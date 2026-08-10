// Package ipcproto is the local IPC wire protocol between a frontend and
// this backend: newline-delimited JSON frames over a Unix domain socket.
package ipcproto

import "github.com/Daemeron/dolq/backend/internal/history"

// Client -> server actions.
const (
	ActionConnect           = "connect"
	ActionDisconnect        = "disconnect"
	ActionSend              = "send"
	ActionGetStatus         = "getStatus"
	ActionGetJoinedChannels = "getJoinedChannels"
	ActionGetHistory        = "getHistory"
	ActionSearch            = "search"    // Channel/ServerID empty widens the search - see bouncer.Search
	ActionDCCOffer          = "dccOffer"  // sends a CTCP DCC CHAT request and listens for the reply
	ActionDCCAccept         = "dccAccept" // dials a peer's offered DCC CHAT listener
	ActionDCCSend           = "dccSend"
	ActionDCCClose          = "dccClose"
	ActionXDCCAccept        = "xdccAccept" // accepts a DCC SEND offer (see bouncer/xdcc.go) and downloads it
	ActionXDCCClose         = "xdccClose"  // cancels an in-progress transfer
	ActionXDCCPause         = "xdccPause"
	ActionXDCCResume        = "xdccResume"
)

// Server -> client frame types.
const (
	FrameResult = "result" // reply to a request, ID echoes ClientFrame.ID
	FrameLine   = "line"   // unsolicited, fanned out to a session's subscribers
	FrameEvent  = "event"  // unsolicited, fanned out to a session's subscribers
	FrameStatus = "status" // unsolicited, fanned out to a session's subscribers
)

// ClientFrame is one line the frontend sends.
type ClientFrame struct {
	ID       string   `json:"id,omitempty"` // caller-chosen; echoed back on the result
	Action   string   `json:"action"`
	ServerID string   `json:"serverId,omitempty"`
	Host     string   `json:"host,omitempty"`
	Port     int      `json:"port,omitempty"`
	Nick     string   `json:"nick,omitempty"`
	Secure   bool     `json:"secure,omitempty"`
	SASLUser string   `json:"saslUser,omitempty"` // connect; both empty skips SASL
	SASLPass string   `json:"saslPass,omitempty"` // connect
	Username string   `json:"username,omitempty"` // connect; empty defaults to nick
	Realname string   `json:"realname,omitempty"` // connect; empty defaults to "Dolq IRC Client"
	AltNicks []string `json:"altNicks,omitempty"` // connect
	Line     string   `json:"line,omitempty"`
	Channel  string   `json:"channel,omitempty"` // getHistory, search (empty widens a search - see bouncer.Search)
	Before   int64    `json:"before,omitempty"`  // getHistory: id cursor, 0 = most recent
	Limit    int      `json:"limit,omitempty"`   // getHistory, search
	Query    string   `json:"query,omitempty"`   // search
	// DCC CHAT (see bouncer/dcc.go). dccOffer reuses ServerID (which IRC
	// connection to send the CTCP over) and Nick (the target); dccAccept
	// reuses Host/Port (the peer's announced address, from a
	// DCCChatOfferEvent); dccSend/dccClose use DCCID (dccOffer/dccAccept's
	// result) and, for dccSend, Line. xdccAccept/xdccClose reuse DCCID the
	// same way (ids are just distinguished by their "dcc:"/"xdcc:" prefix);
	// xdccAccept also reuses ServerID/Host/Port/Nick (an XDCCSendOfferEvent's
	// own IP/Port/Nick) plus Filename/Size/Token from that same event and
	// DestDir for where to save it.
	DCCID    string `json:"dccId,omitempty"`
	Filename string `json:"filename,omitempty"`
	Size     int64  `json:"size,omitempty"`
	Token    string `json:"token,omitempty"`
	DestDir  string `json:"destDir,omitempty"`
}

// ServerFrame is one line the backend sends back.
type ServerFrame struct {
	ID       string          `json:"id,omitempty"` // present only on "result"
	Type     string          `json:"type"`
	ServerID string          `json:"serverId,omitempty"`
	Line     string          `json:"line,omitempty"`
	Event    any             `json:"event,omitempty"`
	Status   string          `json:"status,omitempty"`
	Channels []string        `json:"channels,omitempty"`
	Messages []history.Entry `json:"messages,omitempty"`
	DCCID    string          `json:"dccId,omitempty"` // dccOffer/dccAccept's result
	OK       bool            `json:"ok,omitempty"`
	Error    string          `json:"error,omitempty"`
}
