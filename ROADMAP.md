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
- [x] Outgoing flood protection - `Bouncer.Send` is the one path every
      user-originated line takes to the wire (typed chat, `/join`/`/part`/
      `/me`, raw commands from the Log), so it's the one place this needs to
      live: `ircclient.Client.SendPaced` now sits in front of the actual
      write, a token bucket allowing a burst of 4 lines immediately then one
      more every 2s, refilled lazily from elapsed wall-clock time rather
      than a background goroutine - a paste storm gets sent, just spread out
      enough to clear a typical server's own flood protection instead of
      getting the connection killed for tripping it, nothing gets silently
      dropped. Deliberately doesn't touch internal protocol traffic
      (handshake, PONG, CTCP replies, `Disconnect`'s PART/QUIT) - those
      still go through the unpaced `Send` directly, since delaying PONG in
      particular could self-inflict a ping timeout. Known gap: the frontend
      still does its optimistic local echo only after `sendLine`'s IPC round
      trip resolves, so a paced (delayed) send would show up in your own
      chat view late too - not fixed here since nothing in today's UI (a
      single-line input, one Enter per message) can actually trigger the
      burst limit in normal use; worth revisiting if multi-line paste or
      scripting/aliases (Milestone 2) ever can

### Preferences (v1 - the minimum to be comfortable daily)

- [x] Preferences window/panel - a modal (`PreferencesModal`, same style as
      `ConnectModal`), opened from a gear icon next to the nick in
      `UserPanel`. Settings live in their own small JSON file
      (`src/main/settings.ts`, under `app.getPath('userData')`) rather than
      the renderer's localStorage-backed zustand store: unlike everything
      else in that store, at least one setting (retention) has to be read by
      the main process before `dolqd` is even spawned (it becomes the
      `-retention-days` launch flag - previously hardcoded to never being
      passed at all, so retention silently defaulted to "forever" for every
      real user regardless of the flag already existing backend-side), which
      the renderer can't serve in time. First (only, for now) setting wired
      through: history retention, the exact "small follow-up" the
      persistence section above already called out once this existed. It's
      a launch flag, not something `dolqd` can be told to change mid-run, so
      saving it persists immediately but only takes effect on the next
      start - explained in the panel itself rather than actually restarting
      the backend (and dropping every live connection) to apply it
      immediately
- [x] Per-server identity defaults (nick, alt nicks, username/realname, SASL
      creds, autojoin channel list) - nick and SASL creds already had a home
      (`nickMap`/`saslMap`); this rounds out `Server` with `altNicks`,
      `username`, `realname`, `autojoinChannels`, all optional and all
      captured in `ConnectModal`'s new collapsible "Advanced" section so the
      common case (host/nick/SASL) doesn't get more cluttered. AltNicks
      feeds directly into the nick-collision retry machinery from the
      "Nickname collision handling" item above - `handleNickInUse` tries
      each configured alt nick in order before falling back to
      underscore-appending, a configured fallback beating a mangled one.
      Username/realname flow into the `USER` line (previously hardcoded to
      the nick and "Dolq IRC Client"); realname now gets a proper leading
      `:` there too, so a multi-word one actually round-trips correctly
      instead of just working by most servers' leniency. Autojoin channels
      get JOINed once `WELCOME` (`001`) confirms registration - the same
      event that now also drives nick-tracking, so there's no separate
      "just connected" signal needed. Not built: a way to edit any of this
      for a server already added - matches nick/SASL's own existing
      precedent (ConnectModal-only, no edit-later UI exists for those
      either), not a gap introduced by this
