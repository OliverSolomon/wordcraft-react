/**
 * Framework-agnostic WordCraft embedding.
 *
 * `createWordcraft(container)` mounts the real WordCraft editor (ribbon, dialogs, pages and
 * engine, compiled from upstream Rust to WebAssembly) inside any element and returns a handle to
 * drive it. Nothing here touches `window` at import time, so the module is safe to import during
 * server-side rendering; only `createWordcraft` needs a browser.
 */

/** Formats WordCraft can open. */
export type OpenFormat = 'docx' | 'docm' | 'dotx' | 'dotm' | 'doc' | 'dot' | 'odt' | 'rtf' | 'md' | 'html' | 'htm' | 'txt' | 'tex' | 'json';
/** Formats WordCraft can save or export. */
export type ExportFormat = 'docx' | 'docm' | 'dotx' | 'dotm' | 'odt' | 'rtf' | 'md' | 'html' | 'txt' | 'tex' | 'json' | 'pdf' | 'png';

/** Bytes in any of the shapes browsers hand out. */
export type BinaryLike = Uint8Array | ArrayBuffer | Blob;

/** A named document, e.g. `{ name: 'report.docx', data: await res.arrayBuffer() }`. */
export interface DocumentSource {
  /** File name; its extension picks the format. */
  name: string;
  data: BinaryLike;
}

/** WordCraft UI preferences. Unknown keys are ignored. */
export interface WordcraftPrefs {
  /** Ribbon tab: `Home`, `Insert`, `Design`, `Layout`, `References`, `Mailings`, `Review`, `View`, ... */
  tab: string;
  /** Dark interface. */
  dark: boolean;
  /** Pages drawn dark too (View > Switch Modes). */
  darkPage: boolean;
  /** Collapse the ribbon to its tab row (Word's "Show tabs only"). */
  ribbonCollapsed: boolean;
  /** Hide the ribbon including its tabs (Word's "Auto-hide Ribbon"). */
  hideRibbon: boolean;
  /** Hide the title bar: AutoSave, Quick Access Toolbar, title, search and the account avatar. */
  hideTitleBar: boolean;
  /** `auto` or a language code (`en`, `ja`, `pt-br`, `uk`, `zh-hant`, ...). */
  language: string;
  /** Author name used for comments and tracked changes. */
  author: string;
  /** Show the community (Discord) link in the UI. Off by default when embedded. */
  showDiscord: boolean;
  /** Open on the File (backstage) view. */
  backstage: boolean;
  [key: string]: unknown;
}

export interface ChangeInfo {
  /** Edit revision; rises with every change. */
  rev: number;
  /** Unsaved changes since the last load or `markSaved()`. */
  dirty: boolean;
}

/** A file produced by Save, Save As, Export or AutoSave in WordCraft's own UI. */
export interface SavedFile {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  /** The same bytes as a Blob with the right MIME type, ready for `fetch(url, { body })`. */
  blob: Blob;
  /** `autosave` when AutoSave wrote it (a couple of seconds after edits), else `save`. */
  reason: 'save' | 'autosave';
}

/** The person editing. */
export interface WordcraftUser {
  /** Shown on the avatar (as initials) and signs comments and tracked changes. */
  name: string;
  /** Colour for this person's cursor and avatar when collaborating, e.g. `#d9480f`. */
  color?: string;
  /** A stable id for this person (collaboration); defaults to the name. */
  id?: string;
}

/** A selection as base64 Yjs relative positions (shared through awareness). */
export interface CollabCursor {
  anchor: string;
  head: string;
}

/** Someone else in the document, as the editor draws them. */
export interface CollabPeer {
  name: string;
  color?: string;
  anchor?: string | null;
  head?: string | null;
}

/**
 * The editor's low-level co-editing port. `@gamine/wordcraft-react/collab` connects it to a
 * Yjs document and awareness; use it directly only to bridge another sync system.
 */
