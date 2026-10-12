import Link from 'next/link';
import { ArrowRight } from '@phosphor-icons/react/dist/ssr';

import { DemoHead } from '@/components/DemoHead';
import { SHOTS } from '@/lib/features';

export const metadata = { title: 'Demos' };

const DEMOS = [
  { href: 'collaboration', title: 'Real-time co-editing', extra: true, shot: SHOTS.collab, text: 'Two editors on one document, with live cursors and per-person undo. Open it in another tab to join.' },
  { href: 'ai', title: 'AI writing and AI Studio', extra: true, shot: SHOTS.aiBar, text: 'The sparkle, quick actions, skills with the Humaniser on, letterheads and palettes, with your own key.' },
  { href: 'version-history', title: 'Version history', extra: true, shot: SHOTS.versions, text: 'Versions recorded as you edit, a panel by day, read-only previews and restore.' },
  { href: 'fonts', title: 'Fonts on demand', extra: true, shot: SHOTS.fonts, text: 'The Google Fonts library in the font box, each name previewed in its own face.' },
  { href: 'api', title: 'Command API', extra: false, shot: SHOTS.api, text: 'Run ribbon commands from code, read the text, and export .docx, PDF or Markdown.' },
  { href: 'viewer', title: 'Document viewer', extra: false, shot: SHOTS.viewer, text: 'Viewing mode with the title bar and ribbon hidden, for read-only pages.' },
];

export default function Demos() {
  return (
    <>
      <DemoHead title="Demos">
        Each feature on its own, running the published package in your browser. The playground has every prop together.
      </DemoHead>
      <div className="bento">
        {DEMOS.map((d) => (
          <Link key={d.href} className="tile half shot" href={`/demos/${d.href}/`}>
            <div className="tile-body">
              <h3>
                {d.title}
                {d.extra && <span className="tag">Extra</span>}
              </h3>
              <p>{d.text}</p>
              <span className="go">
                Open <ArrowRight size={14} />
              </span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.shot.src} alt={d.shot.alt} loading="lazy" decoding="async" />
          </Link>
        ))}
      </div>
    </>
  );
}
