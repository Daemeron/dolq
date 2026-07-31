// Package history persists everything that flows through a bouncer session
// - every raw line and every parsed event, verbatim - to SQLite, and serves
// it back as scrollback. What to actually render from that is a UI
// decision, made later, elsewhere; storage doesn't pre-filter. One *Store
// per process, one writer goroutine batching queued writes into a
// transaction - SQLite doesn't want concurrent writers, and that's also
// exactly what the roadmap asked for ("one writer... async batched writes
// so a busy channel doesn't block the IRC socket read loop"). An optional
// retention window prunes old entries (and reclaims their space) on a
// periodic sweep.
package history

import (
	"database/sql"
	"encoding/json"
	"log"
	"strings"
	"time"

	_ "modernc.org/sqlite" // registers the "sqlite" driver, pure Go (no cgo)
)

const schema = `
CREATE TABLE IF NOT EXISTS messages (
	id        INTEGER PRIMARY KEY AUTOINCREMENT,
	server_id TEXT NOT NULL,
	channel   TEXT NOT NULL,
	payload   TEXT NOT NULL, -- raw line text, or a JSON-encoded IrcEvent
	ts        INTEGER NOT NULL,
	is_raw    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_scope ON messages(server_id, channel, id);
`

// Entry is one persisted line - either a raw line from a server's log feed
// (IsRaw, Line set) or a structured IRC event (Event set, JSON-encoded the
// same way it's sent to live subscribers - see bouncer.Subscriber.SendEvent).
// ServerID/Channel *are* serialized, unlike everything else here that's
// scoped to one request - Search (unlike Recent) can span every channel,
// even every server, so a result needs to say where it came from.
type Entry struct {
	ID        int64           `json:"id"`
	ServerID  string          `json:"serverId"`
	Channel   string          `json:"channel"`
	Timestamp time.Time       `json:"timestamp"`
	IsRaw     bool            `json:"isRaw,omitempty"`
	Line      string          `json:"line,omitempty"`
	Event     json.RawMessage `json:"event,omitempty"`
}

type Store struct {
	db            *sql.DB
	entries       chan Entry
	done          chan struct{}
	retentionDays int
	stopPrune     chan struct{}
	pruneDone     chan struct{}
}

// Open creates path's schema if needed and starts the writer goroutine.
// retentionDays prunes entries older than that many days on a periodic
// sweep (plus once at startup); 0 disables pruning entirely - keep
// everything forever, the default, and today's only behavior since nothing
// yet offers a way to set this above the flag dolqd starts with. Pass
// ":memory:" for tests.
func Open(path string, retentionDays int) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	// Every access - the writer goroutine's Exec calls and any concurrent
	// Recent() query - funnels through this one connection, so it's always
	// serialized and SQLite never sees a concurrent writer. Chat traffic
	// never comes close to saturating that.
	db.SetMaxOpenConns(1)
	// Lets `PRAGMA incremental_vacuum` (run after a prune sweep actually
	// deletes rows) reclaim freed pages without the full-file rewrite/lock a
	// plain VACUUM needs. Only takes effect from a fresh/empty database, so
	// this has to run before schema creates any tables.
	if _, err := db.Exec(`PRAGMA auto_vacuum = INCREMENTAL`); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	// bufferSize: every raw line queues up to two entries (the line itself,
	// plus its parsed event) into this one channel, so a burst of N lines
	// is really ~2N sends. Sized generously against that - see append's
	// docs for what happens if it's ever actually exceeded.
	const bufferSize = 4096
	s := &Store{db: db, entries: make(chan Entry, bufferSize), done: make(chan struct{}), retentionDays: retentionDays}
	go s.run()
	if retentionDays > 0 {
		s.stopPrune = make(chan struct{})
		s.pruneDone = make(chan struct{})
		go s.pruneLoop()
	}
	return s, nil
}

