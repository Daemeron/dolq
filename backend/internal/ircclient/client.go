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

	"github.com/Daemeron/dolq/backend/internal/dcc"
	"github.com/Daemeron/dolq/backend/internal/ircparse"
	"github.com/Daemeron/dolq/backend/internal/xdcc"
)

const (
	DefaultPingTimeout       = 5 * time.Minute
	DefaultPingCheckInterval = 30 * time.Second
)

const DefaultCapTimeout = 10 * time.Second

const maxNickCollisionRetries = 5

const (
	DefaultFloodBurst    = 4
	DefaultFloodInterval = 2 * time.Second
)

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
	registered     bool
	nickCollisions int
	joinedChannels map[string]struct{}
	namesBuffer    map[string][]ircparse.User
	whoisBuffer    map[string]ircparse.WhoisEvent
	lineListeners  []func(line string)
	eventListeners []func(event any)
	closeListeners []func()

	lastActivity atomic.Int64

	closed chan struct{}

	capLines chan string

	PingTimeout       time.Duration
	PingCheckInterval time.Duration
	CapTimeout        time.Duration

	FloodBurst    int
	FloodInterval time.Duration

	SASLUser string
	SASLPass string

	Username string
	Realname string

	AltNicks []string

	flood floodLimiter
}

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

	lines := []string{"CAP LS 302", "PASS none", "NICK " + c.nick, "USER " + username + " 0 * :" + realname}

	for _, line := range lines {
		if err := c.Send(line); err != nil {
			log.Printf("IRC handshake error: %v", err)
			return
		}
	}

	c.negotiateCaps()
}

