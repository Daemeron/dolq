package bouncer

import (
	"context"
	"fmt"
	"log"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/Daemeron/dolq/backend/internal/dcc"
	"github.com/Daemeron/dolq/backend/internal/history"
	"github.com/Daemeron/dolq/backend/internal/ircclient"
	"github.com/Daemeron/dolq/backend/internal/ircparse"
)

const logChannel = history.LogChannel

func eventChannel(event any) string {
	switch e := event.(type) {
	case ircparse.PrivmsgEvent:
		return dmOrChannel(e.Target, e.Nick)
	case ircparse.ActionEvent:
		return dmOrChannel(e.Target, e.Nick)
	case ircparse.XDCCPackEvent:
		return dmOrChannel(e.Target, e.Nick)
	case ircparse.NoticeEvent:
		if strings.HasPrefix(e.Target, "#") {
			return e.Target
		}
		return logChannel
	case ircparse.JoinEvent:
		return e.Channel
	case ircparse.PartEvent:
		return e.Channel
	case ircparse.KickEvent:
		return e.Channel
	case ircparse.ModeEvent:
		return e.Channel
	case ircparse.TopicEvent:
		return e.Channel
	case ircparse.TopicWhoTimeEvent:
		return e.Channel
	case ircparse.SystemEvent:
		return e.Channel
	default:
		return logChannel
	}
}

var (
	lineHead      = regexp.MustCompile(`^(?:@\S+ )?(?::\S+ )?(\S+)(?: (\S+))?`)
	channelTarget = regexp.MustCompile(`^[@+%&~!]*[#&]`)
	// Numerics address us first, then the channel: ":srv 353 me = #chan :..." or ":srv 332 me #chan :...".
	channelNumerics = map[string]bool{"324": true, "329": true, "332": true, "333": true, "353": true, "366": true}
	alwaysScoped    = map[string]bool{"PRIVMSG": true, "JOIN": true, "PART": true, "KICK": true, "QUIT": true, "NICK": true, "TOPIC": true, "AWAY": true}
)

// channelScopedLine reports whether a raw line is traffic a channel or query
// window already shows, through its event. The log keeps only the rest, the
// server-level lines its view is for.
func channelScopedLine(line string) bool {
	m := lineHead.FindStringSubmatch(line)
	if m == nil {
		return false
	}
	command := strings.ToUpper(m[1])
	if command == "NOTICE" || command == "MODE" {
		return channelTarget.MatchString(m[2])
	}
	return alwaysScoped[command] || channelNumerics[command]
}

// sharedChannels lists the channels a QUIT or NICK touched. They have no
// channel of their own, so besides the copy in the log they are stored once per
// channel the user was in, which lets each channel's history show them.
func sharedChannels(event any) []string {
	switch e := event.(type) {
	case ircparse.QuitEvent:
		return e.Channels
	case ircparse.NickEvent:
		return e.Channels
	}
	return nil
}

func dmOrChannel(target, nick string) string {
	if strings.HasPrefix(target, "#") {
		return target
	}
	return nick
}

type Subscriber interface {
	SendLine(serverID, line string)
	SendEvent(serverID string, event any)
	SendStatus(serverID, status string)
}

type dialFunc func() (*ircclient.Client, error)

type session struct {
	client      *ircclient.Client
	mu          sync.Mutex
	subscribers map[Subscriber]struct{}
	status      string

	dial    dialFunc
	closing bool
	stop    chan struct{}

	reconnecting sync.WaitGroup

	// rejoin is what to join again after a drop; welcomed says the current
	// client got far enough to have rejoined it, so its own joined list is trusted again.
	rejoin   []string
	welcomed bool
}

// channelsToRestore is called with s.mu held. A client dropped before its
// welcome never rejoined anything, so the list from before it still stands.
func (s *session) channelsToRestore() []string {
	if !s.welcomed && len(s.rejoin) > 0 {
		return s.rejoin
	}
	return s.client.GetJoinedChannels()
}

func (s *session) markClosing() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closing = true
	select {
	case <-s.stop:
	default:
		close(s.stop)
	}
}

func (s *session) setStatus(serverID, status string) {
	s.mu.Lock()
	s.status = status
	s.mu.Unlock()
	s.fanOutStatus(serverID, status)
}

