/**
 * Fonts on demand. The browser build ships only a few fonts, so the font box also lists fonts an
 * app can fetch when someone picks one, as Word does with cloud fonts. `googleFonts()` offers the
 * whole Google Fonts library (about 1,900 families, all openly licensed) through the Fontsource
 * CDN; you can also pass your own `FontSource`.
 */

/** A provider of fonts the editor can fetch on demand. */
export interface FontSource {
  /** Family names to list in the font box. */
  families(): string[] | Promise<string[]>;
  /** Font files (TTF/OTF bytes) for `family`: regular, and bold/italic when there are any. */
  load(family: string): Promise<Uint8Array[]>;
}

export interface GoogleFontsOptions {
  /**
   * Where the files come from. `{id}`, `{subset}`, `{weight}` and `{style}` are filled in.
   * Default: the Fontsource CDN on jsDelivr.
   */
  urlTemplate?: string;
  /** Only list these categories (`sans-serif`, `serif`, `display`, `handwriting`, `monospace`). */
  categories?: string[];
  /** Only list these families. */
  only?: string[];
}

const CATEGORY: Record<string, string> = { s: 'sans-serif', r: 'serif', d: 'display', h: 'handwriting', m: 'monospace' };
const DEFAULT_URL = 'https://cdn.jsdelivr.net/fontsource/fonts/{id}@latest/{subset}-{weight}-{style}.ttf';

/** The Google Fonts library, fetched as each family is first picked. */
export function googleFonts(options: GoogleFontsOptions = {}): FontSource {
  const template = options.urlTemplate ?? DEFAULT_URL;
  let rows: Promise<Map<string, { id: string; bold: boolean; italic: boolean; subset: string; category: string }>> | null = null;
  const catalog = () =>
    (rows ??= import('./google-fonts.js').then(({ GOOGLE_FONTS }) => {
      const m = new Map<string, { id: string; bold: boolean; italic: boolean; subset: string; category: string }>();
      for (const [family, id, cat, flags, subset] of GOOGLE_FONTS) {
        m.set(family, {
          id: id || family.toLowerCase().replace(/ /g, '-'),
          bold: (flags ?? '').includes('b'),
          italic: (flags ?? '').includes('i'),
          subset: subset || 'latin',
          category: CATEGORY[cat ?? 's'] ?? 'sans-serif',
        });
      }
      return m;
    }));
  return {
    async families() {
      const m = await catalog();
      let names = [...m.keys()];
      if (options.categories) names = names.filter((n) => options.categories!.includes(m.get(n)!.category));
      if (options.only) names = names.filter((n) => options.only!.includes(n));
      return names;
    },
    async load(family) {
      const f = (await catalog()).get(family);
      if (!f) throw new Error(`${family} isn't a Google Font`);
      const url = (weight: number, style: string) =>
        template.replace('{id}', f.id).replace('{subset}', f.subset).replace('{weight}', String(weight)).replace('{style}', style);
      const wanted: Array<[number, string]> = [[400, 'normal']];
      if (f.bold) wanted.push([700, 'normal']);
      if (f.italic) wanted.push([400, 'italic']);
      if (f.bold && f.italic) wanted.push([700, 'italic']);
      const files: Array<Uint8Array | null> = await Promise.all(
        wanted.map(async ([w, s]): Promise<Uint8Array | null> => {
          const res = await fetch(url(w, s));
          return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
        }),
      );
      const ok: Uint8Array[] = [];
      for (const b of files) if (b && b.byteLength > 0) ok.push(b);
      if (!ok.length) throw new Error(`couldn't download ${family}`);
      return ok;
    },
  };
}

const RECENT_KEY = 'wordcraft.recentFonts';

/** Recently used fonts kept in this browser (Word keeps them per user too). */
export function readRecentFonts(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 10) : [];
  } catch {
    return [];
  }
}

export function writeRecentFonts(fonts: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(fonts.slice(0, 10)));
  } catch {
    // Storage unavailable (private mode, sandboxed iframe): recent fonts last for this visit.
  }
}
