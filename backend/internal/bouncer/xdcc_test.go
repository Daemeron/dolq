package bouncer

import (
	"os"
	"path/filepath"
	"testing"
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
