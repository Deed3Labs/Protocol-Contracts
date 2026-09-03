import type { StaffRole } from '@clear/domain';

/**
 * Whose action this is, on every screen.
 *
 * The refund flow moves authority between two people, and the whole reason it is safe is that
 * nobody has to remember which of them the tablet currently thinks they are. So the chip is not
 * decoration and not optional: it is the answer to "who is about to do this".
 */
export function RoleChip({ name, role }: { name: string; role: StaffRole }) {
  const label = role === 'owner' ? 'owner' : 'counter';
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px]',
        role === 'owner'
          ? 'border-[var(--clear-border-accent)] bg-[var(--clear-bg-accent)] text-[var(--clear-text-accent)]'
          : 'border-[var(--clear-border)] bg-[var(--clear-surface-2)] text-[var(--clear-text-secondary)]',
      ].join(' ')}
    >
      <span className="font-medium">{name}</span>
      <span aria-hidden>·</span>
      <span>{label}</span>
    </span>
  );
}
