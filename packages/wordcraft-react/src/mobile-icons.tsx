/**
 * Line icons for the mobile layout, drawn for this package on a 24-point grid (no Microsoft
 * iconography: Word's own icons are Microsoft's). Each is a list of SVG path strings stroked in
 * the current colour; a few letters (B, I, U) are set as type instead.
 */
import type { CSSProperties } from 'react';

const P: Record<string, string[]> = {
  undo: ['M9 5 4 10l5 5', 'M4 10h10a5 5 0 0 1 0 10h-3'],
  redo: ['M15 5l5 5-5 5', 'M20 10H10a5 5 0 0 0 0 10h3'],
  search: ['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z', 'M15.5 15.5 20 20'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  back: ['M15 5l-7 7 7 7'],
  forward: ['M9 5l7 7-7 7'],
  down: ['M6 9l6 6 6-6'],
  up: ['M6 15l6-6 6 6'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  palette: ['M4 19 9.5 5h1L16 19', 'M6.2 14h7.6', 'M15 19l5-5 1.5 1.5-5 5H15v-1.5Z'],
  edit: ['M4 20h4L19 9l-4-4L4 16v4Z', 'M13.5 6.5l4 4'],
  bullets: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4.5 6h.01', 'M4.5 12h.01', 'M4.5 18h.01'],
  numbering: ['M10 6h10', 'M10 12h10', 'M10 18h10', 'M4 5l1.5-1v5', 'M3.5 13.5c0-1 .8-1.5 1.5-1.5s1.5.5 1.5 1.3c0 1.2-3 2.2-3 3.7h3'],
  indent: ['M4 5h16', 'M11 10h9', 'M11 14h9', 'M4 19h16', 'M4 9l3 3-3 3'],
  outdent: ['M4 5h16', 'M11 10h9', 'M11 14h9', 'M4 19h16', 'M7 9l-3 3 3 3'],
  alignLeft: ['M4 6h16', 'M4 10h10', 'M4 14h16', 'M4 18h10'],
  alignCenter: ['M4 6h16', 'M7 10h10', 'M4 14h16', 'M7 18h10'],
  alignRight: ['M4 6h16', 'M10 10h10', 'M4 14h16', 'M10 18h10'],
  justify: ['M4 6h16', 'M4 10h16', 'M4 14h16', 'M4 18h16'],
  highlight: ['M9 14 15.5 4.5 19.5 8.5 10 15l-2.5.5L9 14Z', 'M8 16l-3 3h5'],
  fontColor: ['M6 16 11.5 4h1L18 16', 'M8 12h8'],
  paragraph: ['M10 4v16', 'M15 4v16', 'M18 4h-8a4 4 0 0 0 0 8h0'],
  styles: ['M3.5 18 8 6h1l4.5 12', 'M5 14h7', 'M15 13.5a3 3 0 1 1 6 0V18', 'M21 15.5c-1-.8-6-.8-6 1.2s3.5 1.8 6 0'],
  clear: ['M6 5h12', 'M12 5 9 19', 'M14 14l6 6', 'M20 14l-6 6'],
  table: ['M4 5h16v14H4Z', 'M4 10h16', 'M4 14.5h16', 'M10 5v14', 'M15 5v14'],
  picture: ['M4 5h16v14H4Z', 'M4 16l5-5 4 4 2-2 5 5', 'M15.5 9.5h.01'],
  camera: ['M4 8h3.5L9 5.5h6L16.5 8H20v11H4Z', 'M12 10a3.2 3.2 0 1 0 0 6.4A3.2 3.2 0 0 0 12 10Z'],
  shapes: ['M4 11h8v9H4Z', 'M16.5 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'M15 15l5 5'],
  textBox: ['M4 5h16v14H4Z', 'M8 9h8', 'M12 9v7'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  comment: ['M4 5h16v11H11l-5 4v-4H4Z', 'M8 9h8', 'M8 12.5h5'],
  header: ['M5 3h14v18H5Z', 'M8 7h8'],
  footer: ['M5 3h14v18H5Z', 'M8 17h8'],
  pageNumber: ['M5 3h14v18H5Z', 'M11 15.5l1-1v4', 'M10.5 18.5h3'],
  footnote: ['M4 7h10', 'M4 11h10', 'M4 15h7', 'M17 4l1.5-1v5', 'M4 20h16'],
  symbol: ['M5 19h4.5v-1.5a6.5 6.5 0 1 1 5 0V19H19'],
  pageBreak: ['M5 3v6h14V3', 'M5 21v-6h14v6', 'M3 12h3', 'M9 12h2', 'M13 12h2', 'M18 12h3'],
  pen: ['M5 19l2-6 9-9 3 3-9 9-5 3Z', 'M14 6l3 3'],
  pencil: ['M4 20l1-5L16 4l4 4L9 19l-5 1Z', 'M14 6l4 4', 'M5 15l4 4'],
  marker: ['M8 15 16 4l4 4-9 10H8v-3Z', 'M4 20h9'],
  eraser: ['M8 20h12', 'M4.5 15.5 14 6l5 5-7.5 7.5H8Z', 'M9.5 11 14 15.5'],
  lasso: ['M12 5c-4.4 0-8 2-8 5s3.6 5 8 5 8-2 8-5-3.6-5-8-5Z', 'M8 14c-1 1.5-1 3 .5 4s3-.5 3 1.5'],
  stopDraw: ['M6 4l12 8-12 8Z'],
  margins: ['M5 3h14v18H5Z', 'M8.5 3v18', 'M15.5 3v18', 'M5 6.5h14', 'M5 17.5h14'],
  orientation: ['M4 7h11v14H4Z', 'M10 3h10v8', 'M17 1l3 2-3 2'],
  pageSize: ['M6 3h9l4 4v14H6Z', 'M15 3v4h4'],
  columns: ['M4 4h7v16H4Z', 'M13 4h7v16h-7Z'],
  breaks: ['M6 3v5h12V3', 'M6 21v-5h12v5', 'M3 12h18'],
  spelling: ['M3 15 6 6h1l3 9', 'M4 12h5', 'M13 15V6h3a2 2 0 0 1 0 4.5h-3', 'M13 10.5h3.5a2.3 2.3 0 0 1 0 4.5H13', 'M14 19l2.5 2.5L21 17'],
  wordCount: ['M4 6h16', 'M4 10h16', 'M4 14h9', 'M16 15l1.5-1v6', 'M15.5 20.5h3.5'],
  track: ['M4 20h4L19 9l-4-4L4 16v4Z', 'M3 23h18'],
  markup: ['M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'],
  accept: ['M5 12.5l4.5 4.5L19 7.5'],
  reject: ['M6 6l12 12', 'M18 6 6 18'],
  prev: ['M12 19V5', 'M6 11l6-6 6 6'],
  next: ['M12 5v14', 'M6 13l6 6 6-6'],
  mobile: ['M7 2h10v20H7Z', 'M11 18.5h2'],
  print: ['M7 9V3h10v6', 'M5 9h14v8h-2', 'M7 17H5', 'M7 14h10v7H7Z'],
  zoom: ['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z', 'M15.5 15.5 20 20', 'M8 10.5h5', 'M10.5 8v5'],
  navigation: ['M4 5h4', 'M4 12h4', 'M4 19h4', 'M11 5h9', 'M13 12h7', 'M13 19h7'],
  readAloud: ['M4 9h4l5-4v14l-5-4H4Z', 'M16 9a4 4 0 0 1 0 6', 'M18.5 6.5a7.5 7.5 0 0 1 0 11'],
  moon: ['M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z'],
  mic: ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z', 'M5.5 11a6.5 6.5 0 0 0 13 0', 'M12 17.5V21'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  merge: ['M4 5h16v14H4Z', 'M12 5v4', 'M12 15v4', 'M8 12h8', 'M14 10l2 2-2 2', 'M10 10l-2 2 2 2'],
  rowAbove: ['M4 11h16v9H4Z', 'M12 3v6', 'M9 6h6'],
  rowBelow: ['M4 4h16v9H4Z', 'M12 15v6', 'M9 18h6'],
  colLeft: ['M11 4h9v16h-9Z', 'M3 12h6', 'M6 9v6'],
  colRight: ['M4 4h9v16H4Z', 'M15 12h6', 'M18 9v6'],
  autofit: ['M4 5h16v14H4Z', 'M8 12h8', 'M10 10l-2 2 2 2', 'M14 10l2 2-2 2'],
  wrap: ['M4 6h16', 'M4 18h16', 'M4 10h5v4H4Z', 'M12 11h8', 'M12 14h8'],
  rotate: ['M19 12a7 7 0 1 1-2-4.9', 'M19 3v5h-5'],
  crop: ['M7 3v14h14', 'M3 7h14v14'],
  altText: ['M4 5h16v14H4Z', 'M7 15l2.5-6h1L13 15', 'M7.8 13h4.4', 'M15 9v6'],
  reset: ['M5 12a7 7 0 1 0 2-4.9', 'M5 3v5h5'],
  fill: ['M5 11 11 5l7 7-6 6Z', 'M3 21h18', 'M19 14s2 2.3 2 3.5a2 2 0 0 1-4 0c0-1.2 2-3.5 2-3.5Z'],
  outline: ['M5 5h14v14H5Z'],
  effects: ['M12 3v4', 'M12 17v4', 'M3 12h4', 'M17 12h4', 'M6 6l2.5 2.5', 'M15.5 15.5 18 18', 'M18 6l-2.5 2.5', 'M8.5 15.5 6 18'],
  share: ['M12 15V3', 'M7 8l5-5 5 5', 'M5 13v8h14v-8'],
  save: ['M5 3h11l3 3v15H5Z', 'M8 3v5h7V3', 'M8 14h8v7H8Z'],
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M5 20h14'],
  history: ['M4 12a8 8 0 1 0 2.3-5.7', 'M4 4v4h4', 'M12 8v4l3 2'],
  sparkle: ['M12 3c.6 4.5 2.5 6.4 7 7-4.5.6-6.4 2.5-7 7-.6-4.5-2.5-6.4-7-7 4.5-.6 6.4-2.5 7-7Z'],
  replace: ['M4 8h12', 'M13 5l3 3-3 3', 'M20 16H8', 'M11 13l-3 3 3 3'],
  sun: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'M12 2v2', 'M12 20v2', 'M2 12h2', 'M20 12h2', 'M5 5l1.4 1.4', 'M17.6 17.6 19 19', 'M19 5l-1.4 1.4', 'M6.4 17.6 5 19'],
  selectAll: ['M4 4h3', 'M10 4h4', 'M17 4h3v3', 'M20 10v4', 'M20 17v3h-3', 'M14 20h-4', 'M7 20H4v-3', 'M4 14v-4', 'M8 9h8v6H8Z'],
  cut: ['M6 6a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z', 'M6 13a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z', 'M8.2 9.8 20 18', 'M8.2 14.2 20 6'],
  copy: ['M8 8h12v12H8Z', 'M16 8V4H4v12h4'],
  paste: ['M8 4H5v17h14V4h-3', 'M8 2h8v4H8Z'],
};

export type IconName = keyof typeof P | 'bold' | 'italic' | 'underline' | 'strike' | 'subscript' | 'superscript';

const LETTERS: Partial<Record<IconName, { text: string; style: CSSProperties; sub?: string; sup?: string }>> = {
  bold: { text: 'B', style: { fontWeight: 800 } },
  italic: { text: 'I', style: { fontStyle: 'italic', fontFamily: 'Georgia, serif', fontWeight: 600 } },
  underline: { text: 'U', style: { textDecoration: 'underline', textUnderlineOffset: 3, fontWeight: 600 } },
  strike: { text: 'ab', style: { textDecoration: 'line-through', fontWeight: 600, fontSize: 16 } },
  subscript: { text: 'x', sub: '2', style: { fontWeight: 600 } },
  superscript: { text: 'x', sup: '2', style: { fontWeight: 600 } },
};

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  const letter = LETTERS[name];
  if (letter) {
    return (
      <span className="wcm-glyph" aria-hidden="true" style={{ width: size, height: size, ...letter.style }}>
        {letter.text}
        {letter.sub && <sub>{letter.sub}</sub>}
        {letter.sup && <sup>{letter.sup}</sup>}
      </span>
    );
  }
  const paths = P[name as keyof typeof P] ?? [];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
