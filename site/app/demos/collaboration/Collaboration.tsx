'use client';

import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { yjsCollaboration } from '@gamine/wordcraft-react/collab';

import { Editor } from '@/components/Editor';
import { BroadcastProvider } from '@/lib/broadcast-provider';

const ROOM = 'collab-demo-v1';
const PEOPLE = [
  { name: 'Ada Lovelace', color: '#c2410c' },
  { name: 'Grace Hopper', color: '#2554c7' },
];

function Person({ person, first, start, onReady }: { person: { name: string; color: string }; first: boolean; start: boolean; onReady?: () => void }) {
  // Created in the browser only: BroadcastChannel doesn't exist while the page is pre-rendered.
  const [collab, setCollab] = useState<{ provider: BroadcastProvider; collaboration: ReturnType<typeof yjsCollaboration> } | null>(null);
  useEffect(() => {
    if (!start) return;
    const doc = new Y.Doc();
    const provider = new BroadcastProvider(ROOM, doc);
    setCollab({ provider, collaboration: yjsCollaboration({ doc, provider }) });
    return () => {
      provider.destroy();
      setCollab(null);
    };
  }, [start]);

  return (
    <div className="demo-frame">
      <div className="controls">
        <strong style={{ color: person.color }}>● {person.name}</strong>
      </div>
      {collab ? (
        <Editor sample={first} user={person} collaboration={collab.collaboration} ribbon="tabs" height="min(70vh, 720px)" onReady={() => onReady?.()} />
      ) : (
        <div className="launch" style={{ height: 'min(70vh, 720px)' }}>
          <p>Joining once {PEOPLE[0]!.name.split(' ')[0]} has the document open…</p>
        </div>
      )}
    </div>
  );
}

export function Collaboration() {
  // The second person joins once the first has opened and shared the document.
  const [firstReady, setFirstReady] = useState(false);
  const [second, setSecond] = useState(false);
  useEffect(() => {
    if (!firstReady) return;
    const t = setTimeout(() => setSecond(true), 1500);
    return () => clearTimeout(t);
  }, [firstReady]);
  return (
    <div className="two">
      <Person person={PEOPLE[0]!} first start onReady={() => setFirstReady(true)} />
      <Person person={PEOPLE[1]!} first={false} start={second} />
    </div>
  );
}