export interface CollabPort {
  /**
   * Join with the shared state (one Yjs update, after the provider synced). Returns `true` when
   * the shared document was empty and the open document was put into it.
   */
  start(clientId: number, state: Uint8Array | null): boolean;
  /** Apply a remote update. */
  apply(update: Uint8Array): void;
  /** The whole shared state as one Yjs update. */
  state(): Uint8Array;
  /** Leave (the document stays; Undo returns to WordCraft's own history). */
  stop(): void;
  /** Local changes to broadcast. */
  onUpdate(cb: ((update: Uint8Array) => void) | null): void;
  /** This person's selection, when it moves. */
  onCursor(cb: ((cursor: CollabCursor | null) => void) | null): void;
  /** Who else is here, with their selections (drawn on the pages and in the title bar). */
  setPeers(peers: CollabPeer[]): void;
}

/**
 * Something that connects an editor to collaborators, e.g. `yjsCollaboration({ doc, provider })`
 * from `@gamine/wordcraft-react/collab`. `attach` returns a function that disconnects.
 */
export interface Collaboration {
  attach(editor: WordcraftEditor): () => void;
}

/** Word's Ribbon Display Options. */
export type RibbonDisplay = 'full' | 'tabs' | 'hidden';

/** The UI preferences that show or hide the title bar and ribbon. */
export function chromePrefs(titleBar: boolean | undefined, ribbon: RibbonDisplay | undefined): Partial<WordcraftPrefs> {
  const out: Partial<WordcraftPrefs> = {};
  if (titleBar !== undefined) out.hideTitleBar = !titleBar;
  if (ribbon !== undefined) {
    out.hideRibbon = ribbon === 'hidden';
    out.ribbonCollapsed = ribbon === 'tabs';
  }
  return out;
}

/** A command from WordCraft's registry (the same ids the ribbon, shortcuts and MCP use). */
export interface CommandInfo {
  id: string;
  label: string;
  /** Where Word has it, e.g. `Home › Font`. */
  location: string;
  /** Keyboard shortcut, e.g. `Mod+B`; empty when none. */
  shortcut: string;
  /** Params documentation, e.g. `{"text": string}`; empty when none. */
  params: string;
  /** Does it change the document? */
  mutates: boolean;
}

export interface WordcraftOptions {
  /** Document to open on start. Without one WordCraft starts with a blank document. */
  document?: DocumentSource;
  /** Start with WordCraft's built-in sample document. */
  sample?: boolean;
  /** `auto` (WebGPU, falling back to WebGL2) or `webgl` to force WebGL2. */
  renderer?: 'auto' | 'webgl';
  /** Initial UI preferences. */
  prefs?: Partial<WordcraftPrefs>;
  /**
   * Where to load `wordcraft_embed_bg.wasm` from. By default it is resolved next to the package's
   * JavaScript, which webpack 5 / Next.js, Vite, Rollup and esbuild handle automatically. Set this
   * to serve it from a CDN or `public/`.
   */
  wasmUrl?: string | URL;
  /** Ask before the browser tab closes or navigates away with unsaved changes. Off by default. */
  guardUnload?: boolean;
  /** The person editing. Their name signs comments and tracked changes and shows on the avatar. */
  user?: WordcraftUser;
  /**
   * Start with AutoSave on. AutoSave writes the document through `onSave` (with
   * `reason: 'autosave'`) a couple of seconds after edits, as Word does for cloud files, and
   * people can switch it with the toggle in the title bar. Needs `onSave`. Default: on.
   */
  autoSave?: boolean;
  /** Show the title bar (AutoSave, Quick Access Toolbar, title, search, avatar). Default: true. */
  titleBar?: boolean;
  /** Ribbon Display Options: `full` (default), `tabs` (tabs only) or `hidden`. */
  ribbon?: RibbonDisplay;
  /** Called after edits (coalesced to at most once per frame). */
  onChange?: (info: ChangeInfo) => void;
  /**
   * Called when the user saves or exports from WordCraft's UI. Without it the browser downloads
   * the file, as in the official web build. Return a promise to have `markSaved()` called once it
   * resolves for the document's own format.
   */
  onSave?: (file: SavedFile) => void | Promise<void>;
}

