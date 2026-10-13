'use client';

/**
 * AI Studio's brand tools (Extras): a palette from a logo or photo, and where the logo goes, with
 * a live mini page that shows the placement.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent, ClipboardEvent, DragEvent } from 'react';

import type { Palette } from './ai-studio.js';
import { assignRoles, contrast, css, darkVariant, extractColors, fixPalette, paletteFrom, paletteWarnings } from './theme.js';
import type { PaletteRole, Swatch } from './theme.js';
import type { LogoPlacement, LogoSpec } from './letterhead.js';

const MAX = 1_500_000;

async function readAsDataUrl(b: Blob): Promise<string> {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(r.error);
    r.readAsDataURL(b);
  });
}

// ----- palette from pictures ------------------------------------------------------------------

export function PaletteFromImage({
  pickImage,
  initial,
  onSave,
  onApply,
  fonts,
}: {
  pickImage?: () => Promise<Blob | string | null>;
  /** A picture to start from (the letterhead's logo). */
  initial?: { src: string; name: string } | null;
  onSave: (p: Palette) => void;
  onApply: (p: Palette, scope: 'document' | 'headings', fonts?: { heading: string; body?: string }) => void;
  fonts?: { heading: string; body?: string };
}) {
  const [pics, setPics] = useState<Array<{ src: string; name: string }>>(() => (initial ? [initial] : []));
  const [swatches, setSwatches] = useState<Swatch[]>([]);
  const [roles, setRoles] = useState<Record<PaletteRole, string> | null>(null);
  const [armed, setArmed] = useState<PaletteRole | null>(null);
  const [dark, setDark] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [heading, setHeading] = useState(fonts?.heading ?? '');
  const [body, setBody] = useState(fonts?.body ?? '');
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pics.length) return;
    let live = true;
    setBusy(true);
    extractColors(pics.map((p) => p.src), { count: 7 })
      .then((sw) => {
        if (!live) return;
        setSwatches(sw);
        setRoles(assignRoles(sw));
        if (!name) setName(`From ${pics[0].name.replace(/\.[^.]+$/, '')}`);
      })
      .catch((e: unknown) => live && setNote(`Couldn’t read the picture: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [pics]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (blobs: Array<Blob | string>, names: string[]) => {
    const next: Array<{ src: string; name: string }> = [];
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      if (typeof b !== 'string' && b.size > MAX * 4) {
        setNote('Choose pictures under 6 MB.');
        continue;
      }
      next.push({ src: typeof b === 'string' ? b : await readAsDataUrl(b), name: names[i] ?? `picture ${pics.length + i + 1}` });
    }
    setPics((p) => [...p, ...next].slice(0, 4));
  };
  const onFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const fs = Array.from(e.target.files ?? []);
    e.target.value = '';
    void add(fs, fs.map((f) => f.name));
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const fs = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    void add(fs, fs.map((f) => f.name));
  };
  const onPaste = (e: ClipboardEvent) => {
    const fs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (fs.length) {
      e.preventDefault();
      void add(fs, fs.map(() => 'pasted picture'));
    }
  };

  const base: Palette | null = roles ? paletteFrom(roles, name || 'From a picture', pics.length ? `from ${pics.map((p) => p.name).join(' and ')}` : undefined) : null;
  const palette = base && dark ? darkVariant(base) : base;
  const page = dark ? '#1f1f1f' : '#ffffff';
  const warnings = palette ? paletteWarnings(palette, page) : [];

  return (
    <div className="wcbr" onPaste={onPaste}>
      <style>{CSS}</style>
      <div className="wcbr-drop" onDragOver={(e) => e.preventDefault()} onDrop={onDrop} tabIndex={0} aria-label="Drop or paste a logo or photo">
        {pics.length ? (
          <div className="wcbr-pics">
            {pics.map((p, i) => (
              <figure key={i}>
                <img src={p.src} alt={p.name} />
                <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setPics((l) => l.filter((_, k) => k !== i))}>
                  ✕
                </button>
              </figure>
            ))}
          </div>
        ) : (
          <span>Drop a logo or photo here, paste one, or</span>
        )}
        <span className="wcbr-row">
          <button type="button" className="wcai-btn" onClick={() => file.current?.click()}>
            {pics.length ? 'Add another' : 'Choose pictures'}
          </button>
          {pickImage && (
            <button
              type="button"
              className="wcai-btn"
              onClick={async () => {
                try {
                  const got = await pickImage();
                  if (got) void add([got], ['picture from your files']);
                } catch (e) {
                  setNote(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              From your files
            </button>
          )}
        </span>
        <input ref={file} type="file" accept="image/*" multiple hidden onChange={onFiles} />
      </div>
      {busy && <p className="wcai-note-inline">Reading colours…</p>}
      {swatches.length > 0 && palette && roles && (
        <>
          <div className="wcbr-swatches" role="list" aria-label="Colours found">
            {swatches.map((s, i) => (
              <button
                key={i}
                type="button"
                role="listitem"
                className="wcbr-swatch"
                title={`${s.hex} · ${Math.round(s.share * 100)}% of ${pics[s.source]?.name ?? 'the picture'}${armed ? ` · set as ${armed}` : ''}`}
                onClick={() => {
                  if (!armed) return setNote('Pick a role first (Primary, Secondary…), then a colour.');
                  setRoles({ ...roles, [armed]: s.hex });
                  setArmed(null);
                }}
              >
                <span style={{ background: s.hex }} />
                <small>{Math.round(s.share * 100)}%</small>
              </button>
            ))}
          </div>
          <div className="wcbr-roles">
            {(['primary', 'secondary', 'accent', 'muted'] as PaletteRole[]).map((r) => (
              <button key={r} type="button" aria-pressed={armed === r} className="wcbr-role" onClick={() => setArmed(armed === r ? null : r)}>
                <span style={{ background: css(palette[r]) }} />
                {r[0].toUpperCase() + r.slice(1)}
                <small>{contrast(css(palette[r]), page).toFixed(1)}:1</small>
              </button>
            ))}
          </div>
          <div className="wcbr-sample" style={{ background: page }}>
            <div style={{ color: css(palette.primary), fontSize: 18, fontWeight: 700 }}>Heading in primary</div>
            <div style={{ color: css(palette.secondary), fontWeight: 600 }}>Subheading in secondary</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <span style={{ background: css(palette.primary), color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>Table header</span>
              <span style={{ borderLeft: `3px solid ${css(palette.accent)}`, paddingLeft: 6, color: dark ? '#ddd' : '#333', fontSize: 11 }}>Callout bar</span>
              <span style={{ color: css(palette.muted), fontSize: 11 }}>Muted text</span>
            </div>
          </div>
          {warnings.length > 0 && (
            <p className="wcbr-warn" role="alert">
              {warnings.map((w) => `${w.role} is ${w.ratio.toFixed(1)}:1 (needs ${w.need}:1)`).join('; ')}.{' '}
              <button
                type="button"
                className="wcai-btn"
                onClick={() => {
                  if (!base) return;
                  const f = fixPalette(base, '#ffffff');
                  setRoles({ primary: css(f.primary), secondary: css(f.secondary), accent: css(f.accent), muted: css(f.muted) });
                }}
              >
                Fix contrast
              </button>
            </p>
          )}
          <div className="wcbr-row">
            <label className="wcai-check">
              <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> Dark variant
            </label>
            <input className="wcbr-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Palette name" placeholder="Palette name" />
          </div>
          <div className="wcbr-row">
            <input className="wcbr-name" value={heading} onChange={(e) => setHeading(e.target.value)} aria-label="Heading font" placeholder="Heading font (optional)" />
            <input className="wcbr-name" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Body font" placeholder="Body font (optional)" />
          </div>
          <div className="wcbr-row wcbr-end">
            <button type="button" className="wcai-btn wcai-ghost" onClick={() => (onSave(palette), setNote(`Saved “${palette.name}”.`))}>
              Save palette
            </button>
            <button type="button" className="wcai-btn" onClick={() => onApply(palette, 'headings')}>
              Apply to headings only
            </button>
            <button type="button" className="wcai-btn wcai-primary" onClick={() => onApply(palette, 'document', heading.trim() ? { heading: heading.trim(), body: body.trim() || undefined } : undefined)}>
              Apply to document
            </button>
          </div>
        </>
      )}
      {note && (
        <p className="wcai-note-inline" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

// ----- logo placement -------------------------------------------------------------------------

export const PLACEMENTS: Array<{ id: LogoPlacement; label: string }> = [
  { id: 'header-left', label: 'Header left' },
  { id: 'header-center', label: 'Header centre' },
  { id: 'header-right', label: 'Header right' },
  { id: 'header-logo-left-text-right', label: 'Logo left, text right' },
  { id: 'header-text-left-logo-right', label: 'Text left, logo right' },
  { id: 'header-stacked', label: 'Logo above text' },
  { id: 'footer-left', label: 'Footer left' },
  { id: 'footer-center', label: 'Footer centre' },
  { id: 'footer-right', label: 'Footer right' },
  { id: 'watermark', label: 'Watermark' },
  { id: 'cover', label: 'Cover page' },
  { id: 'side-left', label: 'Left edge' },
  { id: 'side-right', label: 'Right edge' },
  { id: 'inline', label: 'At the cursor' },
  { id: 'signature', label: 'Signature block' },
];

/** A thumbnail page showing where the logo goes. */
export function MiniPage({ placement, src, opacity = 1, rotation = 0, accent = '#3d6d99', size = 1 }: { placement: LogoPlacement; src?: string; opacity?: number; rotation?: number; accent?: string; size?: number }) {
  const logo = (style: CSSProperties) => (src ? <img src={src} alt="" style={{ position: 'absolute', objectFit: 'contain', ...style }} /> : <span style={{ position: 'absolute', background: accent, borderRadius: 2, ...style }} />);
  const lines = (top: number) => (
    <div style={{ position: 'absolute', left: 10, right: 10, top, display: 'grid', gap: 4 }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ height: 3, borderRadius: 2, background: '#d5d8dc', width: i === 5 ? '60%' : '100%' }} />
      ))}
    </div>
  );
  const w = Math.round(18 * size);
  const text = (align: 'left' | 'right' | 'center', left = 10, right = 10, top = 8) => (
    <div style={{ position: 'absolute', left, right, top, display: 'grid', gap: 2, justifyItems: align === 'center' ? 'center' : align === 'right' ? 'end' : 'start' }}>
      <span style={{ height: 4, width: 34, background: accent, borderRadius: 2 }} />
      <span style={{ height: 2, width: 24, background: '#b9bec4', borderRadius: 2 }} />
    </div>
  );
  let body = lines(34);
  let extra = null;
  switch (placement) {
    case 'header-left':
    case 'header-center':
    case 'header-right':
    case 'header-stacked': {
      const a = placement === 'header-center' ? 'center' : placement === 'header-right' ? 'right' : 'left';
      const left = a === 'left' ? 10 : a === 'right' ? 70 - w : 45 - w / 2;
      extra = (
        <>
          {logo({ left, top: 6, width: w, height: 10 })}
          {text(a, 10, 10, 18)}
        </>
      );
      break;
    }
    case 'header-logo-left-text-right':
      extra = (
        <>
          {logo({ left: 10, top: 6, width: w, height: 14 })}
          {text('right', 30, 10, 8)}
        </>
      );
      break;
    case 'header-text-left-logo-right':
      extra = (
        <>
          {text('left', 10, 30, 8)}
          {logo({ right: 10, top: 6, width: w, height: 14 })}
        </>
      );
      break;
    case 'footer-left':
    case 'footer-center':
    case 'footer-right': {
      const a = placement === 'footer-center' ? 'center' : placement === 'footer-right' ? 'right' : 'left';
      extra = (
        <>
          {text('left')}
          {logo({ left: a === 'left' ? 10 : a === 'right' ? 70 - w : 45 - w / 2, bottom: 6, width: w, height: 9 })}
        </>
      );
      break;
    }
    case 'watermark':
      extra = (
        <>
          {text('left')}
          {logo({ left: 20, top: 40, width: 50, height: 40, opacity, transform: `rotate(${rotation}deg)` })}
        </>
      );
      break;
    case 'cover':
      body = <span />;
      extra = (
        <>
          {logo({ left: 25, top: 26, width: 40, height: 30 })}
          <span style={{ position: 'absolute', left: 20, right: 20, top: 66, height: 5, background: accent, borderRadius: 2 }} />
          <span style={{ position: 'absolute', left: 30, right: 30, top: 76, height: 3, background: '#b9bec4', borderRadius: 2 }} />
        </>
      );
      break;
    case 'side-left':
    case 'side-right':
      extra = (
        <>
          {text('left')}
          {logo({ [placement === 'side-left' ? 'left' : 'right']: 1, top: 40, width: 8, height: 40 })}
        </>
      );
      break;
    case 'inline':
      extra = (
        <>
          {text('left')}
          {logo({ left: 10, top: 56, width: 26, height: 14 })}
        </>
      );
      break;
    case 'signature':
      extra = (
        <>
          {text('left')}
          {logo({ left: 10, bottom: 18, width: 20, height: 10 })}
          <span style={{ position: 'absolute', left: 10, bottom: 12, width: 30, height: 1, background: '#555' }} />
        </>
      );
      break;
  }
  return (
    <span className="wcbr-page" aria-hidden="true">
      {body}
      {extra}
    </span>
  );
}

/** A size that suits the placement when switching to it: a header logo is small, a watermark or cover large. */
function sizeFor(to: LogoPlacement, spec: LogoSpec): Partial<LogoSpec> {
  const size = spec.size ?? 48;
  const big = to === 'watermark' || to === 'cover';
  if (big && size < 120) return { size: to === 'watermark' ? 300 : 200 };
  if (!big && size > 200) return { size: to.startsWith('side') ? 60 : 48 };
  return {};
}

export function LogoPlacementControls({ spec, onChange, disabled, accent }: { spec: LogoSpec; onChange: (s: LogoSpec) => void; disabled?: boolean; accent?: string }) {
  const placement = spec.placement ?? 'header-left';
  const wm = placement === 'watermark';
  const floating = wm || placement.startsWith('side');
  const set = (patch: Partial<LogoSpec>) => !disabled && onChange({ ...spec, ...patch });
  const cm = ((spec.size ?? (wm ? 300 : 48)) / 28.35).toFixed(1);
  return (
    <div className="wcbr">
      <style>{CSS}</style>
      <div className="wcbr-places" role="radiogroup" aria-label="Logo placement">
        {PLACEMENTS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={placement === p.id} className="wcbr-place" disabled={disabled} onClick={() => set({ placement: p.id, ...sizeFor(p.id, spec), ...(p.id === 'watermark' && spec.opacity === undefined ? { opacity: 0.15 } : {}) })}>
            <MiniPage placement={p.id} src={spec.src} opacity={p.id === 'watermark' ? (spec.opacity ?? 0.15) : 1} rotation={spec.rotation ?? 0} accent={accent} />
            <small>{p.label}</small>
          </button>
        ))}
      </div>
      <div className="wcbr-grid">
        <label className="wcai-field">
          Width ({cm} cm)
          <input type="range" min={12} max={wm ? 480 : 260} step={2} value={spec.size ?? (wm ? 300 : 48)} disabled={disabled} onChange={(e) => set({ size: Number(e.target.value) })} />
        </label>
        {(placement.startsWith('header') || placement.startsWith('footer') || wm || placement.startsWith('side')) && (
          <label className="wcai-field">
            Pages
            <select value={spec.pages ?? 'all'} disabled={disabled} onChange={(e) => set({ pages: e.target.value as LogoSpec['pages'] })}>
              <option value="all">Every page</option>
              <option value="first">First page only</option>
              <option value="odd">Odd pages</option>
              <option value="even">Even pages</option>
            </select>
          </label>
        )}
        {wm && (
          <>
            <label className="wcai-field">
              Opacity ({Math.round((spec.opacity ?? 0.15) * 100)}%)
              <input type="range" min={5} max={40} value={Math.round((spec.opacity ?? 0.15) * 100)} disabled={disabled} onChange={(e) => set({ opacity: Number(e.target.value) / 100 })} />
            </label>
            <label className="wcai-check">
              <input type="checkbox" checked={(spec.rotation ?? 0) !== 0} disabled={disabled} onChange={(e) => set({ rotation: e.target.checked ? -45 : 0 })} /> Diagonal
            </label>
            <label className="wcai-check">
              <input type="checkbox" checked={!!spec.repeat} disabled={disabled} onChange={(e) => set({ repeat: e.target.checked })} /> Repeat down the page
            </label>
          </>
        )}
        {floating && (
          <label className="wcai-field">
            Wrap
            <select value={spec.wrap ?? 'behind'} disabled={disabled} onChange={(e) => set({ wrap: e.target.value as LogoSpec['wrap'] })}>
              <option value="behind">Behind text</option>
              <option value="front">In front of text</option>
            </select>
          </label>
        )}
        {floating && (
          <label className="wcai-field">
            Offset (pt)
            <span className="wcbr-row">
              <input type="number" aria-label="Horizontal offset" value={spec.offset?.x ?? ''} placeholder="x" disabled={disabled} onChange={(e) => set({ offset: { ...spec.offset, x: e.target.value === '' ? undefined : Number(e.target.value) } })} />
              <input type="number" aria-label="Vertical offset" value={spec.offset?.y ?? ''} placeholder="y" disabled={disabled} onChange={(e) => set({ offset: { ...spec.offset, y: e.target.value === '' ? undefined : Number(e.target.value) } })} />
            </span>
          </label>
        )}
      </div>
    </div>
  );
}

const CSS = `
.wcbr{display:grid;gap:10px}
.wcbr-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.wcbr-end{justify-content:flex-end}
.wcbr-drop{display:grid;gap:8px;justify-items:center;padding:14px;border:1.5px dashed var(--line,#c4c7c5);border-radius:14px;color:var(--dim,#5f6368);font-size:13px;text-align:center}
.wcbr-drop:focus{outline:2px solid var(--accent,#0b57d0)}
.wcbr-pics{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.wcbr-pics figure{position:relative;margin:0;width:72px;height:56px;border-radius:8px;background:#fff;border:1px solid var(--line,#dadce0);display:grid;place-items:center}
.wcbr-pics img{max-width:64px;max-height:48px;object-fit:contain}
.wcbr-pics button{position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:10px;border:1px solid var(--line,#dadce0);background:var(--bg,#fff);color:inherit;font-size:10px;cursor:pointer}
.wcbr-swatches{display:flex;flex-wrap:wrap;gap:8px}
.wcbr-swatch{display:grid;justify-items:center;gap:2px;padding:0;border:0;background:none;color:inherit;cursor:pointer}
.wcbr-swatch span{width:34px;height:34px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)}
.wcbr-swatch small{font-size:10px;color:var(--dim,#5f6368)}
.wcbr-roles{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:6px}
.wcbr-role{display:flex;align-items:center;gap:6px;height:34px;padding:0 10px;border:1px solid var(--line,#dadce0);border-radius:10px;background:none;color:inherit;cursor:pointer;font:inherit;font-size:12px}
.wcbr-role[aria-pressed=true]{border-color:var(--accent,#0b57d0);box-shadow:0 0 0 2px var(--accent-soft,#e8f0fe)}
.wcbr-role span{width:16px;height:16px;border-radius:4px}
.wcbr-role small{margin-left:auto;color:var(--dim,#5f6368)}
.wcbr-sample{padding:12px;border:1px solid var(--line,#dadce0);border-radius:10px}
.wcbr-warn{margin:0;padding:8px 10px;border-radius:8px;background:#fef7e0;color:#7a4b00;font-size:12px}
.wcbr-name{flex:1;min-width:120px;height:32px;padding:0 10px;border:1px solid var(--line,#dadce0);border-radius:8px;background:var(--bg,#fff);color:inherit;font:inherit;font-size:13px}
.wcbr-places{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:6px}
.wcbr-place{display:grid;justify-items:center;gap:4px;padding:6px 4px;border:1px solid var(--line,#dadce0);border-radius:10px;background:none;color:inherit;cursor:pointer;font:inherit}
.wcbr-place[aria-checked=true]{border-color:var(--accent,#0b57d0);box-shadow:0 0 0 2px var(--accent-soft,#e8f0fe)}
.wcbr-place small{font-size:10.5px;text-align:center;line-height:1.2}
.wcbr-page{position:relative;display:block;width:90px;height:116px;border-radius:4px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.18);overflow:hidden}
.wcbr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;align-items:end}
.wcbr-grid input[type=number]{width:64px;height:30px;border:1px solid var(--line,#dadce0);border-radius:8px;background:var(--bg,#fff);color:inherit;padding:0 6px}
`;
