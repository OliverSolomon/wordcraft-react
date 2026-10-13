/**
 * Logo placement (an Extra): where a letterhead's logo goes (header left, centre or right, beside
 * the organisation text or stacked above it, footer, first page only, odd or even pages, a
 * watermark behind the text, a cover page, a side edge, the cursor, a signature block) and a row
 * of partner logos. Everything is written as ordinary Word structure: pictures in the header or
 * footer, borderless header tables, Different First Page and Odd & Even headers.
 */
import type { WordcraftEditor } from './core.js';
import type { Letterhead, Palette } from './ai-studio.js';
import { esc } from './blocks.js';
import { css } from './theme.js';

export type LogoPlacement =
  | 'header-left'
  | 'header-center'
  | 'header-right'
  | 'header-logo-left-text-right'
  | 'header-text-left-logo-right'
  | 'header-stacked'
  | 'footer-left'
  | 'footer-center'
  | 'footer-right'
  | 'watermark'
  | 'cover'
  | 'side-left'
  | 'side-right'
  | 'inline'
  | 'signature';

export interface LogoSpec {
  /** A data URL (PNG, JPEG, GIF, WebP or SVG; SVG becomes PNG). */
  src: string;
  placement?: LogoPlacement;
  /** Width in points (1 cm is about 28.35 pt). Default 48 (watermark 300, cover 200). */
  size?: number;
  /** Offset in points from the preset position (side edge and watermark). */
  offset?: { x?: number; y?: number };
  /** 0.05 to 1. Default 1 (watermark 0.15). */
  opacity?: number;
  /** Degrees: 0 or -45 for a watermark. */
  rotation?: number;
  wrap?: 'inline' | 'behind' | 'front';
  /** Which pages carry it (header and footer placements). Default `all`. */
  pages?: 'all' | 'first' | 'odd' | 'even';
  /** Repeat a watermark as a tile (three down the page). */
  repeat?: boolean;
}

/** The letterhead's logo as a spec (a plain string keeps the old behaviour: above the text, aligned with it). */
export function logoSpec(lh: Letterhead): LogoSpec | null {
  const l = (lh as Letterhead & { logo?: string | LogoSpec }).logo;
  if (!l) return null;
  if (typeof l === 'string') return { src: l, placement: lh.align === 'center' ? 'header-center' : lh.align === 'right' ? 'header-right' : 'header-left', size: lh.logoWidth ?? 48 };
  return { size: lh.logoWidth, ...l };
}

const MAX_LOGO = 1_500_000;

/**
 * Get a picture ready to place: SVG and anything else become PNG, transparent margins are trimmed,
 * a white background can be made transparent, opacity and rotation are baked in (so Word, Google
 * Docs and LibreOffice all show the same thing), and the size is capped.
 */
export async function prepareImage(src: string, opts: { trim?: boolean; removeWhite?: boolean; opacity?: number; rotation?: number; maxSide?: number } = {}): Promise<{ data: string; width: number; height: number }> {
  if (src.length > MAX_LOGO * 1.4) throw new Error('The picture is too large (1.5 MB at most).');
  const img = new Image();
  img.src = src;
  await img.decode();
  const maxSide = opts.maxSide ?? 1200;
  let w = img.naturalWidth || 300, h = img.naturalHeight || 150;
  const k = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * k));
  h = Math.max(1, Math.round(h * k));
  let c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  let ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.drawImage(img, 0, 0, w, h);
  if (opts.removeWhite || opts.trim !== false) {
    const d = ctx.getImageData(0, 0, w, h);
    const px = d.data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (opts.removeWhite && px[i] > 242 && px[i + 1] > 242 && px[i + 2] > 242) px[i + 3] = 0;
        if (px[i + 3] > 12) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    ctx.putImageData(d, 0, 0);
    if (opts.trim !== false && maxX >= minX && (minX > 0 || minY > 0 || maxX < w - 1 || maxY < h - 1)) {
      const t = document.createElement('canvas');
      t.width = maxX - minX + 1;
      t.height = maxY - minY + 1;
      t.getContext('2d')?.drawImage(c, minX, minY, t.width, t.height, 0, 0, t.width, t.height);
      c = t;
      w = t.width;
      h = t.height;
    }
  }
  const alpha = Math.max(0.05, Math.min(1, opts.opacity ?? 1));
  const deg = opts.rotation ?? 0;
  if (alpha < 1 || deg) {
    const rad = (deg * Math.PI) / 180;
    const rw = Math.ceil(Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad)));
    const rh = Math.ceil(Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad)));
    const r = document.createElement('canvas');
    r.width = rw;
    r.height = rh;
    ctx = r.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    ctx.globalAlpha = alpha;
    ctx.translate(rw / 2, rh / 2);
    ctx.rotate(rad);
    ctx.drawImage(c, -w / 2, -h / 2);
    c = r;
    w = rw;
    h = rh;
  }
  const url = c.toDataURL('image/png');
  return { data: url.slice(url.indexOf(',') + 1), width: w, height: h };
}