export interface WordcraftEditor {
  /** The canvas WordCraft draws on. */
  readonly canvas: HTMLCanvasElement;
  /** Open a document. `name`'s extension picks the format. */
  load(source: DocumentSource | File): Promise<void>;
  /** Start a new blank document. */
  newDocument(): void;
  /** Serialise the document to bytes, e.g. `export('docx')` or `export('report.pdf')`. */
  export(format: ExportFormat | string): Uint8Array;
  /** `export` wrapped in a Blob with the right MIME type. */
  exportBlob(format: ExportFormat | string): Blob;
  /** The document as HTML. */
  getHTML(): string;
  /** The document as Markdown. */
  getMarkdown(): string;
  /** The body text. */
  getText(): string;
  /** The selected text. */
  getSelectedText(): string;
  /** Open the browser's print dialog on the document (File > Print). */
  print(): void;
  /** The person editing. */
  getUser(): WordcraftUser;
  /** Change the person editing (name on the avatar, comments and tracked changes). */
  setUser(user: WordcraftUser): void;
  /** Low-level co-editing port (see `@gamine/wordcraft-react/collab`). */
  readonly collab: CollabPort;
  /** Whether AutoSave is on. */
  isAutoSaving(): boolean;
  /** Turn AutoSave on or off (needs `onSave`); returns whether it is now on. */
  setAutoSave(on: boolean): boolean;
  /** Run any WordCraft command by id, e.g. `execute('format.bold')`, `execute('text.insert', { text: 'Hi' })`. */
  execute<T = unknown>(command: string, params?: Record<string, unknown>): T;
  /** Every command in WordCraft's registry. */
  commands(): CommandInfo[];
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Title shown in WordCraft's title bar. */
  title(): string;
  rev(): number;
  isDirty(): boolean;
  /** Tell WordCraft the host has persisted the document. */
  markSaved(): void;
  getPrefs(): WordcraftPrefs;
  setPrefs(patch: Partial<WordcraftPrefs>): void;
  /** Replace the change listener (or remove it with `null`). */
  setOnChange(cb: ((info: ChangeInfo) => void) | null): void;
  /** Replace the save listener (or remove it with `null`, restoring browser downloads). */
  setOnSave(cb: ((file: SavedFile) => void | Promise<void>) | null): void;
  /** True once destroyed or after an unrecoverable error. */
  readonly destroyed: boolean;
  /** Stop the editor and remove its canvas. Safe to call twice. */
  destroy(): void;
}

// ---------------------------------------------------------------------------------------------
// wasm-bindgen glue

