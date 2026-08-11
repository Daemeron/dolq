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

// TestSafeFilename is the important one: an XDCC offer's filename comes
// from an untrusted network peer, and safeFilename is the only thing
// standing between that and a path-traversal write outside the intended
// download directory.
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

// TestXDCCAcceptResumesPartialFile checks the resume handshake end to end:
// an existing partial file triggers a CTCP DCC RESUME request, and once the
// bot ACCEPTs it, the transfer appends the bot's remaining bytes onto the
// existing file - rather than uniquePath-ing a second, separate file next
// to it, which is what would happen without resume support.
func TestXDCCAcceptResumesPartialFile(t *testing.T) {
	dir := t.TempDir()
	existing := []byte("0123456789") // 10 bytes already on disk
	if err := os.WriteFile(filepath.Join(dir, "file.zip"), existing, 0o644); err != nil {
		t.Fatalf("seed partial file: %v", err)
	}
	rest := []byte("rest-of-the-file-goes-here")
	size := int64(len(existing) + len(rest))

	// Stands in for the sender ("alice"'s bot) accepting a connection on
	// the port its original DCC SEND offer announced.
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
		io.Copy(io.Discard, conn) // drain acks
	}()

	b := New(nil)
	sub := &fakeSubscriber{}
	serverConn, r := pipeSession(t, b, "server-a", sub)

	offer := ircparse.XDCCSendOfferEvent{
		Nick: "alice", Filename: "file.zip", IP: "127.0.0.1", Port: senderPort, Size: size,
	}

	idCh := make(chan string, 1)
	go func() {
		id, err := b.XDCCAccept("server-a", offer, dir, sub)
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

	// Reply as the bot would: DCC ACCEPT at the position it was asked for.
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

// TestXDCCAcceptFallsBackToFreshWhenBotIgnoresResume checks that a bot that
// never answers a DCC RESUME request (most don't support it) doesn't hang
// the whole accept - XDCCAccept falls back to downloading the pack fresh,
// same as if no partial file had ever existed, leaving the original partial
// file untouched rather than corrupting it.
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
	b.ResumeAcceptTimeout = 50 * time.Millisecond // never replied to - no need to sit through the real timeout
	sub := &fakeSubscriber{}
	_, r := pipeSession(t, b, "server-a", sub)

	offer := ircparse.XDCCSendOfferEvent{
		Nick: "alice", Filename: "file.zip", IP: "127.0.0.1", Port: senderPort, Size: int64(len(full)),
	}
	idCh := make(chan string, 1)
	go func() {
		id, err := b.XDCCAccept("server-a", offer, dir, sub)
		if err != nil {
			t.Errorf("XDCCAccept: %v", err)
			return
		}
		idCh <- id
	}()

	if _, err := r.ReadString('\n'); err != nil { // the (unanswered) DCC RESUME request
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
