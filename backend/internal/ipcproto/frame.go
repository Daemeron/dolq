// Package ipcproto is the local IPC wire protocol between a frontend and
// this backend: newline-delimited JSON frames over a Unix domain socket.
package ipcproto

// Client -> server actions.
const (
	ActionConnect           = "connect"
	ActionDisconnect        = "disconnect"
	ActionSend              = "send"
	ActionGetStatus         = "getStatus"
	ActionGetJoinedChannels = "getJoinedChannels"
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
	ID       string `json:"id,omitempty"` // caller-chosen; echoed back on the result
	Action   string `json:"action"`
	ServerID string `json:"serverId,omitempty"`
	Host     string `json:"host,omitempty"`
	Port     int    `json:"port,omitempty"`
	Nick     string `json:"nick,omitempty"`
	Secure   bool   `json:"secure,omitempty"`
	Line     string `json:"line,omitempty"`
}

// ServerFrame is one line the backend sends back.
type ServerFrame struct {
	ID       string   `json:"id,omitempty"` // present only on "result"
	Type     string   `json:"type"`
	ServerID string   `json:"serverId,omitempty"`
	Line     string   `json:"line,omitempty"`
	Event    any      `json:"event,omitempty"`
	Status   string   `json:"status,omitempty"`
	Channels []string `json:"channels,omitempty"`
	OK       bool     `json:"ok,omitempty"`
	Error    string   `json:"error,omitempty"`
}
