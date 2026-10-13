/**
 * Colours from a logo or photo (an Extra), and the document theme they become.
 *
 * Everything runs in the browser: a picture is shrunk to about 96 px, converted to Lab, stripped
 * of transparent, near-white and near-black pixels, clustered with k-means, merged where two
 * clusters look alike, and ranked by area and saturation. With several pictures the colours are
 * taken round-robin, so a small logo is not drowned by a busy photo.
 */
import type { WordcraftEditor } from './core.js';
import type { Palette } from './ai-studio.js';

export interface Swatch {
  /** `#rrggbb`. */
  hex: string;
  /** Share of the picture's counted pixels, 0 to 1. */
  share: number;
  /** Which picture it came from (index into the sources). */
  source: number;
}

export type PaletteRole = 'primary' | 'secondary' | 'accent' | 'muted';

export interface ExtractOptions {
  /** How many swatches to return (5 to 8). Default 6. */
  count?: number;
  /** `logo` favours flat colours, `photo` the most saturated large areas. Default: guessed per picture. */
  kind?: 'logo' | 'photo' | 'auto';
}

type Lab = [number, number, number];

// ----- colour maths ---------------------------------------------------------------------------

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const unlin = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToLab(r: number, g: number, b: number): Lab {
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function labToRgb([L, a, b]: Lab): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const g = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const x = g(fx) * 0.95047, y = g(fy), z = g(fz) * 1.08883;
  return [
    unlin(x * 3.2406 + y * -1.5372 + z * -0.4986),
    unlin(x * -0.9689 + y * 1.8758 + z * 0.0415),
    unlin(x * 0.0557 + y * -0.204 + z * 1.057),
  ];
}

const dist = (p: Lab, q: Lab) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const chroma = (p: Lab) => Math.hypot(p[1], p[2]);

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Darken (or lighten, on a dark page) a colour in Lab until it reaches `ratio` against `on`. */
export function fixContrast(hex: string, on = '#ffffff', ratio = 4.5): string {
  if (contrast(hex, on) >= ratio) return hex;
  const lab = rgbToLab(...hexToRgb(hex));
  const darker = luminance(on) > 0.4;
  for (let i = 0; i < 100; i++) {
    lab[0] = darker ? lab[0] - 1 : lab[0] + 1;
    const out = rgbToHex(...labToRgb(lab));
    if (contrast(out, on) >= ratio || lab[0] <= 0 || lab[0] >= 100) return out;
  }
  return darker ? '#000000' : '#ffffff';
}

/** Lighten or darken by `amount` Lab lightness (negative darkens). */
export function shade(hex: string, amount: number): string {
  const lab = rgbToLab(...hexToRgb(hex));
  lab[0] = Math.max(0, Math.min(100, lab[0] + amount));
  return rgbToHex(...labToRgb(lab));
}

// ----- extraction -----------------------------------------------------------------------------

export type ImageInput = Blob | string | HTMLImageElement | ImageBitmap;

async function loadImage(src: ImageInput): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap) return src;
  if (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement) {
    if (!src.complete) await new Promise((ok, no) => ((src.onload = ok), (src.onerror = no)));
    return src;
  }
  const url = typeof src === 'string' ? src : URL.createObjectURL(src as Blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    if (typeof src !== 'string') setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

interface Pixels {
  labs: Lab[];
  /** Fraction of pixels that are one of a handful of exact colours: high for logos. */
  flatness: number;
}

async function pixelsOf(src: ImageInput, longSide = 96): Promise<Pixels> {
  const img = await loadImage(src);
  const k = Math.min(1, longSide / Math.max(img.width, img.height, 1));
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const labs: Lab[] = [];
  const exact = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const lab = rgbToLab(r, g, b);
    if (lab[0] > 95 && chroma(lab) < 8) continue; // near white
    if (lab[0] < 6) continue; // near black
    labs.push(lab);
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    exact.set(key, (exact.get(key) ?? 0) + 1);
  }
  const top = [...exact.values()].sort((a, b) => b - a).slice(0, 6).reduce((a, b) => a + b, 0);
  return { labs, flatness: labs.length ? top / labs.length : 0 };
}

