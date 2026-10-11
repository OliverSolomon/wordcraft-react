import Link from 'next/link';
import type { ReactNode } from 'react';

export function DemoHead({ title, extra, doc, children }: { title: string; extra?: boolean; doc?: string; children: ReactNode }) {
  return (
    <div className="demo-head">
      <Link href="/demos/" style={{ fontSize: 14 }}>
        ← All demos
      </Link>
      <h1>
        {title} {extra && <span className="extra">Extra</span>}
      </h1>
      <p>
        {children}
        {doc && (
          <>
            {' '}
            <Link href={`/docs/${doc}/`}>Read the docs →</Link>
          </>
        )}
      </p>
    </div>
  );
}
