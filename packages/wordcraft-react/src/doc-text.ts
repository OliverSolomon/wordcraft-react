/**
 * The document as the panels read it: paragraphs joined into one text with a map back to each
 * paragraph's path, sections by heading, and a way to merge several features' marks into one
 * `setMarks` call.
 */
import type { DocParagraph, TextMark, WordcraftEditor } from './core.js';

export interface DocIndex {
  paragraphs: DocParagraph[];
  /** Every paragraph's text joined with `\n`. */
  text: string;
  /** Where each paragraph starts in `text`. */
  starts: number[];
}

export function indexDocument(editor: WordcraftEditor): DocIndex {
  const paragraphs = editor.paragraphs();
  const starts: number[] = [];
  let at = 0;
  for (const p of paragraphs) {
    starts.push(at);
    at += p.text.length + 1;
  }
  return { paragraphs, text: paragraphs.map((p) => p.text).join('\n'), starts };
}

/** A range of the joined text, cut at paragraph ends, as paragraph ranges. */
export function rangesFor(index: DocIndex, start: number, end: number): Array<{ path: number[]; start: number; end: number; para: number }> {
  const out: Array<{ path: number[]; start: number; end: number; para: number }> = [];
  index.paragraphs.forEach((p, i) => {
    const s = index.starts[i];
    const e = s + p.text.length;
    const a = Math.max(start, s), b = Math.min(end, e);
    if (b > a) out.push({ path: p.path, start: a - s, end: b - s, para: i });
  });
  return out;
}

export interface Section {
  /** The heading paragraph's index, or -1 for text before the first heading. */
  heading: number;
  title: string;
  level: number;
  /** Paragraph indices in the section (the heading included). */
  paras: number[];
}

/** Split into sections at each heading (any level). */
export function sections(paragraphs: DocParagraph[]): Section[] {
  const out: Section[] = [];
  let cur: Section = { heading: -1, title: 'Start of the document', level: 0, paras: [] };
  paragraphs.forEach((p, i) => {
    if (p.heading > 0 && p.text.trim()) {
      if (cur.paras.length) out.push(cur);
      cur = { heading: i, title: p.text.trim(), level: p.heading, paras: [i] };
    } else cur.paras.push(i);
  });
  if (cur.paras.length) out.push(cur);
  return out;
}

export const samePath = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** A short stable hash of a string (FNV-1a), for caching per paragraph. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Merge marks from several features (writing checks, originality, a citation flash) into one list. */
export class MarkLayers {
  private layers = new Map<string, TextMark[]>();
  constructor(private editor: () => WordcraftEditor | null) {}
  set(layer: string, marks: TextMark[]): void {
    if (!marks.length) this.layers.delete(layer);
    else this.layers.set(layer, marks);
    const ed = this.editor();
    if (!ed || ed.destroyed) return;
    try {
      ed.setMarks([...this.layers.values()].flat().slice(0, 5000));
    } catch {
      // marks are an overlay; never let them break editing
    }
  }
  clear(layer: string): void {
    this.set(layer, []);
  }
  /** Highlight a paragraph range for a moment (a citation chip, a search hit). */
  flash(path: number[], start: number, end: number, color = '#fbbc04', ms = 2200): void {
    this.set('flash', [{ id: 'flash', path, start, end, color, style: 'highlight' }]);
    setTimeout(() => this.clear('flash'), ms);
  }
}

/** Words, characters, reading time and pages (at about 500 words a page). */
export function countText(text: string): { words: number; characters: number; charactersNoSpaces: number; readingMinutes: number; pages: number } {
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
  return {
    words,
    characters: text.replace(/\n/g, '').length,
    charactersNoSpaces: text.replace(/\s/g, '').length,
    readingMinutes: Math.max(words ? 1 : 0, Math.round(words / 238)),
    pages: Math.max(1, Math.ceil(words / 500)),
  };
}