// maxBatch caps how many queued entries run drains into one transaction -
// just a ceiling against a pathological burst holding one transaction open
// too long, not a target: most batches will be far smaller.
const maxBatch = 100

// run is the sole writer goroutine. It blocks for the first entry, then
// opportunistically drains anything already queued (up to maxBatch) into
// the same transaction before committing - one fsync for a whole burst
// instead of one per line, without adding latency when traffic is quiet
// (a lone entry just commits by itself, same as before).
func (s *Store) run() {
	defer close(s.done)
	for {
		e, ok := <-s.entries
		if !ok {
			return
		}
		batch := []Entry{e}
	drain:
		for len(batch) < maxBatch {
			select {
			case e, ok := <-s.entries:
				if !ok {
					break drain
				}
				batch = append(batch, e)
			default:
				break drain
			}
		}
		s.writeBatch(batch)
	}
}

func (s *Store) writeBatch(batch []Entry) {
	tx, err := s.db.Begin()
	if err != nil {
		log.Printf("history: begin tx: %v", err)
		return
	}
	stmt, err := tx.Prepare(`INSERT INTO messages (server_id, channel, payload, ts, is_raw) VALUES (?, ?, ?, ?, ?)`)
	if err != nil {
		log.Printf("history: prepare insert: %v", err)
		tx.Rollback()
		return
	}
	defer stmt.Close()

	for _, e := range batch {
		payload := e.Line
		if !e.IsRaw {
			payload = string(e.Event)
		}
		if _, err := stmt.Exec(e.ServerID, e.Channel, payload, e.Timestamp.UnixMilli(), e.IsRaw); err != nil {
			log.Printf("history: write error: %v", err)
		}
	}
	if err := tx.Commit(); err != nil {
		log.Printf("history: commit tx: %v", err)
	}
}

// AppendLine queues a raw line for persistence under channel (typically a
// server-wide log bucket, not a real IRC channel). See append's docs on the
// async/non-blocking contract.
func (s *Store) AppendLine(serverID, channel, line string, ts time.Time) {
	s.append(Entry{ServerID: serverID, Channel: channel, Timestamp: ts, IsRaw: true, Line: line})
}

// AppendEvent queues a structured IRC event for persistence, JSON-encoded
// the same way it's already sent to live subscribers.
func (s *Store) AppendEvent(serverID, channel string, event any, ts time.Time) {
	payload, err := json.Marshal(event)
	if err != nil {
		log.Printf("history: marshal event: %v", err)
		return
	}
	s.append(Entry{ServerID: serverID, Channel: channel, Timestamp: ts, Event: payload})
}

// buffered channel, non-blocking send. At bufferSize in-flight
// unwritten entries the write side has effectively stalled - a sustained
// flood way past even a large paste or NAMES dump - so this drops and logs
// rather than blocking the read loop the backend dispatches Append* from.
func (s *Store) append(e Entry) {
	if s == nil {
		return
	}
	select {
	case s.entries <- e:
	default:
		log.Printf("history: buffer full, dropping entry for %s/%s", e.ServerID, e.Channel)
	}
}

// pruneInterval is how often a running Store re-checks retention beyond the
// sweep it always does once at startup.
const pruneInterval = time.Hour

func (s *Store) pruneLoop() {
	defer close(s.pruneDone)
	s.prune()
	ticker := time.NewTicker(pruneInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			s.prune()
		case <-s.stopPrune:
			return
		}
	}
}

// prune deletes entries older than retentionDays and, if that actually freed
// anything, reclaims the space. Only ever called with retentionDays > 0 (via
// pruneLoop, gated the same way in Open/Close) - retentionDays <= 0 would
// otherwise make the cutoff "now" and delete everything, so this guards it
// too rather than relying solely on that call discipline.
func (s *Store) prune() {
	if s.retentionDays <= 0 {
		return
	}
	cutoff := time.Now().AddDate(0, 0, -s.retentionDays).UnixMilli()
	res, err := s.db.Exec(`DELETE FROM messages WHERE ts < ?`, cutoff)
	if err != nil {
		log.Printf("history: prune error: %v", err)
		return
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("history: pruned %d entries older than %d day(s)", n, s.retentionDays)
		if _, err := s.db.Exec(`PRAGMA incremental_vacuum`); err != nil {
			log.Printf("history: incremental_vacuum: %v", err)
		}
	}
}

