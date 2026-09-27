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

const logChannel = "__log__"

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
	default:
		return logChannel
	}
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

func (b *Bouncer) Connect(
	serverID, host string, port int, nick string, secure bool,
	saslUser, saslPass, username, realname string, altNicks []string,
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
		b.store.AppendLine(serverID, logChannel, line, time.Now())
		sess.fanOutLine(serverID, line)
	})
	client.AddEventListener(func(event any) {
		if _, ok := event.(ircclient.NamesEvent); !ok {
			b.store.AppendEvent(serverID, eventChannel(event), event, time.Now())
		}
		sess.fanOutEvent(serverID, event)
	})
	client.OnClose(func() { b.handleClose(serverID, sess) })
}

func (b *Bouncer) logLine(serverID string, sess *session, line string) {
	b.store.AppendLine(serverID, logChannel, line, time.Now())
	sess.fanOutLine(serverID, line)
}

func (b *Bouncer) handleClose(serverID string, sess *session) {
	sess.mu.Lock()
	closing := sess.closing
	dial := sess.dial
	sess.mu.Unlock()

	if closing || dial == nil {
		b.forget(serverID, sess)
		sess.setStatus(serverID, "disconnected")
		b.logLine(serverID, sess, "*** Disconnected")
		return
	}

	sess.setStatus(serverID, "connecting")
	b.logLine(serverID, sess, "*** Connection lost - reconnecting...")
	go b.reconnect(serverID, sess)
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
	previousChannels := sess.client.GetJoinedChannels()
	sess.mu.Unlock()

	backoff := b.ReconnectBackoffBase
	for {
		select {
		case <-time.After(backoff):
		case <-sess.stop:
			b.forget(serverID, sess)
			sess.setStatus(serverID, "disconnected")
			b.logLine(serverID, sess, "*** Disconnected")
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
			b.logLine(serverID, sess, "*** Disconnected")
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
		rejoinOnWelcome(client, previousChannels)
		sess.setStatus(serverID, "connected")
		b.logLine(serverID, sess, "*** Reconnected")
		client.Start()
		return
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
	if client.Closed() {
		return nil
	}
	return client.Disconnect()
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
	return client.SendPaced(line)
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
