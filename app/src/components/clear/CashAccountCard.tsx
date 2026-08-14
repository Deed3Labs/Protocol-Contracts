import { Button } from '@/components/ui/button';
import Card from './Card';
import { money } from '@/lib/money';
import type { CashAccount } from '@/lib/clearModel';

/** Cash account — design spec §4. Cash spends first, so this leads the right column. */
export default function CashAccountCard({
  account,
  onDetails,
}: {
  account: CashAccount;
  onDetails?: () => void;
}) {
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-foreground-secondary">Cash account</span>
        <span className="text-[17px] font-medium tabular-nums">{money(account.balance)}</span>
      </div>

      {account.nextDepositOn && (
        <p className="mb-2 mt-1 text-xs text-muted-foreground">
          Next deposit {account.nextDepositOn} · ~{money(account.nextDepositEstimate)} est.
        </p>
      )}

      {account.directDepositActive && (
        <div className="flex items-center justify-between gap-3 border-t-[0.5px] border-border pt-2">
          <span className="text-[11px] text-tier-savings-fg">Direct deposit active</span>
          <Button variant="clear" size="xs" onClick={onDetails}>
            Details
          </Button>
        </div>
      )}
    </Card>
  );
}
