import { Router, type Request, type Response } from 'express';
import { syncSavingsCollateralFromBalance, syncPoolCollateral, syncBondCollateral } from '../services/chain/savingsCollateralService.js';
import { ethers } from 'ethers';
import { requireWalletMatch, requireVerifiedWallet } from '../middleware/auth.js';
import { savingsIntentService } from '../services/savingsIntentService.js';
import { savingsRelayerService } from '../services/savingsRelayerService.js';
import { savingsGaslessService } from '../services/savingsGaslessService.js';
import { relayEsaDeposit } from '../services/savings/esaDeposit.js';
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
      // Shared with the sweep's allocate endpoint, which performs the same mint. One implementation,
      // so the vault and token pinning cannot drift between two copies of a money-moving call.
      const relayed = await relayEsaDeposit({
        signature: body.signature.trim(),
        chainId: parseChainId(body.chainId),
        submit: {
          depositor: owner,
          token: String(submit.token),
          amount: String(submit.amount),
          receiver: submit.receiver === undefined ? undefined : String(submit.receiver),
          validAfter: submit.validAfter === undefined ? undefined : String(submit.validAfter),
          validBefore: String(submit.validBefore),
          authNonce: String(submit.authNonce),
        },
      });
      txHash = relayed.txHash;
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

    /*
     * Make the savings back the credit line.
     *
     * Minting CLRUSD is not what moves a member's limit — the registry reads what is *pledged*,
     * not what is held, so without this a deposit lands and the savings tier stays at zero. That
     * is what it did.
     *
     * Synced to the balance rather than adjusted by this transfer's amount, so a pledge that
     * drifted for any reason (a sweep, a failed earlier sync, a redeem that raced this) is
     * corrected rather than compounded.
     *
     * Best-effort, like the ledger above and for the same reason: the transfer is already on
     * chain. A member whose follow-up write failed has their money and an unmoved limit, which is
     * recoverable; a member whose confirmed deposit was reported as failed is not.
     */
    void syncSavingsCollateralFromBalance(ethers.getAddress(owner)).then((result) => {
      if (!result.ok) console.error('[savings/gasless] collateral sync failed:', result.reason);
    });

    res.json({ success: true, action, chainId: config.chainId, vaultAddress: config.vaultAddress, txHash, status: 'SUBMITTED' });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to submit gasless savings transfer',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Gasless move of USDC FROM a linked external wallet → the user's Clear smart wallet (the reverse of a
 * Cash→linked transfer, and the first leg of gasless move-then-withdraw). The linked EOA signs an EIP-3009
 * TransferWithAuthorization; the relayer submits it + pays gas. Source must be a VERIFIED wallet of the
 * user (linked), destination is server-pinned to their smart wallet, token pinned to USDC.
 */
