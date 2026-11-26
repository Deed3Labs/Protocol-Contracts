import { useState } from 'react';
import { HousingAllowanceBlock, RedeemCreditsDialog, AddToHomeDialog, type HomeSource } from './HousingAllowance';
import { useOptionalAddress, useOptionalSmartWalletClient } from '@/hooks/useOptionalWallet';
import { useClearBalances } from '@/hooks/useClearBalances';
import { ACTIVE_CHAIN_ID, clearContracts } from '@/lib/clearNetwork';
import { contributeMismatch, signRedeem, usdUnits, type Housing, type HousingHome } from '@/lib/housing';
import { scContribute, scRedeemHome } from '@/lib/sendCalls';
import { markChainStale } from '@/lib/chainStale';
import { prepareHousingContribute, prepareRedeemCredits, submitRedeemCredits } from '@/utils/apiClient';
import type { ElpaActive } from '@/lib/elpa';

const said = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * The Housing Allowance block with its two sheets and the Clear Deed, wired to the member's wallet:
 *
 *   - Redeem credits: the API prepares RedeemCredits, the phone checks it against the sheet, Face ID,
 *     the member's wallet signs, the API submits.
 *   - Add savings or USDC: the API prepares [approve, contribute], the phone checks them, and the
 *     member's wallet sends them in one sponsored batch (from savings, with the CLRUSD redeemed first).
 *   - Redeem your Clear Deed: RedemptionAgent.redeemHome from the member's wallet.
 *
 * After each, the chain is read again (`onChanged`).
 */
export default function ConnectedHousingAllowance({
  home,
  housing,
  elpa,
  onChanged,
}: {
  home: HousingHome;
  housing: Housing;
  elpa?: ElpaActive | null;
  onChanged: () => void;
}) {
  const address = useOptionalAddress();
  const getClient = useOptionalSmartWalletClient();
  const balances = useClearBalances();
  const [sheet, setSheet] = useState<'redeem' | 'add' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chainId = ACTIVE_CHAIN_ID;
  const contracts = clearContracts(chainId);
  const client = async () => (getClient ? await getClient({ id: chainId }).catch(() => undefined) : undefined);

  const run = async (work: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setSheet(null);
      markChainStale();
      onChanged();
    } catch (e) {
      setError(said(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const redeemCredits = (credits: number) =>
    run(async () => {
      if (!address || !contracts?.pointsIssuer) throw new Error('Redeeming credits is not available on this network yet.');
      const prepared = await prepareRedeemCredits(home.homeId, address, credits);
      if ('error' in prepared) throw new Error(prepared.error);
      const signature = await signRedeem({
        typedData: prepared.typedData,
        shown: { member: address, homeId: home.homeId, credits },
        expected: { chainId, pointsIssuer: contracts.pointsIssuer },
        nowSeconds: Math.floor(Date.now() / 1000),
      });
      const sent = await submitRedeemCredits(home.homeId, { wallet: address, credits, deadline: prepared.deadline, signature });
      if ('error' in sent) throw new Error(sent.error);
    }, 'The redemption did not go through. Nothing was redeemed.');

  const add = (source: HomeSource, usd: number) =>
    run(async () => {
      if (!address || !contracts?.housingAllowanceRecord) throw new Error('Paying toward a home is not available on this network yet.');
      const prepared = await prepareHousingContribute(home.homeId, address, usd);
      if ('error' in prepared) throw new Error(prepared.error);
      const units = usdUnits(usd);
      const mismatch = contributeMismatch({
        calls: prepared.calls,
        shown: { homeId: home.homeId, units },
        expected: { usdc: contracts.usdc, record: contracts.housingAllowanceRecord },
      });
      if (mismatch) throw new Error(`This is not the payment on your screen (${mismatch}). Nothing was sent.`);
      await scContribute({
        smartWalletClient: await client(),
        ownerWallet: address,
        chainId,
        calls: prepared.calls.map((c) => ({ to: c.to as `0x${string}`, data: c.data as `0x${string}` })),
        ...(source === 'savings' ? { fromSavingsUnits: units } : {}),
      });
      balances.refresh?.();
    }, 'The payment did not go through. Nothing was sent.');

  const redeemHome = () =>
    run(async () => {
      if (!address) throw new Error('Connect your account first.');
      await scRedeemHome({ smartWalletClient: await client(), ownerWallet: address, chainId, homeId: home.homeId });
    }, 'The Clear Deed did not move. Nothing changed.');

  const open = (s: 'redeem' | 'add') => {
    setError(null);
    setSheet(s);
  };

  return (
    <>
      <HousingAllowanceBlock
        home={home}
        housing={housing}
        elpa={elpa}
        onRedeemCredits={() => open('redeem')}
        onAdd={() => open('add')}
        onRedeemHome={redeemHome}
        busy={busy && sheet === null}
        error={sheet === null ? error : null}
      />
      <RedeemCreditsDialog
        open={sheet === 'redeem'}
        onOpenChange={(o) => !busy && setSheet(o ? 'redeem' : null)}
        home={home}
        housing={housing}
        busy={busy}
        error={error}
        onConfirm={redeemCredits}
      />
      <AddToHomeDialog
        open={sheet === 'add'}
        onOpenChange={(o) => !busy && setSheet(o ? 'add' : null)}
        home={home}
        savings={balances.savings}
        cash={balances.cash}
        busy={busy}
        error={error}
        onConfirm={add}
      />
    </>
  );
}
