'use client';

import { useEffect, useMemo, useState } from 'react';
import { WordcraftEditor, type CommentEvent, type Letterhead, type Permission, type Person } from '@gamine/wordcraft-react';
import { ai } from '../ai';

const PEOPLE: Person[] = [
  { id: 'wanjiru', name: 'Wanjiru Kamau', email: 'wanjiru@example.org' },
  { id: 'otieno', name: 'Otieno Odhiambo', email: 'otieno@example.org' },
  { id: 'amina', name: 'Amina Yusuf', email: 'amina@example.org' },
];

/**
 * The Google Docs style features, for trying them and for smoke-features.mjs:
 * /features?permission=comment, an organisation letterhead that arrives after the editor
 * mounts (as a host's brand loads from its server), and comments with people to mention.
 * window.features exposes the host side: setPermission, setLetterhead and the store's events.
 */
export default function FeaturesPage() {
  const [permission, setPermission] = useState<Permission>('edit');
  const [letterhead, setLetterhead] = useState<Letterhead | null>(null);
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setPermission((q.get('permission') as Permission) ?? 'edit');
    // The brand arrives a moment after mount.
    const t = setTimeout(() => setLetterhead({ name: q.get('org') ?? 'Sauti Salama', tagline: 'Survivor-centred referral network', address: 'Nairobi', rule: true }), 1500);
    return () => clearTimeout(t);
  }, []);

  const log = (e: string) => setEvents((x) => [...x, e]);
  useEffect(() => {
    Object.assign(window, { features: { setPermission, setLetterhead, events } });
  }, [events]);

  const comments = useMemo(
    () => ({
      people: PEOPLE,
      store: {
        create: (c: CommentEvent['comment']) => log(`create:${c.text}`),
        reply: (c: CommentEvent['comment']) => log(`reply:${c.text}`),
        update: (c: CommentEvent['comment']) => log(`update:${c.text}`),
        resolve: (c: CommentEvent['comment'], r: boolean) => log(`resolve:${c.id}:${r}`),
        remove: (c: CommentEvent['comment']) => log(`remove:${c.id}`),
      },
      onMention: ({ people }: { people: Person[] }) => log(`mention:${people.map((p) => p.id).join(',')}`),
    }),
    [],
  );

  return (
    <main style={{ height: '100dvh', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 8, font: '13px system-ui' }}>
        Access:
        {(['view', 'comment', 'suggest', 'edit'] as Permission[]).map((p) => (
          <button key={p} type="button" aria-pressed={permission === p} onClick={() => setPermission(p)}>
            {p}
          </button>
        ))}
        <span data-testid="events">{events.length} store events</span>
      </div>
      <WordcraftEditor
        sample
        user={{ name: 'Wanjiru Kamau' }}
        permission={permission}
        comments={comments}
        ai={{ ...ai, letterhead, onLetterheadApplied: (lh) => log(`letterhead:${lh.name}`) }}
        height="100%"
        onReady={(ed) => Object.assign(window, { wordcraft: ed })}
        onSave={async () => undefined}
      />
    </main>
  );
}
