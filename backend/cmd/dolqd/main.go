// Command dolqd is the standalone Dolq IRC backend: an IRC client, a
// bouncer/session manager, and a local IPC socket a frontend talks to.
package main

import (
	"context"
	"crypto/tls"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
	"time"

	"github.com/Daemeron/dolq/backend/internal/bouncer"
	"github.com/Daemeron/dolq/backend/internal/history"
	"github.com/Daemeron/dolq/backend/internal/ipcproto"
)

func main() {
	socketPath := flag.String("socket", "", "Unix domain socket path to listen on (default: a path under the OS temp dir); ignored if -addr is set")
	addr := flag.String("addr", "", "TCP address to listen on instead of a Unix socket, e.g. 0.0.0.0:6789 - for a remote backend (see docker/) a frontend dials over the network; a locally-spawned dolqd should leave this unset")
	dbPath := flag.String("db", "", "SQLite database path for message history (default: a path under the OS config dir)")
	tlsCert := flag.String("tls-cert", "", "TLS certificate (PEM) for -addr; with -tls-key. If neither file exists a self-signed pair is generated there (default: next to the database)")
	tlsKey := flag.String("tls-key", "", "TLS private key (PEM) for -addr")
	acmeDomain := flag.String("acme-domain", "", "get and renew a Let's Encrypt certificate for this domain (needs port 443 reachable from the internet and the name pointing here); replaces the self-signed certificate")
	acmeEmail := flag.String("acme-email", "", "contact address for Let's Encrypt expiry notices (optional)")
	acmeStaging := flag.Bool("acme-staging", false, "use Let's Encrypt's staging CA (untrusted certificates) to test the setup")
	secure := flag.Bool("secure", false, "with TLS on -addr, accept only TLS connections that present the access token, refusing plain unauthenticated ones. By default those are still accepted on the same port so clients and setups from before access tokens keep working; once every client is paired, turn this on (also DOLQ_SECURE=1)")
	useTLSFlag := flag.Bool("tls", true, "serve -addr over TLS; -tls=false for plain TCP, e.g. behind a TLS-terminating proxy or an SSH tunnel")
	useTokenFlag := flag.Bool("token", true, "require an access token on -addr (DOLQ_TOKEN, or generated once and kept next to the database); -token=false means anyone who can reach the port can use it, so only on a network you fully trust. Independent of -tls")
	downloadDir := flag.String("download-dir", "", "with -addr, where XDCC downloads are saved; clients cannot choose another directory (also DOLQ_DOWNLOAD_DIR; default: a downloads dir next to the database). A locally spawned dolqd saves where the app asks")
	retentionDays := flag.Int("retention-days", 0, "prune history older than this many days (0 = keep forever)")
	flag.Parse()

	// Installed before the socket path is printed, so a parent signalling
	// right after reading it gets a clean shutdown rather than a default kill.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	p, err := plan(options{
		socket: *socketPath, addr: *addr, tlsCert: *tlsCert, tlsKey: *tlsKey, acmeDomain: *acmeDomain,
		secure: *secure, tls: *useTLSFlag, token: *useTokenFlag,
	}, os.Getenv, runtime.GOOS, os.Getpid())
	if err != nil {
		log.Fatal(err)
	}
	network, path, token := p.network, p.path, p.token
	if p.noTokenWarning {
		log.Print("warning: -token=false: no access token; anyone who can reach this port can read your history and use your IRC sessions")
	}
	if p.loadToken {
		if token, err = ipcproto.LoadOrCreateToken(filepath.Join(filepath.Dir(resolveDBPath(*dbPath)), "token")); err != nil {
			log.Fatalf("access token: %v", err)
		}
	}

	var fingerprint string
	var tlsCfg *tls.Config
	if p.acme {
		cacheDir := filepath.Join(filepath.Dir(resolveDBPath(*dbPath)), "acme")
		tlsCfg = ipcproto.ACMEConfig(*acmeDomain, *acmeEmail, cacheDir, *acmeStaging)
		log.Printf("serving TLS with a Let's Encrypt certificate for %s (port 443 must reach this listener)", *acmeDomain)
	} else if p.useTLS {
		certFile, keyFile := p.certFile, p.keyFile
		if certFile == "" {
			dir := filepath.Dir(resolveDBPath(*dbPath))
			certFile, keyFile = filepath.Join(dir, "tls-cert.pem"), filepath.Join(dir, "tls-key.pem")
		}
		hostname, _ := os.Hostname()
		cert, err := ipcproto.LoadOrCreateCert(certFile, keyFile, []string{"localhost", "127.0.0.1", "::1", hostname})
		if err != nil {
			log.Fatalf("tls certificate: %v", err)
		}
		tlsCfg = ipcproto.ServerTLSConfig(cert)
		fingerprint = ipcproto.Fingerprint(cert)
		log.Printf("serving TLS, certificate SHA-256 fingerprint: %s", fingerprint)
	} else if p.plainWarning {
		log.Print("warning: listening without TLS on a non-loopback address; passwords and chat cross the network in the clear")
	}

	if p.tempSocket {
		// A private directory of our own: the socket is never reachable via a shared, world-listable /tmp.
		dir, err := os.MkdirTemp("", "dolq-")
		if err != nil {
			log.Fatalf("create socket dir: %v", err)
		}
		path = filepath.Join(dir, "dolq.sock")
	}

	ln, err := ipcproto.Listen(network, path)
	if err != nil {
		log.Fatalf("listen on %s %s: %v", network, path, err)
	}
	if p.pairing {
		logPairing(path, token, fingerprint, p.useTLS)
	}
	if tlsCfg != nil {
		if p.allowPlain {
			log.Print("warning: plain, unauthenticated connections are still accepted on this port so older clients keep working; pair your clients and restart with -secure to refuse them")
		}
		ln = ipcproto.NewSniffingListener(ln, tlsCfg, p.allowPlain)
	}
	// One bare line to stdout: the discovery contract a future parent
	// process (e.g. Electron, spawning this as a local child) reads to find
	// the socket it should connect to. Meaningless over tcp (nothing spawns
	// a remote dolqd to read its stdout), but harmless - left unconditional.
	fmt.Println(path)

	store, err := history.Open(resolveDBPath(*dbPath), *retentionDays)
	if err != nil {
		log.Fatalf("open history db: %v", err)
	}
	defer store.Close()

	b := bouncer.New(store)
	srv := ipcproto.NewServer(b).RequireToken(token)
	if network == "tcp" {
		dir := serverDownloadDir(*downloadDir, os.Getenv("DOLQ_DOWNLOAD_DIR"), *dbPath)
		if err := os.MkdirAll(dir, 0o700); err != nil {
			log.Fatalf("create download dir %s: %v", dir, err)
		}
		log.Printf("saving downloads to %s", dir)
		srv.DownloadDir(dir)
	}

	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.Serve(ln) }()

	select {
	case <-ctx.Done():
		log.Println("shutting down...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		b.Shutdown(shutdownCtx)
		cancel()
		ln.Close()
		if network == "unix" {
			os.Remove(path)
			if p.tempSocket {
				os.Remove(filepath.Dir(path))
			}
		}
	case err := <-serveErr:
		log.Printf("serve error: %v", err)
	}
}

