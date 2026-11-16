package bouncer

import (
	"log"
	"os"
	"strings"
	"testing"

	"github.com/Daemeron/dolq/backend/internal/ircparse"
)

func TestARefusedOfferIsLoggedWithItsReason(t *testing.T) {
	out := &logBuffer{}
	log.SetOutput(out)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	// no connection to take the offer on
	offer := ircparse.XDCCSendOfferEvent{Nick: "alice", Filename: "f.zip", IP: "127.0.0.1", Port: 1, Size: 10}
	if _, err := New(nil).XDCCAccept("nope", offer, t.TempDir(), 0, 0, &fakeSubscriber{}); err == nil {
		t.Fatal("an offer on a server we are not connected to was accepted")
	}

	// a disk with no room to spare
	was := freeSpace
	freeSpace = func(string) (uint64, uint64, error) { return 1000, 2000, nil }
	t.Cleanup(func() { freeSpace = was })
	b := New(nil)
	sub := &fakeSubscriber{}
	pipeSession(t, b, "server-a", sub)
	big := ircparse.XDCCSendOfferEvent{Nick: "bob", Filename: "big.iso", IP: "127.0.0.1", Port: 1, Size: 5_000_000}
	if _, err := b.XDCCAccept("server-a", big, t.TempDir(), 0, 0, sub); err == nil {
		t.Fatal("an offer that does not fit was accepted")
	}

	got := out.String()
	for _, want := range []string{
		`xdcc: could not accept f.zip from alice: bouncer: no session for "nope"`,
		"xdcc: could not accept big.iso from bob: not enough room in ",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("the log never said %q:\n%s", want, got)
		}
	}
}

func TestAnAcceptedOfferIsNotLoggedAsRefused(t *testing.T) {
	out := &logBuffer{}
	log.SetOutput(out)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	b := New(nil)
	sub := &fakeSubscriber{}
	pipeSession(t, b, "server-a", sub)
	offer := ircparse.XDCCSendOfferEvent{Nick: "alice", Filename: "f.zip", IP: "127.0.0.1", Port: 1, Size: 10}
	id, err := b.XDCCAccept("server-a", offer, t.TempDir(), 0, 0, sub)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { waitFor(t, func() bool { return b.xdccTransfer(id) == nil }) })
	if strings.Contains(out.String(), "could not accept") {
		t.Errorf("an offer that was taken up is logged as refused:\n%s", out.String())
	}
}
