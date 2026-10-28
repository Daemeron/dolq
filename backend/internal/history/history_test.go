package history

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

type testEvent struct {
	Type string `json:"type"`
	Nick string `json:"nick"`
}

func TestAppendEventAndRecent(t *testing.T) {
	s, err := Open(":memory:", 0)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	base := time.Now()
	for i := 0; i < 3; i++ {
		s.AppendEvent("srv", "#chan", testEvent{Type: "JOIN", Nick: "user"}, base.Add(time.Duration(i)*time.Second))
	}
	s.AppendLine("srv", "__log__", "raw line", base)
	s.AppendEvent("other", "#chan", testEvent{Type: "JOIN", Nick: "b"}, base)

	entries := waitForCount(t, s, "srv", "#chan", 3)

	if entries[0].ID >= entries[1].ID || entries[1].ID >= entries[2].ID {
		t.Fatalf("entries not in chronological (ascending id) order: %+v", entries)
	}
	if entries[0].IsRaw || entries[0].Line != "" {
		t.Fatalf("expected an event entry, got %+v", entries[0])
	}
	var decoded testEvent
	if err := json.Unmarshal(entries[0].Event, &decoded); err != nil {
		t.Fatalf("event not valid JSON: %v", err)
	}
	if decoded.Type != "JOIN" || decoded.Nick != "user" {
		t.Fatalf("event round-tripped wrong: %+v", decoded)
	}

	page, err := s.Recent("srv", "#chan", entries[2].ID, 1)
	if err != nil {
		t.Fatalf("recent (paged): %v", err)
	}
	if len(page) != 1 || page[0].ID != entries[1].ID {
		t.Fatalf("got %+v, want just entry %d", page, entries[1].ID)
	}
}

func TestAppendLineIsRaw(t *testing.T) {
	s, err := Open(":memory:", 0)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	s.AppendLine("srv", "__log__", ":server NOTICE * :hi", time.Now())
	entries := waitForCount(t, s, "srv", "__log__", 1)

	if !entries[0].IsRaw || entries[0].Line != ":server NOTICE * :hi" || entries[0].Event != nil {
		t.Fatalf("expected a raw line entry, got %+v", entries[0])
	}
}

func TestBurstSpansMultipleBatches(t *testing.T) {
	s, err := Open(":memory:", 0)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	const n = maxBatch*2 + 37
	for i := 0; i < n; i++ {
		s.AppendLine("srv", "__log__", fmt.Sprintf("line %d", i), time.Now())
	}

	entries := waitForCount(t, s, "srv", "__log__", n)
	for i, e := range entries {
		want := fmt.Sprintf("line %d", i)
		if e.Line != want {
			t.Fatalf("entry %d: got %q, want %q (order/loss bug across a batch boundary)", i, e.Line, want)
		}
	}
}

