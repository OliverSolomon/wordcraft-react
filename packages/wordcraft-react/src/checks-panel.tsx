'use client';

/**
 * The writing checks UI (an Extra): coloured underlines by category, a card at the caret with the
 * explanation and one-click fixes, and a panel with every issue, a score, readability, tone and
 * the writing goals. Paragraphs are checked after the person pauses, one at a time, cached by
 * their text, and never in Viewing mode or in a document marked sensitive.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SelectionInfo, TextMark, WordcraftEditor } from './core.js';
import { CATEGORY_COLOR, CATEGORY_LABEL, easeLabel, plainLanguageChecker, readability, writingScore } from './checks.js';
import type { Checker, Issue, IssueCategory, WritingGoals } from './checks.js';
import { hashText } from './doc-text.js';
import type { MarkLayers } from './doc-text.js';
import { ICONS, PANEL_CSS, PanelIcon, SidePanel } from './panel.js';

export interface WritingChecksOptions {
  /** The engines to run. Default: the built-in plain-language rules only (nothing leaves the browser). */
  checkers?: Checker[];
  /** Starting goals; people can change them in the panel. */
  goals?: WritingGoals;
  /** BCP 47 language for the checkers. Default: the browser's. */
  language?: string;
  /** Wait this long after the last edit before checking (ms). Default 1200. */
  debounce?: number;
  /** Words to treat as correct (your organisation's names, say). */
  dictionary?: string[];
  /** Called when someone adds a word to their dictionary (to keep it on your server). */
  onDictionaryAdd?: (word: string) => void;
  /** Underline as people type (default true); false checks only from the panel. */
  live?: boolean;
}

export interface FoundIssue extends Issue {
  key: string;
  path: number[];
  para: number;
  /** The text the issue covers. */
  text: string;
  checker: string;
}

const LS_RULES = 'wordcraft.checks.ignoredRules';
const LS_WORDS = 'wordcraft.checks.dictionary';
const LS_GOALS = 'wordcraft.checks.goals';
const readList = (k: string): string[] => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? '[]') as string[];
  } catch {
    return [];
  }
};
const writeList = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage blocked */
  }
};

