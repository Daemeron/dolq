// Package history persists everything that flows through a bouncer session
// - every raw line and every parsed event, verbatim - to SQLite, and serves
// it back as scrollback. What to actually render from that is a UI
// decision, made later, elsewhere; storage doesn't pre-filter. One *Store
// per process, one writer goroutine - SQLite doesn't want concurrent
// writers, and that's also exactly what the roadmap asked for ("one
// writer... message/event tables keyed by server+channel").
package history

import (
	"database/sql"
	"encoding/json"
	"log"
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
// ServerID/Channel aren't serialized: a retrieval response is already
// scoped to the request's serverId/channel, so echoing them back on every
// row would be redundant.
type Entry struct {
	ID        int64           `json:"id"`
	ServerID  string          `json:"-"`
	Channel   string          `json:"-"`
	Timestamp time.Time       `json:"timestamp"`
	IsRaw     bool            `json:"isRaw,omitempty"`
	Line      string          `json:"line,omitempty"`
	Event     json.RawMessage `json:"event,omitempty"`
}

type Store struct {
	db      *sql.DB
	entries chan Entry
	done    chan struct{}
}

// Open creates path's schema if needed and starts the writer goroutine.
// Pass ":memory:" for tests.
func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	// Every access - the writer goroutine's Exec calls and any concurrent
	// Recent() query - funnels through this one connection, so it's always
	// serialized and SQLite never sees a concurrent writer. Chat traffic
	// never comes close to saturating that.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	s := &Store{db: db, entries: make(chan Entry, 256), done: make(chan struct{})}
	go s.run()
	return s, nil
}

func (s *Store) run() {
	defer close(s.done)
	for e := range s.entries {
		payload := e.Line
		if !e.IsRaw {
			payload = string(e.Event)
		}
		_, err := s.db.Exec(`INSERT INTO messages (server_id, channel, payload, ts, is_raw) VALUES (?, ?, ?, ?, ?)`,
			e.ServerID, e.Channel, payload, e.Timestamp.UnixMilli(), e.IsRaw)
		if err != nil {
			log.Printf("history: write error: %v", err)
		}
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

// ponytail: buffered channel, non-blocking send. At 256 in-flight unwritten
// entries the write side has effectively stalled - way past normal chat
// rates - so this drops and logs rather than blocking the read loop the
// backend dispatches Append* from.
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
		var e Entry
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

// Close stops the writer goroutine (draining anything already queued) and
// closes the database. A nil *Store is a no-op.
func (s *Store) Close() error {
	if s == nil {
		return nil
	}
	close(s.entries)
	<-s.done
	return s.db.Close()
}
