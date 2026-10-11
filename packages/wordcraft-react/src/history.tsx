'use client';

/**
 * Version history (an Extra), in the style of Google Docs: a panel on the right lists the
 * versions recorded as people worked, grouped by day. Click one to see it, read only, in place of
 * the document; restore it, name it, download a copy or delete it.
 *
 * `<WordcraftEditor versionHistory />` renders this for you and opens it from the title bar,
 * File › Info › View Version History, and Ctrl+Alt+Shift+H.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { createWordcraft } from './core.js';
import type { WordcraftEditor, WordcraftUser } from './core.js';
import { browserVersionStore, newVersionId, pruneVersions } from './versions.js';
import type { VersionHistoryOptions, VersionMeta, VersionStore } from './versions.js';

export interface VersionHistoryProps {
  editor: WordcraftEditor | null;
  options: VersionHistoryOptions;
  user?: WordcraftUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dark?: boolean;
  /** Where to load the `.wasm` from, for the preview (same as the editor's). */
  wasmUrl?: string | URL;
}

/** Imperative handle: record a version now (the editor calls this on each save). */
export interface VersionHistoryHandle {
  record(reason: VersionMeta['reason'], name?: string): Promise<void>;
}

const MINUTE = 60_000;

function words(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

function hashBytes(b: Uint8Array): string {
  // FNV-1a over the bytes: enough to skip recording an unchanged document.
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) {
    h ^= b[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return `${b.length}:${(h >>> 0).toString(16)}`;
}

function dayLabel(d: Date, now = new Date()): string {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

const timeOf = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const fullDate = (d: Date) => `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}, ${timeOf(d)}`;

const REASON: Record<VersionMeta['reason'], string> = {
  open: 'Opened',
  autosave: '',
  save: 'Saved',
  manual: '',
  restore: 'Restored',
};

/** The version history panel and its recorder. */
export const VersionHistory = forwardRef<VersionHistoryHandle, VersionHistoryProps>(function VersionHistory({ editor, options, user, open, onOpenChange, dark, wasmUrl }, ref) {
  const store: VersionStore = useMemo(() => options.store ?? browserVersionStore(options.documentId ?? 'default'), [options.store, options.documentId]);
  const interval = options.interval ?? 5 * MINUTE;
  const max = options.max ?? 200;
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [namedOnly, setNamedOnly] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [status, setStatus] = useState('');
  const [previewReady, setPreviewReady] = useState(false);
  const last = useRef<{ hash: string; rev: number; at: number } | null>(null);
  const previewBox = useRef<HTMLDivElement>(null);
  const preview = useRef<WordcraftEditor | null>(null);
  const userRef = useRef(user);
  userRef.current = user;

  const refresh = useCallback(async () => {
    try {
      setVersions(await store.list());
    } catch (e) {
      setStatus(`Couldn’t load the version history: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [store]);

  const record = useCallback(
    async (reason: VersionMeta['reason'], name?: string) => {
      if (!editor || editor.destroyed) return;
      const bytes = editor.export('json');
      const hash = hashBytes(bytes);
      if (!name && reason !== 'restore' && last.current?.hash === hash) return;
      last.current = { hash, rev: editor.rev(), at: Date.now() };
      const meta: VersionMeta = {
        id: newVersionId(),
        createdAt: new Date().toISOString(),
        author: userRef.current ? { name: userRef.current.name, color: userRef.current.color } : undefined,
        reason,
        size: bytes.byteLength,
        title: editor.title(),
        words: words(editor.getText()),
        ...(name ? { name } : {}),
      };
      try {
        await store.put(meta, bytes);
        await pruneVersions(store, max);
        await refresh();
      } catch (e) {
        console.warn('[wordcraft] version history:', e);
      }
    },
    [editor, store, max, refresh],
  );

  useImperativeHandle(ref, () => ({ record }), [record]);

  // Record the opened document, then a version every `interval` while it changes.
  useEffect(() => {
    if (!editor || editor.destroyed) return;
    let stopped = false;
    void (async () => {
      const list = await store.list().catch(() => [] as VersionMeta[]);
      if (stopped) return;
      setVersions(list);
      if (!list.length) await record('open');
      else last.current = { hash: '', rev: editor.rev(), at: Date.now() };
    })();
    const timer = setInterval(
      () => {
        if (editor.destroyed || !last.current) return;
        if (editor.rev() !== last.current.rev && Date.now() - last.current.at >= interval) void record('autosave');
      },
      Math.min(interval, 30_000),
    );
    // Leaving the page records the latest edits too.
    const onHide = () => {
      if (document.visibilityState === 'hidden' && last.current && editor.rev() !== last.current.rev) void record('autosave');
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [editor, store, interval]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opening the panel lists the versions again (another tab or person may have added some).
  useEffect(() => {
    if (open) void refresh();
    else {
      setSelected(null);
      setMenu(null);
      setRenaming(null);
      setStatus('');
    }
  }, [open, refresh]);

  // The preview: a second, read-only editor shown in place of the document.
  useEffect(() => {
    if (!selected || !previewBox.current) return;
    let cancelled = false;
    const box = previewBox.current;
    setPreviewReady(false);
    void (async () => {
      const bytes = await store.get(selected);
      if (cancelled || !bytes) {
        if (!bytes) setStatus('That version is no longer available.');
        return;
      }
      try {
        if (!preview.current || preview.current.destroyed) {
          preview.current = await createWordcraft(box, {
            document: { name: 'version.json', data: bytes },
            mode: 'viewing',
            titleBar: false,
            ribbon: 'hidden',
            autoSave: false,
            wasmUrl,
            prefs: { dark: !!dark },
          });
        } else {
          await preview.current.load({ name: 'version.json', data: bytes });
          preview.current.setMode('viewing');
        }
        if (cancelled) return;
        setPreviewReady(true);
      } catch (e) {
        setStatus(`Couldn’t show that version: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, store, wasmUrl, dark]);

  // Closing the preview releases its editor.
  useEffect(() => {
    if (selected) return;
    preview.current?.destroy();
    preview.current = null;
    setPreviewReady(false);
  }, [selected]);
  useEffect(() => () => preview.current?.destroy(), []);

  const restore = async (id: string) => {
    if (!editor || editor.destroyed) return;
    const v = versions.find((x) => x.id === id);
    const bytes = await store.get(id);
    if (!bytes) {
      setStatus('That version is no longer available.');
      return;
    }
    await record('autosave');
    editor.restoreContent(bytes, 'json');
    await record('restore', undefined);
    setSelected(null);
    setStatus(v ? `Restored the version from ${fullDate(new Date(v.createdAt))}.` : 'Version restored.');
    onOpenChange(false);
    editor.canvas.focus();
  };

  const download = async (v: VersionMeta) => {
    const bytes = await store.get(v.id);
    if (!bytes) return;
    // Convert through a hidden editor so the copy is a Word document.
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', width: '800px', height: '600px' });
    document.body.appendChild(host);
    try {
      const ed = await createWordcraft(host, { document: { name: 'version.json', data: bytes }, titleBar: false, ribbon: 'hidden', autoSave: false, fonts: false, wasmUrl });
      const blob = ed.exportBlob('docx');
      ed.destroy();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${v.name || v.title || 'Document'} (${new Date(v.createdAt).toISOString().slice(0, 16).replace('T', ' ').replace(':', '.')}).docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } finally {
      host.remove();
    }
  };

  const saveName = async (id: string | 'current') => {
    const name = draftName.trim();
    setRenaming(null);
    if (id === 'current') {
      if (name) await record('manual', name);
      return;
    }
    await store.rename(id, name || null);
    await refresh();
  };

  // Ctrl+Alt+Shift+H toggles the panel, as in Google Docs.
  useEffect(() => {
    if (!editor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.shiftKey && e.code === 'KeyH') {
        const root = editor.canvas.parentElement;
        if (root && (root.contains(document.activeElement) || document.activeElement === document.body)) {
          e.preventDefault();
          e.stopPropagation();
          onOpenChange(!open);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editor, open, onOpenChange]);

  if (!open) return null;

  const shown = namedOnly ? versions.filter((v) => v.name) : versions;
  const groups: Array<[string, VersionMeta[]]> = [];
  for (const v of shown) {
    const label = dayLabel(new Date(v.createdAt));
    const g = groups[groups.length - 1];
    if (g && g[0] === label) g[1].push(v);
    else groups.push([label, [v]]);
  }
  const sel = versions.find((v) => v.id === selected) ?? null;
  const stop = (e: ReactKeyboardEvent) => e.stopPropagation();

  return (
    <div className="wcvh" data-theme={dark ? 'dark' : 'light'} onKeyDown={stop} onKeyUp={stop}>
      <style>{CSS}</style>
      {selected && (
        <div className="wcvh-preview">
          <div className="wcvh-banner">
            <div className="wcvh-banner-text">
              <strong>{sel?.name || (sel ? fullDate(new Date(sel.createdAt)) : 'Version')}</strong>
              {sel && (
                <span>
                  {sel.name ? `${fullDate(new Date(sel.createdAt))} · ` : ''}
                  {sel.author?.name ?? 'Unknown'}
                </span>
              )}
            </div>
            <button type="button" className="wcvh-btn" onClick={() => setSelected(null)}>
              Back to current version
            </button>
            <button type="button" className="wcvh-btn wcvh-primary" onClick={() => void restore(selected)}>
              Restore this version
            </button>
          </div>
          <div ref={previewBox} className="wcvh-preview-doc">
            {!previewReady && <div className="wcvh-loading">Opening this version…</div>}
          </div>
        </div>
      )}
      <aside className="wcvh-panel" aria-label="Version history">
        <header className="wcvh-head">
          <h2>Version history</h2>
          <span className="wcvh-extra" title="An Extra: not part of WordCraft">
            Extra
          </span>
          <button type="button" className="wcvh-icon" aria-label="Close version history" onClick={() => onOpenChange(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </header>
        <div className="wcvh-tools">
          <label className="wcvh-filter">
            <span className="wcvh-switch">
              <input type="checkbox" checked={namedOnly} onChange={(e) => setNamedOnly(e.target.checked)} />
              <span />
            </span>
            Only named versions
          </label>
        </div>
        <div className="wcvh-list" role="list">
          <div role="listitem" className={`wcvh-item wcvh-current${selected ? '' : ' wcvh-on'}`} onClick={() => setSelected(null)}>
            <div className="wcvh-time">Current version</div>
            <div className="wcvh-who">
              <span className="wcvh-dot" style={{ background: user?.color ?? '#1a73e8' }} />
              {user?.name ?? 'You'}
            </div>
            {renaming === 'current' ? (
              <NameInput value={draftName} onChange={setDraftName} onDone={() => void saveName('current')} onCancel={() => setRenaming(null)} />
            ) : (
              <button
                type="button"
                className="wcvh-link"
                onClick={(e) => {
                  e.stopPropagation();
                  setDraftName('');
                  setRenaming('current');
                }}
              >
                Name current version
              </button>
            )}
          </div>
          {groups.map(([label, items]) => (
            <div key={label} className="wcvh-group">
              <div className="wcvh-day">{label}</div>
              {items.map((v) => {
                const d = new Date(v.createdAt);
                const reason = REASON[v.reason];
                return (
                  <div
                    key={v.id}
                    role="listitem"
                    tabIndex={0}
                    className={`wcvh-item${selected === v.id ? ' wcvh-on' : ''}`}
                    onClick={() => setSelected(v.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setSelected(v.id);
                    }}
                  >
                    {renaming === v.id ? (
                      <NameInput value={draftName} onChange={setDraftName} onDone={() => void saveName(v.id)} onCancel={() => setRenaming(null)} />
                    ) : (
                      <>
                        {v.name && <div className="wcvh-name">{v.name}</div>}
                        <div className={v.name ? 'wcvh-sub' : 'wcvh-time'}>
                          {v.name ? fullDate(d) : timeOf(d)}
                          {reason && <span className="wcvh-tag">{reason}</span>}
                        </div>
                      </>
                    )}
                    <div className="wcvh-who">
                      <span className="wcvh-dot" style={{ background: v.author?.color ?? '#9aa0a6' }} />
                      {v.author?.name ?? 'Unknown'}
                      {typeof v.words === 'number' && <span className="wcvh-words">{v.words.toLocaleString()} words</span>}
                    </div>
                    <button
                      type="button"
                      className="wcvh-icon wcvh-more"
                      aria-label="More actions"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenu(menu === v.id ? null : v.id);
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"
                        />
                      </svg>
                    </button>
                    {menu === v.id && (
                      <div className="wcvh-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                        <button role="menuitem" type="button" onClick={() => (setMenu(null), void restore(v.id))}>
                          Restore this version
                        </button>
                        <button
                          role="menuitem"
                          type="button"
                          onClick={() => {
                            setMenu(null);
                            setDraftName(v.name ?? '');
                            setRenaming(v.id);
                          }}
                        >
                          {v.name ? 'Rename version' : 'Name this version'}
                        </button>
                        <button role="menuitem" type="button" onClick={() => (setMenu(null), void download(v))}>
                          Download a copy (.docx)
                        </button>
                        <button
                          role="menuitem"
                          type="button"
                          onClick={async () => {
                            setMenu(null);
                            if (selected === v.id) setSelected(null);
                            await store.remove(v.id);
                            await refresh();
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {!shown.length && <p className="wcvh-empty">{namedOnly ? 'No named versions yet. Name one from its ⋮ menu.' : 'Versions appear here as you work.'}</p>}
        </div>
        {status && (
          <footer className="wcvh-status" role="status">
            {status}
          </footer>
        )}
      </aside>
    </div>
  );
});

function NameInput({ value, onChange, onDone, onCancel }: { value: string; onChange(v: string): void; onDone(): void; onCancel(): void }) {
  return (
    <input
      className="wcvh-input"
      autoFocus
      value={value}
      placeholder="Name this version"
      maxLength={80}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') onDone();
        if (e.key === 'Escape') onCancel();
      }}
    />
  );
}

const CSS = `
.wcvh{--bg:#fff;--fg:#1f1f1f;--dim:#5f6368;--line:#e0e3e7;--soft:#f1f4f9;--hover:#f4f6fa;--accent:#0b57d0;--accent-soft:#e8f0fe;--accent-fg:#fff;
--grad:linear-gradient(110deg,#4285f4 0%,#9b72cb 55%,#d96570 100%);--shadow:0 2px 6px rgba(60,64,67,.15),0 8px 24px rgba(60,64,67,.12);
position:absolute;inset:0;z-index:6;pointer-events:none;font:14px/1.45 "Google Sans Text","Google Sans",Inter,"Segoe UI",system-ui,sans-serif;color:var(--fg)}
.wcvh[data-theme=dark]{--bg:#1e1f20;--fg:#e3e3e3;--dim:#a8abb0;--line:#3c4043;--soft:#282a2c;--hover:#2a2c2e;--accent:#a8c7fa;--accent-soft:#0b3a7a;--accent-fg:#062e6f;--shadow:0 2px 6px rgba(0,0,0,.5),0 8px 24px rgba(0,0,0,.45)}
.wcvh *{box-sizing:border-box}
.wcvh button{font:inherit;color:inherit}
.wcvh-panel{pointer-events:auto;position:absolute;top:0;right:0;bottom:0;width:min(320px,100%);display:flex;flex-direction:column;background:var(--bg);border-left:1px solid var(--line);box-shadow:var(--shadow);animation:wcvh-in .25s cubic-bezier(.2,.8,.2,1)}
.wcvh-head{display:flex;align-items:center;gap:8px;padding:16px 12px 8px 20px}
.wcvh-head h2{margin:0;font-size:18px;font-weight:500;letter-spacing:-.01em}
.wcvh-extra{padding:1px 8px;border-radius:10px;background:var(--grad);color:#fff;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.wcvh-icon{margin-left:auto;width:32px;height:32px;border:0;border-radius:50%;background:transparent;color:var(--dim);display:grid;place-items:center;cursor:pointer}
.wcvh-icon:hover{background:var(--hover);color:var(--fg)}
.wcvh-tools{padding:4px 20px 12px;border-bottom:1px solid var(--line)}
.wcvh-filter{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--dim);cursor:pointer}
.wcvh-switch{position:relative;width:34px;height:20px;flex:none}
.wcvh-switch input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer;z-index:1}
.wcvh-switch span{position:absolute;inset:0;border-radius:10px;background:var(--line);transition:background .2s}
.wcvh-switch span::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .2s}
.wcvh-switch input:checked+span{background:var(--accent)}
.wcvh-switch input:checked+span::after{transform:translateX(14px)}
.wcvh-list{flex:1;overflow:auto;padding:8px 0 16px}
.wcvh-day{padding:14px 20px 6px;font-size:12px;font-weight:500;color:var(--dim)}
.wcvh-item{position:relative;padding:10px 44px 10px 20px;cursor:pointer;border-left:3px solid transparent;transition:background .12s}
.wcvh-item:hover{background:var(--hover)}
.wcvh-item:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.wcvh-on{background:var(--accent-soft);border-left-color:var(--accent)}
.wcvh-on:hover{background:var(--accent-soft)}
.wcvh-current{border-bottom:1px solid var(--line);padding-bottom:14px}
.wcvh-time{font-size:14px;font-weight:500}
.wcvh-name{font-size:14px;font-weight:600}
.wcvh-sub{font-size:12px;color:var(--dim)}
.wcvh-tag{display:inline-block;margin-left:8px;padding:0 7px;border-radius:9px;background:var(--soft);color:var(--dim);font-size:11px;font-weight:500;vertical-align:1px}
.wcvh-who{display:flex;align-items:center;gap:7px;margin-top:4px;font-size:12px;color:var(--dim)}
.wcvh-dot{width:9px;height:9px;border-radius:50%;flex:none}
.wcvh-words{margin-left:auto;font-size:11px}
.wcvh-more{position:absolute;top:8px;right:8px;opacity:0}
.wcvh-item:hover .wcvh-more,.wcvh-on .wcvh-more,.wcvh-more:focus-visible{opacity:1}
.wcvh-menu{position:absolute;right:10px;top:40px;z-index:3;min-width:210px;padding:6px 0;background:var(--bg);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);animation:wcvh-pop .14s ease}
.wcvh-menu button{display:block;width:100%;text-align:left;padding:9px 16px;border:0;background:none;font-size:13px;cursor:pointer}
.wcvh-menu button:hover{background:var(--hover)}
.wcvh-link{margin-top:8px;padding:0;border:0;background:none;color:var(--accent)!important;font-size:13px;font-weight:500;cursor:pointer}
.wcvh-link:hover{text-decoration:underline}
.wcvh-input{width:100%;margin:2px 0;padding:6px 9px;border:1px solid var(--accent);border-radius:6px;font:inherit;font-size:14px;background:var(--bg);color:var(--fg);outline:none;box-shadow:0 0 0 3px var(--accent-soft)}
.wcvh-empty{margin:24px 20px;color:var(--dim);font-size:13px}
.wcvh-status{padding:10px 20px;border-top:1px solid var(--line);font-size:12px;color:var(--dim)}
.wcvh-preview{pointer-events:auto;position:absolute;top:0;left:0;bottom:0;right:min(320px,100%);display:flex;flex-direction:column;background:var(--soft);animation:wcvh-fade .2s ease}
.wcvh-banner{display:flex;align-items:center;gap:10px;padding:10px 16px;background:var(--bg);border-bottom:1px solid var(--line);flex-wrap:wrap}
.wcvh-banner-text{display:grid;margin-right:auto;min-width:0}
.wcvh-banner-text strong{font-size:15px;font-weight:600}
.wcvh-banner-text span{font-size:12px;color:var(--dim)}
.wcvh-btn{height:36px;padding:0 18px;border-radius:18px;border:1px solid var(--line);background:var(--bg);font-size:14px;font-weight:500;cursor:pointer;transition:background .15s,box-shadow .15s}
.wcvh-btn:hover{background:var(--hover)}
.wcvh .wcvh-primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
.wcvh-primary:hover{background:var(--accent);box-shadow:0 1px 3px rgba(11,87,208,.35)}
.wcvh-preview-doc{position:relative;flex:1;min-height:0}
.wcvh-loading{position:absolute;inset:0;display:grid;place-items:center;color:var(--dim);font-size:14px}
@keyframes wcvh-in{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}
@keyframes wcvh-fade{from{opacity:0}to{opacity:1}}
@keyframes wcvh-pop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.wcvh *{animation:none!important;transition:none!important}}
`;
