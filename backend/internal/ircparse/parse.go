// Package ircparse turns raw IRC protocol lines into structured events.
package ircparse

import (
	"regexp"
	"strings"
)

// Ranked highest to lowest; PrivilegeNone means no channel privilege.
type PrivilegeLevel string

const (
	PrivilegeOwner  PrivilegeLevel = "owner"
	PrivilegeAdmin  PrivilegeLevel = "admin"
	PrivilegeOp     PrivilegeLevel = "op"
	PrivilegeHalfop PrivilegeLevel = "halfop"
	PrivilegeVoice  PrivilegeLevel = "voice"
	PrivilegeNone   PrivilegeLevel = "none"
)

type User struct {
	Nick      string         `json:"nick"`
	Privilege PrivilegeLevel `json:"privilege"`
}

type ModeChange struct {
	Nick      string         `json:"nick"`
	Privilege PrivilegeLevel `json:"privilege"`
	Granted   bool           `json:"granted"`
}

type PrivmsgEvent struct {
	Type   string `json:"type"`
	Nick   string `json:"nick"`
	Target string `json:"target"`
	Text   string `json:"text"`
}

type JoinEvent struct {
	Type    string `json:"type"`
	Nick    string `json:"nick"`
	Channel string `json:"channel"`
}

type PartEvent struct {
	Type    string `json:"type"`
	Nick    string `json:"nick"`
	Channel string `json:"channel"`
	Reason  string `json:"reason,omitempty"`
}

type KickEvent struct {
	Type    string `json:"type"`
	By      string `json:"by"`
	Channel string `json:"channel"`
	Nick    string `json:"nick"`
	Reason  string `json:"reason,omitempty"`
}

type QuitEvent struct {
	Type   string `json:"type"`
	Nick   string `json:"nick"`
	Reason string `json:"reason,omitempty"`
}

type NickEvent struct {
	Type    string `json:"type"`
	OldNick string `json:"oldNick"`
	NewNick string `json:"newNick"`
}

type ModeEvent struct {
	Type    string       `json:"type"`
	Channel string       `json:"channel"`
	Changes []ModeChange `json:"changes"`
}

// NamesReplyEvent and EndOfNamesEvent are raw wire shapes (RFC replies
// 353/366). They're not meant to leave ircclient, which buffers them into a
// single synthesized "names" event - see ircclient.Client.
type NamesReplyEvent struct {
	Channel string
	Users   []User
}

type EndOfNamesEvent struct {
	Channel string
}

// NAMES only ever reports a single (the highest) prefix per user without the
// multi-prefix capability, which this client doesn't negotiate.
var prefixToPrivilege = map[byte]PrivilegeLevel{
	'~': PrivilegeOwner, '&': PrivilegeAdmin, '@': PrivilegeOp, '%': PrivilegeHalfop, '+': PrivilegeVoice,
}

// MODE letter -> privilege, for the letters that change a user's channel privilege.
var modeLetterToPrivilege = map[byte]PrivilegeLevel{
	'q': PrivilegeOwner, 'a': PrivilegeAdmin, 'o': PrivilegeOp, 'h': PrivilegeHalfop, 'v': PrivilegeVoice,
}

// Non-privilege CHANMODES letters, classified by how they consume args - needed so a
// privilege change bundled in the same MODE line as one of these (e.g. `+ob nick mask`)
// doesn't get its argument misaligned. Based on Ergo's advertised
// CHANMODES=Ibe,k,fl,CEMRUimnstu (list-type, always-arg, set-only-arg, never-arg).
var alwaysArgLetters = map[byte]bool{'b': true, 'e': true, 'I': true, 'k': true}
var setOnlyArgLetters = map[byte]bool{'f': true, 'l': true}
var neverArgLetters = map[byte]bool{
	'C': true, 'E': true, 'M': true, 'R': true, 'U': true,
	'i': true, 'm': true, 'n': true, 's': true, 't': true, 'u': true,
}

func parseNames(nickList string) []User {
	fields := strings.Fields(nickList)
	users := make([]User, 0, len(fields))
	for _, raw := range fields {
		privilege, ok := prefixToPrivilege[raw[0]]
		nick := raw
		if ok {
			nick = raw[1:]
		} else {
			privilege = PrivilegeNone
		}
		users = append(users, User{Nick: nick, Privilege: privilege})
	}
	return users
}

