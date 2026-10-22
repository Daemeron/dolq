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

func TestDisconnectDuringBackoffReturnsOnlyOnceReconnectHasStopped(t *testing.T) {
	dial, servers := pipeDial(t)
	b := New(nil)
	b.ReconnectBackoffBase = 10 * time.Second
	b.ReconnectBackoffMax = 10 * time.Second

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
	// No waiting: a Connect that follows must not be followed by a stale "disconnected".
	if got := sub.lastStatus(); got != "disconnected" {
		t.Errorf("status right after Disconnect = %q, want disconnected", got)
	}
	if got := b.Status("server-a"); got != "disconnected" {
		t.Errorf("Status(server-a) right after Disconnect = %q, want disconnected", got)
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

func TestSecondDropBeforeWelcomeKeepsTheChannels(t *testing.T) {
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
	writeLine(t, first, ":irc.example.net 001 testnick :Welcome")
	writeLine(t, first, ":testnick!u@h JOIN :#chat")
	waitFor(t, func() bool { return slices.Contains(b.JoinedChannels("server-a"), "#chat") })

	first.Close()
	second := <-servers
	drainHandshake(t, bufio.NewReader(second))
	// Dropped again before the welcome, so nothing was rejoined on this one.
	second.Close()

	third := <-servers
	thirdReader := bufio.NewReader(third)
	drainHandshake(t, thirdReader)
	writeLine(t, third, ":irc.example.net 001 testnick :Welcome back")

	line, err := thirdReader.ReadString('\n')
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

func TestOutgoingEvent(t *testing.T) {
	cases := []struct {
		name, line, wantChannel string
		want                    any
	}{
		{"private message goes to the other party's nick", "PRIVMSG bob :hi", "bob",
			ircparse.PrivmsgEvent{Type: "PRIVMSG", Nick: "me", Target: "bob", Text: "hi"}},
		{"channel message goes to the channel", "PRIVMSG #chan :hi there", "#chan",
			ircparse.PrivmsgEvent{Type: "PRIVMSG", Nick: "me", Target: "#chan", Text: "hi there"}},
		{"action", "PRIVMSG bob :\x01ACTION waves\x01", "bob",
			ircparse.ActionEvent{Type: "ACTION", Nick: "me", Target: "bob", Text: "waves"}},
		{"not a message", "JOIN #chan", "", nil},
		{"CTCP request", "PRIVMSG bob :\x01VERSION\x01", "", nil},
		{"services password", "PRIVMSG NickServ :identify hunter2", "", nil},
		{"services by host", "PRIVMSG Q@CServe.quakenet.org :AUTH me pw", "", nil},
		{"credentials to a plain nick", "PRIVMSG bot :identify hunter2", "", nil},
		{"channel chat that starts like a credential", "PRIVMSG #chan :release notes tomorrow", "#chan",
			ircparse.PrivmsgEvent{Type: "PRIVMSG", Nick: "me", Target: "#chan", Text: "release notes tomorrow"}},
		{"pack request", "PRIVMSG bot :XDCC SEND #5", "bot",
			ircparse.PrivmsgEvent{Type: "PRIVMSG", Nick: "me", Target: "bot", Text: "XDCC SEND #5"}},
	}
	for _, tc := range cases {
		ch, ev, ok := outgoingEvent("me", tc.line)
		if ok != (tc.want != nil) || ch != tc.wantChannel || ev != tc.want {
			t.Errorf("%s: got (%q, %#v, %v)", tc.name, ch, ev, ok)
		}
	}
	if _, _, ok := outgoingEvent("", "PRIVMSG bob :hi"); ok {
		t.Error("stored a message before the nick was known")
	}
}

func TestSendStoresOwnMessagesAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.db")
	store, err := history.Open(path, 0)
	if err != nil {
		t.Fatal(err)
	}
	b := New(store)
	_, r := pipeSession(t, b, "server-a", &fakeSubscriber{})
	read := make(chan struct{}, 2)
	go func() {
		for range 2 {
			if _, err := r.ReadString('\n'); err != nil {
				return
			}
			read <- struct{}{}
		}
	}()
	for _, line := range []string{"PRIVMSG bob :hello", "PRIVMSG NickServ :identify hunter2"} {
		if err := b.Send("server-a", line); err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		select {
		case <-read:
		case <-time.After(5 * time.Second):
			t.Fatal("lines were not written to the server")
		}
	}
	done := make(chan error, 1)
	go func() { done <- b.Disconnect("server-a") }()
	if _, err := r.ReadString('\n'); err != nil {
		t.Fatalf("read QUIT: %v", err)
	}
	if err := <-done; err != nil {
		t.Fatalf("Disconnect: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := history.Open(path, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	dm, _ := reopened.Recent("server-a", "bob", 0, 10)
	if len(dm) != 1 {
		t.Fatalf("got %d entries for bob, want 1", len(dm))
	}
	all, _ := reopened.Recent("server-a", "NickServ", 0, 10)
	if len(all) != 0 {
		t.Fatalf("services message was stored: %#v", all)
	}
}

func TestChannelScopedLine(t *testing.T) {
	for _, line := range []string{
		":alice!u@h PRIVMSG #chan :hello",
		":alice!u@h PRIVMSG me :psst",
		":alice!u@h JOIN :#chan",
		":alice!u@h PART #chan :bye",
		":op!u@h KICK #chan bob :spam",
		":alice!u@h QUIT :Ping timeout",
		":alice!u@h NICK :alicia",
		":op!u@h MODE #chan +o bob",
		":op!u@h TOPIC #chan :new topic",
		":alice!u@h NOTICE #chan :hi all",
		":alice!u@h NOTICE @#chan :ops only",
		":alice!u@h AWAY :gone",
		":srv 332 me #chan :topic",
		":srv 333 me #chan op!u@h 1700000000",
		":srv 353 me = #chan :me @op alice",
		":srv 366 me #chan :End of /NAMES list.",
		"@time=2024-01-01T00:00:00Z :alice!u@h PRIVMSG #chan :tagged",
	} {
		if !channelScopedLine(line) {
			t.Errorf("channelScopedLine(%q) = false, want true", line)
		}
	}
	for _, line := range []string{
		":srv 001 me :Welcome to the network",
		":srv 372 me :- message of the day",
		":srv 433 * me :Nickname is already in use",
		":srv 404 me #chan :Cannot send to channel",
		":NickServ!s@h NOTICE me :This nickname is registered",
		":srv NOTICE * :*** Looking up your hostname",
		":me!u@h MODE me +i",
		"PING :token",
		":srv 311 me alice u h * :Alice",
		"*** Disconnected",
		"*** Connection lost - reconnecting...",
		"",
	} {
		if channelScopedLine(line) {
			t.Errorf("channelScopedLine(%q) = true, want false", line)
		}
	}
}

func TestLogKeepsOnlyServerLines(t *testing.T) {
	store, err := history.Open(":memory:", 0)
	if err != nil {
		t.Fatalf("open history: %v", err)
	}
	defer store.Close()
	sub := &fakeSubscriber{}
	b := New(store)
	conn, _ := pipeSession(t, b, "server-a", sub)

	writeLine(t, conn, ":alice!u@h PRIVMSG #chan :hello")
	writeLine(t, conn, ":srv 372 me :- message of the day")
	// Both still reach the client live.
	waitFor(t, func() bool { return sub.lineCount() == 2 })
	waitFor(t, func() bool {
		entries, _ := store.Recent("server-a", logChannel, 0, 10)
		return len(entries) == 1 && entries[0].Line == ":srv 372 me :- message of the day"
	})
	if entries, _ := store.Recent("server-a", "#chan", 0, 10); len(entries) != 1 || entries[0].IsRaw {
		t.Fatalf("got %+v in #chan, want just the PRIVMSG event", entries)
	}
}

// closeSignalConn reports the first Close, so a test can act at exactly the
// point Disconnect gives the connection up.
type closeSignalConn struct {
	net.Conn
	once    sync.Once
	closing chan struct{}
}

func (c *closeSignalConn) Close() error {
	c.once.Do(func() { close(c.closing) })
	return c.Conn.Close()
}

func receive[T any](t *testing.T, ch <-chan T, what string) T {
	t.Helper()
	select {
	case v := <-ch:
		return v
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for %s", what)
		var zero T
		return zero
	}
}

// A Disconnect that lands while the drop is still being handled must neither
// fail nor return before the session has settled. A close listener that blocks
// holds the client in that window for as long as the test needs.
func TestDisconnectWhileTheDropIsHandled(t *testing.T) {
	for _, tc := range []struct {
		name string
		// holdFirst blocks before the bouncer sees the drop instead of after.
		holdFirst bool
	}{
		{"after the bouncer started a redial", false},
		{"before the bouncer saw the drop", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dial, servers := pipeDial(t)
			b := New(nil)
			b.ReconnectBackoffBase = time.Hour
			b.ReconnectBackoffMax = time.Hour

			clientConn, server := net.Pipe()
			t.Cleanup(func() { clientConn.Close(); server.Close() })
			conn := &closeSignalConn{Conn: clientConn, closing: make(chan struct{})}
			client := ircclient.New(conn, "testnick")

			entered, release := make(chan struct{}), make(chan struct{})
			releaseOnce := sync.OnceFunc(func() { close(release) })
			t.Cleanup(releaseOnce)
			hold := func() {
				close(entered)
				<-release
			}
			if tc.holdFirst {
				client.OnClose(hold)
			}
			sub := &fakeSubscriber{}
			b.connect("server-a", client, sub, dial)
			if !tc.holdFirst {
				client.OnClose(hold)
			}
			drainHandshake(t, bufio.NewReader(server))

			server.Close()
			receive(t, entered, "the drop to be handled")

			done := make(chan error, 1)
			go func() { done <- b.Disconnect("server-a") }()
			select {
			case <-conn.closing:
			case err := <-done:
				t.Fatalf("Disconnect returned (%v) while the drop was still being handled", err)
			case <-time.After(5 * time.Second):
				t.Fatal("timed out waiting for Disconnect to close the connection")
			}
			releaseOnce()

			if err := receive(t, done, "Disconnect"); err != nil {
				t.Fatalf("Disconnect: %v", err)
			}
			if got := sub.lastStatus(); got != "disconnected" {
				t.Errorf("status right after Disconnect = %q, want disconnected", got)
			}
			if got := b.Status("server-a"); got != "disconnected" {
				t.Errorf("Status(server-a) right after Disconnect = %q, want disconnected", got)
			}
			select {
			case <-servers:
				t.Error("redialed after Disconnect")
			default:
			}
		})
	}
}
