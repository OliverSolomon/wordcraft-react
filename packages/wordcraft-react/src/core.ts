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
  /** Hide the status bar (page, word count, zoom). The mobile layout hides it. */
  hideStatusBar: boolean;
  /** Show the mini toolbar over a selection (on by default). The mobile layout uses its own. */
  miniToolbar: boolean;
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
  /** Their picture, for presence avatars. */
  avatarUrl?: string;
}

/** Someone in the document right now (co-editing presence). */
export interface PresenceUser {
  /** The awareness client id. */
  clientId: number;
  id: string | null;
  name: string;
  color: string;
  avatarUrl: string | null;
  /** What they are doing: editing (or suggesting) or only viewing. */
  state: 'editing' | 'viewing';
  /** No activity for a minute. */
  idle: boolean;
  /** This browser's own entry. */
  self: boolean;
  /** Joined without a name ("Anonymous Otter"). */
  anonymous: boolean;
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
  /** Listen for who is in the document (avatars in your header). Returns a function that stops. */
  onPresence?(cb: (users: PresenceUser[]) => void): () => void;
}

/** Word's Ribbon Display Options. */
export type RibbonDisplay = 'full' | 'tabs' | 'hidden';

/** The ribbon's tabs (contextual tabs like Table Design come and go by themselves). */
export type RibbonTab = 'File' | 'Home' | 'Insert' | 'Draw' | 'Design' | 'Layout' | 'References' | 'Mailings' | 'Review' | 'View' | 'Zotero' | 'Help';
export const RIBBON_TABS: RibbonTab[] = ['File', 'Home', 'Insert', 'Draw', 'Design', 'Layout', 'References', 'Mailings', 'Review', 'View', 'Zotero', 'Help'];

/** Word's mode switch: edit directly, edit as tracked suggestions, or only read. */
export type EditorMode = 'editing' | 'reviewing' | 'viewing';

/** The tabs to hide, given the tabs to show and/or the tabs to hide. */
export function hiddenTabsFor(show: RibbonTab[] | undefined, hide: RibbonTab[] | undefined): RibbonTab[] {
  const out = new Set<RibbonTab>(hide ?? []);
  if (show) for (const t of RIBBON_TABS) if (!show.includes(t)) out.add(t);
  return [...out];
}

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

/** A rectangle in CSS pixels, measured from the editor's top-left corner. */
export interface EditorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the selection is and what it holds, for touch layouts (see `onSelection`). */
export interface SelectionInfo {
  /** A caret, not a selection. */
  collapsed: boolean;
  /** The visible part of the selection (or the caret), or `null` when it is off screen. */
  rect: EditorRect | null;
  visible: boolean;
  /** The page area (the editor minus its title bar, ribbon and status bar). */
  page: EditorRect | null;
  /** Contextual tabs for the selection: `Table Design`, `Table Layout`, `Picture Format`, `Shape Format`, `SmartArt Design`, `Chart Design`, `Equation`, `Outlining`. */
  contextual: string[];
  /** Ids of the marks (`setMarks`) the caret is in. */
  marks: string[];
  /** The collaborator being followed (`followPeer`), or null. */
  following: string | null;
  /** The selection was made by touch (its handles show). */
  touch: boolean;
  /** A touch selection gesture just finished: a phone shows its floating toolbar now. */
  selected: boolean;
  /** The page is moving under a finger or a fling. */
  scrolling: boolean;
  /** Total distance the page has scrolled by touch, in CSS pixels (positive = towards the top). */
  scrolled: number;
}

/** The editor reports the selection in egui points, with the editor's size in points beside it. */
type RawSelectionInfo = SelectionInfo & { screen?: EditorRect | null };

/** A body paragraph (tables included), as the panels read the document. */
export interface DocParagraph {
  /** Where it is: `[block]` at the top level, `[table, row, cell, block]` inside a table. */
  path: number[];
  /** Its plain text. Offsets (`selectText`, marks, comment anchors) count UTF-16 units in it. */
  text: string;
  style: string;
  styleName: string;
  /** Outline level 1 to 9 for Title and Heading 1 to 9, else 0. */
  heading: number;
}

