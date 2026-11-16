// Package natmap asks the home router (UPnP, or NAT-PMP) for this machine's public address and for a port to be
// forwarded to it, so that a peer on the internet can connect in without anything being set up by hand. It is for a
// passive XDCC offer, a DCC chat and a file sent: the peer connects to us. Nothing is opened unless it is asked for.
package natmap

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"sync"
	"time"

	nat "github.com/libp2p/go-nat"
)

const (
	// foundFor is how long a router that answered is remembered, so each transfer does not search again.
	foundFor = 10 * time.Minute
	// notFoundFor is how long the lack of one is remembered. Searching takes seconds, and a router that is not there now
	// will not be there in a moment.
	notFoundFor = 30 * time.Second
)

// Gateway is the part of a router that is used, so a test can stand in for one. *nat.NAT values satisfy it.
type Gateway interface {
	Type() string
	GetExternalAddress() (net.IP, error)
	AddPortMapping(ctx context.Context, protocol string, internalPort int, description string, timeout time.Duration) (int, error)
	DeletePortMapping(ctx context.Context, protocol string, internalPort int) error
}

// Mapper finds the router once in a while and asks it to forward ports.
type Mapper struct {
	// Discover finds the router; nat.DiscoverGateway unless a test says otherwise.
	Discover func(ctx context.Context) (Gateway, error)
	// Lease is how long the router keeps a mapping if it is never removed, such as when this process dies.
	Lease time.Duration
	// Now is the time, for a test.
	Now func() time.Time

	mu       sync.Mutex
	gw       Gateway
	foundAt  time.Time
	lastErr  error
	failedAt time.Time
}

// New is a Mapper that finds a real router. lease is how long a mapping lives if it is not removed first.
func New(lease time.Duration) *Mapper {
	return &Mapper{
		Discover: func(ctx context.Context) (Gateway, error) { return nat.DiscoverGateway(ctx) },
		Lease:    lease,
		Now:      time.Now,
	}
}

func (m *Mapper) gateway(ctx context.Context) (Gateway, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.Now()
	if m.gw != nil && now.Sub(m.foundAt) < foundFor {
		return m.gw, nil
	}
	if m.lastErr != nil && now.Sub(m.failedAt) < notFoundFor {
		return nil, m.lastErr
	}
	gw, err := m.Discover(ctx)
	if err != nil {
		m.gw, m.lastErr, m.failedAt = nil, noRouter(err), now
		return nil, m.lastErr
	}
	m.gw, m.foundAt, m.lastErr = gw, now, nil
	return gw, nil
}

func noRouter(err error) error {
	return fmt.Errorf("no router answered (it has to allow UPnP or NAT-PMP, and this machine has to be on the same network as it: in a container that means host networking): %w", err)
}

// Probe says what the router would give out, without asking it to open anything: a line for the log at start-up.
func (m *Mapper) Probe(ctx context.Context) (string, error) {
	gw, err := m.gateway(ctx)
	if err != nil {
		return "", err
	}
	ip, err := gw.GetExternalAddress()
	if err != nil {
		return "", fmt.Errorf("the router (%s) would not say its public address: %w", gw.Type(), err)
	}
	if err := checkPublic(ip); err != nil {
		return "", err
	}
	return fmt.Sprintf("found a router (%s), whose public address is %s", gw.Type(), ip), nil
}

// Reach is what a peer has to be told to connect to a port this machine listens on: the router's public address and a
// port on it that the router forwards. release gives the mapping back and may be called more than once. The router is
// asked for nothing until this is called.
func (m *Mapper) Reach(ctx context.Context, listenPort int) (ip net.IP, port int, release func(), err error) {
	gw, err := m.gateway(ctx)
	if err != nil {
		return nil, 0, nil, err
	}
	ip, err = gw.GetExternalAddress()
	if err != nil {
		return nil, 0, nil, fmt.Errorf("the router (%s) would not say its public address: %w", gw.Type(), err)
	}
	if err := checkPublic(ip); err != nil {
		return nil, 0, nil, err
	}
	port, err = gw.AddPortMapping(ctx, "tcp", listenPort, "dolqd DCC", m.Lease)
	if err != nil {
		return nil, 0, nil, fmt.Errorf("the router (%s) would not forward a port: %w", gw.Type(), err)
	}
	log.Printf("dcc: the router (%s) forwards %s:%d to this machine's port %d for up to %s", gw.Type(), ip, port, listenPort, m.Lease)

	var once sync.Once
	release = func() {
		once.Do(func() {
			// the mapping must go even when the caller's context is already over
			rctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if err := gw.DeletePortMapping(rctx, "tcp", listenPort); err != nil {
				log.Printf("dcc: the router (%s) would not remove the forward of port %d, it expires on its own: %v", gw.Type(), listenPort, err)
				return
			}
			log.Printf("dcc: the forward of port %d on the router (%s) is removed", listenPort, gw.Type())
		})
	}
	return ip, port, release, nil
}

// checkPublic refuses an address that cannot be reached from the internet. A router that reports a private address sits
// behind another one, and a provider that shares one public address between customers (CGNAT) hands out 100.64.0.0/10:
// either way, forwarding a port on this router leads nowhere.
func checkPublic(ip net.IP) error {
	if ip == nil || ip.IsUnspecified() {
		return errors.New("the router has no public address yet")
	}
	if ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || cgnat.Contains(ip) {
		return fmt.Errorf("the router's address is %s, which is not a public address: another router, or your provider (CGNAT), sits between it and the internet, so no peer can connect in", ip)
	}
	return nil
}

var cgnat = func() *net.IPNet {
	_, n, _ := net.ParseCIDR("100.64.0.0/10")
	return n
}()
