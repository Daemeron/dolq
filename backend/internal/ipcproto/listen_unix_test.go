//go:build !windows

package ipcproto

import (
	"net"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestListenRefusesToDeleteANonSocket(t *testing.T) {
	path := filepath.Join(t.TempDir(), "important.txt")
	if err := os.WriteFile(path, []byte("keep me"), 0o644); err != nil {
		t.Fatal(err)
	}
	if ln, err := Listen("unix", path); err == nil {
		ln.Close()
		t.Fatal("listened over a regular file")
	}
	if got, err := os.ReadFile(path); err != nil || string(got) != "keep me" {
		t.Fatalf("file was touched: %q, %v", got, err)
	}
}

func TestListenReplacesStaleSocket(t *testing.T) {
	path := filepath.Join(t.TempDir(), "d.sock")
	stale, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	stale.(*net.UnixListener).SetUnlinkOnClose(false)
	stale.Close()

	ln, err := Listen("unix", path)
	if err != nil {
		t.Fatalf("Listen over a stale socket: %v", err)
	}
	defer ln.Close()
	info, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("socket mode %o, want 0600", info.Mode().Perm())
	}
}

func TestWithPrivateUmask(t *testing.T) {
	old := syscall.Umask(0)
	defer syscall.Umask(old)

	path := filepath.Join(t.TempDir(), "f")
	err := withPrivateUmask(func() error { return os.WriteFile(path, nil, 0o666) })
	if err != nil {
		t.Fatal(err)
	}
	if info, _ := os.Stat(path); info.Mode().Perm() != 0o600 {
		t.Errorf("created with mode %o, want 0600", info.Mode().Perm())
	}
	if now := syscall.Umask(0); now != 0 {
		t.Errorf("umask left at %o, want it restored", now)
	}
}
