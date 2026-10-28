package ipcproto

import (
	"crypto/tls"
	"crypto/x509"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"testing"
)

func TestLoadOrCreateCertKeepsTheSameCertificateAcrossRestarts(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile := filepath.Join(dir, "sub", "c.pem"), filepath.Join(dir, "sub", "k.pem")

	first, err := LoadOrCreateCert(certFile, keyFile, []string{"localhost", "127.0.0.1", "box.example", ""})
	if err != nil {
		t.Fatal(err)
	}
	second, err := LoadOrCreateCert(certFile, keyFile, []string{"other.example"})
	if err != nil {
		t.Fatal(err)
	}
	if Fingerprint(first) != Fingerprint(second) {
		t.Error("the certificate changed between loads, which would break every pinned client")
	}

	leaf, err := x509.ParseCertificate(first.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	if len(leaf.DNSNames) != 2 || leaf.DNSNames[0] != "localhost" || leaf.DNSNames[1] != "box.example" {
		t.Errorf("DNS names = %v", leaf.DNSNames)
	}
	if len(leaf.IPAddresses) != 1 || leaf.IPAddresses[0].String() != "127.0.0.1" {
		t.Errorf("IP addresses = %v", leaf.IPAddresses)
	}
	if runtime.GOOS != "windows" {
		if info, _ := os.Stat(keyFile); info.Mode().Perm() != 0o600 {
			t.Errorf("private key mode = %o, want 0600", info.Mode().Perm())
		}
	}
}

func TestLoadOrCreateCertRefusesAHalfProvidedPair(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile := filepath.Join(dir, "c.pem"), filepath.Join(dir, "k.pem")
	if err := os.WriteFile(certFile, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOrCreateCert(certFile, keyFile, nil); err == nil {
		t.Error("accepted a certificate without its key")
	}
	if _, err := os.Stat(keyFile); err == nil {
		t.Error("generated a key next to a certificate it did not create")
	}
}

func TestLoadOrCreateCertRejectsGarbage(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile := filepath.Join(dir, "c.pem"), filepath.Join(dir, "k.pem")
	os.WriteFile(certFile, []byte("not pem"), 0o600)
	os.WriteFile(keyFile, []byte("not pem"), 0o600)
	if _, err := LoadOrCreateCert(certFile, keyFile, nil); err == nil {
		t.Error("loaded a garbage pair")
	}
}

func TestFingerprintIsColonSeparatedUppercaseSHA256(t *testing.T) {
	cert, err := LoadOrCreateCert(filepath.Join(t.TempDir(), "c.pem"), filepath.Join(t.TempDir(), "k.pem"), []string{"localhost"})
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^([0-9A-F]{2}:){31}[0-9A-F]{2}$`).MatchString(Fingerprint(cert)) {
		t.Errorf("fingerprint %q is not 32 colon-separated hex pairs", Fingerprint(cert))
	}
	if got := Fingerprint(tls.Certificate{}); got != "" {
		t.Errorf("empty certificate fingerprint = %q, want empty", got)
	}
}
