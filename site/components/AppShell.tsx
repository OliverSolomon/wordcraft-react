'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  BookOpenText,
  CaretDown,
  CaretRight,
  ClockCounterClockwise,
  GithubLogo,
  List,
  MagnifyingGlass,
  Moon,
  Package,
  PencilSimple,
  PlayCircle,
  SlidersHorizontal,
  Sun,
  X,
} from '@phosphor-icons/react';

import type { DocEntry } from '@/lib/docs';
import { Search } from './Search';

const REPO = 'https://github.com/OliverSolomon/wordcraft-react';

const PRIMARY = [
  { href: '/', label: 'Documentation', icon: BookOpenText, match: (p: string) => p === '/' || p.startsWith('/docs') },
  { href: '/playground/', label: 'Playground', icon: SlidersHorizontal, match: (p: string) => p.startsWith('/playground') },
  { href: '/demos/', label: 'Demos', icon: PlayCircle, match: (p: string) => p.startsWith('/demos') },
  { href: '/docs/changelog/', label: 'Changelog', icon: ClockCounterClockwise, match: (p: string) => p.startsWith('/docs/changelog') },
];

const DEMO_TITLES: Record<string, string> = {
  collaboration: 'Co-editing',
  ai: 'AI writing',
  'version-history': 'Version history',
  fonts: 'Fonts',
  api: 'Command API',
  viewer: 'Viewer',
};

function trail(path: string, index: DocEntry[]): Array<{ label: string; href?: string }> {
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return [{ label: 'Overview' }];
  if (parts[0] === 'docs') {
    const entry = index.find((d) => d.slug === parts[1]);
    return entry ? [{ label: 'Docs', href: '/docs/' }, { label: entry.group }, { label: entry.title }] : [{ label: 'Docs' }];
  }
  if (parts[0] === 'demos') return parts[1] ? [{ label: 'Demos', href: '/demos/' }, { label: DEMO_TITLES[parts[1]] ?? parts[1] }] : [{ label: 'Demos' }];
  if (parts[0] === 'playground') return [{ label: 'Playground' }];
  return [{ label: parts[0] }];
}

