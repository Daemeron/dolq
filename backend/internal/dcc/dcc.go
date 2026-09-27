package dcc

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"log"
	"net"
	"strconv"
	"sync"
	"time"
)

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

func Dial(ip string, port int) (*Session, error) {
	conn, err := DialRaw(ip, port)
	if err != nil {
		return nil, err
	}
	return newSession(conn), nil
}

func DialRaw(ip string, port int) (net.Conn, error) {
	return net.Dial("tcp", net.JoinHostPort(ip, strconv.Itoa(port)))
}

func Listen(minPort, maxPort int) (net.Listener, error) {
	if minPort == 0 && maxPort == 0 {
		return net.Listen("tcp", ":0")
	}
	if minPort <= 0 || maxPort < minPort {
		return nil, fmt.Errorf("dcc: invalid port range %d-%d", minPort, maxPort)
	}
	var lastErr error
	for port := minPort; port <= maxPort; port++ {
		ln, err := net.Listen("tcp", ":"+strconv.Itoa(port))
		if err == nil {
			return ln, nil
		}
		lastErr = err
	}
	return nil, fmt.Errorf("dcc: no free port in %d-%d: %w", minPort, maxPort, lastErr)
}

func AcceptOnce(ln net.Listener, timeout time.Duration) (*Session, error) {
	conn, err := AcceptOnceRaw(ln, timeout)
	if err != nil {
		return nil, err
	}
	return newSession(conn), nil
}

func AcceptOnceRaw(ln net.Listener, timeout time.Duration) (net.Conn, error) {
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
		return r.conn, r.err
	case <-time.After(timeout):
		return nil, errors.New("dcc: timed out waiting for the peer to connect")
	}
}

func LocalIP() (net.IP, error) {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP, nil
}

func EncodeIP(ip net.IP) uint32 {
	return binary.BigEndian.Uint32(ip.To4())
}

func DecodeIP(n uint32) net.IP {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, n)
	return net.IP(b)
}

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