// parseChannelModeChanges extracts privilege changes (qaohv) from a MODE line, correctly
// skipping over any other recognized CHANMODES letters bundled into the same line (e.g.
// `+ob nick mask`) so their arguments don't misalign the ones that follow. A letter this
// client doesn't recognize at all means it can no longer be sure how many args the rest
// of the line consumes, so parsing stops there - whatever privilege changes were already
// found (earlier in the same line) are still returned rather than discarded.
func parseChannelModeChanges(modeString string, args []string) []ModeChange {
	var changes []ModeChange
	granted := true
	argIndex := 0

	for i := 0; i < len(modeString); i++ {
		letter := modeString[i]

		if letter == '+' {
			granted = true
			continue
		}
		if letter == '-' {
			granted = false
			continue
		}

		if privilege, ok := modeLetterToPrivilege[letter]; ok {
			if argIndex >= len(args) {
				break
			}
			nick := args[argIndex]
			argIndex++
			changes = append(changes, ModeChange{Nick: nick, Privilege: privilege, Granted: granted})
			continue
		}
		if alwaysArgLetters[letter] {
			argIndex++
			continue
		}
		if setOnlyArgLetters[letter] {
			if granted {
				argIndex++
			}
			continue
		}
		if neverArgLetters[letter] {
			continue
		}
		break // unrecognized letter - arg alignment past this point is no longer reliable
	}

	return changes
}

// One entry per wire message we understand: pattern matches the raw line,
// build turns the capture groups into the event (or nil to report no event).
// Add new RFC commands/replies by appending an entry here - ParseLine itself
// never needs to change.
type rule struct {
	pattern *regexp.Regexp
	build   func(m []string) any
}

var rules = []rule{
	{
		pattern: regexp.MustCompile(`^:([^!\s]+)!\S+ PRIVMSG (#\S+) :(.*)$`),
		build: func(m []string) any {
			return PrivmsgEvent{Type: "PRIVMSG", Nick: m[1], Target: m[2], Text: m[3]}
		},
	},
	{
		pattern: regexp.MustCompile(`^:([^!\s]+)!\S+ JOIN :?(#\S+)`),
		build: func(m []string) any {
			return JoinEvent{Type: "JOIN", Nick: m[1], Channel: m[2]}
		},
	},
	{
		pattern: regexp.MustCompile(`^:([^!\s]+)!\S+ PART (#\S+)(?: :(.*))?$`),
		build: func(m []string) any {
			return PartEvent{Type: "PART", Nick: m[1], Channel: m[2], Reason: m[3]}
		},
	},
	{
		pattern: regexp.MustCompile(`^:([^!\s]+)!\S+ KICK (#\S+) (\S+)(?: :(.*))?$`),
		build: func(m []string) any {
			return KickEvent{Type: "KICK", By: m[1], Channel: m[2], Nick: m[3], Reason: m[4]}
		},
	},
	{
		pattern: regexp.MustCompile(`^:([^!\s]+)!\S+ QUIT(?: :(.*))?$`),
		build: func(m []string) any {
			return QuitEvent{Type: "QUIT", Nick: m[1], Reason: m[2]}
		},
	},
	{
		pattern: regexp.MustCompile(`^:([^!\s]+)!\S+ NICK :?(\S+)$`),
		build: func(m []string) any {
			return NickEvent{Type: "NICK", OldNick: m[1], NewNick: m[2]}
		},
	},
	{
		pattern: regexp.MustCompile(`^:[^!\s]+!\S+ MODE (#\S+) ([-+]\S+)(.*)$`),
		build: func(m []string) any {
			args := strings.Fields(m[3])
			changes := parseChannelModeChanges(m[2], args)
			if changes == nil {
				return nil
			}
			return ModeEvent{Type: "MODE", Channel: m[1], Changes: changes}
		},
	},
	{
		pattern: regexp.MustCompile(`^:\S+ 353 \S+ [=*@] (#\S+) :(.*)$`),
		build: func(m []string) any {
			return NamesReplyEvent{Channel: m[1], Users: parseNames(m[2])}
		},
	},
	{
		pattern: regexp.MustCompile(`^:\S+ 366 \S+ (#\S+)`),
		build: func(m []string) any {
			return EndOfNamesEvent{Channel: m[1]}
		},
	},
}

// ParseLine parses one raw IRC protocol line into a structured event, or
// returns nil if the line isn't one this client understands (or, for MODE,
// if the line contains no channel privilege changes).
func ParseLine(line string) any {
	for _, r := range rules {
		if m := r.pattern.FindStringSubmatch(line); m != nil {
			return r.build(m)
		}
	}
	return nil
}
