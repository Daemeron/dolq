package ipcproto

import (
	"bytes"
	"log"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// logBuffer is what the standard logger writes to for the length of a test, safe to read while it is written.
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

func captureLog(t *testing.T) *logBuffer {
	t.Helper()
	out := &logBuffer{}
	log.SetOutput(out)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	return out
}

func waitForLog(t *testing.T, out *logBuffer, want string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(out.String(), want) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("the log never said %q, it says:\n%s", want, out.String())
}

func TestLogShowsClientLifecycle(t *testing.T) {
	out := captureLog(t)
	tc := dialTestClient(t, startAuthServer(t, "s3cret"))
	tc.send(t, ClientFrame{ID: "1", Action: ActionAuth, AuthToken: "s3cret"})
	tc.recv(t)
	waitForLog(t, out, "client local: authenticated")
	tc.conn.Close()
	waitForLog(t, out, "client local: disconnected")
	if !strings.Contains(out.String(), "client local: connected") {
		t.Errorf("no connect line in:\n%s", out.String())
	}
	if strings.Contains(out.String(), "s3cret") {
		t.Errorf("the access token reached the log:\n%s", out.String())
	}
}

func TestLogShowsRefusedClient(t *testing.T) {
	out := captureLog(t)
	tc := dialTestClient(t, startAuthServer(t, "s3cret"))
	tc.send(t, ClientFrame{ID: "1", Action: ActionAuth, AuthToken: "guess"})
	tc.recv(t)
	waitForLog(t, out, "rejected, the access token is missing or wrong")
	if strings.Contains(out.String(), "guess") {
		t.Errorf("the token that was tried reached the log:\n%s", out.String())
	}
}

func TestLogShowsProbeHangUp(t *testing.T) {
	out := captureLog(t)
	tc := dialTestClient(t, startAuthServer(t, "s3cret"))
	tc.conn.Close()
	waitForLog(t, out, "closed without authenticating")
}
