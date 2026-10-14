package main

import (
	"bufio"
	"bytes"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestResolveDBPathExplicit(t *testing.T) {
	if got := resolveDBPath("/x/y.db"); got != "/x/y.db" {
		t.Fatalf("got %q, want explicit path back", got)
	}
}

func TestResolveDBPathDefault(t *testing.T) {
	cfg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", cfg)
	t.Setenv("HOME", cfg)
	t.Setenv("AppData", cfg)

	got := resolveDBPath("")
	if filepath.Base(got) != "history.db" || filepath.Base(filepath.Dir(got)) != "dolq" {
		t.Fatalf("got %q, want .../dolq/history.db", got)
	}
	if _, err := os.Stat(filepath.Dir(got)); err != nil {
		t.Fatalf("config dir not created: %v", err)
	}
}

// TestDaemonLifecycle builds the real binary, checks it prints a dialable
// socket path, and that SIGINT shuts it down cleanly and removes the socket.
func TestDaemonLifecycle(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix socket + SIGINT flow")
	}
	dir := t.TempDir()
	bin := filepath.Join(dir, "dolqd")
	if out, err := exec.Command("go", "build", "-o", bin, ".").CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}

	sock := filepath.Join(dir, "d.sock")
	cmd := exec.Command(bin, "-socket", sock, "-db", filepath.Join(dir, "h.db"))
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill() })

	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil || line != sock+"\n" {
		t.Fatalf("stdout line = %q, err %v; want %q", line, err, sock)
	}
	conn, err := net.DialTimeout("unix", sock, 2*time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	conn.Close()

	if err := cmd.Process.Signal(os.Interrupt); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("exit: %v", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("daemon did not exit after SIGINT")
	}
	if _, err := os.Stat(sock); !os.IsNotExist(err) {
		t.Fatalf("socket not removed: %v", err)
	}
}

func TestServerDownloadDir(t *testing.T) {
	if got := serverDownloadDir("/f", "/e", "/x/h.db"); got != "/f" {
		t.Errorf("flag: got %q", got)
	}
	if got := serverDownloadDir("", "/e", "/x/h.db"); got != "/e" {
		t.Errorf("env: got %q", got)
	}
	if got, want := serverDownloadDir("", "", "/x/h.db"), filepath.Join("/x", "downloads"); got != want {
		t.Errorf("default: got %q, want %q", got, want)
	}
}

func captureLog(t *testing.T, f func()) string {
	t.Helper()
	var buf bytes.Buffer
	log.SetOutput(&buf)
	defer log.SetOutput(os.Stderr)
	f()
	return buf.String()
}

func TestLogPairingHidesTokenUnlessAsked(t *testing.T) {
	t.Setenv("DOLQ_PUBLIC_HOST", "dolq.lan")
	hidden := captureLog(t, func() { logPairing("0.0.0.0:6789", "", "s3cret", "AA", true, false) })
	if strings.Contains(hidden, "s3cret") || !strings.Contains(hidden, "-print-pairing") {
		t.Fatalf("without show: %q, want a hint and no token", hidden)
	}
	shown := captureLog(t, func() { logPairing("0.0.0.0:6789", "", "s3cret", "AA", true, true) })
	if !strings.Contains(shown, "dolq://dolq.lan:6789?") || !strings.Contains(shown, "token=s3cret") {
		t.Fatalf("with show: %q, want the pairing link", shown)
	}
}

func TestLogPairingUsesACMEDomain(t *testing.T) {
	t.Setenv("DOLQ_PUBLIC_HOST", "dolq.lan")
	out := captureLog(t, func() { logPairing(":443", "dolq.example.com", "tok", "", true, true) })
	if !strings.Contains(out, "dolq://dolq.example.com:443?") || strings.Contains(out, "dolq.lan") {
		t.Fatalf("got %q, want only a link to the ACME domain", out)
	}
}
