'use client';

import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { CommentsDrawer, WordcraftEditor, type ComposeRequest, type FileMenuOptions, type TopBarProp, type UiProp, type WordcraftEditorRef } from '@gamine/wordcraft-react';
import { yjsCollaboration } from '@gamine/wordcraft-react/collab';

const SERVER = process.env.NEXT_PUBLIC_COLLAB_URL ?? 'ws://localhost:1234';

/**
 * The host owns the screen: the `ui` switches, a `topBar`, a granular `fileMenu`, comments owned
 * by the host (`comments.exclusive`) and the standalone `<CommentsDrawer/>`. Used by smoke-host.mjs.
 *
 * ?topBar=1          the host's top bar (back, quick access, title, presence, share, user menu)
 * ?exclusive=drawer  comments owned by the host, composed in the package's drawer
 * ?exclusive=callback  ... composed in the host's own composer (onRequestCompose)
 * ?ui=paper          the page alone
 * ?fileMenu=1        a File menu the host arranged
 * ?doc=<room>&name=  co-editing (needs `npm run collab-server`)
 * Nothing: the editor with default props.
 */
export default function HostPage() {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => setQ(new URLSearchParams(window.location.search)), []);
  if (!q) return null;
  return <Host q={q} />;
}

function Host({ q }: { q: URLSearchParams }) {
  const [editor, setEditor] = useState<WordcraftEditorRef>(null);
  const [ui, setUi] = useState<UiProp | undefined>(q.get('ui') === 'paper' ? 'paper' : undefined);
  const [request, setRequest] = useState<ComposeRequest | null>(null);
  const [draft, setDraft] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const log = (e: string) => setEvents((x) => [...x, e]);
  const exclusive = q.get('exclusive');
  const room = q.get('doc');
  const name = q.get('name') ?? 'Oliver Host';
  const color = q.get('color') ?? '#0e7490';

  const collab = useMemo(() => {
    if (!room) return null;
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(SERVER, `wordcraft-host-${room}`, doc);
    return { doc, provider, collaboration: yjsCollaboration({ doc, provider }) };
  }, [room]);
  useEffect(() => () => collab?.provider.destroy(), [collab]);

  // The page's test hooks.
  useEffect(() => {
    Object.assign(window, { host: { setUi, events, request } });
  }, [events, request]);

  const topBar: TopBarProp | undefined = q.get('topBar')
    ? ({ permission }) => ({
        left: [{ type: 'back', onClick: () => log('back'), label: 'Documents', confirmUnsaved: false }, { type: 'quickAccess', items: ['undo', 'redo', 'separator', 'print'] }, 'title', 'saveState'],
        right: [
          'presence',
          'comments',
          { type: 'share', disabled: permission === 'view' ? 'Only editors can share' : false, onClick: () => log('share') },
          { type: 'user', menu: [{ label: 'Profile', onClick: () => log('profile') }, { label: 'Sign out', separator: true, danger: true, onClick: () => log('signout') }] },
        ],
      })
    : undefined;

  const fileMenu: FileMenuOptions | undefined = q.get('fileMenu')
    ? [
        { id: 'info' },
        { id: 'save' },
        { id: 'print', disabled: 'Printing is off for this document' },
        { id: 'share', onSelect: () => log('file:share') },
        { id: 'export', label: 'Download' },
        { id: 'export.docx', hidden: true },
        { id: 'export.pdf', label: 'PDF for the board' },
        { id: 'moveToFolder', label: 'Move to folder', section: 'Organise', onSelect: () => log('file:moveToFolder') },
      ]
    : undefined;

  return (
    <div style={{ display: 'flex', gap: 0, height: '100vh' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <WordcraftEditor
          sample
          user={{ name, color }}
          height="100vh"
          ui={ui}
          topBar={topBar}
          fileMenu={fileMenu}
          collaboration={collab?.collaboration}
          comments={
            exclusive === 'drawer'
              ? { exclusive: true }
              : exclusive === 'callback'
                ? { exclusive: true, onRequestCompose: (r) => (setRequest(r), setDraft('')), onOpenComment: (id) => log(`open:${id}`) }
                : q.get('comments')
                  ? true
                  : undefined
          }
          onShare={q.get('topBar') ? () => log('share') : undefined}
          onReady={(ed) => {
            setEditor(ed);
            Object.assign(window, { wordcraft: ed });
            ed.onHostEvent((e) => log(`event:${e}`));
          }}
        />
      </div>
      {exclusive === 'callback' && (
        <aside data-testid="host-panel" style={{ width: 300, borderLeft: '1px solid #ddd', display: 'flex', flexDirection: 'column', font: '14px system-ui' }}>
          {request && (
            <div data-testid="host-composer" style={{ padding: 12, borderBottom: '1px solid #ddd' }}>
              <p style={{ margin: '0 0 6px', color: '#555' }}>On “{request.quote}”</p>
              <textarea aria-label="Host comment" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: '100%' }} />
              <button type="button" onClick={() => (request.cancel(), setRequest(null))}>
                Cancel
              </button>
              <button type="button" disabled={!draft.trim()} onClick={() => (request.submit(draft), setRequest(null))}>
                Post
              </button>
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0 }}>
            <CommentsDrawer editor={editor} user={{ name }} />
          </div>
        </aside>
      )}
    </div>
  );
}
