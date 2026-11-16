# File transfers

Files and direct chats do not go through the IRC server. IRC is only used to **arrange** them (a CTCP message saying
"connect to this address and port"); the data then flows over a direct TCP connection between `dolqd` and the other
user. `dolqd` makes those connections, not the app, so on a remote backend a download lands on the backend's disk.

## Receiving a file (XDCC)

XDCC is how bots offer files: you ask the bot for a numbered pack, and it offers the file with DCC SEND.

```mermaid
sequenceDiagram
    autonumber
    actor U as You
    participant W as Window
    participant D as dolqd
    participant I as IRC server
    participant P as bot (the peer)
    participant F as disk of dolqd

    U->>W: request a pack (xdcc send, or a click in the packlist)
    W->>D: send "PRIVMSG bot :xdcc send #12"
    D->>I: the message
    I-->>P: delivered
    P->>I: PRIVMSG you :DCC SEND name ip port size
    I-->>D: the offer
    D->>D: parse it into an XDCCSENDOFFER event
    D-->>W: event with nick, filename, ip, port, size, token
    alt auto-accept is on and you requested this pack, or the sender is trusted
        W->>W: accept without asking
    else
        W-->>U: "bot wants to send you name (size)". Accept?
        U->>W: accept (optionally trust this sender)
    end
    W->>D: {"action":"xdccAccept", …}

    D->>F: is there room? (the file, less what a partial copy has, plus 100 MB to spare)
    alt not enough room
        D-->>W: error "Not enough free space…", nothing is opened
    end

    opt a partial copy of the same file exists
        D->>I: PRIVMSG bot :DCC RESUME name port position
        P-->>D: DCC ACCEPT name port position (waits up to 10 s)
        Note over D: carry on from that position, or start a new file
    end

    D->>F: create the file (never overwriting, never following a symlink)

    alt active offer, the bot gave a port
        D->>P: TCP connect to ip:port
    else passive offer, the port is 0 (the bot cannot be dialled)
        D->>D: listen on a port (any, or from your range)
        D->>I: PRIVMSG bot :DCC SEND name MY-IP MY-PORT size token
        P->>D: TCP connect (waits up to 3 minutes)
    end

    D-->>W: status connected
    loop until all bytes arrive
        P->>D: data
        D->>F: write
        D->>P: acknowledgement, bytes received so far
        D-->>W: XDCCTRANSFER received, total (at most every 250 ms)
    end
    D->>F: close the file
    D-->>W: XDCCTRANSFER done, path
    D->>D: store the outcome in the Transfers list and in the chat with bot
```

### When the bot queues the request

A busy bot answers a request with a place in its queue, and sends the offer minutes or hours later, when your turn comes.

```mermaid
sequenceDiagram
    autonumber
    actor U as You
    participant W as Window
    participant D as dolqd
    participant P as bot

    U->>W: request a pack
    W->>W: remember "one offer expected from this bot", with the time
    W->>D: send "PRIVMSG bot :xdcc send #12"
    D->>P: the message
    P-->>D: NOTICE: "queued at position 3"
    D-->>W: the notice, which is shown in your chat with the bot (and kept in the server log)
    Note over U,P: minutes or hours pass, the window may be in the background
    P->>D: DCC SEND offer
    D-->>W: XDCCSENDOFFER event
    alt answers a request of yours that is less than 24 hours old, and auto-accept is on
        W->>D: xdccAccept, with no prompt
        Note over D,P: the transfer goes on as above
    else auto-accept is off, or nothing was asked for
        W-->>U: a prompt, which has to be answered before the bot gives up (180 s for many bots)
    end
```

- **The bot's private notices** (queue position, "you already requested that pack", "you have a DCC pending") are shown in the
  chat opened with that bot, as well as in the server log. Only a chat that is already open gets them: asking for a pack opens one.
- **A request stays good for 24 hours**, counted from the last request to that bot. A batch counts one offer per pack. After
  a day an offer from that nick is no longer taken to be the answer to it, and asks.
