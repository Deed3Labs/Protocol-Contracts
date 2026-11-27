import { ethers } from 'ethers';
import { savingsGaslessService } from '../savingsGaslessService.js';
import { savingsRelayerService } from '../savingsRelayerService.js';

/*
 * Relaying a member's signed USDC deposit into the ESA — the mint, shared.
 *
 * This is the one operation that turns a member's USDC into CLRUSD, and it exists in exactly one
 * place because two callers need it: the Savings page's own gasless deposit, and a sweep finishing
 * at `ready_to_allocate`. Two copies of a money-moving call is two places for the vault pinning to
 * drift.
 *
 * THE SERVER CANNOT DO THIS ALONE, and that is not a gap to close. The USDC belongs to the member
 * and sits on their smart wallet; moving it requires their signature. What the server contributes
 * is gas and submission — it relays an authorization the member signed, and it can do nothing
 * without one. Any design where the backend mints on a member's behalf would mean the backend can
 * spend their money.
 *
 * The vault and token addresses come from server config and are never taken from the request. A
 * caller who could name the contract could name their own.
 */

export interface DepositAuthorization {
  /** 65-byte hex signature over the USDC EIP-3009 typed data. */
  signature: string;
  submit: {
    depositor: string;
    token: string;
    amount: string;
    receiver?: string;
    validAfter?: string;
    validBefore: string;
    authNonce: string;
  };
  /**
   * Only for a receiver other than the depositor (audit M-5): the depositor's EIP-712 signature over
   * DepositIntent(depositor, token, amount, receiver, authNonce) in the vault's domain. Any length,
   * so a smart account can sign it.
   */
  intentSignature?: string;
  chainId?: number;
}

export interface DepositRelayResult {
  txHash: string;
  amount: bigint;
  chainId: number;
}

const SIGNATURE = /^0x[a-fA-F0-9]{130}$/;

/**
 * Submit a member's signed deposit and return the transaction that minted.
 *
 * Throws with a readable message on every rejection, because each one is a reason the member's
 * money did not move and the UI has to be able to say which.
 */
export async function relayEsaDeposit(auth: DepositAuthorization): Promise<DepositRelayResult> {
  const signature = String(auth.signature ?? '').trim();
  if (!SIGNATURE.test(signature)) {
    throw new Error('signature must be a 65-byte hex signature');
  }

  const submit = auth.submit;
  if (!submit || typeof submit !== 'object') throw new Error('submit params are required');

  if (!ethers.isAddress(submit.depositor)) throw new Error('submit.depositor must be a valid address');

  const config = savingsGaslessService.resolveConfig(auth.chainId);

  // Pinned to server config. Trusting the client here would let a caller point the relayer — which
  // pays gas and holds no funds of its own — at any contract they liked.
  if (!ethers.isAddress(submit.token) || ethers.getAddress(submit.token) !== config.usdcAddress) {
    throw new Error('token must be the configured USDC for this chain');
  }

  const amount = BigInt(String(submit.amount));
  if (amount <= 0n) throw new Error('amount must be greater than zero');

  const sig = ethers.Signature.from(signature);
  const depositor = ethers.getAddress(submit.depositor);
  const receiverRaw = String(submit.receiver ?? submit.depositor);
  if (!ethers.isAddress(receiverRaw)) throw new Error('submit.receiver must be a valid address');
  const receiver = ethers.getAddress(receiverRaw);
  const args = {
    depositor,
    token: config.usdcAddress,
    amount,
    receiver,
    validAfter: BigInt(String(submit.validAfter ?? '0')),
    validBefore: BigInt(String(submit.validBefore)),
    authNonce: String(submit.authNonce),
    v: sig.v,
    r: sig.r,
    s: sig.s,
  };

  /*
   * The vault mints only to the depositor (audit M-5). Anyone else is named by the depositor's own
   * signed DepositIntent, which the vault checks; without one the deposit is refused here, before
   * the relayer spends gas on a call the vault would revert.
   */
  let txHash: string;
  if (receiver === depositor) {
    txHash = await savingsRelayerService.depositWithAuthorization(config.chainId, config.vaultAddress, args);
  } else {
    const intentSignature = String(auth.intentSignature ?? '').trim();
    if (!/^0x(?:[0-9a-fA-F]{2}){65,}$/.test(intentSignature)) {
      throw new Error('a deposit to another wallet needs the depositor’s signed deposit intent');
    }
    txHash = await savingsRelayerService.depositWithAuthorizationFor(config.chainId, config.vaultAddress, {
      ...args,
      intentSignature,
    });
  }

  return { txHash, amount, chainId: config.chainId };
}
