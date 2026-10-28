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

func TestReceiveFile(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	payload := bytes.Repeat([]byte("hello world "), 1000)
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

func TestReceiveFilePause(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	payload := bytes.Repeat([]byte("x"), 256*1024)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		conn.Write(payload)
		io.Copy(io.Discard, conn)
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

func TestParseResumeAcceptRejectsMalformedReplies(t *testing.T) {
	for _, param := range []string{
		"SEND file 1 2",                // not an ACCEPT
		`ACCEPT "unterminated 5000 10`, // quote never closes
		"ACCEPT file",                  // no fields at all
		"ACCEPT file 5000",             // position missing
		"ACCEPT file port 10",          // port not a number
		"ACCEPT file 5000 pos",         // position not a number
		"ACCEPT",                       // nothing
	} {
		if got, ok := ParseResumeAccept(param); ok {
			t.Errorf("ParseResumeAccept(%q) = %+v, want it rejected", param, got)
		}
	}
}

func TestParseResumeAcceptReadsAQuotedNameAndAToken(t *testing.T) {
	got, ok := ParseResumeAccept(`ACCEPT "my file.iso" 5000 1024 tok`)
	if !ok || got.Filename != "my file.iso" || got.Port != 5000 || got.Position != 1024 || got.Token != "tok" {
		t.Errorf("got %+v, ok %v", got, ok)
	}
}

func TestDialFailsForAnAddressNobodyListensOn(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	if _, err := Dial("127.0.0.1", port); err == nil {
		t.Error("Dial to a closed port succeeded")
	}
}

type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) { return 0, io.ErrShortWrite }

func TestReceiveFileStopsWhenTheDiskWriteFails(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	go server.Write([]byte("data"))
	if err := ReceiveFile(client, failingWriter{}, 0, 4, nil, nil); err != io.ErrShortWrite {
		t.Errorf("err = %v, want the write error", err)
	}
}

func TestReceiveFileReportsAPeerThatHangsUpEarly(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	go func() {
		server.Write([]byte("par"))
		// ack read so the writer doesn't block on the pipe
		buf := make([]byte, 4)
		server.Read(buf)
		server.Close()
	}()
	var out bytes.Buffer
	if err := ReceiveFile(client, &out, 0, 10, nil, nil); err == nil {
		t.Error("a short transfer was reported as complete")
	}
	if out.String() != "par" {
		t.Errorf("wrote %q before the hang-up", out.String())
	}
}

func TestParseSendOfferRejectsMalformedOffers(t *testing.T) {
	for _, param := range []string{
		"CHAT chat 1 2",               // not a SEND
		`SEND "unterminated 1 2 3`,    // quote never closes
		"SEND file",                   // no fields
		"SEND file 3232235777 5000",   // size missing
		"SEND file notanip 5000 10",   // ip not a number
		"SEND file 3232235777 x 10",   // port not a number
		"SEND file 3232235777 5000 x", // size not a number
	} {
		if got, ok := ParseSendOffer(param); ok {
			t.Errorf("ParseSendOffer(%q) = %+v, want it rejected", param, got)
		}
	}
}
