package dcc

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"math/rand"
	"net"
	"strings"
	"testing"
	"time"
)

func tcpPair(t *testing.T) (sender, peer net.Conn) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	accepted := make(chan net.Conn, 1)
	go func() {
		c, _ := ln.Accept()
		accepted <- c
	}()
	sender, err = net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	peer = <-accepted
	t.Cleanup(func() { sender.Close(); peer.Close() })
	return sender, peer
}

func sampleFile(n int) []byte {
	b := make([]byte, n)
	rand.New(rand.NewSource(1)).Read(b)
	return b
}

func TestSendFile(t *testing.T) {
	t.Run("streams the file, reports progress and finishes once the peer acknowledges every byte", func(t *testing.T) {
		data := sampleFile(300_000)
		sender, peer := tcpPair(t)

		var got bytes.Buffer
		recvErr := make(chan error, 1)
		go func() { recvErr <- ReceiveFile(peer, &got, 0, int64(len(data)), nil, nil) }()

		var last int64
		err := SendFile(sender, bytes.NewReader(data), int64(len(data)), 5*time.Second, func(sent int64) { last = sent })
		if err != nil {
			t.Fatalf("SendFile: %v", err)
		}
		if err := <-recvErr; err != nil {
			t.Fatalf("ReceiveFile: %v", err)
		}
		if !bytes.Equal(got.Bytes(), data) {
			t.Error("the peer received different bytes")
		}
		if last != int64(len(data)) {
			t.Errorf("last progress = %d, want %d", last, len(data))
		}
	})

	t.Run("counts a peer that closes without a last acknowledgement as done", func(t *testing.T) {
		data := sampleFile(10_000)
		sender, peer := tcpPair(t)
		go func() {
			io.ReadFull(peer, make([]byte, len(data)))
			peer.Close()
		}()
		if err := SendFile(sender, bytes.NewReader(data), int64(len(data)), 5*time.Second, nil); err != nil {
			t.Errorf("SendFile: %v", err)
		}
	})

	t.Run("gives up on a peer that reads everything but never confirms", func(t *testing.T) {
		data := sampleFile(10_000)
		sender, peer := tcpPair(t)
		go io.Copy(io.Discard, peer)
		err := SendFile(sender, bytes.NewReader(data), int64(len(data)), 50*time.Millisecond, nil)
		if err == nil || !strings.Contains(err.Error(), "did not confirm") {
			t.Errorf("got %v, want a missing confirmation", err)
		}
	})

	t.Run("fails when the peer goes away mid-transfer", func(t *testing.T) {
		data := sampleFile(8 << 20)
		sender, peer := tcpPair(t)
		go func() {
			io.ReadFull(peer, make([]byte, 1024))
			peer.Close()
		}()
		if err := SendFile(sender, bytes.NewReader(data), int64(len(data)), time.Second, nil); err == nil {
			t.Error("expected an error")
		}
	})

	t.Run("fails when the file is shorter than announced, or cannot be read", func(t *testing.T) {
		sender, peer := tcpPair(t)
		go io.Copy(io.Discard, peer)
		err := SendFile(sender, bytes.NewReader(sampleFile(100)), 200, time.Second, nil)
		if err == nil || !strings.Contains(err.Error(), "ended after 100 of 200") {
			t.Errorf("short file: got %v", err)
		}
		sender2, peer2 := tcpPair(t)
		go io.Copy(io.Discard, peer2)
		boom := errors.New("disk gone")
		if err := SendFile(sender2, errReader{boom}, 10, time.Second, nil); !errors.Is(err, boom) {
			t.Errorf("read error: got %v", err)
		}
	})

	t.Run("refuses sizes it cannot acknowledge", func(t *testing.T) {
		sender, _ := tcpPair(t)
		for _, size := range []int64{0, -1, 1 << 32} {
			if err := SendFile(sender, bytes.NewReader(nil), size, time.Second, nil); err == nil {
				t.Errorf("size %d: expected an error", size)
			}
		}
	})

	t.Run("accepts a final acknowledgement that arrives after the data", func(t *testing.T) {
		data := sampleFile(5000)
		sender, peer := tcpPair(t)
		go func() {
			io.ReadFull(peer, make([]byte, len(data)))
			time.Sleep(30 * time.Millisecond)
			var ack [4]byte
			binary.BigEndian.PutUint32(ack[:], uint32(len(data)))
			peer.Write(ack[:])
			io.Copy(io.Discard, peer)
		}()
		if err := SendFile(sender, bytes.NewReader(data), int64(len(data)), 5*time.Second, nil); err != nil {
			t.Errorf("SendFile: %v", err)
		}
	})
}

type errReader struct{ err error }

func (e errReader) Read([]byte) (int, error) { return 0, e.err }
