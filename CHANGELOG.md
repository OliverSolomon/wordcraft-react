# Changelog

Every published version of `@gamine/wordcraft-react`, newest first. Versions follow the rule in [docs/VERSIONING.md](docs/VERSIONING.md): each release bumps the patch number (0.3.0, 0.3.1, 0.3.2…), and the minor number moves only when a version is declared stable. Automatic upstream syncs add their own entries.

Features marked ✦ are Extras: additions of this package that are not part of Microsoft Word or WordCraft. [docs/DIVERGENCES.md](docs/DIVERGENCES.md) lists every way the package differs from WordCraft.

## 0.3.6 (2026-10-17)

- **Upstream WordCraft** moved to `eae2421` (308 commits). Highlights: a pure header and footer design with a page parameter, pictures leave the caret after them, and `krilla` comes from craft-libs. The patches were rebased; Cargo.toml now copies upstream's `[patch.crates-io]` on every sync. Upstream now opens on Home whenever preferences are applied, so `setPrefs` keeps the tab (and the File view) showing unless the change names one.
- **Comments owned by your app** ✦ (`comments: { exclusive: true }`, or `nativePane: false`):
  - **The native pane never opens**, from the selection toolbar, ribbon, right-click menu, Ctrl+Alt+M, phone palette or a balloon.
  - **Compose before create:** every New Comment asks for a composer on the selection, yours (`onRequestCompose`) or the package's drawer. Nothing exists until it is submitted with text; cancelling leaves nothing.
  - **A host API** outside the command ids: `editor.comments.create`, `reply`, `edit`, `delete`, `resolve`, `reopen`, `list`, `focus` and `onChange`, never blocked by `disabledCommands`.
  - **The drawer:** Edit and Delete are icons under the text, it fits any width, and `<CommentsDrawer/>` is exported on its own.
- **One `ui` prop** ✦ with a boolean for every surface: title bar, ribbon (with its tab row), status bar, selection toolbar, context menu, rulers, Navigation pane, the workspace row (Ask, Comments, Checks, Tools, Voice each), presence, Share, mode switch, zoom, page-view buttons, File menu and the phone palette. `false` removes the surface, its room and its shortcuts, live, with no remount. `ui="paper"` leaves the page alone. `ribbon` also takes `false`.
- **A headless API** ✦ for your own toolbar: `editor.state()`, `onStateChange`, `isActive` and `can`, plus `editor.onHostEvent`.
- **`icons`** ✦: your own icons for Ask, Comments, Checks, Tools, Voice, Share, Back and History.
- **Your own top bar** ✦ (`topBar`): left, centre and right zones of built-in items (back with an unsaved check, quick access, title, save state, presence in cursor colours with follow and "+N" and "Guest", Share with a disabled reason, the user menu, comments, history) and your own buttons and components. At narrow widths the title shortens first, then avatars collapse, then Share becomes an icon; nothing overflows at 360px. It can be a function of `{ permission, user, collaborators }`.
- **The File menu, item by item** ✦ (`fileMenu`): show, hide, rename, disable with a reason, replace with your action, reorder, group into sections and add your own items. Share is a File item, and each export format has its own id (`export.pdf`, `export.docx`...). Hidden or disabled items' shortcuts are off. `onShare` takes Share from WordCraft's dialog.
- **Tests:** `smoke-host.mjs` runs ten New Comments in a row with no native pane, the drawer's and the host's composers, the switches toggled live, the File menu, the top bar at 1360px and 360px, two live collaborators, and a snapshot of the default chrome. The late letterhead check stays in `smoke-features.mjs`.

## 0.3.5 (2026-10-13)

0.3.5 brings together what was planned as 0.3.5, 0.3.6 and 0.3.7.

