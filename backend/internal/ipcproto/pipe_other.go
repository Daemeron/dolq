//go:build !windows

package ipcproto

import (
	"errors"
	"net"
	"sync"
	"syscall"
)

func listenPipe(string) (net.Listener, error) { return nil, errors.New("named pipes are Windows-only") }

var umaskMu sync.Mutex

// withPrivateUmask runs f with the umask set to 0177, so files it creates are
// owner-only. The umask is process-wide; this is only called while starting up.
func withPrivateUmask(f func() error) error {
	umaskMu.Lock()
	defer umaskMu.Unlock()
	old := syscall.Umask(0o177)
	defer syscall.Umask(old)
	return f()
}
