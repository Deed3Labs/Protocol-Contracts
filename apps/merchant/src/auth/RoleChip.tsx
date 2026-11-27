import type { ReactNode } from 'react';
import type { StaffRole } from '@clear/domain';

/**
 * Whose action this is.
 *
 * The refund flow moves authority between two people, and the whole reason that is safe is that
 * nobody has to remember which of them the tablet currently thinks they are. So every screen in it
 * carries one of these, and it is not decoration: it is the answer to "who is about to do this".
 *
 * Accent means an owner is involved — either acting, or being waited on. Muted is the counter.
 */
export function Chip({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'accent' }) {
  return (
    <span
      className={[
        'inline-block whitespace-nowrap rounded-full border-[0.5px] px-2 py-0.5 text-[9.5px] uppercase tracking-[0.5px]',
        tone === 'accent'
          ? 'border-[var(--clear-border-accent)] bg-[var(--clear-bg-accent)] text-[var(--clear-text-accent)]'
          : 'border-[var(--clear-border)] text-[var(--clear-text-muted)]',
      ].join(' ')}
    >
      {children}
    </span>
  );
}

export function RoleChip({ name, role }: { name: string; role: StaffRole }) {
  return (
    <Chip tone={role === 'owner' ? 'accent' : 'muted'}>
      {name} · {role === 'owner' ? 'owner' : 'counter'}
    </Chip>
  );
}
