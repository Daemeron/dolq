package ipcproto

import (
	"net"

	"github.com/Microsoft/go-winio"
)

func listenPipe(path string) (net.Listener, error) { return winio.ListenPipe(path, nil) }
