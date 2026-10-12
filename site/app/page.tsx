import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, BookOpenText, CheckCircle, Eye, SlidersHorizontal } from '@phosphor-icons/react/dist/ssr';

import { CopyInstall } from '@/components/CopyInstall';
import { SHOTS } from '@/lib/features';
import type { Shot } from '@/lib/features';

function upstream(): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), '..', 'UPSTREAM_REV'), 'utf8').trim().slice(0, 7);
  } catch {
    return '';
  }
}

function Tile({
  href,
  title,
  extra,
  children,
  shot,
  icon,
  size,
}: {
  href: string;
  title: string;
  extra?: boolean;
  children: ReactNode;
  shot?: Shot;
  icon?: ReactNode;
  size: 'wide' | 'half' | 'third';
}) {
  return (
    <Link href={href} className={`tile ${size}${shot ? ' shot' : ''}`}>
      <div className={shot ? 'tile-body' : undefined}>
        {icon && <div className="tile-ico">{icon}</div>}
        <h3>
          {title}
          {extra && <span className="tag">Extra</span>}
        </h3>
        <p>{children}</p>
        {!shot && (
          <span className="go">
            Open <ArrowRight size={14} />
          </span>
        )}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {shot && <img src={shot.src} alt={shot.alt} loading="lazy" decoding="async" />}
    </Link>
  );
}

export default function Overview() {
  const rev = upstream();
  return (
    <>
      <section className="hero">
        <h1>
          Word-grade documents,
          <br />
          <em>in one React component.</em>
        </h1>
        <div className="hero-side">
          <p>storytold’s open-source WordCraft editor, packaged for React: the ribbon, real pages, tracked changes and .docx. Co-editing, AI and version history are one prop each.</p>
          <div className="hero-actions">
            <Link className="btn primary" href="/docs/getting-started/">
              Get started
              <span className="btn-ico">
                <ArrowRight size={15} weight="bold" />
              </span>
            </Link>
            <CopyInstall />
          </div>
        </div>
      </section>

      <div className="showcase">
        <div className="strip">
          {[SHOTS.editor, SHOTS.aiBar, SHOTS.versions, SHOTS.collab].map((s) => (
            <figure key={s.src}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.src} alt={s.alt} decoding="async" />
            </figure>
          ))}
        </div>
      </div>
      <p className="caption">Hover a picture to see more of it. Every feature below has a page with screenshots, a live example and the code.</p>

      <h2 className="section-title">Everything in the box</h2>
      <p className="section-sub">
        What ships today. Features tagged <span className="tag">Extra</span> are additions of this package, not part of Microsoft Word or WordCraft.
      </p>
      <div className="bento">
        <Tile size="wide" href="/docs/getting-started/" title="The whole word processor" shot={SHOTS.editor}>
          WordCraft’s ribbon, styles, tables, headers and footers, footnotes, equations, comments and Track Changes, on real pages.
        </Tile>
        <Tile size="third" href="/docs/getting-started/" title="Inline tools, as on Windows" shot={SHOTS.mini}>
          The two-row mini toolbar over a selection and above the right-click menu, with New Comment.
        </Tile>
        <Tile size="third" href="/docs/co-editing/" title="Co-editing" extra shot={SHOTS.collab}>
          Yjs with any provider. Live cursors and per-person undo.
        </Tile>
        <Tile size="third" href="/docs/ai/" title="AI and AI Studio" extra shot={SHOTS.aiBar}>
          A writing bar with skills, letterheads, palettes and your own key.
        </Tile>
        <Tile size="third" href="/docs/version-history/" title="Version history" extra shot={SHOTS.versions}>
          Versions recorded as you work. View, name, restore or download.
        </Tile>
        <Tile size="half" href="/docs/fonts/" title="Fonts on demand" extra shot={SHOTS.fonts}>
          The Google Fonts library in the font box, each name in its own face.
        </Tile>
        <Tile size="half" href="/docs/editor-api/" title="Command API" shot={SHOTS.api}>
          Every ribbon action is a command you can run from code. Export to .docx, PDF, HTML or Markdown.
        </Tile>
        <Tile size="third" href="/docs/mobile/" title="Phones and tablets" extra shot={SHOTS.mobile}>
          Word for Android’s shape: touch gestures and one palette at the bottom.
        </Tile>
        <Tile size="third" href="/docs/props/" title="Host controls" icon={<SlidersHorizontal size={20} />}>
          Choose the tabs, collapse or hide the ribbon and title bar, set the mode and turn commands off.
        </Tile>
        <Tile size="third" href="/demos/viewer/" title="Document viewer" icon={<Eye size={20} />}>
          Viewing mode with the chrome hidden: faithful pages, read only.
        </Tile>
      </div>

      <div className="band">
        <div>
          <h3>Drop it in like any editor</h3>
          <p>It renders on the server as a sized box and starts in the browser, so the App Router needs no dynamic import.</p>
          <ul className="ticks">
            <li>
              <CheckCircle size={16} weight="fill" />
              Saves reach your app through onSave, including Word-style AutoSave.
            </li>
            <li>
              <CheckCircle size={16} weight="fill" />
              Your bundler emits the WebAssembly binary and caches it.
            </li>
            <li>
              <CheckCircle size={16} weight="fill" />
              Kept in step with WordCraft{rev ? ` (now ${rev})` : ''}: synced every two hours, released when the tests pass.
            </li>
          </ul>
        </div>
        <pre className="codeblock">{`'use client';
import { WordcraftEditor } from '@gamine/wordcraft-react';

export default function Brief() {
  return (
    <WordcraftEditor
      user={{ name: 'Wanjiru Kamau' }}
      ai
      versionHistory
      onSave={(file) =>
        fetch('/api/brief', { method: 'PUT', body: file.blob })
      }
    />
  );
}`}</pre>
      </div>

      <h2 className="section-title">The Craft packages</h2>
      <p className="section-sub">Open-source look-alikes of the Office apps, packaged for React. Each follows its upstream project and the same versioning rule.</p>
      <div className="pkgs">
        <div className="pkg">
          <h3>
            @gamine/wordcraft-react <span className="status">Available</span>
          </h3>
          <p>Packages storytold’s WordCraft, the Microsoft Word look-alike.</p>
        </div>
        <div className="pkg">
          <h3>
            @gamine/gridcraft-react <span className="status soon">Planned</span>
          </h3>
          <p>Will package storytold’s GridCraft, the Microsoft Excel look-alike, the same way.</p>
        </div>
      </div>

      <h2 className="next-title">Up next</h2>
      <div className="next-grid">
        <Link className="next-card" href="/docs/getting-started/">
          <span className="dir">
            <BookOpenText size={18} />
            Getting started
          </span>
          <p>Install the package and put the editor in a page.</p>
        </Link>
        <Link className="next-card" href="/playground/">
          <span className="dir">
            Playground
            <ArrowRight size={18} />
          </span>
          <p>Change every prop and watch the editor follow.</p>
        </Link>
      </div>
    </>
  );
}
