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

// expectNoLine fails if the client writes anything within a short window -
// used to assert a retry/reply was deliberately withheld. Uses conn's own
// deadline (net.Pipe supports one) and reads directly on the calling
// goroutine, unlike expectLine, so there's nothing left running - and
// nothing that can call t.Fatal - once the subtest that started it returns.
func expectNoLine(t *testing.T, conn net.Conn, r *bufio.Reader) {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	defer conn.SetReadDeadline(time.Time{})
	if line, err := r.ReadString('\n'); err == nil {
		t.Fatalf("got unexpected line %q", line)
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

// drainHandshake reads off the four lines every connection sends up front:
// CAP LS (always, now - see negotiateCaps), then the classic PASS/NICK/USER
// registration trio.
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
		c.FloodInterval = time.Hour // never refills during this test
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
		expectLine(t, r) // spends the only token, immediately

		go c.SendPaced("PRIVMSG #chan :second")
		expectNoLine(t, server, r) // still well within the interval
		if got := expectLine(t, r); got != "PRIVMSG #chan :second\r\n" {
			t.Errorf("got %q", got)
		}
	})

	t.Run("returns an error if the connection closes while waiting for a token", func(t *testing.T) {
		c, server, r := pipeClient(t, "testnick")
		c.Start()
		drainHandshake(t, r)
		c.FloodBurst = 1
		c.FloodInterval = time.Hour // never refills in time
		go c.SendPaced("PRIVMSG #chan :first")
		expectLine(t, r) // spends the only token

		errCh := make(chan error, 1)
		go func() { errCh <- c.SendPaced("PRIVMSG #chan :second") }()

		server.Close() // trips the read loop's EOF, closing c.closed
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
		// sasl is the only thing offered and it's never requested without
		// credentials, so this should go straight to CAP END - no CAP REQ,
		// no AUTHENTICATE, at all.
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

		// Offers only sasl - baseline cap requesting is covered by
		// TestCapNegotiation, so this stays focused on the SASL exchange.
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
		drainHandshake(t, r)

		writeLine(t, server, "CAP * LS :sasl")
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

	t.Run("gives up after CapTimeout when the server never acks the sasl request", func(t *testing.T) {
		c, server, r := pipeClient(t, "mynick")
		c.SASLUser = "myuser"
		c.SASLPass = "mypass"
		c.CapTimeout = 30 * time.Millisecond
		c.Start()
		drainHandshake(t, r)

		writeLine(t, server, "CAP * LS :sasl")
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
			}
			if !reflect.DeepEqual(e, want) {
				t.Errorf("got %#v, want %#v", e, want)
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
		select {
		case e := <-events:
			t.Errorf("expected no event, got %#v", e)
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
		select {
		case e := <-events:
			t.Fatalf("expected no event yet, got %#v", e)
		case <-time.After(50 * time.Millisecond):
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

		// e.g. from PRIVMSGing someone who's away - no preceding 311 for them.
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

		// AltNicks exhausted - falls back to underscore-appending the last
		// rejected nick, same as with no AltNicks configured at all.
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
			expectLine(t, r) // the retry NICK
			<-events
		}

		// One more collision past the cap: no further NICK sent, and the
		// event reports it gave up (Retrying empty).
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

		expectNoLine(t, server, r)
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
		<-events // WELCOME

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

		expectNoLine(t, server, r)
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
