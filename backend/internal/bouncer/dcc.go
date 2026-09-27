package bouncer

import (
	"fmt"
	"log"
	"net"
	"sync"
	"time"

	"github.com/Daemeron/dolq/backend/internal/dcc"
	"github.com/google/uuid"
)

const DefaultDCCAcceptTimeout = 3 * time.Minute

func (b *Bouncer) DCCOffer(serverID, nick string, portMin, portMax int, sub Subscriber) (string, error) {
	b.mu.Lock()
	sess := b.sessions[serverID]
	b.mu.Unlock()
	if sess == nil {
		return "", fmt.Errorf("bouncer: no session for %q", serverID)
	}
	sess.mu.Lock()
	client := sess.client
	sess.mu.Unlock()

	ln, err := dcc.Listen(portMin, portMax)
	if err != nil {
		return "", err
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ip, err := dcc.LocalIP()
	if err != nil {
		ln.Close()
		return "", err
	}

	id := "dcc:" + uuid.NewString()
	line := fmt.Sprintf("PRIVMSG %s :\x01DCC CHAT chat %d %d\x01", nick, dcc.EncodeIP(ip), port)
	if err := client.SendPaced(line); err != nil {
		ln.Close()
		return "", err
	}

	sub.SendStatus(id, "connecting")
	go func() {
		peer, err := dcc.AcceptOnce(ln, b.DCCAcceptTimeout)
		if err != nil {
			log.Printf("bouncer: DCC offer to %s: %v", nick, err)
			sub.SendStatus(id, "disconnected")
			return
		}
		b.wireDCC(id, peer, sub)
	}()
	return id, nil
}

func (b *Bouncer) DCCAccept(ip string, port int, sub Subscriber) (string, error) {
	peer, err := dcc.Dial(ip, port)
	if err != nil {
		return "", err
	}
	id := "dcc:" + uuid.NewString()
	b.wireDCC(id, peer, sub)
	return id, nil
}

func (b *Bouncer) wireDCC(id string, peer *dcc.Session, sub Subscriber) {
	b.dccMu.Lock()
	b.dccSessions[id] = peer
	b.dccMu.Unlock()

	peer.AddLineListener(func(line string) { sub.SendLine(id, line) })
	peer.OnClose(func() {
		sub.SendStatus(id, "disconnected")
		b.dccMu.Lock()
		delete(b.dccSessions, id)
		b.dccMu.Unlock()
	})
	sub.SendStatus(id, "connected")
	peer.Start()
}

func (b *Bouncer) DCCSend(id, line string) error {
	b.dccMu.Lock()
	peer := b.dccSessions[id]
	b.dccMu.Unlock()
	if peer == nil {
		return fmt.Errorf("bouncer: no DCC session %q", id)
	}
	return peer.Send(line)
}

func (b *Bouncer) DCCClose(id string) error {
	b.dccMu.Lock()
	peer := b.dccSessions[id]
	b.dccMu.Unlock()
	if peer == nil {
		return nil
	}
	return peer.Close()
}

func (b *Bouncer) closeAllDCC() {
	b.dccMu.Lock()
	sessions := make([]*dcc.Session, 0, len(b.dccSessions))
	for _, peer := range b.dccSessions {
		sessions = append(sessions, peer)
	}
	b.dccMu.Unlock()

	var wg sync.WaitGroup
	for _, peer := range sessions {
		wg.Add(1)
		go func(p *dcc.Session) {
			defer wg.Done()
			p.Close()
		}(peer)
	}
	wg.Wait()
}
