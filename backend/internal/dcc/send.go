package dcc

import (
	"encoding/binary"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
)

type SendOffer struct {
	Filename string
	IP       string
	Port     int
	Size     int64
	Token    string
}

func ParseSendOffer(param string) (SendOffer, bool) {
	rest, ok := strings.CutPrefix(param, "SEND ")
	if !ok {
		return SendOffer{}, false
	}
	filename, rest, ok := cutFilename(rest)
	if !ok {
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

type ResumeAccept struct {
	Filename string
	Port     int
	Position int64
	Token    string
}

func ParseResumeAccept(param string) (ResumeAccept, bool) {
	rest, ok := strings.CutPrefix(param, "ACCEPT ")
	if !ok {
		return ResumeAccept{}, false
	}
	filename, rest, ok := cutFilename(rest)
	if !ok {
		return ResumeAccept{}, false
	}

	fields := strings.Fields(rest)
	if len(fields) < 2 {
		return ResumeAccept{}, false
	}
	port, err := strconv.Atoi(fields[0])
	if err != nil {
		return ResumeAccept{}, false
	}
	position, err := strconv.ParseInt(fields[1], 10, 64)
	if err != nil {
		return ResumeAccept{}, false
	}
	accept := ResumeAccept{Filename: filename, Port: port, Position: position}
	if len(fields) >= 3 {
		accept.Token = fields[2]
	}
	return accept, true
}

func cutFilename(rest string) (filename, remainder string, ok bool) {
	rest = strings.TrimSpace(rest)
	if strings.HasPrefix(rest, `"`) {
		end := strings.IndexByte(rest[1:], '"')
		if end < 0 {
			return "", "", false
		}
		return rest[1 : 1+end], strings.TrimSpace(rest[1+end+1:]), true
	}
	if name, remainder, found := strings.Cut(rest, " "); found {
		return name, strings.TrimSpace(remainder), true
	}
	return "", "", false
}

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

func (g *PauseGate) wait() {
	g.mu.Lock()
	paused, ch := g.paused, g.resume
	g.mu.Unlock()
	if paused {
		<-ch
	}
}

func ReceiveFile(conn net.Conn, w io.Writer, base, size int64, pause *PauseGate, onProgress func(total int64)) error {
	buf := make([]byte, 64*1024)
	total := base
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
