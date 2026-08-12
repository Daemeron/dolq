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

// DefaultDCCAcceptTimeout bounds how long an offered DCC CHAT listener
// stays open waiting for the other side to connect - same give-up-
// eventually shape as everything else in this codebase that waits on
// another party (CAP negotiation, nick-collision retries).
const DefaultDCCAcceptTimeout = 3 * time.Minute

// DCCOffer sends a CTCP DCC CHAT request to nick over serverID's IRC
// connection and starts listening for them to connect back. Returns
// immediately with the session id sub will receive lines/status under (see
// Subscriber, and wireDCC) - the actual connection, or a timeout, happens
// on its own goroutine. portMin/portMax constrain the listener the same way
// XDCCAccept's passive branch does (see dcc.Listen) - both 0 lets the OS
// pick any free port, same as before this existed.
//
// Unlike IRC sessions, a DCC session isn't kept in the bouncer's own
// survives-a-subscriber-disconnect sense - it's handed straight to
// whichever Subscriber made this call and forgotten once that connection
// closes (see wireDCC/Shutdown). Simpler, and fine in practice: this app
// only ever has the one Electron main-process connection at a time.
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

// DCCAccept dials out to a peer's offered DCC CHAT listener - the
// recipient's side of accepting an offer (see ircparse.DCCChatOfferEvent,
// which is where ip/port come from).
func (b *Bouncer) DCCAccept(ip string, port int, sub Subscriber) (string, error) {
	peer, err := dcc.Dial(ip, port)
	if err != nil {
		return "", err
	}
	id := "dcc:" + uuid.NewString()
	b.wireDCC(id, peer, sub)
	return id, nil
}

// wireDCC registers an established DCC session and fans its traffic out to
// sub, reusing the exact same Subscriber.SendLine/SendStatus methods an IRC
// session's lines already go through - id just stands in for a serverID,
// which the frontend/ipcproto pipeline never needed to know was IRC-
// specific in the first place. Deliberately not persisted to history (see
// DCCOffer's doc) - a DCC chat is a rare, transient side channel, not
// something this app's retention model was built around.
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

// DCCSend writes a line to an active DCC CHAT session.
func (b *Bouncer) DCCSend(id, line string) error {
	b.dccMu.Lock()
	peer := b.dccSessions[id]
	b.dccMu.Unlock()
	if peer == nil {
		return fmt.Errorf("bouncer: no DCC session %q", id)
	}
	return peer.Send(line)
}

// DCCClose ends an active DCC CHAT session - a no-op if it's already gone.
func (b *Bouncer) DCCClose(id string) error {
	b.dccMu.Lock()
	peer := b.dccSessions[id]
	b.dccMu.Unlock()
	if peer == nil {
		return nil
	}
	return peer.Close()
}

// closeAllDCC closes every still-open DCC session - part of Shutdown, so
// nothing lingers past the process actually exiting.
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
