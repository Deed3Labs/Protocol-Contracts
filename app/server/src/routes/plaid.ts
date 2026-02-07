import { Router, Request, Response } from 'express';
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
  DepositoryAccountSubtype,
  CreditAccountSubtype,
  InvestmentAccountSubtype,
  type LinkTokenCreateRequest,
  type ItemPublicTokenExchangeRequest,
  type AccountsBalanceGetRequest,
  type TransactionsRecurringGetRequest,
  type TransactionsGetRequest,
  type InvestmentsHoldingsGetRequest,
  type InvestmentsRefreshRequest,
} from 'plaid';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';

const router = Router();

// Optional cache for balances (reduces Plaid API calls; fails open if Redis unavailable)
let cacheServicePromise: Promise<CacheService | null> | null = null;
async function getCacheService(): Promise<CacheService | null> {
  if (cacheServicePromise !== null) return cacheServicePromise;
  cacheServicePromise = getRedisClient()
    .then((client) => new CacheService(client))
    .catch(() => null);
  return cacheServicePromise;
}

// One Plaid Item = one institution connection (one access_token).
// In-memory store: walletAddress (lowercase) -> array of items so users can link multiple institutions.
// Replace with Redis or DB in production for persistence across restarts
interface StoredItem {
  access_token: string;
  item_id: string;
}
const accessTokenStore = new Map<string, StoredItem[]>();

function getPlaidClient(): PlaidApi | null {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = process.env.PLAID_ENV || 'sandbox';

  if (!clientId || !secret) {
    return null;
  }

  const basePath =
    env === 'production'
      ? PlaidEnvironments.production
      : PlaidEnvironments.sandbox;

  const configuration = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
      },
    },
  });

  return new PlaidApi(configuration);
}

/**
 * POST /api/plaid/link-token
 * Create a Link token for Plaid Link (keyed by wallet address)
 * Body: { walletAddress: string }
 */
router.post('/link-token', async (req: Request, res: Response) => {
  try {
    const client = getPlaidClient();
    if (!client) {
      return res.status(503).json({
        error: 'Plaid not configured',
        message: 'PLAID_CLIENT_ID and PLAID_SECRET must be set',
      });
    }

    const { walletAddress } = req.body as { walletAddress?: string };
    if (!walletAddress || typeof walletAddress !== 'string') {
      return res.status(400).json({
        error: 'Missing walletAddress',
        message: 'Request body must include walletAddress',
      });
    }

    const request: LinkTokenCreateRequest = {
      client_name: 'Protocol Contracts',
      language: 'en',
      country_codes: [CountryCode.Us],
      user: { client_user_id: walletAddress.toLowerCase() },
      // Auth for balance/account numbers; Transactions for recurring streams (Upcoming Transactions)
      products: [Products.Auth, Products.Transactions],
      // Optional: allow brokerage/investment accounts when institution supports them (no restriction on Link)
      optional_products: [Products.Investments],
      // When account_filters is set, any type not listed is omitted from Link. Include depository,
      // credit, and investment so users can select bank, credit card, and brokerage/investment accounts.
      account_filters: {
        depository: {
          account_subtypes: [
            DepositoryAccountSubtype.Checking,
            DepositoryAccountSubtype.Savings,
            DepositoryAccountSubtype.CashManagement,
          ],
        },
        credit: {
          account_subtypes: [CreditAccountSubtype.CreditCard],
        },
        investment: {
          account_subtypes: [
            InvestmentAccountSubtype.Brokerage,
            InvestmentAccountSubtype.Ira,
            InvestmentAccountSubtype._401k,
            InvestmentAccountSubtype._403B,
            InvestmentAccountSubtype._457b,
          ],
        },
      },
    };

    const response = await client.linkTokenCreate(request);
    const linkToken = response.data.link_token;

    res.json({ link_token: linkToken });
  } catch (error: unknown) {
    const err = error as { response?: { data?: unknown }; message?: string };
    console.error('Plaid linkTokenCreate error:', err.response?.data ?? err.message);
    res.status(500).json({
      error: 'Failed to create link token',
      message: err.message ?? 'Unknown error',
    });
  }
});