interface RawHandle {
  load(name: string, bytes: Uint8Array): void;
  newDocument(): void;
  export(name: string): Uint8Array;
  execute(id: string, params?: string | null): string;
  commands(): string;
  getText(): string;
  getSelectedText(): string;
  title(): string;
  rev(): number;
  isDirty(): boolean;
  markSaved(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  getPrefs(): string;
  setPrefs(patch: string): void;
  setOnChange(cb: ((info: ChangeInfo) => void) | null): void;
  setOnSave(cb: ((file: Omit<SavedFile, 'blob'>) => void) | null): void;
  hasPanicked(): boolean;
  getUser(): string;
  setUserName(name: string): void;
  isAutoSaving(): boolean;
  setAutoSave(on: boolean): boolean;
  setPersist(on: boolean): void;
  collabStart(clientId: number, state: Uint8Array | null): boolean;
  collabApply(update: Uint8Array): void;
  collabState(): Uint8Array;
  collabStop(): void;
  setOnCollabUpdate(cb: ((update: Uint8Array) => void) | null): void;
  setOnCollabCursor(cb: ((cursor: CollabCursor | null) => void) | null): void;
  setPeers(json: string): void;
  destroy(): void;
  free?(): void;
}

interface Glue {
  default(input?: { module_or_path?: string | URL | Request } | string | URL): Promise<unknown>;
  mount(canvas: HTMLCanvasElement, options?: string | null, name?: string | null, bytes?: Uint8Array | null): Promise<RawHandle>;
}

let gluePromise: Promise<Glue> | null = null;

/**
 * Load and instantiate the WebAssembly module once per page. Called by `createWordcraft`; call it
 * yourself to start the (large) download early, e.g. on hover over an "Open editor" button.
 */
export function preloadWordcraft(wasmUrl?: string | URL): Promise<void> {
  return loadGlue(wasmUrl).then(() => undefined);
}

function loadGlue(wasmUrl?: string | URL): Promise<Glue> {
  if (!gluePromise) {
    gluePromise = (async () => {
      const glue = (await import('../wasm/wordcraft_embed.js')) as unknown as Glue;
      // Without an explicit URL the glue resolves `wordcraft_embed_bg.wasm` relative to itself
      // via `new URL(..., import.meta.url)`, which bundlers turn into an emitted asset.
      await glue.default(wasmUrl ? { module_or_path: wasmUrl } : undefined);
      return glue;
    })();
    gluePromise.catch(() => {
      gluePromise = null;
    });
  }
  return gluePromise;
}

const MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  docm: 'application/vnd.ms-word.document.macroEnabled.12',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  pdf: 'application/pdf',
  png: 'image/png',
  html: 'text/html',
  htm: 'text/html',
  md: 'text/markdown',
  txt: 'text/plain',
  tex: 'application/x-tex',
  json: 'application/json',
};

/** MIME type for a file name or bare extension. */
export function mimeTypeFor(nameOrExt: string): string {
  const ext = nameOrExt.includes('.') ? nameOrExt.slice(nameOrExt.lastIndexOf('.') + 1) : nameOrExt;
  return MIME[ext.toLowerCase()] ?? 'application/octet-stream';
}

/** `docx` -> `document.docx`; names that already have an extension pass through. */
export function exportName(format: string): string {
  return format.includes('.') ? format : `document.${format}`;
}

export async function toBytes(data: BinaryLike): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer());
}

const DEFAULT_PREFS: Partial<WordcraftPrefs> = { showDiscord: false };

/**
 * Mount WordCraft inside `container`. The editor fills the container and follows its size, so
 * give the container a height (WordCraft is a full application: 600px or more works well).
 */
