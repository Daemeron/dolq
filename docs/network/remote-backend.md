# Remote backend

A `dolqd` that runs on another machine (a NAS, a server, a container) keeps your IRC sessions and history alive while
the app is closed. The app attaches to it over TLS. This page covers pairing, how the connection is secured, how the
app keeps it alive, and how it switches between backends while running.

How `dolqd` itself is deployed (Docker, ports, the pairing link) is in [Container and pairing](container-and-pairing.md).

## The states

The app always knows how the link is doing, and says so in the button at the bottom of the server list.

```mermaid
stateDiagram-v2
    [*] --> connecting: app starts, or Preferences saved
    connecting --> connected: signed in
    connecting --> reconnecting: nothing answers yet
    connecting --> failed: certificate changed, token refused, user said no

    connected --> reconnecting: link closed, or no answer to a heartbeat
    reconnecting --> connected: back, signed in again
    reconnecting --> failed: certificate changed, token refused

    failed --> connecting: Reconnect, or a new link saved
    reconnecting --> connecting: Reconnect, or a new link saved
    connected --> connecting: Reconnect, or switched to another backend
```

| State | Meaning | Does the app keep trying? |
|---|---|---|
| `connecting` | Dialling for the first time, or starting over | yes |
| `connected` | Signed in. The heartbeat runs | not needed |
| `reconnecting` | The backend cannot be reached or the link dropped. The panel says why and when the next try is | yes, forever, with growing waits |
| `failed` | Something retrying cannot fix: a changed certificate or a refused token | no, until you act |

## Setting it up once

```mermaid
sequenceDiagram
    autonumber
    actor U as You
    participant D as dolqd (on the NAS)
    participant W as Window (Preferences)
    participant M as Main process
    participant K as OS keychain
    participant B as BackendClient

    Note over D: first start with a fresh data folder
    D->>D: make an access token and a self-signed certificate
    D-->>U: log: dolq://host:6789?fp=CERT-FINGERPRINT&token=TOKEN
    U->>W: switch on "remote backend", paste the link
    W->>W: parsePairingLink: address, token, fingerprint, TLS flag
    W-->>U: "Paired with host:6789. Save to connect."
    U->>W: Save
    W->>M: setSettings (IPC)
    M->>K: store the token
    M->>M: keep the fingerprint as the pin
    M->>M: resolve the new target, compare with the old one (sameTarget)
    alt the target changed
        M->>B: retarget(new target)
        Note over B: no restart needed
    else nothing about the connection changed
        Note over M: the live connection is left alone
    end
```

### Notes

1. **The link carries everything.** Address, access token and the certificate's fingerprint travel together, out of
   band, in one paste. Because the fingerprint arrives with the token, there is nothing to confirm on first connect.
2. **The token never reaches the window.** After pasting, the window sends it once to the main process, which keeps it
   in the OS keychain (or an owner-only file where there is none). The window only learns whether one is saved.
3. **A pin belongs to one address.** Saving a different address without a new link drops the old fingerprint and
   token, so a secret cannot follow you to another host.
4. **Validation.** A link without a token, with a bad port, or with a malformed fingerprint is refused in the window
   ("That is not a valid Dolq pairing link") and never saved. A fingerprint that could not match would only fail
   later, confusingly.

## Connecting: certificate pinning, then sign-in

