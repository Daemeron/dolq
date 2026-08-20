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
  switch between them from the server rail
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
socket — it owns the actual IRC/DCC/XDCC connections and the SQLite history
store, while the renderer stays a thin UI on top.

---

## Prerequisites

- **Node.js** ≥ 20
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
(a `go tool` dependency, config in `backend/.air.toml`):

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
│   └── irc/
│       └── BackendClient.ts  # Spawns dolqd, talks to it over its Unix socket
├── preload/
│   └── index.ts              # Exposes a typed window.irc API via contextBridge
├── renderer/
│   └── src/
│       ├── App.tsx           # Root layout and event wiring
│       ├── store.ts          # zustand store (servers, channels, messages, users, preferences)
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