func (s *session) fanOutLine(serverID, line string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for sub := range s.subscribers {
		sub.SendLine(serverID, line)
	}
}

func (s *session) fanOutEvent(serverID string, event any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for sub := range s.subscribers {
		sub.SendEvent(serverID, event)
	}
}

func (s *session) fanOutStatus(serverID, status string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for sub := range s.subscribers {
		sub.SendStatus(serverID, status)
	}
}

type Bouncer struct {
	mu       sync.Mutex
	sessions map[string]*session
	store    *history.Store

	dccMu       sync.Mutex
	dccSessions map[string]*dcc.Session
	xdccConns   map[string]*xdccTransfer

	ReconnectBackoffBase time.Duration
	ReconnectBackoffMax  time.Duration

	DCCAcceptTimeout time.Duration

	ResumeAcceptTimeout time.Duration
	// SendConfirmTimeout is how long a finished upload waits for the peer's last acknowledgement.
	SendConfirmTimeout time.Duration

	// redialPause, when a test sets it, runs before the named step of a redial
	// so a Disconnect can be made to land right there.
	redialPause func(step string)
}

func New(store *history.Store) *Bouncer {
	return &Bouncer{
		sessions:             make(map[string]*session),
		dccSessions:          make(map[string]*dcc.Session),
		xdccConns:            make(map[string]*xdccTransfer),
		store:                store,
		ReconnectBackoffBase: 2 * time.Second,
		ReconnectBackoffMax:  60 * time.Second,
		DCCAcceptTimeout:     DefaultDCCAcceptTimeout,
		ResumeAcceptTimeout:  DefaultResumeAcceptTimeout,
		SendConfirmTimeout:   DefaultSendConfirmTimeout,
	}
}

func (b *Bouncer) Connect(
	serverID, host string, port int, nick string, secure bool,
	saslUser, saslPass, username, realname string, altNicks []string, password string,
	initial Subscriber,
) error {
	if err := b.Disconnect(serverID); err != nil {
		return err
	}

	dial := func() (*ircclient.Client, error) {
		client, err := ircclient.Dial(host, port, nick, secure)
		if err != nil {
			return nil, err
		}
		client.SASLUser = saslUser
		client.SASLPass = saslPass
		client.Username = username
		client.Realname = realname
		client.AltNicks = altNicks
		client.Password = password
		return client, nil
	}
	client, err := dial()
	if err != nil {
		return err
	}
	b.connect(serverID, client, initial, dial)
	return nil
}

func (b *Bouncer) connect(serverID string, client *ircclient.Client, initial Subscriber, dial dialFunc) {
	sess := &session{
		client:      client,
		subscribers: map[Subscriber]struct{}{initial: {}},
		status:      "connected",
		dial:        dial,
		stop:        make(chan struct{}),
	}
	b.wire(serverID, sess, client)

	b.mu.Lock()
	b.sessions[serverID] = sess
	b.mu.Unlock()

	client.Start()
}

func (b *Bouncer) wire(serverID string, sess *session, client *ircclient.Client) {
	client.AddLineListener(func(line string) {
		if !channelScopedLine(line) {
			b.store.AppendLine(serverID, logChannel, line, time.Now())
		}
		sess.fanOutLine(serverID, line)
	})
	client.AddEventListener(func(event any) {
		if _, ok := event.(ircclient.NamesEvent); !ok {
			now := time.Now()
			b.store.AppendEvent(serverID, eventChannel(event), event, now)
			for _, ch := range sharedChannels(event) {
				b.store.AppendEvent(serverID, ch, event, now)
			}
		}
		sess.fanOutEvent(serverID, event)
	})
	client.AddEventListener(func(event any) {
		if _, ok := event.(ircparse.WelcomeEvent); ok {
			sess.mu.Lock()
			sess.welcomed = true
			sess.mu.Unlock()
		}
	})
	client.OnClose(func() { b.handleClose(serverID, sess) })
}

// logLine records a connection notice in the log and, for each channel that
// was joined, as a system event in that channel too.
func (b *Bouncer) logLine(serverID string, sess *session, line string, channels []string) {
	now := time.Now()
	b.store.AppendLine(serverID, logChannel, line, now)
	sess.fanOutLine(serverID, line)
	text := strings.TrimSpace(strings.TrimPrefix(line, "***"))
	for _, ch := range channels {
		event := ircparse.SystemEvent{Type: "SYSTEM", Channel: ch, Text: text}
		b.store.AppendEvent(serverID, ch, event, now)
		sess.fanOutEvent(serverID, event)
	}
}

