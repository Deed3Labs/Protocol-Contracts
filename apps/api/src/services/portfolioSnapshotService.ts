import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { getAllTokenBalancesMultiChain } from './balanceService.js';
import { plaidTokenStore } from './plaidTokenStore.js';
import { portfolioHistoryStore } from './portfolioHistoryStore.js';

/*
 * Computes + backfills portfolio value (mainnet USDC + CLRUSD on-chain, plus Plaid bank balances).
 * Snapshots are stored daily (forward) by the cron; history is reconstructed once (backfill) from
 * transaction flows — accurate here because balances are $1-pegged stablecoins + USD bank cash.
 * Every external call is defensive: failures degrade to 0 / partial rather than throwing.
 *
 * NOTE: written without a local backend to test against — verify on deploy. Plaid uses the same
 * client pattern as routes/plaid.ts; on-chain history is read from the server's own public
 * /api/transactions endpoint to reuse the tested Alchemy logic.
 */

const MAINNET = [1, 10, 8453, 42161, 137, 100];
const ALL_CHAINS = [1, 10, 8453, 42161, 137, 100, 11155111, 84532];
const DAY = 86_400_000;
const BACKFILL_DAYS = 365;

// Canonical mainnet USDC contract addresses (mirror frontend config/tokens.ts). Cash is matched by
// ADDRESS, not symbol, so bridged variants (e.g. Gnosis USDC.e) are counted and symbol-spoofing
// spam tokens are excluded — keeping the snapshot total in lockstep with the balance cards.
const USDC_ADDRESSES: Record<number, string> = {
  1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  10: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
  8453: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  42161: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
  137: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  100: '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83',
};
const USDC_KEYS = new Set(Object.entries(USDC_ADDRESSES).map(([c, a]) => `${c}:${a}`));
// USDC symbol variants — used only for tx-flow matching, where the contract address isn't available.
const USDC_SYMS = new Set(['USDC', 'USDC.E', 'USDBC']);

interface Flow {
  ts: number;
  usd: number; // + inflow, - outflow
}

const clean = (s?: string) => (s || '').replace(/[^\x20-\x7E]/g, '').trim().toUpperCase();
const dayISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const startOfUTCDay = (ms: number) => Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), new Date(ms).getUTCDate());

let _client: PlaidApi | null | undefined;
function plaidClient(): PlaidApi | null {
  if (_client !== undefined) return _client;
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    _client = null;
    return null;
  }
  const basePath = process.env.PLAID_ENV === 'production' ? PlaidEnvironments.production : PlaidEnvironments.sandbox;
  _client = new PlaidApi(new Configuration({ basePath, baseOptions: { headers: { 'PLAID-CLIENT-ID': clientId, 'PLAID-SECRET': secret } } }));
  return _client;
}

/** Current on-chain stablecoin value (mainnet USDC + CLRUSD any chain), in USD. */
export async function getOnchainStableUsd(wallet: string): Promise<number> {
  try {
    const res = await getAllTokenBalancesMultiChain([{ address: wallet, chainIds: ALL_CHAINS }]);
    const byChain = res.get(wallet) || res.get(wallet.toLowerCase()) || new Map();
    let sum = 0;
    for (const [chainId, tokens] of byChain.entries()) {
      for (const t of tokens) {
        const isUSDC = USDC_KEYS.has(`${chainId}:${(t.address || '').toLowerCase()}`); // mainnet USDC by canonical address
        const isCLRUSD = clean(t.symbol) === 'CLRUSD'; // CLRUSD any chain (own token, no spam risk)
        if (isUSDC || isCLRUSD) sum += Number(t.balance) || 0;
      }
    }
    return sum;
  } catch {
    return 0;
  }
}

/** Current Plaid bank cash (depository accounts), in USD. */
export async function getBankUsd(wallet: string): Promise<number> {
  try {
    const client = plaidClient();
    if (!client) return 0;
    const items = await plaidTokenStore.getItems(wallet);
    let sum = 0;
    for (const item of items) {
      try {
        const r = await client.accountsBalanceGet({ access_token: item.access_token });
        for (const a of r.data.accounts || []) {
          if (a.type && a.type !== 'depository') continue;
          sum += (a.balances?.available ?? a.balances?.current ?? 0) || 0;
        }
      } catch {
        /* skip item */
      }
    }
    return sum;
  } catch {
    return 0;
  }
}

