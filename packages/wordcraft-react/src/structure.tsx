'use client';

/**
 * AI that builds structure (an Extra): tables, diagrams, charts, checklists, callouts, equations,
 * QR codes, images and tables of contents, from a prompt and a data source, previewed before
 * anything goes into the document. Also the `/` slash menu and the host's own actions.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { WordcraftEditor } from './core.js';
import type { Palette } from './ai-studio.js';
import { blocksToMarkdown, cellNumber, insertBlocks, parseBlocks, parseDelimited, sanitizeBlocks, tableTools } from './blocks.js';
import type { Block, NumberFormat } from './blocks.js';
import { completeText } from './ai-run.js';
import type { AiSource } from './ai-run.js';
import { chartSvg, hasMermaid, renderDiagram, renderMermaidSvg, renderQr } from './renderers.js';
import { qrSvg } from './qr.js';
import { inlineHtml } from './blocks.js';
import { css } from './theme.js';

export type StructureKind = 'table' | 'diagram' | 'chart' | 'timeline' | 'checklist' | 'callout' | 'equation' | 'qr' | 'image' | 'toc' | 'free';

export interface DataTable {
  columns: string[];
  rows: Array<Array<string | number | null>>;
  /** Shown as the data source's name. */
  label?: string;
}

export interface HostActionContext {
  editor: WordcraftEditor;
  selection: string;
  palette: Palette;
}

/** An action of your own in the slash menu and the structure panel, e.g. "Insert our standard donor paragraph". */
export interface HostAction {
  id: string;
  label: string;
  /** An emoji or one or two letters. */
  icon?: string;
  run(ctx: HostActionContext): Block[] | Promise<Block[]>;
}

export interface StructureOptions {
  /** A data source from your app (your Sheets or Excel files), for tables and charts. */
  pickData?: () => Promise<DataTable | null>;
  /** Generate an image from a prompt (always previewed, with alt text). */
  generateImage?: (prompt: string) => Promise<Blob>;
  /** Find an image (your library or a licensed service). */
  imageSearch?: (query: string) => Promise<Array<{ src: string | Blob; alt: string }>>;
  /** Your own actions. */
  actions?: HostAction[];
}

export const STRUCTURE_ITEMS: Array<{ kind: StructureKind; label: string; icon: string; hint: string }> = [
  { kind: 'table', label: 'Table', icon: '▦', hint: 'A table from your words or your data' },
  { kind: 'diagram', label: 'Diagram', icon: '◇', hint: 'Flowchart, sequence, org chart, mind map…' },
  { kind: 'chart', label: 'Chart', icon: '▮', hint: 'Bar, line, pie and more, as a Word chart' },
  { kind: 'timeline', label: 'Timeline', icon: '⟶', hint: 'Dates and milestones' },
  { kind: 'checklist', label: 'Checklist', icon: '☑', hint: 'Steps to tick off' },
  { kind: 'callout', label: 'Callout', icon: '❕', hint: 'A note, tip or warning' },
  { kind: 'equation', label: 'Equation', icon: '∑', hint: 'From words or LaTeX' },
  { kind: 'qr', label: 'QR code', icon: '▣', hint: 'For a link or text' },
  { kind: 'image', label: 'Image', icon: '🖼', hint: 'Generated or found, with alt text' },
  { kind: 'toc', label: 'Table of contents', icon: '☰', hint: 'From the headings' },
];

const TASK: Record<StructureKind, string> = {
  table: 'Make a table block (add a caption only if useful).',
  diagram: 'Make exactly one diagram block with Mermaid code.',
  chart: 'Make exactly one chart block.',
  timeline: 'Make a timeline: one diagram block using Mermaid `timeline` syntax.',
  checklist: 'Make a checklist block.',
  callout: 'Make one callout block.',
  equation: 'Make one equation block with LaTeX.',
  qr: '',
  image: '',
  toc: '',
  free: 'Write the content as blocks, using headings, lists and tables where they help.',
};

