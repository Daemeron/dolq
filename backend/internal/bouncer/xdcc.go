package bouncer

import (
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Daemeron/dolq/backend/internal/dcc"
	"github.com/Daemeron/dolq/backend/internal/disk"
	"github.com/Daemeron/dolq/backend/internal/history"
	"github.com/Daemeron/dolq/backend/internal/ircclient"
	"github.com/Daemeron/dolq/backend/internal/ircparse"
	"github.com/google/uuid"
)

type XDCCTransferEvent struct {
	Type     string `json:"type"`
	Received int64  `json:"received"`
	Total    int64  `json:"total"`
	Path     string `json:"path"`
	Done     bool   `json:"done,omitempty"`
	Error    string `json:"error,omitempty"`
	// Sending marks a file going out to Nick rather than one coming in.
	Sending bool `json:"sending,omitempty"`
}

const progressInterval = 250 * time.Millisecond

// xdccTransfer is registered from accept on, so it can be cancelled before
// the peer has connected too. Its fields other than pause are guarded by
// Bouncer.dccMu.
type xdccTransfer struct {
	pause     *dcc.PauseGate
	ln        net.Listener // passive, while waiting for the peer
	conn      net.Conn     // once connected
	cancelled bool
}

const DefaultResumeAcceptTimeout = 10 * time.Second

// XDCCAccept takes up a file the sender offered. A refusal is logged as well as returned: the sender is left waiting for
// a connection until it gives up, and the log is where anyone looking for why will go.
func (b *Bouncer) XDCCAccept(
	serverID string, offer ircparse.XDCCSendOfferEvent, destDir string, portMin, portMax int, sub Subscriber,
) (string, error) {
	id, err := b.xdccAccept(serverID, offer, destDir, portMin, portMax, sub)
	if err != nil {
		log.Printf("xdcc: could not accept %s from %s: %v", offer.Filename, offer.Nick, err)
	}
	return id, err
}

