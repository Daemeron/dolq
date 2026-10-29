# Dolq design system

The look of the app: Claude-style warm neutrals, one orange brand colour, a yellow accent reserved for settings forms, and colour only where it identifies something (server icons and nicknames). Light and dark share the same token names.

- `preview.html`: open in a browser for every token and component, with a light/dark toggle.
- `reference.css`: the prototype stylesheet the design was approved in. It is a reference only; the app uses the tokens in `src/renderer/src/index.css`.

## Where things live

| What | Where |
| --- | --- |
| Tokens (both themes) | `src/renderer/src/index.css` (`:root` is dark, `[data-theme="light"]` is light) |
| Shared pieces | `components/Icon.tsx` (icons, `IconButton`, with `compact` for the title strip), `components/ChannelList.tsx` (`RowButton`), `components/ContextMenu.tsx` |
| Window chrome | `components/TitleBar.tsx` (the strip on top), `hooks/useNavHistory.ts` + `utils/navHistory.ts` (back and forward), `utils/locationTitle.ts` (the title), `src/main/windowFrame.ts` (frame options per platform) |
| Dashboard | `components/DolqMark.tsx` (the logo), `components/Dashboard.tsx`, `components/Sparkline.tsx`, `components/BandwidthChart.tsx`, `hooks/useRateHistory.ts`; numbers from `utils/latency.ts`, `utils/transferRate.ts`, `utils/sparkline.ts`, `utils/bytes.ts` |
| Server icon | `components/ServerAppearance.tsx` (letters and colour in Edit server), `utils/server.ts` (`serverColor`, `serverIconText`) |
| Dialog pieces | `components/ViewPanel.tsx` (the dialog), `components/ui.tsx` (`Button`, `Field`, `Switch`, `Card`, `Setting`, `Tabs`, `Segmented`, `inputClass`) |
| Nick colours | `utils/nickColor.ts` |
| Message grouping | `utils/groupMessages.ts`; folded joins and leaves: `utils/membershipGroups.ts`, `components/MembershipSummary.tsx` |

Use tokens through Tailwind's variable syntax, e.g. `bg-(--dolq-bg-panel)`, `text-(--dolq-text-dim)`. Never hard-code a hex in a component; if a colour is missing, add a token to both themes.

