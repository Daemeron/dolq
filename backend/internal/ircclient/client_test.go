package ircclient

import (
	"bufio"
	"encoding/base64"
	"net"
	"reflect"
	"testing"
	"time"

	"github.com/Daemeron/dolq/backend/internal/ircparse"
)

// pipeClient wires a Client to one end of an in-memory net.Pipe(), handing
// the test the other end to act as a fake IRC server.
func pipeClient(t *testing.T, nick string) (*Client, net.Conn, *bufio.Reader) {
	t.Helper()
	clientConn, serverConn := net.Pipe()
	t.Cleanup(func() {
		clientConn.Close()
		serverConn.Close()
	})
	return New(clientConn, nick), serverConn, bufio.NewReader(serverConn)
}

// expectLine reads one CRLF-terminated line the client wrote, off a
// goroutine so a net.Pipe's blocking Read doesn't wedge the test forever.
func expectLine(t *testing.T, r *bufio.Reader) string {
	t.Helper()
	type result struct {
		line string
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		line, err := r.ReadString('\n')
		ch <- result{line, err}
	}()
	select {
	case res := <-ch:
		if res.err != nil {
			t.Fatalf("read line: %v", res.err)
		}
		return res.line
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for a line")
		return ""
	}
}

func writeLine(t *testing.T, conn net.Conn, line string) {
	t.Helper()
	done := make(chan error, 1)
	go func() {
		_, err := conn.Write([]byte(line + "\r\n"))
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("write line: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out writing a line")
	}
}

func drainHandshake(t *testing.T, r *bufio.Reader) {
	t.Helper()
	for i := 0; i < 3; i++ {
		expectLine(t, r)
	}
}

func TestSend(t *testing.T) {
	t.Run("writes the message with CRLF appended", func(t *testing.T) {
		c, _, r := pipeClient(t, "testnick")
		go c.Send("NICK testnick")
		if got := expectLine(t, r); got != "NICK testnick\r\n" {
			t.Errorf("got %q", got)
		}
	})

	t.Run("strips a leading forward slash", func(t *testing.T) {
		c, _, r := pipeClient(t, "testnick")
		go c.Send("/JOIN #test")
		if got := expectLine(t, r); got != "JOIN #test\r\n" {
			t.Errorf("got %q", got)
		}
	})

	t.Run("preserves forward slashes elsewhere in the message", func(t *testing.T) {
		c, _, r := pipeClient(t, "testnick")
		go c.Send("PRIVMSG #chan :see https://example.com")
		want := "PRIVMSG #chan :see https://example.com\r\n"
		if got := expectLine(t, r); got != want {
			t.Errorf("got %q want %q", got, want)
		}
	})

	t.Run("returns an error once the connection is closed", func(t *testing.T) {
		c, server, _ := pipeClient(t, "testnick")
		server.Close()
		if err := c.Send("PING :server"); err == nil {
			t.Error("expected an error, got nil")
		}
	})
}

func TestHandshake(t *testing.T) {
	c, _, r := pipeClient(t, "mynick")
	c.Start()

	want := []string{"PASS none\r\n", "NICK mynick\r\n", "USER mynick 0 * Dolq IRC Client\r\n"}
	for _, w := range want {
		if got := expectLine(t, r); got != w {
			t.Errorf("got %q want %q", got, w)
		}
	}
}

