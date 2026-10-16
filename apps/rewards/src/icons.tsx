import type { SVGProps } from 'react';

/** The spec's icons, as drawn (24-unit strokes; the Clear mark at 336). */
type P = SVGProps<SVGSVGElement>;
const stroke = (w: number, sw = 1.8) => ({ width: w, height: w, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: sw, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true });

export const ClearMark = (p: P & { size?: number }) => (
  <svg className="mk" width={p.size} height={p.size} viewBox="0 0 336 336" aria-hidden="true" {...p}>
    <g transform="translate(168 168)" fill="none" stroke="currentColor">
      <path d="M 148.28 -64 A 161.5 161.5 0 1 0 148.28 64 L 74.22 64 A 98 98 0 1 1 74.22 -64 Z" strokeWidth="4" fill="currentColor" />
      <path d="M 0 -8 H 114 V 8 H 0 Z" fill="currentColor" stroke="none" />
      <circle cx="0" cy="0" r="34" fill="currentColor" stroke="none" />
      <circle cx="131.5" cy="0" r="25.25" strokeWidth="15.5" />
    </g>
  </svg>
);
export const ChevronSm = () => <svg {...stroke(12, 2)}><path d="m9 18 6-6-6-6" /></svg>;
export const Chevron = () => <svg {...stroke(14, 2)}><path d="m9 18 6-6-6-6" /></svg>;
export const Back = () => <svg {...stroke(18)}><path d="m15 18-6-6 6-6" /></svg>;
export const Close = () => <svg {...stroke(18)}><path d="M18 6 6 18M6 6l12 12" /></svg>;
export const Caret = () => <svg {...stroke(14, 2)}><path d="m7 10 5 5 5-5" /></svg>;
export const Tick = () => <svg {...stroke(16, 2.2)}><path d="m5 12 5 5 9-10" /></svg>;
export const Done = () => <svg {...stroke(26, 2.2)}><path d="m5 12 5 5 9-10" /></svg>;
export const HomeIcon = () => (
  <svg {...stroke(20)}>
    <path d="M3 11 12 4l9 7" />
    <path d="M5 10v10h14V10" />
  </svg>
);
export const GiftIcon = () => (
  <svg {...stroke(20)}>
    <rect x="4" y="9" width="16" height="11" />
    <path d="M12 9v11M3 9h18M12 9C9 9 7 4 9.5 4S12 9 12 9Zm0 0c3 0 5-5 2.5-5S12 9 12 9Z" />
  </svg>
);
export const ScanIcon = () => (
  <svg {...stroke(20)}>
    <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" />
    <path d="M8 12h8" />
  </svg>
);
export const PersonIcon = () => (
  <svg {...stroke(20)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
  </svg>
);
