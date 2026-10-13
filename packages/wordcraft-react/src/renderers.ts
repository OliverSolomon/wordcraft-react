/**
 * Renderers for structured AI output, all loaded or run only when first used: Mermaid diagrams
 * (through a loader the host passes, so no library or CDN is pulled in by default), QR codes (our
 * own encoder), chart previews (plain SVG), and SVG to PNG for inserting.
 */
import type { Block, RenderedImage } from './blocks.js';
import type { Palette } from './ai-studio.js';
import { qrSvg } from './qr.js';
import { esc } from './blocks.js';

/** What the package needs from Mermaid (`import('mermaid')` satisfies it). */
export interface MermaidLike {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
  parse?(text: string): Promise<unknown>;
}
export type MermaidLoader = () => Promise<MermaidLike | { default: MermaidLike }>;

let mermaidPromise: Promise<MermaidLike> | null = null;
let mermaidLoader: MermaidLoader | null = null;

/** Tell the package how to load Mermaid, e.g. `() => import('mermaid')`. */
export function setMermaidLoader(loader: MermaidLoader | null | undefined): void {
  if (loader === mermaidLoader) return;
  mermaidLoader = loader ?? null;
  mermaidPromise = null;
}

export function hasMermaid(): boolean {
  return !!mermaidLoader;
}

async function mermaid(): Promise<MermaidLike> {
  if (!mermaidLoader) throw new Error('Diagrams need Mermaid: install it and pass `ai.mermaid = () => import("mermaid")`.');
  mermaidPromise ??= mermaidLoader().then((m) => ('default' in m && m.default ? m.default : (m as MermaidLike)));
  return mermaidPromise;
}

const MAX_DIAGRAM_NODES = 150;

/** Render Mermaid source to SVG, strictly (no scripts, no clicks, no external fetches), themed with the palette. */
export async function renderMermaidSvg(source: string, p: Palette, font = 'Aptos, Segoe UI, Arial, sans-serif'): Promise<string> {
  const src = source.trim();
  if (src.length > 8000) throw new Error('The diagram is too large (8,000 characters at most).');
  const nodes = (src.match(/-->|---|->>|-\.->|==>/g) ?? []).length;
  if (nodes > MAX_DIAGRAM_NODES) throw new Error(`The diagram has too many links (${nodes}; ${MAX_DIAGRAM_NODES} at most).`);
  if (/<\s*script|javascript:|on\w+\s*=|click\s+\w+\s+(call|href)/i.test(src)) throw new Error('The diagram contains a script or a click handler, which are not allowed.');
  const m = await mermaid();
  m.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    theme: 'base',
    fontFamily: font,
    themeVariables: {
      primaryColor: tint(p.primary, 0.85),
      primaryBorderColor: p.primary,
      primaryTextColor: '#1f1f1f',
      lineColor: p.secondary,
      secondaryColor: tint(p.secondary, 0.85),
      tertiaryColor: tint(p.accent, 0.85),
      fontFamily: font,
    },
  });
  const { svg } = await m.render(`wcdiag${Math.random().toString(36).slice(2, 8)}`, src);
  return scrubSvg(svg);
}