- **AI that builds structure** ✦ (`ai.structure`):
  - **Real structure:** answers go in as headings, nested lists, links, quotes, code and native Word tables, never as model HTML.
  - **An Insert menu and a `/` slash menu:** Table, Diagram, Chart, Timeline, Checklist, Callout, Equation, QR code, Image and Table of contents, plus Date, Divider, Page break, Signature line and your own actions (`ai.actions`).
  - **One panel for each:** a prompt, a data source (the prompt, the selection, the document, a pasted CSV or `ai.pickData`), a preview and the insert modes. In Suggesting the result is a tracked change.
  - **Tables from data:** values must come from the data, and anything else becomes `[to confirm]`. Beside the preview you can add or remove rows and columns, sort, apply number formats and add a totals row.
  - **Diagrams:** Mermaid (`ai.mermaid`, loaded on first use), rendered strictly and themed with the palette, with alt text. The source is kept in the picture's title for **Edit diagram**, and a diagram that fails offers **Ask AI to fix**.
  - **Native output:** charts are native Word charts and equations are Word equations. QR codes come from our own encoder.
  - **Images:** from `ai.generateImage` or `ai.imageSearch`, previewed first.
  - **Safety:** model output is validated, capped and sanitised; nothing runs and nothing is fetched.
- **A theme from a logo or photo** ✦:
  - **Finding colours:** five to eight swatches found in the browser, with roles, contrast warnings and a one-click fix, and a dark variant.
  - **Saving:** palettes are saved with their source and passed to `ai.onPaletteCreated`.
  - **Applying:** *Apply to document* writes the palette into the document theme (`theme1.xml`, so Design › Colors shows it), plus theme fonts. It recolours the title, headings, links, quotes and the AI's tables and callouts. *Apply to headings only* stays.
- **Logo placement** ✦ (a `LogoSpec` on the letterhead):
  - **Placements:** header left, centre or right; beside the text or above it; footer; a watermark behind the text (opacity, diagonal, repeat); a cover page; a side edge; at the cursor; a signature block.
  - **Pages and partners:** every, first, odd or even pages, and a row of partner logos.
  - **Preview and replacing:** a live mini page shows each preset, and applying again replaces rather than stacks.
  - **Shorthand:** `ai.brand = { logo, palette }`, and `onLogoChanged` for your app.
- **Ask this document** ✦ (`ai.chat`):
  - **Grounded answers:** a side panel answers from the document's passages (the whole document, this section or the selection). It sends only the passages that match, and citation chips scroll to and highlight their source.
  - **Actions:** Summarise, Key points, Action items, Explain this, Translate selection and Find where it says. Each answer can be inserted, used to replace the selection, copied or added as a comment.
  - **Storage:** a chat store (`ai.chatStore`) keeps the conversation.
- **Writing checks** ✦ (`checks` or `ai.checker`):
  - **Underlines and the card:** underlines by category, and a card with fixes, Dismiss, Ignore this rule and Add to dictionary.
  - **The panel:** a score, readability (Flesch), tone, and goals (audience, formality, domain including plain language, intent).
  - **Engines:** `plainLanguageChecker()` runs in the browser, alongside `languageTool({ url })` and `llmChecker(complete)`. There is no Grammarly adapter because its SDK closed in January 2024.
  - **When it runs:** checks run after a pause, are cached per paragraph, and never run in Viewing or on a sensitive document.
- **Originality** ✦ (`originality`):
  - **Sources:** your organisation's own documents (`corpus.search`), a plagiarism service (`checkPlagiarism`) and a soft AI-writing signal (`detectAi`) with its caveat.
  - **Actions:** Go to, Add citation and Rewrite.
  - **Safeguards:** the check is opt-in, results never go into the file and it never blocks anything.
- **Tools** ✦ (`tools`): side panels for:
  - an outline, with drag or Alt+Up and Alt+Down to move a section;
  - accessibility, using WordCraft's checker with its fixes;
  - sources and a bibliography;
  - word count with a goal;
  - voice typing;
  - a translated copy of the document.

  They open from **Tools** at the bottom right, or the phone layout's More menu.
- **Sensitive documents:** `sensitive` turns off everything that would send text.
- **API:** `editor.caret()` and `editor.selectedObject()`. Requests gain `history`, `goals`, `language` and `data`, and `ask`, `structure`, `check` and `translate` actions. `aiUserMessage` and `aiSystemPrompt` handle them all.
- **Patch 0007:** custom theme colours for Design › Colors, and first-page and even-page headers and footers by command.
- **Tests:** `smoke-extras.mjs` covers the acceptance cases (citations, checks, originality, theme, placement, tables, CSV data, diagrams, charts, the slash menu, permissions and sanitising). Unit tests cover blocks, QR codes, checks, contrast and prompts.

## 0.3.4 (2026-10-13)

