'use client';

/**
 * `<WordcraftEditor />`: the WordCraft word processor as a React component.
 *
 * Works in React 18/19, Next.js (App Router and Pages Router), Remix and Vite. The component
 * renders a sized container on the server and mounts WordCraft in an effect on the client, so it
 * needs no `dynamic(..., { ssr: false })` wrapper.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { chromePrefs, createWordcraft, hiddenTabsFor } from './core.js';
import { AiBar } from './ai.js';
import { VersionHistory } from './history.js';
import type { VersionHistoryHandle } from './history.js';
import type { VersionHistoryOptions } from './versions.js';
import type { AiOptions } from './ai.js';
import { MobileShell } from './mobile.js';
import type { MobileOptions } from './mobile.js';
import { CommentsButton, CommentsPanel, openThreads, useCommentSync } from './comments.js';
import type { CommentsOptions, Person } from './comments.js';
import { AccessChip, Notice, PresenceAvatars, WorkspaceRow, applyPermission, canComment, canWrite, lowerPermission } from './workspace.js';
import type { Permission } from './workspace.js';
import type { ChangeInfo, Collaboration, DocumentSource, EditorMode, FontSource, PresenceUser, RibbonDisplay, RibbonTab, SavedFile, WordcraftEditor as Editor, WordcraftOptions, WordcraftPrefs, WordcraftUser } from './core.js';

export * from './core.js';
export { AiBar, AiStar, ExtraTag, aiReady, insertText, AI_PROVIDERS, completeWith } from './ai.js';
export * from './ai-studio.js';
export { VersionHistory } from './history.js';
export type { VersionHistoryHandle, VersionHistoryProps } from './history.js';
export type { AiBarProps, AiOptions, AiProviderConfig, AiProviderId } from './ai.js';
export { MOBILE_PALETTE, MobileShell } from './mobile.js';
export { CommentsPanel, CommentsButton, useCommentSync, personColor } from './comments.js';
export type { CommentEvent, CommentEventType, CommentStore, CommentsOptions, CommentsPanelProps, Person, StoredComment } from './comments.js';
export { AccessChip, PERMISSION_LABEL, PresenceAvatars, applyPermission, canComment, canWrite } from './workspace.js';
export type { Permission } from './workspace.js';
export type { FormatState, MobileOptions, MobileShellProps, MobileTabId, PaletteItem, PaletteState, PaletteTab, ViewState } from './mobile.js';

export interface WordcraftEditorProps {
  /** Document to open when the editor mounts. Changing it later loads the new document. */
  document?: DocumentSource | null;
  /** Start with the built-in sample document (ignored when `document` is set). */
  sample?: boolean;
  /** `auto` (WebGPU, falling back to WebGL2) or `webgl`. Read once, on mount. */
  renderer?: WordcraftOptions['renderer'];
  /** UI preferences; changes are applied live. */
  prefs?: Partial<WordcraftPrefs>;
  /** Shorthand for `prefs.dark`. */
  dark?: boolean;
  /**
   * The person editing: `{ name, color? }`. The name shows on the avatar and signs comments and
   * tracked changes. Changes apply live; read it back with `ref.current.getUser()`.
   */
  user?: WordcraftUser;
  /** @deprecated Use `user={{ name }}`. */
  author?: string;
  /**
   * Start with AutoSave on (default true). AutoSave writes through `onSave` with
   * `reason: 'autosave'` a couple of seconds after edits, and the title bar toggle switches it.
   * Needs `onSave`. Changing the prop switches AutoSave.
   */
  autoSave?: boolean;
  /** Show the title bar (AutoSave, Quick Access Toolbar, title, search, avatar). Default true. */
  titleBar?: boolean;
  /** Ribbon Display Options, as in Word: `full` (default), `tabs` (tabs only) or `hidden`. */
  ribbon?: RibbonDisplay;
  /**
   * Real-time co-editing, e.g. `yjsCollaboration({ doc, provider })` from
   * `@gamine/wordcraft-react/collab`. Keep it stable (create it once, or in `useMemo`): a new
   * object reconnects.
   */
  collaboration?: Collaboration | null;
  /** The ribbon tabs to offer, e.g. `['File', 'Home', 'Insert', 'Review']`. Changes apply live. */
  tabs?: RibbonTab[];
  /** Ribbon tabs to leave out, e.g. `['Mailings', 'Zotero']`. Changes apply live. */
  hiddenTabs?: RibbonTab[];
  /** Word's mode switch: `editing` (default), `reviewing` (Track Changes) or `viewing` (read only). */
  mode?: EditorMode;
  /**
   * What this person may do, enforced by the editor (typing, paste, drag and drop, AI results,
   * find and replace all obey it): `view` (read, select, copy), `comment` (view plus comments),
   * `suggest` (every edit is a tracked suggestion), `edit` (default). Change it at runtime and it
   * applies at once; lowering it tells the person.
   */
  permission?: Permission;
  /** Viewers see the comments (read only). Default true. */
  commentsVisibleToViewers?: boolean;
  /** Viewers and commenters may copy, print and download. Default true. */
  allowCopy?: boolean;
  /**
   * Comments in the Google Docs style: a panel of threads with filters, replies, `@mentions`,
   * Assign to, Resolve and Reopen, and a store adapter for every change. `true` turns on the panel
   * alone. The comments themselves live in the document (and in the .docx).
   */
  comments?: CommentsOptions | boolean;
  /** Open or close the comments panel (controlled). */
  commentsOpen?: boolean;
  onCommentsOpenChange?: (open: boolean) => void;
  /** Show who else is here (avatars with follow) at the bottom right while co-editing. Default true. */
  presence?: boolean;
  /** Commands to turn off (ids, or prefixes ending in `*`). Changes apply live. */
  disabledCommands?: string[];
  /** Fonts offered on demand; default the Google Fonts library, `false` for built-in fonts only. Read once. */
  fonts?: FontSource | FontSource[] | false;
  /**
   * AI writing (an Extra: not part of Microsoft Word or WordCraft), like Gemini in Google Docs: a
   * sparkle at the bottom centre opens a prompt bar, with AI Studio for skills (Humaniser on by
   * default), letterheads, palettes and the model. Answers come from `complete` (your function,
   * e.g. your API route), a `provider` with a key, or the person's own OpenRouter, OpenAI,
   * Anthropic or Gemini key. `true` means only people's own keys.
   */
  ai?: AiOptions | boolean | null;
  /**
   * Version history like Google Docs (an Extra): versions are recorded as people work, and a panel
   * lists them to view, restore, name or download. Opens from the title, File › Info and
   * Ctrl+Alt+Shift+H. `true` keeps versions in this browser; pass `{ store }` to keep them on
   * your server (`httpVersionStore`, or your own `VersionStore`). Read once, on mount.
   */
  versionHistory?: boolean | VersionHistoryOptions;
  /** Open or close the version history panel (controlled). */
  versionsOpen?: boolean;
  onVersionsOpenChange?: (open: boolean) => void;
  /** Open or close the AI bar (controlled). Leave unset to let the star button toggle it. */
  aiOpen?: boolean;
  onAiOpenChange?: (open: boolean) => void;
  /**
   * The phone layout, shaped like Word on Android: a title bar, the page, and a command palette at
   * the bottom, with touch gestures on the page. `'auto'` (default) uses it on touch screens
   * narrower than 600px and switches live (a foldable opening, a phone turning); `true` always;
   * `false` never.
   */
  mobile?: boolean | 'auto';
  /** Options for the phone layout: Mobile View, the back arrow, sharing, camera, dictation. */
  mobileOptions?: MobileOptions;
  /** Ask before the tab closes with unsaved changes. Read once, on mount. */
  guardUnload?: boolean;
  /** Where to load the `.wasm` from (CDN or `public/`). Read once, on mount. */
  wasmUrl?: string | URL;
  /** Editor height. Defaults to 720px; WordCraft is a full application and needs room. */
  height?: number | string;
  className?: string;
  style?: CSSProperties;
  /** Shown while the editor downloads and starts. */
  loading?: ReactNode;
  /** Shown if the editor can't start (no WebGPU or WebGL2, or the .wasm failed to load). */
  fallback?: ReactNode | ((error: Error) => ReactNode);
  onReady?: (editor: Editor) => void;
  onChange?: (info: ChangeInfo, editor: Editor) => void;
  /**
   * Save / Save As / Export / AutoSave in WordCraft's UI (`file.reason` says which). Without it the
   * browser downloads the file and AutoSave stays off.
   */
  onSave?: (file: SavedFile, editor: Editor) => void | Promise<void>;
  onError?: (error: Error) => void;
}

