import { Button } from '@/components/ui/button';
import { money } from '@/lib/money';
import type { PendingClaim } from '@/lib/clearModel';

/**
 * Pending claim — design spec §8. Shown when money has been sent to someone who
 * isn't a member yet, so it's left the balance but nobody has it.
 *
 * Takes the accent background rather than a warning color: it's waiting, not
 * wrong. The expiry is the part that needs acting on, hence Remind.
 */
export default function PendingClaimBanner({
  claim,
  onRemind,
}: {
  claim: PendingClaim;
  onRemind?: () => void;
}) {
  return (
    <div className="rounded-lg bg-tier-boost/10 px-3 py-2.5 text-tier-boost-fg lg:flex lg:items-center lg:justify-between lg:gap-3 lg:px-3.5">
      <div className="min-w-0">
        <p className="text-xs lg:text-[13px]">
          {money(claim.amount)} waiting for {claim.recipient}
          <span className="hidden lg:inline"> to claim</span>
        </p>
        {/* Mobile folds the reminder into the line — a separate button costs a row
            that the expiry copy needs more. */}
        <p className="mt-0.5 text-[11px] opacity-80">
          <span className="hidden lg:inline">Sent {claim.sentOn} · expires</span>
          <span className="lg:hidden">Expires</span> in {claim.expiresInDays} days
          <span aria-hidden className="lg:hidden">
            {' · '}
          </span>
          <button type="button" onClick={onRemind} className="underline lg:hidden">
            Remind
          </button>
        </p>
      </div>
      <Button
        variant="clear"
        size="xs"
        className="hidden border-tier-boost/30 lg:inline-flex"
        onClick={onRemind}
      >
        Remind
      </Button>
    </div>
  );
}
