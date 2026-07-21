package bouncer

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Daemeron/dolq/backend/internal/ircclient"
	"github.com/Daemeron/dolq/backend/internal/ircparse"
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

	// dial: nil - net.Pipe() can't be redialed, so this session opts out of
	// auto-reconnect (see TestReconnect* below for that, over a dialFunc
	// that can be).
	client := ircclient.New(clientConn, "testnick")
	b.connect(serverID, client, initial, nil)

	r := bufio.NewReader(serverConn)
	drainHandshake(t, r)
	return serverConn, r
}

// drainHandshake reads off CAP LS plus the PASS/NICK/USER lines every
// ircclient handshake sends, so a test's subsequent reads see only its own
// traffic.
func drainHandshake(t *testing.T, r *bufio.Reader) {
	t.Helper()
	for range 4 {
		if _, err := r.ReadString('\n'); err != nil {
			t.Fatalf("drain handshake: %v", err)
		}
	}
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
	b := New(nil)

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
	b := New(nil)
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
	b := New(nil)
	sub := &fakeSubscriber{}
	b.Attach(sub, "nonexistent") // must not panic
	if n := sub.lineCount(); n != 0 {
		t.Errorf("got %d lines, want 0", n)
	}
}

func TestStatusFanOutOnClose(t *testing.T) {
	b := New(nil)
	sub := &fakeSubscriber{}
	server, _ := pipeSession(t, b, "server-a", sub)

	server.Close() // the far end going away

	waitFor(t, func() bool { return sub.lastStatus() == "disconnected" })
	waitFor(t, func() bool { return b.Status("server-a") == "disconnected" })
}

func TestShutdownDisconnectsEverySession(t *testing.T) {
	b := New(nil)
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

// pipeDial returns a dialFunc that redials by handing out a fresh
// net.Pipe() pair each call, and a channel delivering the server-side end
// of each one so a test can drive it as a fake IRC server.
func pipeDial(t *testing.T) (dialFunc, chan net.Conn) {
	t.Helper()
	servers := make(chan net.Conn, 8)
	dial := func() (*ircclient.Client, error) {
		clientConn, serverConn := net.Pipe()
		t.Cleanup(func() { clientConn.Close(); serverConn.Close() })
		servers <- serverConn
		return ircclient.New(clientConn, "testnick"), nil
	}
	return dial, servers
}

func TestReconnectsAfterUnexpectedDrop(t *testing.T) {
	dial, servers := pipeDial(t)
	b := New(nil)
	// Long enough that "connecting" is reliably observable as the *last*
	// status before the redial (which succeeds immediately, no real
	// network involved) flips it to "connected" - too short a backoff
	// races the poll below.
	b.ReconnectBackoffBase = 50 * time.Millisecond
	b.ReconnectBackoffMax = 50 * time.Millisecond

	sub := &fakeSubscriber{}
	client, err := dial()
	if err != nil {
		t.Fatal(err)
	}
	first := <-servers
	b.connect("server-a", client, sub, dial)
	drainHandshake(t, bufio.NewReader(first))

	first.Close() // the far end going away unexpectedly

	waitFor(t, func() bool { return sub.lastStatus() == "connecting" })

	second := <-servers // reconnect's redial
	drainHandshake(t, bufio.NewReader(second))

	waitFor(t, func() bool { return sub.lastStatus() == "connected" })
	if got := b.Status("server-a"); got != "connected" {
		t.Errorf("Status(server-a) = %q, want connected", got)
	}

	// Still fanning out to the original subscriber over the new connection,
	// without needing to re-Attach.
	writeLine(t, second, ":irc.example.net 001 me :Welcome back")
	waitFor(t, func() bool { return sub.lastLine() == ":irc.example.net 001 me :Welcome back" })
}

func TestReconnectRetriesOnDialFailure(t *testing.T) {
	realDial, servers := pipeDial(t)
	var failuresLeft atomic.Int32
	failuresLeft.Store(2)
	dial := func() (*ircclient.Client, error) {
		if failuresLeft.Add(-1) >= 0 {
			return nil, fmt.Errorf("simulated dial failure")
		}
		return realDial()
	}

	b := New(nil)
	b.ReconnectBackoffBase = 20 * time.Millisecond
	b.ReconnectBackoffMax = 20 * time.Millisecond

	sub := &fakeSubscriber{}
	client, err := realDial()
	if err != nil {
		t.Fatal(err)
	}
	first := <-servers
	b.connect("server-a", client, sub, dial)
	drainHandshake(t, bufio.NewReader(first))

	first.Close()
	waitFor(t, func() bool { return sub.lastStatus() == "connecting" })

	// Only arrives once the two simulated dial failures have been retried
	// past.
	second := <-servers
	drainHandshake(t, bufio.NewReader(second))
	waitFor(t, func() bool { return sub.lastStatus() == "connected" })
}

func TestDisconnectDuringBackoffCancelsReconnect(t *testing.T) {
	dial, servers := pipeDial(t)
	b := New(nil)
	b.ReconnectBackoffBase = 200 * time.Millisecond // long enough to Disconnect mid-sleep
	b.ReconnectBackoffMax = 200 * time.Millisecond

	sub := &fakeSubscriber{}
	client, err := dial()
	if err != nil {
		t.Fatal(err)
	}
	first := <-servers
	b.connect("server-a", client, sub, dial)
	drainHandshake(t, bufio.NewReader(first))

	first.Close()
	waitFor(t, func() bool { return sub.lastStatus() == "connecting" })

	if err := b.Disconnect("server-a"); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}

	waitFor(t, func() bool { return sub.lastStatus() == "disconnected" })
	waitFor(t, func() bool { return b.Status("server-a") == "disconnected" })

	select {
	case <-servers:
		t.Fatal("dial was retried after Disconnect")
	case <-time.After(300 * time.Millisecond):
	}
}

func TestEventChannelBucketing(t *testing.T) {
	tests := []struct {
		name  string
		event any
		want  string
	}{
		{"channel PRIVMSG keeps its target", ircparse.PrivmsgEvent{Nick: "alice", Target: "#general"}, "#general"},
		{"DM PRIVMSG buckets by sender, not our own nick", ircparse.PrivmsgEvent{Nick: "alice", Target: "dolq_user"}, "alice"},
		{"channel ACTION keeps its target", ircparse.ActionEvent{Nick: "alice", Target: "#general"}, "#general"},
		{"DM ACTION buckets by sender", ircparse.ActionEvent{Nick: "alice", Target: "dolq_user"}, "alice"},
		{"channel NOTICE keeps its target", ircparse.NoticeEvent{Nick: "alice", Target: "#general"}, "#general"},
		{"private NOTICE falls back to the log bucket, not the sender", ircparse.NoticeEvent{Nick: "irc.example.net", Target: "dolq_user"}, logChannel},
		{"WELCOME falls back to the log bucket", ircparse.WelcomeEvent{Nick: "dolq_user"}, logChannel},
		{"NICKINUSE falls back to the log bucket", ircparse.NickInUseEvent{Nick: "dolq_user"}, logChannel},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := eventChannel(tt.event); got != tt.want {
				t.Errorf("eventChannel(%#v) = %q, want %q", tt.event, got, tt.want)
			}
		})
	}
}
