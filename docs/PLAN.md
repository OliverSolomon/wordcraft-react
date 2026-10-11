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

The trade-off with option 2 is that the editor is a canvas application. Host CSS can't style its insides, and the binary is large (about 30 MB, or 12 MB gzipped). Both are acceptable for an "embed Word or Excel in my app" product, and the README documents them.

## Architecture (same for both packages)

```
host React / Next.js app
  └─ <WordcraftEditor /> (packages/*/src/index.tsx: 'use client', SSR-safe, ref API)
       └─ createWordcraft(el) (packages/*/src/core.ts: framework-agnostic loader + typed API)
            ├─ /collab: yjsCollaboration() (Yjs doc + awareness ⇄ the editor's co-editing port)
            └─ wordcraft_embed.wasm (crates/*-embed: wasm-bindgen surface)
                 ├─ crates/*-collab (the document model as a Yjs-compatible CRDT, via yrs)
                 └─ upstream WordApp / Session (pinned commit + patches/)
```

The embed crate replaces only the upstream page shell (`apps/<name>-web/src/web.rs`). It:

- mounts on any canvas instead of a fixed `#id`, and supports several editors on one page and `destroy()`.
- exposes `load`, `export` in every upstream format, `execute(commandId, params)`, `commands()`, text getters, undo state, dirty tracking and UI preferences.
- sends Save, Save As and Export to a host `onSave` callback, falling back to a browser download.
- fires `onChange` after edits, deferred to a microtask so callbacks can safely call back into the editor.
- runs AutoSave through `onSave` (never browser storage), switchable from the title bar toggle as in Word.
- sets the person editing (avatar, comments, tracked changes) and can hide the title bar and the ribbon (Word's Ribbon Display Options).
- co-edits: keeps the document in a Yjs-compatible shared state, sends Undo and Redo through it so they take back only your own changes, and draws other people's cursors, selections and avatars.

Upstream is pinned to one commit (`UPSTREAM_REV`) and never forked. A few small hooks the embed needs are kept as patches in `patches/`, applied by `scripts/prepare-upstream.sh` before every build, and written so they can be offered upstream. Updating is automatic. The daily Upstream sync workflow pins the new commit, re-applies the patches, takes upstream's own lockfile, rebuilds, runs every check including a headless-browser smoke test, and publishes a patch release. If upstream breaks anything, it opens an issue instead. `scripts/sync-upstream.py` does the same pinning by hand.

## Phases

### Phase 1: WordCraft (this repo)
1. Embed crate with the wasm-bindgen API (done).
2. TypeScript core and React component, SSR-safe, with a typed ref API (done).
3. Build script for the binary: cargo, then wasm-bindgen, then wasm-opt `-Oz`, matching upstream's trunk settings (done).
4. Next.js App Router example (done).
5. CI that runs fmt, clippy, tests, the binary build, the package build and the example build, plus a tag-driven npm release with provenance (done).
6. Browser verification in headless Chromium (WebGL2): the full ribbon renders, and load, export (docx, pdf, html, md), the docx round trip, execute, prefs, Ctrl+S reaching onSave, and keyboard typing all work (done).
7. Publish to npm (done: 0.1.1, then automatic releases).
8. Working AutoSave when embedded, a configurable and readable user, and hideable title bar and ribbon (done, 0.2.0).
10. Upstream every two hours with self-refreshing patches; host-chosen ribbon tabs, Word's Editing/Reviewing/Viewing modes, turned-off commands, Google Fonts on demand with Recently Used Fonts, comment click-to-text, and an AI writing bar like Google Docs (done, 0.2.0). See docs/WORD-PARITY.md for how close the editor is to Word.
9. Real-time co-editing the way Word does it, on Yjs (done, 0.2.0): character-level merging, property-level formatting merges, per-person undo, cursors and avatars, AutoSave of the one shared file with version history in the example, and a two-browser test in CI.

### Phase 2: GridCraft
Copy this repo's template to `gridcraft-react`. GridCraft has the same layout (`apps/gridcraft-web`, `crates/ui-egui`, `crates/engine`, egui 0.36), so the embed crate is a port of this one. The spreadsheet-specific API additions are:
- `load` and `export` for xlsx, csv, ods and pdf.
- reading and writing cell values and ranges (`getCell`, `setCell`, `getRange`), plus the active sheet and selection.
- `onChange` with the changed sheet and range, so a host can sync data without exporting the whole workbook.

### Phase 3: Hardening and developer experience
- A shared `@gamine/craft-core` loader if more craft apps follow (PDFCraft, DesignCraft and others share the conventions).
- Precompressed `.wasm.br` and a documented CDN recipe.
- Server-side snapshots: convert the shared state to .docx on the server (a Node build of the collab crate), so the file stays current even when nobody's editor is open.
- Comments and tracked changes shown live per author in co-editing (they already sync as data).
- Docs site with live demos.
- Optional: ask upstream to accept the embed API as a `lib` target in `apps/<name>-web`. The wrapper would then shrink to the TypeScript layer.

## Constraints we keep from upstream
- No Microsoft assets of any kind. Everything visual comes from upstream, which is clean-room.
- Credit upstream in NOTICE, and don't use the ArtCraft name, wordmark or logos.
- No panics in Rust code. Errors cross into JavaScript as `Error`s.