/**
 * POST /api/plaid/exchange-token
 * Exchange public token for access token and add to wallet's linked items (supports multiple institutions).
 * Body: { walletAddress: string, publicToken: string }
 */
router.post('/exchange-token', async (req: Request, res: Response) => {
  try {
    const client = getPlaidClient();
    if (!client) {
      return res.status(503).json({
        error: 'Plaid not configured',
        message: 'PLAID_CLIENT_ID and PLAID_SECRET must be set',
      });
    }

    const { walletAddress, publicToken } = req.body as {
      walletAddress?: string;
      publicToken?: string;
    };
    if (!walletAddress || !publicToken) {
      return res.status(400).json({
        error: 'Missing parameters',
        message: 'Request body must include walletAddress and publicToken',
      });
    }

    const request: ItemPublicTokenExchangeRequest = {
      public_token: publicToken,
    };
    const response = await client.itemPublicTokenExchange(request);
    const accessToken = response.data.access_token;
    const itemId = response.data.item_id;
    const key = walletAddress.toLowerCase();
    const existing = accessTokenStore.get(key) ?? [];
    existing.push({ access_token: accessToken, item_id: itemId });
    accessTokenStore.set(key, existing);

    // Invalidate balance cache so next fetch (or client refresh) returns all linked accounts
    const cacheService = await getCacheService();
    if (cacheService) await cacheService.del(CacheKeys.plaidBalances(key));

    res.json({ success: true });
  } catch (error: unknown) {
    const err = error as { response?: { data?: unknown }; message?: string };
    console.error('Plaid exchange token error:', err.response?.data ?? err.message);
    res.status(500).json({
      error: 'Failed to exchange token',
      message: err.message ?? 'Unknown error',
    });
  }
});

/** Account in balance response; item_id identifies which linked institution (for optional per-item disconnect) */
type BalanceAccount = {
  account_id: string;
  name: string;
  mask?: string;
  current: number | null;
  available: number | null;
  item_id?: string;
  /** Plaid account type: depository, credit, loan, investment, other */
  type?: string;
  /** Plaid account subtype e.g. checking, savings, credit card, brokerage */
  subtype?: string;
};

/** Response shape for GET /api/plaid/balances (with optional cached flag) */
const balancesResponse = (body: {
  accounts: BalanceAccount[];
  totalBankBalance: number;
  linked: boolean;
  cached?: boolean;
}) => body;

/**
 * GET /api/plaid/balances?walletAddress=0x...
 * Get balances for all linked bank accounts (all institutions). Aggregates multiple items per wallet.
 * Cached server-side (Redis) to reduce Plaid API usage (~$0.10/call). TTL via CACHE_TTL_PLAID_BALANCES (default 1 hour).
 */