/** Remove anything active or remote from an SVG: scripts, event handlers, foreignObject, external hrefs. */
export function scrubSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '')
    .replace(/@import[^;]+;/gi, '')
    .replace(/url\((?!\s*#)[^)]*\)/gi, 'none');
}

function tint(hex: string, k: number): string {
  const n = parseInt(hex.replace('#', ''), 16) || 0;
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Rasterise an SVG to PNG (base64, no prefix), at `scale` times its size, on white. */
export async function svgToPng(svg: string, scale = 2, maxWidth = 1600): Promise<{ png: string; width: number; height: number }> {
  const sized = svg.match(/<svg[^>]*\swidth="([\d.]+)(px)?"[^>]*\sheight="([\d.]+)(px)?"/);
  const vb = svg.match(/viewBox="[\d.\s-]+?\s([\d.]+)\s([\d.]+)"/);
  let w = sized ? parseFloat(sized[1]) : vb ? parseFloat(vb[1]) : 600;
  let h = sized ? parseFloat(sized[3]) : vb ? parseFloat(vb[2]) : 400;
  if (!sized) svg = svg.replace('<svg', `<svg width="${w}" height="${h}"`);
  const k = Math.min(scale, maxWidth / Math.max(w, 1));
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/png');
  return { png: url.slice(url.indexOf(',') + 1), width: w, height: h };
}

/** A sentence describing a Mermaid diagram, for alt text when the model gave none. */
export function diagramAlt(source: string, title?: string): string {
  const first = source.trim().split('\n')[0]?.trim() ?? '';
  const kind = /^sequenceDiagram/.test(first) ? 'Sequence diagram' : /^gantt/.test(first) ? 'Gantt chart' : /^timeline/.test(first) ? 'Timeline' : /^mindmap/.test(first) ? 'Mind map' : /^erDiagram/.test(first) ? 'Entity relationship diagram' : /^stateDiagram/.test(first) ? 'State diagram' : /^(graph|flowchart)/.test(first) ? 'Flowchart' : 'Diagram';
  const labels = Array.from(source.matchAll(/\[\s*"?([^\]"]{1,60})"?\s*\]|\(\s*"?([^)"]{1,60})"?\s*\)|\{\s*"?([^}"]{1,60})"?\s*\}/g))
    .map((m) => (m[1] ?? m[2] ?? m[3] ?? '').trim())
    .filter(Boolean);
  const steps = [...new Set(labels)].slice(0, 10);
  return `${kind}${title ? `: ${title}` : ''}${steps.length ? `. Steps: ${steps.join(', ')}${labels.length > 10 ? ', and more' : ''}.` : '.'}`;
}

export async function renderDiagram(b: Extract<Block, { type: 'diagram' }>, p: Palette): Promise<RenderedImage> {
  const svg = await renderMermaidSvg(b.source, p);
  const { png, width } = await svgToPng(svg);
  return { png, width: Math.min(450, width * 0.75), alt: b.alt?.trim() || diagramAlt(b.source, b.title) };
}

export async function renderQr(b: Extract<Block, { type: 'qr' }>): Promise<RenderedImage> {
  const { png } = await svgToPng(qrSvg(b.text, { scale: 8 }), 1);
  return { png, width: 108, alt: b.alt?.trim() || `QR code linking to ${b.text}` };
}

// ----- chart preview (the document gets a native Word chart) ----------------------------------

/** An SVG picture of a chart block, for the result card's preview. */
export function chartSvg(b: Extract<Block, { type: 'chart' }>, p: Palette, w = 520, h = 300): string {
  const colors = [p.primary, p.secondary, p.accent, p.muted, tint(p.primary, 0.4), tint(p.secondary, 0.4), tint(p.accent, 0.4), '#7f7f7f'];
  const font = 'font-family="Aptos, Segoe UI, Arial, sans-serif"';
  const title = b.title ? `<text x="${w / 2}" y="20" text-anchor="middle" font-size="14" font-weight="600" ${font}>${esc(b.title)}</text>` : '';
  const legend = b.series
    .map((s, i) => `<g transform="translate(${16 + i * 120},${h - 14})"><rect width="10" height="10" y="-9" fill="${colors[i % colors.length]}"/><text x="14" font-size="11" ${font}>${esc(s.name.slice(0, 16))}</text></g>`)
    .join('');
  if (b.chart === 'pie' || b.chart === 'donut') {
    const vals = (b.series[0]?.values ?? []).map((v) => Math.max(0, v ?? 0));
    const total = vals.reduce((a, c) => a + c, 0) || 1;
    const cx = w / 2, cy = h / 2 + 4, r = Math.min(w, h) / 2 - 40;
    let a0 = -Math.PI / 2;
    const slices = vals
      .map((v, i) => {
        const a1 = a0 + (v / total) * Math.PI * 2;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const d = `M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z`;
        const mid = (a0 + a1) / 2;
        const label = `<text x="${cx + (r + 14) * Math.cos(mid)}" y="${cy + (r + 14) * Math.sin(mid)}" font-size="10" text-anchor="middle" ${font}>${esc((b.categories[i] ?? '').slice(0, 14))}</text>`;
        a0 = a1;
        return `<path d="${d}" fill="${colors[i % colors.length]}" stroke="#fff"/>${label}`;
      })
      .join('');
    const hole = b.chart === 'donut' ? `<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#fff"/>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#fff"/>${title}${slices}${hole}</svg>`;
  }
  const L = 48, R = 12, T = b.title ? 32 : 14, B = 44;
  const pw = w - L - R, ph = h - T - B;
  const stacked = b.chart === 'stacked';
  const n = b.categories.length || Math.max(...b.series.map((s) => s.values.length), 1);
  const totals = Array.from({ length: n }, (_, i) => b.series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0));
  const all = b.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = Math.max(stacked ? Math.max(...totals, 0) : Math.max(...all, 0), 1);
  const min = stacked ? 0 : Math.min(0, ...all);
  const y = (v: number) => T + ph - ((v - min) / (max - min)) * ph;
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((t) => {
      const v = min + (max - min) * t;
      return `<line x1="${L}" x2="${w - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e5e5e5"/><text x="${L - 6}" y="${y(v) + 3}" font-size="10" text-anchor="end" fill="#555" ${font}>${Number(v.toPrecision(3)).toLocaleString()}</text>`;
    })
    .join('');
  const band = pw / n;
  const cats = b.categories.map((c, i) => `<text x="${L + band * (i + 0.5)}" y="${T + ph + 14}" font-size="10" text-anchor="middle" fill="#333" ${font}>${esc(c.slice(0, 12))}</text>`).join('');
  let marks = '';
  if (b.chart === 'line' || b.chart === 'area' || b.chart === 'scatter') {
    b.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => (v === null ? null : [L + band * (i + 0.5), y(v)])).filter((q): q is number[] => !!q);
      const col = colors[si % colors.length];
      if (b.chart === 'area' && pts.length) marks += `<path d="M${pts[0][0]},${y(Math.max(min, 0))} ${pts.map((q) => `L${q[0]},${q[1]}`).join(' ')} L${pts[pts.length - 1][0]},${y(Math.max(min, 0))} Z" fill="${col}" opacity=".35"/>`;
      if (b.chart !== 'scatter') marks += `<polyline points="${pts.map((q) => q.join(',')).join(' ')}" fill="none" stroke="${col}" stroke-width="2"/>`;
      marks += pts.map((q) => `<circle cx="${q[0]}" cy="${q[1]}" r="3" fill="${col}"/>`).join('');
    });
  } else {
    const k = b.series.length;
    for (let i = 0; i < n; i++) {
      let acc = 0;
      b.series.forEach((s, si) => {
        const v = s.values[i] ?? 0;
        const col = colors[si % colors.length];
        if (stacked) {
          marks += `<rect x="${L + band * i + band * 0.2}" y="${y(acc + Math.max(0, v))}" width="${band * 0.6}" height="${y(acc) - y(acc + Math.max(0, v))}" fill="${col}"/>`;
          acc += Math.max(0, v);
        } else {
          const bw = (band * 0.75) / k;
          const x = L + band * i + band * 0.125 + bw * si;
          marks += `<rect x="${x}" y="${Math.min(y(v), y(0))}" width="${bw}" height="${Math.abs(y(0) - y(v))}" fill="${col}"/>`;
        }
      });
    }
  }
  const axes = `${b.yTitle ? `<text transform="translate(12,${T + ph / 2}) rotate(-90)" font-size="11" text-anchor="middle" ${font}>${esc(b.yTitle)}</text>` : ''}${b.xTitle ? `<text x="${L + pw / 2}" y="${h - 26}" font-size="11" text-anchor="middle" ${font}>${esc(b.xTitle)}</text>` : ''}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#fff"/>${title}${grid}${marks}${cats}${axes}${b.series.length > 1 ? legend : ''}</svg>`;
}
