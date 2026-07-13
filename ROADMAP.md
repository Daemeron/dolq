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

- [x] SQLite-backed history store - one writer, message/event rows keyed by
      server+channel. Lives in the Go backend (`backend/internal/history`,
      `modernc.org/sqlite`, pure Go/no cgo) rather than `better-sqlite3`/
      `node:sqlite` in the Electron main process: once the IRC client itself
      moved to `dolqd`, that's also where every line/event already flows
      through, so that's where it gets persisted - not just `PRIVMSG`, every
      raw line and every parsed event, verbatim. What to render from that is
      a UI decision made separately (`App.tsx`'s `toMessages`), not
      storage's to pre-filter
- [x] Async batched writes so a busy channel doesn't block the IRC socket read
      loop - one writer goroutine draining a buffered channel, opportunistically
      batching whatever's queued into one transaction per commit instead of
      one fsync per line. Persisted before fan-out to live subscribers, not
      after, since fan-out writes to subscriber sockets synchronously on the
      same read-loop goroutine and could otherwise delay history behind a
      slow subscriber
- [x] Message history stops depending on zustand's `persist` (`localStorage`) -
      `messageMap` was already excluded from `partialize`; scrollback now
      round-trips through SQLite instead (`getHistory` IPC action) rather
      than living only in memory for the session
- [x] On channel open: preload the most recent messages (default 100) from
      SQLite; lazy-load older history on scroll-up (infinite scroll backwards) -
      paged backwards via an id cursor, `MessageArea` detects the prepend from
      the data itself and compensates scroll position so it doesn't jump
- [x] Retention setting (keep forever / N days) - `dolqd -retention-days N`
      (0, the default, keeps everything forever). Flag-based rather than a
      UI toggle since there's no Preferences panel yet (separate item,
      below) for it to live in; wiring a real setting through to this flag
      is a small follow-up once that exists. "N messages per channel" as a
      third mode wasn't built - no UI to choose between it and N-days either
- [x] Periodic vacuum/compaction so the DB doesn't grow unbounded - hourly
      prune sweep (plus once at startup) when retention is enabled, paired
      with `PRAGMA incremental_vacuum` to actually reclaim the freed space

### Rendering

- [ ] Virtualized message list (e.g. `react-window` / `@tanstack/virtual`) so
      scrollback of tens of thousands of lines stays smooth
- [ ] Preserve scroll position across virtualization changes (channel switch,
      history backfill inserting older messages above the viewport)
- [ ] Virtualized user list for large channels (100+ users)

### Core protocol gaps

- [x] TLS/SSL support (port 6697 by default) - `IrcClient` connects via
      `tls.connect()` when requested, with a per-connection toggle in the
      connect form (defaults on)
- [x] SASL PLAIN authentication - opt-in: `CAP LS`/`CAP REQ :sasl` only sent
      when SASL credentials are actually configured, so a connection without
      them handshakes exactly as before. `AUTHENTICATE`/CAP negotiation lines
      are handled directly in `ircclient` (not parsed into events - nothing
      else needs them), with a bounded timeout so a server that ignores CAP
      entirely can't hang the connection; any failure (declined, rejected,
      timed out) falls back to registering unauthenticated rather than
      blocking the connection. Credentials live in the Connect modal and are
      kept only for the running session (`store.ts`'s `saslMap`, excluded
      from `partialize` like `messageMap`/`statusMap`) - not written to
      localStorage in plaintext, so they don't survive an app restart. A
      real credential store (there's no Preferences panel yet either) is the
      natural place to fix that later. Separately noticed but left alone:
      the connect form's "Server Password" (`PASS`) field is already
      wired up in the UI but was never actually sent by the client -
      pre-existing, unrelated to SASL, worth its own fix
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
- [ ] `irc://`/`ircs://` link handling - register dolq as the OS protocol
      handler (`app.setAsDefaultProtocolClient`) and parse the incoming URL
      (macOS `open-url`, Windows/Linux second-instance argv) into a
      host/port/channel/secure prefill for the connect flow, so clicking an
      IRC link elsewhere opens straight into dolq

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
- [x] `MODE` parsing only handles lines where every letter is a privilege letter
      (`qaohv`); lines mixing in other channel modes (`+k`, `+b`, ...) are
      silently dropped (see the comment in `parseLine.ts`) - now extracts
      privilege changes bundled with known list/key/limit/no-arg modes,
      stopping only at a truly unrecognized letter
- [x] No handling of `PING` timeouts from the server side - if the server goes
      silent without closing the socket, the client won't notice - the client
      now tracks time since last received data and closes the socket itself
      after 5 minutes of silence
- [x] No IPv6-specific testing/handling - `net.Socket` already handled bare IPv6
      literals correctly (verified live against Ergo over `::1`); the real gap was
      a bracketed literal (`[::1]`, common URL/copy-paste convention) failing to
      connect since nothing stripped the brackets before handing the host to
      `net`. Host/port joining and splitting moved into a tested
      `serverId.ts` helper that normalizes this. Also fixed a related
      unhandled-rejection warning found in the process: the handshake's
      `Promise.all` could leave sibling `send()` rejections unobserved when a
      bad connection failed more than one of them

---

## Non-goals (for now)

- Docker client deployment (always on experience by connecting the App to IRC
  server through middle-man)
- Built-in IRC bot
