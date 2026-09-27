package history

import (
	"database/sql"
	"encoding/json"
	"log"
	"strings"
	"time"

	_ "modernc.org/sqlite"
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

func Open(path string, retentionDays int) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`PRAGMA auto_vacuum = INCREMENTAL`); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
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

const maxBatch = 100

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

func (s *Store) AppendLine(serverID, channel, line string, ts time.Time) {
	s.append(Entry{ServerID: serverID, Channel: channel, Timestamp: ts, IsRaw: true, Line: line})
}

func (s *Store) AppendEvent(serverID, channel string, event any, ts time.Time) {
	payload, err := json.Marshal(event)
	if err != nil {
		log.Printf("history: marshal event: %v", err)
		return
	}
	s.append(Entry{ServerID: serverID, Channel: channel, Timestamp: ts, Event: payload})
}

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

	for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
		entries[i], entries[j] = entries[j], entries[i]
	}
	return entries, nil
}

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

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

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
