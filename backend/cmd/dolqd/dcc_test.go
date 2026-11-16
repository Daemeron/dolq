package main

import (
	"errors"
	"net"
	"strings"
	"testing"
)

func TestParsePortRange(t *testing.T) {
	cases := []struct {
		in       string
		min, max int
		ok       bool
	}{
		{"40000-40010", 40000, 40010, true},
		{" 40000 - 40010 ", 40000, 40010, true},
		{"40000", 40000, 40000, true},
		{"1-65535", 1, 65535, true},
		{"", 0, 0, false},
		{"abc", 0, 0, false},
		{"40000-abc", 0, 0, false},
		{"40010-40000", 0, 0, false}, // backwards
		{"0-10", 0, 0, false},
		{"40000-70000", 0, 0, false},
	}
	for _, c := range cases {
		min, max, err := parsePortRange(c.in)
		if (err == nil) != c.ok || min != c.min || max != c.max {
			t.Errorf("parsePortRange(%q) = %d, %d, %v; want %d, %d, ok=%v", c.in, min, max, err, c.min, c.max, c.ok)
		}
	}
}

func TestDCCSettingsReadTheFlagsFirstAndThenTheEnvironment(t *testing.T) {
	env := map[string]string{"DOLQ_DCC_HOST": "nas.example.org", "DOLQ_DCC_PORTS": "40000-40010"}
	getenv := func(k string) string { return env[k] }

	got, err := readDCCSettings("", "", getenv)
	if err != nil || got != (dccSettings{host: "nas.example.org", minPort: 40000, maxPort: 40010}) {
		t.Errorf("from the environment: got %+v, %v", got, err)
	}
	got, err = readDCCSettings("203.0.113.7", "41000-41005", getenv)
	if err != nil || got != (dccSettings{host: "203.0.113.7", minPort: 41000, maxPort: 41005}) {
		t.Errorf("a flag wins over the environment: got %+v, %v", got, err)
	}
	got, err = readDCCSettings("", "", func(string) string { return "" })
	if err != nil || got != (dccSettings{}) {
		t.Errorf("nothing set should leave the machine's own address and any port: got %+v, %v", got, err)
	}
	if _, err := readDCCSettings("", "nonsense", getenv); err == nil {
		t.Error("a bad port range was accepted")
	}
}

func TestAutoAsksTheRouterAndIsNotAnAddress(t *testing.T) {
	getenv := func(k string) string { return map[string]string{"DOLQ_DCC_HOST": "Auto"}[k] }
	got, err := readDCCSettings("", "", getenv)
	if err != nil || !got.auto || got.host != "" {
		t.Errorf("DOLQ_DCC_HOST=Auto: got %+v, %v; want the router asked, and no address", got, err)
	}
	if got, _ := readDCCSettings("auto", "", func(string) string { return "" }); !got.auto {
		t.Errorf("-dcc-host auto: got %+v", got)
	}

	announce := func(string) (net.IP, error) { return nil, errors.New("not used") }
	lines := strings.Join(dccLines(dccSettings{auto: true}, false, announce), "\n")
	if !strings.Contains(lines, "router's public address") || strings.Contains(lines, "warning") {
		t.Errorf("a plain machine with auto should say what it will do, and not warn:\n%s", lines)
	}
	lines = strings.Join(dccLines(dccSettings{auto: true}, true, announce), "\n")
	if !strings.Contains(lines, "warning") || !strings.Contains(lines, "network_mode: host") {
		t.Errorf("a container with auto needs host networking, and should say so:\n%s", lines)
	}
}

func TestDCCLinesSayHowAPeerReachesThisMachine(t *testing.T) {
	announce := func(host string) (net.IP, error) {
		if host == "bad.example" {
			return nil, errors.New("no such host")
		}
		return net.IPv4(203, 0, 113, 7), nil
	}
	join := func(l []string) string { return strings.Join(l, "\n") }

	got := join(dccLines(dccSettings{host: "mynas.example", minPort: 40000, maxPort: 40010}, true, announce))
	for _, want := range []string{"are told mynas.example (203.0.113.7)", "ports 40000-40010"} {
		if !strings.Contains(got, want) {
			t.Errorf("never said %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "warning") {
		t.Errorf("a configured address was warned about:\n%s", got)
	}

	if got := join(dccLines(dccSettings{host: "bad.example"}, false, announce)); !strings.Contains(got, "warning: DCC: cannot announce bad.example") {
		t.Errorf("an address that cannot be announced was not warned about:\n%s", got)
	}

	if got := join(dccLines(dccSettings{}, true, announce)); !strings.Contains(got, "warning") || !strings.Contains(got, "DOLQ_DCC_HOST") {
		t.Errorf("a container with no address set was not warned, with the way out:\n%s", got)
	}
	if got := dccLines(dccSettings{}, false, announce); len(got) != 0 {
		t.Errorf("a plain machine with nothing set needs no line, got %v", got)
	}
}