func (b *Bouncer) xdccAccept(
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

	if err := checkRoom(destDir, offer); err != nil {
		return "", err
	}
	destPath, base, f, err := openDestination(client, offer, destDir, b.ResumeAcceptTimeout)
	if err != nil {
		return "", err
	}

	t := &xdccTransfer{pause: dcc.NewPauseGate()}
	// connected hands the peer's connection over to the transfer, or reports
	// the transfer over: it failed to connect, or was cancelled meanwhile.
	connected := func(conn net.Conn, err error) {
		b.dccMu.Lock()
		if err == nil && t.cancelled {
			err = errors.New("cancelled")
		}
		if err == nil {
			t.conn = conn
		} else {
			delete(b.xdccConns, id)
		}
		b.dccMu.Unlock()
		if err != nil {
			log.Printf("bouncer: XDCC from %s: %v", offer.Nick, err)
			if conn != nil {
				conn.Close()
			}
			sub.SendStatus(id, "disconnected")
			f.Close()
			return
		}
		b.runXDCCTransfer(id, serverID, offer, t, f, destPath, base, sub)
	}

	if offer.Port != 0 {
		b.dccMu.Lock()
		b.xdccConns[id] = t
		b.dccMu.Unlock()
		log.Printf("xdcc: accepted %s from %s, connecting to %s:%d", offer.Filename, offer.Nick, offer.IP, offer.Port)
		sub.SendStatus(id, "connecting")
		go func() { connected(dcc.DialRaw(offer.IP, offer.Port)) }()
		return id, nil
	}

	ln, err := dcc.Listen(portMin, portMax)
	if err != nil {
		f.Close()
		return "", err
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ip, err := dcc.AnnouncedIP(b.DCCHost)
	if err != nil {
		ln.Close()
		f.Close()
		return "", err
	}
	t.ln = ln
	b.dccMu.Lock()
	b.xdccConns[id] = t
	b.dccMu.Unlock()
	// The address announced is where the sender has to connect; inside a container it is the container's own.
	log.Printf("xdcc: accepted %s from %s, waiting for it at %s:%d", offer.Filename, offer.Nick, ip, port)
	line := fmt.Sprintf("PRIVMSG %s :\x01DCC SEND %s %d %d %d %s\x01",
		offer.Nick, quoteIfSpaced(offer.Filename), dcc.EncodeIP(ip), port, offer.Size, offer.Token)
	if err := client.SendPaced(line); err != nil {
		b.dccMu.Lock()
		delete(b.xdccConns, id)
		b.dccMu.Unlock()
		ln.Close()
		f.Close()
		return "", err
	}

	sub.SendStatus(id, "connecting")
	go func() { connected(dcc.AcceptOnceRaw(ln, b.DCCAcceptTimeout)) }()
	return id, nil
}

func openDestination(client *ircclient.Client, offer ircparse.XDCCSendOfferEvent, destDir string, acceptTimeout time.Duration) (destPath string, base int64, f *os.File, err error) {
	natural := filepath.Join(destDir, safeFilename(offer.Filename))
	// Lstat, not Stat: only a regular file in destDir itself may be resumed,
	// never whatever a symlink there points at.
	if stat, statErr := os.Lstat(natural); statErr == nil && stat.Mode().IsRegular() && stat.Size() > 0 && stat.Size() < offer.Size {
		if position, ok := requestResume(client, offer, stat.Size(), acceptTimeout); ok {
			f, err := openForResume(natural, stat, position)
			if err != nil {
				return "", 0, nil, err
			}
			return natural, position, f, nil
		}
	}

	destPath = uniquePath(destDir, safeFilename(offer.Filename))
	// O_EXCL also refuses a dangling symlink, so a new download never writes outside destDir.
	f, err = os.OpenFile(destPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return "", 0, nil, err
	}
	return destPath, 0, f, nil
}

// openForResume opens path for appending at position, refusing it if it is no
// longer the regular file stat described (swapped for a symlink in the meantime).
func openForResume(path string, stat os.FileInfo, position int64) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}
	if opened, err := f.Stat(); err != nil || !os.SameFile(stat, opened) {
		f.Close()
		return nil, fmt.Errorf("bouncer: %s changed before resuming", path)
	}
	if err := f.Truncate(position); err != nil {
		f.Close()
		return nil, err
	}
	if _, err := f.Seek(0, io.SeekEnd); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}

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

func (b *Bouncer) runXDCCTransfer(id, serverID string, offer ircparse.XDCCSendOfferEvent, t *xdccTransfer, f *os.File, destPath string, base int64, sub Subscriber) {
	size := offer.Size
	conn := t.conn
	defer func() {
		b.dccMu.Lock()
		delete(b.xdccConns, id)
		b.dccMu.Unlock()
		conn.Close()
		f.Close()
	}()

	sub.SendStatus(id, "connected")
	log.Printf("xdcc: receiving %s from %s (%d bytes)", offer.Filename, offer.Nick, size)
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
		log.Printf("bouncer: XDCC transfer %s: %v (%s: %s)", id, err, filepath.Dir(destPath), disk.Describe(filepath.Dir(destPath)))
		sub.SendEvent(id, XDCCTransferEvent{Type: "XDCCTRANSFER", Path: destPath, Error: err.Error()})
		b.recordTransfer(serverID, offer.Nick, fmt.Sprintf("Download of %s failed: %s", offer.Filename, err))
		b.keepTransfer(t, history.Transfer{ID: id, ServerID: serverID, Nick: offer.Nick, Filename: offer.Filename, Total: size, Path: destPath, Error: err.Error()})
		return
	}
	sub.SendEvent(id, XDCCTransferEvent{Type: "XDCCTRANSFER", Received: size, Total: size, Path: destPath, Done: true})
	log.Printf("xdcc: received %s from %s", offer.Filename, offer.Nick)
	b.recordTransfer(serverID, offer.Nick, fmt.Sprintf("Downloaded %s to %s", offer.Filename, destPath))
	b.keepTransfer(t, history.Transfer{ID: id, ServerID: serverID, Nick: offer.Nick, Filename: offer.Filename, Received: size, Total: size, Path: destPath, Done: true})
}

