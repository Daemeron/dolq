package dcc

import (
	"bytes"
	"encoding/binary"
	"io"
	"net"
	"testing"
	"time"
)

func TestParseResumeAccept(t *testing.T) {
	cases := []struct {
		name  string
		param string
		want  ResumeAccept
		ok    bool
	}{
		{
			"active, unquoted filename",
			"ACCEPT file.txt 5000 1024",
			ResumeAccept{Filename: "file.txt", Port: 5000, Position: 1024}, true,
		},
		{
			"passive, quoted filename with a space, and a token",
			`ACCEPT "my file.txt" 0 1024 7`,
			ResumeAccept{Filename: "my file.txt", Position: 1024, Token: "7"}, true,
		},
		{"not an ACCEPT at all", "SEND file.txt 3232235777 5000 1024", ResumeAccept{}, false},
		{"too few fields", "ACCEPT file.txt 5000", ResumeAccept{}, false},
		{"non-numeric position", "ACCEPT file.txt 5000 notaposition", ResumeAccept{}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := ParseResumeAccept(c.param)
			if ok != c.ok {
				t.Fatalf("ok = %v, want %v", ok, c.ok)
			}
			if ok && got != c.want {
				t.Fatalf("got %+v, want %+v", got, c.want)
			}
		})
	}
}

func TestParseSendOffer(t *testing.T) {
	cases := []struct {
		name  string
		param string
		want  SendOffer
		ok    bool
	}{
		{
			"active, unquoted filename",
			"SEND file.txt 3232235777 5000 1024",
			SendOffer{Filename: "file.txt", IP: "192.168.1.1", Port: 5000, Size: 1024}, true,
		},
		{
			"passive, quoted filename with a space, and a token",
			`SEND "my file.txt" 3232235777 0 1024 7`,
			SendOffer{Filename: "my file.txt", IP: "192.168.1.1", Size: 1024, Token: "7"}, true,
		},
		{"not a SEND at all", "CHAT chat 3232235777 5000", SendOffer{}, false},
		{"too few fields", "SEND file.txt 3232235777", SendOffer{}, false},
		{"non-numeric ip", "SEND file.txt notanip 5000 1024", SendOffer{}, false},
		{"unterminated quote", `SEND "file.txt 3232235777 5000 1024`, SendOffer{}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := ParseSendOffer(c.param)
			if ok != c.ok {
				t.Fatalf("ok = %v, want %v", ok, c.ok)
			}
			if ok && got != c.want {
				t.Fatalf("got %+v, want %+v", got, c.want)
			}
		})
	}
}

// TestReceiveFile checks the happy path end to end over a real loopback
// connection: every byte sent arrives in order, onProgress reports the
// final total, and a 4-byte big-endian running-total ack comes back after
// each chunk - the flow-control convention most XDCC bot software still
// expects.
func TestReceiveFile(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	payload := bytes.Repeat([]byte("hello world "), 1000) // spans multiple 64KB-buffer reads on the sender side too
	ackCh := make(chan uint32, 32)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		conn.Write(payload)
		for {
			var ack [4]byte
			if _, err := conn.Read(ack[:]); err != nil {
				return
			}
			ackCh <- binary.BigEndian.Uint32(ack[:])
		}
	}()

	conn, err := net.DialTimeout("tcp", ln.Addr().String(), time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	var out bytes.Buffer
	var lastProgress int64
	if err := ReceiveFile(conn, &out, 0, int64(len(payload)), nil, func(total int64) { lastProgress = total }); err != nil {
		t.Fatalf("ReceiveFile: %v", err)
	}
	if !bytes.Equal(out.Bytes(), payload) {
		t.Fatalf("received %d bytes, want %d bytes matching the payload", out.Len(), len(payload))
	}
	if lastProgress != int64(len(payload)) {
		t.Fatalf("final onProgress total = %d, want %d", lastProgress, len(payload))
	}

	select {
	case ack := <-ackCh:
		if ack == 0 || ack > uint32(len(payload)) {
			t.Fatalf("got a nonsense ack %d", ack)
		}
	case <-time.After(time.Second):
		t.Fatal("no ack ever arrived")
	}
}

// TestReceiveFileResume checks a non-zero base: only the bytes the sender
// actually writes count toward size, acks/onProgress report the file's
// absolute position (base-relative, not just what this call wrote), and w
// only ever receives the resumed portion - the caller (openDestination) is
// the one responsible for w already containing the first base bytes.
func TestReceiveFileResume(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	const base = 1024
	rest := bytes.Repeat([]byte("y"), 4096)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		conn.Write(rest)
		io.Copy(io.Discard, conn)
	}()

	conn, err := net.DialTimeout("tcp", ln.Addr().String(), time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	var out bytes.Buffer
	var lastProgress int64
	size := int64(base + len(rest))
	if err := ReceiveFile(conn, &out, base, size, nil, func(total int64) { lastProgress = total }); err != nil {
		t.Fatalf("ReceiveFile: %v", err)
	}
	if !bytes.Equal(out.Bytes(), rest) {
		t.Fatalf("w received %d bytes, want exactly the %d-byte resumed portion", out.Len(), len(rest))
	}
	if lastProgress != size {
		t.Fatalf("final onProgress total = %d, want %d (base + resumed bytes)", lastProgress, size)
	}
}

// TestReceiveFilePause checks that a paused transfer genuinely stops making
// progress until Resume, rather than just racing ahead regardless.
func TestReceiveFilePause(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	payload := bytes.Repeat([]byte("x"), 256*1024) // several 64KB chunks
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		conn.Write(payload)
		io.Copy(io.Discard, conn) // drain acks, otherwise a full send buffer could stall the sender
	}()

	conn, err := net.DialTimeout("tcp", ln.Addr().String(), time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	gate := NewPauseGate()
	gate.Pause()

	done := make(chan error, 1)
	var out bytes.Buffer
	go func() { done <- ReceiveFile(conn, &out, 0, int64(len(payload)), gate, nil) }()

	select {
	case err := <-done:
		t.Fatalf("ReceiveFile finished while paused (err=%v) - pause did not hold it up", err)
	case <-time.After(100 * time.Millisecond):
	}

	gate.Resume()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("ReceiveFile: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("ReceiveFile never finished after Resume")
	}
	if out.Len() != len(payload) {
		t.Fatalf("got %d bytes, want %d", out.Len(), len(payload))
	}
}
