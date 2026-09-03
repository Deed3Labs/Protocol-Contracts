import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Card, { CardRule } from '@/components/clear/Card';
import Modal from '@/components/clear/Modal';
import InfoBlock from '@/components/clear/InfoBlock';
import { money, count, signedMoney } from '@clear/domain';
import { closureBalance, type AccountClosure } from '@/lib/clearModel';

/**
 * Close account — what leaving actually costs.
 *
 * Every figure is stated before the exit, including the one that's easiest to
 * leave out: credits are forfeited, because they're earned by staying. The
 * settlement is computed, so it can't quietly disagree with the balances the
 * rest of the app shows.
 *
 * "Talk to someone first" is the primary action and closing is the quiet one.
 * That's deliberate, and it isn't a dark pattern — closing is still one click
 * away, but a member owing money on exit should have the conversation offered.
 */
export default function CloseAccountDialog({
  closure,
  open,
  onOpenChange,
}: {
  closure: AccountClosure;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const balance = closureBalance(closure);
  const owed = balance < 0;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Close account"
      description="What happens to your savings, credit and equity credits if you leave."
    >
      <InfoBlock tone="neutral" className="mb-3.5 flex gap-2.5">
        <TriangleAlert className="mt-px h-[15px] w-[15px] shrink-0" strokeWidth={1.75} />
        <span>Leaving ends your membership. Here&rsquo;s exactly what happens.</span>
      </InfoBlock>

      <Card className="mb-3">
        <div className="text-xs leading-[2]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-foreground-secondary">Savings returned</span>
            <span className="tabular-nums">{money(closure.savingsReturned, { cents: true })}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-foreground-secondary">Credit balance settled first</span>
            <span className="tabular-nums">{signedMoney(-closure.creditToSettle)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-foreground-secondary">Bonds redeemed at maturity</span>
            <span>{closure.bondsNote}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-foreground-secondary">Equity credits forfeited</span>
            <span className="tabular-nums text-foreground-secondary">
              {count(closure.creditsForfeited)}
            </span>
          </div>
        </div>

        <CardRule className="flex items-baseline justify-between gap-3">
          <span className="text-xs">{owed ? 'You’d owe' : 'You’d receive'}</span>
          <span className="text-[13px] font-medium tabular-nums">
            {money(Math.abs(balance), { cents: true })}
          </span>
        </CardRule>
      </Card>

      <InfoBlock className="mb-3.5">
        Your {count(closure.creditsForfeited)} equity credits go back to the co-op. They&rsquo;re
        earned by staying, so they don&rsquo;t come with you.
      </InfoBlock>

      <Button variant="clear" size="xs" className="mb-2 w-full">
        Talk to someone first
      </Button>
      <Button variant="clear" size="xs" className="w-full text-foreground-secondary">
        Continue closing
      </Button>
    </Modal>
  );
}
