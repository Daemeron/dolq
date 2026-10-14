package ipcproto

import (
	"bufio"
	"crypto/subtle"
	"encoding/json"
	"log"
	"net"
	"os"
	"sync"
	"time"

	"github.com/Daemeron/dolq/backend/internal/bouncer"
	"github.com/Daemeron/dolq/backend/internal/ircparse"
)

func Listen(network, address string) (net.Listener, error) {
	if network == "unix" {
		if err := os.Remove(address); err != nil && !os.IsNotExist(err) {
			return nil, err
		}
	}
	if network == "pipe" {
		return listenPipe(address)
	}
	ln, err := net.Listen(network, address)
	if err != nil {
		return nil, err
	}
	if network == "unix" {
		// The default mode follows the umask, which can leave the socket open
		// to other local users; only the owner may connect.
		if err := os.Chmod(address, 0o600); err != nil {
			ln.Close()
			return nil, err
		}
	}
	return ln, nil
}

type Server struct {
	b     *bouncer.Bouncer
	token string
}

// authTimeout (a var so tests can shorten it) bounds how long a fresh connection may take to present its token.
var authTimeout = 10 * time.Second

func NewServer(b *bouncer.Bouncer) *Server {
	return &Server{b: b}
}

// RequireToken makes every connection open with an auth frame carrying token
// before any other action is honored. An empty token turns the check off.
func (s *Server) RequireToken(token string) *Server {
	s.token = token
	return s
}

// authenticate reads the connection's first frame and reports whether it is a
// valid auth frame. The reply is written either way; the caller closes the
// connection when it returns false.
func (s *Server) authenticate(c *conn, scanner *bufio.Scanner) bool {
	c.netConn.SetReadDeadline(time.Now().Add(authTimeout))
	defer c.netConn.SetReadDeadline(time.Time{})

	// Nothing arrived (a health probe, a port scan, a stalled client): just hang up.
	if !scanner.Scan() {
		return false
	}
	var f ClientFrame
	if json.Unmarshal(scanner.Bytes(), &f) != nil || f.Action != ActionAuth ||
		subtle.ConstantTimeCompare([]byte(f.AuthToken), []byte(s.token)) != 1 {
		time.Sleep(300 * time.Millisecond) // slow down guessing
		c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: false, Error: "unauthorized"})
		return false
	}
	c.writeResult(f.ID, nil)
	return true
}

func (s *Server) Serve(ln net.Listener) error {
	for {
		netConn, err := ln.Accept()
		if err != nil {
			return err
		}
		go s.handleConn(netConn)
	}
}

type conn struct {
	netConn net.Conn

	writeMu sync.Mutex
	enc     *json.Encoder
}

func (c *conn) SendLine(serverID, line string) {
	c.writeFrame(ServerFrame{Type: FrameLine, ServerID: serverID, Line: line})
}

func (c *conn) SendEvent(serverID string, event any) {
	c.writeFrame(ServerFrame{Type: FrameEvent, ServerID: serverID, Event: event})
}

func (c *conn) SendStatus(serverID, status string) {
	c.writeFrame(ServerFrame{Type: FrameStatus, ServerID: serverID, Status: status})
}

func (c *conn) writeResult(id string, err error) {
	if err != nil {
		c.writeFrame(ServerFrame{ID: id, Type: FrameResult, OK: false, Error: err.Error()})
		return
	}
	c.writeFrame(ServerFrame{ID: id, Type: FrameResult, OK: true})
}

func (c *conn) writeFrame(f ServerFrame) {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if err := c.enc.Encode(f); err != nil {
		log.Printf("ipcproto: write error: %v", err)
	}
}

