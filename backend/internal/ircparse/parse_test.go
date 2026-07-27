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
			name: "parses PRIVMSG to a nick as a private message",
			line: ":alice!u@host PRIVMSG dolq_user :hey, got a sec?",
			want: PrivmsgEvent{Type: "PRIVMSG", Nick: "alice", Target: "dolq_user", Text: "hey, got a sec?"},
		},
		{
			name: "parses NOTICE from a user",
			line: ":NickServ!services@host NOTICE dolq_user :You are now identified.",
			want: NoticeEvent{Type: "NOTICE", Nick: "NickServ", Target: "dolq_user", Text: "You are now identified."},
		},
		{
			name: "parses NOTICE from a bare server hostname",
			line: ":irc.example.net NOTICE dolq_user :*** Looking up your hostname...",
			want: NoticeEvent{Type: "NOTICE", Nick: "irc.example.net", Target: "dolq_user", Text: "*** Looking up your hostname..."},
		},
		{
			name: "parses NOTICE to a channel",
			line: ":alice!u@host NOTICE #general :heads up",
			want: NoticeEvent{Type: "NOTICE", Nick: "alice", Target: "#general", Text: "heads up"},
		},
		{
			name: "parses RPL_WELCOME (001) for our confirmed nick",
			line: ":irc.example.net 001 dolq_user :Welcome to the Example Network, dolq_user",
			want: WelcomeEvent{Type: "WELCOME", Nick: "dolq_user"},
		},
		{
			name: "parses ERR_NICKNAMEINUSE (433) before registration",
			line: ":irc.example.net 433 * dolq_user :Nickname is already in use.",
			want: NickInUseEvent{Type: "NICKINUSE", Nick: "dolq_user"},
		},
		{
			name: "parses ERR_NICKNAMEINUSE (433) after registration",
			line: ":irc.example.net 433 dolq_user newnick :Nickname is already in use.",
			want: NickInUseEvent{Type: "NICKINUSE", Nick: "newnick"},
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
					{Nick: "alice", Privileges: []PrivilegeLevel{PrivilegeOwner}},
					{Nick: "bob", Privileges: []PrivilegeLevel{PrivilegeAdmin}},
					{Nick: "carol", Privileges: []PrivilegeLevel{PrivilegeOp}},
					{Nick: "dave", Privileges: []PrivilegeLevel{PrivilegeHalfop}},
					{Nick: "eve", Privileges: []PrivilegeLevel{PrivilegeVoice}},
					{Nick: "frank"},
				},
			},
		},
		{
			name: "parses a 353 NAMES reply with a stacked multi-prefix entry",
			line: ":irc.example.net 353 me = #general :@+alice bob",
			want: NamesReplyEvent{
				Channel: "#general",
				Users: []User{
					{Nick: "alice", Privileges: []PrivilegeLevel{PrivilegeOp, PrivilegeVoice}},
					{Nick: "bob"},
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
		{
			name: "parses a 311 RPL_WHOISUSER reply",
			line: ":irc.example.net 311 dolq_user alice ident host.example.net * :Alice Example",
			want: WhoisUserEvent{Nick: "alice", User: "ident", Host: "host.example.net", Realname: "Alice Example"},
		},
		{
			name: "parses a 312 RPL_WHOISSERVER reply",
			line: ":irc.example.net 312 dolq_user alice irc.example.net :Example IRC Network",
			want: WhoisServerEvent{Nick: "alice", Server: "irc.example.net", Info: "Example IRC Network"},
		},
		{
			name: "parses a 317 RPL_WHOISIDLE reply with a signon time",
			line: ":irc.example.net 317 dolq_user alice 300 1700000000 :seconds idle, signon time",
			want: WhoisIdleEvent{Nick: "alice", IdleSeconds: 300, SignonTime: 1700000000},
		},
		{
			name: "parses a 317 RPL_WHOISIDLE reply without a signon time",
			line: ":irc.example.net 317 dolq_user alice 300 :seconds idle",
			want: WhoisIdleEvent{Nick: "alice", IdleSeconds: 300},
		},
		{
			name: "parses a 319 RPL_WHOISCHANNELS reply, stripping privilege prefixes",
			line: ":irc.example.net 319 dolq_user alice :@#general +#offtopic #help",
			want: WhoisChannelsEvent{Nick: "alice", Channels: []string{"#general", "#offtopic", "#help"}},
		},
		{
			name: "parses a 330 RPL_WHOISACCOUNT reply",
			line: ":irc.example.net 330 dolq_user alice alice_account :is logged in as",
			want: WhoisAccountEvent{Nick: "alice", Account: "alice_account"},
		},
		{
			name: "parses a 301 RPL_AWAY reply",
			line: ":irc.example.net 301 dolq_user alice :gone fishing",
			want: WhoisAwayEvent{Nick: "alice", Message: "gone fishing"},
		},
		{
			name: "parses a 401 ERR_NOSUCHNICK reply",
			line: ":irc.example.net 401 dolq_user ghost :No such nick/channel",
			want: ErrNoSuchNickEvent{Nick: "ghost"},
		},
		{
			name: "parses a 318 RPL_ENDOFWHOIS reply",
			line: ":irc.example.net 318 dolq_user alice :End of /WHOIS list.",
			want: EndOfWhoisEvent{Nick: "alice"},
		},
		{name: "returns nil for an unrecognized PING line", line: "PING :irc.example.net", want: nil},
		{name: "returns nil for an unrecognized numeric", line: ":irc.example.net 002 me :Your host is irc.example.net", want: nil},
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
