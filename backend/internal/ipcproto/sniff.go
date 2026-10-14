package ipcproto

import (
	"bufio"
	"context"
	"crypto/tls"
	"net"
	"sync"
	"time"
)

// A TLS handshake always opens with the record type byte 0x16; the plain
// protocol opens with a JSON frame, so the first byte tells them apart.
const tlsHandshakeByte = 0x16

// defaultSniffTimeout bounds how long a new connection may stay silent before it is dropped.
const defaultSniffTimeout = 10 * time.Second

// legacyPlainConn marks a connection accepted without TLS in compatibility
// mode. Those clients predate access tokens, so they are not asked for one.
type legacyPlainConn struct {
	net.Conn
	r *bufio.Reader
}

func (c *legacyPlainConn) Read(p []byte) (int, error) { return c.r.Read(p) }

// peekedConn replays the bytes already peeked at to whoever reads next (the TLS layer).
type peekedConn struct {
	net.Conn
	r *bufio.Reader
}

func (c *peekedConn) Read(p []byte) (int, error) { return c.r.Read(p) }

type sniffListener struct {
	net.Listener
	timeout   time.Duration
	conns     chan net.Conn
	errc      chan error
	done      chan struct{}
	closeOnce sync.Once
}

// NewSniffingListener serves TLS (cfg) and, if allowPlain, the legacy plain
// protocol on the same port, deciding per connection from its first byte.
// Plain connections come out wrapped as legacyPlainConn; with allowPlain false
// they are dropped, which is what -secure wants.
func NewSniffingListener(ln net.Listener, cfg *tls.Config, allowPlain bool) net.Listener {
	return newSniffingListener(ln, cfg, allowPlain, defaultSniffTimeout)
}

func newSniffingListener(ln net.Listener, cfg *tls.Config, allowPlain bool, timeout time.Duration) net.Listener {
	s := &sniffListener{
		Listener: ln,
		timeout:  timeout,
		conns:    make(chan net.Conn),
		errc:     make(chan error, 1),
		done:     make(chan struct{}),
	}
	go s.acceptLoop(cfg, allowPlain)
	return s
}

func (s *sniffListener) acceptLoop(cfg *tls.Config, allowPlain bool) {
	for {
		raw, err := s.Listener.Accept()
		if err != nil {
			select {
			case s.errc <- err:
			case <-s.done:
			}
			return
		}
		// One goroutine per connection, so a client that connects and says
		// nothing cannot hold up the ones behind it.
		go func() {
			raw.SetReadDeadline(time.Now().Add(s.timeout))
			br := bufio.NewReader(raw)
			first, err := br.Peek(1)
			raw.SetReadDeadline(time.Time{})
			if err != nil {
				raw.Close()
				return
			}
			var conn net.Conn
			switch {
			case first[0] == tlsHandshakeByte:
				// Handshake here, under the same deadline: left to the first
				// read it would have none when no token is required (only
				// authentication sets one), so a stalled client was held forever.
				tc := tls.Server(&peekedConn{Conn: raw, r: br}, cfg)
				raw.SetDeadline(time.Now().Add(s.timeout))
				err := tc.HandshakeContext(context.Background())
				raw.SetDeadline(time.Time{})
				if err != nil {
					raw.Close()
					return
				}
				conn = tc
			case allowPlain:
				conn = &legacyPlainConn{Conn: raw, r: br}
			default:
				raw.Close()
				return
			}
			select {
			case s.conns <- conn:
			case <-s.done:
				conn.Close()
			}
		}()
	}
}

func (s *sniffListener) Accept() (net.Conn, error) {
	select {
	case c := <-s.conns:
		return c, nil
	case err := <-s.errc:
		return nil, err
	case <-s.done:
		return nil, net.ErrClosed
	}
}

func (s *sniffListener) Close() error {
	s.closeOnce.Do(func() { close(s.done) })
	return s.Listener.Close()
}
