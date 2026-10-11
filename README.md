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

If you would rather serve the binary yourself (from a CDN, say, or from `public/`), copy `node_modules/@gamine/wordcraft-react/wasm/wordcraft_embed_bg.wasm` and pass `wasmUrl="/wordcraft_embed_bg.wasm"`. Serve it as `application/wasm` with gzip or Brotli. Compression takes it from about 25 MB to about 10 MB with gzip, and less with Brotli. When a bundler emits the file, its name carries a content hash, so it can be cached indefinitely. If you copy it yourself, the name doesn't change between releases, so give it a cache lifetime that matches your deploys.

A complete example app lives in [`examples/nextjs`](examples/nextjs).

## Component props

| Prop | Type | Notes |
|---|---|---|
| `document` | `{ name, data }` | Opens on mount. `data` can be an `ArrayBuffer`, a `Uint8Array` or a `Blob`, and the extension in `name` picks the format. If you change it later, the new document loads. |
| `sample` | `boolean` | Starts with WordCraft's built-in sample document. |
| `user` | `{ name, color?, id? }` | The person editing. The name shows on the title bar avatar and signs comments and tracked changes; `color` is their cursor colour when co-editing. Changes apply live; read it back with `editor.getUser()`. |
| `autoSave` | `boolean` | AutoSave starts on (default) or off. It writes through `onSave` with `reason: 'autosave'` a couple of seconds after edits, and the title bar toggle switches it, as in Word. Needs `onSave`. |
| `titleBar` | `boolean` | `false` hides the title bar (AutoSave, Quick Access Toolbar, title, search, avatar). |
| `ribbon` | `'full' \| 'tabs' \| 'hidden'` | Word's Ribbon Display Options: always show, show tabs only, or hide the ribbon completely. |
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
editor.destroy();
```

`execute` runs the same command registry that WordCraft's ribbon, keyboard shortcuts, CLI and MCP server use, so anything a user can do from the ribbon can also be scripted. Call `editor.commands()` for the full list, including each command's parameters.

## Co-editing

Several people can edit one document at once, the way Word's co-authoring works:

- **Merging.** Changes merge as people type, down to the character. Two people typing in the same paragraph both keep their words. Formatting merges property by property, so one person's bold and another's italics on the same word both stick.
- **Structure.** Paragraph splits, tables, headers, footers, notes, comments, pictures and document settings are all shared.
- **Undo.** Ctrl+Z and the Undo button take back only your own changes, not other people's.
- **Presence.** Everyone else's cursor and selection show on the page in their colour with a name flag, and their avatars appear in the title bar.
- **Saving.** AutoSave writes the merged document over the one shared file, so nobody's save overwrites anyone else's work. Keep earlier versions on your server if you want version history; the example does.

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

- **Size.** The binary is about 25 MB, or about 10 MB gzipped, and it's the full application, including its fonts. Load it on the pages that need it, and call `preloadWordcraft()` on hover or route prefetch.
- **Rendering.** WordCraft draws onto a `<canvas>` with its own UI toolkit (egui), which is why it can match Word's interface pixel for pixel. The flip side is that host CSS can't style what's inside the editor. Use `prefs` (dark mode, language, ribbon) and commands instead.
- **Keyboard.** As with any embedded app, shortcuts go to the editor once it has focus.
- **Persistence.** The editor never writes to browser storage. Your app owns the document, and both AutoSave and Save go through `onSave`. You can also call `export()` whenever you like.
- **Patches on upstream.** The package applies three small patches to WordCraft, listed in [`patches/`](patches): AutoSave on the web, hideable title bar and ribbon, the co-editing hooks, and the browser clock. They're written so they can be offered upstream.

## Repository layout

```
crates/wordcraft-embed   Rust: wasm-bindgen API over upstream WordCraft (pinned in UPSTREAM_REV)
crates/wordcraft-collab  Rust: WordCraft documents as a Yjs-compatible CRDT (co-editing)
patches/                 Small hooks applied on top of upstream by scripts/prepare-upstream.sh
packages/wordcraft-react TypeScript: createWordcraft() core, <WordcraftEditor />, and /collab (Yjs)
examples/nextjs          Next.js App Router example, including /collab (co-editing) and its shared-file API
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

1. pins the new commit, re-applies `patches/` on top of it and copies upstream's `Cargo.lock`, so every shared dependency matches upstream exactly;
2. rebuilds the WebAssembly and runs every check: Rust lints and tests, the package tests, the Next.js example build, and a headless-browser smoke test that starts the editor and exercises the API;
3. if everything passes, bumps the patch version, commits, tags `vX.Y.Z` and publishes to npm through the Release workflow.

If upstream breaks anything, nothing is published. npm keeps serving the last good version, and the workflow opens an issue that links to the failed run. If you'd rather review each update before it ships, set the repository variable `UPSTREAM_SYNC_MODE` to `pr`, and the workflow will open a pull request instead of publishing.

To release by hand, bump the version in `packages/wordcraft-react/package.json` and push a matching `v*` tag. Publishing needs either an `NPM_TOKEN` repository secret (a granular npm token with publish rights on `@gamine`) or npm trusted publishing configured for this repository's `release.yml`. A version that is already on npm is skipped, so re-running a release is safe.

## License and credits

Licensed under Apache-2.0 ([LICENSE](LICENSE)) or MIT ([LICENSE-MIT](LICENSE-MIT)), at your option. These are the same terms as WordCraft. The package bundles WordCraft by the ArtCraft Team and the WordCraft contributors, along with fonts under the SIL Open Font License. [NOTICE](NOTICE) has the details. This is an independent wrapper, not an official WordCraft release, and it is not affiliated with Microsoft.
