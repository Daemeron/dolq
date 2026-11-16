package natmap

import (
	"context"
	"errors"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeGateway struct {
	mu       sync.Mutex
	external net.IP
	extErr   error
	mapErr   error
	assign   func(internal int) int // the external port the router hands out
	mapped   []int
	deleted  []int
	delErr   error
}

func (g *fakeGateway) Type() string { return "fake UPnP" }

func (g *fakeGateway) GetExternalAddress() (net.IP, error) { return g.external, g.extErr }

func (g *fakeGateway) AddPortMapping(_ context.Context, protocol string, internal int, _ string, _ time.Duration) (int, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if protocol != "tcp" {
		return 0, errors.New("only tcp is expected")
	}
	if g.mapErr != nil {
		return 0, g.mapErr
	}
	g.mapped = append(g.mapped, internal)
	if g.assign != nil {
		return g.assign(internal), nil
	}
	return internal, nil
}

func (g *fakeGateway) DeletePortMapping(_ context.Context, _ string, internal int) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.deleted = append(g.deleted, internal)
	return g.delErr
}

// mapperFor is a Mapper whose router is gw, counting how often it is searched for.
func mapperFor(gw Gateway, err error) (*Mapper, *int) {
	searches := 0
	now := time.Unix(1_700_000_000, 0)
	m := New(5 * time.Minute)
	m.Now = func() time.Time { return now }
	m.Discover = func(context.Context) (Gateway, error) {
		searches++
		return gw, err
	}
	return m, &searches
}

func TestReachForwardsAPortAndGivesItBack(t *testing.T) {
	gw := &fakeGateway{external: net.IPv4(80, 144, 209, 90)}
	m, _ := mapperFor(gw, nil)

	ip, port, release, err := m.Reach(context.Background(), 41234)
	if err != nil {
		t.Fatal(err)
	}
	if got := ip.String(); got != "80.144.209.90" || port != 41234 {
		t.Errorf("announced %s:%d, want the router's address and the forwarded port 41234", got, port)
	}
	if len(gw.mapped) != 1 || gw.mapped[0] != 41234 {
		t.Errorf("the router was asked to map %v", gw.mapped)
	}
	if len(gw.deleted) != 0 {
		t.Error("the forward was removed before it was released")
	}
	release()
	release() // may be called again, it must not ask the router twice
	if len(gw.deleted) != 1 || gw.deleted[0] != 41234 {
		t.Errorf("after release the router was asked to remove %v, want [41234] once", gw.deleted)
	}
}

func TestReachAnnouncesThePortTheRouterAssigned(t *testing.T) {
	gw := &fakeGateway{external: net.IPv4(80, 144, 209, 90), assign: func(internal int) int { return internal + 1000 }}
	m, _ := mapperFor(gw, nil)
	_, port, _, err := m.Reach(context.Background(), 41234)
	if err != nil || port != 42234 {
		t.Errorf("announced port %d, %v; want the router's 42234", port, err)
	}
}

func TestReachRefusesAnAddressNobodyOnTheInternetCanReach(t *testing.T) {
	for name, ip := range map[string]net.IP{
		"another router in front": net.IPv4(192, 168, 1, 1),
		"private":                 net.IPv4(10, 0, 0, 5),
		"provider shared (CGNAT)": net.IPv4(100, 72, 3, 4),
		"link local":              net.IPv4(169, 254, 1, 1),
		"not known yet":           net.IPv4zero,
	} {
		gw := &fakeGateway{external: ip}
		m, _ := mapperFor(gw, nil)
		if _, _, _, err := m.Reach(context.Background(), 41234); err == nil {
			t.Errorf("%s (%s): a port was forwarded to an address nobody can reach", name, ip)
		}
		if len(gw.mapped) != 0 {
			t.Errorf("%s: the router was asked to open a port anyway", name)
		}
	}
}

func TestReachSaysWhyWhenTheRouterCannotBeUsed(t *testing.T) {
	m, _ := mapperFor(nil, errors.New("no NAT found"))
	if _, _, _, err := m.Reach(context.Background(), 1); err == nil || !strings.Contains(err.Error(), "host networking") {
		t.Errorf("no router: got %v, want a reason that names host networking", err)
	}

	gw := &fakeGateway{external: net.IPv4(80, 144, 209, 90), mapErr: errors.New("718 ConflictInMappingEntry")}
	m, _ = mapperFor(gw, nil)
	if _, _, _, err := m.Reach(context.Background(), 1); err == nil || !strings.Contains(err.Error(), "would not forward a port") {
		t.Errorf("a refused mapping: got %v", err)
	}
	gw = &fakeGateway{extErr: errors.New("timeout")}
	m, _ = mapperFor(gw, nil)
	if _, _, _, err := m.Reach(context.Background(), 1); err == nil || !strings.Contains(err.Error(), "would not say its public address") {
		t.Errorf("no public address: got %v", err)
	}
}

func TestTheRouterIsFoundOnceWhileItIsRememberedAndNotSearchedForAgainSoon(t *testing.T) {
	gw := &fakeGateway{external: net.IPv4(80, 144, 209, 90)}
	m, searches := mapperFor(gw, nil)
	for range 3 {
		if _, _, release, err := m.Reach(context.Background(), 1); err != nil {
			t.Fatal(err)
		} else {
			release()
		}
	}
	if *searches != 1 {
		t.Errorf("the router was searched for %d times, want once", *searches)
	}

	missing, searches2 := mapperFor(nil, errors.New("none"))
	for range 3 {
		missing.Reach(context.Background(), 1)
	}
	if *searches2 != 1 {
		t.Errorf("a missing router was searched for %d times in a row, want once", *searches2)
	}
	now := missing.Now()
	missing.Now = func() time.Time { return now.Add(notFoundFor + time.Second) }
	missing.Reach(context.Background(), 1)
	if *searches2 != 2 {
		t.Errorf("after a while the search should be made again, got %d searches", *searches2)
	}
}

func TestProbeSaysWhatTheRouterWouldGiveOutWithoutOpeningAnything(t *testing.T) {
	gw := &fakeGateway{external: net.IPv4(80, 144, 209, 90)}
	m, _ := mapperFor(gw, nil)
	line, err := m.Probe(context.Background())
	if err != nil || !strings.Contains(line, "80.144.209.90") || !strings.Contains(line, "fake UPnP") {
		t.Errorf("Probe = %q, %v", line, err)
	}
	if len(gw.mapped) != 0 {
		t.Error("probing opened a port")
	}
	m, _ = mapperFor(&fakeGateway{external: net.IPv4(192, 168, 0, 1)}, nil)
	if _, err := m.Probe(context.Background()); err == nil {
		t.Error("a private address was reported as usable")
	}
}
