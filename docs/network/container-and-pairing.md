# Container and pairing

Running `dolqd` in Docker, on a NAS or on a server: how it starts, what it listens on, what it prints so a client can
pair with it, and how its certificate and token survive (or do not survive) a restart.

The compose file with every setting and its explanation is `docker-compose.release.yml` in the repository root.

## First start of a fresh data folder

```mermaid
sequenceDiagram
    autonumber
    actor Op as You (on the NAS)
    participant Dk as Docker
    participant E as entrypoint
    participant D as dolqd
    participant V as /data (a mounted folder)

    Op->>Dk: docker compose up -d
    Dk->>E: start as root
    E->>V: hand /data and /downloads to PUID:PGID if Docker made them
    E->>D: su-exec PUID:PGID dolqd -addr 0.0.0.0:6789 -db /data/history.db
    Note over D: log: dolqd 0.14.0
    D->>V: read or create token (random, 0600)
    D->>V: read or create tls-cert.pem and tls-key.pem (self-signed, 10 years)
    Note over D: log: serving TLS, certificate SHA-256 fingerprint …
    D->>D: listen on 0.0.0.0:6789
    D-->>Op: log: pair a client by pasting one of these …<br/>dolq://HOST:6789?fp=FINGERPRINT&token=TOKEN
    D->>V: open history.db
    D-->>Op: log: saving downloads to /downloads, free space of each folder
    D-->>Op: log: ready, listening on …
    Note over D: on later starts the link is not printed again.<br/>Add -print-pairing to print it every start (it contains the token).
```

### Where the host in the link comes from

The link names an address that the **client** has to be able to reach, and `dolqd` has to guess it:

1. the `-acme-domain`, if one is set (the only name its certificate is valid for), else
2. `DOLQ_PUBLIC_HOST`, if set (and `DOLQ_PUBLIC_PORT` for the port), else
3. the addresses of the machine's network interfaces.

Inside a container on a bridge network the third option finds only the container's internal address (`172.x.x.x`),
which the outside cannot reach. Set `DOLQ_PUBLIC_HOST` to the NAS's name or address, or put `network_mode: host` in
the compose file. A link with the wrong host can be fixed by hand: only the host part is wrong, the fingerprint and token
are still right.

## What the container listens on

```mermaid
flowchart TD
    subgraph HostNet["network_mode: host (the default in the compose file)"]
        direction LR
        C1["Client"] -->|"NAS address:6789"| D1["dolqd shares the NAS's network<br/>listens directly on 6789"]
        D1 -->|"DCC offers carry the NAS's own address,<br/>so inbound DCC can work"| P1["File senders"]
    end

    subgraph Bridge["bridge network with ports: 6789:6789"]
        direction LR
        C2["Client"] -->|"NAS address:6789"| DK["Docker port forward"]
        DK --> D2["dolqd in its own network<br/>172.x.x.x:6789"]
        D2 -->|"DCC offers carry 172.x.x.x,<br/>so only active downloads work"| P2["File senders"]
    end
```

| | Host networking | Bridge with `ports:` |
|---|---|---|
| Pairing link host | the NAS's real addresses, found automatically | needs `DOLQ_PUBLIC_HOST` |
| Port 6789 | taken on the NAS itself, must be free | mapped, can be another number (then set `DOLQ_PUBLIC_PORT`) |
| Active XDCC downloads | work | work |
| Passive XDCC, DCC chat, sending files | work on the LAN. From the internet they also need `DOLQ_DCC_HOST` and a forwarded `DOLQ_DCC_PORTS` range, or `DOLQ_DCC_HOST=auto` with UPnP on the router | work only with `DOLQ_DCC_HOST` and `DOLQ_DCC_PORTS` set, forwarded on the router and published under `ports`. Otherwise the announced address is the container's own (see [File transfers](file-transfers.md#letting-a-peer-connect-in-passive-offers-chats-files-you-send)) |
| Docker Desktop on a Mac or PC | not available | use this |