var baselineCaps = []string{"multi-prefix", "away-notify", "server-time"}

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

	payload := base64.StdEncoding.EncodeToString([]byte("\x00" + c.SASLUser + "\x00" + c.SASLPass))
	if err := c.Send("AUTHENTICATE " + payload); err != nil {
		log.Printf("SASL: send credentials: %v - continuing without it", err)
		return
	}
	result, ok := c.awaitCapLine(func(l string) bool {
		cmd := capCommand(l)
		return cmd != "CAP" && cmd != "AUTHENTICATE"
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

func (c *Client) endCapNegotiation() {
	if err := c.Send("CAP END"); err != nil {
		log.Printf("CAP: CAP END: %v", err)
	}
}

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

func capFields(line string) []string {
	fields := strings.Fields(line)
	if len(fields) > 0 && strings.HasPrefix(fields[0], ":") {
		fields = fields[1:]
	}
	return fields
}

func capCommand(line string) string {
	fields := capFields(line)
	if len(fields) == 0 {
		return ""
	}
	return fields[0]
}

func capSubcommand(line string) string {
	fields := capFields(line)
	if len(fields) < 3 || fields[0] != "CAP" {
		return ""
	}
	return fields[2]
}

func capLSContinues(line string) bool {
	fields := capFields(line)
	return len(fields) > 3 && fields[3] == "*"
}

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

func stripMessageTags(line string) string {
	if !strings.HasPrefix(line, "@") {
		return line
	}
	_, rest, _ := strings.Cut(line, " ")
	return rest
}

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
	for _, cb := range closeListeners {
		cb()
	}
	close(c.closed)
}

func (c *Client) handleLine(line string) {
	untagged := stripMessageTags(line)

	if strings.HasPrefix(untagged, "PING") {
		token := strings.TrimSpace(strings.TrimPrefix(untagged, "PING"))
		c.Send("PONG " + token)
	}

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
		c.mu.Lock()
		_, whoisInFlight := c.whoisBuffer[e.Nick]
		c.mu.Unlock()
		if whoisInFlight {
			c.updateWhois(e.Nick, func(w *ircparse.WhoisEvent) { w.Away = e.Message })
			return
		}
		c.emitEvent(ircparse.AwayEvent{Type: "AWAY", Nick: e.Nick, Away: true, Message: e.Message})
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
	case ircparse.NoticeEvent:
		if pack, ok := xdcc.ParseListLine(e.Text); ok {
			c.emitEvent(ircparse.XDCCPackEvent{
				Type: "XDCCPACK", Nick: e.Nick, Target: e.Target,
				Number: pack.Number, Gets: pack.Gets, Size: pack.Size, Filename: pack.Filename,
			})
		}
	case ircparse.PrivmsgEvent:
		if pack, ok := xdcc.ParseListLine(e.Text); ok {
			c.emitEvent(ircparse.XDCCPackEvent{
				Type: "XDCCPACK", Nick: e.Nick, Target: e.Target,
				Number: pack.Number, Gets: pack.Gets, Size: pack.Size, Filename: pack.Filename,
			})
		}
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

const clientVersion = "Dolq IRC Client"

func (c *Client) handleCTCPRequest(e ircparse.CTCPRequestEvent) {
	switch e.Command {
	case "VERSION":
		c.sendCTCPReply(e.Nick, "VERSION "+clientVersion)
	case "PING":
		c.sendCTCPReply(e.Nick, "PING "+e.Param)
	case "DCC":
		c.handleDCCRequest(e.Nick, e.Param)
	}
}

func (c *Client) handleDCCRequest(nick, param string) {
	fields := strings.Fields(param)
	if len(fields) == 0 {
		return
	}
	switch fields[0] {
	case "CHAT":
		if len(fields) < 4 {
			return
		}
		ipNum, err := strconv.ParseUint(fields[2], 10, 32)
		if err != nil {
			return
		}
		port, err := strconv.Atoi(fields[3])
		if err != nil {
			return
		}
		ip := dcc.DecodeIP(uint32(ipNum))
		c.emitEvent(ircparse.DCCChatOfferEvent{Type: "DCCCHATOFFER", Nick: nick, IP: ip.String(), Port: port})
	case "SEND":
		offer, ok := dcc.ParseSendOffer(param)
		if !ok {
			return
		}
		c.emitEvent(ircparse.XDCCSendOfferEvent{
			Type: "XDCCSENDOFFER", Nick: nick, Filename: offer.Filename,
			IP: offer.IP, Port: offer.Port, Size: offer.Size, Token: offer.Token,
		})
	case "ACCEPT":
		accept, ok := dcc.ParseResumeAccept(param)
		if !ok {
			return
		}
		c.emitEvent(ircparse.XDCCResumeAcceptEvent{
			Type: "XDCCRESUMEACCEPT", Nick: nick, Filename: accept.Filename,
			Port: accept.Port, Position: accept.Position, Token: accept.Token,
		})
	}
}

func (c *Client) sendCTCPReply(nick, payload string) {
	if err := c.Send("NOTICE " + nick + " :\x01" + payload + "\x01"); err != nil {
		log.Printf("ircclient: CTCP reply to %s: %v", nick, err)
	}
}

func (c *Client) updateWhois(nick string, fn func(w *ircparse.WhoisEvent)) {
	c.mu.Lock()
	w := c.whoisBuffer[nick]
	w.Nick = nick
	fn(&w)
	c.whoisBuffer[nick] = w
	c.mu.Unlock()
}

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

func (c *Client) Closed() bool {
	select {
	case <-c.closed:
		return true
	default:
		return false
	}
}

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

func (c *Client) Send(msg string) error {
	line := strings.TrimPrefix(msg, "/")
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_, err := c.conn.Write([]byte(line + "\r\n"))
	return err
}

func (c *Client) SendPaced(msg string) error {
	if !c.flood.wait(c.FloodBurst, c.FloodInterval, c.closed) {
		return errors.New("ircclient: connection closed while waiting to send")
	}
	return c.Send(msg)
}

type floodLimiter struct {
	mu       sync.Mutex
	init     bool
	tokens   int
	burst    int
	interval time.Duration
	next     time.Time
}

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
