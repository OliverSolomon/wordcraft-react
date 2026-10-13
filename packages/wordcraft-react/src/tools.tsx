'use client';

/**
 * Smaller tools (Extras, each behind its own option): an outline of the headings with drag to
 * reorder sections, the accessibility checker (WordCraft's own rules), sources and a
 * bibliography, word count with a goal, voice typing, and translating the document.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import type { DocParagraph, WordcraftEditor } from './core.js';
import { countText, indexDocument, sections } from './doc-text.js';
import type { MarkLayers } from './doc-text.js';
import { completeText } from './ai-run.js';
import type { AiSource } from './ai-run.js';
import { ICONS, PanelIcon, SidePanel } from './panel.js';

export interface ToolsOptions {
  /** The outline of headings, with drag to reorder sections. */
  outline?: boolean;
  /** WordCraft's accessibility checker in a panel: missing alt text, heading order, contrast, link text, table headers. */
  accessibility?: boolean;
  /** Sources, citations and a bibliography (APA, MLA, Chicago and more). */
  sources?: boolean;
  /** Word count with a goal; a number sets the goal. */
  wordCount?: boolean | { goal?: number };
  /** Voice typing through the browser's speech recognition (where it has one). */
  voice?: boolean;
  /** Translate the whole document; the result goes to `onTranslated` (else it downloads as Markdown). */
  translate?: boolean | { languages?: string[] };
  onTranslated?: (doc: { language: string; markdown: string; name: string }) => void;
}

export type ToolId = 'outline' | 'accessibility' | 'sources' | 'count' | 'translate';

