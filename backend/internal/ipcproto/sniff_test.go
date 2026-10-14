package ipcproto

import (
	"bufio"
	"crypto/tls"
	"net"
	"path/filepath"
	"testing"
	"time"

	"github.com/Daemeron/dolq/backend/internal/bouncer"
)

// startSniffServer serves TLS and, unless secure, plain connections on one port
// with an access token required for TLS clients.
func startSniffServer(t *testing.T, secure bool) string {
	t.Helper()
	cert, err := LoadOrCreateCert(filepath.Join(t.TempDir(), "c.pem"), filepath.Join(t.TempDir(), "k.pem"), []string{"localhost"})
	if err != nil {
		t.Fatal(err)
	}
	inner, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ln := NewSniffingListener(inner, ServerTLSConfig(cert), !secure)
	go NewServer(bouncer.New(nil)).RequireToken("tok").Serve(ln)
	t.Cleanup(func() { ln.Close() })
	return inner.Addr().String()
}

func dialPlain(t *testing.T, addr string) *testClient {
	t.Helper()
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return &testClient{conn: conn, r: bufio.NewReader(conn)}
}

func dialTLS(t *testing.T, addr string) *testClient {
	t.Helper()
	conn, err := tls.Dial("tcp", addr, &tls.Config{InsecureSkipVerify: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return &testClient{conn: conn, r: bufio.NewReader(conn)}
}

func TestCompatModeServesLegacyPlainClientsWithoutAToken(t *testing.T) {
	tc := dialPlain(t, startSniffServer(t, false))
	tc.send(t, ClientFrame{ID: "1", Action: ActionGetStatus, ServerID: "x"})
	if f := tc.recv(t); f.ID != "1" || f.Error != "" {
		t.Fatalf("legacy client got %+v, want a normal reply", f)
	}
}

func TestCompatModeStillRequiresATokenOverTLS(t *testing.T) {
	addr := startSniffServer(t, false)

	bad := dialTLS(t, addr)
	bad.send(t, ClientFrame{ID: "1", Action: ActionGetStatus, ServerID: "x"})
	if f := bad.recv(t); f.Error != "unauthorized" {
		t.Fatalf("TLS client without a token got %+v, want unauthorized", f)
	}

	good := dialTLS(t, addr)
	good.send(t, ClientFrame{ID: "1", Action: ActionAuth, AuthToken: "tok"})
	if f := good.recv(t); !f.OK {
		t.Fatalf("TLS client with the token got %+v", f)
	}
}

func TestSecureModeDropsPlainClients(t *testing.T) {
	tc := dialPlain(t, startSniffServer(t, true))
	tc.send(t, ClientFrame{ID: "1", Action: ActionGetStatus, ServerID: "x"})
	expectClosed(t, tc)
}

func TestSecureModeStillServesTLS(t *testing.T) {
	tc := dialTLS(t, startSniffServer(t, true))
	tc.send(t, ClientFrame{ID: "1", Action: ActionAuth, AuthToken: "tok"})
	if f := tc.recv(t); !f.OK {
		t.Fatalf("got %+v", f)
	}
}

func TestSilentConnectionDoesNotBlockOthers(t *testing.T) {
	addr := startSniffServer(t, false)
	silent, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	defer silent.Close()

	tc := dialPlain(t, addr)
	tc.send(t, ClientFrame{ID: "1", Action: ActionGetStatus, ServerID: "x"})
	if f := tc.recv(t); f.ID != "1" {
		t.Fatalf("got %+v", f)
	}
}

func TestSilentConnectionIsDroppedAfterTheSniffTimeout(t *testing.T) {
	old := sniffTimeout
	sniffTimeout = 100 * time.Millisecond
	t.Cleanup(func() { sniffTimeout = old })

	tc := dialPlain(t, startSniffServer(t, false))
	expectClosed(t, tc)
}

func TestPlainClientThatSendsATokenIsNotRefused(t *testing.T) {
	tc := dialPlain(t, startSniffServer(t, false))
	tc.send(t, ClientFrame{ID: "1", Action: ActionAuth, AuthToken: "tok"})
	if f := tc.recv(t); !f.OK {
		t.Fatalf("auth frame on a legacy connection got %+v, want ok", f)
	}
}