// keepTransfer saves how a transfer ended for the Transfers list, unless the user cancelled it: that one is dismissed already.
func (b *Bouncer) keepTransfer(t *xdccTransfer, tr history.Transfer) {
	b.dccMu.Lock()
	cancelled := t.cancelled
	b.dccMu.Unlock()
	if cancelled {
		return
	}
	tr.Timestamp = time.Now()
	b.store.SaveTransfer(tr)
}

func (b *Bouncer) Transfers() ([]history.Transfer, error) {
	return b.store.Transfers()
}

// DeleteTransfer forgets one saved transfer, or all of them when id is empty.
func (b *Bouncer) DeleteTransfer(id string) error {
	return b.store.DeleteTransfer(id)
}

// recordTransfer keeps the outcome of a download in the history of the
// conversation with the sender, so it is still there after a restart.
func (b *Bouncer) recordTransfer(serverID, nick, text string) {
	b.store.AppendEvent(serverID, nick, ircparse.SystemEvent{Type: "SYSTEM", Channel: nick, Text: text}, time.Now())
}

func (b *Bouncer) XDCCClose(id string) error {
	t := b.xdccTransfer(id)
	if t == nil {
		return nil
	}
	b.cancelXDCC(t)
	return nil
}

// cancelXDCC stops a transfer: a running one is cut off, one still waiting for
// the peer stops listening, and a peer that connects after all is dropped.
func (b *Bouncer) cancelXDCC(t *xdccTransfer) {
	b.dccMu.Lock()
	t.cancelled = true
	ln, conn := t.ln, t.conn
	b.dccMu.Unlock()
	t.pause.Resume()
	if conn != nil {
		conn.Close()
	} else if ln != nil {
		ln.Close()
	}
}

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

func (b *Bouncer) closeAllXDCC() {
	b.dccMu.Lock()
	transfers := make([]*xdccTransfer, 0, len(b.xdccConns))
	for _, t := range b.xdccConns {
		transfers = append(transfers, t)
	}
	b.dccMu.Unlock()
	for _, t := range transfers {
		b.cancelXDCC(t)
	}
}

func safeFilename(name string) string {
	name = filepath.Base(name)
	if name == "" || name == "." || name == ".." || name == string(filepath.Separator) {
		return "download"
	}
	return name
}

func uniquePath(dir, name string) string {
	path := filepath.Join(dir, name)
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for n := 1; ; n++ {
		if _, err := os.Lstat(path); os.IsNotExist(err) {
			return path
		}
		path = filepath.Join(dir, fmt.Sprintf("%s (%d)%s", base, n, ext))
	}
}

func quoteIfSpaced(name string) string {
	if strings.ContainsRune(name, ' ') {
		return `"` + name + `"`
	}
	return name
}

// minFree is what a download leaves free on its disk. A download that would use it all is refused, because a full disk
// takes more than the download down with it: on a NAS the system disk is small, and when it is full the NAS can no
// longer keep its own files in order.
const minFree = 100 * 1000 * 1000

// freeSpace is how much room a folder has; a variable so tests can give another answer.
var freeSpace = disk.Free

// checkRoom refuses an offer when its file, less what a partial download of it already has, would not fit in destDir
// with minFree to spare. When the room cannot be told, the download goes ahead.
func checkRoom(destDir string, offer ircparse.XDCCSendOfferEvent) error {
	if offer.Size <= 0 {
		return nil
	}
	need := offer.Size
	if st, err := os.Lstat(filepath.Join(destDir, safeFilename(offer.Filename))); err == nil && st.Mode().IsRegular() && st.Size() < offer.Size {
		need = offer.Size - st.Size()
	}
	free, _, err := freeSpace(destDir)
	if err != nil || free >= uint64(need)+minFree {
		return nil
	}
	return fmt.Errorf("not enough room in %s: %s free, and %s needs %s with %s kept free for the system",
		destDir, disk.Size(free), offer.Filename, disk.Size(uint64(need)), disk.Size(minFree))
}
