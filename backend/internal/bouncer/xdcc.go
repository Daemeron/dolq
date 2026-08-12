package bouncer

import (
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Daemeron/dolq/backend/internal/dcc"
	"github.com/Daemeron/dolq/backend/internal/ircclient"
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

// xdccTransfer is the bookkeeping runXDCCTransfer registers under an id -
// enough for XDCCClose/XDCCPause/XDCCResume/closeAllXDCC to reach an
// in-progress transfer from outside its own goroutine.
type xdccTransfer struct {
	conn  net.Conn
	pause *dcc.PauseGate
}

// DefaultResumeAcceptTimeout bounds how long XDCCAccept waits for a bot's
// CTCP DCC ACCEPT reply to a DCC RESUME request before giving up and
// starting the pack over from scratch instead - a bot that doesn't support
// resume just never replies, same "give up and move on" shape as every
// other handshake timeout in this codebase (see ircclient.DefaultCapTimeout).
// Overridable per-Bouncer - see ResumeAcceptTimeout.
const DefaultResumeAcceptTimeout = 10 * time.Second

// XDCCAccept accepts a parsed XDCC/DCC SEND offer (see XDCCSendOfferEvent)
// and downloads it into destDir, returning an id the caller receives
// XDCCTransferEvent updates under - same shape as DCCOffer/DCCAccept.
// offer.Filename is untrusted (a network peer chose it) so it's never used
// as anything but a base name within destDir - see safeFilename.
//
// If a partial download of the same name is already sitting in destDir
// (left behind by an earlier attempt that never finished - see
// runXDCCTransfer's doc), this first tries to resume it via a CTCP DCC
// RESUME/ACCEPT handshake (requestResume) before connecting, appending onto
// it rather than starting over. That handshake blocks this call for up to
// ResumeAcceptTimeout; harmless since ipcproto handles every frame on its
// own goroutine (see Server.handleConn).
//
// portMin/portMax constrain the listener a passive/reverse offer opens (see
// dcc.Listen) - ignored for an active offer, which dials out instead of
// listening at all. Both 0 lets the OS pick any free port, same as before
// this existed.
func (b *Bouncer) XDCCAccept(
	serverID string, offer ircparse.XDCCSendOfferEvent, destDir string, portMin, portMax int, sub Subscriber,
) (string, error) {
	id := "xdcc:" + uuid.NewString()

	b.mu.Lock()
	sess := b.sessions[serverID]
	b.mu.Unlock()
	if sess == nil {
		return "", fmt.Errorf("bouncer: no session for %q", serverID)
	}
	sess.mu.Lock()
	client := sess.client
	sess.mu.Unlock()

	destPath, base, f, err := openDestination(client, offer, destDir, b.ResumeAcceptTimeout)
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
			b.runXDCCTransfer(id, conn, f, destPath, base, offer.Size, sub)
		}()
		return id, nil
	}

	// Passive/reverse: the sender can't accept a connection (usually NAT),
	// so we listen instead and tell them our address - same handshake shape
	// as DCCOffer, just replying to an offer instead of making one.
	ln, err := dcc.Listen(portMin, portMax)
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
		b.runXDCCTransfer(id, conn, f, destPath, base, offer.Size, sub)
	}()
	return id, nil
}

// openDestination decides where offer's bytes land and opens it: if a
// partial download of the same name already exists in destDir and a resume
// handshake succeeds (requestResume), that file is reopened for append and
// base is how much of it to keep; otherwise (no partial file, or the bot
// didn't answer the resume request) a fresh file is created via uniquePath,
// same as before resume support existed, and base is 0.
func openDestination(client *ircclient.Client, offer ircparse.XDCCSendOfferEvent, destDir string, acceptTimeout time.Duration) (destPath string, base int64, f *os.File, err error) {
	natural := filepath.Join(destDir, safeFilename(offer.Filename))
	if stat, statErr := os.Stat(natural); statErr == nil && stat.Size() > 0 && stat.Size() < offer.Size {
		if position, ok := requestResume(client, offer, stat.Size(), acceptTimeout); ok {
			f, err := os.OpenFile(natural, os.O_WRONLY, 0o644)
			if err != nil {
				return "", 0, nil, err
			}
			if err := f.Truncate(position); err != nil {
				f.Close()
				return "", 0, nil, err
			}
			if _, err := f.Seek(0, io.SeekEnd); err != nil {
				f.Close()
				return "", 0, nil, err
			}
			return natural, position, f, nil
		}
	}

	destPath = uniquePath(destDir, safeFilename(offer.Filename))
	f, err = os.Create(destPath)
	if err != nil {
		return "", 0, nil, err
	}
	return destPath, 0, f, nil
}