// Recent returns up to limit entries for serverID/channel, oldest first. If
// before > 0, only entries with id < before are considered (paging
// backwards through scrollback). limit <= 0 defaults to 200.
func (s *Store) Recent(serverID, channel string, before int64, limit int) ([]Entry, error) {
	if s == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = 200
	}
	rows, err := s.db.Query(
		`SELECT id, payload, ts, is_raw FROM messages
		 WHERE server_id = ? AND channel = ? AND (? <= 0 OR id < ?)
		 ORDER BY id DESC LIMIT ?`,
		serverID, channel, before, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []Entry
	for rows.Next() {
		e := Entry{ServerID: serverID, Channel: channel}
		var ts int64
		var payload string
		if err := rows.Scan(&e.ID, &payload, &ts, &e.IsRaw); err != nil {
			return nil, err
		}
		e.Timestamp = time.UnixMilli(ts)
		if e.IsRaw {
			e.Line = payload
		} else {
			e.Event = json.RawMessage(payload)
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Query is newest-first (so LIMIT keeps the *most recent* N); callers
	// want chronological order.
	for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
		entries[i], entries[j] = entries[j], entries[i]
	}
	return entries, nil
}

// Search returns up to limit entries whose stored payload contains query
// (case-insensitive substring match - SQLite's LIKE already is, for ASCII),
// newest first. serverID/channel scope the search when non-empty; either or
// both empty widens it (empty channel: every channel on serverID; empty
// serverID: every server, "global").
//
// This is a literal substring match against the raw stored payload - JSON
// for a parsed event, plain text for a raw line - not anything JSON-aware.
// Works well for actual words/phrases, which is what "search" means in
// practice; a query that happens to collide with JSON structure itself
// (e.g. "type") can turn up noise. SQLite FTS5 (a virtual table kept in
// sync with this one via triggers) would be the natural upgrade if that
// ever matters enough to justify the added schema complexity - not
// something "search across history" needs to start with.
func (s *Store) Search(serverID, channel, query string, limit int) ([]Entry, error) {
	if s == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = 200
	}
	rows, err := s.db.Query(
		`SELECT id, server_id, channel, payload, ts, is_raw FROM messages
		 WHERE (? = '' OR server_id = ?) AND (? = '' OR channel = ?)
		   AND payload LIKE '%' || ? || '%' ESCAPE '\'
		 ORDER BY id DESC LIMIT ?`,
		serverID, serverID, channel, channel, escapeLike(query), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []Entry
	for rows.Next() {
		var e Entry
		var ts int64
		var payload string
		if err := rows.Scan(&e.ID, &e.ServerID, &e.Channel, &payload, &ts, &e.IsRaw); err != nil {
			return nil, err
		}
		e.Timestamp = time.UnixMilli(ts)
		if e.IsRaw {
			e.Line = payload
		} else {
			e.Event = json.RawMessage(payload)
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return entries, nil
}

// escapeLike backslash-escapes a user-typed search term's own LIKE
// wildcards (%, _) so e.g. searching for a literal "50%" doesn't turn into
// a wildcard match - paired with the query's own ESCAPE '\' clause.
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

// Close stops the prune loop (if running) and the writer goroutine
// (draining anything already queued), then closes the database. A nil
// *Store is a no-op.
func (s *Store) Close() error {
	if s == nil {
		return nil
	}
	if s.retentionDays > 0 {
		close(s.stopPrune)
		<-s.pruneDone
	}
	close(s.entries)
	<-s.done
	return s.db.Close()
}
