/**
 * AI output as document structure (an Extra). The model is asked for a small JSON block list and
 * Markdown is the fallback; either way the answer is parsed, validated, capped and repaired into
 * `Block[]`, and the package writes the HTML for it itself (every string escaped, no model HTML
 * ever reaches the document). Tables, headings, lists, quotes, code and rules go in through
 * WordCraft's HTML import; charts and equations become native Word objects; diagrams, QR codes
 * and images become pictures with alt text.
 */
import type { WordcraftEditor } from './core.js';
import type { Palette } from './ai-studio.js';
import { shade, withHash } from './theme.js';

export type ChartType = 'column' | 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter' | 'stacked';

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered?: boolean; items: ListItem[] }
  | { type: 'checklist'; items: Array<{ text: string; done?: boolean }> }
  | { type: 'table'; columns: string[]; rows: string[][]; align?: Array<'left' | 'center' | 'right'>; caption?: string; total?: boolean }
  | { type: 'quote'; text: string; cite?: string }
  | { type: 'callout'; variant?: 'note' | 'tip' | 'warning'; title?: string; text: string }
  | { type: 'code'; text: string; language?: string }
  | { type: 'rule' }
  | { type: 'pageBreak' }
  | { type: 'toc' }
  | { type: 'diagram'; source: string; alt?: string; title?: string }
  | { type: 'chart'; chart: ChartType; title?: string; categories: string[]; series: Array<{ name: string; values: Array<number | null> }>; xTitle?: string; yTitle?: string }
  | { type: 'equation'; latex: string; display?: boolean }
  | { type: 'qr'; text: string; alt?: string }
  | { type: 'image'; src: string; alt: string; prompt?: string; width?: number }
  | { type: 'signature'; name?: string; title?: string }
  | { type: 'date' };

export interface ListItem {
  text: string;
  children?: ListItem[];
  ordered?: boolean;
}

/** Limits on what the model may produce. */
export const BLOCK_LIMITS = { blocks: 200, chars: 60_000, rows: 200, cols: 12, cell: 500, depth: 4, items: 200, diagram: 8_000, series: 8, points: 200 };

const TYPES = new Set(['heading', 'paragraph', 'list', 'checklist', 'table', 'quote', 'callout', 'code', 'rule', 'pageBreak', 'toc', 'diagram', 'chart', 'equation', 'qr', 'image', 'signature', 'date']);

// ----- parsing --------------------------------------------------------------------------------

/** Read a model's answer: a JSON block list (fenced or bare), else Markdown. Always returns valid blocks. */
export function parseBlocks(answer: string): Block[] {
  const text = answer.slice(0, BLOCK_LIMITS.chars);
  const json = findJson(text);
  if (json) {
    const blocks = sanitizeBlocks(json);
    if (blocks.length) return blocks;
  }
  return markdownToBlocks(text);
}

function findJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const candidates = [fence?.[1], text.trim()];
  for (const c of candidates) {
    if (!c) continue;
    const t = c.trim();
    if (!(t.startsWith('[') || t.startsWith('{'))) continue;
    try {
      const v = JSON.parse(t) as unknown;
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object' && Array.isArray((v as { blocks?: unknown }).blocks)) return (v as { blocks: unknown[] }).blocks;
      if (v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string') return [v];
    } catch {
      // not JSON
    }
  }
  return null;
}

const str = (v: unknown, max = 4000): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[,\s$€£%]/g, ''));
    return Number.isFinite(n) && v.trim() !== '' ? n : null;
  }
  return null;
};

/** Only `data:image/png|jpeg|gif|webp` URIs: a remote URL would be fetched, so it is dropped. */
export function safeImageSrc(src: unknown): string | null {
  const s = str(src, 15_000_000);
  return /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/.test(s) ? s : null;
}

function sanitizeItems(v: unknown, depth: number, budget: { n: number }): ListItem[] {
  if (!Array.isArray(v) || depth > BLOCK_LIMITS.depth) return [];
  const out: ListItem[] = [];
  for (const it of v) {
    if (budget.n-- <= 0) break;
    if (typeof it === 'string') out.push({ text: str(it) });
    else if (it && typeof it === 'object') {
      const o = it as Record<string, unknown>;
      const children = sanitizeItems(o.children ?? o.items, depth + 1, budget);
      out.push({ text: str(o.text), ...(children.length ? { children } : {}), ...(o.ordered ? { ordered: true } : {}) });
    }
  }
  return out;
}

