package bouncer

import (
	"bufio"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Daemeron/dolq/backend/internal/dcc"
)

func TestDCCOffer(t *testing.T) {
	t.Run("sends the CTCP offer, then connects once the peer dials in and exchanges lines", func(t *testing.T) {
		b := New(nil)
		sub := &fakeSubscriber{}
		serverConn, r := pipeSession(t, b, "server-a", sub)
		_ = serverConn

		// DCCOffer's SendPaced blocks until something reads it - over the
		// real OS sockets ipcproto actually uses that's instant, but this
		// test's net.Pipe() is fully synchronous/unbuffered, so the read
		// below has to happen concurrently, not after.
		type offerResult struct {
			id  string
			err error
		}
		offerCh := make(chan offerResult, 1)
		go func() {
			id, err := b.DCCOffer("server-a", "alice", 0, 0, sub)
			offerCh <- offerResult{id, err}
		}()

		line, err := r.ReadString('\n')
		if err != nil {
			t.Fatalf("read CTCP offer: %v", err)
		}
		prefix, suffix := "PRIVMSG alice :\x01DCC CHAT chat ", "\x01\r\n"
		if !strings.HasPrefix(line, prefix) || !strings.HasSuffix(line, suffix) {
			t.Fatalf("got %q, want a DCC CHAT CTCP offer", line)
		}
		fields := strings.Fields(strings.TrimSuffix(strings.TrimPrefix(line, prefix), suffix))
		if len(fields) != 2 {
			t.Fatalf("offer body = %q, want \"<ip> <port>\"", line)
		}
		port, err := strconv.Atoi(fields[1])
		if err != nil {
			t.Fatalf("parse announced port: %v", err)
		}

		var offer offerResult
		select {
		case offer = <-offerCh:
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for DCCOffer to return")
		}
		if offer.err != nil {
			t.Fatalf("DCCOffer: %v", offer.err)
		}
		id := offer.id

		waitFor(t, func() bool { return sub.lastStatus() == "connecting" })

		peer, err := net.Dial("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
		if err != nil {
			t.Fatalf("dial back to the offered listener: %v", err)
		}
		t.Cleanup(func() { peer.Close() })

		waitFor(t, func() bool { return sub.lastStatus() == "connected" })

		if _, err := peer.Write([]byte("hello from peer\r\n")); err != nil {
			t.Fatalf("peer write: %v", err)
		}
		waitFor(t, func() bool { return sub.lastLine() == "hello from peer" })

		if err := b.DCCSend(id, "hello from us"); err != nil {
			t.Fatalf("DCCSend: %v", err)
		}
		peerReader := bufio.NewReader(peer)
		got, err := peerReader.ReadString('\n')
		if err != nil {
			t.Fatalf("peer read: %v", err)
		}
		if strings.TrimRight(got, "\r\n") != "hello from us" {
			t.Errorf("peer received %q, want %q", got, "hello from us\r\n")
		}

		if err := b.DCCClose(id); err != nil {
			t.Fatalf("DCCClose: %v", err)
		}
		waitFor(t, func() bool { return sub.lastStatus() == "disconnected" })
	})

	t.Run("errors when there's no IRC session for serverID to send the offer over", func(t *testing.T) {
		b := New(nil)
		if _, err := b.DCCOffer("no-such-server", "alice", 0, 0, &fakeSubscriber{}); err == nil {
			t.Error("expected an error, got nil")
		}
	})

	t.Run("reports disconnected if nobody connects before the timeout", func(t *testing.T) {
		b := New(nil)
		b.DCCAcceptTimeout = 50 * time.Millisecond
		sub := &fakeSubscriber{}
		_, r := pipeSession(t, b, "server-a", sub)

		errCh := make(chan error, 1)
		go func() {
			_, err := b.DCCOffer("server-a", "alice", 0, 0, sub)
			errCh <- err
		}()
		if _, err := r.ReadString('\n'); err != nil {
			t.Fatalf("read CTCP offer: %v", err)
		}
		if err := <-errCh; err != nil {
			t.Fatalf("DCCOffer: %v", err)
		}

		waitFor(t, func() bool { return sub.lastStatus() == "disconnected" })
	})
}

func TestDCCAccept(t *testing.T) {
	t.Run("dials the peer's listener and exchanges lines", func(t *testing.T) {
		ln, err := dcc.Listen(0, 0)
		if err != nil {
			t.Fatalf("Listen: %v", err)
		}
		_, portStr, _ := net.SplitHostPort(ln.Addr().String())
		port, _ := strconv.Atoi(portStr)

		peerConnCh := make(chan net.Conn, 1)
		go func() {
			conn, err := ln.Accept()
			if err == nil {
				peerConnCh <- conn
			}
		}()

		b := New(nil)
		sub := &fakeSubscriber{}
		id, err := b.DCCAccept("127.0.0.1", port, sub)
		if err != nil {
			t.Fatalf("DCCAccept: %v", err)
		}
		waitFor(t, func() bool { return sub.lastStatus() == "connected" })

		var peer net.Conn
		select {
		case peer = <-peerConnCh:
		case <-time.After(2 * time.Second):
			t.Fatal("peer never accepted a connection")
		}
		t.Cleanup(func() { peer.Close() })

		if _, err := peer.Write([]byte("hi from listener\r\n")); err != nil {
			t.Fatalf("peer write: %v", err)
		}
		waitFor(t, func() bool { return sub.lastLine() == "hi from listener" })

		if err := b.DCCSend(id, "hi from dialer"); err != nil {
			t.Fatalf("DCCSend: %v", err)
		}
		got, err := bufio.NewReader(peer).ReadString('\n')
		if err != nil {
			t.Fatalf("peer read: %v", err)
		}
		if strings.TrimRight(got, "\r\n") != "hi from dialer" {
			t.Errorf("peer received %q, want %q", got, "hi from dialer\r\n")
		}
	})

	t.Run("errors when nothing is listening at that address", func(t *testing.T) {
		if _, err := New(nil).DCCAccept("127.0.0.1", 1, &fakeSubscriber{}); err == nil {
			t.Error("expected an error, got nil")
		}
	})
}

func TestDCCSendUnknownSession(t *testing.T) {
	b := New(nil)
	if err := b.DCCSend("dcc:no-such-id", "hi"); err == nil {
		t.Error("expected an error, got nil")
	}
}

func TestDCCCloseUnknownSessionIsANoOp(t *testing.T) {
	b := New(nil)
	if err := b.DCCClose("dcc:no-such-id"); err != nil {
		t.Errorf("expected no error, got %v", err)
	}
}
