import fs from 'node:fs';
import path from 'node:path';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';

import { AppShell } from '@/components/AppShell';
import { docIndex } from '@/lib/docs';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'wordcraft-react', template: '%s · wordcraft-react' },
  description: 'wordcraft-react: storytold’s open-source WordCraft word processor as a React and Next.js component, with co-editing, AI writing, version history and fonts on demand.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b0c0f' },
    { media: '(prefers-color-scheme: light)', color: '#e7e8ec' },
  ],
};

// The theme is set before the first paint, so a light-mode reader never sees a dark flash.
const THEME = `try{var t=localStorage.getItem('wc-site-theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='dark'}`;

function packageVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'packages', 'wordcraft-react', 'package.json'), 'utf8')) as { version: string };
    return pkg.version;
  } catch {
    return '0';
  }
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body>
        <AppShell index={docIndex()} version={packageVersion()}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
