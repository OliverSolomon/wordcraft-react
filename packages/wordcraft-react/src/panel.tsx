'use client';

/**
 * The frame every side panel shares (document chat, writing checks, originality, outline,
 * accessibility, sources): the same width, header, tokens and motion as the comments panel, and a
 * bottom sheet on a phone. Host theme tokens (`--wc-bg`, `--wc-fg`, `--wc-accent`…) win.
 */
import type { KeyboardEvent, ReactNode } from 'react';

export function SidePanel({
  title,
  icon,
  extra = true,
  onClose,
  dark,
  sheet,
  children,
  actions,
  label,
}: {
  title: string;
  icon?: ReactNode;
  /** Tag it as an Extra (not part of Word or WordCraft). */
  extra?: boolean;
  onClose: () => void;
  dark?: boolean;
  sheet?: boolean;
  children: ReactNode;
  actions?: ReactNode;
  label?: string;
}) {
  // Keys typed in a panel belong to the panel, not the document.
  const keys = (e: KeyboardEvent<HTMLElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape') onClose();
  };
  return (
    <aside className={`wcsp${sheet ? ' wcsp-sheet' : ''}`} data-theme={dark ? 'dark' : 'light'} aria-label={label ?? title} onKeyDown={keys} onKeyUp={(e) => e.stopPropagation()} onPaste={(e) => e.stopPropagation()}>
      <style>{PANEL_CSS}</style>
      <header className="wcsp-top">
        {icon}
        <h2>{title}</h2>
        {extra && (
          <span className="wcsp-extra" title="An Extra: not part of Microsoft Word or WordCraft">
            Extra
          </span>
        )}
        {actions}
        <button type="button" className="wcsp-icon" aria-label={`Close ${title}`} onClick={onClose}>
          ✕
        </button>
      </header>
      {children}
    </aside>
  );
}

/** A small line icon (24px grid). */
export const PanelIcon = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
    <path d={d} fill="currentColor" />
  </svg>
);

export const ICONS = {
  chat: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z',
  check: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  outline: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
  access: 'M12 2c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm9 7h-6v13h-2v-6h-2v6H9V9H3V7h18v2z',
  book: 'M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z',
  count: 'M3 5h18v2H3V5zm0 6h12v2H3v-2zm0 6h18v2H3v-2z',
  mic: 'M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z',
  translate: 'M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z',
  shield: 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z',
};

