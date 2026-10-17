/**
 * The host's say over WordCraft's own screen: one switch per surface (`ui`), the File menu
 * (`fileMenu`) and the host's own icons (`icons`). Everything here is applied live through
 * preferences and turned-off commands, so switching a surface never remounts the editor and
 * never loses the document, the selection or a co-editing session.
 */
import type { ReactNode } from 'react';

import type { FileMenuPref, PresenceUser, RibbonDisplay, WordcraftPrefs, WordcraftUser } from './core.js';
import type { Permission } from './workspace.js';

/** The workspace row's buttons (bottom right, an Extra). */
export interface WorkspaceSwitches {
  /** The AI launcher ("Ask"). */
  ask?: boolean;
  comments?: boolean;
  checks?: boolean;
  /** The Extras' panels (outline, word count, accessibility, sources, translate, chat). */
  tools?: boolean;
  voice?: boolean;
  /** The access chip (Viewing, Commenting, Suggesting). */
  access?: boolean;
}

/**
 * Every surface of the editor, each a boolean. `false` takes it out entirely: it isn't drawn, it
 * takes no room and its shortcuts don't open it. Leave a key out for the default (shown).
 */
export interface UiOptions {
  /** The title bar: AutoSave, Quick Access, title, search, avatars, Share and the account. */
  titleBar?: boolean;
  /** The ribbon. `false` removes it with its tab row; `'tabs'` keeps only the tab row. */
  ribbon?: boolean | RibbonDisplay;
  statusBar?: boolean;
  /** The mini toolbar over a selection. */
  selectionToolbar?: boolean;
  /** The right-click menu on the page. */
  contextMenu?: boolean;
  rulers?: boolean;
  /** The Navigation pane (headings, pages, search results). */
  navigationPane?: boolean;
  /** The row of buttons at the bottom right (`false` for all, or one switch each). */
  workspace?: boolean | WorkspaceSwitches;
  /** Collaborators' avatars (title bar and workspace row). */
  presence?: boolean;
  /** The Share button. */
  share?: boolean;
  /** The Editing / Reviewing / Viewing switch. */
  modeSwitch?: boolean;
  /** The zoom slider and percentage. */
  zoom?: boolean;
  /** The page-view buttons (Read Mode, Print Layout, Web Layout). */
  viewSwitcher?: boolean;
  /** The File menu (backstage). `false` also turns off its shortcuts (Ctrl+S, Ctrl+O, Ctrl+P...). */
  fileMenu?: boolean;
  /** The phone layout's command palette at the bottom. */
  mobilePalette?: boolean;
}

/** Only the page: no title bar, ribbon, status bar, toolbars, menus, rulers or panes. */
export const PAPER_UI: Readonly<Required<Omit<UiOptions, 'workspace'>> & { workspace: false }> = Object.freeze({
  titleBar: false,
  ribbon: false,
  statusBar: false,
  selectionToolbar: false,
  contextMenu: false,
  rulers: false,
  navigationPane: false,
  workspace: false,
  presence: false,
  share: false,
  modeSwitch: false,
  zoom: false,
  viewSwitcher: false,
  fileMenu: false,
  mobilePalette: false,
});

/** `ui` as given: the switches, or `'paper'` for the page alone. */
export type UiProp = UiOptions | 'paper';

export function resolveUi(ui: UiProp | undefined): UiOptions {
  if (ui === 'paper') return PAPER_UI;
  return ui ?? {};
}

/** Is workspace button `key` on? */
export function workspaceOn(ui: UiOptions, key: keyof WorkspaceSwitches): boolean {
  const w = ui.workspace;
  if (w === false) return false;
  if (w === true || w === undefined) return true;
  return w[key] !== false;
}

/** The preferences `ui` asks for. Keys left out of `ui` are left as the other props set them. */
export function uiPrefs(ui: UiOptions): Partial<WordcraftPrefs> {
  const out: Partial<WordcraftPrefs> = {};
  if (ui.titleBar !== undefined) out.hideTitleBar = !ui.titleBar;
  if (ui.ribbon !== undefined) {
    const r = ui.ribbon === true ? 'full' : ui.ribbon === false ? 'hidden' : ui.ribbon;
    out.hideRibbon = r === 'hidden';
    out.ribbonCollapsed = r === 'tabs';
  }
  if (ui.statusBar !== undefined) out.hideStatusBar = !ui.statusBar;
  if (ui.selectionToolbar !== undefined) out.miniToolbar = ui.selectionToolbar;
  if (ui.contextMenu !== undefined) out.hideContextMenu = !ui.contextMenu;
  if (ui.rulers !== undefined) out.hideRulers = !ui.rulers;
  if (ui.navigationPane !== undefined) out.hideNavPane = !ui.navigationPane;
  if (ui.presence !== undefined) out.hidePresence = !ui.presence;
  if (ui.share !== undefined) out.hideShare = !ui.share;
  if (ui.modeSwitch !== undefined) out.hideModeSwitch = !ui.modeSwitch;
  if (ui.zoom !== undefined) out.hideZoom = !ui.zoom;
  if (ui.viewSwitcher !== undefined) out.hideViewSwitcher = !ui.viewSwitcher;
  return out;
}