/** A comment or a reply in the document. */
export interface DocComment {
  id: number;
  /** The comment this replies to, or null for a thread's first comment. */
  parent: number | null;
  author: string;
  initials: string;
  /** ISO 8601. */
  date: string;
  resolved: boolean;
  text: string;
  /** The commented text (first 200 characters). */
  quote: string;
  /** Where the commented text is (first comments only). */
  anchor: { path: number[]; start: number; end: number } | null;
}

/** A place in the body text: the paragraph's path and a UTF-16 offset in its text. */
export interface TextPoint {
  path: number[];
  offset: number;
}

/** The selection's two ends (`anchor` where it started, `focus` where the caret is). */
export interface CaretInfo {
  anchor: TextPoint | null;
  focus: TextPoint | null;
}

/** A mark over the text: a squiggle (writing checks) or a highlight (originality). */
export interface TextMark {
  id: string;
  path: number[];
  start: number;
  end: number;
  /** `#rrggbb`. */
  color?: string;
  style?: 'squiggle' | 'highlight';
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
  /** The ribbon tabs to offer, e.g. `['File', 'Home', 'Insert', 'Review']`. Default: all. */
  tabs?: RibbonTab[];
  /** Ribbon tabs to leave out, e.g. `['Mailings', 'Zotero']`. */
  hiddenTabs?: RibbonTab[];
  /** Start in `editing` (default), `reviewing` (Track Changes) or `viewing` (read only). */
  mode?: EditorMode;
  /**
   * Commands to turn off: ids from `editor.commands()`, or prefixes ending in `*`
   * (`'mailings.*'`, `'file.open'`). They're greyed in the ribbon and refused everywhere.
   */
  disabledCommands?: string[];
  /**
   * Fonts offered on demand in the font box (fetched the first time someone picks one).
   * Default: `googleFonts()`, the Google Fonts library. `false` offers only the built-in fonts.
   */
  fonts?: FontSource | FontSource[] | false;
  /** Show the AI (sparkle) button in the ribbon, beside Comments. Default: off. */
  aiButton?: boolean;
  /** Called when someone clicks the AI button. */
  onAiButton?: () => void;
  /**
   * Offer Version History: clicking the title or File › Info › View Version History calls
   * `onVersionHistory`. (`<WordcraftEditor versionHistory />` wires this to its panel.)
   */
  versionHistory?: boolean;
  onVersionHistory?: () => void;
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
  /** Word's mode switch: `editing`, `reviewing` or `viewing`. */
  getMode(): EditorMode;
  setMode(mode: EditorMode): void;
  /** Change which ribbon tabs show. */
  setTabs(show?: RibbonTab[], hide?: RibbonTab[]): void;
  /** Change which commands are turned off (ids or prefixes ending in `*`). */
  setDisabledCommands(commands: string[]): void;
  /** Make a font (TTF/OTF bytes) available to documents. */
  addFont(bytes: Uint8Array): void;
  /** Whether a font family is available to documents now. */
  hasFont(family: string): boolean;
  /** Show or hide the AI (sparkle) button in the ribbon. */
  setAiButton(on: boolean): void;
  /** Replace the AI button listener (or remove it with `null`). */
  setOnAiButton(cb: (() => void) | null): void;
  /** Turn Version History's entry points (title click, File › Info) on or off. */
  setVersionHistory(on: boolean): void;
  /** Replace the Version History listener. */
  setOnVersionHistory(cb: (() => void) | null): void;
  /**
   * Replace the document's content with another version of it, keeping its name and file, as
   * one undoable step (Version History's Restore). Default format: WordCraft JSON.
   */
  restoreContent(bytes: Uint8Array, format?: ExportFormat | string): void;
  /** Whether AutoSave is on. */
  isAutoSaving(): boolean;
  /** Turn AutoSave on or off (needs `onSave`); returns whether it is now on. */
  setAutoSave(on: boolean): boolean;
  /**
   * Touch gestures on the page (on by default): a finger drags the page, a tap places the caret,
   * a long press selects a word, handles change the selection and two fingers zoom.
   */
  setTouch(on: boolean): void;
  /** Where the selection is now (for a floating toolbar). */
  selectionInfo(): SelectionInfo | null;
  /** Listen for selection changes (also as it moves on screen). Returns a function that stops listening. */
  onSelection(cb: (info: SelectionInfo) => void): () => void;
  /** Every body paragraph, tables included, with its path and plain text. */
  paragraphs(): DocParagraph[];
  /** Every comment and reply, with its author, state, text and anchor. */
  comments(): DocComment[];
  /** Select `start..end` (UTF-16 offsets) of the paragraph at `path`, and scroll to it. */
  selectText(path: number[], start: number, end: number): void;
  /** Lay marks over the text (squiggles or highlights); an empty list clears them. */
  setMarks(marks: TextMark[]): void;
  /** Where the selection is, as `paragraphs()` counts it; `null` ends are outside the body (a header, a footnote). */
  caret(): CaretInfo | null;
  /** The selected picture, chart or shape (`kind`, its alt text and title), or `null`. Read only. */
  selectedObject(): { kind: 'picture' | 'chart' | 'shape'; alt: string; title: string } | null;
  /** Keep a collaborator's caret in view until the person scrolls, clicks or types (`null` stops). */
  followPeer(name: string | null): void;
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
  setMode(mode: string): void;
  getMode(): string;
  setDisabledCommands(json: string): void;
  setCloudFonts(json: string): void;
  setOnFontRequest(cb: ((family: string, preview?: boolean) => void) | null): void;
  setVersionHistory?(on: boolean): void;
  addFont(bytes: Uint8Array): number;
  hasFont(family: string): boolean;
  documentFonts(): string;
  setAiButton?(on: boolean): void;
  restoreContent?(name: string, bytes: Uint8Array): void;
  setOnHostEvent?(cb: ((event: string) => void) | null): void;
  setTouch?(on: boolean): void;
  setOnSelection?(cb: ((info: RawSelectionInfo) => void) | null): void;
  selectionInfo?(): string;
  paragraphs?(): string;
  comments?(): string;
  selectText?(path: string, start: number, end: number): void;
  setMarks?(json: string): void;
  caret?(): string;
  selectedObject?(): string;
  followPeer?(name: string | null): void;
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

import { googleFonts, readRecentFonts, writeRecentFonts } from './fonts.js';
import type { FontSource } from './fonts.js';
export { googleFonts } from './fonts.js';
export { describeAiRequest } from './ai-core.js';
export type { AiAction, AiRequest } from './ai-core.js';
export { AI_PROVIDERS, AI_SYSTEM_PROMPT, aiSystemPrompt, aiUserMessage, completeWith } from './ai-providers.js';
export { browserVersionStore, httpVersionStore, memoryVersionStore, newVersionId, pruneVersions } from './versions.js';
export type { VersionHistoryOptions, VersionMeta, VersionStore } from './versions.js';
export { BUILT_IN_PALETTES, BUILT_IN_SKILLS, HUMANISER, applyLetterhead, applyPalette, parseSkillMarkdown, studioInstructions } from './ai-studio.js';
export type { AiSkill, AiStudioState, Letterhead, Palette } from './ai-studio.js';
export type { AiProviderConfig, AiProviderId } from './ai-providers.js';
export type { FontSource, GoogleFontsOptions } from './fonts.js';

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
  // touch-action: the editor handles every finger on the page itself (scrolling, selecting,
  // zooming), so the browser must not pan or zoom the host page under it.
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', outline: 'none', touchAction: 'none' });
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
    prefs: {
      ...DEFAULT_PREFS,
      recentFonts: readRecentFonts(),
      ...(options.prefs ?? {}),
      ...chromePrefs(options.titleBar, options.ribbon),
      ...(options.tabs || options.hiddenTabs ? { hiddenTabs: hiddenTabsFor(options.tabs, options.hiddenTabs) } : {}),
    },
  });

  let raw: RawHandle;
  try {
    raw = await glue.mount(canvas, mountOptions, initial?.name ?? null, initialBytes);
  } catch (e) {
    canvas.remove();
    throw e;
  }

  // A finger reaches the editor as touch events, which its touch layer turns into gestures. The
  // browser also sends pointer events for it, which egui would take for a second, mouse click (a
  // double-click that selects a word); those stop here, before the canvas. Mouse and pen pass.
  const touchPointer = (e: PointerEvent) => {
    if (e.pointerType === 'touch' && e.target === canvas) e.stopPropagation();
  };
  container.addEventListener('pointerdown', touchPointer, { capture: true });
  container.addEventListener('pointerup', touchPointer, { capture: true });

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

  if (options.mode && options.mode !== 'editing') raw.setMode(options.mode);
  if (options.disabledCommands?.length) raw.setDisabledCommands(JSON.stringify(options.disabledCommands));

  // Fonts on demand: list them in the font box, fetch one when it's first picked, and remember the
  // recently used fonts in this browser.
  const sources = options.fonts === false ? [] : Array.isArray(options.fonts) ? options.fonts : [options.fonts ?? googleFonts()];
  const owner = new Map<string, FontSource>();
  // Per family: the regular face alone (a font-box preview) or every face.
  const loading = new Map<string, Promise<void>>();
  const previews = new Map<string, Promise<void>>();
  const add = (files: Uint8Array[]) => {
    if (destroyed) return;
    for (const f of files) raw.addFont(f);
  };
  const fetchFont = (family: string): Promise<void> => {
    const src = owner.get(family);
    if (!src) return Promise.resolve();
    let p = loading.get(family);
    if (!p) {
      const preview = previews.get(family);
      // With the preview's regular face already in, fetch only the other faces.
      p = (preview ? preview.then(() => src.load(family, { faces: raw.hasFont(family) ? 'others' : 'all' })) : src.load(family))
        .then(add)
        .catch((e) => {
          loading.delete(family);
          console.warn(`[wordcraft] font ${family}:`, e);
        });
      loading.set(family, p);
    }
    return p;
  };
  // Font-box previews: a few at a time, so scrolling the list never floods the network.
  const previewQueue: string[] = [];
  let previewsRunning = 0;
  const pumpPreviews = () => {
    while (previewsRunning < 4 && previewQueue.length && !destroyed) {
      const family = previewQueue.shift()!;
      const src = owner.get(family);
      if (!src || loading.has(family) || previews.has(family)) continue;
      previewsRunning++;
      const p = src
        .load(family, { faces: 'regular' })
        .then(add)
        .catch(() => undefined)
        .finally(() => {
          previewsRunning--;
          pumpPreviews();
        });
      previews.set(family, p);
    }
  };
  const previewFont = (family: string) => {
    if (owner.has(family) && !loading.has(family) && !previews.has(family) && !previewQueue.includes(family)) {
      // Newest first: the rows on screen now matter more than ones scrolled past.
      previewQueue.unshift(family);
      if (previewQueue.length > 40) previewQueue.length = 40;
      pumpPreviews();
    }
  };
  if (sources.length) {
    raw.setOnFontRequest((family, preview) => void (preview ? previewFont(family) : fetchFont(family)));
    Promise.all(sources.map(async (src) => ({ src, names: await src.families() })))
      .then((lists) => {
        if (destroyed) return;
        for (const { src, names } of lists) for (const n of names) if (!owner.has(n)) owner.set(n, src);
        raw.setCloudFonts(JSON.stringify([...owner.keys()]));
        // Fonts picked lately are probably in use: load them now, and the ones the document uses.
        for (const f of readRecentFonts()) void fetchFont(f);
        fetchDocumentFonts();
      })
      .catch((e) => console.warn('[wordcraft] font list unavailable', e));
  }
  // Web fonts the document uses load by themselves, as Word downloads cloud fonts (checked a
  // moment after edits settle, so typing never waits on it).
  let fontTimer: ReturnType<typeof setTimeout> | undefined;
  function fetchDocumentFonts() {
    if (!owner.size || destroyed) return;
    try {
      for (const f of JSON.parse(raw.documentFonts()) as string[]) if (owner.has(f)) void fetchFont(f);
    } catch {
      // ignore
    }
  }
  let lastRecent = JSON.stringify(readRecentFonts());
  const userOnChange = options.onChange;
  options.onChange = (info) => {
    try {
      const recent = (JSON.parse(raw.getPrefs()) as { recentFonts?: string[] }).recentFonts ?? [];
      const key = JSON.stringify(recent);
      if (key !== lastRecent) {
        lastRecent = key;
        writeRecentFonts(recent);
      }
    } catch {
      // ignore
    }
    clearTimeout(fontTimer);
    fontTimer = setTimeout(fetchDocumentFonts, 1500);
    userOnChange?.(info);
  };

  // Events from WordCraft's UI meant for the page.
  let onAi: (() => void) | null = options.onAiButton ?? null;
  let onVersions: (() => void) | null = options.onVersionHistory ?? null;
  raw.setOnHostEvent?.((event) => {
    if (event === 'ai') onAi?.();
    if (event === 'versions') onVersions?.();
  });
  if (options.aiButton) raw.setAiButton?.(true);
  if (options.versionHistory) raw.setVersionHistory?.(true);

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

  // Selection listeners share the one callback the editor offers. Points become CSS pixels by the
  // canvas's own measure, which holds at any device pixel ratio and interface size.
  const toCss = (info: RawSelectionInfo): SelectionInfo => {
    const { screen, ...rest } = info;
    const k = screen && screen.width > 0 && canvas.clientWidth > 0 ? canvas.clientWidth / screen.width : 1;
    const r = (x: EditorRect | null): EditorRect | null => (x ? { x: x.x * k, y: x.y * k, width: x.width * k, height: x.height * k } : null);
    return { ...rest, rect: r(rest.rect), page: r(rest.page), scrolled: rest.scrolled * k };
  };
  const selectionListeners = new Set<(info: SelectionInfo) => void>();
  const syncSelection = () => {
    raw.setOnSelection?.(selectionListeners.size ? (info) => selectionListeners.forEach((cb) => cb(toCss(info))) : null);
  };

  const editor: WordcraftEditor = {
    canvas,
    collab,
    setTouch(on) {
      alive();
      raw.setTouch?.(on);
    },
    paragraphs() {
      alive();
      return raw.paragraphs ? (JSON.parse(raw.paragraphs()) as DocParagraph[]) : [];
    },
    comments() {
      alive();
      return raw.comments ? (JSON.parse(raw.comments()) as DocComment[]) : [];
    },
    selectText(path, start, end) {
      alive();
      raw.selectText?.(JSON.stringify(path), Math.max(0, start), Math.max(0, end));
    },
    setMarks(marks) {
      alive();
      raw.setMarks?.(JSON.stringify(marks));
    },
    caret() {
      alive();
      return raw.caret ? (JSON.parse(raw.caret()) as CaretInfo) : null;
    },
    selectedObject() {
      alive();
      return raw.selectedObject ? (JSON.parse(raw.selectedObject()) as ReturnType<WordcraftEditor['selectedObject']>) : null;
    },
    followPeer(name) {
      alive();
      raw.followPeer?.(name);
    },
    selectionInfo() {
      alive();
      const out = raw.selectionInfo?.();
      return out ? toCss(JSON.parse(out) as RawSelectionInfo) : null;
    },
    onSelection(cb) {
      alive();
      selectionListeners.add(cb);
      syncSelection();
      return () => {
        selectionListeners.delete(cb);
        if (!destroyed) syncSelection();
      };
    },
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
    getMode() {
      alive();
      return raw.getMode() as EditorMode;
    },
    setMode(mode) {
      alive();
      raw.setMode(mode);
    },
    setTabs(show, hide) {
      alive();
      raw.setPrefs(JSON.stringify({ hiddenTabs: hiddenTabsFor(show, hide) }));
    },
    setAiButton(on) {
      alive();
      raw.setAiButton?.(on);
    },
    setOnAiButton(cb) {
      onAi = cb;
    },
    setVersionHistory(on) {
      alive();
      raw.setVersionHistory?.(on);
    },
    setOnVersionHistory(cb) {
      onVersions = cb;
    },
    restoreContent(bytes, format = 'json') {
      alive();
      if (!raw.restoreContent) throw new Error('This build of WordCraft cannot restore versions.');
      raw.restoreContent(exportName(format), bytes);
    },
    setDisabledCommands(commands) {
      alive();
      raw.setDisabledCommands(JSON.stringify(commands));
    },
    addFont(bytes) {
      alive();
      raw.addFont(bytes);
    },
    hasFont(family) {
      alive();
      return raw.hasFont(family);
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
      // Keep remembering recent fonts behind the new listener.
      const remember = options.onChange;
      options.onChange = cb
        ? (info) => {
            remember?.(info);
            cb(info);
          }
        : remember;
      raw.setOnChange(options.onChange ?? null);
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
      container.removeEventListener('pointerdown', touchPointer, { capture: true });
      container.removeEventListener('pointerup', touchPointer, { capture: true });
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
