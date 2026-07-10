// Package ircclient manages one connection to one IRC network.
package ircclient

import (
	"bufio"
	"crypto/tls"
	"errors"
	"log"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Daemeron/dolq/backend/internal/ircparse"
)

// Servers ping idle clients every minute or two; if nothing at all has been received
// in this long, the far end is presumably gone even though the socket never got a
// FIN/RST to tell us so (e.g. the network just vanished) - so the client checks for
// this itself rather than sitting "connected" forever.
const (
	DefaultPingTimeout       = 5 * time.Minute
	DefaultPingCheckInterval = 30 * time.Second
)

// NamesEvent is the synthesized event ircclient emits once a NAMES reply
// (RFC 353, possibly split across several lines) is complete (RFC 366).
type NamesEvent struct {
	Type    string          `json:"type"`
	Channel string          `json:"channel"`
	Users   []ircparse.User `json:"users"`
}

type Client struct {
	conn    net.Conn
	writeMu sync.Mutex

	mu             sync.Mutex
	nick           string
	joinedChannels map[string]struct{}
	namesBuffer    map[string][]ircparse.User
	lineListeners  []func(line string)
	eventListeners []func(event any)
	closeListeners []func()

	lastActivity atomic.Int64 // UnixNano, written by the read loop, read by the watchdog

	closed chan struct{}

	// Overridable before Start(); tests shrink these to avoid a slow test suite.
	PingTimeout       time.Duration
	PingCheckInterval time.Duration
}

// Dial opens a real connection to an IRC network. secure selects TLS.
func Dial(host string, port int, nick string, secure bool) (*Client, error) {
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	var conn net.Conn
	var err error
	if secure {
		conn, err = tls.Dial("tcp", addr, &tls.Config{ServerName: host})
	} else {
		conn, err = net.Dial("tcp", addr)
	}
	if err != nil {
		return nil, err
	}
	return newClient(conn, nick), nil
}

// New wraps an already-open connection - the test seam, driven over net.Pipe()
// instead of a real socket.
func New(conn net.Conn, nick string) *Client {
	return newClient(conn, nick)
}

func newClient(conn net.Conn, nick string) *Client {
	c := &Client{
		conn:              conn,
		nick:              nick,
		joinedChannels:    make(map[string]struct{}),
		namesBuffer:       make(map[string][]ircparse.User),
		closed:            make(chan struct{}),
		PingTimeout:       DefaultPingTimeout,
		PingCheckInterval: DefaultPingCheckInterval,
	}
	c.lastActivity.Store(time.Now().UnixNano())
	return c
}

// Start begins the handshake and the read/watchdog loops. It's separate from
// Dial/New so a caller can register listeners first - once Start runs, the
// read loop is a concurrent goroutine and could otherwise race a listener
// registered too late (unlike Node's single-threaded event loop, which the
// TS version this was ported from could rely on for that ordering).
func (c *Client) Start() {
	go c.readLoop()
	go c.watchPingTimeout()
	go c.handshake()
}

func (c *Client) handshake() {
	lines := []string{
		"PASS none",
		"NICK " + c.nick,
		"USER " + c.nick + " 0 * Dolq IRC Client",
	}
	// Unlike the TS version (which fires all three writes and separately
	// catches each rejection so Node doesn't warn about the ones Promise.all
	// didn't wait for), Go's Write is synchronous - so on error there's
	// nothing to gain by attempting the rest.
	for _, line := range lines {
		if err := c.Send(line); err != nil {
			log.Printf("IRC handshake error: %v", err)
			return
		}
	}
}

func (c *Client) watchPingTimeout() {
	ticker := time.NewTicker(c.PingCheckInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			last := time.Unix(0, c.lastActivity.Load())
			if time.Since(last) > c.PingTimeout {
				c.conn.Close()
				return
			}
		case <-c.closed:
			return
		}
	}
}

