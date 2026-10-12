//go:build !windows

package ipcproto

import (
	"errors"
	"net"
)

func listenPipe(string) (net.Listener, error) { return nil, errors.New("named pipes are Windows-only") }
