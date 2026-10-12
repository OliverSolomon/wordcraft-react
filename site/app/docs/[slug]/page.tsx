import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight } from '@phosphor-icons/react/dist/ssr';

import { FeatureShowcase } from '@/components/FeatureShowcase';
import { docIndex, renderDoc } from '@/lib/docs';
import { SHOWCASES } from '@/lib/features';

export const dynamicParams = false;

export function generateStaticParams() {
  return docIndex().map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const entry = docIndex().find((d) => d.slug === slug);
  return { title: entry?.title ?? 'Docs', description: entry?.description };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const index = docIndex();
  const i = index.findIndex((d) => d.slug === slug);
  if (i < 0) notFound();
  const entry = index[i]!;
  const { html } = renderDoc(slug);
  const prev = index[i - 1];
  const next = index[i + 1];
  const showcase = SHOWCASES[slug];

  return (
    <article>
      <header className="page-head">
        <h1>
          {entry.title}
          {entry.extra && <span className="tag">Extra</span>}
        </h1>
        {entry.description && <p>{entry.description}</p>}
      </header>
      {showcase && <FeatureShowcase showcase={showcase} />}
      <div className="prose" style={showcase ? { marginTop: 36 } : undefined} dangerouslySetInnerHTML={{ __html: html }} />
      <h2 className="next-title">Up next</h2>
      <div className="next-grid">
        {prev ? (
          <Link className="next-card" href={`/docs/${prev.slug}/`}>
            <span className="dir">
              <ArrowLeft size={18} />
              {prev.title}
            </span>
            <p>{prev.description}</p>
          </Link>
        ) : (
          <Link className="next-card" href="/">
            <span className="dir">
              <ArrowLeft size={18} />
              Overview
            </span>
            <p>Every feature at a glance, with screenshots and live examples.</p>
          </Link>
        )}
        {next ? (
          <Link className="next-card" href={`/docs/${next.slug}/`}>
            <span className="dir">
              {next.title}
              <ArrowRight size={18} />
            </span>
            <p>{next.description}</p>
          </Link>
        ) : (
          <Link className="next-card" href="/playground/">
            <span className="dir">
              Playground
              <ArrowRight size={18} />
            </span>
            <p>Change every prop and watch the editor follow.</p>
          </Link>
        )}
      </div>
    </article>
  );
}