/** Commands `ui` turns off, so a hidden surface's shortcuts don't bring it back. */
export function uiDisabled(ui: UiOptions): string[] {
  const out: string[] = [];
  if (ui.fileMenu === false) out.push('ui.backstage', ...Object.values(FILE_SHORTCUTS).flat());
  if (ui.navigationPane === false) out.push('view.navigationPane');
  if (ui.rulers === false) out.push('view.ruler');
  if (ui.modeSwitch === false) out.push('ui.mode');
  if (ui.share === false) out.push('file.share');
  return out;
}

// ---------------------------------------------------------------------------------------------
// The File menu

/** WordCraft's own File menu pages, in its order. */
export const FILE_MENU_IDS = ['home', 'new', 'open', 'info', 'recover', 'save', 'saveAs', 'print', 'share', 'export', 'close', 'options'] as const;
/** Export formats, each its own item: `export.pdf`, `export.docx`... */
export const EXPORT_IDS = ['export.pdf', 'export.docx', 'export.xml', 'export.wordml2003', 'export.odt', 'export.rtf', 'export.html', 'export.md', 'export.tex', 'export.txt', 'export.png'] as const;

export type FileMenuId = (typeof FILE_MENU_IDS)[number] | (typeof EXPORT_IDS)[number];

/** The commands (and so the shortcuts) behind each File item: hiding the item turns them off. */
const FILE_SHORTCUTS: Record<string, string[]> = {
  new: ['file.new', 'file.newFromTemplate'],
  open: ['file.open'],
  save: ['file.save'],
  saveAs: ['file.saveAs', 'file.saveTemplate'],
  print: ['file.print', 'file.printPdf', 'file.printMarkup'],
  share: ['file.share'],
  close: ['file.close'],
  options: ['file.options'],
  recover: ['file.recover'],
  'export.pdf': ['file.exportPdf'],
  'export.png': ['file.exportPng'],
};

/** One File menu item: WordCraft's own (by id) or the host's. */
export interface FileMenuItem {
  /** WordCraft's id (`print`, `export.pdf`...) or your own (`moveToFolder`). */
  id: FileMenuId | (string & {});
  label?: string;
  /** Leave it out (and turn off its shortcut). */
  hidden?: boolean;
  /** Show it greyed out; a string is the reason, shown on hover. Its shortcut is off too. */
  disabled?: boolean | string;
  /** Your action instead of WordCraft's (required for your own items). */
  onSelect?: () => void;
  /** A heading to group it under. Items with the same section sit together. */
  section?: string;
}

/**
 * The File menu: a list (its order is the menu's; WordCraft's items left out are hidden, export
 * formats keep their place on the Export page) or per-item settings by id.
 */
export type FileMenuOptions = FileMenuItem[] | Partial<Record<FileMenuId, Omit<FileMenuItem, 'id'> | false>>;

/** What `topBar` and `fileMenu` functions get. */
export interface SurfaceContext {
  permission: Permission;
  user?: WordcraftUser;
  collaborators: PresenceUser[];
}

export interface ResolvedFileMenu {
  pref: FileMenuPref[];
  disabled: string[];
  actions: Map<string, () => void>;
}

const BUILT_IN = new Set<string>([...FILE_MENU_IDS, ...EXPORT_IDS]);

export function resolveFileMenu(menu: FileMenuOptions | undefined): ResolvedFileMenu {
  const out: ResolvedFileMenu = { pref: [], disabled: [], actions: new Map() };
  if (!menu) return out;
  const items: FileMenuItem[] = Array.isArray(menu)
    ? menu
    : Object.entries(menu).map(([id, v]) => (v === false ? { id, hidden: true } : { id, ...(v ?? {}) }));
  const add = (i: FileMenuItem) => {
    const off = i.hidden || (i.disabled !== undefined && i.disabled !== false);
    if (off && BUILT_IN.has(i.id)) out.disabled.push(...(FILE_SHORTCUTS[i.id] ?? []));
    if (i.onSelect) out.actions.set(i.id, i.onSelect);
    if (!BUILT_IN.has(i.id) && !i.onSelect) console.warn(`[wordcraft] File menu item "${i.id}" needs onSelect`);
    out.pref.push({
      id: i.id,
      label: i.label ?? (BUILT_IN.has(i.id) ? '' : i.id),
      hidden: !!i.hidden,
      disabled: i.disabled === true ? 'Not available' : typeof i.disabled === 'string' ? i.disabled : '',
      host: !!i.onSelect,
      section: i.section ?? '',
    });
  };
  items.forEach(add);
  if (Array.isArray(menu)) {
    // A list is the whole menu: WordCraft's pages it leaves out are hidden (and their shortcuts off).
    const listed = new Set(items.map((i) => i.id));
    for (const id of FILE_MENU_IDS) if (!listed.has(id) && id !== 'home') out.disabled.push(...(FILE_SHORTCUTS[id] ?? []));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Icons

/** Your own icons for the workspace row and the top bar. Any React node (an `<svg>`, an icon component). */
export interface IconsOptions {
  ask?: ReactNode;
  comments?: ReactNode;
  checks?: ReactNode;
  tools?: ReactNode;
  voice?: ReactNode;
  share?: ReactNode;
  back?: ReactNode;
  history?: ReactNode;
}
