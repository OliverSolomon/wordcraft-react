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
| `titleBar` | `boolean` | `false` hides the title bar (AutoSave, Quick Access Toolbar, title, search, avatar). |
| `ribbon` | `'full' \| 'tabs' \| 'hidden'` | Word's Ribbon Display Options: always show, show tabs only, or hide the ribbon completely. People can also collapse the ribbon with the ^ at its corner (leaving the title bar, tabs and ruler), open a tab's commands over the page by clicking it, and pin the ribbon back. |
| `tabs`, `hiddenTabs` | `RibbonTab[]` | Which ribbon tabs to offer: `File`, `Home`, `Insert`, `Draw`, `Design`, `Layout`, `References`, `Mailings`, `Review`, `View`, `Zotero`, `Help`. Contextual tabs (Table Design, Picture Format…) still appear when needed. Applied live. |
| `mode` | `'editing' \| 'reviewing' \| 'viewing'` | Word's mode switch. Reviewing turns on Track Changes; Viewing allows reading, copying, printing and exporting but no changes. People can also switch it from the button beside Comments. |
| `disabledCommands` | `string[]` | Commands to turn off, by id from `editor.commands()` or by prefix (`'mailings.*'`, `'file.open'`). They're greyed in the ribbon and refused from shortcuts, menus and `execute`. |
| `fonts` | `FontSource \| FontSource[] \| false` | Fonts offered in the font box on demand. The default is `googleFonts()`, the whole Google Fonts library, fetched when first picked or when a document uses one. `false` keeps to the built-in fonts. |
| `ai` ✦ Extra | `AiOptions` or `true` | A sparkle at the bottom centre opens a Gemini-style AI bar with AI Studio (skills with the Humaniser on by default, letterheads, palettes, model). Works with your endpoint, a provider key, or people's own OpenRouter/OpenAI/Anthropic/Gemini key. See [AI](#ai-extra). |
| `versionHistory` ✦ Extra | `boolean` or `{ store?, documentId?, interval?, max? }` | Version history like Google Docs: versions recorded as people work, in a panel to view, restore, name, download or delete. Opens from the title bar, File › Info and Ctrl+Alt+Shift+H. See [Version history](#version-history-extra). |
| `versionsOpen`, `onVersionsOpenChange` | | Open or close the version history panel yourself. |
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
editor.destroy();
```

`execute` runs the same command registry that WordCraft's ribbon, keyboard shortcuts, CLI and MCP server use, so anything a user can do from the ribbon can also be scripted. Call `editor.commands()` for the full list, including each command's parameters.

## Co-editing

Several people can edit one document at once, the way Word's co-authoring works:

- **Merging.** Changes merge as people type, down to the character. Two people typing in the same paragraph both keep their words. Formatting merges property by property, so one person's bold and another's italics on the same word both stick.
- **Structure.** Paragraph splits, tables, headers, footers, notes, comments, pictures and document settings are all shared.
- **Undo.** Ctrl+Z and the Undo button take back only your own changes, not other people's.
- **Presence.** Everyone else's cursor and selection show on the page in their colour with a name flag, and their avatars appear in the title bar.
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

The first person to open a document shares whatever the editor has open (pass the stored file as `document`). Everyone who joins later gets the live shared document instead. `yjsCollaboration` waits for the provider's first sync before joining, so a document is never put in twice. [`examples/nextjs/app/collab`](examples/nextjs/app/collab) is a complete page with a shared-file API that keeps the last 20 versions. Run `npm run collab-server` next to `npm run dev` and open `/collab` in two windows to try it.

## Fonts

The browser build bundles a handful of fonts, so the font box also offers fonts on demand, the way Word offers cloud fonts. By default that's the Google Fonts library (about 1,970 openly licensed families). A font downloads from the Fontsource CDN the first time someone picks it, or when an opened document uses it. The font box lists Theme Fonts, Recently Used Fonts and All Fonts, as Word does, shows each name in its own font, and remembers recently used fonts in the browser. To preview a web font it fetches just its regular face, and only for the rows on screen.

```tsx
import { googleFonts } from '@gamine/wordcraft-react';
<WordcraftEditor fonts={googleFonts({ categories: ['serif', 'sans-serif'] })} />   // a narrower list
<WordcraftEditor fonts={{ families: () => ['Brand Sans'], load: async () => [await (await fetch('/fonts/brand.ttf')).arrayBuffer()].map((b) => new Uint8Array(b)) }} />
<WordcraftEditor fonts={false} />                                                    // built-in fonts only
```

## Extras

Everything in this package matches Word and WordCraft, except features marked **✦ Extra**. Extras are additions of this package and are not part of Microsoft Word or WordCraft. In the editor they carry an *Extra* tag. They are:

- ✦ **AI writing and AI Studio** (below).
- ✦ **Real-time co-editing** with per-person undo and live cursors ([Co-editing](#co-editing)). Word has this; WordCraft does not yet.
- ✦ **Fonts on demand** from the Google Fonts library ([Fonts](#fonts)).
- ✦ **Version history** in the style of Google Docs ([Version history](#version-history-extra)). Word has version history for files in OneDrive; WordCraft has none.

The full list of differences from WordCraft, Extras or not, is in [docs/DIVERGENCES.md](docs/DIVERGENCES.md).

## AI (Extra)

`ai` puts a sparkle at the bottom centre of the editor, like Gemini in Google Docs. Hovering shows "Help me write"; clicking opens the AI bar:

- **Quick actions:** chips above the prompt box. With text selected: Rewrite, Shorten, Elaborate, More formal, and under More: Fix grammar, Summarize, More casual, Turn into an email, Make an outline, Match doc format. Without a selection: Match doc format, Continue writing, Meeting notes, Email draft, and under More: Summarize, Outline, Brainstorm.
- **The prompt box:** + for templates (proposal, formal letter, blog post, cover letter and more), AI Studio, the "Write with …" field, a ⋮ menu and the send button.
- **Answers:** they stream into a preview. People then insert it, replace the selection, insert it below, try again or discard it.

### AI Studio

The sliders button in the prompt box opens AI Studio. Its settings stay in the person's browser.

- **Skills:** writing instructions added to every request. The **Humaniser** is on by default. It asks for natural, human-sounding prose with varied rhythm, plain words, no stock AI phrases and no em dashes. Built-in skills also include Plain English, Concise, Persuasive, Academic, Warm & friendly and British English. People can write their own skill or import a `SKILL.md` (front matter `name` and `description`, then the instructions). Your app can add skills with `ai.skills` and choose which are on with `ai.defaultSkills`.
- **Letterhead:** organisation name, tagline, address, contact line, logo, font, alignment and an accent rule, with a live preview. *Apply to document* writes it into the document header. The AI also gets these details as context for letters and emails. Your app can supply a starting letterhead with `ai.letterhead`.
- **Palette:** eight brand palettes and a custom one. *Apply to headings* recolours the title and Heading 1 to 3, and the letterhead uses the same colours. Your app can add palettes with `ai.palettes`.
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

Other options: `launcher: 'none'` hides the sparkle (control the bar with the `aiOpen` and `onAiOpenChange` props), `ribbonButton: true` adds a sparkle beside Comments in the ribbon, `studio: false` hides skills, letterhead and palette, and `onStudioChange` reports AI Studio's settings so you can keep them on your server.

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
- **Patches on upstream.** The package applies five small patches to WordCraft, listed in [`patches/`](patches). They cover AutoSave on the web, hiding the title bar and ribbon, the co-editing hooks, host controls (tabs, modes, turned-off commands, fonts), the AI button with Word's ribbon collapse, and Windows-style inline tools, rulers, font previews and Version History's entry points. They're written so they can be offered upstream. [docs/DIVERGENCES.md](docs/DIVERGENCES.md) lists every resulting difference from WordCraft.
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
