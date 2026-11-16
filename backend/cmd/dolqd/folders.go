package main

import (
	"fmt"

	"github.com/Daemeron/dolq/backend/internal/disk"
)

// folderOps is what the report of a folder asks the machine; tests give it answers.
type folderOps struct {
	describe func(dir string) string
	onRoot   func(dir string) bool
	// free is the bytes available in the folder, and false when that cannot be told.
	free func(dir string) (uint64, bool)
}

var machineFolderOps = folderOps{
	describe: disk.Describe,
	onRoot:   disk.OnRootFilesystem,
	free: func(dir string) (uint64, bool) {
		free, _, err := disk.Free(dir)
		return free, err == nil
	},
}

// lowSpace is the room under which a folder is warned about: a download is bigger than that.
const lowSpace = 1_000_000_000

// folderLines is what the log says at start about a folder dolqd keeps files in: how much room it has, a warning when
// there is hardly any, and, in a container, a warning when it is not a mounted volume. A host folder that is missing is
// created by Docker on whatever disk holds its parent, often a small system disk, so everything written there fills it up.
func folderLines(label, dir string, inContainer bool, ops folderOps) []string {
	lines := []string{fmt.Sprintf("%s folder %s: %s", label, dir, ops.describe(dir))}
	if free, ok := ops.free(dir); ok && free < lowSpace {
		lines = append(lines, fmt.Sprintf(
			"warning: the %s folder %s has only %s free. If that is not the disk you meant, the folder behind it is missing: "+
				"Docker creates a missing folder on the machine's own small disk. Check the path in the compose file",
			label, dir, disk.Size(free)))
	}
	if inContainer && ops.onRoot(dir) {
		lines = append(lines, fmt.Sprintf(
			"warning: %s is not a mounted volume: it is inside the container, so what is saved there is lost with it and "+
				"fills the disk the container runs on. Check the volumes in the compose file, and that the folders they "+
				"point to exist on the host", dir))
	}
	return lines
}
