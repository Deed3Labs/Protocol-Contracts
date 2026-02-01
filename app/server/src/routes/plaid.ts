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

const router = Router();

// In-memory store: walletAddress (lowercase) -> access_token
// Replace with Redis or DB in production for persistence across restarts
const accessTokenStore = new Map<string, string>();

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
 * Exchange public token for access token and store by wallet address
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
    const key = walletAddress.toLowerCase();
    accessTokenStore.set(key, accessToken);

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

/**
 * GET /api/plaid/balances?walletAddress=0x...
 * Get balances for linked bank accounts (keyed by wallet address)
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

    const accessToken = accessTokenStore.get(walletAddress.toLowerCase());
    if (!accessToken) {
      return res.json({
        accounts: [],
        totalBankBalance: 0,
        linked: false,
      });
    }

    const request: AccountsBalanceGetRequest = { access_token: accessToken };
    const response = await client.accountsBalanceGet(request);
    const accounts = response.data.accounts ?? [];

    const accountList = accounts.map((acc) => ({
      account_id: acc.account_id,
      name: acc.name,
      mask: acc.mask ?? undefined,
      current: acc.balances?.current ?? null,
      available: acc.balances?.available ?? null,
    }));

    let totalBankBalance = 0;
    for (const acc of accounts) {
      const current = acc.balances?.current;
      if (typeof current === 'number' && current !== null) {
        totalBankBalance += current;
      }
    }

    res.json({
      accounts: accountList,
      totalBankBalance,
      linked: true,
    });
  } catch (error: unknown) {
    const err = error as { response?: { data?: { error_code?: string } }; message?: string };
    const errorCode = err.response?.data?.error_code;
    // ITEM_LOGIN_REQUIRED or similar - user needs to re-link
    if (errorCode === 'ITEM_LOGIN_REQUIRED' || errorCode === 'INVALID_ACCESS_TOKEN') {
      const walletAddress = req.query.walletAddress as string | undefined;
      if (walletAddress) {
        accessTokenStore.delete(walletAddress.toLowerCase());
      }
      return res.json({
        accounts: [],
        totalBankBalance: 0,
        linked: false,
      });
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
 * Remove stored access token for wallet address
 * Body: { walletAddress: string }
 */
router.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.body as { walletAddress?: string };
    if (!walletAddress || typeof walletAddress !== 'string') {
      return res.status(400).json({
        error: 'Missing walletAddress',
        message: 'Request body must include walletAddress',
      });
    }
    accessTokenStore.delete(walletAddress.toLowerCase());
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
