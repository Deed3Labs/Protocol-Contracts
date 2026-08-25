import { useCallback, useEffect, useMemo, useState } from 'react';
import { readContract } from '@wagmi/core';
import { parseUnits } from 'viem';
import MoveMoneyDialog from './MoveMoneyDialog';
import { useClearBalances } from '@/hooks/useClearBalances';
import { useOptionalAddress, useOptionalSmartWalletClient } from '@/hooks/useOptionalWallet';
import { ACTIVE_CHAIN_ID, clearContracts } from '@/lib/clearNetwork';
import { wagmiAdapter } from '@/AppKitProvider';
import { scBuyBond } from '@/lib/sendCalls';
import { getEarn } from '@/utils/apiClient';
import { toEarnData } from '@/lib/earnMapping';
import { BOND_HAIRCUT_BPS } from '@/lib/clearModel';
import { shortMoveReason } from '@/hooks/usePoolMove';
import { EARN_DAY_ONE } from '@/data/clearPlaceholder';
import { track } from '@/lib/analytics';
import type { EarnData } from '@/lib/clearModel';

/**
 * Buying a bond, wired.
 *
 * Paid from **Ready to allocate** — the USDC already in the member's smart account — the same
 * balance savings and the pool draw on. Approve and mint go in one sponsored batch.
 *
 * **The price is quoted by the chain, not by the screen.** `calculateRequiredDeposit` is what the
 * deposit contract will actually charge, and it is what the approval is for. The ladder on the
 * screen is a model of the same curve; letting it set the approval would mean two figures that
 * agree until the curve moves and then quietly do not, with the approval being the one that fails.
 */
const DEPOSIT_ABI = [
  { type: 'function', name: 'calculateRequiredDeposit', stateMutability: 'view',
    inputs: [
      { name: 'tokenAddress', type: 'address' },
      { name: 'faceValue', type: 'uint256' },
      { name: 'maturityDate', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }] },
] as const;

const FACTORY_ABI = [
  { type: 'function', name: 'getMinFaceValue', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'getMaxFaceValue', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
] as const;

const BOND_ABI = [
  { type: 'function', name: 'getDiscountForMaturity', stateMutability: 'view',
    inputs: [{ name: 'timeToMaturity', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }] },
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
  const getClientForChain = useOptionalSmartWalletClient();
  const [data, setData] = useState<EarnData>(EARN_DAY_ONE);
  const [busy, setBusy] = useState(false);
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

  /*
   * The price, quoted by the chain for exactly what is on screen.
   *
   * `calculateRequiredDeposit` is what the deposit contract will charge and what the approval is
   * for. Deriving it in the app from a modelled curve would be two figures that agree until the
   * curve moves — and the approval would be the one that fails.
   */
  useEffect(() => {
    const c = clearContracts(ACTIVE_CHAIN_ID);
    if (!open || !c?.burnerBondDeposit || face <= 0) {
      setPriceToday(null);
      return;
    }
    let cancelled = false;
    void readContract(wagmiAdapter.wagmiConfig, {
      address: c.burnerBondDeposit,
      abi: DEPOSIT_ABI,
      functionName: 'calculateRequiredDeposit',
      args: [c.usdc, parseUnits(face.toFixed(2), 6), BigInt(Math.floor(maturityDate.getTime() / 1000))],
      chainId: ACTIVE_CHAIN_ID,
    })
      .then((units) => {
        if (!cancelled) setPriceToday(Number(units as bigint) / 1e6);
      })
      .catch(() => {
        if (!cancelled) setPriceToday(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, face, maturityDate]);

  const onBuy = useCallback(
    async (purchase: { face: number; maturity: { date: Date } }) => {
      if (!address) {
        setError('Connect a wallet first.');
        return;
      }
      const chainId = ACTIVE_CHAIN_ID;
      const c = clearContracts(chainId);
      if (!c?.burnerBondDeposit || !c.burnerBond) {
        setError('Bonds are not available on this network.');
        return;
      }

      setBusy(true);
      setError(null);
      setProgress({ status: 'processing', step: 0 });
      try {
        const faceValue = purchase.face.toFixed(2);
        const maturityDate = Math.floor(purchase.maturity.date.getTime() / 1000);
        const face = parseUnits(faceValue, 6);

        // Both from the chain: what it costs, and the discount the collection prices it at. The
        // deposit contract validates the discount it is handed, so a number the screen invented
        // would be rejected at the last possible moment.
        const priceUnits = (await readContract(wagmiAdapter.wagmiConfig, {
          address: c.burnerBondDeposit, abi: DEPOSIT_ABI, functionName: 'calculateRequiredDeposit',
          args: [c.usdc, face, BigInt(maturityDate)], chainId,
        })) as bigint;

        const secondsToMaturity = BigInt(Math.max(0, maturityDate - Math.floor(Date.now() / 1000)));
        const discountBps = (await readContract(wagmiAdapter.wagmiConfig, {
          address: c.burnerBond, abi: BOND_ABI, functionName: 'getDiscountForMaturity',
          args: [secondsToMaturity], chainId,
        })) as bigint;

        const chainClient = getClientForChain
          ? await getClientForChain({ id: chainId }).catch(() => undefined)
          : undefined;

        await scBuyBond({
          smartWalletClient: chainClient,
          ownerWallet: address,
          faceValue,
          maturityDate,
          discountBps: Number(discountBps),
          priceUnits,
          chainId,
        });

        // Ready to allocate falls by what the bond actually cost, not by its face.
        balances.applyOptimistic(-Number(priceUnits) / 1e6, 0);
        setProgress({ status: 'done', step: 3 });
        track('bond_bought', {}); // that it happened, never the amount or the term
      } catch (e) {
        const message = e instanceof Error ? e.message : "That didn't go through.";
        setError(message);
        setProgress({ status: 'failed', step: 1, failureNote: shortMoveReason(message) });
      } finally {
        setBusy(false);
      }
    },
    [address, getClientForChain, balances, onOpenChange],
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
