# Messages and history

How a line you type reaches the server, how what the server says reaches your screen, and how it ends up stored so a
window opened later (or a second client) can show it.

## Sending a message

```mermaid
sequenceDiagram
    autonumber
    actor U as You
    participant W as Window
    participant M as Main process
    participant B as BackendClient
    participant S as dolqd (ipcproto)
    participant Bo as bouncer
    participant C as ircclient
    participant H as history store
    participant I as IRC server

    U->>W: type text, press Enter
    W->>W: slash commands and aliases become a raw IRC line
    W->>M: irc:send (serverId, "PRIVMSG #chan :text")
    M->>B: send(serverId, line)
    B->>S: {"action":"send","serverId":"s1","line":"…"}
    Note over S: queued in the lane for s1, so lines stay in order
    S->>Bo: Send(s1, line)
    Bo->>C: SendPaced (burst of 4, then one every 2 s)
    C->>I: PRIVMSG #chan :text
    Note over Bo: a server does not echo your own message back,<br/>so it is stored here
    Bo->>H: AppendEvent(PRIVMSG from you)
    S-->>B: result ok
    B-->>W: resolved
```

### Notes

1. **What is kept out of history.** A message to a services account (a nick ending in `serv`, or a user@host) that
   starts with `identify`, `login`, `auth`, `register`, `group`, `ghost`, `release` or `recover` is sent but never
   stored, because it holds a password in plain text.
2. **Only chat is stored on the way out.** Lines that are not a chat message (JOIN, MODE, PING, …) are sent and not
   recorded; what the server says about them comes back as events.
3. **Order.** Because `send` frames for one server share a queue, what you type first goes out first even when the
   backend is busy with other requests.

## Receiving

```mermaid
sequenceDiagram
    autonumber
    participant I as IRC server
    participant C as ircclient
    participant Bo as bouncer
    participant H as history store
    participant S as ipcproto (every attached client)
    participant W as Window

    I-->>C: :nick!u@h PRIVMSG #chan :hello
    C->>C: strip IRCv3 tags, answer PING, ignore our own latency PONG
    C->>Bo: line listener (the raw line)
    alt a channel or query already shows it through its event
        Note over Bo: not stored in the log
    else a server-level line (MOTD, notices, numerics)
        Bo->>H: AppendLine(server, log, line)
    end
    Bo->>S: pushed line frame
    S-->>W: line, shown in the server log

    C->>C: ParseLine, turn the line into an event
    C->>Bo: event listener (PRIVMSG, JOIN, PART, NICK, TOPIC, MODE …)
    alt a transient event (member list, latency)
        Note over Bo: not stored
    else
        Bo->>H: AppendEvent(server, channel, event)
        opt QUIT or NICK (no channel of its own)
            Bo->>H: AppendEvent once for each channel the user was in
        end
    end
    Bo->>S: pushed event frame
    S-->>W: event, shown in the channel
```

### Notes

1. **Two views of the same traffic.** The raw line feeds the server log; the parsed event feeds channels and private
   chats. That is why WHOIS replies can be hidden from the log view while still being stored.
2. **Stored once, shown everywhere.** Storage happens in `dolqd` before anything is sent to a client, so a client that
   is attached, one that attaches later, and one that never existed all read the same history.
3. **Writing is queued.** Appends go into a queue and are written to SQLite in batches by one goroutine, so a slow
   disk never stalls an IRC session. If the disk cannot be written (full, read-only), the failures are counted and
   reported in the log at most every so often, and the batch is dropped rather than retried forever.

## Loading history and searching

```mermaid
sequenceDiagram
    autonumber
    participant W as Window
    participant M as Main process
    participant B as BackendClient
    participant S as dolqd
    participant H as history store

    W->>M: irc:getHistory (server, channel, before, limit)
    M->>B: getHistory(…)
    B->>S: {"action":"getHistory","serverId":"s1","channel":"#chan","before":12345,"limit":100}
    S->>H: Recent(server, channel, before, limit)
    H-->>S: entries, newest first
    S-->>B: result with messages
    B-->>W: entries, merged into the view (mergeHistory)
    Note over W: scrolling to the top asks for the next page with a smaller "before"

    W->>M: irc:search (server, channel, query)
    M->>B: search(…)
    B->>S: {"action":"search", … ,"query":"text"}
    S->>H: Search (LIKE, special characters escaped)
    H-->>W: matching entries
```

History is per server and per channel (a private chat is a channel named after the other person). A server's raw lines
live in a channel of their own, the log.

## Catching up after a gap

When the app was not attached (closed, asleep, or its link to the backend dropped), `dolqd` kept the IRC sessions
going and stored everything. Attaching again is therefore a read, not a replay:

```mermaid
sequenceDiagram
    autonumber
    participant W as Window
    participant M as Main process
    participant S as dolqd
    participant H as history store

    Note over W,S: the link is back, or the app has just opened
    loop for each server in the app
        W->>M: getStatus(server)
        M->>S: getStatus
        S-->>M: the session's state, and this client is attached again
    end
    loop for each open channel
        W->>M: getJoinedChannels, getHistory
        M->>S: …
        S->>H: Recent
        H-->>W: what arrived while away
    end
    Note over W: reloading happens only once every server is attached again,<br/>so no line falls between the history read and the live feed
```

## Retention

`dolqd -retention-days N` (Preferences on a local backend, the compose file or command line for a remote one) removes
history older than N days; 0 keeps it forever. Pruning runs in the background. A local backend reads this setting
when it starts, so changing it needs a restart of the app; a remote backend reads its own.

## Code

- `backend/internal/bouncer/bouncer.go`: `Send`, `wire`, `channelScopedLine`, `outgoingEvent`
- `backend/internal/history/history.go`: the store: queue, batches, `Recent`, `Search`, pruning
- `src/renderer/src/App.tsx`: the event switch, `reconcile`, history paging
- `src/renderer/src/utils/mergeHistory.ts`, `whoisFilter.ts`, `logLine.ts`
