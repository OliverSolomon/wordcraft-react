'use client';

/**
 * The phone layout, shaped like Word on Android: a thin title bar, the page, and one command
 * palette at the bottom that swaps tabs. It drives WordCraft's own commands (the same ids as the
 * ribbon), so nothing about editing is new; only the chrome is.
 *
 * `<WordcraftEditor mobile />` (or `mobile="auto"`, the default, on a narrow touch screen) hides
 * WordCraft's title bar, ribbon, status bar and mini toolbar and renders this around the page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import type { EditorMode, RibbonTab, SelectionInfo, WordcraftEditor as Editor } from './core.js';
import { Icon } from './mobile-icons.js';
import type { IconName } from './mobile-icons.js';

/** The palette's tabs, as on Word for Android. Table, Picture and Shape appear with a selection. */
export type MobileTabId = 'Home' | 'Insert' | 'Draw' | 'Layout' | 'Review' | 'View' | 'Table' | 'Picture' | 'Shape';

export interface MobileOptions {
  /** Open in Mobile View, which reflows the text to the screen (Word's phone default). Default true. */
  mobileView?: boolean;
  /** Title shown in the title bar. Default: the document's title. */
  title?: string;
  /** Show a back arrow at the left of the title bar that calls this (e.g. back to your file list). */
  onBack?: () => void;
  /** Share in the More menu. Default: the browser's share sheet with the .docx, when it has one. */
  onShare?: (editor: Editor) => void;
  /** Insert › Camera (a photo from the phone's camera). Default true. */
  camera?: boolean;
  /** A microphone button for dictation, where the browser offers speech recognition. Default true. */
  dictation?: boolean;
  /** Hide the title bar and palette while scrolling down, as Word does. Default true. */
  shyChrome?: boolean;
}

/** The layout's own state shared with the palette's buttons. */
export interface PaletteState {
  format: FormatState;
  view: ViewState;
  mode: EditorMode;
}

/** `format.state`: the formatting at the selection. */
export interface FormatState {
  font?: string | null;
  size?: number | null;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  subscript?: boolean;
  superscript?: boolean;
  color?: string | null;
  highlight?: string | null;
  style?: string;
  styleName?: string;
}

/** `view.state`, as far as the layout reads it. */
export interface ViewState {
  mode?: string;
  zoom?: number;
  ruler?: boolean;
  [key: string]: unknown;
}

type PageId =
  | 'font'
  | 'size'
  | 'color'
  | 'highlight'
  | 'moreFormat'
  | 'paragraph'
  | 'styles'
  | 'table'
  | 'shapes'
  | 'link'
  | 'comment'
  | 'pageNumbers'
  | 'symbol'
  | 'margins'
  | 'orientation'
  | 'pageSize'
  | 'columns'
  | 'breaks'
  | 'zoom'
  | 'mode'
  | 'tableStyles'
  | 'wrap'
  | 'pictureStyles'
  | 'altText'
  | 'shapeFill'
  | 'shapeOutline'
  | 'shapeEffects'
  | 'more';

type ActionId = 'find' | 'picture' | 'camera' | 'wordCount' | 'drawOff' | 'mobileView' | 'printLayout';

export type PaletteItem =
  | { kind: 'command'; label: string; icon: IconName; command: string; params?: Record<string, unknown>; active?: (s: PaletteState) => boolean; keep?: boolean }
  | { kind: 'page'; label: string; icon: IconName; page: PageId; value?: (s: PaletteState) => string | undefined }
  | { kind: 'action'; label: string; icon: IconName; action: ActionId; active?: (s: PaletteState) => boolean }
  | { kind: 'row'; items: PaletteItem[] }
  | { kind: 'fontBoxes' };

export interface PaletteTab {
  id: MobileTabId;
  /** Groups of items, drawn with a divider between them. */
  groups: PaletteItem[][];
  /** Shown only while the selection calls for it (a table, picture or shape). */
  contextual?: boolean;
}

const cmd = (label: string, icon: IconName, command: string, params?: Record<string, unknown>, active?: (s: PaletteState) => boolean): PaletteItem => ({ kind: 'command', label, icon, command, params, active });
const page = (label: string, icon: IconName, p: PageId, value?: (s: PaletteState) => string | undefined): PaletteItem => ({ kind: 'page', label, icon, page: p, value });
const act = (label: string, icon: IconName, action: ActionId, active?: (s: PaletteState) => boolean): PaletteItem => ({ kind: 'action', label, icon, action, active });
const isWeb = (s: PaletteState) => s.view.mode === 'Web' || s.view.mode === 'web';

/**
 * The palette, tab by tab. Commands are WordCraft's own ids; the host's `disabledCommands`,
 * `tabs` and `hiddenTabs` thin it out the same way they thin the ribbon.
 */
export const MOBILE_PALETTE: PaletteTab[] = [
  {
    id: 'Home',
    groups: [
      [{ kind: 'fontBoxes' }],
      [
        {
          kind: 'row',
          items: [
            cmd('Bold', 'bold', 'format.bold', undefined, (s) => !!s.format.bold),
            cmd('Italic', 'italic', 'format.italic', undefined, (s) => !!s.format.italic),
            cmd('Underline', 'underline', 'format.underline', undefined, (s) => !!s.format.underline),
            page('Highlight', 'highlight', 'highlight'),
            page('Font Color', 'fontColor', 'color'),
          ],
        },
        page('More Formatting', 'strike', 'moreFormat'),
      ],
      [
        {
          kind: 'row',
          items: [cmd('Bullets', 'bullets', 'para.bullets'), cmd('Numbering', 'numbering', 'para.numbering'), cmd('Decrease Indent', 'outdent', 'para.outdent'), cmd('Increase Indent', 'indent', 'para.indent')],
        },
        page('Paragraph Formatting', 'paragraph', 'paragraph'),
      ],
      [page('Styles', 'styles', 'styles', (s) => s.format.styleName ?? undefined)],
      [act('Find', 'search', 'find')],
    ],
  },
  {
    id: 'Insert',
    groups: [
      [page('Table', 'table', 'table'), act('Pictures', 'picture', 'picture'), act('Camera', 'camera', 'camera'), page('Shapes', 'shapes', 'shapes'), cmd('Text Box', 'textBox', 'insert.textBox')],
      [page('Link', 'link', 'link'), page('Comment', 'comment', 'comment')],
      [cmd('Header', 'header', 'insert.header', { preset: 'blank' }), cmd('Footer', 'footer', 'insert.footer', { preset: 'blank' }), page('Page Numbers', 'pageNumber', 'pageNumbers'), cmd('Footnote', 'footnote', 'references.footnote')],
      [page('Symbol', 'symbol', 'symbol'), cmd('Page Break', 'pageBreak', 'insert.pageBreak')],
    ],
  },
  {
    id: 'Draw',
    groups: [
      [cmd('Pen', 'pen', 'draw.pen'), cmd('Pencil', 'pencil', 'draw.pencil'), cmd('Highlighter', 'marker', 'draw.highlighter'), cmd('Eraser', 'eraser', 'draw.eraser'), cmd('Lasso Select', 'lasso', 'draw.lasso')],
      [act('Stop Drawing', 'stopDraw', 'drawOff')],
    ],
  },
  {
    id: 'Layout',
    groups: [[page('Margins', 'margins', 'margins'), page('Orientation', 'orientation', 'orientation'), page('Size', 'pageSize', 'pageSize'), page('Columns', 'columns', 'columns'), page('Breaks', 'breaks', 'breaks')]],
  },
  {
    id: 'Review',
    groups: [
      [cmd('Spelling', 'spelling', 'review.spelling'), act('Word Count', 'wordCount', 'wordCount')],
      [page('New Comment', 'comment', 'comment'), cmd('Show Comments', 'comment', 'view.commentsPane'), cmd('Previous Comment', 'prev', 'review.previousComment'), cmd('Next Comment', 'next', 'review.nextComment')],
      [cmd('Track Changes', 'track', 'review.trackChanges'), page('Mode', 'markup', 'mode', (s) => modeLabel(s.mode))],
      [
        {
          kind: 'row',
          items: [cmd('Previous Change', 'prev', 'review.previousChange'), cmd('Next Change', 'next', 'review.nextChange'), cmd('Accept', 'accept', 'review.accept'), cmd('Reject', 'reject', 'review.reject')],
        },
      ],
    ],
  },
  {
    id: 'View',
    groups: [
      [act('Mobile View', 'mobile', 'mobileView', isWeb), act('Print Layout', 'print', 'printLayout', (s) => !isWeb(s))],
      [page('Zoom', 'zoom', 'zoom', (s) => (typeof s.view.zoom === 'number' ? `${Math.round(s.view.zoom)}%` : undefined)), cmd('Navigation', 'navigation', 'view.navigationPane'), cmd('Read Aloud', 'readAloud', 'review.readAloud')],
      [cmd('Dark Page', 'moon', 'view.darkMode')],
    ],
  },
  {
    id: 'Table',
    contextual: true,
    groups: [
      [
        { kind: 'row', items: [cmd('Insert Above', 'rowAbove', 'table.insertRowAbove'), cmd('Insert Below', 'rowBelow', 'table.insertRowBelow'), cmd('Insert Left', 'colLeft', 'table.insertColumnLeft'), cmd('Insert Right', 'colRight', 'table.insertColumnRight')] },
      ],
      [cmd('Delete Rows', 'trash', 'table.deleteRow'), cmd('Delete Columns', 'trash', 'table.deleteColumn'), cmd('Delete Table', 'trash', 'table.deleteTable'), cmd('Merge Cells', 'merge', 'table.merge')],
      [page('Table Styles', 'table', 'tableStyles'), cmd('AutoFit to Contents', 'autofit', 'table.autofit', { mode: 'contents' }), cmd('AutoFit to Window', 'autofit', 'table.autofit', { mode: 'window' })],
    ],
  },
  {
    id: 'Picture',
    contextual: true,
    groups: [[page('Styles', 'picture', 'pictureStyles'), page('Wrap Text', 'wrap', 'wrap'), page('Alt Text', 'altText', 'altText'), cmd('Reset Picture', 'reset', 'picture.reset')]],
  },
  {
    id: 'Shape',
    contextual: true,
    groups: [[page('Fill', 'fill', 'shapeFill'), page('Outline', 'outline', 'shapeOutline'), page('Effects', 'effects', 'shapeEffects'), page('Wrap Text', 'wrap', 'wrap')]],
  },
];

