# Wire protocol

The app (through its main process) and `dolqd` exchange **newline-delimited JSON**: one JSON object per line, in
both directions. The same protocol runs over the local socket and over the remote TLS connection.

## Shape of a conversation

```mermaid
sequenceDiagram
    autonumber
    participant B as BackendClient (app)
    participant S as ipcproto Server (dolqd)
    participant Bo as bouncer

    B->>S: {"id":"1","action":"auth","authToken":"…"}
    S-->>B: {"id":"1","type":"result","ok":true}

    Note over B,S: a request carries an id, and its result carries the same id
    B->>S: {"id":"2","action":"getStatus","serverId":"s1"}
    S->>Bo: Attach(this client, s1), Status(s1)
    S-->>B: {"id":"2","type":"result","ok":true,"status":"connected"}

    Note over B,S: frames without an id are pushed by the backend whenever something happens
    Bo-->>S: a line arrived on s1
    S-->>B: {"type":"line","serverId":"s1","line":":nick!u@h PRIVMSG …"}
    Bo-->>S: a parsed event
    S-->>B: {"type":"event","serverId":"s1","event":{"type":"JOIN",…}}
    Bo-->>S: the session changed state
    S-->>B: {"type":"status","serverId":"s1","status":"connecting"}
```

- **Request frames** (client to backend) have an `action`, an `id` the client makes up (a UUID), and the fields that
  action needs. Unused fields are left out.
- **Result frames** (backend to client) have `"type":"result"`, the same `id`, `ok`, and either an `error` or the
  answer (`status`, `channels`, `messages`, `transfers`, `dccId`).
- **Pushed frames** (backend to client) have no `id`: `line` (a raw IRC line), `event` (a parsed one) and `status`
  (`connected`, `connecting`, `disconnected`). They carry the `serverId` they belong to, so one subscription per
  frame type covers every server. For a file transfer or a DCC chat, `serverId` holds the transfer's id (`xdcc:…`,
  `dcc:…`).
- A frame that is not valid JSON gets an error result and the connection carries on.

## Actions

| Action | Fields it uses | Answer | What it does |
|---|---|---|---|
| `auth` | `authToken` | `ok` | Must be the first frame when the backend asks for a token. Anything else first, or a wrong token, closes the connection |
| `connect` | `serverId`, `host`, `port`, `nick`, `secure`, `saslUser`, `saslPass`, `username`, `realname`, `altNicks`, `password` | `ok` | Opens an IRC connection (closing a previous one for that `serverId`). See [IRC connection](irc-connection.md) |
| `disconnect` | `serverId` | `ok` | Quits that IRC connection for good |
| `send` | `serverId`, `line` | `ok` | Sends one raw IRC line. Strictly in order per server |
| `getStatus` | `serverId` | `status` | Says how a session is doing, **and attaches this client to it** so it receives its pushed frames |
| `getJoinedChannels` | `serverId` | `channels` | Channels the session is in. An unknown `serverId` gives an empty list |
| `getHistory` | `serverId`, `channel`, `before`, `limit` | `messages` | A page of stored lines and events, newest first |
| `search` | `serverId`, `channel`, `query`, `limit` | `messages` | Full-text search in the history |
| `dccOffer` | `serverId`, `nick`, `portMin`, `portMax` | `dccId` | Offers a DCC chat: listens, tells the peer where |
| `dccAccept` | `host`, `port` | `dccId` | Joins a chat the peer offered |
| `dccSend` | `dccId`, `line` | `ok` | Sends one chat line |
| `dccClose` | `dccId` | `ok` | Ends a chat |
| `dccSendFile` | `serverId`, `nick`, `path`, `portMin`, `portMax` | `dccId` | Offers a file on the backend's disk to a peer |
| `xdccAccept` | `serverId`, `nick`, `host`, `port`, `filename`, `size`, `token`, `destDir`, `portMin`, `portMax` | `dccId` | Takes a file a bot offered. See [File transfers](file-transfers.md) |
| `xdccClose` | `dccId` | `ok` | Cancels a transfer |
| `xdccPause`, `xdccResume` | `dccId` | `ok` | Pauses and resumes a download |
| `getInfo` | none | `info` | The backend describes itself (below). The app sends it every 20 s as its heartbeat. A backend from before it existed answers `ok: false` with `unknown action: getInfo`, which still proves it is alive |
| `getTransfers` | none | `transfers` | Transfers that ended, kept across restarts |
| `deleteTransfer` | `dccId` (empty for all) | `ok` | Forgets one saved transfer, or all |