func (b *Bouncer) handleClose(serverID string, sess *session) {
	sess.mu.Lock()
	closing := sess.closing
	dial := sess.dial
	channels := sess.channelsToRestore()
	sess.rejoin = channels
	sess.mu.Unlock()

	if closing || dial == nil {
		b.forget(serverID, sess)
		sess.setStatus(serverID, "disconnected")
		b.logLine(serverID, sess, "*** Disconnected", channels)
		return
	}

	sess.setStatus(serverID, "connecting")
	b.logLine(serverID, sess, "*** Connection lost - reconnecting...", channels)
	sess.reconnecting.Add(1)
	go func() {
		defer sess.reconnecting.Done()
		b.reconnect(serverID, sess)
	}()
}

func rejoinOnWelcome(client *ircclient.Client, channels []string) {
	if len(channels) == 0 {
		return
	}
	client.AddEventListener(func(event any) {
		if _, ok := event.(ircparse.WelcomeEvent); !ok {
			return
		}
		for _, ch := range channels {
			client.SendPaced("JOIN " + ch)
		}
	})
}

func (b *Bouncer) reconnect(serverID string, sess *session) {
	sess.mu.Lock()
	previousChannels := sess.rejoin
	sess.mu.Unlock()

	backoff := b.ReconnectBackoffBase
	for {
		select {
		case <-time.After(backoff):
		case <-sess.stop:
			b.forget(serverID, sess)
			sess.setStatus(serverID, "disconnected")
			b.logLine(serverID, sess, "*** Disconnected", previousChannels)
			return
		}

		client, err := sess.dial()

		b.pauseRedial("install")
		// Checked and installed under one lock: a Disconnect either stops this
		// redial here or finds the new client in place.
		sess.mu.Lock()
		closing := sess.closing
		if !closing && err == nil {
			sess.client = client
			sess.welcomed = false
		}
		sess.mu.Unlock()
		if closing {
			if err == nil {
				client.Disconnect()
			}
			b.forget(serverID, sess)
			sess.setStatus(serverID, "disconnected")
			b.logLine(serverID, sess, "*** Disconnected", previousChannels)
			return
		}
		if err != nil {
			log.Printf("bouncer: reconnect %s: %v", serverID, err)
			backoff = min(backoff*2, b.ReconnectBackoffMax)
			continue
		}

		b.wire(serverID, sess, client)
		rejoinOnWelcome(client, previousChannels)
		sess.setStatus(serverID, "connected")
		b.logLine(serverID, sess, "*** Reconnected", previousChannels)
		b.pauseRedial("start")
		client.Start()
		return
	}
}

func (b *Bouncer) pauseRedial(step string) {
	if b.redialPause != nil {
		b.redialPause(step)
	}
}

func (b *Bouncer) forget(serverID string, sess *session) {
	b.mu.Lock()
	if b.sessions[serverID] == sess {
		delete(b.sessions, serverID)
	}
	b.mu.Unlock()
}

func (b *Bouncer) Attach(sub Subscriber, serverID string) {
	b.mu.Lock()
	sess := b.sessions[serverID]
	b.mu.Unlock()
	if sess == nil {
		return
	}
	sess.mu.Lock()
	sess.subscribers[sub] = struct{}{}
	sess.mu.Unlock()
}

func (b *Bouncer) Detach(sub Subscriber) {
	b.mu.Lock()
	sessions := make([]*session, 0, len(b.sessions))
	for _, sess := range b.sessions {
		sessions = append(sessions, sess)
	}
	b.mu.Unlock()

	for _, sess := range sessions {
		sess.mu.Lock()
		delete(sess.subscribers, sub)
		sess.mu.Unlock()
	}
}

