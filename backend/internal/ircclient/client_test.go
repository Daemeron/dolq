package ircclient

import (
	"bufio"
	"encoding/base64"
	"io"
	"net"
	"reflect"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Daemeron/dolq/backend/internal/ircparse"
)

func pipeClient(t *testing.T, nick string) (*Client, net.Conn, *bufio.Reader) {
	t.Helper()
	clientConn, serverConn := net.Pipe()
	t.Cleanup(func() {
		clientConn.Close()
		serverConn.Close()
	})
	return New(clientConn, nick), serverConn, bufio.NewReader(serverConn)
}

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

func expectNoLine(t *testing.T, conn net.Conn, r *bufio.Reader) {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	defer conn.SetReadDeadline(time.Time{})
	if line, err := r.ReadString('\n'); err == nil {
		t.Fatalf("got unexpected line %q", line)
	}
}

// expectNothingSent proves the client wrote nothing for the lines before it
// without waiting out a window: lines are handled in order and a PING is
// answered right away, so anything they caused would come before the PONG.
// Their events have been emitted by then too.
func expectNothingSent(t *testing.T, conn net.Conn, r *bufio.Reader) {
	t.Helper()
	go conn.Write([]byte("PING :barrier\r\n"))
	if got := expectLine(t, r); got != "PONG :barrier\r\n" {
		t.Fatalf("got unexpected line %q", got)
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
	for range 4 {
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

func TestSendPaced(t *testing.T) {
	t.Run("sends up to the burst immediately", func(t *testing.T) {
		c, _, r := pipeClient(t, "testnick")
		c.FloodBurst = 3
		c.FloodInterval = time.Hour
		for range 3 {
			go c.SendPaced("PRIVMSG #chan :line")
		}
		for range 3 {
			expectLine(t, r)
		}
	})

	t.Run("throttles beyond the burst until the next interval", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		c.FloodBurst = 1
		c.FloodInterval = 500 * time.Millisecond
		go c.SendPaced("PRIVMSG #chan :first")
		expectLine(t, r)

		go c.SendPaced("PRIVMSG #chan :second")
		expectNoLine(t, server, r)
		if got := expectLine(t, r); got != "PRIVMSG #chan :second\r\n" {
			t.Errorf("got %q", got)
		}
	})

	t.Run("returns an error if the connection closes while waiting for a token", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		c.Start()
		drainHandshake(t, r)
		c.FloodBurst = 1
		c.FloodInterval = time.Hour
		go c.SendPaced("PRIVMSG #chan :first")
		expectLine(t, r)

		errCh := make(chan error, 1)
		go func() { errCh <- c.SendPaced("PRIVMSG #chan :second") }()

		server.Close()
		select {
		case err := <-errCh:
			if err == nil {
				t.Error("expected an error, got nil")
			}
		case <-time.After(2 * time.Second):
			t.Fatal("SendPaced didn't return once the connection closed")
		}
	})
}

func TestHandshake(t *testing.T) {
	c, _, r := pipeClient(t, "mynick")
	c.Start()

	want := []string{"CAP LS 302\r\n", "PASS none\r\n", "NICK mynick\r\n", "USER mynick 0 * :Dolq IRC Client\r\n"}
	for _, w := range want {
		if got := expectLine(t, r); got != w {
			t.Errorf("got %q want %q", got, w)
		}
	}
}

func TestHandshakeSendsServerPassword(t *testing.T) {
	c, _, r := pipeClient(t, "mynick")
	c.Password = "hunter2"
	c.Start()

	expectLine(t, r)
	if got, want := expectLine(t, r), "PASS hunter2\r\n"; got != want {
		t.Errorf("got %q want %q", got, want)
	}
}

func TestCapNegotiation(t *testing.T) {
	t.Run("requests only the baseline caps the server actually advertised", func(t *testing.T) {
		c, server, r := pipeClient(t, "mynick")
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, "CAP * LS :multi-prefix server-time some-other-cap")
		if got := expectLine(t, r); got != "CAP REQ :multi-prefix server-time\r\n" {
			t.Fatalf("got %q", got)
		}
		writeLine(t, server, "CAP * ACK :multi-prefix server-time")

		if got := expectLine(t, r); got != "CAP END\r\n" {
			t.Fatalf("got %q want CAP END", got)
		}
	})

	t.Run("accumulates a multi-line LS 302 reply before requesting", func(t *testing.T) {
		c, server, r := pipeClient(t, "mynick")
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, "CAP * LS * :multi-prefix")
		writeLine(t, server, "CAP * LS :away-notify server-time")

		if got := expectLine(t, r); got != "CAP REQ :multi-prefix away-notify server-time\r\n" {
			t.Fatalf("got %q", got)
		}
	})

	t.Run("sends no REQ, still ends with CAP END, when nothing offered matches", func(t *testing.T) {
		c, server, r := pipeClient(t, "mynick")
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, "CAP * LS :some-other-cap")
		if got := expectLine(t, r); got != "CAP END\r\n" {
			t.Fatalf("got %q want CAP END directly (no REQ sent)", got)
		}
	})

	t.Run("registers plainly if the server never replies to CAP LS", func(t *testing.T) {
		c, _, r := pipeClient(t, "mynick")
		c.CapTimeout = 30 * time.Millisecond
		c.Start()
		drainHandshake(t, r)

		if got := expectLine(t, r); got != "CAP END\r\n" {
			t.Fatalf("got %q want CAP END", got)
		}
	})
}

