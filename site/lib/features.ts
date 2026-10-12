/** What each documentation page shows above its text: screenshots, a live example and code. */
export type LiveKind = 'editor' | 'ai' | 'versions' | 'collab' | 'fonts' | 'api' | 'viewer' | 'mobile';

export interface Shot {
  src: string;
  alt: string;
}

export interface Showcase {
  shots: Shot[];
  live: LiveKind;
  code: string;
  caption: string;
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';
const shot = (name: string, alt: string): Shot => ({ src: `${BASE}/shots/${name}.jpg`, alt });

export const SHOTS = {
  editor: shot('editor', 'The editor with the ribbon, rulers and a document'),
  mini: shot('mini-toolbar', 'The mini toolbar over a selected word'),
  context: shot('context-menu', 'The right-click menu with the mini toolbar above it'),
  collapsed: shot('collapsed', 'The ribbon collapsed to its tabs'),
  fonts: shot('font-previews', 'The font box, each name drawn in its own font'),
  aiBar: shot('ai-bar', 'The AI bar with quick actions and the prompt box'),
  aiResult: shot('ai-result', 'An AI suggestion ready to insert'),
  skills: shot('ai-skills', 'AI Studio skills, with the Humaniser on'),
  letterhead: shot('ai-letterhead', 'AI Studio letterhead with a live preview'),
  palette: shot('ai-palette', 'AI Studio palettes'),
  versions: shot('versions', 'Version history: a version shown read only, with Restore'),
  collab: shot('collab', 'Two people editing one document, each with a cursor'),
  viewer: shot('viewer', 'Viewing mode with the title bar and ribbon hidden'),
  api: shot('api', 'Running editor commands from code'),
  playground: shot('playground', 'The playground with every prop'),
  mobile: shot('mobile-page', 'The phone layout: title bar, the page in Mobile View and the quick bar'),
  mobilePalette: shot('mobile-palette', 'The command palette open on Home, with the font boxes'),
  mobileSelect: shot('mobile-select', 'A long-pressed word with handles and the floating toolbar'),
  mobileTable: shot('mobile-table', 'Insert Table as a page inside the palette'),
};

export const SHOWCASES: Record<string, Showcase> = {
  'getting-started': {
    shots: [SHOTS.editor, SHOTS.mini, SHOTS.context, SHOTS.collapsed],
    live: 'editor',
    caption: 'The full WordCraft editor in a React component: the ribbon, real pages, the mini toolbar and the right-click menu, saving through your app.',
    code: `'use client';
import { WordcraftEditor } from '@gamine/wordcraft-react';

export default function Page() {
  return (
    <WordcraftEditor
      sample
      user={{ name: 'Wanjiru Kamau' }}
      onSave={(file) => fetch('/api/doc', { method: 'PUT', body: file.blob })}
    />
  );
}`,
  },
  props: {
    shots: [SHOTS.playground, SHOTS.collapsed, SHOTS.viewer, SHOTS.editor],
    live: 'editor',
    caption: 'Props shape the editor: which tabs show, the title bar and ribbon, the mode, commands you turn off, and the Extras.',
    code: `<WordcraftEditor
  user={{ name: 'Wanjiru Kamau', color: '#2554c7' }}
  ribbon="tabs"
  hiddenTabs={['Mailings', 'Zotero']}
  disabledCommands={['file.open']}
  mode="reviewing"
  ai
  versionHistory
/>`,
  },
  'editor-api': {
    shots: [SHOTS.api, SHOTS.editor, SHOTS.mini, SHOTS.context],
    live: 'api',
    caption: 'Everything the ribbon does is a command. Run them from code, read the text, and export to any format.',
    code: `const editor = ref.current!;
editor.execute('text.insert', { text: 'Quarterly report' });
editor.execute('para.heading1');
editor.execute('insert.table', { rows: 3, cols: 4 });
const pdf = editor.exportBlob('pdf');
const markdown = editor.getMarkdown();`,
  },
  'co-editing': {
    shots: [SHOTS.collab, SHOTS.editor, SHOTS.versions, SHOTS.mini],
    live: 'collab',
    caption: 'Two people in one document. Words, formatting and cursors appear for both, and each person’s Undo takes back only their own edits.',
    code: `import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { yjsCollaboration } from '@gamine/wordcraft-react/collab';

const doc = new Y.Doc();
const provider = new WebsocketProvider('wss://collab.example.com', 'brief-42', doc);

<WordcraftEditor user={me} collaboration={yjsCollaboration({ doc, provider })} />`,
  },
  ai: {
    shots: [SHOTS.aiBar, SHOTS.skills, SHOTS.letterhead, SHOTS.aiResult],
    live: 'ai',
    caption: 'The sparkle opens a writing bar. AI Studio holds the skills (the Humaniser is on by default), a letterhead, palettes and the model.',
    code: `<WordcraftEditor
  ai={{
    complete: (request) => streamFromYourApi(request),
    letterhead: { name: 'Mazingira Trust', contact: 'hello@mazingira.org' },
    defaultSkills: ['humaniser', 'british'],
  }}
/>`,
  },
  'version-history': {
    shots: [SHOTS.versions, SHOTS.editor, SHOTS.collab, SHOTS.mini],
    live: 'versions',
    caption: 'Versions are recorded as you work. Open one to read it, then restore it in one undoable step.',
    code: `import { WordcraftEditor, httpVersionStore } from '@gamine/wordcraft-react';

<WordcraftEditor
  versionHistory={{ store: httpVersionStore('/api/documents/42/versions') }}
/>`,
  },
  fonts: {
    shots: [SHOTS.fonts, SHOTS.editor, SHOTS.mini, SHOTS.palette],
    live: 'fonts',
    caption: 'The Google Fonts library sits in the font box with Theme and Recently Used fonts, each name shown in its own face.',
    code: `import { googleFonts } from '@gamine/wordcraft-react';

<WordcraftEditor fonts={googleFonts({ categories: ['serif', 'sans-serif'] })} />`,
  },
  mobile: {
    shots: [SHOTS.mobile, SHOTS.mobilePalette, SHOTS.mobileSelect, SHOTS.mobileTable],
    live: 'mobile',
    caption: 'On a phone the editor takes the shape of Word for Android: drag to scroll, long-press to select, and one command palette at the bottom. Foldables switch live.',
    code: `'use client';
import { useRouter } from 'next/navigation';
import { WordcraftEditor } from '@gamine/wordcraft-react';

export default function Edit() {
  const router = useRouter();
  return (
    <WordcraftEditor
      mobile="auto" // the phone layout below 600px on touch screens
      mobileOptions={{ onBack: () => router.back() }}
      height="100dvh"
      onSave={(file) => fetch('/api/doc', { method: 'PUT', body: file.blob })}
    />
  );
}`,
  },
};