// resolveDBPath honors an explicit -db flag, otherwise places the database
// under the OS's standard per-user config dir (~/Library/Application
// Support, %AppData%, ~/.config) - unlike the socket, this has to survive
// across restarts.
func resolveDBPath(explicit string) string {
	if explicit != "" {
		return explicit
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		log.Fatalf("resolve config dir: %v", err)
	}
	dir = filepath.Join(dir, "dolq")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.Fatalf("create config dir %s: %v", dir, err)
	}
	return filepath.Join(dir, "history.db")
}

// serverDownloadDir picks the directory a network listener saves downloads to:
// -download-dir, else DOLQ_DOWNLOAD_DIR, else "downloads" next to the database.
func serverDownloadDir(flagDir, envDir, dbPath string) string {
	if flagDir != "" {
		return flagDir
	}
	if envDir != "" {
		return envDir
	}
	return filepath.Join(filepath.Dir(resolveDBPath(dbPath)), "downloads")
}

// logPairing prints the link a client pastes into Preferences to connect. The
// host is DOLQ_PUBLIC_HOST (and the port DOLQ_PUBLIC_PORT) if set, else this machine's LAN addresses (inside a
// container those are not reachable from outside: set DOLQ_PUBLIC_HOST, or
// replace the host in the link with the machine's name).
func logPairing(listenAddr, token, fingerprint string, tls bool) {
	_, portStr, err := net.SplitHostPort(listenAddr)
	port, _ := strconv.Atoi(portStr)
	if err != nil || port == 0 {
		return
	}
	// Behind a port mapping (Docker, a Kubernetes NodePort) clients use another port than the one bound here.
	if p, err := strconv.Atoi(os.Getenv("DOLQ_PUBLIC_PORT")); err == nil && p > 0 {
		port = p
	}
	hosts := ipcproto.LANHosts()
	if h := os.Getenv("DOLQ_PUBLIC_HOST"); h != "" {
		hosts = []string{h}
	}
	if len(hosts) == 0 {
		hosts = []string{"HOST"}
	}
	log.Print("pair a client by pasting one of these into Preferences > Remote Backend (keep it private, it contains the access token):")
	for _, h := range hosts {
		log.Printf("  %s", ipcproto.PairingLink(h, port, token, fingerprint, tls))
	}
}
