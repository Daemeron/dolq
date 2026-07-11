package ipcproto

import (
	"bufio"
	"encoding/json"
	"log"
	"net"
	"os"
	"sync"

	"github.com/Daemeron/dolq/backend/internal/bouncer"
)

// Listen removes any stale file at path (safe: only one live instance is
// ever expected to own a given socket path) and starts listening there.
func Listen(path string) (net.Listener, error) {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	return net.Listen("unix", path)
}

// Server accepts local IPC connections and dispatches their frames to a
// shared *bouncer.Bouncer.
type Server struct {
	b *bouncer.Bouncer
}

func NewServer(b *bouncer.Bouncer) *Server {
	return &Server{b: b}
}

// Serve accepts connections from ln, handling each on its own goroutine,
// until Accept starts failing (typically because ln was closed).
func (s *Server) Serve(ln net.Listener) error {
	for {
		netConn, err := ln.Accept()
		if err != nil {
			return err
		}
		go s.handleConn(netConn)
	}
}

// conn is one IPC connection; it implements bouncer.Subscriber so the
// bouncer can fan traffic out to it directly.
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
		// Wait for in-flight handlers (e.g. a slow Connect) rather than
		// detaching/closing out from under them - otherwise a handler that's
		// still dialing when the peer disconnects could finish afterward and
		// leave an orphaned session nothing will ever Detach from.
		inFlight.Wait()
		s.b.Detach(c) // stop fan-out; the underlying IRC sessions stay up
		netConn.Close()
	}()

	scanner := bufio.NewScanner(netConn)
	for scanner.Scan() {
		var f ClientFrame
		if err := json.Unmarshal(scanner.Bytes(), &f); err != nil {
			c.writeFrame(ServerFrame{Type: FrameResult, OK: false, Error: err.Error()})
			continue
		}
		// Each frame is handled on its own goroutine so a slow action (e.g.
		// Connect dialing an unreachable host) can't block other frames on
		// the same connection - including ones for a different serverId
		// that have nothing to do with it. Frame.ID exists precisely so
		// responses can come back out of order.
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
	case ActionConnect:
		c.writeResult(f.ID, s.b.Connect(f.ServerID, f.Host, f.Port, f.Nick, f.Secure, c))
	case ActionDisconnect:
		c.writeResult(f.ID, s.b.Disconnect(f.ServerID))
	case ActionSend:
		c.writeResult(f.ID, s.b.Send(f.ServerID, f.Line))
	case ActionGetStatus:
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
	default:
		c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: false, Error: "unknown action: " + f.Action})
	}
}
