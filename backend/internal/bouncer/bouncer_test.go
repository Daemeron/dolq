package bouncer

import (
	"bufio"
	"context"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/Daemeron/dolq/backend/internal/ircclient"
)

type fakeSubscriber struct {
	mu     sync.Mutex
	lines  []string
	status []string
}

func (f *fakeSubscriber) SendLine(serverID, line string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lines = append(f.lines, line)
}

func (f *fakeSubscriber) SendEvent(serverID string, event any) {}

func (f *fakeSubscriber) SendStatus(serverID, status string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.status = append(f.status, status)
}

func (f *fakeSubscriber) lineCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.lines)
}

func (f *fakeSubscriber) lastLine() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.lines) == 0 {
		return ""
	}
	return f.lines[len(f.lines)-1]
}

func (f *fakeSubscriber) lastStatus() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.status) == 0 {
		return ""
	}
	return f.status[len(f.status)-1]
}

// pipeSession wires a new Bouncer session for serverID to one end of an
// in-memory net.Pipe(), handing the test the other end (and a line reader
// on it) to act as the fake IRC server - reusing the real ircclient.Client
// rather than a second mock of the wire protocol.
func pipeSession(t *testing.T, b *Bouncer, serverID string, initial Subscriber) (net.Conn, *bufio.Reader) {
	t.Helper()
	clientConn, serverConn := net.Pipe()
	t.Cleanup(func() {
		clientConn.Close()
		serverConn.Close()
	})

	client := ircclient.New(clientConn, "testnick")
	b.connect(serverID, client, initial)

	r := bufio.NewReader(serverConn)
	for i := 0; i < 3; i++ { // drain the PASS/NICK/USER handshake
		if _, err := r.ReadString('\n'); err != nil {
			t.Fatalf("drain handshake: %v", err)
		}
	}
	return serverConn, r
}

func writeLine(t *testing.T, conn net.Conn, line string) {
	t.Helper()
	done := make(chan error, 1)
	go func() {
		_, err := conn.Write([]byte(line + "\r\n"))
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("write line: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out writing a line")
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition never became true within the deadline")
}

func TestFanOutIsScopedPerServerID(t *testing.T) {
	b := New()

	subA1, subA2 := &fakeSubscriber{}, &fakeSubscriber{}
	serverA, _ := pipeSession(t, b, "server-a", subA1)
	b.Attach(subA2, "server-a")

	subB := &fakeSubscriber{}
	pipeSession(t, b, "server-b", subB)

	writeLine(t, serverA, ":irc.example.net 001 me :Welcome")

	waitFor(t, func() bool { return subA1.lineCount() == 1 })
	waitFor(t, func() bool { return subA2.lineCount() == 1 })

	want := ":irc.example.net 001 me :Welcome"
	if got := subA1.lastLine(); got != want {
		t.Errorf("subA1 got %q, want %q", got, want)
	}
	if got := subA2.lastLine(); got != want {
		t.Errorf("subA2 got %q, want %q", got, want)
	}
	if n := subB.lineCount(); n != 0 {
		t.Errorf("subB (attached to a different serverID) got %d lines, want 0", n)
	}
}

func TestDetachStopsFanOutWithoutClosingTheSession(t *testing.T) {
	b := New()
	sub := &fakeSubscriber{}
	server, _ := pipeSession(t, b, "server-a", sub)

	b.Detach(sub)
	writeLine(t, server, ":irc.example.net 001 me :Welcome")

	time.Sleep(50 * time.Millisecond)
	if n := sub.lineCount(); n != 0 {
		t.Errorf("expected no lines after Detach, got %d", n)
	}
	if got := b.Status("server-a"); got != "connected" {
		t.Errorf("Status(server-a) = %q, want connected (detaching a subscriber doesn't disconnect the session)", got)
	}
}

func TestAttachToAnUnknownServerIDIsANoOp(t *testing.T) {
	b := New()
	sub := &fakeSubscriber{}
	b.Attach(sub, "nonexistent") // must not panic
	if n := sub.lineCount(); n != 0 {
		t.Errorf("got %d lines, want 0", n)
	}
}

func TestStatusFanOutOnClose(t *testing.T) {
	b := New()
	sub := &fakeSubscriber{}
	server, _ := pipeSession(t, b, "server-a", sub)

	server.Close() // the far end going away

	waitFor(t, func() bool { return sub.lastStatus() == "disconnected" })
	waitFor(t, func() bool { return b.Status("server-a") == "disconnected" })
}

func TestShutdownDisconnectsEverySession(t *testing.T) {
	b := New()
	_, readerA := pipeSession(t, b, "server-a", &fakeSubscriber{})
	_, readerB := pipeSession(t, b, "server-b", &fakeSubscriber{})

	done := make(chan struct{})
	go func() {
		b.Shutdown(context.Background())
		close(done)
	}()

	for name, r := range map[string]*bufio.Reader{"server-a": readerA, "server-b": readerB} {
		line, err := r.ReadString('\n')
		if err != nil {
			t.Fatalf("%s: read QUIT: %v", name, err)
		}
		if line != "QUIT\r\n" {
			t.Errorf("%s: got %q, want QUIT\\r\\n", name, line)
		}
	}

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Shutdown did not return")
	}
}