const TAB_LABEL: Record<MobileTabId, string> = { Home: 'Home', Insert: 'Insert', Draw: 'Draw', Layout: 'Layout', Review: 'Review', View: 'View', Table: 'Table', Picture: 'Picture', Shape: 'Shape' };

function modeLabel(m: EditorMode): string {
  return m === 'reviewing' ? 'Reviewing' : m === 'viewing' ? 'Viewing' : 'Editing';
}

/** The contextual palette tabs for WordCraft's contextual ribbon tabs. */
function contextualTabs(info: SelectionInfo | null): MobileTabId[] {
  const out: MobileTabId[] = [];
  const c = info?.contextual ?? [];
  if (c.includes('Table Layout') || c.includes('Table Design')) out.push('Table');
  if (c.includes('Picture Format')) out.push('Picture');
  if (c.includes('Shape Format')) out.push('Shape');
  return out;
}

/** Is `id` turned off by a `disabledCommands` entry (an id, or a prefix ending in `*`)? */
function disabled(id: string, list: string[]): boolean {
  return list.some((d) => (d.endsWith('*') ? id.startsWith(d.slice(0, -1)) : d === id));
}

function itemCommand(item: PaletteItem): string | null {
  return item.kind === 'command' ? item.command : null;
}

const COLORS = ['000000', '404040', '7F7F7F', 'BFBFBF', 'FFFFFF', 'C00000', 'FF0000', 'FFC000', 'FFFF00', '92D050', '00B050', '00B0F0', '0070C0', '002060', '7030A0'];
const HIGHLIGHTS: Array<[string, string]> = [
  ['yellow', 'FFFF00'],
  ['brightGreen', '00FF00'],
  ['turquoise', '00FFFF'],
  ['pink', 'FF00FF'],
  ['blue', '0000FF'],
  ['red', 'FF0000'],
  ['darkBlue', '000080'],
  ['teal', '008080'],
  ['green', '008000'],
  ['violet', '800080'],
  ['darkRed', '800000'],
  ['darkYellow', '808000'],
  ['gray50', '808080'],
  ['gray25', 'C0C0C0'],
  ['black', '000000'],
];
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
const FONTS = ['Aptos', 'Calibri', 'Arial', 'Times New Roman', 'Georgia', 'Cambria', 'Verdana', 'Garamond', 'Courier New', 'Roboto', 'Open Sans', 'Lato', 'Merriweather', 'Noto Sans', 'Noto Serif'];
// Common symbols (no dash characters: insert those from the keyboard).
const SYMBOLS = ['©', '®', '™', '§', '¶', '†', '‡', '•', '…', '€', '£', '¥', '¢', '°', '±', '×', '÷', '≠', '≈', '≤', '≥', '∞', 'µ', 'π', 'Ω', '∑', '√', '½', '¼', '¾', '✓', '✗', '→', '←', '↑', '↓', '★', '♥', '«', '»'];
const SHAPES: Array<[string, string]> = [
  ['rectangle', 'Rectangle'],
  ['roundedRectangle', 'Rounded Rectangle'],
  ['ellipse', 'Oval'],
  ['triangle', 'Triangle'],
  ['diamond', 'Diamond'],
  ['star', 'Star'],
  ['heart', 'Heart'],
  ['arrow', 'Arrow'],
  ['line', 'Line'],
];
// WordCraft's built-in table styles (by id; their names carry dashes).
const TABLE_STYLES: Array<[string, string]> = [
  ['TableGrid', 'Table Grid'],
  ['PlainTable1', 'Plain Table 1'],
  ['GridTable1Light', 'Grid Table 1 Light'],
  ['GridTable4AccentBlue', 'Grid Table 4, Blue'],
  ['GridTable4AccentOrange', 'Grid Table 4, Orange'],
  ['GridTable4AccentGreen', 'Grid Table 4, Green'],
  ['GridTable4AccentPurple', 'Grid Table 4, Purple'],
  ['ListTable3AccentBlue', 'List Table 3, Blue'],
  ['ListTable3AccentOrange', 'List Table 3, Orange'],
  ['ListTable3AccentGreen', 'List Table 3, Green'],
  ['ListTable3AccentPurple', 'List Table 3, Purple'],
];
const WRAPS: Array<[string, string]> = [
  ['inline', 'In Line with Text'],
  ['square', 'Square'],
  ['tight', 'Tight'],
  ['through', 'Through'],
  ['topAndBottom', 'Top and Bottom'],
  ['behindText', 'Behind Text'],
  ['inFrontOfText', 'In Front of Text'],
];

// ---------------------------------------------------------------------------------------------

/** Keep a tap on our buttons from taking focus from the editor (which would close the keyboard). */
const keepFocus = (e: ReactPointerEvent) => e.preventDefault();

export interface MobileShellProps {
  editor: Editor;
  options: MobileOptions;
  dark?: boolean;
  /** Ribbon tabs the host hides (they hide the same palette tabs). */
  hiddenTabs: RibbonTab[];
  disabledCommands: string[];
  /** Version History and AI, when the host turned them on. */
  onVersions?: () => void;
  onAi?: () => void;
  /** Tell the editor component how much room the chrome takes, so the page sits between it. */
  onInsets: (top: number, bottom: number) => void;
}

type Sheet = 'peek' | 'open' | 'closed';

const TITLE_H = 48;
const PEEK_H = 48;

