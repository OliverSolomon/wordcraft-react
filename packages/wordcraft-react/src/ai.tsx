'use client';

/**
 * AI writing (an Extra: not part of Microsoft Word or WordCraft), in the style of Gemini in
 * Google Docs. A sparkle at the bottom centre of the editor opens a bar: quick-action chips above
 * a rounded prompt box with templates (+), AI Studio, a menu and a send button. Answers stream
 * into a preview you can insert, use to replace the selection, try again or discard.
 *
 * AI Studio (the sliders button) holds the writing skills (the Humaniser is on by default, and
 * people can add their own or import a SKILL.md), a letterhead for the document header, a colour
 * palette for headings, and the model and API key.
 *
 * Where answers come from, first match wins:
 * - the person's own OpenRouter, OpenAI, Anthropic, Gemini or OpenAI-compatible key, added in AI
 *   Studio and kept in their browser (`allowUserKey`, on by default);
 * - `provider`: a provider and key your app supplies;
 * - `complete`: your function, usually a call to your own API route (keeps your key on the server).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';

import type { WordcraftEditor } from './core.js';
import type { AiAction, AiRequest } from './ai-core.js';
import { AI_PROVIDERS, completeWith, readStoredAi, writeStoredAi } from './ai-providers.js';
import type { AiProviderConfig, AiProviderId } from './ai-providers.js';
import {
  BUILT_IN_PALETTES,
  BUILT_IN_SKILLS,
  DEFAULT_STUDIO,
  activeSkills,
  applyLetterhead,
  effectiveLetterhead,
  sameLetterhead,
  validLetterhead,
  applyPalette,
  paletteFor,
  parseSkillMarkdown,
  readStudio,
  removeLetterhead,
  studioInstructions,
  writeStudio,
} from './ai-studio.js';
import type { AiSkill, AiStudioState, Letterhead, Palette } from './ai-studio.js';
import type { LogoSpec } from './letterhead.js';
import { applyLetterheadPlaced, logoSpec, removeLetterheadPlaced } from './letterhead.js';
import type { MermaidLoader } from './renderers.js';
import { setMermaidLoader } from './renderers.js';
import { BlockPreview, STRUCTURE_ITEMS, StructurePanel } from './structure.js';
import type { HostAction, StructureKind, StructureOptions } from './structure.js';
import { insertBlocks, markdownToBlocks } from './blocks.js';
import { renderDiagram, renderQr } from './renderers.js';
import { applyTheme } from './theme.js';
import type { ChatStore } from './chat.js';
import type { Checker } from './checks.js';
import type { OriginalityOptions } from './originality.js';
import { LogoPlacementControls, MiniPage, PaletteFromImage } from './studio-brand.js';
export { describeAiRequest } from './ai-core.js';
export type { AiAction, AiRequest } from './ai-core.js';
export { AI_PROVIDERS, completeWith } from './ai-providers.js';
export type { AiProviderConfig, AiProviderId } from './ai-providers.js';
export * from './ai-studio.js';

export interface AiOptions {
  /** Produce the text: return it whole, or stream it as an async iterable of chunks. */
  complete?: (request: AiRequest) => Promise<string> | AsyncIterable<string>;
  /** Call a provider straight from the browser with this key (see `AiProviderConfig`). */
  provider?: AiProviderConfig;
  /**
   * Let people add their own OpenRouter, OpenAI, Anthropic, Gemini or OpenAI-compatible key in AI
   * Studio (kept in their browser). Their key is used ahead of `complete` and `provider`. Default: true.
   */
  allowUserKey?: boolean;
  /** The assistant's name in the prompt box ("Write with …"). Default: the provider's name, or "AI". */
  name?: string;
  /** Extra templates for the + menu: a label and the prompt it fills in. */
  templates?: Array<{ label: string; prompt: string }>;
  /** Skills to offer besides the built-in ones (Humaniser, Plain English, Concise…). */
  skills?: AiSkill[];
  /** Skill ids on until the person changes them. Default: `['humaniser']`. */
  defaultSkills?: string[];
  /**
   * Your organisation's letterhead. AI Studio's Letterhead page shows it, ready to apply; it is
   * read on every render, so one that arrives or changes after the editor mounts shows at once.
   * A person's own edits are kept as their override (with "Reset to organisation letterhead").
   */
  letterhead?: Letterhead | null;
  /** Keep the organisation's letterhead as it is: its fields are read only, and only Apply and Remove are offered. */
  letterheadLocked?: boolean;
  /** Called after the letterhead is applied to the document (to log it, or save the document). */
  onLetterheadApplied?: (letterhead: Letterhead) => void;
  /** Palettes to offer besides the built-in ones; the first is the default when given. */
  palettes?: Palette[];
  /** Show AI Studio's skills, letterhead and palette pages. Default: true. */
  studio?: boolean;
  /** Where the sparkle that opens the bar sits. `none`: open it yourself (`aiOpen`). Default `bottom`. */
  launcher?: 'bottom' | 'none';
  /** Also show a sparkle button in the ribbon, beside Comments. Default: false. */
  ribbonButton?: boolean;
  /** Called whenever AI Studio's settings change (to keep them on your server, say). */
  onStudioChange?: (state: AiStudioState) => void;

  // ----- brand (Extras) -----
  /** Shorthand: your logo and palette in one object, so the letterhead and palette are ready. */
  brand?: { logo?: string | LogoSpec; palette?: Palette; name?: string };
  /** Offer pictures from your app's files ("From your files") for logos and palettes. */
  pickImage?: () => Promise<Blob | string | null>;
  /** Called when someone changes the logo or its placement in AI Studio. */
  onLogoChanged?: (logo: LogoSpec | null) => void;
  /** Called when someone saves a palette made from a logo or photo (to store it for the whole organisation; pass it back in `palettes`). */
  onPaletteCreated?: (palette: Palette) => void;
  /** Theme fonts offered with a palette: written to the document theme's font scheme. */
  fonts?: { heading: string; body?: string };

  // ----- structure (Extras) -----
  /**
   * AI that builds structure: answers become real headings, lists and tables; an Insert menu
   * and the `/` slash menu make tables, diagrams, charts, checklists, callouts, equations, QR
   * codes, images and tables of contents. Default: off.
   */
  structure?: boolean;
  /** Load Mermaid for diagrams, e.g. `() => import('mermaid')` (it loads only when first used). */
  mermaid?: MermaidLoader;
  /** Data from your app (Sheets or Excel files) for tables and charts. */
  pickData?: StructureOptions['pickData'];
  /** Make an image from a prompt. */
  generateImage?: StructureOptions['generateImage'];
  /** Find an image (your library, or a licensed service). */
  imageSearch?: StructureOptions['imageSearch'];
  /** Your own actions in the Insert and slash menus, e.g. "Insert the grant budget table from Finance". */
  actions?: HostAction[];

  // ----- reading and checking (Extras) -----
  /** "Ask this document": a chat panel grounded in the document, with citations. Default: off. */
  chat?: boolean;
  /** Keeps each person's chat with each document (default: this browser). */
  chatStore?: ChatStore;
  /** Writing-check engines (`languageTool({ url })`, `llmChecker(complete)`, your own). Turns writing checks on. */
  checker?: Checker | Checker[];
  /** Plagiarism, AI-writing signal and your own corpus (see `OriginalityOptions`). Turns the Originality panel on. */
  originality?: OriginalityOptions;
}

type Chip = [AiAction, string];
const WITH_SELECTION: Chip[] = [
  ['rewrite', 'Rewrite'],
  ['shorten', 'Shorten'],
  ['elaborate', 'Elaborate'],
  ['formal', 'More formal'],
];
const WITH_SELECTION_MORE: Chip[] = [
  ['fix', 'Fix grammar'],
  ['summarize', 'Summarize'],
  ['casual', 'More casual'],
  ['email', 'Turn into an email'],
  ['outline', 'Make an outline'],
  ['match-format', 'Match doc format'],
];
const WITHOUT_SELECTION: Chip[] = [
  ['match-format', 'Match doc format'],
  ['continue', 'Continue writing'],
  ['meeting-notes', 'Meeting notes'],
  ['email', 'Email draft'],
];
const WITHOUT_SELECTION_MORE: Chip[] = [
  ['summarize', 'Summarize document'],
  ['outline', 'Outline'],
  ['brainstorm', 'Brainstorm ideas'],
];
const TEMPLATES: Array<{ label: string; prompt: string }> = [
  { label: 'Project proposal', prompt: 'A project proposal with background, goals, scope, timeline and budget sections about ' },
  { label: 'Formal letter', prompt: 'A formal letter on our letterhead to ' },
  { label: 'Blog post', prompt: 'A blog post with a strong title and short sections about ' },
  { label: 'Cover letter', prompt: 'A cover letter for the role of ' },
  { label: 'Meeting agenda', prompt: 'A meeting agenda with timings for a meeting about ' },
  { label: 'Press release', prompt: 'A press release announcing ' },
  { label: 'Job description', prompt: 'A job description for ' },
];
const LETTERHEAD_FONTS = ['Aptos', 'Georgia', 'Playfair Display', 'Montserrat', 'Lato', 'Merriweather', 'Inter', 'Cormorant Garamond', 'Poppins', 'Libre Baskerville'];

