package ipcproto

import (
	"bufio"
	"encoding/json"
	"io"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Daemeron/dolq/backend/internal/bouncer"
)

func startTestServer(t *testing.T) string {
	t.Helper()
	return startServerWith(t, NewServer(bouncer.New(nil)))
}

func startServerWith(t *testing.T, s *Server) string {
	t.Helper()
	f, err := os.CreateTemp("", "dolq-*.sock")
	if err != nil {
		t.Fatalf("create temp path: %v", err)
	}
	path := f.Name()
	f.Close()
	os.Remove(path)

	ln, err := Listen("unix", path)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	go s.Serve(ln)
	t.Cleanup(func() {
		ln.Close()
		os.Remove(path)
	})
	return path
}

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

func TestGetInfoDescribesTheBackend(t *testing.T) {
	dir := t.TempDir()
	s := NewServer(bouncer.New(nil)).About("9.9.9", Folder{"data", dir}, Folder{"gone", filepath.Join(dir, "nope")})
	path := startServerWith(t, s)
	first, second := dialTestClient(t, path), dialTestClient(t, path)

	first.send(t, ClientFrame{ID: "1", Action: ActionGetInfo})
	if got := first.recv(t); !got.OK || got.Info == nil {
		t.Fatalf("expected an info result, got %#v", got)
	}
	second.send(t, ClientFrame{ID: "2", Action: ActionGetInfo})
	got := second.recv(t)
	info := got.Info
	if !got.OK || info == nil {
		t.Fatalf("expected an info result, got %#v", got)
	}
	if info.Version != "9.9.9" || info.Clients != 2 || info.Sessions != 0 || info.Transfers != 0 {
		t.Errorf("unexpected info %#v", info)
	}
	if info.UptimeMs < 0 || info.UptimeMs > 5000 {
		t.Errorf("a server that has just started has been up for %d ms", info.UptimeMs)
	}
	if len(info.Folders) != 2 {
		t.Fatalf("expected both folders, got %#v", info.Folders)
	}
	if f := info.Folders[0]; f.Name != "data" || f.Path != dir || f.Total == 0 || f.Free > f.Total || f.Error != "" {
		t.Errorf("the folder that exists should report its room, got %#v", f)
	}
	if f := info.Folders[1]; f.Error == "" || f.Total != 0 {
		t.Errorf("a folder that is not there should say why, got %#v", f)
	}
}

