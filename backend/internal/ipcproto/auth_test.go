package ipcproto

import (
	"bufio"
	"crypto/tls"
	"crypto/x509"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/Daemeron/dolq/backend/internal/bouncer"
)

func startAuthServer(t *testing.T, token string) string {
	t.Helper()
	return startAuthServerTimeout(t, token, defaultAuthTimeout)
}

func startAuthServerTimeout(t *testing.T, token string, timeout time.Duration) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "s.sock")
	ln, err := Listen("unix", path)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	srv := NewServer(bouncer.New(nil)).RequireToken(token)
	srv.authTimeout = timeout
	go srv.Serve(ln)
	t.Cleanup(func() { ln.Close() })
	return path
}

func expectClosed(t *testing.T, tc *testClient) {
	t.Helper()
	tc.conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		if _, err := tc.r.ReadByte(); err != nil {
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				t.Fatal("expected the server to close the connection")
			}
			return
		}
	}
}

func TestAuthAcceptsTheRightToken(t *testing.T) {
	tc := dialTestClient(t, startAuthServer(t, "s3cret"))
	tc.send(t, ClientFrame{ID: "1", Action: ActionAuth, AuthToken: "s3cret"})
	if f := tc.recv(t); !f.OK || f.ID != "1" {
		t.Fatalf("auth result = %+v, want ok", f)
	}
	tc.send(t, ClientFrame{ID: "2", Action: ActionGetStatus, ServerID: "nope"})
	if f := tc.recv(t); f.ID != "2" {
		t.Fatalf("expected a normal reply after auth, got %+v", f)
	}
}

func TestAuthRejectsAWrongToken(t *testing.T) {
	tc := dialTestClient(t, startAuthServer(t, "s3cret"))
	tc.send(t, ClientFrame{ID: "1", Action: ActionAuth, AuthToken: "guess"})
	if f := tc.recv(t); f.OK || f.Error != "unauthorized" {
		t.Fatalf("auth result = %+v, want unauthorized", f)
	}
	expectClosed(t, tc)
}

func TestAuthRejectsAnyOtherFirstFrame(t *testing.T) {
	tc := dialTestClient(t, startAuthServer(t, "s3cret"))
	tc.send(t, ClientFrame{ID: "1", Action: ActionGetJoinedChannels, ServerID: "x"})
	if f := tc.recv(t); f.OK || f.Error != "unauthorized" {
		t.Fatalf("result = %+v, want unauthorized", f)
	}
	expectClosed(t, tc)
}

func TestAuthTimesOutOnASilentConnection(t *testing.T) {
	tc := dialTestClient(t, startAuthServerTimeout(t, "s3cret", 100*time.Millisecond))
	expectClosed(t, tc)
}

func TestUnixSocketIsOwnerOnly(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix permissions")
	}
	path := filepath.Join(t.TempDir(), "s.sock")
	ln, err := Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm&0o077 != 0 {
		t.Errorf("socket mode = %o, want no group/other access", perm)
	}
}

func TestSelfSignedCertIsStableAndServesTLS(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile := filepath.Join(dir, "c.pem"), filepath.Join(dir, "k.pem")

	cert, err := LoadOrCreateCert(certFile, keyFile, []string{"localhost", "127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}
	again, err := LoadOrCreateCert(certFile, keyFile, nil)
	if err != nil {
		t.Fatal(err)
	}
	fp := Fingerprint(cert)
	if fp == "" || fp != Fingerprint(again) {
		t.Fatalf("fingerprint not stable: %q vs %q", fp, Fingerprint(again))
	}
	if info, _ := os.Stat(keyFile); runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		t.Errorf("key mode = %o, want owner only", info.Mode().Perm())
	}

	inner, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ln := NewSniffingListener(inner, ServerTLSConfig(cert), false)
	go NewServer(bouncer.New(nil)).RequireToken("tok").Serve(ln)
	defer ln.Close()

	pool := x509.NewCertPool()
	leaf, _ := x509.ParseCertificate(cert.Certificate[0])
	pool.AddCert(leaf)
	conn, err := tls.Dial("tcp", inner.Addr().String(), &tls.Config{RootCAs: pool, ServerName: "localhost"})
	if err != nil {
		t.Fatalf("tls dial: %v", err)
	}
	defer conn.Close()
	tc := &testClient{conn: conn}
	tc.r = bufio.NewReader(conn)
	tc.send(t, ClientFrame{ID: "1", Action: ActionAuth, AuthToken: "tok"})
	if f := tc.recv(t); !f.OK {
		t.Fatalf("auth over TLS = %+v", f)
	}
}

func TestLoadOrCreateCertRefusesHalfAPair(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile := filepath.Join(dir, "c.pem"), filepath.Join(dir, "k.pem")
	os.WriteFile(certFile, []byte("x"), 0o600)
	if _, err := LoadOrCreateCert(certFile, keyFile, nil); err == nil {
		t.Fatal("expected an error when only the certificate exists")
	}
}

func TestIsLoopback(t *testing.T) {
	for addr, want := range map[string]bool{
		"127.0.0.1:6789": true, "[::1]:6789": true, "localhost:6789": true,
		"0.0.0.0:6789": false, ":6789": false, "192.168.1.5:6789": false, "bad": false,
	} {
		if got := IsLoopback(addr); got != want {
			t.Errorf("IsLoopback(%q) = %v, want %v", addr, got, want)
		}
	}
}
