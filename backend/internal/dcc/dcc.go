// Package dcc implements the peer-to-peer half of DCC CHAT: once an offer
// is made and accepted (that handshake rides over CTCP, on the ordinary IRC
// connection - see ircclient's CTCP DCC handling and bouncer's DCCOffer/
// DCCAccept), everything after is a plain direct TCP connection between the
// two clients, carrying newline-delimited text with no more IRC framing at
// all - that's what Session wraps.
package dcc

import (
	"bufio"
	"encoding/binary"
	"errors"
	"log"
	"net"
	"strconv"
	"sync"
	"time"
)

// Session is one active DCC CHAT connection, deliberately shaped like
// ircclient.Client (Send/AddLineListener/OnClose/Start) even though it's a
// much simpler protocol - consistent with the rest of this codebase rather
// than because DCC needs any of the IRC-specific machinery that shape
// originally existed for.
type Session struct {
	conn net.Conn

	mu             sync.Mutex
	lineListeners  []func(line string)
	closeListeners []func()

	closed chan struct{}
}

func newSession(conn net.Conn) *Session {
	return &Session{conn: conn, closed: make(chan struct{})}
}

// Dial connects out to a peer's announced DCC CHAT listener - the path an
// offer's *recipient* takes once they accept.
func Dial(ip string, port int) (*Session, error) {
	conn, err := net.Dial("tcp", net.JoinHostPort(ip, strconv.Itoa(port)))
	if err != nil {
		return nil, err
	}
	return newSession(conn), nil
}

// Listen opens a TCP listener on an OS-chosen port - the path an offer's
// *sender* takes: listen first, then announce the port (and LocalIP) in the
// CTCP request, then AcceptOnce.
func Listen() (net.Listener, error) {
	return net.Listen("tcp", ":0")
}

// AcceptOnce accepts exactly one connection from ln - a DCC offer is only
// ever good for one taker - within timeout, closing ln either way (a second
// caller connecting late, or not at all, isn't this client's problem once
// the window's passed).
func AcceptOnce(ln net.Listener, timeout time.Duration) (*Session, error) {
	defer ln.Close()
	type result struct {
		conn net.Conn
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		conn, err := ln.Accept()
		ch <- result{conn, err}
	}()
	select {
	case r := <-ch:
		if r.err != nil {
			return nil, r.err
		}
		return newSession(r.conn), nil
	case <-time.After(timeout):
		return nil, errors.New("dcc: timed out waiting for the peer to connect")
	}
}

// LocalIP makes a best-effort guess at the address a DCC CHAT offer should
// announce for the peer to connect back to: the local interface the OS
// would route a public-internet connection through. Nothing is actually
// sent - a UDP "connect" only resolves routing, it doesn't dial anywhere -
// the standard trick for finding your own outbound address without asking
// an external service. This doesn't solve NAT: behind one, it's still your
// private LAN address, and the offer only connects if the peer can actually
// reach it (same LAN, or port forwarding) - a real limitation DCC has
// always had, not something specific to this client.
func LocalIP() (net.IP, error) {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP, nil
}

// EncodeIP and DecodeIP convert to/from the wire format a DCC CTCP request
// announces an IPv4 address in: a big-endian uint32, decimal - not a
// dotted-quad string. A convention from DCC's mIRC-era origins that every
// client still speaking DCC has to match.
func EncodeIP(ip net.IP) uint32 {
	return binary.BigEndian.Uint32(ip.To4())
}

func DecodeIP(n uint32) net.IP {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, n)
	return net.IP(b)
}

// Start begins the read loop - separate from Dial/newSession so a caller
// can register listeners first, same reasoning as ircclient.Client.Start.
func (s *Session) Start() {
	go s.readLoop()
}

func (s *Session) readLoop() {
	scanner := bufio.NewScanner(s.conn)
	for scanner.Scan() {
		s.mu.Lock()
		listeners := s.lineListeners
		s.mu.Unlock()
		for _, cb := range listeners {
			cb(scanner.Text())
		}
	}
	if err := scanner.Err(); err != nil {
		log.Printf("dcc: read error: %v", err)
	}

	s.mu.Lock()
	closeListeners := s.closeListeners
	s.mu.Unlock()
	for _, cb := range closeListeners {
		cb()
	}
	close(s.closed)
}

func (s *Session) Send(line string) error {
	_, err := s.conn.Write([]byte(line + "\r\n"))
	return err
}

func (s *Session) AddLineListener(cb func(line string)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lineListeners = append(s.lineListeners, cb)
}

// OnClose registers cb to run once, when the connection closes. If it's
// already closed, cb runs immediately - same contract as ircclient.Client's.
func (s *Session) OnClose(cb func()) {
	select {
	case <-s.closed:
		cb()
		return
	default:
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	select {
	case <-s.closed:
		cb()
	default:
		s.closeListeners = append(s.closeListeners, cb)
	}
}

func (s *Session) Close() error {
	return s.conn.Close()
}
