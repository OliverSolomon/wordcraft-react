import fs from 'node:fs';
import path from 'node:path';
import { Marked } from 'marked';

export interface DocEntry {
  slug: string;
  title: string;
  group: string;
  extra: boolean;
}

const CONTENT = path.join(process.cwd(), 'content');
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

export function docIndex(): DocEntry[] {
  return JSON.parse(fs.readFileSync(path.join(CONTENT, 'docs.json'), 'utf8')) as DocEntry[];
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/\s+/g, '-');

export interface RenderedDoc {
  html: string;
  headings: Array<{ id: string; text: string; depth: number }>;
}

export function renderDoc(slug: string): RenderedDoc {
  const md = fs.readFileSync(path.join(CONTENT, `${slug}.md`), 'utf8');
  const headings: RenderedDoc['headings'] = [];
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = slugify(text);
        if (depth <= 3) headings.push({ id, text: text.replace(/<[^>]+>/g, ''), depth });
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${text}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const external = /^https?:/.test(href);
        const url = href.startsWith('/') ? `${BASE}${href}` : href;
        return `<a href="${url}"${title ? ` title="${title}"` : ''}${external ? ' target="_blank" rel="noreferrer"' : ''}>${text}</a>`;
      },
      table(token) {
        // Tables scroll sideways on narrow screens instead of widening the page.
        const head = token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join('');
        const rows = token.rows.map((r) => `<tr>${r.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`).join('');
        return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>\n`;
      },
    },
  });
  const html = (marked.parse(md) as string).replace(/✦/g, '<span class="extra-mark" title="Extra: not part of Word or WordCraft">✦</span>');
  return { html, headings };
}