function kmeans(labs: Lab[], k: number): Array<{ c: Lab; n: number }> {
  if (!labs.length) return [];
  // k-means++ seeding, deterministic (the farthest point each time) so the same logo gives the same palette.
  const centres: Lab[] = [labs[Math.floor(labs.length / 2)]];
  while (centres.length < Math.min(k, labs.length)) {
    let best = labs[0], bestD = -1;
    for (const p of labs) {
      const d = Math.min(...centres.map((c) => dist(c, p)));
      if (d > bestD) (bestD = d), (best = p);
    }
    if (bestD < 1) break;
    centres.push([...best] as Lab);
  }
  const assign = new Int32Array(labs.length);
  for (let iter = 0; iter < 12; iter++) {
    const sum = centres.map(() => [0, 0, 0, 0]);
    labs.forEach((p, i) => {
      let bi = 0, bd = Infinity;
      centres.forEach((c, j) => {
        const d = dist(c, p);
        if (d < bd) (bd = d), (bi = j);
      });
      assign[i] = bi;
      const s = sum[bi];
      s[0] += p[0], s[1] += p[1], s[2] += p[2], s[3]++;
    });
    centres.forEach((c, j) => {
      const s = sum[j];
      if (s[3]) (c[0] = s[0] / s[3]), (c[1] = s[1] / s[3]), (c[2] = s[2] / s[3]);
    });
  }
  const counts = centres.map(() => 0);
  assign.forEach((j) => counts[j]++);
  return centres.map((c, j) => ({ c, n: counts[j] })).filter((x) => x.n > 0);
}

/**
 * The main colours of one or more pictures, ranked. Each swatch carries its share of the picture
 * and which picture it came from.
 */
export async function extractColors(sources: ImageInput[], options: ExtractOptions = {}): Promise<Swatch[]> {
  const count = Math.max(5, Math.min(8, options.count ?? 6));
  const perSource: Swatch[][] = [];
  for (let s = 0; s < sources.length; s++) {
    const px = await pixelsOf(sources[s]);
    if (!px.labs.length) {
      perSource.push([]);
      continue;
    }
    const kind = options.kind && options.kind !== 'auto' ? options.kind : px.flatness > 0.6 ? 'logo' : 'photo';
    let clusters = kmeans(px.labs, kind === 'logo' ? 8 : 10);
    // Merge clusters that look alike (Delta E under 12).
    clusters.sort((a, b) => b.n - a.n);
    const merged: Array<{ c: Lab; n: number }> = [];
    for (const cl of clusters) {
      const near = merged.find((m) => dist(m.c, cl.c) < 12);
      if (near) near.n += cl.n;
      else merged.push({ c: cl.c, n: cl.n });
    }
    clusters = merged;
    const total = clusters.reduce((a, b) => a + b.n, 0) || 1;
    const score = (x: { c: Lab; n: number }) => {
      const area = x.n / total;
      const sat = chroma(x.c) / 100;
      return kind === 'logo' ? area + 0.15 * sat : area * (0.35 + sat);
    };
    perSource.push(
      clusters
        .sort((a, b) => score(b) - score(a))
        .map((x) => ({ hex: rgbToHex(...labToRgb(x.c)), share: x.n / total, source: s })),
    );
  }
  // Round-robin across pictures, skipping near duplicates.
  const out: Swatch[] = [];
  const seen: Lab[] = [];
  for (let i = 0; out.length < count && perSource.some((l) => l.length > i); i++) {
    for (const list of perSource) {
      const sw = list[i];
      if (!sw || out.length >= count) continue;
      const lab = rgbToLab(...hexToRgb(sw.hex));
      if (seen.some((x) => dist(x, lab) < 10)) continue;
      seen.push(lab);
      out.push(sw);
    }
  }
  return out;
}

/**
 * Give swatches their roles: primary (dark enough for text, at least 4.5:1 on white), secondary,
 * accent (most saturated) and muted (most neutral).
 */
export function assignRoles(swatches: Swatch[]): Record<PaletteRole, string> {
  const hexes = swatches.map((s) => s.hex);
  if (!hexes.length) return { primary: '#1f3864', secondary: '#2e75b6', accent: '#c55a11', muted: '#7f7f7f' };
  const labOf = (h: string) => rgbToLab(...hexToRgb(h));
  const byChroma = [...hexes].sort((a, b) => chroma(labOf(b)) - chroma(labOf(a)));
  const readable = hexes.filter((h) => contrast(h, '#ffffff') >= 4.5);
  const primary = readable[0] ?? fixContrast(hexes[0]);
  const accent = byChroma.find((h) => h !== primary) ?? byChroma[0];
  const muted = [...hexes].sort((a, b) => chroma(labOf(a)) - chroma(labOf(b))).find((h) => h !== primary && h !== accent) ?? shade(primary, 35);
  const secondary = hexes.find((h) => h !== primary && h !== accent && h !== muted) ?? shade(primary, 18);
  return { primary, secondary, accent, muted };
}