- **Upstream:** synced to WordCraft `159b84f`, 150 commits since `62b58d1` (WordCraft 0.6.0 and 0.6.1):
  - **Tables:** mouse selection, insertion and moving, border and corner drags, double-click AutoFit, whole-cell selection, a table context menu, and ruler markers.
  - **Layout:** Word-like kerning and paragraph spacing.
  - **Reading and editing:** a paginated Reading Mode, Hide White Space, an Undo history list, a selection bar, Word's caret, and Ctrl+F in the Navigation pane.
  - **Languages:** French, German, Italian, Czech, Bulgarian and Polish interfaces, with more proofing languages.
  - **Files:** better .doc and RTF import, and metafile pictures.
  - **Fonts:** Add Font.
  - **Fixes:** many layout and file fixes.
- **Letterhead, plug and play:** `ai.letterhead` is the organisation's letterhead, read on every render, so one that loads after the editor shows at once and a changed one replaces it. A person's own edits are a separate override, saved only with a name and started from the letterhead shown, with *Reset to organisation letterhead*. New `ai.letterheadLocked` and `ai.onLetterheadApplied`. Applying twice replaces rather than stacks.
- **Access levels:** `permission` (`view`, `comment`, `suggest`, `edit`), enforced by the editor through Restrict Editing and the mode, changeable live with a notice when it goes down, and an access chip. `allowCopy` and `commentsVisibleToViewers` refine it; AI answers can be copied but not inserted below Suggest.
- **Comments** ✦: a Google Docs style panel with filters, @mentions and a people picker, Assign to, Resolve and Reopen, edit and delete, and a store adapter (`create`, `reply`, `update`, `resolve`, `remove`, `subscribe`) with `onMention` for notifications. Threads and resolved state survive a .docx round trip.
- **Presence** ✦: avatars at the bottom right with idle state, a `+n` counter and following (`editor.followPeer`), anonymous names for people without one, and `onPresenceChange` and `<PresenceAvatars>` for your own header.
- **API:** `editor.paragraphs()`, `editor.comments()`, `editor.selectText()`, `editor.setMarks()` and `editor.followPeer()`.
- **Web Layout** follows the window width, as in Word.
- **Docs site** in the shadcn/ui manner, with Access levels and Comments pages.
- **Tests:** `smoke-features.mjs` covers the letterhead, access levels, comments and marks, and the co-editing test now covers presence, following and shared comments.

## 0.3.3 (2026-10-12)

- **Phones and tablets** ✦: on a touch screen narrower than 600px the editor takes the shape of Word for Android (`mobile`, `'auto'` by default). A slim title bar (Undo, Redo, Mobile View, the palette, More) sits over the page, with a command palette at the bottom: a quick bar above the keyboard, and Home, Insert, Draw, Layout, Review and View tabs with Table, Picture and Shape when the selection calls for them. Fonts, colours, styles, margins, sizes, tables, shapes, links and comments open as pages inside the palette. It switches live as a phone turns or a foldable opens.
- **Touch on the page** ✦: a finger drags and flings the page, a tap places the caret, a long press selects a word, handles adjust the selection and two fingers zoom. A floating toolbar over a touch selection cuts, copies and pastes through the phone's clipboard.
- **On the phone** ✦: Find and Replace in place of the title bar, sharing the .docx through the phone's share sheet, Download as PDF, Word Count, photos from the camera, and dictation where the browser offers speech recognition. The bars slide away as you read down, and the palette rides above the keyboard.
- **API:** `editor.onSelection()`, `editor.selectionInfo()` and `editor.setTouch()`, and the `hideStatusBar` and `miniToolbar` preferences (patch 0006 hides the status bar).

## 0.3.2 (2026-10-12)

