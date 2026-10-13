/**
 * AI Studio (an Extra: not part of Microsoft Word or WordCraft). Settings the AI bar uses when
 * it writes, kept per person in their browser:
 *
 * - **Skills:** writing instructions added to every request. The Humaniser is on by default;
 *   people can turn on others, write their own, or import a `SKILL.md`.
 * - **Letterhead:** an organisation's name, tagline, contact line and logo, put into the
 *   document's header, and given to the AI as context.
 * - **Palette:** brand colours for the headings and the letterhead.
 *
 * Server-safe: no React, no DOM at import time.
 */
import type { WordcraftEditor } from './core.js';

/** A writing skill: instructions the AI follows on every request while it is on. */
export interface AiSkill {
  id: string;
  name: string;
  /** One line shown under the name. */
  description?: string;
  /** What the AI should do, in plain words. */
  instructions: string;
}

/** An organisation's letterhead, placed in the document header. */
export interface Letterhead {
  /** Organisation or person, the large first line. */
  name: string;
  tagline?: string;
  /** Postal address, one line. */
  address?: string;
  /** Email, phone, website: one line. */
  contact?: string;
  /** Logo as a data URL (`data:image/png;base64,…`). */
  logo?: string;
  /** Logo width in points. Default 48. */
  logoWidth?: number;
  align?: 'left' | 'center' | 'right';
  /** Font family for the letterhead (any font in the font box, Google Fonts included). */
  font?: string;
  /** Draw a rule in the palette's accent colour under the letterhead. Default true. */
  rule?: boolean;
}

/** Brand colours as `RRGGBB` hex. */
export interface Palette {
  id: string;
  name: string;
  /** Titles, Heading 1 and the letterhead name. */
  primary: string;
  /** Heading 2, the tagline. */
  secondary: string;
  /** Heading 3, the letterhead rule. */
  accent: string;
  /** Subtitles and the contact line. */
  muted: string;
}

/** Everything the studio keeps for a person. */
export interface AiStudioState {
  /** Ids of the skills that are on. */
  enabled: string[];
  /** Skills the person wrote or imported. */
  custom: AiSkill[];
  /**
   * The person's own letterhead, saved only once they changed something and it has a name. The
   * organisation's (`ai.letterhead`) applies whenever there is none: see [`effectiveLetterhead`].
   */
  letterheadOverride: Letterhead | null;
  /** Id of the chosen palette. */
  palette: string;
  /** The person's own palette (id `custom`). */
  customPalette?: Palette;
}

export const HUMANISER: AiSkill = {
  id: 'humaniser',
  name: 'Humaniser',
  description: 'Natural, human-sounding prose without AI tells',
  instructions: [
    'Write like a thoughtful person, not a machine.',
    'Vary sentence length and rhythm, and prefer plain, specific words to abstract ones. Use the active voice.',
    'Cut filler, hedging and stock phrases such as "delve", "tapestry", "landscape", "unlock", "elevate", "seamless", "robust", "in today\'s fast-paced world" and "it\'s important to note".',
    'Never use em dashes; use commas, full stops, colons or parentheses instead.',
    'Avoid reflexive lists of three, rhetorical questions, and closing sentences that restate what was just said.',
    'Keep the writer\'s voice and facts, and never invent details.',
  ].join(' '),
};

export const BUILT_IN_SKILLS: AiSkill[] = [
  HUMANISER,
  {
    id: 'plain-english',
    name: 'Plain English',
    description: 'Short words, short sentences, no jargon',
    instructions: 'Use plain English: everyday words, sentences under 20 words on average, and no jargon or acronyms without explanation. Address the reader as "you" where it fits.',
  },
  {
    id: 'concise',
    name: 'Concise',
    description: 'Say it in fewer words',
    instructions: 'Be concise. Keep only what the reader needs, lead with the main point, and remove repetition and throat-clearing.',
  },
  {
    id: 'persuasive',
    name: 'Persuasive',
    description: 'Clear case, evidence, call to action',
    instructions: 'Write persuasively: state the case early, support it with concrete evidence or examples from the document, answer the obvious objection, and end with a clear next step.',
  },
  {
    id: 'academic',
    name: 'Academic',
    description: 'Formal, precise, hedged where needed',
    instructions: 'Use a formal academic register: precise terms, careful claims hedged only where the evidence is uncertain, no contractions, and no first person unless the document already uses it.',
  },
  {
    id: 'warm',
    name: 'Warm & friendly',
    description: 'Approachable and encouraging',
    instructions: 'Use a warm, friendly tone: approachable, encouraging and respectful, with contractions, without being casual about serious matters.',
  },
  {
    id: 'british',
    name: 'British English',
    description: 'UK spelling and conventions',
    instructions: 'Use British English spelling and conventions (organise, colour, centre, programme, licence as a noun), day-month-year dates, and single quotation marks.',
  },
];

