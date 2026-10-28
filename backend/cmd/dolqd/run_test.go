package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"io"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

type daemon struct {
	path    string // the line dolqd printed
	cancel  context.CancelFunc
	done    chan error
	stopped bool
}

// startDaemon runs the real startup code in-process and returns once it has printed its address.
func startDaemon(t *testing.T, args ...string) *daemon {
	t.Helper()
	r, w := io.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	d := &daemon{cancel: cancel, done: make(chan error, 1)}
	go func() {
		err := run(ctx, args, w)
		w.Close()
		d.done <- err
	}()
	t.Cleanup(func() {
		if d.stopped {
			return
		}
		cancel()
		select {
		case <-d.done:
		case <-time.After(15 * time.Second):
			t.Error("daemon did not stop")
		}
	})
	line := make(chan string, 1)
	go func() {
		s, _ := bufio.NewReader(r).ReadString('\n')
		line <- strings.TrimSpace(s)
	}()
	select {
	case d.path = <-line:
	case err := <-d.done:
		t.Fatalf("daemon exited during startup: %v", err)
	case <-time.After(15 * time.Second):
		t.Fatal("daemon never printed its address")
	}
	return d
}

func (d *daemon) stop(t *testing.T) {
	t.Helper()
	d.stopped = true
	d.cancel()
	select {
	case err := <-d.done:
		if err != nil {
			t.Fatalf("shutdown error: %v", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("daemon did not stop")
	}
}

func freeAddr(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().String()
}

func TestRunServesOnTheGivenSocketAndCleansUp(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix socket flow")
	}
	// Unix socket paths are short-limited, and t.TempDir() is too long on macOS.
	dir, err := os.MkdirTemp("", "dq")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	sock := filepath.Join(dir, "d.sock")
	d := startDaemon(t, "-socket", sock, "-db", filepath.Join(dir, "h.db"))
	if d.path != sock {
		t.Fatalf("printed %q, want %q", d.path, sock)
	}
	conn, err := net.DialTimeout("unix", sock, 2*time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	conn.Close()
	d.stop(t)
	if _, err := os.Stat(sock); !os.IsNotExist(err) {
		t.Errorf("socket not removed: %v", err)
	}
}

func TestRunWithoutASocketUsesAPrivateTempDirAndRemovesIt(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix socket flow")
	}
	d := startDaemon(t, "-db", filepath.Join(t.TempDir(), "h.db"))
	dir := filepath.Dir(d.path)
	if info, err := os.Stat(dir); err != nil || info.Mode().Perm() != 0o700 {
		t.Fatalf("socket dir = %v, %v; want an owner-only directory", info, err)
	}
	d.stop(t)
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Errorf("temp socket dir not removed: %v", err)
	}
}

func TestRunOverTLSCreatesACertificateAndAToken(t *testing.T) {
	dir := t.TempDir()
	addr := freeAddr(t)
	logs := captureLog(t, func() {
		d := startDaemon(t, "-addr", addr, "-db", filepath.Join(dir, "h.db"), "-print-pairing")
		conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 2 * time.Second}, "tcp", addr, &tls.Config{InsecureSkipVerify: true})
		if err != nil {
			t.Fatalf("tls dial: %v", err)
		}
		conn.Close()
		d.stop(t)
	})
	for _, f := range []string{"tls-cert.pem", "tls-key.pem", "token"} {
		if _, err := os.Stat(filepath.Join(dir, f)); err != nil {
			t.Errorf("%s was not created: %v", f, err)
		}
	}
	if !strings.Contains(logs, "serving TLS, certificate SHA-256 fingerprint") {
		t.Errorf("no fingerprint logged: %s", logs)
	}
	if !strings.Contains(logs, "dolq://") {
		t.Errorf("no pairing link logged: %s", logs)
	}
	if !strings.Contains(logs, "saving downloads to") {
		t.Errorf("no download dir logged: %s", logs)
	}
	if info, err := os.Stat(filepath.Join(dir, "downloads")); err != nil || !info.IsDir() {
		t.Errorf("download dir missing: %v", err)
	}
}

