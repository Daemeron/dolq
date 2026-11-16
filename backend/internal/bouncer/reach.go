package bouncer

import (
	"context"
	"net"
	"time"

	"github.com/Daemeron/dolq/backend/internal/dcc"
)

// reachTimeout bounds asking a router for an address and a port: finding one takes seconds, and a transfer is not worth waiting minutes for.
const reachTimeout = 15 * time.Second

// Reacher says how a peer connects to a port this machine listens on, for when the address of the machine is not enough:
// behind a router, the router's public address and a port it forwards. release gives back whatever was set up, and may be
// called more than once.
type Reacher interface {
	Reach(ctx context.Context, listenPort int) (ip net.IP, port int, release func(), err error)
}

// reach is what to announce for a listener on listenPort: what the Reacher says, or without one the configured (or the
// machine's own) address and the port itself.
func (b *Bouncer) reach(listenPort int) (net.IP, int, func(), error) {
	if b.Reacher != nil {
		ctx, cancel := context.WithTimeout(context.Background(), reachTimeout)
		defer cancel()
		return b.Reacher.Reach(ctx, listenPort)
	}
	ip, err := dcc.AnnouncedIP(b.DCCHost)
	return ip, listenPort, func() {}, err
}
