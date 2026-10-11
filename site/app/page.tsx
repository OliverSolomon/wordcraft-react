import Link from 'next/link';
import type { ReactNode } from 'react';

import { CopyInstall } from '@/components/CopyInstall';
import { LaunchEditor } from '@/components/LaunchEditor';

const Icon = ({ d }: { d: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d={d} />
  </svg>
);
const ICONS = {
  doc: 'M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5L13 3.5zM8 13h8v2H8v-2zm0 4h8v2H8v-2z',
  people: 'M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 2 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z',
  spark: 'M12 2c.6 5.4 4.6 9.4 10 10-5.4.6-9.4 4.6-10 10-.6-5.4-4.6-9.4-10-10 5.4-.6 9.4-4.6 10-10z',
  history: 'M13 3a9 9 0 0 0-9 9H1l3.9 3.9L9 12H6a7 7 0 1 1 2.1 5l-1.4 1.4A9 9 0 1 0 13 3zm-1 5v5l4.3 2.5.7-1.2-3.5-2.1V8H12z',
  font: 'M9.9 4 4 20h2.6l1.5-4h7.8l1.5 4H20L14.1 4H9.9zm-1 9.8L12 6.6l3.1 7.2H8.9z',
  sliders: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
  code: 'M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z',
  eye: 'M12 5C7 5 2.7 8.1 1 12c1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 11.5A4.5 4.5 0 1 1 16.5 12 4.5 4.5 0 0 1 12 16.5zm0-7A2.5 2.5 0 1 0 14.5 12 2.5 2.5 0 0 0 12 9.5z',
  grid: 'M3 3h18v18H3V3zm2 2v4h4V5H5zm6 0v4h4V5h-4zm6 0v4h2V5h-2zM5 11v4h4v-4H5zm6 0v4h4v-4h-4zm6 0v4h2v-4h-2zM5 17v2h4v-2H5zm6 0v2h4v-2h-4zm6 0v2h2v-2h-2z',
};

function Feature({ icon, title, extra, children, href }: { icon: string; title: string; extra?: boolean; children: ReactNode; href: string }) {
  return (
    <Link className="card" href={href}>
      <div className="icon">
        <Icon d={icon} />
      </div>
      <h3>
        {title} {extra && <span className="extra">Extra</span>}
      </h3>
      <p>{children}</p>
      <span className="go">See it →</span>
    </Link>
  );
}

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <span className="eyebrow">Open source · React · Next.js</span>
          <h1>
            A <em>Word-grade</em> document editor, as one React component.
          </h1>
          <p className="lead">
            The full WordCraft word processor (the ribbon, the dialogs, real pages, tracked changes, comments, .docx and PDF) running in your app. Add co-editing, AI writing and version history with a prop.
          </p>
          <div className="cta">
            <Link className="btn primary" href="/playground/">
              Open the playground
            </Link>
            <Link className="btn" href="/docs/getting-started/">
              Read the docs
            </Link>
            <CopyInstall />
          </div>
          <LaunchEditor />
        </div>
      </section>

      <section className="block">
        <div className="wrap">
          <h2>Everything a document needs</h2>
          <p className="sub">
            Each feature has a live demo. Features tagged <span className="extra">Extra</span> are additions of this package: they are not part of Microsoft Word or WordCraft.
          </p>
          <div className="grid">
            <Feature icon={ICONS.doc} title="The full editor" href="/playground/">
              WordCraft&apos;s ribbon, styles, tables, headers, footnotes, equations and Track Changes, 1:1 with its own apps.
            </Feature>
            <Feature icon={ICONS.people} title="Real-time co-editing" extra href="/demos/collaboration/">
              Yjs with any provider. Live cursors, per-person undo, and one shared file saved by AutoSave.
            </Feature>
            <Feature icon={ICONS.spark} title="AI writing and AI Studio" extra href="/demos/ai/">
              A Gemini-style bar with skills (the Humaniser is on by default), letterheads, palettes and your own key.
            </Feature>
            <Feature icon={ICONS.history} title="Version history" extra href="/demos/version-history/">
              Versions recorded as you work, like Google Docs. View, restore, name or download any of them.
            </Feature>
            <Feature icon={ICONS.font} title="Fonts on demand" extra href="/demos/fonts/">
              The Google Fonts library in the font box, previewed in each face and fetched when picked.
            </Feature>
            <Feature icon={ICONS.sliders} title="Host controls" href="/playground/">
              Choose the ribbon tabs, hide the title bar or ribbon, switch modes and turn off commands.
            </Feature>
            <Feature icon={ICONS.code} title="Command API" href="/demos/api/">
              Every ribbon action is a command you can run from code, plus export to .docx, PDF, HTML and Markdown.
            </Feature>
            <Feature icon={ICONS.eye} title="Document viewer" href="/demos/viewer/">
              Viewing mode with the chrome hidden: a faithful, read-only page view for any .docx.
            </Feature>
          </div>
        </div>
      </section>

      <section className="block alt">
        <div className="wrap split">
          <div>
            <h2>Drop it in like any editor</h2>
            <p className="sub">It renders on the server as a sized box and starts in the browser, so it works in the App Router without a dynamic import.</p>
            <ul className="checks">
              <li>Saves go to your app through onSave, including Word-style AutoSave.</li>
              <li>The WebAssembly binary is emitted by your bundler and cached.</li>
              <li>Upstream WordCraft is synced every two hours and released when it passes the tests.</li>
            </ul>
          </div>
          <pre className="codeblock">{`'use client';
import { WordcraftEditor } from '@gamine/wordcraft-react';

export default function Page() {
  return (
    <WordcraftEditor
      user={{ name: 'Ada Lovelace' }}
      ai
      versionHistory
      onSave={(file) =>
        fetch('/api/doc', { method: 'PUT', body: file.blob })
      }
    />
  );
}`}</pre>
        </div>
      </section>

      <section className="block">
        <div className="wrap">
          <h2>The Craft packages</h2>
          <p className="sub">Open-source look-alikes of the Office apps, packaged for React. Each follows its upstream project and the same versioning rule.</p>
          <div className="pkg">
            <div className="card">
              <div className="icon">
                <Icon d={ICONS.doc} />
              </div>
              <h3>
                @gamine/wordcraft-react <span className="status">Available</span>
              </h3>
              <p>WordCraft, the Microsoft Word look-alike.</p>
              <span className="go">
                <Link href="/docs/getting-started/">Get started →</Link>
              </span>
            </div>
            <div className="card">
              <div className="icon">
                <Icon d={ICONS.grid} />
              </div>
              <h3>
                @gamine/gridcraft-react <span className="status soon">Planned</span>
              </h3>
              <p>GridCraft, the Microsoft Excel look-alike, packaged the same way.</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
