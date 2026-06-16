# Reecord

> An IRC client that feels like Discord.

[![Build and Test](https://github.com/daemeron/reecord/actions/workflows/build-and-test.yml/badge.svg?branch=main)](https://github.com/daemeron/reecord/actions/workflows/build-and-test.yml)
[![Latest Release](https://img.shields.io/github/v/release/daemeron/reecord)](https://github.com/daemeron/reecord/releases/latest)

Reecord is a desktop IRC client built with Electron and React, designed to bring
a familiar, modern interface to IRC. It borrows Discord's layout — server list,
channel list, topic bar, message area, and user list — while staying true to the
IRC protocol underneath. Currently targeting macOS, with multiplatform support
planned.

> Screenshot coming soon.

---

## Features

- **Server rail** — switch between IRC servers with a single click
- **Channel list** — browse joined channels with a persistent **Log** view at
  the top showing raw server output
- **Topic bar** — displays the current channel topic at a glance
- **Message area** — clean chat history with per-nick color coding and hover
  timestamps
- **User list** — shows operators and regular users in the current channel
- **Dark theme** — Discord-inspired dark UI built with Tailwind CSS

---

## Tech Stack

| Layer        | Technology               |
| ------------ | ------------------------ |
| Runtime      | Electron 42              |
| UI framework | React 18                 |
| Language     | TypeScript 5             |
| Bundler      | electron-vite 5 / Vite 7 |
| Styling      | Tailwind CSS v4          |

---

## Prerequisites

- **Node.js** ≥ 20
- **macOS** (for packaging — dev mode works on any platform)
- **npm** ≥ 10

---

## Download

Grab the latest release from the [releases page](https://github.com/daemeron/reecord/releases/latest).

### macOS

After downloading, macOS Gatekeeper will quarantine the app. Remove the flag before opening:

```bash
xattr -d com.apple.quarantine /path/to/app/Reecord.app
```

Then open `Reecord.app` normally.

### Windows

The installer is signed with a self-generated certificate, so Windows SmartScreen will warn you. To proceed:

1. When the SmartScreen dialog appears, click **More info**
2. Click **Run anyway**

---

## Installation (from source)

```bash
git clone https://github.com/daemeron/reecord.git
cd reecord
npm install
```

---

## Development

Start the app in dev mode with hot reload:

```bash
npm run dev
```

This launches the Electron window with the renderer running via Vite's dev
server. Changes to `src/renderer` reflect instantly; changes to `src/main` or
`src/preload` restart the main process.

---

## Building

**Compile only** — outputs to `out/`:

```bash
npm run build
```

**Preview the production build** without packaging:

```bash
npm run preview
```

**Package a distributable** — outputs `.dmg` and `.zip` to `dist/`:

```bash
npm run package
```

The packaged app is signed under app ID `com.reecord.app`. electron-builder
config lives in `electron-builder.json5`.

---

## Project Structure

```
src/
├── main/               # Electron main process
│   ├── index.ts        # Entry point, window management
│   └── irc/
│       ├── client.ts   # IRC connection and protocol handling
│       └── relay.ts    # Forwards IRC events to the renderer over IPC
├── preload/
│   └── index.ts        # Exposes a typed window.irc API via contextBridge
├── renderer/
│   └── src/
│       ├── App.tsx         # Root layout component
│       ├── DummyData.ts     # Static dummy data for UI development
│       └── components/     # ServerList, ChannelList, TopicBar, MessageArea, UserList, MessageInput
└── shared/
    └── ipc.ts          # IPC channel names and types shared between main and renderer
```

---

## Roadmap

- [ ] Work in progress

---

## License

[MIT](./LICENSE)
