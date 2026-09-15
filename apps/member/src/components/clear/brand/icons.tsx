import type { SVGProps } from 'react';

/*
 * The brand guide's own icons, transcribed path for path from the reference files.
 *
 * Not lucide: several of these differ from lucide's glyph of the same name (the savings mark is a
 * dollar, the card has square corners, activity is a pulse), and the reference's stroke weights are
 * part of the drawing — the active nav item is 1.9, everything else 1.75.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number };

function base(size: number, strokeWidth: number, props: SVGProps<SVGSVGElement>) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  };
}

/** The Clear mark. Drawn as given — never cut, rotated or redrawn. */
export function ClearMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 336 336" aria-hidden {...props}>
      <g transform="translate(168 168)" fill="none" stroke="currentColor">
        <path d="M 148.28 -64 A 161.5 161.5 0 1 0 148.28 64 L 74.22 64 A 98 98 0 1 1 74.22 -64 Z" strokeWidth="4" fill="currentColor" />
        <path d="M 0 -8 H 114 V 8 H 0 Z" fill="currentColor" stroke="none" />
        <circle cx="0" cy="0" r="34" fill="currentColor" stroke="none" />
        <circle cx="131.5" cy="0" r="25.25" strokeWidth="15.5" />
      </g>
    </svg>
  );
}

export function BellIcon({ size = 18, strokeWidth = 1.75, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

export function HomeIcon({ size = 20, strokeWidth = 1.75, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

export function SavingsIcon({ size = 20, strokeWidth = 1.75, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <path d="M12 2v20" />
      <path d="M17 6.5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

export function EarnIcon({ size = 20, strokeWidth = 1.75, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <path d="m4 16 5-6 4 4 7-8" />
      <path d="M15 6h5v5" />
    </svg>
  );
}

export function ActivityIcon({ size = 20, strokeWidth = 1.75, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </svg>
  );
}

export function CardIcon({ size = 20, strokeWidth = 1.75, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <rect x="2" y="5" width="20" height="14" rx="0" />
      <path d="M2 10h20" />
    </svg>
  );
}

export function PlusIcon({ size = 21, strokeWidth = 2, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function CloseIcon({ size = 17, strokeWidth = 1.9, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/** The small chevron the guide uses for "there is more behind this". */
export function ChevronIcon({ size = 10, strokeWidth = 2.4, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function EyeIcon({ size = 14, strokeWidth = 1.75, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function CopyIcon({ size = 14, strokeWidth = 1.75, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <rect x="9" y="9" width="12" height="12" rx="0" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function UserIcon({ size = 17, strokeWidth = 1.75, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

export function ShieldIcon({ size = 17, strokeWidth = 1.75, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
    </svg>
  );
}

export function HelpIcon({ size = 17, strokeWidth = 1.75, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function SignOutIcon({ size = 17, strokeWidth = 1.75, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </svg>
  );
}

/** The route's two-way swap: sits on the seam between the legs. */
export function SwapIcon({ size = 13, strokeWidth = 2, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <path d="M4 7h16M20 7l-3-3M20 17H4M4 17l3 3" />
    </svg>
  );
}

/** One way only — a bond cannot go back to cash before maturity. */
export function ArrowIcon({ size = 14, strokeWidth = 2.2, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <path d="M4 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

/** The keypad's delete key, drawn rather than a Unicode glyph. */
export function BackspaceIcon({ size = 19, strokeWidth = 1.8, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <path d="M20 5H9l-6 7 6 7h11a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z" />
      <path d="m16 9-5 6M11 9l5 6" />
    </svg>
  );
}

/** The tick, without a circle. */
export function TickIcon({ size = 13, strokeWidth = 3, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** The failure mark — deliberately not a red cross: the member's money is still theirs. */
export function AlertIcon({ size = 30, strokeWidth = 2, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <path d="M12 8v5M12 16.5v.01" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

/** Protection that is on. */
export function ShieldCheckIcon({ size = 15, strokeWidth = 1.75, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

/** Protection not yet unlocked. Square-cornered body, like every drawn shape. */
export function LockIcon({ size = 15, strokeWidth = 1.75, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <rect x="3" y="11" width="18" height="11" rx="0" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/** A pane's way back. */
export function BackIcon({ size = 17, strokeWidth = 1.9, ...props }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, props)}>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}
