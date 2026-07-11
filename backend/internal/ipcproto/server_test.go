package ipcproto

import (
	"bufio"
	"encoding/json"
	"io"
	"net"
	"os"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/Daemeron/dolq/backend/internal/bouncer"
)

func startTestServer(t *testing.T) string {
	t.Helper()
	// A short, flat name under os.TempDir() rather than t.TempDir(): Unix
	// domain socket paths have an OS-level length limit (~104 bytes on
	// macOS) that t.TempDir()'s nested, test-name-embedding paths blow past.
	f, err := os.CreateTemp("", "dolq-*.sock")
	if err != nil {
		t.Fatalf("create temp path: %v", err)
	}
	path := f.Name()
	f.Close()
	os.Remove(path) // Listen() creates the actual socket file at this path

	ln, err := Listen(path)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	go NewServer(bouncer.New(nil)).Serve(ln)
	t.Cleanup(func() {
		ln.Close()
		os.Remove(path)
	})
	return path
}

// testClient dials the local IPC socket under test and gives back helpers
// for sending frames and reading responses.
type testClient struct {
	conn net.Conn
	r    *bufio.Reader
}

func dialTestClient(t *testing.T, path string) *testClient {
	t.Helper()
	conn, err := net.Dial("unix", path)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return &testClient{conn: conn, r: bufio.NewReader(conn)}
}

func (tc *testClient) send(t *testing.T, f ClientFrame) {
	t.Helper()
	b, err := json.Marshal(f)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if _, err := tc.conn.Write(append(b, '\n')); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func (tc *testClient) recv(t *testing.T) ServerFrame {
	t.Helper()
	type result struct {
		line string
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		line, err := tc.r.ReadString('\n')
		ch <- result{line, err}
	}()
	select {
	case res := <-ch:
		if res.err != nil {
			t.Fatalf("read: %v", res.err)
		}
		var f ServerFrame
		if err := json.Unmarshal([]byte(res.line), &f); err != nil {
			t.Fatalf("unmarshal %q: %v", res.line, err)
		}
		return f
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for a frame")
		return ServerFrame{}
	}
}

func TestGetStatusAndJoinedChannelsForUnknownServer(t *testing.T) {
	tc := dialTestClient(t, startTestServer(t))

	tc.send(t, ClientFrame{ID: "1", Action: ActionGetStatus, ServerID: "nope"})
	want := ServerFrame{ID: "1", Type: FrameResult, OK: true, Status: "disconnected"}
	if got := tc.recv(t); !reflect.DeepEqual(got, want) {
		t.Errorf("got %#v want %#v", got, want)
	}

	tc.send(t, ClientFrame{ID: "2", Action: ActionGetJoinedChannels, ServerID: "nope"})
	want = ServerFrame{ID: "2", Type: FrameResult, OK: true}
	if got := tc.recv(t); !reflect.DeepEqual(got, want) {
		t.Errorf("got %#v want %#v", got, want)
	}
}

func TestSendToUnknownServerReturnsAnError(t *testing.T) {
	tc := dialTestClient(t, startTestServer(t))

	tc.send(t, ClientFrame{ID: "1", Action: ActionSend, ServerID: "nope", Line: "PRIVMSG #x :hi"})
	got := tc.recv(t)
	if got.OK || got.Error == "" {
		t.Errorf("expected a failed result with an error message, got %#v", got)
	}
}

func TestMalformedFrameReturnsAnError(t *testing.T) {
	tc := dialTestClient(t, startTestServer(t))

	if _, err := tc.conn.Write([]byte("not json\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	if got := tc.recv(t); got.OK {
		t.Errorf("expected ok=false for malformed input, got %#v", got)
	}
}

func TestUnknownActionReturnsAnError(t *testing.T) {
	tc := dialTestClient(t, startTestServer(t))

	tc.send(t, ClientFrame{ID: "1", Action: "doSomethingElse"})
	if got := tc.recv(t); got.OK {
		t.Errorf("expected ok=false, got %#v", got)
	}
}

func TestMultipleConnectionsAreIndependent(t *testing.T) {
	path := startTestServer(t)
	tc1 := dialTestClient(t, path)
	tc2 := dialTestClient(t, path)

	tc1.send(t, ClientFrame{ID: "a", Action: ActionGetStatus, ServerID: "x"})
	tc2.send(t, ClientFrame{ID: "b", Action: ActionGetStatus, ServerID: "y"})

	got1, got2 := tc1.recv(t), tc2.recv(t)
	if got1.ID != "a" || got2.ID != "b" {
		t.Errorf("id mismatch: got1=%q got2=%q", got1.ID, got2.ID)
	}
}

// TestConnectEndToEnd exercises the whole path: a "connect" frame over the
// Unix socket drives a real ircclient.Dial to a fake IRC server on loopback
// TCP, and that fake server's traffic fans back out as "line" frames.
func TestConnectEndToEnd(t *testing.T) {
	fakeIRC, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer fakeIRC.Close()
	go func() {
		conn, err := fakeIRC.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		r := bufio.NewReader(conn)
		for i := 0; i < 3; i++ { // PASS/NICK/USER
			if _, err := r.ReadString('\n'); err != nil {
				return
			}
		}
		conn.Write([]byte(":irc.example.net 001 testnick :Welcome\r\n"))
		io.Copy(io.Discard, r) // keep the connection open
	}()

	tc := dialTestClient(t, startTestServer(t))
	host, portStr, _ := net.SplitHostPort(fakeIRC.Addr().String())
	port, _ := strconv.Atoi(portStr)

	tc.send(t, ClientFrame{
		ID: "1", Action: ActionConnect, ServerID: "s1",
		Host: host, Port: port, Nick: "testnick", Secure: false,
	})
	if result := tc.recv(t); !result.OK || result.ID != "1" {
		t.Fatalf("connect result: %#v", result)
	}

	want := ServerFrame{Type: FrameLine, ServerID: "s1", Line: ":irc.example.net 001 testnick :Welcome"}
	if got := tc.recv(t); !reflect.DeepEqual(got, want) {
		t.Errorf("got %#v want %#v", got, want)
	}
}
