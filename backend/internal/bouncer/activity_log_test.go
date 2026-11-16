package bouncer

import (
	"bytes"
	"io"
	"log"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Daemeron/dolq/backend/internal/ircparse"
)

type logBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (l *logBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.Write(p)
}

func (l *logBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.String()
}

func TestTheLogSaysWhenADCCOfferArrivesAndHowItIsAnswered(t *testing.T) {
	out := &logBuffer{}
	log.SetOutput(out)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	b := New(nil)
	sub := &fakeSubscriber{}
	conn, _ := pipeSession(t, b, "server-a", sub)
	writeLine(t, conn, ":irc.example.net 001 testnick :Welcome")
	writeLine(t, conn, ":gattsu!u@h PRIVMSG testnick :\x01DCC SEND pack.mkv 3232235777 5000 1500000\x01")
	writeLine(t, conn, ":gattsu!u@h PRIVMSG testnick :\x01DCC SEND other.mkv 0 0 2048 7\x01")
	writeLine(t, conn, ":friend!u@h PRIVMSG testnick :\x01DCC CHAT chat 3232235777 5001\x01")
	waitForLog(t, out, "offers a DCC chat")

	got := out.String()
	for _, want := range []string{
		"gattsu offers pack.mkv (1.5 MB) to be fetched from 192.168.1.1:5000, waiting for an app to accept",
		"gattsu offers other.mkv (2.0 KB) and wants us to listen for it (a passive offer)",
		"friend offers a DCC chat, waiting for an app to accept",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("the log never said %q:\n%s", want, got)
		}
	}

	// accepting says where the sender has to connect, the part a container gets wrong. net.Pipe is synchronous, so what
	// the client sends has to be read for the accept to get on.
	go io.Copy(io.Discard, conn)
	passive := ircparse.XDCCSendOfferEvent{Nick: "gattsu", Filename: "other.mkv", Size: 2048, Token: "7"}
	if _, err := b.XDCCAccept("server-a", passive, t.TempDir(), 0, 0, sub); err != nil {
		t.Fatal(err)
	}
	active := ircparse.XDCCSendOfferEvent{Nick: "gattsu", Filename: "pack.mkv", IP: "127.0.0.1", Port: 1, Size: 10}
	if _, err := b.XDCCAccept("server-a", active, t.TempDir(), 0, 0, sub); err != nil {
		t.Fatal(err)
	}
	got = out.String()
	for _, want := range []string{
		"xdcc: accepted other.mkv from gattsu, waiting for it at ",
		"xdcc: accepted pack.mkv from gattsu, connecting to 127.0.0.1:1",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("the log never said %q:\n%s", want, got)
		}
	}
}

func waitForLog(t *testing.T, out *logBuffer, text string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && !strings.Contains(out.String(), text) {
		time.Sleep(10 * time.Millisecond)
	}
}

func TestTheLogSaysWhatTheUsersOwnNickDoesOnAServer(t *testing.T) {
	out := &logBuffer{}
	log.SetOutput(out)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	b := New(nil)
	conn, _ := pipeSession(t, b, "server-a", &fakeSubscriber{})
	writeLine(t, conn, ":irc.example.net 001 testnick :Welcome")
	writeLine(t, conn, ":testnick!u@h JOIN :#chat")
	writeLine(t, conn, ":someone!u@h JOIN :#chat")
	writeLine(t, conn, ":someone!u@h PRIVMSG #chat :a private word")
	writeLine(t, conn, ":testnick!u@h PART #chat :bye")

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && !strings.Contains(out.String(), "left #chat") {
		time.Sleep(10 * time.Millisecond)
	}
	got := out.String()
	for _, want := range []string{"registered as testnick", "joined #chat", "left #chat"} {
		if !strings.Contains(got, want) {
			t.Errorf("the log never said %q:\n%s", want, got)
		}
	}
	for _, private := range []string{"someone", "a private word", "bye"} {
		if strings.Contains(got, private) {
			t.Errorf("the log has %q in it, which is not the user's own doing or is what someone said:\n%s", private, got)
		}
	}
}
