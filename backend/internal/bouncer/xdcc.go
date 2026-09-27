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

type XDCCTransferEvent struct {
	Type     string `json:"type"`
	Received int64  `json:"received"`
	Total    int64  `json:"total"`
	Path     string `json:"path"`
	Done     bool   `json:"done,omitempty"`
	Error    string `json:"error,omitempty"`
}

const progressInterval = 250 * time.Millisecond

type xdccTransfer struct {
	conn  net.Conn
	pause *dcc.PauseGate
}

const DefaultResumeAcceptTimeout = 10 * time.Second

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

func (b *Bouncer) XDCCClose(id string) error {
	t := b.xdccTransfer(id)
	if t == nil {
		return nil
	}
	t.pause.Resume()
	return t.conn.Close()
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
		t.pause.Resume()
		t.conn.Close()
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
		if _, err := os.Stat(path); os.IsNotExist(err) {
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