/** On-chain stablecoin flows, read from the server's own public /api/transactions endpoint. */
async function getOnchainFlows(wallet: string): Promise<Flow[]> {
  const base = `http://127.0.0.1:${process.env.PORT || 3001}`;
  const flows: Flow[] = [];
  for (const chain of MAINNET) {
    try {
      const res = await fetch(`${base}/api/transactions/${chain}/${wallet}?limit=100`);
      if (!res.ok) continue;
      const data = (await res.json()) as { transactions?: Array<{ type?: string; assetSymbol?: string; amount?: number; date?: string }> };
      for (const t of data.transactions || []) {
        const sym = clean(t.assetSymbol);
        if (!(USDC_SYMS.has(sym) || sym === 'CLRUSD')) continue; // USDC variants (no contract addr in tx data) + CLRUSD
        const inbound = /deposit|receiv|incoming|claim/i.test(t.type || '');
        const amt = Math.abs(Number(t.amount) || 0);
        flows.push({ ts: Date.parse(t.date || '') || 0, usd: inbound ? amt : -amt });
      }
    } catch {
      /* skip chain */
    }
  }
  return flows.filter((f) => f.ts > 0);
}

/** Plaid bank flows (last ~2 years) for reconstruction. */
async function getBankFlows(wallet: string): Promise<Flow[]> {
  try {
    const client = plaidClient();
    if (!client) return [];
    const items = await plaidTokenStore.getItems(wallet);
    const end = dayISO(Date.now());
    const start = dayISO(Date.now() - 730 * DAY);
    const flows: Flow[] = [];
    for (const item of items) {
      try {
        let offset = 0;
        for (let page = 0; page < 8; page++) {
          const r = await client.transactionsGet({ access_token: item.access_token, start_date: start, end_date: end, options: { count: 250, offset } });
          const txs = r.data.transactions || [];
          for (const t of txs) {
            // Plaid `amount` is positive for money OUT, negative for money IN.
            flows.push({ ts: Date.parse(t.date) || 0, usd: -(Number(t.amount) || 0) });
          }
          offset += txs.length;
          if (txs.length === 0 || offset >= (r.data.total_transactions || txs.length)) break;
        }
      } catch {
        /* skip item */
      }
    }
    return flows.filter((f) => f.ts > 0);
  } catch {
    return [];
  }
}

/** Snapshot today's totals for a wallet. */
export async function snapshotToday(wallet: string): Promise<void> {
  const [onchain, bank] = await Promise.all([getOnchainStableUsd(wallet), getBankUsd(wallet)]);
  await portfolioHistoryStore.upsert(wallet, dayISO(Date.now()), onchain, bank);
}

/** One-time backfill: reconstruct daily history from current totals + transaction flows. */
export async function backfill(wallet: string): Promise<void> {
  const [onchainNow, bankNow, onchainFlows, bankFlows] = await Promise.all([
    getOnchainStableUsd(wallet),
    getBankUsd(wallet),
    getOnchainFlows(wallet),
    getBankFlows(wallet),
  ]);
  const today = startOfUTCDay(Date.now());
  for (let i = 0; i < BACKFILL_DAYS; i++) {
    const dayStart = today - i * DAY;
    const dayEnd = dayStart + DAY - 1;
    const onAfter = onchainFlows.filter((f) => f.ts > dayEnd).reduce((s, f) => s + f.usd, 0);
    const bankAfter = bankFlows.filter((f) => f.ts > dayEnd).reduce((s, f) => s + f.usd, 0);
    await portfolioHistoryStore.upsert(wallet, dayISO(dayStart), onchainNow - onAfter, bankNow - bankAfter);
  }
}

/** Daily cron entry: refresh today's snapshot for every wallet we already track. */
export async function snapshotAllWallets(): Promise<void> {
  const wallets = await portfolioHistoryStore.listWallets();
  for (const w of wallets) {
    try {
      await snapshotToday(w);
    } catch {
      /* skip wallet */
    }
  }
}
