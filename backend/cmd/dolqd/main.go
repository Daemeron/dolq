// Command dolqd is the standalone Dolq IRC backend: an IRC client, a
// bouncer/session manager, and a local IPC socket a frontend talks to.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/Daemeron/dolq/backend/internal/bouncer"
	"github.com/Daemeron/dolq/backend/internal/history"
	"github.com/Daemeron/dolq/backend/internal/ipcproto"
)

func main() {
	socketPath := flag.String("socket", "", "Unix domain socket path to listen on (default: a path under the OS temp dir)")
	dbPath := flag.String("db", "", "SQLite database path for message history (default: a path under the OS config dir)")
	retentionDays := flag.Int("retention-days", 0, "prune history older than this many days (0 = keep forever)")
	flag.Parse()

	path := *socketPath
	if path == "" {
		path = filepath.Join(os.TempDir(), fmt.Sprintf("dolq-%d.sock", os.Getpid()))
	}

	ln, err := ipcproto.Listen(path)
	if err != nil {
		log.Fatalf("listen on %s: %v", path, err)
	}
	// One bare line to stdout: the discovery contract a future parent
	// process (e.g. Electron, spawning this as a local child) reads to find
	// the socket it should connect to.
	fmt.Println(path)

	store, err := history.Open(resolveDBPath(*dbPath), *retentionDays)
	if err != nil {
		log.Fatalf("open history db: %v", err)
	}
	defer store.Close()

	b := bouncer.New(store)
	srv := ipcproto.NewServer(b)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.Serve(ln) }()

	select {
	case <-ctx.Done():
		log.Println("shutting down...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		b.Shutdown(shutdownCtx)
		cancel()
		ln.Close()
		os.Remove(path)
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
