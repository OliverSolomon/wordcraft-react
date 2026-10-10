# Plan of action: WordCraft and GridCraft as npm packages

## Goal

Ship the storytold "craft" apps as npm packages that a React or Next.js app can import and use like TipTap or any other WYSIWYG editor, with a 1:1 match to the original apps:

| Upstream | Look-alike of | npm package | Repository |
|---|---|---|---|
| [storytold/wordcraft](https://github.com/storytold/wordcraft) | Microsoft Word | `@gamine/wordcraft-react` | [OliverSolomon/wordcraft-react](https://github.com/OliverSolomon/wordcraft-react) |
| [storytold/gridcraft](https://github.com/storytold/gridcraft) | Microsoft Excel | `@gamine/gridcraft-react` | OliverSolomon/gridcraft-react (to create) |

## The key decision: wrap the real app, don't rebuild it

Both upstream projects are Rust workspaces with the same layered architecture. Each has a document engine with a command registry (every ribbon button, shortcut, CLI and MCP action is a command id) and an egui front end that draws a Word-style or Excel-style ribbon on a canvas. Each also ships an official browser build (`apps/<name>-web`) that compiles the whole app to WebAssembly and runs it with WebGPU, falling back to WebGL2.

That gives us two ways to build a package:

1. **Rebuild the UI in React** and use only the engine through WebAssembly. That would mean months of work re-creating the ribbon, the dialogs, the page rendering and the typing behaviour. The result would drift from upstream with every release, so it could never be a 1:1 match.
2. **Wrap the official web build** (chosen). Embed the exact upstream app on a canvas the host owns, and add a thin API layer around it. Look and behaviour are identical by construction, and keeping up with upstream means bumping a commit hash.

The trade-off with option 2 is that the editor is a canvas application. Host CSS can't style its insides, and the binary is large (about 25 MB, or 10 MB gzipped). Both are acceptable for an "embed Word or Excel in my app" product, and the README documents them.

## Architecture (same for both packages)

```
host React / Next.js app
  └─ <WordcraftEditor /> (packages/*/src/index.tsx: 'use client', SSR-safe, ref API)
       └─ createWordcraft(el) (packages/*/src/core.ts: framework-agnostic loader + typed API)
            └─ wordcraft_embed.wasm (crates/*-embed: wasm-bindgen surface, pinned upstream)
                 └─ upstream WordApp / Session (unmodified egui UI + engine)
```

The embed crate replaces only the upstream page shell (`apps/<name>-web/src/web.rs`). It:

- mounts on any canvas instead of a fixed `#id`, and supports several editors on one page and `destroy()`.
- exposes `load`, `export` in every upstream format, `execute(commandId, params)`, `commands()`, text getters, undo state, dirty tracking and UI preferences.
- sends Save, Save As and Export to a host `onSave` callback, falling back to a browser download.
- fires `onChange` after edits, deferred to a microtask so callbacks can safely call back into the editor.
- turns autosave and local storage off, because the host owns persistence.

Upstream is consumed as a git dependency pinned to one commit (`UPSTREAM_REV`), never forked. Updating is `scripts/bump-upstream.sh`, then a rebuild, a smoke test and a release.

## Phases

### Phase 1: WordCraft (this repo)
1. Embed crate with the wasm-bindgen API (done).
2. TypeScript core and React component, SSR-safe, with a typed ref API (done).
3. Build script for the binary: cargo, then wasm-bindgen, then wasm-opt `-Oz`, matching upstream's trunk settings (done).
4. Next.js App Router example (done).
5. CI that runs fmt, clippy, tests, the binary build, the package build and the example build, plus a tag-driven npm release with provenance (done).
6. Browser verification in headless Chromium (WebGL2): the full ribbon renders, and load, export (docx, pdf, html, md), the docx round trip, execute, prefs, Ctrl+S reaching onSave, and keyboard typing all work (done).
7. Publish to npm: needs an `NPM_TOKEN` secret with rights on the `@gamine` scope, then a `v0.1.0` tag.

### Phase 2: GridCraft
Copy this repo's template to `gridcraft-react`. GridCraft has the same layout (`apps/gridcraft-web`, `crates/ui-egui`, `crates/engine`, egui 0.36), so the embed crate is a port of this one. The spreadsheet-specific API additions are:
- `load` and `export` for xlsx, csv, ods and pdf.
- reading and writing cell values and ranges (`getCell`, `setCell`, `getRange`), plus the active sheet and selection.
- `onChange` with the changed sheet and range, so a host can sync data without exporting the whole workbook.

### Phase 3: Hardening and developer experience
- A shared `@gamine/craft-core` loader if more craft apps follow (PDFCraft, DesignCraft and others share the conventions).
- Precompressed `.wasm.br` and a documented CDN recipe.
- Playwright smoke tests in CI against the example app.
- Docs site with live demos.
- Optional: ask upstream to accept the embed API as a `lib` target in `apps/<name>-web`. The wrapper would then shrink to the TypeScript layer.

## Constraints we keep from upstream
- No Microsoft assets of any kind. Everything visual comes from upstream, which is clean-room.
- Credit upstream in NOTICE, and don't use the ArtCraft name, wordmark or logos.
- No panics in Rust code. Errors cross into JavaScript as `Error`s.