- **Auto-accept for requested packs is on by default.** The preference can be switched off, and then every offer asks, which with a
  queue means a prompt at an arbitrary time. Offers nobody asked for always ask.
- **Not yet:** the decision is made in the app. If no app is attached when the offer arrives (closed, asleep), nothing accepts
  it and the bot gives up. Accepting in the backend, which stays on, is the next step.

### Notes

1. **Who connects.** An *active* offer is the usual one: the bot has a reachable address, `dolqd` connects out. A
   *passive* offer (port 0, often with a token) means the bot cannot be reached, so `dolqd` opens a listening port
   and tells the bot where, which needs that port reachable from the bot. See the ports section below.
2. **Room check.** A download that would leave less than 100 MB free on its disk is refused with a message that names
   the folder and its free space. On a NAS the system disk is small, and filling it takes the NAS's own services with
   it. If the free space cannot be told, the download goes ahead.
3. **Safe files.** The name from the bot is cleaned (no path parts). A new file never overwrites another and does not
   follow a link planted in the folder; resuming only continues a regular file in that folder.
4. **Where it goes.** A local backend saves where Preferences say. A remote backend ignores any folder the app sends
   and saves to the folder it was started with (`DOLQ_DOWNLOAD_DIR`, `/downloads` in the compose file).
5. **Done is remembered.** Finished and failed transfers are saved by the backend, so the Transfers list is there
   after a restart and on another client. Clearing them is `deleteTransfer`.

## Pause, resume, cancel

```mermaid
sequenceDiagram
    participant W as Window
    participant D as dolqd
    participant P as bot

    W->>D: xdccPause
    D->>D: close the pause gate: the receiving loop stops reading
    Note over D,P: TCP flow control makes the bot slow down, the connection stays open
    W->>D: xdccResume
    D->>D: open the gate, reading and acknowledging continue
    W->>D: xdccClose (cancel)
    D--xP: close the connection, or stop listening if the bot never connected
    D-->>W: status disconnected
    Note over D: a cancelled transfer is dismissed, not kept in the list
```

## Sending a file

```mermaid
sequenceDiagram
    autonumber
    actor U as You
    participant W as Window
    participant D as dolqd
    participant I as IRC server
    participant P as the other user

    U->>W: choose a file to send to a nick
    Note over W: the path is read by dolqd, so it must exist on the machine where dolqd runs
    W->>D: {"action":"dccSendFile","nick":"…","path":"…"}
    D->>D: listen on a port (any, or from your range)
    D->>I: PRIVMSG nick :DCC SEND name IP PORT size
    I-->>P: delivered
    P->>D: TCP connect (waits up to 3 minutes)
    loop until all bytes are written
        D->>P: data
        P-->>D: acknowledgements
        D-->>W: progress
    end
    Note over D: a write blocked for 2 minutes counts as the peer gone.<br/>Waits up to 30 s for the last acknowledgement, and some clients never send one.
    D-->>W: done
```

## Direct chat (DCC CHAT)

```mermaid
sequenceDiagram
    autonumber
    participant W as Window
    participant D as dolqd
    participant I as IRC server
    participant P as the other user

    alt you offer
        W->>D: dccOffer(server, nick)
        D->>D: listen on a port
        D->>I: PRIVMSG nick :DCC CHAT chat IP PORT
        P->>D: TCP connect (3 minutes to do so)
    else they offer
        P->>I: PRIVMSG you :DCC CHAT chat IP PORT
        I-->>D: parsed into a DCCCHATOFFER event
        D-->>W: the offer, you are asked
        W->>D: dccAccept(ip, port)
        D->>P: TCP connect
    end
    loop chat
        W->>D: dccSend(id, line)
        D->>P: line
        P-->>D: line
        D-->>W: pushed line frame for this chat's id
    end
    W->>D: dccClose
```

### How an address is written in a DCC message

