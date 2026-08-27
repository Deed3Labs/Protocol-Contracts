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

/** A tinted initials avatar for a transaction row. */
export default function TransactionAvatar({ row, className }: { row: ActivityRow; className?: string }) {
  return (
    <span
      aria-hidden
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-medium text-white ${className ?? ''}`}
      style={{ background: avatarColor(row) }}
    >
      {initialsOf(row.name)}
    </span>
  );
}
