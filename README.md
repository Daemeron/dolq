# Dolq

![Dolq logo](/resources/icons/128x128.png)

> An IRC client that feels like Discord.

[![Build and Test](https://github.com/daemeron/dolq/actions/workflows/build-and-test.yml/badge.svg?branch=main)](https://github.com/daemeron/dolq/actions/workflows/build-and-test.yml)
[![Latest Release](https://img.shields.io/github/v/release/daemeron/dolq)](https://github.com/daemeron/dolq/releases/latest)

Dolq is a desktop IRC client built with Electron, React, and a Go backend,
designed to bring a familiar, modern interface to IRC. It borrows Discord's
layout — server list, channel list, topic bar, message area, and user list —
while staying true to the IRC protocol underneath: TLS, SASL, CAP negotiation,
CTCP, DCC, and XDCC file transfers all work like a "real" IRC client, just with
a friendlier shell around them. Currently targeting macOS, with multiplatform
support planned.

> ![Main chat view](/resources/screenshots/main-view.png)
> ![Preferences panel](/resources/screenshots/preferences.png)
> ![Add a server](/resources/screenshots/connect.png)

---

## Features

- **Multi-server** — connect to as many networks/identities as you want at once,
  switch between them from the server rail; nothing connects on launch unless
  you tick **Connect when the app opens** for that server
- **Channel list** — joined channels, DMs, and DCC chats, with a persistent
  **Log** view showing raw server output
- **XDCC file transfers** — browse pack listings, request/accept `DCC SEND` in
  passive or active mode, resume partial downloads, and track progress in a
  queue with pause/resume
- **DCC CHAT** — direct peer-to-peer chats alongside regular channels
- **History that survives a restart** — SQLite-backed, with configurable
  retention, full-text search (per-channel or across everything), and
  plain-text/JSON export
- **The IRC parts you'd expect** — SASL, TLS, CAP negotiation, CTCP
  (`ACTION`/`VERSION`/`PING`), WHOIS, away status, ignore lists, multiple
  identities per network, nick collision handling, flood protection,
  auto-reconnect, NickServ-aware prompts, `/alias` scripting
- **Desktop integration** — system tray with unread badge, desktop notifications
  with per-channel mute, `irc://`/`ircs://` link handling
- **Customization** — keybindings, sound alerts, per-server color overrides,
  font size/family, timestamp format, message density
- **Dark theme** — grayscale dark UI built with Tailwind CSS

See [ROADMAP.md](./ROADMAP.md) for the full feature list and what's still in
progress.

---

## Tech Stack

| Layer          | Technology                        |
| -------------- | --------------------------------- |
| Runtime        | Electron 42                       |
| UI framework   | React 18 + zustand                |
| Language       | TypeScript 5                      |
| Bundler        | electron-vite 5 / Vite 7          |
| Styling        | Tailwind CSS v4                   |
| Backend daemon | Go, SQLite (`modernc.org/sqlite`) |

The Electron app talks to a small Go daemon (`dolqd`) over a local Unix domain
socket (a named pipe on Windows), or over TLS TCP when it points at a
[remote backend](#remote-backend) — it owns the actual IRC/DCC/XDCC connections
and the SQLite history store, while the renderer stays a thin UI on top.

---

## Prerequisites

- **Node.js** ≥ 22
- **Go** ≥ 1.26 (only needed to build the backend daemon)
- **macOS** (for packaging — dev mode works on any platform)
- **npm** ≥ 10

---

## Download

Grab the latest release from the
[releases page](https://github.com/daemeron/dolq/releases/latest).

### macOS

After downloading, macOS Gatekeeper will quarantine the app. Remove the flag
before opening:

```bash
xattr -d com.apple.quarantine /path/to/app/Dolq.app
```

Then open `Dolq.app` normally.

### Windows

The installer is signed with a self-generated certificate, so Windows
SmartScreen will warn you. To proceed:

1. When the SmartScreen dialog appears, click **More info**
2. Click **Run anyway**

---

## Remote backend

By default the app starts its own `dolqd` and talks to it over a local socket.
You can instead run `dolqd` on an always-on machine (a server, a NAS) so IRC
sessions and history stay up while the app is closed, and point any number of
clients at it.

**Run it.** From the repo root, `docker compose up -d` builds and starts
`backend/Dockerfile`, listening on port 6789 with its data in a volume. On
Kubernetes, see [deploy/kubernetes/README.md](./deploy/kubernetes/README.md)
(prebuilt multi-arch images are published to `ghcr.io/daemeron/dolqd`). Without
a container, `dolqd -addr 0.0.0.0:6789` does the same.

**Pair a client.** On first start `dolqd` generates an access token and a
self-signed TLS certificate, keeps them next to the history database (the
directory is owner-only; in the Docker image it is the `/data` volume, owned by
uid 10001), and logs a pairing link (`dolq://host:6789?token=...&fp=...`, e.g.
in `docker compose logs dolqd`). In Dolq open **Preferences**, tick **Connect
to a remote backend instead of running one locally**, paste the link into
**Pairing Link**, save and restart. The link carries the address, the token and
the certificate fingerprint, so nothing else needs confirming. Keep it private.

If the connection to a remote backend drops (the laptop sleeps, the Wi-Fi
changes), the app redials it with backoff (1 second, doubling up to 30) and
signs in again; your servers stay as the backend left them and the open
channels reload their history. A refused token or a changed certificate stops
the retries and shows an error instead.

The link is logged only when the token is first generated, so it does not sit
in routinely kept logs; later starts log a hint instead. To see it again,
restart once with `-print-pairing` (with Docker Compose, temporarily add
`command: ['-print-pairing']` to the service, `docker compose up -d`, read the
logs, then remove it). With `-acme-domain` the link uses that domain as its
host.

**Downloads.** A remote `dolqd` saves XDCC downloads on the server, not where
the app's **Preferences** download folder points: clients cannot choose the
directory. Files go to `-download-dir` (or `DOLQ_DOWNLOAD_DIR`), by default
`downloads` next to the history database (`/data/downloads` in the Docker
image). A locally spawned `dolqd` still saves where the app asks.

**Legacy plain connections.** `dolqd` accepts only TLS connections that
present the token. Clients and setups from before access tokens connected
plainly, without one; to keep those working until every client is paired,
start it with `-allow-legacy-plain` (or `DOLQ_ALLOW_LEGACY_PLAIN=1`), which
accepts them on the same port and logs a warning saying so. `-secure`, which
used to turn that refusal on, is now the default and does nothing.

| Flag                                             | Meaning                                                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `-addr host:port`                                | Listen on TCP for remote clients instead of a local socket                                                            |
| `-db path`                                       | History database; the token and certificate live in the same directory by default                                     |
| `-allow-legacy-plain`                            | Also accept plain, unauthenticated connections from unpaired clients (see above)                                      |
| `-tls=false`                                     | Serve plain TCP, e.g. behind a TLS-terminating proxy or an SSH tunnel                                                 |
| `-token=false`                                   | No access token: anyone who can reach the port can use it. Only on a network you fully trust                          |
| `-tls-cert` / `-tls-key`                         | Use this certificate and key (generated there if neither file exists)                                                 |
| `-acme-domain` / `-acme-email` / `-acme-staging` | Get a Let's Encrypt certificate for a public domain name (port 443 must reach `dolqd`); pair with a link without `fp` |
| `-download-dir path`                             | Where XDCC downloads are saved (default: `downloads` next to the database)                                            |
| `-print-pairing`                                 | Log the pairing link on this start (otherwise only when the token is first generated)                                 |
| `-retention-days n`                              | Prune history older than `n` days (0 keeps everything)                                                                |

`-tls=false` and `-token=false` are independent, and neither can be combined
with `-allow-legacy-plain`. In the client, untick **Encrypt the connection
(TLS)** and/or leave the token empty to match.

| Environment variable        | Meaning                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `DOLQ_TOKEN`                | Use this access token instead of a generated one (kept out of `ps`, so there is no flag)  |
| `DOLQ_ALLOW_LEGACY_PLAIN=1` | Same as `-allow-legacy-plain`                                                             |
| `DOLQ_PUBLIC_HOST`          | Host name or IP to put in the pairing link (inside a container `dolqd` cannot tell)       |
| `DOLQ_PUBLIC_PORT`          | Port to put in the pairing link, when clients reach it through a different one (NodePort) |
| `DOLQ_DOWNLOAD_DIR`         | Same as `-download-dir`                                                                   |

To rotate the token or certificate, delete `token` or `tls-cert.pem` /
`tls-key.pem` from the data directory, restart (with `-print-pairing` if you
kept the token), and re-pair each client.

---

## Installation (from source)

```bash
git clone https://github.com/daemeron/dolq.git
cd dolq
npm install
```

---

## Development

Start the app in dev mode with hot reload:

```bash
npm run frontend:dev
```

This launches the Electron window with the renderer running via Vite's dev
server; the Go backend daemon is built and spawned automatically. Changes to
`src/renderer` reflect instantly; changes to `src/main` or `src/preload` restart
the main process. Changes to `backend/` need an app restart to pick up (it's
rebuilt automatically on the next launch).

To run `dolqd` on its own, outside Electron (e.g. to poke at it with `nc` or
a script against its Unix socket) - rebuilds and restarts it automatically on
every `backend/**/*.go` change, via [air](https://github.com/air-verse/air)
(run with `go run` at a pinned version so it stays out of `backend/go.mod`;
config in `backend/.air.toml`):

```bash
npm run backend:dev
```

---

## Building

**Compile the backend daemon** — outputs to `backend/bin/`:

```bash
npm run backend:build
```

**Compile the frontend only** — outputs to `out/`:

```bash
npm run frontend:build
```

**Run the production build** without packaging:

```bash
npm run run
```

**Package a distributable** — builds the backend, builds the frontend, then
outputs `.dmg`/`.zip` to `dist/`:

```bash
npm run package
```

The packaged app is signed under app ID `com.daemeron.dolq`. electron-builder
config lives in `electron-builder.json5`.

---

## Linting & Formatting

The Electron/TS side uses [Biome](https://biomejs.dev) for both formatting and
linting (the Go side already has its own `gofmt`/`go vet` gate, run in CI):

```bash
npm run frontend:lint        # check only (what CI runs)
npm run frontend:lint:fix    # apply fixes in place
```

**VSCode**: opening the repo prompts you to install the recommended
[Biome extension](https://marketplace.visualstudio.com/items?itemName=biomejs.biome)
(`.vscode/extensions.json`); `.vscode/settings.json` then formats on save and
organizes imports automatically, no extra setup needed.

**Other editors**: Biome ships official plugins/LSP support for
[most other editors](https://biomejs.dev/guides/editors/first-party-extensions/)
(Zed, JetBrains, Neovim, Sublime, Helix, ...) - point yours at this repo's
`biome.json` and format-on-save works the same way.

---

## Testing

```bash
npm run frontend:test        # one-shot
npm run frontend:test:dev    # watch mode
```

The backend has its own Go test suite, same shape:

```bash
npm run backend:test         # one-shot
npm run backend:test:dev     # rerun on every backend/**/*.go change, also via air (config in backend/.air.test.toml)
```

---

## Project Structure

```
src/
├── main/                     # Electron main process
│   ├── index.ts              # Entry point, window/tray management, IPC handlers
│   ├── ircUrl.ts             # irc://ircs:// link parsing
│   ├── settings.ts           # Persisted main-process settings (retention, downloads, ports)
│   ├── remoteBackend.ts      # Dials a remote dolqd: TLS, token, pinned fingerprint
│   ├── secrets.ts            # Saved passwords, encrypted with Electron's safeStorage
│   └── irc/
│       ├── BackendClient.ts  # Spawns dolqd or connects to a remote one, talks to it over its socket
│       └── redial.ts         # Backoff for redialing a remote backend that dropped
├── preload/
│   └── index.ts              # Exposes a typed window.irc API via contextBridge
├── renderer/
│   └── src/
│       ├── App.tsx           # Root layout and event wiring
│       ├── store.ts          # zustand store (servers, channels, messages, users, preferences)
│       ├── utils/            # Pure, unit-tested logic: commands, aliases, reconcile on launch,
│       │                      # history paging, log filter, alerts, export, ...
│       └── components/       # ServerList, ChannelList, TopicBar, MessageArea, UserList,
│                              # MessageInput, PreferencesModal, SearchModal, XDCC/DCC modals, ...
└── shared/
    └── ipc.ts                # IPC channel names and types shared between main and renderer

backend/
├── cmd/dolqd/                # Daemon entry point
└── internal/
    ├── ircclient/            # IRC protocol connection handling
    ├── ircparse/             # IRC line parsing
    ├── bouncer/              # Multi-connection management, XDCC/DCC orchestration
    ├── dcc/                  # DCC CHAT/SEND, port ranges, resume support
    ├── xdcc/                 # XDCC pack-listing parsing
    ├── history/              # SQLite-backed message history and search
    └── ipcproto/             # The socket protocol spoken to the Electron main process
```

---

## Roadmap

Dolq is a slow-and-steady side project. The first target was a "usable"
milestone — comfortable enough for daily use — since reached, followed by fuller
IRC power-user features, XDCC file transfers, and customization, all also done.
What's left is mostly polish and cross-platform distribution.

See [ROADMAP.md](./ROADMAP.md) for the full plan, milestone-by-milestone.

---

## License

[MIT](./LICENSE)