| Form | Example | Meaning |
|---|---|---|
| A number | `3232235777` | an IPv4 address (192.168.1.1) written as one 32-bit integer, which is what the DCC convention says |
| Text with colons | `2001:db8::1` | an IPv6 address. IPv6 has no numeric form, so clients and bots write the address itself |
| Text with dots | `192.168.1.1` | an IPv4 address, accepted too |

`dolqd` reads all three. Anything else (a host name, an address with a zone such as `fe80::1%en0`, brackets) is dropped, and
the log says so (`ignored a DCC request from …`). The same goes for a subcommand it does not support, such as `SSEND` (a
TLS-encrypted send) and `TSEND`.

## Ports and networks

### IPv6

A sender offering from an IPv6 address works as an ordinary active offer: `dolqd` connects out to it. The machine `dolqd`
runs on needs IPv6 connectivity for that. A Docker bridge network has none by default, so the connection fails with
`network is unreachable` in the log. Host networking uses the NAS's own IPv6, if it has any.

What `dolqd` itself announces is still IPv4 only: the address in a passive offer, a DCC chat it offers, or a file it sends is
its IPv4 address. A peer that can only be reached over IPv6 cannot connect to those.

### Letting a peer connect in (passive offers, chats, files you send)

When the *other side* has to connect to `dolqd`, two things must be true:

1. **It is told an address it can reach.** By default `dolqd` announces its own address on the way to the internet: right on a plain LAN,
   wrong behind a router or in a container, where it is a private address nothing outside can reach. `DOLQ_DCC_HOST` (or
   `-dcc-host`) sets the address to announce: your public address, or a name that points at it (a dynamic DNS name is looked up
   at each announcement). IPv4 only.
2. **The connection can get in.** The listening port is chosen by `dolqd`, any free one by default, which cannot be forwarded.
   `DOLQ_DCC_PORTS` (or `-dcc-ports`) pins it to a range, such as `40000-40010`, or a single port. Forward the same range on the
   router to the machine, and with a Docker bridge network publish it too (the same numbers on both sides). The range set on the
   backend wins over the one in the app's Preferences, since the ports to open are the machine's to say.

```mermaid
flowchart LR
    Bot["bot on the internet"] -->|"connects to PUBLIC-ADDRESS:40003"| Router["router<br/>forwards 40000-40010<br/>to the NAS"]
    Router --> Docker["Docker<br/>publishes 40000-40010"]
    Docker --> D["dolqd listens on 40003<br/>(one port of the range)"]
    D -.->|"DCC SEND file PUBLIC-ADDRESS 40003 size token<br/>(the announcement, through IRC)"| Bot
```

At start-up `dolqd` says what it will do, and in a container with no address set it warns, because that default cannot work:
`warning: DCC: in a container, peers that have to connect here … are told the container's own address`.

An **active** offer, where the sender listens and `dolqd` connects out, needs none of this.

#### Asking the router instead: `DOLQ_DCC_HOST=auto`

If the router speaks UPnP or NAT-PMP, `dolqd` can do both things itself, for each transfer that needs it:

```mermaid
sequenceDiagram
    autonumber
    participant D as dolqd
    participant R as router
    participant P as bot on the internet
    participant I as IRC server

    P->>I: DCC SEND file 0 0 size token  (passive: you listen)
    I-->>D: the offer, accepted in the app
    D->>D: listen on a free port, say 41234
    D->>R: what is your public address? (UPnP or NAT-PMP, found by a broadcast)
    R-->>D: 80.144.209.90
    D->>R: forward TCP 41234 to me, for up to 5 minutes
    R-->>D: done (the external port may differ)
    D->>I: DCC SEND file 80.144.209.90 41234 size token
    I-->>P: the announcement
    P->>R: connects to 80.144.209.90:41234
    R->>D: forwarded to 41234
    Note over D,R: the file arrives
    D->>R: remove the forward of 41234
```

- **Nothing is opened until a transfer needs it**, only that one TCP port, with a lease of 5 minutes so the router closes it by itself if
  `dolqd` dies, and `dolqd` removes it as soon as the sender has connected, given up or been cancelled. Each forward and each removal is logged.