const run = (editor: WordcraftEditor, cmd: string, params?: Record<string, unknown>) => {
  try {
    return editor.execute(cmd, params);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
};

function useRev(editor: WordcraftEditor, ms = 800): number {
  const [rev, setRev] = useState(() => editor.rev());
  useEffect(() => {
    const t = window.setInterval(() => !editor.destroyed && setRev(editor.rev()), ms);
    return () => window.clearInterval(t);
  }, [editor, ms]);
  return rev;
}

// ----- outline --------------------------------------------------------------------------------

export function OutlinePanel({ editor, canWrite, marks, onClose, dark, sheet }: { editor: WordcraftEditor; canWrite: boolean; marks: MarkLayers; onClose: () => void; dark?: boolean; sheet?: boolean }) {
  const rev = useRev(editor);
  const paras = useMemo(() => editor.paragraphs(), [editor, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const heads = paras.map((p, i) => ({ p, i })).filter(({ p }) => p.heading > 0 && p.text.trim() && p.path.length === 1);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [status, setStatus] = useState('');

  // A section's top-level blocks: from its heading to the next heading at the same or a higher level.
  const span = (h: { p: DocParagraph }) => {
    const start = h.p.path[0];
    const next = heads.find((x) => x.p.path[0] > start && x.p.heading <= h.p.heading);
    const last = paras.filter((q) => q.path.length >= 1).reduce((m, q) => Math.max(m, q.path[0]), start);
    return { start, end: next ? next.p.path[0] : last + 1 };
  };

  const move = (from: number, to: number) => {
    const a = heads[from], b = heads[to];
    if (!a || !b || from === to) return;
    const s = span(a);
    if (b.p.path[0] > s.start && b.p.path[0] < s.end) return setStatus('A section can’t move inside itself.');
    const size = s.end - s.start;
    const target = b.p.path[0] > s.start ? b.p.path[0] - size : b.p.path[0];
    const r1 = run(editor, 'outline.selectSubtree', { block: s.start }) as { error?: string };
    if (r1?.error) return setStatus(r1.error);
    run(editor, 'edit.cut');
    editor.selectText([target], 0, 0);
    const r2 = run(editor, 'edit.paste') as { error?: string };
    setStatus(r2?.error ? r2.error : `Moved “${a.p.text.slice(0, 40)}”.`);
  };

  return (
    <SidePanel title="Outline" icon={<PanelIcon d={ICONS.outline} />} onClose={onClose} dark={dark} sheet={sheet}>
      <div className="wcsp-body">
        {!heads.length && <p className="wcsp-empty">Headings (Heading 1, 2, 3…) appear here. Apply a heading style to start an outline.</p>}
        <div className="wcsp-list" role="list">
          {heads.map((h, k) => (
            <button
              key={`${h.p.path.join('.')}-${k}`}
              type="button"
              role="listitem"
              className="wcsp-item"
              draggable={canWrite}
              data-over={over === k && drag !== null && drag !== k ? '' : undefined}
              style={{ paddingLeft: 8 + (h.p.heading - 1) * 14, fontWeight: h.p.heading <= 1 ? 600 : 400 }}
              onClick={() => {
                editor.selectText(h.p.path, 0, 0);
                marks.flash(h.p.path, 0, h.p.text.length);
              }}
              onDragStart={(e) => {
                setDrag(k);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(k);
              }}
              onDragEnd={() => (setDrag(null), setOver(null))}
              onDrop={(e) => {
                e.preventDefault();
                if (drag !== null) move(drag, k);
                setDrag(null);
                setOver(null);
              }}
              onKeyDown={(e) => {
                if (!canWrite || !e.altKey) return;
                if (e.key === 'ArrowUp' && k > 0) (e.preventDefault(), move(k, k - 1));
                if (e.key === 'ArrowDown') {
                  // Moving a section down is moving the next one up above it.
                  e.preventDefault();
                  const sibling = heads.findIndex((x) => x.p.path[0] === span(h).end);
                  if (sibling >= 0) move(sibling, k);
                }
              }}
            >
              <span className="wcsp-grow">{h.p.text}</span>
            </button>
          ))}
        </div>
        {canWrite && heads.length > 1 && <p className="wcsp-dim">Drag a heading to move its section, or use Alt+Up and Alt+Down.</p>}
        {status && <p className="wcsp-dim" role="status">{status}</p>}
      </div>
    </SidePanel>
  );
}

// ----- accessibility --------------------------------------------------------------------------

interface A11yIssue {
  kind: 'error' | 'warning' | 'tip';
  rule: string;
  issue: string;
  where?: number[];
  pos?: unknown;
  select?: { anchor: unknown; focus: unknown };
  fix?: string;
  action?: { label: string; command: string; params?: Record<string, unknown> };
}

export function AccessibilityPanel({ editor, canWrite, onClose, dark, sheet }: { editor: WordcraftEditor; canWrite: boolean; onClose: () => void; dark?: boolean; sheet?: boolean }) {
  const rev = useRev(editor, 1500);
  const issues = useMemo(() => {
    const r = run(editor, 'file.accessibility') as { issues?: A11yIssue[] };
    return r?.issues ?? [];
  }, [editor, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const color = { error: '#d93025', warning: '#f9ab00', tip: '#1a73e8' };
  const go = (x: A11yIssue) => {
    if (x.select) run(editor, 'select.range', x.select as Record<string, unknown>);
    else if (x.pos) run(editor, 'select.range', { anchor: x.pos, focus: x.pos });
  };
  return (
    <SidePanel title="Accessibility" icon={<PanelIcon d={ICONS.access} />} extra={false} onClose={onClose} dark={dark} sheet={sheet}>
      <div className="wcsp-body">
        <p className="wcsp-dim">{issues.length ? `${issues.filter((x) => x.kind === 'error').length} errors, ${issues.filter((x) => x.kind === 'warning').length} warnings, ${issues.filter((x) => x.kind === 'tip').length} tips` : 'No accessibility issues found.'}</p>
        {issues.map((x, i) => (
          <div key={i} className="wcsp-card">
            <div className="wcsp-row">
              <span className="wcsp-dot" style={{ background: color[x.kind] }} />
              <strong className="wcsp-grow" style={{ fontSize: 13 }}>{x.issue}</strong>
            </div>
            {x.fix && <p className="wcsp-dim">{x.fix}</p>}
            <div className="wcsp-row">
              {(x.pos || x.select) && (
                <button type="button" className="wcsp-btn wcsp-small" onClick={() => go(x)}>
                  Go to
                </button>
              )}
              {canWrite && x.action && (
                <button
                  type="button"
                  className="wcsp-btn wcsp-small wcsp-primary"
                  onClick={() => {
                    go(x);
                    run(editor, x.action!.command, x.action!.params ?? {});
                  }}
                >
                  {x.action.label}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </SidePanel>
  );
}

// ----- sources and bibliography ---------------------------------------------------------------

interface Source {
  tag: string;
  kind: string;
  author: string;
  title: string;
  year: string;
  publisher?: string;
  url?: string;
}

const STYLES = ['APA', 'MLA', 'Chicago', 'Harvard (Anglia)', 'IEEE', 'ISO 690 (numerical)'];

export function SourcesPanel({ editor, canWrite, onClose, dark, sheet }: { editor: WordcraftEditor; canWrite: boolean; onClose: () => void; dark?: boolean; sheet?: boolean }) {
  const rev = useRev(editor, 1500);
  const [tick, setTick] = useState(0);
  const sources = useMemo(() => {
    const r = run(editor, 'references.sources', {}) as Source[] | { sources?: Source[]; error?: string };
    return Array.isArray(r) ? r : (r?.sources ?? []);
  }, [editor, rev, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [form, setForm] = useState({ kind: 'website', author: '', title: '', year: '', publisher: '', url: '' });
  const [style, setStyle] = useState('APA');
  const [status, setStatus] = useState('');
  const add = (cite: boolean) => {
    if (!form.title.trim()) return setStatus('A source needs a title.');
    const r = run(editor, cite ? 'references.citation' : 'references.sources', cite ? { source: form } : { add: form }) as { error?: string };
    if (r?.error) return setStatus(r.error);
    setForm({ kind: 'website', author: '', title: '', year: '', publisher: '', url: '' });
    setTick((t) => t + 1);
    setStatus(cite ? 'Cited at the cursor.' : 'Source added.');
  };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <SidePanel title="Sources" icon={<PanelIcon d={ICONS.book} />} extra={false} onClose={onClose} dark={dark} sheet={sheet}>
      <div className="wcsp-body">
        {sources.map((s) => (
          <div key={s.tag} className="wcsp-card">
            <strong style={{ fontSize: 13 }}>{s.title || s.tag}</strong>
            <p className="wcsp-dim">{[s.author, s.year, s.publisher].filter(Boolean).join(' · ')}</p>
            <div className="wcsp-row">
              {s.url && /^https?:\/\//.test(s.url) && (
                <a className="wcsp-chip" style={{ display: 'inline-grid', placeItems: 'center', textDecoration: 'none' }} href={s.url} target="_blank" rel="noreferrer noopener">
                  {new URL(s.url).hostname}
                </a>
              )}
              {canWrite && (
                <button type="button" className="wcsp-btn wcsp-small" onClick={() => (run(editor, 'references.citation', { tag: s.tag }), setStatus('Cited at the cursor.'))}>
                  Cite
                </button>
              )}
            </div>
          </div>
        ))}
        {!sources.length && <p className="wcsp-empty">No sources yet.</p>}
        {canWrite && (
          <div className="wcsp-card" style={{ display: 'grid', gap: 8 }}>
            <h3>Add a source</h3>
            <label className="wcsp-field">
              Type
              <select value={form.kind} onChange={set('kind')}>
                <option value="website">Website</option>
                <option value="book">Book</option>
                <option value="article">Journal article</option>
                <option value="report">Report</option>
              </select>
            </label>
            <label className="wcsp-field">
              Author (Last, First; Last, First)
              <input value={form.author} onChange={set('author')} />
            </label>
            <label className="wcsp-field">
              Title
              <input value={form.title} onChange={set('title')} />
            </label>
            <div className="wcsp-row">
              <label className="wcsp-field wcsp-grow">
                Year
                <input value={form.year} onChange={set('year')} />
              </label>
              <label className="wcsp-field wcsp-grow">
                Publisher
                <input value={form.publisher} onChange={set('publisher')} />
              </label>
            </div>
            <label className="wcsp-field">
              Link
              <input value={form.url} onChange={set('url')} placeholder="https://" />
            </label>
            <div className="wcsp-row">
              <button type="button" className="wcsp-btn wcsp-primary" onClick={() => add(true)}>
                Add and cite
              </button>
              <button type="button" className="wcsp-btn" onClick={() => add(false)}>
                Add
              </button>
            </div>
          </div>
        )}
        {status && <p className="wcsp-dim" role="status">{status}</p>}
      </div>
      {canWrite && (
        <div className="wcsp-foot">
          <div className="wcsp-row">
            <label className="wcsp-field wcsp-grow">
              Style
              <select
                value={style}
                onChange={(e) => {
                  setStyle(e.target.value);
                  run(editor, 'references.citationStyle', { style: e.target.value });
                }}
              >
                {STYLES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <button type="button" className="wcsp-btn" style={{ alignSelf: 'end' }} onClick={() => (run(editor, 'references.bibliography', {}), setStatus('Bibliography inserted at the cursor.'))}>
              Insert bibliography
            </button>
          </div>
        </div>
      )}
    </SidePanel>
  );
}

// ----- word count -----------------------------------------------------------------------------

export function WordCountPanel({ editor, goal: initialGoal, onClose, dark, sheet }: { editor: WordcraftEditor; goal?: number; onClose: () => void; dark?: boolean; sheet?: boolean }) {
  const rev = useRev(editor, 700);
  const [goal, setGoal] = useState(initialGoal ?? 0);
  const [selected, setSelected] = useState('');
  useEffect(() => editor.onSelection(() => setSelected(editor.getSelectedText())), [editor]);
  const all = useMemo(() => countText(indexDocument(editor).text), [editor, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = countText(selected);
  const secs = useMemo(() => sections(editor.paragraphs()).filter((s) => s.heading >= 0), [editor, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const paras = useMemo(() => editor.paragraphs(), [editor, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const pct = goal > 0 ? Math.min(100, Math.round((all.words / goal) * 100)) : 0;
  return (
    <SidePanel title="Word count" icon={<PanelIcon d={ICONS.count} />} onClose={onClose} dark={dark} sheet={sheet}>
      <div className="wcsp-body">
        <div className="wcsp-card">
          <div className="wcsp-row" style={{ justifyContent: 'space-between' }}>
            <span>Words</span>
            <strong>{all.words.toLocaleString()}</strong>
          </div>
          <div className="wcsp-row" style={{ justifyContent: 'space-between' }}>
            <span>Characters</span>
            <span>{all.characters.toLocaleString()} ({all.charactersNoSpaces.toLocaleString()} without spaces)</span>
          </div>
          <div className="wcsp-row" style={{ justifyContent: 'space-between' }}>
            <span>Pages (about)</span>
            <span>{all.pages}</span>
          </div>
          <div className="wcsp-row" style={{ justifyContent: 'space-between' }}>
            <span>Reading time</span>
            <span>{all.readingMinutes} min</span>
          </div>
          {selected.trim() && (
            <div className="wcsp-row" style={{ justifyContent: 'space-between' }}>
              <span>Selection</span>
              <span>
                {sel.words.toLocaleString()} words, {sel.characters.toLocaleString()} characters
              </span>
            </div>
          )}
        </div>
        <div className="wcsp-card" style={{ display: 'grid', gap: 8 }}>
          <label className="wcsp-field">
            Word goal
            <input type="number" min={0} step={50} value={goal || ''} placeholder="e.g. 1500" onChange={(e) => setGoal(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          {goal > 0 && (
            <>
              <div className="wcsp-meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <span className="wcsp-dim">{all.words >= goal ? 'Goal reached.' : `${(goal - all.words).toLocaleString()} words to go (${pct}%).`}</span>
            </>
          )}
        </div>
        {secs.length > 1 && (
          <div className="wcsp-card">
            <h3>By section</h3>
            {secs.map((s) => (
              <div key={s.heading} className="wcsp-row" style={{ justifyContent: 'space-between' }}>
                <span className="wcsp-grow" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.title}
                </span>
                <span className="wcsp-dim">{countText(s.paras.map((i) => paras[i]?.text ?? '').join('\n')).words}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </SidePanel>
  );
}

// ----- voice typing ---------------------------------------------------------------------------

type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

export function speechAvailable(): boolean {
  return typeof window !== 'undefined' && !!((window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
}

/** Voice typing: what is said is typed at the caret, as Word's Dictate does. */
export function useVoiceTyping(editor: WordcraftEditor | null, language?: string) {
  const [on, setOn] = useState(false);
  const [error, setError] = useState('');
  const rec = useRef<Recognition | null>(null);
  const stop = () => {
    rec.current?.stop();
    rec.current = null;
    setOn(false);
  };
  const start = () => {
    if (!editor) return;
    const C = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
    if (!C) return setError('This browser has no speech recognition.');
    const r = new C();
    r.lang = language ?? navigator.language;
    r.continuous = true;
    r.interimResults = false;
    let first = true;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res.isFinal) continue;
        let text = res[0].transcript.trim();
        if (!text) continue;
        text = (first ? '' : ' ') + text.replace(/\s+(period|full stop)$/i, '.').replace(/\s+comma$/i, ',');
        first = false;
        try {
          editor.execute('text.insert', { text });
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    r.onerror = (e) => setError(e.error === 'not-allowed' ? 'The microphone is blocked for this page.' : e.error);
    r.onend = () => setOn(false);
    rec.current = r;
    setError('');
    r.start();
    setOn(true);
  };
  useEffect(() => () => rec.current?.stop(), []);
  return { on, error, toggle: () => (on ? stop() : start()), available: speechAvailable() };
}

// ----- translate ------------------------------------------------------------------------------

/** Translate the document section by section (Markdown keeps headings, lists and tables). */
export async function translateDocument(editor: WordcraftEditor, ai: AiSource, language: string, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<string> {
  const md = editor.getMarkdown();
  const chunks = md.split(/\n(?=#{1,6}\s)/).reduce<string[]>((acc, part) => {
    const last = acc[acc.length - 1];
    if (last !== undefined && last.length + part.length < 3500) acc[acc.length - 1] = `${last}\n${part}`;
    else acc.push(part);
    return acc;
  }, []);
  const out: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) break;
    onProgress?.(i, chunks.length);
    out.push((await completeText(ai, { action: 'translate', prompt: `${language}. The text is Markdown: keep every Markdown mark (headings, lists, tables, links) exactly and translate only the words`, selection: chunks[i], signal })).trim());
  }
  onProgress?.(chunks.length, chunks.length);
  return out.join('\n\n');
}

export function TranslatePanel({ editor, ai, languages, onTranslated, onClose, dark, sheet }: { editor: WordcraftEditor; ai: AiSource; languages?: string[]; onTranslated?: ToolsOptions['onTranslated']; onClose: () => void; dark?: boolean; sheet?: boolean }) {
  const [language, setLanguage] = useState(languages?.[0] ?? 'French');
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const abort = useRef<AbortController | null>(null);
  const go = async () => {
    const ctl = new AbortController();
    abort.current = ctl;
    setError('');
    setDone('');
    try {
      const markdown = await translateDocument(editor, ai, language, (a, b) => setProgress([a, b]), ctl.signal);
      const base = (editor.title() || 'Document').replace(/\.[^.]+$/, '');
      const name = `${base} (${language}).md`;
      if (onTranslated) onTranslated({ language, markdown, name });
      else {
        const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: name });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
      setDone(onTranslated ? `The ${language} copy is ready.` : `Downloaded ${name}.`);
    } catch (e) {
      if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };
  return (
    <SidePanel title="Translate document" icon={<PanelIcon d={ICONS.translate} />} onClose={() => (abort.current?.abort(), onClose())} dark={dark} sheet={sheet}>
      <div className="wcsp-body">
        <p className="wcsp-note">Makes a translated copy, keeping headings, lists and tables. This document is not changed. The text is sent to the AI section by section.</p>
        <label className="wcsp-field">
          Into
          {languages?.length ? (
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {languages.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          ) : (
            <input value={language} onChange={(e) => setLanguage(e.target.value)} />
          )}
        </label>
        <button type="button" className="wcsp-btn wcsp-primary" disabled={!!progress || !language.trim()} onClick={() => void go()}>
          {progress ? `Translating ${Math.min(progress[0] + 1, progress[1])} of ${progress[1]}…` : 'Translate'}
        </button>
        {done && <p className="wcsp-dim" role="status">{done}</p>}
        {error && <p className="wcsp-note" role="status">{error}</p>}
      </div>
    </SidePanel>
  );
}
