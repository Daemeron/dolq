package ircparse

import (
	"reflect"
	"testing"
)

func TestParseLine(t *testing.T) {
	tests := []struct {
		name string
		line string
		want any
	}{
		{
			name: "parses PRIVMSG to a channel",
			line: ":alice!u@host PRIVMSG #general :hello there",
			want: PrivmsgEvent{Type: "PRIVMSG", Nick: "alice", Target: "#general", Text: "hello there"},
		},
		{
			name: "parses JOIN without a leading colon on the channel",
			line: ":bob!u@host JOIN #general",
			want: JoinEvent{Type: "JOIN", Nick: "bob", Channel: "#general"},
		},
		{
			name: "parses JOIN with a leading colon on the channel",
			line: ":bob!u@host JOIN :#general",
			want: JoinEvent{Type: "JOIN", Nick: "bob", Channel: "#general"},
		},
		{
			name: "parses PART with a reason",
			line: ":carol!u@host PART #general :bye",
			want: PartEvent{Type: "PART", Nick: "carol", Channel: "#general", Reason: "bye"},
		},
		{
			name: "parses PART without a reason",
			line: ":carol!u@host PART #general",
			want: PartEvent{Type: "PART", Nick: "carol", Channel: "#general"},
		},
		{
			name: "parses KICK with a reason",
			line: ":alice!u@host KICK #general bob :spamming",
			want: KickEvent{Type: "KICK", By: "alice", Channel: "#general", Nick: "bob", Reason: "spamming"},
		},
		{
			name: "parses KICK without a reason",
			line: ":alice!u@host KICK #general bob",
			want: KickEvent{Type: "KICK", By: "alice", Channel: "#general", Nick: "bob"},
		},
		{
			name: "parses QUIT",
			line: ":dave!u@host QUIT :goodbye",
			want: QuitEvent{Type: "QUIT", Nick: "dave", Reason: "goodbye"},
		},
		{
			name: "parses NICK with a leading colon on the new nick",
			line: ":eve!u@host NICK :eve2",
			want: NickEvent{Type: "NICK", OldNick: "eve", NewNick: "eve2"},
		},
		{
			name: "parses NICK without a leading colon on the new nick",
			line: ":eve!u@host NICK eve2",
			want: NickEvent{Type: "NICK", OldNick: "eve", NewNick: "eve2"},
		},
		{
			name: "parses a CTCP ACTION as an ActionEvent",
			line: ":alice!u@host PRIVMSG #general :\x01ACTION waves\x01",
			want: ActionEvent{Type: "ACTION", Nick: "alice", Target: "#general", Text: "waves"},
		},
		{
			name: "parses a CTCP VERSION request",
			line: ":alice!u@host PRIVMSG dolq_user :\x01VERSION\x01",
			want: CTCPRequestEvent{Nick: "alice", Target: "dolq_user", Command: "VERSION"},
		},
		{
			name: "parses a CTCP PING request with its token",
			line: ":alice!u@host PRIVMSG dolq_user :\x01PING 1600000000\x01",
			want: CTCPRequestEvent{Nick: "alice", Target: "dolq_user", Command: "PING", Param: "1600000000"},
		},
		{
			name: "parses a live TOPIC change",
			line: ":alice!u@host TOPIC #general :new topic here",
			want: TopicEvent{Type: "TOPIC", Channel: "#general", Topic: "new topic here", Nick: "alice"},
		},
		{
			name: "parses a 332 RPL_TOPIC reply",
			line: ":irc.example.net 332 me #general :existing topic",
			want: TopicEvent{Type: "TOPIC", Channel: "#general", Topic: "existing topic"},
		},
		{
			name: "parses a 333 RPL_TOPICWHOTIME reply with a bare nick",
			line: ":irc.example.net 333 me #general alice 1600000000",
			want: TopicWhoTimeEvent{Type: "TOPICWHOTIME", Channel: "#general", Nick: "alice", SetAt: 1600000000},
		},
		{
			name: "parses a 333 RPL_TOPICWHOTIME reply with a full hostmask and trailing colon",
			line: ":irc.example.net 333 me #general alice!u@host :1600000000",
			want: TopicWhoTimeEvent{Type: "TOPICWHOTIME", Channel: "#general", Nick: "alice", SetAt: 1600000000},
		},
		{
			name: "parses a 353 NAMES reply with mixed status symbols",
			line: ":irc.example.net 353 me = #general :~alice &bob @carol %dave +eve frank",
			want: NamesReplyEvent{
				Channel: "#general",
				Users: []User{
					{Nick: "alice", Privilege: PrivilegeOwner},
					{Nick: "bob", Privilege: PrivilegeAdmin},
					{Nick: "carol", Privilege: PrivilegeOp},
					{Nick: "dave", Privilege: PrivilegeHalfop},
					{Nick: "eve", Privilege: PrivilegeVoice},
					{Nick: "frank", Privilege: PrivilegeNone},
				},
			},
		},
		{
			name: "parses a 366 end-of-names marker",
			line: ":irc.example.net 366 me #general :End of /NAMES list.",
			want: EndOfNamesEvent{Channel: "#general"},
		},
		{
			name: "parses a channel MODE granting a privilege",
			line: ":alice!u@host MODE #general +o bob",
			want: ModeEvent{
				Type: "MODE", Channel: "#general",
				Changes: []ModeChange{{Nick: "bob", Privilege: PrivilegeOp, Granted: true}},
			},
		},
		{
			name: "parses a channel MODE with mixed grants and revokes for multiple nicks",
			line: ":alice!u@host MODE #general +o-v bob carol",
			want: ModeEvent{
				Type: "MODE", Channel: "#general",
				Changes: []ModeChange{
					{Nick: "bob", Privilege: PrivilegeOp, Granted: true},
					{Nick: "carol", Privilege: PrivilegeVoice, Granted: false},
				},
			},
		},
		{
			name: "extracts a privilege grant bundled with a known list/key/limit mode",
			line: ":alice!u@host MODE #general +ok bob secretkey",
			want: ModeEvent{
				Type: "MODE", Channel: "#general",
				Changes: []ModeChange{{Nick: "bob", Privilege: PrivilegeOp, Granted: true}},
			},
		},
		{
			name: "does not consume an argument for a ban set alongside a privilege grant",
			line: ":alice!u@host MODE #general +ob bob carol!*@*",
			want: ModeEvent{
				Type: "MODE", Channel: "#general",
				Changes: []ModeChange{{Nick: "bob", Privilege: PrivilegeOp, Granted: true}},
			},
		},
		{
			name: "only consumes a limit argument when the limit is being set, not unset",
			line: ":alice!u@host MODE #general +l-o 50 bob",
			want: ModeEvent{
				Type: "MODE", Channel: "#general",
				Changes: []ModeChange{{Nick: "bob", Privilege: PrivilegeOp, Granted: false}},
			},
		},
		{
			name: "skips known no-argument flags without losing a later privilege change",
			line: ":alice!u@host MODE #general +nto bob",
			want: ModeEvent{
				Type: "MODE", Channel: "#general",
				Changes: []ModeChange{{Nick: "bob", Privilege: PrivilegeOp, Granted: true}},
			},
		},
		{
			name: "returns nil when no privilege changes are found",
			line: ":alice!u@host MODE #general +k secretkey",
			want: nil,
		},
		{
			name: "stops at a fully unrecognized letter but keeps changes found before it",
			line: ":alice!u@host MODE #general +oZ bob mystery",
			want: ModeEvent{
				Type: "MODE", Channel: "#general",
				Changes: []ModeChange{{Nick: "bob", Privilege: PrivilegeOp, Granted: true}},
			},
		},
		{name: "returns nil for an unrecognized PING line", line: "PING :irc.example.net", want: nil},
		{name: "returns nil for an unrecognized numeric", line: ":irc.example.net 001 me :Welcome", want: nil},
		{name: "returns nil for garbage", line: "garbage", want: nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseLine(tt.line)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("ParseLine(%q) = %#v, want %#v", tt.line, got, tt.want)
			}
		})
	}
}
