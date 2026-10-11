# How close is the editor to Microsoft Word?

The editor is WordCraft, so its Word coverage is WordCraft's. Upstream measures that coverage against a catalogue of Word's ribbon and menu features, taken from Word for Mac 16.113.4 (Microsoft 365). The numbers below are from that catalogue at the pinned upstream commit (WordCraft 0.5.0, `UPSTREAM_REV`), and they rise with every sync. Upstream regenerates the live list in its [`docs/parity-checklist.md`](https://github.com/storytold/wordcraft/blob/main/docs/parity-checklist.md), and ranks the shortfalls in [`docs/gaps.md`](https://github.com/storytold/wordcraft/blob/main/docs/gaps.md).

**Overall: 402 of 434 catalogued Word features are implemented (92.6%).**

## Formatting (Home)

**99 of 102.** Everything in Word's Clipboard, Font, Paragraph, Styles and Editing groups is implemented.

- **Clipboard:** Paste, Keep Text Only, Merge Formatting, Paste Special, the Clipboard pane, Format Painter, Copy and Paste Formatting.
- **Font:** font and size, grow and shrink, Change Case, Clear Formatting.
  - Bold, italic, eight underline styles, strikethrough and double strikethrough.
  - Subscript and superscript, small caps, all caps, hidden text, emboss and engrave.
  - Text effects (outline, shadow), highlight, font colour and character shading.
  - Character spacing, scale, position and border, and the full Font dialog.
- **Paragraph:** bullets, numbering, multilevel lists (with Define New), list levels, restart and set numbering value, indents and sort.
  - Show/Hide ¶, all five alignments, line spacing and space before and after, shading and borders.
  - Horizontal line, the Paragraph dialog and tabs, keep with next, keep lines together, page break before and widow/orphan control.
  - Outline level, hanging indent, right-to-left and left-to-right text, and Asian Typography.
- **Styles:** the gallery, create, modify, update to match and delete, the Styles pane, Style Inspector, Manage Styles, Apply Styles and character styles.
- **Editing:** Find, Advanced Find, Replace and Replace All, Go To, Select All, Select Objects and Select Similar Formatting.
- **Missing:** Phonetic Guide and Enclose Characters (East Asian typography), and Dictate.
- **Added by this package's font work:** the font box lists Theme Fonts, Recently Used Fonts and All Fonts the way Word does, and offers the Google Fonts library on demand.

## Tables (Insert, Table Design, Table Layout)

**Table Design 8 of 8, Table Layout 30 of 30.**

- **Inserting:** Insert Table, Draw Table, Convert Text to Table, Quick Tables, and an Excel spreadsheet object.
- **Table Design:** table styles with Table Style Options; new, modify and delete table styles; shading, borders and Border Painter.
- **Table Layout, selecting and drawing:** Select Table, Row and Cell; View Gridlines; Properties; Draw Table and Eraser.
- **Table Layout, structure:** insert and delete rows, columns and cells, delete the table, merge and split cells, and split the table.
- **Table Layout, sizing and data:** AutoFit, row height and column width, distribute rows and columns, alignment, text direction and cell margins, Sort, Repeat Header Rows, Convert to Text, and Formula.

## Design

**10 of 10.** Themes, Style Sets, Colors, Fonts, Paragraph Spacing, Effects and Set as Default. Watermark, Page Color and Page Borders.

## Insert

**43 of 53.**

- **Implemented:**
  - Cover Page, Blank Page and Page Break.
  - Pictures and Shapes.
  - Link, Bookmark and Cross-reference, and Comment.
  - Headers, footers and page numbers, with every option.
  - Text Box, Quick Parts and AutoText, Document Property and Field, WordArt, Drop Cap, Signature Line, Date & Time, Object and Text from File.
  - Equation, Symbol, and nonbreaking or optional characters.
- **Missing:**
  - Online Pictures, Icons, 3D Models and Screenshot.
  - SmartArt and Chart. Existing charts and SmartArt are drawn and kept when saving, but not yet editable.
  - Drawing Canvas, Online Video, Add-ins and Ink Equation.

## Other tabs

| Tab | Implemented |
|---|---|
| File | 20 of 20 |
| Layout | 19 of 19 |
| References | 24 of 24 |
| Mailings | 17 of 17 |
| Review | 28 of 30 (missing Translate, Block Authors) |
| View | 25 of 29 (missing the multi-window commands: Arrange All, Side by Side, Synchronous Scrolling, Switch Windows) |
| Draw | 5 of 11 |
| Equation | 21 of 22 |
| Picture Format | 14 of 14 |
| Shape Format | 3 of 6 |

## Extras: what this package adds beyond Word and WordCraft

These are tagged **✦ Extra** in the docs and *Extra* in the editor, because they are not part of Microsoft Word, WordCraft, or either.

| Extra | Word | WordCraft |
|---|---|---|
| AI bar: a sparkle at the bottom centre, Gemini-style quick actions, templates, streaming answers | Copilot is separate | Gap #25 |
| AI Studio skills: Humaniser on by default, built-in and custom skills, SKILL.md import | No | No |
| AI Studio letterhead: organisation details and logo written into the header, used as AI context | No | No |
| AI Studio palettes: brand colours for the title, headings and letterhead | Theme colours only | Theme colours only |
| Bring your own AI key: OpenRouter, OpenAI, Anthropic, Gemini or OpenAI-compatible | No | No |
| Real-time co-editing with per-person undo and cursors | Yes | Not yet |
| Google Fonts library on demand | Cloud fonts | No |

Host-app controls are also this package's own: which ribbon tabs show, commands the host turns off, the Editing/Reviewing/Viewing mode, Ribbon Display Options, and the user's name.

## How gaps close

Upstream lands about 70 commits a day, and its ranked gap list estimates the remaining work. This package pulls upstream every two hours and publishes each update that passes the tests, so closed gaps reach you without anything to do on your side. Building the missing Insert features here as patches would fork the editor and fight that sync. The better route is to contribute them upstream, where they'd also reach the desktop apps.
