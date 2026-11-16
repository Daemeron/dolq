package disk

import "golang.org/x/sys/windows"

func free0(dir string) (free, total uint64, err error) {
	path, err := windows.UTF16PtrFromString(dir)
	if err != nil {
		return 0, 0, err
	}
	var available, all, totalFree uint64
	if err := windows.GetDiskFreeSpaceEx(path, &available, &all, &totalFree); err != nil {
		return 0, 0, err
	}
	return available, all, nil
}

// There is no root filesystem to compare with, and no containers of this kind to run on.
func onRoot(string) bool { return false }
