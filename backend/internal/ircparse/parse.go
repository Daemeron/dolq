// Package ircparse turns raw IRC protocol lines into structured events.
package ircparse

import (
	"regexp"
	"strconv"
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

// Privileges holds every channel privilege a user currently has, not just
// the highest - populated from all of a NAMES prefix stack (e.g. "@+alice"
// is both op and voice), which the server only sends once `multi-prefix`
// has been negotiated (see ircclient's CAP REQ). Without it, a server only
// ever leads with the single highest prefix, so this just comes back with
// that one entry - same information as before, only representing it as a
// (single-element) set instead of a bare field.
type User struct {
	Nick       string           `json:"nick"`
	Privileges []PrivilegeLevel `json:"privileges"`
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

// WelcomeEvent is RPL_WELCOME (001), the first reply once registration
// actually succeeds - its target parameter is the server's authoritative
// view of our nick, which might not match what was requested (see
// NickInUseEvent below): this is what ircclient trusts as "my nick" rather
// than just assuming whatever NICK it originally sent was accepted.
type WelcomeEvent struct {
	Type string `json:"type"`
	Nick string `json:"nick"`
}

// NickInUseEvent is ERR_NICKNAMEINUSE (433) - the requested nick is taken.
// Retrying carries the alternate nick ircclient automatically retried with,
// if it did (only while still registering, see Client.handleNickInUse) -
// empty means it gave up (retries exhausted) or this was an already-
// registered client's own live nick change getting rejected, which isn't
// silently overridden with a nick nobody asked for.
type NickInUseEvent struct {
	Type     string `json:"type"`
	Nick     string `json:"nick"`
	Retrying string `json:"retrying,omitempty"`
}

// ActionEvent is CTCP ACTION (`/me`) - a PRIVMSG whose text is wrapped in
// \x01ACTION ... \x01. It's split out from PrivmsgEvent so the UI can render
// "* nick does a thing" instead of literal control bytes.
type ActionEvent struct {
	Type   string `json:"type"`
	Nick   string `json:"nick"`
	Target string `json:"target"`
	Text   string `json:"text"`
}

// NoticeEvent is a NOTICE - same targeting as PRIVMSG (a channel or a query
// straight to us) but meant never to trigger an automated reply, which is
// exactly why CTCP replies (see ircclient.sendCTCPReply) go out as NOTICE
// rather than PRIVMSG. Kept as its own event type, not folded into
// PrivmsgEvent, so the UI can render it distinctly. The source isn't always
// a nick!user@host - server notices (pre-registration MOTD-adjacent lines,
// etc.) come from a bare server hostname instead, so Nick is just whatever
// preceded an optional "!" rather than requiring one.
type NoticeEvent struct {
	Type   string `json:"type"`
	Nick   string `json:"nick"`
	Target string `json:"target"`
	Text   string `json:"text"`
}

// CTCPRequestEvent is any other CTCP request embedded in a PRIVMSG (RFC
// "extended formatting": \x01COMMAND args\x01) - VERSION and PING get an
// automatic reply, DCC gets parsed into a DCCChatOfferEvent for the user to
// accept/decline (see ircclient.Client.handleCTCPRequest for both).  Not
// meant to leave ircclient itself: there's nothing here to render directly.
type CTCPRequestEvent struct {
	Nick    string
	Target  string
	Command string
	Param   string
}

// DCCChatOfferEvent is a parsed CTCP "DCC CHAT" request - someone offering
// to open a direct peer-to-peer chat connection, bypassing the IRC server
// for its actual content. IP is already decoded from the wire's big-endian-
// uint32-decimal convention (see dcc.DecodeIP) into a normal dotted-quad
// string. Accepting or declining is a user decision the UI makes - nothing
// here dials out on its own, see bouncer.DCCAccept.
type DCCChatOfferEvent struct {
	Type string `json:"type"`
	Nick string `json:"nick"`
	IP   string `json:"ip"`
	Port int    `json:"port"`
}

// XDCCPackEvent is one row of an XDCC bot's pack listing, recognized inside
// an ordinary NOTICE or PRIVMSG's text (see ircclient's dispatch and
// xdcc.ParseListLine) - XDCC itself is just a text convention, not
// something the IRC protocol knows about. Emitted alongside the underlying
// NoticeEvent/PrivmsgEvent, not instead of it, so the raw listing still
// shows up as ordinary chat even where the pattern misses. Nick/Target
// carry the same meaning as NoticeEvent's - the bot, and whoever it sent
// the line to (us, for a typical private LIST reply).
type XDCCPackEvent struct {
	Type     string `json:"type"`
	Nick     string `json:"nick"`
	Target   string `json:"target"`
	Number   int    `json:"number"`
	Gets     int    `json:"gets"`
	Size     string `json:"size"`
	Filename string `json:"filename"`
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

// TopicEvent covers both a live TOPIC command and the RPL_TOPIC (332) numeric
// a server sends on join for a channel that already has one - Nick is only
// ever set for the former (who's changing it right now), empty for the
// latter (just reporting the existing topic, not a change).
type TopicEvent struct {
	Type    string `json:"type"`
	Channel string `json:"channel"`
	Topic   string `json:"topic"`
	Nick    string `json:"nick,omitempty"`
}

// TopicWhoTimeEvent is RPL_TOPICWHOTIME (333) - who set the current topic and
// when, sent right after RPL_TOPIC (332) on join. SetAt is Unix seconds, as
// sent on the wire.
type TopicWhoTimeEvent struct {
	Type    string `json:"type"`
	Channel string `json:"channel"`
	Nick    string `json:"nick"`
	SetAt   int64  `json:"setAt"`
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

// WhoisEvent is the synthesized result of a WHOIS request - ircclient
// accumulates the handful of raw numeric replies below (all "not meant to
// leave ircclient" the same way NamesReplyEvent/EndOfNamesEvent aren't)
// keyed by nick as they arrive, and emits this once RPL_ENDOFWHOIS (318)
// closes it out. Every field but Nick is only ever set if the server
// actually sent that piece - a network without WHOISACCOUNT (330) support,
// say, just leaves Account empty rather than this failing to build at all.
type WhoisEvent struct {
	Type        string   `json:"type"`
	Nick        string   `json:"nick"`
	User        string   `json:"user,omitempty"`
	Host        string   `json:"host,omitempty"`
	Realname    string   `json:"realname,omitempty"`
	Server      string   `json:"server,omitempty"`
	ServerInfo  string   `json:"serverInfo,omitempty"`
	IdleSeconds int64    `json:"idleSeconds,omitempty"`
	SignonTime  int64    `json:"signonTime,omitempty"`
	Channels    []string `json:"channels,omitempty"`
	Account     string   `json:"account,omitempty"`
	Away        string   `json:"away,omitempty"`
	// NoSuchNick means ERR_NOSUCHNICK (401) arrived instead of any of the
	// above - the WHOIS target doesn't exist (or just quit/changed nick
	// before the request landed).
	NoSuchNick bool `json:"noSuchNick,omitempty"`
}

// WhoisUserEvent (311), WhoisServerEvent (312), WhoisIdleEvent (317),
// WhoisChannelsEvent (319), WhoisAccountEvent (330, not universally
// supported), WhoisAwayEvent (301), ErrNoSuchNickEvent (401), and
// EndOfWhoisEvent (318) are the raw wire shapes WhoisEvent above is built
// from - see ircclient.Client's whoisBuffer.
type WhoisUserEvent struct {
	Nick, User, Host, Realname string
}

type WhoisServerEvent struct {
	Nick, Server, Info string
}

type WhoisIdleEvent struct {
	Nick        string
	IdleSeconds int64
	SignonTime  int64 // 0 if the server didn't include one
}

type WhoisChannelsEvent struct {
	Nick     string
	Channels []string
}

type WhoisAccountEvent struct {
	Nick, Account string
}

// WhoisAwayEvent is RPL_AWAY (301) - also sent standalone (outside any
// WHOIS) when messaging an away user. ircclient tells the two apart itself
// (a whois actually in flight for that nick, or not - see
// Client.handleLine) and turns a standalone one into an AwayEvent instead.
type WhoisAwayEvent struct {
	Nick, Message string
}

type ErrNoSuchNickEvent struct {
	Nick string
}

type EndOfWhoisEvent struct {
	Nick string
}

// AwayEvent is either a real-time away-notify update (someone in a shared
// channel just went away or came back - Message is only meaningful when
// Away is true, away-notify's "back" form carries no message at all) or a
// one-shot "they're away" learned from messaging someone (see
// WhoisAwayEvent's doc) - both are "here's this nick's away status right
// now" from the UI's point of view, so they share a shape.
type AwayEvent struct {
	Type    string `json:"type"`
	Nick    string `json:"nick"`
	Away    bool   `json:"away"`
	Message string `json:"message,omitempty"`
}

// SelfAwayEvent is RPL_UNAWAY (305, no longer away) or RPL_NOWAWAY (306,
// now away) - the server confirming our own AWAY command took effect.
type SelfAwayEvent struct {
	Type string `json:"type"`
	Away bool   `json:"away"`
}

// With `multi-prefix` negotiated, a NAMES entry can stack every prefix a
// user holds (e.g. "@+alice" for op+voice) instead of just the highest one.
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

// stripPrivilegePrefix drops any leading NAMES-style privilege symbols
// (`@#general` -> `#general`) - RPL_WHOISCHANNELS (319) lists channels the
// same way NAMES lists users, prefixed with the caller's highest privilege
// in each, which a WHOIS summary has no use for.
func stripPrivilegePrefix(s string) string {
	i := 0
	for i < len(s) {
		if _, ok := prefixToPrivilege[s[i]]; !ok {
			break
		}
		i++
	}
	return s[i:]
}

func parseNames(nickList string) []User {
	fields := strings.Fields(nickList)
	users := make([]User, 0, len(fields))
	for _, raw := range fields {
		i := 0
		var privileges []PrivilegeLevel
		for i < len(raw) {
			p, ok := prefixToPrivilege[raw[i]]
			if !ok {
				break
			}
			privileges = append(privileges, p)
			i++
		}
		users = append(users, User{Nick: raw[i:], Privileges: privileges})
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
	// Checked before the plain-PRIVMSG rule below so a CTCP-wrapped payload
	// (\x01...\x01) - whether sent to a channel or straight to us as a query
	// - is recognized as CTCP rather than falling through as literal chat
	// text containing control bytes.
	{
		pattern: regexp.MustCompile(`^:([^!\s]+)!\S+ PRIVMSG (\S+) :\x01(\S+)(?: ([^\x01]*))?\x01$`),
		build: func(m []string) any {
			if m[3] == "ACTION" {
				return ActionEvent{Type: "ACTION", Nick: m[1], Target: m[2], Text: m[4]}
			}
			return CTCPRequestEvent{Nick: m[1], Target: m[2], Command: m[3], Param: m[4]}
		},
	},
	{
		// Any target, not just a channel: a non-channel target is a private
		// message/query addressed straight to us (the only way we'd ever
		// receive one) - see the "Private messages/queries" ROADMAP item.
		pattern: regexp.MustCompile(`^:([^!\s]+)!\S+ PRIVMSG (\S+) :(.*)$`),
		build: func(m []string) any {
			return PrivmsgEvent{Type: "PRIVMSG", Nick: m[1], Target: m[2], Text: m[3]}
		},
	},
	{
		// Source is "nick!user@host" for a real user, but just a bare server
		// hostname (no "!") for server notices - cut at an optional "!" rather
		// than requiring one, same trick TOPICWHOTIME's build func uses below.
		pattern: regexp.MustCompile(`^:(\S+) NOTICE (\S+) :(.*)$`),
		build: func(m []string) any {
			nick, _, _ := strings.Cut(m[1], "!")
			return NoticeEvent{Type: "NOTICE", Nick: nick, Target: m[2], Text: m[3]}
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
		pattern: regexp.MustCompile(`^:([^!\s]+)!\S+ TOPIC (#\S+) :(.*)$`),
		build: func(m []string) any {
			return TopicEvent{Type: "TOPIC", Channel: m[2], Topic: m[3], Nick: m[1]}
		},
	},
	{
		pattern: regexp.MustCompile(`^:\S+ 332 \S+ (#\S+) :(.*)$`),
		build: func(m []string) any {
			return TopicEvent{Type: "TOPIC", Channel: m[1], Topic: m[2]}
		},
	},
	{
		pattern: regexp.MustCompile(`^:\S+ 333 \S+ (#\S+) (\S+) :?(\d+)$`),
		build: func(m []string) any {
			setAt, err := strconv.ParseInt(m[3], 10, 64)
			if err != nil {
				return nil
			}
			// Some servers send the full nick!user@host, not just the nick.
			nick, _, _ := strings.Cut(m[2], "!")
			return TopicWhoTimeEvent{Type: "TOPICWHOTIME", Channel: m[1], Nick: nick, SetAt: setAt}
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
	{
		pattern: regexp.MustCompile(`^:\S+ 001 (\S+) :`),
		build: func(m []string) any {
			return WelcomeEvent{Type: "WELCOME", Nick: m[1]}
		},
	},
	{
		pattern: regexp.MustCompile(`^:\S+ 433 \S+ (\S+) :`),
		build: func(m []string) any {
			return NickInUseEvent{Type: "NICKINUSE", Nick: m[1]}
		},
	},
	{
		// The "*" between host and the realname's ':' is an unused legacy
		// field (historically the hopcount to the target's server) - every
		// server still sends it, nothing reads it.
		pattern: regexp.MustCompile(`^:\S+ 311 \S+ (\S+) (\S+) (\S+) \S+ :(.*)$`),
		build: func(m []string) any {
			return WhoisUserEvent{Nick: m[1], User: m[2], Host: m[3], Realname: m[4]}
		},
	},
	{
		pattern: regexp.MustCompile(`^:\S+ 312 \S+ (\S+) (\S+) :(.*)$`),
		build: func(m []string) any {
			return WhoisServerEvent{Nick: m[1], Server: m[2], Info: m[3]}
		},
	},
	{
		// The signon-time parameter is a newer (but widely deployed)
		// addition servers may or may not send.
		pattern: regexp.MustCompile(`^:\S+ 317 \S+ (\S+) (\d+)(?: (\d+))? :`),
		build: func(m []string) any {
			idle, err := strconv.ParseInt(m[2], 10, 64)
			if err != nil {
				return nil
			}
			var signon int64
			if m[3] != "" {
				signon, _ = strconv.ParseInt(m[3], 10, 64)
			}
			return WhoisIdleEvent{Nick: m[1], IdleSeconds: idle, SignonTime: signon}
		},
	},
	{
		pattern: regexp.MustCompile(`^:\S+ 319 \S+ (\S+) :(.*)$`),
		build: func(m []string) any {
			channels := strings.Fields(m[2])
			for i, ch := range channels {
				channels[i] = stripPrivilegePrefix(ch)
			}
			return WhoisChannelsEvent{Nick: m[1], Channels: channels}
		},
	},
	{
		pattern: regexp.MustCompile(`^:\S+ 330 \S+ (\S+) (\S+) :`),
		build: func(m []string) any {
			return WhoisAccountEvent{Nick: m[1], Account: m[2]}
		},
	},
	{
		pattern: regexp.MustCompile(`^:\S+ 301 \S+ (\S+) :(.*)$`),
		build: func(m []string) any {
			return WhoisAwayEvent{Nick: m[1], Message: m[2]}
		},
	},
	{
		pattern: regexp.MustCompile(`^:\S+ 401 \S+ (\S+) :`),
		build: func(m []string) any {
			return ErrNoSuchNickEvent{Nick: m[1]}
		},
	},
	{
		pattern: regexp.MustCompile(`^:\S+ 318 \S+ (\S+) :`),
		build: func(m []string) any {
			return EndOfWhoisEvent{Nick: m[1]}
		},
	},
	{
		// away-notify: they just went away. Checked before the bare "AWAY"
		// (came back) rule below since this one requires the " :message"
		// suffix that rule's absence of a match relies on.
		pattern: regexp.MustCompile(`^:([^!\s]+)!\S+ AWAY :(.*)$`),
		build: func(m []string) any {
			return AwayEvent{Type: "AWAY", Nick: m[1], Away: true, Message: m[2]}
		},
	},
	{
		// away-notify: they just came back - no trailing parameter at all,
		// unlike the away form above.
		pattern: regexp.MustCompile(`^:([^!\s]+)!\S+ AWAY$`),
		build: func(m []string) any {
			return AwayEvent{Type: "AWAY", Nick: m[1], Away: false}
		},
	},
	{
		pattern: regexp.MustCompile(`^:\S+ 305 \S+ :`), // RPL_UNAWAY
		build: func(m []string) any {
			return SelfAwayEvent{Type: "SELFAWAY", Away: false}
		},
	},
	{
		pattern: regexp.MustCompile(`^:\S+ 306 \S+ :`), // RPL_NOWAWAY
		build: func(m []string) any {
			return SelfAwayEvent{Type: "SELFAWAY", Away: true}
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
