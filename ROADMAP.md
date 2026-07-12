# Roadmap

Dolq's goal: a daily-driver desktop IRC client that feels like a modern chat app
without giving up IRC's openness. This tracks the path from "functional
prototype" to **usable** (comfortable enough for daily use) to feature-complete,
plus the bugs and gaps found along the way.

Milestones are ordered roughly by dependency and by how much they block daily
use, not by calendar date. Items within a milestone aren't strictly ordered.

---

## Milestone 1 — Usable (daily-driver baseline)

The bar for "usable": connect to the servers/channels I actually use, don't lose
history when the app restarts, and don't worry that a busy channel's history
will hang the UI.

### Persistence

- [ ] SQLite-backed history store (`better-sqlite3` or `node:sqlite`) - one
      writer in the main process, message/event tables keyed by server+channel
- [ ] Async batched writes so a busy channel doesn't block the IRC socket read
      loop
- [ ] Message history stops depending on zustand's `persist` (`localStorage`) -
      persist only small UI state there, move message bodies to SQLite
- [ ] On channel open: preload the most recent ~1 day (or last N messages,
      whichever is smaller) from SQLite; lazy-load older history on scroll-up
      (infinite scroll backwards)
- [ ] Retention setting (keep forever / N days / N messages per channel)
- [ ] Periodic vacuum/compaction so the DB doesn't grow unbounded

### Rendering

- [ ] Virtualized message list (e.g. `react-window` / `@tanstack/virtual`) so
      scrollback of tens of thousands of lines stays smooth
- [ ] Preserve scroll position across virtualization changes (channel switch,
      history backfill inserting older messages above the viewport)
- [ ] Virtualized user list for large channels (100+ users)

### Core protocol gaps

- [ ] TLS/SSL support (`ircs://`, port 6697 by default) - currently
      plaintext-only
- [ ] SASL PLAIN authentication
- [ ] CAP negotiation (`CAP LS` / `CAP REQ`) - at minimum `multi-prefix` (today
      `NAMES`/`MODE` only ever track a user's single highest privilege - see the
      comment on `applyModeChanges` in `store.ts`), `away-notify`, `server-time`
- [ ] Private messages/queries - `PRIVMSG` parsing only matches channel targets
      (`#...`) today; DMs to your own nick aren't parsed or displayed at all
- [ ] `NOTICE` handling
- [ ] `TOPIC` / `332` / `333` parsing - `Channel.topic` already exists in the
      type and renders in `TopicBar`, but nothing ever sets it
- [ ] CTCP: `ACTION` (`/me`), `VERSION` reply, `PING` reply
- [ ] Auto-reconnect with backoff on unexpected disconnect (today only a manual
      Connect button/`/connect`)
- [ ] Nickname collision handling - alternate nick / prompt instead of just
      showing the raw `433` line in the Log
- [ ] Outgoing flood protection (basic send-rate limiting so a paste storm
      doesn't get you killed by the server)

### Preferences (v1 - the minimum to be comfortable daily)

- [ ] Preferences window/panel
- [ ] Per-server identity defaults (nick, alt nicks, username/realname, SASL
      creds, autojoin channel list)
- [ ] Notification toggle + basic mention/highlight detection (own nick
      mentioned in a channel you're not focused on)
- [ ] Timestamp format (12h/24h), compact vs. cozy message density

---

## Milestone 2 — IRC power-user features

- [ ] WHOIS panel (click a user → WHOIS info)
- [ ] Ignore/block list (per-nick, per-network)
- [ ] DCC CHAT
- [ ] Clickable URLs, safe link handling
- [ ] Search across history (per-channel and global)
- [ ] Export channel/server logs (plain text, maybe JSON)
- [ ] ChanServ/NickServ-aware helpers (e.g. detect registration prompts, auth
      flow shortcuts)
- [ ] Multiple identities per network (e.g. separate work/personal nick on the
      same server)
- [ ] Away status (`/away`, marking away in the UI)
- [ ] Scripting/aliases (basic `/alias` command shortcuts)

---

## Milestone 3 — XDCC file transfers

- [ ] XDCC LIST request + parse pack listings
- [ ] XDCC GET / DCC SEND, with passive and active mode
- [ ] Transfer manager UI - queue, progress, speed, pause/resume
- [ ] Resume partial downloads
- [ ] Configurable download directory and port range (for active mode/NAT)
- [ ] Basic pack-list browsing quality-of-life (search across known XDCC bots,
      if feasible without violating any bot's own rules)

---

## Milestone 4 — Customization & polish

- [ ] Preferences beyond M1's basics: keybinding customization, sound alerts,
      per-server color overrides, font size/family
- [ ] System tray icon (minimize to tray, unread badge count)
- [ ] Desktop notifications with per-channel mute
- [ ] Accessibility pass (keyboard navigation, screen reader labels, focus
      management in modals)
- [ ] Emoji picker (optional, since this is "Discord-like")
- [ ] Light theme (the `2e` icon variant is already sitting in `resources/`
      waiting for this)

---

## Milestone 5 — Cross-platform distribution

- [ ] Windows and Linux build parity (README currently says "targeting macOS...
      multiplatform planned" - `electron-builder.json5` already has
      `win`/`linux` targets configured but they're unverified)
- [ ] Auto-update (`electron-updater` + a release feed)
- [ ] Code signing for Windows (currently self-signed, triggers SmartScreen per
      the README)
- [ ] Notarization for macOS (currently ad-hoc signed, per
      `electron-builder.json5`'s `identity: "-"`)

---

## Known bugs / tech debt (not milestone-specific)

- [ ] Chat history and connection status don't survive an app restart at all
      today (`messageMap`/`statusMap` aren't in `store.ts`'s `partialize`) -
      largely subsumed by Milestone 1's persistence work, but worth tracking as
      the concrete user-visible symptom in the meantime
- [ ] `MODE` parsing only handles lines where every letter is a privilege letter
      (`qaohv`); lines mixing in other channel modes (`+k`, `+b`, ...) are
      silently dropped (see the comment in `parseLine.ts`)
- [ ] No handling of `PING` timeouts from the server side - if the server goes
      silent without closing the socket, the client won't notice
- [ ] No IPv6-specific testing/handling

---

## Non-goals (for now)

- Docker client deployment (always on experience by connecting the App to IRC
  server through middle-man)
- Built-in IRC bot
