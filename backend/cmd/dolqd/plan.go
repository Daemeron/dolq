package main

import (
	"errors"
	"fmt"

	"github.com/Daemeron/dolq/backend/internal/ipcproto"
)

// options are the parsed command-line flags that decide how dolqd listens
// and how it secures the listener.
type options struct {
	socket     string
	addr       string
	tlsCert    string
	tlsKey     string
	acmeDomain string
	secure     bool
	tls        bool
	token      bool
}

// listenPlan is what main does with options and the environment, decided
// up front without touching the filesystem or the network.
type listenPlan struct {
	network string // "unix", "tcp" or "pipe"
	// path is the address to listen on; empty for a unix socket with no
	// -socket, where main creates a private temp dir for it (tempSocket).
	path       string
	tempSocket bool

	useToken bool
	// token is DOLQ_TOKEN; on tcp with useToken and no DOLQ_TOKEN, main loads
	// or creates one next to the database (loadToken).
	token     string
	loadToken bool

	useTLS bool
	// acme is set when TLS comes from Let's Encrypt for options.acmeDomain;
	// otherwise, with useTLS, certFile/keyFile is the explicit pair, or both
	// empty for the default pair next to the database.
	acme              bool
	certFile, keyFile string

	secureOnly bool
	// allowPlain: with TLS, still accept plain unauthenticated connections.
	allowPlain bool
	pairing    bool // log the pairing link

	noTokenWarning bool // tcp with -token=false
	plainWarning   bool // tcp without TLS on a non-loopback address
}

var errSecureConflict = errors.New("-secure refuses connections that are not TLS with an access token, so it cannot be combined with -tls=false or -token=false")

// plan turns flags, the environment (getenv) and the OS into a listenPlan.
// pid names the Windows pipe. It does no I/O.
func plan(o options, getenv func(string) string, goos string, pid int) (listenPlan, error) {
	p := listenPlan{network: "unix", path: o.socket}
	if o.addr != "" {
		p.network, p.path = "tcp", o.addr
	} else if p.path == "" && goos == "windows" {
		// Node can't connect to AF_UNIX sockets on Windows (EACCES); use a named pipe
		p.network, p.path = "pipe", fmt.Sprintf(`\\.\pipe\dolq-%d`, pid)
	}
	p.tempSocket = p.network == "unix" && o.socket == ""
	tcp := p.network == "tcp"

	// The token comes from the environment, not a flag, so it never shows up in
	// a process listing. A network listener always needs one: if none is given,
	// a random one is created once and kept next to the database.
	p.token = getenv("DOLQ_TOKEN")
	p.useToken = !tcp || o.token
	if tcp && !p.useToken {
		p.token = ""
		p.noTokenWarning = true
	} else if tcp && p.token == "" {
		p.loadToken = true
	}

	p.useTLS = tcp && o.tls
	p.secureOnly = o.secure || getenv("DOLQ_SECURE") == "1"
	if p.secureOnly && tcp && (!p.useTLS || !p.useToken) {
		return listenPlan{}, errSecureConflict
	}
	if p.useTLS && o.acmeDomain != "" {
		p.acme = true
	} else if p.useTLS {
		if o.tlsCert != "" && o.tlsKey != "" {
			p.certFile, p.keyFile = o.tlsCert, o.tlsKey
		}
	} else if tcp && !ipcproto.IsLoopback(p.path) {
		p.plainWarning = true
	}

	p.pairing = tcp && p.useToken
	// Plain connections are the legacy path for clients that predate tokens;
	// with no token to protect there is nothing to stay compatible with.
	p.allowPlain = p.useTLS && p.useToken && !p.secureOnly
	return p, nil
}