/** Validate and repair untrusted blocks: unknown types and fields are dropped, sizes are capped. */
export function sanitizeBlocks(input: unknown): Block[] {
  if (!Array.isArray(input)) return [];
  const out: Block[] = [];
  for (const raw of input.slice(0, BLOCK_LIMITS.blocks)) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const type = String(o.type ?? '');
    if (!TYPES.has(type)) {
      if (typeof o.text === 'string') out.push({ type: 'paragraph', text: str(o.text) });
      continue;
    }
    switch (type) {
      case 'heading': {
        const level = Math.max(1, Math.min(4, Math.round(num(o.level) ?? 1))) as 1 | 2 | 3 | 4;
        out.push({ type, level, text: str(o.text, 300) });
        break;
      }
      case 'paragraph':
        out.push({ type, text: str(o.text) });
        break;
      case 'list':
        out.push({ type, ordered: !!o.ordered, items: sanitizeItems(o.items, 1, { n: BLOCK_LIMITS.items }) });
        break;
      case 'checklist':
        out.push({
          type,
          items: (Array.isArray(o.items) ? o.items : []).slice(0, BLOCK_LIMITS.items).map((it) => (typeof it === 'string' ? { text: str(it) } : { text: str((it as Record<string, unknown>)?.text), done: !!(it as Record<string, unknown>)?.done })),
        });
        break;
      case 'table': {
        const columns = (Array.isArray(o.columns) ? o.columns : Array.isArray(o.headers) ? o.headers : []).slice(0, BLOCK_LIMITS.cols).map((c) => str(c, 200));
        const width = Math.max(columns.length, 1);
        const rows = (Array.isArray(o.rows) ? o.rows : []).slice(0, BLOCK_LIMITS.rows).map((r) => {
          const cells = Array.isArray(r) ? r : r && typeof r === 'object' ? columns.map((c) => (r as Record<string, unknown>)[c]) : [r];
          const row = cells.slice(0, width).map((c) => str(c, BLOCK_LIMITS.cell));
          while (row.length < width) row.push('');
          return row;
        });
        if (!columns.length && rows.length) columns.push(...rows[0].map((_, i) => `Column ${i + 1}`));
        const align = Array.isArray(o.align) ? o.align.slice(0, width).map((a) => (a === 'center' || a === 'right' ? a : 'left')) : undefined;
        out.push({ type, columns, rows, ...(align ? { align } : {}), ...(o.caption ? { caption: str(o.caption, 300) } : {}), ...(o.total ? { total: true } : {}) });
        break;
      }
      case 'quote':
        out.push({ type, text: str(o.text), ...(o.cite ? { cite: str(o.cite, 300) } : {}) });
        break;
      case 'callout': {
        const variant = o.variant === 'tip' || o.variant === 'warning' ? o.variant : 'note';
        out.push({ type, variant, text: str(o.text), ...(o.title ? { title: str(o.title, 200) } : {}) });
        break;
      }
      case 'code':
        out.push({ type, text: str(o.text ?? o.code, 20_000), ...(o.language ? { language: str(o.language, 40) } : {}) });
        break;
      case 'rule':
      case 'pageBreak':
      case 'toc':
      case 'date':
        out.push({ type } as Block);
        break;
      case 'diagram':
        out.push({ type, source: str(o.source ?? o.mermaid ?? o.code, BLOCK_LIMITS.diagram), ...(o.alt ? { alt: str(o.alt, 1000) } : {}), ...(o.title ? { title: str(o.title, 200) } : {}) });
        break;
      case 'chart': {
        const chart = (['column', 'bar', 'line', 'area', 'pie', 'donut', 'scatter', 'stacked'] as ChartType[]).includes(o.chart as ChartType) ? (o.chart as ChartType) : o.kind && typeof o.kind === 'string' && ['column', 'bar', 'line', 'area', 'pie', 'donut', 'scatter', 'stacked'].includes(o.kind) ? (o.kind as ChartType) : 'column';
        const categories = (Array.isArray(o.categories) ? o.categories : Array.isArray(o.labels) ? o.labels : []).slice(0, BLOCK_LIMITS.points).map((c) => str(c, 100));
        const series = (Array.isArray(o.series) ? o.series : []).slice(0, BLOCK_LIMITS.series).map((s, i) => {
          const so = (s ?? {}) as Record<string, unknown>;
          return { name: str(so.name, 100) || `Series ${i + 1}`, values: (Array.isArray(so.values) ? so.values : Array.isArray(so.data) ? so.data : []).slice(0, BLOCK_LIMITS.points).map(num) };
        });
        out.push({ type, chart, categories, series, ...(o.title ? { title: str(o.title, 200) } : {}), ...(o.xTitle ? { xTitle: str(o.xTitle, 100) } : {}), ...(o.yTitle ? { yTitle: str(o.yTitle, 100) } : {}) });
        break;
      }
      case 'equation':
        out.push({ type, latex: str(o.latex ?? o.text, 4000), display: o.display !== false });
        break;
      case 'qr':
        out.push({ type, text: str(o.text ?? o.url, 1200), ...(o.alt ? { alt: str(o.alt, 300) } : {}) });
        break;
      case 'image': {
        const src = safeImageSrc(o.src);
        if (src) out.push({ type, src, alt: str(o.alt, 1000) || 'Image', ...(o.prompt ? { prompt: str(o.prompt, 1000) } : {}) });
        break;
      }
      case 'signature':
        out.push({ type, ...(o.name ? { name: str(o.name, 200) } : {}), ...(o.title ? { title: str(o.title, 200) } : {}) });
        break;
    }
  }
  return out;
}

