package bouncer

import (
	"context"
	"errors"
	"net"
	"strconv"
	"strings"
	"sync"
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

// fakeReacher stands in for a router: it announces a public address and a port other than the one listened on, and
// records what it was asked for and what was given back.
type fakeReacher struct {
	mu       sync.Mutex
	err      error
	asked    []int
	released int
}

func (f *fakeReacher) Reach(_ context.Context, listenPort int) (net.IP, int, func(), error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return nil, 0, nil, f.err
	}
	f.asked = append(f.asked, listenPort)
	return net.IPv4(80, 144, 209, 90), listenPort + 1000, func() {
		f.mu.Lock()
		f.released++
		f.mu.Unlock()
	}, nil
}

func (f *fakeReacher) releasedCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.released
}

func TestAPassiveOfferThroughARouterAnnouncesItsAddressAndPortAndGivesTheMappingBack(t *testing.T) {
	router := &fakeReacher{}
	b := New(nil)
	b.Reacher = router
	sub := &fakeSubscriber{}
	_, r := pipeSession(t, b, "server-a", sub)

	passive := ircparse.XDCCSendOfferEvent{Nick: "gattsu", Filename: "other.mkv", Size: 2048, Token: "7"}
	type accepted struct {
		id  string
		err error
	}
	done := make(chan accepted, 1)
	dir := t.TempDir()
	go func() {
		id, err := b.XDCCAccept("server-a", passive, dir, 0, 0, sub)
		done <- accepted{id, err}
	}()
	line, err := r.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	ip, port, _ := announced(t, line, "SEND")
	res := <-done
	if res.err != nil {
		t.Fatal(res.err)
	}
	t.Cleanup(func() {
		b.XDCCClose(res.id)
		waitFor(t, func() bool { return b.xdccTransfer(res.id) == nil })
	})

	if ip != "80.144.209.90" {
		t.Errorf("the peer was told %s, want the router's address", ip)
	}
	if len(router.asked) != 1 || port != router.asked[0]+1000 {
		t.Errorf("the peer was told port %d; the router was asked about %v and hands out that plus 1000", port, router.asked)
	}
	if router.releasedCount() != 0 {
		t.Error("the mapping was given back while the transfer still waits for the peer")
	}

	b.XDCCClose(res.id) // the peer never comes: the wait ends and the port is given back
	waitFor(t, func() bool { return router.releasedCount() == 1 })
	if got := router.releasedCount(); got != 1 {
		t.Errorf("the mapping was given back %d times, want once", got)
	}
}

func TestAnOfferIsRefusedAtOnceWhenTheRouterCannotBeUsed(t *testing.T) {
	router := &fakeReacher{err: errors.New("no router answered")}
	b := New(nil)
	b.Reacher = router
	sub := &fakeSubscriber{}
	pipeSession(t, b, "server-a", sub)

	passive := ircparse.XDCCSendOfferEvent{Nick: "gattsu", Filename: "other.mkv", Size: 2048, Token: "7"}
	_, err := b.XDCCAccept("server-a", passive, t.TempDir(), 0, 0, sub)
	if err == nil || !strings.Contains(err.Error(), "no router answered") {
		t.Fatalf("got %v, want the router's reason", err)
	}
	if _, err := b.DCCOffer("server-a", "bob", 0, 0, sub); err == nil {
		t.Error("a chat was offered with no way for the peer to connect")
	}
}