- [x] Notification toggle + basic mention/highlight detection (own nick
      mentioned in a channel you're not focused on) - `mentionsNick`
      (`utils/mentions.ts`) does a whole-word, case-insensitive match,
      bounded with lookarounds rather than `\b` since an IRC nick can start
      or end with a non-word character (`[bot]`, RFC 2812 allows
      `[]{}\|^_-\``) that `\b` would never fire a boundary on at all. On a
      channel PRIVMSG/ACTION that mentions you and isn't the channel
      currently selected: highlights it in the sidebar (`mentionedChannels`
      in the store, cleared on selecting it - not persisted, same as
      statusMap/userMap) and, if the toggle is on, fires a real desktop
      notification via the renderer's own `Notification` (Electron
      implements the standard web API there directly - no IPC/main-process
      round trip needed) that jumps you straight to the channel on click.
      Scoped to channels only, not queries - unlike a channel, every DM is
      already "for you" by definition, so there's no separate "mention"
      signal to detect there. The toggle itself lives in the zustand store
      (persisted, applies live) rather than the main-process settings file
      the Preferences panel's retention setting uses - it doesn't need to
      exist before `dolqd` spawns the way retention does, so there's no
      reason to pay that indirection for it; the panel now surfaces both,
      each through whichever path actually fits. Not built: window-focus
      awareness (only "is this the selected channel" is checked, not "is
      the app window itself focused") - skipped for now, the selected-
      channel check alone covers the common case
- [x] Timestamp format (12h/24h), compact vs. cozy message density - both
      live in the zustand store (persisted, applies instantly, no restart -
      same reasoning as the notifications toggle above for why these don't
      go through the main-process settings file), surfaced as two more
      controls in the Preferences panel. `MessageArea.formatTime` takes the
      format as a param (`hour12` straight into `toLocaleTimeString`);
      compact density tightens each non-log row's vertical padding
      (`py-0.5`/`py-1` down to `py-0`) and the virtualizer's row-height
      estimate to match, everything else about a row - font size, layout -
      stays the same. In fixing this, noticed and fixed the notifications
      toggle from the previous item was never actually added to the store's
      `partialize` - it looked persisted (the store option is right there)
      but silently reset to its default on every restart; now it, and both
      of these, actually are

---

## Milestone 2 — IRC power-user features

- [x] WHOIS panel (click a user → WHOIS info) - right-click a user in
      `UserList` (left-click already opens a query, see "Private
      messages/queries"). `ircclient` accumulates the handful of numeric
      replies a WHOIS scatters across the wire (311 user/host/realname, 312
      server, 317 idle/signon, 319 channels, 330 account - not universally
      supported, some networks just omit it, 401 no-such-nick) keyed by
      nick, the same buffer-until-a-terminator shape NAMES already uses,
      and emits one synthesized `WhoisEvent` on 318 (RPL_ENDOFWHOIS).
      RPL_AWAY (301) is parsed too, but only folded into an in-flight WHOIS
      for now - it's also sent standalone when messaging an away user,
      which the "Away status" item below will need to handle without
      colliding with this. `WhoisModal` shows a "Looking up..." state
      until the reply lands (or "No such nick" if 401 fired) - no timeout
      if the server never answers at all, same tradeoff CAP negotiation
      doesn't have here since there's no handshake blocking on it
- [x] Ignore/block list (per-nick, per-network) - purely a client-side
      display filter (`store.ignoredNicks`, persisted, keyed by serverId -
      "per-network" already means "per-server" everywhere else in this app,
      e.g. `nickMap`/`saslMap`, so this follows suit rather than inventing a
      separate notion of "network"). IRC has no native ignore, so nothing
      is sent to the server - an ignored nick's PRIVMSG/ACTION/NOTICE just
      never reaches `appendMessage` (and, for a DM, never even opens a
      query - see `isIgnored`'s placement ahead of `dmKey`). Scoped to chat
      content only, not JOIN/PART/QUIT/etc. - ignoring means "stop showing
      me what they say", not "hide that they exist". Toggled from a right-
      click in `UserList` (ignored users render dimmed + struck through);
      since that only works while they're actually visible in a shared
      channel, the Preferences panel also lists every ignored nick across
      every server with its own Unignore, for the case where they've since
      left or you're not sharing a channel with them anymore
- [x] DCC CHAT - a new `dcc` package handles the peer-to-peer half (plain
      newline-delimited text over a direct TCP connection, no more IRC
      framing at all), deliberately shaped like `ircclient.Client` (Send/
      AddLineListener/OnClose/Start) even though DCC needs none of that
      shape's original IRC-specific reasons to exist - consistency with the
      rest of this codebase over a bespoke API. The CTCP handshake that
      sets one up still rides over the ordinary IRC connection though:
      `ircclient` parses an incoming `DCC CHAT` request into a
      `DCCChatOfferEvent` (unlike VERSION/PING, nothing auto-replies -
      accepting is a user decision) and `bouncer.DCCOffer`/`DCCAccept`
      open the actual socket. A DCC session's traffic reuses the exact
      same `Subscriber.SendLine`/`SendStatus` fan-out an IRC session's
      lines already go through, keyed by a synthetic `dcc:<uuid>` id
      standing in for a serverId - the whole ipcproto/preload/onLine/
      onStatus pipeline never needed to know that was IRC-specific in the
      first place, so no new wire framing was needed, just two new
      actions (`dccOffer`/`dccAccept`, returning that id) plus
      `dccSend`/`dccClose`. Frontend-side a DCC session is a `Channel`
      with both `isQuery` and `isDCC` set - same TopicBar/MessageInput
      treatment a query already gets, just its own "DCC Chats" sidebar
      section and closed via `dccClose` instead of `PART`. Known
      limitations, both explained in code comments rather than solved:
      the announced IP is a best-effort guess at your outbound interface
      (`dcc.LocalIP`) with no NAT traversal - behind one, the offer only
      connects if the peer can actually reach that address (same LAN, or
      port forwarding), the same real limitation DCC has always had, not
      specific to this client; and a DCC session doesn't survive an app
      restart the way IRC sessions do (no reconnect, no persistence) -
      this app only ever has one Electron-process subscriber at a time,
      so that bouncer-survives-a-subscriber-disconnect guarantee wasn't
      worth replicating for something this transient. Also noticed but
      out of scope: an unrelated pre-existing flaky test in
      `internal/history` (`TestRetentionPrunesOldEntries`) - untouched by
      this change, worth its own fix
- [x] Clickable URLs, safe link handling - `IrcText` runs a second pass over
      each already-formatted chunk (mIRC color/bold/etc. parsing stays
      untouched), splitting out `http(s)://` matches as clickable links -
      deliberately http(s)-only, nothing else IRC text carries a real risk
      of (a `javascript:` or platform-specific custom-scheme URI actually
      launching something is the concern "safe" is about here, not
      mismatched link text vs. href the way browsers worry about phishing -
      IRC text has no separate "display text", what you see is the literal
      URL). Clicking calls a new `window.irc.openExternal`, since
      `shell.openExternal` only exists in the main process - checked again
      there rather than trusting the renderer's own regex as the only
      guard against a non-http(s) scheme. Trailing sentence punctuation
      glued onto a match ("see https://example.com.") is trimmed off
      after the fact rather than excluded from the matching regex itself,
      since a period is a perfectly valid character *inside* a URL
      (`example.co.uk`) - only stripped when it's stuck to the very end
- [x] Search across history (per-channel and global) - `history.Store.Search`
      is a case-insensitive `LIKE` match against the same stored payload
      `Recent` already reads (raw line text, or the JSON a parsed event was
      encoded as) - a literal substring match, not JSON-aware, so a query
      that happens to collide with JSON structure itself (rare - real
      searches are words/phrases) can turn up noise; SQLite FTS5 would be
      the natural upgrade if that ever actually matters enough to justify
      a virtual table kept in sync via triggers. serverID/channel empty
      widens the scope (empty channel: every channel on that server; empty
      server: every server, "global") - the two ROADMAP asked for are just
      the two ends of that, `SearchModal`'s checkbox toggling between them.
      A result carries its own serverId/channel now (`history.Entry` always
      serializes them, not just for search - `Recent`/getHistory's response
      didn't need them before since it's already scoped to one, but now
      does double duty), so clicking one can jump straight to that
      channel - the search icon lives in `ChannelList`'s header, next to
      the server name it's implicitly scoped to by default
- [x] Export channel/server logs (plain text, maybe JSON) - both formats,
      via a small dropdown (⬇, reusing the same context-menu component
      everything else's right-click menus already use, just left-click
      triggered here) in `TopicBar`, next to whichever channel/Log/query is
      currently selected - a DCC session doesn't get one, its history isn't
      persisted at all (see the "DCC CHAT" item above). No new backend
      endpoint needed: the renderer already had `getHistory`'s paging
      cursor for scrollback, so exporting is just that same loop (see
      `loadOlderHistory`) run to completion instead of one page at a time,
      formatted (`formatEntry`, one line per entry - most event types get a
      human-readable line, anything without a dedicated case falls back to
      raw JSON rather than needing to enumerate every event type a log
      export essentially never actually surfaces) or left as-is for JSON.
      `fs`/the save dialog aren't reachable from the renderer either, so
      the actual write goes through one more small main-process handler
      (`saveTextFile`), same shape as `openExternal` above it
- [x] ChanServ/NickServ-aware helpers (e.g. detect registration prompts, auth
      flow shortcuts) - scoped to NickServ identify prompts specifically:
      that's the concrete, common pain point ("nick already registered,
      please identify") the roadmap's own example names; nothing about
      ChanServ had an actual pattern worth hardcoding without a real need
      driving what it should even do. `isNickServIdentifyPrompt` matches
      loosely on the words that matter ("identify" + "registered"/
      "reserved") rather than one network's exact sentence, since services
      packages (atheme, anope, ergo's built-in NickServ) all phrase this
      slightly differently. A matching NOTICE pops a small modal - the
      "auth flow shortcut" - that sends `/msg NickServ identify <password>`
      for you instead of typing the whole thing out, with a tip pointing at
      SASL (already fully supported, see "Per-server identity defaults")
      as the real fix for not wanting to see this prompt at all: nothing
      here is remembered anywhere, on purpose, since SASL already is
      dolq's actual answer to "identify automatically next time"
- [x] Multiple identities per network (e.g. separate work/personal nick on the
      same server) - root cause of why this didn't already work: `Server.id`
      was `host:port` (`buildServerId`), so connecting a second identity to
      a network you'd already added just silently replaced the first one's
      live session (`bouncer.Connect` explicitly disconnects any existing
      session for the same id first) rather than running both. `Server.id`
      is now opaque (`crypto.randomUUID()`), with `host`/`port` promoted to
      explicit fields instead of being parsed back out of it - the backend
      never actually cared what shape a serverId was (always treated as a
      plain lookup key), so this needed zero backend changes, only the
      frontend's own id-generation convention. `nickMap`/`saslMap`/
      `channelMap`/etc. were already keyed by that id, so per-identity
      nick/SASL/history "just worked" once ids stopped colliding - the
      actual fix is genuinely that small. Two things stay `host:port`,
      deliberately: `ServerPreset.id` (the quick-pick list is "networks
      you've connected to before", still deduped per-network regardless of
      how many identities you've since added for one) and a fallback
      (`resolveHostPort`) for a `Server` persisted before this existed and
      so still only has the old `host:port`-shaped id to recover them from -
      no migration needed, old and new entries coexist fine
- [x] Away status (`/away`, marking away in the UI) - `/away [message]`
      sends `AWAY [:message]` (bare `/away` clears it, matching the RFC).
      `away-notify` (already negotiated, see CAP negotiation above) reports
      real-time away/back for anyone sharing a channel with us -
      `ircparse.AwayEvent` covers both directions, "back" distinguished
      from "away" by the wire form carrying no trailing param at all rather
      than an empty one. Also fixed the exact gap the WHOIS panel item
      above called out: a standalone `301` (e.g. from messaging an away
      user, not part of any WHOIS) used to get silently absorbed into
      `whoisBuffer` regardless of whether a WHOIS was actually in flight -
      a real pre-existing bug once away status started needing that same
      numeric for something else, now only folded in when a `311` already
      opened an entry for that nick, otherwise emitted as a standalone
      `AwayEvent`. UI: dimmed + "(away)" in `UserList` for anyone away in a
      shared channel, and in `UserPanel` for your own status (confirmed via
      `305`/`306`). Known IRCv3 limitation, not solved here: away-notify
      only reports *changes*, not who's already away when you join a
      channel or first connect - NAMES has no away flag, so that only shows
      up once they toggle it (or you WHOIS them) while you're watching
- [x] Scripting/aliases (basic `/alias` command shortcuts) - `/alias name
      command template` defines one (`$1`/`$2`/... for individual args,
      `$*` for all of them unsplit - `expandAlias`), `/unalias name` removes
      it; typing `/name ...` later re-enters `handleSend` with the expanded
      text, so an alias expanding to `/me waves` or another alias goes
      through every existing check exactly as if it had been typed
      directly - no separate execution path to keep in sync with the real
      one. A built-in command always wins if an alias happens to share its
      name (checked last, as a fallback) rather than ever being able to
      shadow `/join` etc. Global, not per-server - a typing shortcut isn't
      a protocol/network concept the way SASL creds or autojoin are.
      Guarded against runaway recursion (an alias expanding back to itself,
      directly or through another one) with a small fixed depth ceiling,
      not a real limit normal aliases should ever hit. Defining/removing is
      command-only; the Preferences panel is view-and-remove, same
      treatment as Ignored Users above - not a place to add one from
      scratch either

---

## Milestone 3 — XDCC file transfers

- [x] XDCC LIST request + parse pack listings - the request half needed no
      new code at all: XDCC is just a text convention over ordinary PRIVMSG,
      not a protocol extension, so `/msg <bot> XDCC LIST` already worked
      through the existing `/msg` command. Parsing is new: `xdcc.ParseListLine`
      (`backend/internal/xdcc`) recognizes the `#<n>  <gets>x [<size>]
      <filename>` row shape essentially every XDCC bot (iroffer and its many
      forks) uses, leaving header/footer lines ("** 12 packs **", "Total
      Offered: ...") as plain text since they don't match. ircclient emits a
      parsed `XDCCPackEvent` alongside the underlying NOTICE/PRIVMSG (not
      instead of it, so the raw listing still shows up as ordinary chat
      wherever the pattern misses), which the UI renders as a distinct 📦 row
      in the bot's query instead of raw bot-formatted text. Clicking one now
      requests it - see the next item
- [x] XDCC GET / DCC SEND, with passive and active mode - clicking a parsed
      pack row sends the bot's own "XDCC SEND #n" convention (plain PRIVMSG,
      same as LIST needed no new protocol code); its CTCP DCC SEND reply is
      parsed into a new `XDCCSendOfferEvent` (`dcc.ParseSendOffer`, handling
      both active and passive/reverse - port 0 - offers, and the quoted-
      filename convention bots use for names with spaces) and shown as an
      explicit accept/decline prompt, same "connects straight to an address
      you didn't choose" reasoning as the existing DCC CHAT offer prompt.
      Accepting streams the file straight to disk in the Go backend
      (`bouncer.XDCCAccept`/`dcc.ReceiveFile`) - never through IPC as message
      payloads, and never trusting the offer's own filename beyond its base
      name (`safeFilename`), since it's chosen by whatever's on the other
      end of the network. Saves into the OS Downloads folder (no directory
      picker yet - that's the "configurable download directory" item below)
      with browser-style " (1)", " (2)" collision suffixes, and never deletes
      a partial file on failure so a future "resume" has something to resume
      from. Progress shows as a minimal status strip, not the queue/speed/
      pause-resume "Transfer manager UI" that's still its own item next
- [x] Transfer manager UI - queue, progress, speed, pause/resume - the status
      strip from the previous item is now a real queue: every transfer
      xdccAccept starts stays listed, active or finished, until explicitly
      dismissed (separate from cancelling one still in progress), instead of
      vanishing the instant it completes. Speed is a plain bytes-since-last-
      update/seconds-since-last-update calculation in the renderer (nothing
      backend-side needed - XDCCTRANSFER already carries a timestamped byte
      count). Pause/resume is `dcc.PauseGate` on the backend: pausing doesn't
      send anything or touch the connection at all, it just stops the read
      loop between chunks - TCP's own flow control backs up the sender on
      its end automatically, which is all "pause" has ever needed to mean
      here. Deliberately not the same as the next item: a paused transfer's
      connection is still open and its progress still in memory, so nothing
      here helps if the app restarts or the connection actually drops - see
      "Resume partial downloads" for that
- [x] Resume partial downloads - accepting a pack whose filename already has
      a same-named, smaller file sitting in the download directory (left
      over from an earlier attempt that never finished - a partial file is
      never deleted on failure, see the XDCC GET item above) now tries a
      standard CTCP `DCC RESUME`/`DCC ACCEPT` handshake with the bot before
      connecting (`bouncer.requestResume`, `ircparse.XDCCResumeAcceptEvent`),
      appending the remaining bytes onto the existing file instead of
      re-downloading it whole or uniquePath-ing a second copy next to it.
      Entirely automatic - no new UI, no separate "resume" action - clicking
      the same pack again is what starts it. A bot that doesn't answer the
      resume request within `ResumeAcceptTimeout` (many don't support it at
      all) just falls back to downloading fresh, same as before this
      existed. `dcc.ReceiveFile` grew a `base` offset so the wire's byte
      counting - both the running-total ack and progress reporting - can
      stay in terms of the whole file's absolute position, not just what
      one connection itself transferred. Distinct from pause/resume in the
      previous item: this is a *new* connection continuing an *old* file
      after the transfer stopped entirely (app restart, dropped connection,
      crash), not one already-open connection being told to keep going
- [x] Configurable download directory and port range (for active mode/NAT) -
      both live in Preferences and, unlike retentionDays, apply immediately
      rather than needing a restart: download directory (empty defaults to
      the OS Downloads folder, same as before this existed) and a DCC port
      range for the listener DCC CHAT offers and passive/reverse XDCC
      accepts open (`dcc.Listen` now tries ports across a min-max range
      instead of always taking whatever the OS hands out), letting a user
      behind NAT forward one fixed range in their router instead of a
      different random port every time. Neither is pushed to the Go backend
      as standing config - both are read fresh out of Settings in Electron's
      main process and passed as plain arguments on each `dccOffer`/
      `xdccAccept` call, the same way `destDir` already worked before this.
      Doesn't touch `LocalIP`'s own known limitation (still announces the
      LAN address, not the actual public one) - a fixed port range is what
      makes forwarding *possible*, not a fix for NAT traversal itself
- [x] Basic pack-list browsing quality-of-life (search across known XDCC bots,
      if feasible without violating any bot's own rules) - reuses the
      existing history Search wholesale rather than adding a second search
      path: every XDCCPACK a bot's LIST reply produced is already a
      structured, persisted history row (see the XDCC LIST item above), so
      it was already reachable by plain text search, just rendered as raw
      JSON and only "jump to this bot's query" on click. Now a hit renders
      as the same 📦 row MessageArea shows live, and clicking one requests
      the pack directly (switching to that server/bot first, since a global
      hit isn't necessarily on the currently selected one) instead of just
      navigating. A new "Packs only" toggle filters to just those hits
      client-side (the backend search has no notion of an event's type to
      filter by - see history.Store.Search) and asks for a wider result
      limit to compensate for filtering after the fetch. Never contacts a
      bot beyond LIST requests the user already made themselves - this
      searches what's already been received and kept, nothing scraped or
      requested fresh - which is what keeps it inside "without violating
      any bot's own rules": no bot is being LIST-spammed or fetched from
      behind the scenes on the search's behalf

---

## Milestone 4 — Customization & polish

- [x] Preferences beyond M1's basics: keybinding customization, sound alerts,
      per-server color overrides, font size/family - four distinct enough
      preferences that this was worked through one at a time rather
      than as a single pass.
      - [x] Font size/family - Font Size is Electron's own whole-window page
            zoom (`webContents.setZoomFactor`, via a new `setZoomFactor` IPC
            action), not a CSS font-size: almost every text size in this app
            is a fixed Tailwind px value, not rem/em, so a root font-size
            change would visibly do nothing to most of the UI - zoom scales
            text *and* layout uniformly instead, same as a browser's own
            Cmd/Ctrl +/-. Font Family (System Default/Serif/Monospace) is a
            plain CSS custom property instead (`--dolq-font-family`,
            index.css) - no layout-scale concern there, so plain CSS is
            enough. Both are renderer/zustand-store state applying live,
            same pattern Timestamp Format/Message Density already use, not
            part of the main-process-owned `Settings` object's save/cancel
            flow. Verified against the real running app (Playwright
            `_electron`): picking "Large"/"Monospace" from the real
            Preferences selects actually changed the window's live zoom
            factor and the CSS variable, not just local component state
      - [x] Sound alerts - the OS's own system alert sound (Electron's
            `shell.beep()`, via a new `playAlertSound` IPC action), not a
            bundled audio asset or a synthesized Web Audio tone - both
            unnecessary when the platform already has one the user can
            already control/replace at the OS level, same reasoning as
            reusing `app.setBadgeCount` over a hand-drawn tray badge. A
            separate `soundAlertsEnabled` toggle from `notificationsEnabled`
            (some people want one but not the other), same trigger point in
            `checkMention` though, so it inherits per-channel mute for free.
            Verified against the real running app: spied on `shell.beep` in
            the main process and confirmed `window.irc.playAlertSound()`
            actually reaches it, and that the new Preferences checkbox
            renders and toggles
      - [x] Per-server color overrides - the server icon (ServerList) only:
            it's the one place `#c792ea` (the app's default accent) marks
            "which server," everywhere else that purple shows up is
            server-agnostic UI (modals, checkboxes) where a per-server color
            wouldn't mean anything. A hex string on the `Server` object
            itself (`color?`, already part of the persisted `servers`
            array, no new store key needed), set via a native
            `<input type="color">` behind a "Change Color…" item on the
            existing per-server context menu - the OS's own color picker
            instead of building one. Applied through a `--server-accent`
            CSS custom property so Tailwind's `bg-[var(--server-accent)]`
            stays a static class (Tailwind can't generate arbitrary-value
            classes from a runtime hex string) - unset falls back to the
            same purple every server already used. Verified against the
            real running app (Playwright `_electron`): opened the real
            context menu, drove the hidden color input the same way the OS
            picker would (native value setter + a real `change` event, since
            a plain `.value =` gets swallowed by React's controlled-input
            tracking), and confirmed both the live CSS variable and the
            persisted store value updated
      - [x] Keybinding customization - four global shortcuts (Next/Previous
            Channel, Close Current Channel, Toggle Mute), the actions this
            app already exposes via click/context-menu that make sense to
            fire from anywhere; not a general-purpose remapper for every
            existing shortcut. Default bindings all use Alt (`Alt+ArrowDown`
            etc.) so they never collide with normal typing in the message
            box. A shared `comboFromEvent` (utils/keybind.ts) requires a
            modifier key and builds the same combo string used both to
            record a new binding in Preferences and to match a keypress in
            App.tsx's listener, one definition for both. Rebinding is a
            click-then-press-keys row per action, Esc cancels; no collision
            check if two actions end up on the same combo (see the
            `note:` comment at the call site) and no reset-to-default
            button - both are easy to add later if anyone hits them. Verified
            against the real running app (Playwright `_electron`): opened
            the real Preferences panel, entered recording mode on "Next
            Channel", pressed Alt+N, and confirmed the button's label
            actually updated to the new combo
- [x] System tray icon (minimize to tray, unread badge count) - the window's
      close ("X"/red traffic light) button now hides instead of destroying
      it (`createWindow`'s own `close` listener, main/index.ts), same shape
      most tray apps use; a click on the tray icon toggles it back, and its
      context menu offers "Show Dolq"/"Quit" explicitly. This also fixes a
      pre-existing rough edge on macOS: without this, closing the window
      actually destroyed it (Electron's default), so reopening via the dock
      icon built a brand new one - now the same instance survives, kept
      alive rather than recreated. A single module-level `quitting` flag
      (set by `before-quit`, already idempotent from before this existed)
      is what tells "the user clicked close" apart from "the app is
      actually quitting" - reused rather than adding a second one. Unread
      badge count reuses `mentionedChannels` (the only "unread"-shaped
      signal this app tracks) via `app.setBadgeCount` - macOS/Linux(Unity)
      only; Windows needs a taskbar overlay icon instead (a different API),
      not implemented here, same gap the Windows/Linux parity item already
      tracks. Verified end to end with a scripted Playwright `_electron`
      run (headless, no real menu bar to screenshot): setBadgeCount round-
      trips through the real IPC path, closing the window leaves it un-
      destroyed and hidden, and showing it again brings it back
- [x] Desktop notifications with per-channel mute - picked as the smallest,
      most self-contained item in this milestone: desktop notifications
      already existed (M1's mention detection), this just adds a per-channel
      override. `toggleMuteChannel` (store.ts) tracks muted channels the
      same way mentionedChannels already does - bare channel id, persisted
      like ignoredNicks since it's a standing preference. A muted channel's
      checkMention (App.tsx) returns before doing anything at all, not just
      before the notification - same as Discord, muting also suppresses the
      sidebar's unread highlight, not only the popup. Toggled from a
      channel's right-click menu (ChannelList), which already had the same
      shape of per-channel action for Join/Leave/Remove; a 🔕 shows next to
      a muted channel's name the same way a mention already shows its own
      dot. Scoped to channels only (not queries/DMs) since that's the only
      place checkMention/notify ever fire from today - a mute toggle for
      queries would mute something that can't notify in the first place
- [ ] Accessibility pass (keyboard navigation, screen reader labels, focus
      management in modals)
- [ ] Emoji picker (optional, since this is "Discord-like")
- [x] Light theme - the note this item used to have about a `2e` icon
      variant already sitting in `resources/` waiting for this didn't hold
      up: no such file exists (`resources/` only ever had the one icon set),
      so the app icon/tray icon stay theme-agnostic, same as before. The UI
      itself never had a theming abstraction to begin with - every color was
      a literal hex baked into each component's Tailwind classes - so this
      is a `--dolq-*` CSS custom property per structural role (backgrounds,
      borders, primary/secondary/dim/faint text), dark values on `:root`
      matching the app's original palette exactly (an unset/pre-this-setting
      persisted store still looks identical), light overrides under
      `:root[data-theme='light']` toggled by a new `theme` store field via
      App.tsx's effect. Accent purple, success/danger colors, the mention
      dot, nick colors, privilege-role colors and the mIRC color palette
      (IrcText.tsx) are deliberately left as plain hex, not themed - they're
      saturated enough to already read fine on both backgrounds, and a
      matching light-mode variant for all ~20 of those is real palette
      design work this pass didn't need, not just a mechanical var swap.
      The one exception: the mention *text* color (ChannelList) needed its
      own light value, since it's the one place one of those colors doubles
      as body text rather than a background/dot/badge - the dark-mode pale
      yellow fails contrast on a light sidebar. Caught and fixed the same
      class of bug more broadly for `text-white` (added for exactly one
      dark palette, hardcoded independent of the new tokens): kept literal
      on solid accent/semantic backgrounds where it stays legible either
      way, retheme everywhere else (headings, selected-row text, hover
      icons) that sits on a surface now going light. Verified against the
      real running app in both themes (Playwright `_electron`, seeded
      multi-server data through the store directly): confirmed dark mode
      renders unchanged and light mode is fully legible end to end -
      sidebar, topic bar, message area with nick colors, user list, and the
      full Preferences panel including a mentioned-channel row
- [x] `irc://`/`ircs://` link handling - `main/ircUrl.ts`'s `parseIrcUrl`
      reads the loose convention most IRC clients already use for these
      (`irc[s]://<host>[:<port>][/[<channel>][,<modifier>...]]`, both the
      percent-encoded and the technically-wrong-but-extremely-common bare
      "#channel" forms), deliberately not attempting to pull a password out
      of one - there's no standard, non-OS-history-visible place for a real
      link to carry one. Registered as dolq's protocol handler
      (`app.setAsDefaultProtocolClient`) for both schemes; a single-instance
      lock (`app.requestSingleInstanceLock`) means a link clicked while
      already running reaches the one running copy via `second-instance`'s
      argv (Windows/Linux) or `open-url` (macOS) instead of spawning a
      second dolq, and a cold start via a link is caught by scanning
      `process.argv` once at launch. The parsed host/port/secure/channel
      prefill the same "Add a Server" form a manual click already opens
      (`ConnectModal`'s new `initial` prop, channel going into
      autojoinChannels) - connecting is still the user's own explicit
      action from there, same posture as accepting a DCC/XDCC offer, not an
      auto-connect. `parseIrcUrl` has its own test suite; the full path
      (a real `open-url` event through to the form actually pre-filled) was
      also checked end-to-end with a scripted Playwright `_electron` run

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

- [x] Chat history and connection status don't survive an app restart at all
      today (`messageMap`/`statusMap` aren't in `store.ts`'s `partialize`) -
      chat history turned out to already be covered by Milestone 1's
      persistence work (SQLite + `getHistory`, preloaded off the persisted
      `selectedChannelId`, not `messageMap`); connection status was the real
      remaining gap. `dolqd` itself doesn't survive a restart the way it
      survives a renderer-only reload (`before-quit` PARTs/QUITs every
      session on the way out), so the existing hydration-reconcile effect's
      `getStatus` check came back `disconnected` for every server, and
      nothing ever turned that into a new connection. That effect now
      auto-reconnects: any server that isn't already `connected` gets dialed
      with its persisted host/nick/SASL/etc., the same `connect()` call
      `connectToServer` (the manual Connect button) makes - pulled into a
      shared `connectServer` helper so both paths stay identical. No new
      "was connected at quit" flag - since a real restart always starts
      every server `disconnected` regardless of whether it was connected or
      manually left disconnected before quitting, there'd be nothing to key
      it off; every configured server just gets dialed on launch, same as
      most IRC clients' default. A dial failure (bad host, network down) is
      caught per-server so one dead network doesn't stop the rest from being
      attempted, leaving it `disconnected` for the user to retry manually
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
- [x] "Add a Server" defaulted Name/Host to a real, silently-connectable
      value (`Localhost`/`localhost`) instead of an empty field - clicking
      Connect without editing anything (easy to do without noticing, e.g.
      after typing just a nickname) dialed `localhost:6697` instead of
      whatever the user actually meant to connect to, surfacing as an
      opaque `dial tcp [::1]:6697: connect: connection refused` with no clue
      it was a form-default problem rather than a real connection failure.
      Both fields now start empty behind their existing placeholder text;
      the form's own empty-host submit guard turns "forgot to fill it in"
      into "can't submit" instead of "connects to the wrong thing." A
      manually-typed host with no Name given (a preset always fills Name
      in, so this only affects custom entries) now falls back to the host
      itself rather than leaving the server unnamed in the rail
- [x] Joining any channel with a plain (unprefixed) member went straight to
      a blank window - `ircparse.parseNames`'s `var privileges []PrivilegeLevel`
      left a nil slice for a NAMES entry with no `@`/`+`/etc. prefix, which
      Go's `encoding/json` marshals as `null`, not `[]`; the renderer's
      `highestPrivilege` called `.reduce` on that unconditionally and
      crashed the whole tree with no error boundary to catch it. This hit
      essentially every real channel (any regular member, not just an edge
      case), reproduced live against Libera's `#libera`. Fixed at the
      source (`privileges := []PrivilegeLevel{}`, never nil) and, since
      this is IPC-deserialized data that only ever *looked*
      type-safe at compile time, hardened `highestPrivilege` itself
      (`(privileges ?? [])`) rather than trusting every future caller to
      remember. Three existing Go test cases, across both `ircparse` and
      `ircclient`, had baked the old nil-means-omitted behavior into their
      fixtures and needed updating alongside the fix

---

## Non-goals (for now)

- Docker client deployment (always on experience by connecting the App to IRC
  server through middle-man)
- Built-in IRC bot
