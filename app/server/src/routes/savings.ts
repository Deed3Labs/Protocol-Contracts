import { Router, type Request, type Response } from 'express';
import { ethers } from 'ethers';
import { requireWalletMatch } from '../middleware/auth.js';
import { savingsIntentService } from '../services/savingsIntentService.js';
import { savingsRelayerService } from '../services/savingsRelayerService.js';
import { savingsGaslessService } from '../services/savingsGaslessService.js';
import { payLedgerStore, networkFromChainId } from '../services/payLedgerStore.js';

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

/**
 * Fully-gasless deposit/redeem. `prepare` returns the typed data the user signs (USDC EIP-3009 for
 * deposit, vault EIP-712 Redeem for redeem); `submit` hands the signature to the relayer, which
 * pays gas and calls depositWithAuthorization / redeemWithAuthorization on the vault.
 */
savingsRouter.post('/gasless/prepare', async (req: Request, res: Response) => {
  try {
    const body = req.body as { action?: unknown; ownerWallet?: unknown; amount?: unknown; chainId?: unknown };

    const action = parseAction(body.action);
    if (!action) {
      res.status(400).json({ error: 'Invalid action', message: 'action must be deposit or redeem' });
      return;
    }
    if (typeof body.ownerWallet !== 'string' || !ethers.isAddress(body.ownerWallet)) {
      res.status(400).json({ error: 'Invalid ownerWallet', message: 'ownerWallet must be a valid EVM address' });
      return;
    }
    if (!requireWalletMatch(req, res, body.ownerWallet, 'ownerWallet')) return;
    if (typeof body.amount !== 'string' || body.amount.trim().length === 0) {
      res.status(400).json({ error: 'Invalid amount', message: 'amount is required' });
      return;
    }

    const input = { chainId: parseChainId(body.chainId), ownerWallet: body.ownerWallet, amount: body.amount };
    const prepared =
      action === 'deposit'
        ? await savingsGaslessService.buildDepositTypedData(input)
        : await savingsGaslessService.buildRedeemTypedData(input);

    res.json(prepared);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to prepare gasless savings transfer',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

savingsRouter.post('/gasless/submit', async (req: Request, res: Response) => {
  try {
    const body = req.body as { action?: unknown; chainId?: unknown; signature?: unknown; submit?: Record<string, unknown> };

    const action = parseAction(body.action);
    if (!action) {
      res.status(400).json({ error: 'Invalid action', message: 'action must be deposit or redeem' });
      return;
    }
    if (typeof body.signature !== 'string' || !/^0x[a-fA-F0-9]{130}$/.test(body.signature.trim())) {
      res.status(400).json({ error: 'Invalid signature', message: 'signature must be a 65-byte hex signature' });
      return;
    }
    const submit = body.submit;
    if (!submit || typeof submit !== 'object') {
      res.status(400).json({ error: 'Invalid submit', message: 'submit params are required' });
      return;
    }

    const owner = action === 'deposit' ? submit.depositor : submit.redeemer;
    if (typeof owner !== 'string' || !ethers.isAddress(owner)) {
      res.status(400).json({ error: 'Invalid owner', message: 'submit.depositor / submit.redeemer must be a valid address' });
      return;
    }
    if (!requireWalletMatch(req, res, owner, 'ownerWallet')) return;

    // Pin the vault + token to server config — never trust the client to target an arbitrary contract.
    const config = savingsGaslessService.resolveConfig(parseChainId(body.chainId));
    if (typeof submit.token !== 'string' || ethers.getAddress(submit.token) !== config.usdcAddress) {
      res.status(400).json({ error: 'Invalid token', message: 'token must be the configured USDC for this chain' });
      return;
    }
    const sig = ethers.Signature.from(body.signature.trim());

    let txHash: string;
    if (action === 'deposit') {
      const amount = BigInt(String(submit.amount));
      if (amount <= 0n) throw new Error('amount must be greater than zero');
      txHash = await savingsRelayerService.depositWithAuthorization(config.chainId, config.vaultAddress, {
        depositor: ethers.getAddress(owner),
        token: config.usdcAddress,
        amount,
        receiver: ethers.getAddress(String(submit.receiver ?? owner)),
        validAfter: BigInt(String(submit.validAfter ?? '0')),
        validBefore: BigInt(String(submit.validBefore)),
        authNonce: String(submit.authNonce),
        v: sig.v,
        r: sig.r,
        s: sig.s,
      });
    } else {
      const clrusdAmount = BigInt(String(submit.clrusdAmount));
      if (clrusdAmount <= 0n) throw new Error('clrusdAmount must be greater than zero');

      // Pre-check liquidity so the user gets a clear message instead of a relayer gas-estimation
      // failure (redeem returns USDC 1:1, both 6-decimals, so it needs >= clrusdAmount in the vault).
      const vaultUsdc = await savingsGaslessService.vaultUsdcBalance(config);
      if (vaultUsdc < clrusdAmount) {
        res.status(409).json({
          error: 'Insufficient vault liquidity',
          message: "The savings vault doesn't have enough USDC to redeem that amount right now. Try a smaller amount.",
        });
        return;
      }

      txHash = await savingsRelayerService.redeemWithAuthorization(config.chainId, config.vaultAddress, {
        redeemer: ethers.getAddress(owner),
        token: config.usdcAddress,
        clrusdAmount,
        receiver: ethers.getAddress(String(submit.receiver ?? owner)),
        deadline: BigInt(String(submit.deadline)),
        v: sig.v,
        r: sig.r,
        s: sig.s,
      });
    }

    // Equity-credit ledger (best-effort — never fail the confirmed transfer): a deposit earns a
    // matched credit (1/$1, capped 1500/mo, 30-day vest); a redeem claws back pending deposit credits.
    try {
      const ledgerWallet = ethers.getAddress(owner).toLowerCase();
      const network = networkFromChainId(config.chainId);
      if (action === 'deposit') {
        await payLedgerStore.recordDepositMatch({ wallet: ledgerWallet, amountMicros: String(submit.amount), txRef: txHash, network });
      } else {
        await payLedgerStore.clawbackDepositMatch({ wallet: ledgerWallet, amountMicros: String(submit.clrusdAmount), network });
      }
    } catch (ledgerError) {
      console.error('[savings/gasless] equity ledger update failed:', ledgerError);
    }

    res.json({ success: true, action, chainId: config.chainId, vaultAddress: config.vaultAddress, txHash, status: 'SUBMITTED' });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to submit gasless savings transfer',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Record equity credits for an AA-submitted (client-side, ZeroDev) savings deposit/redeem — the
 * account-abstraction path settles on-chain directly, so it doesn't pass through /submit which normally
 * accrues credits. Idempotent per txHash. NOTE: trusts the authenticated wallet + amount for now;
 * mainnet should verify the tx receipt's Deposited/Redeemed event before crediting.
 */
savingsRouter.post('/gasless/record', async (req: Request, res: Response) => {
  try {
    const wallet = req.auth?.walletAddress;
    if (!wallet || !ethers.isAddress(wallet)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const body = req.body as { action?: unknown; amount?: unknown; txHash?: unknown; chainId?: unknown };
    const action = parseAction(body.action);
    if (!action) {
      res.status(400).json({ error: 'Invalid action' });
      return;
    }
    if (typeof body.txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(body.txHash)) {
      res.status(400).json({ error: 'Invalid txHash' });
      return;
    }
    const amount = String(body.amount ?? '');
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
      res.status(400).json({ error: 'Invalid amount' });
      return;
    }
    const chainId = parseChainId(body.chainId) ?? 0;
    const network = networkFromChainId(chainId);
    // Verify the tx on-chain (parse the vault's Deposited/Redeemed event) so credits can't be claimed
    // without a genuine deposit/redeem. Mainnet REQUIRES a match + uses the on-chain amount; testnet
    // falls back to the client amount if the lookup misses (keeps demo testing unblocked).
    const verified = await savingsGaslessService
      .verifySavingsTx({ chainId, txHash: body.txHash, action, wallet })
      .catch(() => null);
    if (!verified && network === 'mainnet') {
      res.status(400).json({ error: 'Unverified transaction', message: 'Could not verify the on-chain deposit/redeem for this wallet.' });
      return;
    }
    const amountMicros = (verified ?? BigInt(amount)).toString();
    const ledgerWallet = ethers.getAddress(wallet).toLowerCase();
    if (action === 'deposit') {
      await payLedgerStore.recordDepositMatch({ wallet: ledgerWallet, amountMicros, txRef: body.txHash, network });
    } else {
      await payLedgerStore.clawbackDepositMatch({ wallet: ledgerWallet, amountMicros, network });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to record credits', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default savingsRouter;