/** Markdown (what most models write anyway) to blocks: headings, lists (nested), tables, quotes, code, rules, mermaid fences, checklists. */
export function markdownToBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ type: 'paragraph', text: para.join(' ').trim() });
    para = [];
  };
  for (let i = 0; i < lines.length && out.length < BLOCK_LIMITS.blocks; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w-]*)/);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i]);
      const lang = fence[1].toLowerCase();
      if (lang === 'mermaid') out.push({ type: 'diagram', source: body.join('\n').slice(0, BLOCK_LIMITS.diagram) });
      else if (lang === 'json') out.push(...sanitizeBlocks(tryJson(body.join('\n'))));
      else if (lang === 'latex' || lang === 'math' || lang === 'tex') out.push({ type: 'equation', latex: body.join('\n'), display: true });
      else out.push({ type: 'code', text: body.join('\n'), ...(lang ? { language: lang } : {}) });
      continue;
    }
    if (/^\s*\$\$/.test(line)) {
      flush();
      const body: string[] = [line.replace(/^\s*\$\$/, '')];
      if (!/\$\$\s*$/.test(line.replace(/^\s*\$\$/, ''))) for (i++; i < lines.length && !/\$\$\s*$/.test(lines[i]); i++) body.push(lines[i]);
      if (i < lines.length && lines[i] !== line) body.push(lines[i]);
      out.push({ type: 'equation', latex: body.join('\n').replace(/\$\$/g, '').trim(), display: true });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      flush();
      out.push({ type: 'heading', level: Math.min(4, h[1].length) as 1 | 2 | 3 | 4, text: h[2] });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      out.push({ type: 'rule' });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const columns = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left')) as Array<'left' | 'center' | 'right'>;
      const rows: string[][] = [];
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]));
      i--;
      out.push(...sanitizeBlocks([{ type: 'table', columns, rows, align }]));
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const body: string[] = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) body.push(lines[i].replace(/^\s*>\s?/, ''));
      i--;
      const callout = body[0]?.match(/^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*(.*)$/i);
      if (callout) {
        const v = callout[1].toLowerCase();
        out.push({ type: 'callout', variant: v === 'tip' ? 'tip' : v === 'warning' || v === 'caution' ? 'warning' : 'note', text: [callout[2], ...body.slice(1)].join(' ').trim() });
      } else out.push({ type: 'quote', text: body.join(' ') });
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flush();
      const items: Array<{ indent: number; ordered: boolean; text: string }> = [];
      for (; i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]); i++) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m) items.push({ indent: m[1].replace(/\t/g, '  ').length, ordered: /\d/.test(m[2]), text: m[3] });
      }
      i--;
      if (items.every((it) => /^\[[ xX]\]\s/.test(it.text))) {
        out.push({ type: 'checklist', items: items.map((it) => ({ text: it.text.slice(4), done: /^\[[xX]\]/.test(it.text) })) });
        continue;
      }
      out.push({ type: 'list', ordered: items[0]?.ordered, items: nest(items) });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
}