export const PANEL_CSS = `
.wcsp{--bg:var(--wc-bg,#fff);--fg:var(--wc-fg,#1f1f1f);--dim:var(--wc-dim,#5f6368);--line:var(--wc-line,#e0e3e7);--soft:var(--wc-soft,#f1f4f9);--accent:var(--wc-accent,#0b57d0);--accent-soft:var(--wc-accent-soft,#e8f0fe);--accent-fg:var(--wc-accent-fg,#fff);--shadow:0 2px 6px rgba(60,64,67,.15),0 8px 24px rgba(60,64,67,.12);
position:absolute;top:0;right:0;bottom:0;width:min(360px,100%);z-index:6;display:flex;flex-direction:column;background:var(--bg);color:var(--fg);border-left:1px solid var(--line);box-shadow:var(--shadow);font:14px/1.45 "Google Sans Text","Google Sans",Inter,"Segoe UI",system-ui,sans-serif;animation:wcsp-in .2s cubic-bezier(.2,.8,.2,1)}
.wcsp[data-theme=dark]{--bg:var(--wc-bg,#1e1f20);--fg:var(--wc-fg,#e3e3e3);--dim:var(--wc-dim,#a8abb0);--line:var(--wc-line,#3c4043);--soft:var(--wc-soft,#282a2c);--accent:var(--wc-accent,#a8c7fa);--accent-soft:var(--wc-accent-soft,#0b3a7a);--accent-fg:var(--wc-accent-fg,#062e6f);--shadow:0 2px 6px rgba(0,0,0,.5),0 8px 24px rgba(0,0,0,.45)}
.wcsp-sheet{top:auto;left:0;width:auto;height:min(76%,600px);border-left:0;border-top:1px solid var(--line);border-radius:16px 16px 0 0;animation:wcsp-up .22s cubic-bezier(.2,.8,.2,1)}
.wcsp *{box-sizing:border-box}
.wcsp button,.wcsp select,.wcsp textarea,.wcsp input{font:inherit;color:inherit}
.wcsp-top{display:flex;align-items:center;gap:8px;padding:14px 10px 8px 18px}
.wcsp-top h2{margin:0;font-size:17px;font-weight:500}
.wcsp-top>.wcsp-extra{margin-right:auto}
.wcsp-extra{padding:1px 7px;border-radius:9px;background:linear-gradient(90deg,#e8f0fe,#f3e8fd);color:#5b3fc4;font-size:10.5px;font-weight:600;letter-spacing:.02em}
.wcsp[data-theme=dark] .wcsp-extra{background:#2d2a4a;color:#c9b8ff}
.wcsp-icon{width:32px;height:32px;border:0;border-radius:50%;background:transparent;color:var(--dim);cursor:pointer;display:grid;place-items:center;font-size:15px;flex:none}
.wcsp-icon:hover{background:var(--soft);color:var(--fg)}
.wcsp-btn{height:32px;padding:0 14px;border:1px solid var(--line);border-radius:16px;background:var(--bg);cursor:pointer;font-size:13px;font-weight:500;white-space:nowrap}
.wcsp-btn:hover{background:var(--soft)}
.wcsp-btn:disabled{opacity:.45;cursor:default}
.wcsp .wcsp-primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
.wcsp-small{height:26px;padding:0 10px;font-size:12px}
.wcsp-bar{display:flex;flex-wrap:wrap;gap:6px;padding:4px 14px 10px;border-bottom:1px solid var(--line)}
.wcsp-bar button[aria-pressed],.wcsp-pill{height:28px;padding:0 10px;border:1px solid var(--line);border-radius:14px;background:none;cursor:pointer;font-size:12px}
.wcsp-bar button[aria-pressed=true]{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:500}
.wcsp-bar select{height:28px;border:1px solid var(--line);border-radius:14px;background:var(--bg);padding:0 8px;font-size:12px}
.wcsp-body{flex:1;overflow:auto;padding:12px 14px 16px;display:grid;gap:10px;align-content:start}
.wcsp-card{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--bg)}
.wcsp-card[data-active]{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
.wcsp-card h3{margin:0 0 4px;font-size:13px;font-weight:600}
.wcsp-card p{margin:4px 0}
.wcsp-dim{color:var(--dim);font-size:12px}
.wcsp-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.wcsp-row>.wcsp-grow{flex:1;min-width:0}
.wcsp-empty{color:var(--dim);font-size:13px;text-align:center;margin:24px 8px}
.wcsp-note{margin:0;padding:8px 10px;border-radius:8px;background:var(--soft);color:var(--dim);font-size:12px}
.wcsp-foot{padding:10px 14px;border-top:1px solid var(--line);display:grid;gap:8px}
.wcsp-input{width:100%;min-height:38px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--bg);resize:none;outline:none}
.wcsp-input:focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
.wcsp-chips{display:flex;flex-wrap:wrap;gap:6px}
.wcsp-chip{height:28px;padding:0 10px;border:1px solid var(--line);border-radius:14px;background:var(--soft);cursor:pointer;font-size:12px}
.wcsp-chip:hover{border-color:var(--accent);color:var(--accent)}
.wcsp-cite{display:inline-grid;place-items:center;min-width:20px;height:18px;margin:0 2px;padding:0 5px;border:0;border-radius:9px;background:var(--accent-soft);color:var(--accent);font-size:11px;font-weight:600;cursor:pointer;vertical-align:1px}
.wcsp-cite:hover{background:var(--accent);color:var(--accent-fg)}
.wcsp-msg{white-space:pre-wrap;word-break:break-word}
.wcsp-msg[data-role=user]{justify-self:end;max-width:85%;padding:8px 12px;border-radius:14px 14px 4px 14px;background:var(--accent-soft)}
.wcsp-meter{height:6px;border-radius:3px;background:var(--soft);overflow:hidden}
.wcsp-meter>span{display:block;height:100%;border-radius:3px;background:var(--accent)}
.wcsp-score{display:grid;place-items:center;width:52px;height:52px;border-radius:50%;border:4px solid var(--accent);font-size:16px;font-weight:600;flex:none}
.wcsp-dot{display:inline-block;width:9px;height:9px;border-radius:50%;flex:none}
.wcsp-list{display:grid;gap:2px}
.wcsp-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:8px;background:none;text-align:left;cursor:pointer}
.wcsp-item:hover{background:var(--soft)}
.wcsp-item[draggable=true]{cursor:grab}
.wcsp-item[data-over]{box-shadow:inset 0 2px 0 var(--accent)}
.wcsp-field{display:grid;gap:4px;font-size:12px;color:var(--dim)}
.wcsp-field input,.wcsp-field select{height:32px;padding:0 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font-size:13px}
.wcsp-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.wcsp-dots::after{content:'…';animation:wcsp-blink 1s steps(3,end) infinite}
@keyframes wcsp-blink{50%{opacity:.3}}
@keyframes wcsp-in{from{transform:translateX(16px);opacity:0}to{transform:none;opacity:1}}
@keyframes wcsp-up{from{transform:translateY(24px)}to{transform:none}}
@media (prefers-reduced-motion:reduce){.wcsp,.wcsp *{animation:none!important;transition:none!important}}
`;