export const BUILT_IN_PALETTES: Palette[] = [
  { id: 'office', name: 'Office', primary: '0F4761', secondary: '156082', accent: 'E97132', muted: '595959' },
  { id: 'ocean', name: 'Ocean', primary: '023E8A', secondary: '0077B6', accent: '00B4D8', muted: '48606F' },
  { id: 'forest', name: 'Forest', primary: '1B4332', secondary: '2D6A4F', accent: 'D4A373', muted: '52796F' },
  { id: 'terracotta', name: 'Terracotta', primary: '7F3B2A', secondary: 'B5543A', accent: 'E0A458', muted: '6E5E57' },
  { id: 'plum', name: 'Plum', primary: '4A1942', secondary: '893168', accent: 'C38D9E', muted: '6B4E71' },
  { id: 'sunset', name: 'Sunset', primary: '7A1E48', secondary: 'C8553D', accent: 'F28F3B', muted: '6D597A' },
  { id: 'slate', name: 'Slate', primary: '1F2937', secondary: '374151', accent: '2563EB', muted: '6B7280' },
  { id: 'mono', name: 'Monochrome', primary: '111111', secondary: '333333', accent: '777777', muted: '8A8A8A' },
];

export const DEFAULT_STUDIO: AiStudioState = { enabled: ['humaniser'], custom: [], letterheadOverride: null, palette: 'office' };

/** A letterhead worth keeping or applying: one with a name. */
export function validLetterhead(lh: unknown): lh is Letterhead {
  return !!lh && typeof lh === 'object' && typeof (lh as Letterhead).name === 'string' && (lh as Letterhead).name.trim().length > 0;
}

/** The letterhead in force: the person's override, else the organisation's, else none. */
export function effectiveLetterhead(state: Pick<AiStudioState, 'letterheadOverride'>, organisation?: Letterhead | null, locked = false): Letterhead | null {
  if (locked) return validLetterhead(organisation) ? organisation : null;
  return state.letterheadOverride ?? (validLetterhead(organisation) ? organisation : null);
}

/** Two letterheads with the same fields (a host may pass a new object with the same values). */
export function sameLetterhead(a: Letterhead | null | undefined, b: Letterhead | null | undefined): boolean {
  const key = (l: Letterhead | null | undefined) => (l ? JSON.stringify([l.name, l.tagline, l.address, l.contact, l.logo, l.logoWidth, l.align, l.font, l.rule]) : '');
  return key(a) === key(b);
}

const KEY = 'wordcraft.ai.studio';

export function readStudio(defaults: Partial<AiStudioState> = {}): AiStudioState {
  const base: AiStudioState = { ...DEFAULT_STUDIO, ...defaults };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as (Partial<AiStudioState> & { letterhead?: unknown }) | null;
    if (!v || typeof v !== 'object') return base;
    // Older versions kept one `letterhead` (often an empty one saved by a toggle): only a named
    // one carries over, as the person's override.
    const override = validLetterhead(v.letterheadOverride) ? v.letterheadOverride : validLetterhead(v.letterhead) ? v.letterhead : null;
    return {
      enabled: Array.isArray(v.enabled) ? v.enabled.filter((x) => typeof x === 'string') : base.enabled,
      custom: Array.isArray(v.custom) ? v.custom.filter((s) => s && typeof s.id === 'string' && typeof s.instructions === 'string') : [],
      letterheadOverride: override ?? base.letterheadOverride,
      palette: typeof v.palette === 'string' ? v.palette : base.palette,
      customPalette: v.customPalette,
    };
  } catch {
    return base;
  }
}

export function writeStudio(state: AiStudioState): void {
  try {
    // A nameless letterhead is never saved, so it can't hide the organisation's for good.
    const keep = { ...state, letterheadOverride: validLetterhead(state.letterheadOverride) ? state.letterheadOverride : null };
    localStorage.setItem(KEY, JSON.stringify(keep));
  } catch {
    // storage unavailable or full (a large logo): the settings last for this visit
  }
}

/**
 * Read a skill from a `SKILL.md` (YAML front matter with `name` and `description`, then the
 * instructions) or plain text (the first line becomes the name).
 */
