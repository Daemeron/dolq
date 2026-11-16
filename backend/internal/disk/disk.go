// Package disk answers two questions about a folder: how much room is left on its filesystem, and whether it is on the
// same filesystem as the root of the machine. In a container the second means the folder is not a mounted volume.
package disk

import "fmt"

// Free reports the bytes available to a process and the total bytes of the filesystem that holds dir.
func Free(dir string) (free, total uint64, err error) {
	return free0(dir)
}

// OnRootFilesystem reports whether dir is on the same filesystem as the root of the machine, which for a container is
// the container's own, not a volume mounted into it. It is false where that cannot be told.
func OnRootFilesystem(dir string) bool {
	return onRoot(dir)
}

// Describe is how a folder's free space reads in the log, such as "14.2 GB free of 1.8 TB".
func Describe(dir string) string {
	free, total, err := Free(dir)
	if err != nil {
		return "free space unknown"
	}
	return fmt.Sprintf("%s free of %s", Size(free), Size(total))
}

// Size writes a number of bytes the way a person reads it: 1.5 GB, 320 KB.
func Size(n uint64) string {
	const unit = 1000
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	value, suffix := float64(n), ""
	for _, s := range []string{"KB", "MB", "GB", "TB", "PB"} {
		value /= unit
		suffix = s
		if value < unit {
			break
		}
	}
	return fmt.Sprintf("%.1f %s", value, suffix)
}
