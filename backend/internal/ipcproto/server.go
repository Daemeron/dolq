package ipcproto

import (
	"bufio"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Daemeron/dolq/backend/internal/bouncer"
	"github.com/Daemeron/dolq/backend/internal/disk"
	"github.com/Daemeron/dolq/backend/internal/ircparse"
)

func Listen(network, address string) (net.Listener, error) {
	if network == "pipe" {
		return listenPipe(address)
	}
	if network != "unix" {
		return net.Listen(network, address)
	}
	// Clear out a stale socket from an earlier run, but nothing else: -socket
	// pointed at a regular file must not delete it.
	if info, err := os.Lstat(address); err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return nil, fmt.Errorf("%s exists and is not a socket", address)
		}
		if err := os.Remove(address); err != nil {
			return nil, err
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	// Bound under an owner-only umask, so the socket is never reachable by
	// other local users, not even between bind and the chmod below.
	var ln net.Listener
	err := withPrivateUmask(func() (err error) {
		ln, err = net.Listen(network, address)
		return err
	})
	if err != nil {
		return nil, err
	}
	// Belt and braces where there is no umask (Windows).
	if err := os.Chmod(address, 0o600); err != nil {
		ln.Close()
		return nil, err
	}
	return ln, nil
}

type Server struct {
	b     *bouncer.Bouncer
	token string
	// downloadDir, when set, is where every XDCC download goes, whatever
	// directory the client asks for.
	downloadDir string
	// authTimeout bounds how long a fresh connection may take to present its token.
	authTimeout time.Duration
	// writeTimeout bounds each frame written to a client; see conn.writeFrame.
	writeTimeout time.Duration

	// What getInfo reports about this process.
	version   string
	startedAt time.Time
	folders   []Folder
	clients   atomic.Int32

	// The room the folders have left is read in the background, never while a client waits: a folder on a network
	// share can stall, and getInfo doubles as the app's heartbeat, which would then take the link for dead.
	freeSpace     func(dir string) (free, total uint64, err error)
	roomFirstWait time.Duration
	roomMu        sync.Mutex
	room          []FolderInfo
	roomAt        time.Time
	roomBusy      bool
}

// roomMaxAge is how old a reading of the folders may get before a new one is started.
const roomMaxAge = 30 * time.Second

// Folder is a folder the backend writes to, named for the client that monitors it.
type Folder struct{ Name, Path string }

const (
	defaultAuthTimeout  = 10 * time.Second
	defaultWriteTimeout = 10 * time.Second
)

func NewServer(b *bouncer.Bouncer) *Server {
	return &Server{
		b: b, authTimeout: defaultAuthTimeout, writeTimeout: defaultWriteTimeout, startedAt: time.Now(),
		freeSpace: disk.Free, roomFirstWait: time.Second,
	}
}

// About sets what getInfo says: the release this is, and the folders whose free space it reports.
func (s *Server) About(version string, folders ...Folder) *Server {
	s.version, s.folders = version, folders
	return s
}

func (s *Server) info() *Info {
	info := &Info{Version: s.version, UptimeMs: time.Since(s.startedAt).Milliseconds(), Clients: int(s.clients.Load()), Folders: s.folderRoom()}
	if s.b != nil {
		info.Sessions, info.Transfers = s.b.Stats()
	}
	return info
}

// folderRoom answers with the last reading of the folders and, when it is old, starts a new one in the background.
// Only the very first call waits for a reading, and only briefly, so it has something to show. A folder that stalls
// leaves the answer without that reading, and does not hold the answer back.
func (s *Server) folderRoom() []FolderInfo {
	s.roomMu.Lock()
	if !s.roomBusy && time.Since(s.roomAt) > roomMaxAge {
		s.roomBusy = true
		done := make(chan struct{})
		go func() {
			read := make([]FolderInfo, 0, len(s.folders))
			for _, f := range s.folders {
				fi := FolderInfo{Name: f.Name, Path: f.Path}
				if free, total, err := s.freeSpace(f.Path); err != nil {
					fi.Error = err.Error()
				} else {
					fi.Free, fi.Total = free, total
				}
				read = append(read, fi)
			}
			s.roomMu.Lock()
			s.room, s.roomAt, s.roomBusy = read, time.Now(), false
			s.roomMu.Unlock()
			close(done)
		}()
		if s.roomAt.IsZero() {
			s.roomMu.Unlock()
			select {
			case <-done:
			case <-time.After(s.roomFirstWait):
			}
			s.roomMu.Lock()
		}
	}
	out := append([]FolderInfo{}, s.room...)
	s.roomMu.Unlock()
	return out
}

// RequireToken makes every connection open with an auth frame carrying token
// before any other action is honored. An empty token turns the check off.
func (s *Server) RequireToken(token string) *Server {
	s.token = token
	return s
}

// DownloadDir pins XDCC downloads to dir, ignoring the client-supplied
// destination. For a network listener, where a remote client must not choose
// where on this machine files are written. Empty keeps the client's choice
// (a locally spawned backend, which saves to the app's own download folder).
func (s *Server) DownloadDir(dir string) *Server {
	s.downloadDir = dir
	return s
}