const lastKinds = new WeakMap<WordcraftEditor, Set<string>>();

const run = (editor: WordcraftEditor, cmd: string, params?: Record<string, unknown>) => editor.execute(cmd, params);

/** Clear a header or footer story (it keeps existing, empty). */
function clearStory(editor: WordcraftEditor, footer: boolean, kind: 'default' | 'first' | 'even') {
  run(editor, footer ? 'insert.editFooter' : 'insert.editHeader', { kind });
  try {
    run(editor, 'select.all');
    run(editor, 'text.delete');
    run(editor, 'para.borders', { kind: 'none' });
  } finally {
    run(editor, 'insert.closeHeader');
  }
}

function textHtml(lh: Letterhead, p: Palette, align: string): string {
  const font = lh.font?.trim() ? `font-family:'${lh.font.trim().replace(/'/g, '')}';` : '';
  const lines = [
    `<p style="text-align:${align};margin:0"><span style="${font}font-size:20pt;font-weight:bold;color:${css(p.primary)}">${esc(lh.name)}</span></p>`,
    lh.tagline ? `<p style="text-align:${align};margin:0"><span style="${font}font-size:11pt;font-style:italic;color:${css(p.secondary)}">${esc(lh.tagline)}</span></p>` : '',
    lh.address || lh.contact ? `<p style="text-align:${align};margin:0"><span style="${font}font-size:9pt;color:${css(p.muted)}">${esc([lh.address, lh.contact].filter(Boolean).join(' · '))}</span></p>` : '',
  ];
  return lines.join('');
}

/**
 * Write the letterhead (with its logo where `logo.placement` says, and partner logos) into the
 * document, replacing what an earlier apply wrote, never stacking.
 */
