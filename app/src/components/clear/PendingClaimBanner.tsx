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
    <div className="flex items-center justify-between gap-3 rounded-lg bg-tier-boost/10 px-3.5 py-2.5 text-tier-boost-fg">
      <div className="min-w-0">
        <p className="text-[13px]">
          {money(claim.amount)} waiting for {claim.recipient} to claim
        </p>
        <p className="mt-0.5 text-[11px] opacity-80">
          Sent {claim.sentOn} · expires in {claim.expiresInDays} days
        </p>
      </div>
      <Button variant="clear" size="xs" className="border-tier-boost/30" onClick={onRemind}>
        Remind
      </Button>
    </div>
  );
}
