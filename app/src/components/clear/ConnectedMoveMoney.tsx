import { useCallback, useEffect, useState } from 'react';
import MoveMoneyDialog, { type MoveDirection } from './MoveMoneyDialog';
import { useSavingsMove } from '@/hooks/useSavingsMove';
import { useClearBalances } from '@/hooks/useClearBalances';
import { useOptionalAddress } from '@/hooks/useOptionalWallet';
import { useMoneyActions } from '@/context/MoneyActionsContext';
import { getCredit, getPaySummary } from '@/utils/apiClient';
import { track } from '@/lib/analytics';
import type { SavingsData } from '@/lib/clearModel';
import { freeSavings } from '@/lib/freeSavings';

/**
 * Move money, wired to both directions.
 *
 * The general savings component — it supersedes the one-way "Add to savings" for the entry points
 * a member actually reaches, because taking money out is the same decision with the sign flipped
 * and splitting it across two surfaces made withdrawing feel like a different, harder thing.
 *
 * The dialog stays presentational so the preview harness renders it with no wallet behind it.
 */

export default function ConnectedMoveMoney({
  data,
  open,
  onOpenChange,
}: {
  data: SavingsData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const balances = useClearBalances();
  // The empty state's two ways out, taken from the app's own money actions rather than passed down
  // by every caller. It is provider-optional, so the design preview gets no-ops and still renders.
  const { openAddMoney, openAutoSave } = useMoneyActions();
  const address = useOptionalAddress();
  const [direction, setDirection] = useState<MoveDirection>('deposit');
  const [encumberedCents, setEncumberedCents] = useState<number | null>(null);
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    if (!address || !open) return;
    let cancelled = false;
    void getCredit(address).then((credit) => {
      if (cancelled || !credit) return;
      // What cannot leave, from the registry — not the pledge. Encumbrance follows what is
      // *drawn*, so savings backing a line nobody has touched are entirely withdrawable.
      setEncumberedCents(credit.savingsEncumberedCents);
    });
    // Equity credits come from the ledger that mints them, not from the page. It is the same read
    // Home and Savings already use, so a member sees one figure wherever they look at it.
    void getPaySummary(address).then((summary) => {
      if (!cancelled && summary) setCredits(summary.totalEquity);
    });
    return () => {
      cancelled = true;
    };
  }, [address, open]);

  const onMoved = useCallback(
    (moved: MoveDirection, amount: number) => {
      // Optimistic, reconciled by the poll. Cash and savings move in opposite directions, and the
      // cash leg is Ready to allocate rather than spendable — this is USDC inside Clear, not money
      // that could have settled a card authorization.
      const delta = moved === 'deposit' ? amount : -amount;
      balances.applyOptimistic(-delta, delta);

      // The balances above are safe to show optimistically -- the transfer confirmed, so they are
      // already true. The credit limit is not: it moves only once the server has pledged the
      // collateral and pushed the capacities, two writes later. So this asks for a re-read rather
      // than predicting a figure the contracts have not agreed to yet.
      window.dispatchEvent(new Event('clear:credit-stale'));

      track('savings_move', { direction: moved }); // direction only, never the amount
    },
    [balances],
  );

  const { busy, error, txHash, move, reset } = useSavingsMove(onMoved);

  /*
   * Every figure with a real source is read from that source, and the page's `data` is used only
   * for what has none.
   *
   * The earlier version fell back to `data` whenever the balance read came back at zero, which is
   * the furnished-fixture mistake in a new place: a member with nothing would have been shown the
   * reference's money as their own. The reference's numbers are mock — it is a picture of the
   * screens, not a source of balances — and the contracts are deployed, so there is no reason for
   * a figure that exists on chain to come from anywhere else.
   *
   * What legitimately still comes from `data`: the credits goal, which is a product constant, and
   * the projected date, which is a projection nothing on chain holds.
   */
  const savingsTotal = balances.savings;
  // Ready to allocate — USDC in the smart account that is not card-spendable. That is what a
  // deposit draws from, so it is what the leg shows.
  const cashReady = balances.cash;

  return (
    <MoveMoneyDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          setDirection('deposit');
        }
        onOpenChange(next);
      }}
      direction={direction}
      onDirectionChange={setDirection}
      cashReady={cashReady}
      savingsTotal={savingsTotal}
      savingsFree={freeSavings(savingsTotal, encumberedCents)}
      credits={credits ?? 0}
      creditsGoal={data.savings.creditsGoal}
      reachesGoalBy={data.savings.onTrackFor}
      busy={busy}
      error={error}
      txHash={txHash}
      onMove={(amount) => void move(direction, amount)}
      onAddMoney={() => {
        onOpenChange(false);
        openAddMoney();
      }}
      onAutoSave={() => {
        onOpenChange(false);
        openAutoSave();
      }}
    />
  );
}
