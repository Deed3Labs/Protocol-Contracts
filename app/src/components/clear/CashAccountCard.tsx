import { Button } from '@/components/ui/button';
import Card from './Card';
import { money } from '@/lib/money';
import { cashTotal, hasUnspendableCash, type CashAccount } from '@/lib/clearModel';

/**
 * Cash account — design spec §4. Cash spends first, so this leads the right column.
 *
 * The balance has two parts and the card says so. Spendable fiat settles the card; USDC on the
 * member's smart wallet is equally theirs but cannot settle an authorization, so it is shown
 * inside the balance and named as unspendable rather than quietly folded in. A member looking at a
 * number that includes money their card will refuse has been told something false.
 */
export default function CashAccountCard({
  account,
  onDetails,
  onAllocate,
}: {
  account: CashAccount;
  onDetails?: () => void;
  /** Opens the choice of where the on-chain part goes — Savings or an Earn product. */
  onAllocate?: () => void;
}) {
  const unspendable = hasUnspendableCash(account);

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-foreground-secondary">Cash account</span>
        <span className="text-[17px] font-medium tabular-nums">{money(cashTotal(account))}</span>
      </div>

      {unspendable && (
        <div className="mt-2 border-t-[0.5px] border-border pt-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-foreground-secondary">Spendable</span>
            <span className="text-xs tabular-nums">{money(account.spendable)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted-foreground">Not spendable yet</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {money(account.onChain)}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              Move it to Savings or Earn to put it to work.
            </p>
            {onAllocate && (
              <Button variant="clear" size="xs" onClick={onAllocate}>
                Move
              </Button>
            )}
          </div>
        </div>
      )}

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
