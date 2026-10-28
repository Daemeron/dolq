package dcc

import (
	"net"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestEncodeDecodeIP(t *testing.T) {
	tests := []struct {
		ip   string
		want uint32
	}{
		{"192.168.1.1", 3232235777},
		{"127.0.0.1", 2130706433},
		{"8.8.8.8", 134744072},
	}
	for _, tt := range tests {
		t.Run(tt.ip, func(t *testing.T) {
			ip := net.ParseIP(tt.ip)
			if got := EncodeIP(ip); got != tt.want {
				t.Errorf("EncodeIP(%s) = %d, want %d", tt.ip, got, tt.want)
			}
			if got := DecodeIP(tt.want); !got.Equal(ip) {
				t.Errorf("DecodeIP(%d) = %s, want %s", tt.want, got, tt.ip)
			}
		})
	}
}

func TestListenPortRange(t *testing.T) {
	t.Run("binds within the requested range", func(t *testing.T) {
		probe, err := net.Listen("tcp", ":0")
		if err != nil {
			t.Fatalf("probe listen: %v", err)
		}
		port := probe.Addr().(*net.TCPAddr).Port
		probe.Close()

		ln, err := Listen(port, port+5)
		if err != nil {
			t.Fatalf("Listen: %v", err)
		}
		defer ln.Close()
		got := ln.Addr().(*net.TCPAddr).Port
		if got < port || got > port+5 {
			t.Errorf("bound port %d, want within [%d, %d]", got, port, port+5)
		}
	})

	t.Run("errors when every port in the range is already taken", func(t *testing.T) {
		probe, err := net.Listen("tcp", ":0")
		if err != nil {
			t.Fatalf("probe listen: %v", err)
		}
		defer probe.Close()
		port := probe.Addr().(*net.TCPAddr).Port

		if _, err := Listen(port, port); err == nil {
			t.Error("expected an error, got nil")
		}
	})

	t.Run("rejects a backwards range", func(t *testing.T) {
		if _, err := Listen(5000, 4000); err == nil {
			t.Error("expected an error, got nil")
		}
	})
}

func TestSessionRoundTrip(t *testing.T) {
	ln, err := Listen(0, 0)
	if err != nil {
		t.Fatalf("Listen: %v", err)
	}
	_, portStr, err := net.SplitHostPort(ln.Addr().String())
	if err != nil {
		t.Fatalf("split listener addr: %v", err)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		t.Fatalf("parse port: %v", err)
	}

	acceptedCh := make(chan *Session, 1)
	acceptErrCh := make(chan error, 1)
	go func() {
		sess, err := AcceptOnce(ln, 2*time.Second)
		if err != nil {
			acceptErrCh <- err
			return
		}
		acceptedCh <- sess
	}()

	client, err := Dial("127.0.0.1", port)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	t.Cleanup(func() { client.Close() })

	var server *Session
	select {
	case server = <-acceptedCh:
	case err := <-acceptErrCh:
		t.Fatalf("AcceptOnce: %v", err)
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for AcceptOnce")
	}
	t.Cleanup(func() { server.Close() })

	serverLines := make(chan string, 1)
	server.AddLineListener(func(line string) { serverLines <- line })
	server.Start()
	client.Start()

	if err := client.Send("hello from client"); err != nil {
		t.Fatalf("client.Send: %v", err)
	}
	select {
	case got := <-serverLines:
		if got != "hello from client" {
			t.Errorf("server received %q, want %q", got, "hello from client")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for the line")
	}

	clientLines := make(chan string, 1)
	client.AddLineListener(func(line string) { clientLines <- line })
	if err := server.Send("hello from server"); err != nil {
		t.Fatalf("server.Send: %v", err)
	}
	select {
	case got := <-clientLines:
		if got != "hello from server" {
			t.Errorf("client received %q, want %q", got, "hello from server")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for the line")
	}
}

func TestAcceptOnceTimesOut(t *testing.T) {
	ln, err := Listen(0, 0)
	if err != nil {
		t.Fatalf("Listen: %v", err)
	}
	if _, err := AcceptOnce(ln, 50*time.Millisecond); err == nil {
		t.Error("expected a timeout error, got nil")
	}
}

func TestSessionOnCloseFiresOnDisconnect(t *testing.T) {
	ln, err := Listen(0, 0)
	if err != nil {
		t.Fatalf("Listen: %v", err)
	}
	_, portStr, _ := net.SplitHostPort(ln.Addr().String())
	port, _ := strconv.Atoi(portStr)

	acceptedCh := make(chan *Session, 1)
	go func() {
		sess, err := AcceptOnce(ln, 2*time.Second)
		if err == nil {
			acceptedCh <- sess
		}
	}()

	client, err := Dial("127.0.0.1", port)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	server := <-acceptedCh
	server.Start()
	client.Start()

	closed := make(chan struct{})
	server.OnClose(func() { close(closed) })

	client.Close()

	select {
	case <-closed:
	case <-time.After(2 * time.Second):
		t.Fatal("OnClose never fired")
	}

	fired := make(chan struct{})
	server.OnClose(func() { close(fired) })
	select {
	case <-fired:
	case <-time.After(time.Second):
		t.Fatal("OnClose registered post-close never fired")
	}
}

// Every OnClose callback must fire exactly once, including ones registered
// while the close callbacks are running (from inside a callback or from
// another goroutine racing the disconnect).
func TestSessionOnCloseRacingDisconnect(t *testing.T) {
	for i := 0; i < 200; i++ {
		serverConn, clientConn := net.Pipe()
		sess := newSession(serverConn)

		const racers = 8
		var fired [racers + 2]atomic.Int32
		sess.OnClose(func() {
			fired[0].Add(1)
			// Registering from inside a callback must neither deadlock nor
			// be dropped.
			sess.OnClose(func() { fired[1].Add(1) })
		})

		var wg sync.WaitGroup
		start := make(chan struct{})
		for r := 0; r < racers; r++ {
			wg.Add(1)
			go func(r int) {
				defer wg.Done()
				<-start
				sess.OnClose(func() { fired[r+2].Add(1) })
			}(r)
		}

		sess.Start()
		close(start)
		clientConn.Close()
		wg.Wait()

		allFired := func() bool {
			for j := range fired {
				if fired[j].Load() == 0 {
					return false
				}
			}
			return true
		}
		deadline := time.Now().Add(2 * time.Second)
		for !allFired() {
			if time.Now().After(deadline) {
				t.Fatalf("iteration %d: some OnClose callbacks never fired", i)
			}
			time.Sleep(time.Millisecond)
		}
		// Give any duplicate call a moment to show up.
		time.Sleep(time.Millisecond)
		for j := range fired {
			if n := fired[j].Load(); n != 1 {
				t.Fatalf("iteration %d: callback %d fired %d times, want 1", i, j, n)
			}
		}
	}
}

func TestLocalIPIsAUsableAddress(t *testing.T) {
	ip, err := LocalIP()
	if err != nil {
		t.Skipf("no route to the internet here: %v", err)
	}
	if ip == nil || ip.IsUnspecified() {
		t.Errorf("LocalIP = %v", ip)
	}
}
