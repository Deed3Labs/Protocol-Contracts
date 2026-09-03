import { Button } from '@/components/ui/button';
import Card, { CardRule } from './Card';
import { money } from '@clear/domain';
import { hasUnspendableCash, type CashAccount } from '@/lib/clearModel';

/**
 * Cash account — design spec §4, two states.
 *
 * Spendable leads, because it is the number that answers "what can I do right now": fiat in the
 * bank account, for the card and payments. There is no combined total anywhere on this card. A
 * single figure spanning both halves would be the one number a member cannot act on — part of it
 * settles a card and part of it categorically cannot.
 *
 * Ready to allocate is money moved on-chain and not yet placed. It can go to Savings or Earn and
 * never to the card, and it should normally read $0.00 — so it renders dimmed and inert in the
 * normal state, and grows its destinations only when something is parked there. The exception
 * looks like an exception.
 *
 * Both halves share one layout — title and amount, then a caption row, divided by a hairline. The
 * amount is smaller here than Spendable's because this is the half a member cannot spend, and the
 * hierarchy should say which number answers "what can I do right now".
 */
export default function CashAccountCard({
  account,
  onDetails,
  onAllocateSavings,
  onAllocateEarn,
  onBackToCash,
}: {
  account: CashAccount;
  onDetails?: () => void;
  onAllocateSavings?: () => void;
  onAllocateEarn?: () => void;
  /** Send it back to spendable fiat — the way out for a member who changed their mind. */
  onBackToCash?: () => void;
}) {
  const parked = hasUnspendableCash(account);

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-foreground-secondary">Spendable</span>
        {/* Same size as Clear credit's and Term plans' headline values — three cards now stack in
            this column, and a taller figure here would rank Spendable above them for no reason. */}
        <span className="text-[17px] font-medium tabular-nums">
          {money(account.spendable, { cents: true })}
        </span>
      </div>

      <div className="mt-[3px] flex items-baseline justify-between gap-3">
        <span className="text-[11px] text-muted-foreground">Card and payments</span>
        {account.nextDepositOn && (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {account.nextDepositOn} · ~{money(account.nextDepositEstimate, { cents: true })}
          </span>
        )}
      </div>

      {parked ? (
        <div className="mt-3 border-t-[0.5px] border-border pt-[11px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-foreground-secondary">Ready to allocate</span>
            <span className="text-[16px] font-medium tabular-nums">
              {money(account.readyToAllocate, { cents: true })}
            </span>
          </div>

          <div className="mt-[3px] flex items-baseline justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">Savings and Earn only</span>
            <span className="text-[11px] text-muted-foreground">Not spendable on your card</span>
          </div>

          <div className="mt-2.5 flex gap-[7px]">
            <Button variant="clear" size="xs" className="flex-1" onClick={onAllocateSavings}>
              Savings
            </Button>
            <Button variant="clear" size="xs" className="flex-1" onClick={onAllocateEarn}>
              Earn
            </Button>
            <Button variant="clear" size="xs" className="flex-1" onClick={onBackToCash}>
              Back to cash
            </Button>
          </div>
        </div>
      ) : (
        // Dimmed rather than hidden: a member who has used this once should still find the line
        // where they left it, reading zero.
        <div className="mt-3 flex items-center justify-between gap-3 border-t-[0.5px] border-border pt-[11px] opacity-50">
          <span className="text-xs text-foreground-secondary">Ready to allocate</span>
          <span className="text-[13px] tabular-nums">{money(0, { cents: true })}</span>
        </div>
      )}

      {/* The footer is unconditional. Direct deposit status changes what the left side says, never
          whether the right side is there — account details are how a member sets direct deposit up
          in the first place, so gating the way in on already having it is backwards. */}
      <CardRule className="flex items-center justify-between gap-3">
        {account.directDepositActive ? (
          <span className="text-[11px] text-tier-savings-fg">Direct deposit active</span>
        ) : (
          <span className="text-[11px] text-muted-foreground">Direct deposit not set up</span>
        )}
        <Button variant="clear" size="xs" onClick={onDetails}>
          Details
        </Button>
      </CardRule>
    </Card>
  );
}
