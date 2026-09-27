package xdcc

import (
	"regexp"
	"strconv"
	"strings"
)

type Pack struct {
	Number   int
	Gets     int
	Size     string
	Filename string
}

var listLineRE = regexp.MustCompile(`^#(\d+)\s+(\d+)x\s+\[\s*([^\]]+?)\s*\]\s+(.+)$`)

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
