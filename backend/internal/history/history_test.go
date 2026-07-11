package history

import (
	"encoding/json"
	"testing"
	"time"
)

type testEvent struct {
	Type string `json:"type"`
	Nick string `json:"nick"`
}

func TestAppendEventAndRecent(t *testing.T) {
	s, err := Open(":memory:")
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
	s, err := Open(":memory:")
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

func TestNilStoreIsNoop(t *testing.T) {
	var s *Store
	s.AppendLine("srv", "#chan", "hi", time.Now())
	s.AppendEvent("srv", "#chan", testEvent{Type: "JOIN"}, time.Now())
	entries, err := s.Recent("srv", "#chan", 0, 10)
	if err != nil || entries != nil {
		t.Fatalf("nil store should no-op, got entries=%v err=%v", entries, err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("nil store Close should no-op, got %v", err)
	}
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
		entries, err = s.Recent(serverID, channel, 0, 10)
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