router.get('/balances', async (req: Request, res: Response) => {
  try {
    const client = getPlaidClient();
    if (!client) {
      return res.status(503).json({
        error: 'Plaid not configured',
        message: 'PLAID_CLIENT_ID and PLAID_SECRET must be set',
      });
    }

    const walletAddress = req.query.walletAddress as string | undefined;
    if (!walletAddress) {
      return res.status(400).json({
        error: 'Missing walletAddress',
        message: 'Query parameter walletAddress is required',
      });
    }

    const key = walletAddress.toLowerCase();
    const items = accessTokenStore.get(key);
    if (!items?.length) {
      return res.json(balancesResponse({
        accounts: [],
        totalBankBalance: 0,
        linked: false,
      }));
    }

    const skipCache = req.query.refresh === '1' || req.query.refresh === 'true';
    const cacheService = await getCacheService();
    const cacheKey = CacheKeys.plaidBalances(key);
    const ttl = parseInt(process.env.CACHE_TTL_PLAID_BALANCES || '3600', 10); // 1 hour default (~$0.10/call)

    if (cacheService && !skipCache) {
      const cached = await cacheService.get<{
        accounts: BalanceAccount[];
        totalBankBalance: number;
        linked: boolean;
      }>(cacheKey);
      if (cached) {
        return res.json(balancesResponse({ ...cached, cached: true }));
      }
    }

    const accountList: BalanceAccount[] = [];
    let totalBankBalance = 0;
    const stillValidItems: StoredItem[] = [];
    // De-dupe accounts even across re-links where Plaid may mint new account_ids
    // Prefer mask+name when mask exists, otherwise fall back to account_id.
    const seenAccountKeys = new Set<string>();
    // Detect duplicate Items (user linked same institution twice) by fingerprinting the account list.
    // If two Items return the same set of accounts, we keep the first and drop the duplicate to avoid repeated calls.
    const seenItemFingerprints = new Set<string>();

    for (const item of items) {
      try {
        const request: AccountsBalanceGetRequest = { access_token: item.access_token };
        const response = await client.accountsBalanceGet(request);
        const accounts = response.data.accounts ?? [];
        // Fingerprint for this Item (stable across refresh): sorted list of name+mask pairs
        const fingerprint = accounts
          .map((a) => `${a.name}|${a.mask ?? ''}`)
          .sort()
          .join('||');
        if (fingerprint && seenItemFingerprints.has(fingerprint)) {
          // Duplicate link of the same institution/accounts; drop this item
          continue;
        }
        if (fingerprint) seenItemFingerprints.add(fingerprint);

        stillValidItems.push(item);
        for (const acc of accounts) {
          const key = acc.mask ? `${acc.mask}|${acc.name}` : acc.account_id;
          if (seenAccountKeys.has(key)) continue;
          seenAccountKeys.add(key);
          const current = acc.balances?.current;
          if (typeof current === 'number' && current !== null) {
            totalBankBalance += current;
          }
          accountList.push({
            account_id: acc.account_id,
            name: acc.name,
            mask: acc.mask ?? undefined,
            current: acc.balances?.current ?? null,
            available: acc.balances?.available ?? null,
            item_id: item.item_id,
            type: acc.type ?? undefined,
            subtype: acc.subtype ?? undefined,
          });
        }
      } catch (itemErr: unknown) {
        const err = itemErr as { response?: { data?: { error_code?: string } }; message?: string };
        const errorCode = err.response?.data?.error_code;
        if (errorCode === 'ITEM_LOGIN_REQUIRED' || errorCode === 'INVALID_ACCESS_TOKEN') {
          // This institution needs re-link; drop it and continue with others
          console.warn('Plaid item invalid, removing:', item.item_id, err.response?.data ?? err.message);
          continue;
        }
        throw itemErr;
      }
    }

    // Persist removal of any invalid items
    if (stillValidItems.length !== items.length) {
      if (stillValidItems.length === 0) {
        accessTokenStore.delete(key);
      } else {
        accessTokenStore.set(key, stillValidItems);
      }
      const cacheServiceForInvalidate = await getCacheService();
      if (cacheServiceForInvalidate) await cacheServiceForInvalidate.del(cacheKey);
    }

    const payload = { accounts: accountList, totalBankBalance, linked: accountList.length > 0 };
    if (cacheService) {
      await cacheService.set(cacheKey, payload, ttl);
    }
    return res.json(balancesResponse(payload));
  } catch (error: unknown) {
    const err = error as { response?: { data?: { error_code?: string } }; message?: string };
    const errorCode = err.response?.data?.error_code;
    if (errorCode === 'ITEM_LOGIN_REQUIRED' || errorCode === 'INVALID_ACCESS_TOKEN') {
      const walletAddress = req.query.walletAddress as string | undefined;
      if (walletAddress) {
        const key = walletAddress.toLowerCase();
        accessTokenStore.delete(key);
        const cacheService = await getCacheService();
        if (cacheService) await cacheService.del(CacheKeys.plaidBalances(key));
      }
      return res.json(balancesResponse({
        accounts: [],
        totalBankBalance: 0,
        linked: false,
      }));
    }
    console.error('Plaid balances error:', err.response?.data ?? err.message);
    res.status(500).json({
      error: 'Failed to get balances',
      message: err.message ?? 'Unknown error',
    });
  }
});

/** Normalized investment holding for API response (holding + security joined) */
type InvestmentHoldingPayload = {
  holding_id: string;
  account_id: string;
  security_id: string;
  name: string;
  ticker_symbol: string | null;
  security_type: string | null;
  quantity: number;
  institution_value: number;
  cost_basis: number | null;
  institution_price: number;
  iso_currency_code: string | null;
  item_id: string;
};

