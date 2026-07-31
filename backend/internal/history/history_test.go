package history

import (
	"encoding/json"
	"fmt"
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
	// Different channel/server - must not show up in the #chan query below.
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

	// Cursor: ask for entries before the last one, limit 1 -> just the middle entry.
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

// TestBurstSpansMultipleBatches sends more entries than maxBatch in one go,
// so run() has to drain, commit, and go back for more at least twice -
// checking the batching loop doesn't drop or misorder anything at that
// boundary.
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
	s, err := Open(":memory:", 1) // 1-day retention
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	old := time.Now().AddDate(0, 0, -2) // past the 1-day cutoff
	s.AppendLine("srv", "__log__", "old line", old)
	s.AppendLine("srv", "__log__", "recent line", time.Now())
	waitForCount(t, s, "srv", "__log__", 2)

	// pruneLoop already ran one sweep at startup (before these entries even
	// existed) and won't run another for an hour, so drive it directly
	// rather than waiting on the real ticker.
	s.prune()

	entries, err := s.Recent("srv", "__log__", 0, 10)
	if err != nil {
		t.Fatalf("recent: %v", err)
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

// waitForCount polls Recent until it sees want entries for serverID/channel
// - Append* is async (that's the point - it must never block the IRC read
// loop it's called from), so writes land on the store's own schedule.
func waitForCount(t *testing.T, s *Store, serverID, channel string, want int) []Entry {
	t.Helper()
	deadline := time.Now().Add(time.Second)
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
