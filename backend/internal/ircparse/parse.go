package ircparse

import (
	"regexp"
	"strconv"
	"strings"
)

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

type WelcomeEvent struct {
	Type string `json:"type"`
	Nick string `json:"nick"`
}

type NickInUseEvent struct {
	Type     string `json:"type"`
	Nick     string `json:"nick"`
	Retrying string `json:"retrying,omitempty"`
}

type ActionEvent struct {
	Type   string `json:"type"`
	Nick   string `json:"nick"`
	Target string `json:"target"`
	Text   string `json:"text"`
}

type NoticeEvent struct {
	Type   string `json:"type"`
	Nick   string `json:"nick"`
	Target string `json:"target"`
	Text   string `json:"text"`
}

type CTCPRequestEvent struct {
	Nick    string
	Target  string
	Command string
	Param   string
}

type DCCChatOfferEvent struct {
	Type string `json:"type"`
	Nick string `json:"nick"`
	IP   string `json:"ip"`
	Port int    `json:"port"`
}

type XDCCSendOfferEvent struct {
	Type     string `json:"type"`
	Nick     string `json:"nick"`
	Filename string `json:"filename"`
	IP       string `json:"ip"`
	Port     int    `json:"port"`
	Size     int64  `json:"size"`
	Token    string `json:"token,omitempty"`
}

type XDCCPackEvent struct {
	Type     string `json:"type"`
	Nick     string `json:"nick"`
	Target   string `json:"target"`
	Number   int    `json:"number"`
	Gets     int    `json:"gets"`
	Size     string `json:"size"`
	Filename string `json:"filename"`
}

type XDCCResumeAcceptEvent struct {
	Type     string `json:"type"`
	Nick     string `json:"nick"`
	Filename string `json:"filename"`
	Port     int    `json:"port"`
	Position int64  `json:"position"`
	Token    string `json:"token,omitempty"`
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

type TopicEvent struct {
	Type    string `json:"type"`
	Channel string `json:"channel"`
	Topic   string `json:"topic"`
	Nick    string `json:"nick,omitempty"`
}

type TopicWhoTimeEvent struct {
	Type    string `json:"type"`
	Channel string `json:"channel"`
	Nick    string `json:"nick"`
	SetAt   int64  `json:"setAt"`
}

type NamesReplyEvent struct {
	Channel string
	Users   []User
}

type EndOfNamesEvent struct {
	Channel string
}

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
	NoSuchNick  bool     `json:"noSuchNick,omitempty"`
}

type WhoisUserEvent struct {
	Nick, User, Host, Realname string
}

type WhoisServerEvent struct {
	Nick, Server, Info string
}

type WhoisIdleEvent struct {
	Nick        string
	IdleSeconds int64
	SignonTime  int64
}

type WhoisChannelsEvent struct {
	Nick     string
	Channels []string
}

type WhoisAccountEvent struct {
	Nick, Account string
}

type WhoisAwayEvent struct {
	Nick, Message string
}

type ErrNoSuchNickEvent struct {
	Nick string
}

type EndOfWhoisEvent struct {
	Nick string
}

type AwayEvent struct {
	Type    string `json:"type"`
	Nick    string `json:"nick"`
	Away    bool   `json:"away"`
	Message string `json:"message,omitempty"`
}

type SelfAwayEvent struct {
	Type string `json:"type"`
	Away bool   `json:"away"`
}

var prefixToPrivilege = map[byte]PrivilegeLevel{
	'~': PrivilegeOwner, '&': PrivilegeAdmin, '@': PrivilegeOp, '%': PrivilegeHalfop, '+': PrivilegeVoice,
}

var modeLetterToPrivilege = map[byte]PrivilegeLevel{
	'q': PrivilegeOwner, 'a': PrivilegeAdmin, 'o': PrivilegeOp, 'h': PrivilegeHalfop, 'v': PrivilegeVoice,
}

var alwaysArgLetters = map[byte]bool{'b': true, 'e': true, 'I': true, 'k': true}
var setOnlyArgLetters = map[byte]bool{'f': true, 'l': true}
var neverArgLetters = map[byte]bool{
	'C': true, 'E': true, 'M': true, 'R': true, 'U': true,
	'i': true, 'm': true, 'n': true, 's': true, 't': true, 'u': true,
}

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
		privileges := []PrivilegeLevel{}
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
		break
	}

	return changes
}

type rule struct {
	pattern *regexp.Regexp
	build   func(m []string) any
}

var rules = []rule{
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
		pattern: regexp.MustCompile(`^:([^!\s]+)!\S+ PRIVMSG (\S+) :(.*)$`),
		build: func(m []string) any {
			return PrivmsgEvent{Type: "PRIVMSG", Nick: m[1], Target: m[2], Text: m[3]}
		},
	},
	{
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
		pattern: regexp.MustCompile(`^:([^!\s]+)!\S+ AWAY :(.*)$`),
		build: func(m []string) any {
			return AwayEvent{Type: "AWAY", Nick: m[1], Away: true, Message: m[2]}
		},
	},
	{
		pattern: regexp.MustCompile(`^:([^!\s]+)!\S+ AWAY$`),
		build: func(m []string) any {
			return AwayEvent{Type: "AWAY", Nick: m[1], Away: false}
		},
	},
	{
		pattern: regexp.MustCompile(`^:\S+ 305 \S+ :`),
		build: func(m []string) any {
			return SelfAwayEvent{Type: "SELFAWAY", Away: false}
		},
	},
	{
		pattern: regexp.MustCompile(`^:\S+ 306 \S+ :`),
		build: func(m []string) any {
			return SelfAwayEvent{Type: "SELFAWAY", Away: true}
		},
	},
}

func ParseLine(line string) any {
	for _, r := range rules {
		if m := r.pattern.FindStringSubmatch(line); m != nil {
			return r.build(m)
		}
	}
	return nil
}