func TestSASL(t *testing.T) {
	t.Run("not requested when no credentials are configured, even if the server offers it", func(t *testing.T) {
		c, server, r := pipeClient(t, "mynick")
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, "CAP * LS :sasl")
		if got := expectLine(t, r); got != "CAP END\r\n" {
			t.Fatalf("got %q want CAP END (no CAP REQ)", got)
		}
	})

	t.Run("full successful negotiation", func(t *testing.T) {
		c, server, r := pipeClient(t, "mynick")
		c.SASLUser = "myuser"
		c.SASLPass = "mypass"
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, "CAP * LS :sasl")

		if got := expectLine(t, r); got != "CAP REQ :sasl\r\n" {
			t.Fatalf("got %q want CAP REQ :sasl", got)
		}
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
		drainHandshake(t, r)

		writeLine(t, server, "CAP * LS :sasl")
		expectLine(t, r)
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
		drainHandshake(t, r)

		writeLine(t, server, "CAP * LS :sasl")
		expectLine(t, r)
		writeLine(t, server, "CAP * ACK :sasl")
		expectLine(t, r)
		writeLine(t, server, "AUTHENTICATE +")
		expectLine(t, r)
		writeLine(t, server, ":irc.example.net 904 mynick :SASL authentication failed")

		if got := expectLine(t, r); got != "CAP END\r\n" {
			t.Fatalf("got %q want CAP END", got)
		}
	})

	t.Run("gives up after CapTimeout when the server never acks the sasl request", func(t *testing.T) {
		c, server, r := pipeClient(t, "mynick")
		c.SASLUser = "myuser"
		c.SASLPass = "mypass"
		c.CapTimeout = 30 * time.Millisecond
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, "CAP * LS :sasl")
		expectLine(t, r)

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

		expectNothingSent(t, server, r)
	})
}

