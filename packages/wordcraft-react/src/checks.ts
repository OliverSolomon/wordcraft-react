/**
 * Writing checks (an Extra), in the manner of Grammarly: an engine-agnostic contract, three
 * adapters (plain-language rules that run in the browser, LanguageTool on your own server, and
 * the AI through `ai.complete`), readability and tone. The UI lives in `checks-panel.tsx`.
 *
 * Grammarly's Text Editor SDK closed in January 2024, so there is no Grammarly adapter; any
 * other service fits the `Checker` contract.
 */
import { completeText, parseJsonAnswer } from './ai-run.js';
import type { AiSource } from './ai-run.js';

export type IssueCategory = 'correctness' | 'clarity' | 'engagement' | 'delivery';

export interface Issue {
  /** UTF-16 offsets in the paragraph's text. */
  start: number;
  end: number;
  category: IssueCategory;
  message: string;
  replacements: string[];
  /** Which rule found it (used by "Ignore this rule"). */
  ruleId: string;
  /** 0 to 1. */
  confidence?: number;
}

export interface WritingGoals {
  audience?: 'general' | 'expert';
  formality?: 'informal' | 'neutral' | 'formal';
  domain?: 'general' | 'business' | 'academic' | 'plain';
  intent?: 'inform' | 'persuade' | 'report';
}

export interface CheckContext {
  goals: WritingGoals;
  /** BCP 47 language, e.g. `en-GB`. */
  language: string;
  /** Words the person added to their dictionary. */
  dictionary: string[];
  signal: AbortSignal;
}

export interface Checker {
  /** Shown in the panel (e.g. "LanguageTool"). */
  name: string;
  /** Sends text off the device (the panel says so). */
  remote?: boolean;
  check(text: string, ctx: CheckContext): Promise<Issue[]> | Issue[];
}

export const CATEGORY_COLOR: Record<IssueCategory, string> = { correctness: '#d93025', clarity: '#1a73e8', engagement: '#188038', delivery: '#9334e6' };
export const CATEGORY_LABEL: Record<IssueCategory, string> = { correctness: 'Correctness', clarity: 'Clarity', engagement: 'Engagement', delivery: 'Delivery' };

// ----- built-in rules (nothing leaves the browser) ---------------------------------------------

const WORDY: Array<[RegExp, string, string]> = [
  [/\bin order to\b/gi, 'to', 'in-order-to'],
  [/\bdue to the fact that\b/gi, 'because', 'due-to-the-fact'],
  [/\bat this point in time\b/gi, 'now', 'at-this-point'],
  [/\bin the event that\b/gi, 'if', 'in-the-event'],
  [/\bfor the purpose of\b/gi, 'to', 'for-the-purpose'],
  [/\bwith regard to\b/gi, 'about', 'with-regard'],
  [/\bin spite of the fact that\b/gi, 'although', 'in-spite'],
  [/\ba large number of\b/gi, 'many', 'large-number'],
  [/\bprior to\b/gi, 'before', 'prior-to'],
  [/\bsubsequent to\b/gi, 'after', 'subsequent-to'],
  [/\bit is important to note that\b/gi, '', 'important-to-note'],
];
const PLAIN: Array<[RegExp, string]> = [
  [/\butili[sz]e\b/gi, 'use'],
  [/\butili[sz]ation\b/gi, 'use'],
  [/\bcommence\b/gi, 'start'],
  [/\bfacilitate\b/gi, 'help'],
  [/\bendeavou?r\b/gi, 'try'],
  [/\bascertain\b/gi, 'find out'],
  [/\bterminate\b/gi, 'end'],
  [/\bin lieu of\b/gi, 'instead of'],
  [/\bnotwithstanding\b/gi, 'despite'],
  [/\bleverage\b/gi, 'use'],
  [/\bsynergy\b/gi, 'cooperation'],
  [/\bstakeholders?\b/gi, 'people involved'],
];
const WEAK = /\b(very|really|quite|basically|actually|just|literally|totally)\b/gi;
const PASSIVE = /\b(am|is|are|was|were|be|been|being)\s+(\w+ed|\w+en)\b/gi;
const HEDGES = /\b(maybe|perhaps|might|i think|i guess|sort of|kind of|possibly|probably|somewhat)\b/gi;

/** Sentences of a paragraph with their offsets. */
export function sentencesOf(text: string): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  const re = /[^.!?]+[.!?]*["')\]]*\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0].trim()) {
      if (re.lastIndex === m.index) re.lastIndex++;
      continue;
    }
    out.push({ text: m[0].trimEnd(), start: m.index });
  }
  return out;
}

/**
 * Plain-language rules in the browser: long sentences, wordy phrases, jargon, passive voice,
 * repeated words, filler, double spaces. Private by design: nothing is sent anywhere.
 */