savingsRouter.post('/gasless/wallet-transfer/prepare', async (req: Request, res: Response) => {
  try {
    const body = req.body as { fromWallet?: unknown; amount?: unknown; chainId?: unknown };
    if (typeof body.fromWallet !== 'string' || !ethers.isAddress(body.fromWallet)) {
      res.status(400).json({ error: 'Invalid fromWallet', message: 'fromWallet must be a valid EVM address' });
      return;
    }
    // The source must be one of THIS user's verified wallets (a linked external wallet).
    if (!requireVerifiedWallet(req, res, body.fromWallet, 'fromWallet')) return;
    // Destination is ALWAYS the user's own smart wallet — server-pinned, never client-chosen.
    const toWallet = req.auth?.smartWallet;
    if (!toWallet || !ethers.isAddress(toWallet)) {
      res.status(400).json({ error: 'No smart wallet', message: 'Your Clear account is still setting up. Try again shortly.' });
      return;
    }
    if (ethers.getAddress(body.fromWallet) === ethers.getAddress(toWallet)) {
      res.status(400).json({ error: 'Same wallet', message: 'Source and destination are the same wallet.' });
      return;
    }
    if (typeof body.amount !== 'string' || body.amount.trim().length === 0) {
      res.status(400).json({ error: 'Invalid amount', message: 'amount is required' });
      return;
    }
    const prepared = await savingsGaslessService.buildWalletTransferTypedData({
      chainId: parseChainId(body.chainId),
      fromWallet: body.fromWallet,
      toWallet,
      amount: body.amount,
    });
    res.json(prepared);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to prepare wallet transfer',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

savingsRouter.post('/gasless/wallet-transfer/submit', async (req: Request, res: Response) => {
  try {
    const body = req.body as { chainId?: unknown; signature?: unknown; submit?: Record<string, unknown> };
    if (typeof body.signature !== 'string' || !/^0x[a-fA-F0-9]{130}$/.test(body.signature.trim())) {
      res.status(400).json({ error: 'Invalid signature', message: 'signature must be a 65-byte hex signature' });
      return;
    }
    const submit = body.submit;
    if (!submit || typeof submit !== 'object') {
      res.status(400).json({ error: 'Invalid submit', message: 'submit params are required' });
      return;
    }
    const from = submit.from;
    if (typeof from !== 'string' || !ethers.isAddress(from)) {
      res.status(400).json({ error: 'Invalid from', message: 'submit.from must be a valid address' });
      return;
    }
    if (!requireVerifiedWallet(req, res, from, 'from')) return;

    // Pin destination to the user's smart wallet + token to the configured USDC — never trust the client.
    const config = savingsGaslessService.resolveConfig(parseChainId(body.chainId));
    const toWallet = req.auth?.smartWallet;
    if (!toWallet || typeof submit.to !== 'string' || ethers.getAddress(String(submit.to)) !== ethers.getAddress(toWallet)) {
      res.status(400).json({ error: 'Invalid to', message: 'Destination must be your Clear account.' });
      return;
    }
    if (typeof submit.token !== 'string' || ethers.getAddress(submit.token) !== config.usdcAddress) {
      res.status(400).json({ error: 'Invalid token', message: 'token must be the configured USDC for this chain' });
      return;
    }
    const value = BigInt(String(submit.value));
    if (value <= 0n) throw new Error('value must be greater than zero');
    const sig = ethers.Signature.from(body.signature.trim());

    const txHash = await savingsRelayerService.transferWithAuthorization(config.chainId, config.usdcAddress, {
      from: ethers.getAddress(from),
      to: ethers.getAddress(toWallet),
      value,
      validAfter: BigInt(String(submit.validAfter ?? '0')),
      validBefore: BigInt(String(submit.validBefore)),
      nonce: String(submit.authNonce),
      v: sig.v,
      r: sig.r,
      s: sig.s,
    });

    res.json({ success: true, action: 'wallet-transfer', chainId: config.chainId, txHash, status: 'SUBMITTED' });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to submit wallet transfer',
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
/**
 * A yield-pool movement landed on chain; pledge the position behind it.
 *
 * Its own route rather than a third action on `/gasless/record`, because that route's body is
 * about a vault deposit -- it verifies the ESA's own event and writes the equity-credit match, and
 * neither applies to the pool. A pool deposit earns yield, not credits.
 *
 * Nothing is trusted from the body but the fact that something happened: the position is read back
 * from the pool and the pledge is synced to it, so a wrong or replayed amount changes nothing.
 */
savingsRouter.post('/pool/record', async (req: Request, res: Response) => {
  try {
    const wallet = req.auth?.walletAddress;
    if (!wallet || !ethers.isAddress(wallet)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await syncPoolCollateral(ethers.getAddress(wallet));
    if (!result.ok) console.error('[pool/record] collateral sync failed:', result.reason);

    // Answered as accepted either way. The movement is already on chain; a failed pledge leaves a
    // position that backs nothing yet, which the next movement or a manual sync repairs -- and
    // reporting failure here would tell a member their deposit did not work when it did.
    res.json({ success: true, pledged: result.ok });
  } catch (error) {
    console.error('[pool/record] failed:', error);
    res.status(500).json({ error: 'Failed to record pool movement' });
  }
});

/**
 * A bond was bought; pledge it.
 *
 * Takes no amount, which is the point: bonds pledge by identity, so the server reads which ones
 * the member holds and reconciles the pledged set against it. There is nothing in the body worth
 * lying about.
 */
savingsRouter.post('/bond/record', async (req: Request, res: Response) => {
  try {
    const wallet = req.auth?.walletAddress;
    if (!wallet || !ethers.isAddress(wallet)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await syncBondCollateral(ethers.getAddress(wallet));
    if (!result.ok) console.error('[bond/record] collateral sync failed:', result.reason);

    // Accepted either way: the purchase is already on chain, and reporting failure here would tell
    // a member their bond did not mint when it did.
    res.json({ success: true, pledged: result.ok });
  } catch (error) {
    console.error('[bond/record] failed:', error);
    res.status(500).json({ error: 'Failed to record bond purchase' });
  }
});

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

    // Make the savings back the credit line. This is the path a smart-account deposit takes -- the
    // sponsored UserOp goes straight to the vault and reports here, never through /gasless/submit,
    // so the sync living only there fired for the relayer fallback and not for the common case.
    // That is why a first deposit needed a manual backfill and a second did not move the line.
    // Synced to the balance, so it does not matter that this and /submit both run it.
    void syncSavingsCollateralFromBalance(ethers.getAddress(wallet)).then((result) => {
      if (!result.ok) console.error('[savings/record] collateral sync failed:', result.reason);
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to record credits', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default savingsRouter;