export function AppShell({ index, version, children }: { index: DocEntry[]; version: string; children: ReactNode }) {
  const path = usePathname() ?? '/';
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [drawer, setDrawer] = useState(false);
  const [searching, setSearching] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  }, []);
  useEffect(() => setDrawer(false), [path]);

  // Cmd/Ctrl+K opens search, as in most documentation sites.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearching((s) => !s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const switchTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('wc-site-theme', next);
    } catch {
      // storage unavailable: the choice lasts for this visit
    }
  };

  const groups = useMemo(() => [...new Set(index.map((d) => d.group))], [index]);
  const q = query.trim().toLowerCase();
  const filtered = q ? index.filter((d) => `${d.title} ${d.description} ${d.headings.join(' ')}`.toLowerCase().includes(q)) : index;
  const currentDoc = path.startsWith('/docs/') ? path.split('/')[2] : '';
  const crumbs = trail(path, index);
  const editHref = currentDoc ? `${REPO}/blob/main/${editPath(currentDoc)}` : REPO;

  return (
    <div className="shell">
      <div className="frame">
        <header className="topbar">
          <button type="button" className="round menu-btn" aria-label="Open navigation" onClick={() => setDrawer(true)}>
            <List size={18} />
          </button>
          <Link href="/" className="wordmark" aria-label="wordcraft-react, home">
            <span className="wordmark-mark">W</span>
            wordcraft-react
          </Link>
          <Link href="/docs/changelog/" className="version" title="What changed in this version">
            v{version}
            <CaretDown size={12} weight="bold" />
          </Link>
          <button type="button" className="search-pill" onClick={() => setSearching(true)} aria-label="Search documentation">
            <MagnifyingGlass size={18} />
            <span>Search documentation</span>
            <kbd className="kbd">⌘K</kbd>
          </button>
          <nav className="toplinks" aria-label="Site">
            <Link href="/demos/" aria-current={path.startsWith('/demos') ? 'page' : undefined}>
              Demos
            </Link>
            <Link href="/docs/props/" aria-current={path.startsWith('/docs/props') ? 'page' : undefined}>
              Reference
            </Link>
            <Link href="/docs/changelog/" aria-current={path.startsWith('/docs/changelog') ? 'page' : undefined}>
              Changelog
            </Link>
          </nav>
          <a className="round gh-btn" href={REPO} target="_blank" rel="noreferrer" aria-label="GitHub repository">
            <GithubLogo size={19} />
          </a>
        </header>

        <div className="crumbbar">
          <span className="pkg-chip">
            <span className="pkg-dot">
              <Package size={11} weight="bold" />
            </span>
            @gamine/wordcraft-react
          </span>
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} style={{ display: 'contents' }}>
                {i > 0 && (
                  <span className="sep" aria-hidden="true">
                    <CaretRight size={11} weight="bold" />
                  </span>
                )}
                {c.href ? (
                  <Link href={c.href}>{c.label}</Link>
                ) : (
                  <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>
                )}
              </span>
            ))}
          </nav>
          <div className="crumb-actions">
            {currentDoc && (
              <a className="ghost" href={editHref} target="_blank" rel="noreferrer">
                <PencilSimple size={15} />
                <span className="label">Edit this page</span>
              </a>
            )}
            <button type="button" className="ghost" onClick={switchTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              <span className="label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>
          </div>
        </div>

        <div className="body">
          {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}
          <aside className="sidebar" data-open={drawer} aria-label="Documentation">
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              {drawer && (
                <button type="button" className="round" aria-label="Close navigation" onClick={() => setDrawer(false)} style={{ marginBottom: 12 }}>
                  <X size={16} />
                </button>
              )}
            </div>
            <label className="side-search">
              <MagnifyingGlass size={17} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Fast search" aria-label="Filter pages" />
            </label>
            {!q && (
              <nav className="primary-nav">
                {PRIMARY.map(({ href, label, icon: Icon, match }) => (
                  <Link key={href} href={href} aria-current={match(path) && (href !== '/' || !path.startsWith('/docs/changelog')) ? 'page' : undefined}>
                    <span className="nav-ico">
                      <Icon size={20} weight={match(path) ? 'fill' : 'regular'} />
                    </span>
                    {label}
                  </Link>
                ))}
              </nav>
            )}
            {groups.map((g) => {
              const items = filtered.filter((d) => d.group === g);
              if (!items.length) return null;
              const expanded = q ? true : (open[g] ?? (g !== 'Project' || items.some((d) => d.slug === currentDoc)));
              return (
                <div key={g} className="group">
                  <button type="button" className="group-head" aria-expanded={expanded} onClick={() => setOpen((o) => ({ ...o, [g]: !expanded }))}>
                    {g}
                    <CaretDown size={14} weight="bold" />
                  </button>
                  {expanded && (
                    <div className="group-items">
                      {items.map((d) => (
                        <Link key={d.slug} href={`/docs/${d.slug}/`} aria-current={d.slug === currentDoc ? 'page' : undefined}>
                          {d.title}
                          {d.extra && <span className="tag">Extra</span>}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {q && !filtered.length && <p style={{ color: 'var(--muted)', fontSize: 14, padding: '8px 14px' }}>No pages match “{query}”.</p>}
          </aside>
          <main className="content">
            <div className="content-inner reveal" key={path}>
              {children}
            </div>
          </main>
        </div>
      </div>
      {searching && <Search index={index} onClose={() => setSearching(false)} />}
    </div>
  );
}

function editPath(slug: string): string {
  const files: Record<string, string> = {
    divergences: 'docs/DIVERGENCES.md',
    'word-parity': 'docs/WORD-PARITY.md',
    versioning: 'docs/VERSIONING.md',
    changelog: 'CHANGELOG.md',
  };
  return files[slug] ?? 'README.md';
}
