package bouncer

import (
	"errors"
	"fmt"
	"log"
	"math"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Daemeron/dolq/backend/internal/dcc"
	"github.com/google/uuid"
)

// DefaultSendConfirmTimeout is how long a finished upload waits for the peer's last acknowledgement.
const DefaultSendConfirmTimeout = 30 * time.Second

// offerName is the file's name as it goes into a DCC SEND offer, which has no room for spaces or quotes.
func offerName(path string) string {
	name := strings.Map(func(r rune) rune {
		if r == ' ' || r == '"' || r < 0x20 {
			return '_'
		}
		return r
	}, filepath.Base(path))
	return name
}

// DCCSendFile offers the file at path to nick and, once nick connects, streams it. It listens for the peer (an
// active DCC SEND), so the peer must be able to reach this machine. The transfer is cancelled with XDCCClose.
func (b *Bouncer) DCCSendFile(serverID, nick, path string, portMin, portMax int, sub Subscriber) (string, error) {
	b.mu.Lock()
	sess := b.sessions[serverID]
	b.mu.Unlock()
	if sess == nil {
		return "", fmt.Errorf("bouncer: no session for %q", serverID)
	}
	sess.mu.Lock()
	client := sess.client
	sess.mu.Unlock()

	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return "", err
	}
	if !info.Mode().IsRegular() {
		f.Close()
		return "", fmt.Errorf("bouncer: %s is not a file", filepath.Base(path))
	}
	size := info.Size()
	if size == 0 || size > math.MaxUint32 {
		f.Close()
		return "", fmt.Errorf("bouncer: %s cannot be sent over DCC (it must be between 1 byte and 4 GiB)", filepath.Base(path))
	}

	ln, err := dcc.Listen(portMin, portMax)
	if err != nil {
		f.Close()
		return "", err
	}
	ip, err := dcc.LocalIP()
	if err != nil {
		ln.Close()
		f.Close()
		return "", err
	}

	id := "xdcc:" + uuid.NewString()
	t := &xdccTransfer{pause: dcc.NewPauseGate(), ln: ln}
	b.dccMu.Lock()
	b.xdccConns[id] = t
	b.dccMu.Unlock()

	name := offerName(path)
	port := ln.Addr().(*net.TCPAddr).Port
	line := fmt.Sprintf("PRIVMSG %s :\x01DCC SEND %s %d %d %d\x01", nick, name, dcc.EncodeIP(ip), port, size)
	if err := client.SendPaced(line); err != nil {
		b.dccMu.Lock()
		delete(b.xdccConns, id)
		b.dccMu.Unlock()
		ln.Close()
		f.Close()
		return "", err
	}

	sub.SendStatus(id, "connecting")
	sub.SendEvent(id, XDCCTransferEvent{Type: "XDCCTRANSFER", Total: size, Path: path, Sending: true})
	go b.runDCCSendFile(id, serverID, nick, name, path, size, t, ln, f, sub)
	return id, nil
}

func (b *Bouncer) runDCCSendFile(
	id, serverID, nick, name, path string, size int64, t *xdccTransfer, ln net.Listener, f *os.File, sub Subscriber,
) {
	defer f.Close()
	forget := func() {
		b.dccMu.Lock()
		delete(b.xdccConns, id)
		b.dccMu.Unlock()
	}
	fail := func(err error) {
		forget()
		log.Printf("bouncer: DCC send %s to %s: %v", name, nick, err)
		sub.SendStatus(id, "disconnected")
		sub.SendEvent(id, XDCCTransferEvent{Type: "XDCCTRANSFER", Total: size, Path: path, Error: err.Error(), Sending: true})
		b.recordTransfer(serverID, nick, fmt.Sprintf("Sending %s failed: %s", name, err))
	}

	conn, err := dcc.AcceptOnceRaw(ln, b.DCCAcceptTimeout)
	b.dccMu.Lock()
	cancelled := t.cancelled
	if err == nil && !cancelled {
		t.conn = conn
	}
	b.dccMu.Unlock()
	if err == nil && cancelled {
		conn.Close()
	}
	if cancelled {
		err = errors.New("cancelled")
	}
	if err != nil {
		fail(err)
		return
	}
	defer conn.Close()

	sub.SendStatus(id, "connected")
	last := time.Now()
	err = dcc.SendFile(conn, f, size, b.SendConfirmTimeout, func(sent int64) {
		if sent < size && time.Since(last) < progressInterval {
			return
		}
		last = time.Now()
		sub.SendEvent(id, XDCCTransferEvent{Type: "XDCCTRANSFER", Received: sent, Total: size, Path: path, Sending: true})
	})
	if err != nil {
		b.dccMu.Lock()
		wasCancelled := t.cancelled
		b.dccMu.Unlock()
		if wasCancelled {
			err = errors.New("cancelled")
		}
		fail(err)
		return
	}
	forget()
	sub.SendStatus(id, "disconnected")
	sub.SendEvent(id, XDCCTransferEvent{Type: "XDCCTRANSFER", Received: size, Total: size, Path: path, Done: true, Sending: true})
	b.recordTransfer(serverID, nick, fmt.Sprintf("Sent %s", name))
}
