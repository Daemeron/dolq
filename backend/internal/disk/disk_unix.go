//go:build !windows

package disk

import (
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

func free0(dir string) (free, total uint64, err error) {
	var st unix.Statfs_t
	if err := unix.Statfs(dir, &st); err != nil {
		return 0, 0, err
	}
	return uint64(st.Bavail) * uint64(st.Bsize), uint64(st.Blocks) * uint64(st.Bsize), nil
}

func onRoot(dir string) bool {
	a, err := os.Stat(dir)
	if err != nil {
		return false
	}
	b, err := os.Stat("/")
	if err != nil {
		return false
	}
	sa, ok1 := a.Sys().(*syscall.Stat_t)
	sb, ok2 := b.Sys().(*syscall.Stat_t)
	return ok1 && ok2 && uint64(sa.Dev) == uint64(sb.Dev)
}
