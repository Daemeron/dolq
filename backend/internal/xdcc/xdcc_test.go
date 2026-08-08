package xdcc

import "testing"

func TestParseListLine(t *testing.T) {
	cases := []struct {
		line string
		want Pack
		ok   bool
	}{
		{"#1   72x [340M] Show.S01E01.mkv", Pack{1, 72, "340M", "Show.S01E01.mkv"}, true},
		{"  #12  0x [ 1.4G]   Movie.Name.2020.mkv", Pack{12, 0, "1.4G", "Movie.Name.2020.mkv"}, true},
		{"#3 5x [700.5M] file with spaces.rar", Pack{3, 5, "700.5M", "file with spaces.rar"}, true},
		{"** 12 packs ** 3 of 5 slots open, Record: 250.0KB/s", Pack{}, false},
		{"Total Offered: 3.4GB  Total Transferred: 1.2TB", Pack{}, false},
		{"just chatting, not a pack line", Pack{}, false},
	}
	for _, c := range cases {
		got, ok := ParseListLine(c.line)
		if ok != c.ok {
			t.Errorf("ParseListLine(%q) ok = %v, want %v", c.line, ok, c.ok)
			continue
		}
		if ok && got != c.want {
			t.Errorf("ParseListLine(%q) = %+v, want %+v", c.line, got, c.want)
		}
	}
}