## Certificate, token and why they must persist

The certificate and the token live in the data folder (`/data` in the container). They are what a paired client holds on to.

```mermaid
sequenceDiagram
    autonumber
    participant C as client (paired earlier)
    participant D1 as dolqd, first container
    participant V as /data
    participant D2 as dolqd, container made again

    D1->>V: write token and certificate
    C->>D1: pinned connection, signs in
    Note over D1,D2: the container is removed and created again
    alt /data is a mounted folder (the compose file's ./data:/data)
        D2->>V: read the same token and certificate
        C->>D2: pinned connection works, nothing to redo
    else /data is not mounted, so Docker made a throwaway volume
        D2->>D2: nothing there: make a new token and a new certificate
        C->>D2: connect
        D2-->>C: a certificate with another fingerprint
        Note over C: "The remote backend's certificate changed"
    end
```

If you see the app say the certificate changed right after re-creating a container, the usual cause is a `/data` that
is not mounted: the image declares `/data` as a volume, so without a mount Docker silently gives it a new anonymous
one each time. The log shows a new fingerprint at each start. History is lost the same way.

## Let's Encrypt instead of a self-signed certificate

With `-acme-domain`, `dolqd` gets a certificate from Let's Encrypt, so clients trust it without a pin and it renews on its
own. Validation happens on the same listener (TLS-ALPN-01), so port 443 of the domain must reach it.

```mermaid
sequenceDiagram
    autonumber
    participant C as client
    participant D as dolqd
    participant LE as Let's Encrypt
    participant Ca as /data/acme (cache)

    C->>D: TLS ClientHello for dolq.example.org
    alt a valid certificate is cached
        D->>Ca: read it
    else none yet, or it is about to expire
        D->>LE: order a certificate for dolq.example.org
        LE->>D: validate on port 443 (TLS-ALPN-01, the same listener)
        D-->>LE: proof
        LE-->>D: certificate
        D->>Ca: keep it and the account key
    end
    D-->>C: the certificate (signed by a public CA)
    Note over C: trusted as it is. No pin was needed,<br/>and renewals do not change anything for the client.
```

`-acme-staging` uses Let's Encrypt's test service (certificates nobody trusts) for trying the setup without rate limits.
The pairing link then names the domain and carries no fingerprint.

## Older clients and plain connections

A client from before access tokens existed speaks the plain protocol without a token. `dolqd` refuses that by default.
`-allow-legacy-plain` (or `DOLQ_ALLOW_LEGACY_PLAIN=1`) makes it accept plain connections next to TLS ones on the same
port, by looking at the first byte (a TLS handshake starts with 0x16). Anyone who can reach the port can then use the
backend, so it is meant for a short migration and cannot be combined with `-tls=false` or `-token=false`.

## What the log tells you

| Log line | Means |
|---|---|
| `dolqd 0.14.0` | which version is running |
| `serving TLS, certificate SHA-256 fingerprint: …` | a self-signed certificate, and its pin |
| `warning: /data belongs to user …` | the data folder is owned by someone `PUID` cannot write as |
| `data folder /data: … free of …` | free space, with a warning when low or when it is not a mounted volume |
| `ready, listening on …` | it started |
| `client ADDR: connected` then `authenticated` | an app paired and signed in |
| `client ADDR: rejected, the access token is missing or wrong` | a client has an old or wrong token |
| `client ADDR: closed without authenticating` | a probe or port scan, or a client that gave up |
| `irc host:port: connecting as …`, `registered as …`, `joined …` | what the sessions are doing |

## Code

- `backend/cmd/dolqd/plan.go`: how the options and environment become a listening plan
- `backend/cmd/dolqd/main.go`: start-up order, `logPairing`
- `backend/internal/ipcproto/pairing.go`: the token file and the link
- `backend/internal/ipcproto/tls.go`, `acme.go`, `sniff.go`
- `backend/docker-entrypoint.sh`, `backend/Dockerfile`, `docker-compose.release.yml`
