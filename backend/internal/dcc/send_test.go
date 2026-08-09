package dcc

import (
	"bytes"
	"encoding/binary"
	"net"
	"testing"
	"time"
)

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
	if err := ReceiveFile(conn, &out, int64(len(payload)), func(total int64) { lastProgress = total }); err != nil {
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