/**
 * GET /api/plaid/investments/holdings?walletAddress=0x...
 * Fetch investment holdings for all linked items (brokerage accounts).
 * Uses Plaid /investments/holdings/get. Cached server-side. Pass refresh=1 to skip cache.
 * Returns empty array if no items or Investments product not ready for an item.
 */
router.get('/investments/holdings', async (req: Request, res: Response) => {
  try {
    const client = getPlaidClient();
    if (!client) {
      return res.status(503).json({
        error: 'Plaid not configured',
        message: 'PLAID_CLIENT_ID and PLAID_SECRET must be set',
      });
    }

    const walletAddress = req.query.walletAddress as string | undefined;
    if (!walletAddress) {
      return res.status(400).json({
        error: 'Missing walletAddress',
        message: 'Query parameter walletAddress is required',
      });
    }

    const key = walletAddress.toLowerCase();
    const items = accessTokenStore.get(key);
    if (!items?.length) {
      return res.json({ holdings: [], linked: false, cached: false });
    }

    const skipCache = req.query.refresh === '1' || req.query.refresh === 'true';
    const cacheService = await getCacheService();
    const cacheKey = CacheKeys.plaidInvestmentsHoldings(key);
    const ttl = parseInt(process.env.CACHE_TTL_PLAID_BALANCES || '3600', 10);

    if (cacheService && !skipCache) {
      const cached = await cacheService.get<{ holdings: InvestmentHoldingPayload[] }>(cacheKey);
      if (cached?.holdings) {
        return res.json({ holdings: cached.holdings, linked: true, cached: true });
      }
    }

    const allHoldings: InvestmentHoldingPayload[] = [];
    const seenHoldingKeys = new Set<string>();

    for (const item of items) {
      try {
        const request: InvestmentsHoldingsGetRequest = { access_token: item.access_token };
        const response = await client.investmentsHoldingsGet(request);
        const holdings = response.data.holdings ?? [];
        const securities = response.data.securities ?? [];
        const securityMap = new Map(securities.map((s) => [s.security_id, s]));

        for (const h of holdings) {
          const sec = securityMap.get(h.security_id);
          const keyId = `${item.item_id}|${h.account_id}|${h.security_id}`;
          if (seenHoldingKeys.has(keyId)) continue;
          seenHoldingKeys.add(keyId);
          allHoldings.push({
            holding_id: `${h.account_id}-${h.security_id}`,
            account_id: h.account_id,
            security_id: h.security_id,
            name: sec?.name ?? 'Unknown',
            ticker_symbol: sec?.ticker_symbol ?? null,
            security_type: sec?.type ?? null,
            quantity: h.quantity ?? 0,
            institution_value: h.institution_value ?? 0,
            cost_basis: h.cost_basis ?? null,
            institution_price: h.institution_price ?? 0,
            iso_currency_code: h.iso_currency_code ?? null,
            item_id: item.item_id,
          });
        }
      } catch (itemErr: unknown) {
        const err = itemErr as { response?: { data?: { error_code?: string } }; message?: string };
        const errorCode = err.response?.data?.error_code;
        if (errorCode === 'PRODUCT_NOT_READY' || errorCode === 'ITEM_LOGIN_REQUIRED' || errorCode === 'INVALID_ACCESS_TOKEN') {
          continue;
        }
        throw itemErr;
      }
    }

    const payload = { holdings: allHoldings };
    if (cacheService) {
      await cacheService.set(cacheKey, payload, ttl);
    }
    return res.json({ holdings: allHoldings, linked: items.length > 0, cached: false });
  } catch (error: unknown) {
    const err = error as { response?: { data?: unknown }; message?: string };
    console.error('Plaid investments holdings error:', err.response?.data ?? err.message);
    res.status(500).json({
      error: 'Failed to get investment holdings',
      message: err.message ?? 'Unknown error',
    });
  }
});

/**
 * POST /api/plaid/investments/refresh
 * Trigger on-demand refresh of investment data for the wallet's linked items.
 * See https://plaid.com/docs/investments/#investmentsrefresh
 * Body: { walletAddress: string }
 */
