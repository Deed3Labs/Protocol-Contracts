import { Router, type Request, type Response } from 'express';
import { ethers } from 'ethers';
import { requireWalletMatch } from '../middleware/auth.js';
import { savingsIntentService } from '../services/savingsIntentService.js';
import { savingsRelayerService } from '../services/savingsRelayerService.js';

const savingsRouter = Router();

function parseAction(value: unknown): 'deposit' | 'redeem' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'deposit' || normalized === 'redeem' ? normalized : null;
}

function parseChainId(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

savingsRouter.post('/intents/create', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      action?: unknown;
      ownerWallet?: unknown;
      receiverWallet?: unknown;
      amount?: unknown;
      chainId?: unknown;
    };

    const action = parseAction(body.action);
    if (!action) {
      res.status(400).json({
        error: 'Invalid action',
        message: 'action must be deposit or redeem',
      });
      return;
    }

    if (typeof body.ownerWallet !== 'string' || !ethers.isAddress(body.ownerWallet)) {
      res.status(400).json({
        error: 'Invalid ownerWallet',
        message: 'ownerWallet must be a valid EVM address',
      });
      return;
    }

    if (!requireWalletMatch(req, res, body.ownerWallet, 'ownerWallet')) {
      return;
    }

    if (typeof body.amount !== 'string' || body.amount.trim().length === 0) {
      res.status(400).json({
        error: 'Invalid amount',
        message: 'amount is required',
      });
      return;
    }

    const payload = await savingsIntentService.buildIntentPayload({
      action,
      ownerWallet: body.ownerWallet,
      receiverWallet:
        typeof body.receiverWallet === 'string' && ethers.isAddress(body.receiverWallet)
          ? body.receiverWallet
          : body.ownerWallet,
      amount: body.amount,
      chainId: parseChainId(body.chainId),
    });

    res.json({
      action: payload.action,
      chainId: payload.chainId,
      escrowAddress: payload.escrowAddress,
      transferToken: payload.transferToken,
      vaultToken: payload.vaultToken,
      vaultAddress: payload.vaultAddress,
      ownerWallet: payload.ownerWallet,
      receiverWallet: payload.receiverWallet,
      amount: savingsIntentService.formatMicros(BigInt(payload.amount)),
      amountMicros: payload.amount,
      expiryAt: new Date(payload.expiry * 1000).toISOString(),
      intentToken: savingsIntentService.createIntentToken(payload),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to create savings intent',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

savingsRouter.post('/intents/finalize', async (req: Request, res: Response) => {
  try {
    const body = req.body as { intentToken?: unknown; fundingTxHash?: unknown };
    if (typeof body.intentToken !== 'string' || body.intentToken.trim().length < 32) {
      res.status(400).json({
        error: 'Invalid intentToken',
        message: 'intentToken is required',
      });
      return;
    }
    if (typeof body.fundingTxHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(body.fundingTxHash.trim())) {
      res.status(400).json({
        error: 'Invalid fundingTxHash',
        message: 'fundingTxHash must be a valid transaction hash',
      });
      return;
    }

    const payload = savingsIntentService.verifyIntentToken(body.intentToken.trim());
    if (!requireWalletMatch(req, res, payload.ownerWallet, 'ownerWallet')) {
      return;
    }

    const fundingCheck = await savingsIntentService.verifyFundingTransfer(payload, body.fundingTxHash.trim());
    if (!fundingCheck.valid) {
      res.status(400).json({
        error: 'Funding transfer verification failed',
        message: fundingCheck.reason || 'Funding transfer is invalid',
      });
      return;
    }

    const existingStatus = await savingsRelayerService.getIntentStatus(payload);
    if (existingStatus === 2) {
      res.json({
        success: true,
        action: payload.action,
        escrowAddress: payload.escrowAddress,
        fundingTxHash: body.fundingTxHash.trim(),
        settlementTxHash: null,
        status: 'FINALIZED',
      });
      return;
    }
    if (existingStatus === 3) {
      res.status(409).json({
        error: 'Intent already refunded',
        message: 'This savings intent has already been refunded.',
      });
      return;
    }

    const settlementTxHash = await savingsRelayerService.settleIntent(payload);
    res.json({
      success: true,
      action: payload.action,
      escrowAddress: payload.escrowAddress,
      fundingTxHash: body.fundingTxHash.trim(),
      settlementTxHash,
      status: 'FINALIZED',
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to finalize savings intent',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

savingsRouter.post('/intents/refund', async (req: Request, res: Response) => {
  try {
    const body = req.body as { intentToken?: unknown };
    if (typeof body.intentToken !== 'string' || body.intentToken.trim().length < 32) {
      res.status(400).json({
        error: 'Invalid intentToken',
        message: 'intentToken is required',
      });
      return;
    }

    const payload = savingsIntentService.verifyIntentToken(body.intentToken.trim(), { allowExpired: true });
    if (!requireWalletMatch(req, res, payload.ownerWallet, 'ownerWallet')) {
      return;
    }

    const refundTxHash = await savingsRelayerService.refundIntent(payload);
    res.json({
      success: true,
      action: payload.action,
      escrowAddress: payload.escrowAddress,
      refundTxHash,
      status: 'REFUNDED',
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to refund savings intent',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default savingsRouter;
