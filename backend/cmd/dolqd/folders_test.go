package main

import (
	"strings"
	"testing"
)

func fakeOps(onRoot bool) folderOps {
	return folderOps{
		describe: func(string) string { return "14.2 GB free of 1.8 TB" },
		onRoot:   func(string) bool { return onRoot },
		free:     func(string) (uint64, bool) { return 14_200_000_000, true },
	}
}

func TestAFolderOnAMountedVolumeIsOnlyDescribed(t *testing.T) {
	got := folderLines("download", "/downloads", true, fakeOps(false))
	if len(got) != 1 || got[0] != "download folder /downloads: 14.2 GB free of 1.8 TB" {
		t.Fatalf("got %q", got)
	}
}

func TestAFolderInsideTheContainerIsWarnedAbout(t *testing.T) {
	got := folderLines("download", "/downloads", true, fakeOps(true))
	if len(got) != 2 || !strings.HasPrefix(got[1], "warning: /downloads is not a mounted volume") {
		t.Fatalf("got %q", got)
	}
}

func TestOutsideAContainerTheRootFilesystemIsNormal(t *testing.T) {
	got := folderLines("data", "/home/me/.config/dolq", false, fakeOps(true))
	if len(got) != 1 {
		t.Fatalf("a folder on the root filesystem of an ordinary machine was warned about: %q", got)
	}
}

func TestAFolderWithHardlyAnyRoomIsWarnedAbout(t *testing.T) {
	ops := fakeOps(false)
	ops.free = func(string) (uint64, bool) { return 0, true }
	got := folderLines("download", "/downloads", true, ops)
	if len(got) != 2 || !strings.HasPrefix(got[1], "warning: the download folder /downloads has only 0 B free") {
		t.Fatalf("got %q", got)
	}
}

func TestRoomThatCannotBeToldIsNotAWarning(t *testing.T) {
	ops := fakeOps(false)
	ops.free = func(string) (uint64, bool) { return 0, false }
	if got := folderLines("data", "/data", true, ops); len(got) != 1 {
		t.Fatalf("got %q", got)
	}
}
