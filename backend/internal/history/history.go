package history

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"
	"sync"
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
CREATE TABLE IF NOT EXISTS transfers (
	id        TEXT PRIMARY KEY,
	server_id TEXT NOT NULL,
	nick      TEXT NOT NULL,
	filename  TEXT NOT NULL,
	received  INTEGER NOT NULL,
	total     INTEGER NOT NULL,
	path      TEXT NOT NULL,
	done      INTEGER NOT NULL,
	error     TEXT NOT NULL,
	sending   INTEGER NOT NULL,
	ts        INTEGER NOT NULL
);
`

// LogChannel holds a server's raw lines (and the events that belong to no channel).
const LogChannel = "__log__"

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

	// unsaved and lastFailureLogged are the writer goroutine's, for saying that writes fail without saying it every time.
	unsaved           int
	lastFailureLogged time.Time

	// sendMu keeps append from sending on entries once Close has closed it.
	sendMu sync.RWMutex
	closed bool
}

func Open(path string, retentionDays int) (*Store, error) {
	if err := restrictDBFiles(path); err != nil {
		return nil, err
	}
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
	if err := dropProtocolNoise(db); err != nil {
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

// protocolNoise matches the keep-alive lines that used to be logged: the server's PING, and its answer to a latency
// PING of ours ([@tags ][:prefix ]PING ... or ...PONG server :dolq-<digits>).
var protocolNoise = regexp.MustCompile(`^(@\S+ )?(:\S+ )?(PING( .*)?|PONG \S+ :dolq-\d+)$`)

// cleanupVersion counts the one-time history cleanups; PRAGMA user_version records the last one done.
const cleanupVersion = 2

// dropProtocolNoise removes those lines from histories written before they were kept out of the log. It runs once per
// database and cleanup version, so a large history is not scanned at every start.
func dropProtocolNoise(db *sql.DB) error {
	var version int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return err
	}
	if version >= cleanupVersion {
		return nil
	}
	rows, err := db.Query(`SELECT id, payload FROM messages WHERE is_raw = 1 AND (payload LIKE '%PING%' OR payload LIKE '%PONG%')`)
	if err != nil {
		return err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		var payload string
		if err := rows.Scan(&id, &payload); err != nil {
			rows.Close()
			return err
		}
		if protocolNoise.MatchString(payload) {
			ids = append(ids, id)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	for _, id := range ids {
		if _, err := tx.Exec(`DELETE FROM messages WHERE id = ?`, id); err != nil {
			tx.Rollback()
			return err
		}
	}
	if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, cleanupVersion)); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// restrictDBFiles makes the database owner-only before SQLite opens it:
// SQLite would create it 0644, and gives its journal files the database's
// mode. Existing files, from older versions, are tightened too.
func restrictDBFiles(path string) error {
	if path == ":memory:" || strings.HasPrefix(path, "file:") {
		return nil
	}
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return err
	}
	f.Close()
	for _, p := range []string{path, path + "-journal", path + "-wal", path + "-shm"} {
		if err := os.Chmod(p, 0o600); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
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

	for i, e := range batch {
		payload := e.Line
		if !e.IsRaw {
			payload = string(e.Event)
		}
		if _, err := stmt.Exec(e.ServerID, e.Channel, payload, e.Timestamp.UnixMilli(), e.IsRaw); err != nil {
			// A write that fails, as one does on a full disk, has rolled the whole transaction back, so the rest of the
			// batch cannot be saved either, and committing it would only fail again.
			tx.Rollback()
			s.writeFailed(len(batch)-i, err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		s.writeFailed(len(batch), err)
	}
}

// failLogEvery is how seldom a store that cannot write says so: a full disk fails every write, and each failure would
// otherwise be a line in the log, or two.
const failLogEvery = 30 * time.Second

// writeFailed counts entries that could not be saved and, at most every failLogEvery, says how many. It is called
// only from the goroutine that writes, so it needs no lock.
func (s *Store) writeFailed(n int, err error) {
	s.unsaved += n
	if time.Since(s.lastFailureLogged) < failLogEvery {
		return
	}
	log.Printf("history: could not save %d entries: %v (is the disk full?)", s.unsaved, err)
	s.unsaved = 0
	s.lastFailureLogged = time.Now()
}

func (s *Store) AppendLine(serverID, channel, line string, ts time.Time) {
	s.append(Entry{ServerID: serverID, Channel: channel, Timestamp: ts, IsRaw: true, Line: line})
}

func (s *Store) AppendEvent(serverID, channel string, event any, ts time.Time) {
	// Unescaped, so the stored text reads as sent: json.Marshal would turn & < > into \u0026...
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(event); err != nil {
		log.Printf("history: marshal event: %v", err)
		return
	}
	s.append(Entry{ServerID: serverID, Channel: channel, Timestamp: ts, Event: bytes.TrimSuffix(buf.Bytes(), []byte("\n"))})
}

func (s *Store) append(e Entry) {
	if s == nil {
		return
	}
	s.sendMu.RLock()
	defer s.sendMu.RUnlock()
	if s.closed {
		return
	}
	select {
	case s.entries <- e:
	default:
		log.Printf("history: buffer full, dropping entry for %s/%s", e.ServerID, e.Channel)
	}
}

var pruneInterval = time.Hour

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
	// Events match on what they say (json_extract also decodes rows stored
	// with escaped & < >), not on their JSON keys: a message's text, a pack's
	// filename, a topic, or a part/kick/quit reason. A message is stored both as an
	// event and, in the log, as its raw line (older versions kept every PRIVMSG
	// there too); only one of the two may match. In the log that is the raw line,
	// which is what the Log view shows.
	rows, err := s.db.Query(
		`SELECT id, server_id, channel, payload, ts, is_raw FROM messages
		 WHERE (? = '' OR server_id = ?) AND (? = '' OR channel = ?)
		   AND CASE WHEN is_raw
		     THEN payload NOT LIKE '% PRIVMSG %' AND payload LIKE '%' || ? || '%' ESCAPE '\'
		     ELSE channel <> ? AND coalesce(json_extract(payload, '$.text'), json_extract(payload, '$.filename'),
		       json_extract(payload, '$.topic'), json_extract(payload, '$.reason'), '')
		       LIKE '%' || ? || '%' ESCAPE '\'
		   END
		 ORDER BY id DESC LIMIT ?`,
		serverID, serverID, channel, channel, escapeLike(query), LogChannel, escapeLike(query), limit)
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
	s.sendMu.Lock()
	s.closed = true
	close(s.entries)
	s.sendMu.Unlock()
	<-s.done
	return s.db.Close()
}

// Transfer is a download or upload that has ended, kept so the Transfers list survives a restart.
type Transfer struct {
	ID        string    `json:"id"`
	ServerID  string    `json:"serverId"`
	Nick      string    `json:"nick"`
	Filename  string    `json:"filename"`
	Received  int64     `json:"received"`
	Total     int64     `json:"total"`
	Path      string    `json:"path"`
	Done      bool      `json:"done,omitempty"`
	Error     string    `json:"error,omitempty"`
	Sending   bool      `json:"sending,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

