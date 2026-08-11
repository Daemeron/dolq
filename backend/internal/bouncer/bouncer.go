// Package bouncer manages IRC sessions that outlive any one subscriber:
// a session stays connected as long as its Bouncer does, independent of
// whether the subscriber that opened it is still attached.
package bouncer

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/Daemeron/dolq/backend/internal/dcc"
	"github.com/Daemeron/dolq/backend/internal/history"
	"github.com/Daemeron/dolq/backend/internal/ircclient"
	"github.com/Daemeron/dolq/backend/internal/ircparse"
)

// logChannel is the sentinel "channel" a server's raw, unparsed line feed is
// stored under - there's one per server, not per actual IRC channel.
const logChannel = "__log__"

// eventChannel picks which channel bucket a parsed event is persisted
// under. Events with an explicit channel/target keep it; QuitEvent and
// NickEvent don't have one - a QUIT or nick change can ripple across every
// channel the user shared with us, and nothing here tracks per-user channel
// membership to resolve that - so those fall back to the server's shared
// log bucket, same as raw lines. Connection-level events (WelcomeEvent,
// a private NickInUseEvent) fall back the same way via the default case
// below - there's no channel for them to belong to at all.
func eventChannel(event any) string {
	switch e := event.(type) {
	case ircparse.PrivmsgEvent:
		return dmOrChannel(e.Target, e.Nick)
	case ircparse.ActionEvent:
		return dmOrChannel(e.Target, e.Nick)
	case ircparse.XDCCPackEvent:
		// Bucketed like PRIVMSG/ACTION (by sender, for a private reply), not
		// like NoticeEvent's own default-to-log - the frontend routes a live
		// XDCCPACK into the bot's query the same way, so history matches what
		// reopening that query later shows.
		return dmOrChannel(e.Target, e.Nick)
	case ircparse.NoticeEvent:
		// Unlike PRIVMSG/ACTION, a private NOTICE doesn't bucket by sender -
		// it's frequently a bare server hostname, not a nick worth opening a
		// query for (see ircparse.NoticeEvent), so it falls back to the log
		// bucket instead, same as QuitEvent/NickEvent below.
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
	default:
		return logChannel
	}
}

// dmOrChannel picks the history bucket for a PRIVMSG/ACTION. A channel
// target keeps its name; a non-channel target is always our own nick (the
// only way we'd ever receive one), so those bucket by sender instead - both
// directions of a DM conversation end up in the same place. Only incoming
// DMs go through here; our own sent messages aren't looped back by the
// server without echo-message, the same pre-existing gap channel messages
// have.
func dmOrChannel(target, nick string) string {
	if strings.HasPrefix(target, "#") {
		return target
	}
	return nick
}

// Subscriber receives one session's traffic. Defined here (rather than in
// whatever transport implements it, e.g. ipcproto) so the dependency runs
// one way: transport packages import bouncer, not the reverse.
type Subscriber interface {
	SendLine(serverID, line string)
	SendEvent(serverID string, event any)
	SendStatus(serverID, status string)
}

// dialFunc opens a fresh connection to the network a session belongs to,
// with whatever parameters (host, port, nick, TLS, SASL creds) the original
// Connect call captured. Stored on the session so an unexpected drop can
// redial with the same settings - see reconnect.
type dialFunc func() (*ircclient.Client, error)

type session struct {
	client      *ircclient.Client
	mu          sync.Mutex
	subscribers map[Subscriber]struct{}
	status      string // "connecting" | "connected" - "disconnected" is implicit in the session being forgotten, see forget

	dial    dialFunc      // redials after an unexpected drop; nil disables auto-reconnect (used by tests driving a session directly over net.Pipe(), which can't be redialed)
	closing bool          // true once Disconnect (or a fresh Connect replacing this session) is intentionally tearing this down - suppresses auto-reconnect
	stop    chan struct{} // closed once, alongside closing, to cancel a reconnect attempt that's sleeping in backoff or has just redialed
}

