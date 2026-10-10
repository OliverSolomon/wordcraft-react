'use client';

/**
 * `<WordcraftEditor />`: the WordCraft word processor as a React component.
 *
 * Works in React 18/19, Next.js (App Router and Pages Router), Remix and Vite. The component
 * renders a sized container on the server and mounts WordCraft in an effect on the client, so it
 * needs no `dynamic(..., { ssr: false })` wrapper.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { createWordcraft } from './core.js';
import type { ChangeInfo, DocumentSource, SavedFile, WordcraftEditor as Editor, WordcraftOptions, WordcraftPrefs } from './core.js';

export * from './core.js';

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
  /** Shorthand for `prefs.author` (comments and tracked changes). */
  author?: string;
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
  /** Save / Save As / Export in WordCraft's UI. Without it the browser downloads the file. */
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

  // Latest props for callbacks, so changing a handler never remounts the editor.
  const latest = useRef(props);
  latest.current = props;

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
      prefs: mergedPrefs(p),
      onChange: (info) => instance && latest.current.onChange?.(info, instance),
      onSave: (file) => (instance ? latest.current.onSave?.(file, instance) : undefined),
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
    editor.setOnSave(hasOnSave ? (file) => latest.current.onSave?.(file, editor) : null);
  }, [editor, hasOnSave]);

  // Live preference changes.
  const prefsKey = JSON.stringify(mergedPrefs(props));
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
      {error && (typeof fallback === 'function' ? fallback(error) : (fallback ?? <DefaultFallback error={error} />))}
    </div>
  );
});

function mergedPrefs(p: WordcraftEditorProps): Partial<WordcraftPrefs> {
  const out: Partial<WordcraftPrefs> = { ...(p.prefs ?? {}) };
  if (p.dark !== undefined) out.dark = p.dark;
  if (p.author !== undefined) out.author = p.author;
  return out;
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
