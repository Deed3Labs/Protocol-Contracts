import { useCallback, useEffect, useMemo, useState } from 'react';
import { readContract } from '@wagmi/core';
import MoveMoneyDialog from './MoveMoneyDialog';
import { useClearBalances } from '@/hooks/useClearBalances';
import { useOptionalAddress } from '@/hooks/useOptionalWallet';
import { ACTIVE_CHAIN_ID, clearContracts } from '@/lib/clearNetwork';
import { wagmiAdapter } from '@/AppKitProvider';
import { BOND_PURCHASE_UNAVAILABLE } from '@/lib/sendCalls';
import { getEarn } from '@/utils/apiClient';
import { toEarnData } from '@/lib/earnMapping';
import { BOND_HAIRCUT_BPS } from '@/lib/clearModel';
import { shortMoveReason } from '@/hooks/usePoolMove';
import { EARN_DAY_ONE } from '@/data/clearPlaceholder';
import type { EarnData } from '@/lib/clearModel';

/**
 * Buying a bond.
 *
 * Paid from **Ready to allocate** — the USDC already in the member's smart account — the same
 * balance savings and the pool draw on.
 *
 * Phase 2f replaced the purchase: the deposit contract, the discount curve and its
 * `calculateRequiredDeposit` quote are retired (decision 8), and a bond is bought with
 * `BurnerBond.purchase(quote, signature, attestation)` on a Ladder rung, signed by the buyer's own
 * key, with an eligibility attestation. Until that flow is built the screen shows the terms and says
 * buying is not open in the app; nothing is sent to a retired contract.
 */

const FACTORY_ABI = [
  { type: 'function', name: 'getMinFaceValue', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'getMaxFaceValue', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
] as const;


export default function ConnectedBuyBond({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const balances = useClearBalances();
  const address = useOptionalAddress();
  const [data, setData] = useState<EarnData>(EARN_DAY_ONE);
  const [busy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [months, setMonths] = useState(24);
  const [face, setFace] = useState(0);
  // Quoted by the chain for the chosen face and term. Null until both are known and the quote has
  // come back — the screen shows nothing rather than a price the contract has not agreed to.
  const [priceToday, setPriceToday] = useState<number | null>(null);
  /*
   * The face values the collection will actually mint, read from the factory.
   *
   * Not hardcoded, because they are governance parameters that can move — and not omitted, because
   * the mint enforces them and nothing between here and there does. `calculateRequiredDeposit`
   * quotes a price for a face below the minimum perfectly happily, so a member saw "$4.84 today"
   * for a bond that then reverted with no reason at all: the deployed build strips revert strings,
   * so a failed `require` arrives as `0x`.
   */
  const [faceLimits, setFaceLimits] = useState<{ min: number; max: number } | null>(null);
  const [progress, setProgress] = useState<{ status: 'processing' | 'done' | 'failed'; step: number; failureNote?: string } | null>(null);

  // Read, not passed. A page holding a mapped model would hand fixtures to a screen that spends
  // money, which is the mistake the savings dialog was fixed for.
  useEffect(() => {
    if (!address || !open) return;
    let cancelled = false;
    void getEarn(address).then((earn) => {
      if (cancelled || !earn) return;
      setData(toEarnData(earn.pool, earn.bonds, earn.terms, earn.earnedToDateCents, null, EARN_DAY_ONE));
    });
    return () => {
      cancelled = true;
    };
  }, [address, open]);

  useEffect(() => {
    const c = clearContracts(ACTIVE_CHAIN_ID);
    if (!open || !c?.burnerBondFactory) return;
    let cancelled = false;
    void Promise.all([
      readContract(wagmiAdapter.wagmiConfig, {
        address: c.burnerBondFactory, abi: FACTORY_ABI, functionName: 'getMinFaceValue', chainId: ACTIVE_CHAIN_ID,
      }),
      readContract(wagmiAdapter.wagmiConfig, {
        address: c.burnerBondFactory, abi: FACTORY_ABI, functionName: 'getMaxFaceValue', chainId: ACTIVE_CHAIN_ID,
      }),
    ])
      .then(([min, max]) => {
        if (!cancelled) setFaceLimits({ min: Number(min as bigint) / 1e6, max: Number(max as bigint) / 1e6 });
      })
      .catch(() => {
        /* Left null; the mint still enforces them, so the worst case is the error we already had. */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const maturityDate = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d;
  }, [months]);

  // No chain quote until the signed-Quote purchase is built: the screen shows no price it cannot keep.
  useEffect(() => {
    setPriceToday(null);
  }, [open, face, maturityDate]);

  const onBuy = useCallback(
    async (_purchase: { face: number; maturity: { date: Date } }) => {
      if (!address) {
        setError('Connect a wallet first.');
        return;
      }
      setError(BOND_PURCHASE_UNAVAILABLE);
      setProgress({ status: 'failed', step: 0, failureNote: shortMoveReason(BOND_PURCHASE_UNAVAILABLE) });
    },
    [address],
  );

  return (
    <MoveMoneyDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          setFace(0);
          setProgress(null);
        }
        onOpenChange(next);
      }}
      destination="bond"
      direction="deposit"
      onDirectionChange={() => {
        /* A bond is one-way before maturity; the route shows an arrow, not a swap. */
      }}
      cashReady={balances.cash}
      savingsTotal={0}
      savingsFree={0}
      credits={0}
      creditsGoal={0}
      bond={{
        termOptions: data.terms.map((t) => t.months),
        months,
        onMonthsChange: setMonths,
        // Zero until the chain has quoted it, so the screen never shows a price nothing agreed to.
        priceToday: priceToday ?? 0,
        maturesShort: maturityDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        maturesLong: maturityDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        ratePercent: data.terms.find((t) => t.months === months)?.rate ?? 0,
        haircutBps: BOND_HAIRCUT_BPS,
        // Until the factory has answered, nothing is out of range — the screen does not invent a
        // limit it has not read.
        minFace: faceLimits?.min ?? 0,
        maxFace: faceLimits?.max ?? Number.MAX_SAFE_INTEGER,
        heldBefore: data.bonds.length,
      }}
      busy={busy}
      error={error}
      progress={progress}
      // "See your bonds" belongs on Earn, which is where this was opened from — so closing is the
      // honest action rather than a route this modal does not own.
      onAgain={() => onOpenChange(false)}
      onRetry={() => setProgress(null)}
      onAmountChange={setFace}
      onMove={(amount) => void onBuy({ face: amount, maturity: { date: maturityDate } })}
    />
  );
}