// markClosing tells this session's reconnect loop (if any is running or
// about to start) to give up rather than keep retrying - the far end going
// away is about to be intentional (Disconnect, or a fresh Connect replacing
// this session), not a network hiccup.
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
	store    *history.Store // nil is fine, see history.Store's nil receivers

	// dccMu guards dccSessions/xdccConns separately from mu - DCC/XDCC
	// bookkeeping (see dcc.go, xdcc.go) has nothing to do with IRC session
	// state and there's no reason for the two to contend with each other.
	dccMu       sync.Mutex
	dccSessions map[string]*dcc.Session
	xdccConns   map[string]*xdccTransfer

	// Overridable before any Connect() call - tests shrink these so a
	// reconnect test doesn't have to sit through a real backoff.
	ReconnectBackoffBase time.Duration
	ReconnectBackoffMax  time.Duration

	// Overridable before any DCCOffer() call - tests shrink this so an
	// unaccepted-offer test doesn't have to sit through the real timeout.
	DCCAcceptTimeout time.Duration

	// Overridable before any XDCCAccept() call - tests shrink this so a
	// bot-never-replies resume test doesn't have to sit through the real
	// timeout. See requestResume.
	ResumeAcceptTimeout time.Duration
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
	}
}

// Connect (re)connects serverID, replacing any existing session for it, and
// attaches initial as the session's first subscriber before returning so
// nothing sent after Connect returns is missed. saslUser/saslPass are
// optional (both empty skips SASL entirely, as ircclient.Client does).
func (b *Bouncer) Connect(
	serverID, host string, port int, nick string, secure bool,
	saslUser, saslPass, username, realname string, altNicks []string,
	initial Subscriber,
) error {
	if err := b.Disconnect(serverID); err != nil {
		return err
	}

	// Captured so an unexpected drop can redial with the same settings -
	// see reconnect. Only ever called again on this client's own session's
	// goroutine, never concurrently with this first call.
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
		return client, nil
	}
	client, err := dial()
	if err != nil {
		return err
	}
	b.connect(serverID, client, initial, dial)
	return nil
}

// connect wires an already-constructed client into a new session. dial is
// nil in tests that inject a client built over net.Pipe() directly (via
// ircclient.New) - net.Pipe() can't be redialed, so those sessions just opt
// out of auto-reconnect rather than exercising it.
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

// wire attaches sess's persistence/fan-out/close handling to client. Called
// once for the initial connection and again, with a freshly redialed
// client, each time reconnect succeeds.
func (b *Bouncer) wire(serverID string, sess *session, client *ircclient.Client) {
	// Persist before fanning out, not after: fanOut writes to subscriber
	// sockets synchronously, right here on the IRC read loop's goroutine, so
	// a slow/stalled subscriber backpressures that write and blocks the read
	// loop until it clears (pre-existing bouncer behavior, not something
	// this changes). Append itself never blocks (see append's docs), so
	// persisting first means a stuck subscriber can delay live delivery
	// without also risking history for it.
	client.AddLineListener(func(line string) {
		b.store.AppendLine(serverID, logChannel, line, time.Now())
		sess.fanOutLine(serverID, line)
	})
	client.AddEventListener(func(event any) {
		// NamesEvent is a synthesized full-membership snapshot (see
		// ircclient's NAMES/353/366 handling), not a discrete happening -
		// nothing to "replay" about it, and persisting a full user list on
		// every NAMES reply would just bloat the DB. Everything else is
		// persisted verbatim; which of it actually gets rendered as
		// scrollback is a UI decision, not storage's to make.
		if _, ok := event.(ircclient.NamesEvent); !ok {
			b.store.AppendEvent(serverID, eventChannel(event), event, time.Now())
		}
		sess.fanOutEvent(serverID, event)
	})
	client.OnClose(func() { b.handleClose(serverID, sess) })
}

// handleClose runs once, whenever a session's client connection ends -
// whether intentionally (Disconnect, or a fresh Connect replacing this
// session) or not. An intentional close, or a session with no dial func
// (net.Pipe()-backed test sessions, which can't be redialed), just forgets
// the session; anything else is an unexpected drop, retried with backoff.
func (b *Bouncer) handleClose(serverID string, sess *session) {
	sess.mu.Lock()
	closing := sess.closing
	dial := sess.dial
	sess.mu.Unlock()

	if closing || dial == nil {
		b.forget(serverID, sess)
		sess.setStatus(serverID, "disconnected")
		return
	}

	sess.setStatus(serverID, "connecting")
	go b.reconnect(serverID, sess)
}

