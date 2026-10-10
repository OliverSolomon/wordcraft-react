/**
 * Framework-agnostic WordCraft embedding.
 *
 * `createWordcraft(container)` mounts the real WordCraft editor (ribbon, dialogs, pages and
 * engine, compiled from upstream Rust to WebAssembly) inside any element and returns a handle to
 * drive it. Nothing here touches `window` at import time, so the module is safe to import during
 * server-side rendering; only `createWordcraft` needs a browser.
 */

/** Formats WordCraft can open. */
export type OpenFormat = 'docx' | 'docm' | 'dotx' | 'dotm' | 'odt' | 'rtf' | 'md' | 'html' | 'htm' | 'txt' | 'tex' | 'json';
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
  /** Collapse the ribbon to its tab row. */
  ribbonCollapsed: boolean;
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

/** A file produced by Save, Save As or Export in WordCraft's own UI. */
export interface SavedFile {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
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
  setOnSave(cb: ((file: SavedFile) => void) | null): void;
  hasPanicked(): boolean;
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
    prefs: { ...DEFAULT_PREFS, ...(options.prefs ?? {}) },
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
      ? (file: SavedFile) => {
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

  const editor: WordcraftEditor = {
    canvas,
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
