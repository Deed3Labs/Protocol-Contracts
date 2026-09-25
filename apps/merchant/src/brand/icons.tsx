import type { ReactNode } from 'react';

/**
 * The reference's icons, drawn exactly as the reference draws them.
 *
 * Each one keeps its own size and stroke from docs/merchant-reference/ rather than coming from an
 * icon set, because the reference varies them on purpose: nav icons are 20px at 1.8, the lock in
 * the nav is 11px at 2.2, sign-in's large icons are 22px at 1.6. A single library icon at a single
 * weight would flatten that.
 */

interface Props {
  size: number;
  stroke: number;
  children: ReactNode;
  /** Most icons round their joins; a few (plus, close) are drawn with round caps only. */
  joins?: boolean;
}

function Svg({ size, stroke, children, joins = true }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin={joins ? 'round' : undefined}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** The Clear mark. Never redrawn, rotated or cut — it is used exactly as the brand ships it. */
export function ClearMark() {
  return (
    <svg className="c-mk" viewBox="0 0 336 336" aria-hidden="true">
      <g transform="translate(168 168)" fill="none" stroke="currentColor">
        <path
          d="M 148.28 -64 A 161.5 161.5 0 1 0 148.28 64 L 74.22 64 A 98 98 0 1 1 74.22 -64 Z"
          strokeWidth="4"
          fill="currentColor"
        />
        <path d="M 0 -8 H 114 V 8 H 0 Z" fill="currentColor" stroke="none" />
        <circle cx="0" cy="0" r="34" fill="currentColor" stroke="none" />
        <circle cx="131.5" cy="0" r="25.25" strokeWidth="15.5" />
      </g>
    </svg>
  );
}

// ---- Navigation -------------------------------------------------------------------------------

export const IconHome = () => (
  <Svg size={20} stroke={1.8}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </Svg>
);
export const IconCharges = () => (
  <Svg size={20} stroke={1.8}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
    <path d="M9 8h6M9 12h6" />
  </Svg>
);
export const IconInventory = () => (
  <Svg size={20} stroke={1.8}>
    <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" />
    <path d="M3 7.5 12 12l9-4.5M12 12v9" />
  </Svg>
);
export const IconPayouts = () => (
  <Svg size={20} stroke={1.8}>
    <path d="M3 21h18" />
    <path d="M5 10h14" />
    <path d="M12 3 4 7h16z" />
    <path d="M7 10v8M12 10v8M17 10v8" />
  </Svg>
);
export const IconStaff = () => (
  <Svg size={20} stroke={1.8}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
    <path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.8c1.9.6 3 2.4 3 4.7" />
  </Svg>
);
export const IconOverview = () => (
  <Svg size={20} stroke={1.8}>
    <path d="M4 20V11M10 20V5M16 20v-6M22 20H2" />
  </Svg>
);
/** The padlock beside Payouts and Overview on a counter shift. */
export const IconLock = () => (
  <Svg size={11} stroke={2.2}>
    <rect x="5" y="11" width="14" height="10" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Svg>
);
/** The phone's action button. */
export const IconPlus = () => (
  <Svg size={21} stroke={2} joins={false}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

// ---- Sheets -----------------------------------------------------------------------------------

/** A sheet's close, as Home's sheets draw it. */
export const IconClose = () => (
  <Svg size={17} stroke={1.9} joins={false}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);
/** The same close, at sign-in's size. */
export const IconCloseLg = () => (
  <Svg size={18} stroke={1.9}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
/** The chevron at the end of a row that opens something. Drawn in ink-50, as the reference has it. */
export const IconChevron = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="var(--ink-50)"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ flexShrink: 0 }}
  >
    <path d="m9 18 6-6-6-6" />
  </svg>
);
/** The same chevron in the current colour, for the + sheet's options. */
export const IconChevronInk = () => (
  <Svg size={14} stroke={2}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
);
export const IconAmount = () => (
  <Svg size={20} stroke={1.6}>
    <rect x="4" y="3" width="16" height="18" rx="1" />
    <path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01" />
  </Svg>
);
export const IconCart = ({ size = 20 }: { size?: 16 | 20 }) => (
  <Svg size={size} stroke={size === 16 ? 1.8 : 1.6}>
    <path d="M3 4h2l2.2 10.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 7H6.2" />
    <circle cx="9" cy="19.5" r="1.3" />
    <circle cx="17" cy="19.5" r="1.3" />
  </Svg>
);

// ---- Signing in -------------------------------------------------------------------------------

export const IconTablet = () => (
  <Svg size={22} stroke={1.6}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M11 18h2" />
  </Svg>
);
/** Backspace, on the PIN pad. */
export const IconDelete = () => (
  <Svg size={20} stroke={1.8}>
    <path d="M20 5H9l-6 7 6 7h11a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z" />
    <path d="m16 9-5 6M11 9l5 6" />
  </Svg>
);
export const IconMail = () => (
  <Svg size={18} stroke={1.7}>
    <rect x="3" y="5" width="18" height="14" rx="1" />
    <path d="m3 7 9 6 9-6" />
  </Svg>
);
export const IconPasskey = () => (
  <Svg size={18} stroke={1.7}>
    <path d="M12 11a3 3 0 1 0-3-3" />
    <path d="M6 20v-2a6 6 0 0 1 9.5-4.9" />
    <path d="M18 14v6M15 17h6" />
  </Svg>
);
/** The key on the owner's signed-in chip. */
export const IconKey = () => (
  <Svg size={13} stroke={1.9}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 9-9M17 6l3 3M15 8l2 2" />
  </Svg>
);
/** Back, in a flow header opened from inside a section. */
export const IconBack = () => (
  <Svg size={18} stroke={1.9}>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </Svg>
);
