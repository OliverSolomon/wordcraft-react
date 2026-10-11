'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/docs/getting-started/', label: 'Docs', match: '/docs' },
  { href: '/playground/', label: 'Playground', match: '/playground' },
  { href: '/demos/', label: 'Demos', match: '/demos' },
];

export function NavLinks() {
  const path = usePathname() ?? '';
  return (
    <nav className="nav">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={path.startsWith(l.match) ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
      <a className="gh hide-sm" href="https://github.com/OliverSolomon/wordcraft-react" target="_blank" rel="noreferrer">
        GitHub
      </a>
    </nav>
  );
}
