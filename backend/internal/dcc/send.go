package dcc

import (
	"encoding/binary"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
)

// SendOffer is a parsed CTCP "DCC SEND" request - see ParseSendOffer.
type SendOffer struct {
	Filename string
	IP       string
	Port     int // 0 means passive/reverse: the sender can't accept a connection (usually NAT), so accepting means listening ourselves and telling them our address instead - see bouncer.XDCCAccept.
	Size     int64
	Token    string // only set for a passive offer, echoed back so the sender can match our reply to it
}

// ParseSendOffer parses a CTCP DCC SEND request's param: "SEND <filename>
// <ip> <port> <size> [token]". Filename is double-quoted if it contains
// spaces (the common convention among bots whose packs have space-
// containing names) - unquoted otherwise. IP is the same big-endian-
// uint32-decimal wire convention DCC CHAT uses (see DecodeIP).
func ParseSendOffer(param string) (SendOffer, bool) {
	rest, ok := strings.CutPrefix(param, "SEND ")
	if !ok {
		return SendOffer{}, false
	}
	rest = strings.TrimSpace(rest)

	var filename string
	if strings.HasPrefix(rest, `"`) {
		end := strings.IndexByte(rest[1:], '"')
		if end < 0 {
			return SendOffer{}, false
		}
		filename, rest = rest[1:1+end], strings.TrimSpace(rest[1+end+1:])
	} else if sp := strings.IndexByte(rest, ' '); sp >= 0 {
		filename, rest = rest[:sp], strings.TrimSpace(rest[sp+1:])
	} else {
		return SendOffer{}, false
	}

	fields := strings.Fields(rest)
	if len(fields) < 3 {
		return SendOffer{}, false
	}
	ipNum, err := strconv.ParseUint(fields[0], 10, 32)
	if err != nil {
		return SendOffer{}, false
	}
	port, err := strconv.Atoi(fields[1])
	if err != nil {
		return SendOffer{}, false
	}
	size, err := strconv.ParseInt(fields[2], 10, 64)
	if err != nil {
		return SendOffer{}, false
	}
	offer := SendOffer{Filename: filename, IP: DecodeIP(uint32(ipNum)).String(), Port: port, Size: size}
	if len(fields) >= 4 {
		offer.Token = fields[3]
	}
	return offer, true
}

// PauseGate lets a caller pause and resume a ReceiveFile transfer in
// progress without closing the underlying connection. Pausing doesn't send
// anything - it just stops reading, and TCP's own flow control does the
// rest: the sender's writes back up and block on their end automatically,
// no protocol-level "pause" message DCC has ever had. The zero value isn't
// usable - construct with NewPauseGate.
type PauseGate struct {
	mu     sync.Mutex
	paused bool
	resume chan struct{}
}

func NewPauseGate() *PauseGate {
	return &PauseGate{resume: make(chan struct{})}
}

func (g *PauseGate) Pause() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.paused = true
}

func (g *PauseGate) Resume() {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.paused {
		g.paused = false
		close(g.resume)
		g.resume = make(chan struct{})
	}
}

// wait blocks for as long as the gate is paused at the moment it's called -
// checked once per chunk in ReceiveFile's loop, not mid-read (a single
// conn.Read call is never long enough to matter).
func (g *PauseGate) wait() {
	g.mu.Lock()
	paused, ch := g.paused, g.resume
	g.mu.Unlock()
	if paused {
		<-ch
	}
}

// ReceiveFile copies exactly size bytes from conn into w, calling
// onProgress after each chunk with the running total. After each chunk it
// also writes a 4-byte big-endian running total back to conn - the original
// DCC SEND spec's own flow-control/completion ack, which most bot software
// still expects even though TCP already provides flow control on its own.
// That 4-byte width is a real ceiling inherited from the spec (wraps past
// 4GB); not worked around here since a receiver-side ack format is only
// useful if the sender speaks the same extension, which isn't something
// this client controls. pause may be nil (never pauses).
func ReceiveFile(conn net.Conn, w io.Writer, size int64, pause *PauseGate, onProgress func(total int64)) error {
	buf := make([]byte, 64*1024)
	var total int64
	for total < size {
		if pause != nil {
			pause.wait()
		}
		n, err := conn.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return werr
			}
			total += int64(n)
			var ack [4]byte
			binary.BigEndian.PutUint32(ack[:], uint32(total))
			if _, werr := conn.Write(ack[:]); werr != nil {
				return werr
			}
			if onProgress != nil {
				onProgress(total)
			}
		}
		if err != nil {
			if err == io.EOF && total == size {
				break
			}
			return err
		}
	}
	return nil
}
