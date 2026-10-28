# Dolq design system

The look of the app: Claude-style warm neutrals, one clay accent, and colour only where it identifies something (server icons and nicknames). Light and dark share the same token names.

- `preview.html`: open in a browser for every token and component, with a light/dark toggle.
- `reference.css`: the prototype stylesheet the design was approved in. It is a reference only; the app uses the tokens in `src/renderer/src/index.css`.

## Where things live

| What | Where |
| --- | --- |
| Tokens (both themes) | `src/renderer/src/index.css` (`:root` is dark, `[data-theme="light"]` is light) |
| Shared pieces | `components/Icon.tsx` (icons, `IconButton`), `components/ChannelList.tsx` (`RowButton`), `components/ContextMenu.tsx` |
| Dialog pieces | `components/ViewPanel.tsx` (the dialog), `components/ui.tsx` (`Button`, `Field`, `Switch`, `Card`, `Setting`, `Tabs`, `Segmented`, `inputClass`) |
| Nick colours | `utils/nickColor.ts` |
| Message grouping | `utils/groupMessages.ts` |

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
| `--dolq-accent` (+ `-hover`, `-soft`, `on-accent`) | #D97757 | #C6613F | Primary actions, focus, unread |
| `--dolq-ok` / `--dolq-warn` / `--dolq-danger` | green / amber / red | | Connection state, errors |
| `--dolq-nick-1`..`8` | brighter set | deeper set | Nick and avatar colour |

Type: Inter for the interface (the Font Family preference still overrides `--dolq-font-family`), Newsreader for view titles (`--dolq-font-serif`), JetBrains Mono for code and logs.
Shape: 8px controls, 12px cards, 16px composer, 13px server icons.

## Rules

1. **Colour is identity.** Only server icons and nick/avatar colours are colourful. Everything else is neutral plus the accent.
2. **Connection state lives on the server icon.** A badge in the bottom-right corner: green connected, amber connecting, grey disconnected. Its tooltip (`data-tip`) says which. Connect/disconnect is in the server's context menu and the toolbar power button.
3. **Toolbar.** Conversation actions (search, mute, export, connect, members) sit top right in the header, as icon buttons with a tooltip. Use `IconButton`; give it `on` for a toggled state.
4. **Tooltips** are CSS-only: add `has-tip` and `data-tip="..."` (plus `tip-right` to open sideways).
5. **Scrollbars** are global: invisible until the scroller is hovered, then thin and rounded. Do not style scrollbars per component.
6. **Messages group** when the same person sends plain chat lines within five minutes of the previous line. Only the first shows avatar, name and time; the rest show their time on hover. Events, notices, actions and pack lists never group.
7. **Focus** uses a 2px accent outline (`:focus-visible`), so keep real buttons and inputs.
8. **Every UI component change ships with a test** next to it.
9. **Dialogs are one shape.** Build them with `ViewPanel`: a serif title, an optional description, the body, and a footer on the panel colour with the actions on the right (`Cancel` as ghost, the main action as primary). Settings are rows of a `Card`: a `Setting` has a title and a description on the left and its control on the right. Switches are `Switch`, never a bare checkbox. Titles are sentence case.
10. **Overrides need a layer.** Rules in `index.css` that Tailwind utilities must be able to override (the tooltip, the focus outline) live in `@layer`; an unlayered rule beats every utility.

## Adding to the system

Add the token to both themes in `index.css`, document it in the table above, and show it in `preview.html` and `reference.css` if it introduces a new component style.
