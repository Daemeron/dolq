// Package ircclient manages one connection to one IRC network.
package ircclient

import (
	"bufio"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"log"
	"net"
	"slices"
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

// DefaultCapTimeout bounds how long the handshake waits for each step of CAP
// negotiation (the LS reply, a REQ ack, SASL's credential prompt and auth
// result) before giving up and registering as if CAP was never sent - a
// server that doesn't understand CAP at all will just never reply, and this
// is what stops that from hanging the connection forever.
const DefaultCapTimeout = 10 * time.Second

// maxNickCollisionRetries bounds automatic alternate-nick retries during
// initial registration (before RPL_WELCOME) - see handleNickInUse. A server
// that just always says "in use" would otherwise retry forever; past this
// it gives up and stays unregistered, the same give-up-and-move-on shape
// CAP/SASL negotiation already has for a server that never answers at all.
const maxNickCollisionRetries = 5

// DefaultFloodBurst and DefaultFloodInterval bound outgoing user-originated
// traffic (see SendPaced) to a burst of DefaultFloodBurst lines, then one
// more every DefaultFloodInterval - generic pacing that clears most
// servers' own flood protection without a paste storm getting the
// connection killed, without needing per-network tuning. Overridable before
// Start() the same way PingTimeout/CapTimeout are.
const (
	DefaultFloodBurst    = 4
	DefaultFloodInterval = 2 * time.Second
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
	registered     bool // true once RPL_WELCOME (001) confirms nick, see handleNickInUse
	nickCollisions int  // count of automatic alternate-nick retries so far, capped by maxNickCollisionRetries
	joinedChannels map[string]struct{}
	namesBuffer    map[string][]ircparse.User
	whoisBuffer    map[string]ircparse.WhoisEvent // accumulated per nick until RPL_ENDOFWHOIS - see handleLine
	lineListeners  []func(line string)
	eventListeners []func(event any)
	closeListeners []func()

	lastActivity atomic.Int64 // UnixNano, written by the read loop, read by the watchdog

	closed chan struct{}

	// capLines carries CAP/AUTHENTICATE/SASL-numeric lines to the handshake
	// goroutine while it's negotiating capabilities - see isCapOrAuthLine and
	// awaitCapLine. Buffered and non-blocking to send to (like every other
	// listener dispatch here): once negotiation is done nothing reads it
	// again, and a slow/absent reader must never stall the read loop.
	capLines chan string

	// Overridable before Start(); tests shrink these to avoid a slow test suite.
	PingTimeout       time.Duration
	PingCheckInterval time.Duration
	CapTimeout        time.Duration

	// Overridable before the first SendPaced call - unlike the timeouts
	// above, flood pacing has no Start()-time goroutine to seed, it lazily
	// self-initializes on first use (see floodLimiter.wait), so there's no
	// deadline for overriding these beyond "before anything gets sent".
	FloodBurst    int
	FloodInterval time.Duration

	// SASL PLAIN credentials. Both empty (the default) just means the "sasl"
	// capability never makes it into negotiateCaps' REQ - every other
	// capability this client wants is still requested the same either way.
	SASLUser string
	SASLPass string

	// Identity overrides for the USER line - both empty (the default) means
	// "USER <nick> 0 * :Dolq IRC Client", same as before these existed.
	Username string
	Realname string

	// AltNicks are tried in order, before handleNickInUse falls back to
	// appending underscores, each time the currently-requested nick turns
	// out to be taken during registration (see handleNickInUse) - a
	// configured fallback beats a mangled one.
	AltNicks []string

	// flood paces SendPaced - a plain zero-value field (not a pointer set up
	// in Start()) specifically so it's safe to use immediately after
	// construction, before Start() has run. That matters: bouncer's
	// reconnect swaps a session's client (and flips its status to
	// "connected", inviting a Send) before calling the new client's Start(),
	// so a pointer initialized there could still be nil when a concurrent
	// SendPaced call reaches it.
	flood floodLimiter
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
		whoisBuffer:       make(map[string]ircparse.WhoisEvent),
		closed:            make(chan struct{}),
		capLines:          make(chan string, 16),
		PingTimeout:       DefaultPingTimeout,
		PingCheckInterval: DefaultPingCheckInterval,
		CapTimeout:        DefaultCapTimeout,
		FloodBurst:        DefaultFloodBurst,
		FloodInterval:     DefaultFloodInterval,
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
	username := c.Username
	if username == "" {
		username = c.nick
	}
	realname := c.Realname
	if realname == "" {
		realname = "Dolq IRC Client"
	}

	// Sent unconditionally, not just when SASL is configured: this is also
	// how the client finds out whether the server supports multi-prefix/
	// away-notify/server-time (see negotiateCaps) - it holds registration
	// open until CAP END below, so a server that understands CAP won't
	// complete (and start delivering messages) before that.
	//
	// realname gets a leading ':' (unlike before Username/Realname were
	// configurable) so it can actually contain spaces - a bare multi-word
	// trailing param is something most servers tolerate leniently, but
	// isn't correct, and a user-supplied realname is more likely to have
	// spaces than the old hardcoded "Dolq IRC Client" ever needed to worry
	// about.
	lines := []string{"CAP LS 302", "PASS none", "NICK " + c.nick, "USER " + username + " 0 * :" + realname}

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

	c.negotiateCaps()
}

// baselineCaps are requested whenever the server advertises them - no opt-in
// needed, unlike sasl: multi-prefix fixes NAMES/MODE only ever being able to
// track a user's single highest channel privilege (see ircparse.User),
// away-notify and server-time both just work once ACKed (an AWAY line flows
// through unparsed same as any other command this client doesn't act on;
// server-time's per-message tags are stripped before parsing - see
// stripMessageTags).
var baselineCaps = []string{"multi-prefix", "away-notify", "server-time"}

// negotiateCaps runs the CAP LS/REQ exchange and always ends it with CAP
// END, holding registration open until it does. baselineCaps and (if
// configured) sasl are requested as two independent REQs rather than one
// combined list - ACK/NAK answers a REQ atomically, so bundling them would
// let a server that merely declines sasl take the rest down with it. A
// server that doesn't understand CAP at all just never replies to CAP LS,
// so every wait here is bounded by CapTimeout and falls through to
// registering exactly as if CAP was never sent.
func (c *Client) negotiateCaps() {
	var offered []string
	for {
		line, ok := c.awaitCapLine(func(l string) bool { return capSubcommand(l) == "LS" })
		if !ok {
			log.Print("CAP: timed out waiting for the server's capability list - continuing without any")
			c.endCapNegotiation()
			return
		}
		offered = append(offered, parseCapList(line)...)
		if !capLSContinues(line) {
			break
		}
	}

	c.requestCaps(offered, baselineCaps)

	if c.SASLUser != "" && c.SASLPass != "" && slices.Contains(offered, "sasl") {
		c.negotiateSASL()
	}
	c.endCapNegotiation()
}

// requestCaps REQs whichever of want the server actually offered (a no-op
// if none were), logging - not aborting the wider negotiation - if the
// server NAKs or never answers.
func (c *Client) requestCaps(offered, want []string) {
	var req []string
	for _, w := range want {
		if slices.Contains(offered, w) {
			req = append(req, w)
		}
	}
	if len(req) == 0 {
		return
	}
	if err := c.Send("CAP REQ :" + strings.Join(req, " ")); err != nil {
		log.Printf("CAP: request %v: %v", req, err)
		return
	}
	ack, ok := c.awaitCapLine(func(l string) bool {
		sub := capSubcommand(l)
		return sub == "ACK" || sub == "NAK"
	})
	switch {
	case !ok:
		log.Printf("CAP: timed out waiting for %v to be acked", req)
	case capSubcommand(ack) != "ACK":
		log.Printf("CAP: server declined %v", req)
	}
}

// negotiateSASL requests the sasl capability and, if granted, authenticates
// via SASL PLAIN. Only called when SASL credentials are configured and the
// server actually offered sasl (negotiateCaps checks both). Any failure
// along the way (declined capability, rejected credentials, an unresponsive
// server) just logs and returns - the caller sends CAP END either way, so
// registration completes unauthenticated rather than hanging forever.
func (c *Client) negotiateSASL() {
	if err := c.Send("CAP REQ :sasl"); err != nil {
		log.Printf("SASL: request sasl capability: %v - continuing without it", err)
		return
	}
	ack, ok := c.awaitCapLine(func(l string) bool {
		sub := capSubcommand(l)
		return sub == "ACK" || sub == "NAK"
	})
	if !ok {
		log.Print("SASL: timed out waiting for the sasl capability request to be acked - continuing without it")
		return
	}
	if capSubcommand(ack) != "ACK" {
		log.Print("SASL: server declined the sasl capability - continuing without it")
		return
	}

	if err := c.Send("AUTHENTICATE PLAIN"); err != nil {
		log.Printf("SASL: AUTHENTICATE PLAIN: %v - continuing without it", err)
		return
	}
	if _, ok := c.awaitCapLine(func(l string) bool { return capCommand(l) == "AUTHENTICATE" }); !ok {
		log.Print("SASL: timed out waiting for the server to request credentials - continuing without it")
		return
	}

	// PLAIN mechanism payload: authzid NUL authcid NUL passwd. authzid
	// (which identity to act as) is left empty - we're not impersonating
	// another account, just authenticating as authcid.
	payload := base64.StdEncoding.EncodeToString([]byte("\x00" + c.SASLUser + "\x00" + c.SASLPass))
	if err := c.Send("AUTHENTICATE " + payload); err != nil {
		log.Printf("SASL: send credentials: %v - continuing without it", err)
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
}

// endCapNegotiation releases registration - a server holding it open for CAP
// negotiation (or SASL within it) won't complete registration until this is
// sent.
func (c *Client) endCapNegotiation() {
	if err := c.Send("CAP END"); err != nil {
		log.Printf("CAP: CAP END: %v", err)
	}
}

// awaitCapLine blocks for the next CAP/AUTHENTICATE/SASL-numeric line
// matching want (see isCapOrAuthLine), discarding any that don't, up to
// CapTimeout or until the connection closes.
func (c *Client) awaitCapLine(want func(line string) bool) (string, bool) {
	timeout := time.NewTimer(c.CapTimeout)
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

// capLSContinues reports whether an LS reply line is a "more to come"
// continuation of a multi-line LS 302 response - the RFC marks that with a
// literal "*" parameter right after LS, before the capability list itself:
// `CAP <target> LS * :cap1 cap2` continues, `CAP <target> LS :cap1 cap2` is
// the last (or only) line.
func capLSContinues(line string) bool {
	fields := capFields(line)
	return len(fields) > 3 && fields[3] == "*"
}

// parseCapList extracts capability names from an LS/ACK/NAK line's trailing
// parameter, dropping any "=values" a capability advertises (LS 302 can send
// e.g. "sasl=PLAIN,EXTERNAL" - this client only ever checks for the bare
// name) and the "*" continuation marker capLSContinues already looks at.
func parseCapList(line string) []string {
	fields := capFields(line)
	if len(fields) < 4 {
		return nil
	}
	fields = fields[3:]
	if fields[0] == "*" {
		fields = fields[1:]
	}
	caps := make([]string, 0, len(fields))
	for _, f := range fields {
		f = strings.TrimPrefix(f, ":")
		if f == "" {
			continue
		}
		name, _, _ := strings.Cut(f, "=")
		caps = append(caps, name)
	}
	return caps
}

// stripMessageTags removes a leading IRCv3 message-tag block (`@key=val;...
// `) if present - the wire effect of the server-time capability (and
// whatever else the server decides to tag once any tag-bearing capability
// is on), which this client requests but doesn't otherwise act on: values
// aren't parsed out, just dropped, so every command line underneath keeps
// parsing exactly as it did before tags existed.
func stripMessageTags(line string) string {
	if !strings.HasPrefix(line, "@") {
		return line
	}
	_, rest, _ := strings.Cut(line, " ")
	return rest
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
	// Once server-time is negotiated (see negotiateCaps), every line arrives
	// prefixed with an IRCv3 message-tag block (`@time=... :nick!... PRIVMSG
	// ...`) that none of the protocol logic below - or ircparse's regexes -
	// know anything about. Stripped here, once, rather than threading tag
	// awareness through every PING/CAP/ParseLine check: line (tags and all)
	// still goes to lineListeners below, so raw history/log stays verbatim.
	untagged := stripMessageTags(line)

	if strings.HasPrefix(untagged, "PING") {
		token := strings.TrimSpace(strings.TrimPrefix(untagged, "PING"))
		c.Send("PONG " + token)
	}

	// Doesn't return/skip the normal dispatch below - CAP/AUTHENTICATE
	// traffic still shows up in the raw line feed same as everything else,
	// same as PING above. Only negotiateCaps/negotiateSASL's awaitCapLine
	// ever reads this channel, and only while negotiation is actually
	// running - the non-blocking send is what keeps a slow/absent reader
	// from stalling the read loop the rest of the time.
	if isCapOrAuthLine(untagged) {
		select {
		case c.capLines <- untagged:
		default:
		}
	}

	c.mu.Lock()
	lineListeners := c.lineListeners
	c.mu.Unlock()
	for _, cb := range lineListeners {
		cb(line)
	}

	event := ircparse.ParseLine(untagged)
	if event == nil {
		return
	}

	switch e := event.(type) {
	case ircparse.CTCPRequestEvent:
		c.handleCTCPRequest(e)
		return
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
	case ircparse.WhoisUserEvent:
		c.updateWhois(e.Nick, func(w *ircparse.WhoisEvent) { w.User, w.Host, w.Realname = e.User, e.Host, e.Realname })
		return
	case ircparse.WhoisServerEvent:
		c.updateWhois(e.Nick, func(w *ircparse.WhoisEvent) { w.Server, w.ServerInfo = e.Server, e.Info })
		return
	case ircparse.WhoisIdleEvent:
		c.updateWhois(e.Nick, func(w *ircparse.WhoisEvent) { w.IdleSeconds, w.SignonTime = e.IdleSeconds, e.SignonTime })
		return
	case ircparse.WhoisChannelsEvent:
		c.updateWhois(e.Nick, func(w *ircparse.WhoisEvent) { w.Channels = e.Channels })
		return
	case ircparse.WhoisAccountEvent:
		c.updateWhois(e.Nick, func(w *ircparse.WhoisEvent) { w.Account = e.Account })
		return
	case ircparse.WhoisAwayEvent:
		c.updateWhois(e.Nick, func(w *ircparse.WhoisEvent) { w.Away = e.Message })
		return
	case ircparse.ErrNoSuchNickEvent:
		c.updateWhois(e.Nick, func(w *ircparse.WhoisEvent) { w.NoSuchNick = true })
		return
	case ircparse.EndOfWhoisEvent:
		c.mu.Lock()
		w, ok := c.whoisBuffer[e.Nick]
		delete(c.whoisBuffer, e.Nick)
		c.mu.Unlock()
		if !ok {
			w.Nick = e.Nick
		}
		w.Type = "whois"
		c.emitEvent(w)
		return
	case ircparse.WelcomeEvent:
		c.mu.Lock()
		c.nick = e.Nick
		c.registered = true
		c.mu.Unlock()
	case ircparse.NickInUseEvent:
		retrying := c.handleNickInUse(e.Nick)
		c.emitEvent(ircparse.NickInUseEvent{Type: "NICKINUSE", Nick: e.Nick, Retrying: retrying})
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

// clientVersion answers a CTCP VERSION request - just an identifying
// string, nothing else reads it.
const clientVersion = "Dolq IRC Client"

// handleCTCPRequest answers the two CTCP requests worth auto-replying to
// (VERSION, PING) over CTCP's own reply channel - a NOTICE back to the
// requester, wrapped the same way the request was. Anything else (ACTION
// never reaches here - see ircparse's PRIVMSG/CTCP rule) is silently
// ignored, same as a client that's never heard of it.
func (c *Client) handleCTCPRequest(e ircparse.CTCPRequestEvent) {
	switch e.Command {
	case "VERSION":
		c.sendCTCPReply(e.Nick, "VERSION "+clientVersion)
	case "PING":
		c.sendCTCPReply(e.Nick, "PING "+e.Param)
	}
}

func (c *Client) sendCTCPReply(nick, payload string) {
	if err := c.Send("NOTICE " + nick + " :\x01" + payload + "\x01"); err != nil {
		log.Printf("ircclient: CTCP reply to %s: %v", nick, err)
	}
}

// updateWhois mutates the in-progress WhoisEvent buffered for nick via fn,
// starting a fresh one if this is the first reply seen for it - the shared
// lock/read-modify-write every WHOIS numeric case above needs.
func (c *Client) updateWhois(nick string, fn func(w *ircparse.WhoisEvent)) {
	c.mu.Lock()
	w := c.whoisBuffer[nick]
	w.Nick = nick
	fn(&w)
	c.whoisBuffer[nick] = w
	c.mu.Unlock()
}

// handleNickInUse reacts to ERR_NICKNAMEINUSE (433). While still registering
// (no RPL_WELCOME yet) it retries through AltNicks in order first - a
// configured fallback beats a mangled one - then falls back to nick plus
// one more underscore per attempt, up to max(maxNickCollisionRetries,
// len(AltNicks)) so a longer configured list always gets a full chance, and
// returns the nick it retried with. Once already registered - a live /nick
// attempt getting rejected - or once retries are exhausted, it does nothing
// and returns "": neither case should silently land the connection on a
// nick nobody asked for.
func (c *Client) handleNickInUse(nick string) string {
	c.mu.Lock()
	var retry string
	limit := max(maxNickCollisionRetries, len(c.AltNicks))
	if !c.registered && c.nickCollisions < limit {
		if c.nickCollisions < len(c.AltNicks) {
			retry = c.AltNicks[c.nickCollisions]
		} else {
			retry = nick + strings.Repeat("_", c.nickCollisions-len(c.AltNicks)+1)
		}
		c.nickCollisions++
		c.nick = retry
	}
	c.mu.Unlock()

	if retry == "" {
		return ""
	}
	if err := c.Send("NICK " + retry); err != nil {
		log.Printf("ircclient: retry NICK %s: %v", retry, err)
	}
	return retry
}

// Closed reports whether the connection has already ended - i.e. whether
// OnClose's registered callbacks have already run (or would run immediately
// if registered now). Lets a caller holding onto a possibly-stale Client
// (bouncer, after an unexpected drop) tell whether it's still worth trying
// to use before doing so.
func (c *Client) Closed() bool {
	select {
	case <-c.closed:
		return true
	default:
		return false
	}
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

// SendPaced is like Send, but paced by the outgoing flood limiter (see
// floodLimiter) - it blocks until a token is available or the connection
// closes first, whichever comes first. Only for user-originated traffic
// (bouncer.Send is the only caller): internal protocol lines - the
// handshake, PONG replies, CTCP replies, Disconnect's PART/QUIT - go
// through Send directly and are never delayed by this, since none of them
// are the paste-storm/rapid-command-spam case this guards against, and PONG
// in particular is time-sensitive enough that delaying it could self-
// inflict a ping timeout.
func (c *Client) SendPaced(msg string) error {
	if !c.flood.wait(c.FloodBurst, c.FloodInterval, c.closed) {
		return errors.New("ircclient: connection closed while waiting to send")
	}
	return c.Send(msg)
}

// floodLimiter is a token bucket sized in whole lines: burst tokens are
// available immediately, then one more every interval - refilled lazily
// (computed from elapsed wall-clock time on each call, not a background
// goroutine), so a zero-value floodLimiter is immediately usable with no
// setup step and nothing to leak or stop on disconnect.
type floodLimiter struct {
	mu       sync.Mutex
	init     bool
	tokens   int
	burst    int
	interval time.Duration
	next     time.Time // when the next token becomes available
}

// wait blocks (waking up in interval-sized steps, checking done each time)
// until a token is available, spends it, and returns true - or returns
// false if done fires first. burst/interval are only read on the very first
// call, which is what makes it safe to keep overriding Client.FloodBurst/
// FloodInterval right up until that point, same as the other Client
// timeouts that are only consulted once their owning goroutine starts.
func (fl *floodLimiter) wait(burst int, interval time.Duration, done <-chan struct{}) bool {
	for {
		fl.mu.Lock()
		if !fl.init {
			fl.tokens, fl.burst, fl.interval = burst, burst, interval
			fl.next = time.Now().Add(interval)
			fl.init = true
		}
		now := time.Now()
		if fl.tokens < fl.burst && !now.Before(fl.next) {
			gained := int(now.Sub(fl.next)/fl.interval) + 1
			fl.tokens = min(fl.burst, fl.tokens+gained)
			fl.next = fl.next.Add(time.Duration(gained) * fl.interval)
		}
		if fl.tokens > 0 {
			fl.tokens--
			fl.mu.Unlock()
			return true
		}
		sleep := fl.next.Sub(now)
		fl.mu.Unlock()

		select {
		case <-time.After(sleep):
		case <-done:
			return false
		}
	}
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