func (s *Server) handleConn(netConn net.Conn) {
	c := &conn{netConn: netConn, enc: json.NewEncoder(netConn)}
	var inFlight sync.WaitGroup
	defer func() {
		inFlight.Wait()
		s.b.Detach(c)
		netConn.Close()
	}()

	scanner := bufio.NewScanner(netConn)
	// Plain connections accepted for compatibility predate tokens and skip the check.
	_, legacy := netConn.(*legacyPlainConn)
	if s.token != "" && !legacy && !s.authenticate(c, scanner) {
		return
	}
	for scanner.Scan() {
		var f ClientFrame
		if err := json.Unmarshal(scanner.Bytes(), &f); err != nil {
			c.writeFrame(ServerFrame{Type: FrameResult, OK: false, Error: err.Error()})
			continue
		}
		inFlight.Add(1)
		go func(f ClientFrame) {
			defer inFlight.Done()
			s.handleFrame(c, f)
		}(f)
	}
	if err := scanner.Err(); err != nil {
		log.Printf("ipcproto: read error: %v", err)
	}
}

func (s *Server) handleFrame(c *conn, f ClientFrame) {
	switch f.Action {
	case ActionAuth:
		// Authentication happens before the frame loop starts. One arriving here
		// is from a client that sends its token to a connection that did not need
		// it (a legacy plain one, or a backend running with -token=false).
		c.writeResult(f.ID, nil)
	case ActionConnect:
		c.writeResult(f.ID, s.b.Connect(f.ServerID, f.Host, f.Port, f.Nick, f.Secure, f.SASLUser, f.SASLPass, f.Username, f.Realname, f.AltNicks, f.Password, c))
	case ActionDisconnect:
		c.writeResult(f.ID, s.b.Disconnect(f.ServerID))
	case ActionSend:
		c.writeResult(f.ID, s.b.Send(f.ServerID, f.Line))
	case ActionGetStatus:
		s.b.Attach(c, f.ServerID)
		c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: true, Status: s.b.Status(f.ServerID)})
	case ActionGetJoinedChannels:
		c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: true, Channels: s.b.JoinedChannels(f.ServerID)})
	case ActionGetHistory:
		entries, err := s.b.History(f.ServerID, f.Channel, f.Before, f.Limit)
		if err != nil {
			c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: false, Error: err.Error()})
			return
		}
		c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: true, Messages: entries})
	case ActionSearch:
		entries, err := s.b.Search(f.ServerID, f.Channel, f.Query, f.Limit)
		if err != nil {
			c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: false, Error: err.Error()})
			return
		}
		c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: true, Messages: entries})
	case ActionDCCOffer:
		id, err := s.b.DCCOffer(f.ServerID, f.Nick, f.PortMin, f.PortMax, c)
		if err != nil {
			c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: false, Error: err.Error()})
			return
		}
		c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: true, DCCID: id})
	case ActionDCCAccept:
		id, err := s.b.DCCAccept(f.Host, f.Port, c)
		if err != nil {
			c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: false, Error: err.Error()})
			return
		}
		c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: true, DCCID: id})
	case ActionDCCSend:
		c.writeResult(f.ID, s.b.DCCSend(f.DCCID, f.Line))
	case ActionDCCClose:
		c.writeResult(f.ID, s.b.DCCClose(f.DCCID))
	case ActionXDCCAccept:
		offer := ircparse.XDCCSendOfferEvent{
			Nick: f.Nick, Filename: f.Filename, IP: f.Host, Port: f.Port, Size: f.Size, Token: f.Token,
		}
		id, err := s.b.XDCCAccept(f.ServerID, offer, f.DestDir, f.PortMin, f.PortMax, c)
		if err != nil {
			c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: false, Error: err.Error()})
			return
		}
		c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: true, DCCID: id})
	case ActionXDCCClose:
		c.writeResult(f.ID, s.b.XDCCClose(f.DCCID))
	case ActionXDCCPause:
		c.writeResult(f.ID, s.b.XDCCPause(f.DCCID))
	case ActionXDCCResume:
		c.writeResult(f.ID, s.b.XDCCResume(f.DCCID))
	default:
		c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: false, Error: "unknown action: " + f.Action})
	}
}
