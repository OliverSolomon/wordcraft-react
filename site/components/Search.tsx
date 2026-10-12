'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';

import type { DocEntry } from '@/lib/docs';

interface Hit {
  href: string;
  title: string;
  where: string;
}

const PAGES: Hit[] = [
  { href: '/', title: 'Overview', where: 'Every feature at a glance' },
  { href: '/playground/', title: 'Playground', where: 'Every prop, live' },
  { href: '/demos/collaboration/', title: 'Co-editing demo', where: 'Demos' },
  { href: '/demos/ai/', title: 'AI writing demo', where: 'Demos' },
  { href: '/demos/version-history/', title: 'Version history demo', where: 'Demos' },
  { href: '/demos/fonts/', title: 'Fonts demo', where: 'Demos' },
  { href: '/demos/api/', title: 'Command API demo', where: 'Demos' },
  { href: '/demos/viewer/', title: 'Document viewer demo', where: 'Demos' },
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/\s+/g, '-');

/** Search across pages and their sections. Opens with Cmd/Ctrl+K; no animation, it's a keyboard action. */
export function Search({ index, onClose }: { index: DocEntry[]; onClose(): void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const all = useMemo<Hit[]>(() => {
    const out: Hit[] = [...PAGES];
    for (const d of index) {
      out.push({ href: `/docs/${d.slug}/`, title: d.title, where: d.description || d.group });
      for (const h of d.headings) out.push({ href: `/docs/${d.slug}/#${slug(h)}`, title: h, where: d.title });
    }
    return out;
  }, [index]);

  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return all.slice(0, 8);
    return all
      .map((h) => {
        const hay = `${h.title} ${h.where}`.toLowerCase();
        const title = h.title.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return null;
        const score = words.reduce((s, w) => s + (title.startsWith(w) ? 3 : title.includes(w) ? 2 : 1), 0);
        return { h, score };
      })
      .filter((x): x is { h: Hit; score: number } => !!x)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((x) => x.h);
  }, [q, all]);

  const go = (h: Hit | undefined) => {
    if (!h) return;
    onClose();
    router.push(h.href);
  };

  return (
    <div className="search-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-box" role="dialog" aria-label="Search documentation">
        <div className="row">
          <MagnifyingGlass size={18} />
          <input
            ref={input}
            value={q}
            placeholder="Search pages, sections and demos"
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, hits.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              }
              if (e.key === 'Enter') go(hits[active]);
            }}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div className="results" role="listbox">
          {hits.map((h, i) => (
            <a
              key={`${h.href}-${i}`}
              href={h.href}
              className="result"
              role="option"
              aria-selected={i === active}
              data-active={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={(e) => {
                e.preventDefault();
                go(h);
              }}
            >
              {h.title}
              <small>{h.where}</small>
            </a>
          ))}
          {!hits.length && <div className="empty">Nothing matches “{q}”.</div>}
        </div>
      </div>
    </div>
  );
}