function nest(flat: Array<{ indent: number; ordered: boolean; text: string }>): ListItem[] {
  const root: ListItem[] = [];
  const stack: Array<{ indent: number; list: ListItem[] }> = [{ indent: -1, list: root }];
  for (const it of flat) {
    while (stack.length > 1 && it.indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1];
    const item: ListItem = { text: it.text, ...(it.ordered ? { ordered: true } : {}) };
    parent.list.push(item);
    if (stack.length <= BLOCK_LIMITS.depth) {
      item.children = [];
      stack.push({ indent: it.indent, list: item.children });
    }
  }
  const prune = (l: ListItem[]) => l.forEach((x) => (x.children?.length ? prune(x.children) : delete x.children));
  prune(root);
  return root;
}

/** Plain text of blocks (Copy, and "Edit as text"). */
export function blocksToMarkdown(blocks: Block[]): string {
  const list = (items: ListItem[], ordered: boolean, depth: number): string =>
    items.map((it, i) => `${'  '.repeat(depth)}${ordered ? `${i + 1}.` : '-'} ${it.text}${it.children?.length ? `\n${list(it.children, !!it.children[0]?.ordered, depth + 1)}` : ''}`).join('\n');
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'heading': return `${'#'.repeat(b.level)} ${b.text}`;
        case 'paragraph': return b.text;
        case 'list': return list(b.items, !!b.ordered, 0);
        case 'checklist': return b.items.map((it) => `- [${it.done ? 'x' : ' '}] ${it.text}`).join('\n');
        case 'table': return [`| ${b.columns.join(' | ')} |`, `|${b.columns.map(() => ' --- ').join('|')}|`, ...b.rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
        case 'quote': return `> ${b.text}`;
        case 'callout': return `> [!${(b.variant ?? 'note').toUpperCase()}] ${b.title ? `${b.title}: ` : ''}${b.text}`;
        case 'code': return `\`\`\`${b.language ?? ''}\n${b.text}\n\`\`\``;
        case 'rule': return '---';
        case 'pageBreak': return '';
        case 'toc': return '[Table of contents]';
        case 'diagram': return `\`\`\`mermaid\n${b.source}\n\`\`\``;
        case 'chart': return `[${b.chart} chart${b.title ? `: ${b.title}` : ''}]`;
        case 'equation': return `$$${b.latex}$$`;
        case 'qr': return `[QR code: ${b.text}]`;
        case 'image': return `[Image: ${b.alt}]`;
        case 'signature': return `______________________\n${b.name ?? ''}${b.title ? `\n${b.title}` : ''}`;
        case 'date': return new Date().toLocaleDateString();
      }
    })
    .join('\n\n');
}

// ----- tables ---------------------------------------------------------------------------------

/** Parse CSV or TSV (quoted fields allowed) into columns and rows. */
export function parseDelimited(text: string): { columns: string[]; rows: string[][] } {
  const t = text.replace(/\r\n?/g, '\n').trim();
  const firstLine = t.split('\n')[0] ?? '';
  const delim = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? '\t' : firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === delim) row.push(cell.trim()), (cell = '');
    else if (c === '\n') row.push(cell.trim()), rows.push(row), (row = []), (cell = '');
    else cell += c;
  }
  row.push(cell.trim());
  rows.push(row);
  const [columns = [], ...body] = rows.slice(0, BLOCK_LIMITS.rows + 1);
  return { columns: columns.slice(0, BLOCK_LIMITS.cols), rows: body.map((r) => r.slice(0, BLOCK_LIMITS.cols)) };
}

