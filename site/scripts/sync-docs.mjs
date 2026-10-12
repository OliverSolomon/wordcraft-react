// Builds the site's documentation pages from the repository's own docs, so there is one source
// of truth: README.md is split into pages by its sections, and docs/*.md and CHANGELOG.md become
// pages of their own. Relative links are rewritten to point at the site or at GitHub.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const out = path.resolve(here, '..', 'content');
const REPO = 'https://github.com/OliverSolomon/wordcraft-react';

// README sections (by heading) that make up each page, in the sidebar's order.
const PAGES = [
  { slug: 'getting-started', title: 'Getting started', group: 'Start', sections: ['', 'Install', 'Using it with Next.js'] },
  { slug: 'props', title: 'Component props', group: 'Start', sections: ['Component props'] },
  { slug: 'editor-api', title: 'Editor API', group: 'Start', sections: ['Editor API (the ref)'] },
  { slug: 'without-react', title: 'Without React', group: 'Start', sections: ['Without React'] },
  { slug: 'co-editing', title: 'Co-editing', group: 'Features', extra: true, sections: ['Co-editing'] },
  { slug: 'ai', title: 'AI and AI Studio', group: 'Features', extra: true, sections: ['AI (Extra)'] },
  { slug: 'version-history', title: 'Version history', group: 'Features', extra: true, sections: ['Version history (Extra)'] },
  { slug: 'fonts', title: 'Fonts', group: 'Features', sections: ['Fonts'] },
  { slug: 'mobile', title: 'Phones and tablets', group: 'Features', extra: true, sections: ['Phones and tablets'] },
  { slug: 'extras', title: 'Extras', group: 'Reference', sections: ['Extras'] },
  { slug: 'divergences', title: 'Divergences from WordCraft', group: 'Reference', file: 'docs/DIVERGENCES.md' },
  { slug: 'word-parity', title: 'Word parity', group: 'Reference', file: 'docs/WORD-PARITY.md' },
  { slug: 'things-to-know', title: 'Things to know', group: 'Reference', sections: ['Things to know'] },
  { slug: 'versioning', title: 'Versioning', group: 'Project', file: 'docs/VERSIONING.md' },
  { slug: 'changelog', title: 'Changelog', group: 'Project', file: 'CHANGELOG.md' },
  { slug: 'contributing', title: 'Building and contributing', group: 'Project', sections: ['Repository layout', 'Building from source', 'Staying in step with upstream'] },
  { slug: 'license', title: 'License and credits', group: 'Project', sections: ['License and credits'] },
];

// One line per page for cards, search and the page header.
const SUMMARIES = {
  'getting-started': 'Install the package and put a Word-grade editor in a React or Next.js page.',
  props: 'Every prop of <WordcraftEditor />, from documents and saving to tabs, modes and Extras.',
  'editor-api': 'Load, export and script the editor through its ref, with the same commands as the ribbon.',
  'without-react': 'Mount the editor in any element with the framework-free core.',
  'co-editing': 'Several people in one document at once, with live cursors and per-person undo.',
  ai: 'A Gemini-style writing bar with skills, letterheads, palettes and your own model.',
  'version-history': 'Versions recorded as you work, to view, name, restore or download.',
  fonts: 'The Google Fonts library in the font box, previewed in each face.',
  mobile: 'Word for Android’s shape on phones: touch gestures, a bottom command palette, foldables.',
  extras: 'What this package adds beyond Microsoft Word and WordCraft.',
  divergences: 'Every way the package differs from WordCraft, and where each change lives.',
  'word-parity': 'How much of Word the editor covers, tab by tab.',
  'things-to-know': 'Size, rendering, keyboard focus, persistence and the upstream patches.',
  versioning: 'How releases are numbered, and how they reach npm.',
  changelog: 'What changed in each published version.',
  contributing: 'Repository layout, building from source and the upstream sync.',
  license: 'Licences and credits.',
};

