import { ClearMark } from './icons';
import { cn } from '../cn';

/**
 * The lockup, mark then the wordmark in Bricolage, unlinked: what a screen that has nowhere to go
 * home to shows (signing in, onboarding). The Clear app's own Wordmark wraps the same markup in a
 * link home.
 */
export default function Lockup({ sm, className }: { sm?: boolean; className?: string }) {
  return (
    <span className={cn('c-lockup', sm && 'c-sm', className)}>
      <ClearMark className="c-mk" />
      <span className="c-wm">Clear</span>
    </span>
  );
}