/** A number in a table cell, or null (currency, thousands separators and percent signs allowed). */
export function cellNumber(s: string): number | null {
  const t = s.trim();
  if (!t || !/[0-9]/.test(t)) return null;
  const neg = /^\(.*\)$/.test(t) || t.startsWith('-');
  const n = Number(t.replace(/[()\s,$€£¥%]|KSh|KES|USD/gi, '').replace(/^-/, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

export type NumberFormat = 'plain' | 'currency' | 'percent' | 'date';

/** Sort, format and total a table block (the tools beside a table result). */
export function tableTools(b: Extract<Block, { type: 'table' }>) {
  const copy = (rows: string[][]): Extract<Block, { type: 'table' }> => ({ ...b, rows });
  return {
    sort(col: number, desc = false) {
      const rows = [...b.rows].filter((r) => !(b.total && r === b.rows[b.rows.length - 1]));
      rows.sort((x, y) => {
        const [a, c] = [cellNumber(x[col] ?? ''), cellNumber(y[col] ?? '')];
        const r = a !== null && c !== null ? a - c : (x[col] ?? '').localeCompare(y[col] ?? '');
        return desc ? -r : r;
      });
      return copy(b.total ? [...rows, b.rows[b.rows.length - 1]] : rows);
    },
    addRow() {
      return copy([...b.rows, b.columns.map(() => '')]);
    },
    removeRow(i: number) {
      return copy(b.rows.filter((_, j) => j !== i));
    },
    addColumn(name = 'New column') {
      return { ...b, columns: [...b.columns, name], rows: b.rows.map((r) => [...r, '']) };
    },
    removeColumn(i: number) {
      return { ...b, columns: b.columns.filter((_, j) => j !== i), rows: b.rows.map((r) => r.filter((_, j) => j !== i)), align: b.align?.filter((_, j) => j !== i) };
    },
    format(col: number, fmt: NumberFormat, currency = 'USD', locale?: string) {
      const f = (s: string) => {
        if (fmt === 'date') {
          const d = new Date(s);
          return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
        }
        const n = cellNumber(s);
        if (n === null) return s;
        if (fmt === 'currency') return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
        if (fmt === 'percent') return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(Math.abs(n) > 1 ? n / 100 : n);
        return new Intl.NumberFormat(locale).format(n);
      };
      return { ...copy(b.rows.map((r) => r.map((c, j) => (j === col ? f(c) : c)))), align: b.columns.map((_, j) => (j === col ? 'right' : (b.align?.[j] ?? 'left'))) as Array<'left' | 'center' | 'right'> };
    },
    withTotal() {
      if (b.total) return b;
      const rows = b.rows;
      const total = b.columns.map((_, j) => {
        if (j === 0) return 'Total';
        const nums = rows.map((r) => cellNumber(r[j] ?? ''));
        if (!nums.length || nums.some((n) => n === null)) return '';
        const sum = (nums as number[]).reduce((a, c) => a + c, 0);
        const sample = rows.find((r) => r[j])?.[j] ?? '';
        const prefix = sample.match(/^[^\d(-]*/)?.[0] ?? '';
        return `${prefix}${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(sum)}`;
      });
      return { ...b, rows: [...rows, total], total: true };
    },
  };
}

// ----- HTML for the document (we write it; every string is escaped) ----------------------------

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Inline Markdown in block text: **bold**, *italic*, `code` and [links](https://…) (http, https and mailto only). */
export function inlineHtml(text: string): string {
  let out = esc(text);
  out = out.replace(/`([^`]+)`/g, '<span style="font-family:Consolas,monospace">$1</span>');
  out = out.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<b>${a ?? b}</b>`);
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  out = out.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_, label, url) => `<a href="${url.replace(/"/g, '%22')}">${label}</a>`);
  return out;
}

const CALLOUT_LABEL = { note: 'Note', tip: 'Tip', warning: 'Warning' } as const;

/** One block (that HTML can carry) as HTML for WordCraft's importer, or null for native objects. */
export function blockHtml(b: Block, palette: Palette): string | null {
  const p = withHash(palette);
  const list = (items: ListItem[], ordered: boolean): string =>
    `<${ordered ? 'ol' : 'ul'}>${items.map((it) => `<li>${inlineHtml(it.text)}${it.children?.length ? list(it.children, !!it.children[0]?.ordered) : ''}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
  switch (b.type) {
    case 'heading':
      return `<h${b.level}>${inlineHtml(b.text)}</h${b.level}>`;
    case 'paragraph':
      return `<p>${inlineHtml(b.text)}</p>`;
    case 'list':
      return list(b.items, !!b.ordered);
    case 'checklist':
      return b.items.map((it) => `<p>${it.done ? '☑' : '☐'} ${inlineHtml(it.text)}</p>`).join('');
    case 'table': {
      const head = `<tr>${b.columns.map((c, j) => `<th bgcolor="${p.primary}" style="color:#ffffff"><p style="text-align:${b.align?.[j] ?? 'left'};color:#ffffff"><b>${inlineHtml(c)}</b></p></th>`).join('')}</tr>`;
      const body = b.rows
        .map((r, i) => {
          const last = b.total && i === b.rows.length - 1;
          const zebra = !last && i % 2 === 1 ? ` bgcolor="${shade(p.muted, 48)}"` : last ? ` bgcolor="${shade(p.secondary, 45)}"` : '';
          return `<tr>${r.map((c, j) => `<td${zebra}><p style="text-align:${b.align?.[j] ?? 'left'}">${last ? `<b>${inlineHtml(c)}</b>` : inlineHtml(c) || '&nbsp;'}</p></td>`).join('')}</tr>`;
        })
        .join('');
      const caption = b.caption ? `<p><i>${inlineHtml(b.caption)}</i></p>` : '';
      return `${caption}<table border="1">${head}${body}</table><p></p>`;
    }
    case 'quote':
      return `<blockquote><p>${inlineHtml(b.text)}</p>${b.cite ? `<p>${esc(b.cite)}</p>` : ''}</blockquote>`;
    case 'callout': {
      const color = b.variant === 'warning' ? '#b45309' : b.variant === 'tip' ? p.secondary : p.primary;
      return `<table border="0"><tr><td bgcolor="${shade(color, 52)}"><p style="color:${color}"><b>${esc(b.title || CALLOUT_LABEL[b.variant ?? 'note'])}</b></p><p>${inlineHtml(b.text)}</p></td></tr></table><p></p>`;
    }
    case 'code':
      return `<pre>${esc(b.text)}</pre>`;
    case 'signature':
      return `<p></p><p>______________________________</p>${b.name ? `<p><b>${esc(b.name)}</b></p>` : ''}${b.title ? `<p>${esc(b.title)}</p>` : ''}`;
    case 'date':
      return `<p>${esc(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }))}</p>`;
    default:
      return null;
  }
}

// ----- inserting ------------------------------------------------------------------------------

export interface RenderedImage {
  /** PNG bytes as base64 (no `data:` prefix). */
  png: string;
  width: number;
  alt: string;
}

export interface InsertContext {
  palette: Palette;
  /** Render a diagram block to a PNG (Mermaid, loaded on first use). */
  renderDiagram?: (b: Extract<Block, { type: 'diagram' }>, p: Palette) => Promise<RenderedImage>;
  /** Render a QR block. */
  renderQr?: (b: Extract<Block, { type: 'qr' }>) => Promise<RenderedImage>;
  /** Called with each picture inserted from a diagram, so "Edit diagram" can find its source. */
  onDiagram?: (alt: string, source: string) => void;
}

const CHART_TYPE: Record<ChartType, string> = { column: 'column', bar: 'bar', line: 'line', area: 'area', pie: 'pie', donut: 'doughnut', scatter: 'scatter', stacked: 'columnStacked' };

/**
 * Insert blocks at the caret (replacing a selection). In Reviewing mode (Suggesting), WordCraft
 * records the insertion as a tracked change, as it does for a paste.
 */
export async function insertBlocks(editor: WordcraftEditor, blocks: Block[], ctx: InsertContext): Promise<void> {
  let html = '';
  const flush = () => {
    if (!html) return;
    editor.execute('edit.pasteSpecial', { as: 'html', html: `<html><body>${html}</body></html>` });
    html = '';
  };
  for (const b of blocks) {
    const h = blockHtml(b, ctx.palette);
    if (h !== null) {
      html += h;
      continue;
    }
    flush();
    try {
      await insertNative(editor, b, ctx);
    } catch (e) {
      // A block that can't be made becomes its text, so nothing is lost.
      html += `<p>${esc(blocksToMarkdown([b]))}</p>`;
      console.warn('[wordcraft] could not insert block', b.type, e);
    }
  }
  flush();
}

async function insertNative(editor: WordcraftEditor, b: Block, ctx: InsertContext): Promise<void> {
  switch (b.type) {
    case 'pageBreak':
      editor.execute('insert.pageBreak');
      return;
    case 'rule':
      // Home › Borders › Horizontal Line on this paragraph, then a fresh paragraph without it.
      editor.execute('insert.horizontalLine');
      editor.execute('text.newParagraph');
      editor.execute('para.borders', { kind: 'none' });
      return;
    case 'toc':
      editor.execute('references.toc', {});
      editor.execute('text.newParagraph');
      return;
    case 'equation':
      editor.execute('insert.equation', { latex: b.latex, display: b.display !== false, edit: false });
      editor.execute('text.newParagraph');
      return;
    case 'chart': {
      const scatter = b.chart === 'scatter';
      editor.execute('insert.chart', {
        type: CHART_TYPE[b.chart],
        title: b.title ?? '',
        legend: b.series.length > 1 || b.chart === 'pie' || b.chart === 'donut' ? 'bottom' : 'none',
        dataLabels: b.chart === 'pie' || b.chart === 'donut' || b.categories.length <= 8,
        data: { categories: scatter ? b.categories : b.categories, series: b.series.map((s) => ({ name: s.name, values: s.values })) },
      });
      // The new chart is selected: alt text goes on it, then the caret moves past it.
      try {
        const alt = chartAlt(b);
        editor.execute('object.altText', { text: alt, title: b.title ?? 'Chart' });
      } catch {
        /* alt text is a nicety */
      }
      collapse(editor);
      editor.execute('text.newParagraph');
      return;
    }
    case 'diagram': {
      if (!ctx.renderDiagram) throw new Error('no diagram renderer');
      const img = await ctx.renderDiagram(b, ctx.palette);
      editor.execute('insert.picture', { data: img.png, width: img.width, alt: img.alt });
      // The Mermaid source rides in the picture's title, so "Edit diagram" works after a save and reopen.
      try {
        editor.execute('object.altText', { title: `${DIAGRAM_TITLE}${b.source}` });
      } catch {
        /* an older engine: the source stays with the host through onDiagram */
      }
      ctx.onDiagram?.(img.alt, b.source);
      collapse(editor);
      editor.execute('text.newParagraph');
      return;
    }
    case 'qr': {
      if (!ctx.renderQr) throw new Error('no QR renderer');
      const img = await ctx.renderQr(b);
      editor.execute('insert.picture', { data: img.png, width: img.width, alt: img.alt });
      collapse(editor);
      editor.execute('text.newParagraph');
      return;
    }
    case 'image': {
      const data = b.src.slice(b.src.indexOf(',') + 1);
      editor.execute('insert.picture', { data, width: b.width, alt: b.alt });
      collapse(editor);
      editor.execute('text.newParagraph');
      return;
    }
  }
}

/** Pictures made from a Mermaid diagram carry this prefix and the source in their title. */
export const DIAGRAM_TITLE = 'mermaid:';

/**
 * After inserting a picture or chart, put the caret after it (so the next Enter doesn't replace
 * it). Charts are left selected; pictures already leave the caret after them (WordCraft #965).
 */
export function collapse(editor: WordcraftEditor): void {
  const c = editor.caret();
  const a = c?.anchor, f = c?.focus;
  if (a && f && (a.offset !== f.offset || a.path.join() !== f.path.join())) editor.execute('caret.right');
}

/** Alt text for a chart: its kind, title and what it plots. */
export function chartAlt(b: Extract<Block, { type: 'chart' }>): string {
  const pts = b.categories.slice(0, 12).map((c, i) => `${c} ${b.series.map((s) => s.values[i] ?? 'n/a').join('/')}`).join(', ');
  return `${b.chart[0].toUpperCase()}${b.chart.slice(1)} chart${b.title ? ` of ${b.title}` : ''}: ${b.series.map((s) => s.name).join(', ')} by ${b.xTitle ?? 'category'}. ${pts}${b.categories.length > 12 ? ', …' : ''}.`;
}

export { BLOCKS_PROMPT } from './ai-core.js';