export async function applyLetterheadPlaced(editor: WordcraftEditor, lh: Letterhead & { partners?: string[] }, p: Palette): Promise<void> {
  const logo = logoSpec(lh);
  const placement: LogoPlacement = logo?.placement ?? 'header-stacked';
  const pages = logo?.pages ?? 'all';
  const kind: 'default' | 'first' | 'even' = pages === 'first' ? 'first' : pages === 'even' ? 'even' : 'default';
  const align = lh.align ?? 'left';

  // Replace, never stack: clear every header or footer an earlier apply wrote.
  const before = lastKinds.get(editor) ?? new Set<string>(['header:default']);
  const now = new Set<string>([`header:${kind}`]);
  if (placement.startsWith('footer')) now.add(`footer:${kind}`);
  for (const k of new Set([...before, ...now])) {
    const [part, kk] = k.split(':') as ['header' | 'footer', 'default' | 'first' | 'even'];
    if (kk !== 'default' || part === 'header' || before.has(k)) {
      try {
        clearStory(editor, part === 'footer', kk);
      } catch {
        /* an engine without first/even headers: the default one is cleared below */
      }
    }
  }
  lastKinds.set(editor, now);

  const pic = async (spec: LogoSpec, extra: { opacity?: number; rotation?: number } = {}) =>
    prepareImage(spec.src, { opacity: extra.opacity ?? spec.opacity, rotation: extra.rotation ?? spec.rotation, removeWhite: false });
  const insertPic = async (spec: LogoSpec, width: number, alt: string, extra: { opacity?: number; rotation?: number } = {}) => {
    const img = await pic(spec, extra);
    run(editor, 'insert.picture', { data: img.data, width, alt });
    return img;
  };

  // ----- the header (or the header part of a footer layout) -----
  run(editor, 'insert.editHeader', { kind });
  try {
    run(editor, 'select.all');
    run(editor, 'para.borders', { kind: 'none' });
    run(editor, 'para.spacing', { before: 0, after: 0 });
    const width = logo?.size ?? 48;
    const sideBySide = placement === 'header-logo-left-text-right' || placement === 'header-text-left-logo-right';
    if (logo && sideBySide) {
      const img = await pic(logo);
      const logoCell = `<td style="width:${width + 12}pt"><p style="text-align:${placement === 'header-logo-left-text-right' ? 'left' : 'right'}"><img src="data:image/png;base64,${img.data}" width="${Math.round(width / 0.75)}" alt="${esc(lh.name)} logo"></p></td>`;
      const textCell = `<td>${textHtml(lh, p, placement === 'header-logo-left-text-right' ? 'right' : 'left')}</td>`;
      run(editor, 'edit.pasteSpecial', { as: 'html', html: `<html><body><table border="0"><tr>${placement === 'header-logo-left-text-right' ? logoCell + textCell : textCell + logoCell}</tr></table></body></html>` });
    } else {
      if (logo && (placement.startsWith('header') || placement === 'header-stacked')) {
        const a = placement === 'header-center' ? 'center' : placement === 'header-right' ? 'right' : placement === 'header-stacked' ? align : 'left';
        run(editor, 'para.align', { value: a });
        await insertPic(logo, width, `${lh.name} logo`);
        run(editor, 'caret.right');
        run(editor, 'text.newParagraph');
      }
      run(editor, 'edit.pasteSpecial', { as: 'html', html: `<html><body>${textHtml(lh, p, align)}</body></html>` });
    }
    if (lh.rule !== false) {
      run(editor, 'para.borders', { kind: 'bottom', width: 1.5, color: p.accent.replace('#', '') });
      run(editor, 'para.spacing', { before: 0, after: 12 });
    }
    // Partner logos: one row, evenly spaced, under the letterhead.
    if (lh.partners?.length) {
      const cells = await Promise.all(lh.partners.slice(0, 6).map(async (src, i) => {
        const img = await prepareImage(src);
        return `<td><p style="text-align:center"><img src="data:image/png;base64,${img.data}" width="${Math.round(36 / 0.75)}" alt="Partner logo ${i + 1}"></p></td>`;
      }));
      run(editor, 'text.newParagraph');
      run(editor, 'edit.pasteSpecial', { as: 'html', html: `<html><body><table border="0"><tr>${cells.join('')}</tr></table></body></html>` });
    }
    // A watermark or a side strip: a picture behind the text, anchored in the header so it is on every page.
    if (logo && (placement === 'watermark' || placement === 'side-left' || placement === 'side-right')) {
      run(editor, 'text.newParagraph');
      const wm = placement === 'watermark';
      const count = wm && logo.repeat ? 3 : 1;
      for (let i = 0; i < count; i++) {
        await insertPic(logo, logo.size ?? (wm ? 300 : 60), `${lh.name} ${wm ? 'watermark' : 'logo'}`, wm ? { opacity: logo.opacity ?? 0.15, rotation: logo.rotation ?? 0 } : {});
        run(editor, 'arrange.wrap', { wrap: logo.wrap === 'front' ? 'inFrontOfText' : 'behindText' });
        const preset = wm ? (count === 1 ? 'middleCenter' : (['topCenter', 'middleCenter', 'bottomCenter'] as const)[i]) : placement === 'side-left' ? 'middleLeft' : 'middleRight';
        const x = logo.offset?.x, y = logo.offset?.y;
        run(editor, 'arrange.position', { preset, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}) });
        run(editor, 'arrange.moveWithText', { value: false });
        run(editor, 'caret.right');
      }
    }
  } finally {
    run(editor, 'insert.closeHeader');
  }

  // ----- footer -----
  if (logo && placement.startsWith('footer')) {
    run(editor, 'insert.editFooter', { kind });
    try {
      run(editor, 'select.all');
      run(editor, 'text.delete');
      run(editor, 'para.align', { value: placement === 'footer-center' ? 'center' : placement === 'footer-right' ? 'right' : 'left' });
      await insertPic(logo, logo.size ?? 36, `${lh.name} logo`);
      run(editor, 'caret.right');
    } finally {
      run(editor, 'insert.closeHeader');
    }
  }

  // ----- body placements -----
  if (logo && (placement === 'inline' || placement === 'signature')) {
    if (placement === 'signature') {
      run(editor, 'caret.docEnd');
      run(editor, 'text.newParagraph');
    }
    await insertPic(logo, logo.size ?? (placement === 'signature' ? 72 : 120), `${lh.name} logo`);
    run(editor, 'caret.right');
    if (placement === 'signature') {
      run(editor, 'text.newParagraph');
      run(editor, 'text.insert', { text: lh.name });
    }
  }
  if (logo && placement === 'cover') {
    run(editor, 'caret.docStart');
    run(editor, 'insert.coverPage', { title: lh.name, subtitle: lh.tagline ?? '', author: [lh.address, lh.contact].filter(Boolean).join(' · ') });
    run(editor, 'caret.docStart');
    run(editor, 'para.align', { value: 'center' });
    await insertPic(logo, logo.size ?? 200, `${lh.name} logo`);
    run(editor, 'caret.right');
    run(editor, 'text.newParagraph');
  }
}

/** Remove the letterhead: every header and footer an apply wrote, and the watermark with them. */
export function removeLetterheadPlaced(editor: WordcraftEditor): void {
  const kinds = lastKinds.get(editor) ?? new Set(['header:default']);
  for (const k of kinds) {
    const [part, kind] = k.split(':') as ['header' | 'footer', 'default' | 'first' | 'even'];
    try {
      if (kind === 'default') run(editor, part === 'footer' ? 'insert.removeFooter' : 'insert.removeHeader');
      else clearStory(editor, part === 'footer', kind);
    } catch {
      /* already gone */
    }
  }
  lastKinds.delete(editor);
}
