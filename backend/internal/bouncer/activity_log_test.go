package bouncer

import (
	"bytes"
	"log"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
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
