import Link from 'next/link';

export const metadata = { title: 'Demos' };

const DEMOS = [
  { href: 'collaboration', title: 'Real-time co-editing', extra: true, text: 'Two editors on one document, with live cursors and per-person undo. Open it in another tab to join.' },
  { href: 'ai', title: 'AI writing and AI Studio', extra: true, text: 'The sparkle at the bottom centre, quick actions, skills (Humaniser on), letterheads and palettes, with your own key.' },
  { href: 'version-history', title: 'Version history', extra: true, text: 'Versions recorded as you edit, a Google Docs-style panel, read-only previews and restore.' },
  { href: 'fonts', title: 'Fonts on demand', extra: true, text: 'The Google Fonts library in the font box, each name previewed in its own face.' },
  { href: 'api', title: 'Command API', text: 'Run ribbon commands from code, read the text, and export .docx, PDF, HTML or Markdown.' },
  { href: 'viewer', title: 'Document viewer', text: 'Viewing mode with the title bar and ribbon hidden, for read-only pages.' },
];

export default function Demos() {
  return (
    <div className="wrap" style={{ paddingBottom: 80 }}>
      <div className="demo-head">
        <span className="eyebrow">Demos</span>
        <h1>See each feature on its own</h1>
        <p>
          Every demo runs the published package in your browser. The <Link href="/playground/">playground</Link> has all the props together.
        </p>
      </div>
      <div className="grid">
        {DEMOS.map((d) => (
          <Link key={d.href} className="card" href={`/demos/${d.href}/`}>
            <h3>
              {d.title} {d.extra && <span className="extra">Extra</span>}
            </h3>
            <p>{d.text}</p>
            <span className="go">Open →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
