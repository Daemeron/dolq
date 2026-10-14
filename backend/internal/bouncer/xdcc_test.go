package bouncer

import (
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/Daemeron/dolq/backend/internal/ircparse"
)

func TestSafeFilename(t *testing.T) {
	cases := map[string]string{
		"movie.mkv":                      "movie.mkv",
		"../../etc/passwd":               "passwd",
		"../../../home/user/.ssh/id_rsa": "id_rsa",
		"/etc/passwd":                    "passwd",
		"..":                             "download",
		".":                              "download",
		"":                               "download",
		"a/b/c.zip":                      "c.zip",
	}
	for in, want := range cases {
		if got := safeFilename(in); got != want {
			t.Errorf("safeFilename(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSafeFilenameStaysWithinDir(t *testing.T) {
	dir := t.TempDir()
	for _, in := range []string{"../../etc/passwd", "../secret", "/etc/shadow"} {
		joined := filepath.Join(dir, safeFilename(in))
		if filepath.Dir(joined) != dir {
			t.Errorf("safeFilename(%q) escaped dir: joined to %q", in, joined)
		}
	}
}

func TestUniquePath(t *testing.T) {
	dir := t.TempDir()

	first := uniquePath(dir, "file.zip")
	if first != filepath.Join(dir, "file.zip") {
		t.Fatalf("first call: got %q", first)
	}
	if err := os.WriteFile(first, []byte("x"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	second := uniquePath(dir, "file.zip")
	if second != filepath.Join(dir, "file (1).zip") {
		t.Fatalf("second call: got %q, want a \"(1)\" suffix", second)
	}
	if err := os.WriteFile(second, []byte("x"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	third := uniquePath(dir, "file.zip")
	if third != filepath.Join(dir, "file (2).zip") {
		t.Fatalf("third call: got %q, want a \"(2)\" suffix", third)
	}
}

func TestXDCCAcceptResumesPartialFile(t *testing.T) {
	dir := t.TempDir()
	existing := []byte("0123456789")
	if err := os.WriteFile(filepath.Join(dir, "file.zip"), existing, 0o644); err != nil {
		t.Fatalf("seed partial file: %v", err)
	}
	rest := []byte("rest-of-the-file-goes-here")
	size := int64(len(existing) + len(rest))

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	senderPort := ln.Addr().(*net.TCPAddr).Port
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		conn.Write(rest)
		io.Copy(io.Discard, conn)
	}()

	b := New(nil)
	sub := &fakeSubscriber{}
	serverConn, r := pipeSession(t, b, "server-a", sub)

	offer := ircparse.XDCCSendOfferEvent{
		Nick: "alice", Filename: "file.zip", IP: "127.0.0.1", Port: senderPort, Size: size,
	}

	idCh := make(chan string, 1)
	go func() {
		id, err := b.XDCCAccept("server-a", offer, dir, 0, 0, sub)
		if err != nil {
			t.Errorf("XDCCAccept: %v", err)
			return
		}
		idCh <- id
	}()

	line, err := r.ReadString('\n')
	if err != nil {
		t.Fatalf("read DCC RESUME request: %v", err)
	}
	want := "PRIVMSG alice :\x01DCC RESUME file.zip " + strconv.Itoa(senderPort) + " " + strconv.Itoa(len(existing)) + "\x01\r\n"
	if line != want {
		t.Fatalf("got %q, want %q", line, want)
	}

	writeLine(t, serverConn, ":alice!u@host PRIVMSG testnick :\x01DCC ACCEPT file.zip "+
		strconv.Itoa(senderPort)+" "+strconv.Itoa(len(existing))+"\x01")

	select {
	case <-idCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for XDCCAccept to return")
	}

	waitFor(t, func() bool { return sub.lastStatus() == "disconnected" })

	got, err := os.ReadFile(filepath.Join(dir, "file.zip"))
	if err != nil {
		t.Fatalf("read result file: %v", err)
	}
	want2 := append(append([]byte{}, existing...), rest...)
	if string(got) != string(want2) {
		t.Fatalf("file.zip = %q, want %q (existing + resumed bytes, no separate \"(1)\" file)", got, want2)
	}
	if _, err := os.Stat(filepath.Join(dir, "file (1).zip")); err == nil {
		t.Error("a separate \"(1)\" file was also created - resume should have reused the original")
	}
}

func TestXDCCAcceptFallsBackToFreshWhenBotIgnoresResume(t *testing.T) {
	dir := t.TempDir()
	existing := []byte("0123456789")
	if err := os.WriteFile(filepath.Join(dir, "file.zip"), existing, 0o644); err != nil {
		t.Fatalf("seed partial file: %v", err)
	}

	full := []byte("a-brand-new-full-copy-of-the-file")
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	senderPort := ln.Addr().(*net.TCPAddr).Port
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		conn.Write(full)
		io.Copy(io.Discard, conn)
	}()

	b := New(nil)
	b.ResumeAcceptTimeout = 50 * time.Millisecond
	sub := &fakeSubscriber{}
	_, r := pipeSession(t, b, "server-a", sub)

	offer := ircparse.XDCCSendOfferEvent{
		Nick: "alice", Filename: "file.zip", IP: "127.0.0.1", Port: senderPort, Size: int64(len(full)),
	}
	idCh := make(chan string, 1)
	go func() {
		id, err := b.XDCCAccept("server-a", offer, dir, 0, 0, sub)
		if err != nil {
			t.Errorf("XDCCAccept: %v", err)
			return
		}
		idCh <- id
	}()

	if _, err := r.ReadString('\n'); err != nil {
		t.Fatalf("read DCC RESUME request: %v", err)
	}

	select {
	case <-idCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for XDCCAccept to return")
	}
	waitFor(t, func() bool { return sub.lastStatus() == "disconnected" })

	if got, err := os.ReadFile(filepath.Join(dir, "file.zip")); err != nil || string(got) != string(existing) {
		t.Errorf("original partial file was modified: got %q, %v", got, err)
	}
	got, err := os.ReadFile(filepath.Join(dir, "file (1).zip"))
	if err != nil {
		t.Fatalf("read fresh-download file: %v", err)
	}
	if string(got) != string(full) {
		t.Errorf("file (1).zip = %q, want %q", got, full)
	}
}

// A symlink in the download dir must not let a resume truncate or append to
// the file it points at, nor a new download write through it.
func TestOpenDestinationIgnoresSymlinks(t *testing.T) {
	dir, outside := t.TempDir(), t.TempDir()
	victim := filepath.Join(outside, "victim")
	if err := os.WriteFile(victim, []byte("0123456789"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(victim, filepath.Join(dir, "file.zip")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := os.Symlink(filepath.Join(outside, "dangling"), filepath.Join(dir, "file (1).zip")); err != nil {
		t.Fatal(err)
	}

	// A nil client: a resume attempt would panic, so this also proves none is made.
	offer := ircparse.XDCCSendOfferEvent{Nick: "alice", Filename: "file.zip", Size: 100}
	path, base, f, err := openDestination(nil, offer, dir, time.Millisecond)
	if err != nil {
		t.Fatalf("openDestination: %v", err)
	}
	f.Close()
	if want := filepath.Join(dir, "file (2).zip"); path != want || base != 0 {
		t.Fatalf("got %q at %d, want a fresh %q", path, base, want)
	}
	if got, _ := os.ReadFile(victim); string(got) != "0123456789" {
		t.Fatalf("symlink target modified: %q", got)
	}
	if _, err := os.Lstat(filepath.Join(outside, "dangling")); !os.IsNotExist(err) {
		t.Fatalf("wrote through a dangling symlink: %v", err)
	}
}

func TestOpenForResumeRefusesSwappedFile(t *testing.T) {
	dir := t.TempDir()
	a, b := filepath.Join(dir, "a"), filepath.Join(dir, "b")
	for _, p := range []string{a, b} {
		if err := os.WriteFile(p, []byte("0123456789"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	statA, err := os.Lstat(a)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := openForResume(b, statA, 5); err == nil {
		t.Fatal("resumed onto a file other than the one checked")
	}
	if got, _ := os.ReadFile(b); string(got) != "0123456789" {
		t.Fatalf("swapped file modified: %q", got)
	}
	f, err := openForResume(a, statA, 5)
	if err != nil {
		t.Fatalf("openForResume: %v", err)
	}
	f.Close()
	if got, _ := os.ReadFile(a); string(got) != "01234" {
		t.Fatalf("not truncated to the resume position: %q", got)
	}
}
