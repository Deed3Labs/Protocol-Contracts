import { Router, Request, Response } from 'express';

const router = Router();

/**
 * POST /api/bridge/funding-url
 * Returns a URL to open Bridge (ACH/wire) funding flow with wallet, amount, destination currency and network.
 * Body: { walletAddress, amount, destinationCurrency, destinationNetwork }
 * Returns: { url: string } or 501 if Bridge is not configured.
 */
router.post('/funding-url', async (req: Request, res: Response) => {
  try {
    const { walletAddress, amount, destinationCurrency, destinationNetwork } = req.body;

    if (!walletAddress || !amount || !destinationCurrency || !destinationNetwork) {
      return res.status(400).json({
        error: 'Missing parameters',
        message: 'walletAddress, amount, destinationCurrency, and destinationNetwork are required',
      });
    }

    const bridgeBaseUrl = process.env.BRIDGE_FUNDING_URL_BASE || process.env.BRIDGE_BASE_URL;
    const bridgeApiKey = process.env.BRIDGE_API_KEY;

    // If Bridge provides a client URL with query params, build it
    if (bridgeBaseUrl) {
      const params = new URLSearchParams({
        wallet: walletAddress,
        amount: String(amount),
        currency: String(destinationCurrency).toUpperCase(),
        network: String(destinationNetwork).toLowerCase(),
      });
      const url = `${bridgeBaseUrl.replace(/\/$/, '')}?${params.toString()}`;
      return res.json({ url });
    }

    // Optional: call Bridge API to create a session and return their redirect URL (when BRIDGE_API_KEY is set)
    if (bridgeApiKey) {
      // Placeholder for Bridge API session creation (e.g. bridge.xyz or similar)
      // const bridgeResponse = await fetch('https://api.bridge.xyz/v1/sessions', { ... });
      // return res.json({ url: bridgeResponse.redirect_url });
    }

    // Not configured: return a placeholder so client can still show "Funding complete" message
    // Client will open nothing and show the 1-3 business days message
    return res.status(501).json({
      error: 'Bridge not configured',
      message: 'Set BRIDGE_FUNDING_URL_BASE or BRIDGE_API_KEY to enable bank funding',
      url: null,
    });
  } catch (error) {
    console.error('Bridge funding-url error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