func (c *Client) readLoop() {
	scanner := bufio.NewScanner(c.conn)
	for scanner.Scan() {
		c.lastActivity.Store(time.Now().UnixNano())
		c.handleLine(scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		log.Printf("ircclient: read error: %v", err)
	}

	c.mu.Lock()
	closeListeners := c.closeListeners
	c.mu.Unlock()
	// Listeners run *before* c.closed closes, not after - Disconnect() (and
	// anything else awaiting c.closed) should only unblock once every
	// registered OnClose callback has actually run, the same guarantee
	// Node's synchronous EventEmitter gives the TS version this was ported
	// from (a 'close' listener registered earlier always finishes before a
	// later once('close', resolve) added inside disconnect() settles).
	for _, cb := range closeListeners {
		cb()
	}
	close(c.closed)
}

func (c *Client) handleLine(line string) {
	if strings.HasPrefix(line, "PING") {
		token := strings.TrimSpace(strings.TrimPrefix(line, "PING"))
		c.Send("PONG " + token)
	}

	c.mu.Lock()
	lineListeners := c.lineListeners
	c.mu.Unlock()
	for _, cb := range lineListeners {
		cb(line)
	}

	event := ircparse.ParseLine(line)
	if event == nil {
		return
	}

	switch e := event.(type) {
	case ircparse.NamesReplyEvent:
		c.mu.Lock()
		c.namesBuffer[e.Channel] = append(c.namesBuffer[e.Channel], e.Users...)
		c.mu.Unlock()
		return
	case ircparse.EndOfNamesEvent:
		c.mu.Lock()
		users := c.namesBuffer[e.Channel]
		delete(c.namesBuffer, e.Channel)
		c.mu.Unlock()
		if users == nil {
			users = []ircparse.User{}
		}
		c.emitEvent(NamesEvent{Type: "names", Channel: e.Channel, Users: users})
		return
	case ircparse.NickEvent:
		c.mu.Lock()
		if e.OldNick == c.nick {
			c.nick = e.NewNick
		}
		c.mu.Unlock()
	case ircparse.JoinEvent:
		if e.Nick == c.nick {
			c.mu.Lock()
			c.joinedChannels[e.Channel] = struct{}{}
			c.mu.Unlock()
		}
	case ircparse.PartEvent:
		if e.Nick == c.nick {
			c.mu.Lock()
			delete(c.joinedChannels, e.Channel)
			c.mu.Unlock()
		}
	case ircparse.KickEvent:
		if e.Nick == c.nick {
			c.mu.Lock()
			delete(c.joinedChannels, e.Channel)
			c.mu.Unlock()
		}
	}

	c.emitEvent(event)
}

// GetJoinedChannels lets a freshly (re)attached listener verify which
// channels this session is still actually in.
func (c *Client) GetJoinedChannels() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	channels := make([]string, 0, len(c.joinedChannels))
	for ch := range c.joinedChannels {
		channels = append(channels, ch)
	}
	return channels
}

func (c *Client) emitEvent(event any) {
	c.mu.Lock()
	listeners := c.eventListeners
	c.mu.Unlock()
	for _, cb := range listeners {
		cb(event)
	}
}

func (c *Client) AddLineListener(cb func(line string)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.lineListeners = append(c.lineListeners, cb)
}

func (c *Client) AddEventListener(cb func(event any)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.eventListeners = append(c.eventListeners, cb)
}

// OnClose registers cb to run once, when the connection closes. If the
// connection has already closed, cb runs immediately.
func (c *Client) OnClose(cb func()) {
	select {
	case <-c.closed:
		cb()
		return
	default:
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	select {
	case <-c.closed:
		cb()
	default:
		c.closeListeners = append(c.closeListeners, cb)
	}
}

// Send writes one IRC line, appending the trailing CRLF the wire protocol
// requires. A leading '/' (a UI affordance for typed commands) is stripped.
func (c *Client) Send(msg string) error {
	line := strings.TrimPrefix(msg, "/")
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_, err := c.conn.Write([]byte(line + "\r\n"))
	return err
}

// Disconnect PARTs every joined channel, sends QUIT, then closes the
// connection and waits for the read loop to actually finish.
func (c *Client) Disconnect() error {
	var errs []error
	for _, ch := range c.GetJoinedChannels() {
		if err := c.Send("PART " + ch); err != nil {
			errs = append(errs, err)
		}
	}
	if err := c.Send("QUIT"); err != nil {
		errs = append(errs, err)
	}
	c.conn.Close()
	<-c.closed
	return errors.Join(errs...)
}
