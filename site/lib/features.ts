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
  comments: shot('comments', 'The comments panel: a thread with a mention, an assignment and a reply'),
  viewer2: shot('access-viewer', 'A viewer: the access chip at the bottom right, and typing refused'),
  commenter: shot('access-commenter', 'A commenter adding a comment through the panel'),
  letterheadOrg: shot('ai-letterhead-org', "AI Studio showing the organisation's letterhead, ready to apply"),
  structureTable: shot('structure-table', 'A table made from pasted CSV data, sorted with a total, ready to insert'),
  structureDiagram: shot('structure-diagram', 'A flowchart of a referral process, rendered from Mermaid in the preview'),
  structureChart: shot('structure-chart', 'A chart preview that goes in as a native Word chart'),
  slash: shot('slash-menu', 'The slash menu at the start of an empty line'),
  brandPalette: shot('brand-palette', 'A palette made from a logo and a photo, with roles and contrast'),
  brandPlacement: shot('brand-placement', 'Logo placement presets on mini pages'),
  chat: shot('chat', 'Ask this document: an answer citing its passages'),
  checks: shot('checks', 'Writing checks: a score, readability, tone and suggestions by category'),
  originality: shot('originality', 'An originality report with a match in the organisation’s own documents'),
  outline: shot('outline', 'The outline of headings, ready to drag'),
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
  structure: {
    shots: [SHOTS.structureTable, SHOTS.structureDiagram, SHOTS.structureChart, SHOTS.slash],
    live: 'ai',
    caption: 'Ask for a table, a diagram or a chart and get the real thing: a native table, a Mermaid diagram with its source kept, a Word chart. Type / on an empty line for the menu.',
    code: `<WordcraftEditor
  ai={{
    complete,
    structure: true,
    mermaid: () => import('mermaid'),
    pickData: () => pickSheetFromYourApp(),
    actions: [{ id: 'donor', label: 'Donor paragraph', run: () => [{ type: 'paragraph', text: 'Thank you…' }] }],
  }}
/>`,
  },
  brand: {
    shots: [SHOTS.brandPalette, SHOTS.brandPlacement, SHOTS.letterheadOrg, SHOTS.palette],
    live: 'ai',
    caption: 'Pick a logo or a photo and get a palette written into the document theme, then put the logo in the header, the footer, behind the text or on a cover page.',
    code: `<WordcraftEditor
  ai={{
    complete,
    brand: { name: 'Sauti Salama', logo: logoDataUrl },
    letterhead: { name: 'Sauti Salama', logo: { src: logoDataUrl, placement: 'watermark', opacity: 0.15 } },
    onPaletteCreated: (palette) => saveForOrganisation(palette),
  }}
/>`,
  },
  chat: {
    shots: [SHOTS.chat, SHOTS.aiBar, SHOTS.editor, SHOTS.comments],
    live: 'ai',
    caption: 'Questions are answered from the document itself, and every answer cites the passages it used.',
    code: `<WordcraftEditor ai={{ complete, chat: true, chatStore: myChatStore }} />`,
  },
  checks: {
    shots: [SHOTS.checks, SHOTS.editor, SHOTS.mini, SHOTS.context],
    live: 'editor',
    caption: 'Underlines by category with one-click fixes, readability and tone, through engines you choose; the default runs in the browser.',
    code: `import { WordcraftEditor, plainLanguageChecker, languageTool } from '@gamine/wordcraft-react';

<WordcraftEditor
  checks={{ checkers: [plainLanguageChecker(), languageTool({ url: 'https://lt.example.org' })], goals: { domain: 'plain' } }}
/>`,
  },
  originality: {
    shots: [SHOTS.originality, SHOTS.editor, SHOTS.comments, SHOTS.chat],
    live: 'editor',
    caption: 'Matches against your own documents first, a service you choose if you want one, and an AI-writing signal that never claims to be a verdict.',
    code: `<WordcraftEditor
  originality={{
    corpus: { search: (text) => fetch('/api/similar', { method: 'POST', body: text }).then((r) => r.json()) },
  }}
/>`,
  },
  tools: {
    shots: [SHOTS.outline, SHOTS.checks, SHOTS.editor, SHOTS.mini],
    live: 'editor',
    caption: 'An outline to move sections, accessibility with fixes, sources and a bibliography, a word goal, voice typing and translation.',
    code: `<WordcraftEditor tools={{ outline: true, accessibility: true, sources: true, wordCount: { goal: 1500 }, voice: true, translate: true }} />`,
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
  comments: {
    shots: [SHOTS.comments, SHOTS.commenter, SHOTS.editor],
    live: 'editor',
    caption: 'Threads with filters, @mentions and Assign to, on top of WordCraft’s own Word-style comments; your store hears every change.',
    code: `<WordcraftEditor
  comments={{
    people: team,
    store: {
      create: (c) => api.post('/comments', c),
      reply: (c, parent) => api.post(\`/comments/\${parent.id}/replies\`, c),
      resolve: (c, resolved) => api.patch(\`/comments/\${c.id}\`, { resolved }),
    },
    onMention: ({ comment, people }) => notify(people, comment),
  }}
/>`,
  },
  access: {
    shots: [SHOTS.viewer2, SHOTS.commenter, SHOTS.comments],
    live: 'editor',
    caption: 'View, comment, suggest or edit, enforced by the editor itself and changeable while the document is open.',
    code: `<WordcraftEditor
  permission={share.level}        // 'view' | 'comment' | 'suggest' | 'edit'
  allowCopy={share.level !== 'view'}
  comments
/>`,
  },
};