import { insertText } from './insert-text.js';
export { insertText };

const Icon = ({ d, size = 20 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="wcai-icon">
    <path d={d} fill="currentColor" />
  </svg>
);
const I = {
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  tune: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
  more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  send: 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z',
  stop: 'M7 7h10v10H7z',
  down: 'M7 10l5 5 5-5z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  upload: 'M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z',
  check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
};

/** Gemini-style four-point sparkle. */
export const AiStar = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="wcai-star">
    <defs>
      <linearGradient id="wcai-star-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#4285f4" />
        <stop offset=".55" stopColor="#9b72cb" />
        <stop offset="1" stopColor="#d96570" />
      </linearGradient>
    </defs>
    <path d="M12 2c.6 5.4 4.6 9.4 10 10-5.4.6-9.4 4.6-10 10-.6-5.4-4.6-9.4-10-10 5.4-.6 9.4-4.6 10-10z" fill="url(#wcai-star-grad)" />
  </svg>
);

/** The "Extra" tag: marks features that are not part of Microsoft Word or WordCraft. */
export const ExtraTag = () => (
  <span className="wcai-extra" title="An Extra: not part of Microsoft Word or WordCraft">
    Extra
  </span>
);

export interface AiBarProps {
  editor: WordcraftEditor | null;
  options: AiOptions;
  /** Whether the bar is open (controlled). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Show the sparkle launcher at the bottom centre while the bar is closed. Default: true. */
  launcher?: boolean;
  /** Distance from the bottom of the editor, clearing WordCraft's status bar. */
  bottom?: number;
  dark?: boolean;
  /** The person may not change the text (viewers, commenters): answers can be read and copied, not inserted. */
  readOnly?: boolean;
  /** Edits become tracked suggestions (Suggesting): structured inserts say so. */
  suggest?: boolean;
  /** Open the structure panel from outside (the slash menu): a kind, a host action id, or a diagram to edit. */
  request?: { kind: StructureKind; actionId?: string; editDiagram?: string; nonce: number } | null;
  /** Called after a diagram is inserted, with its alt text and Mermaid source ("Edit diagram" finds it again). */
  onDiagram?: (alt: string, source: string) => void;
}

/** Is any source of answers set up: the app's, or the person's own key? */
export function aiReady(options: AiOptions): boolean {
  return !!(options.complete || options.provider?.apiKey || ((options.allowUserKey ?? true) && readStoredAi()));
}

type StudioTab = 'skills' | 'letterhead' | 'palette' | 'model';