/** A palette from the roles, with `source` naming where it came from. */
export function paletteFrom(roles: Record<PaletteRole, string>, name: string, source?: string): Palette & { source?: string } {
  return { id: `custom-${Date.now().toString(36)}`, name, ...roles, source };
}

/** The dark variant of a palette: the same hues, lightened to read on a dark page. */
export function darkVariant(p: Palette): Palette {
  const on = '#1f1f1f';
  return {
    ...p,
    id: `${p.id}-dark`,
    name: `${p.name} (dark)`,
    primary: fixContrast(p.primary, on),
    secondary: fixContrast(p.secondary, on, 3),
    accent: fixContrast(p.accent, on, 3),
    muted: fixContrast(p.muted, on, 3),
  };
}

/** Problems a palette has on a page colour (`#ffffff` by default). */
export function paletteWarnings(p: Palette, page = '#ffffff'): Array<{ role: PaletteRole; ratio: number; need: number }> {
  const need: Record<PaletteRole, number> = { primary: 4.5, secondary: 4.5, accent: 3, muted: 3 };
  return (['primary', 'secondary', 'accent', 'muted'] as PaletteRole[])
    .map((role) => ({ role, ratio: contrast(p[role], page), need: need[role] }))
    .filter((w) => w.ratio < w.need);
}

/** The palette with every role made readable on `page`. */
export function fixPalette(p: Palette, page = '#ffffff'): Palette {
  return {
    ...p,
    primary: fixContrast(p.primary, page, 4.5),
    secondary: fixContrast(p.secondary, page, 4.5),
    accent: fixContrast(p.accent, page, 3),
    muted: fixContrast(p.muted, page, 3),
  };
}

// ----- the document theme ---------------------------------------------------------------------

const hex6 = (h: string) => h.replace('#', '').toUpperCase().slice(0, 6);
const rgbParam = (hex: string) => ({ Rgb: hexToRgb(hex) });

export interface ThemeFonts {
  heading: string;
  body?: string;
}

/**
 * Write a palette as the document theme (Design › Colors shows it, and it is the colour scheme in
 * `word/theme/theme1.xml`), then colour the styles that use it: title, headings, hyperlinks,
 * quotes, the table header and the letterhead rule. With `scope: 'headings'` only the title and
 * headings change (the light option).
 */
export function applyTheme(editor: WordcraftEditor, p: Palette, options: { scope?: 'document' | 'headings'; fonts?: ThemeFonts; name?: string } = {}): void {
  const scope = options.scope ?? 'document';
  const style = (name: string, props: Record<string, unknown>) => {
    try {
      editor.execute('styles.modify', { style: name, ...props });
    } catch {
      // the document may not define every style
    }
  };
  if (scope === 'document') {
    try {
      editor.execute('design.themeColors', {
        name: options.name ?? p.name,
        colors: {
          dk2: hex6(p.primary),
          lt2: hex6(shade(p.muted, 45)),
          accent1: hex6(p.primary),
          accent2: hex6(p.secondary),
          accent3: hex6(p.accent),
          accent4: hex6(p.muted),
          accent5: hex6(shade(p.secondary, 20)),
          accent6: hex6(shade(p.accent, -15)),
          hlink: hex6(fixContrast(p.secondary)),
          folHlink: hex6(p.muted),
        },
      });
    } catch {
      // an older engine without custom theme colours: the styles below still change
    }
    if (options.fonts?.heading) {
      try {
        editor.execute('design.themeFonts', { heading: options.fonts.heading, body: options.fonts.body ?? options.fonts.heading });
      } catch {
        /* ignore */
      }
    }
  }
  style('Title', { chr: { color: rgbParam(p.primary) } });
  style('Heading 1', { chr: { color: rgbParam(p.primary) } });
  style('Heading 2', { chr: { color: rgbParam(p.secondary) } });
  style('Heading 3', { chr: { color: rgbParam(fixContrast(p.accent, '#ffffff', 3)) } });
  style('Heading 4', { chr: { color: rgbParam(p.secondary) } });
  style('Subtitle', { chr: { color: rgbParam(p.muted) } });
  if (scope === 'headings') return;
  style('Hyperlink', { chr: { color: rgbParam(fixContrast(p.secondary)) } });
  style('Intense Quote', { chr: { color: rgbParam(p.primary) } });
  style('Quote', { chr: { color: rgbParam(shade(p.muted, -10)) } });
}
