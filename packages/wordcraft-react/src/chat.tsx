'use client';

/**
 * Chat with the document (an Extra), like Gemini's side panel in Google Docs. Questions are
 * answered from the document's own passages, numbered, and the answer cites them as chips that
 * scroll to and highlight the paragraph. Long documents are cut by heading and only the passages
 * that match the question are sent; the whole text never goes for a narrow question.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { WordcraftEditor } from './core.js';
import { completeText } from './ai-run.js';
import type { AiSource } from './ai-run.js';
import { indexDocument, sections } from './doc-text.js';
import type { DocIndex, MarkLayers } from './doc-text.js';
import { ICONS, PanelIcon, SidePanel } from './panel.js';
import { insertText } from './insert-text.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Passages the answer was given, by number: `{ [n]: { path, text } }`. */
  passages?: Record<number, { path: number[]; text: string }>;
  at: string;
}

/** Keeps a person's chat with a document (the host knows which document and person). */
export interface ChatStore {
  load(): Promise<ChatMessage[]> | ChatMessage[];
  save(messages: ChatMessage[]): Promise<void> | void;
  clear(): Promise<void> | void;
}

/** A chat store in this browser's localStorage under `key`. */
export function browserChatStore(key = 'wordcraft.chat'): ChatStore {
  return {
    load() {
      try {
        return JSON.parse(localStorage.getItem(key) ?? '[]') as ChatMessage[];
      } catch {
        return [];
      }
    },
    save(messages) {
      try {
        localStorage.setItem(key, JSON.stringify(messages.slice(-60)));
      } catch {
        // storage full or blocked: the chat still works for this visit
      }
    },
    clear() {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

export type ChatScope = 'document' | 'section' | 'selection';

const BUDGET = 9000;
const STOP = new Set('a an and are as at be but by for from has have how i in is it its of on or that the this to was what when where which who why will with you your does do did can should would could about into than then there these those our we they them their not no'.split(' '));
const terms = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((w) => !STOP.has(w));

/** The passages to send for a question: by relevance for a narrow one, in order for a broad one. */
export function pickPassages(index: DocIndex, question: string, scope: ChatScope, caretPara: number | null, broad: boolean): number[] {
  const ps = index.paragraphs;
  const nonEmpty = (i: number) => !!ps[i]?.text.trim();
  let pool = ps.map((_, i) => i).filter(nonEmpty);
  if (scope === 'section' && caretPara !== null) {
    const sec = sections(ps).find((s) => s.paras.includes(caretPara));
    if (sec) pool = sec.paras.filter(nonEmpty);
  }
  const fit = (list: number[]) => {
    const out: number[] = [];
    let used = 0;
    for (const i of list) {
      const n = ps[i].text.length + 8;
      if (used + n > BUDGET) break;
      out.push(i);
      used += n;
    }
    return out;
  };
  if (broad) {
    // Headings first so a summary sees the shape, then text in order until the budget is spent.
    const heads = pool.filter((i) => ps[i].heading > 0);
    const chosen = new Set(fit(heads));
    let used = [...chosen].reduce((a, i) => a + ps[i].text.length + 8, 0);
    for (const i of pool) {
      if (chosen.has(i)) continue;
      const n = ps[i].text.length + 8;
      if (used + n > BUDGET) break;
      chosen.add(i);
      used += n;
    }
    return [...chosen].sort((a, b) => a - b);
  }
  const q = new Set(terms(question));
  const df = new Map<string, number>();
  const docs = pool.map((i) => {
    const t = terms(ps[i].text);
    new Set(t).forEach((w) => df.set(w, (df.get(w) ?? 0) + 1));
    return { i, t };
  });
  const N = docs.length || 1;
  // Each paragraph's section heading counts towards it (a question about "budget" finds the Budget section).
  const secOf = new Map<number, string>();
  for (const s of sections(ps)) for (const i of s.paras) secOf.set(i, s.title);
  const scored = docs.map(({ i, t }) => {
    let score = 0;
    for (const w of t) if (q.has(w)) score += Math.log(1 + N / (df.get(w) ?? 1)) / Math.sqrt(1 + t.length / 40);
    for (const w of terms(secOf.get(i) ?? '')) if (q.has(w)) score += 1.5;
    return { i, score };
  });
  const best = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  // A neighbour of a hit often finishes its thought.
  const withNeighbours: number[] = [];
  for (const { i } of best.slice(0, 14)) for (const j of [i, i + 1]) if (pool.includes(j) && !withNeighbours.includes(j)) withNeighbours.push(j);
  const chosen = fit(withNeighbours.length ? withNeighbours : pool.slice(0, 20));
  return chosen.sort((a, b) => a - b);
}

const QUICK: Array<{ label: string; prompt: string; broad?: boolean; selection?: boolean }> = [
  { label: 'Summarise', prompt: 'Summarise this document in a short paragraph.', broad: true },
  { label: 'Key points', prompt: 'List the key points as short bullet lines.', broad: true },
  { label: 'Action items', prompt: 'List the action items, with owners and dates where the document gives them.', broad: true },
  { label: 'Explain this', prompt: 'Explain the selected text in plain words.', selection: true },
  { label: 'Translate selection', prompt: 'translate', selection: true },
];

export interface DocChatProps {
  editor: WordcraftEditor;
  ai: AiSource & { instructions?: string };
  store?: ChatStore;
  /** The person may change the text (Insert and Replace show). */
  canWrite: boolean;
  /** The person may comment (Add as comment shows). */
  canComment: boolean;
  marks: MarkLayers;
  onClose: () => void;
  dark?: boolean;
  sheet?: boolean;
}

export function DocChat({ editor, ai, store, canWrite, canComment, marks, onClose, dark, sheet }: DocChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState<ChatScope>('document');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [find, setFind] = useState<{ q: string; hits: Array<{ path: number[]; text: string; start: number }> } | null>(null);
  const [lang, setLang] = useState('');
  const [mode, setMode] = useState<'' | 'translate' | 'find'>('');
  const [modeText, setModeText] = useState('');
  const [status, setStatus] = useState('');
  const abort = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    Promise.resolve(store?.load() ?? [])
      .then((m) => live && setMessages(m))
      .catch(() => undefined);
    return () => {
      live = false;
      abort.current?.abort();
    };
  }, [store]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages, streaming]);

  const persist = (m: ChatMessage[]) => {
    setMessages(m);
    try {
      void Promise.resolve(store?.save(m)).catch(() => undefined);
    } catch {
      /* the chat still works */
    }
  };

  const caretPara = (index: DocIndex): number | null => {
    const at = editor.caret()?.focus;
    if (!at) return null;
    const i = index.paragraphs.findIndex((p) => p.path.length === at.path.length && p.path.every((x, k) => x === at.path[k]));
    return i < 0 ? null : i;
  };

  const ask = async (question: string, opts: { broad?: boolean; translate?: string } = {}) => {
    const q = question.trim();
    if (!q || busy) return;
    const index = indexDocument(editor);
    const selection = editor.getSelectedText().trim();
    const useScope: ChatScope = selection && scope === 'selection' ? 'selection' : scope === 'selection' ? 'document' : scope;
    const ids = useScope === 'selection' ? [] : pickPassages(index, q, useScope, caretPara(index), !!opts.broad);
    const passages: Record<number, { path: number[]; text: string }> = {};
    ids.forEach((i, k) => (passages[k + 1] = { path: index.paragraphs[i].path, text: index.paragraphs[i].text }));
    const doc = Object.entries(passages)
      .map(([n, p]) => `[${n}] ${p.text}`)
      .join('\n');
    const user: ChatMessage = { role: 'user', content: q, at: new Date().toISOString() };
    const next = [...messages, user];
    setMessages(next);
    setDraft('');
    setBusy(true);
    setStreaming('');
    setStatus('');
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const answer = await completeText(
        ai,
        opts.translate
          ? { action: 'translate', prompt: opts.translate, selection, document: '', signal: ctl.signal }
          : {
              action: 'ask',
              prompt: q,
              selection: useScope === 'selection' || /\bselect/i.test(q) ? selection : '',
              document: doc || '(The document is empty.)',
              history: messages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
              instructions: ai.instructions,
              signal: ctl.signal,
            },
        setStreaming,
      );
      if (ctl.signal.aborted) return;
      persist([...next, { role: 'assistant', content: answer.trim() || 'No answer came back. Try again.', passages, at: new Date().toISOString() }]);
    } catch (e) {
      if (!ctl.signal.aborted) persist([...next, { role: 'assistant', content: `Something went wrong: ${e instanceof Error ? e.message : String(e)}`, at: new Date().toISOString() }]);
    } finally {
      setBusy(false);
      setStreaming('');
    }
  };

  const goTo = (p: { path: number[]; text: string }) => {
    try {
      // The paragraph may have moved since the answer: find it again by its text.
      const now = editor.paragraphs();
      const same = now.find((x) => x.text === p.text) ?? now.find((x) => x.path.join() === p.path.join());
      if (!same) return setStatus('That passage is no longer in the document.');
      editor.selectText(same.path, 0, 0);
      marks.flash(same.path, 0, same.text.length);
    } catch {
      setStatus('That passage is no longer in the document.');
    }
  };

  const findText = (q: string) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return setFind(null);
    const hits = editor
      .paragraphs()
      .map((p) => ({ path: p.path, text: p.text, start: p.text.toLowerCase().indexOf(needle) }))
      .filter((h) => h.start >= 0)
      .slice(0, 30);
    setFind({ q, hits });
  };

  const plain = (s: string) => s.replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '').trim();
  const act = (kind: 'insert' | 'replace' | 'copy' | 'comment', m: ChatMessage) => {
    const text = plain(m.content);
    try {
      if (kind === 'copy') return void navigator.clipboard?.writeText(text).then(() => setStatus('Copied.'));
      if (kind === 'comment') {
        if (!editor.getSelectedText().trim()) {
          // Comment on the first cited passage when nothing is selected.
          const first = Object.values(m.passages ?? {})[0];
          const now = first && editor.paragraphs().find((x) => x.text === first.text);
          if (!now) return setStatus('Select the text to comment on first.');
          editor.selectText(now.path, 0, now.text.length);
        }
        editor.execute('review.newComment', { text });
        return setStatus('Added as a comment.');
      }
      if (kind === 'insert' && editor.getSelectedText()) editor.execute('caret.right');
      insertText(editor, text);
      setStatus(kind === 'insert' ? 'Inserted at the cursor.' : 'Replaced the selection.');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const render = (m: ChatMessage): ReactNode => {
    if (m.role === 'user' || !m.passages) return m.content;
    const parts = m.content.split(/(\[\d+(?:\s*,\s*\d+)*\])/g);
    return parts.map((part, i) => {
      const nums = part.match(/^\[(\d+(?:\s*,\s*\d+)*)\]$/);
      if (!nums) return part;
      return nums[1].split(/\s*,\s*/).map((n) => {
        const p = m.passages?.[Number(n)];
        return p ? (
          <button key={`${i}-${n}`} type="button" className="wcsp-cite" title={p.text.slice(0, 160)} onClick={() => goTo(p)}>
            {n}
          </button>
        ) : (
          <span key={`${i}-${n}`}>[{n}]</span>
        );
      });
    });
  };

  return (
    <SidePanel
      title="Ask this document"
      icon={<PanelIcon d={ICONS.chat} />}
      onClose={onClose}
      dark={dark}
      sheet={sheet}
      actions={
        messages.length > 0 ? (
          <button
            type="button"
            className="wcsp-btn wcsp-small"
            onClick={() => {
              setMessages([]);
              void Promise.resolve(store?.clear()).catch(() => undefined);
            }}
          >
            Clear
          </button>
        ) : undefined
      }
    >
      <div className="wcsp-bar" role="group" aria-label="What to ask about">
        {(['document', 'section', 'selection'] as ChatScope[]).map((s) => (
          <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}>
            {s === 'document' ? 'Whole document' : s === 'section' ? 'This section' : 'Selection'}
          </button>
        ))}
      </div>
      <div className="wcsp-body" ref={list} aria-live="polite">
        {!messages.length && !busy && (
          <p className="wcsp-note">Answers come from this document and cite the passages they use: click a number to go there. Only the passages that match your question are sent.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'wcsp-msg' : 'wcsp-card'} data-role={m.role}>
            {m.role === 'assistant' ? (
              <>
                <div className="wcsp-msg">{render(m)}</div>
                <div className="wcsp-row" style={{ marginTop: 8 }}>
                  {canWrite && (
                    <>
                      <button type="button" className="wcsp-btn wcsp-small" onClick={() => act('insert', m)}>
                        Insert at cursor
                      </button>
                      <button type="button" className="wcsp-btn wcsp-small" onClick={() => act('replace', m)}>
                        Replace selection
                      </button>
                    </>
                  )}
                  <button type="button" className="wcsp-btn wcsp-small" onClick={() => act('copy', m)}>
                    Copy
                  </button>
                  {canComment && (
                    <button type="button" className="wcsp-btn wcsp-small" onClick={() => act('comment', m)}>
                      Add as comment
                    </button>
                  )}
                </div>
              </>
            ) : (
              m.content
            )}
          </div>
        ))}
        {busy && <div className="wcsp-card wcsp-msg">{streaming ? plain(streaming) : <span className="wcsp-dots">Reading the document</span>}</div>}
        {find && (
          <div className="wcsp-card">
            <h3>
              “{find.q}”: {find.hits.length ? `${find.hits.length} place${find.hits.length > 1 ? 's' : ''}` : 'not found'}
            </h3>
            <div className="wcsp-list">
              {find.hits.map((h, i) => (
                <button
                  key={i}
                  type="button"
                  className="wcsp-item"
                  onClick={() => {
                    editor.selectText(h.path, h.start, h.start + find.q.trim().length);
                    marks.flash(h.path, h.start, h.start + find.q.trim().length);
                  }}
                >
                  <span className="wcsp-dim">{h.text.slice(Math.max(0, h.start - 30), h.start + 60)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {status && <p className="wcsp-dim" role="status">{status}</p>}
      </div>
      <div className="wcsp-foot">
        <div className="wcsp-chips">
          {QUICK.map((q) => (
            <button
              key={q.label}
              type="button"
              className="wcsp-chip"
              onClick={() => {
                if (q.selection && !editor.getSelectedText().trim()) return setStatus('Select some text first.');
                if (q.prompt === 'translate') {
                  setModeText(lang);
                  return setMode('translate');
                }
                void ask(q.prompt, { broad: q.broad });
              }}
            >
              {q.label}
            </button>
          ))}
          <button
            type="button"
            className="wcsp-chip"
            onClick={() => {
              if (draft.trim()) return findText(draft);
              setModeText('');
              setMode('find');
            }}
          >
            Find where it says…
          </button>
        </div>
        {mode && (
          <form
            className="wcsp-row"
            onSubmit={(e) => {
              e.preventDefault();
              const v = modeText.trim();
              if (!v) return;
              setMode('');
              if (mode === 'find') return findText(v);
              setLang(v);
              void ask(`Translate the selection into ${v}.`, { translate: v });
            }}
          >
            <input
              className="wcsp-input wcsp-grow"
              autoFocus
              value={modeText}
              aria-label={mode === 'find' ? 'Words to find' : 'Language'}
              placeholder={mode === 'find' ? 'Find where it says…' : 'Into which language? e.g. French'}
              onChange={(e) => setModeText(e.target.value)}
            />
            <button type="submit" className="wcsp-btn wcsp-primary">
              {mode === 'find' ? 'Find' : 'Translate'}
            </button>
            <button type="button" className="wcsp-btn" onClick={() => setMode('')}>
              Cancel
            </button>
          </form>
        )}
        <div className="wcsp-row">
          <textarea
            className="wcsp-input wcsp-grow"
            rows={2}
            value={draft}
            placeholder="Ask about this document…"
            aria-label="Ask about this document"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void ask(draft);
              }
            }}
          />
          <button type="button" className="wcsp-btn wcsp-primary" disabled={!busy && !draft.trim()} onClick={() => (busy ? abort.current?.abort() : void ask(draft))}>
            {busy ? 'Stop' : 'Ask'}
          </button>
        </div>
        <span className="wcsp-dim">AI can make mistakes, so check the cited passages.</span>
      </div>
    </SidePanel>
  );
}