router.post('/investments/refresh', async (req: Request, res: Response) => {
  try {
    const client = getPlaidClient();
    if (!client) {
      return res.status(503).json({
        error: 'Plaid not configured',
        message: 'PLAID_CLIENT_ID and PLAID_SECRET must be set',
      });
    }

    const { walletAddress } = req.body as { walletAddress?: string };
    if (!walletAddress || typeof walletAddress !== 'string') {
      return res.status(400).json({
        error: 'Missing walletAddress',
        message: 'Request body must include walletAddress',
      });
    }

    const key = walletAddress.toLowerCase();
    const items = accessTokenStore.get(key);
    if (!items?.length) {
      return res.json({ success: true, message: 'No linked items' });
    }

    for (const item of items) {
      try {
        const request: InvestmentsRefreshRequest = { access_token: item.access_token };
        await client.investmentsRefresh(request);
      } catch (itemErr: unknown) {
        const err = itemErr as { response?: { data?: { error_code?: string } }; message?: string };
        if (err.response?.data?.error_code === 'PRODUCT_NOT_READY') continue;
        throw itemErr;
      }
    }

    const cacheService = await getCacheService();
    if (cacheService) await cacheService.del(CacheKeys.plaidInvestmentsHoldings(key));

    res.json({ success: true });
  } catch (error: unknown) {
    const err = error as { response?: { data?: unknown }; message?: string };
    console.error('Plaid investments refresh error:', err.response?.data ?? err.message);
    res.status(500).json({
      error: 'Failed to refresh investment data',
      message: err.message ?? 'Unknown error',
    });
  }
});

/** Normalized recurring stream for API response (day = day of month from predicted_next_date) */
type RecurringStreamPayload = {
  stream_id: string;
  name: string;
  amount: number;
  day: number;
  iso_currency_code: string | null;
};

/**
 * GET /api/plaid/recurring-transactions?walletAddress=0x...
 * Fetch recurring inflow (deposits) and outflow (subscriptions/expenses) streams via Plaid
 * /transactions/recurring/get. Cached server-side to avoid excessive Plaid API calls.
 * Only called when user has linked accounts and Upcoming Transactions is shown.
 */
