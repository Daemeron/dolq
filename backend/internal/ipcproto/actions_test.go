package ipcproto

import (
	"bufio"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/Daemeron/dolq/backend/internal/bouncer"
	"github.com/Daemeron/dolq/backend/internal/history"
)

// startStoreServer is startTestServer with a real history store behind the bouncer.
func startStoreServer(t *testing.T) (path string, store *history.Store) {
	t.Helper()
	store, err := history.Open(filepath.Join(t.TempDir(), "h.db"), 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	dir, err := os.MkdirTemp("", "dolq-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	path = filepath.Join(dir, "s.sock")
	ln, err := Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go NewServer(bouncer.New(store)).Serve(ln)
	return path, store
}

// call sends one frame and returns its result, skipping the status and line
// frames the backend may push in between.
func (tc *testClient) call(t *testing.T, f ClientFrame) ServerFrame {
	t.Helper()
	tc.send(t, f)
	for {
		if got := tc.recv(t); got.Type == FrameResult {
			return got
		}
	}
}

func TestUnknownActionIsRefused(t *testing.T) {
	tc := dialTestClient(t, startTestServer(t))
	got := tc.call(t, ClientFrame{ID: "1", Action: "frobnicate"})
	if got.OK || !strings.Contains(got.Error, "unknown action: frobnicate") {
		t.Errorf("got %#v", got)
	}
}

func TestAuthFrameOnAnOpenServerIsAcknowledged(t *testing.T) {
	tc := dialTestClient(t, startTestServer(t))
	got := tc.call(t, ClientFrame{ID: "1", Action: ActionAuth, AuthToken: "unneeded"})
	if !got.OK {
		t.Errorf("got %#v", got)
	}
}

func TestHistoryAndSearchAreServedFromTheStore(t *testing.T) {
	path, store := startStoreServer(t)
	store.AppendLine("s1", "#c", "first release note", time.Now())
	store.AppendLine("s1", "#c", "something else", time.Now())
	tc := dialTestClient(t, path)

	deadline := time.Now().Add(5 * time.Second)
	var hist ServerFrame
	for time.Now().Before(deadline) {
		hist = tc.call(t, ClientFrame{ID: "h", Action: ActionGetHistory, ServerID: "s1", Channel: "#c", Limit: 10})
		if len(hist.Messages) == 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !hist.OK || len(hist.Messages) != 2 {
		t.Fatalf("history = %#v", hist)
	}
	found := tc.call(t, ClientFrame{ID: "q", Action: ActionSearch, ServerID: "s1", Channel: "#c", Query: "release", Limit: 10})
	if !found.OK || len(found.Messages) != 1 || found.Messages[0].Line != "first release note" {
		t.Errorf("search = %#v", found)
	}
}

func TestConnectDisconnectAndStatusAgainstAnIRCServer(t *testing.T) {
	irc, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer irc.Close()
	go func() {
		c, err := irc.Accept()
		if err != nil {
			return
		}
		defer c.Close()
		bufio.NewReader(c).ReadString('\n') // swallow registration; the test only needs the connection to stay up
		time.Sleep(2 * time.Second)
	}()
	port := irc.Addr().(*net.TCPAddr).Port

	tc := dialTestClient(t, startTestServer(t))
	got := tc.call(t, ClientFrame{ID: "1", Action: ActionConnect, ServerID: "s1", Host: "127.0.0.1", Port: port, Nick: "mira"})
	if !got.OK {
		t.Fatalf("connect = %#v", got)
	}
	if st := tc.call(t, ClientFrame{ID: "2", Action: ActionGetStatus, ServerID: "s1"}); st.Status != "connected" {
		t.Errorf("status = %#v", st)
	}
	if d := tc.call(t, ClientFrame{ID: "3", Action: ActionDisconnect, ServerID: "s1"}); !d.OK {
		t.Errorf("disconnect = %#v", d)
	}
}

func TestConnectToAnUnreachableServerReportsWhy(t *testing.T) {
	l, _ := net.Listen("tcp", "127.0.0.1:0")
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()
	tc := dialTestClient(t, startTestServer(t))
	got := tc.call(t, ClientFrame{ID: "1", Action: ActionConnect, ServerID: "s1", Host: "127.0.0.1", Port: port, Nick: "mira"})
	if got.OK || got.Error == "" {
		t.Errorf("got %#v", got)
	}
}

func TestDCCAndXDCCActionsFailCleanlyForUnknownTargets(t *testing.T) {
	tc := dialTestClient(t, startTestServer(t))
	for _, c := range []struct {
		name   string
		frame  ClientFrame
		wantOK bool
	}{
		{"dcc offer without a session", ClientFrame{Action: ActionDCCOffer, ServerID: "nope", Nick: "n"}, false},
		{"dcc accept to a bad address", ClientFrame{Action: ActionDCCAccept, Host: "not an ip", Port: 1}, false},
		{"dcc send on an unknown chat", ClientFrame{Action: ActionDCCSend, DCCID: "nope", Line: "hi"}, false},
		{"dcc close on an unknown chat", ClientFrame{Action: ActionDCCClose, DCCID: "nope"}, true},
		{"dcc send file without a session", ClientFrame{Action: ActionDCCSendFile, ServerID: "nope", Nick: "n", Path: "/tmp/x"}, false},
		{"xdcc accept without a session", ClientFrame{Action: ActionXDCCAccept, ServerID: "nope", Nick: "bot", Filename: "f", Host: "127.0.0.1", Port: 1}, false},
		{"xdcc close on an unknown transfer", ClientFrame{Action: ActionXDCCClose, DCCID: "nope"}, true},
		{"xdcc pause on an unknown transfer", ClientFrame{Action: ActionXDCCPause, DCCID: "nope"}, false},
		{"xdcc resume on an unknown transfer", ClientFrame{Action: ActionXDCCResume, DCCID: "nope"}, false},
	} {
		t.Run(c.name, func(t *testing.T) {
			c.frame.ID = "x"
			got := tc.call(t, c.frame)
			if got.OK != c.wantOK {
				t.Errorf("ok = %v, want %v (%#v)", got.OK, c.wantOK, got)
			}
			if !c.wantOK && got.Error == "" {
				t.Errorf("a failure should say why: %#v", got)
			}
		})
	}
}

func TestSendStatusWritesAStatusFrame(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	c := &conn{netConn: server, writeTimeout: time.Second, enc: json.NewEncoder(server)}
	go c.SendStatus("s1", "connecting")
	var f ServerFrame
	if err := json.NewDecoder(client).Decode(&f); err != nil {
		t.Fatal(err)
	}
	if f.Type != FrameStatus || f.ServerID != "s1" || f.Status != "connecting" {
		t.Errorf("got %#v", f)
	}
}

func TestListenRefusesToReplaceAFileThatIsNotASocket(t *testing.T) {
	f := filepath.Join(t.TempDir(), "precious")
	if err := os.WriteFile(f, []byte("data"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Listen("unix", f); err == nil || !strings.Contains(err.Error(), "not a socket") {
		t.Errorf("err = %v", err)
	}
	if b, _ := os.ReadFile(f); string(b) != "data" {
		t.Error("the file was modified")
	}
}

func TestListenOnTCPAndNamedPipes(t *testing.T) {
	ln, err := Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ln.Close()
	if runtime.GOOS != "windows" {
		if _, err := Listen("pipe", "dolq"); err == nil {
			t.Error("named pipes should be refused off Windows")
		}
	}
}

func TestACMEConfigRequiresModernTLSAndAnswersTheALPNChallenge(t *testing.T) {
	cfg := ACMEConfig("dolq.example.org", "ops@example.org", t.TempDir(), true)
	if cfg.MinVersion < 0x0303 { // TLS 1.2
		t.Errorf("MinVersion = %#x", cfg.MinVersion)
	}
	found := false
	for _, p := range cfg.NextProtos {
		if p == "acme-tls/1" {
			found = true
		}
	}
	if !found {
		t.Errorf("NextProtos = %v, want acme-tls/1 for TLS-ALPN-01", cfg.NextProtos)
	}
	if cfg.GetCertificate == nil {
		t.Error("no certificate source")
	}
}

func TestLANHostsAreNonLoopbackIPv4(t *testing.T) {
	for _, h := range LANHosts() {
		ip := net.ParseIP(h)
		if ip == nil || ip.To4() == nil || ip.IsLoopback() {
			t.Errorf("unexpected LAN host %q", h)
		}
	}
}

func TestAClosedSniffingListenerStopsAccepting(t *testing.T) {
	inner, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ln := NewSniffingListener(inner, nil, true)
	ln.Close()
	if _, err := ln.Accept(); err == nil {
		t.Error("Accept succeeded after Close")
	}
}

func TestListenRefusesAnAddressItCannotBind(t *testing.T) {
	if _, err := Listen("tcp", "256.0.0.1:99999"); err == nil {
		t.Error("bound an impossible address")
	}
}

func TestTokenCannotBeStoredUnderAFile(t *testing.T) {
	blocker := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := LoadOrCreateToken(filepath.Join(blocker, "token")); err == nil {
		t.Error("created a token somewhere it cannot exist")
	}
}
