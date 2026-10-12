# Changelog

Every published version of `@gamine/wordcraft-react`, newest first. Versions follow the rule in [docs/VERSIONING.md](docs/VERSIONING.md): each release bumps the patch number (0.3.0, 0.3.1, 0.3.2…), and the minor number moves only when a version is declared stable. Automatic upstream syncs add their own entries.

Features marked ✦ are Extras: additions of this package that are not part of Microsoft Word or WordCraft. [docs/DIVERGENCES.md](docs/DIVERGENCES.md) lists every way the package differs from WordCraft.

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
