import { useCallback, useEffect, useState } from 'react';
import MoveMoneyDialog, { type MoveDirection } from './MoveMoneyDialog';
import { useSavingsMove } from '@/hooks/useSavingsMove';
import { useClearBalances } from '@/hooks/useClearBalances';
import { useOptionalAddress } from '@/hooks/useOptionalWallet';
import { useMoneyActions } from '@/context/MoneyActionsContext';
import { getCredit } from '@/utils/apiClient';
import { track } from '@/lib/analytics';
import { savingsTotal as savingsBalance, type SavingsData } from '@/lib/clearModel';
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
  const [pledgedCents, setPledgedCents] = useState<number | null>(null);

  useEffect(() => {
    if (!address || !open) return;
    let cancelled = false;
    void getCredit(address).then((credit) => {
      if (cancelled || !credit) return;
      const savingsTier = credit.tiers.find((tier) => tier.kind === 'SAVINGS');
      setPledgedCents(savingsTier?.collateralValueCents ?? 0);
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
      track('savings_move', { direction: moved }); // direction only, never the amount
    },
    [balances],
  );

  const { busy, error, txHash, move, reset } = useSavingsMove(onMoved);

  const live = !balances.loading && balances.total > 0;
  // The whole savings balance, not its cash slice. `savings.cash` is one of three parts — cash,
  // vested and vesting — and using it made the dialog quote $3,000.00 on a page whose own header
  // read $6,000.00, one component apart.
  const savingsTotal = live ? balances.savings : savingsBalance(data.savings);
  // The cash leg is what the reference calls "ready to allocate" — USDC held in the smart account
  // that is not card-spendable. That is what a deposit draws from, so it is what the leg shows.
  const cashReady = live ? balances.cash : data.payFrom.balance;

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
      savingsFree={freeSavings(savingsTotal, pledgedCents)}
      credits={data.savings.credits}
      creditsGoal={data.savings.creditsGoal}
      creditLimitToday={data.creditLimitToday}
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
