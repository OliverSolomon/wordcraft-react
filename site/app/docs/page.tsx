import Link from 'next/link';
import { ArrowRight } from '@phosphor-icons/react/dist/ssr';

import { docIndex } from '@/lib/docs';

export const metadata = { title: 'Docs' };

export default function DocsHome() {
  const index = docIndex();
  const groups = [...new Set(index.map((d) => d.group))];
  return (
    <>
      <header className="page-head">
        <h1>Documentation</h1>
        <p>Generated from the repository on every release, so it always matches the version on npm.</p>
      </header>
      {groups.map((g) => (
        <section key={g}>
          <h2 className="section-title" style={{ marginTop: 34 }}>
            {g}
          </h2>
          <div className="next-grid" style={{ marginTop: 14 }}>
            {index
              .filter((d) => d.group === g)
              .map((d) => (
                <Link key={d.slug} className="next-card" href={`/docs/${d.slug}/`}>
                  <span className="dir">
                    {d.title}
                    {d.extra && <span className="tag">Extra</span>}
                    <ArrowRight size={16} style={{ marginLeft: 'auto' }} />
                  </span>
                  <p>{d.description}</p>
                </Link>
              ))}
          </div>
        </section>
      ))}
    </>
  );
}
