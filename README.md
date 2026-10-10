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
| `dark`, `author`, `prefs` | | UI preferences, applied live: ribbon `tab`, `dark`, `darkPage`, `ribbonCollapsed`, `language`, `author`, `showDiscord`. |
| `renderer` | `'auto' \| 'webgl'` | Uses WebGPU and falls back to WebGL2. Pass `webgl` to force WebGL2. |
| `height`, `className`, `style` | | The editor fills its container. The default height is 720px. |
| `loading`, `fallback` | `ReactNode` | `loading` shows while the editor starts. `fallback` shows if it can't start. |
| `onReady(editor)` | | Called once the editor is running. |
| `onChange({ rev, dirty }, editor)` | | Called after edits, at most once per frame. |
| `onSave(file, editor)` | | Called on Save, Save As and Export in WordCraft's own UI with `{ name, mimeType, bytes }`. If the promise you return resolves, the document is marked saved. Without this prop the browser downloads the file. |
| `onError(error)` | | |
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
editor.undo(); editor.redo(); editor.canUndo(); editor.canRedo();
editor.isDirty(); editor.markSaved(); editor.rev(); editor.title();
editor.getPrefs(); editor.setPrefs({ tab: 'Review', dark: true });
editor.destroy();
```

`execute` runs the same command registry that WordCraft's ribbon, keyboard shortcuts, CLI and MCP server use, so anything a user can do from the ribbon can also be scripted. Call `editor.commands()` for the full list, including each command's parameters.

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
- **Persistence.** Autosave and local storage are switched off when the editor is embedded. Your app owns the document, so use `onSave`, or call `export()` whenever you like.

## Repository layout

```
crates/wordcraft-embed   Rust: wasm-bindgen API over upstream WordCraft (pinned in Cargo.toml / UPSTREAM_REV)
packages/wordcraft-react TypeScript: createWordcraft() core + <WordcraftEditor /> React component
examples/nextjs          Next.js App Router example
scripts/build-wasm.sh    Builds the .wasm into packages/wordcraft-react/wasm
scripts/bump-upstream.sh Moves to a newer upstream WordCraft commit
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

To release, bump the version in `packages/wordcraft-react/package.json` and push a matching `v*` tag. The release workflow builds the binary and publishes to npm with provenance. It needs an `NPM_TOKEN` secret.

## License and credits

Licensed under Apache-2.0 ([LICENSE](LICENSE)) or MIT ([LICENSE-MIT](LICENSE-MIT)), at your option. These are the same terms as WordCraft. The package bundles WordCraft by the ArtCraft Team and the WordCraft contributors, along with fonts under the SIL Open Font License. [NOTICE](NOTICE) has the details. This is an independent wrapper, not an official WordCraft release, and it is not affiliated with Microsoft.
