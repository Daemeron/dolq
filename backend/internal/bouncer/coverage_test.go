package bouncer

import (
	"bufio"
	"net"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Daemeron/dolq/backend/internal/dcc"
	"github.com/Daemeron/dolq/backend/internal/history"
	"github.com/Daemeron/dolq/backend/internal/ircparse"
)

func TestEventChannelRoutesEachEventToItsWindow(t *testing.T) {
	cases := []struct {
		name  string
		event any
		want  string
	}{
		{"channel message", ircparse.PrivmsgEvent{Nick: "a", Target: "#c"}, "#c"},
		{"private message goes to the sender", ircparse.PrivmsgEvent{Nick: "a", Target: "me"}, "a"},
		{"action", ircparse.ActionEvent{Nick: "a", Target: "#c"}, "#c"},
		{"pack list", ircparse.XDCCPackEvent{Nick: "bot", Target: "me"}, "bot"},
		{"channel notice", ircparse.NoticeEvent{Target: "#c"}, "#c"},
		{"server notice goes to the log", ircparse.NoticeEvent{Target: "me"}, logChannel},
		{"join", ircparse.JoinEvent{Channel: "#c"}, "#c"},
		{"part", ircparse.PartEvent{Channel: "#c"}, "#c"},
		{"kick", ircparse.KickEvent{Channel: "#c"}, "#c"},
		{"mode", ircparse.ModeEvent{Channel: "#c"}, "#c"},
		{"topic", ircparse.TopicEvent{Channel: "#c"}, "#c"},
		{"topic time", ircparse.TopicWhoTimeEvent{Channel: "#c"}, "#c"},
		{"system", ircparse.SystemEvent{Channel: "#c"}, "#c"},
		{"anything else goes to the log", ircparse.WelcomeEvent{}, logChannel},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := eventChannel(c.event); got != c.want {
				t.Errorf("eventChannel = %q, want %q", got, c.want)
			}
		})
	}
}

func TestSharedChannelsOnlyForQuitAndNick(t *testing.T) {
	if got := sharedChannels(ircparse.QuitEvent{Channels: []string{"#a", "#b"}}); len(got) != 2 {
		t.Errorf("quit: got %v", got)
	}
	if got := sharedChannels(ircparse.NickEvent{Channels: []string{"#a"}}); len(got) != 1 {
		t.Errorf("nick: got %v", got)
	}
	if got := sharedChannels(ircparse.JoinEvent{Channel: "#a"}); got != nil {
		t.Errorf("join: got %v, want nil", got)
	}
}

func TestQuoteIfSpaced(t *testing.T) {
	if got := quoteIfSpaced("plain.iso"); got != "plain.iso" {
		t.Errorf("got %q", got)
	}
	if got := quoteIfSpaced("my file.iso"); got != `"my file.iso"` {
		t.Errorf("got %q", got)
	}
}

func TestXDCCPauseAndResumeNeedAKnownTransfer(t *testing.T) {
	b := New(nil)
	if err := b.XDCCPause("nope"); err == nil {
		t.Error("pausing an unknown transfer succeeded")
	}
	if err := b.XDCCResume("nope"); err == nil {
		t.Error("resuming an unknown transfer succeeded")
	}
	b.xdccConns["x"] = &xdccTransfer{pause: dcc.NewPauseGate()}
	if err := b.XDCCPause("x"); err != nil {
		t.Errorf("pause: %v", err)
	}
	if err := b.XDCCResume("x"); err != nil {
		t.Errorf("resume: %v", err)
	}
}

func TestShutdownCancelsListeningTransfers(t *testing.T) {
	b := New(nil)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	tr := &xdccTransfer{pause: dcc.NewPauseGate(), ln: ln}
	b.xdccConns["x"] = tr
	b.closeAllXDCC()
	if !tr.cancelled {
		t.Error("transfer was not cancelled")
	}
	if _, err := ln.Accept(); err == nil {
		t.Error("listener still accepting after shutdown")
	}
}

func TestHistoryAndSearchReadTheStore(t *testing.T) {
	store, err := history.Open(filepath.Join(t.TempDir(), "h.db"), 0)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	b := New(store)
	store.AppendLine("s", "#c", "hello release", time.Now())
	store.AppendLine("s", "#c", "unrelated", time.Now())

	var recent, found []history.Entry
	waitFor(t, func() bool {
		recent, _ = b.History("s", "#c", 0, 10)
		return len(recent) == 2
	})
	waitFor(t, func() bool {
		found, _ = b.Search("s", "#c", "release", 10)
		return len(found) == 1
	})
	if found[0].Line != "hello release" {
		t.Errorf("search found %q", found[0].Line)
	}
}

func TestConnectDialsTheServerAndDisconnectHangsUp(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	accepted := make(chan net.Conn, 1)
	go func() {
		c, err := ln.Accept()
		if err == nil {
			accepted <- c
		}
	}()

	b := New(nil)
	sub := &fakeSubscriber{}
	port := ln.Addr().(*net.TCPAddr).Port
	if err := b.Connect("s1", "127.0.0.1", port, "mira", false, "", "", "mira", "Mira", nil, "", sub); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	conn := <-accepted
	defer conn.Close()
	r := bufio.NewReader(conn)
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	var seen []string
	for len(seen) < 4 {
		line, err := r.ReadString('\n')
		if err != nil {
			t.Fatalf("read registration: %v (got %v)", err, seen)
		}
		seen = append(seen, strings.TrimSpace(line))
	}
	joined := strings.Join(seen, "|")
	if !strings.Contains(joined, "NICK mira") || !strings.Contains(joined, "USER mira") {
		t.Errorf("registration lines = %v", seen)
	}
	if b.Status("s1") != "connected" {
		t.Errorf("status = %q", b.Status("s1"))
	}
	go b.Disconnect("s1")
	waitFor(t, func() bool { return b.Status("s1") == "disconnected" })
}

func TestConnectReportsAnUnreachableServer(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close() // nothing listens there any more
	b := New(nil)
	if err := b.Connect("s1", "127.0.0.1", port, "mira", false, "", "", "", "", nil, "", &fakeSubscriber{}); err == nil {
		t.Fatal("Connect to a closed port succeeded")
	}
}
