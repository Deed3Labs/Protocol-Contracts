import { useId, useMemo } from 'react';
import { getSvgPath } from 'figma-squircle';
import type { ActivityRow } from '@/lib/clearModel';

/*
 * One avatar, used by every transaction list.
 *
 * Its own component because two lists render transactions — TransactionRows on Home and Card,
 * ActivityList on Activity — and a copy in each is how they drift. That is not hypothetical in this
 * codebase: three copies of the notification state is what made marking one read appear not to
 * work.
 */

/*
 * Initials from a merchant name.
 *
 * Two letters where the name has two words, one where it has one. Not three: at 32px a third
 * letter is smaller than it is legible, and every avatar starts looking the same.
 */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * The tint for a row's avatar.
 *
 * Category first, which only card spending has — a merchant category code comes from the network
 * and nothing else carries one.
 *
 * Otherwise the tier that funded it, which every row does have. Both are real answers to "what kind
 * of row is this", so the colour means something either way; falling straight to a neutral would
 * have made every list outside the Card page a column of identical grey circles, which is the
 * scannability the avatars exist for, thrown away.
 *
 * Never a colour derived from the merchant's name. A stable hash of a string looks like meaning and
 * has none, and two shops would end up the same colour for no reason a member could ever learn.
 */
function avatarColor(row: ActivityRow): string {
  if (row.category) return `rgb(var(--cat-${row.category}))`;
  if (row.paidFromTier) return `rgb(var(--tier-${row.paidFromTier}))`;
  if (row.source === 'cash' || row.source === 'cash account') return 'rgb(var(--tier-cash))';
  if (row.source === 'savings') return 'rgb(var(--tier-savings))';
  if (row.source === 'credit') return 'rgb(var(--tier-boost))';
  return 'rgb(var(--cat-other))';
}

/**
 * A tinted initials avatar for a transaction row.
 *
 * A real squircle, not a circle and not `rounded-lg`. `border-radius` draws four quarter-circles
 * that meet the straight edges at a curvature break; `figma-squircle` generates the same path
 * Figma's corner smoothing does, which is the construction the app mark already uses. Using it here
 * means a row's avatar and the mark in the header are the same shape rather than two things that
 * are nearly the same shape, which is the kind of difference nobody names and everybody feels.
 */
const SIZE = 32;
const RADIUS_RATIO = 0.2237; // Apple's icon proportions, as in the wordmark.
const SMOOTHING = 0.6;

export default function TransactionAvatar({ row, className }: { row: ActivityRow; className?: string }) {
  const clipId = useId();
  const path = useMemo(
    () =>
      getSvgPath({
        width: SIZE,
        height: SIZE,
        cornerRadius: SIZE * RADIUS_RATIO,
        cornerSmoothing: SMOOTHING,
        preserveSmoothing: true,
      }),
    [],
  );

  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={`shrink-0 ${className ?? ''}`}
      aria-hidden
      focusable="false"
    >
      <defs>
        <clipPath id={clipId}>
          <path d={path} />
        </clipPath>
      </defs>
      <rect width={SIZE} height={SIZE} fill={avatarColor(row)} clipPath={`url(#${clipId})`} />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#FBFAF7"
        fontSize="11"
        fontWeight="500"
        fontFamily="inherit"
      >
        {initialsOf(row.name)}
      </text>
    </svg>
  );
}