func TestSASL(t *testing.T) {
	t.Run("not attempted when no credentials are configured", func(t *testing.T) {
		c, _, r := pipeClient(t, "mynick")
		c.Start()
		drainHandshake(t, r) // PASS/NICK/USER, no leading CAP LS
	})

	t.Run("full successful negotiation", func(t *testing.T) {
		c, server, r := pipeClient(t, "mynick")
		c.SASLUser = "myuser"
		c.SASLPass = "mypass"
		c.Start()

		if got := expectLine(t, r); got != "CAP LS 302\r\n" {
			t.Fatalf("got %q want CAP LS 302", got)
		}
		drainHandshake(t, r) // PASS/NICK/USER

		if got := expectLine(t, r); got != "CAP REQ :sasl\r\n" {
			t.Fatalf("got %q want CAP REQ :sasl", got)
		}
		// The LS reply arriving first (as it would from a real server, since
		// LS was sent before REQ) must not be mistaken for the REQ's ack.
		writeLine(t, server, "CAP * LS :sasl multi-prefix")
		writeLine(t, server, "CAP * ACK :sasl")

		if got := expectLine(t, r); got != "AUTHENTICATE PLAIN\r\n" {
			t.Fatalf("got %q want AUTHENTICATE PLAIN", got)
		}
		writeLine(t, server, "AUTHENTICATE +")

		want := "AUTHENTICATE " + base64.StdEncoding.EncodeToString([]byte("\x00myuser\x00mypass")) + "\r\n"
		if got := expectLine(t, r); got != want {
			t.Fatalf("got %q want %q", got, want)
		}
		writeLine(t, server, ":irc.example.net 903 mynick :SASL authentication successful")

		if got := expectLine(t, r); got != "CAP END\r\n" {
			t.Fatalf("got %q want CAP END", got)
		}
	})

	t.Run("gives up cleanly when the server declines the capability", func(t *testing.T) {
		c, server, r := pipeClient(t, "mynick")
		c.SASLUser = "myuser"
		c.SASLPass = "mypass"
		c.Start()

		expectLine(t, r) // CAP LS 302
		drainHandshake(t, r)
		expectLine(t, r) // CAP REQ :sasl
		writeLine(t, server, "CAP * NAK :sasl")

		if got := expectLine(t, r); got != "CAP END\r\n" {
			t.Fatalf("got %q want CAP END (no AUTHENTICATE attempt after a NAK)", got)
		}
	})

	t.Run("gives up cleanly when authentication is rejected", func(t *testing.T) {
		c, server, r := pipeClient(t, "mynick")
		c.SASLUser = "myuser"
		c.SASLPass = "wrongpass"
		c.Start()

		expectLine(t, r) // CAP LS 302
		drainHandshake(t, r)
		expectLine(t, r) // CAP REQ :sasl
		writeLine(t, server, "CAP * ACK :sasl")
		expectLine(t, r) // AUTHENTICATE PLAIN
		writeLine(t, server, "AUTHENTICATE +")
		expectLine(t, r) // AUTHENTICATE <payload>
		writeLine(t, server, ":irc.example.net 904 mynick :SASL authentication failed")

		if got := expectLine(t, r); got != "CAP END\r\n" {
			t.Fatalf("got %q want CAP END", got)
		}
	})

	t.Run("gives up after SASLTimeout when the server never responds", func(t *testing.T) {
		c, _, r := pipeClient(t, "mynick")
		c.SASLUser = "myuser"
		c.SASLPass = "mypass"
		c.SASLTimeout = 30 * time.Millisecond
		c.Start()

		expectLine(t, r) // CAP LS 302
		drainHandshake(t, r)
		expectLine(t, r) // CAP REQ :sasl - server never acks it

		if got := expectLine(t, r); got != "CAP END\r\n" {
			t.Fatalf("got %q want CAP END", got)
		}
	})
}

func TestPingPong(t *testing.T) {
	t.Run("responds to PING with PONG using the server token", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, "PING :irc.libera.chat")
		if got := expectLine(t, r); got != "PONG :irc.libera.chat\r\n" {
			t.Errorf("got %q", got)
		}
	})

	t.Run("ignores non-PING lines", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		c.Start()
		drainHandshake(t, r)
		writeLine(t, server, ":nick!user@host PRIVMSG #chan :hello")

		ch := make(chan string, 1)
		go func() {
			line, err := r.ReadString('\n')
			if err == nil {
				ch <- line
			}
		}()
		select {
		case line := <-ch:
			t.Errorf("unexpected line written by client: %q", line)
		case <-time.After(100 * time.Millisecond):
		}
	})
}

func TestPingTimeoutWatchdog(t *testing.T) {
	t.Run("closes the connection once no data has arrived for longer than the timeout", func(t *testing.T) {
		c, _, _ := pipeClient(t, "testnick")
		c.PingTimeout = 30 * time.Millisecond
		c.PingCheckInterval = 10 * time.Millisecond
		c.Start()

		select {
		case <-c.closed:
		case <-time.After(2 * time.Second):
			t.Fatal("watchdog did not close the connection")
		}
	})

	t.Run("does not close before the timeout has elapsed", func(t *testing.T) {
		c, _, _ := pipeClient(t, "testnick")
		c.PingTimeout = 200 * time.Millisecond
		c.PingCheckInterval = 20 * time.Millisecond
		c.Start()

		select {
		case <-c.closed:
			t.Fatal("closed before the timeout elapsed")
		case <-time.After(80 * time.Millisecond):
		}
	})

	t.Run("resets the deadline whenever a line is received", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		c.PingTimeout = 150 * time.Millisecond
		c.PingCheckInterval = 20 * time.Millisecond
		c.Start()
		drainHandshake(t, r)

		time.Sleep(100 * time.Millisecond)
		writeLine(t, server, "PING :irc.example.net")
		expectLine(t, r) // the PONG reply confirms the line reached the read loop

		select {
		case <-c.closed:
			t.Fatal("closed even though a line reset the deadline")
		case <-time.After(100 * time.Millisecond):
		}
	})
}

func TestNamesAccumulation(t *testing.T) {
	t.Run("combines multiple 353 replies into one names event on 366", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 10)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":irc.example.net 353 testnick = #general :alice @bob")
		writeLine(t, server, ":irc.example.net 353 testnick = #general :carol")
		select {
		case e := <-events:
			t.Fatalf("expected no event yet, got %v", e)
		case <-time.After(50 * time.Millisecond):
		}

		writeLine(t, server, ":irc.example.net 366 testnick #general :End of /NAMES list.")
		want := NamesEvent{
			Type: "names", Channel: "#general",
			Users: []ircparse.User{
				{Nick: "alice", Privilege: ircparse.PrivilegeNone},
				{Nick: "bob", Privilege: ircparse.PrivilegeOp},
				{Nick: "carol", Privilege: ircparse.PrivilegeNone},
			},
		}
		select {
		case e := <-events:
			if !reflect.DeepEqual(e, want) {
				t.Errorf("got %#v want %#v", e, want)
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for the names event")
		}
	})

	t.Run("emits an empty names list when 366 arrives with no preceding 353", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 10)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":irc.example.net 366 testnick #empty :End of /NAMES list.")
		want := NamesEvent{Type: "names", Channel: "#empty", Users: []ircparse.User{}}
		select {
		case e := <-events:
			if !reflect.DeepEqual(e, want) {
				t.Errorf("got %#v want %#v", e, want)
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for the names event")
		}
	})
}

