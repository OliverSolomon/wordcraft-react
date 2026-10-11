'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WordcraftEditor, type DocumentSource, type WordcraftEditorRef } from '@gamine/wordcraft-react';
import { yjsCollaboration } from '@gamine/wordcraft-react/collab';
import { ai } from '../ai';

const SERVER = process.env.NEXT_PUBLIC_COLLAB_URL ?? 'ws://localhost:1234';
const NAMES = ['Ada Lovelace', 'Grace Hopper', 'Katherine Johnson', 'Wangari Maathai', 'Margaret Hamilton', 'Hedy Lamarr'];
const COLORS = ['#c2410c', '#1d4ed8', '#15803d', '#7e22ce', '#be185d', '#0e7490'];

/**
 * Everyone who opens /collab?doc=<id> edits the same document live. AutoSave writes the merged
 * document over the one shared file (app/api/documents/[id]), which keeps earlier versions.
 */
export function CollabEditor() {
  const editor = useRef<WordcraftEditorRef>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [file, setFile] = useState<DocumentSource | null | undefined>(undefined);
  const [saved, setSaved] = useState('');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const i = Math.floor(Math.random() * NAMES.length);
    setDocId(q.get('doc') ?? 'demo');
    setName(q.get('name') ?? NAMES[i]);
    setColor(COLORS[i]);
  }, []);

  // The stored file, used only if nobody has the document open yet (the first person shares it).
  useEffect(() => {
    if (!docId) return;
    fetch(`/api/documents/${docId}`)
      .then(async (r) => (r.ok ? { name: `${docId}.docx`, data: await r.arrayBuffer() } : null))
      .catch(() => null)
      .then(setFile);
  }, [docId]);

  // One shared Yjs document and connection per document id.
  const collab = useMemo(() => {
    if (!docId) return null;
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(SERVER, `wordcraft-${docId}`, doc);
    return { doc, provider, collaboration: yjsCollaboration({ doc, provider }) };
  }, [docId]);
  useEffect(() => () => collab?.provider.destroy(), [collab]);

  if (!docId || file === undefined || !name) return <p>Connecting…</p>;

  return (
    <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', color: '#444' }}>
        <span>
          Document <code>{docId}</code>, you are <b style={{ color }}>{name}</b>. Open this page in another window to edit together.
        </span>
        <span data-testid="saved">{saved && `AutoSaved: ${saved}`}</span>
      </div>
      <WordcraftEditor
        ref={editor}
        document={file ?? undefined}
        user={{ name, color }}
        collaboration={collab?.collaboration}
        ai={ai}
        height="calc(100vh - 100px)"
        style={{ borderRadius: 8, border: '1px solid #ddd' }}
        onReady={(ed) => Object.assign(window, { wordcraft: ed, wordcraftProvider: collab?.provider })}
        onSave={async (f) => {
          // Every AutoSave overwrites the one shared file with the merged document.
          const res = await fetch(`/api/documents/${docId}`, { method: 'PUT', body: f.blob });
          if (!res.ok) throw new Error(`save failed: ${res.status}`);
          setSaved(`${new Date().toLocaleTimeString()} (${f.reason})`);
        }}
      />
    </div>
  );
}