/** Numbers in a table that the data does not contain (the AI must not invent values). */
export function unverifiedCells(b: Extract<Block, { type: 'table' }>, data: DataTable): Array<[number, number]> {
  const known = new Set<number>();
  const text = new Set<string>();
  for (const r of data.rows) for (const c of r) {
    if (c === null || c === undefined) continue;
    const n = typeof c === 'number' ? c : cellNumber(String(c));
    if (n !== null) known.add(Math.round(n * 100) / 100);
    text.add(String(c).trim().toLowerCase());
  }
  // Column sums are allowed (a total row).
  const cols = data.columns.length;
  for (let j = 0; j < cols; j++) {
    let s = 0, ok = true;
    for (const r of data.rows) {
      const n = typeof r[j] === 'number' ? (r[j] as number) : cellNumber(String(r[j] ?? ''));
      if (n === null) ok = false;
      else s += n;
    }
    if (ok) known.add(Math.round(s * 100) / 100);
  }
  const bad: Array<[number, number]> = [];
  b.rows.forEach((r, i) =>
    r.forEach((c, j) => {
      const n = cellNumber(c);
      if (n === null) return;
      if (/\[to confirm\]|\[number\]/i.test(c)) return;
      const v = Math.round(n * 100) / 100;
      if (!known.has(v) && !known.has(Math.round(n)) && !text.has(c.trim().toLowerCase())) bad.push([i, j]);
    }),
  );
  return bad;
}

function dataToCsv(d: DataTable): string {
  const q = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [d.columns.map(q).join(','), ...d.rows.slice(0, 500).map((r) => r.map(q).join(','))].join('\n');
}

async function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(r.error);
    r.readAsDataURL(b);
  });
}

/** Re-encode any image as PNG (drops metadata and anything that is not pixels). */
async function toPngDataUrl(src: string, maxSide = 1600): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

// ----- preview --------------------------------------------------------------------------------

function DiagramView({ source, palette, onFix }: { source: string; palette: Palette; onFix?: (error: string) => void }) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setError('');
    if (!hasMermaid()) {
      setError('Diagrams need Mermaid: pass ai.mermaid = () => import("mermaid").');
      return;
    }
    renderMermaidSvg(source, palette)
      .then((s) => live && setSvg(s))
      .catch((e: unknown) => live && (setSvg(''), setError(e instanceof Error ? e.message : String(e))));
    return () => {
      live = false;
    };
  }, [source, palette]);
  if (error)
    return (
      <div>
        <pre className="wcst-code">{source}</pre>
        <p className="wcst-warn">{error}</p>
        {onFix && hasMermaid() && (
          <button type="button" className="wcai-btn" onClick={() => onFix(error)}>
            Ask AI to fix the diagram
          </button>
        )}
      </div>
    );
  return svg ? <img className="wcst-img" alt="Diagram preview" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} /> : <span className="wcai-dots" />;
}