export function plainLanguageChecker(): Checker {
  return {
    name: 'Plain language',
    check(text, ctx) {
      const out: Issue[] = [];
      const add = (start: number, end: number, category: IssueCategory, message: string, ruleId: string, replacements: string[] = [], confidence = 0.7) => out.push({ start, end, category, message, ruleId, replacements, confidence });
      const plain = ctx.goals.domain === 'plain' || ctx.goals.audience === 'general';
      const maxWords = plain ? 22 : ctx.goals.domain === 'academic' ? 35 : 28;
      for (const s of sentencesOf(text)) {
        const words = s.text.split(/\s+/).filter(Boolean).length;
        if (words > maxWords) add(s.start, s.start + s.text.length, 'clarity', `This sentence has ${words} words. Sentences under ${maxWords} words are easier to read; try splitting it.`, 'long-sentence', [], 0.6);
      }
      for (const [re, rep, id] of WORDY) for (const m of text.matchAll(re)) add(m.index ?? 0, (m.index ?? 0) + m[0].length, 'clarity', `“${m[0]}” is wordy.`, `wordy:${id}`, rep ? [rep] : [''], 0.8);
      if (plain || ctx.goals.formality !== 'formal')
        for (const [re, rep] of PLAIN) for (const m of text.matchAll(re)) add(m.index ?? 0, (m.index ?? 0) + m[0].length, 'clarity', `“${m[0]}” has a plainer word.`, `plain:${m[0].toLowerCase()}`, [matchCase(m[0], rep)], 0.6);
      for (const m of text.matchAll(PASSIVE)) add(m.index ?? 0, (m.index ?? 0) + m[0].length, 'clarity', 'Passive voice: saying who does what is often clearer.', 'passive', [], 0.4);
      for (const m of text.matchAll(WEAK)) add(m.index ?? 0, (m.index ?? 0) + m[0].length, 'engagement', `“${m[0]}” rarely adds meaning.`, `filler:${m[0].toLowerCase()}`, [''], 0.5);
      if (ctx.goals.intent === 'persuade' || ctx.goals.formality === 'formal')
        for (const m of text.matchAll(HEDGES)) add(m.index ?? 0, (m.index ?? 0) + m[0].length, 'delivery', `“${m[0]}” sounds unsure.`, `hedge:${m[0].toLowerCase()}`, [], 0.5);
      for (const m of text.matchAll(/\b(\w+)\s+\1\b/gi)) if (!ctx.dictionary.includes(m[1].toLowerCase())) add(m.index ?? 0, (m.index ?? 0) + m[0].length, 'correctness', `“${m[1]}” is repeated.`, 'repeated-word', [m[1]], 0.9);
      for (const m of text.matchAll(/ {2,}/g)) add(m.index ?? 0, (m.index ?? 0) + m[0].length, 'correctness', 'Two spaces in a row.', 'double-space', [' '], 0.9);
      if (ctx.goals.formality === 'formal') for (const m of text.matchAll(/!/g)) add(m.index ?? 0, (m.index ?? 0) + 1, 'delivery', 'Exclamation marks read as informal.', 'exclamation', ['.'], 0.5);
      return out;
    },
  };
}

function matchCase(src: string, rep: string): string {
  return src[0] === src[0]?.toUpperCase() ? rep[0].toUpperCase() + rep.slice(1) : rep;
}

// ----- LanguageTool ---------------------------------------------------------------------------

export interface LanguageToolOptions {
  /** Your server, e.g. `https://lt.example.org` (the adapter posts to `/v2/check`). */
  url: string;
  /** Default `auto`, or the editor's language. */
  language?: string;
  /** `picky` turns on more style rules. */
  level?: 'default' | 'picky';
  /** Extra form fields (an API key and username for a hosted plan, say). */
  extra?: Record<string, string>;
}