func TestNickTracking(t *testing.T) {
	t.Run("updates the tracked nick when the server confirms our own NICK change", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 10)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":testnick!u@host NICK :newnick")
		select {
		case <-events:
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for the NICK event")
		}

		c.mu.Lock()
		got := c.nick
		c.mu.Unlock()
		if got != "newnick" {
			t.Errorf("nick = %q, want newnick", got)
		}
	})

	t.Run("ignores NICK events for other users", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 10)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":someoneelse!u@host NICK :othernick")
		select {
		case <-events:
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for the NICK event")
		}

		c.mu.Lock()
		got := c.nick
		c.mu.Unlock()
		if got != "testnick" {
			t.Errorf("nick = %q, want testnick", got)
		}
	})
}

func TestJoinedChannelTracking(t *testing.T) {
	setup := func(t *testing.T) (*Client, net.Conn, chan any) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 10)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)
		return c, server, events
	}
	await := func(t *testing.T, events chan any) {
		t.Helper()
		select {
		case <-events:
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for an event")
		}
	}

	t.Run("tracks a channel once we join it", func(t *testing.T) {
		c, server, events := setup(t)
		writeLine(t, server, ":testnick!u@host JOIN #general")
		await(t, events)
		if got := c.GetJoinedChannels(); !reflect.DeepEqual(got, []string{"#general"}) {
			t.Errorf("got %v", got)
		}
	})

	t.Run("ignores JOIN events for other users", func(t *testing.T) {
		c, server, events := setup(t)
		writeLine(t, server, ":someoneelse!u@host JOIN #general")
		await(t, events)
		if got := c.GetJoinedChannels(); len(got) != 0 {
			t.Errorf("got %v, want empty", got)
		}
	})

	t.Run("drops the channel when we PART it", func(t *testing.T) {
		c, server, events := setup(t)
		writeLine(t, server, ":testnick!u@host JOIN #general")
		await(t, events)
		writeLine(t, server, ":testnick!u@host PART #general")
		await(t, events)
		if got := c.GetJoinedChannels(); len(got) != 0 {
			t.Errorf("got %v, want empty", got)
		}
	})

	t.Run("drops the channel when we get KICKed from it", func(t *testing.T) {
		c, server, events := setup(t)
		writeLine(t, server, ":testnick!u@host JOIN #general")
		await(t, events)
		writeLine(t, server, ":alice!u@host KICK #general testnick :bye")
		await(t, events)
		if got := c.GetJoinedChannels(); len(got) != 0 {
			t.Errorf("got %v, want empty", got)
		}
	})

	t.Run("keeps the channel when someone else gets KICKed", func(t *testing.T) {
		c, server, events := setup(t)
		writeLine(t, server, ":testnick!u@host JOIN #general")
		await(t, events)
		writeLine(t, server, ":alice!u@host KICK #general bob :bye")
		await(t, events)
		if got := c.GetJoinedChannels(); !reflect.DeepEqual(got, []string{"#general"}) {
			t.Errorf("got %v", got)
		}
	})
}

func TestDisconnect(t *testing.T) {
	t.Run("sends QUIT and closes the connection", func(t *testing.T) {
		c, _, r := pipeClient(t, "testnick")
		c.Start()
		drainHandshake(t, r)

		done := make(chan error, 1)
		go func() { done <- c.Disconnect() }()

		if got := expectLine(t, r); got != "QUIT\r\n" {
			t.Errorf("got %q", got)
		}
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("Disconnect returned error: %v", err)
			}
		case <-time.After(time.Second):
			t.Fatal("Disconnect did not return")
		}
	})

	t.Run("PARTs every joined channel before sending QUIT", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 10)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":testnick!u@host JOIN #general")
		<-events
		writeLine(t, server, ":testnick!u@host JOIN #random")
		<-events

		done := make(chan error, 1)
		go func() { done <- c.Disconnect() }()

		got := []string{expectLine(t, r), expectLine(t, r), expectLine(t, r)}
		if got[2] != "QUIT\r\n" {
			t.Errorf("expected QUIT last, got %v", got)
		}
		parted := map[string]bool{got[0]: true, got[1]: true}
		if !parted["PART #general\r\n"] || !parted["PART #random\r\n"] {
			t.Errorf("expected PART #general and PART #random, got %v", got[:2])
		}

		select {
		case err := <-done:
			if err != nil {
				t.Errorf("Disconnect returned error: %v", err)
			}
		case <-time.After(time.Second):
			t.Fatal("Disconnect did not return")
		}
	})
}