func (s *Store) SaveTransfer(t Transfer) {
	if s == nil {
		return
	}
	_, err := s.db.Exec(
		`INSERT OR REPLACE INTO transfers (id, server_id, nick, filename, received, total, path, done, error, sending, ts)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.ID, t.ServerID, t.Nick, t.Filename, t.Received, t.Total, t.Path, t.Done, t.Error, t.Sending, t.Timestamp.UnixMilli())
	if err != nil {
		log.Printf("history: save transfer: %v", err)
	}
}

// Transfers returns the saved transfers, oldest first.
func (s *Store) Transfers() ([]Transfer, error) {
	if s == nil {
		return nil, nil
	}
	rows, err := s.db.Query(
		`SELECT id, server_id, nick, filename, received, total, path, done, error, sending, ts FROM transfers ORDER BY ts, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Transfer
	for rows.Next() {
		var t Transfer
		var ts int64
		if err := rows.Scan(&t.ID, &t.ServerID, &t.Nick, &t.Filename, &t.Received, &t.Total, &t.Path, &t.Done, &t.Error, &t.Sending, &ts); err != nil {
			return nil, err
		}
		t.Timestamp = time.UnixMilli(ts)
		out = append(out, t)
	}
	return out, rows.Err()
}

// DeleteTransfer forgets one saved transfer, or every one when id is empty.
func (s *Store) DeleteTransfer(id string) error {
	if s == nil {
		return nil
	}
	if id == "" {
		_, err := s.db.Exec(`DELETE FROM transfers`)
		return err
	}
	_, err := s.db.Exec(`DELETE FROM transfers WHERE id = ?`, id)
	return err
}
