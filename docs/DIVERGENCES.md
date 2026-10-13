# Divergences from WordCraft

The package ships upstream WordCraft compiled to WebAssembly, pinned to the commit in [`UPSTREAM_REV`](../UPSTREAM_REV), with a small patch series on top ([`patches/`](../patches)). Everything not listed here behaves exactly as in WordCraft's own web app.

Each row says where the difference lives:

- **Patch:** a change to WordCraft's code, in `patches/`. Each patch is written so it could be offered upstream.
- **Package:** code in this package around the editor (React, TypeScript, or the `wordcraft-embed` crate). WordCraft itself is unchanged.
- **Config:** a different default setting.

Rows marked ✦ are **Extras**: features that are not part of Microsoft Word or WordCraft.

## Editing and interface

| Area | WordCraft | This package | Where |
|---|---|---|---|
| Mini toolbar contents | Two rows: font, size, Grow and Shrink; B I U S, highlight, font colour, alignment | Adds Bullets, Numbering and New Comment to the second row, as on Windows | Patch 0005 |
| Mini toolbar with the right-click menu | Hidden while the menu is open | Shown above the menu, as on Windows | Patch 0005 |
| Vertical ruler | Measures the caret's page only, so it goes blank once that page scrolls away | Measures the page in view when the caret's page is off screen | Patch 0005 |
| Double-clicking a ruler | Opens the Tabs dialog on a tab marker | Also opens Page Setup elsewhere on either ruler, as in Word | Patch 0005 |
| Font box | One list of installed fonts, previewed in their own faces | Theme Fonts, Recently Used Fonts and All Fonts sections, as in Word, plus web fonts with previews ✦ | Patches 0003, 0005 |
| Ribbon collapse | Ribbon Display Options | Also Word's ^ button: tabs and ruler stay, a tab click opens the ribbon over the page, and the pin keeps it open | Patch 0004 |
| Editing / Reviewing / Viewing | Editing and Reviewing | Adds Viewing, a real read-only mode, and shows each item on two lines as Word does | Patch 0003, 0005 |
| Clicking a comment | Selects the comment card | Also moves the caret to the commented text | Patch 0003 |
| Title bar text | The name and "Saved" joined by a long dash | "Name • Saved", as in Word; a click opens Version History when it is on | Patch 0005 |
| Command search results | Command and location joined by a long dash | "Bold · Home › Font" | Patch 0005 |
| Discord link in the title bar | Shown | Hidden by default (`prefs.showDiscord`) | Config |

## Host app controls

| Area | WordCraft | This package | Where |
|---|---|---|---|
| Title bar and ribbon | Always shown | Can be hidden by the host (`titleBar`, `ribbon`) | Patch 0001 |
| Ribbon tabs | All tabs | The host chooses which show (`tabs`, `hiddenTabs`) | Patch 0003 |
| Commands | All available | The host can turn commands off; they are greyed and refused (`disabledCommands`) | Patch 0003 |
| User name | Set in File › Options | Set by the host (`user`) and shown on the avatar | Package |
| Opening the editor | A full page app | Mounts inside any element; React component and framework-agnostic core; safe with server rendering | Package |

## Saving and files

| Area | WordCraft | This package | Where |
|---|---|---|---|
| Save, Save As, Export | Download the file, or keep it in browser storage | Hand the file to the host (`onSave`), which can store it anywhere; downloads only without `onSave` | Patch 0001, Package |
| AutoSave on the web | Into browser storage | Through the host, as Word does for cloud files | Patch 0001 |
| Version history ✦ | A `file.versions` command with no interface | A Google Docs-style panel: versions recorded as you work, view, restore, name, download, delete; kept in the browser or on your server | Patch 0005, Package |

## Collaboration

| Area | WordCraft | This package | Where |
|---|---|---|---|
| Real-time co-editing ✦ | Not available yet | Yjs CRDT with any provider; per-person undo; live cursors and avatars; one shared file with AutoSave | Patch 0002, Package |

## Fonts

| Area | WordCraft | This package | Where |
|---|---|---|---|
| Web fonts ✦ | The fonts built into the web build | The Google Fonts library (about 1,900 families) on demand, or your own `FontSource`; fonts a document uses load by themselves | Patches 0003, 0005, Package |
| Recently used fonts | Per session | Kept in the browser, as Word keeps them per user | Package |

## AI

| Area | WordCraft | This package | Where |
|---|---|---|---|
| AI writing ✦ | Not available (upstream gap #25) | A Gemini-style bar opened by a sparkle at the bottom centre: quick actions, templates, streaming answers | Package |
| AI Studio ✦ | Not available | Writing skills (Humaniser on by default, custom skills, SKILL.md import), letterheads, brand palettes, model and key | Package |
| AI providers ✦ | Not available | Your endpoint, or people's own OpenRouter, OpenAI, Anthropic, Gemini or OpenAI-compatible key | Package |
| AI ribbon button | Not available | Optional sparkle beside Comments (`ai.ribbonButton`) | Patch 0004 |

## Access, comments and presence

| Area | WordCraft | This package | Where |
|---|---|---|---|
| Access levels | Restrict Editing (read only, comments, tracked changes) chosen in the document | A `permission` prop (view, comment, suggest, edit) the host sets and changes live, with a chip and a notice; it drives Restrict Editing and the mode, and locks the switches | Package |
| Comments panel ✦ | Word's comment cards in the margin | Also a panel of threads with filters (Open, Resolved, Mine, Mentions me, author), @mentions with a people picker, Assign to, and a store adapter for every change | Package |
| Presence avatars ✦ | Collaborators' avatars in the title bar (patch 0002) | Also a row at the bottom right with idle state, a `+n` counter and following, and `onPresenceChange` for the host | Package |
| Reading the document ✦ | Not exposed to a host | `editor.paragraphs()`, `editor.comments()`, `selectText` and marks over the text (`setMarks`) for host panels | Package |
| Organisation letterhead | Not available | `ai.letterhead` is the organisation's, read live; a person's edits are a separate override with Reset; `letterheadLocked` and `onLetterheadApplied` | Package |
| Web Layout width | Always 800pt | Follows the window, as in Word (Mobile View on phones) | Package |

## Phones and tablets

| Area | WordCraft | This package | Where |
|---|---|---|---|
| Phone layout ✦ | The desktop interface at any size | Below 600px on a touch screen, Word for Android's shape: title bar, page, bottom command palette with tab switcher, drill-in pages and contextual Table, Picture and Shape tabs; switches live on foldables (`mobile`) | Package |
| Status bar | Always shown | Can be hidden (`prefs.hideStatusBar`); the phone layout hides it | Patch 0006 |
| Touch on the page ✦ | A finger acts as a mouse, so a drag selects text | A drag scrolls and flings, a tap places the caret, a long press selects a word, handles adjust the selection, two fingers zoom | Package |
| Selection on screen ✦ | Not reported | `editor.onSelection()` and `selectionInfo()` give its place in CSS pixels and the contextual tabs, for floating toolbars | Package |
| Floating toolbar on phones ✦ | The mini toolbar | Cut, Copy, Paste (through the system clipboard), Comment and Format over a touch selection | Package |
| Dictation ✦ | Not available (Word's Dictate is a parity gap) | A microphone button types what you say, where the browser offers speech recognition | Package |
| Camera ✦ | Not available | Insert › Camera puts a photo from the phone's camera into the document | Package |

## Not included

These parts of WordCraft are not in the package, because they need a desktop or a server:

- The desktop apps' native file dialogs, printing through the system and window management.
- The MCP server, the command-line tool and the control channel. The same command registry is available through `editor.execute()`.