// reconnect retries sess.dial with exponential backoff until it succeeds or
// sess.stop is closed (Disconnect, or a fresh Connect for the same
// serverID - either way, give up rather than keep trying). Runs on its own
// goroutine, started by handleClose after an unexpected drop.
func (b *Bouncer) reconnect(serverID string, sess *session) {
	backoff := b.ReconnectBackoffBase
	for {
		select {
		case <-time.After(backoff):
		case <-sess.stop:
			b.forget(serverID, sess)
			sess.setStatus(serverID, "disconnected")
			return
		}

		client, err := sess.dial()

		sess.mu.Lock()
		closing := sess.closing
		sess.mu.Unlock()
		if closing {
			if err == nil {
				client.Disconnect()
			}
			b.forget(serverID, sess)
			sess.setStatus(serverID, "disconnected")
			return
		}
		if err != nil {
			log.Printf("bouncer: reconnect %s: %v", serverID, err)
			backoff = min(backoff*2, b.ReconnectBackoffMax)
			continue
		}

		sess.mu.Lock()
		sess.client = client
		sess.mu.Unlock()
		b.wire(serverID, sess, client)
		sess.setStatus(serverID, "connected")
		client.Start()
		return
	}
}

// forget removes sess from the session table, but only if it's still the
// current session for serverID - a reconnect goroutine racing a fresh
// Connect() for the same serverID must not delete the new session out from
// under it.
func (b *Bouncer) forget(serverID string, sess *session) {
	b.mu.Lock()
	if b.sessions[serverID] == sess {
		delete(b.sessions, serverID)
	}
	b.mu.Unlock()
}

// Attach adds sub to the set of subscribers receiving serverID's traffic.
// A no-op if no session for serverID is currently live.
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

// Detach removes sub from every session it's subscribed to. This does not
// touch the underlying IRC session, which persists independent of any one
// subscriber's lifetime - that's the actual bouncer behavior.
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

// Disconnect PARTs every joined channel and QUITs serverID's session. If a
// reconnect attempt was in progress after an earlier unexpected drop, that
// attempt is cancelled instead of being left to keep retrying in the
// background.
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
	if client.Closed() {
		// Mid-backoff: nothing live to PART/QUIT. markClosing already told
		// the retry loop to stop and report itself gone.
		return nil
	}
	return client.Disconnect()
}

// History returns up to limit persisted messages for serverID/channel,
// oldest first, paging backwards from before (0 for "most recent"). Works
// regardless of whether serverID currently has a live session.
func (b *Bouncer) History(serverID, channel string, before int64, limit int) ([]history.Entry, error) {
	return b.store.Recent(serverID, channel, before, limit)
}

// Search searches persisted history the same way History does, but across
// possibly every channel and/or every server at once - see
// history.Store.Search for the actual scoping/matching rules. Works
// regardless of whether any of the matched servers currently have a live
// session, same as History.
func (b *Bouncer) Search(serverID, channel, query string, limit int) ([]history.Entry, error) {
	return b.store.Search(serverID, channel, query, limit)
}

// Status reports serverID's session state: "connected", "connecting" (mid
// reconnect after an unexpected drop), or "disconnected" (no session at
// all).
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

// JoinedChannels reports the channels serverID's session is currently in.
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

// Send writes a line to serverID's session. Paced (see
// ircclient.Client.SendPaced) - this is the one and only path a
// user-originated line takes to the wire, so it's the right (and only)
// place to guard against a paste storm or rapid-fire command spam tripping
// the server's own flood protection; internal protocol traffic never goes
// through here.
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
	return client.SendPaced(line)
}

// Shutdown disconnects every live session concurrently, or until ctx is
// done - used on SIGINT/SIGTERM.
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
			// markClosing first, or a reconnect that's mid-backoff would
			// just start a fresh session after this one shuts down.
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
