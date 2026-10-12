import Link from 'next/link';
import type { ReactNode } from 'react';

export function DemoHead({ title, extra, doc, children }: { title: string; extra?: boolean; doc?: string; children: ReactNode }) {
  return (
    <header className="page-head">
      <h1>
        {title}
        {extra && <span className="tag">Extra</span>}
      </h1>
      <p>
        {children}
        {doc && (
          <>
            {' '}
            <Link href={`/docs/${doc}/`} style={{ color: 'var(--accent)' }}>
              Read the docs
            </Link>
          </>
        )}
      </p>
    </header>
  );
}
