import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { docIndex, renderDoc } from '@/lib/docs';

export const dynamicParams = false;

export function generateStaticParams() {
  return docIndex().map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const entry = docIndex().find((d) => d.slug === slug);
  return { title: entry?.title ?? 'Docs' };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const index = docIndex();
  const i = index.findIndex((d) => d.slug === slug);
  if (i < 0) notFound();
  const entry = index[i]!;
  const { html, headings } = renderDoc(slug);
  const groups = [...new Set(index.map((d) => d.group))];
  const prev = index[i - 1];
  const next = index[i + 1];
  const toc = headings.filter((h) => h.depth > 1);

  return (
    <div className="docs">
      <nav className="docs-nav" aria-label="Documentation">
        {groups.map((g) => (
          <div key={g}>
            <h4>{g}</h4>
            {index
              .filter((d) => d.group === g)
              .map((d) => (
                <Link key={d.slug} href={`/docs/${d.slug}/`} aria-current={d.slug === slug ? 'page' : undefined}>
                  {d.title}
                  {d.extra && <span className="extra">Extra</span>}
                </Link>
              ))}
          </div>
        ))}
      </nav>
      <article className="prose">
        <h1>
          {entry.title} {entry.extra && <span className="extra">Extra</span>}
        </h1>
        <div dangerouslySetInnerHTML={{ __html: html }} />
        <div className="doc-foot">
          {prev ? <Link href={`/docs/${prev.slug}/`}>← {prev.title}</Link> : <span />}
          {next ? <Link href={`/docs/${next.slug}/`}>{next.title} →</Link> : <span />}
        </div>
      </article>
      <aside className="toc" aria-label="On this page">
        {toc.length > 1 && (
          <>
            <h4>On this page</h4>
            {toc.map((h) => (
              <a key={h.id} href={`#${h.id}`} className={`d${h.depth}`}>
                {h.text}
              </a>
            ))}
          </>
        )}
      </aside>
    </div>
  );
}
