package dcc

import (
	"net"
	"strconv"
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

func TestSessionRoundTrip(t *testing.T) {
	ln, err := Listen()
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
	ln, err := Listen()
	if err != nil {
		t.Fatalf("Listen: %v", err)
	}
	if _, err := AcceptOnce(ln, 50*time.Millisecond); err == nil {
		t.Error("expected a timeout error, got nil")
	}
}

func TestSessionOnCloseFiresOnDisconnect(t *testing.T) {
	ln, err := Listen()
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

	// Registering after the connection already closed should fire immediately.
	fired := make(chan struct{})
	server.OnClose(func() { close(fired) })
	select {
	case <-fired:
	case <-time.After(time.Second):
		t.Fatal("OnClose registered post-close never fired")
	}
}