/** The ref handle: the editor once mounted, otherwise `null`. */
export type WordcraftEditorRef = Editor | null;

const defaultLoading = (
  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', font: '14px system-ui, sans-serif', color: '#555', background: '#e6e6e6' }}>
    Loading WordCraft…
  </div>
);

export const WordcraftEditor = forwardRef<Editor, WordcraftEditorProps>(function WordcraftEditor(props, ref) {
  const { height = 720, className, style, loading = defaultLoading, fallback } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [aiOpenState, setAiOpenState] = useState(false);
  const aiOpen = props.aiOpen ?? aiOpenState;
  const setAiOpen = (v: boolean) => {
    setAiOpenState(v);
    latest.current.onAiOpenChange?.(v);
  };
  const ai: AiOptions | null = props.ai === true ? {} : props.ai ? props.ai : null;
  const [versionsOpenState, setVersionsOpenState] = useState(false);
  const versionsOpen = props.versionsOpen ?? versionsOpenState;
  const setVersionsOpen = useCallback((v: boolean) => {
    setVersionsOpenState(v);
    latest.current.onVersionsOpenChange?.(v);
  }, []);
  const history = useRef<VersionHistoryHandle>(null);
  const versionOptions = useMemo<VersionHistoryOptions | null>(
    () => (props.versionHistory === true ? {} : props.versionHistory ? props.versionHistory : null),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Latest props for callbacks, so changing a handler never remounts the editor.
  const latest = useRef(props);
  latest.current = props;

  // The phone layout: on narrow touch screens (or when asked), measured on the container.
  const [isMobile, setIsMobile] = useState(false);
  const mobileSeen = useRef(false);
  const mobileProp = props.mobile ?? 'auto';
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (mobileProp !== 'auto') {
      setIsMobile(mobileProp);
      return;
    }
    const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
    const check = () => setIsMobile(el.getBoundingClientRect().width < MOBILE_BREAKPOINT && !!coarse?.matches);
    check();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(check) : null;
    ro?.observe(el);
    coarse?.addEventListener?.('change', check);
    return () => {
      ro?.disconnect();
      coarse?.removeEventListener?.('change', check);
    };
  }, [mobileProp]);
  if (isMobile) mobileSeen.current = true;
  const mobileRef = useRef(isMobile);
  mobileRef.current = isMobile;

  useImperativeHandle(ref, () => editor as Editor, [editor]);

  // Mount once per container. StrictMode mounts, unmounts and mounts again; the `cancelled` flag
  // destroys the first instance as soon as it finishes starting.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;
    let instance: Editor | null = null;
    const p = latest.current;
    createWordcraft(el, {
      document: p.document ?? undefined,
      sample: !p.document && p.sample,
      renderer: p.renderer,
      wasmUrl: p.wasmUrl,
      guardUnload: p.guardUnload,
      user: userOf(p),
      autoSave: p.autoSave,
      mode: p.mode,
      disabledCommands: p.disabledCommands,
      fonts: p.fonts,
      prefs: mergedPrefs(p, isMobileAtMount(el, p.mobile), false),
      aiButton: !!(p.ai && p.ai !== true && p.ai.ribbonButton),
      versionHistory: !!p.versionHistory,
      onChange: (info) => instance && latest.current.onChange?.(info, instance),
      onSave: p.onSave
        ? (file) => {
            if (file.reason === 'save') void history.current?.record('save');
            return instance ? latest.current.onSave?.(file, instance) : undefined;
          }
        : undefined,
    })
      .then((ed) => {
        if (cancelled) {
          ed.destroy();
          return;
        }
        instance = ed;
        setEditor(ed);
        latest.current.onReady?.(ed);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        latest.current.onError?.(err);
      });
    return () => {
      cancelled = true;
      instance?.destroy();
      instance = null;
      setEditor(null);
    };
  }, []);

  // Keep the save handler in sync with whether an onSave prop is present.
  const hasOnSave = !!props.onSave;
  useEffect(() => {
    if (!editor || editor.destroyed) return;
    editor.setOnSave(
      hasOnSave
        ? (file) => {
            if (file.reason === 'save') void history.current?.record('save');
            return latest.current.onSave?.(file, editor);
          }
        : null,
    );
  }, [editor, hasOnSave]);

  // The person editing.
  const user = userOf(props);
  const userKey = user ? JSON.stringify(user) : '';
  useEffect(() => {
    if (!editor || editor.destroyed || !userKey) return;
    editor.setUser(JSON.parse(userKey) as WordcraftUser);
  }, [editor, userKey]);

  // The ribbon's sparkle (when asked for) opens and closes the AI bar.
  const hasAi = !!ai?.ribbonButton;
  const aiOpenRef = useRef(aiOpen);
  aiOpenRef.current = aiOpen;
  useEffect(() => {
    if (!editor || editor.destroyed) return;
    editor.setAiButton(hasAi);
    editor.setOnAiButton(hasAi ? () => setAiOpen(!aiOpenRef.current) : null);
  }, [editor, hasAi]); // eslint-disable-line react-hooks/exhaustive-deps

  // Version history: the title and File › Info open the panel.
  useEffect(() => {
    if (!editor || editor.destroyed || !versionOptions) return;
    editor.setOnVersionHistory(() => setVersionsOpen(true));
    return () => editor.setOnVersionHistory(null);
  }, [editor, versionOptions, setVersionsOpen]);

  // Co-editing.
  const collaboration = props.collaboration ?? null;
  useEffect(() => {
    if (!editor || editor.destroyed || !collaboration) return;
    return collaboration.attach(editor);
  }, [editor, collaboration]);

  // Mode, access level and turned-off commands follow their props. The access level wins over
  // the mode: a viewer stays in Viewing, a suggester in Reviewing.
  const permission: Permission = props.permission ?? 'edit';
  const disabledKey = JSON.stringify(props.disabledCommands ?? []);
  const [notice, setNotice] = useState('');
  const lastPermission = useRef<Permission | null>(null);
  useEffect(() => {
    if (!editor || editor.destroyed) return;
    const host = JSON.parse(disabledKey) as string[];
    if (props.permission) {
      applyPermission(editor, permission, host, { allowCopy: props.allowCopy, mode: props.mode });
    } else {
      editor.setDisabledCommands(host);
      if (props.mode && editor.getMode() !== props.mode) editor.setMode(props.mode);
    }
    const before = lastPermission.current;
    lastPermission.current = permission;
    if (before && lowerPermission(permission, before)) {
      setNotice(permission === 'view' ? 'Your access changed: you can now only view this document.' : permission === 'comment' ? 'Your access changed: you can now comment, but not edit.' : 'Your access changed: your edits are now suggestions.');
    }
  }, [editor, permission, props.permission, props.mode, props.allowCopy, disabledKey]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  // Comments: the panel and the host's store.
  const commentOptions: CommentsOptions | null = props.comments === true ? {} : props.comments ? props.comments : null;
  const people: Person[] = Array.isArray(commentOptions?.people) ? commentOptions.people : [];
  const [assignees, setAssignees] = useState(() => new Map<number, Person | null>());
  const comments = useCommentSync(commentOptions ? editor : null, commentOptions, people, assignees);
  const [commentsOpenState, setCommentsOpenState] = useState(false);
  const commentsOpen = !!commentOptions && (props.commentsOpen ?? commentsOpenState) && (permission !== 'view' || props.commentsVisibleToViewers !== false);
  const setCommentsOpen = (v: boolean) => {
    setCommentsOpenState(v);
    latest.current.onCommentsOpenChange?.(v);
  };
  // The page makes room for the comments panel (on a phone it is a sheet over the page).
  useEffect(() => {
    if (!editor || editor.destroyed || isMobile) return;
    editor.canvas.style.right = commentsOpen ? 'min(340px, 100%)' : '0';
  }, [editor, commentsOpen, isMobile]);

  // Presence: who else is here, and following one of them.
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [following, setFollowing] = useState<string | null>(null);
  useEffect(() => {
    if (!collaboration?.onPresence) return;
    return collaboration.onPresence(setPresence);
  }, [collaboration]);
  useEffect(() => {
    if (!editor || editor.destroyed || !collaboration) return;
    return editor.onSelection((info) => setFollowing(info.following ?? null));
  }, [editor, collaboration]);
  const follow = (name: string | null) => {
    if (!editor || editor.destroyed) return;
    editor.followPeer(name);
    setFollowing(name);
  };

  // AutoSave follows the prop when it changes (the title bar toggle can still switch it).
  const firstAutoSave = useRef(props.autoSave);
  useEffect(() => {
    if (!editor || editor.destroyed || props.autoSave === undefined || props.autoSave === firstAutoSave.current) return;
    firstAutoSave.current = props.autoSave;
    editor.setAutoSave(props.autoSave);
  }, [editor, props.autoSave]);

  // The page sits between the phone layout's title bar and palette.
  const setInsets = useCallback(
    (top: number, bottom: number) => {
      if (!editor || editor.destroyed) return;
      Object.assign(editor.canvas.style, { top: `${top}px`, bottom: `${bottom}px`, height: 'auto' });
    },
    [editor],
  );
  useEffect(() => {
    if (!editor || editor.destroyed || isMobile) return;
    Object.assign(editor.canvas.style, { top: '0', bottom: '0', height: '100%' });
    editor.setTouch(true);
  }, [editor, isMobile]);

  // Live preference changes.
  const prefsKey = JSON.stringify(mergedPrefs(props, isMobile, mobileSeen.current));
  useEffect(() => {
    if (!editor || editor.destroyed) return;
    editor.setPrefs(JSON.parse(prefsKey) as Partial<WordcraftPrefs>);
  }, [editor, prefsKey]);

  // A new `document` prop after mount loads that document.
  const firstDoc = useRef(props.document);
  useEffect(() => {
    if (!editor || editor.destroyed || !props.document || props.document === firstDoc.current) return;
    firstDoc.current = props.document;
    editor.load(props.document).catch((e: unknown) => latest.current.onError?.(e instanceof Error ? e : new Error(String(e))));
  }, [editor, props.document]);

  return (
    <div
      ref={containerRef}
      className={className}
      data-wordcraft-root=""
      style={{ position: 'relative', width: '100%', height, overflow: 'hidden', ...style }}
    >
      {!editor && !error && loading}
      {editor && versionOptions && (
        <VersionHistory
          ref={history}
          editor={editor}
          options={versionOptions}
          user={userOf(props)}
          open={versionsOpen}
          onOpenChange={setVersionsOpen}
          dark={props.dark ?? props.prefs?.dark}
          wasmUrl={props.wasmUrl}
        />
      )}
      {editor && isMobile && !versionsOpen && (
        <MobileShell
          editor={editor}
          options={props.mobileOptions ?? {}}
          dark={props.dark ?? props.prefs?.dark}
          hiddenTabs={hiddenTabsFor(props.tabs, props.hiddenTabs)}
          disabledCommands={props.disabledCommands ?? []}
          onVersions={versionOptions ? () => setVersionsOpen(true) : undefined}
          onAi={ai && canWrite(permission) ? () => setAiOpen(true) : undefined}
          onInsets={setInsets}
          permission={permission}
          onComments={commentOptions && (permission !== 'view' || props.commentsVisibleToViewers !== false) ? () => setCommentsOpen(true) : undefined}
          openComments={commentOptions ? openThreads(comments) : 0}
          people={collaboration && props.presence !== false ? presence.filter((u) => !u.self).length : 0}
        />
      )}
      {editor && !isMobile && !versionsOpen && (props.permission || commentOptions || (collaboration && props.presence !== false && presence.some((u) => !u.self))) && (
        <WorkspaceRow dark={props.dark ?? props.prefs?.dark}>
          {props.permission && <AccessChip level={permission} />}
          {collaboration && props.presence !== false && <PresenceAvatars users={presence} following={following} onFollow={follow} />}
          {commentOptions && !commentsOpen && (permission !== 'view' || props.commentsVisibleToViewers !== false) && <CommentsButton count={openThreads(comments)} onClick={() => setCommentsOpen(true)} />}
        </WorkspaceRow>
      )}
      {editor && commentOptions && commentsOpen && !versionsOpen && (
        <CommentsPanel
          editor={editor}
          comments={comments}
          user={userOf(props)}
          people={people}
          options={commentOptions}
          canComment={canComment(permission)}
          assignees={assignees}
          onAssign={(id, p) => setAssignees((m) => new Map(m).set(id, p))}
          onClose={() => setCommentsOpen(false)}
          dark={props.dark ?? props.prefs?.dark}
          sheet={isMobile}
        />
      )}
      {notice && <Notice dark={props.dark ?? props.prefs?.dark} onClose={() => setNotice('')}>{notice}</Notice>}
      {editor && ai && !versionsOpen && (
        <AiBar
          editor={editor}
          options={ai}
          open={aiOpen}
          onOpenChange={setAiOpen}
          launcher={ai.launcher !== 'none' && !isMobile && canWrite(permission)}
          readOnly={!canWrite(permission)}
          bottom={isMobile ? 64 : undefined}
          dark={props.dark ?? props.prefs?.dark}
        />
      )}
      {error && (typeof fallback === 'function' ? fallback(error) : (fallback ?? <DefaultFallback error={error} />))}
    </div>
  );
});