func TestRunPlainWithoutATokenWarnsLoudly(t *testing.T) {
	dir := t.TempDir()
	addr := freeAddr(t)
	logs := captureLog(t, func() {
		d := startDaemon(t, "-addr", addr, "-tls=false", "-token=false", "-db", filepath.Join(dir, "h.db"), "-download-dir", filepath.Join(dir, "dl"))
		conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		conn.Close()
		d.stop(t)
	})
	if !strings.Contains(logs, "-token=false: no access token") {
		t.Errorf("missing token warning: %s", logs)
	}
	if _, err := os.Stat(filepath.Join(dir, "dl")); err != nil {
		t.Errorf("explicit download dir not created: %v", err)
	}
}

func TestRunWithALetsEncryptDomainServesTheirChallengeConfig(t *testing.T) {
	dir := t.TempDir()
	addr := freeAddr(t)
	logs := captureLog(t, func() {
		d := startDaemon(t, "-addr", addr, "-db", filepath.Join(dir, "h.db"),
			"-acme-domain", "dolq.example.org", "-acme-staging", "-print-pairing")
		d.stop(t)
	})
	if !strings.Contains(logs, "Let's Encrypt certificate for dolq.example.org") {
		t.Errorf("acme not announced: %s", logs)
	}
	if !strings.Contains(logs, "dolq://dolq.example.org:") {
		t.Errorf("pairing link should use the certificate's domain: %s", logs)
	}
}

func TestRunWarnsAboutLegacyPlainConnections(t *testing.T) {
	dir := t.TempDir()
	logs := captureLog(t, func() {
		d := startDaemon(t, "-addr", freeAddr(t), "-db", filepath.Join(dir, "h.db"), "-allow-legacy-plain")
		d.stop(t)
	})
	if !strings.Contains(logs, "-allow-legacy-plain") {
		t.Errorf("no legacy warning: %s", logs)
	}
}

func TestRunWarnsAboutPlainTCPOnANetworkAddress(t *testing.T) {
	dir := t.TempDir()
	port := strings.Split(freeAddr(t), ":")[1]
	logs := captureLog(t, func() {
		d := startDaemon(t, "-addr", "0.0.0.0:"+port, "-tls=false", "-db", filepath.Join(dir, "h.db"))
		d.stop(t)
	})
	if !strings.Contains(logs, "without TLS on a non-loopback address") {
		t.Errorf("no plaintext warning: %s", logs)
	}
}

func TestRunReportsStartupProblems(t *testing.T) {
	dir := t.TempDir()
	notASocket := filepath.Join(dir, "file")
	if err := os.WriteFile(notASocket, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name string
		args []string
		want string
	}{
		{"unknown flag", []string{"-nope"}, "flag provided but not defined"},
		{"legacy plain without TLS", []string{"-addr", "127.0.0.1:1", "-tls=false", "-allow-legacy-plain"}, "cannot be combined"},
		{"socket path is a regular file", []string{"-socket", notASocket, "-db", filepath.Join(dir, "h.db")}, "not a socket"},
		{"unusable certificate", []string{"-addr", "127.0.0.1:0", "-tls-cert", filepath.Join(dir, "no", "such", "dir", "c.pem"), "-tls-key", "/dev/null/k.pem", "-db", filepath.Join(dir, "h.db")}, "tls certificate"},
		{"history database cannot open", []string{"-socket", filepath.Join(dir, "x.sock"), "-db", filepath.Join(dir, "nodir", "sub", "h.db")}, "open history db"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if runtime.GOOS == "windows" && c.name == "unusable certificate" {
				t.Skip("path semantics differ")
			}
			done := make(chan error, 1)
			go func() { done <- run(context.Background(), c.args, io.Discard) }()
			select {
			case err := <-done:
				if err == nil || !strings.Contains(err.Error(), c.want) {
					t.Errorf("err = %v, want it to mention %q", err, c.want)
				}
			case <-time.After(15 * time.Second):
				t.Fatal("run did not return")
			}
		})
	}
}
