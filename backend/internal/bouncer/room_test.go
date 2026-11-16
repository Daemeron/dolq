package bouncer

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Daemeron/dolq/backend/internal/ircparse"
)

func withFree(t *testing.T, free uint64, err error) {
	t.Helper()
	old := freeSpace
	freeSpace = func(string) (uint64, uint64, error) { return free, 1 << 40, err }
	t.Cleanup(func() { freeSpace = old })
}

func offerOf(name string, size int64) ircparse.XDCCSendOfferEvent {
	return ircparse.XDCCSendOfferEvent{Nick: "bot", Filename: name, Size: size}
}

func TestADownloadThatFitsWithRoomToSpareIsAccepted(t *testing.T) {
	withFree(t, 5_000_000_000, nil)
	if err := checkRoom(t.TempDir(), offerOf("a.mkv", 1_400_000_000)); err != nil {
		t.Fatal(err)
	}
}

func TestADownloadThatWouldFillTheDiskIsRefusedAndSaysWhy(t *testing.T) {
	withFree(t, 1_450_000_000, nil)
	err := checkRoom(t.TempDir(), offerOf("a.mkv", 1_400_000_000))
	if err == nil {
		t.Fatal("a download that leaves 50 MB free was accepted")
	}
	for _, want := range []string{"not enough room", "1.4 GB free", "a.mkv needs 1.4 GB", "100.0 MB kept free"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("%q does not say %q", err, want)
		}
	}
}

func TestADownloadToADiskWithNoRoomAtAllIsRefused(t *testing.T) {
	withFree(t, 0, nil)
	if err := checkRoom(t.TempDir(), offerOf("a.mkv", 66_000_000)); err == nil {
		t.Fatal("a download to a full disk was accepted")
	}
}

func TestOnlyWhatIsStillMissingOfAPartialDownloadNeedsRoom(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.mkv"), make([]byte, 1000), 0o644); err != nil {
		t.Fatal(err)
	}
	// 1000 bytes of 1,000,000,050 are there: 1,000,000,000 are missing, so it fits in 1.2 GB free, whole it would not.
	withFree(t, 1_100_000_000, nil)
	if err := checkRoom(dir, offerOf("a.mkv", 1_000_000_050)); err != nil {
		t.Fatalf("the partial file was not counted: %v", err)
	}
	if err := checkRoom(t.TempDir(), offerOf("a.mkv", 1_000_000_050)); err == nil {
		t.Fatal("the whole file fit in room that is too small")
	}
}

func TestRoomThatCannotBeToldAndSizesThatAreUnknownAreNotARefusal(t *testing.T) {
	withFree(t, 0, errors.New("no way to tell"))
	if err := checkRoom(t.TempDir(), offerOf("a.mkv", 1_400_000_000)); err != nil {
		t.Fatal(err)
	}
	withFree(t, 0, nil)
	if err := checkRoom(t.TempDir(), offerOf("a.mkv", 0)); err != nil {
		t.Fatal(err)
	}
}
