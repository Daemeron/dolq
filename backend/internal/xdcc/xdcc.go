// Package xdcc parses XDCC pack listings - a convention layered on plain
// PRIVMSG/NOTICE text (no CTCP, no protocol support at all), not something
// ircparse's RFC-shaped grammar covers. Requesting a listing needs nothing
// new either: "XDCC LIST" sent to a bot is just an ordinary /msg, already
// supported. This only covers the LIST reply's pack rows - GET/DCC SEND is
// a separate, later Milestone 3 item.
package xdcc

import (
	"regexp"
	"strconv"
	"strings"
)

// Pack is one parsed row of a bot's pack listing.
type Pack struct {
	Number   int
	Gets     int
	Size     string // kept as the bot's own string (e.g. "340M", "1.2G") - unit conventions vary too much to normalize confidently
	Filename string
}

// listLineRE matches the pack-row shape essentially every XDCC bot software
// (iroffer and its many forks/clones, which is to say nearly all of them)
// uses: "#<n>  <gets>x [<size>] <filename>". Leading whitespace and an
// optional "x" after gets are the only real variation seen in the wild.
var listLineRE = regexp.MustCompile(`^#(\d+)\s+(\d+)x\s+\[\s*([^\]]+?)\s*\]\s+(.+)$`)

// ParseListLine reports whether line is a pack-listing row and, if so,
// returns it parsed. Header/footer lines a bot sends around the packs
// themselves ("** 12 packs **", "Total Offered: ...") don't match and are
// left as plain chat text.
func ParseListLine(line string) (Pack, bool) {
	m := listLineRE.FindStringSubmatch(strings.TrimSpace(line))
	if m == nil {
		return Pack{}, false
	}
	number, err := strconv.Atoi(m[1])
	if err != nil {
		return Pack{}, false
	}
	gets, err := strconv.Atoi(m[2])
	if err != nil {
		return Pack{}, false
	}
	return Pack{Number: number, Gets: gets, Size: m[3], Filename: m[4]}, true
}