```mermaid
sequenceDiagram
    autonumber
    participant B as BackendClient
    participant D as dolqd
    participant U as You (dialog)

    Note over B: state "connecting": Connecting to host:6789
    opt not TLS, or no token
        B->>U: "This backend is not fully secured. Connect anyway?"
        U-->>B: yes or no (no ends the attempt)
    end
    B->>D: TCP connect to host:6789
    B->>D: TLS ClientHello
    D-->>B: TLS ServerHello, certificate
    Note over B: Node is told not to judge the certificate.<br/>The app decides (decideTrust).
    B->>B: fingerprint of the certificate it was shown

    alt a pin is saved
        alt fingerprint equals the pin
            Note over B: trusted
        else fingerprint differs
            B--xD: hang up
            Note over B: state "failed": the certificate changed.<br/>Paste the pairing link to trust the new one.
        end
    else no pin, and a public CA signed it (Let's Encrypt)
        Note over B: trusted, so it can renew freely
    else no pin, self-signed
        B->>U: "Trust the backend at host?" with the fingerprint
        U-->>B: yes (the fingerprint is saved as the pin) or no (failed)
    end

    B->>D: {"id":"…","action":"auth","authToken":"TOKEN"}
    alt token correct
        D-->>B: {"type":"result","ok":true}
        Note over B: state "connected": Connected to host:6789
        B->>B: start the heartbeat
    else token wrong or missing
        D->>D: wait 300 ms (slows guessing)
        D-->>B: {"type":"result","ok":false,"error":"unauthorized"}
        D--xB: close
        Note over B: state "failed": The backend refused the access token
    end
```

### Notes

1. **Why the app judges the certificate itself.** A pinned fingerprint must match even if a public CA signed the
   certificate. Otherwise anyone who could get a trusted certificate for that name could stand in for a self-signed
   backend you paired with. Without a pin, a public CA's certificate is accepted as it is, and a self-signed one is
   shown to you once.
2. **Not fully secured.** `dolqd` can be run with `-tls=false` and/or `-token=false` for a tunnel or a proxy you
   trust. The app agrees to talk like that only after you say yes, and loopback addresses never ask.
