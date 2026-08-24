import { useCallback, useEffect, useState } from 'react';
import MoveMoneyDialog, { type MoveDirection } from './MoveMoneyDialog';
import { usePoolMove } from '@/hooks/usePoolMove';
import { useClearBalances } from '@/hooks/useClearBalances';
import { useOptionalAddress } from '@/hooks/useOptionalWallet';
import { useMoneyActions } from '@/context/MoneyActionsContext';
import { getCredit, getEarn, type EarnPoolRow } from '@/utils/apiClient';
import { track } from '@/lib/analytics';

/**
 * The haircut `CollateralRegistry` applies to a pool share, read from the deployment.
 *
 * Stated here rather than fetched because it is a co-op parameter that changes by governance, not
 * by the minute — but it is a real on-chain value, so if it moves this constant is the one place
 * that is wrong, and the limit it quotes is the thing a member would notice.
 */
const POOL_SHARE_HAIRCUT_BPS = 7_000;

/**
 * Add to / take from the yield pool, wired.
 *
 * The same component as savings, pointed at a different destination — which is how the reference
 * describes it, so it is a prop rather than a second modal. Both directions draw on, or return to,
 * **Ready to allocate**: the USDC already in the member's smart account that the card cannot spend.
 *
 * Every figure is read, none come from the page. That is the rule the savings tier was fixed to
 * follow after showing a member the reference's money as their own, and it applies here from the
 * start rather than after the same bug.
 */
export default function ConnectedPoolMove({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const balances = useClearBalances();
  const address = useOptionalAddress();
  const { openAddMoney, openAutoSave } = useMoneyActions();
  const [direction, setDirection] = useState<MoveDirection>('deposit');
  const [limitCents, setLimitCents] = useState<number | null>(null);
  const [owedCents, setOwedCents] = useState<number | null>(null);
  // Read here rather than passed in. A page holding a mapped model would have to hand over
  // fixtures on the way, and fixtures reaching a screen that moves money is the exact mistake the
  // savings dialog was fixed for.
  const [pool, setPool] = useState<EarnPoolRow | null>(null);

  useEffect(() => {
    if (!address || !open) return;
    let cancelled = false;
    void getEarn(address).then((earn) => {
      if (!cancelled && earn) setPool(earn.pool);
    });
    void getCredit(address).then((credit) => {
      if (cancelled || !credit) return;
      const active = credit.tiers.filter((tier) => tier.active);
      setLimitCents(active.reduce((sum, tier) => sum + tier.limitCents, 0));
      setOwedCents(active.reduce((sum, tier) => sum + tier.usedCents, 0));
    });
    return () => {
      cancelled = true;
    };
  }, [address, open]);

  const onMoved = useCallback(
    (moved: MoveDirection, amount: number) => {
      // Cash is Ready to allocate, and the pool position is not a Clear balance the hook tracks —
      // so only the cash leg moves optimistically. The position reconciles on the next Earn read.
      balances.applyOptimistic(moved === 'deposit' ? -amount : amount, 0);
      track('pool_move', { direction: moved }); // direction only, never the amount
    },
    [balances],
  );

  const { busy, error, txHash, move, reset } = usePoolMove(onMoved);

  const position = (pool?.positionCents ?? 0) / 100;
  // What the pool can pay right now. Capacity less what is lent out is the cash on hand, and it is
  // the reason a withdrawal can be partly queued rather than refused.
  const freeNow = Math.max(0, ((pool?.capacityCents ?? 0) - (pool?.lentCents ?? 0)) / 100);
  const utilizationBps =
    pool && pool.capacityCents > 0 ? Math.round((pool.lentCents / pool.capacityCents) * 10_000) : 0;

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
      destination="pool"
      direction={direction}
      onDirectionChange={setDirection}
      cashReady={balances.cash}
      savingsTotal={position}
      // The member's whole position is theirs; what caps a withdrawal is the pool's cash, which
      // MoveMoneyDialog applies on top.
      savingsFree={position}
      credits={0}
      creditsGoal={0}
      pool={{
        apyPercent: pool?.apyPercent ?? 0,
        // POOL_SHARE is registered at a 70% haircut, so a dollar lent backs seventy cents of
        // limit. The dialog applies it to whatever is typed rather than to a fixed figure.
        haircutBps: POOL_SHARE_HAIRCUT_BPS,
        freeNow,
        utilizationBps,
        ...(limitCents !== null ? { limitAfter: limitCents / 100 } : {}),
        ...(owedCents !== null ? { owed: owedCents / 100 } : {}),
      }}
      busy={busy}
      error={error}
      txHash={txHash}
      onMove={(amount) => void move(direction, amount, freeNow)}
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