func TestRetentionPrunesOldEntries(t *testing.T) {
	s, err := Open(":memory:", 1)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	old := time.Now().AddDate(0, 0, -2)
	s.AppendLine("srv", "__log__", "old line", old)
	s.AppendLine("srv", "__log__", "recent line", time.Now())

	deadline := time.Now().Add(time.Second)
	var entries []Entry
	for time.Now().Before(deadline) {
		s.prune()
		var err error
		entries, err = s.Recent("srv", "__log__", 0, 10)
		if err != nil {
			t.Fatalf("recent: %v", err)
		}
		// Writes are batched asynchronously: wait for the recent line to land
		// and the old one to be pruned, not just for a single row.
		if len(entries) == 1 && entries[0].Line == "recent line" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if len(entries) != 1 || entries[0].Line != "recent line" {
		t.Fatalf("prune kept the wrong entries: %+v", entries)
	}
}

func TestNilStoreIsNoop(t *testing.T) {
	var s *Store
	s.AppendLine("srv", "#chan", "hi", time.Now())
	s.AppendEvent("srv", "#chan", testEvent{Type: "JOIN"}, time.Now())
	entries, err := s.Recent("srv", "#chan", 0, 10)
	if err != nil || entries != nil {
		t.Fatalf("nil store should no-op, got entries=%v err=%v", entries, err)
	}
	found, err := s.Search("srv", "#chan", "hi", 10)
	if err != nil || found != nil {
		t.Fatalf("nil store Search should no-op, got entries=%v err=%v", found, err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("nil store Close should no-op, got %v", err)
	}
}

func TestSearch(t *testing.T) {
	s, err := Open(":memory:", 0)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	base := time.Now()
	s.AppendLine("srv", "#general", "hello world", base)
	s.AppendLine("srv", "#offtopic", "goodbye world", base.Add(time.Second))
	s.AppendLine("other-srv", "#general", "hello from elsewhere", base.Add(2*time.Second))
	waitForCount(t, s, "srv", "#general", 1)
	waitForCount(t, s, "srv", "#offtopic", 1)
	waitForCount(t, s, "other-srv", "#general", 1)

	t.Run("scoped to one server and channel", func(t *testing.T) {
		got, err := s.Search("srv", "#general", "hello", 10)
		if err != nil {
			t.Fatalf("search: %v", err)
		}
		if len(got) != 1 || got[0].Line != "hello world" {
			t.Fatalf("got %+v, want just the #general match", got)
		}
	})

	t.Run("empty channel searches every channel on that server", func(t *testing.T) {
		got, err := s.Search("srv", "", "world", 10)
		if err != nil {
			t.Fatalf("search: %v", err)
		}
		if len(got) != 2 {
			t.Fatalf("got %d results, want 2 (both srv channels)", len(got))
		}
	})

	t.Run("empty server searches globally", func(t *testing.T) {
		got, err := s.Search("", "", "hello", 10)
		if err != nil {
			t.Fatalf("search: %v", err)
		}
		if len(got) != 2 {
			t.Fatalf("got %d results, want 2 (both servers)", len(got))
		}
	})

	t.Run("results carry their own serverId/channel for a global search", func(t *testing.T) {
		got, err := s.Search("", "", "hello", 10)
		if err != nil {
			t.Fatalf("search: %v", err)
		}
		byServer := map[string]string{}
		for _, e := range got {
			byServer[e.ServerID] = e.Channel
		}
		if byServer["srv"] != "#general" || byServer["other-srv"] != "#general" {
			t.Fatalf("results missing their scope: %+v", got)
		}
	})

	t.Run("case-insensitive", func(t *testing.T) {
		got, err := s.Search("srv", "#general", "HELLO", 10)
		if err != nil {
			t.Fatalf("search: %v", err)
		}
		if len(got) != 1 {
			t.Fatalf("got %d results, want 1", len(got))
		}
	})

	t.Run("no match returns no results, not an error", func(t *testing.T) {
		got, err := s.Search("srv", "#general", "nonexistent", 10)
		if err != nil {
			t.Fatalf("search: %v", err)
		}
		if len(got) != 0 {
			t.Fatalf("got %+v, want no results", got)
		}
	})

	t.Run("a literal LIKE wildcard in the query is escaped, not treated as a wildcard", func(t *testing.T) {
		s.AppendLine("srv", "#general", "50% off today", base.Add(3*time.Second))
		waitForCount(t, s, "srv", "#general", 2)

		got, err := s.Search("srv", "#general", "50%", 10)
		if err != nil {
			t.Fatalf("search: %v", err)
		}
		if len(got) != 1 || got[0].Line != "50% off today" {
			t.Fatalf("got %+v, want just the literal \"50%%\" match", got)
		}
	})
}

type textEvent struct {
	Type   string `json:"type"`
	Nick   string `json:"nick"`
	Target string `json:"target"`
	Text   string `json:"text"`
}

func TestSearchMatchesMessageText(t *testing.T) {
	s, err := Open(":memory:", 0)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	base := time.Now()
	s.AppendEvent("srv", "#c", textEvent{Type: "PRIVMSG", Nick: "tom", Target: "#c", Text: "Tom & Jerry <3"}, base)
	s.AppendEvent("srv", "#c", testEvent{Type: "JOIN", Nick: "jerry"}, base)
	// A row written before events were stored unescaped.
	if _, err := s.db.Exec(`INSERT INTO messages (server_id, channel, payload, ts) VALUES ('srv', '#c', ?, 0)`,
		`{"type":"PRIVMSG","nick":"old","target":"#c","text":"fish \u0026 chips"}`); err != nil {
		t.Fatalf("insert: %v", err)
	}
	waitForCount(t, s, "srv", "#c", 3)

	for query, want := range map[string]int{
		"Tom & Jerry":  1,
		"<3":           1,
		"fish & chips": 1,
		"nick":         0, // a JSON key, not anything anyone said
		"type":         0,
		"jerry":        1, // the message, not the JOIN of the user called jerry
	} {
		got, err := s.Search("srv", "#c", query, 10)
		if err != nil {
			t.Fatalf("search %q: %v", query, err)
		}
		if len(got) != want {
			t.Errorf("search %q: got %d results %+v, want %d", query, len(got), got, want)
		}
	}
}

type topicEvent struct {
	Type    string `json:"type"`
	Channel string `json:"channel"`
	Topic   string `json:"topic"`
	Nick    string `json:"nick,omitempty"`
}

type reasonEvent struct {
	Type    string `json:"type"`
	Nick    string `json:"nick"`
	Channel string `json:"channel,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

func TestSearchMatchesTopicsAndReasons(t *testing.T) {
	s, err := Open(":memory:", 0)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	base := time.Now()
	s.AppendEvent("srv", "#c", topicEvent{Type: "TOPIC", Channel: "#c", Topic: "Release day & cake", Nick: "op"}, base)
	s.AppendEvent("srv", "#c", reasonEvent{Type: "QUIT", Nick: "tom", Reason: "Ping timeout"}, base)
	s.AppendEvent("srv", "#c", reasonEvent{Type: "PART", Nick: "ann", Channel: "#c", Reason: "off to bed"}, base)
	s.AppendEvent("srv", "#c", reasonEvent{Type: "PART", Nick: "bob", Channel: "#c"}, base)
	waitForCount(t, s, "srv", "#c", 4)

	for query, want := range map[string]int{
		"release day & cake": 1,
		"ping timeout":       1,
		"off to bed":         1,
		"bob":                0, // a nick, not a reason
		"channel":            0,
	} {
		got, err := s.Search("srv", "#c", query, 10)
		if err != nil {
			t.Fatalf("search %q: %v", query, err)
		}
		if len(got) != want {
			t.Errorf("search %q: got %d results %+v, want %d", query, len(got), got, want)
		}
	}
}

func TestSearchReturnsEachMessageOnce(t *testing.T) {
	s, err := Open(":memory:", 0)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	base := time.Now()
	// A channel message as older versions stored it: the raw line in the log, the event in the channel.
	s.AppendLine("srv", LogChannel, ":tom!u@h PRIVMSG #c :hello there", base)
	s.AppendEvent("srv", "#c", textEvent{Type: "PRIVMSG", Nick: "tom", Target: "#c", Text: "hello there"}, base)
	// A notice to us: raw line and event, both in the log.
	s.AppendLine("srv", LogChannel, ":NickServ!s@h NOTICE me :hello, please identify", base)
	s.AppendEvent("srv", LogChannel, textEvent{Type: "NOTICE", Nick: "NickServ", Target: "me", Text: "hello, please identify"}, base)
	waitForCount(t, s, "srv", LogChannel, 3)

	got, err := s.Search("", "", "hello", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d results %+v, want 2", len(got), got)
	}
	var channelEvent, logLine bool
	for _, e := range got {
		channelEvent = channelEvent || (e.Channel == "#c" && !e.IsRaw)
		logLine = logLine || (e.Channel == LogChannel && e.IsRaw && e.Line == ":NickServ!s@h NOTICE me :hello, please identify")
	}
	if !channelEvent || !logLine {
		t.Fatalf("got %+v, want the #c event and the raw notice", got)
	}
}

func TestAppendEventKeepsHTMLCharacters(t *testing.T) {
	s, err := Open(":memory:", 0)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	s.AppendEvent("srv", "#c", textEvent{Type: "PRIVMSG", Text: "a<b & c>d"}, time.Now())
	entries := waitForCount(t, s, "srv", "#c", 1)
	if want := `{"type":"PRIVMSG","nick":"","target":"","text":"a<b & c>d"}`; string(entries[0].Event) != want {
		t.Fatalf("stored %s, want %s", entries[0].Event, want)
	}
}

func waitForCount(t *testing.T, s *Store, serverID, channel string, want int) []Entry {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	var entries []Entry
	for time.Now().Before(deadline) {
		var err error
		entries, err = s.Recent(serverID, channel, 0, want+10)
		if err != nil {
			t.Fatalf("recent: %v", err)
		}
		if len(entries) == want {
			return entries
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("got %d entries for %s/%s, want %d", len(entries), serverID, channel, want)
	return nil
}

func TestOpenMakesDBOwnerOnly(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix permissions")
	}
	dir := t.TempDir()
	fresh := filepath.Join(dir, "fresh.db")
	existing := filepath.Join(dir, "old.db")
	if err := os.WriteFile(existing, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(existing+"-wal", nil, 0o644); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{fresh, existing} {
		s, err := Open(p, 0)
		if err != nil {
			t.Fatalf("Open(%s): %v", p, err)
		}
		s.Close()
	}
	for _, p := range []string{fresh, existing, existing + "-wal"} {
		info, err := os.Stat(p)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Errorf("%s: mode %o, want 0600", p, info.Mode().Perm())
		}
	}
}

func TestAppendAfterCloseIsDropped(t *testing.T) {
	s, err := Open(":memory:", 0)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	// A late IRC read loop must not panic with "send on closed channel".
	s.AppendLine("srv", "#chan", "late", time.Now())
	s.AppendEvent("srv", "#chan", testEvent{Type: "JOIN", Nick: "a"}, time.Now())
}

func TestDatabaseFailuresAreLoggedNotFatal(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "h.db"), 1)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	log.SetOutput(&buf)
	defer log.SetOutput(os.Stderr)

	s.db.Close() // the database goes away under a running store
	s.writeBatch([]Entry{{ServerID: "s", Channel: "#c", Timestamp: time.Now(), IsRaw: true, Line: "x"}})
	s.prune()

	out := buf.String()
	if !strings.Contains(out, "history: begin tx") {
		t.Errorf("write failure not logged: %q", out)
	}
	if !strings.Contains(out, "history: prune error") {
		t.Errorf("prune failure not logged: %q", out)
	}
	s.Close()
}

func TestOpenFailsForAPathItCannotCreate(t *testing.T) {
	if _, err := Open(filepath.Join(t.TempDir(), "missing", "dir", "h.db"), 0); err == nil {
		t.Error("Open succeeded in a directory that does not exist")
	}
}

func TestAnEventThatCannotBeEncodedIsDroppedNotStored(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "h.db"), 0)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var buf bytes.Buffer
	log.SetOutput(&buf)
	defer log.SetOutput(os.Stderr)

	s.AppendEvent("s", "#c", map[string]any{"bad": make(chan int)}, time.Now())
	s.AppendEvent("s", "#c", testEvent{Type: "PRIVMSG", Nick: "ok"}, time.Now())

	entries := waitForCount(t, s, "s", "#c", 1)
	if len(entries) != 1 {
		t.Fatalf("stored %d entries, want only the encodable one", len(entries))
	}
	if !strings.Contains(buf.String(), "history: marshal event") {
		t.Errorf("encode failure not logged: %q", buf.String())
	}
}

func TestReadsFailCleanlyOnceTheDatabaseIsGone(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "h.db"), 0)
	if err != nil {
		t.Fatal(err)
	}
	s.db.Close()
	if _, err := s.Recent("s", "#c", 0, 10); err == nil {
		t.Error("Recent succeeded on a closed database")
	}
	if _, err := s.Search("s", "#c", "x", 10); err == nil {
		t.Error("Search succeeded on a closed database")
	}
	s.Close()
}

func TestAWriteToAMissingTableIsLoggedNotFatal(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "h.db"), 0)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var buf bytes.Buffer
	log.SetOutput(&buf)
	defer log.SetOutput(os.Stderr)
	if _, err := s.db.Exec(`DROP TABLE messages`); err != nil {
		t.Fatal(err)
	}
	s.writeBatch([]Entry{{ServerID: "s", Channel: "#c", Timestamp: time.Now(), IsRaw: true, Line: "x"}})
	if !strings.Contains(buf.String(), "history: prepare insert") {
		t.Errorf("failure not logged: %q", buf.String())
	}
}

func TestEntriesAreDroppedRatherThanBlockingWhenTheBufferIsFull(t *testing.T) {
	// No writer is draining this store, so its one-slot buffer fills at once.
	s := &Store{entries: make(chan Entry, 1)}
	var buf bytes.Buffer
	log.SetOutput(&buf)
	defer log.SetOutput(os.Stderr)
	s.AppendLine("s", "#c", "first", time.Now())
	s.AppendLine("s", "#c", "second", time.Now())
	if len(s.entries) != 1 {
		t.Errorf("buffered %d entries, want 1", len(s.entries))
	}
	if !strings.Contains(buf.String(), "buffer full, dropping entry for s/#c") {
		t.Errorf("drop not logged: %q", buf.String())
	}
}

func TestOldEntriesArePrunedOnASchedule(t *testing.T) {
	old := pruneInterval
	pruneInterval = 20 * time.Millisecond
	defer func() { pruneInterval = old }()

	s, err := Open(filepath.Join(t.TempDir(), "h.db"), 1)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	// Written straight to the table, after the prune at startup has run, so only a later tick can remove it.
	time.Sleep(50 * time.Millisecond)
	stale := time.Now().AddDate(0, 0, -30).UnixMilli()
	if _, err := s.db.Exec(`INSERT INTO messages (server_id, channel, payload, ts, is_raw) VALUES ('s', '#c', 'old', ?, 1)`, stale); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var n int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM messages`).Scan(&n); err == nil && n == 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("the stale entry was never pruned")
}