// In-README anchors that now live on other pages.
const ANCHORS = {
  '#phones-and-tablets': '/docs/mobile/',
  '#co-editing': '/docs/co-editing/',
  '#real-time-co-editing': '/docs/co-editing/',
  '#ai-extra': '/docs/ai/',
  '#version-history-extra': '/docs/version-history/',
  '#fonts': '/docs/fonts/',
  '#extras': '/docs/extras/',
};
const FILES = { 'docs/DIVERGENCES.md': 'divergences', 'docs/WORD-PARITY.md': 'word-parity', 'docs/VERSIONING.md': 'versioning', 'CHANGELOG.md': 'changelog' };

function rewriteLinks(md, from) {
  return md.replace(/\]\(([^)\s]+)\)/g, (all, href) => {
    if (/^(https?:|mailto:)/.test(href)) return all;
    if (href.startsWith('#')) return `](${ANCHORS[href] ?? href})`;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), href)).replace(/^\.\//, '');
    const [file, hash] = resolved.split('#');
    if (FILES[file]) return `](/docs/${FILES[file]}/${hash ? `#${hash}` : ''})`;
    if (file === 'README.md') return `](/docs/getting-started/)`;
    const kind = /\.[a-z]+$/i.test(file) ? 'blob' : 'tree';
    return `](${REPO}/${kind}/main/${file}${hash ? `#${hash}` : ''})`;
  });
}

function splitReadme(md) {
  const sections = new Map();
  let name = '';
  let buf = [];
  let inCode = false;
  for (const line of md.split('\n')) {
    if (line.startsWith('```')) inCode = !inCode;
    if (!inCode && line.startsWith('## ')) {
      sections.set(name, buf.join('\n').trim());
      // Trailing punctuation in a heading ("Co-editing.") doesn't change which section it is.
      name = line.slice(3).trim().replace(/[.:!]+$/, '').trim();
      buf = [];
    } else if (!inCode && line.startsWith('# ') && !name) {
      // the package title: the site has its own
    } else {
      buf.push(line);
    }
  }
  sections.set(name, buf.join('\n').trim());
  return sections;
}

// Plain text of a page's first paragraph, for cards and search.
function lead(md) {
  const para = md
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .find((b) => b && !/^(#|```|\||- |\d+\. |<)/.test(b));
  const text = (para ?? '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 170 ? `${text.slice(0, 167).replace(/\s+\S*$/, '')}…` : text;
}

// Section headings, for search.
function headings(md) {
  const out = [];
  let inCode = false;
  for (const line of md.split('\n')) {
    if (line.startsWith('```')) inCode = !inCode;
    const m = !inCode && /^(##|###) (.+)$/.exec(line);
    if (m) out.push(m[2].replace(/[`*]/g, '').trim());
  }
  return out;
}

fs.mkdirSync(out, { recursive: true });
const readme = splitReadme(fs.readFileSync(path.join(root, 'README.md'), 'utf8'));
const index = [];
for (const page of PAGES) {
  let md;
  if (page.file) {
    md = fs.readFileSync(path.join(root, page.file), 'utf8').replace(/^# .*\n+/, '');
    md = rewriteLinks(md, page.file);
  } else {
    md = page.sections
      .map((s, i) => {
        const body = readme.get(s);
        if (body === undefined) throw new Error(`README has no section "${s}"`);
        // The first section of a page is its lead; later ones keep their headings.
        return i === 0 ? body : `## ${s}\n\n${body}`;
      })
      .join('\n\n');
    md = rewriteLinks(md, 'README.md');
  }
  if (/\u2014/.test(md)) throw new Error(`${page.slug}: em dash found; the docs avoid them`);
  fs.writeFileSync(path.join(out, `${page.slug}.md`), md + '\n');
  index.push({ slug: page.slug, title: page.title, group: page.group, extra: !!page.extra, description: SUMMARIES[page.slug] ?? lead(md), headings: headings(md) });
}
fs.writeFileSync(path.join(out, 'docs.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`docs: wrote ${index.length} pages`);