func (b *Bouncer) Disconnect(serverID string) error {
	b.mu.Lock()
	sess := b.sessions[serverID]
	b.mu.Unlock()
	if sess == nil {
		return nil
	}
	sess.markClosing()

	sess.mu.Lock()
	client := sess.client
	sess.mu.Unlock()
	err := client.Disconnect()
	// Disconnect returns only after the close listeners, so a redial they started is counted by now.
	// Wait for it to wind down so its "disconnected" can't land after whatever replaces this session.
	sess.reconnecting.Wait()
	// A redial that installed its client before closing was set started it
	// before returning, so this waits for that client's close too. When nothing
	// was installed it is the client already disconnected above.
	sess.mu.Lock()
	latest := sess.client
	sess.mu.Unlock()
	latest.Disconnect()
	return err
}

func (b *Bouncer) History(serverID, channel string, before int64, limit int) ([]history.Entry, error) {
	return b.store.Recent(serverID, channel, before, limit)
}

func (b *Bouncer) Search(serverID, channel, query string, limit int) ([]history.Entry, error) {
	return b.store.Search(serverID, channel, query, limit)
}

func (b *Bouncer) Status(serverID string) string {
	b.mu.Lock()
	sess := b.sessions[serverID]
	b.mu.Unlock()
	if sess == nil {
		return "disconnected"
	}
	sess.mu.Lock()
	defer sess.mu.Unlock()
	return sess.status
}

func (b *Bouncer) JoinedChannels(serverID string) []string {
	b.mu.Lock()
	sess := b.sessions[serverID]
	b.mu.Unlock()
	if sess == nil {
		return nil
	}
	sess.mu.Lock()
	client := sess.client
	sess.mu.Unlock()
	return client.GetJoinedChannels()
}

func (b *Bouncer) Send(serverID, line string) error {
	b.mu.Lock()
	sess := b.sessions[serverID]
	b.mu.Unlock()
	if sess == nil {
		return fmt.Errorf("bouncer: no session for %q", serverID)
	}
	sess.mu.Lock()
	client := sess.client
	sess.mu.Unlock()
	if err := client.SendPaced(line); err != nil {
		return err
	}
	// The server does not echo our own messages back, so they are stored here.
	if ch, event, ok := outgoingEvent(client.Nick(), line); ok {
		b.store.AppendEvent(serverID, ch, event, time.Now())
	}
	return nil
}

var (
	outgoingMessage = regexp.MustCompile(`(?i)^PRIVMSG (\S+) :(.*)$`)
	// Services take passwords in plain messages; those must never reach the history.
	servicesTarget  = regexp.MustCompile(`(?i)serv$|@`)
	credentialsText = regexp.MustCompile(`(?i)^(identify|login|auth|register|group|ghost|release|recover)\b`)
)

// outgoingEvent turns a line we are about to send into the event the server
// would have delivered for it, and the history channel it belongs to: the
// channel itself, or the other party's nick for a private message. ok is false
// for anything that is not a chat message worth keeping.
func outgoingEvent(self, line string) (channel string, event any, ok bool) {
	m := outgoingMessage.FindStringSubmatch(line)
	if m == nil || self == "" {
		return "", nil, false
	}
	target, text := m[1], m[2]
	// Only a private message can carry a password; "release notes tomorrow" in a channel is chat.
	if servicesTarget.MatchString(target) || (!isChannelTarget(target) && credentialsText.MatchString(text)) {
		return "", nil, false
	}
	if rest, found := strings.CutPrefix(text, "\x01ACTION "); found {
		return target, ircparse.ActionEvent{Type: "ACTION", Nick: self, Target: target, Text: strings.TrimSuffix(rest, "\x01")}, true
	}
	if strings.HasPrefix(text, "\x01") {
		return "", nil, false
	}
	return target, ircparse.PrivmsgEvent{Type: "PRIVMSG", Nick: self, Target: target, Text: text}, true
}

func isChannelTarget(target string) bool {
	return target != "" && strings.ContainsRune("#&+!", rune(target[0]))
}

func (b *Bouncer) Shutdown(ctx context.Context) {
	b.closeAllDCC()
	b.closeAllXDCC()

	b.mu.Lock()
	sessions := make([]*session, 0, len(b.sessions))
	for _, sess := range b.sessions {
		sessions = append(sessions, sess)
	}
	b.mu.Unlock()

	var wg sync.WaitGroup
	for _, sess := range sessions {
		wg.Add(1)
		go func(s *session) {
			defer wg.Done()
			s.markClosing()
			s.mu.Lock()
			client := s.client
			s.mu.Unlock()
			client.Disconnect()
		}(sess)
	}
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
	}
}