// requestResume asks offer.Nick to resume offer.Filename at existing bytes
// in via CTCP DCC RESUME, blocking for its DCC ACCEPT reply (or
// acceptTimeout, whichever comes first). ok is false if the bot never
// replies at all, or replies for a different transfer - either way the
// caller falls back to a fresh download.
//
// Known ceiling: the event listener this registers on client is never
// removed - ircclient has no API for that (nothing else in this codebase
// removes one either). One extra listener per resume attempt is negligible
// for a session's lifetime; revisit if that ever stops being true.
func requestResume(client *ircclient.Client, offer ircparse.XDCCSendOfferEvent, existing int64, acceptTimeout time.Duration) (position int64, ok bool) {
	accepted := make(chan ircparse.XDCCResumeAcceptEvent, 1)
	client.AddEventListener(func(event any) {
		e, ok := event.(ircparse.XDCCResumeAcceptEvent)
		if !ok || e.Nick != offer.Nick || e.Filename != offer.Filename {
			return
		}
		select {
		case accepted <- e:
		default:
		}
	})

	// Token only ever appears in a passive/reverse RESUME (matching a
	// passive offer's own token) - an active offer never had one to echo
	// back, and a trailing empty field could confuse a strict bot's parser.
	resume := fmt.Sprintf("DCC RESUME %s %d %d", quoteIfSpaced(offer.Filename), offer.Port, existing)
	if offer.Token != "" {
		resume += " " + offer.Token
	}
	line := fmt.Sprintf("PRIVMSG %s :\x01%s\x01", offer.Nick, resume)
	if err := client.SendPaced(line); err != nil {
		return 0, false
	}

	select {
	case e := <-accepted:
		return e.Position, true
	case <-time.After(acceptTimeout):
		return 0, false
	}
}

// runXDCCTransfer drives one accepted transfer to completion - registering
// it (so Shutdown/XDCCClose can reach it), streaming bytes to disk from
// base onward (0 for a fresh download, or however much of a partial file
// openDestination resumed from), and reporting progress/completion/error.
// It leaves whatever ends up on disk in place on failure rather than
// deleting it - a future XDCCAccept for the same pack has something to
// resume from (see openDestination) instead of starting over.
func (b *Bouncer) runXDCCTransfer(id string, conn net.Conn, f *os.File, destPath string, base, size int64, sub Subscriber) {
	t := &xdccTransfer{conn: conn, pause: dcc.NewPauseGate()}
	b.dccMu.Lock()
	b.xdccConns[id] = t
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
	err := dcc.ReceiveFile(conn, f, base, size, t.pause, func(received int64) {
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
// there, same shutdown shape as DCCClose. Also resumes first - closing a
// connection a PauseGate is currently blocking on wouldn't otherwise wake
// ReceiveFile up to notice.
func (b *Bouncer) XDCCClose(id string) error {
	t := b.xdccTransfer(id)
	if t == nil {
		return nil
	}
	t.pause.Resume()
	return t.conn.Close()
}

// XDCCPause and XDCCResume pause/resume an in-progress transfer in place -
// see dcc.PauseGate. Erroring on an unknown id (unlike XDCCClose's
// already-gone no-op) because a pause/resume that silently did nothing
// would leave the UI showing a state that never actually took effect.
func (b *Bouncer) XDCCPause(id string) error {
	t := b.xdccTransfer(id)
	if t == nil {
		return fmt.Errorf("bouncer: no transfer %q", id)
	}
	t.pause.Pause()
	return nil
}

func (b *Bouncer) XDCCResume(id string) error {
	t := b.xdccTransfer(id)
	if t == nil {
		return fmt.Errorf("bouncer: no transfer %q", id)
	}
	t.pause.Resume()
	return nil
}

func (b *Bouncer) xdccTransfer(id string) *xdccTransfer {
	b.dccMu.Lock()
	defer b.dccMu.Unlock()
	return b.xdccConns[id]
}

// closeAllXDCC aborts every still-running transfer - part of Shutdown, so
// dolqd exiting doesn't leave one hanging (or, worse, a subscriber gone
// with nothing left to ever report progress to).
func (b *Bouncer) closeAllXDCC() {
	b.dccMu.Lock()
	transfers := make([]*xdccTransfer, 0, len(b.xdccConns))
	for _, t := range b.xdccConns {
		transfers = append(transfers, t)
	}
	b.dccMu.Unlock()
	for _, t := range transfers {
		t.pause.Resume() // a paused transfer would otherwise never notice conn.Close and hang Shutdown's wait
		t.conn.Close()
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
