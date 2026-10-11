import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { NavLinks } from '@/components/NavLinks';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'WordCraft for React', template: '%s · WordCraft for React' },
  description:
    'A Microsoft Word look-alike as a React and Next.js component: the full WordCraft editor, with co-editing, AI writing, version history and fonts on demand.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="inner">
            <Link className="brand" href="/">
              <span className="brand-mark">W</span>
              WordCraft <small>for React</small>
            </Link>
            <NavLinks />
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <div className="wrap">
            <span>
              <code>@gamine/wordcraft-react</code> by ndamathia. Built on{' '}
              <a href="https://github.com/storytold/wordcraft" target="_blank" rel="noreferrer">
                WordCraft
              </a>
              . MIT or Apache-2.0. Not affiliated with Microsoft.
            </span>
            <span>
              <a href="https://github.com/OliverSolomon/wordcraft-react" target="_blank" rel="noreferrer">
                GitHub
              </a>
              {' · '}
              <a href="https://www.npmjs.com/package/@gamine/wordcraft-react" target="_blank" rel="noreferrer">
                npm
              </a>
              {' · '}
              <Link href="/docs/changelog/">Changelog</Link>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
