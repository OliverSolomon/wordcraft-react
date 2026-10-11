import Link from 'next/link';

import { docIndex } from '@/lib/docs';

export const metadata = { title: 'Docs' };

export default function DocsHome() {
  const index = docIndex();
  const groups = [...new Set(index.map((d) => d.group))];
  return (
    <div className="wrap" style={{ padding: '48px 20px 80px' }}>
      <span className="eyebrow">Documentation</span>
      <h1 style={{ fontSize: 40, letterSpacing: '-0.03em', margin: '14px 0 8px' }}>Everything in the package</h1>
      <p style={{ color: 'var(--ink-2)', maxWidth: 680 }}>
        These pages are generated from the repository&apos;s README and docs on every release, so they always match the published version.
      </p>
      {groups.map((g) => (
        <section key={g} style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)' }}>{g}</h2>
          <div className="grid">
            {index
              .filter((d) => d.group === g)
              .map((d) => (
                <Link key={d.slug} className="card" href={`/docs/${d.slug}/`}>
                  <h3>
                    {d.title} {d.extra && <span className="extra">Extra</span>}
                  </h3>
                  <span className="go">Read →</span>
                </Link>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