export function MobileShell({ editor, options, dark, hiddenTabs, disabledCommands, onVersions, onAi, onInsets }: MobileShellProps) {
  const [sheet, setSheet] = useState<Sheet>('peek');
  const [tab, setTab] = useState<MobileTabId>('Home');
  const [pages, setPages] = useState<PageId[]>([]);
  const [switcher, setSwitcher] = useState(false);
  const [menu, setMenu] = useState(false);
  const [finding, setFinding] = useState(false);
  const [toast, setToast] = useState<ReactNode>(null);
  const [state, setState] = useState<PaletteState>({ format: {}, view: {}, mode: 'editing' });
  const [info, setInfo] = useState<SelectionInfo | null>(null);
  const [hidden, setHidden] = useState(false);
  const [keyboard, setKeyboard] = useState(0);
  const [title, setTitle] = useState('');
  const [listening, setListening] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const lastScrolled = useRef<number | null>(null);
  const lastContextual = useRef<string>('');
  const clipboardText = useRef<string>('');
  const shy = options.shyChrome !== false;
  const viewing = state.mode === 'viewing';

  // Read the formatting and view state after every change (once per frame at most).
  const refresh = useCallback(() => {
    if (editor.destroyed) return;
    try {
      setState({
        format: editor.execute<FormatState>('format.state') ?? {},
        view: editor.execute<ViewState>('view.state') ?? {},
        mode: editor.getMode(),
      });
      setTitle(options.title ?? editor.title());
    } catch {
      // The editor is busy or gone; the next change refreshes.
    }
  }, [editor, options.title]);
  const frame = useRef(0);
  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(refresh);
  }, [refresh]);

  useEffect(() => {
    refresh();
    const offSel = editor.onSelection((i) => {
      setInfo(i);
      schedule();
    });
    // The mode and title can change from outside (the host's own buttons): look twice a second.
    let lastMode = editor.getMode();
    let lastTitle = editor.title();
    const tick = window.setInterval(() => {
      if (editor.destroyed) return;
      const mode = editor.getMode();
      const t = editor.title();
      if (mode !== lastMode || t !== lastTitle) {
        lastMode = mode;
        lastTitle = t;
        schedule();
      }
    }, 500);
    return () => {
      offSel();
      window.clearInterval(tick);
      cancelAnimationFrame(frame.current);
    };
  }, [editor, refresh, schedule]);

  // Phone set-up: Mobile View (or the page fitted to the width), no rulers.
  useEffect(() => {
    if (editor.destroyed) return;
    try {
      const view = editor.execute<ViewState>('view.state') ?? {};
      if (view.ruler) editor.execute('view.ruler');
      if (options.mobileView !== false) editor.execute('view.webLayout');
      else editor.execute('view.zoom', { value: 'pageWidth' });
    } catch (e) {
      console.warn('[wordcraft] mobile set-up', e);
    }
    refresh();
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Contextual tabs: open the new one when a table, picture or shape gets selected.
  const ctx = contextualTabs(info);
  const ctxKey = ctx.join(',');
  useEffect(() => {
    if (ctxKey && ctxKey !== lastContextual.current && sheet === 'open') {
      setTab(ctx[0]);
      setPages([]);
    }
    if (!ctxKey && (tab === 'Table' || tab === 'Picture' || tab === 'Shape')) setTab('Home');
    lastContextual.current = ctxKey;
  }, [ctxKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shy chrome: scrolling down the document hides the bars, scrolling up brings them back.
  useEffect(() => {
    if (!shy || !info) return;
    const prev = lastScrolled.current;
    lastScrolled.current = info.scrolled;
    if (prev === null) return;
    const d = info.scrolled - prev;
    if (d < -6 && sheet !== 'open' && !finding) setHidden(true);
    else if (d > 6) setHidden(false);
  }, [info, shy, sheet, finding]);

  // The soft keyboard: keep the palette just above it.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const el = rootRef.current;
      if (!el) return;
      const bottom = el.getBoundingClientRect().bottom;
      setKeyboard(Math.max(0, Math.round(bottom - (vv.offsetTop + vv.height))));
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    onResize();
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
    };
  }, []);

  // Room the chrome takes, for the page between it.
  const sheetH = viewing ? 0 : sheet === 'open' ? 0 : sheet === 'peek' ? PEEK_H : 0;
  const top = hidden ? 0 : TITLE_H;
  const bottom = (hidden && sheet !== 'open' ? 0 : sheetH) + keyboard;
  useEffect(() => onInsets(top, bottom), [top, bottom, onInsets]);

  const run = useCallback(
    (command: string, params?: Record<string, unknown>) => {
      try {
        const out = editor.execute(command, params);
        schedule();
        return out;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setToast(<span>{msg}</span>);
        return null;
      }
    },
    [editor, schedule],
  );

  const tabs = useMemo(() => {
    const base = MOBILE_PALETTE.filter((t) => !t.contextual && !hiddenTabs.includes(t.id as RibbonTab));
    const extra = MOBILE_PALETTE.filter((t) => t.contextual && ctx.includes(t.id));
    return [...base, ...extra];
  }, [hiddenTabs, ctxKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];

  const openPage = (p: PageId) => setPages((s) => [...s, p]);
  const backPage = () => setPages((s) => s.slice(0, -1));

  const drawing = useRef(false);
  const doAction = (a: ActionId) => {
    switch (a) {
      case 'find':
        setFinding(true);
        setSheet('peek');
        break;
      case 'picture':
        fileRef.current?.click();
        break;
      case 'camera':
        cameraRef.current?.click();
        break;
      case 'wordCount': {
        const c = run('review.wordCount') as Record<string, number> | null;
        if (c) setToast(<WordCount counts={c} />);
        break;
      }
      case 'drawOff':
        run('draw.select');
        editor.setTouch(true);
        drawing.current = false;
        break;
      case 'mobileView':
        run('view.webLayout');
        break;
      case 'printLayout':
        run('view.printLayout');
        run('view.zoom', { value: 'pageWidth' });
        break;
    }
  };

  const press = (item: PaletteItem) => {
    if (item.kind === 'command') {
      run(item.command, item.params);
      // A pen draws with one finger; two fingers still scroll and zoom.
      if (item.command.startsWith('draw.') && item.command !== 'draw.select') {
        editor.setTouch(false);
        drawing.current = true;
        setSheet('peek');
      }
    } else if (item.kind === 'page') openPage(item.page);
    else if (item.kind === 'action') doAction(item.action);
  };

  const insertImage = async (file: File | undefined) => {
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const name = file.name && file.name.includes('.') ? file.name : `photo.${(file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`;
    run('insert.picture', { path: name, data: btoa(bin) });
  };

  // Floatie: Cut, Copy, Paste, Comment over a touch selection.
  const floatie = info && !info.collapsed && info.touch && !info.scrolling && info.visible && info.rect && !viewing;
  const copy = async (cut: boolean) => {
    const text = editor.getSelectedText();
    clipboardText.current = text;
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      // The system clipboard refused; WordCraft's own still has it.
    }
    run(cut ? 'edit.cut' : 'edit.copy');
  };
  const paste = async () => {
    let text: string | null = null;
    try {
      text = (await navigator.clipboard?.readText()) ?? null;
    } catch {
      text = null;
    }
    // Text we copied ourselves pastes with its formatting from WordCraft's clipboard.
    if (text === null || text === clipboardText.current) run('edit.paste');
    else run('edit.paste', { text });
  };

  // Dictation into the document, where the browser offers speech recognition.
  type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
  const recognition = useRef<Recognition | null>(null);
  const SpeechCtor = typeof window !== 'undefined' ? ((window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as (new () => Recognition) | undefined : undefined;
  const canDictate = options.dictation !== false && !!SpeechCtor && !viewing;
  const dictate = () => {
    if (!SpeechCtor) return;
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const r = new SpeechCtor();
    r.lang = document.documentElement.lang || navigator.language || 'en-US';
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) run('text.insert', { text: `${res[0].transcript.trim()} ` });
      }
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recognition.current = r;
    r.start();
    setListening(true);
  };
  useEffect(() => () => recognition.current?.stop(), []);

  const share = async () => {
    setMenu(false);
    if (options.onShare) return options.onShare(editor);
    const name = `${(title || 'Document').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Document'}.docx`;
    const file = new File([editor.exportBlob('docx')], name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: name });
        return;
      } catch {
        // Cancelled: nothing to do.
        return;
      }
    }
    download(file);
  };

  const stop = (e: ReactKeyboardEvent) => e.stopPropagation();
  const pageId = pages[pages.length - 1];

  return (
    <div ref={rootRef} className="wcm" data-theme={dark ? 'dark' : 'light'} onKeyDown={stop} onKeyUp={stop}>
      <style>{CSS}</style>
      {/* Title bar, or the find bar in its place. */}
      <header className="wcm-top" data-hidden={hidden || undefined} style={{ height: TITLE_H }}>
        {finding ? (
          <FindBar run={run} onClose={() => setFinding(false)} />
        ) : (
          <>
            {options.onBack && <IconButton icon="back" label="Back" onPress={options.onBack} />}
            <div className="wcm-title" title={title}>
              {title}
            </div>
            {viewing ? (
              <button type="button" className="wcm-edit" onPointerDown={keepFocus} onClick={() => (editor.setMode('editing'), schedule())}>
                <Icon name="edit" size={18} />
                Edit
              </button>
            ) : (
              <>
                <IconButton icon="undo" label="Undo" onPress={() => run('edit.undo')} />
                <IconButton icon="redo" label="Redo" onPress={() => run('edit.redo')} />
              </>
            )}
            <IconButton icon="mobile" label="Mobile View" active={isWeb(state)} onPress={() => doAction(isWeb(state) ? 'printLayout' : 'mobileView')} />
            {!viewing && <IconButton icon="palette" label="Show commands" active={sheet === 'open'} onPress={() => setSheet(sheet === 'open' ? 'peek' : 'open')} />}
            <IconButton icon="more" label="More options" onPress={() => setMenu((m) => !m)} />
          </>
        )}
      </header>

      {menu && (
        <>
          <div className="wcm-scrim" onClick={() => setMenu(false)} />
          <div className="wcm-menu" role="menu">
            <MenuItem icon="search" label="Find" onPress={() => (setMenu(false), doAction('find'))} />
            <MenuItem icon="save" label="Save" onPress={() => (setMenu(false), run('file.save'))} />
            <MenuItem icon="share" label="Share" onPress={share} />
            <MenuItem icon="download" label="Download as PDF" onPress={() => (setMenu(false), download(new File([editor.exportBlob('pdf')], `${title || 'Document'}.pdf`, { type: 'application/pdf' })))} />
            <MenuItem icon="print" label="Print" onPress={() => (setMenu(false), editor.print())} />
            <MenuItem icon="wordCount" label="Word Count" onPress={() => (setMenu(false), doAction('wordCount'))} />
            {onVersions && <MenuItem icon="history" label="Version History" onPress={() => (setMenu(false), onVersions())} />}
            {onAi && !viewing && <MenuItem icon="sparkle" label="Write with AI" extra onPress={() => (setMenu(false), setSheet('peek'), onAi())} />}
            <div className="wcm-menu-sep" />
            {(['editing', 'reviewing', 'viewing'] as EditorMode[]).map((m) => (
              <MenuItem key={m} icon={m === 'editing' ? 'edit' : m === 'reviewing' ? 'track' : 'markup'} label={modeLabel(m)} checked={state.mode === m} onPress={() => (setMenu(false), editor.setMode(m), schedule())} />
            ))}
          </div>
        </>
      )}

      {/* Floatie over a touch selection. */}
      {floatie && info.rect && (
        <div className="wcm-floatie" role="toolbar" aria-label="Selection" style={floatiePos(info)}>
          <FloatieButton icon="cut" label="Cut" onPress={() => void copy(true)} />
          <FloatieButton icon="copy" label="Copy" onPress={() => void copy(false)} />
          <FloatieButton icon="paste" label="Paste" onPress={() => void paste()} />
          <FloatieButton icon="comment" label="Comment" onPress={() => (setSheet('open'), setTab('Review'), setPages(['comment']))} />
          <FloatieButton icon="palette" label="Format" onPress={() => (setSheet('open'), setTab('Home'), setPages([]))} />
        </div>
      )}

      {/* Dictation. */}
      {canDictate && !hidden && sheet !== 'open' && (
        <button type="button" className="wcm-fab" data-on={listening || undefined} aria-label={listening ? 'Stop dictation' : 'Dictate'} aria-pressed={listening} onPointerDown={keepFocus} onClick={dictate} style={{ bottom: bottom + 16 }}>
          <Icon name="mic" />
        </button>
      )}

      {toast && (
        <div className="wcm-toast" role="status" style={{ bottom: bottom + 16 }}>
          <div className="wcm-toast-body">{toast}</div>
          <button type="button" className="wcm-toast-close" aria-label="Close" onClick={() => setToast(null)}>
            <Icon name="close" size={18} />
          </button>
        </div>
      )}

      {/* The command palette. */}
      {!viewing && sheet !== 'closed' && (
        <section className="wcm-sheet" data-open={sheet === 'open' || undefined} data-hidden={(hidden && sheet !== 'open') || undefined} style={{ bottom: keyboard }} aria-label="Commands">
          {sheet === 'peek' ? (
            <div className="wcm-peek" role="toolbar" aria-label="Quick formatting">
              <ToolButton icon="bold" label="Bold" active={!!state.format.bold} onPress={() => run('format.bold')} />
              <ToolButton icon="italic" label="Italic" active={!!state.format.italic} onPress={() => run('format.italic')} />
              <ToolButton icon="underline" label="Underline" active={!!state.format.underline} onPress={() => run('format.underline')} />
              <ToolButton icon="bullets" label="Bullets" onPress={() => run('para.bullets')} />
              <ToolButton icon="numbering" label="Numbering" onPress={() => run('para.numbering')} />
              <ToolButton icon="comment" label="New Comment" onPress={() => (setSheet('open'), setTab('Review'), setPages(['comment']))} />
              <span className="wcm-peek-gap" />
              <ToolButton icon="up" label="Show commands" onPress={() => setSheet('open')} />
            </div>
          ) : (
            <>
              <div className="wcm-sheet-head">
                {pageId ? (
                  <>
                    <IconButton icon="back" label="Back" onPress={backPage} />
                    <div className="wcm-sheet-title">{pageTitle(pageId)}</div>
                  </>
                ) : (
                  <button type="button" className="wcm-switch" aria-haspopup="listbox" aria-expanded={switcher} onPointerDown={keepFocus} onClick={() => setSwitcher((s) => !s)}>
                    {TAB_LABEL[current.id]}
                    {current.contextual && <span className="wcm-ctx-dot" />}
                    <Icon name="down" size={18} />
                  </button>
                )}
                <span className="wcm-gap" />
                <IconButton icon="undo" label="Undo" onPress={() => run('edit.undo')} />
                <IconButton icon="down" label="Hide commands" onPress={() => (setSheet('peek'), setPages([]), setSwitcher(false))} />
              </div>
              {switcher && !pageId && (
                <div className="wcm-tabs" role="listbox" aria-label="Tabs">
                  {tabs.map((t) => (
                    <button key={t.id} type="button" role="option" aria-selected={t.id === current.id} className="wcm-tab" onPointerDown={keepFocus} onClick={() => (setTab(t.id), setSwitcher(false))}>
                      {TAB_LABEL[t.id]}
                      {t.contextual && <span className="wcm-ctx">Selection</span>}
                      {t.id === current.id && <Icon name="check" size={18} />}
                    </button>
                  ))}
                </div>
              )}
              <div className="wcm-body">
                {pageId ? (
                  <DrillPage id={pageId} state={state} editor={editor} run={run} done={() => setPages([])} openPage={openPage} />
                ) : (
                  current.groups.map((g, gi) => {
                    const items = g.filter((it) => !itemCommand(it) || !disabled(itemCommand(it)!, disabledCommands)).filter((it) => !(it.kind === 'action' && it.action === 'camera' && options.camera === false));
                    if (!items.length) return null;
                    return (
                      <div key={gi} className="wcm-group">
                        {items.map((it, i) => (
                          <PaletteRow key={i} item={it} state={state} disabledCommands={disabledCommands} onPress={press} openPage={openPage} />
                        ))}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </section>
      )}

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => (void insertImage(e.target.files?.[0]), (e.target.value = ''))} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (void insertImage(e.target.files?.[0]), (e.target.value = ''))} />
    </div>
  );
}

function floatiePos(info: SelectionInfo): CSSProperties {
  const r = info.rect!;
  const page = info.page ?? r;
  const h = 48;
  // Above the selection when there is room, else below its first line.
  const above = r.y - h - 12 >= page.y;
  const y = above ? r.y - h - 12 : Math.min(r.y + r.height + 28, page.y + page.height - h - 8);
  const cx = r.x + r.width / 2;
  return { top: Math.max(page.y + 4, y), left: `clamp(8px, ${cx}px - 130px, calc(100% - 268px))` };
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function pageTitle(p: PageId): string {
  const t: Record<PageId, string> = {
    font: 'Font',
    size: 'Font Size',
    color: 'Font Color',
    highlight: 'Highlight',
    moreFormat: 'More Formatting',
    paragraph: 'Paragraph Formatting',
    styles: 'Styles',
    table: 'Insert Table',
    shapes: 'Shapes',
    link: 'Link',
    comment: 'New Comment',
    pageNumbers: 'Page Numbers',
    symbol: 'Symbol',
    margins: 'Margins',
    orientation: 'Orientation',
    pageSize: 'Size',
    columns: 'Columns',
    breaks: 'Breaks',
    zoom: 'Zoom',
    mode: 'Mode',
    tableStyles: 'Table Styles',
    wrap: 'Wrap Text',
    pictureStyles: 'Picture Styles',
    altText: 'Alt Text',
    shapeFill: 'Shape Fill',
    shapeOutline: 'Shape Outline',
    shapeEffects: 'Shape Effects',
    more: 'More',
  };
  return t[p];
}

// ---------------------------------------------------------------------------------------------
// Pieces

function IconButton({ icon, label, onPress, active }: { icon: IconName; label: string; onPress: () => void; active?: boolean }) {
  return (
    <button type="button" className="wcm-icon" aria-label={label} title={label} aria-pressed={active} onPointerDown={keepFocus} onClick={onPress}>
      <Icon name={icon} />
    </button>
  );
}

function ToolButton({ icon, label, onPress, active }: { icon: IconName; label: string; onPress: () => void; active?: boolean }) {
  return (
    <button type="button" className="wcm-tool" aria-label={label} title={label} aria-pressed={active ?? undefined} onPointerDown={keepFocus} onClick={onPress}>
      <Icon name={icon} />
    </button>
  );
}

function FloatieButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <button type="button" className="wcm-fl" aria-label={label} onPointerDown={keepFocus} onClick={onPress}>
      <Icon name={icon} size={20} />
      <span>{label}</span>
    </button>
  );
}

function MenuItem({ icon, label, onPress, checked, extra }: { icon: IconName; label: string; onPress: () => void; checked?: boolean; extra?: boolean }) {
  return (
    <button type="button" role={checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={checked} className="wcm-menu-item" onPointerDown={keepFocus} onClick={onPress}>
      <Icon name={icon} size={20} />
      <span>{label}</span>
      {extra && <span className="wcm-extra">Extra</span>}
      {checked && <Icon name="check" size={18} />}
    </button>
  );
}

function PaletteRow({ item, state, disabledCommands, onPress, openPage }: { item: PaletteItem; state: PaletteState; disabledCommands: string[]; onPress: (i: PaletteItem) => void; openPage: (p: PageId) => void }) {
  if (item.kind === 'fontBoxes') {
    return (
      <div className="wcm-boxes">
        <button type="button" className="wcm-box" style={{ fontFamily: state.format.font ? `"${state.format.font}", system-ui` : undefined }} onPointerDown={keepFocus} onClick={() => openPage('font')}>
          <span>{state.format.font ?? 'Font'}</span>
          <Icon name="forward" size={18} />
        </button>
        <button type="button" className="wcm-box wcm-box-size" onPointerDown={keepFocus} onClick={() => openPage('size')}>
          <span>{state.format.size ?? ''}</span>
          <Icon name="forward" size={18} />
        </button>
      </div>
    );
  }
  if (item.kind === 'row') {
    const items = item.items.filter((it) => !itemCommand(it) || !disabled(itemCommand(it)!, disabledCommands));
    return (
      <div className="wcm-row" role="toolbar">
        {items.map((it, i) => {
          if (it.kind === 'row' || it.kind === 'fontBoxes') return null;
          const active = it.kind === 'command' || it.kind === 'action' ? it.active?.(state) : undefined;
          return (
            <button key={i} type="button" className="wcm-tool" aria-label={it.label} title={it.label} aria-pressed={active} onPointerDown={keepFocus} onClick={() => onPress(it)}>
              <Icon name={it.icon} />
              {it.kind === 'page' && <span className="wcm-tool-more" />}
            </button>
          );
        })}
      </div>
    );
  }
  const active = item.kind === 'command' || item.kind === 'action' ? item.active?.(state) : undefined;
  const value = item.kind === 'page' ? item.value?.(state) : undefined;
  return (
    <button type="button" className="wcm-item" aria-pressed={active} onPointerDown={keepFocus} onClick={() => onPress(item)}>
      <Icon name={item.icon} />
      <span className="wcm-item-label">{item.label}</span>
      {value && <span className="wcm-item-value">{value}</span>}
      {item.kind === 'page' && <Icon name="forward" size={18} />}
      {active && item.kind !== 'page' && <Icon name="check" size={18} />}
    </button>
  );
}

function Choice({ label, onPress, selected, style, icon }: { label: string; onPress: () => void; selected?: boolean; style?: CSSProperties; icon?: IconName }) {
  return (
    <button type="button" className="wcm-item" aria-pressed={selected} onPointerDown={keepFocus} onClick={onPress}>
      {icon && <Icon name={icon} />}
      <span className="wcm-item-label" style={style}>
        {label}
      </span>
      {selected && <Icon name="check" size={18} />}
    </button>
  );
}

function Swatches({ colors, onPick, auto }: { colors: Array<[string, string]>; onPick: (value: string) => void; auto?: { label: string; value: string } }) {
  return (
    <div className="wcm-swatches">
      {auto && <Choice label={auto.label} onPress={() => onPick(auto.value)} />}
      <div className="wcm-swatch-grid">
        {colors.map(([value, hex]) => (
          <button key={value} type="button" className="wcm-swatch" aria-label={value} title={value} style={{ background: `#${hex}` }} onPointerDown={keepFocus} onClick={() => onPick(value)} />
        ))}
      </div>
    </div>
  );
}

function WordCount({ counts }: { counts: Record<string, number> }) {
  const rows: Array<[string, unknown]> = [
    ['Pages', counts.pages],
    ['Words', counts.words],
    ['Characters (no spaces)', counts.charactersNoSpaces ?? counts.charsNoSpaces],
    ['Characters (with spaces)', counts.characters ?? counts.chars],
    ['Paragraphs', counts.paragraphs],
  ];
  return (
    <div className="wcm-count">
      <strong>Word Count</strong>
      {rows
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <span>{(v as number).toLocaleString()}</span>
          </div>
        ))}
    </div>
  );
}

function FindBar({ run, onClose }: { run: (c: string, p?: Record<string, unknown>) => unknown; onClose: () => void }) {
  const [text, setText] = useState('');
  const [replace, setReplace] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [options, setOptions] = useState(false);
  const [count, setCount] = useState<string>('');
  const find = (q = text) => {
    if (!q) return setCount('');
    const out = run('edit.find', { text: q, matchCase, wholeWord }) as { count?: number; matches?: number; total?: number } | null;
    const n = out?.count ?? out?.matches ?? out?.total;
    setCount(typeof n === 'number' ? (n === 0 ? 'No results' : `${n} found`) : '');
  };
  return (
    <div className="wcm-find">
      <div className="wcm-find-row">
        <IconButton icon="back" label="Close find" onPress={onClose} />
        <input
          className="wcm-find-input"
          autoFocus
          enterKeyHint="search"
          placeholder="Find in document"
          aria-label="Find in document"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.shiftKey ? run('edit.findPrevious') : count ? run('edit.findNext') : find());
            if (e.key === 'Escape') onClose();
          }}
          onBlur={() => find()}
        />
        {count && <span className="wcm-find-count">{count}</span>}
        <IconButton icon="prev" label="Previous result" onPress={() => run('edit.findPrevious')} />
        <IconButton icon="next" label="Next result" onPress={() => (count ? run('edit.findNext') : find())} />
        <IconButton icon="more" label="Find options" active={options} onPress={() => setOptions((o) => !o)} />
      </div>
      {options && (
        <div className="wcm-find-options">
          <label>
            <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case
          </label>
          <label>
            <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole words
          </label>
          <label>
            <input type="checkbox" checked={replacing} onChange={(e) => setReplacing(e.target.checked)} /> Replace
          </label>
        </div>
      )}
      {replacing && (
        <div className="wcm-find-row">
          <Icon name="replace" />
          <input className="wcm-find-input" placeholder="Replace with" aria-label="Replace with" value={replace} onChange={(e) => setReplace(e.target.value)} />
          <button type="button" className="wcm-text-btn" onClick={() => (run('edit.replace', { text, with: replace, matchCase, wholeWord }), find())}>
            Replace
          </button>
          <button type="button" className="wcm-text-btn" onClick={() => (run('edit.replaceAll', { text, with: replace, matchCase, wholeWord }), find())}>
            All
          </button>
        </div>
      )}
    </div>
  );
}

