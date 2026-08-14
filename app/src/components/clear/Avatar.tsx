import { cn } from '@/lib/utils';

/**
 * Avatar tints vary per person, not per role — the reference gives two members
 * different colors, so the tint is identity, not meaning. Picked deterministically
 * from the id so someone keeps the same color everywhere they appear.
 */
const AVATAR_TINTS = [
  'bg-tier-boost/10 text-tier-boost-fg',
  'bg-tier-savings/10 text-tier-savings-fg',
  'bg-secondary text-foreground-secondary',
];

export function tintFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}

export default function Avatar({
  id,
  initials,
  className,
}: {
  /** Whatever identifies this person or business — the tint is derived from it. */
  id: string;
  initials: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px]',
        tintFor(id),
        className,
      )}
    >
      {initials}
    </span>
  );
}