func TestCTCP(t *testing.T) {
	t.Run("replies to a CTCP VERSION request with a NOTICE", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":alice!u@host PRIVMSG testnick :\x01VERSION\x01")
		if got := expectLine(t, r); got != "NOTICE alice :\x01VERSION "+clientVersion+"\x01\r\n" {
			t.Errorf("got %q", got)
		}
	})

	t.Run("replies to a CTCP PING request by echoing its token", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":alice!u@host PRIVMSG testnick :\x01PING 1600000000\x01")
		if got := expectLine(t, r); got != "NOTICE alice :\x01PING 1600000000\x01\r\n" {
			t.Errorf("got %q", got)
		}
	})

	t.Run("does not reply to a CTCP ACTION - it's a message to render, not a request", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		c.Start()
		drainHandshake(t, r)
		writeLine(t, server, ":alice!u@host PRIVMSG #chan :\x01ACTION waves\x01")

		expectNothingSent(t, server, r)
	})

	t.Run("emits an ActionEvent for a CTCP ACTION", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 1)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":alice!u@host PRIVMSG #chan :\x01ACTION waves\x01")
		select {
		case e := <-events:
			want := ircparse.ActionEvent{Type: "ACTION", Nick: "alice", Target: "#chan", Text: "waves"}
			if !reflect.DeepEqual(e, want) {
				t.Errorf("got %#v, want %#v", e, want)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for the ActionEvent")
		}
	})

	t.Run("emits a DCCChatOfferEvent for a CTCP DCC CHAT request, decoding the IP", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 1)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":alice!u@host PRIVMSG testnick :\x01DCC CHAT chat 3232235777 5000\x01")
		select {
		case e := <-events:
			want := ircparse.DCCChatOfferEvent{Type: "DCCCHATOFFER", Nick: "alice", IP: "192.168.1.1", Port: 5000}
			if !reflect.DeepEqual(e, want) {
				t.Errorf("got %#v, want %#v", e, want)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for the DCCChatOfferEvent")
		}
	})

	t.Run("does not auto-reply to a DCC CHAT request", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		c.Start()
		drainHandshake(t, r)
		writeLine(t, server, ":alice!u@host PRIVMSG testnick :\x01DCC CHAT chat 3232235777 5000\x01")

		expectNothingSent(t, server, r)
	})

	t.Run("emits an XDCCSendOfferEvent for an active-mode DCC SEND request", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 1)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":alice!u@host PRIVMSG testnick :\x01DCC SEND file.txt 3232235777 5000 1024\x01")
		select {
		case e := <-events:
			want := ircparse.XDCCSendOfferEvent{
				Type: "XDCCSENDOFFER", Nick: "alice", Filename: "file.txt", IP: "192.168.1.1", Port: 5000, Size: 1024,
				Host: "u@host",
			}
			if !reflect.DeepEqual(e, want) {
				t.Errorf("got %#v, want %#v", e, want)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for the XDCCSendOfferEvent")
		}
	})

	t.Run("an XDCCSendOfferEvent carries the sender's account from the account tag", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 1)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, "@time=2026-01-01T00:00:00.000Z;account=alice_acct :alice!u@host PRIVMSG testnick :\x01DCC SEND f 3232235777 5000 1\x01")
		select {
		case e := <-events:
			offer, ok := e.(ircparse.XDCCSendOfferEvent)
			if !ok || offer.Account != "alice_acct" || offer.Host != "u@host" {
				t.Errorf("got %#v, want account alice_acct and host u@host", e)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for the XDCCSendOfferEvent")
		}
	})

	t.Run("emits an XDCCSendOfferEvent for a passive/reverse DCC SEND request, port 0 and a token", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 1)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, `:alice!u@host PRIVMSG testnick :`+"\x01"+`DCC SEND "my file.txt" 3232235777 0 1024 7`+"\x01")
		select {
		case e := <-events:
			want := ircparse.XDCCSendOfferEvent{
				Type: "XDCCSENDOFFER", Nick: "alice", Filename: "my file.txt", IP: "192.168.1.1", Size: 1024, Token: "7",
				Host: "u@host",
			}
			if !reflect.DeepEqual(e, want) {
				t.Errorf("got %#v, want %#v", e, want)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for the XDCCSendOfferEvent")
		}
	})

	t.Run("does not auto-reply to a DCC SEND request", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		c.Start()
		drainHandshake(t, r)
		writeLine(t, server, ":alice!u@host PRIVMSG testnick :\x01DCC SEND file.txt 3232235777 5000 1024\x01")

		expectNothingSent(t, server, r)
	})

	t.Run("emits an XDCCResumeAcceptEvent for a DCC ACCEPT reply", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 1)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, `:alice!u@host PRIVMSG testnick :`+"\x01"+`DCC ACCEPT "my file.txt" 5000 512 7`+"\x01")
		select {
		case e := <-events:
			want := ircparse.XDCCResumeAcceptEvent{
				Type: "XDCCRESUMEACCEPT", Nick: "alice", Filename: "my file.txt", Port: 5000, Position: 512, Token: "7",
			}
			if e != want {
				t.Errorf("got %#v, want %#v", e, want)
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for the XDCCResumeAcceptEvent")
		}
	})

	t.Run("ignores an unrecognized DCC subcommand", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 1)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":alice!u@host PRIVMSG testnick :\x01DCC RESUME file.txt 5000 512\x01")
		expectNothingSent(t, server, r)
		select {
		case e := <-events:
			t.Errorf("expected no event, got %#v", e)
		default:
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
		c.PingTimeout = time.Hour
		c.PingCheckInterval = time.Millisecond
		c.Start()

		// Many checks run in this window; each must see the timeout still ahead.
		select {
		case <-c.closed:
			t.Fatal("closed before the timeout elapsed")
		case <-time.After(20 * time.Millisecond):
		}
	})

	t.Run("resets the deadline whenever a line is received", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		c.lastActivity.Store(time.Now().Add(-time.Hour).UnixNano())
		c.Start()
		drainHandshake(t, r)

		// The PONG is written while the PING is handled, after the read that counts as activity.
		writeLine(t, server, "PING :irc.example.net")
		expectLine(t, r)

		if idle := time.Since(time.Unix(0, c.lastActivity.Load())); idle > time.Minute {
			t.Fatalf("last activity is %v old after a line was received", idle)
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
		expectNothingSent(t, server, r)
		select {
		case e := <-events:
			t.Fatalf("expected no event yet, got %v", e)
		default:
		}

		writeLine(t, server, ":irc.example.net 366 testnick #general :End of /NAMES list.")
		want := NamesEvent{
			Type: "names", Channel: "#general",
			Users: []ircparse.User{
				{Nick: "alice", Privileges: []ircparse.PrivilegeLevel{}},
				{Nick: "bob", Privileges: []ircparse.PrivilegeLevel{ircparse.PrivilegeOp}},
				{Nick: "carol", Privileges: []ircparse.PrivilegeLevel{}},
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

func TestWhoisAccumulation(t *testing.T) {
	t.Run("combines every WHOIS reply into one whois event on 318", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 10)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":irc.example.net 311 testnick alice ident host.example.net * :Alice Example")
		writeLine(t, server, ":irc.example.net 312 testnick alice irc.example.net :Example IRC Network")
		writeLine(t, server, ":irc.example.net 317 testnick alice 300 1700000000 :seconds idle, signon time")
		writeLine(t, server, ":irc.example.net 319 testnick alice :@#general +#offtopic")
		writeLine(t, server, ":irc.example.net 330 testnick alice alice_account :is logged in as")
		expectNothingSent(t, server, r)
		select {
		case e := <-events:
			t.Fatalf("expected no event yet, got %#v", e)
		default:
		}

		writeLine(t, server, ":irc.example.net 318 testnick alice :End of /WHOIS list.")
		want := ircparse.WhoisEvent{
			Type: "whois", Nick: "alice", User: "ident", Host: "host.example.net", Realname: "Alice Example",
			Server: "irc.example.net", ServerInfo: "Example IRC Network",
			IdleSeconds: 300, SignonTime: 1700000000,
			Channels: []string{"#general", "#offtopic"}, Account: "alice_account",
		}
		select {
		case e := <-events:
			if !reflect.DeepEqual(e, want) {
				t.Errorf("got %#v want %#v", e, want)
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for the whois event")
		}
	})

	t.Run("marks NoSuchNick when 401 precedes 318 with nothing else buffered", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 10)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":irc.example.net 401 testnick ghost :No such nick/channel")
		writeLine(t, server, ":irc.example.net 318 testnick ghost :End of /WHOIS list.")
		want := ircparse.WhoisEvent{Type: "whois", Nick: "ghost", NoSuchNick: true}
		select {
		case e := <-events:
			if !reflect.DeepEqual(e, want) {
				t.Errorf("got %#v want %#v", e, want)
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for the whois event")
		}
	})

	t.Run("keeps concurrent WHOIS requests for different nicks separate", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 10)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":irc.example.net 311 testnick alice a a.example.net * :Alice")
		writeLine(t, server, ":irc.example.net 311 testnick bob b b.example.net * :Bob")
		writeLine(t, server, ":irc.example.net 318 testnick alice :End of /WHOIS list.")

		select {
		case e := <-events:
			want := ircparse.WhoisEvent{Type: "whois", Nick: "alice", User: "a", Host: "a.example.net", Realname: "Alice"}
			if !reflect.DeepEqual(e, want) {
				t.Errorf("got %#v want %#v", e, want)
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for alice's whois event")
		}

		writeLine(t, server, ":irc.example.net 318 testnick bob :End of /WHOIS list.")
		select {
		case e := <-events:
			want := ircparse.WhoisEvent{Type: "whois", Nick: "bob", User: "b", Host: "b.example.net", Realname: "Bob"}
			if !reflect.DeepEqual(e, want) {
				t.Errorf("got %#v want %#v", e, want)
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for bob's whois event")
		}
	})

	t.Run("folds a 301 into an in-flight whois", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 10)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":irc.example.net 311 testnick alice a a.example.net * :Alice")
		writeLine(t, server, ":irc.example.net 301 testnick alice :gone fishing")
		writeLine(t, server, ":irc.example.net 318 testnick alice :End of /WHOIS list.")
		select {
		case e := <-events:
			want := ircparse.WhoisEvent{
				Type: "whois", Nick: "alice", User: "a", Host: "a.example.net", Realname: "Alice", Away: "gone fishing",
			}
			if !reflect.DeepEqual(e, want) {
				t.Errorf("got %#v want %#v", e, want)
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for the whois event")
		}
	})

	t.Run("emits a standalone AwayEvent for a 301 with no whois in flight", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 10)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":irc.example.net 301 testnick alice :gone fishing")
		select {
		case e := <-events:
			want := ircparse.AwayEvent{Type: "AWAY", Nick: "alice", Away: true, Message: "gone fishing"}
			if !reflect.DeepEqual(e, want) {
				t.Errorf("got %#v want %#v", e, want)
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for the AwayEvent")
		}
	})
}