/** The AI bar and its launcher. `<WordcraftEditor ai={...} />` renders it for you. */
export function AiBar({ editor, options, open, onOpenChange, launcher = true, bottom = 30, dark, readOnly = false, suggest = false, request, onDiagram }: AiBarProps) {
  const allowUserKey = options.allowUserKey ?? true;
  const showStudio = options.studio ?? true;
  const [own, setOwn] = useState<AiProviderConfig | null>(null);
  const [studio, setStudioState] = useState<AiStudioState>(() => ({
    ...DEFAULT_STUDIO,
    enabled: options.defaultSkills ?? DEFAULT_STUDIO.enabled,
    palette: options.palettes?.[0]?.id ?? DEFAULT_STUDIO.palette,
  }));
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState('');
  const [menu, setMenu] = useState<'' | 'more' | 'templates' | 'dots' | 'insert'>('');
  const [tab, setTab] = useState<StudioTab | null>(null);
  const [structure, setStructure] = useState<{ kind: StructureKind; prompt?: string; action?: HostAction | null; editDiagram?: { source: string } | null } | null>(null);
  const [paletteSeed, setPaletteSeed] = useState<{ src: string; name: string } | null>(null);
  const last = useRef<{ action: AiAction; prompt: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const onStudioChange = useRef(options.onStudioChange);
  onStudioChange.current = options.onStudioChange;

  // Browser-only state, read after mount so server rendering matches.
  useEffect(() => {
    if (allowUserKey) setOwn(readStoredAi());
    setStudioState(
      readStudio({
        enabled: options.defaultSkills ?? DEFAULT_STUDIO.enabled,
        palette: options.palettes?.[0]?.id ?? DEFAULT_STUDIO.palette,
      }),
    );
  }, [allowUserKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setStudio = useCallback((update: (s: AiStudioState) => AiStudioState) => {
    setStudioState((prev) => {
      const next = update(prev);
      writeStudio(next);
      onStudioChange.current?.(next);
      return next;
    });
  }, []);

  const appSource = !!(options.complete || options.provider?.apiKey);
  const active: AiProviderConfig | null = (allowUserKey && own) || (options.provider?.apiKey ? options.provider : null);
  const ready = !!active || !!options.complete;
  const name = options.name ?? (active ? AI_PROVIDERS[active.provider].name.replace(/ \(.*\)$/, '') : 'AI');
  const skillsOn = useMemo(() => (showStudio ? activeSkills(studio, options.skills) : []), [studio, options.skills, showStudio]);
  const extraPalettes = useMemo(() => (options.brand?.palette ? [options.brand.palette, ...(options.palettes ?? []).filter((p) => p.id !== options.brand?.palette?.id)] : (options.palettes ?? [])), [options.brand?.palette, options.palettes]);
  const palette = paletteFor(studio, extraPalettes);
  // `brand` fills in the organisation's letterhead: its logo, and a name when there is no letterhead.
  const organisation: Letterhead | null = options.letterhead
    ? { ...options.letterhead, logo: options.letterhead.logo ?? options.brand?.logo }
    : options.brand?.name
      ? { name: options.brand.name, logo: options.brand.logo }
      : null;
  // Like the palette, worked out on every render: the organisation's letterhead may arrive late.
  const letterhead = effectiveLetterhead(studio, organisation, options.letterheadLocked);
  useEffect(() => setMermaidLoader(options.mermaid), [options.mermaid]);
  const structureOn = !!options.structure && !readOnly;

  // The slash menu (or the host) asks for the structure panel.
  useEffect(() => {
    if (!request) return;
    const action = request.actionId ? options.actions?.find((a) => a.id === request.actionId) ?? null : null;
    setStructure({ kind: request.kind, action, editDiagram: request.editDiagram ? { source: request.editDiagram } : null });
    setTab(null);
    onOpenChange(true);
  }, [request?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshSelection = useCallback(() => {
    if (editor && !editor.destroyed) setSelection(editor.getSelectedText().trim());
  }, [editor]);

  const reset = () => {
    abort.current?.abort();
    setResult('');
    setError('');
    setBusy(false);
    setMenu('');
  };

  useEffect(() => {
    if (open) {
      refreshSelection();
      // With no way to get answers yet, start with the model and key.
      if (!ready && allowUserKey) setTab('model');
      requestAnimationFrame(() => input.current?.focus());
    } else {
      reset();
      setTab(null);
      setStructure(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    onOpenChange(false);
    if (editor && !editor.destroyed) editor.canvas.focus();
  };

  const run = async (action: AiAction, text: string) => {
    if (!editor || editor.destroyed) return;
    if (!ready) {
      if (allowUserKey) setTab('model');
      else setError('AI isn’t set up for this editor.');
      return;
    }
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    last.current = { action, prompt: text };
    setMenu('');
    setTab(null);
    setBusy(true);
    setError('');
    setResult('');
    const sel = editor.getSelectedText().trim();
    setSelection(sel);
    try {
      const request: AiRequest = {
        prompt: text,
        action,
        selection: sel,
        document: editor.getText(),
        instructions: `${showStudio ? studioInstructions(skillsOn, letterhead) : ''}${structureOn ? `${showStudio ? '\n\n' : ''}You may use Markdown for structure (# headings, - lists, | tables |, > quotes, \`\`\`mermaid diagrams) when the request calls for it.` : ''}`,
        skills: skillsOn.map((s) => s.name),
        signal: ctl.signal,
      };
      const out = active ? completeWith(active, request) : options.complete!(request);
      if (typeof (out as AsyncIterable<string>)[Symbol.asyncIterator] === 'function') {
        let acc = '';
        for await (const chunk of out as AsyncIterable<string>) {
          if (ctl.signal.aborted) return;
          acc += chunk;
          setResult(acc);
        }
        if (!acc && !ctl.signal.aborted) setError('The AI returned no text. Try again, or rephrase.');
      } else {
        const whole = await (out as Promise<string>);
        if (!ctl.signal.aborted) setResult(whole);
      }
    } catch (e) {
      if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abort.current === ctl) setBusy(false);
    }
  };

  // With structure on, an answer in Markdown goes in as real headings, lists and tables.
  const richBlocks = useMemo(() => {
    if (!structureOn || !result || busy) return null;
    const b = markdownToBlocks(result);
    return b.some((x) => x.type !== 'paragraph') ? b : null;
  }, [structureOn, result, busy]);

  const accept = async (mode: 'replace' | 'below') => {
    if (!editor || editor.destroyed || !result || readOnly) return;
    if (mode === 'below' && selection) {
      // Keep the selection and add the text after it, in a new paragraph.
      editor.execute('caret.right');
      editor.execute('text.newParagraph');
    }
    try {
      if (richBlocks) await insertBlocks(editor, richBlocks, { palette, renderDiagram, renderQr, onDiagram });
      else insertText(editor, result.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    reset();
    setPrompt('');
    close();
  };

  const submit = () => {
    if (busy) abort.current?.abort();
    else if (prompt.trim()) void run('write', prompt.trim());
  };

  const onPromptKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // Keys typed in the bar belong to the bar, not to the document behind it.
  const onDockKey = (e: KeyboardEvent<HTMLElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      if (menu) setMenu('');
      else if (tab) setTab(null);
      else close();
    }
  };

  const theme = dark ? 'dark' : 'light';

  if (!open) {
    return (
      <div className="wcai" data-theme={theme} style={{ bottom }}>
        <style>{CSS}</style>
        {launcher && (
          <button type="button" className="wcai-launch" aria-label={`Write with ${name}`} title="Help me write (an Extra, not part of Word)" onMouseDown={(e) => e.preventDefault()} onClick={() => onOpenChange(true)}>
            <AiStar size={22} />
            <span className="wcai-launch-label">Help me write</span>
          </button>
        )}
      </div>
    );
  }

  const chips = selection ? WITH_SELECTION : WITHOUT_SELECTION;
  const more = selection ? WITH_SELECTION_MORE : WITHOUT_SELECTION_MORE;
  const templates = [...(options.templates ?? []), ...TEMPLATES];
  const canSend = busy || !!prompt.trim();
  const showResult = !!(result || busy || error);
  const tabs: Array<[StudioTab, string]> = [
    ...(showStudio
      ? ([
          ['skills', 'Skills'],
          ['letterhead', 'Letterhead'],
          ['palette', 'Palette'],
        ] as Array<[StudioTab, string]>)
      : []),
    ...(allowUserKey ? ([['model', 'Model']] as Array<[StudioTab, string]>) : []),
  ];

  let panel: ReactNode = null;
  if (structure && editor && !tab) {
    panel = (
      <StructurePanel
        key={`${structure.kind}-${structure.action?.id ?? ''}-${request?.nonce ?? ''}`}
        editor={editor}
        kind={structure.kind}
        ai={ready ? { complete: options.complete, provider: options.provider, allowUserKey, instructions: showStudio ? studioInstructions(skillsOn, letterhead) : '' } : null}
        palette={palette}
        options={{ pickData: options.pickData, generateImage: options.generateImage, imageSearch: options.imageSearch, actions: options.actions }}
        suggest={suggest}
        initialPrompt={structure.prompt ?? prompt}
        action={structure.action}
        editDiagram={structure.editDiagram}
        onDiagram={onDiagram}
        onClose={() => setStructure(null)}
      />
    );
  } else if (tab) {
    panel = (
      <section className="wcai-card wcai-studio" aria-label="AI Studio">
        <header className="wcai-studio-head">
          <AiStar size={18} />
          <strong>AI Studio</strong>
          <ExtraTag />
          <nav className="wcai-tabs" role="tablist">
            {tabs.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className="wcai-tab" onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          <button type="button" className="wcai-round wcai-small" aria-label="Close AI Studio" onClick={() => setTab(null)}>
            <Icon d={I.close} size={18} />
          </button>
        </header>
        <div className="wcai-studio-body">
          {tab === 'skills' && <SkillsPage studio={studio} setStudio={setStudio} extra={options.skills ?? []} />}
          {tab === 'letterhead' && (
            <LetterheadPage
              studio={studio}
              setStudio={setStudio}
              palette={palette}
              editor={editor}
              organisation={organisation}
              locked={!!options.letterheadLocked}
              onApplied={options.onLetterheadApplied}
              onLogoChanged={options.onLogoChanged}
              onColorsFrom={(src) => {
                setPaletteSeed({ src, name: 'logo' });
                setTab('palette');
              }}
            />
          )}
          {tab === 'palette' && (
            <PalettePage
              studio={studio}
              setStudio={setStudio}
              extra={extraPalettes}
              editor={editor}
              seed={paletteSeed}
              pickImage={options.pickImage}
              fonts={options.fonts}
              onPaletteCreated={options.onPaletteCreated}
            />
          )}
          {tab === 'model' && (
            <ModelPage
              own={own}
              appSource={appSource}
              onSave={(cfg) => {
                writeStoredAi(cfg);
                setOwn(cfg);
                setError('');
                setTab(null);
                requestAnimationFrame(() => input.current?.focus());
              }}
            />
          )}
        </div>
        <footer className="wcai-studio-foot">Extras are additions of this package, not part of Microsoft Word or WordCraft. Settings stay in this browser.</footer>
      </section>
    );
  } else if (showResult) {
    panel = (
      <section className="wcai-card wcai-result" aria-live="polite">
        <header className="wcai-result-head">
          <AiStar size={16} />
          <span className={busy ? 'wcai-shimmer' : ''}>{busy ? `${name} is writing…` : error ? 'Something went wrong' : selection ? 'Suggestion for the selected text' : 'Suggestion'}</span>
          <span className="wcai-result-tags">
            {skillsOn.slice(0, 3).map((s) => (
              <span key={s.id} className="wcai-tag">
                {s.name}
              </span>
            ))}
          </span>
          <button type="button" className="wcai-round wcai-small" aria-label="Discard" title="Discard" onClick={reset}>
            <Icon d={I.close} size={18} />
          </button>
        </header>
        {richBlocks && !error ? (
          <BlockPreview blocks={richBlocks} palette={palette} />
        ) : (
          <div className={`wcai-result-text${error ? ' wcai-error' : ''}`}>{error || result || <span className="wcai-dots" aria-label="Writing" />}</div>
        )}
        {error && allowUserKey && !busy && (
          <div className="wcai-actions">
            <button type="button" className="wcai-btn" onClick={() => setTab('model')}>
              Check the model and key
            </button>
          </div>
        )}
        {result && !busy && (
          <div className="wcai-actions">
            {readOnly ? (
              <button type="button" className="wcai-btn wcai-primary" onClick={() => void navigator.clipboard?.writeText(result.trim())}>
                Copy
              </button>
            ) : (
              <button type="button" className="wcai-btn wcai-primary" onClick={() => void accept('replace')}>
                {selection ? 'Replace' : 'Insert'}
              </button>
            )}
            {selection && !readOnly && (
              <button type="button" className="wcai-btn" onClick={() => void accept('below')}>
                Insert below
              </button>
            )}
            <button type="button" className="wcai-btn" onClick={() => last.current && void run(last.current.action, last.current.prompt)}>
              Try again
            </button>
            <button type="button" className="wcai-btn wcai-ghost" onClick={reset}>
              Discard
            </button>
          </div>
        )}
      </section>
    );
  }

  const status = [skillsOn.length ? skillsOn.map((s) => s.name).join(' · ') : '', letterhead?.name ? `${letterhead.name} letterhead` : '']
    .filter(Boolean)
    .join('  ·  ');

  return (
    <div className="wcai" data-theme={theme} style={{ bottom }}>
      <style>{CSS}</style>
      <div
        className="wcai-dock"
        role="dialog"
        aria-label={`Write with ${name}`}
        onKeyDown={onDockKey}
        onKeyUp={(e) => e.stopPropagation()}
        onPaste={(e) => e.stopPropagation()}
        onPointerEnter={() => !busy && !result && refreshSelection()}
      >
        {panel}
        {!tab && !showResult && !structure && (
          <div className="wcai-chips">
            {chips.map(([action, label]) => (
              <button key={action} type="button" className="wcai-chip" onClick={() => void run(action, prompt.trim())}>
                {label}
              </button>
            ))}
            <span className="wcai-anchor">
              <button type="button" className="wcai-chip" aria-expanded={menu === 'more'} onClick={() => setMenu(menu === 'more' ? '' : 'more')}>
                More <Icon d={I.down} size={16} />
              </button>
              {menu === 'more' && (
                <div role="menu" className="wcai-menu wcai-menu-center">
                  {more.map(([action, label]) => (
                    <button key={action} role="menuitem" type="button" className="wcai-item" onClick={() => void run(action, prompt.trim())}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </span>
            {structureOn && (
              <span className="wcai-anchor">
                <button type="button" className="wcai-chip" aria-expanded={menu === 'insert'} onClick={() => setMenu(menu === 'insert' ? '' : 'insert')}>
                  Insert <Icon d={I.down} size={16} />
                </button>
                {menu === 'insert' && (
                  <div role="menu" className="wcai-menu wcai-menu-center">
                    {STRUCTURE_ITEMS.map((it) => (
                      <button
                        key={it.kind}
                        role="menuitem"
                        type="button"
                        className="wcai-item"
                        onClick={() => {
                          setMenu('');
                          setStructure({ kind: it.kind, prompt: prompt.trim() });
                        }}
                      >
                        <span aria-hidden="true" style={{ width: 20, display: 'inline-block' }}>{it.icon}</span> {it.label}
                      </button>
                    ))}
                    {(options.actions ?? []).length > 0 && <div className="wcai-sep" />}
                    {(options.actions ?? []).map((a) => (
                      <button
                        key={a.id}
                        role="menuitem"
                        type="button"
                        className="wcai-item"
                        onClick={() => {
                          setMenu('');
                          setStructure({ kind: 'free', action: a });
                        }}
                      >
                        <span aria-hidden="true" style={{ width: 20, display: 'inline-block' }}>{a.icon ?? '✦'}</span> {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </span>
            )}
          </div>
        )}
        <div className="wcai-pill">
          <span className="wcai-anchor">
            <button type="button" className="wcai-round" title="Templates" aria-label="Templates" onClick={() => setMenu(menu === 'templates' ? '' : 'templates')}>
              <Icon d={I.plus} />
            </button>
            {menu === 'templates' && (
              <div role="menu" className="wcai-menu wcai-menu-left">
                <div className="wcai-menu-title">Start from a template</div>
                {templates.map((t) => (
                  <button
                    key={t.label}
                    role="menuitem"
                    type="button"
                    className="wcai-item"
                    onClick={() => {
                      setPrompt(t.prompt);
                      setMenu('');
                      requestAnimationFrame(() => {
                        const el = input.current;
                        if (el) {
                          el.focus();
                          el.setSelectionRange(t.prompt.length, t.prompt.length);
                        }
                      });
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </span>
          {tabs.length > 0 && (
            <button
              type="button"
              className={`wcai-round${tab ? ' wcai-on' : ''}`}
              title="AI Studio: skills, letterhead, palette, model"
              aria-label="AI Studio"
              aria-pressed={!!tab}
              onClick={() => setTab(tab ? null : tabs[0][0])}
            >
              <Icon d={I.tune} />
              {skillsOn.length > 0 && <span className="wcai-badge">{skillsOn.length}</span>}
            </button>
          )}
          <textarea
            ref={input}
            rows={1}
            value={prompt}
            className="wcai-input"
            aria-label={`Write with ${name}`}
            placeholder={selection ? `Ask ${name} to change the selected text…` : `Write with ${name}…`}
            onChange={(e) => {
              setPrompt(e.target.value);
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
            }}
            onKeyDown={onPromptKey}
          />
          <span className="wcai-anchor">
            <button type="button" className="wcai-round" title="More options" aria-label="More options" onClick={() => setMenu(menu === 'dots' ? '' : 'dots')}>
              <Icon d={I.more} />
            </button>
            {menu === 'dots' && (
              <div role="menu" className="wcai-menu wcai-menu-right">
                {tabs.map(([id, label]) => (
                  <button key={id} role="menuitem" type="button" className="wcai-item" onClick={() => (setMenu(''), setTab(id))}>
                    {label}…
                  </button>
                ))}
                {allowUserKey && own && (
                  <button
                    role="menuitem"
                    type="button"
                    className="wcai-item"
                    onClick={() => {
                      writeStoredAi(null);
                      setOwn(null);
                      setMenu('');
                    }}
                  >
                    Remove my API key
                  </button>
                )}
                <div className="wcai-sep" />
                <button role="menuitem" type="button" className="wcai-item" onClick={() => (setMenu(''), setPrompt(''), reset())}>
                  Clear
                </button>
                <button role="menuitem" type="button" className="wcai-item" onClick={close}>
                  Close
                </button>
              </div>
            )}
          </span>
          <button type="button" className={`wcai-send${canSend ? ' wcai-ready' : ''}`} title={busy ? 'Stop' : 'Send'} aria-label={busy ? 'Stop' : 'Send'} disabled={!canSend} onClick={submit}>
            <Icon d={busy ? I.stop : I.send} />
          </button>
        </div>
        <div className="wcai-note">
          {status ? <span>{status}</span> : null}
          <span>AI can make mistakes, so check its work.</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// AI Studio pages

type SetStudio = (update: (s: AiStudioState) => AiStudioState) => void;

function SkillsPage({ studio, setStudio, extra }: { studio: AiStudioState; setStudio: SetStudio; extra: AiSkill[] }) {
  const [draft, setDraft] = useState<{ name: string; description: string; instructions: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const rows: Array<[AiSkill, 'App' | 'Built-in' | 'Yours']> = [
    ...extra.map((s) => [s, 'App'] as [AiSkill, 'App']),
    ...BUILT_IN_SKILLS.map((s) => [s, 'Built-in'] as [AiSkill, 'Built-in']),
    ...studio.custom.map((s) => [s, 'Yours'] as [AiSkill, 'Yours']),
  ];
  const toggle = (id: string, on: boolean) => setStudio((s) => ({ ...s, enabled: on ? [...s.enabled.filter((x) => x !== id), id] : s.enabled.filter((x) => x !== id) }));
  const add = (skill: AiSkill) => setStudio((s) => ({ ...s, custom: [...s.custom, skill], enabled: [...s.enabled, skill.id] }));
  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    add(parseSkillMarkdown(await f.text(), f.name.replace(/\.(md|txt)$/i, '')));
  };

  return (
    <div className="wcai-page">
      <p className="wcai-lead">Skills shape how the AI writes. Every skill that is on applies to each request.</p>
      <ul className="wcai-skills">
        {rows.map(([s, kind]) => {
          const on = studio.enabled.includes(s.id);
          return (
            <li key={s.id} className={`wcai-skill${on ? ' wcai-skill-on' : ''}`}>
              <label className="wcai-switch">
                <input type="checkbox" checked={on} onChange={(e) => toggle(s.id, e.target.checked)} aria-label={s.name} />
                <span />
              </label>
              <div className="wcai-skill-text">
                <div className="wcai-skill-name">
                  {s.name} <span className="wcai-tag">{kind}</span>
                </div>
                {s.description && <div className="wcai-skill-desc">{s.description}</div>}
              </div>
              {kind === 'Yours' && (
                <button
                  type="button"
                  className="wcai-round wcai-small"
                  aria-label={`Delete ${s.name}`}
                  title="Delete"
                  onClick={() => setStudio((st) => ({ ...st, custom: st.custom.filter((c) => c.id !== s.id), enabled: st.enabled.filter((x) => x !== s.id) }))}
                >
                  <Icon d={I.trash} size={18} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {draft ? (
        <form
          className="wcai-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.name.trim() || !draft.instructions.trim()) return;
            const skill = parseSkillMarkdown(draft.instructions, draft.name);
            add({ ...skill, name: draft.name.trim(), description: draft.description.trim() || undefined });
            setDraft(null);
          }}
        >
          <div className="wcai-grid2">
            <label className="wcai-field">
              Name
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Our house style" autoFocus />
            </label>
            <label className="wcai-field">
              Short description
              <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Optional" />
            </label>
          </div>
          <label className="wcai-field">
            Instructions
            <textarea rows={4} value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} placeholder="Tell the AI how to write, e.g. “Use sentence case headings, spell out numbers under ten, and sign off as the Programmes Team.”" />
          </label>
          <div className="wcai-actions wcai-end">
            <button type="button" className="wcai-btn wcai-ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button type="submit" className="wcai-btn wcai-primary" disabled={!draft.name.trim() || !draft.instructions.trim()}>
              Add skill
            </button>
          </div>
        </form>
      ) : (
        <div className="wcai-actions">
          <button type="button" className="wcai-btn" onClick={() => setDraft({ name: '', description: '', instructions: '' })}>
            <Icon d={I.plus} size={18} /> New skill
          </button>
          <button type="button" className="wcai-btn" onClick={() => file.current?.click()}>
            <Icon d={I.upload} size={18} /> Import SKILL.md
          </button>
          <input ref={file} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden onChange={(e) => void importFile(e)} />
        </div>
      )}
    </div>
  );
}

function LetterheadPage({
  studio,
  setStudio,
  palette,
  editor,
  organisation,
  locked,
  onApplied,
  onLogoChanged,
  onColorsFrom,
}: {
  studio: AiStudioState;
  setStudio: SetStudio;
  palette: Palette;
  editor: WordcraftEditor | null;
  organisation: Letterhead | null;
  locked: boolean;
  onApplied?: (lh: Letterhead) => void;
  onLogoChanged?: (logo: LogoSpec | null) => void;
  onColorsFrom?: (src: string) => void;
}) {
  const effective = effectiveLetterhead(studio, organisation, locked);
  const lh: Letterhead = effective ?? { name: '', align: 'left', rule: true };
  const hasOrg = validLetterhead(organisation);
  const overridden = !locked && !!studio.letterheadOverride && hasOrg && !sameLetterhead(studio.letterheadOverride, organisation);
  const [note, setNote] = useState('');
  const [placing, setPlacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const partnerFile = useRef<HTMLInputElement>(null);
  const spec = logoSpec(lh);
  // An edit starts from the letterhead shown (the organisation's, say), so toggling the rule keeps
  // its name, tagline, address and logo. An edit that lands back on the organisation's drops the
  // override.
  const set = (patch: Partial<Letterhead>) => {
    if (locked) return;
    setStudio((s) => {
      const next = { ...(effectiveLetterhead(s, organisation) ?? lh), ...patch };
      return { ...s, letterheadOverride: hasOrg && sameLetterhead(next, organisation) ? null : next };
    });
  };
  const onLogo = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 1_500_000) {
      setNote('Choose a logo under 1.5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      // Keep the placement when the picture changes; a new logo starts where the old one was.
      const next: string | LogoSpec = typeof lh.logo === 'object' && lh.logo ? { ...lh.logo, src } : src;
      set({ logo: next });
      onLogoChanged?.(typeof next === 'string' ? { src: next } : next);
    };
    reader.readAsDataURL(f);
  };
  const onPartner = (e: ChangeEvent<HTMLInputElement>) => {
    const fs = Array.from(e.target.files ?? []).filter((f) => f.size <= 1_500_000);
    e.target.value = '';
    Promise.all(fs.map((f) => new Promise<string>((ok) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.readAsDataURL(f);
    }))).then((srcs) => set({ partners: [...(lh.partners ?? []), ...srcs].slice(0, 6) }));
  };
  const setSpec = (next: LogoSpec) => {
    set({ logo: next });
    onLogoChanged?.(next);
  };
  const apply = async () => {
    if (!editor || editor.destroyed || !lh.name.trim()) return;
    setBusy(true);
    try {
      // A placed logo or partner logos use the placement writer; a plain letterhead keeps the original one.
      if (typeof lh.logo === 'object' || lh.partners?.length || (typeof lh.logo === 'string' && lh.logo.startsWith('data:image/svg'))) await applyLetterheadPlaced(editor, lh, palette);
      else applyLetterhead(editor, lh, palette);
      setNote(spec?.placement === 'watermark' ? 'Letterhead and watermark added.' : 'Letterhead added to the document.');
      onApplied?.(lh);
    } catch (e) {
      setNote(`Couldn’t add the letterhead: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const hex = (h: string) => `#${h}`;
  const font = lh.font?.trim() ? `"${lh.font.trim()}", Georgia, serif` : 'inherit';

  return (
    <div className="wcai-page">
      <div className="wcai-split">
        <div className="wcai-form">
          <label className="wcai-field">
            Organisation or name
            <input readOnly={locked} value={lh.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Open Studio Collective" />
          </label>
          <label className="wcai-field">
            Tagline
            <input readOnly={locked} value={lh.tagline ?? ''} onChange={(e) => set({ tagline: e.target.value })} placeholder="Optional" />
          </label>
          <div className="wcai-grid2">
            <label className="wcai-field">
              Address
              <input readOnly={locked} value={lh.address ?? ''} onChange={(e) => set({ address: e.target.value })} placeholder="12 Alder Street, Nairobi" />
            </label>
            <label className="wcai-field">
              Contact
              <input readOnly={locked} value={lh.contact ?? ''} onChange={(e) => set({ contact: e.target.value })} placeholder="hello@example.org · +254 700 000 000" />
            </label>
          </div>
          <div className="wcai-grid2">
            <label className="wcai-field">
              Font
              <input readOnly={locked} list="wcai-fonts" value={lh.font ?? ''} onChange={(e) => set({ font: e.target.value })} placeholder="Document font" />
              <datalist id="wcai-fonts">
                {LETTERHEAD_FONTS.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </label>
            <div className="wcai-field">
              Alignment
              <div className="wcai-segment" role="radiogroup" aria-label="Alignment">
                {(['left', 'center', 'right'] as const).map((a) => (
                  <button key={a} type="button" role="radio" aria-checked={(lh.align ?? 'left') === a} disabled={locked} onClick={() => set({ align: a })}>
                    {a === 'center' ? 'Centre' : a[0].toUpperCase() + a.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="wcai-row">
            {!locked && (
              <button type="button" className="wcai-btn" onClick={() => file.current?.click()}>
                <Icon d={I.upload} size={18} /> {lh.logo ? 'Change logo' : 'Add logo'}
              </button>
            )}
            {lh.logo && !locked && (
              <button type="button" className="wcai-btn wcai-ghost" onClick={() => (set({ logo: undefined }), onLogoChanged?.(null))}>
                Remove logo
              </button>
            )}
            {spec && (
              <button type="button" className="wcai-btn" aria-expanded={placing} onClick={() => setPlacing(!placing)}>
                Placement
              </button>
            )}
            {spec && onColorsFrom && (
              <button type="button" className="wcai-btn" onClick={() => onColorsFrom(spec.src)}>
                Colours from this logo
              </button>
            )}
            {!locked && (
              <button type="button" className="wcai-btn wcai-ghost" onClick={() => partnerFile.current?.click()}>
                Partner logos{lh.partners?.length ? ` (${lh.partners.length})` : ''}
              </button>
            )}
            {!locked && !!lh.partners?.length && (
              <button type="button" className="wcai-btn wcai-ghost" onClick={() => set({ partners: undefined })}>
                Clear partners
              </button>
            )}
            <input ref={partnerFile} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" multiple hidden onChange={onPartner} />
            <label className="wcai-check">
              <input type="checkbox" disabled={locked} checked={lh.rule !== false} onChange={(e) => set({ rule: e.target.checked })} /> Accent rule
            </label>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden onChange={onLogo} />
          </div>
          {placing && spec && <LogoPlacementControls spec={{ placement: 'header-left', ...spec }} disabled={locked} accent={`#${palette.accent}`} onChange={setSpec} />}
        </div>
        <div className="wcai-preview" aria-label="Preview">
          <div className="wcai-paper" style={{ textAlign: lh.align ?? 'left', fontFamily: font }}>
            {spec && spec.placement && spec.placement !== 'header-left' && spec.placement !== 'header-center' && spec.placement !== 'header-right' ? (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                <MiniPage placement={spec.placement} src={spec.src} opacity={spec.opacity ?? (spec.placement === 'watermark' ? 0.15 : 1)} rotation={spec.rotation ?? 0} accent={`#${palette.accent}`} />
              </div>
            ) : (
              spec && <img src={spec.src} alt="" style={{ width: Math.round((spec.size ?? lh.logoWidth ?? 48) * 1.1), maxHeight: 64, objectFit: 'contain', display: 'inline-block', marginBottom: 6 }} />
            )}
            <div style={{ color: hex(palette.primary), fontWeight: 700, fontSize: 20, lineHeight: 1.2 }}>{lh.name || 'Your organisation'}</div>
            {lh.tagline && <div style={{ color: hex(palette.secondary), fontStyle: 'italic', fontSize: 12, marginTop: 2 }}>{lh.tagline}</div>}
            {(lh.address || lh.contact) && (
              <div style={{ color: hex(palette.muted), fontSize: 10, marginTop: 4 }}>{[lh.address, lh.contact].filter(Boolean).join(' · ')}</div>
            )}
            {lh.rule !== false && <div style={{ borderBottom: `2px solid ${hex(palette.accent)}`, marginTop: 8 }} />}
            <div className="wcai-paper-lines">
              <span />
              <span />
              <span />
            </div>
          </div>
          <div className="wcai-preview-cap">Uses the {palette.name} palette</div>
        </div>
      </div>
      <div className="wcai-actions wcai-between">
        <span className="wcai-note-inline" role="status">
          {note || (locked ? 'Your organisation’s letterhead.' : overridden ? 'Your own version of the letterhead.' : hasOrg ? 'Your organisation’s letterhead.' : '')}
        </span>
        <span className="wcai-actions">
          {overridden && (
            <button
              type="button"
              className="wcai-btn wcai-ghost"
              onClick={() => {
                setStudio((st) => ({ ...st, letterheadOverride: null }));
                setNote('Back to your organisation’s letterhead.');
              }}
            >
              Reset to organisation letterhead
            </button>
          )}
          <button
            type="button"
            className="wcai-btn wcai-ghost"
            onClick={() => {
              if (editor && !editor.destroyed) {
                removeLetterheadPlaced(editor);
                removeLetterhead(editor);
                setNote('Letterhead removed.');
              }
            }}
          >
            Remove from document
          </button>
          <button type="button" className="wcai-btn wcai-primary" disabled={!lh.name.trim() || busy} onClick={() => void apply()}>
            {busy ? 'Applying…' : 'Apply to document'}
          </button>
        </span>
      </div>
    </div>
  );
}

function PalettePage({
  studio,
  setStudio,
  extra,
  editor,
  seed,
  pickImage,
  fonts,
  onPaletteCreated,
}: {
  studio: AiStudioState;
  setStudio: SetStudio;
  extra: Palette[];
  editor: WordcraftEditor | null;
  seed?: { src: string; name: string } | null;
  pickImage?: () => Promise<Blob | string | null>;
  fonts?: { heading: string; body?: string };
  onPaletteCreated?: (p: Palette) => void;
}) {
  const [note, setNote] = useState('');
  const [fromImage, setFromImage] = useState(!!seed);
  const custom: Palette = studio.customPalette ?? { id: 'custom', name: 'Your palette', primary: '1F3A5F', secondary: '3D6D99', accent: 'F2A541', muted: '6B7280' };
  const all = [...extra, ...(studio.savedPalettes ?? []), ...BUILT_IN_PALETTES];
  const chosen = paletteFor(studio, extra);
  const swatches = (p: Palette) => (
    <span className="wcai-swatches">
      {[p.primary, p.secondary, p.accent, p.muted].map((c, i) => (
        <span key={i} style={{ background: `#${c}` }} />
      ))}
    </span>
  );
  const setCustom = (key: 'primary' | 'secondary' | 'accent' | 'muted', value: string) =>
    setStudio((s) => ({ ...s, palette: 'custom', customPalette: { ...custom, [key]: value.replace('#', '').toUpperCase() } }));

  return (
    <div className="wcai-page">
      <div className="wcai-actions wcai-between">
        <p className="wcai-lead" style={{ margin: 0 }}>Brand colours for the document theme, the headings and the letterhead.</p>
        <button type="button" className="wcai-btn" aria-expanded={fromImage} onClick={() => setFromImage(!fromImage)}>
          From a logo or photo
        </button>
      </div>
      {fromImage && (
        <PaletteFromImage
          key={seed?.src ?? 'none'}
          initial={seed}
          pickImage={pickImage}
          fonts={fonts}
          onSave={(p) => {
            setStudio((s) => ({ ...s, palette: p.id, savedPalettes: [p, ...(s.savedPalettes ?? []).filter((x) => x.id !== p.id)].slice(0, 24) }));
            onPaletteCreated?.(p);
          }}
          onApply={(p, scope, f) => {
            if (!editor || editor.destroyed) return;
            setStudio((s) => ({ ...s, palette: p.id, savedPalettes: [p, ...(s.savedPalettes ?? []).filter((x) => x.id !== p.id)].slice(0, 24) }));
            if (scope === 'headings') applyPalette(editor, p);
            else applyTheme(editor, p, { scope: 'document', fonts: f });
            setNote(scope === 'headings' ? `${p.name} applied to the title and headings.` : `${p.name} is now the document theme (Design › Colors shows it).`);
          }}
        />
      )}
      <div className="wcai-palettes" role="radiogroup" aria-label="Palette">
        {all.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={chosen.id === p.id} className="wcai-palette" onClick={() => setStudio((s) => ({ ...s, palette: p.id }))}>
            {swatches(p)}
            <span className="wcai-palette-name">
              {p.name}
              {chosen.id === p.id && <Icon d={I.check} size={16} />}
            </span>
          </button>
        ))}
        <div role="radio" aria-checked={chosen.id === 'custom'} tabIndex={0} className="wcai-palette wcai-palette-custom" onClick={() => setStudio((s) => ({ ...s, palette: 'custom', customPalette: custom }))}>
          <span className="wcai-swatches">
            {(['primary', 'secondary', 'accent', 'muted'] as const).map((k) => (
              <label key={k} title={k[0].toUpperCase() + k.slice(1)} style={{ background: `#${custom[k]}` }}>
                <input type="color" value={`#${custom[k]}`} onChange={(e) => setCustom(k, e.target.value)} aria-label={`${k} colour`} />
              </label>
            ))}
          </span>
          <span className="wcai-palette-name">
            Your palette
            {chosen.id === 'custom' && <Icon d={I.check} size={16} />}
          </span>
        </div>
      </div>
      <div className="wcai-actions wcai-between">
        <span className="wcai-note-inline" role="status">
          {note}
        </span>
        <span className="wcai-actions">
          <button
            type="button"
            className="wcai-btn"
            onClick={() => {
              if (!editor || editor.destroyed) return;
              applyPalette(editor, chosen);
              setNote(`${chosen.name} applied to the title and headings.`);
            }}
          >
            Apply to headings
          </button>
          <button
            type="button"
            className="wcai-btn wcai-primary"
            onClick={() => {
              if (!editor || editor.destroyed) return;
              applyTheme(editor, chosen, { scope: 'document', fonts });
              setNote(`${chosen.name} is now the document theme.`);
            }}
          >
            Apply to document
          </button>
        </span>
      </div>
    </div>
  );
}

function ModelPage({ own, appSource, onSave }: { own: AiProviderConfig | null; appSource: boolean; onSave(cfg: AiProviderConfig | null): void }) {
  const [useOwn, setUseOwn] = useState(!!own || !appSource);
  const [provider, setProvider] = useState<AiProviderId>(own?.provider ?? 'openrouter');
  const [apiKey, setApiKey] = useState(own?.apiKey ?? '');
  const [model, setModel] = useState(own?.model ?? '');
  const [baseUrl, setBaseUrl] = useState(own?.baseUrl ?? '');
  const meta = AI_PROVIDERS[provider];
  const valid = !useOwn || !!(apiKey.trim() && (provider !== 'custom' || (baseUrl.trim() && model.trim())));

  return (
    <form
      className="wcai-page wcai-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSave(useOwn ? { provider, apiKey: apiKey.trim(), model: model.trim() || undefined, baseUrl: baseUrl.trim() || undefined } : null);
      }}
    >
      {appSource ? (
        <div className="wcai-segment wcai-wide" role="radiogroup" aria-label="Source">
          <button type="button" role="radio" aria-checked={!useOwn} onClick={() => setUseOwn(false)}>
            This app’s AI
          </button>
          <button type="button" role="radio" aria-checked={useOwn} onClick={() => setUseOwn(true)}>
            My own API key
          </button>
        </div>
      ) : (
        <p className="wcai-lead">Add an API key from OpenRouter or another AI provider to write with AI.</p>
      )}
      {useOwn && (
        <>
          <div className="wcai-grid3">
            <label className="wcai-field">
              Provider
              <select value={provider} onChange={(e) => setProvider(e.target.value as AiProviderId)}>
                {(Object.keys(AI_PROVIDERS) as AiProviderId[]).map((id) => (
                  <option key={id} value={id}>
                    {AI_PROVIDERS[id].name}
                  </option>
                ))}
              </select>
            </label>
            <label className="wcai-field">
              API key
              <input type="password" autoComplete="off" spellCheck={false} value={apiKey} placeholder={meta.keyHint} onChange={(e) => setApiKey(e.target.value)} />
            </label>
            <label className="wcai-field">
              <span>
                Model {provider !== 'custom' && <span className="wcai-dim">(optional)</span>}
              </span>
              <input value={model} placeholder={meta.defaultModel || 'model id'} onChange={(e) => setModel(e.target.value)} />
            </label>
          </div>
          {provider === 'custom' && (
            <label className="wcai-field">
              Endpoint URL
              <input value={baseUrl} placeholder="https://api.example.com/v1" onChange={(e) => setBaseUrl(e.target.value)} />
            </label>
          )}
          <p className="wcai-dim wcai-small-text">
            Your key stays in this browser and is sent only to {meta.name}.{' '}
            {meta.keyUrl && (
              <a href={meta.keyUrl} target="_blank" rel="noreferrer">
                Get a key
              </a>
            )}
          </p>
        </>
      )}
      <div className="wcai-actions wcai-end">
        <button type="submit" className="wcai-btn wcai-primary" disabled={!valid}>
          Save
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Styles, scoped under .wcai. Colours come from the variables at the top.

const CSS = `
.wcai{--bg:#fff;--fg:#1f1f1f;--dim:#5f6368;--line:#dadce0;--soft:#f0f4f9;--hover:#eef1f6;--accent:#0b57d0;--accent-fg:#fff;--accent-soft:#d3e3fd;--err:#b3261e;
--grad:linear-gradient(110deg,#4285f4 0%,#9b72cb 55%,#d96570 100%);
--shadow:0 1px 3px rgba(60,64,67,.16),0 6px 20px rgba(60,64,67,.14);--shadow-lg:0 2px 6px rgba(60,64,67,.18),0 12px 32px rgba(60,64,67,.18);
position:absolute;top:0;left:0;right:0;display:flex;justify-content:center;align-items:flex-end;pointer-events:none;z-index:5;container-type:inline-size;
font:14px/1.45 "Google Sans Text","Google Sans",Inter,"Segoe UI",system-ui,sans-serif;color:var(--fg);-webkit-font-smoothing:antialiased}
.wcai[data-theme=dark]{--bg:#1e1f20;--fg:#e3e3e3;--dim:#a8abb0;--line:#3c4043;--soft:#282a2c;--hover:#2f3133;--accent:#a8c7fa;--accent-fg:#062e6f;--accent-soft:#0b3a7a;--err:#f2b8b5;
--shadow:0 1px 3px rgba(0,0,0,.5),0 6px 20px rgba(0,0,0,.4);--shadow-lg:0 2px 6px rgba(0,0,0,.5),0 12px 32px rgba(0,0,0,.5)}
.wcai *{box-sizing:border-box}
.wcai button{font:inherit;color:inherit}
.wcai-icon,.wcai-star{display:block;flex:none}
.wcai-launch{pointer-events:auto;display:flex;align-items:center;gap:0;height:48px;min-width:48px;padding:0 12px;border-radius:24px;border:1px solid transparent;cursor:pointer;
background:linear-gradient(var(--bg),var(--bg)) padding-box,var(--grad) border-box;box-shadow:var(--shadow);margin-bottom:10px;
transition:box-shadow .25s ease,transform .25s ease,gap .25s ease,padding .25s ease;animation:wcai-pop .35s cubic-bezier(.2,.8,.2,1)}
.wcai-launch .wcai-star{transition:transform .5s cubic-bezier(.2,.8,.2,1)}
.wcai-launch-label{max-width:0;overflow:hidden;white-space:nowrap;font-weight:500;font-size:14px;opacity:0;transition:max-width .3s ease,opacity .2s ease}
.wcai-launch:hover,.wcai-launch:focus-visible{box-shadow:var(--shadow-lg);transform:translateY(-2px);gap:8px;padding:0 18px 0 14px;outline:none}
.wcai-launch:hover .wcai-launch-label,.wcai-launch:focus-visible .wcai-launch-label{max-width:160px;opacity:1}
.wcai-launch:hover .wcai-star{transform:rotate(90deg) scale(1.08)}
.wcai-dock{pointer-events:auto;width:min(760px,calc(100% - 24px));max-height:calc(100% - 16px);display:flex;flex-direction:column;gap:10px;animation:wcai-in .28s cubic-bezier(.2,.8,.2,1)}
.wcai-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}
.wcai-chip{display:flex;align-items:center;gap:2px;height:32px;padding:0 14px;border-radius:16px;border:1px solid var(--line);background:var(--bg);cursor:pointer;font-size:13px;font-weight:500;white-space:nowrap;box-shadow:0 1px 2px rgba(60,64,67,.1);transition:background .15s,border-color .15s,transform .15s}
.wcai-chip:hover{background:var(--hover);border-color:transparent;transform:translateY(-1px)}
.wcai-pill{display:flex;align-items:center;gap:2px;padding:6px 8px;border-radius:28px;border:1px solid var(--line);background:var(--bg);box-shadow:var(--shadow);transition:box-shadow .2s,border-color .2s}
.wcai-pill:focus-within{border-color:transparent;background:linear-gradient(var(--bg),var(--bg)) padding-box,var(--grad) border-box;box-shadow:var(--shadow-lg)}
.wcai-input{flex:1;min-width:0;height:36px;max-height:140px;resize:none;border:0;outline:none;background:transparent;color:var(--fg);font:inherit;font-size:15px;line-height:20px;padding:8px 6px}
.wcai-input::placeholder{color:var(--dim)}
.wcai-round{position:relative;width:36px;height:36px;flex:none;border-radius:50%;border:0;background:transparent;color:var(--dim);display:grid;place-items:center;cursor:pointer;transition:background .15s,color .15s}
.wcai-round:hover{background:var(--hover);color:var(--fg)}
.wcai-round.wcai-on{background:var(--accent-soft);color:var(--accent)}
.wcai-round.wcai-small{width:30px;height:30px}
.wcai-badge{position:absolute;top:3px;right:2px;min-width:15px;height:15px;padding:0 4px;border-radius:8px;background:var(--grad);color:#fff;font-size:10px;font-weight:600;line-height:15px;text-align:center}
.wcai-send{width:36px;height:36px;flex:none;margin-left:4px;border-radius:50%;border:0;display:grid;place-items:center;background:var(--soft);color:var(--dim);cursor:default;transition:background .2s,color .2s,transform .15s}
.wcai-send.wcai-ready{background:var(--accent);color:var(--accent-fg);cursor:pointer}
.wcai-send.wcai-ready:hover{transform:scale(1.06)}
.wcai-note{align-self:center;display:flex;justify-content:center;flex-wrap:wrap;gap:2px 14px;max-width:100%;padding:3px 12px;border-radius:12px;font-size:11px;color:var(--dim);text-align:center;margin-top:-4px;background:color-mix(in srgb,var(--bg) 88%,transparent);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.wcai-anchor{position:relative;display:inline-flex}
.wcai-menu{position:absolute;bottom:calc(100% + 8px);min-width:210px;padding:6px 0;border-radius:12px;background:var(--bg);border:1px solid var(--line);box-shadow:var(--shadow-lg);z-index:3;animation:wcai-in .16s ease}
.wcai-menu-left{left:0}.wcai-menu-right{right:0}.wcai-menu-center{left:50%;transform:translateX(-50%);animation:none}
.wcai-menu-title{padding:6px 16px 8px;font-size:12px;color:var(--dim)}
.wcai-item{display:block;width:100%;text-align:left;border:0;background:none;padding:9px 16px;font-size:13px;cursor:pointer}
.wcai-item:hover{background:var(--hover)}
.wcai-sep{height:1px;margin:6px 0;background:var(--line)}
.wcai-card{background:var(--bg);border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow-lg);animation:wcai-in .22s cubic-bezier(.2,.8,.2,1)}
.wcai-result{padding:14px 16px;display:grid;gap:10px}
.wcai-result-head{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dim)}
.wcai-result-tags{display:flex;gap:6px;margin-left:auto}
.wcai-result-text{max-height:240px;overflow:auto;white-space:pre-wrap;font-size:15px;line-height:1.6;padding:2px}
.wcai-error{color:var(--err)}
.wcai-tag{display:inline-block;padding:1px 8px;border-radius:10px;background:var(--soft);color:var(--dim);font-size:11px;font-weight:500;vertical-align:1px}
.wcai-extra{display:inline-block;padding:1px 8px;border-radius:10px;background:var(--grad);color:#fff;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.wcai-shimmer{background:linear-gradient(90deg,var(--dim) 20%,var(--accent) 50%,var(--dim) 80%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:wcai-shine 1.6s linear infinite}
.wcai-dots::after{content:"";display:inline-block;width:46px;height:10px;border-radius:5px;background:linear-gradient(90deg,var(--soft),var(--accent-soft),var(--soft));background-size:200% 100%;animation:wcai-shine 1.2s linear infinite}
.wcai-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.wcai-end{justify-content:flex-end}.wcai-between{justify-content:space-between}
.wcai-btn{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 16px;border-radius:17px;border:1px solid var(--line);background:var(--bg);font-size:13px;font-weight:500;cursor:pointer;transition:background .15s,border-color .15s,box-shadow .15s}
.wcai-btn:hover{background:var(--hover)}
.wcai-btn:disabled{opacity:.45;cursor:default}
.wcai .wcai-primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
.wcai-primary:hover:not(:disabled){background:var(--accent);box-shadow:0 1px 3px rgba(11,87,208,.35)}
.wcai-ghost{border-color:transparent;background:transparent}
.wcai-studio{display:flex;flex-direction:column;flex:0 1 auto;min-height:0;max-height:520px;overflow:hidden}
.wcai-result{flex:0 1 auto;min-height:0}
.wcai-studio-head{display:flex;align-items:center;gap:8px;padding:12px 12px 0 16px;flex-wrap:wrap}
.wcai-studio-head strong{font-weight:600;font-size:15px}
.wcai-tabs{display:flex;gap:2px;margin:0 auto;padding:3px;border-radius:18px;background:var(--soft)}
.wcai .wcai-tab{border:0;background:transparent;height:30px;padding:0 14px;border-radius:15px;font-size:13px;font-weight:500;color:var(--dim);cursor:pointer;transition:background .15s,color .15s,box-shadow .15s}
.wcai .wcai-tab[aria-selected=true]{background:var(--bg);color:var(--fg);box-shadow:0 1px 2px rgba(60,64,67,.2)}
.wcai-studio-body{overflow:auto;padding:14px 16px}
.wcai-studio-foot{padding:8px 16px 12px;font-size:11px;color:var(--dim);border-top:1px solid var(--line)}
.wcai-page{display:grid;gap:14px}
.wcai-lead{margin:0;color:var(--dim);font-size:13px}
.wcai-skills{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px}
.wcai-skill{display:flex;align-items:flex-start;gap:12px;padding:10px 12px;border-radius:14px;border:1px solid var(--line);transition:border-color .15s,background .15s}
.wcai-skill-on{border-color:transparent;background:linear-gradient(var(--bg),var(--bg)) padding-box,var(--grad) border-box}
.wcai-skill-text{flex:1;min-width:0}
.wcai-skill-name{font-weight:500;font-size:13px}
.wcai-skill-desc{font-size:12px;color:var(--dim);margin-top:2px}
.wcai-switch{position:relative;flex:none;width:34px;height:20px;margin-top:1px;cursor:pointer}
.wcai-switch input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer;z-index:1}
.wcai-switch span{position:absolute;inset:0;border-radius:10px;background:var(--line);transition:background .2s}
.wcai-switch span::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .2s}
.wcai-switch input:checked+span{background:var(--accent)}
.wcai-switch input:checked+span::after{transform:translateX(14px)}
.wcai-switch input:focus-visible+span{outline:2px solid var(--accent);outline-offset:2px}
.wcai-form{display:grid;gap:12px}
.wcai-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.wcai-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.wcai-field{display:grid;gap:5px;font-size:12px;font-weight:500;color:var(--dim);align-content:start}
.wcai-field input,.wcai-field select,.wcai-field textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:9px 11px;font:inherit;font-size:13px;font-weight:400;background:var(--bg);color:var(--fg);outline:none;transition:border-color .15s,box-shadow .15s}
.wcai-field textarea{resize:vertical;min-height:84px;line-height:1.5}
.wcai-field input:focus,.wcai-field select:focus,.wcai-field textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.wcai-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.wcai-check{display:inline-flex;align-items:center;gap:6px;font-size:13px;margin-left:auto}
.wcai-segment{display:flex;padding:3px;border-radius:12px;background:var(--soft);gap:2px}
.wcai .wcai-segment button{flex:1;height:30px;border:0;border-radius:9px;background:transparent;font-size:13px;color:var(--dim);cursor:pointer}
.wcai .wcai-segment button[aria-checked=true]{background:var(--bg);color:var(--fg);box-shadow:0 1px 2px rgba(60,64,67,.2)}
.wcai-wide{max-width:360px}
.wcai-split{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:16px;align-items:start}
.wcai-preview{display:grid;gap:6px;position:sticky;top:0}
.wcai-paper{background:#fff;color:#222;border-radius:12px;padding:18px 20px;box-shadow:0 1px 3px rgba(60,64,67,.2),0 0 0 1px rgba(60,64,67,.06);min-height:170px}
.wcai-paper-lines{display:grid;gap:7px;margin-top:16px}
.wcai-paper-lines span{display:block;height:6px;border-radius:3px;background:#eceff3}
.wcai-paper-lines span:nth-child(2){width:86%}.wcai-paper-lines span:nth-child(3){width:64%}
.wcai-preview-cap{font-size:11px;color:var(--dim);text-align:center}
.wcai-palettes{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.wcai-palette{display:grid;gap:8px;padding:10px;border-radius:14px;border:1px solid var(--line);background:var(--bg);cursor:pointer;text-align:left;transition:border-color .15s,transform .15s,box-shadow .15s}
.wcai-palette:hover{transform:translateY(-1px);box-shadow:var(--shadow)}
.wcai-palette[aria-checked=true]{border-color:transparent;background:linear-gradient(var(--bg),var(--bg)) padding-box,var(--grad) border-box}
.wcai-swatches{display:flex;height:34px;border-radius:9px;overflow:hidden}
.wcai-swatches>*{flex:1;position:relative}
.wcai-swatches label{cursor:pointer}
.wcai-swatches input[type=color]{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer}
.wcai-palette-name{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:500}
.wcai-note-inline{font-size:12px;color:var(--dim)}
.wcai-dim{color:var(--dim);font-weight:400}
.wcai-small-text{font-size:12px;margin:0}
.wcai a{color:var(--accent)}
@container (max-width:640px){.wcai-split,.wcai-grid2,.wcai-grid3{grid-template-columns:1fr}.wcai-tabs{order:5;width:100%;margin:6px 0 0}.wcai-result-tags{display:none}}
@keyframes wcai-in{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
@keyframes wcai-pop{from{opacity:0;transform:translateY(8px) scale(.9)}to{opacity:1;transform:none}}
@keyframes wcai-shine{from{background-position:200% 0}to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.wcai *,.wcai-launch,.wcai-dock{animation:none!important;transition:none!important}}
`;