func (s *Server) destDir(requested string) string {
	if s.downloadDir != "" {
		return s.downloadDir
	}
	return requested
}

// authenticate reads the connection's first frame and reports whether it is a
// valid auth frame. The reply is written either way; the caller closes the
// connection when it returns false.
func (s *Server) authenticate(c *conn, scanner *bufio.Scanner) bool {
	c.netConn.SetReadDeadline(time.Now().Add(s.authTimeout))
	defer c.netConn.SetReadDeadline(time.Time{})

	// Nothing arrived (a health probe, a port scan, a stalled client): just hang up.
	if !scanner.Scan() {
		log.Printf("client %s: closed without authenticating (a probe, or a client that gave up)", c.remote)
		return false
	}
	var f ClientFrame
	if json.Unmarshal(scanner.Bytes(), &f) != nil || f.Action != ActionAuth ||
		subtle.ConstantTimeCompare([]byte(f.AuthToken), []byte(s.token)) != 1 {
		log.Printf("client %s: rejected, the access token is missing or wrong", c.remote)
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
	// remote is who is on the other end, for the log: an address, or "local" for the app's own socket.
	remote       string
	writeTimeout time.Duration

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

// writeFrame gives up on a client that stops reading after writeTimeout and
// hangs up on it: lines and events are written to every attached client from
// the IRC session's read loop, so one stuck client would stall the session for all.
func (c *conn) writeFrame(f ServerFrame) {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	c.netConn.SetWriteDeadline(time.Now().Add(c.writeTimeout))
	if err := c.enc.Encode(f); err != nil {
		log.Printf("ipcproto: write error: %v", err)
		// A frame cut off midway leaves the stream unreadable anyway.
		c.netConn.Close()
	}
}

func (s *Server) handleConn(netConn net.Conn) {
	c := &conn{netConn: netConn, remote: remoteName(netConn), writeTimeout: s.writeTimeout, enc: json.NewEncoder(netConn)}
	log.Printf("client %s: connected", c.remote)
	defer log.Printf("client %s: disconnected", c.remote)
	var inFlight sync.WaitGroup
	lanes := map[string]chan ClientFrame{}
	defer func() {
		for _, lane := range lanes {
			close(lane)
		}
		inFlight.Wait()
		s.b.Detach(c)
		netConn.Close()
	}()

	scanner := bufio.NewScanner(netConn)
	// Plain connections accepted for compatibility predate tokens and skip the check.
	_, legacy := netConn.(*legacyPlainConn)
	if s.token != "" && !legacy {
		if !s.authenticate(c, scanner) {
			return
		}
		log.Printf("client %s: authenticated", c.remote)
	} else if legacy {
		log.Printf("client %s: plain connection without an access token (legacy)", c.remote)
	}
	s.clients.Add(1)
	defer s.clients.Add(-1)
	for scanner.Scan() {
		var f ClientFrame
		if err := json.Unmarshal(scanner.Bytes(), &f); err != nil {
			c.writeFrame(ServerFrame{Type: FrameResult, OK: false, Error: err.Error()})
			continue
		}
		if f.Action == ActionSend {
			// Lines to one server must reach it in the order they were typed.
			lane := lanes[f.ServerID]
			if lane == nil {
				lane = make(chan ClientFrame, 256)
				lanes[f.ServerID] = lane
				inFlight.Add(1)
				go func() {
					defer inFlight.Done()
					for f := range lane {
						s.handleFrame(c, f)
					}
				}()
			}
			lane <- f
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
	case ActionDCCSendFile:
		id, err := s.b.DCCSendFile(f.ServerID, f.Nick, f.Path, f.PortMin, f.PortMax, c)
		if err != nil {
			c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: false, Error: err.Error()})
			return
		}
		c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: true, DCCID: id})
	case ActionDCCClose:
		c.writeResult(f.ID, s.b.DCCClose(f.DCCID))
	case ActionXDCCAccept:
		offer := ircparse.XDCCSendOfferEvent{
			Nick: f.Nick, Filename: f.Filename, IP: f.Host, Port: f.Port, Size: f.Size, Token: f.Token,
		}
		id, err := s.b.XDCCAccept(f.ServerID, offer, s.destDir(f.DestDir), f.PortMin, f.PortMax, c)
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
	case ActionGetTransfers:
		transfers, err := s.b.Transfers()
		if err != nil {
			c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: false, Error: err.Error()})
			return
		}
		c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: true, Transfers: transfers})
	case ActionDeleteTransfer:
		c.writeResult(f.ID, s.b.DeleteTransfer(f.DCCID))
	case ActionGetInfo:
		c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: true, Info: s.info()})
	default:
		c.writeFrame(ServerFrame{ID: f.ID, Type: FrameResult, OK: false, Error: "unknown action: " + f.Action})
	}
}

// remoteName is how the other end of a connection appears in the log.
func remoteName(c net.Conn) string {
	if a := c.RemoteAddr(); a != nil && a.Network() != "unix" && a.String() != "" {
		return a.String()
	}
	return "local"
}
