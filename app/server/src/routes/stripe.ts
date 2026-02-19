import { Router, Request, Response } from 'express';
import { requireWalletArrayMatch } from '../middleware/auth.js';

const router = Router();

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
      customer_ip_address,
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

    if (!wallet_addresses || typeof wallet_addresses !== 'object') {
      return res.status(400).json({
        error: 'Missing wallet_addresses',
        message: 'wallet_addresses is required',
      });
    }

    const requestWallets = Object.values(wallet_addresses).filter((value): value is string => typeof value === 'string');
    if (requestWallets.length === 0) {
      return res.status(400).json({
        error: 'Invalid wallet_addresses',
        message: 'wallet_addresses must include at least one address',
      });
    }
    if (!requireWalletArrayMatch(req, res, requestWallets, 'wallet_addresses')) return;

    // Build the request body for Stripe API
    const formData = new URLSearchParams();
    
    // Add wallet addresses
    if (wallet_addresses) {
      Object.entries(wallet_addresses).forEach(([network, address]) => {
        if (address) {
          formData.append(`wallet_addresses[${network}]`, address as string);
        }
      });
    }

    // Add optional parameters
    if (customer_ip_address) {
      formData.append('customer_ip_address', customer_ip_address);
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
    
    if (destination_amount) {
      formData.append('destination_amount', destination_amount.toString());
    }
    
    if (source_amount) {
      formData.append('source_amount', source_amount.toString());
    }

    // Add arrays for destination currencies and networks
    if (destination_currencies && Array.isArray(destination_currencies)) {
      destination_currencies.forEach((currency: string) => {
        formData.append('destination_currencies[]', currency);
      });
    }

    if (destination_networks && Array.isArray(destination_networks)) {
      destination_networks.forEach((network: string) => {
        formData.append('destination_networks[]', network);
      });
    }

    // Note: branding_settings (e.g. border_style=rectangular) may not be supported
    // on crypto/onramp_sessions - omit to avoid API errors.

    // Make request to Stripe API
    const response = await fetch('https://api.stripe.com/v1/crypto/onramp_sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const data = await response.json() as StripeOnrampSessionResponse | StripeErrorResponse;

    if (!response.ok) {
      console.error('Stripe API error:', data);
      const errorData = data as StripeErrorResponse;
      return res.status(response.status).json({
        error: 'Failed to create onramp session',
        message: errorData.error?.message || 'Unknown error',
        code: errorData.error?.code,
      });
    }

    // Return the session with client_secret
    const sessionData = data as StripeOnrampSessionResponse;
    res.json({
      id: sessionData.id,
      client_secret: sessionData.client_secret,
      status: sessionData.status,
      transaction_details: sessionData.transaction_details,
    });
  } catch (error) {
    console.error('Error creating Stripe onramp session:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
