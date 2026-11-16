package bouncer

import (
	"strconv"
	"strings"
	"testing"

	"github.com/Daemeron/dolq/backend/internal/dcc"
	"github.com/Daemeron/dolq/backend/internal/ircparse"
)

// announced reads the address and port a line told a peer to connect to: "...DCC SEND file IP PORT size token" or "...DCC CHAT chat IP PORT".
func announced(t *testing.T, line, verb string) (ip string, port int, rest []string) {
	t.Helper()
	_, after, ok := strings.Cut(line, "\x01DCC "+verb+" ")
	if !ok {
		t.Fatalf("not a DCC %s line: %q", verb, line)
	}
	fields := strings.Fields(strings.TrimSuffix(strings.TrimSpace(after), "\x01"))
	n, err := strconv.ParseUint(fields[1], 10, 32)
	if err != nil {
		t.Fatalf("the address in %q is not a number: %v", line, err)
	}
	port, err = strconv.Atoi(fields[2])
	if err != nil {
		t.Fatalf("the port in %q is not a number: %v", line, err)
	}
	return dcc.DecodeIP(uint32(n)).String(), port, append([]string{fields[0]}, fields[3:]...)
}

func TestAPassiveOfferAnnouncesTheConfiguredAddressAndAPortInTheRange(t *testing.T) {
	b := New(nil)
	b.DCCHost = "203.0.113.7"
	sub := &fakeSubscriber{}
	_, r := pipeSession(t, b, "server-a", sub)

	dir := t.TempDir()
	passive := ircparse.XDCCSendOfferEvent{Nick: "gattsu", Filename: "other.mkv", Size: 2048, Token: "7"}
	type accepted struct {
		id  string
		err error
	}
	done := make(chan accepted, 1)
	go func() {
		id, err := b.XDCCAccept("server-a", passive, dir, 41000, 41010, sub)
		done <- accepted{id, err}
	}()

	line, err := r.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	ip, port, rest := announced(t, line, "SEND")
	if ip != "203.0.113.7" {
		t.Errorf("the peer was told %s, not the configured address", ip)
	}
	if port < 41000 || port > 41010 {
		t.Errorf("the peer was told port %d, outside 41000-41010", port)
	}
	if strings.Join(rest, " ") != "other.mkv 2048 7" {
		t.Errorf("the rest of the offer was %v, want the file, its size and the token", rest)
	}

	res := <-done
	if res.err != nil {
		t.Fatal(res.err)
	}
	// the transfer holds its file open while it waits for the peer, and Windows will not delete an open file
	t.Cleanup(func() {
		b.XDCCClose(res.id)
		waitFor(t, func() bool { return b.xdccTransfer(res.id) == nil })
	})
}

func TestADCCChatOfferAnnouncesTheConfiguredAddress(t *testing.T) {
	b := New(nil)
	b.DCCHost = "localhost"
	sub := &fakeSubscriber{}
	_, r := pipeSession(t, b, "server-a", sub)

	errs := make(chan error, 1)
	go func() {
		_, err := b.DCCOffer("server-a", "bob", 0, 0, sub)
		errs <- err
	}()
	line, err := r.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if ip, _, _ := announced(t, line, "CHAT"); ip != "127.0.0.1" {
		t.Errorf("the peer was told %s, want the address of the configured name", ip)
	}
	if err := <-errs; err != nil {
		t.Fatal(err)
	}
}

func TestAnOfferIsRefusedWhenTheConfiguredAddressCannotBeAnnounced(t *testing.T) {
	b := New(nil)
	b.DCCHost = "2001:db8::1"
	sub := &fakeSubscriber{}
	pipeSession(t, b, "server-a", sub)

	passive := ircparse.XDCCSendOfferEvent{Nick: "gattsu", Filename: "other.mkv", Size: 2048, Token: "7"}
	if _, err := b.XDCCAccept("server-a", passive, t.TempDir(), 0, 0, sub); err == nil {
		t.Fatal("a passive offer was accepted with an address that cannot be announced")
	}
}
