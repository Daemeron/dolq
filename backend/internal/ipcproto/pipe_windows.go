package ipcproto

import (
	"fmt"
	"net"

	"github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
)

// listenPipe creates the named pipe with a protected DACL that grants access
// to the current user only; the default descriptor also lets other accounts
// on the machine open it.
func listenPipe(path string) (net.Listener, error) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return nil, fmt.Errorf("look up current user: %w", err)
	}
	sddl := fmt.Sprintf("D:P(A;;GA;;;%s)", user.User.Sid.String())
	return winio.ListenPipe(path, &winio.PipeConfig{SecurityDescriptor: sddl})
}

// withPrivateUmask just runs f: Windows has no umask, and Listen chmods the
// socket afterwards.
func withPrivateUmask(f func() error) error { return f() }