export async function createWordcraft(container: HTMLElement, options: WordcraftOptions = {}): Promise<WordcraftEditor> {
  if (typeof window === 'undefined') {
    throw new Error('createWordcraft() needs a browser; call it from an effect or event handler, not during server rendering.');
  }
  const glue = await loadGlue(options.wasmUrl);

  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('data-wordcraft', '');
  canvas.tabIndex = 0;
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', outline: 'none' });
  container.appendChild(canvas);

  const initial = options.document;
  const initialBytes = initial ? await toBytes(initial.data) : null;
  const mountOptions = JSON.stringify({
    sample: !!options.sample,
    renderer: options.renderer ?? 'auto',
    guardUnload: !!options.guardUnload,
    persist: !!options.onSave,
    autoSave: options.autoSave ?? true,
    user: options.user ? { name: options.user.name } : undefined,
    prefs: { ...DEFAULT_PREFS, ...(options.prefs ?? {}), ...chromePrefs(options.titleBar, options.ribbon) },
  });

  let raw: RawHandle;
  try {
    raw = await glue.mount(canvas, mountOptions, initial?.name ?? null, initialBytes);
  } catch (e) {
    canvas.remove();
    throw e;
  }

  let destroyed = false;
  const alive = () => {
    if (destroyed) throw new Error('This WordCraft editor has been destroyed.');
  };

  const wrapSave = (cb: ((file: SavedFile) => void | Promise<void>) | null | undefined) =>
    cb
      ? (raw_file: Omit<SavedFile, 'blob'>) => {
          const copy = new Uint8Array(raw_file.bytes.byteLength);
          copy.set(raw_file.bytes);
          const file: SavedFile = { ...raw_file, bytes: copy, blob: new Blob([copy.buffer], { type: raw_file.mimeType }) };
          const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
          const persists = ['docx', 'docm', 'dotx', 'dotm', 'odt', 'rtf', 'json'].includes(ext);
          Promise.resolve(cb(file))
            .then(() => {
              if (persists && !destroyed) raw.markSaved();
            })
            .catch((e) => console.error('[wordcraft] onSave failed', e));
        }
      : null;

  raw.setOnChange(options.onChange ?? null);
  raw.setOnSave(wrapSave(options.onSave));
  let user: WordcraftUser = options.user ? { ...options.user } : { name: (JSON.parse(raw.getUser()) as { name: string }).name };

  const collab: CollabPort = {
    start(clientId, state) {
      alive();
      return raw.collabStart(clientId, state);
    },
    apply(update) {
      alive();
      raw.collabApply(update);
    },
    state() {
      alive();
      return raw.collabState();
    },
    stop() {
      if (!destroyed) raw.collabStop();
    },
    onUpdate(cb) {
      if (!destroyed) raw.setOnCollabUpdate(cb);
    },
    onCursor(cb) {
      if (!destroyed) raw.setOnCollabCursor(cb);
    },
    setPeers(peers) {
      if (!destroyed) raw.setPeers(JSON.stringify(peers));
    },
  };

  const editor: WordcraftEditor = {
    canvas,
    collab,
    async load(source) {
      alive();
      const name = source.name;
      const bytes = source instanceof Blob ? await toBytes(source) : await toBytes(source.data);
      raw.load(name, bytes);
    },
    newDocument() {
      alive();
      raw.newDocument();
    },
    export(format) {
      alive();
      return raw.export(exportName(format));
    },
    exportBlob(format) {
      const bytes = editor.export(format);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return new Blob([copy.buffer], { type: mimeTypeFor(exportName(format)) });
    },
    getHTML() {
      return new TextDecoder().decode(editor.export('html'));
    },
    getMarkdown() {
      return new TextDecoder().decode(editor.export('md'));
    },
    getText() {
      alive();
      return raw.getText();
    },
    getSelectedText() {
      alive();
      return raw.getSelectedText();
    },
    execute<T = unknown>(command: string, params?: Record<string, unknown>): T {
      alive();
      const out = raw.execute(command, params ? JSON.stringify(params) : null);
      return (out ? JSON.parse(out) : null) as T;
    },
    commands() {
      alive();
      return JSON.parse(raw.commands()) as CommandInfo[];
    },
    print() {
      editor.execute('ui.print');
    },
    getUser() {
      return { ...user };
    },
    setUser(next) {
      alive();
      raw.setUserName(next.name);
      user = { ...next, name: next.name.trim() };
    },
    isAutoSaving() {
      alive();
      return raw.isAutoSaving();
    },
    setAutoSave(on) {
      alive();
      return raw.setAutoSave(on);
    },
    undo() {
      editor.execute('edit.undo');
    },
    redo() {
      editor.execute('edit.redo');
    },
    canUndo() {
      alive();
      return raw.canUndo();
    },
    canRedo() {
      alive();
      return raw.canRedo();
    },
    title() {
      alive();
      return raw.title();
    },
    rev() {
      alive();
      return raw.rev();
    },
    isDirty() {
      alive();
      return raw.isDirty();
    },
    markSaved() {
      alive();
      raw.markSaved();
    },
    getPrefs() {
      alive();
      return JSON.parse(raw.getPrefs()) as WordcraftPrefs;
    },
    setPrefs(patch) {
      alive();
      raw.setPrefs(JSON.stringify(patch));
    },
    setOnChange(cb) {
      alive();
      raw.setOnChange(cb);
    },
    setOnSave(cb) {
      alive();
      raw.setOnSave(wrapSave(cb));
      raw.setPersist(!!cb);
    },
    get destroyed() {
      return destroyed || raw.hasPanicked();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      try {
        raw.destroy();
        raw.free?.();
      } finally {
        canvas.remove();
      }
    },
  };
  return editor;
}