3. **Timeouts on the server.** A connection that stays silent for 10 seconds is dropped (see
   [How `dolqd` takes a connection](#how-dolqd-takes-a-connection)). The auth frame must arrive within 10 seconds.

## Keeping the link alive

TCP keepalive is on (30 s), but an operating system can take minutes to notice a dead link after a sleep, a NAT
timeout or a NAS reboot. So the app checks for itself.

```mermaid
sequenceDiagram
    autonumber
    participant B as BackendClient
    participant D as dolqd

    loop every 20 seconds while connected
        B->>D: getJoinedChannels for a server that does not exist<br/>(cheap, no side effects)
        alt answered within 10 seconds
            D-->>B: result (any answer proves the link is alive)
        else no answer in 10 seconds
            Note over B: log: The backend stopped answering. Reconnecting…
            B->>B: destroy the socket
            Note over B: continues as "the link dropped", below
        end
    end
```

## When the link drops

```mermaid
sequenceDiagram
    autonumber
    participant W as Window
    participant M as Main process
    participant B as BackendClient
    participant D as dolqd

    D--xB: socket closes (restart, sleep, network, or a missed heartbeat)
    B->>B: reject every request still waiting
    B-->>M: servers are now "connecting"
    M-->>W: status for each server, and the new state
    Note over B: state "reconnecting": Lost the connection to host:6789

    loop 1 s, 2 s, 4 s, 8 s, 16 s, then every 30 s
        B->>B: wait
        B->>D: connect, check the pin, sign in
        alt reached and signed in
            D-->>B: ok
        else cannot be reached
            Note over B: state "reconnecting": host:6789 refused the connection.<br/>Is the backend running? Trying again in 4s.
        else certificate changed or token refused
            Note over B: state "failed", the loop stops
        end
    end

    Note over B: state "connected"
    B-->>M: reconnected
    M-->>W: backendReconnected
    W->>M: getStatus for every server (re-attach)
    M->>D: getStatus
    D-->>M: status, and the session starts feeding this client again
    W->>M: getHistory (catch up on what arrived meanwhile)
    M->>D: getHistory
    D-->>W: the missed lines and events
```

### Notes

1. **IRC does not notice.** The IRC sessions live in `dolqd`, which keeps running. While the app was away it kept
   the sessions up, kept answering IRC pings and stored everything. That is why catching up is only a history read.
2. **A failed state is not a loop.** A changed certificate or a refused token is something retrying cannot fix, so the
   app stops, says what it is, and waits for you (Reconnect, or a new link).
3. **Error wording.** Network errors are turned into sentences with a next step: `ECONNREFUSED` says nothing is
   listening, `ETIMEDOUT` suggests a firewall or a machine that is off, `EHOSTUNREACH` also mentions the Mac's Local
   Network permission, `ENOTFOUND` suggests using the IP address.

## Switching backends while running

Saving Preferences, or pressing Reconnect, changes what the app is connected to with no restart. The same routine
serves both, and also switches between local and remote.

```mermaid
sequenceDiagram
    autonumber
    participant W as Window
    participant M as Main process
    participant B as BackendClient
    participant Old as old backend
    participant New as new backend

    W->>M: setSettings (remote on, off, or a new link)
    M->>B: retarget(target, or nothing for local)
    B->>B: new generation number, stop the heartbeat
    B->>Old: destroy the socket (a local child is stopped)
    B->>B: reject every request still waiting
    B-->>W: servers shown as "connecting"
    Note over B: state "connecting"
    B->>New: connect and sign in (or spawn the local dolqd)
    New-->>B: ok
    Note over B: state "connected"
    B-->>W: reconnected, so the window re-attaches every server and reloads history
```

A dial that was still under way for the old target notices the generation changed after it signs in and drops its
socket, so a slow old connection can never take over from the new one.

## How `dolqd` takes a connection

```mermaid
sequenceDiagram
    autonumber
    participant C as client
    participant L as listener (sniffing)
    participant S as ipcproto Server
    participant Bo as bouncer

    C->>L: TCP connect
    L->>L: wait for the first byte (at most 10 s, then drop)
    alt first byte is 0x16, a TLS handshake
        L->>C: TLS handshake with the certificate
    else anything else, and -allow-legacy-plain is on
        Note over L: treated as an old plain client, no token asked
    else anything else
        L--xC: drop
    end
    L->>S: connection
    Note over S: log: client ADDRESS: connected
    S->>C: wait up to 10 s for the auth frame
    alt token matches (constant-time compare)
        S-->>C: result ok
        Note over S: log: authenticated
        loop frames
            C->>S: action frame
            S->>Bo: do it
            Bo-->>C: result, plus pushed line, event and status frames
        end
    else no frame, or wrong token
        Note over S: log: rejected (or closed without authenticating)
        S--xC: close
    end
    Note over S: log: client ADDRESS: disconnected
    S->>Bo: Detach(client)
```

- A probe or port scan that sends nothing is told apart in the log from a client with the wrong token.
- A client that stops reading is hung up on after a 10 second write timeout, because one stuck client must not stall
  an IRC session shared by others.
- When a client detaches, the IRC sessions stay up.

## Failure cases

| Cause | What the panel says | What to do |
|---|---|---|
| Wrong address or backend down | `host:port refused the connection: nothing is listening there…` | Start the backend, check the port. Retries on its own |
| Firewall or machine off | `host:port did not answer…` | Retries on its own |
| No route (a Mac without Local Network permission) | `There is no route to host:port… Local Network` | Allow Dolq in Privacy and Security, Local Network |
| Name does not resolve | `The name in host:port could not be found…` | Use the IP address |
| The backend was re-created with a new certificate | `The remote backend's certificate changed (now …)` | Paste its new pairing link |
| Token changed | `The backend refused the access token` | Paste its new pairing link |
| The link was silent for 10 s after a heartbeat | log: `The backend stopped answering. Reconnecting…` | Retries on its own |

## Code

- `src/main/irc/BackendClient.ts`: `begin`, `connectRemote`, `dialTls`, `attach`, `lost`, `ping`, `retarget`
- `src/main/remoteBackend.ts`: `decideTrust`, `insecureReasons`, `sameTarget`, `describeDialError`
- `src/main/irc/redial.ts`: the waits
- `src/shared/pairing.ts`: `parsePairingLink`
- `backend/internal/ipcproto/sniff.go`, `server.go`, `tls.go`: the listener, sign-in, the certificate