/** A palette page: the choices behind one button (fonts, colours, margins, ...). */
function DrillPage({ id, state, editor, run, done, openPage }: { id: PageId; state: PaletteState; editor: Editor; run: (c: string, p?: Record<string, unknown>) => unknown; done: () => void; openPage: (p: PageId) => void }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [url, setUrl] = useState('https://');
  const [label, setLabel] = useState('');
  const [comment, setComment] = useState('');
  const [alt, setAlt] = useState('');
  const pick = (c: string, p?: Record<string, unknown>) => {
    run(c, p);
  };
  const pickDone = (c: string, p?: Record<string, unknown>) => {
    run(c, p);
    done();
  };
  const [styles, setStyles] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    if (id !== 'styles') return;
    try {
      const out = editor.execute<unknown>('styles.list');
      const list = Array.isArray(out) ? out : ((out as { styles?: unknown[] } | null)?.styles ?? []);
      const parsed = (list as Array<Record<string, unknown>>)
        .filter((s) => (s.type ?? s.kind ?? 'paragraph') === 'paragraph' && s.hidden !== true && s.visible !== false)
        .map((s) => ({ id: String(s.id ?? s.name), name: String(s.name ?? s.id) }));
      setStyles(parsed.slice(0, 60));
    } catch {
      setStyles([]);
    }
  }, [id, editor]);

  switch (id) {
    case 'font':
      return (
        <div className="wcm-list">
          {[...new Set([...(state.format.font ? [state.format.font] : []), ...FONTS])].map((f) => (
            <Choice key={f} label={f} style={{ fontFamily: `"${f}", system-ui`, fontSize: 17 }} selected={state.format.font === f} onPress={() => pickDone('format.font', { name: f })} />
          ))}
        </div>
      );
    case 'size':
      return (
        <div className="wcm-list">
          <div className="wcm-row">
            <ToolButton icon="minus" label="Shrink Font" onPress={() => pick('format.shrinkFont')} />
            <span className="wcm-row-value">{state.format.size ?? ''}</span>
            <ToolButton icon="plus" label="Grow Font" onPress={() => pick('format.growFont')} />
          </div>
          {SIZES.map((s) => (
            <Choice key={s} label={String(s)} selected={state.format.size === s} onPress={() => pickDone('format.size', { size: s })} />
          ))}
        </div>
      );
    case 'color':
      return <Swatches colors={COLORS.map((c) => [c, c])} auto={{ label: 'Automatic', value: 'auto' }} onPick={(v) => pickDone('format.color', { color: v })} />;
    case 'highlight':
      return <Swatches colors={HIGHLIGHTS} auto={{ label: 'No Color', value: 'none' }} onPick={(v) => pickDone('format.highlight', { color: v })} />;
    case 'moreFormat':
      return (
        <div className="wcm-list">
          <Choice icon="strike" label="Strikethrough" selected={!!state.format.strike} onPress={() => pick('format.strikethrough')} />
          <Choice icon="subscript" label="Subscript" selected={!!state.format.subscript} onPress={() => pick('format.subscript')} />
          <Choice icon="superscript" label="Superscript" selected={!!state.format.superscript} onPress={() => pick('format.superscript')} />
          <Choice icon="plus" label="Grow Font" onPress={() => pick('format.growFont')} />
          <Choice icon="minus" label="Shrink Font" onPress={() => pick('format.shrinkFont')} />
          <Choice icon="styles" label="UPPERCASE" onPress={() => pick('format.changeCase', { mode: 'upper' })} />
          <Choice icon="styles" label="lowercase" onPress={() => pick('format.changeCase', { mode: 'lower' })} />
          <Choice icon="styles" label="Sentence case" onPress={() => pick('format.changeCase', { mode: 'sentence' })} />
          <Choice icon="clear" label="Clear Formatting" onPress={() => pickDone('format.clear')} />
        </div>
      );
    case 'paragraph':
      return (
        <div className="wcm-list">
          <div className="wcm-row" role="toolbar" aria-label="Alignment">
            <ToolButton icon="alignLeft" label="Align Left" onPress={() => pick('para.alignLeft')} />
            <ToolButton icon="alignCenter" label="Center" onPress={() => pick('para.alignCenter')} />
            <ToolButton icon="alignRight" label="Align Right" onPress={() => pick('para.alignRight')} />
            <ToolButton icon="justify" label="Justify" onPress={() => pick('para.justify')} />
          </div>
          <div className="wcm-caption">Line spacing</div>
          {[1, 1.15, 1.5, 2, 2.5, 3].map((v) => (
            <Choice key={v} label={v.toFixed(v % 1 ? (v * 100) % 10 ? 2 : 1 : 1)} onPress={() => pick('para.lineSpacing', { value: v })} />
          ))}
        </div>
      );
    case 'styles':
      return (
        <div className="wcm-list">
          {(styles.length ? styles : ['Normal', 'Title', 'Subtitle', 'Heading 1', 'Heading 2', 'Heading 3', 'Quote', 'List Paragraph'].map((n) => ({ id: n, name: n }))).map((s) => (
            <Choice key={s.id} label={s.name} selected={state.format.style === s.id || state.format.styleName === s.name} style={styleLook(s.name)} onPress={() => pickDone('styles.apply', { style: s.id })} />
          ))}
        </div>
      );
    case 'table':
      return (
        <div className="wcm-form">
          <Stepper label="Rows" value={rows} set={setRows} min={1} max={30} />
          <Stepper label="Columns" value={cols} set={setCols} min={1} max={12} />
          <TablePreview rows={rows} cols={cols} />
          <button type="button" className="wcm-primary" onClick={() => pickDone('insert.table', { rows, cols })}>
            Insert Table
          </button>
        </div>
      );
    case 'shapes':
      return (
        <div className="wcm-list">
          {SHAPES.map(([k, l]) => (
            <Choice key={k} icon="shapes" label={l} onPress={() => pickDone('insert.shape', { kind: k })} />
          ))}
        </div>
      );
    case 'link':
      return (
        <div className="wcm-form">
          <label className="wcm-field">
            <span>Address</span>
            <input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <label className="wcm-field">
            <span>Text to display</span>
            <input value={label} placeholder={editor.getSelectedText() || 'Optional'} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <button type="button" className="wcm-primary" disabled={!/^\w+:\S+/.test(url) || url === 'https://'} onClick={() => pickDone('insert.link', label ? { url, text: label } : { url })}>
            Insert Link
          </button>
        </div>
      );
    case 'comment':
      return (
        <div className="wcm-form">
          <label className="wcm-field">
            <span>Comment</span>
            <textarea rows={3} autoFocus value={comment} placeholder="Start a conversation" onChange={(e) => setComment(e.target.value)} />
          </label>
          <button type="button" className="wcm-primary" disabled={!comment.trim()} onClick={() => pickDone('review.newComment', { text: comment.trim() })}>
            Post
          </button>
        </div>
      );
    case 'pageNumbers':
      return (
        <div className="wcm-list">
          {(['top', 'bottom'] as const).flatMap((pos) =>
            (['left', 'center', 'right'] as const).map((align) => (
              <Choice key={pos + align} icon="pageNumber" label={`${pos === 'top' ? 'Top' : 'Bottom'} of Page, ${align === 'center' ? 'Center' : align === 'left' ? 'Left' : 'Right'}`} onPress={() => pickDone('insert.pageNumber', { position: pos, align })} />
            )),
          )}
        </div>
      );
    case 'symbol':
      return (
        <div className="wcm-symbols">
          {SYMBOLS.map((s) => (
            <button key={s} type="button" className="wcm-symbol" aria-label={`Insert ${s}`} onPointerDown={keepFocus} onClick={() => pick('insert.symbol', { char: s })}>
              {s}
            </button>
          ))}
        </div>
      );
    case 'margins':
      return (
        <div className="wcm-list">
          {[
            ['normal', 'Normal', '2.54 cm on each side'],
            ['narrow', 'Narrow', '1.27 cm on each side'],
            ['moderate', 'Moderate', '2.54 cm top and bottom, 1.91 cm sides'],
            ['wide', 'Wide', '2.54 cm top and bottom, 5.08 cm sides'],
            ['mirrored', 'Mirrored', 'Inside and outside margins'],
          ].map(([v, l, d]) => (
            <button key={v} type="button" className="wcm-item wcm-item-2" onPointerDown={keepFocus} onClick={() => pickDone('layout.margins', { preset: v })}>
              <Icon name="margins" />
              <span className="wcm-item-label">
                {l}
                <small>{d}</small>
              </span>
            </button>
          ))}
        </div>
      );
    case 'orientation':
      return (
        <div className="wcm-list">
          <Choice icon="pageSize" label="Portrait" onPress={() => pickDone('layout.orientation', { value: 'portrait' })} />
          <Choice icon="orientation" label="Landscape" onPress={() => pickDone('layout.orientation', { value: 'landscape' })} />
        </div>
      );
    case 'pageSize':
      return (
        <div className="wcm-list">
          {['Letter', 'Legal', 'A4', 'A5', 'B5', 'Executive'].map((n) => (
            <Choice key={n} icon="pageSize" label={n} onPress={() => pickDone('layout.size', { name: n })} />
          ))}
        </div>
      );
    case 'columns':
      return (
        <div className="wcm-list">
          <Choice icon="pageSize" label="One" onPress={() => pickDone('layout.columns', { count: 1 })} />
          <Choice icon="columns" label="Two" onPress={() => pickDone('layout.columns', { count: 2 })} />
          <Choice icon="columns" label="Three" onPress={() => pickDone('layout.columns', { count: 3 })} />
          <Choice icon="columns" label="Left" onPress={() => pickDone('layout.columns', { count: 2, preset: 'left' })} />
          <Choice icon="columns" label="Right" onPress={() => pickDone('layout.columns', { count: 2, preset: 'right' })} />
        </div>
      );
    case 'breaks':
      return (
        <div className="wcm-list">
          {[
            ['page', 'Page'],
            ['column', 'Column'],
            ['textWrapping', 'Text Wrapping'],
            ['nextPage', 'Next Page (section)'],
            ['continuous', 'Continuous (section)'],
            ['evenPage', 'Even Page (section)'],
            ['oddPage', 'Odd Page (section)'],
          ].map(([k, l]) => (
            <Choice key={k} icon="breaks" label={l} onPress={() => pickDone('layout.break', { kind: k })} />
          ))}
        </div>
      );
    case 'zoom':
      return (
        <div className="wcm-list">
          <Choice label="Page Width" onPress={() => pickDone('view.zoom', { value: 'pageWidth' })} />
          <Choice label="One Page" onPress={() => pickDone('view.zoom', { value: 'onePage' })} />
          {[50, 75, 100, 125, 150, 200].map((z) => (
            <Choice key={z} label={`${z}%`} selected={Math.round(Number(state.view.zoom)) === z} onPress={() => pickDone('view.zoom', { value: z })} />
          ))}
        </div>
      );
    case 'mode':
      return (
        <div className="wcm-list">
          {(['editing', 'reviewing', 'viewing'] as EditorMode[]).map((m) => (
            <Choice key={m} icon={m === 'editing' ? 'edit' : m === 'reviewing' ? 'track' : 'markup'} label={modeLabel(m)} selected={state.mode === m} onPress={() => (editor.setMode(m), run('format.state'), done())} />
          ))}
        </div>
      );
    case 'tableStyles':
      return (
        <div className="wcm-list">
          {TABLE_STYLES.map(([id, label]) => (
            <Choice key={id} icon="table" label={label} onPress={() => pickDone('table.style', { style: id })} />
          ))}
        </div>
      );
    case 'wrap':
      return (
        <div className="wcm-list">
          {WRAPS.map(([k, l]) => (
            <Choice key={k} icon="wrap" label={l} onPress={() => pickDone('arrange.wrap', { wrap: k })} />
          ))}
        </div>
      );
    case 'pictureStyles':
      return (
        <div className="wcm-list">
          {[
            ['simpleFrame', 'Simple Frame'],
            ['thickFrame', 'Thick Frame'],
            ['rounded', 'Rounded'],
            ['softEdge', 'Soft Edge'],
            ['shadow', 'Shadow'],
          ].map(([k, l]) => (
            <Choice key={k} icon="picture" label={l} onPress={() => pickDone('picture.style', { style: k })} />
          ))}
        </div>
      );
    case 'altText':
      return (
        <div className="wcm-form">
          <label className="wcm-field">
            <span>Describe this picture for people who can’t see it</span>
            <textarea rows={3} autoFocus value={alt} onChange={(e) => setAlt(e.target.value)} />
          </label>
          <button type="button" className="wcm-primary" disabled={!alt.trim()} onClick={() => pickDone('picture.altText', { text: alt.trim() })}>
            Save
          </button>
          <button type="button" className="wcm-text-btn" onClick={() => pickDone('picture.altText', { text: '', decorative: true })}>
            Mark as decorative
          </button>
        </div>
      );
    case 'shapeFill':
      return <Swatches colors={COLORS.map((c) => [c, c])} auto={{ label: 'No Fill', value: 'none' }} onPick={(v) => pickDone('shape.fill', { color: v === 'none' ? null : v })} />;
    case 'shapeOutline':
      return <Swatches colors={COLORS.map((c) => [c, c])} auto={{ label: 'No Outline', value: 'none' }} onPick={(v) => pickDone('shape.outline', { color: v === 'none' ? null : v })} />;
    case 'shapeEffects':
      return (
        <div className="wcm-list">
          <Choice icon="effects" label="Shadow" onPress={() => pickDone('shape.effects', { shadow: 'offsetBottomRight' })} />
          <Choice icon="effects" label="Glow" onPress={() => pickDone('shape.effects', { glow: 8 })} />
          <Choice icon="effects" label="Soft Edges" onPress={() => pickDone('shape.effects', { softEdge: 5 })} />
          <Choice icon="reset" label="No Effects" onPress={() => pickDone('shape.effects', { shadow: null, glow: null, softEdge: null })} />
        </div>
      );
    case 'more':
      return (
        <div className="wcm-list">
          <Choice label="Styles" onPress={() => openPage('styles')} />
        </div>
      );
  }
}