## What `getInfo` answers

```json
{"id":"7","type":"result","ok":true,"info":{
  "version":"0.15.0",
  "uptimeMs":273600000,
  "clients":1,
  "sessions":3,
  "transfers":1,
  "folders":[
    {"name":"data","path":"/data","free":3700000000000,"total":6500000000000},
    {"name":"downloads","path":"/downloads","free":3700000000000,"total":6500000000000}
  ]}}
```

| Field | Meaning |
|---|---|
| `version` | The release this `dolqd` was built from (`dev` for a build from source) |
| `uptimeMs` | How long the process has been running. A length of time, not a start time, so a client with a different clock still shows it right |
| `clients` | Authenticated apps attached now, including the one asking |
| `sessions` | IRC connections held, including ones being redialled |
| `transfers` | Open file transfers and direct chats |
| `folders` | The folders it writes to, with free and total bytes. A folder whose size cannot be read has an `error` instead |

The free space is read in a background goroutine and kept for up to 30 seconds. Only the first ever `getInfo` waits for
a reading, for at most a second. A folder that does not answer (a stalled network share) leaves the `folders` list without
it, and never delays the answer.

## Ordering and concurrency

```mermaid
sequenceDiagram
    autonumber
    participant B as BackendClient
    participant S as ipcproto Server
    participant L1 as lane for server s1
    participant Bo as bouncer

    B->>S: send s1 "PRIVMSG a :one"
    S->>L1: queue (a lane per serverId)
    B->>S: send s1 "PRIVMSG a :two"
    S->>L1: queue
    B->>S: getHistory (any other action)
    Note over S: runs at once in its own goroutine
    L1->>Bo: send "one"
    L1->>Bo: send "two"
    S-->>B: getHistory result (may arrive before the sends finish)
```

- `send` frames for one server go through one queue (capacity 256), so what you typed first is sent first, even though
  the server handles different requests concurrently.
- Every other action runs on its own, so a slow history query never holds up typing.
- Results can arrive in any order. That is why they carry the request's `id`.

## Several clients, one backend

```mermaid
sequenceDiagram
    autonumber
    participant A as client A (laptop)
    participant B as client B (second window or machine)
    participant S as dolqd
    participant I as IRC server

    A->>S: connect s1
    S->>I: open the IRC connection
    B->>S: getStatus s1
    Note over S: B is attached to s1 too
    I-->>S: a message
    S-->>A: line and event frames
    S-->>B: the same frames
    A->>S: send s1 "PRIVMSG …"
    S->>I: the line
    Note over S: if a client stops reading,<br/>it is hung up on after 10 s so the others are not held up
    A--xS: A disconnects
    Note over S: A is detached. The IRC session goes on, B still receives
```

A client receives pushed frames only for sessions it has attached to, which happens when it asks `getStatus` for them
(after it connects, or reconnects). `connect` attaches the client that made it.

## Security of the frames

- Over the local socket the connection is private to the user; over TCP it is inside TLS. Frames are never sent in the
  clear except in the explicitly agreed `-tls=false` setups.
- A remote backend pins where downloads go: the `destDir` an app sends in `xdccAccept` is ignored and `dolqd` saves
  to its own configured folder, so a client of a network backend cannot choose a path on the server.
- The token is compared in constant time, and a wrong one costs the guesser 300 ms.

## Code

- `backend/internal/ipcproto/frame.go`: all action and frame definitions
- `backend/internal/ipcproto/server.go`: reading, the per-server lanes, `handleFrame`
- `src/main/irc/BackendClient.ts`: `request`, `handleFrame`, the typed methods
- `src/shared/ipc.ts`: the app's own IPC names (window to main), which are separate from these frames