- **Upstream:** synced to WordCraft `62b58d1`, 95 commits since `1d4f741`. Word coverage rises from 402 of 434 to 482 of 497 catalogued features. The main additions:
  - **Insert:** SmartArt (list, process, cycle, hierarchy, pyramid, radial, matrix, venn), Chart (column, bar, line, pie, area, scatter, doughnut), Icons (an original library), Drawing Canvas, WordArt effects and shape connectors.
  - **Layout and views:** Outline view with the Outlining tab, vertical text, the document grid, right-to-left tables and sections, balanced newspaper columns, Tight and Through wrapping, footnote and endnote options per section.
  - **Review and references:** Track Changes moves, Compare, Restrict Editing, content controls, and dialogs for Caption, Index, Table of Contents, Create Source, Line Numbers, Hyphenation, Language, Envelopes and Labels.
  - **Editing:** a two-row mini toolbar, dragging after a double- or triple-click extends by words or paragraphs, Find and Replace special characters and wildcards, Word's common shortcuts, moving paragraphs, Alt+X, field codes.
  - **East Asian text:** Phonetic Guide, Enclose Characters, Chinese, Japanese and Korean numbering, separate Asian fonts, Myanmar, Khmer and Indic shaping.
  - **Files and printing:** Word XML (Flat OPC) and Word 2003 XML, Print preview with page ranges, Print Markup, mail merge from spreadsheets, many .doc, RTF, ODT and HTML fixes.
  - **Customising:** Customize Ribbon and Quick Access Toolbar, Customize Keyboard, File › Options panes, Templates and Add-ins.
  - **Interface:** Russian and Turkish, screen-reader access to the document, More Colors.
- **Co-editing:** content controls and text-box text settings are now shared, so the new upstream features survive real-time editing.
- **Patches:** rebased onto the new upstream. The mini toolbar and double-click fixes upstream made replace ours; patch 0005 keeps Bullets, Numbering and New Comment on the toolbar and the toolbar above the right-click menu, and patch 0004 keeps the ribbon collapse alongside upstream's Customize Ribbon.
- **Docs site:** a calm app-style layout with a sidebar, search (Ctrl+K or ⌘K), light and dark themes, and on each feature page a preview of real screenshots, a live example and the code.

## 0.3.1 (2026-10-11)

- **Version history** ✦, in the style of Google Docs. Versions are recorded as people work (every few minutes while the document changes, on each save, and before a restore). A panel lists them by day with author and word count. You can view one read only in place of the document, restore it as one undoable step, name it, download it as .docx or delete it. It opens from the title bar, File › Info and Ctrl+Alt+Shift+H. Versions stay in the browser by default; `httpVersionStore` or your own `VersionStore` keeps them on your server.
- **Font previews:** the font box shows each name in its own font, including web fonts. It fetches just the regular face of the fonts on screen, four at a time.
- **Mini toolbar, as on Windows:** it now appears after a double-click or triple-click selection, which it used to miss. It adds Grow and Shrink Font, Bullets, Numbering and New Comment, and also sits above the right-click menu.
- **Rulers:** the vertical ruler measures the page in view when the caret's page has scrolled away, where it used to go blank. Double-clicking a ruler opens Page Setup.
- **Title bar:** reads "Name • Saved" as Word does, and opens Version History when it is on. The Editing, Reviewing and Viewing menu shows two-line items.
- **Upstream:** synced to WordCraft `1d4f741`.
- **Docs:** a showcase and documentation site (`site/`), a table of divergences from WordCraft, this changelog, and the versioning rule. Em dashes are gone from the package's text.

## 0.3.0 (2026-10-11)

- **AI bar** ✦: a Gemini-style sparkle at the bottom centre opens quick actions, templates and a prompt box. Answers stream into a preview to insert, replace, retry or discard.
- **AI Studio** ✦: writing skills (the Humaniser is on by default; add your own or import a SKILL.md), a letterhead written into the header, brand palettes for headings, and the model and key.
- **Bring your own key** ✦: OpenRouter, OpenAI, Anthropic, Gemini or any OpenAI-compatible API, kept in the browser.
- **Ribbon collapse:** Word's ^ button leaves the tabs and ruler. Clicking a tab opens the ribbon over the page, and the pin keeps it open.

## 0.2.0 (2026-10-10)

- **Real-time co-editing** ✦ with Yjs (any provider): per-person undo, live cursors and avatars, one shared file with AutoSave.
- Ribbon tabs the host chooses, the Editing/Reviewing/Viewing switch with a real read-only mode, and commands the host turns off.
- Fonts on demand from the Google Fonts library ✦, with Word's Theme, Recently Used and All Fonts sections.
- Clicking a comment takes the caret to its text.
- AutoSave works when embedded, the user's name is configurable, and the title bar and ribbon can be hidden.

## 0.1.1 (2026-10-10)

- First public release: the WordCraft editor as a React component and a framework-agnostic core, with saving through the host app.

## 0.1.0 (2026-10-10)

- Initial package, not published.
