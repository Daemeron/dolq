# App and internet

Apart from the backend, the app reaches the internet in exactly three ways: it **checks for updates**, it **fetches a
web page when you ask** (a packlist), and it **opens a link in your browser**. It also **receives** `irc://` links from
the operating system. Nothing else: there is no analytics or telemetry call anywhere in the source.

The window is not allowed to reach out by itself. Its content security policy is `default-src 'self'`, so it cannot
fetch from another origin. Anything on the internet goes through the main process, where it can be limited.

## Checking for updates

```mermaid
sequenceDiagram
    autonumber
    participant M as Main process (updater)
    participant G as GitHub Releases
    participant W as Window
    actor U as You

    Note over M: 20 s after launch, then every 4 hours,<br/>and only if "check for updates" is on in Preferences
    M->>G: GET https://github.com/Daemeron/dolq/releases/latest/download/latest.yml<br/>(latest-mac.yml or latest-linux.yml on those systems)
    G-->>M: the newest version and where its file is
    alt it is newer than this one
        M-->>W: update status "available", version
        W-->>U: a notice with the version
        alt this system can replace itself (Windows, an AppImage)
            U->>W: Download
            W->>M: downloadUpdate
            M->>G: GET the installer
            G-->>M: file
            M-->>W: status "downloaded"
            Note over M: installs when you quit, or at once on "Restart and update"
        else macOS or a .deb package
            Note over W: it can only tell you a version is out, with a link to the release page
        end
    else up to date
        Note over M: nothing is shown
    end
```

### Notes

1. **The feed is the latest release's own files.** No update server exists: the release workflow uploads `latest.yml`
   and friends next to the installers, and `latest/download` always points at the newest release. Publishing a
   release is what publishes the update.
2. **Nothing downloads on its own** unless you switched on "download updates automatically". A failed download goes
   back to being offered.
3. **No signing.** On macOS the app is not signed, so it cannot replace itself there; it only announces the release.
4. The check is the only request the app makes without you doing something, and it sends nothing about you beyond what
   an HTTPS request to GitHub contains.

## Opening a link

```mermaid
sequenceDiagram
    autonumber
    actor U as You
    participant W as Window
    participant M as Main process
    participant OS as Operating system
    participant Br as Browser

    U->>W: click a link in a message or the topic
    W->>M: irc:openExternal(url)
    M->>M: is it http or https? (checked here again, not trusted from the window)
    alt yes
        M->>OS: shell.openExternal(url)
        OS->>Br: open it
    else any other scheme
        M-->>W: refused
    end
```

## Fetching a packlist

An XDCC bot's packlist is often a web page. The window cannot fetch it, so the main process does, for that one request.

```mermaid
sequenceDiagram
    autonumber
    actor U as You
    participant W as Window
    participant M as Main process
    participant S as the packlist web server

    U->>W: open a packlist URL
    W->>M: irc:fetchPage(url)
    M->>M: http or https only
    M->>S: GET url (15 s limit)
    S-->>M: page
    alt the answer is not 2xx
        M-->>W: error "the page answered HTTP …"
    else more than 5,000,000 characters
        M-->>W: error "the page is too large"
    else
        M-->>W: the text
        W->>W: pull pack lines out of it (ParseListLine), offer them to request
    end
```

The whole body is read before the size check, which is a known shortcut: a huge page costs memory before it is refused.

## `irc://` links from outside

Clicking an `irc://` or `ircs://` link in a browser should open Dolq on that server and channel. This is the only inbound
path the operating system has into the app.

```mermaid
sequenceDiagram
    autonumber
    participant OS as Operating system
    participant M as Main process
    participant W as Window
    actor U as You

    Note over M: at start-up Dolq registers itself as the handler for irc and ircs
    alt macOS
        OS->>M: open-url event with the link
    else Windows or Linux, Dolq already running
        OS->>M: starts a second copy, which hands its arguments over (second-instance) and exits
    else Windows or Linux, Dolq not running
        OS->>M: starts Dolq with the link in its arguments (cold start)
    end
    M->>M: parse irc(s)://host:port/channel (a bad or unknown scheme is ignored)
    M-->>W: openIrcUrl (host, port, secure, channel)
    W-->>U: the Add Server dialog, filled in, ready to connect
```

The link only **fills in a form**. It never connects by itself, so a link on a web page cannot make Dolq join a server.

## Code

- `src/main/updater.ts`, `src/main/index.ts` (`registerUpdateHandlers`), `electron-builder.json5` (the feed URL)
- `src/main/index.ts`: `irc:openExternal`, `irc:fetchPage`, `handleIrcUrl`, `second-instance`, `open-url`
- `src/main/ircUrl.ts`: link parsing
- `src/renderer/index.html`: the content security policy
