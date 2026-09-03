import { useEffect, useState } from 'react';
import { getTokenBalancesBatch } from '@/utils/apiClient';
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
  const [nonce, setNonce] = useState(0);
  const key = enabled ? addresses.map((a) => a.toLowerCase()).sort().join(',') : '';

  // Refetch after a money action — a transfer FROM a linked wallet drops its balance, which otherwise
  // stayed stale (only refetched when the address list changed). Refetch now + again after the indexer
  // catches up.
  useEffect(() => {
    const onActivity = () => {
      setNonce((n) => n + 1);
      setTimeout(() => setNonce((n) => n + 1), 4000);
    };
    window.addEventListener('clear:activity', onActivity);
    return () => window.removeEventListener('clear:activity', onActivity);
  }, []);

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
      for (const a of addresses) out[a.toLowerCase()] = { usdc: 0, clrusd: 0 };
      // Query the two known tokens (USDC + CLRUSD) directly via balanceOf, which fails over Alchemy →
      // public RPC server-side. This survives Alchemy Data-API outages, unlike the Portfolio discovery API.
      const requests: Array<{ chainId: number; tokenAddress: string; userAddress: string }> = [];
      for (const a of addresses) {
        if (usdcAddr) requests.push({ chainId: ACTIVE_CHAIN_ID, tokenAddress: usdcAddr, userAddress: a });
        if (clrusdAddr) requests.push({ chainId: ACTIVE_CHAIN_ID, tokenAddress: clrusdAddr, userAddress: a });
      }
      const results = await getTokenBalancesBatch(requests).catch(() => []);
      for (const r of results) {
        if (!r.data) continue; // null = zero balance or not found → stays 0
        const addrLower = r.userAddress.toLowerCase();
        const ta = r.tokenAddress.toLowerCase();
        const bal = Number(r.data.balance) || 0;
        if (!out[addrLower]) out[addrLower] = { usdc: 0, clrusd: 0 };
        if (ta === usdcAddr) out[addrLower].usdc = bal;
        else if (ta === clrusdAddr) out[addrLower].clrusd = bal;
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
  }, [key, enabled, nonce]);

  return { balances, loading };
}