router.get('/recurring-transactions', async (req: Request, res: Response) => {
  try {
    const client = getPlaidClient();
    if (!client) {
      return res.status(503).json({
        error: 'Plaid not configured',
        message: 'PLAID_CLIENT_ID and PLAID_SECRET must be set',
      });
    }

    const walletAddress = req.query.walletAddress as string | undefined;
    if (!walletAddress) {
      return res.status(400).json({
        error: 'Missing walletAddress',
        message: 'Query parameter walletAddress is required',
      });
    }

    const key = walletAddress.toLowerCase();
    const items = accessTokenStore.get(key);
    if (!items?.length) {
      return res.json({
        inflowStreams: [],
        outflowStreams: [],
        linked: false,
        cached: false,
      });
    }

    const skipCache = req.query.refresh === '1' || req.query.refresh === 'true';
    const cacheService = await getCacheService();
    const cacheKey = CacheKeys.plaidRecurringTransactions(key);
    const ttl = parseInt(process.env.CACHE_TTL_PLAID_RECURRING ?? '86400', 10); // 24h default – recurring streams change rarely (monthly scale)

    if (cacheService && !skipCache) {
      const cached = await cacheService.get<{
        inflowStreams: RecurringStreamPayload[];
        outflowStreams: RecurringStreamPayload[];
      }>(cacheKey);
      if (cached) {
        return res.json({ ...cached, linked: true, cached: true });
      }
    }

    const inflowStreams: RecurringStreamPayload[] = [];
    const outflowStreams: RecurringStreamPayload[] = [];
    const seenInflow = new Set<string>();
    const seenOutflow = new Set<string>();

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    for (const item of items) {
      try {
        const request: TransactionsRecurringGetRequest = { access_token: item.access_token };
        const response = await client.transactionsRecurringGet(request);
        const inflow = response.data.inflow_streams ?? [];
        const outflow = response.data.outflow_streams ?? [];

        for (const s of inflow) {
          if (seenInflow.has(s.stream_id)) continue;
          seenInflow.add(s.stream_id);
          const nextDate = s.predicted_next_date;
          if (!nextDate) continue;
          const [y, m, d] = nextDate.split('-').map(Number);
          if (y !== currentYear || m !== currentMonth + 1) continue;
          const amount = s.last_amount?.amount != null ? Math.abs(Number(s.last_amount.amount)) : (s.average_amount?.amount != null ? Math.abs(Number(s.average_amount.amount)) : 0);
          const iso = s.last_amount?.iso_currency_code ?? s.average_amount?.iso_currency_code ?? null;
          inflowStreams.push({
            stream_id: s.stream_id,
            name: s.merchant_name || s.description || 'Deposit',
            amount,
            day: d,
            iso_currency_code: iso,
          });
        }

        for (const s of outflow) {
          if (seenOutflow.has(s.stream_id)) continue;
          seenOutflow.add(s.stream_id);
          const nextDate = s.predicted_next_date;
          if (!nextDate) continue;
          const [y, m, d] = nextDate.split('-').map(Number);
          if (y !== currentYear || m !== currentMonth + 1) continue;
          const amount = s.last_amount?.amount != null ? Math.abs(Number(s.last_amount.amount)) : (s.average_amount?.amount != null ? Math.abs(Number(s.average_amount.amount)) : 0);
          const iso = s.last_amount?.iso_currency_code ?? s.average_amount?.iso_currency_code ?? null;
          outflowStreams.push({
            stream_id: s.stream_id,
            name: s.merchant_name || s.description || 'Payment',
            amount,
            day: d,
            iso_currency_code: iso,
          });
        }
      } catch (itemErr: unknown) {
        const err = itemErr as { response?: { data?: { error_code?: string } }; message?: string };
        const errorCode = err.response?.data?.error_code;
        if (errorCode === 'ITEM_LOGIN_REQUIRED' || errorCode === 'INVALID_ACCESS_TOKEN') continue;
        if (errorCode === 'PRODUCTS_NOT_SUPPORTED' || errorCode === 'PRODUCT_NOT_READY') continue;
        throw itemErr;
      }
    }

    const payload = { inflowStreams, outflowStreams };
    if (cacheService) await cacheService.set(cacheKey, payload, ttl);
    return res.json({ ...payload, linked: true, cached: false });
  } catch (error: unknown) {
    const err = error as { response?: { data?: unknown }; message?: string };
    console.error('Plaid recurring-transactions error:', err.response?.data ?? err.message);
    res.status(500).json({
      error: 'Failed to get recurring transactions',
      message: err.message ?? 'Unknown error',
    });
  }
});

/** Spend-by-day payload: day of month (1–31) -> total outflows (positive amount) */
type SpendByDayPayload = Record<number, number>;

/**
 * GET /api/plaid/transactions/spend?walletAddress=0x...
 * Fetch transaction outflows for the current month via Plaid /transactions/get, aggregated by day.
 * Used by SpendTracker. Cached server-side (1–2h) to avoid excessive Plaid API calls.
 * Use ?refresh=1 to bypass cache. Optional: call /transactions/refresh before this to trigger
 * Plaid's on-demand pull from the institution, then refetch with refresh=1.
 */
