package ipcproto

import (
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestLoadOrCreateTokenIsCreatedOnceAndKept(t *testing.T) {
	file := filepath.Join(t.TempDir(), "sub", "token")
	first, created, err := LoadOrCreateToken(file)
	if err != nil || !created {
		t.Fatalf("first load: created %v, err %v; want a new token", created, err)
	}
	if len(first) < 32 {
		t.Fatalf("token %q is too short", first)
	}
	second, created, err := LoadOrCreateToken(file)
	if err != nil || second != first || created {
		t.Fatalf("second load = %q (created %v), %v; want the same token %q", second, created, err, first)
	}
	if info, _ := os.Stat(file); runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		t.Errorf("token file mode = %o, want owner only", info.Mode().Perm())
	}
	if info, _ := os.Stat(filepath.Dir(file)); runtime.GOOS != "windows" && info.Mode().Perm() != 0o700 {
		t.Errorf("token dir mode = %o, want 0700", info.Mode().Perm())
	}
}

func TestPairingLinkCarriesTokenAndFingerprint(t *testing.T) {
	link := PairingLink("192.168.1.5", 6789, "tok", "AA:BB", true)
	u, err := url.Parse(link)
	if err != nil {
		t.Fatal(err)
	}
	if u.Scheme != "dolq" || u.Host != "192.168.1.5:6789" || u.Query().Get("token") != "tok" || u.Query().Get("fp") != "AA:BB" {
		t.Errorf("unexpected link %q", link)
	}
}

func TestPairingLinkOmitsFingerprintForCASignedCerts(t *testing.T) {
	u, _ := url.Parse(PairingLink("dolq.example.com", 443, "tok", "", true))
	if u.Query().Has("fp") {
		t.Error("a CA-issued certificate needs no pinned fingerprint")
	}
	v, _ := url.Parse(PairingLink("::1", 6789, "tok", "", true))
	if v.Host != "[::1]:6789" {
		t.Errorf("IPv6 host = %q, want bracketed", v.Host)
	}
}

func TestPairingLinkMarksAPlainBackend(t *testing.T) {
	u, _ := url.Parse(PairingLink("nas.local", 6789, "tok", "", false))
	if u.Query().Get("tls") != "0" {
		t.Errorf("a backend without TLS should say so, got %q", u)
	}
	v, _ := url.Parse(PairingLink("nas.local", 6789, "tok", "AA", true))
	if v.Query().Has("tls") {
		t.Error("a TLS backend needs no tls parameter")
	}
}