function TableView({ b, onChange, bad }: { b: Extract<Block, { type: 'table' }>; onChange?: (b: Block) => void; bad: Array<[number, number]> }) {
  const [fmtCol, setFmtCol] = useState(-1);
  const t = tableTools(b);
  const isBad = (i: number, j: number) => bad.some(([x, y]) => x === i && y === j);
  return (
    <div>
      {b.caption && <p className="wcst-caption">{b.caption}</p>}
      <div className="wcst-scroll">
        <table className="wcst-table">
          <thead>
            <tr>
              {b.columns.map((c, j) => (
                <th key={j} style={{ textAlign: b.align?.[j] ?? 'left' }}>
                  {onChange ? (
                    <button type="button" title="Sort by this column (again to reverse)" onClick={() => onChange(t.sort(j, fmtCol === -2 - j))}>
                      {c}
                    </button>
                  ) : (
                    c
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i} data-total={b.total && i === b.rows.length - 1 ? '' : undefined}>
                {r.map((c, j) => (
                  <td key={j} style={{ textAlign: b.align?.[j] ?? 'left' }} data-bad={isBad(i, j) ? '' : undefined} title={isBad(i, j) ? 'Not found in the data' : undefined}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onChange && (
        <div className="wcst-tools">
          <button type="button" onClick={() => onChange(t.addRow())}>+ Row</button>
          <button type="button" onClick={() => b.rows.length && onChange(t.removeRow(b.rows.length - 1))}>− Row</button>
          <button type="button" onClick={() => onChange(t.addColumn())}>+ Column</button>
          <button type="button" onClick={() => b.columns.length > 1 && onChange(t.removeColumn(b.columns.length - 1))}>− Column</button>
          <button type="button" onClick={() => onChange(t.withTotal())} disabled={!!b.total}>Totals row</button>
          <select aria-label="Number format" value={fmtCol} onChange={(e) => setFmtCol(Number(e.target.value))}>
            <option value={-1}>Format column…</option>
            {b.columns.map((c, j) => (
              <option key={j} value={j}>{c}</option>
            ))}
          </select>
          {fmtCol >= 0 &&
            (['plain', 'currency', 'percent', 'date'] as NumberFormat[]).map((f) => (
              <button key={f} type="button" onClick={() => onChange(t.format(fmtCol, f))}>
                {f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

export function BlockPreview({ blocks, palette, onChange, data, onFixDiagram }: { blocks: Block[]; palette: Palette; onChange?: (blocks: Block[]) => void; data?: DataTable | null; onFixDiagram?: (index: number, error: string) => void }) {
  const set = (i: number) => (b: Block) => onChange?.(blocks.map((x, k) => (k === i ? b : x)));
  const html = (s: string) => ({ __html: inlineHtml(s).replace(/<a href=/g, '<a target="_blank" rel="noopener noreferrer" href=') });
  const list = (items: Array<{ text: string; children?: unknown[] }>, ordered: boolean): ReactNode => {
    const Tag = ordered ? 'ol' : 'ul';
    return (
      <Tag>
        {items.map((it, i) => (
          <li key={i}>
            <span dangerouslySetInnerHTML={html(it.text)} />
            {Array.isArray(it.children) && it.children.length > 0 && list(it.children as Array<{ text: string; children?: unknown[] }>, false)}
          </li>
        ))}
      </Tag>
    );
  };
  return (
    <div className="wcst-preview">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'heading': {
            const H = `h${Math.min(4, b.level + 1)}` as 'h2';
            return <H key={i} style={{ color: css(palette.primary) }} dangerouslySetInnerHTML={html(b.text)} />;
          }
          case 'paragraph':
            return <p key={i} dangerouslySetInnerHTML={html(b.text)} />;
          case 'list':
            return <div key={i}>{list(b.items, !!b.ordered)}</div>;
          case 'checklist':
            return (
              <ul key={i} className="wcst-check">
                {b.items.map((it, k) => (
                  <li key={k}>
                    {it.done ? '☑' : '☐'} <span dangerouslySetInnerHTML={html(it.text)} />
                  </li>
                ))}
              </ul>
            );
          case 'table':
            return <TableView key={i} b={b} onChange={onChange ? set(i) : undefined} bad={data ? unverifiedCells(b, data) : []} />;
          case 'quote':
            return <blockquote key={i} dangerouslySetInnerHTML={html(b.text)} />;
          case 'callout':
            return (
              <div key={i} className="wcst-callout" data-variant={b.variant} style={{ borderColor: b.variant === 'warning' ? '#b45309' : css(palette.primary) }}>
                <strong>{b.title || (b.variant === 'warning' ? 'Warning' : b.variant === 'tip' ? 'Tip' : 'Note')}</strong>
                <p dangerouslySetInnerHTML={html(b.text)} />
              </div>
            );
          case 'code':
            return <pre key={i} className="wcst-code">{b.text}</pre>;
          case 'rule':
            return <hr key={i} />;
          case 'pageBreak':
            return <p key={i} className="wcst-dim">(page break)</p>;
          case 'toc':
            return <p key={i} className="wcst-dim">(table of contents from the headings)</p>;
          case 'diagram':
            return <DiagramView key={i} source={b.source} palette={palette} onFix={onFixDiagram ? (e) => onFixDiagram(i, e) : undefined} />;
          case 'chart':
            return <img key={i} className="wcst-img" alt={b.title ?? 'Chart preview'} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(chartSvg(b, palette))}`} />;
          case 'equation':
            return (
              <pre key={i} className="wcst-code" title="Inserted as a Word equation">
                {b.latex}
              </pre>
            );
          case 'qr':
            return <img key={i} className="wcst-img wcst-qr" alt={b.alt ?? `QR code for ${b.text}`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(b.text, { scale: 4 }))}`} />;
          case 'image':
            return <img key={i} className="wcst-img" alt={b.alt} src={b.src} />;
          case 'signature':
            return (
              <p key={i}>
                ______________________
                <br />
                {b.name}
                {b.title && <br />}
                {b.title}
              </p>
            );
          case 'date':
            return <p key={i}>{new Date().toLocaleDateString()}</p>;
        }
      })}
    </div>
  );
}

// ----- the panel ------------------------------------------------------------------------------

type Source = 'prompt' | 'selection' | 'document' | 'paste' | 'host';

export interface StructurePanelProps {
  editor: WordcraftEditor;
  kind: StructureKind;
  ai: (AiSource & { instructions?: string }) | null;
  palette: Palette;
  options: StructureOptions;
  /** The person's edits become tracked suggestions. */
  suggest: boolean;
  /** Initial prompt (from the AI bar). */
  initialPrompt?: string;
  /** An action of the host's to run straight away. */
  action?: HostAction | null;
  /** The source of a diagram to edit, with its alt text to find the picture again. */
  editDiagram?: { source: string } | null;
  onClose: () => void;
  onDiagram?: (alt: string, source: string) => void;
}

export function StructurePanel({ editor, kind, ai, palette, options, suggest, initialPrompt = '', action, editDiagram, onClose, onDiagram }: StructurePanelProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [source, setSource] = useState<Source>('prompt');
  const [paste, setPaste] = useState('');
  const [hostData, setHostData] = useState<DataTable | null>(null);
  const [blocks, setBlocks] = useState<Block[]>(() => (editDiagram ? [{ type: 'diagram', source: editDiagram.source }] : []));
  const [asText, setAsText] = useState<string | null>(editDiagram ? editDiagram.source : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'cursor' | 'replace' | 'below'>(() => (editor.getSelectedText().trim() ? 'below' : 'cursor'));
  const abort = useRef<AbortController | null>(null);
  const selection = useMemo(() => editor.getSelectedText().trim(), [editor]);
  const item = STRUCTURE_ITEMS.find((x) => x.kind === kind);
  const usesData = kind === 'table' || kind === 'chart' || kind === 'free';

  const data: DataTable | null = useMemo(() => {
    if (source === 'paste' && paste.trim()) return parseDelimited(paste);
    if (source === 'host') return hostData;
    return null;
  }, [source, paste, hostData]);

  useEffect(() => {
    if (action) void runAction(action);
  }, [action]); // eslint-disable-line react-hooks/exhaustive-deps

  const runAction = async (a: HostAction) => {
    setBusy(true);
    setError('');
    try {
      setBlocks(sanitizeBlocks(await a.run({ editor, selection, palette })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const generate = async (fix?: { index: number; error: string }) => {
    setError('');
    if (kind === 'qr') {
      const text = prompt.trim();
      if (!text) return setError('Type the link or text for the QR code.');
      return setBlocks([{ type: 'qr', text }]);
    }
    if (kind === 'toc') return setBlocks([{ type: 'toc' }]);
    if (kind === 'image') {
      if (!prompt.trim()) return setError('Describe the image.');
      setBusy(true);
      try {
        if (options.generateImage) {
          const blob = await options.generateImage(prompt.trim());
          const src = await toPngDataUrl(await blobToDataUrl(blob));
          setBlocks([{ type: 'image', src, alt: prompt.trim(), prompt: prompt.trim() }]);
        } else if (options.imageSearch) {
          const found = (await options.imageSearch(prompt.trim()))[0];
          if (!found) throw new Error('No image found.');
          const src = await toPngDataUrl(typeof found.src === 'string' ? found.src : await blobToDataUrl(found.src));
          setBlocks([{ type: 'image', src, alt: found.alt || prompt.trim(), prompt: prompt.trim() }]);
        } else throw new Error('Images need ai.generateImage or ai.imageSearch from your app.');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!ai) return setError('AI is not set up for this editor.');
    if (!prompt.trim() && !fix && source === 'prompt') return setError('Say what to make.');
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    try {
      let task = `${TASK[kind]}\n${prompt.trim()}`;
      if (fix) {
        const b = blocks[fix.index];
        task = `This Mermaid diagram fails with "${fix.error}". Return one corrected diagram block.\n${b && b.type === 'diagram' ? b.source : ''}`;
      } else if (editDiagram && blocks[0]?.type === 'diagram') {
        task = `Change this Mermaid diagram as asked and return one diagram block. Request: ${prompt.trim()}\n${blocks[0].source}`;
      }
      const dataText = data ? dataToCsv(data) : source === 'selection' ? selection : source === 'document' ? editor.getText().slice(0, 20000) : undefined;
      const answer = await completeText(ai, { action: 'structure', prompt: task, selection: source === 'selection' ? selection : '', document: source === 'document' ? '' : editor.getText().slice(-4000), data: dataText, instructions: ai.instructions, signal: ctl.signal });
      if (ctl.signal.aborted) return;
      let out = parseBlocks(answer);
      if (data) {
        // Values must come from the data: anything else becomes "[to confirm]".
        out = out.map((b) => {
          if (b.type !== 'table') return b;
          const bad = unverifiedCells(b, data);
          return bad.length ? { ...b, rows: b.rows.map((r, i) => r.map((c, j) => (bad.some(([x, y]) => x === i && y === j) ? '[to confirm]' : c))) } : b;
        });
      }
      if (fix) setBlocks(blocks.map((b, i) => (i === fix.index ? (out.find((x) => x.type === 'diagram') ?? b) : b)));
      else setBlocks(out);
      setAsText(null);
      if (!out.length) setError('The answer had nothing to insert. Try again or rephrase.');
    } catch (e) {
      if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const fromData = () => {
    if (!data) return;
    setBlocks([{ type: 'table', columns: data.columns, rows: data.rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c)))), caption: data.label }]);
  };

  const insert = async () => {
    const list = asText !== null && kind !== 'diagram' ? parseBlocks(asText) : asText !== null ? [{ type: 'diagram' as const, source: asText }] : blocks;
    if (!list.length) return;
    setBusy(true);
    try {
      if (mode === 'cursor' && editor.getSelectedText()) editor.execute('caret.right');
      if (mode === 'below' && editor.getSelectedText()) {
        editor.execute('caret.right');
        editor.execute('text.newParagraph');
      }
      await insertBlocks(editor, list, { palette, renderDiagram, renderQr, onDiagram });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    try {
      const d = await options.pickData?.();
      if (d) {
        setHostData({ ...d, columns: d.columns.slice(0, 12), rows: d.rows.slice(0, 200) });
        setSource('host');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="wcai-card wcst" aria-label={item?.label ?? 'Insert'}>
      <style>{CSS}</style>
      <header className="wcai-result-head">
        <span className="wcst-icon" aria-hidden="true">{action?.icon ?? item?.icon ?? '✦'}</span>
        <strong>{action?.label ?? (editDiagram ? 'Edit diagram' : (item?.label ?? 'Insert'))}</strong>
        <span className="wcai-extra" title="An Extra: not part of Microsoft Word or WordCraft">Extra</span>
        <span style={{ marginLeft: 'auto' }} />
        <button type="button" className="wcai-round wcai-small" aria-label="Close" onClick={() => (abort.current?.abort(), onClose())}>
          ✕
        </button>
      </header>
      {!action && kind !== 'toc' && (
        <div className="wcst-form">
          {kind === 'equation' && <p className="wcst-dim">Describe it in words, or type LaTeX. It goes in as a Word equation you can edit.</p>}
          <textarea
            className="wcst-input"
            rows={2}
            value={prompt}
            placeholder={kind === 'qr' ? 'https://example.org/donate' : kind === 'image' ? 'Describe the image' : editDiagram ? 'What to change, e.g. add a step after approval' : `What should the ${(item?.label ?? 'content').toLowerCase()} show?`}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void generate();
              }
            }}
          />
          {usesData && (
            <div className="wcst-row" role="group" aria-label="Data source">
              <span className="wcst-dim">Data:</span>
              {(['prompt', 'selection', 'document', 'paste'] as Source[]).map((s) => (
                <button key={s} type="button" aria-pressed={source === s} className="wcst-seg" disabled={s === 'selection' && !selection} onClick={() => setSource(s)}>
                  {s === 'prompt' ? 'The prompt' : s === 'selection' ? 'Selection' : s === 'document' ? 'Document' : 'Paste CSV'}
                </button>
              ))}
              {options.pickData && (
                <button type="button" aria-pressed={source === 'host'} className="wcst-seg" onClick={() => void pick()}>
                  {hostData?.label ?? 'From a file…'}
                </button>
              )}
            </div>
          )}
          {source === 'paste' && usesData && <textarea className="wcst-input wcst-mono" rows={4} value={paste} placeholder={'Funder,Amount,Deadline\nAcme Trust,25000,2026-12-01'} onChange={(e) => setPaste(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />}
          {data && <p className="wcst-dim">{data.rows.length} rows, {data.columns.length} columns. Values in the result must come from this data.</p>}
          <div className="wcst-row">
            <button type="button" className="wcai-btn wcai-primary" disabled={busy} onClick={() => void generate()}>
              {busy ? 'Working…' : blocks.length ? 'Regenerate' : kind === 'qr' ? 'Make QR code' : 'Generate'}
            </button>
            {data && kind === 'table' && (
              <button type="button" className="wcai-btn" onClick={fromData}>
                Table from the data as is
              </button>
            )}
          </div>
        </div>
      )}
      {(blocks.length > 0 || asText !== null) && (
        <>
          {asText !== null ? (
            kind === 'diagram' || editDiagram ? (
              <div className="wcst-split">
                <textarea className="wcst-input wcst-mono" rows={8} value={asText} aria-label="Mermaid source" onChange={(e) => setAsText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
                <DiagramView source={asText} palette={palette} />
              </div>
            ) : (
              <textarea className="wcst-input wcst-mono" rows={10} value={asText} aria-label="Edit as text" onChange={(e) => setAsText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            )
          ) : (
            <BlockPreview blocks={blocks} palette={palette} onChange={setBlocks} data={data} onFixDiagram={(index, err) => void generate({ index, error: err })} />
          )}
          <p className="wcst-marker">AI-generated: check it before use.</p>
          <div className="wcst-row">
            <select aria-label="Where to insert" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="cursor">At the cursor</option>
              {selection && <option value="replace">Replace the selection</option>}
              {selection && <option value="below">Below the selection</option>}
            </select>
            <button type="button" className="wcai-btn wcai-primary" disabled={busy} onClick={() => void insert()}>
              {suggest ? 'Insert as suggestion' : 'Insert'}
            </button>
            {asText === null ? (
              <button type="button" className="wcai-btn" onClick={() => setAsText(blocks.length === 1 && blocks[0].type === 'diagram' ? blocks[0].source : blocksToMarkdown(blocks))}>
                {blocks.length === 1 && blocks[0].type === 'diagram' ? 'Edit diagram' : 'Edit as text'}
              </button>
            ) : (
              <button type="button" className="wcai-btn" onClick={() => (setBlocks(kind === 'diagram' || editDiagram ? [{ type: 'diagram', source: asText }] : parseBlocks(asText)), setAsText(null))}>
                Preview
              </button>
            )}
          </div>
        </>
      )}
      {error && <p className="wcst-warn" role="status">{error}</p>}
    </section>
  );
}

// ----- slash menu -----------------------------------------------------------------------------

export interface SlashItem {
  id: string;
  label: string;
  icon: string;
  hint?: string;
}

/**
 * The `/` menu: typing `/` at the start of an empty paragraph opens it at the caret. Letters
 * filter it, arrows move, Enter picks, Escape closes. The `/` and filter text are removed when an
 * item is picked.
 */
export function SlashMenu({ editor, container, items, onPick, dark }: { editor: WordcraftEditor; container: HTMLElement | null; items: SlashItem[]; onPick: (id: string) => void; dark?: boolean }) {
  const [open, setOpen] = useState<{ x: number; y: number; path: number[] } | null>(null);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const openRef = useRef(open);
  openRef.current = open;
  const shown = items.filter((i) => !filter || i.label.toLowerCase().includes(filter.toLowerCase()) || i.id.includes(filter.toLowerCase()));
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const activeRef = useRef(active);
  activeRef.current = active;

  const check = () => {
    try {
      const c = editor.caret();
      const at = c?.focus;
      if (!at || (c?.anchor && (c.anchor.offset !== at.offset || c.anchor.path.join() !== at.path.join()))) return setOpen(null);
      const p = editor.paragraphs().find((q) => q.path.join() === at.path.join());
      if (!p || !p.text.startsWith('/') || at.offset < 1 || /\s/.test(p.text.slice(0, at.offset)) || p.text.length > 24) return setOpen(null);
      setFilter(p.text.slice(1, at.offset));
      if (!openRef.current) {
        const info = editor.selectionInfo();
        const r = info?.rect;
        if (!r) return;
        setActive(0);
        setOpen({ x: r.x, y: r.y + r.height + 4, path: at.path });
      }
    } catch {
      setOpen(null);
    }
  };

  const pick = (id: string) => {
    const o = openRef.current;
    setOpen(null);
    if (!o) return;
    const p = editor.paragraphs().find((q) => q.path.join() === o.path.join());
    if (p && p.text.startsWith('/')) {
      editor.selectText(o.path, 0, p.text.length);
      editor.execute('text.delete');
    }
    onPick(id);
  };

  useEffect(() => {
    if (!container) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target !== editor.canvas && !container.contains(e.target as Node)) return;
      if (openRef.current) {
        const list = shownRef.current;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          setActive((a) => (list.length ? (a + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length : 0));
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          const item = list[activeRef.current];
          if (item) {
            e.preventDefault();
            e.stopPropagation();
            pick(item.id);
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setOpen(null);
          return;
        }
      }
      if (e.key === '/' || openRef.current) window.setTimeout(check, 40);
    };
    container.addEventListener('keydown', onKey, true);
    return () => container.removeEventListener('keydown', onKey, true);
  }, [container, editor]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !shown.length) return null;
  return (
    <div className="wcst-slash" data-theme={dark ? 'dark' : 'light'} role="listbox" aria-label="Insert" style={{ left: Math.max(8, open.x), top: open.y }} onMouseDown={(e) => e.preventDefault()}>
      <style>{CSS}</style>
      {shown.map((it, i) => (
        <button key={it.id} type="button" role="option" aria-selected={i === active} className="wcst-slash-item" onMouseEnter={() => setActive(i)} onClick={() => pick(it.id)}>
          <span className="wcst-icon">{it.icon}</span>
          <span>
            {it.label}
            {it.hint && <small>{it.hint}</small>}
          </span>
        </button>
      ))}
    </div>
  );
}

const CSS = `
.wcst{display:grid;gap:10px}
.wcst-icon{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:6px;background:var(--soft,#f1f4f9);font-size:13px;flex:none}
.wcst-form{display:grid;gap:8px}
.wcst-input{width:100%;padding:8px 10px;border:1px solid var(--line,#dadce0);border-radius:10px;background:var(--bg,#fff);color:inherit;font:inherit;resize:vertical;outline:none;box-sizing:border-box}
.wcst-input:focus{border-color:var(--accent,#0b57d0)}
.wcst-mono{font-family:ui-monospace,Consolas,monospace;font-size:12px}
.wcst-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.wcst-row select{height:32px;border:1px solid var(--line,#dadce0);border-radius:16px;background:var(--bg,#fff);color:inherit;padding:0 10px;font:inherit;font-size:13px}
.wcst-seg{height:28px;padding:0 10px;border:1px solid var(--line,#dadce0);border-radius:14px;background:none;color:inherit;cursor:pointer;font:inherit;font-size:12px}
.wcst-seg[aria-pressed=true]{background:var(--accent-soft,#e8f0fe);border-color:transparent;color:var(--accent,#0b57d0);font-weight:500}
.wcst-seg:disabled{opacity:.4;cursor:default}
.wcst-dim{margin:0;color:var(--dim,#5f6368);font-size:12px}
.wcst-warn{margin:0;color:#b3261e;font-size:12px}
.wcst-marker{margin:0;font-size:11px;color:var(--dim,#5f6368)}
.wcst-preview{max-height:300px;overflow:auto;padding:10px 12px;border:1px solid var(--line,#dadce0);border-radius:10px;background:var(--bg,#fff);font-size:13px}
.wcst-preview h2,.wcst-preview h3,.wcst-preview h4{margin:.4em 0 .2em}
.wcst-preview p{margin:.3em 0}
.wcst-preview a{color:var(--accent,#0b57d0)}
.wcst-scroll{overflow:auto}
.wcst-table{border-collapse:collapse;width:100%;font-size:12px}
.wcst-table th,.wcst-table td{border:1px solid var(--line,#dadce0);padding:4px 6px}
.wcst-table th{background:var(--accent,#0b57d0);color:#fff}
.wcst-table th button{all:unset;cursor:pointer}
.wcst-table tr[data-total] td{font-weight:600}
.wcst-table td[data-bad]{background:#fde7e9}
.wcst-tools{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.wcst-tools button,.wcst-tools select{height:24px;padding:0 8px;border:1px solid var(--line,#dadce0);border-radius:12px;background:none;color:inherit;font:inherit;font-size:11px;cursor:pointer}
.wcst-caption{margin:0 0 4px;font-style:italic;color:var(--dim,#5f6368)}
.wcst-callout{border-left:4px solid;padding:6px 10px;border-radius:6px;background:var(--soft,#f1f4f9)}
.wcst-code{margin:6px 0;padding:8px;border-radius:8px;background:var(--soft,#f1f4f9);font:12px ui-monospace,Consolas,monospace;white-space:pre-wrap;max-height:200px;overflow:auto}
.wcst-img{display:block;max-width:100%;max-height:260px;margin:6px auto;background:#fff;border-radius:6px}
.wcst-qr{width:140px}
.wcst-check{list-style:none;padding-left:4px}
.wcst-split{display:grid;grid-template-columns:1fr 1fr;gap:8px}
@media (max-width:560px){.wcst-split{grid-template-columns:1fr}}
.wcst-slash{position:absolute;z-index:9;width:260px;max-height:320px;overflow:auto;padding:6px;border:1px solid #dadce0;border-radius:12px;background:#fff;color:#1f1f1f;box-shadow:0 4px 18px rgba(0,0,0,.18);font:13px "Google Sans Text",Inter,"Segoe UI",system-ui,sans-serif}
.wcst-slash[data-theme=dark]{background:#2b2c2e;color:#e3e3e3;border-color:#3c4043}
.wcst-slash-item{display:flex;align-items:center;gap:10px;width:100%;padding:6px 8px;border:0;border-radius:8px;background:none;color:inherit;text-align:left;cursor:pointer;font:inherit}
.wcst-slash-item span:last-child{display:grid}
.wcst-slash-item small{color:#5f6368;font-size:11px}
.wcst-slash-item[aria-selected=true]{background:#e8f0fe}
.wcst-slash[data-theme=dark] .wcst-slash-item[aria-selected=true]{background:#0b3a7a}
`;
