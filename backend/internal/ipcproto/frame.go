package ipcproto

import "github.com/Daemeron/dolq/backend/internal/history"

const (
	ActionConnect           = "connect"
	ActionDisconnect        = "disconnect"
	ActionSend              = "send"
	ActionGetStatus         = "getStatus"
	ActionGetJoinedChannels = "getJoinedChannels"
	ActionGetHistory        = "getHistory"
	ActionSearch            = "search"
	ActionDCCOffer          = "dccOffer"
	ActionDCCAccept         = "dccAccept"
	ActionDCCSend           = "dccSend"
	ActionDCCClose          = "dccClose"
	ActionXDCCAccept        = "xdccAccept"
	ActionXDCCClose         = "xdccClose"
	ActionXDCCPause         = "xdccPause"
	ActionXDCCResume        = "xdccResume"
)

const (
	FrameResult = "result"
	FrameLine   = "line"
	FrameEvent  = "event"
	FrameStatus = "status"
)

type ClientFrame struct {
	ID       string   `json:"id,omitempty"`
	Action   string   `json:"action"`
	ServerID string   `json:"serverId,omitempty"`
	Host     string   `json:"host,omitempty"`
	Port     int      `json:"port,omitempty"`
	Nick     string   `json:"nick,omitempty"`
	Secure   bool     `json:"secure,omitempty"`
	SASLUser string   `json:"saslUser,omitempty"`
	SASLPass string   `json:"saslPass,omitempty"`
	Username string   `json:"username,omitempty"`
	Realname string   `json:"realname,omitempty"`
	AltNicks []string `json:"altNicks,omitempty"`
	Line     string   `json:"line,omitempty"`
	Channel  string   `json:"channel,omitempty"`
	Before   int64    `json:"before,omitempty"`
	Limit    int      `json:"limit,omitempty"`
	Query    string   `json:"query,omitempty"`
	DCCID    string   `json:"dccId,omitempty"`
	Filename string   `json:"filename,omitempty"`
	Size     int64    `json:"size,omitempty"`
	Token    string   `json:"token,omitempty"`
	DestDir  string   `json:"destDir,omitempty"`
	PortMin  int      `json:"portMin,omitempty"`
	PortMax  int      `json:"portMax,omitempty"`
}

type ServerFrame struct {
	ID       string          `json:"id,omitempty"`
	Type     string          `json:"type"`
	ServerID string          `json:"serverId,omitempty"`
	Line     string          `json:"line,omitempty"`
	Event    any             `json:"event,omitempty"`
	Status   string          `json:"status,omitempty"`
	Channels []string        `json:"channels,omitempty"`
	Messages []history.Entry `json:"messages,omitempty"`
	DCCID    string          `json:"dccId,omitempty"`
	OK       bool            `json:"ok,omitempty"`
	Error    string          `json:"error,omitempty"`
}
