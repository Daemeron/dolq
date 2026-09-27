package bouncer

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"path/filepath"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Daemeron/dolq/backend/internal/history"
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

func pipeSession(t *testing.T, b *Bouncer, serverID string, initial Subscriber) (net.Conn, *bufio.Reader) {
	t.Helper()
	clientConn, serverConn := net.Pipe()
	t.Cleanup(func() {
		clientConn.Close()
		serverConn.Close()
	})

	client := ircclient.New(clientConn, "testnick")
	b.connect(serverID, client, initial, nil)

	r := bufio.NewReader(serverConn)
	drainHandshake(t, r)
	return serverConn, r
}

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
	b.Attach(sub, "nonexistent")
	if n := sub.lineCount(); n != 0 {
		t.Errorf("got %d lines, want 0", n)
	}
}

func TestStatusFanOutOnClose(t *testing.T) {
	b := New(nil)
	sub := &fakeSubscriber{}
	server, _ := pipeSession(t, b, "server-a", sub)

	server.Close()

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

	first.Close()

	waitFor(t, func() bool { return sub.lastStatus() == "connecting" })

	second := <-servers
	drainHandshake(t, bufio.NewReader(second))

	waitFor(t, func() bool { return sub.lastStatus() == "connected" })
	if got := b.Status("server-a"); got != "connected" {
		t.Errorf("Status(server-a) = %q, want connected", got)
	}

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

	second := <-servers
	drainHandshake(t, bufio.NewReader(second))
	waitFor(t, func() bool { return sub.lastStatus() == "connected" })
}

func TestDisconnectDuringBackoffCancelsReconnect(t *testing.T) {
	dial, servers := pipeDial(t)
	b := New(nil)
	b.ReconnectBackoffBase = 200 * time.Millisecond
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

func TestReconnectRejoinsPreviouslyJoinedChannels(t *testing.T) {
	dial, servers := pipeDial(t)
	b := New(nil)
	b.ReconnectBackoffBase = 20 * time.Millisecond
	b.ReconnectBackoffMax = 20 * time.Millisecond

	sub := &fakeSubscriber{}
	client, err := dial()
	if err != nil {
		t.Fatal(err)
	}
	first := <-servers
	b.connect("server-a", client, sub, dial)
	drainHandshake(t, bufio.NewReader(first))

	writeLine(t, first, ":testnick!u@h JOIN :#chat")
	waitFor(t, func() bool { return slices.Contains(b.JoinedChannels("server-a"), "#chat") })

	first.Close()
	waitFor(t, func() bool { return sub.lastStatus() == "connecting" })

	second := <-servers
	secondReader := bufio.NewReader(second)
	drainHandshake(t, secondReader)
	writeLine(t, second, ":irc.example.net 001 testnick :Welcome back")

	line, err := secondReader.ReadString('\n')
	if err != nil {
		t.Fatalf("read rejoin: %v", err)
	}
	if line != "JOIN #chat\r\n" {
		t.Errorf("got %q, want JOIN #chat\\r\\n", line)
	}
}

func TestUnexpectedDropAndReconnectLogSystemLines(t *testing.T) {
	dial, servers := pipeDial(t)
	b := New(nil)
	b.ReconnectBackoffBase = 20 * time.Millisecond
	b.ReconnectBackoffMax = 20 * time.Millisecond

	sub := &fakeSubscriber{}
	client, err := dial()
	if err != nil {
		t.Fatal(err)
	}
	first := <-servers
	b.connect("server-a", client, sub, dial)
	drainHandshake(t, bufio.NewReader(first))

	first.Close()
	waitFor(t, func() bool { return sub.lastLine() == "*** Connection lost - reconnecting..." })

	second := <-servers
	drainHandshake(t, bufio.NewReader(second))
	waitFor(t, func() bool { return sub.lastLine() == "*** Reconnected" })
}

func TestDisconnectLogPersistsAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.db")
	store, err := history.Open(path, 0)
	if err != nil {
		t.Fatalf("open history: %v", err)
	}

	b := New(store)
	_, r := pipeSession(t, b, "server-a", &fakeSubscriber{})

	done := make(chan error, 1)
	go func() { done <- b.Disconnect("server-a") }()
	if _, err := r.ReadString('\n'); err != nil {
		t.Fatalf("read QUIT: %v", err)
	}
	if err := <-done; err != nil {
		t.Fatalf("Disconnect: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	reopened, err := history.Open(path, 0)
	if err != nil {
		t.Fatalf("reopen history: %v", err)
	}
	defer reopened.Close()

	entries, err := reopened.Recent("server-a", logChannel, 0, 10)
	if err != nil {
		t.Fatalf("recent: %v", err)
	}
	if len(entries) == 0 || entries[len(entries)-1].Line != "*** Disconnected" {
		t.Fatalf("got %#v, want last entry's line to be %q", entries, "*** Disconnected")
	}
}

func TestDisconnectLogsASystemLine(t *testing.T) {
	sub := &fakeSubscriber{}
	b := New(nil)
	_, r := pipeSession(t, b, "server-a", sub)

	done := make(chan error, 1)
	go func() { done <- b.Disconnect("server-a") }()

	if _, err := r.ReadString('\n'); err != nil {
		t.Fatalf("read QUIT: %v", err)
	}
	if err := <-done; err != nil {
		t.Fatalf("Disconnect: %v", err)
	}
	waitFor(t, func() bool { return sub.lastLine() == "*** Disconnected" })
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