func TestAwayStatus(t *testing.T) {
	t.Run("passes through an away-notify AWAY as going away", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 10)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":alice!u@host AWAY :lunch")
		select {
		case e := <-events:
			want := ircparse.AwayEvent{Type: "AWAY", Nick: "alice", Away: true, Message: "lunch"}
			if !reflect.DeepEqual(e, want) {
				t.Errorf("got %#v want %#v", e, want)
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for the AwayEvent")
		}
	})

	t.Run("passes through a bare away-notify AWAY as coming back", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 10)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":alice!u@host AWAY")
		select {
		case e := <-events:
			want := ircparse.AwayEvent{Type: "AWAY", Nick: "alice", Away: false}
			if !reflect.DeepEqual(e, want) {
				t.Errorf("got %#v want %#v", e, want)
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for the AwayEvent")
		}
	})

	t.Run("passes through our own 306/305 as SelfAwayEvent", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 10)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":irc.example.net 306 testnick :You have been marked as being away")
		select {
		case e := <-events:
			want := ircparse.SelfAwayEvent{Type: "SELFAWAY", Away: true}
			if !reflect.DeepEqual(e, want) {
				t.Errorf("got %#v want %#v", e, want)
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for the SelfAwayEvent")
		}

		writeLine(t, server, ":irc.example.net 305 testnick :You are no longer marked as being away")
		select {
		case e := <-events:
			want := ircparse.SelfAwayEvent{Type: "SELFAWAY", Away: false}
			if !reflect.DeepEqual(e, want) {
				t.Errorf("got %#v want %#v", e, want)
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for the SelfAwayEvent")
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

func TestNickCollisionHandling(t *testing.T) {
	t.Run("retries with an alternate nick while still registering", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 10)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":irc.example.net 433 * testnick :Nickname is already in use.")

		if got := expectLine(t, r); got != "NICK testnick_\r\n" {
			t.Errorf("retry line = %q, want NICK testnick_", got)
		}
		select {
		case e := <-events:
			want := ircparse.NickInUseEvent{Type: "NICKINUSE", Nick: "testnick", Retrying: "testnick_"}
			if !reflect.DeepEqual(e, want) {
				t.Errorf("event = %#v, want %#v", e, want)
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for the NICKINUSE event")
		}

		c.mu.Lock()
		got := c.nick
		c.mu.Unlock()
		if got != "testnick_" {
			t.Errorf("nick = %q, want testnick_", got)
		}
	})

	t.Run("tries configured AltNicks in order before falling back to underscores", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		c.AltNicks = []string{"testnick2", "testnick3"}
		events := make(chan any, 10)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":irc.example.net 433 * testnick :Nickname is already in use.")
		if got := expectLine(t, r); got != "NICK testnick2\r\n" {
			t.Errorf("retry line = %q, want NICK testnick2", got)
		}
		<-events

		writeLine(t, server, ":irc.example.net 433 * testnick2 :Nickname is already in use.")
		if got := expectLine(t, r); got != "NICK testnick3\r\n" {
			t.Errorf("retry line = %q, want NICK testnick3", got)
		}
		<-events

		writeLine(t, server, ":irc.example.net 433 * testnick3 :Nickname is already in use.")
		if got := expectLine(t, r); got != "NICK testnick3_\r\n" {
			t.Errorf("retry line = %q, want NICK testnick3_", got)
		}
		<-events

		c.mu.Lock()
		got := c.nick
		c.mu.Unlock()
		if got != "testnick3_" {
			t.Errorf("nick = %q, want testnick3_", got)
		}
	})

	t.Run("gives up after maxNickCollisionRetries and stops retrying", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 10)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		for range maxNickCollisionRetries {
			writeLine(t, server, ":irc.example.net 433 * testnick :Nickname is already in use.")
			expectLine(t, r)
			<-events
		}

		writeLine(t, server, ":irc.example.net 433 * testnick :Nickname is already in use.")
		select {
		case e := <-events:
			want := ircparse.NickInUseEvent{Type: "NICKINUSE", Nick: "testnick"}
			if !reflect.DeepEqual(e, want) {
				t.Errorf("event = %#v, want %#v", e, want)
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for the NICKINUSE event")
		}

		expectNothingSent(t, server, r)
	})

	t.Run("RPL_WELCOME confirms the nick and marks registration complete", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 10)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":irc.example.net 001 testnick :Welcome to the Example Network, testnick")
		select {
		case <-events:
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for the WELCOME event")
		}

		c.mu.Lock()
		nick, registered := c.nick, c.registered
		c.mu.Unlock()
		if nick != "testnick" || !registered {
			t.Errorf("nick = %q, registered = %v, want testnick, true", nick, registered)
		}
	})

	t.Run("a live nick change rejected after registration is not auto-retried", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		events := make(chan any, 10)
		c.AddEventListener(func(e any) { events <- e })
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, ":irc.example.net 001 testnick :Welcome")
		<-events

		writeLine(t, server, ":irc.example.net 433 testnick newnick :Nickname is already in use.")
		select {
		case e := <-events:
			want := ircparse.NickInUseEvent{Type: "NICKINUSE", Nick: "newnick"}
			if !reflect.DeepEqual(e, want) {
				t.Errorf("event = %#v, want %#v", e, want)
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for the NICKINUSE event")
		}

		c.mu.Lock()
		got := c.nick
		c.mu.Unlock()
		if got != "testnick" {
			t.Errorf("nick = %q, want unchanged testnick", got)
		}

		expectNothingSent(t, server, r)
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

func TestQuitAndNickReportSharedChannels(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close()
	c := New(client, "me")
	defer client.Close()

	var events []any
	c.AddEventListener(func(e any) { events = append(events, e) })

	for _, line := range []string{
		":me!u@h JOIN #a",
		":srv 353 me = #a :me alice bob",
		":srv 366 me #a :End of /NAMES list.",
		":me!u@h JOIN #b",
		":alice!u@h JOIN #b",
		":bob!u@h PART #a :bye",
		":alice!u@h NICK :alicia",
		":alicia!u@h QUIT :Ping timeout",
		":bob!u@h QUIT :nope",
	} {
		c.handleLine(line)
	}

	var nick ircparse.NickEvent
	var quits []ircparse.QuitEvent
	for _, e := range events {
		switch ev := e.(type) {
		case ircparse.NickEvent:
			nick = ev
		case ircparse.QuitEvent:
			quits = append(quits, ev)
		}
	}
	if want := []string{"#a", "#b"}; !slices.Equal(nick.Channels, want) {
		t.Errorf("NICK channels = %v, want %v", nick.Channels, want)
	}
	if len(quits) != 2 {
		t.Fatalf("got %d quits, want 2", len(quits))
	}
	if want := []string{"#a", "#b"}; !slices.Equal(quits[0].Channels, want) {
		t.Errorf("quit of renamed nick channels = %v, want %v", quits[0].Channels, want)
	}
	if len(quits[1].Channels) != 0 {
		t.Errorf("quit of nick that left #a channels = %v, want none", quits[1].Channels)
	}
}

func TestMessageTag(t *testing.T) {
	cases := []struct{ line, name, want string }{
		{"@time=x;account=bob :b!u@h PRIVMSG a :hi", "account", "bob"},
		{"@account=bob :b!u@h PRIVMSG a :hi", "account", "bob"},
		{"@time=x :b!u@h PRIVMSG a :hi", "account", ""},
		{":b!u@h PRIVMSG a :account=bob", "account", ""},
		{"@xaccount=bob :b!u@h PRIVMSG a :hi", "account", ""},
	}
	for _, tc := range cases {
		if got := messageTag(tc.line, tc.name); got != tc.want {
			t.Errorf("messageTag(%q, %q) = %q, want %q", tc.line, tc.name, got, tc.want)
		}
	}
}

func TestDisconnectOnNeverStartedClientReturns(t *testing.T) {
	client, _, _ := pipeClient(t, "me")
	done := make(chan struct{})
	go func() {
		client.Disconnect()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Disconnect hung on a client that was never started")
	}
}

func TestOnCloseFiresExactlyOnceWhenRegisteredAroundTheClose(t *testing.T) {
	for i := 0; i < 200; i++ {
		client, server, _ := pipeClient(t, "me")
		client.Start()

		var fired atomic.Int32
		done := make(chan struct{})
		go func() {
			client.OnClose(func() { fired.Add(1) })
			close(done)
		}()
		server.Close()
		<-done

		select {
		case <-client.closed:
		case <-time.After(2 * time.Second):
			t.Fatal("client never closed")
		}
		// Settled: the read loop runs its listeners before closing, and a late
		// OnClose runs the callback itself before done.
		if n := fired.Load(); n != 1 {
			t.Fatalf("iteration %d: close callback fired %d times, want 1", i, n)
		}
	}
}

// closeSignalConn reports the first Close, so a test can act at exactly the
// point Disconnect gives the connection up.
type closeSignalConn struct {
	net.Conn
	once    sync.Once
	closing chan struct{}
}

func (c *closeSignalConn) Close() error {
	c.once.Do(func() { close(c.closing) })
	return c.Conn.Close()
}

func receive[T any](t *testing.T, ch <-chan T, what string) T {
	t.Helper()
	select {
	case v := <-ch:
		return v
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for %s", what)
		var zero T
		return zero
	}
}

func TestDisconnectWhileCloseListenersRun(t *testing.T) {
	clientConn, server := net.Pipe()
	t.Cleanup(func() { clientConn.Close(); server.Close() })
	conn := &closeSignalConn{Conn: clientConn, closing: make(chan struct{})}
	c := New(conn, "me")

	entered, release := make(chan struct{}), make(chan struct{})
	var listenerDone atomic.Bool
	c.OnClose(func() {
		close(entered)
		<-release
		listenerDone.Store(true)
	})
	c.Start()
	drainHandshake(t, bufio.NewReader(server))

	server.Close()
	receive(t, entered, "the close listener")

	// A listener may already have told the world the connection is gone.
	if !c.Closed() {
		t.Error("Closed() = false while the close listeners run")
	}

	done := make(chan error, 1)
	go func() { done <- c.Disconnect() }()
	// Hold the listener until Disconnect has let go of the connection, so it
	// makes every decision while the close is still in progress.
	receive(t, conn.closing, "Disconnect to close the connection")
	close(release)

	if err := receive(t, done, "Disconnect"); err != nil {
		t.Errorf("Disconnect on a dropped connection = %v, want nil", err)
	}
	if !listenerDone.Load() {
		t.Error("Disconnect returned before the close listeners finished")
	}
}

type failingWriteConn struct{ net.Conn }

func (failingWriteConn) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }

func TestDisconnectIgnoresAFailedGoodbye(t *testing.T) {
	clientConn, server := net.Pipe()
	t.Cleanup(func() { clientConn.Close(); server.Close() })
	c := New(failingWriteConn{clientConn}, "me")
	c.Start()

	// The read side has not seen the drop yet, so the QUIT is attempted and fails.
	if err := c.Disconnect(); err != nil {
		t.Errorf("Disconnect = %v, want nil: the connection is closed either way", err)
	}
}

// A server that accepts the connection but never answers the TLS handshake must
// not hold a dial, and with it a Disconnect waiting on a redial, forever.
func TestDialGivesUpOnAStalledHandshake(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			t.Cleanup(func() { conn.Close() })
		}
	}()

	old := dialTimeout
	dialTimeout = 50 * time.Millisecond
	t.Cleanup(func() { dialTimeout = old })

	addr := ln.Addr().(*net.TCPAddr)
	done := make(chan error, 1)
	go func() {
		_, err := Dial("127.0.0.1", addr.Port, "testnick", true)
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("Dial succeeded against a server that never answered the handshake")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Dial still waiting on the handshake after the dial timeout")
	}
}

func TestNickFollowsWhatTheServerConfirms(t *testing.T) {
	c, conn, r := pipeClient(t, "mira")
	if c.Nick() != "mira" {
		t.Fatalf("Nick before welcome = %q", c.Nick())
	}
	c.Start()
	drainHandshake(t, r)
	writeLine(t, conn, ":irc.example 001 mira_ :Welcome")
	deadline := time.Now().Add(2 * time.Second)
	for c.Nick() != "mira_" {
		if time.Now().After(deadline) {
			t.Fatalf("Nick = %q, want the welcomed nick mira_", c.Nick())
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestLineListenersSeeEveryRawLine(t *testing.T) {
	c, conn, r := pipeClient(t, "mira")
	lines := make(chan string, 4)
	c.AddLineListener(func(line string) { lines <- line })
	c.Start()
	drainHandshake(t, r)
	writeLine(t, conn, ":irc.example NOTICE * :hello there")
	select {
	case got := <-lines:
		if got != ":irc.example NOTICE * :hello there" {
			t.Errorf("listener got %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("line listener never called")
	}
}

func TestCTCPVersionRequestIsAnsweredWithANotice(t *testing.T) {
	c, conn, r := pipeClient(t, "mira")
	c.Start()
	drainHandshake(t, r)
	writeLine(t, conn, ":bob!b@h PRIVMSG mira :\x01VERSION\x01")
	got := expectLine(t, r)
	if want := "NOTICE bob :\x01VERSION"; len(got) < len(want) || got[:len(want)] != want {
		t.Errorf("reply = %q, want it to start with %q", got, want)
	}
}

func TestCapLineParsing(t *testing.T) {
	cases := []struct {
		line      string
		command   string
		sub       string
		continues bool
		caps      []string
	}{
		{"CAP * LS :sasl multi-prefix", "CAP", "LS", false, []string{"sasl", "multi-prefix"}},
		{":irc.example CAP me LS * :sasl", "CAP", "LS", true, []string{"sasl"}},
		{"CAP * ACK :sasl", "CAP", "ACK", false, []string{"sasl"}},
		{":srv 903 me :ok", "903", "", false, nil},
		{"", "", "", false, nil},
	}
	for _, c := range cases {
		if got := capCommand(c.line); got != c.command {
			t.Errorf("capCommand(%q) = %q, want %q", c.line, got, c.command)
		}
		if got := capSubcommand(c.line); got != c.sub {
			t.Errorf("capSubcommand(%q) = %q, want %q", c.line, got, c.sub)
		}
		if got := capLSContinues(c.line); got != c.continues {
			t.Errorf("capLSContinues(%q) = %v, want %v", c.line, got, c.continues)
		}
		if c.caps != nil {
			if got := parseCapList(c.line); !slices.Equal(got, c.caps) {
				t.Errorf("parseCapList(%q) = %v, want %v", c.line, got, c.caps)
			}
		}
	}
}

func TestRequestsOnlyTheCapabilitiesTheServerOffers(t *testing.T) {
	c, server, r := pipeClient(t, "mynick")
	c.Start()
	drainHandshake(t, r)
	writeLine(t, server, "CAP * LS :multi-prefix away-notify unknown-thing")
	got := expectLine(t, r)
	if !strings.HasPrefix(got, "CAP REQ :") || strings.Contains(got, "unknown-thing") || !strings.Contains(got, "multi-prefix") {
		t.Errorf("got %q, want a request for the wanted subset only", got)
	}
	writeLine(t, server, "CAP * ACK :multi-prefix away-notify")
	if got := expectLine(t, r); got != "CAP END\r\n" {
		t.Errorf("got %q, want CAP END after the ack", got)
	}
}

func TestDCCRequestsBecomeEvents(t *testing.T) {
	c, server, r := pipeClient(t, "mynick")
	events := make(chan any, 8)
	c.AddEventListener(func(e any) { events <- e })
	c.Start()
	drainHandshake(t, r)

	next := func() any {
		select {
		case e := <-events:
			return e
		case <-time.After(2 * time.Second):
			t.Fatal("no event")
			return nil
		}
	}
	// 3232235777 is 192.168.1.1
	writeLine(t, server, ":kestrel!k@host PRIVMSG mynick :\x01DCC CHAT chat 3232235777 5000\x01")
	if e, ok := next().(ircparse.DCCChatOfferEvent); !ok || e.Nick != "kestrel" || e.IP != "192.168.1.1" || e.Port != 5000 {
		t.Errorf("chat offer = %#v", e)
	}
	writeLine(t, server, ":bot!b@bot.example PRIVMSG mynick :\x01DCC SEND file.iso 3232235777 5001 2048\x01")
	if e, ok := next().(ircparse.XDCCSendOfferEvent); !ok || e.Nick != "bot" || e.Filename != "file.iso" || e.Port != 5001 || e.Size != 2048 || e.Host != "b@bot.example" {
		t.Errorf("send offer = %#v", e)
	}
	writeLine(t, server, ":bot!b@bot.example PRIVMSG mynick :\x01DCC ACCEPT file.iso 5001 1024\x01")
	if e, ok := next().(ircparse.XDCCResumeAcceptEvent); !ok || e.Filename != "file.iso" || e.Position != 1024 {
		t.Errorf("resume accept = %#v", e)
	}
}

func TestMalformedDCCRequestsAreIgnored(t *testing.T) {
	c, server, r := pipeClient(t, "mynick")
	events := make(chan any, 8)
	c.AddEventListener(func(e any) { events <- e })
	c.Start()
	drainHandshake(t, r)
	for _, bad := range []string{
		"\x01DCC\x01",
		"\x01DCC CHAT chat\x01",
		"\x01DCC CHAT chat notanumber 5000\x01",
		"\x01DCC CHAT chat 3232235777 notaport\x01",
		"\x01DCC SEND\x01",
		"\x01DCC ACCEPT nothing\x01",
		"\x01DCC FROBNICATE x\x01",
	} {
		writeLine(t, server, ":x!x@h PRIVMSG mynick :"+bad)
	}
	// a normal message afterwards proves the bad ones were consumed without effect
	writeLine(t, server, ":x!x@h PRIVMSG mynick :hello")
	select {
	case e := <-events:
		if _, ok := e.(ircparse.PrivmsgEvent); !ok {
			t.Errorf("a malformed DCC request produced %#v", e)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no event")
	}
}

func TestDialConnectsAndRefusesCleanly(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	accepted := make(chan net.Conn, 1)
	go func() {
		if c, err := ln.Accept(); err == nil {
			accepted <- c
		}
	}()
	c, err := Dial("127.0.0.1", port, "mira", false)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	if c.Nick() != "mira" {
		t.Errorf("Nick = %q", c.Nick())
	}
	(<-accepted).Close()
	ln.Close()

	if _, err := Dial("127.0.0.1", port, "mira", false); err == nil {
		t.Error("Dial to a closed port succeeded")
	}
}

func TestDialSecureFailsAgainstAServerThatDoesNotSpeakTLS(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		c.Write([]byte("this is not tls\r\n"))
		c.Close()
	}()
	if _, err := Dial("127.0.0.1", ln.Addr().(*net.TCPAddr).Port, "mira", true); err == nil {
		t.Error("a TLS dial to a plain server succeeded")
	}
}