router.get('/transactions/spend', async (req: Request, res: Response) => {
  try {
    const client = getPlaidClient();
    if (!client) {
      return res.status(503).json({
        error: 'Plaid not configured',
        message: 'PLAID_CLIENT_ID and PLAID_SECRET must be set',
      });
    }

    const walletAddress = req.query.walletAddress as string | undefined;
    if (!walletAddress) {
      return res.status(400).json({
        error: 'Missing walletAddress',
        message: 'Query parameter walletAddress is required',
      });
    }

    const key = walletAddress.toLowerCase();
    const items = accessTokenStore.get(key);
    if (!items?.length) {
      return res.json({
        spendingByDay: {} as SpendByDayPayload,
        totalSpent: 0,
        linked: false,
        cached: false,
      });
    }

    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0);
    const startDate = firstDay.toISOString().slice(0, 10);
    const endDate = lastDay.toISOString().slice(0, 10);

    const skipCache = req.query.refresh === '1' || req.query.refresh === 'true';
    const cacheService = await getCacheService();
    const cacheKey = CacheKeys.plaidSpend(key);
    const ttl = parseInt(process.env.CACHE_TTL_PLAID_SPEND ?? '3600', 10); // 1 hour – spending updates more often than recurring

    if (cacheService && !skipCache) {
      const cached = await cacheService.get<{ spendingByDay: SpendByDayPayload; totalSpent: number }>(cacheKey);
      if (cached) {
        return res.json({ ...cached, linked: true, cached: true });
      }
    }

    const spendingByDay: SpendByDayPayload = {};
    let totalSpent = 0;

    for (const item of items) {
      try {
        let offset = 0;
        const count = 500;
        let totalTransactions = 0;

        do {
          const request: TransactionsGetRequest = {
            access_token: item.access_token,
            start_date: startDate,
            end_date: endDate,
            options: { count, offset },
          };
          const response = await client.transactionsGet(request);
          const transactions = response.data.transactions ?? [];
          totalTransactions = response.data.total_transactions ?? 0;

          for (const tx of transactions) {
            const amount = Number(tx.amount);
            if (amount > 0) {
              const dateStr = tx.date;
              if (dateStr) {
                const day = parseInt(dateStr.slice(8, 10), 10);
                if (!Number.isNaN(day)) {
                  spendingByDay[day] = (spendingByDay[day] ?? 0) + amount;
                  totalSpent += amount;
                }
              }
            }
          }

          offset += transactions.length;
        } while (offset < totalTransactions && offset < 2500);
      } catch (itemErr: unknown) {
        const err = itemErr as { response?: { data?: { error_code?: string } }; message?: string };
        const errorCode = err.response?.data?.error_code;
        if (errorCode === 'ITEM_LOGIN_REQUIRED' || errorCode === 'INVALID_ACCESS_TOKEN') continue;
        if (errorCode === 'PRODUCTS_NOT_SUPPORTED' || errorCode === 'PRODUCT_NOT_READY') continue;
        throw itemErr;
      }
    }

    const payload = { spendingByDay, totalSpent };
    if (cacheService) await cacheService.set(cacheKey, payload, ttl);
    return res.json({ ...payload, linked: true, cached: false });
  } catch (error: unknown) {
    const err = error as { response?: { data?: unknown }; message?: string };
    console.error('Plaid transactions/spend error:', err.response?.data ?? err.message);
    res.status(500).json({
      error: 'Failed to get spend data',
      message: err.message ?? 'Unknown error',
    });
  }
});

/**
 * POST /api/plaid/disconnect
 * Remove one or all linked Plaid items for a wallet and invalidate balance cache.
 * Body: { walletAddress: string, itemId?: string }
 * - If itemId is omitted, all linked institutions are disconnected.
 * - If itemId is provided, only that institution (Plaid Item) is disconnected.
 */
router.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const { walletAddress, itemId } = req.body as { walletAddress?: string; itemId?: string };
    if (!walletAddress || typeof walletAddress !== 'string') {
      return res.status(400).json({
        error: 'Missing walletAddress',
        message: 'Request body must include walletAddress',
      });
    }
    const key = walletAddress.toLowerCase();
    const items = accessTokenStore.get(key);
    if (!items?.length) {
      return res.json({ success: true });
    }
    if (itemId) {
      const next = items.filter((i) => i.item_id !== itemId);
      if (next.length === 0) {
        accessTokenStore.delete(key);
      } else {
        accessTokenStore.set(key, next);
      }
    } else {
      accessTokenStore.delete(key);
    }
    const cacheService = await getCacheService();
    if (cacheService) {
      await cacheService.del(CacheKeys.plaidBalances(key));
      await cacheService.del(CacheKeys.plaidRecurringTransactions(key));
      await cacheService.del(CacheKeys.plaidSpend(key));
      await cacheService.del(CacheKeys.plaidInvestmentsHoldings(key));
    }
    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Plaid disconnect error:', error);
    res.status(500).json({
      error: 'Failed to disconnect',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
