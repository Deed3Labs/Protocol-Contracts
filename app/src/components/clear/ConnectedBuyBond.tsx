import { useCallback, useEffect, useState } from 'react';
import { readContract } from '@wagmi/core';
import { parseUnits } from 'viem';
import BuyBondDialog from './BuyBondDialog';
import { useClearBalances } from '@/hooks/useClearBalances';
import { useOptionalAddress, useOptionalSmartWalletClient } from '@/hooks/useOptionalWallet';
import { ACTIVE_CHAIN_ID, clearContracts } from '@/lib/clearNetwork';
import { wagmiAdapter } from '@/AppKitProvider';
import { scBuyBond } from '@/lib/sendCalls';
import { getEarn } from '@/utils/apiClient';
import { toEarnData } from '@/lib/earnMapping';
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
        track('bond_bought', {}); // that it happened, never the amount or the term
        onOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't go through.");
      } finally {
        setBusy(false);
      }
    },
    [address, getClientForChain, balances, onOpenChange],
  );

  return (
    <BuyBondDialog
      data={data}
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
      onBuy={(p) => void onBuy(p)}
      busy={busy}
      error={error}
    />
  );
}
