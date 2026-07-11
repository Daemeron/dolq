// Package bouncer manages IRC sessions that outlive any one subscriber:
// a session stays connected as long as its Bouncer does, independent of
// whether the subscriber that opened it is still attached.
package bouncer

import (
	"context"
	"fmt"
	"sync"
	"time"

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
// log bucket, same as raw lines.
func eventChannel(event any) string {
	switch e := event.(type) {
	case ircparse.PrivmsgEvent:
		return e.Target
	case ircparse.JoinEvent:
		return e.Channel
	case ircparse.PartEvent:
		return e.Channel
	case ircparse.KickEvent:
		return e.Channel
	case ircparse.ModeEvent:
		return e.Channel
	default:
		return logChannel
	}
}

// Subscriber receives one session's traffic. Defined here (rather than in
// whatever transport implements it, e.g. ipcproto) so the dependency runs
// one way: transport packages import bouncer, not the reverse.
type Subscriber interface {
	SendLine(serverID, line string)
	SendEvent(serverID string, event any)
	SendStatus(serverID, status string)
}

type session struct {
	client      *ircclient.Client
	mu          sync.Mutex
	subscribers map[Subscriber]struct{}
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
}

func New(store *history.Store) *Bouncer {
	return &Bouncer{sessions: make(map[string]*session), store: store}
}

// Connect (re)connects serverID, replacing any existing session for it, and
// attaches initial as the session's first subscriber before returning so
// nothing sent after Connect returns is missed.
func (b *Bouncer) Connect(serverID, host string, port int, nick string, secure bool, initial Subscriber) error {
	b.mu.Lock()
	existing := b.sessions[serverID]
	b.mu.Unlock()
	if existing != nil {
		if err := existing.client.Disconnect(); err != nil {
			return err
		}
	}

	client, err := ircclient.Dial(host, port, nick, secure)
	if err != nil {
		return err
	}
	b.connect(serverID, client, initial)
	return nil
}

// connect wires an already-constructed client into a new session. Split out
// from Connect (which owns the real ircclient.Dial) so tests can inject a
// client built over net.Pipe() via ircclient.New instead.
func (b *Bouncer) connect(serverID string, client *ircclient.Client, initial Subscriber) {
	sess := &session{client: client, subscribers: map[Subscriber]struct{}{initial: {}}}

	client.AddLineListener(func(line string) {
		sess.fanOutLine(serverID, line)
		b.store.AppendLine(serverID, logChannel, line, time.Now())
	})
	client.AddEventListener(func(event any) {
		sess.fanOutEvent(serverID, event)
		// NamesEvent is a synthesized full-membership snapshot (see
		// ircclient's NAMES/353/366 handling), not a discrete happening -
		// nothing to "replay" about it, and persisting a full user list on
		// every NAMES reply would just bloat the DB. Everything else is
		// persisted verbatim; which of it actually gets rendered as
		// scrollback is a UI decision, not storage's to make.
		if _, ok := event.(ircclient.NamesEvent); ok {
			return
		}
		b.store.AppendEvent(serverID, eventChannel(event), event, time.Now())
	})
	client.OnClose(func() {
		b.mu.Lock()
		delete(b.sessions, serverID)
		b.mu.Unlock()
		sess.fanOutStatus(serverID, "disconnected")
	})

	b.mu.Lock()
	b.sessions[serverID] = sess
	b.mu.Unlock()

	client.Start()
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

// Disconnect PARTs every joined channel and QUITs serverID's session.
func (b *Bouncer) Disconnect(serverID string) error {
	b.mu.Lock()
	sess := b.sessions[serverID]
	b.mu.Unlock()
	if sess == nil {
		return nil
	}
	return sess.client.Disconnect()
}

// History returns up to limit persisted messages for serverID/channel,
// oldest first, paging backwards from before (0 for "most recent"). Works
// regardless of whether serverID currently has a live session.
func (b *Bouncer) History(serverID, channel string, before int64, limit int) ([]history.Entry, error) {
	return b.store.Recent(serverID, channel, before, limit)
}

// Status reports whether serverID currently has a live session.
func (b *Bouncer) Status(serverID string) string {
	b.mu.Lock()
	_, ok := b.sessions[serverID]
	b.mu.Unlock()
	if ok {
		return "connected"
	}
	return "disconnected"
}

// JoinedChannels reports the channels serverID's session is currently in.
func (b *Bouncer) JoinedChannels(serverID string) []string {
	b.mu.Lock()
	sess := b.sessions[serverID]
	b.mu.Unlock()
	if sess == nil {
		return nil
	}
	return sess.client.GetJoinedChannels()
}

// Send writes a line to serverID's session.
func (b *Bouncer) Send(serverID, line string) error {
	b.mu.Lock()
	sess := b.sessions[serverID]
	b.mu.Unlock()
	if sess == nil {
		return fmt.Errorf("bouncer: no session for %q", serverID)
	}
	return sess.client.Send(line)
}

// Shutdown disconnects every live session concurrently, or until ctx is
// done - used on SIGINT/SIGTERM.
func (b *Bouncer) Shutdown(ctx context.Context) {
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
			s.client.Disconnect()
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
