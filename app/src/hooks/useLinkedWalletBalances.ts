import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { getTokensByAddressPortfolio } from '@/utils/apiClient';
import { ACTIVE_CHAIN_ID, clearContracts } from '@/lib/clearNetwork';

export interface LinkedBalance {
  usdc: number;
  clrusd: number;
}

/**
 * USDC/CLRUSD balances for a set of addresses via Alchemy's `tokens/by-address` Data API — one cheap
 * call per ≤2 addresses (Alchemy's documented cap), prices off (we treat both as $1). Runs ONLY while
 * `enabled` (e.g. the Wallets modal is open), so it costs nothing on idle. The smart wallet's balance
 * comes from useClearBalances; this is for the linked external wallets. See [[clearpath-alchemy-cu]].
 */
export function useLinkedWalletBalances(addresses: string[], enabled: boolean) {
  const [balances, setBalances] = useState<Record<string, LinkedBalance>>({});
  const [loading, setLoading] = useState(false);
  const key = enabled ? addresses.map((a) => a.toLowerCase()).sort().join(',') : '';

  useEffect(() => {
    if (!enabled || addresses.length === 0) {
      setBalances({});
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const c = clearContracts(ACTIVE_CHAIN_ID);
      const usdcAddr = c?.usdc?.toLowerCase();
      const clrusdAddr = c?.clrusd?.toLowerCase();
      const out: Record<string, LinkedBalance> = {};
      // Alchemy tokens/by-address caps at 2 addresses/request → batch by 2 (usually just one call).
      for (let i = 0; i < addresses.length; i += 2) {
        const batch = addresses.slice(i, i + 2);
        const { results } = await getTokensByAddressPortfolio(
          batch.map((a) => ({ address: a, chainIds: [ACTIVE_CHAIN_ID] })),
          { withMetadata: true, withPrices: false, includeNativeTokens: false, includeErc20Tokens: true },
        ).catch(() => ({ results: [] as Array<{ address: string; tokens: unknown[] }> }));
        for (const r of results) {
          const addrLower = r.address?.toLowerCase();
          if (!addrLower) continue;
          let usdc = 0;
          let clrusd = 0;
          for (const raw of r.tokens ?? []) {
            const t = raw as { tokenAddress?: string; address?: string; tokenBalance?: string; balanceRaw?: string; tokenMetadata?: { decimals?: number }; decimals?: number };
            const ta = (t.tokenAddress ?? t.address ?? '').toLowerCase();
            const decimals = t.tokenMetadata?.decimals ?? t.decimals ?? 6;
            const bal = Number(ethers.formatUnits(BigInt(t.tokenBalance ?? t.balanceRaw ?? '0'), decimals));
            if (ta === usdcAddr) usdc += bal;
            else if (ta === clrusdAddr) clrusd += bal;
          }
          out[addrLower] = { usdc, clrusd };
        }
      }
      if (!cancelled) {
        setBalances(out);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return { balances, loading };
}
