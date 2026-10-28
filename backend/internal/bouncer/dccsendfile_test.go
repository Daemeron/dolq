package bouncer

import (
	"encoding/binary"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// eventSub is a fakeSubscriber that also keeps the events.
type eventSub struct {
	fakeSubscriber
	emu    sync.Mutex
	events []XDCCTransferEvent
}

func (e *eventSub) SendEvent(serverID string, event any) {
	if ev, ok := event.(XDCCTransferEvent); ok {
		e.emu.Lock()
		e.events = append(e.events, ev)
		e.emu.Unlock()
	}
}

func (e *eventSub) last() XDCCTransferEvent {
	e.emu.Lock()
	defer e.emu.Unlock()
	if len(e.events) == 0 {
		return XDCCTransferEvent{}
	}
	return e.events[len(e.events)-1]
}

func writeTemp(t *testing.T, name string, data []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// offered reads the DCC SEND offer a sender made on the IRC connection and returns what it announced.
func offered(t *testing.T, line string) (name string, port int, size int64) {
	t.Helper()
	prefix, suffix := "PRIVMSG alice :\x01DCC SEND ", "\x01\r\n"
	if !strings.HasPrefix(line, prefix) || !strings.HasSuffix(line, suffix) {
		t.Fatalf("got %q, want a DCC SEND offer to alice", line)
	}
	f := strings.Fields(strings.TrimSuffix(strings.TrimPrefix(line, prefix), suffix))
	if len(f) != 4 {
		t.Fatalf("offer body = %q, want \"<name> <ip> <port> <size>\"", line)
	}
	port, _ = strconv.Atoi(f[2])
	size, _ = strconv.ParseInt(f[3], 10, 64)
	return f[0], port, size
}

// startSend offers path to alice from a goroutine (the pipe is synchronous, so the offer line has to be read) and
// returns the transfer id with the offer's port.
func startSend(t *testing.T, b *Bouncer, sub Subscriber, r interface{ ReadString(byte) (string, error) }, path string) (id string, port int) {
	t.Helper()
	idCh := make(chan string, 1)
	go func() {
		got, err := b.DCCSendFile("server-a", "alice", path, 0, 0, sub)
		if err != nil {
			t.Errorf("DCCSendFile: %v", err)
		}
		idCh <- got
	}()
	line, err := r.ReadString('\n')
	if err != nil {
		t.Fatalf("read offer: %v", err)
	}
	_, port, _ = offered(t, line)
	return <-idCh, port
}

func TestDCCSendFile(t *testing.T) {
	t.Run("offers the file, streams it to the peer that connects and reports it done", func(t *testing.T) {
		b := New(nil)
		sub := &eventSub{}
		_, r := pipeSession(t, b, "server-a", sub)
		data := []byte(strings.Repeat("dolq ", 40_000))
		path := writeTemp(t, "my notes.txt", data)

		idCh := make(chan string, 1)
		go func() {
			id, err := b.DCCSendFile("server-a", "alice", path, 0, 0, sub)
			if err != nil {
				t.Errorf("DCCSendFile: %v", err)
			}
			idCh <- id
		}()
		line, err := r.ReadString('\n')
		if err != nil {
			t.Fatalf("read offer: %v", err)
		}
		name, port, size := offered(t, line)
		if name != "my_notes.txt" {
			t.Errorf("announced name = %q, want spaces replaced", name)
		}
		if size != int64(len(data)) {
			t.Errorf("announced size = %d, want %d", size, len(data))
		}
		id := <-idCh
		if !strings.HasPrefix(id, "xdcc:") {
			t.Errorf("id = %q, want an xdcc: id so it can be cancelled like a download", id)
		}

		conn, err := net.Dial("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
		if err != nil {
			t.Fatalf("peer dial: %v", err)
		}
		defer conn.Close()
		got := make([]byte, 0, len(data))
		buf := make([]byte, 32*1024)
		for len(got) < len(data) {
			n, err := conn.Read(buf)
			got = append(got, buf[:n]...)
			var ack [4]byte
			binary.BigEndian.PutUint32(ack[:], uint32(len(got)))
			conn.Write(ack[:])
			if err != nil {
				break
			}
		}
		if string(got) != string(data) {
			t.Errorf("peer received %d bytes that differ from the file", len(got))
		}
		waitFor(t, func() bool { return sub.last().Done })
		last := sub.last()
		if !last.Sending || last.Received != int64(len(data)) || last.Total != int64(len(data)) || last.Path != path {
			t.Errorf("final event = %+v", last)
		}
		if !sub.sawStatus("connecting") || !sub.sawStatus("connected") || sub.lastStatus() != "disconnected" {
			t.Errorf("statuses = %v", sub.status)
		}
		if b.xdccTransfer(id) != nil {
			t.Error("a finished transfer should be forgotten")
		}
	})

	t.Run("can be cancelled while it waits for the peer", func(t *testing.T) {
		b := New(nil)
		sub := &eventSub{}
		_, r := pipeSession(t, b, "server-a", sub)
		path := writeTemp(t, "a.bin", []byte("x"))
		id, _ := startSend(t, b, sub, r, path)
		if err := b.XDCCClose(id); err != nil {
			t.Fatal(err)
		}
		waitFor(t, func() bool { return sub.last().Error != "" })
		if e := sub.last(); e.Error != "cancelled" || !e.Sending {
			t.Errorf("event = %+v, want a cancelled send", e)
		}
	})

	t.Run("fails when the peer never connects", func(t *testing.T) {
		b := New(nil)
		b.DCCAcceptTimeout = 50 * time.Millisecond
		sub := &eventSub{}
		_, r := pipeSession(t, b, "server-a", sub)
		path := writeTemp(t, "a.bin", []byte("x"))
		startSend(t, b, sub, r, path)
		waitFor(t, func() bool { return sub.last().Error != "" })
		if sub.lastStatus() != "disconnected" {
			t.Errorf("status = %q", sub.lastStatus())
		}
	})

	t.Run("fails and says so when the peer drops the connection part way", func(t *testing.T) {
		b := New(nil)
		sub := &eventSub{}
		_, r := pipeSession(t, b, "server-a", sub)
		path := writeTemp(t, "big.bin", make([]byte, 16<<20))
		_, port := startSend(t, b, sub, r, path)
		conn, err := net.Dial("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
		if err != nil {
			t.Fatal(err)
		}
		io.ReadFull(conn, make([]byte, 1024))
		conn.Close()
		waitFor(t, func() bool { return sub.last().Error != "" })
	})

	t.Run("refuses what it cannot send, before offering anything", func(t *testing.T) {
		b := New(nil)
		sub := &eventSub{}
		pipeSession(t, b, "server-a", sub)
		dir := t.TempDir()
		for name, path := range map[string]string{
			"missing":   filepath.Join(dir, "nope"),
			"directory": dir,
			"empty":     writeTemp(t, "empty", nil),
		} {
			if _, err := b.DCCSendFile("server-a", "alice", path, 0, 0, sub); err == nil {
				t.Errorf("%s: expected an error", name)
			}
		}
		if _, err := b.DCCSendFile("nope", "alice", writeTemp(t, "f", []byte("x")), 0, 0, sub); err == nil {
			t.Error("no session: expected an error")
		}
	})
}

func TestOfferName(t *testing.T) {
	for in, want := range map[string]string{
		"/tmp/a b.iso":    "a_b.iso",
		`/tmp/say "hi".t`: "say__hi_.t",
		"/tmp/plain.bin":  "plain.bin",
	} {
		if got := offerName(in); got != want {
			t.Errorf("offerName(%q) = %q, want %q", in, got, want)
		}
	}
}