## Tokens

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--dolq-bg` | #262624 | #FAF9F5 | Main surface |
| `--dolq-bg-panel` | #1F1E1D | #F3F1EA | Channel list, members |
| `--dolq-bg-panel-alt` | #191918 | #ECE9E0 | Server rail |
| `--dolq-bg-input` | #30302E | #FFFFFF | Inputs, composer, menus |
| `--dolq-bg-row-hover` / `-selected` | 6% / 11% light | 5% / 9% dark | Row states |
| `--dolq-border` / `-strong` | 11% / 22% | 12% / 22% | Dividers / input borders |
| `--dolq-text` | #FAF9F5 | #141413 | Primary text |
| `--dolq-text-muted` | #D3D1C7 | #3D3D3A | Secondary text |
| `--dolq-text-dim` | #A09E95 | #6B6963 | Labels, meta |
| `--dolq-text-faint` | #7E7C75 | #7C7A72 | Placeholders, hashes |
| `--dolq-brand` (+ `-hover`, `-soft`, `-text`, `-text-hover`, `on-brand`) | #D97757 | #C6613F | The app's everyday colour: primary actions (`Button primary`), the send button, unread and mention badges, links, inline code, the focus ring, mention rows, search matches, progress, the latency graph |
| `--dolq-accent` (+ `-hover`, `-soft`, `on-accent`) | #F5C518 | #E0AC00 | **Settings forms only**: switches that are on, the active tab underline, a focused input's border and glow, and the settings forms' own action (`Button accent`: Save in Preferences, Edit server, Connect). Never anywhere else |
| `--dolq-ok` / `--dolq-warn` / `--dolq-danger` | green / amber / red | | Connection state, errors |
| `--dolq-nick-1`..`8` | brighter set | deeper set | Nick and avatar colour |

Type: Inter for the interface (the Font Family preference still overrides `--dolq-font-family`), Newsreader for view titles (`--dolq-font-serif`), JetBrains Mono for code and logs.
Shape: 8px controls, 12px cards, 16px composer, 13px server icons.

## Rules

1. **Colour is identity.** Only server icons and nick/avatar colours are colourful. Everything else is neutral plus the brand colour (orange); yellow is the accent for settings forms only. A server icon takes its colour from the nick palette by default (stable per server); the user can pick another palette colour and 2-3 letters in Edit server.
2. **Connection state lives on the server icon.** A badge in the bottom-right corner: green connected, amber connecting, grey disconnected. Its tooltip (`data-tip`) says which. Connect/disconnect is in the server's context menu and the toolbar power button. The Dashboard lists the same states with latency.
3. **Toolbar.** Conversation actions (search this channel, mentions, mute, export, connect, members) sit top right in the header, as icon buttons with a tooltip. App-wide actions do not belong here; they go in the title strip (rule 11). Use `IconButton`; give it `on` for a toggled state.
4. **Tooltips** are CSS-only: add `has-tip` and `data-tip="..."` (plus `tip-right` to open sideways).
5. **Scrollbars** are global: invisible until the scroller is hovered, then thin and rounded. Do not style scrollbars per component.
6. **Messages group** when the same person sends plain chat lines within five minutes of the previous line. Only the first shows avatar, name and time; the rest show their time on hover. Events, notices, actions and pack lists never group.
7. **Focus** uses a 2px brand-colour outline (`:focus-visible`), so keep real buttons and inputs.
8. **Every UI component change ships with a test** next to it.
9. **Dialogs are one shape.** Build them with `ViewPanel`: a serif title, an optional description, the body, and a footer on the panel colour with the actions on the right (`Cancel` as ghost, the main action as primary). Settings are rows of a `Card`: a `Setting` has a title and a description on the left and its control on the right. Switches are `Switch`, never a bare checkbox. Titles are sentence case.
10. **Overrides need a layer.** Rules in `index.css` that Tailwind utilities must be able to override (the tooltip, the focus outline) live in `@layer`; an unlayered rule beats every utility.

11. **The title strip is for the whole app.** A 32px strip above everything, on the server rail's colour, with a bottom border; it drags the window. Left: back and forward arrows (the places visited in the main area: the Dashboard and conversations; an arrow with nowhere to go is dimmed). Middle: where you are, as plain text (`#channel · Server`, `@nick · Server`, `Server log · Server`, `Dashboard`, `Preferences`), never a heading, since the page below has its own. Right: the app-wide actions as `compact` icon buttons (search everywhere, transfers, away on all servers, preferences), then the window buttons. macOS puts its traffic lights at the far left, so the arrows move past them; Windows and Linux draw the native window buttons at the right (kept native so Windows 11 snap layouts work). Add a new global action here, not in a conversation header. Headers below the strip never make room for window buttons. Hovering (or focusing) the Transfers button shows a small card under it with what is transferring right now: file, sender, progress and speed, up to four with a "+N more" line, or "Nothing is transferring." It is hidden while the Transfers panel is open.
12. **The Dolq logo opens the Dashboard.** The logo is the dagger mark alone (`DolqMark`, drawn in the text colour, no background tile) so it reads on both themes; it is dim until hovered or open. It is the first entry in the server rail, set apart from the servers by a divider, and shows the selected ring while the Dashboard is open (no server looks selected then). The Dashboard is the one place without the channel list and user panel: it is about all servers, not one. The Dashboard is a page, not a dialog: summary stats (servers connected, download rate, upload rate), a Bandwidth card (download in violet (`--dolq-download`), upload in `--dolq-nick-3`, both on one scale from zero, the peak at the top right, the last five minutes sampled every two seconds), then one card per server with status, current latency, a latency trend (`Sparkline`, brand colour) with min/avg/max, and its joined channels as chips that jump to the channel. Latency reads green under 150 ms, amber under 400 ms, red above.
13. **The server log separates connection sessions.** The line after `*** Disconnected` or `*** Connection lost` starts a new session, and is preceded by a divider with generous space above it: a rule on each side of a brand-soft pill reading NEW SESSION (the brand colour, small caps, tracked). It is the one place the log uses the brand colour; keep the rest of the log neutral monospace.
14. **Busy channels fold their membership lines.** Three or more joins, parts, quits and nick changes in a row (within one day) become one summary line, so the conversation around them stays readable: who joined, who left, who quit, who changed nick, naming up to three people and counting the rest ("nolden, MintCarrot and 2 others joined · warrior left"), with the event count and the time it lasted. It is a button; opening it shows every line, in place. One or two lines stay as they are, and your own join, part and quit lines are never folded. The "Show joins and leaves" preference still hides them all.
15. **A choice that belongs to an action sits on the action.** The file offer's Accept is a split button: the main part accepts, a chevron attached to its right edge opens a small menu above it with the ways to accept ("Accept this file only", "Accept from nick for this session", "Always accept from nick"; a check marks the current one). Picking one only changes the button ("Accept", "Accept for session", "Always accept"); a second click on the button accepts. The chevron is there only when the sender can be recognised. Escape closes the menu first, and only a second press declines the offer. Do not put such options as small links in the dialog body.

## Adding to the system

Add the token to both themes in `index.css`, document it in the table above, and show it in `preview.html` and `reference.css` if it introduces a new component style.
