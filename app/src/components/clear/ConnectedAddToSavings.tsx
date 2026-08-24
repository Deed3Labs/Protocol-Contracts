import { useCallback } from 'react';
import AddToSavingsDialog from './AddToSavingsDialog';
import { useSavingsDeposit } from '@/hooks/useSavingsDeposit';
import { useClearBalances } from '@/hooks/useClearBalances';
import { track } from '@/lib/analytics';
import type { SavingsData } from '@/lib/clearModel';

/**
 * Add to savings, wired up.
 *
 * The general deposit, as distinct from auto-save. Auto-save is a standing instruction — sign once
 * and it runs on a schedule — and it had been carrying both jobs, which meant the ordinary case of
 * "put $500 in right now" was routed through a setup flow for something recurring.
 *
 * The dialog itself stays presentational so the preview harness renders the same screen with no
 * wallet, no balances and no deposit behind it.
 */
export default function ConnectedAddToSavings({
  data,
  open,
  onOpenChange,
}: {
  data: SavingsData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const balances = useClearBalances();

  const onDeposited = useCallback(
    (amount: number) => {
      // Optimistic, and reconciled by the poll: cash down, savings up. Without it the member
      // watches a receipt for money that is still sitting in the old balance for half a minute.
      balances.applyOptimistic(-amount, amount);
      track('savings_deposit', {}); // that it happened, not how much
    },
    [balances],
  );

  const { busy, error, txHash, deposit, reset } = useSavingsDeposit(onDeposited);

  // The live cash balance replaces whatever the page was carrying, so the figure the member reads
  // in the From row is the same one the button is checked against. Only once it has actually been
  // read: before that the page's own number stands, because refusing a deposit on a balance we
  // have not seen would be blaming a member for our latency — and in the design preview, where
  // there is no wallet at all, the fixture's figure is the honest one to show.
  const live = !balances.loading && balances.total > 0;
  const withLiveBalance = live
    ? { ...data, payFrom: { ...data.payFrom, balance: balances.cash } }
    : data;

  return (
    <AddToSavingsDialog
      data={withLiveBalance}
      open={open}
      onOpenChange={(next) => {
        // Cleared on close, not on open. A member who closes a receipt and immediately reopens
        // should get a fresh form; clearing on open would blank the receipt they just landed on.
        if (!next) reset();
        onOpenChange(next);
      }}
      onAdd={(amount) => void deposit(amount)}
      busy={busy}
      error={error}
      txHash={txHash}
    />
  );
}
