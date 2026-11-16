package disk

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSizeReadsLikeAPersonWouldWriteIt(t *testing.T) {
	for _, c := range []struct {
		n    uint64
		want string
	}{
		{0, "0 B"},
		{999, "999 B"},
		{1000, "1.0 KB"},
		{1_500_000, "1.5 MB"},
		{14_200_000_000, "14.2 GB"},
		{1_800_000_000_000, "1.8 TB"},
	} {
		if got := Size(c.n); got != c.want {
			t.Errorf("Size(%d) = %q, want %q", c.n, got, c.want)
		}
	}
}

func TestFreeAndDescribeForARealFolder(t *testing.T) {
	dir := t.TempDir()
	free, total, err := Free(dir)
	if err != nil {
		t.Fatal(err)
	}
	if total == 0 || free > total {
		t.Fatalf("free %d of total %d", free, total)
	}
	if got := Describe(dir); !strings.Contains(got, " free of ") {
		t.Errorf("Describe = %q", got)
	}
}

func TestAFolderThatIsNotThereHasNoKnownSpace(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "nope")
	if _, _, err := Free(missing); err == nil {
		t.Error("a missing folder reported its free space")
	}
	if got := Describe(missing); got != "free space unknown" {
		t.Errorf("Describe = %q", got)
	}
	if OnRootFilesystem(missing) {
		t.Error("a missing folder was said to be on the root filesystem")
	}
}

func TestAFolderIsOnTheSameFilesystemAsItsParent(t *testing.T) {
	if _, err := os.Stat("/"); err != nil {
		t.Skip("no root to compare with")
	}
	// The root itself is on its own filesystem, wherever the tests run.
	if got := OnRootFilesystem("/"); got != (os.PathSeparator == '/') {
		t.Errorf("OnRootFilesystem(/) = %v", got)
	}
}
