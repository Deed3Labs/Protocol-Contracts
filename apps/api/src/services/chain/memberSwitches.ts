import { ethers } from 'ethers';
import {
  autoClearTypedData,
  savingsDrawTypedData,
  SWITCH_SIGNATURE_TTL_SECONDS,
  type AutoClearTypedData,
  type SavingsDrawTypedData,
} from '@clear/domain';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider, writesAs } from './provider.js';
import { decodeChainError, describeCreditRefusal } from './chainErrors.js';
import { setAutoRepayChoice } from './autoRepayService.js';

/*
 * The member's own switches on the revolving line, by signature (Phase 2b, 12.2 and 12.7).
 *
 * `setAutoClearWithSignature(member, on, scope, deadline, sig)` and
 * `setSavingsDrawAllowanceWithSignature(member, amount, deadline, sig)` take the member's EIP-712
 * signature (`@clear/domain` revolvingSwitches) at `memberNonces(member)`. The contract checks the
 * signature; any key may submit, and no role is needed, only gas. The API submits with the card
 * settler key, which already writes to the RevolvingIssuer.
 *
 * Onboarding uses this to turn auto-clear ON (UNSECURED_ONLY) without asking the new member for a
 * transaction. Settings may use either this or a direct wallet call.
 */

const ISSUER_ABI = [
  'function memberNonces(address) view returns (uint256)',
  'function setAutoClearWithSignature(address member, bool on, uint8 scope, uint256 deadline, bytes signature)',
  'function setSavingsDrawAllowanceWithSignature(address member, uint256 amount, uint256 deadline, bytes signature)',
];

const SIGNATURE_HEX = /^0x(?:[0-9a-fA-F]{2})+$/;

function chainId(): number {
  const parsed = Number((process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}

function submitterKey(): string {
  return (process.env.CARD_SETTLER_PRIVATE_KEY || '').trim();
}

function issuerAddress(): string | null {
  return getContractAddress(chainId(), 'RevolvingIssuer');
}

export type PrepareSwitch<T> = { ok: true; typedData: T } | { ok: false; reason: string };
export type SubmitSwitch = { ok: true; txHash: string } | { ok: false; reason: string };

async function nonceOf(wallet: string): Promise<bigint | null> {
  const address = issuerAddress();
  if (!address) return null;
  return (await new ethers.Contract(address, ISSUER_ABI, chainProvider(chainId())).memberNonces(wallet)) as bigint;
}

export async function prepareAutoClear(wallet: string, on: boolean, scope: number): Promise<PrepareSwitch<AutoClearTypedData>> {
  if (scope !== 0 && scope !== 1) return { ok: false, reason: 'That isn’t a choice automatic clearing offers.' };
  try {
    const nonce = await nonceOf(wallet);
    const address = issuerAddress();
    if (nonce === null || !address) return { ok: false, reason: 'Not available on this network yet.' };
    return {
      ok: true,
      typedData: autoClearTypedData({
        chainId: chainId(),
        revolvingIssuer: ethers.getAddress(address),
        member: ethers.getAddress(wallet),
        on,
        scope,
        nonce,
        deadline: Math.floor(Date.now() / 1000) + SWITCH_SIGNATURE_TTL_SECONDS,
      }),
    };
  } catch (error) {
    console.error('[auto-clear] prepare failed for', wallet, error instanceof Error ? error.message : error);
    return { ok: false, reason: 'We could not get that ready just now. Nothing changed.' };
  }
}

export async function prepareSavingsDrawAllowance(wallet: string, amount: bigint): Promise<PrepareSwitch<SavingsDrawTypedData>> {
  if (amount < 0n) return { ok: false, reason: 'The amount can’t be negative.' };
  try {
    const nonce = await nonceOf(wallet);
    const address = issuerAddress();
    if (nonce === null || !address) return { ok: false, reason: 'Not available on this network yet.' };
    return {
      ok: true,
      typedData: savingsDrawTypedData({
        chainId: chainId(),
        revolvingIssuer: ethers.getAddress(address),
        member: ethers.getAddress(wallet),
        amount,
        nonce,
        deadline: Math.floor(Date.now() / 1000) + SWITCH_SIGNATURE_TTL_SECONDS,
      }),
    };
  } catch (error) {
    console.error('[savings-allowance] prepare failed for', wallet, error instanceof Error ? error.message : error);
    return { ok: false, reason: 'We could not get that ready just now. Nothing changed.' };
  }
}

function checkSubmission(deadline: number, signature: string): string | null {
  if (!SIGNATURE_HEX.test(String(signature ?? '').trim())) return 'Sign the change to make it.';
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(deadline) || deadline <= now || deadline > now + SWITCH_SIGNATURE_TTL_SECONDS + 60) {
    return 'The approval you signed timed out. Nothing changed. Try again to sign it afresh.';
  }
  return null;
}

async function submit(call: (issuer: ethers.Contract) => Promise<ethers.TransactionResponse>, label: string, wallet: string): Promise<SubmitSwitch> {
  const address = issuerAddress();
  if (!address || !submitterKey()) return { ok: false, reason: 'We could not make that change just now. Nothing changed.' };
  try {
    const signer = new ethers.Wallet(submitterKey(), chainProvider(chainId()));
    const issuer = new ethers.Contract(address, ISSUER_ABI, writesAs(signer));
    const tx = await call(issuer);
    const receipt = await tx.wait(1);
    return { ok: true, txHash: receipt?.hash ?? tx.hash };
  } catch (error) {
    console.error(`[${label}] submit failed for`, wallet, error instanceof Error ? error.message : error);
    return { ok: false, reason: describeCreditRefusal(decodeChainError(error)) ?? 'That did not go through. Nothing changed.' };
  }
}

/** Submit the member's signed `AutoClear`, then record the choice once the chain shows it. */
export async function submitAutoClear(
  wallet: string,
  input: { on: boolean; scope: number; deadline: number; signature: string },
): Promise<SubmitSwitch> {
  const refused = checkSubmission(input.deadline, input.signature);
  if (refused) return { ok: false, reason: refused };
  const result = await submit(
    (issuer) => issuer.setAutoClearWithSignature(wallet, input.on, input.scope, BigInt(input.deadline), input.signature.trim()),
    'auto-clear',
    wallet,
  );
  if (result.ok) await setAutoRepayChoice(wallet, input.on, input.scope).catch(() => null);
  return result;
}

/** Submit the member's signed `SavingsDrawAllowance`. */
export async function submitSavingsDrawAllowance(
  wallet: string,
  input: { amount: string; deadline: number; signature: string },
): Promise<SubmitSwitch> {
  const refused = checkSubmission(input.deadline, input.signature);
  if (refused) return { ok: false, reason: refused };
  let amount: bigint;
  try {
    amount = BigInt(input.amount);
  } catch {
    return { ok: false, reason: 'That amount isn’t a number.' };
  }
  return submit(
    (issuer) => issuer.setSavingsDrawAllowanceWithSignature(wallet, amount, BigInt(input.deadline), input.signature.trim()),
    'savings-allowance',
    wallet,
  );
}
