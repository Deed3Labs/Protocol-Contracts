import { Router, Request, Response } from 'express';
import { requireWalletArrayMatch } from '../middleware/auth.js';

const router = Router();
const MAX_DESTINATION_FILTERS = 10;

// Type definitions for Stripe API responses
interface StripeError {
  message?: string;
  code?: string;
}

interface StripeErrorResponse {
  error: StripeError;
}

interface StripeOnrampSessionResponse {
  id: string;
  client_secret: string;
  status: string;
  transaction_details: {
    destination_currency: string | null;
    destination_amount: string | null;
    destination_network: string | null;
    fees: any;
    lock_wallet_address: boolean;
    source_currency: string | null;
    source_amount: string | null;
    destination_currencies: string[];
    destination_networks: string[];
    transaction_id: string | null;
    wallet_address: string | null;
    wallet_addresses: Record<string, string | null>;
  };
}

/**
 * POST /api/stripe/create-onramp-session
 * Create a Stripe crypto onramp session
 * 
 * Body parameters:
 * - wallet_addresses: Object with network keys (ethereum, solana, etc.) and wallet addresses
 * - customer_ip_address: (optional) Customer IP for supportability checks
 * - source_currency: (optional) Fiat currency (usd, eur)
 * - destination_currency: (optional) Crypto currency (eth, btc, sol, usdc, etc.)
 * - destination_network: (optional) Network (ethereum, solana, bitcoin, polygon, stellar)
 * - destination_amount: (optional) Amount of crypto to purchase
 * - source_amount: (optional) Amount of fiat to spend (mutually exclusive with destination_amount)
 */
router.post('/create-onramp-session', async (req: Request, res: Response) => {
  try {
    const {
      wallet_addresses,
      source_currency,
      destination_currency,
      destination_network,
      destination_amount,
      source_amount,
      destination_currencies,
      destination_networks,
    } = req.body;

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    
    if (!stripeSecretKey) {
      return res.status(500).json({
        error: 'Stripe not configured',
        message: 'STRIPE_SECRET_KEY environment variable is not set',
      });
    }

    if (!wallet_addresses || typeof wallet_addresses !== 'object' || Array.isArray(wallet_addresses)) {
      return res.status(400).json({
        error: 'Missing wallet_addresses',
        message: 'wallet_addresses is required',
      });
    }

    const walletEntries = Object.entries(wallet_addresses).filter(
      (entry): entry is [string, string] => {
        const [network, value] = entry;
        return (
          typeof network === 'string' &&
          network.trim().length > 0 &&
          typeof value === 'string' &&
          value.trim().length > 0
        );
      }
    );
    const requestWallets = walletEntries.map(([, value]) => value.trim());
    if (requestWallets.length === 0) {
      return res.status(400).json({
        error: 'Invalid wallet_addresses',
        message: 'wallet_addresses must include at least one address',
      });
    }
    if (requestWallets.length > MAX_DESTINATION_FILTERS) {
      return res.status(400).json({
        error: 'Too many wallet addresses',
        message: `wallet_addresses supports up to ${MAX_DESTINATION_FILTERS} entries`,
      });
    }
    if (!requireWalletArrayMatch(req, res, requestWallets, 'wallet_addresses')) return;

    const normalizedDestinationAmount = destination_amount != null ? String(destination_amount).trim() : '';
    const normalizedSourceAmount = source_amount != null ? String(source_amount).trim() : '';
    if (normalizedDestinationAmount && normalizedSourceAmount) {
      return res.status(400).json({
        error: 'Invalid amount parameters',
        message: 'Provide either destination_amount or source_amount, not both',
      });
    }
    if (normalizedDestinationAmount && (!Number.isFinite(Number(normalizedDestinationAmount)) || Number(normalizedDestinationAmount) <= 0)) {
      return res.status(400).json({
        error: 'Invalid destination_amount',
        message: 'destination_amount must be a positive number',
      });
    }
    if (normalizedSourceAmount && (!Number.isFinite(Number(normalizedSourceAmount)) || Number(normalizedSourceAmount) <= 0)) {
      return res.status(400).json({
        error: 'Invalid source_amount',
        message: 'source_amount must be a positive number',
      });
    }

    // Build the request body for Stripe API
    const formData = new URLSearchParams();
    
    // Add wallet addresses
    walletEntries.forEach(([network, address]) => {
      formData.append(`wallet_addresses[${network}]`, address.trim());
    });

    // Add optional parameters
    // Use trusted request IP instead of user-provided body input.
    if (req.ip) {
      formData.append('customer_ip_address', req.ip);
    }
    
    if (source_currency) {
      formData.append('source_currency', source_currency);
    }
    
    if (destination_currency) {
      formData.append('destination_currency', destination_currency);
    }
    
    if (destination_network) {
      formData.append('destination_network', destination_network);
    }
    
    if (normalizedDestinationAmount) {
      formData.append('destination_amount', normalizedDestinationAmount);
    }
    
    if (normalizedSourceAmount) {
      formData.append('source_amount', normalizedSourceAmount);
    }

    // Add arrays for destination currencies and networks
    if (destination_currencies && Array.isArray(destination_currencies)) {
      if (destination_currencies.length > MAX_DESTINATION_FILTERS) {
        return res.status(400).json({
          error: 'Too many destination currencies',
          message: `destination_currencies supports up to ${MAX_DESTINATION_FILTERS} entries`,
        });
      }
      destination_currencies.forEach((currency: string) => {
        formData.append('destination_currencies[]', currency);
      });
    }

    if (destination_networks && Array.isArray(destination_networks)) {
      if (destination_networks.length > MAX_DESTINATION_FILTERS) {
        return res.status(400).json({
          error: 'Too many destination networks',
          message: `destination_networks supports up to ${MAX_DESTINATION_FILTERS} entries`,
        });
      }
      destination_networks.forEach((network: string) => {
        formData.append('destination_networks[]', network);
      });
    }

    // Note: branding_settings (e.g. border_style=rectangular) may not be supported
    // on crypto/onramp_sessions - omit to avoid API errors.

    // Make request to Stripe API
    const timeoutMs = parseInt(process.env.STRIPE_API_TIMEOUT_MS || '15000', 10);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let response: globalThis.Response;
    try {
      response = await fetch('https://api.stripe.com/v1/crypto/onramp_sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripeSecretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    let data: StripeOnrampSessionResponse | StripeErrorResponse | null = null;
    try {
      data = await response.json() as StripeOnrampSessionResponse | StripeErrorResponse;
    } catch {
      data = null;
    }

    if (!response.ok) {
      console.error('Stripe API error:', data);
      const errorData = data as StripeErrorResponse | null;
      return res.status(response.status).json({
        error: 'Failed to create onramp session',
        message: errorData?.error?.message || `Stripe request failed (${response.status})`,
        code: errorData?.error?.code,
      });
    }

    // Return the session with client_secret
    if (!data || !('id' in data) || !data.client_secret) {
      return res.status(502).json({
        error: 'Invalid Stripe response',
        message: 'Stripe returned an unexpected response payload',
      });
    }
    const sessionData = data as StripeOnrampSessionResponse;
    res.json({
      id: sessionData.id,
      client_secret: sessionData.client_secret,
      status: sessionData.status,
      transaction_details: sessionData.transaction_details,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return res.status(504).json({
        error: 'Stripe timeout',
        message: 'Timed out while creating Stripe onramp session',
      });
    }
    console.error('Error creating Stripe onramp session:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