- **A changing public address is followed**, since it is asked for each time. The address and the port are never written down.
- **It needs:** UPnP (or NAT-PMP) switched on in the router, which many routers have off by default; a router with a public address of its
  own (a private one, or `100.64.x.x` from a provider that shares one address between customers, means another router or CGNAT sits in
  front, and the transfer is refused with that reason); and, in a container, host networking, because the router is found by a broadcast
  that a Docker bridge network cannot send.
- **At start** `dolqd` asks the router once, without opening anything, and logs `found a router (…), whose public address is …` or why not.
  Without a router the offer is refused at once, with the reason, instead of being left to time out.
- **Where to look when it says no router answered:** the router's UPnP switch (on an ASUS router, WAN, Internet Connection, "Enable UPnP"),
  and whether the NAS is on the same network as it. A VPN that takes over the default route also sends the search to the wrong network.

| Situation | Works? | Why |
|---|---|---|
| Active XDCC download | yes, anywhere | `dolqd` only connects out |
| Passive XDCC, DCC chat you offer, sending a file | needs an open inbound port | the other side connects in |
| Backend in Docker with host networking | the machine's address and ports are used | still needs the router to forward the ports, and `DOLQ_DCC_HOST` for a peer on the internet |
| Backend in Docker on a bridge network | only active downloads, unless `DOLQ_DCC_HOST` and `DOLQ_DCC_PORTS` are set and the range is published | otherwise it announces the container's internal address |
| Behind a router | set the range (the backend's `DOLQ_DCC_PORTS`, or Preferences for a local backend) and forward it | otherwise the OS picks any free port |

Preferences has a DCC port range (min and max). Leave both empty to let the operating system pick; set a range to
forward through a router or firewall.

The address `dolqd` announces in an offer is the one the operating system would use to reach the internet. It finds it
by opening a UDP socket towards 8.8.8.8, which sends nothing. That is the machine's **LAN** address, not its public
one, so a peer outside your network cannot connect to a passive offer even with the port forwarded. In a container it
is the container's own address, which is why host networking matters there.

## Showing a download on your own computer

A remote backend saves on its own disk. The Transfers list can still reveal a file in your file manager if you tell the
app how the backend's folder looks from your computer.

```mermaid
flowchart TD
    A["Show in folder pressed<br/>(path as the backend wrote it, for example /downloads/a.mkv)"] --> B{"remote backend?"}
    B -- "no" --> C["reveal the file in the file manager"]
    B -- "yes" --> D{"a mapping is set in Preferences?<br/>/downloads = /Volumes/anime"}
    D -- "yes, and the path is inside it" --> E["rewrite to /Volumes/anime/a.mkv<br/>and reveal it, if it exists"]
    D -- "no, or the file is not there" --> F["copy the backend's path to the clipboard<br/>and say so"]
```

## Failure cases

| What happens | What you see |
|---|---|
| Not enough room | `Failed: …` naming the folder and its free space, nothing downloaded |
| The bot never connects (passive) | after 3 minutes the transfer ends as disconnected |
| The peer goes away mid-file | the transfer fails with the error, the partial file is kept and can be resumed |
| A resume is not accepted in 10 s | a new file is started instead |
| Cancel | the transfer ends and is not kept in the list |

## Code

- `backend/internal/bouncer/xdcc.go`: `XDCCAccept`, `openDestination`, `requestResume`, `runXDCCTransfer`, `checkRoom`
- `backend/internal/bouncer/dcc.go`, `dccsendfile.go`: chat and sending
- `backend/internal/dcc/`: the sockets, offer parsing, `ReceiveFile`, `SendFile`, the pause gate
- `backend/internal/ircclient/client.go`: `handleDCCRequest`
- `src/renderer/src/App.tsx`: `XDCCSENDOFFER`, `XDCCTRANSFER`, `handleShowInFolder`
- `src/shared/remotePath.ts`: the path mapping
