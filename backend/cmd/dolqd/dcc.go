package main

import (
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"
)

// dccMappingLease is how long a router keeps a forwarded port if dolqd never removes it, such as when it is killed. It
// outlasts the three minutes a transfer waits for its peer.
const dccMappingLease = 5 * time.Minute

// dccSettings is how this machine is reached by a peer that has to connect to it: a passive XDCC offer, a DCC chat
// offered, a file sent.
type dccSettings struct {
	// host is announced to the peer; empty is this machine's own address.
	host string
	// auto asks the router for the public address and for a port to be forwarded, for each transfer (host was "auto").
	auto bool
	// minPort and maxPort are the only ports listened on; zero means any.
	minPort, maxPort int
}

// readDCCSettings reads -dcc-host and -dcc-ports, each falling back to DOLQ_DCC_HOST and DOLQ_DCC_PORTS.
func readDCCSettings(hostFlag, portsFlag string, getenv func(string) string) (dccSettings, error) {
	s := dccSettings{host: strings.TrimSpace(hostFlag)}
	if s.host == "" {
		s.host = strings.TrimSpace(getenv("DOLQ_DCC_HOST"))
	}
	if strings.EqualFold(s.host, "auto") {
		s.host, s.auto = "", true
	}
	ports := strings.TrimSpace(portsFlag)
	if ports == "" {
		ports = strings.TrimSpace(getenv("DOLQ_DCC_PORTS"))
	}
	if ports == "" {
		return s, nil
	}
	min, max, err := parsePortRange(ports)
	if err != nil {
		return dccSettings{}, err
	}
	s.minPort, s.maxPort = min, max
	return s, nil
}

// parsePortRange reads "40000-40010", or a single port "40000".
func parsePortRange(s string) (min, max int, err error) {
	lo, hi, isRange := strings.Cut(s, "-")
	if min, err = strconv.Atoi(strings.TrimSpace(lo)); err != nil {
		return 0, 0, fmt.Errorf("DCC ports %q: not a port or a range such as 40000-40010", s)
	}
	max = min
	if isRange {
		if max, err = strconv.Atoi(strings.TrimSpace(hi)); err != nil {
			return 0, 0, fmt.Errorf("DCC ports %q: not a port or a range such as 40000-40010", s)
		}
	}
	if min < 1 || max > 65535 || max < min {
		return 0, 0, fmt.Errorf("DCC ports %q: ports run from 1 to 65535, and the first cannot be above the last", s)
	}
	return min, max, nil
}

// dccLines says at start-up how a peer reaches this machine, and warns where the default cannot work: in a container, the
// machine's own address is the container's, and nothing outside can connect to it.
func dccLines(c dccSettings, inContainer bool, announce func(host string) (net.IP, error)) []string {
	var lines []string
	switch {
	case c.auto:
		lines = append(lines, "DCC: peers that have to connect here (a passive offer, a chat, a file sent) are told the router's public address and a port it forwards to this machine, asked for (UPnP or NAT-PMP) when a transfer needs it and given back afterwards")
		if inContainer {
			lines = append(lines, "warning: DCC: the router is found by a broadcast on the network, which a Docker bridge network cannot send: this needs host networking (network_mode: host)")
		}
	case c.host != "":
		if ip, err := announce(c.host); err != nil {
			lines = append(lines, fmt.Sprintf("warning: DCC: cannot announce %s to peers: %v", c.host, err))
		} else {
			lines = append(lines, fmt.Sprintf("DCC: peers that have to connect here (a passive offer, a chat, a file sent) are told %s (%s)", c.host, ip))
		}
	case inContainer:
		lines = append(lines, "warning: DCC: in a container, peers that have to connect here (a passive XDCC offer, a DCC chat, a file sent) are told the container's own address, which nothing outside can reach. Set DOLQ_DCC_HOST to your public address or name, and DOLQ_DCC_PORTS, a range published as ports. Active offers, where the sender listens, are not affected")
	}
	if c.maxPort > 0 {
		lines = append(lines, fmt.Sprintf("DCC: connections to this machine listen on ports %d-%d (forward or publish them)", c.minPort, c.maxPort))
	}
	return lines
}