function styleLook(name: string): CSSProperties {
  const n = name.toLowerCase();
  if (n === 'title') return { fontSize: 22, fontWeight: 300 };
  if (n === 'subtitle') return { color: 'var(--dim)', letterSpacing: '.02em' };
  if (n.startsWith('heading 1')) return { fontSize: 19, fontWeight: 600, color: 'var(--accent)' };
  if (n.startsWith('heading 2')) return { fontSize: 17, fontWeight: 600, color: 'var(--accent)' };
  if (n.startsWith('heading')) return { fontWeight: 600 };
  if (n === 'quote' || n.includes('quote')) return { fontStyle: 'italic' };
  return {};
}

function Stepper({ label, value, set, min, max }: { label: string; value: number; set: (n: number) => void; min: number; max: number }) {
  return (
    <div className="wcm-stepper">
      <span>{label}</span>
      <ToolButton icon="minus" label={`Fewer ${label.toLowerCase()}`} onPress={() => set(Math.max(min, value - 1))} />
      <output aria-live="polite">{value}</output>
      <ToolButton icon="plus" label={`More ${label.toLowerCase()}`} onPress={() => set(Math.min(max, value + 1))} />
    </div>
  );
}

function TablePreview({ rows, cols }: { rows: number; cols: number }) {
  const r = Math.min(rows, 8);
  const c = Math.min(cols, 8);
  return (
    <div className="wcm-table-preview" style={{ gridTemplateColumns: `repeat(${c}, 1fr)` }} aria-hidden="true">
      {Array.from({ length: r * c }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

const CSS = `
.wcm{--bg:#fff;--fg:#242424;--icon:#212121;--dim:#616161;--line:#e0e0e0;--soft:#f5f5f5;--press:#ebebeb;--accent:#3f4fd0;--accent-soft:#e8eaff;--accent-fg:#fff;
--shadow:0 4px 12px rgba(0,0,0,.14),0 1px 3px rgba(0,0,0,.12);--sheet-shadow:0 -2px 10px rgba(0,0,0,.10);
position:absolute;inset:0;z-index:5;pointer-events:none;font:16px/1.35 Roboto,"Segoe UI",system-ui,-apple-system,sans-serif;color:var(--fg);-webkit-tap-highlight-color:transparent}
.wcm[data-theme=dark]{--bg:#1f1f1f;--fg:#e6e6e6;--icon:#e6e6e6;--dim:#a8a8a8;--line:#3a3a3a;--soft:#2a2a2a;--press:#333;--accent:#aeb7ff;--accent-soft:#2b3170;--accent-fg:#10155a;--shadow:0 4px 14px rgba(0,0,0,.55);--sheet-shadow:0 -2px 12px rgba(0,0,0,.5)}
.wcm *{box-sizing:border-box}
.wcm button{font:inherit;color:inherit;-webkit-user-select:none;user-select:none;touch-action:manipulation}
.wcm-top{pointer-events:auto;position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:2px;padding:0 4px;background:var(--bg);border-bottom:1px solid var(--line);transition:transform .2s cubic-bezier(.2,.8,.2,1);z-index:3}
.wcm-top[data-hidden]{transform:translateY(-100%)}
.wcm-title{flex:1;min-width:0;padding:0 8px;font-size:17px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wcm-icon,.wcm-tool{flex:none;width:48px;height:48px;border:0;border-radius:24px;background:transparent;color:var(--icon);display:grid;place-items:center;cursor:pointer;position:relative}
.wcm-icon:active,.wcm-tool:active{background:var(--press)}
.wcm-icon[aria-pressed=true],.wcm-tool[aria-pressed=true]{background:var(--accent-soft);color:var(--accent)}
.wcm-tool{border-radius:10px;width:auto;min-width:48px;flex:1}
.wcm-tool-more{position:absolute;right:8px;bottom:8px;width:5px;height:5px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;opacity:.6}
.wcm-glyph{display:inline-grid;place-items:center;font-size:19px;line-height:1;font-family:Roboto,system-ui,sans-serif}
.wcm-glyph sub,.wcm-glyph sup{font-size:10px;line-height:0}
.wcm-edit{display:flex;align-items:center;gap:6px;height:36px;margin-right:4px;padding:0 14px;border:0;border-radius:18px;background:var(--accent);color:var(--accent-fg)!important;font-size:15px;font-weight:500;cursor:pointer}
.wcm-scrim{pointer-events:auto;position:absolute;inset:0;z-index:6}
.wcm-menu{pointer-events:auto;position:absolute;top:44px;right:8px;z-index:7;min-width:236px;max-height:calc(100% - 56px);overflow:auto;padding:8px 0;background:var(--bg);border-radius:12px;box-shadow:var(--shadow);animation:wcm-pop .14s ease}
.wcm-menu-item{display:flex;align-items:center;gap:16px;width:100%;min-height:48px;padding:0 16px;border:0;background:none;text-align:left;cursor:pointer}
.wcm-menu-item span:first-of-type{flex:1}
.wcm-menu-item:active{background:var(--press)}
.wcm-menu-sep{height:1px;margin:8px 0;background:var(--line)}
.wcm-extra{padding:1px 7px;border-radius:9px;background:var(--accent-soft);color:var(--accent);font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.wcm-sheet{pointer-events:auto;position:absolute;left:0;right:0;z-index:4;background:var(--bg);box-shadow:var(--sheet-shadow);border-top:1px solid var(--line);transition:transform .22s cubic-bezier(.2,.8,.2,1)}
.wcm-sheet[data-hidden]{transform:translateY(110%)}
.wcm-sheet[data-open]{border-radius:16px 16px 0 0;border-top:0;max-height:min(62%,440px);display:flex;flex-direction:column;animation:wcm-up .22s cubic-bezier(.2,.8,.2,1)}
.wcm-peek{display:flex;align-items:center;height:48px;padding:0 4px;overflow-x:auto;scrollbar-width:none}
.wcm-peek .wcm-tool{flex:0 0 48px}
.wcm-peek-gap{flex:1}
.wcm-sheet-head{display:flex;align-items:center;min-height:52px;padding:4px 4px 0 8px;border-bottom:1px solid var(--line)}
.wcm-sheet-head::before{content:"";position:absolute;top:6px;left:50%;width:32px;height:4px;margin-left:-16px;border-radius:2px;background:var(--line)}
.wcm-sheet-title{font-size:16px;font-weight:500;padding-left:4px}
.wcm-switch{display:flex;align-items:center;gap:6px;height:40px;padding:0 10px 0 12px;border:0;border-radius:20px;background:var(--soft);font-size:16px!important;font-weight:500;cursor:pointer}
.wcm-ctx-dot{width:7px;height:7px;border-radius:50%;background:var(--accent)}
.wcm-gap{flex:1}
.wcm-tabs{padding:6px 0;border-bottom:1px solid var(--line);max-height:50%;overflow:auto}
.wcm-tab{display:flex;align-items:center;gap:10px;width:100%;min-height:48px;padding:0 20px;border:0;background:none;text-align:left;cursor:pointer;font-size:16px}
.wcm-tab[aria-selected=true]{color:var(--accent);font-weight:500}
.wcm-tab svg{margin-left:auto}
.wcm-ctx{padding:1px 8px;border-radius:9px;background:var(--accent-soft);color:var(--accent);font-size:11px;font-weight:500}
.wcm-body{overflow:auto;overscroll-behavior:contain;padding-bottom:max(8px,env(safe-area-inset-bottom))}
.wcm-group+.wcm-group{border-top:8px solid var(--soft)}
.wcm-item{display:flex;align-items:center;gap:10px;width:100%;min-height:47px;padding:11px 12px 11px 16px;border:0;background:none;text-align:left;cursor:pointer;color:var(--fg)}
.wcm-item>svg:first-child,.wcm-item>.wcm-glyph:first-child{color:var(--icon)}
.wcm-item:active{background:var(--press)}
.wcm-item[aria-pressed=true]{color:var(--accent)}
.wcm-item-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wcm-item-2 .wcm-item-label{white-space:normal;display:grid}
.wcm-item-label small{font-size:13px;color:var(--dim)}
.wcm-item-value{color:var(--dim);font-size:14px;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wcm-row{display:flex;gap:4px;padding:4px 8px}
.wcm-row-value{flex:1;display:grid;place-items:center;font-size:18px;font-weight:500}
.wcm-boxes{display:flex;gap:8px;padding:10px 12px}
.wcm-box{flex:1;display:flex;align-items:center;justify-content:space-between;gap:6px;height:44px;padding:0 8px 0 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);cursor:pointer;min-width:0}
.wcm-box span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wcm-box-size{flex:0 0 96px}
.wcm-list{padding:4px 0}
.wcm-caption{padding:12px 16px 4px;font-size:13px;color:var(--dim)}
.wcm-swatches{padding:4px 0 12px}
.wcm-swatch-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;padding:8px 16px}
.wcm-swatch{aspect-ratio:1;max-height:52px;border:1px solid rgba(0,0,0,.18);border-radius:10px;cursor:pointer}
.wcm-symbols{display:grid;grid-template-columns:repeat(auto-fill,minmax(48px,1fr));gap:4px;padding:8px}
.wcm-symbol{height:48px;border:0;border-radius:8px;background:var(--soft);font-size:21px!important;cursor:pointer}
.wcm-symbol:active{background:var(--press)}
.wcm-form{display:grid;gap:14px;padding:16px}
.wcm-field{display:grid;gap:6px;font-size:13px;color:var(--dim)}
.wcm-field input,.wcm-field textarea,.wcm-find-input{width:100%;min-height:44px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit;font-size:16px;outline:none}
.wcm-field input:focus,.wcm-field textarea:focus,.wcm-find-input:focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
.wcm-primary{height:44px;border:0;border-radius:22px;background:var(--accent);color:var(--accent-fg)!important;font-weight:500;cursor:pointer}
.wcm-primary:disabled{opacity:.45}
.wcm-text-btn{height:40px;padding:0 12px;border:0;border-radius:20px;background:none;color:var(--accent)!important;font-weight:500;cursor:pointer}
.wcm-stepper{display:flex;align-items:center;gap:6px}
.wcm-stepper span{flex:1}
.wcm-stepper .wcm-tool{flex:0 0 48px}
.wcm-stepper output{width:40px;text-align:center;font-size:18px;font-weight:500}
.wcm-table-preview{display:grid;gap:3px;padding:4px 0}
.wcm-table-preview span{height:16px;border:1px solid var(--accent);border-radius:2px;background:var(--accent-soft)}
.wcm-floatie{pointer-events:auto;position:absolute;z-index:4;display:flex;height:48px;padding:0 4px;background:var(--bg);border-radius:8px;box-shadow:var(--shadow);animation:wcm-pop .12s ease}
.wcm-fl{display:grid;justify-items:center;align-content:center;gap:1px;min-width:52px;padding:0 6px;border:0;background:none;cursor:pointer;font-size:11px!important;color:var(--icon)}
.wcm-fl:active{background:var(--press)}
.wcm-fab{pointer-events:auto;position:absolute;right:16px;z-index:3;width:48px;height:48px;border:0;border-radius:16px;background:var(--bg);color:var(--accent);box-shadow:var(--shadow);display:grid;place-items:center;cursor:pointer;transition:bottom .2s cubic-bezier(.2,.8,.2,1)}
.wcm-fab[data-on]{background:var(--accent);color:var(--accent-fg)}
.wcm-toast{pointer-events:auto;position:absolute;left:12px;right:12px;z-index:5;display:flex;align-items:flex-start;gap:8px;padding:12px 8px 12px 16px;background:var(--bg);border-radius:12px;box-shadow:var(--shadow);animation:wcm-pop .14s ease}
.wcm-toast-body{flex:1;font-size:14px}
.wcm-toast-close{width:36px;height:36px;border:0;border-radius:18px;background:none;display:grid;place-items:center;cursor:pointer}
.wcm-count{display:grid;gap:6px}
.wcm-count strong{font-size:15px;margin-bottom:2px}
.wcm-count div{display:flex;justify-content:space-between;color:var(--dim)}
.wcm-count div span:last-child{color:var(--fg);font-variant-numeric:tabular-nums}
.wcm-find{flex:1;display:grid;align-self:stretch;background:var(--bg)}
.wcm-find-row{display:flex;align-items:center;gap:2px;min-height:48px}
.wcm-find-input{flex:1;min-width:0;min-height:38px;padding:6px 10px}
.wcm-find-count{font-size:12px;color:var(--dim);white-space:nowrap;padding:0 4px}
.wcm-find-options{display:flex;flex-wrap:wrap;gap:6px 16px;padding:4px 12px 10px;font-size:14px;background:var(--bg);border-bottom:1px solid var(--line)}
.wcm-find-options label{display:flex;align-items:center;gap:6px}
.wcm-top:has(.wcm-find-options),.wcm-top:has(.wcm-find-row+.wcm-find-row){height:auto!important;align-items:flex-start}
@keyframes wcm-pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
@keyframes wcm-up{from{transform:translateY(24px);opacity:.6}to{transform:none;opacity:1}}
@media (prefers-reduced-motion:reduce){.wcm *{animation:none!important;transition:none!important}}
`;