export function parseSkillMarkdown(text: string, fallbackName = 'Imported skill'): AiSkill {
  let body = text.replace(/\r\n?/g, '\n').trim();
  let name = '';
  let description = '';
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  if (fm) {
    body = body.slice(fm[0].length).trim();
    for (const line of fm[1].split('\n')) {
      const m = /^(\w+)\s*:\s*(.*)$/.exec(line);
      if (!m) continue;
      const value = m[2].trim().replace(/^["']|["']$/g, '');
      if (m[1] === 'name') name = value;
      if (m[1] === 'description') description = value;
    }
  }
  if (!name) {
    const first = body.split('\n')[0] ?? '';
    const heading = /^#+\s*(.+)$/.exec(first);
    if (heading) {
      name = heading[1].trim();
      body = body.slice(first.length).trim();
    }
  }
  name = (name || fallbackName).replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()).slice(0, 60);
  return { id: `custom-${slug(name)}-${Date.now().toString(36)}`, name, description: description.slice(0, 140) || undefined, instructions: body.slice(0, 8000) };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'skill';
}

/** The skills that are on, in the order given. */
export function activeSkills(state: AiStudioState, extra: AiSkill[] = []): AiSkill[] {
  const all = [...extra, ...BUILT_IN_SKILLS, ...state.custom];
  const seen = new Set<string>();
  return all.filter((s) => state.enabled.includes(s.id) && !seen.has(s.id) && seen.add(s.id));
}

/** The text added to the AI's instructions: the skills that are on, and the letterhead as context. */
export function studioInstructions(skills: AiSkill[], letterhead: Letterhead | null): string {
  const parts = skills.map((s) => `${s.name}: ${s.instructions}`);
  if (letterhead?.name) {
    const who = [letterhead.name, letterhead.tagline, letterhead.address, letterhead.contact].filter(Boolean).join('; ');
    parts.push(`The writer represents: ${who}. Use these details where a letter, email or signature needs them.`);
  }
  return parts.join('\n\n');
}

/** The chosen palette (built-in, the app's, or the person's own). */
export function paletteFor(state: AiStudioState, extra: Palette[] = []): Palette {
  if (state.palette === 'custom' && state.customPalette) return state.customPalette;
  return [...extra, ...BUILT_IN_PALETTES].find((p) => p.id === state.palette) ?? BUILT_IN_PALETTES[0];
}

const rgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16) || 0;
  return { Rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255] };
};

/** Colour the document's title and headings with a palette. */
export function applyPalette(editor: WordcraftEditor, p: Palette): void {
  const set = (style: string, hex: string) => {
    try {
      editor.execute('styles.modify', { style, chr: { color: rgb(hex) } });
    } catch {
      // the document may not define every style
    }
  };
  set('Title', p.primary);
  set('Heading 1', p.primary);
  set('Heading 2', p.secondary);
  set('Heading 3', p.accent);
  set('Subtitle', p.muted);
}

/** Replace the document's header with a letterhead, coloured with a palette. */
export function applyLetterhead(editor: WordcraftEditor, lh: Letterhead, p: Palette): void {
  const align = lh.align ?? 'left';
  const font = lh.font?.trim() || undefined;
  type Line = { text: string; size: number; color: string; bold?: boolean; italic?: boolean; caps?: boolean; after: number };
  const lines: Line[] = [
    { text: lh.name, size: 20, color: p.primary, bold: true, after: 2 },
    ...(lh.tagline ? [{ text: lh.tagline, size: 11, color: p.secondary, italic: true, after: 2 }] : []),
    ...([lh.address, lh.contact].filter(Boolean).length
      ? [{ text: [lh.address, lh.contact].filter(Boolean).join(' · '), size: 9, color: p.muted, after: 4 }]
      : []),
  ];
  editor.execute('insert.editHeader');
  try {
    editor.execute('select.all');
    let first = true;
    const paragraph = (after: number) => {
      if (!first) editor.execute('text.newParagraph');
      first = false;
      editor.execute('para.align', { value: align });
      editor.execute('para.spacing', { before: 0, after });
      editor.execute('para.borders', { kind: 'none' });
    };
    if (lh.logo?.startsWith('data:image/')) {
      paragraph(6);
      editor.execute('insert.picture', { data: lh.logo.slice(lh.logo.indexOf(',') + 1), width: lh.logoWidth ?? 48, alt: `${lh.name} logo` });
    }
    lines.forEach((line, i) => {
      paragraph(line.after);
      editor.execute('text.insert', { text: line.text });
      editor.execute('caret.home', { extend: true });
      editor.execute('format.set', {
        props: { font, size: line.size, color: rgb(line.color), bold: !!line.bold, italic: !!line.italic },
      });
      editor.execute('caret.end');
      if (i === lines.length - 1 && lh.rule !== false) {
        editor.execute('para.borders', { kind: 'bottom', width: 1.5, color: p.accent });
        editor.execute('para.spacing', { before: 0, after: 12 });
      }
    });
  } finally {
    editor.execute('insert.closeHeader');
  }
}

/** Remove the letterhead (the document's header). */
export function removeLetterhead(editor: WordcraftEditor): void {
  editor.execute('insert.removeHeader');
}