export function useWritingChecks(editor: WordcraftEditor | null, options: WritingChecksOptions | null, enabled: boolean, marks: MarkLayers) {
  const checkers = useMemo(() => options?.checkers ?? [plainLanguageChecker()], [options?.checkers]);
  const [goals, setGoalsState] = useState<WritingGoals>(() => options?.goals ?? {});
  const [issues, setIssues] = useState<FoundIssue[]>([]);
  const [running, setRunning] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [words, setWords] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [text, setText] = useState('');
  const cache = useRef(new Map<string, Array<Issue & { checker: string }>>());
  const lastRev = useRef(-1);
  const changedAt = useRef(0);
  const checkedRev = useRef(-2);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    setIgnored(readList(LS_RULES));
    setWords(readList(LS_WORDS));
    try {
      const g = JSON.parse(localStorage.getItem(LS_GOALS) ?? 'null') as WritingGoals | null;
      if (g && !options?.goals) setGoalsState(g);
    } catch {
      /* ignore */
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setGoals = (g: WritingGoals) => {
    setGoalsState(g);
    writeList(LS_GOALS, g);
    cache.current.clear();
    checkedRev.current = -2;
  };

  const run = useCallback(async () => {
    if (!editor || editor.destroyed || !enabled) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    const rev = editor.rev();
    const paras = editor.paragraphs();
    setText(paras.map((p) => p.text).join('\n'));
    const dictionary = [...(options?.dictionary ?? []), ...words].map((w) => w.toLowerCase());
    const ctx = { goals, language: options?.language ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US'), dictionary, signal: ctl.signal };
    const found: FoundIssue[] = [];
    const errs = new Set<string>();
    setRunning(true);
    const goalKey = JSON.stringify(goals);
    for (let i = 0; i < paras.length; i++) {
      const p = paras[i];
      if (ctl.signal.aborted) return;
      if (p.text.trim().split(/\s+/).length < 2) continue;
      const key = `${hashText(p.text)}:${goalKey}`;
      let list = cache.current.get(key);
      if (!list) {
        list = [];
        for (const c of checkers) {
          try {
            const got = await c.check(p.text, ctx);
            list.push(...got.filter((x) => x.end > x.start && x.end <= p.text.length).map((x) => ({ ...x, checker: c.name })));
          } catch (e) {
            if (ctl.signal.aborted) return;
            errs.add(`${c.name}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (!errs.size) cache.current.set(key, list);
      }
      for (const x of list) {
        const covered = p.text.slice(x.start, x.end);
        if (ignored.includes(x.ruleId)) continue;
        if (dictionary.includes(covered.toLowerCase())) continue;
        const k = `${hashText(p.text)}:${x.ruleId}:${x.start}`;
        if (dismissed.includes(k)) continue;
        found.push({ ...x, key: k, path: p.path, para: i, text: covered });
      }
    }
    if (ctl.signal.aborted) return;
    // One issue per range: the most confident wins.
    found.sort((a, b) => a.para - b.para || a.start - b.start || (b.confidence ?? 0) - (a.confidence ?? 0));
    const dedup = found.filter((x, i) => !found.slice(0, i).some((y) => y.para === x.para && y.start < x.end && x.start < y.end && y.category === x.category));
    checkedRev.current = rev;
    setIssues(dedup);
    setErrors([...errs]);
    setRunning(false);
  }, [editor, enabled, checkers, goals, ignored, words, dismissed, options?.dictionary, options?.language]);

  // Check after a pause in editing (polling the revision; never on each keystroke).
  useEffect(() => {
    if (!editor || !enabled) return;
    const wait = options?.debounce ?? 1200;
    const tick = () => {
      if (editor.destroyed) return;
      const rev = editor.rev();
      if (rev !== lastRev.current) {
        lastRev.current = rev;
        changedAt.current = Date.now();
        return;
      }
      if (rev !== checkedRev.current && Date.now() - changedAt.current >= wait) void run();
    };
    const t = window.setInterval(tick, 400);
    return () => {
      window.clearInterval(t);
      abort.current?.abort();
    };
  }, [editor, enabled, run, options?.debounce]);

  // A setting changed (rules, words, dismissals): recheck from the cache.
  useEffect(() => {
    checkedRev.current = -2;
  }, [ignored, words, dismissed]);

  // Underlines.
  useEffect(() => {
    if (!enabled || options?.live === false) {
      marks.clear('checks');
      return;
    }
    const list: TextMark[] = issues.map((x) => ({ id: `check:${x.key}`, path: x.path, start: x.start, end: x.end, color: CATEGORY_COLOR[x.category], style: 'squiggle' }));
    marks.set('checks', list);
  }, [issues, enabled, marks, options?.live]);
  useEffect(() => () => marks.clear('checks'), [marks]);

  const dismiss = (x: FoundIssue) => setDismissed((d) => [...d, x.key]);
  const ignoreRule = (x: FoundIssue) =>
    setIgnored((r) => {
      const next = [...new Set([...r, x.ruleId])];
      writeList(LS_RULES, next);
      return next;
    });
  const addWord = (x: FoundIssue) => {
    const w = x.text.trim();
    if (!w) return;
    setWords((list) => {
      const next = [...new Set([...list, w])];
      writeList(LS_WORDS, next);
      return next;
    });
    options?.onDictionaryAdd?.(w);
  };
  const apply = (x: FoundIssue, replacement: string) => {
    if (!editor || editor.destroyed) return;
    // The paragraph may have changed since the check: only apply when the text still matches.
    const p = editor.paragraphs().find((q) => q.path.join() === x.path.join());
    if (!p || p.text.slice(x.start, x.end) !== x.text) {
      checkedRev.current = -2;
      return;
    }
    editor.selectText(x.path, x.start, x.end);
    if (replacement) editor.execute('text.insert', { text: replacement });
    else editor.execute('text.delete');
    setIssues((list) => list.filter((y) => y.key !== x.key));
  };
  const resetIgnored = () => {
    setIgnored([]);
    writeList(LS_RULES, []);
  };

  return { issues, running, errors, goals, setGoals, dismiss, ignoreRule, addWord, apply, recheck: () => ((checkedRev.current = -2), void run()), text, ignored, resetIgnored, checkers };
}

export type WritingChecks = ReturnType<typeof useWritingChecks>;

function Fixes({ x, checks, canWrite, compact }: { x: FoundIssue; checks: WritingChecks; canWrite: boolean; compact?: boolean }) {
  return (
    <div className="wcsp-row" style={{ marginTop: 6 }}>
      {canWrite &&
        x.replacements.slice(0, compact ? 2 : 3).map((r, i) => (
          <button key={i} type="button" className="wcsp-btn wcsp-small wcsp-primary" onClick={() => checks.apply(x, r)}>
            {r === '' ? 'Remove' : r}
          </button>
        ))}
      <button type="button" className="wcsp-btn wcsp-small" onClick={() => checks.dismiss(x)}>
        Dismiss
      </button>
      <button type="button" className="wcsp-btn wcsp-small" onClick={() => checks.ignoreRule(x)}>
        Ignore this rule
      </button>
      {x.category === 'correctness' && /^\S+$/.test(x.text) && (
        <button type="button" className="wcsp-btn wcsp-small" onClick={() => checks.addWord(x)}>
          Add to dictionary
        </button>
      )}
    </div>
  );
}

/** The card for the issue under the caret, floated beside it. */
export function IssueCard({ editor, checks, canWrite, dark }: { editor: WordcraftEditor; checks: WritingChecks; canWrite: boolean; dark?: boolean }) {
  const [info, setInfo] = useState<SelectionInfo | null>(null);
  useEffect(() => editor.onSelection(setInfo), [editor]);
  const id = info?.marks?.find((m) => m.startsWith('check:'));
  const x = id ? checks.issues.find((i) => `check:${i.key}` === id) : undefined;
  if (!x || !info?.rect || info.scrolling) return null;
  const top = info.rect.y + info.rect.height + 8;
  const left = Math.max(8, Math.min(info.rect.x - 20, (editor.canvas.clientWidth || 800) - 340));
  return (
    <div className="wcsp wcck-card" data-theme={dark ? 'dark' : 'light'} style={{ top, left }} role="dialog" aria-label="Writing suggestion" onKeyDown={(e) => e.stopPropagation()}>
      <style>{PANEL_CSS + CARD_CSS}</style>
      <div className="wcsp-row">
        <span className="wcsp-dot" style={{ background: CATEGORY_COLOR[x.category] }} />
        <strong style={{ fontSize: 12 }}>{CATEGORY_LABEL[x.category]}</strong>
        <span className="wcsp-dim">{x.checker}</span>
      </div>
      <p style={{ margin: '6px 0 0' }}>{x.message}</p>
      <Fixes x={x} checks={checks} canWrite={canWrite} compact />
    </div>
  );
}

const CARD_CSS = `.wcsp.wcck-card{position:absolute;right:auto;bottom:auto;width:min(330px,calc(100% - 16px));height:auto;padding:10px 12px;border:1px solid var(--line);border-radius:12px;z-index:7;animation:none}`;

export function ChecksPanel({ editor, checks, canWrite, sensitive, onClose, dark, sheet }: { editor: WordcraftEditor; checks: WritingChecks; canWrite: boolean; sensitive?: boolean; onClose: () => void; dark?: boolean; sheet?: boolean }) {
  const [open, setOpen] = useState<IssueCategory | 'all'>('all');
  const stats = useMemo(() => readability(checks.text), [checks.text]);
  const score = writingScore(checks.issues, stats.words);
  const by = (c: IssueCategory) => checks.issues.filter((x) => x.category === c);
  const shown = open === 'all' ? checks.issues : by(open);
  const remote = checks.checkers.filter((c) => c.remote).map((c) => c.name);
  const g = checks.goals;
  const sel = (k: keyof WritingGoals, v: string) => checks.setGoals({ ...g, [k]: v || undefined });
  return (
    <SidePanel title="Writing checks" icon={<PanelIcon d={ICONS.check} />} onClose={onClose} dark={dark} sheet={sheet}>
      {sensitive ? (
        <div className="wcsp-body">
          <p className="wcsp-note">This document is marked sensitive, so writing checks are off and nothing is sent.</p>
        </div>
      ) : (
        <>
          <div className="wcsp-body">
            <div className="wcsp-card wcsp-row">
              <span className="wcsp-score" aria-label={`Score ${score} of 100`}>
                {score}
              </span>
              <div className="wcsp-grow">
                <strong>{checks.running ? 'Checking…' : checks.issues.length ? `${checks.issues.length} suggestion${checks.issues.length > 1 ? 's' : ''}` : 'Looking good'}</strong>
                <div className="wcsp-dim">
                  {easeLabel(stats.ease)} (reading ease {stats.ease}, grade {stats.grade}) · {stats.avgSentence} words a sentence · {stats.readingMinutes} min read
                </div>
                <div className="wcsp-dim">Tone: {stats.tone.join(', ')}</div>
              </div>
            </div>
            <div className="wcsp-bar" style={{ padding: 0, border: 0 }}>
              <button type="button" aria-pressed={open === 'all'} onClick={() => setOpen('all')}>
                All {checks.issues.length}
              </button>
              {(Object.keys(CATEGORY_LABEL) as IssueCategory[]).map((c) => (
                <button key={c} type="button" aria-pressed={open === c} onClick={() => setOpen(c)}>
                  <span className="wcsp-dot" style={{ background: CATEGORY_COLOR[c], marginRight: 6 }} />
                  {CATEGORY_LABEL[c]} {by(c).length}
                </button>
              ))}
            </div>
            {shown.map((x) => (
              <div key={x.key} className="wcsp-card">
                <button type="button" className="wcsp-item" style={{ padding: 0 }} onClick={() => editor.selectText(x.path, x.start, x.end)}>
                  <span className="wcsp-dot" style={{ background: CATEGORY_COLOR[x.category] }} />
                  <span className="wcsp-grow" style={{ textDecoration: `underline wavy ${CATEGORY_COLOR[x.category]}` }}>
                    {x.text.length > 60 ? `${x.text.slice(0, 60)}…` : x.text}
                  </span>
                </button>
                <p className="wcsp-dim">{x.message}</p>
                <Fixes x={x} checks={checks} canWrite={canWrite} />
              </div>
            ))}
            {!shown.length && !checks.running && <p className="wcsp-empty">Nothing to suggest here.</p>}
            {checks.errors.map((e) => (
              <p key={e} className="wcsp-note" role="status">
                {e}
              </p>
            ))}
          </div>
          <div className="wcsp-foot">
            <div className="wcsp-row">
              <label className="wcsp-field wcsp-grow">
                Audience
                <select value={g.audience ?? ''} onChange={(e) => sel('audience', e.target.value)}>
                  <option value="">General</option>
                  <option value="expert">Expert</option>
                </select>
              </label>
              <label className="wcsp-field wcsp-grow">
                Formality
                <select value={g.formality ?? ''} onChange={(e) => sel('formality', e.target.value)}>
                  <option value="">Neutral</option>
                  <option value="informal">Informal</option>
                  <option value="formal">Formal</option>
                </select>
              </label>
            </div>
            <div className="wcsp-row">
              <label className="wcsp-field wcsp-grow">
                Domain
                <select value={g.domain ?? ''} onChange={(e) => sel('domain', e.target.value)}>
                  <option value="">General</option>
                  <option value="business">Business</option>
                  <option value="academic">Academic</option>
                  <option value="plain">Plain language (public information)</option>
                </select>
              </label>
              <label className="wcsp-field wcsp-grow">
                Intent
                <select value={g.intent ?? ''} onChange={(e) => sel('intent', e.target.value)}>
                  <option value="">Inform</option>
                  <option value="persuade">Persuade</option>
                  <option value="report">Report</option>
                </select>
              </label>
            </div>
            <span className="wcsp-dim">
              {remote.length ? `Each paragraph is sent to ${remote.join(' and ')} when you pause. ` : 'Checked in this browser: nothing is sent. '}
              {checks.ignored.length > 0 && (
                <button type="button" className="wcsp-btn wcsp-small" onClick={checks.resetIgnored}>
                  Restore {checks.ignored.length} ignored rule{checks.ignored.length > 1 ? 's' : ''}
                </button>
              )}
            </span>
          </div>
        </>
      )}
    </SidePanel>
  );
}