/** Below this container width (CSS pixels) a touch screen gets the phone layout, as Word does at 600dp. */
export const MOBILE_BREAKPOINT = 600;

function isMobileAtMount(el: HTMLElement, mobile: WordcraftEditorProps['mobile']): boolean {
  if (mobile === true || mobile === false) return mobile;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse && el.getBoundingClientRect().width < MOBILE_BREAKPOINT;
}

/**
 * The preferences for the props. The phone layout hides WordCraft's own title bar, ribbon, status
 * bar and mini toolbar (it draws its own); leaving it (`restore`) brings back what the props ask for.
 */
function mergedPrefs(p: WordcraftEditorProps, mobile = false, restore = false): Partial<WordcraftPrefs> {
  const out: Partial<WordcraftPrefs> = { ...(p.prefs ?? {}) };
  if (p.dark !== undefined) out.dark = p.dark;
  const tabs = p.tabs || p.hiddenTabs ? { hiddenTabs: hiddenTabsFor(p.tabs, p.hiddenTabs) } : {};
  if (mobile) return { ...out, ...tabs, hideTitleBar: true, hideRibbon: true, ribbonCollapsed: false, hideStatusBar: true, miniToolbar: false };
  const desktop = restore ? { hideTitleBar: false, hideRibbon: false, hideStatusBar: false, miniToolbar: p.prefs?.miniToolbar ?? true } : {};
  return { ...out, ...desktop, ...chromePrefs(p.titleBar, p.ribbon), ...tabs };
}

function userOf(p: WordcraftEditorProps): WordcraftUser | undefined {
  if (p.user?.name?.trim()) return p.user;
  if (p.author?.trim()) return { name: p.author };
  return undefined;
}

function DefaultFallback({ error }: { error: Error }) {
  return (
    <div role="alert" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, textAlign: 'center', font: '14px system-ui, sans-serif', color: '#444', background: '#f3f3f3' }}>
      <strong>WordCraft couldn’t start.</strong>
      <span>A browser with WebGPU or WebGL2 is required.</span>
      <code style={{ fontSize: 12, color: '#888' }}>{error.message}</code>
    </div>
  );
}

export default WordcraftEditor;
