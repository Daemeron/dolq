# IRC connection

`dolqd` holds the connection to each IRC server. The app only asks for it and listens. This page follows one server
from "connect" to "gone", and what happens when the network under it breaks.

## Connecting

```mermaid
sequenceDiagram
    autonumber
    actor U as You
    participant W as Window
    participant M as Main process
    participant K as OS keychain
    participant B as BackendClient
    participant D as dolqd (bouncer)
    participant C as ircclient
    participant I as IRC server

    U->>W: add a server and connect
    W->>M: irc:connect (serverId, host, port, nick, secure, …)
    M->>K: look up remembered password and SASL login for this server
    Note over M: saved credentials are filled in here,<br/>so they never travel through the window
    M->>B: connect(…)
    B->>D: {"action":"connect", …} (see the wire protocol)
    D->>D: end any earlier connection for this serverId
    Note over D: log: irc host:port: connecting as NICK
    D->>C: Dial(host, port, nick, secure)
    C->>I: TCP connect (15 s limit, TLS included)
    opt secure
        C->>I: TLS handshake, certificate checked against the host name
    end
    D-->>B: result ok
    C->>I: CAP LS 302
    C->>I: PASS password (or "none")
    C->>I: NICK nick
    C->>I: USER username 0 * :realname
    I-->>C: CAP … LS :list of capabilities
    C->>I: CAP REQ :multi-prefix away-notify server-time account-tag<br/>(only the ones offered)
    I-->>C: CAP … ACK
    opt SASL login given and offered
        C->>I: CAP REQ :sasl
        I-->>C: CAP … ACK
        C->>I: AUTHENTICATE PLAIN
        I-->>C: AUTHENTICATE +
        C->>I: AUTHENTICATE base64(user NUL user NUL password)
        I-->>C: 903 (success)
    end
    C->>I: CAP END
    I-->>C: 001 Welcome
    Note over D: log: irc host:port: registered as NICK
    D-->>B: event WELCOME, status connected
    B-->>W: pushed to the window
```

### Notes

1. **Credentials.** A password the user chose to remember is stored in the OS keychain and added by the main process.
   The window never holds it after saving.
2. **The result comes early.** `connect` answers once the TCP and TLS connection is up. Registration (001) arrives
   later as a pushed event, because a server can take its time (some wait for ident or DNS).
3. **Capabilities.** Dolq asks for `multi-prefix`, `away-notify`, `server-time` and `account-tag`, and only the ones
   the server offered. If the server never answers `CAP LS` within 10 seconds, it goes on without any (log: `CAP: timed
   out waiting for the server's capability list`). A slow server such as one that makes you wait for DNS shows up
   this way.
4. **SASL is optional.** If login fails the connection continues without it (logged), because a working connection
   with a different nick is better than none.
5. **Nick in use.** While not yet registered, the client tries the alternative nicks from the server's settings in
   order, then your nick with underscores added (`nick_`, `nick__`), at least five times, before giving up.
6. **TLS certificates.** A secure IRC connection uses normal certificate checking against the server's name. It is
   not pinned, unlike the link to a remote backend.

## Staying connected

```mermaid
sequenceDiagram
    autonumber
    participant C as ircclient
    participant I as IRC server
    participant B as BackendClient (every attached client)

    loop whenever the server sends one
        I-->>C: PING :token
        C->>I: PONG :token
        Note over C: not shown in the log, not stored
    end

    loop every 30 s (first after 5 s), once registered
        C->>I: PING :dolq-TIMESTAMP
        I-->>C: PONG :dolq-TIMESTAMP
        C-->>B: event LATENCY, ms
        Note over B: used for the connection's latency, not stored in history
    end

    loop every 30 s
        C->>C: nothing received for 5 minutes?
        opt yes
            C->>I: close the connection
            Note over C: counts as a drop, see below
        end
    end
```

Anything the server sends resets the five minute inactivity clock. Lines going out are paced (a burst of 4, then one
every 2 s), including the ones you type, so joining many channels or pasting a lot of text does not get you kicked for
flooding. Only the handshake and the replies to the server's pings skip the pacing.

## When the connection drops

```mermaid
sequenceDiagram
    autonumber
    participant I as IRC server
    participant C as ircclient
    participant D as dolqd (bouncer)
    participant B as attached clients

    I--xC: connection closes (or the inactivity timeout)
    C->>D: OnClose
    alt you asked for it (disconnect), or there is nothing to redial
        Note over D: log: irc host:port: disconnected
        D-->>B: status disconnected, log line "*** Disconnected"
    else it dropped
        Note over D: log: connection lost, reconnecting
        D-->>B: status connecting, "*** Connection lost - reconnecting..."
        loop 2 s, 4 s, 8 s … at most 60 s apart
            D->>I: Dial again
            alt connected
                Note over D: install the new client, log: reconnected
            else failed
                Note over D: log: reconnect failed, wait longer
            end
        end
        I-->>C: 001 Welcome
        D->>I: JOIN each channel that was joined (paced)
        D-->>B: status connected, "*** Reconnected"
    end
```

The channels to rejoin are the ones joined when the connection broke. A connection that dropped before its welcome
keeps the list from before it, so a flapping connection does not forget where you were.

## Leaving on purpose

```mermaid
sequenceDiagram
    participant W as Window
    participant D as dolqd
    participant I as IRC server

    W->>D: disconnect serverId
    D->>D: mark the session as closing (so it is not redialled)
    loop each joined channel
        D->>I: PART channel
    end
    D->>I: QUIT
    D-->>W: status disconnected
```

When `dolqd` itself shuts down it does this for every session first, so other users see you leave cleanly.

## Failure cases

| What happens | What the log (and window) show |
|---|---|
| The server refuses or does not answer | `irc host:port: could not connect: …`, the connect fails |
| The server drops you | `connection lost, reconnecting`, then `reconnected` |
| The server is silent for 5 minutes | the same |
| Slow or missing capability list | `CAP: timed out waiting for …`, registration continues |
| SASL failed | `SASL: authentication failed (…) - continuing without it` |
| Nick taken | an alternative nick, shown in the registered line |

## Code

- `backend/internal/bouncer/bouncer.go`: `Connect`, `wire`, `handleClose`, `reconnect`, `Disconnect`
- `backend/internal/ircclient/client.go`: `Dial`, `handshake`, `negotiateCaps`, `negotiateSASL`,
  `watchPingTimeout`, `measureLatency`
- `src/main/index.ts`: the `irc:connect` handler and `withSavedSecrets`
