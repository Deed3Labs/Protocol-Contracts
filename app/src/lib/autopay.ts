import { parseUnits } from 'viem';
import { readContract, signTypedData } from '@wagmi/core';
import { wagmiAdapter } from '@/AppKitProvider';
import { clearContracts } from '@/lib/clearNetwork';
import { createAutopayRule } from '@/utils/apiClient';

/*
 * Autopay install — "sign once, then recurring gasless deposits." The user signs TWO EIP-712 messages
 * once (no gas): (1) an EIP-2612 USDC `permit` granting the vault a standing allowance, and (2) the
 * vault's `DepositMandate` (amount, cadence, run-count, expiry). The backend relayer submits the permit
 * and then runs each due deposit via `executeMandateDeposit` — schedule enforced on-chain. Works for any
 * EOA (incl. embedded EOAs); no 7702/session-key/wallet-feature dependency.
 */

export type AutopayCadence = 'weekly' | 'monthly';

const cadenceSeconds = (c: AutopayCadence) => (c === 'weekly' ? 7 * 24 * 3600 : 30 * 24 * 3600);

const ERC20_PERMIT_ABI = [
  { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'version', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'nonces', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

/** Split a 65-byte hex signature into { v, r, s }. */
function splitSig(sig: string): { v: number; r: string; s: string } {
  const r = `0x${sig.slice(2, 66)}`;
  const s = `0x${sig.slice(66, 130)}`;
  let v = parseInt(sig.slice(130, 132), 16);
  if (v < 27) v += 27;
  return { v, r, s };
}

/**
 * Set up recurring gasless Cash→Savings deposits. The user signs the USDC permit + the vault mandate
 * once; returns nothing (the backend stores + schedules). Throws on rejection / unsupported wallet.
 */
export async function installAutopaySession(args: {
  chainId: number;
  ownerWallet: string;
  amountUsdc: number;
  cadence: AutopayCadence;
  runs: number;
}): Promise<void> {
  const config = wagmiAdapter.wagmiConfig;
  const c = clearContracts(args.chainId);
  if (!c) throw new Error(`No contracts for chain ${args.chainId}.`);
  const owner = args.ownerWallet as `0x${string}`;
  const vault = c.esaVault;
  const usdc = c.usdc;

  const runs = Math.max(1, Math.floor(args.runs));
  const amountPerRun = parseUnits(String(args.amountUsdc), 6); // USDC micros
  const interval = cadenceSeconds(args.cadence);
  const now = Math.floor(Date.now() / 1000);
  const startAt = now; // first run allowed immediately
  const expiry = now + interval * (runs + 1); // cover all runs + slack
  const nonce = BigInt(`0x${crypto.getRandomValues(new Uint8Array(16)).reduce((a, b) => a + b.toString(16).padStart(2, '0'), '')}`);

  // 1) Vault DepositMandate (the recurring schedule).
  const mandateSig = await signTypedData(config, {
    account: owner,
    domain: { name: 'ESADepositVault', version: '1', chainId: args.chainId, verifyingContract: vault },
    types: {
      DepositMandate: [
        { name: 'depositor', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'amountPerRun', type: 'uint256' },
        { name: 'interval', type: 'uint64' },
        { name: 'maxRuns', type: 'uint32' },
        { name: 'startAt', type: 'uint256' },
        { name: 'expiry', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
      ],
    },
    primaryType: 'DepositMandate',
    message: {
      depositor: owner,
      token: usdc,
      amountPerRun,
      interval: BigInt(interval),
      maxRuns: runs,
      startAt: BigInt(startAt),
      expiry: BigInt(expiry),
      nonce,
    },
  });
  const m = splitSig(mandateSig);

  // 2) EIP-2612 USDC permit (one standing allowance covering all runs).
  const [tokenName, tokenVersion, permitNonce] = await Promise.all([
    readContract(config, { abi: ERC20_PERMIT_ABI, address: usdc, functionName: 'name', chainId: args.chainId }).catch(() => 'USD Coin'),
    readContract(config, { abi: ERC20_PERMIT_ABI, address: usdc, functionName: 'version', chainId: args.chainId }).catch(() => '2'),
    readContract(config, { abi: ERC20_PERMIT_ABI, address: usdc, functionName: 'nonces', args: [owner], chainId: args.chainId }) as Promise<bigint>,
  ]);
  const permitValue = amountPerRun * BigInt(runs);
  const permitSig = await signTypedData(config, {
    account: owner,
    domain: { name: tokenName as string, version: tokenVersion as string, chainId: args.chainId, verifyingContract: usdc },
    types: {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Permit',
    message: { owner, spender: vault, value: permitValue, nonce: permitNonce, deadline: BigInt(expiry) },
  });
  const p = splitSig(permitSig);

  await createAutopayRule(args.ownerWallet, {
    chainId: args.chainId,
    amountUsdc: args.amountUsdc,
    cadence: args.cadence,
    runs,
    mandate: {
      depositor: owner,
      token: usdc,
      amountPerRun: amountPerRun.toString(),
      interval,
      maxRuns: runs,
      startAt,
      expiry,
      nonce: nonce.toString(),
      v: m.v,
      r: m.r,
      s: m.s,
    },
    permit: { value: permitValue.toString(), deadline: expiry, v: p.v, r: p.r, s: p.s },
  });
}