/** LanguageTool (open source, self-hostable): `POST /v2/check`. */
export function languageTool(options: LanguageToolOptions): Checker {
  const base = options.url.replace(/\/+$/, '').replace(/\/v2\/check$/, '');
  return {
    name: 'LanguageTool',
    remote: true,
    async check(text, ctx) {
      const body = new URLSearchParams({ text, language: options.language ?? ctx.language ?? 'auto', level: options.level ?? (ctx.goals.formality === 'formal' ? 'picky' : 'default'), ...options.extra });
      const res = await fetch(`${base}/v2/check`, { method: 'POST', body, signal: ctx.signal, headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`LanguageTool: ${res.status}`);
      const json = (await res.json()) as {
        matches?: Array<{ offset: number; length: number; message: string; shortMessage?: string; replacements?: Array<{ value: string }>; rule?: { id?: string; issueType?: string; category?: { id?: string } } }>;
      };
      return (json.matches ?? []).map((m) => {
        const type = m.rule?.issueType ?? '';
        const cat = m.rule?.category?.id ?? '';
        const category: IssueCategory = /misspelling|grammar|typographical|duplication|whitespace/.test(type) || /TYPOS|GRAMMAR|PUNCTUATION|CASING|CONFUSED_WORDS/.test(cat) ? 'correctness' : /style|register/.test(type) || /STYLE|REDUNDANCY/.test(cat) ? 'clarity' : /locale-violation/.test(type) ? 'delivery' : 'engagement';
        return { start: m.offset, end: m.offset + m.length, category, message: m.message, replacements: (m.replacements ?? []).slice(0, 5).map((r) => r.value), ruleId: m.rule?.id ?? 'languagetool', confidence: category === 'correctness' ? 0.85 : 0.6 };
      });
    },
  };
}

// ----- the AI ---------------------------------------------------------------------------------

/** Clarity, tone and rewrite suggestions through the editor's AI (`ai.complete`, a provider or the person's key). */
export function llmChecker(source: AiSource | ((request: Parameters<NonNullable<AiSource['complete']>>[0]) => Promise<string> | AsyncIterable<string>)): Checker {
  const ai: AiSource = typeof source === 'function' ? { complete: source, allowUserKey: false } : source;
  return {
    name: 'AI',
    remote: true,
    async check(text, ctx) {
      if (text.trim().split(/\s+/).length < 4) return [];
      const answer = await completeText(ai, { action: 'check', selection: text, goals: ctx.goals as Record<string, string>, signal: ctx.signal });
      const items = parseJsonAnswer<Array<{ text?: string; category?: string; message?: string; replacements?: unknown[]; confidence?: number }>>(answer) ?? [];
      const out: Issue[] = [];
      for (const it of Array.isArray(items) ? items.slice(0, 8) : []) {
        const needle = String(it.text ?? '');
        const at = needle ? text.indexOf(needle) : -1;
        if (at < 0) continue;
        const category = (['correctness', 'clarity', 'engagement', 'delivery'] as IssueCategory[]).includes(it.category as IssueCategory) ? (it.category as IssueCategory) : 'clarity';
        out.push({
          start: at,
          end: at + needle.length,
          category,
          message: String(it.message ?? 'Suggestion').slice(0, 300),
          replacements: (Array.isArray(it.replacements) ? it.replacements : []).map(String).slice(0, 3),
          ruleId: `ai:${category}`,
          confidence: typeof it.confidence === 'number' ? it.confidence : 0.6,
        });
      }
      return out;
    },
  };
}

// ----- readability and tone -------------------------------------------------------------------

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

export interface Readability {
  words: number;
  sentences: number;
  /** Flesch reading ease (higher is easier; 60 to 70 is plain English). */
  ease: number;
  /** Flesch-Kincaid grade level. */
  grade: number;
  avgSentence: number;
  readingMinutes: number;
  /** A short read-out such as "confident, formal". */
  tone: string[];
}

export function readability(text: string): Readability {
  const words = text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
  const sentenceCount = Math.max(1, text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim().split(/\s+/).length > 1).length);
  const syl = words.reduce((a, w) => a + syllables(w), 0);
  const wc = Math.max(1, words.length);
  const ease = Math.round(206.835 - 1.015 * (wc / sentenceCount) - 84.6 * (syl / wc));
  const grade = Math.max(0, Math.round((0.39 * (wc / sentenceCount) + 11.8 * (syl / wc) - 15.59) * 10) / 10);
  const lower = text.toLowerCase();
  const per = (re: RegExp) => ((lower.match(re) ?? []).length / wc) * 100;
  const tone: string[] = [];
  const hedges = per(HEDGES), contractions = per(/\b\w+'(s|re|ve|ll|d|t)\b/g), exclaims = per(/!/g);
  const formal = per(/\b(therefore|however|furthermore|moreover|consequently|accordingly|whereas|thus)\b/g);
  tone.push(hedges > 1.2 ? 'tentative' : 'confident');
  tone.push(contractions > 1.5 || exclaims > 0.8 ? 'informal' : formal > 0.4 || contractions === 0 ? 'formal' : 'neutral');
  if (per(/\b(we|our|us|you|your)\b/g) > 3) tone.push('personal');
  if (per(/\b(must|shall|required|ensure)\b/g) > 1) tone.push('directive');
  return { words: words.length, sentences: sentenceCount, ease: Math.max(0, Math.min(100, ease)), grade, avgSentence: Math.round((wc / sentenceCount) * 10) / 10, readingMinutes: Math.max(words.length ? 1 : 0, Math.round(words.length / 238)), tone };
}

export function easeLabel(ease: number): string {
  return ease >= 80 ? 'Very easy' : ease >= 60 ? 'Plain English' : ease >= 50 ? 'Fairly hard' : ease >= 30 ? 'Hard' : 'Very hard';
}

/** A 0 to 100 score from issues per 100 words, weighted by category. */
export function writingScore(issues: Issue[], words: number): number {
  const w: Record<IssueCategory, number> = { correctness: 4, clarity: 2, engagement: 1, delivery: 1.5 };
  const penalty = issues.reduce((a, i) => a + w[i.category] * (i.confidence ?? 0.7), 0);
  return Math.max(0, Math.min(100, Math.round(100 - (penalty / Math.max(words, 50)) * 100 * 1.6)));
}
