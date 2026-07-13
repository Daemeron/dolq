// Package ircclient manages one connection to one IRC network.
package ircclient

import (
	"bufio"
	"crypto/tls"
	"encoding/base64"
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

// DefaultSASLTimeout bounds how long the handshake waits for each step of
// SASL negotiation (capability ack, credential prompt, auth result) before
// giving up and registering unauthenticated - a server that doesn't
// understand CAP at all will just never reply, and this is what stops that
// from hanging the connection forever.
const DefaultSASLTimeout = 10 * time.Second

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

	// capLines carries CAP/AUTHENTICATE/SASL-numeric lines to the handshake
	// goroutine while it's negotiating SASL - see isCapOrAuthLine and
	// awaitCapLine. Buffered and non-blocking to send to (like every other
	// listener dispatch here): once negotiation is done nothing reads it
	// again, and a slow/absent reader must never stall the read loop.
	capLines chan string

	// Overridable before Start(); tests shrink these to avoid a slow test suite.
	PingTimeout       time.Duration
	PingCheckInterval time.Duration
	SASLTimeout       time.Duration

	// SASL PLAIN credentials. Both empty (the default) skips SASL entirely -
	// handshake() falls back to the plain PASS/NICK/USER sequence it always
	// used, no CAP negotiation at all.
	SASLUser string
	SASLPass string
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
		capLines:          make(chan string, 16),
		PingTimeout:       DefaultPingTimeout,
		PingCheckInterval: DefaultPingCheckInterval,
		SASLTimeout:       DefaultSASLTimeout,
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
	useSASL := c.SASLUser != "" && c.SASLPass != ""

	var lines []string
	if useSASL {
		// Tells the server we're CAP-aware, which holds registration open
		// until we send CAP END below - otherwise it could complete (and
		// start delivering messages) before SASL has even started.
		lines = append(lines, "CAP LS 302")
	}
	lines = append(lines, "PASS none", "NICK "+c.nick, "USER "+c.nick+" 0 * Dolq IRC Client")

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

	if useSASL {
		c.negotiateSASL()
	}
}

// negotiateSASL requests the sasl capability and, if granted, authenticates
// via SASL PLAIN before releasing registration with CAP END. Only called
// when SASL credentials are configured - handshake() already sent CAP LS to
// hold registration open for this. Any failure along the way (declined
// capability, rejected credentials, an unresponsive server) just logs and
// still sends CAP END, so registration completes unauthenticated rather
// than hanging the connection forever.
func (c *Client) negotiateSASL() {
	giveUp := func(reason string) {
		log.Printf("SASL: %s - continuing without it", reason)
		if err := c.Send("CAP END"); err != nil {
			log.Printf("SASL: CAP END: %v", err)
		}
	}

	if err := c.Send("CAP REQ :sasl"); err != nil {
		giveUp("request sasl capability: " + err.Error())
		return
	}
	// The CAP LS reply (triggered by handshake()'s "CAP LS 302") may arrive
	// first and isn't what we're waiting for - only the ACK/NAK subcommand
	// actually answers our REQ.
	ack, ok := c.awaitCapLine(func(l string) bool {
		sub := capSubcommand(l)
		return sub == "ACK" || sub == "NAK"
	})
	if !ok {
		giveUp("timed out waiting for the sasl capability request to be acked")
		return
	}
	if capSubcommand(ack) != "ACK" {
		giveUp("server declined the sasl capability")
		return
	}

	if err := c.Send("AUTHENTICATE PLAIN"); err != nil {
		giveUp("AUTHENTICATE PLAIN: " + err.Error())
		return
	}
	if _, ok := c.awaitCapLine(func(l string) bool { return capCommand(l) == "AUTHENTICATE" }); !ok {
		giveUp("timed out waiting for the server to request credentials")
		return
	}

	// PLAIN mechanism payload: authzid NUL authcid NUL passwd. authzid
	// (which identity to act as) is left empty - we're not impersonating
	// another account, just authenticating as authcid.
	payload := base64.StdEncoding.EncodeToString([]byte("\x00" + c.SASLUser + "\x00" + c.SASLPass))
	if err := c.Send("AUTHENTICATE " + payload); err != nil {
		giveUp("send credentials: " + err.Error())
		return
	}
	result, ok := c.awaitCapLine(func(l string) bool {
		cmd := capCommand(l)
		return cmd != "CAP" && cmd != "AUTHENTICATE" // one of the 90x SASL result numerics
	})
	switch {
	case !ok:
		log.Print("SASL: timed out waiting for an authentication result - continuing anyway")
	case capCommand(result) == "903":
		log.Print("SASL: authenticated")
	default:
		log.Printf("SASL: authentication failed (%s) - continuing without it", strings.TrimSpace(result))
	}
	if err := c.Send("CAP END"); err != nil {
		log.Printf("SASL: CAP END: %v", err)
	}
}

// awaitCapLine blocks for the next CAP/AUTHENTICATE/SASL-numeric line
// matching want (see isCapOrAuthLine), discarding any that don't, up to
// SASLTimeout or until the connection closes.
func (c *Client) awaitCapLine(want func(line string) bool) (string, bool) {
	timeout := time.NewTimer(c.SASLTimeout)
	defer timeout.Stop()
	for {
		select {
		case line := <-c.capLines:
			if want(line) {
				return line, true
			}
		case <-timeout.C:
			return "", false
		case <-c.closed:
			return "", false
		}
	}
}

// capFields splits an IRC line into space-separated fields, dropping a
// leading ":<prefix>" token if present.
func capFields(line string) []string {
	fields := strings.Fields(line)
	if len(fields) > 0 && strings.HasPrefix(fields[0], ":") {
		fields = fields[1:]
	}
	return fields
}

// capCommand returns an IRC line's command token - CAP, AUTHENTICATE, a
// numeric reply, whatever - after stripping any source prefix.
func capCommand(line string) string {
	fields := capFields(line)
	if len(fields) == 0 {
		return ""
	}
	return fields[0]
}

// capSubcommand returns the token after "CAP <target>" (ACK/NAK/LS/...), or
// "" if line isn't a CAP line.
func capSubcommand(line string) string {
	fields := capFields(line)
	if len(fields) < 3 || fields[0] != "CAP" {
		return ""
	}
	return fields[2]
}

// isCapOrAuthLine reports whether line is part of capability/SASL
// negotiation - CAP itself, AUTHENTICATE, or one of the SASL result
// numerics (900-907) - and so belongs on capLines rather than (only) the
// regular line/event listeners.
func isCapOrAuthLine(line string) bool {
	switch capCommand(line) {
	case "CAP", "AUTHENTICATE", "900", "901", "902", "903", "904", "905", "906", "907":
		return true
	}
	return false
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

	// Doesn't return/skip the normal dispatch below - CAP/AUTHENTICATE
	// traffic still shows up in the raw line feed same as everything else,
	// same as PING above. Only negotiateSASL's awaitCapLine ever reads this
	// channel, and only while SASL is actually being negotiated - the
	// non-blocking send is what keeps a slow/absent reader from stalling
	// the read loop the rest of the time.
	if isCapOrAuthLine(line) {
		select {
		case c.capLines <- line:
		default:
		}
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
