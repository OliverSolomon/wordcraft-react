# @gamine/wordcraft-react

The [WordCraft](https://github.com/storytold/wordcraft) word processor, an open-source look-alike of Microsoft Word, packaged as an editor you can drop into React, Next.js or any web app, the way you would use TipTap or another WYSIWYG editor.

It isn't a re-implementation. The package ships the upstream WordCraft code itself (the ribbon, the dialogs, the page layout and the document engine), compiled from Rust to WebAssembly and pinned to one upstream commit. So what your users see is a 1:1 match with WordCraft's own web and desktop apps. What this package adds is the part an embedder needs: it mounts the editor in an element you own, gives you an API for documents and commands, and lets you handle saving instead of having the browser download a file.

```tsx
'use client';
import { useRef } from 'react';
import { WordcraftEditor, type WordcraftEditorRef } from '@gamine/wordcraft-react';

export default function Editor() {
  const ref = useRef<WordcraftEditorRef>(null);
  return (
    <WordcraftEditor
      ref={ref}
      height={800}
      onSave={async (file) => {
        await fetch('/api/documents/42', { method: 'PUT', body: file.bytes });
      }}
    />
  );
}
```

## Install

```bash
npm install @gamine/wordcraft-react
```

React 18 or 19 is a peer dependency, and only the React entry point needs it. The editor runs in any browser with WebGPU or WebGL2, which covers current Chrome, Edge, Firefox and Safari on desktop and mobile.

## Using it with Next.js

The component is marked `'use client'` and starts the editor inside an effect. On the server it renders only its sized container, so it works in the App Router and the Pages Router with no `dynamic(() => import(...), { ssr: false })` wrapper. The `.wasm` file is loaded through `new URL(..., import.meta.url)`, and webpack 5, Turbopack, Vite, Rollup and esbuild all emit it as a static asset automatically.

If you would rather serve the binary yourself (from a CDN, say, or from `public/`), copy `node_modules/@gamine/wordcraft-react/wasm/wordcraft_embed_bg.wasm` and pass `wasmUrl="/wordcraft_embed_bg.wasm"`. Serve it as `application/wasm` with gzip or Brotli. Compression takes it from about 30 MB to about 12 MB with gzip, and less with Brotli. When a bundler emits the file, its name carries a content hash, so it can be cached indefinitely. If you copy it yourself, the name doesn't change between releases, so give it a cache lifetime that matches your deploys.

A complete example app lives in [`examples/nextjs`](examples/nextjs). The documentation site, with a live demo of every feature, is at **[oliversolomon.github.io/wordcraft-react](https://oliversolomon.github.io/wordcraft-react/)** (source in [`site/`](site)).

## Component props

| Prop | Type | Notes |
|---|---|---|
| `document` | `{ name, data }` | Opens on mount. `data` can be an `ArrayBuffer`, a `Uint8Array` or a `Blob`, and the extension in `name` picks the format. If you change it later, the new document loads. |
| `sample` | `boolean` | Starts with WordCraft's built-in sample document. |
| `user` | `{ name, color?, id? }` | The person editing. The name shows on the title bar avatar and signs comments and tracked changes; `color` is their cursor colour when co-editing. Changes apply live; read it back with `editor.getUser()`. |
| `autoSave` | `boolean` | AutoSave starts on (default) or off. It writes through `onSave` with `reason: 'autosave'` a couple of seconds after edits, and the title bar toggle switches it, as in Word. Needs `onSave`. |
| `titleBar` | `boolean` | `false` hides the title bar and everything in it (AutoSave, Quick Access Toolbar, title, search, avatars, Share, account). |
| `ribbon` | `'full' \| 'tabs' \| 'hidden' \| boolean` | Word's Ribbon Display Options: always show, show tabs only, or hide the ribbon completely (`false` too, tab row included). People can also collapse the ribbon with the ^ at its corner (leaving the title bar, tabs and ruler), open a tab's commands over the page by clicking it, and pin the ribbon back. |
| `tabs`, `hiddenTabs` | `RibbonTab[]` | Which ribbon tabs to offer: `File`, `Home`, `Insert`, `Draw`, `Design`, `Layout`, `References`, `Mailings`, `Review`, `View`, `Zotero`, `Help`. Contextual tabs (Table Design, Picture Format…) still appear when needed. Applied live. |
| `mode` | `'editing' \| 'reviewing' \| 'viewing'` | Word's mode switch. Reviewing turns on Track Changes; Viewing allows reading, copying, printing and exporting but no changes. People can also switch it from the button beside Comments. |
| `disabledCommands` | `string[]` | Commands to turn off, by id from `editor.commands()` or by prefix (`'mailings.*'`, `'file.open'`). They're greyed in the ribbon and refused from shortcuts, menus and `execute`. |
| `fonts` | `FontSource \| FontSource[] \| false` | Fonts offered in the font box on demand. The default is `googleFonts()`, the whole Google Fonts library, fetched when first picked or when a document uses one. `false` keeps to the built-in fonts. |
| `ai` ✦ Extra | `AiOptions` or `true` | A sparkle at the bottom centre opens a Gemini-style AI bar with AI Studio (skills with the Humaniser on by default, letterheads, palettes, model). Works with your endpoint, a provider key, or people's own OpenRouter/OpenAI/Anthropic/Gemini key. See [AI](#ai-extra). |
| `versionHistory` ✦ Extra | `boolean` or `{ store?, documentId?, interval?, max? }` | Version history like Google Docs: versions recorded as people work, in a panel to view, restore, name, download or delete. Opens from the title bar, File › Info and Ctrl+Alt+Shift+H. See [Version history](#version-history-extra). |
| `versionsOpen`, `onVersionsOpenChange` | | Open or close the version history panel yourself. |
| `mobile` ✦ Extra | `'auto' \| boolean` | The phone layout, shaped like Word on Android. `'auto'` (default) uses it on touch screens narrower than 600px and switches live, so a foldable gets the phone layout folded and the ribbon unfolded. See [Phones and tablets](#phones-and-tablets). |
| `permission` | `'view' \| 'comment' \| 'suggest' \| 'edit'` | What this person may do, enforced by the editor and changeable at runtime. See [Access levels](#access-levels). `allowCopy` and `commentsVisibleToViewers` refine it. |
| `comments` ✦ Extra | `CommentsOptions` or `true` | Google Docs style comments: a panel with filters, replies, `@mentions`, Assign to, and a store adapter. See [Comments](#comments). `commentsOpen` and `onCommentsOpenChange` control the panel. |
| `presence` | `boolean` | Show who else is here (avatars with follow) at the bottom right while co-editing. Default true. |
| `checks` ✦ Extra | `WritingChecksOptions` or `true` | Writing checks like Grammarly: underlines by category, a card with fixes, a panel with a score, readability and tone. See [Writing checks](#writing-checks-extra). |
| `originality` ✦ Extra | `OriginalityOptions` | Similarity against your own documents, a plagiarism service and a soft AI-writing signal. See [Originality](#originality-extra). |
| `tools` ✦ Extra | `ToolsOptions` | Outline with drag to reorder, accessibility, sources and bibliography, word count with a goal, voice typing, translation. See [Tools](#tools-extra). |
| `sensitive` | `boolean` | A sensitive document (case notes, survivor information): writing checks, originality and document chat are off and nothing is sent anywhere. |
| `panel`, `onPanelChange` | `PanelId \| null` | Open one of the Extras' panels yourself: `chat`, `checks`, `originality`, `outline`, `accessibility`, `sources`, `count`, `translate`. |
| `mobileOptions` | `MobileOptions` | `{ mobileView?, title?, onBack?, onShare?, camera?, dictation?, shyChrome? }` for the phone layout. |
| `collaboration` | | Real-time co-editing, e.g. `yjsCollaboration({ doc, provider })`. See [Co-editing](#co-editing). |
| `dark`, `prefs` | | UI preferences, applied live: ribbon `tab`, `dark`, `darkPage`, `language`, `showDiscord`. |
| `renderer` | `'auto' \| 'webgl'` | Uses WebGPU and falls back to WebGL2. Pass `webgl` to force WebGL2. |
| `height`, `className`, `style` | | The editor fills its container. The default height is 720px. |
| `loading`, `fallback` | `ReactNode` | `loading` shows while the editor starts. `fallback` shows if it can't start. |
| `onReady(editor)` | | Called once the editor is running. |
| `onChange({ rev, dirty }, editor)` | | Called after edits, at most once per frame. |
| `onSave(file, editor)` | | Called on Save, Save As, Export and AutoSave in WordCraft's own UI with `{ name, mimeType, bytes, blob, reason }`. If the promise you return resolves, the document is marked saved. Without this prop the browser downloads the file and AutoSave stays off. |
| `onError(error)` | | |
| `guardUnload` | `boolean` | Asks before the tab closes with unsaved changes, as the WordCraft web app does. Off by default, because your app owns navigation. |
| `wasmUrl` | `string \| URL` | Overrides where the binary loads from. |
| `ui` ✦ Extra | `UiOptions \| 'paper'` | A boolean for every surface, applied live. See [Your own screen](#your-own-screen-extra). |
| `topBar` ✦ Extra | `true`, `{ left, center, right }` or a function | Your own top bar in place of the title bar. See [Your own screen](#your-own-screen-extra). |
| `fileMenu` ✦ Extra | `FileMenuItem[]`, per-item settings or a function | The File menu item by item, each export format too. See [Your own screen](#your-own-screen-extra). |
| `icons` ✦ Extra | `{ ask?, comments?, checks?, tools?, voice?, share?, back?, history? }` | Your own icons (any React node) for the workspace row and the top bar. |
| `onShare` | `() => void` | Share (title bar, File menu, top bar) asks you instead of opening WordCraft's dialog. |

## Editor API (the ref)

```ts
editor.load({ name: 'brief.docx', data: arrayBuffer });  // or a File from an <input>
editor.newDocument();
editor.export('docx');            // Uint8Array; also docm, dotx, odt, rtf, md, html, txt, tex, json, pdf, png
editor.exportBlob('pdf');         // Blob with the right MIME type
editor.getHTML(); editor.getMarkdown(); editor.getText(); editor.getSelectedText();
editor.execute('format.bold');    // any WordCraft command id
editor.execute('text.insert', { text: 'Hello' });
editor.commands();                // [{ id, label, location, shortcut, params, mutates }, ...]
editor.print();                   // the browser's print dialog, as File > Print does
editor.undo(); editor.redo(); editor.canUndo(); editor.canRedo();
editor.isDirty(); editor.markSaved(); editor.rev(); editor.title();
editor.getPrefs(); editor.setPrefs({ tab: 'Review', dark: true, hideTitleBar: true });
editor.getUser(); editor.setUser({ name: 'Ada Lovelace', color: '#c2410c' });
editor.isAutoSaving(); editor.setAutoSave(false);
editor.getMode(); editor.setMode('viewing');
editor.setTabs(['File', 'Home', 'Insert', 'Review']);
editor.setDisabledCommands(['mailings.*', 'file.open']);
editor.addFont(ttfBytes); editor.hasFont('Lato');
editor.restoreContent(versionBytes);   // replace the content with another version, one undoable step
editor.selectionInfo();           // { collapsed, rect, contextual, touch, selected, scrolling, ... } in CSS pixels
editor.onSelection((info) => {}); // as the selection changes or moves; returns a function that stops listening
editor.setTouch(false);           // turn the page's touch gestures off (on by default)
editor.paragraphs();              // [{ path, text, style, styleName, heading }], tables included
editor.comments();                // [{ id, parent, author, date, resolved, text, quote, anchor }]
editor.selectText([3], 0, 12);    // select by paragraph path and UTF-16 offsets, and scroll to it
editor.setMarks([{ id, path, start, end, color, style: 'squiggle' }]);  // underline or highlight text
editor.followPeer('Ada Lovelace'); // keep a co-editor's caret in view (null stops)
editor.caret();                   // { anchor: { path, offset }, focus: { path, offset } } as paragraphs() counts
editor.selectedObject();          // the selected picture, chart or shape: { kind, alt, title }, or null
editor.comments.create({ text, anchor? });   // the host's comment API (see Comments)
editor.onHostEvent((e) => {});    // 'compose', 'comments', 'comment:<id>', 'share', 'file:<id>', 'ai', 'versions'
editor.state();                   // { bold, italic, underline, strike, font, size, style, align, bullets, numbering, canUndo, canRedo, collapsed, selectedText, mode }
editor.onStateChange((s) => {});  // for a toolbar of your own; returns a function that stops listening
editor.isActive('bold'); editor.can('file.print');
editor.destroy();
```

`execute` runs the same command registry that WordCraft's ribbon, keyboard shortcuts, CLI and MCP server use, so anything a user can do from the ribbon can also be scripted. Call `editor.commands()` for the full list, including each command's parameters.

## Co-editing.

Several people can edit one document at once, the way Word's co-authoring works:

- **Merging.** Changes merge as people type, down to the character. Two people typing in the same paragraph both keep their words. Formatting merges property by property, so one person's bold and another's italics on the same word both stick.
- **Structure.** Paragraph splits, tables, headers, footers, notes, comments, pictures and document settings are all shared.
- **Undo.** Ctrl+Z and the Undo button take back only your own changes, not other people's.
- **Presence.** Everyone else's cursor and selection show on the page in their colour with a name flag, and their avatars appear in the title bar and at the bottom right, overlapping with a `+n` counter. An avatar's tooltip says whether they are editing or viewing; after a minute without activity it dims. Click one to follow that person (their caret stays in view until you scroll yourself). Someone who joins without a name shows as "Anonymous" and an animal.
- **Saving.** AutoSave writes the merged document over the one shared file, so nobody's save overwrites anyone else's work. Turn on `versionHistory` with a server store to keep earlier versions everyone can see.

It runs on [Yjs](https://yjs.dev), so any Yjs provider can carry it: y-websocket, Hocuspocus, Liveblocks, PartyKit, y-webrtc, or your own. Install `yjs` and a provider, then:

```tsx
'use client';
import { useEffect, useMemo } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WordcraftEditor } from '@gamine/wordcraft-react';
import { yjsCollaboration } from '@gamine/wordcraft-react/collab';

export function SharedEditor({ docId, me }: { docId: string; me: { name: string; color: string } }) {
  const collab = useMemo(() => {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider('wss://collab.example.com', docId, doc);
    return { provider, collaboration: yjsCollaboration({ doc, provider }) };
  }, [docId]);
  useEffect(() => () => collab.provider.destroy(), [collab]);

  return (
    <WordcraftEditor
      user={me}
      collaboration={collab.collaboration}
      onSave={(file) => fetch(`/api/documents/${docId}`, { method: 'PUT', body: file.blob })}
    />
  );
}
```

For your own header, `yjsCollaboration({ ..., onPresenceChange: (users) => ... })` reports everyone as `{ name, color, avatarUrl, state, idle, self, anonymous }`, and `<PresenceAvatars users={users} onFollow={(name) => editor.followPeer(name)} />` draws them the same way. Pass `user.avatarUrl` for pictures; `presence={false}` hides the bottom-right row.

The first person to open a document shares whatever the editor has open (pass the stored file as `document`). Everyone who joins later gets the live shared document instead. `yjsCollaboration` waits for the provider's first sync before joining, so a document is never put in twice. [`examples/nextjs/app/collab`](examples/nextjs/app/collab) is a complete page with a shared-file API that keeps the last 20 versions. Run `npm run collab-server` next to `npm run dev` and open `/collab` in two windows to try it.

## Access levels

`permission` sets what a person may do, as Google Docs' link access does: `'view'`, `'comment'`, `'suggest'` or `'edit'` (the default). The editor enforces it, not only your buttons: typing, paste, drag and drop, AutoCorrect, find and replace and AI results all go through the same commands, and the commands refuse.

| Level | Can | Cannot |
|---|---|---|
| `view` | Read, select, copy, print, export | Change anything; comments are read only (`commentsVisibleToViewers={false}` hides them) |
| `comment` | Everything a viewer can, plus add, reply to and resolve comments | Change the text |
| `suggest` | Edit, but every change is a tracked suggestion (the mode switch is locked to Reviewing) | Accept or reject changes, turn tracking off |
| `edit` | Everything | |

Change the prop at runtime and it applies at once; when it goes down, the person sees a short notice saying why. A chip at the bottom right says "Viewing", "Commenting" or "Suggesting". `allowCopy={false}` also stops viewers and commenters copying, printing and downloading. Underneath it uses WordCraft's Restrict Editing, so a saved .docx carries the same protection into Word.

## Comments

WordCraft keeps comments in the document, Word style: a highlighted range with a card in the margin, threads, resolve, and a round trip through `word/comments.xml` and `commentsExtended.xml`, so threads, authors and resolved state survive Word and Google Docs. `comments` adds what a web app needs around them:

```tsx
<WordcraftEditor
  comments={{
    people: team,                                  // offered after @ (or a search function)
    store: { create, reply, update, resolve, remove, subscribe },   // every change, for your server
    onMention: ({ comment, people, assignee }) => notify(people, comment),
  }}
/>
```

- **The panel.** A comments button at the bottom right opens every thread, with filters for Open, Resolved, Mine and Mentions me, and by author. Click a quote to go to its text. Add a comment on the selection, reply, `@mention` with a people picker, *Assign to* the first person mentioned, Resolve and Reopen, and edit or delete your own. New comments are announced to screen readers, and on a phone the panel is a sheet over the page.
- **The store.** Every method is optional and may return a promise; a failing store never stops anyone commenting. `subscribe(listener)` applies comments made elsewhere (an email reply, another app) to the open document. With co-editing, other people's comments arrive by themselves.
- **Shortcuts and menus.** WordCraft's own New Comment (Review tab, right-click menu, mini toolbar, Ctrl+Alt+M) and margin cards work as before, and the store hears those comments too.
- **Edit and Delete** sit as icons under your own comments' text. The panel fits any width.
- **Suggestions.** The `suggest` level (or Word's Reviewing mode) records edits as tracked changes with their author; accept and reject them from the Review tab.

`editor.comments()` lists the comments with their anchors, and `editor.selectText(path, start, end)` goes to one. `commentsOpen` and `onCommentsOpenChange` control the panel.

### Comments owned by your app ✦ Extra

```tsx
<WordcraftEditor
  comments={{
    exclusive: true,                              // or nativePane: false
    onRequestCompose: ({ anchor, quote, submit, cancel }) => openMyComposer({ quote, onPost: submit, onCancel: cancel }),
    onOpenComment: (id) => showThread(id),        // a balloon or highlight was clicked
  }}
/>
```

- **The pane never opens.** Not from the selection toolbar, the ribbon, the right-click menu, Ctrl+Alt+M, the phone palette or a balloon.
- **Compose before create.** Every New Comment asks for a composer on the selection: yours (`onRequestCompose`), or without it the package's drawer, opened with its composer on the selection. No comment exists until it is submitted with text, so cancelling leaves nothing.
- **The host API** works whatever `disabledCommands` says, so you can turn off WordCraft's comment buttons and still write comments from your panel. The package keeps the anchors and highlights.

```ts
const id = editor.comments.create({ text: 'Check this figure', anchor });   // anchor defaults to the selection
editor.comments.reply(id, 'Done');
editor.comments.edit(id, 'Check this figure again');
editor.comments.resolve(id); editor.comments.reopen(id);
editor.comments.delete(id);
editor.comments.list();          // the same as editor.comments()
editor.comments.focus(id);       // select the commented text and scroll to it
const off = editor.comments.onChange((list) => setComments(list));
```

`<CommentsDrawer editor={editor} />` is the drawer on its own, for your sidebar: it fills the element you put it in, at any width.

## Your own screen ✦ Extra

**Every surface is a switch.** `ui` takes a boolean for each part of the editor. `false` removes it from the page with its room and its shortcuts; leave a key out to keep it. Changes apply live, with no remount: the document, the selection and a co-editing session carry on.

```tsx
<WordcraftEditor
  ui={{
    titleBar: false,          // everything in the top bar: AutoSave, Quick Access, title, search, avatars, Share, account
    ribbon: false,            // the ribbon and its tab row ('tabs' keeps only the tab row)
    statusBar: false, selectionToolbar: false, contextMenu: false,
    rulers: false, navigationPane: false,
    workspace: { ask: false, comments: true, checks: false, tools: false, voice: false },  // or false for none
    presence: false, share: false, modeSwitch: false, zoom: false, viewSwitcher: false,
    fileMenu: false,          // also turns off Ctrl+S, Ctrl+O, Ctrl+P...
    mobilePalette: false,
  }}
/>
<WordcraftEditor ui="paper" />   // the page alone
```

With `ui="paper"` you can build your own toolbar on the headless API: `editor.state()` and `onStateChange` for what is on at the selection, `isActive('bold')`, `can('file.print')`, and `execute` for the commands. `icons={{ ask, comments, checks, tools, voice }}` swaps in your own icons.

**Your own top bar.** `topBar` replaces WordCraft's title bar with three zones, each an ordered list:

```tsx
<WordcraftEditor
  onShare={() => openShareDialog()}
  topBar={({ permission, user, collaborators }) => ({
    left: [{ type: 'back', href: '/documents', label: 'Documents', confirmUnsaved: true }, { type: 'quickAccess', items: ['undo', 'redo', 'separator', 'print'] }, 'title', 'saveState'],
    center: [{ type: 'custom', id: 'status', render: () => <StatusPill /> }],
    right: ['presence', 'comments', 'history', { type: 'share', disabled: permission === 'view' ? 'Only editors can share' : false }, { type: 'user', menu: [{ label: 'Profile', onClick: openProfile }, { label: 'Sign out', separator: true, onClick: signOut }] }],
  })}
/>
```

- **Built-in items:** `back`, `quickAccess`, `title`, `saveState`, `presence`, `share`, `user`, `comments`, `history`. Your own: `{ type: 'button', label, icon, onClick }` or `{ type: 'custom', render }`.
- **Back** sits at the far left, takes `onClick` or `href`, a label and an icon, asks first when the document is unsaved (`confirmUnsaved`), works from the keyboard, and hides itself without a handler.
- **Presence:** each avatar in that person's cursor colour; click to follow them; the rest collapse to "+N"; people without a name show as "Guest".
- **Share** can be renamed, restyled, hidden, or disabled with a reason shown as its tooltip. **User** is the signed-in person's avatar with your menu. **Quick access** is your choice and order of undo, redo, save, print, find, your buttons and separators.
- **Narrow widths:** the title shortens first, then the avatars collapse to "+N", then Share becomes an icon. Nothing overflows at 360px.

**The File menu, item by item.** Pass a list (its order is the menu's; WordCraft's items you leave out are hidden) or settings by id:

```tsx
<WordcraftEditor
  fileMenu={[
    { id: 'info' }, { id: 'save' },
    { id: 'print', disabled: 'Printing is off for this document' },
    { id: 'share', onSelect: openShareDialog },
    { id: 'export', label: 'Download' },
    { id: 'export.docx', hidden: true },               // PDF allowed, Word refused
    { id: 'moveToFolder', label: 'Move to folder', section: 'Organise', onSelect: moveToFolder },
  ]}
/>
```

WordCraft's ids are `home`, `new`, `open`, `info`, `recover`, `save`, `saveAs`, `print`, `share`, `export`, `close` and `options`, and each export format is its own: `export.pdf`, `export.docx`, `export.xml`, `export.wordml2003`, `export.odt`, `export.rtf`, `export.html`, `export.md`, `export.tex`, `export.txt`, `export.png`. A hidden or disabled item's shortcut is off too (hiding print turns off Ctrl+P). `fileMenu`, like `topBar`, can be a function of `{ permission, user, collaborators }`.

## Fonts

The browser build bundles a handful of fonts, so the font box also offers fonts on demand, the way Word offers cloud fonts. By default that's the Google Fonts library (about 1,970 openly licensed families). A font downloads from the Fontsource CDN the first time someone picks it, or when an opened document uses it. The font box lists Theme Fonts, Recently Used Fonts and All Fonts, as Word does, shows each name in its own font, and remembers recently used fonts in the browser. To preview a web font it fetches just its regular face, and only for the rows on screen.

```tsx
import { googleFonts } from '@gamine/wordcraft-react';
<WordcraftEditor fonts={googleFonts({ categories: ['serif', 'sans-serif'] })} />   // a narrower list
<WordcraftEditor fonts={{ families: () => ['Brand Sans'], load: async () => [await (await fetch('/fonts/brand.ttf')).arrayBuffer()].map((b) => new Uint8Array(b)) }} />
<WordcraftEditor fonts={false} />                                                    // built-in fonts only
```

## Phones and tablets

On a phone the editor takes the shape of Word for Android: a slim title bar, the page, and one command palette at the bottom. WordCraft's own title bar, ribbon, status bar and mini toolbar step aside; every button in the palette runs one of WordCraft's commands, so editing works exactly as on the desktop.

```tsx
<WordcraftEditor mobile="auto" mobileOptions={{ onBack: () => router.back() }} height="100dvh" />
```

- **The page.** A finger drags the page and flings it, a tap places the caret, a long press selects a word, two handles adjust the selection, and two fingers zoom. The page opens in Mobile View, which reflows the text to the screen; the title bar switches between Mobile View and Print Layout.
- **The palette.** A quick bar (Bold, Italic, Underline, Bullets, Numbering, New Comment) sits above the keyboard. The ^ opens the full palette with Home, Insert, Draw, Layout, Review and View, and Table, Picture and Shape appear when the selection calls for them. Fonts, colours, styles, margins, table sizes and the like open as pages inside the palette.
- **Around the page.** A floating toolbar over a selection (Cut, Copy, Paste, Comment, Format), Find and Replace in place of the title bar, a More menu (Save, Share the .docx, Download as PDF, Print, Word Count, the mode switch, Version History and AI when they're on), photos from the camera, and dictation where the browser offers speech recognition. The bars slide away as you read down and come back as you scroll up, and the palette rides above the soft keyboard.
- **Foldables and tablets.** The layout follows the container width live, so a phone turning or a foldable opening switches between the palette and the ribbon. Tablets of 600px and wider keep the ribbon and still get the touch gestures.
- **Your rules apply.** `tabs`, `hiddenTabs` and `disabledCommands` thin the palette as they thin the ribbon. `MOBILE_PALETTE` exports the palette's contents.

`mobile={false}` keeps the desktop layout everywhere; touch gestures on the page stay on unless you call `editor.setTouch(false)`. For your own phone chrome, `editor.onSelection()` reports where the selection sits on screen and which contextual tabs apply.

## Extras

Everything in this package matches Word and WordCraft, except features marked **✦ Extra**. Extras are additions of this package and are not part of Microsoft Word or WordCraft. In the editor they carry an *Extra* tag. They are:

- ✦ **AI writing and AI Studio** (below).
- ✦ **Real-time co-editing** with per-person undo and live cursors ([Co-editing](#co-editing)). Word has this; WordCraft does not yet.
- ✦ **Fonts on demand** from the Google Fonts library ([Fonts](#fonts)).
- ✦ **Version history** in the style of Google Docs ([Version history](#version-history-extra)). Word has version history for files in OneDrive; WordCraft has none.
- ✦ **Comments panel, mentions and a comment store** ([Comments](#comments)), as in Google Docs. The comments themselves are WordCraft's, Word style.
- ✦ **The phone layout and touch gestures** ([Phones and tablets](#phones-and-tablets)), with dictation and camera photos. Word has these in its phone app; WordCraft is desktop and browser only.
- ✦ **AI that builds structure:** tables, diagrams, charts, checklists, callouts, equations, QR codes, images and tables of contents, and a `/` slash menu ([AI that builds structure](#ai-that-builds-structure-extra)).
- ✦ **A theme from a logo or photo, and logo placement** ([Brand theme and logo placement](#brand-theme-and-logo-placement-extra)).
- ✦ **Ask this document**, a chat grounded in the document with citations ([Document chat](#document-chat-extra)).
- ✦ **Writing checks** in the manner of Grammarly ([Writing checks](#writing-checks-extra)). Word has its own Editor pane; this adds goals, readability, tone and pluggable engines.
- ✦ **Originality:** your own documents, a plagiarism service and a soft AI-writing signal ([Originality](#originality-extra)).
- ✦ **Tools:** an outline with drag to reorder, an accessibility panel, sources, word count with a goal, voice typing and translation ([Tools](#tools-extra)). Word has most of these in its own places; these are side panels for the web.

The full list of differences from WordCraft, Extras or not, is in [docs/DIVERGENCES.md](docs/DIVERGENCES.md).

## AI (Extra)

`ai` puts a sparkle at the bottom centre of the editor, like Gemini in Google Docs. Hovering shows "Help me write"; clicking opens the AI bar:

- **Quick actions:** chips above the prompt box. With text selected: Rewrite, Shorten, Elaborate, More formal, and under More: Fix grammar, Summarize, More casual, Turn into an email, Make an outline, Match doc format. Without a selection: Match doc format, Continue writing, Meeting notes, Email draft, and under More: Summarize, Outline, Brainstorm.
- **The prompt box:** + for templates (proposal, formal letter, blog post, cover letter and more), AI Studio, the "Write with …" field, a ⋮ menu and the send button.
- **Answers:** they stream into a preview. People then insert it, replace the selection, insert it below, try again or discard it.

### AI Studio

The sliders button in the prompt box opens AI Studio. Its settings stay in the person's browser.

- **Skills:** writing instructions added to every request. The **Humaniser** is on by default. It asks for natural, human-sounding prose with varied rhythm, plain words, no stock AI phrases and no em dashes. Built-in skills also include Plain English, Concise, Persuasive, Academic, Warm & friendly and British English. People can write their own skill or import a `SKILL.md` (front matter `name` and `description`, then the instructions). Your app can add skills with `ai.skills` and choose which are on with `ai.defaultSkills`.
- **Letterhead:** organisation name, tagline, address, contact line, logo, font, alignment and an accent rule, with a live preview. *Apply to document* writes it into the document header. The AI also gets these details as context for letters and emails. Your app supplies the organisation's letterhead with `ai.letterhead`; it is read live, so one that loads after the editor shows at once and a changed one replaces it. A person's own edits are kept separately in their browser (only once they have a name), with *Reset to organisation letterhead* to go back. `ai.letterheadLocked: true` keeps the official letterhead untouched (read-only fields, only Apply and Remove), and `ai.onLetterheadApplied(letterhead)` tells your app when it was applied, to log it or save the document.
- **Palette:** eight brand palettes, a custom one, and palettes made **from a logo or photo**. *Apply to document* writes it as the document theme; *Apply to headings* recolours only the title and headings. The letterhead uses the same colours. Your app can add palettes with `ai.palettes`. See [Brand theme and logo placement](#brand-theme-and-logo-placement-extra).
- **Model:** the provider, API key, model and endpoint (see below).

### Where answers come from

The first of these that is set up is used:

1. **The person's own key.** They add an OpenRouter, OpenAI, Anthropic, Google Gemini or any OpenAI-compatible key under Model. It stays in their browser and is sent only to that provider. This is on by default; turn it off with `allowUserKey: false`. `ai={true}` offers only this, and the sparkle asks for a key the first time.
2. **`provider`**, a key your app supplies: `{ provider: 'openrouter', apiKey, model? }`. The key is visible to the page, so use a per-user or short-lived key here.
3. **`complete`**, your own function. It is usually a call to your API route, which keeps your key on your server and works with any model.

```tsx
// Your endpoint (people can still bring their own key):
<WordcraftEditor
  ai={{
    async *complete({ signal, ...request }) {
      const res = await fetch('/api/ai', { method: 'POST', body: JSON.stringify(request), signal });
      const reader = res.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield new TextDecoder().decode(value);
      }
    },
    letterhead: { name: 'Open Studio Collective', contact: 'hello@openstudio.org' },
    skills: [{ id: 'house-style', name: 'House style', instructions: 'Use sentence case headings.' }],
    defaultSkills: ['humaniser', 'house-style'],
  }}
/>

// Only people's own OpenRouter / OpenAI / Anthropic / Gemini keys:
<WordcraftEditor ai />
```

`request` has `prompt`, `action`, `selection`, `document`, and `instructions` (the skills that are on, and the letterhead). On your server, pass the request to `aiSystemPrompt(request)` from `@gamine/wordcraft-react/core` to build the system prompt with those instructions, and to `describeAiRequest(request)` to turn a quick action into a task for your model. `completeWith(providerConfig, request)` streams from any supported provider, and works in an API route too. [`examples/nextjs/app/api/ai/route.ts`](examples/nextjs/app/api/ai/route.ts) streams Claude using `ANTHROPIC_API_KEY`.

Requests also carry `history` (document chat), `goals` (writing checks), `language` (translation) and `data` (structured output from a table), and `action` can be `ask`, `structure`, `check` or `translate`. `aiUserMessage(request)` and `aiSystemPrompt(request)` build the right message for each, so a route that uses them handles every Extra.

Other options: `launcher: 'none'` hides the sparkle (control the bar with the `aiOpen` and `onAiOpenChange` props), `ribbonButton: true` adds a sparkle beside Comments in the ribbon, `studio: false` hides skills, letterhead and palette, and `onStudioChange` reports AI Studio's settings so you can keep them on your server.

## AI that builds structure (Extra)

With `ai.structure: true`, AI answers become document structure instead of plain text: headings, nested lists, bold and italic, links, quotes, code, rules and native Word **tables** (a header row shaded in the palette colour, column alignment). Nothing the model writes reaches the document as HTML: the answer is parsed (a JSON block list the model is asked for, with Markdown as the fallback), validated, capped and repaired, and the package writes the document itself.

- **The Insert menu** in the AI bar and the **`/` slash menu** (type `/` at the start of an empty line) offer Table, Diagram, Chart, Timeline, Checklist, Callout, Equation, QR code, Image and Table of contents, plus Date, Divider, Page break and Signature line, and your own actions.
- **Each opens one panel:** a prompt, a data source (the prompt, the selection, the document, a pasted CSV, or your app's `ai.pickData()`), a preview, and where to put it (at the cursor, replacing the selection, or below it). In Suggesting mode it goes in as a tracked change.
- **Tables from data:** with data given, every number in the result must come from it; anything else becomes `[to confirm]`, marked in the preview. *Table from the data as is* skips the AI. Beside the preview: add or remove rows and columns, sort by a column, number formats (currency, percent, date) and a totals row.
- **Diagrams** (flowchart, sequence, org chart, timeline, Gantt, mind map, entity relationship, state) are Mermaid, rendered in the browser with `securityLevel: 'strict'` and themed with the palette, and go in as a picture with alt text. The Mermaid source rides in the picture's title, so after a save and reopen, selecting the diagram shows **Edit diagram**: the code with a live preview, and an AI change ("add a step after approval"). A diagram that fails to render shows its code with *Ask AI to fix the diagram*. Pass `ai.mermaid = () => import('mermaid')`; Mermaid loads only when first used.
- **Charts** (column, bar, line, area, pie, doughnut, scatter, stacked) go in as **native Word charts** with their data, title, legend and alt text, editable in Word.
- **Equations** go in as Word equations from LaTeX. **QR codes** come from the package's own encoder (no library, no network). **Images** come from your `ai.generateImage(prompt)` or `ai.imageSearch(query)`, re-encoded as PNG, never inserted without a preview.
- **Your own actions:** `ai.actions = [{ id, label, icon, run(ctx) → Block[] }]`, e.g. "Insert our standard donor paragraph".
- Every result card says "AI-generated: check it before use" (in the card, not the document). Viewers and commenters see none of this.

```tsx
<WordcraftEditor
  ai={{
    complete,
    structure: true,
    mermaid: () => import('mermaid'),
    pickData: async () => ({ label: 'Grants.xlsx', columns: ['Funder', 'Amount'], rows: [['Acme Trust', 25000]] }),
    actions: [{ id: 'donor', label: 'Donor paragraph', run: () => [{ type: 'paragraph', text: 'Thank you…' }] }],
  }}
/>
```

The block schema is in `BLOCKS_PROMPT`; `parseBlocks`, `markdownToBlocks`, `sanitizeBlocks` and `insertBlocks(editor, blocks, { palette })` are exported for your own flows.

## Brand theme and logo placement (Extra)

**A theme from a logo or photo.** AI Studio › Palette › *From a logo or photo* takes pictures by upload, drag and drop, paste or your app's `ai.pickImage()`. The colours are found in the browser (shrunk to about 96 px, converted to Lab, transparent, near-white and near-black pixels skipped, k-means clusters merged and ranked by area and saturation; with several pictures, taken round-robin so a small logo is not drowned by a photo). Five to eight swatches show their share; roles (primary, secondary, accent, muted) are assigned automatically and changed by picking a role and then a swatch. A heading colour under 4.5:1 on the page gets a warning and a one-click fix; a dark variant is one tick away.

*Apply to document* writes the palette as the **document theme** (the colour scheme in `word/theme/theme1.xml`, which Word's Design › Colors shows) and recolours the styles that use it: title, headings, hyperlinks and quotes, and the tables and callouts the AI inserts. Optional theme fonts (`ai.fonts = { heading, body }`, or the fields in the panel) go to the theme's font scheme. *Apply to headings only* is the light option. *Save palette* keeps it (with its source, "from logo.png") and calls `ai.onPaletteCreated(palette)`, so your app can store it for the whole organisation and pass it back in `ai.palettes`.

**Logo placement.** The letterhead's logo can be a `LogoSpec`: `{ src, placement, size, offset, opacity, rotation, wrap, pages, repeat }`. Placements: header left, centre or right, logo beside the text (either side) or stacked above it, footer left, centre or right, a **watermark** behind the text (opacity 5 to 40 percent, straight or diagonal, optionally repeated), a cover page, a side edge strip, at the cursor, or a signature block. `pages` is `all`, `first` (Different First Page), `odd` or `even` (Different Odd & Even Pages). Partner logos (`partners: [dataUrl…]`) go in one evenly spaced row. A live mini page in AI Studio shows each preset. Pictures are trimmed of transparent margins, SVG becomes PNG, and opacity and rotation are baked into the picture so Word, Google Docs and LibreOffice show the same thing. Applying again replaces what was there; *Remove* clears the headers, footers and watermark it wrote. A plain `logo` string keeps working (above the text, aligned with it).

```tsx
<WordcraftEditor
  ai={{
    complete,
    brand: { name: 'Sauti Salama', logo: logoDataUrl, palette: brandPalette },   // shorthand
    letterhead: { name: 'Sauti Salama', logo: { src: logoDataUrl, placement: 'header-logo-left-text-right', pages: 'all' } },
    onLogoChanged: (logo) => save(logo),
    onPaletteCreated: (palette) => saveForOrganisation(palette),
  }}
/>
```

## Document chat (Extra)

`ai.chat: true` adds **Ask** at the bottom right, opening a side panel like Gemini in Google Docs. Questions are answered from the document: whole document, this section, or the selection. Long documents are cut by heading and only the passages that match the question are sent (headings first for a broad question like a summary), never the whole text for a narrow one. Answers cite the passages as numbered chips; clicking one scrolls to the paragraph and highlights it.

Quick actions: Summarise, Key points, Action items, Explain this, Translate selection, and *Find where it says…* (a plain search, no AI). Each answer has Insert at cursor, Replace selection, Copy and Add as comment. Viewers and commenters can ask but not insert. The panel remembers being open, per person. History is kept by `ai.chatStore` (`load`, `save`, `clear`; default: this browser), so your app can keep it per document and per person. It uses the same `ai.complete` as the bar, with `action: 'ask'`.

## Writing checks (Extra)

`checks` (or `ai.checker`) turns on writing checks in the manner of Grammarly: coloured underlines by category (correctness red, clarity blue, engagement green, delivery purple), a card at the caret with the explanation, one-click fixes, *Dismiss*, *Ignore this rule* and *Add to dictionary*, and a panel with every issue by category, a score, readability (Flesch reading ease and grade, sentence length, reading time) and a tone read-out ("confident, formal"). Goals (audience, formality, domain including plain language for public information, intent) change which rules and AI instructions apply.

Paragraphs are checked after the person pauses (never per keystroke), one at a time, cached by their text; nothing is checked or sent in Viewing mode or in a `sensitive` document. A failing engine never affects typing or saving.

Engines plug in through `Checker` (`{ name, remote?, check(text, ctx) → Issue[] }`):

- `plainLanguageChecker()` (the default): long sentences, wordy phrases, jargon, passive voice, filler, repeated words. It runs in the browser; nothing is sent.
- `languageTool({ url })`: LanguageTool (open source, LGPL core) on your own server, `POST /v2/check`, 25+ languages.
- `llmChecker(complete)`: clarity, tone and rewrites through your AI (`action: 'check'`).

Grammarly's Text Editor SDK closed in January 2024, so there is no Grammarly adapter; any other service fits the `Checker` contract.

```tsx
<WordcraftEditor checks={{ checkers: [plainLanguageChecker(), languageTool({ url: 'https://lt.example.org' })], goals: { domain: 'plain' } }} />
```

## Originality (Extra)

`originality` adds an Originality panel. Nothing runs until the person asks; it says what is sent and to whom; results are overlays only (never written into the file); and it never blocks saving, sharing or exporting. A `sensitive` document hides it and sends nothing.

- `corpus.search(text)`: near matches in **your organisation's own documents** (reused grant text, boilerplate), the private default.
- `checkPlagiarism(text)`: a service you choose, returning `{ score, matches: [{ start, end, similarity, sourceTitle, url }] }`.
- `detectAi(text)`: an AI-writing detector, shown only as a soft per-paragraph signal ("may contain AI-generated text, low confidence") with a note that detectors are often wrong, especially for people writing in a second language. Never a verdict.

The report shows the overall similarity and the matched passages, highlighted in the text, each with *Go to*, *Add citation* (a real Word citation) and *Rewrite*. No vendor is built in.

## Tools (Extra)

`tools` turns on side panels, each separately: `outline` (headings, click to go, drag or Alt+Up/Down to move a section), `accessibility` (WordCraft's own checker: alt text, heading order, contrast, link text, table headers, with fixes), `sources` (sources, citations and a bibliography in APA, MLA, Chicago and more), `wordCount` (`{ goal }` for a word goal; words, characters, pages, reading time, per section and for the selection), `voice` (voice typing through the browser's speech recognition) and `translate` (a translated copy of the document, keeping headings, lists and tables, handed to `onTranslated` or downloaded as Markdown). They open from **Tools** at the bottom right, or from the phone layout's More menu.

## Version history (Extra)

`versionHistory` records versions of the document as people work, like Google Docs: every few minutes while it changes (`interval`, default 5 minutes), on each save, and before a restore. Clicking the title (as in Word), File › Info › View Version History, or Ctrl+Alt+Shift+H opens a panel on the right:

- **The list:** versions grouped by day, each with its time, author and word count. The current version sits at the top, with "Name current version". A switch shows only named versions.
- **Viewing:** clicking a version shows it read only in place of the document, with **Restore this version** and **Back to current version** above it.
- **Each version's ⋮ menu:** Restore, Name or Rename, Download a copy (.docx), Delete. Named versions are never pruned; unnamed ones beyond `max` (default 200) are.
- **Restoring:** the current content is saved as a version first, and the restore itself is a single step that Ctrl+Z undoes. With co-editing, the restore reaches everyone.

Versions are kept in WordCraft's own JSON format, so they hold everything in the document exactly. By default they stay in this browser (IndexedDB), separately per `documentId`. To share them between people and devices, keep them on your server:

```tsx
import { WordcraftEditor, httpVersionStore } from '@gamine/wordcraft-react';

<WordcraftEditor versionHistory={{ store: httpVersionStore(`/api/documents/${id}/versions`) }} />
```

`httpVersionStore(url)` expects `GET url` (the list), `GET url/:id` (the bytes), `PUT url/:id` (the bytes, with the metadata as JSON in an `x-version-meta` header), `PATCH url/:id` (`{ name }`) and `DELETE url/:id`. Or implement `VersionStore` (`list`, `get`, `put`, `rename`, `remove`) over anything you like.

## Without React

```ts
import { createWordcraft, preloadWordcraft } from '@gamine/wordcraft-react/core';

preloadWordcraft();               // optional: start the download early
const editor = await createWordcraft(document.getElementById('editor')!, {
  document: { name: 'letter.docx', data: await (await fetch('/letter.docx')).arrayBuffer() },
  onSave: (file) => upload(file),
});
```

The `/core` entry point has no React dependency, and importing it on the server is safe.

## Things to know

- **Size.** The binary is about 30 MB, or about 12 MB gzipped, and it's the full application, including its fonts. Load it on the pages that need it, and call `preloadWordcraft()` on hover or route prefetch.
- **Rendering.** WordCraft draws onto a `<canvas>` with its own UI toolkit (egui), which is why it can match Word's interface pixel for pixel. The flip side is that host CSS can't style what's inside the editor. Use `prefs` (dark mode, language, ribbon) and commands instead.
- **Keyboard.** As with any embedded app, shortcuts go to the editor once it has focus.
- **Persistence.** The editor keeps the document out of browser storage. Your app owns it, and both AutoSave and Save go through `onSave`; you can also call `export()` whenever you like. The browser keeps only small conveniences (recently used fonts, AI Studio settings, a key someone added) and, with the default store, version history.
- **Patches on upstream.** The package applies six small patches to WordCraft, listed in [`patches/`](patches). They cover AutoSave on the web, hiding the title bar and ribbon, the co-editing hooks, host controls (tabs, modes, turned-off commands, fonts), the AI button with Word's ribbon collapse, Windows-style inline tools, rulers, font previews and Version History's entry points, and hiding the status bar for the phone layout. Access levels use WordCraft's own Restrict Editing. The touch gestures live in this package's own code, not in a patch. They're written so they can be offered upstream. [docs/DIVERGENCES.md](docs/DIVERGENCES.md) lists every resulting difference from WordCraft.
- **How close to Word.** See [docs/WORD-PARITY.md](docs/WORD-PARITY.md).
- **Versions.** Each release bumps the patch number until a version is declared stable ([docs/VERSIONING.md](docs/VERSIONING.md)); [CHANGELOG.md](CHANGELOG.md) says what each one changed.

## Repository layout

```
crates/wordcraft-embed   Rust: wasm-bindgen API over upstream WordCraft (pinned in UPSTREAM_REV)
crates/wordcraft-collab  Rust: WordCraft documents as a Yjs-compatible CRDT (co-editing)
patches/                 Small hooks applied on top of upstream by scripts/prepare-upstream.sh
packages/wordcraft-react TypeScript: createWordcraft() core, <WordcraftEditor />, and /collab (Yjs)
examples/nextjs          Next.js App Router example, including /collab (co-editing) and its shared-file API
site/                    Documentation and showcase site (Next.js, static, deployed to GitHub Pages)
scripts/build-wasm.sh    Builds the .wasm into packages/wordcraft-react/wasm
scripts/sync-upstream.py Pins a newer upstream WordCraft commit, dependencies 1:1 with upstream
examples/nextjs/smoke-*.mjs     Headless-browser tests: the editor and its API, and two people co-editing
docs/PLAN.md             Plan of action for the WordCraft and GridCraft packages
```

## Building from source

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
npm i -g binaryen                 # optional, for the wasm-opt size pass
scripts/build-wasm.sh
cd packages/wordcraft-react && npm install && npm run build && npm test
cd ../../examples/nextjs && npm install && npm run dev
```

## Staying in step with upstream

The **Upstream sync** workflow runs every two hours, and you can also start it by hand from the Actions tab. When storytold/wordcraft has new commits, it:

1. pins the new commit, rebases `patches/` onto it with a three-way merge (refreshing them) and copies upstream's `Cargo.lock`, so every shared dependency matches upstream exactly;
2. rebuilds the WebAssembly and runs every check: Rust lints and tests, the package tests, the Next.js example build, and a headless-browser smoke test that starts the editor and exercises the API;
3. if everything passes, bumps the patch version, commits, tags `vX.Y.Z` and publishes to npm through the Release workflow.

If upstream breaks anything, nothing is published. npm keeps serving the last good version, and the workflow opens an issue that links to the failed run. If you'd rather review each update before it ships, set the repository variable `UPSTREAM_SYNC_MODE` to `pr`, and the workflow will open a pull request instead of publishing.

To release by hand, bump the patch version in `packages/wordcraft-react/package.json`, add its CHANGELOG.md section, and push to `main`; the Release workflow tags it and publishes the section as the release notes. Publishing needs either an `NPM_TOKEN` repository secret (a granular npm token with publish rights on `@gamine`) or npm trusted publishing configured for this repository's `release.yml`. A version that is already on npm is skipped, so re-running a release is safe.

## License and credits

Licensed under Apache-2.0 ([LICENSE](LICENSE)) or MIT ([LICENSE-MIT](LICENSE-MIT)), at your option. These are the same terms as WordCraft. The package bundles WordCraft by the ArtCraft Team and the WordCraft contributors, along with fonts under the SIL Open Font License. [NOTICE](NOTICE) has the details. This is an independent wrapper, not an official WordCraft release, and it is not affiliated with Microsoft.
