import { NavLink } from 'react-router-dom';
import { ClearMark } from '@/components/clear/brand/icons';
import { cn } from '@/lib/utils';

/**
 * The lockup — mark, then the wordmark in Bricolage — as one link home.
 *
 * Shared by the desktop bar and the mobile header so the two can't drift. `sm` is the phone size
 * the guide draws (18px mark, 17px word) against the desktop's 20 and 19.
 */
export default function Wordmark({
  sm,
  className,
  /** Signing in has nowhere to go home to, so there the lockup is just the lockup. */
  plain,
}: {
  sm?: boolean;
  className?: string;
  plain?: boolean;
}) {
  const inside = (
    <>
      <ClearMark className="c-mk" />
      <span className="c-wm">Clear</span>
    </>
  );
  const cls = cn('c-lockup', sm && 'c-sm', className);
  if (plain) return <span className={cls}>{inside}</span>;
  return (
    <NavLink to="/" aria-label="Clear, home" className={cls}>
      {inside}
    </NavLink>
  );
}
