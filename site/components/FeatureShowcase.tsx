'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import type { ComponentType } from 'react';
import { ArrowRight, Check, Code, Images, Play } from '@phosphor-icons/react';
import { preloadWordcraft } from '@gamine/wordcraft-react';

import type { LiveKind, Showcase } from '@/lib/features';

const loading = () => (
  <div className="showcase-start">
    <div>
      <div className="spinner" />
      Starting the editor…
    </div>
  </div>
);

// Live examples load only when asked for: the editor is a 12 MB download.
const LIVE: Record<LiveKind, ComponentType> = {
  editor: dynamic(() => import('./Editor').then((m) => () => <m.Editor sample user={{ name: 'You', color: '#2554c7' }} height="min(66vh, 680px)" />), { ssr: false, loading }),
  ai: dynamic(() => import('@/app/demos/ai/AiDemo').then((m) => m.AiDemo), { ssr: false, loading }),
  versions: dynamic(() => import('@/app/demos/version-history/VersionsDemo').then((m) => m.VersionsDemo), { ssr: false, loading }),
  collab: dynamic(() => import('@/app/demos/collaboration/Collaboration').then((m) => m.Collaboration), { ssr: false, loading }),
  fonts: dynamic(() => import('@/app/demos/fonts/FontsDemo').then((m) => m.FontsDemo), { ssr: false, loading }),
  api: dynamic(() => import('@/app/demos/api/ApiDemo').then((m) => m.ApiDemo), { ssr: false, loading }),
  viewer: dynamic(() => import('@/app/demos/viewer/ViewerDemo').then((m) => m.ViewerDemo), { ssr: false, loading }),
  mobile: dynamic(
    () =>
      import('./Editor').then((m) => () => (
        <div className="phone-frame">
          <m.Editor sample mobile user={{ name: 'You', color: '#2554c7' }} height="100%" />
        </div>
      )),
    { ssr: false, loading },
  ),
};

type Tab = 'preview' | 'live' | 'code';

export function FeatureShowcase({ showcase }: { showcase: Showcase }) {
  const [tab, setTab] = useState<Tab>('preview');
  const [started, setStarted] = useState(false);
  const Live = LIVE[showcase.live];
  const tabs: Array<[Tab, string, typeof Play]> = [
    ['preview', 'Preview', Images],
    ['live', 'Live example', Play],
    ['code', 'Code', Code],
  ];
  return (
    <section aria-label="Example">
      <div className="segmented" role="tablist">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            onMouseEnter={id === 'live' ? () => void preloadWordcraft() : undefined}
          >
            {tab === id ? <Check size={15} weight="bold" /> : <Icon size={15} />}
            {label}
          </button>
        ))}
      </div>
      <div className="showcase">
        {tab === 'preview' && (
          <div className="strip">
            {showcase.shots.map((s) => (
              <figure key={s.src}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.src} alt={s.alt} loading="lazy" decoding="async" />
              </figure>
            ))}
          </div>
        )}
        {tab === 'live' && (
          <div className="showcase-live">
            {started ? (
              <Live />
            ) : (
              <div className="showcase-start">
                <div>
                  <h3>Try it here</h3>
                  <p>The real editor runs in this page. It downloads once, about 12 MB, then stays cached.</p>
                  <button type="button" className="btn primary" onMouseEnter={() => void preloadWordcraft()} onClick={() => setStarted(true)}>
                    Start the live example
                    <span className="btn-ico">
                      <ArrowRight size={15} weight="bold" />
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {tab === 'code' && <pre className="codeblock">{showcase.code}</pre>}
      </div>
      <p className="caption">{showcase.caption}</p>
    </section>
  );
}
