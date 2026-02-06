import { Router, Request, Response } from 'express';
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
  type LinkTokenCreateRequest,
  type ItemPublicTokenExchangeRequest,
  type AccountsBalanceGetRequest,
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
      products: [Products.Auth],
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

    for (const item of items) {
      try {
        const request: AccountsBalanceGetRequest = { access_token: item.access_token };
        const response = await client.accountsBalanceGet(request);
        const accounts = response.data.accounts ?? [];
        stillValidItems.push(item);
        for (const acc of accounts) {
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
    if (cacheService) await cacheService.del(CacheKeys.plaidBalances(key));
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