func TestGetInfoDoesNotWaitForAFolderThatStalls(t *testing.T) {
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	s := NewServer(bouncer.New(nil)).About("1", Folder{"share", "/stalled"})
	s.roomFirstWait = 50 * time.Millisecond
	s.freeSpace = func(string) (uint64, uint64, error) {
		<-release // a network share that does not answer
		return 1, 2, nil
	}
	tc := dialTestClient(t, startServerWith(t, s))

	for i, id := range []string{"1", "2"} {
		start := time.Now()
		tc.send(t, ClientFrame{ID: id, Action: ActionGetInfo})
		got := tc.recv(t)
		if !got.OK || got.Info == nil || got.Info.Version != "1" {
			t.Fatalf("call %d: expected an info result, got %#v", i+1, got)
		}
		if len(got.Info.Folders) != 0 {
			t.Errorf("call %d: a folder that has not answered cannot be reported, got %#v", i+1, got.Info.Folders)
		}
		if took := time.Since(start); took > time.Second {
			t.Errorf("call %d waited %v for a stalled folder", i+1, took)
		}
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
		for i := 0; i < 3; i++ {
			if _, err := r.ReadString('\n'); err != nil {
				return
			}
		}
		conn.Write([]byte(":irc.example.net 001 testnick :Welcome\r\n"))
		io.Copy(io.Discard, r)
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

func TestGetStatusAttachesToAnExistingSession(t *testing.T) {
	fakeIRC, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer fakeIRC.Close()
	var ircConn net.Conn
	accepted := make(chan struct{})
	go func() {
		defer close(accepted)
		conn, err := fakeIRC.Accept()
		if err != nil {
			return
		}
		ircConn = conn
		r := bufio.NewReader(conn)
		for i := 0; i < 3; i++ {
			if _, err := r.ReadString('\n'); err != nil {
				return
			}
		}
		conn.Write([]byte(":irc.example.net 001 testnick :Welcome\r\n"))
	}()

	path := startTestServer(t)
	tc1 := dialTestClient(t, path)
	host, portStr, _ := net.SplitHostPort(fakeIRC.Addr().String())
	port, _ := strconv.Atoi(portStr)

	tc1.send(t, ClientFrame{
		ID: "1", Action: ActionConnect, ServerID: "shared", Host: host, Port: port, Nick: "testnick", Secure: false,
	})
	if result := tc1.recv(t); !result.OK {
		t.Fatalf("connect result: %#v", result)
	}
	tc1.recv(t)
	tc1.recv(t)

	select {
	case <-accepted:
	case <-time.After(2 * time.Second):
		t.Fatal("fake IRC server never accepted the connection")
	}

	tc2 := dialTestClient(t, path)
	tc2.send(t, ClientFrame{ID: "2", Action: ActionGetStatus, ServerID: "shared"})
	want := ServerFrame{ID: "2", Type: FrameResult, OK: true, Status: "connected"}
	if got := tc2.recv(t); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v want %#v", got, want)
	}

	if _, err := ircConn.Write([]byte(":irc.example.net PRIVMSG #x :hi\r\n")); err != nil {
		t.Fatalf("write to fake IRC server: %v", err)
	}

	want = ServerFrame{Type: FrameLine, ServerID: "shared", Line: ":irc.example.net PRIVMSG #x :hi"}
	if got := tc2.recv(t); !reflect.DeepEqual(got, want) {
		t.Errorf("tc2 (attached only via GetStatus) got %#v, want %#v", got, want)
	}
}

func TestServerDownloadDirOverridesClient(t *testing.T) {
	s := NewServer(nil)
	if got := s.destDir("/client/dir"); got != "/client/dir" {
		t.Fatalf("without DownloadDir: got %q, want the client's dir", got)
	}
	s.DownloadDir("/srv/downloads")
	for _, req := range []string{"/client/dir", "", "../../etc"} {
		if got := s.destDir(req); got != "/srv/downloads" {
			t.Fatalf("destDir(%q) = %q, want the server dir", req, got)
		}
	}
}

func TestDCCPortsPinnedByTheServerWinOverTheClients(t *testing.T) {
	s := NewServer(nil)
	if min, max := s.portRange(5000, 5010); min != 5000 || max != 5010 {
		t.Fatalf("without pinned ports the client's range stands, got %d-%d", min, max)
	}
	s.DCCPorts(40000, 40010)
	for _, asked := range [][2]int{{5000, 5010}, {0, 0}} {
		if min, max := s.portRange(asked[0], asked[1]); min != 40000 || max != 40010 {
			t.Errorf("asked for %v, got %d-%d, want the pinned 40000-40010", asked, min, max)
		}
	}
}

func TestSendsToOneServerArriveInOrder(t *testing.T) {
	const lines = 4 // the flood limiter's burst, so none of them is delayed
	for round := 0; round < 25; round++ {
		fakeIRC, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatalf("listen: %v", err)
		}
		got := make(chan string, 16)
		go func() {
			conn, err := fakeIRC.Accept()
			if err != nil {
				return
			}
			defer conn.Close()
			r := bufio.NewReader(conn)
			welcomed := false
			for {
				line, err := r.ReadString('\n')
				if err != nil {
					return
				}
				// A line typed while the client is still registering can land among the handshake lines.
				if len(line) > 8 && line[:8] == "PRIVMSG " {
					got <- line
				}
				if !welcomed && strings.HasPrefix(line, "USER ") {
					welcomed = true
					conn.Write([]byte(":irc.example.net 001 testnick :Welcome\r\n"))
				}
			}
		}()

		tc := dialTestClient(t, startTestServer(t))
		host, portStr, _ := net.SplitHostPort(fakeIRC.Addr().String())
		port, _ := strconv.Atoi(portStr)
		tc.send(t, ClientFrame{ID: "c", Action: ActionConnect, ServerID: "s1", Host: host, Port: port, Nick: "testnick"})
		if result := tc.recv(t); !result.OK {
			t.Fatalf("connect: %#v", result)
		}
		for i := 0; i < lines; i++ {
			tc.send(t, ClientFrame{ID: strconv.Itoa(i), Action: ActionSend, ServerID: "s1", Line: "PRIVMSG #c :msg" + strconv.Itoa(i)})
		}
		for i := 0; i < lines; i++ {
			select {
			case line := <-got:
				if want := "PRIVMSG #c :msg" + strconv.Itoa(i) + "\r\n"; line != want {
					t.Fatalf("round %d: line %d = %q, want %q", round, i, line, want)
				}
			case <-time.After(2 * time.Second):
				t.Fatalf("round %d: timed out waiting for line %d", round, i)
			}
		}
		fakeIRC.Close()
	}
}

func TestWriteToAClientThatStopsReadingTimesOutAndHangsUp(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	c := &conn{netConn: server, writeTimeout: 50 * time.Millisecond, enc: json.NewEncoder(server)}

	done := make(chan struct{})
	go func() {
		c.SendLine("srv", "a line nobody reads")
		c.SendLine("srv", "and another")
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("writing to a client that does not read blocked")
	}
	if _, err := client.Read(make([]byte, 1)); err != io.EOF {
		t.Fatalf("read after the timeout: %v, want the connection closed", err)
	}
}
