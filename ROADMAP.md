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

- [x] Virtualized message list (`@tanstack/react-virtual`) so scrollback of
      tens of thousands of lines stays smooth - only the rows in (and just
      around) the viewport are ever mounted. Row heights vary with wrapped
      text, so sizes start as an estimate and get corrected via
      `ResizeObserver` after each row mounts; keyed by message id (not index)
      so a history-backfill prepend doesn't invalidate every already-measured
      row below it, only the new unmeasured ones above
- [x] Preserve scroll position across virtualization changes (channel switch,
      history backfill inserting older messages above the viewport) - the
      virtualizer's `anchorTo`/`followOnAppend` keep the view pinned to
      whatever's on screen when older history loads in above it, and follow
      new messages to the bottom only if you were already there, re-applied
      on every individual row remeasurement rather than once per render so it
      doesn't drift as estimated heights get replaced by real ones. Channel
      switching is a full swap rather than an append/prepend, so it's still
      handled explicitly: jump to bottom or the remembered scroll position for
      that channel, same as before virtualization. That jump uses estimated
      heights for the newly-selected channel (nothing's measured yet), so a
      restored mid-scroll position can settle slightly as real heights come
      in - bottom-follow doesn't have this problem since it self-corrects;
      only worth fixing for the restore case too if that settle is noticeable
- [x] Virtualized user list for large channels (100+ users) - flattened into
      one list of header+user rows (rather than nested groups) since a large
      channel is nearly all user rows anyway; same dynamic-measurement
      approach as the message list, though row heights are fixed here (no
      wrapping text) so it's really just future-proofing against padding
      tweaks drifting out of sync with a hardcoded number

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
- [x] CAP negotiation (`CAP LS` / `CAP REQ`) - `CAP LS 302` is now sent on
      every connection, not just when SASL is configured (`ircclient.handshake`);
      `multi-prefix`, `away-notify`, and `server-time` are requested as one
      REQ whenever the server advertises them (`negotiateCaps`/`requestCaps`),
      `sasl` as an independent second REQ so a server declining one doesn't
      take the other down with it (ACK/NAK answers a REQ atomically). A
      server that doesn't understand CAP at all just never replies to CAP
      LS, so every step falls back to registering as if CAP was never sent,
      the same guarantee SASL negotiation already had. `multi-prefix` is
      actually put to use: `ircparse.User.Privilege` (a single highest
      privilege) became `Privileges []PrivilegeLevel` (everything a user
      currently holds), parsed from a NAMES entry's full stacked prefix
      (`@+alice`) instead of just its first character - `applyModeChanges`
      in `store.ts` now adds/removes the exact privilege a MODE change
      touches instead of the old single-slot heuristic that lost a user's
      other privileges the moment one of them changed. `server-time` tags
      every line with `@time=...`, which would otherwise break every
      regex-based parsing rule in `ircparse` - `ircclient.stripMessageTags`
      strips that prefix before parsing (the raw, tagged line still reaches
      history/log verbatim); the timestamp itself isn't otherwise used yet.
      `away-notify`'s unsolicited `AWAY` lines just flow through unparsed,
      same as any other command this client doesn't act on - no away-status
      UI exists yet (that's Milestone 2's "Away status" item)
- [x] Private messages/queries - `PRIVMSG`'s target pattern is no longer
      restricted to `#...`; a non-channel target is always our own nick
      (the only way we'd ever receive one), so `ircparse` now parses it like
      any other PRIVMSG rather than dropping it. History buckets it by the
      other party instead of by target (which would otherwise just be our
      own nick for every DM we've ever received) - `bouncer.dmOrChannel` -
      so both directions of a conversation land in the same place once
      echo-message support exists to persist our own side of it too (today,
      same pre-existing gap channel messages have: only what flows back
      *into* the client gets persisted, not what we send). The frontend
      auto-opens a "query" (`Channel.isQuery`) on first incoming DM from a
      nick, the same way a channel auto-joins on `JOIN`, listed under its
      own "Direct Messages" section in the sidebar; clicking a user in
      `UserList` or `/msg <nick> <text>` starts one manually. Everything
      that already existed per-channel - scrollback via `getHistory`,
      CTCP `ACTION`/`VERSION`/`PING` (already target-agnostic, see CTCP
      above) - works for a query the same way, since a query is just a
      `Channel` whose id is a bare nick instead of `#name`
- [x] `NOTICE` handling - `ircparse` gets a `NoticeEvent`, same shape and
      targeting as `PrivmsgEvent` (a channel or straight to us), kept
      separate so the UI can render it distinctly (`-nick-` prefix, dim
      italic) rather than folding it into normal chat. The source isn't
      always a nick - server notices (pre-registration MOTD-adjacent lines,
      NickServ/ChanServ confirmations from bare "services." hostnames on
      some networks) come from a plain hostname with no `!user@host`, so
      `Nick` is just whatever preceded an optional `!`. Channel notices get
      the same per-channel history bucket and live rendering as PRIVMSG; a
      private notice deliberately doesn't bucket by sender the way a DM does
      (see "Private messages/queries" above) - it's frequently a service or
      the server itself, not someone worth opening a query for - so it falls
      back to the shared log bucket, where its raw line was already showing
      up before this (nothing to fix there, just now also a structured event
      for anything that wants one). CTCP replies riding in on a NOTICE
      (nothing in this client sends CTCP requests, so nothing to reply to
      it, and it's a rare enough shape) aren't unwrapped - would show up as
      literal `\x01...\x01` text if it ever happened
- [x] `TOPIC` / `332` / `333` parsing - the live `TOPIC` command and the
      RPL_TOPIC (`332`) numeric sent on join parse into a shared
      `TopicEvent` (`ircparse`); RPL_TOPICWHOTIME (`333`, who set it and
      when) parses into `TopicWhoTimeEvent`. Both flow through unchanged
      (bouncer/ipcproto already forward any event generically) into
      `setTopic`/`setTopicWhoTime` store actions, so `Channel.topic` (plus
      new `topicSetBy`/`topicSetAt` fields) actually gets set. A live
      `TOPIC` change also records who/when itself, since servers don't
      follow it with a 333. `TopicBar` renders the topic as before, with
      who/when now available as a hover tooltip
- [x] CTCP: `ACTION` (`/me`), `VERSION` reply, `PING` reply - a CTCP payload
      (`\x01...\x01`) inside a PRIVMSG is now recognized in `ircparse`
      before the plain-PRIVMSG rule gets a chance to treat it as literal
      chat text: `ACTION` becomes an `ActionEvent` (rendered as "* nick did
      a thing", both incoming and for `/me` typed locally), everything else
      becomes a `CTCPRequestEvent` that never leaves `ircclient` - `VERSION`
      and `PING` get answered with a `NOTICE` back to the requester
      (`ircclient.handleCTCPRequest`), anything else is silently ignored.
      The new CTCP rule matches any `PRIVMSG` target (channel or a private
      query straight to us), unlike the plain-PRIVMSG rule it sits ahead of
      - so `VERSION`/`PING` get answered either way even though private
      messages otherwise still aren't parsed/displayed (see the "Private
      messages/queries" item above)
- [x] Auto-reconnect with backoff on unexpected disconnect - a session's close
      is now either intentional (`Disconnect`, or a fresh `Connect` replacing
      it) or not; only the latter triggers a redial with exponential backoff
      (`Bouncer.ReconnectBackoffBase`/`Max`, 2s doubling to a 60s cap),
      indefinitely until it succeeds or the user disconnects. The session
      object (and its subscribers) survives the drop - only its underlying
      `ircclient.Client` gets swapped out on a successful redial, so an
      attached frontend keeps receiving fan-out without re-`Attach`ing.
      Status during a retry reuses the existing `connecting` state (no new
      status value, so no frontend changes needed) rather than adding a
      distinct "reconnecting" state
- [x] Nickname collision handling - alternate nick, not a prompt: while still
      registering (before RPL_WELCOME/`001`), `ircclient` reacts to
      ERR_NICKNAMEINUSE (`433`) by retrying with the nick plus one more
      underscore each attempt, up to 5 tries, then gives up rather than
      retrying forever against a server that just always says no. `001`'s
      target param - not just an echo of whatever `NICK` was last sent - is
      now what the client actually trusts as "my nick" (`WelcomeEvent`),
      which is what makes the auto-retry safe to do at all. A collision from
      an already-registered client's own live `/nick` isn't auto-overridden
      the same way (that'd silently land you on a nick you didn't ask for) -
      either way, a clear message replaces the raw `433` line in the Log
      (`NickInUseEvent`, `Retrying` set only for the pre-registration case).
      Also fixed in passing: the frontend's own notion of "my nick"
      (`nickMap`) never updated on a live self `NICK` change before this -
      needed for the new WELCOME-driven correction to actually stick, but a
      real gap on its own regardless of collisions
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
