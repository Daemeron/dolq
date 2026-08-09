package bouncer

import (
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Daemeron/dolq/backend/internal/dcc"
	"github.com/Daemeron/dolq/backend/internal/ircparse"
	"github.com/google/uuid"
)

// XDCCTransferEvent reports progress on a transfer XDCCAccept started.
// Unlike a session's ordinary events, this is sent straight to whichever
// Subscriber accepted the offer, under the transfer's own id - never
// persisted to history and never fanned out to anyone else, same reasoning
// as DCC CHAT's lines/status (see wireDCC's doc): a download belongs to
// whoever started it, not to scrollback.
type XDCCTransferEvent struct {
	Type     string `json:"type"`
	Received int64  `json:"received"`
	Total    int64  `json:"total"`
	Path     string `json:"path"`
	Done     bool   `json:"done,omitempty"`
	Error    string `json:"error,omitempty"`
}

// progressInterval throttles how often XDCCTransferEvent updates go out - a
// fast local transfer can fill a 64KB chunk far faster than any UI needs to
// redraw a progress bar.
const progressInterval = 250 * time.Millisecond

// XDCCAccept accepts a parsed XDCC/DCC SEND offer (see XDCCSendOfferEvent)
// and downloads it into destDir, returning immediately with an id the
// caller receives XDCCTransferEvent updates under - same shape as
// DCCOffer/DCCAccept, the transfer itself runs on its own goroutine.
// offer.Filename is untrusted (a network peer chose it) so it's never used
// as anything but a base name within destDir - see safeFilename.
func (b *Bouncer) XDCCAccept(serverID string, offer ircparse.XDCCSendOfferEvent, destDir string, sub Subscriber) (string, error) {
	id := "xdcc:" + uuid.NewString()
	destPath := uniquePath(destDir, safeFilename(offer.Filename))
	f, err := os.Create(destPath)
	if err != nil {
		return "", err
	}

	if offer.Port != 0 {
		// Active: the sender's already listening, just dial it.
		sub.SendStatus(id, "connecting")
		go func() {
			conn, err := dcc.DialRaw(offer.IP, offer.Port)
			if err != nil {
				log.Printf("bouncer: XDCC dial to %s: %v", offer.Nick, err)
				sub.SendStatus(id, "disconnected")
				f.Close()
				return
			}
			b.runXDCCTransfer(id, conn, f, destPath, offer.Size, sub)
		}()
		return id, nil
	}

	// Passive/reverse: the sender can't accept a connection (usually NAT),
	// so we listen instead and tell them our address - same handshake shape
	// as DCCOffer, just replying to an offer instead of making one.
	b.mu.Lock()
	sess := b.sessions[serverID]
	b.mu.Unlock()
	if sess == nil {
		f.Close()
		return "", fmt.Errorf("bouncer: no session for %q", serverID)
	}
	sess.mu.Lock()
	client := sess.client
	sess.mu.Unlock()

	ln, err := dcc.Listen()
	if err != nil {
		f.Close()
		return "", err
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ip, err := dcc.LocalIP()
	if err != nil {
		ln.Close()
		f.Close()
		return "", err
	}
	line := fmt.Sprintf("PRIVMSG %s :\x01DCC SEND %s %d %d %d %s\x01",
		offer.Nick, quoteIfSpaced(offer.Filename), dcc.EncodeIP(ip), port, offer.Size, offer.Token)
	if err := client.SendPaced(line); err != nil {
		ln.Close()
		f.Close()
		return "", err
	}

	sub.SendStatus(id, "connecting")
	go func() {
		conn, err := dcc.AcceptOnceRaw(ln, b.DCCAcceptTimeout)
		if err != nil {
			log.Printf("bouncer: XDCC passive accept from %s: %v", offer.Nick, err)
			sub.SendStatus(id, "disconnected")
			f.Close()
			return
		}
		b.runXDCCTransfer(id, conn, f, destPath, offer.Size, sub)
	}()
	return id, nil
}

// runXDCCTransfer drives one accepted transfer to completion - registering
// it (so Shutdown/XDCCClose can reach it), streaming bytes to disk, and
// reporting progress/completion/error, in every case leaving whatever was
// written on disk in place rather than deleting a partial file: resuming
// one is a separate roadmap item, and there's nothing to resume from if
// this deletes it first.
func (b *Bouncer) runXDCCTransfer(id string, conn net.Conn, f *os.File, destPath string, size int64, sub Subscriber) {
	b.dccMu.Lock()
	b.xdccConns[id] = conn
	b.dccMu.Unlock()
	defer func() {
		b.dccMu.Lock()
		delete(b.xdccConns, id)
		b.dccMu.Unlock()
		conn.Close()
		f.Close()
	}()

	sub.SendStatus(id, "connected")
	last := time.Now()
	err := dcc.ReceiveFile(conn, f, size, func(received int64) {
		if received < size && time.Since(last) < progressInterval {
			return
		}
		last = time.Now()
		sub.SendEvent(id, XDCCTransferEvent{Type: "XDCCTRANSFER", Received: received, Total: size, Path: destPath})
	})
	sub.SendStatus(id, "disconnected")
	if err != nil {
		log.Printf("bouncer: XDCC transfer %s: %v", id, err)
		sub.SendEvent(id, XDCCTransferEvent{Type: "XDCCTRANSFER", Path: destPath, Error: err.Error()})
		return
	}
	sub.SendEvent(id, XDCCTransferEvent{Type: "XDCCTRANSFER", Received: size, Total: size, Path: destPath, Done: true})
}

// XDCCClose cancels an in-progress transfer - a no-op if it's already gone
// (finished or never started). Closing conn is enough: ReceiveFile's Read
// unblocks with an error and runXDCCTransfer's own cleanup takes it from
// there, same shutdown shape as DCCClose.
func (b *Bouncer) XDCCClose(id string) error {
	b.dccMu.Lock()
	conn := b.xdccConns[id]
	b.dccMu.Unlock()
	if conn == nil {
		return nil
	}
	return conn.Close()
}

// closeAllXDCC aborts every still-running transfer - part of Shutdown, so
// dolqd exiting doesn't leave one hanging (or, worse, a subscriber gone
// with nothing left to ever report progress to).
func (b *Bouncer) closeAllXDCC() {
	b.dccMu.Lock()
	conns := make([]net.Conn, 0, len(b.xdccConns))
	for _, c := range b.xdccConns {
		conns = append(conns, c)
	}
	b.dccMu.Unlock()
	for _, c := range conns {
		c.Close()
	}
}

// safeFilename reduces an offer's announced filename to a bare base name -
// the only thing it's ever trusted for. A bot naming its own pack is
// unremarkable; a bot naming it "../../.ssh/authorized_keys" is a path-
// traversal attempt this closes off entirely, the same way any filename
// from an untrusted remote source has to be treated.
func safeFilename(name string) string {
	name = filepath.Base(name)
	if name == "" || name == "." || name == ".." || name == string(filepath.Separator) {
		return "download"
	}
	return name
}

// uniquePath returns dir/name, or dir/name (1), dir/name (2), etc. if that's
// already taken - the same collision convention browsers use for downloads,
// so accepting the same pack twice (or two packs a bot happens to name the
// same thing) never clobbers an earlier one.
func uniquePath(dir, name string) string {
	path := filepath.Join(dir, name)
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for n := 1; ; n++ {
		if _, err := os.Stat(path); os.IsNotExist(err) {
			return path
		}
		path = filepath.Join(dir, fmt.Sprintf("%s (%d)%s", base, n, ext))
	}
}

// quoteIfSpaced wraps name in double quotes if it contains a space - the
// exact convention ParseSendOffer itself consumes on the way in (a plain
// wrap, no escaping either side of it), so a passive reply announcing the
// same filename back stays parseable by whatever's on the other end too.
func quoteIfSpaced(name string) string {
	if strings.ContainsRune(name, ' ') {
		return `"` + name + `"`
	}
	return name
}
