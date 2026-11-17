import { ethers } from 'ethers';
import { getContractAddress } from '../../config/contracts.js';

/*
 * The Assurance fee payer's configuration (docs/operators/assurance-fee-payer.md). Everything is env,
 * keyed by chain where it names an address, as config/contracts.ts is. Off by default: with no pool
 * address nothing runs, and nothing is ever sent unless ASSURANCE_FEE_PAYER_ENABLED is on.
 *
 * The pool is AssurancePoolV2 (`ASSURANCE_POOL_V2_<chain>`), not `ASSURANCE_POOL_<chain>`: that one
 * still names the Phase 1 reserve the Money page reads (primaryBalance, RTD), which has none of the
 * views this needs. Until the new pool is deployed and its address set, the payer stays off.
 */

type Env = Record<string, string | undefined>;

/** The addresses already settled on Base Sepolia (docs/audit/SEPOLIA-OWNER-CHECKLIST.md). */
const DEFAULTS: Record<number, { clFees: string; clOperating: string; clearLendingSafe: string; treasurySafe: string; cdpAccount: string }> = {
  84532: {
    // Clear Lending's CL Fees CDP wallet: the payer for CREDIT_ENHANCEMENT_FEE and RECOVERY
    clFees: '0xB9ed7ea800c3a32a8F2cf7d2aB50AE2d4831cDFd',
    // where Clear Lending's money lands (ClearCredit's lenderOperating) and the pool's draw address
    clOperating: '0xfAFf1081F77bF528bA21eea590f251a755bCdf65',
    // CL Operating's one owner
    clearLendingSafe: '0xAE8FF4Fa84d786Ece2C7Ab87886A2CD6086c419d',
    // the co-op's Clear Treasury Safe: the payer for INTERCHANGE and BOARD_ALLOCATION
    treasurySafe: '0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50',
    cdpAccount: 'cl-fees-base-sepolia',
  },
};

export interface AssuranceFeeConfig {
  chainId: number;
  /** AssurancePoolV2, or null until it's deployed. */
  pool: string | null;
  clFees: string | null;
  clOperating: string | null;
  clearLendingSafe: string | null;
  treasurySafe: string | null;
  /** Whether the job may send the approve and deposit. */
  payerEnabled: boolean;
  /** cdp_server_wallet (default) or local_key (dev only). */
  payerMode: 'cdp_server_wallet' | 'local_key';
  cdpAccountName: string | null;
  /** The fee a year, in basis points: 800 = 8%. */
  feeBps: bigint;
  /** The co-op's interchange policy, in basis points: 2500 = 25%. */
  interchangeBps: bigint;
}

const on = (v: string | undefined) => /^(1|true|on|yes)$/i.test((v ?? '').trim());

function address(raw: string | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v || !ethers.isAddress(v) || v === ethers.ZeroAddress) return null;
  return ethers.getAddress(v);
}

function bps(raw: string | undefined, fallback: bigint): bigint {
  const v = (raw ?? '').trim();
  if (!/^\d+$/.test(v)) return fallback;
  const n = BigInt(v);
  return n > 0n && n <= 10_000n ? n : fallback;
}

export function assuranceChainId(env: Env = process.env): number {
  for (const name of ['ASSURANCE_CHAIN_ID', 'SAVINGS_DEFAULT_CHAIN_ID', 'SEND_DEFAULT_CHAIN_ID']) {
    const n = Number((env[name] ?? '').trim());
    if (Number.isInteger(n) && n > 0) return n;
  }
  return 84532;
}

export function assuranceFeeConfig(env: Env = process.env): AssuranceFeeConfig {
  const chainId = assuranceChainId(env);
  const d = DEFAULTS[chainId];
  const pick = (name: string, fallback?: string) => address(env[`${name}_${chainId}`] ?? env[name] ?? fallback);
  const mode = (env.ASSURANCE_FEE_PAYER_MODE ?? '').trim().toLowerCase() === 'local_key' ? 'local_key' : 'cdp_server_wallet';
  const cdpAccountName = (env[`ASSURANCE_FEE_PAYER_CDP_ACCOUNT_NAME_${chainId}`] ?? env.ASSURANCE_FEE_PAYER_CDP_ACCOUNT_NAME ?? d?.cdpAccount ?? '').trim() || null;
  return {
    chainId,
    // config/contracts.ts reads the same variable when the server starts; a test's own env is read here
    pool: address(env[`ASSURANCE_POOL_V2_${chainId}`] ?? (env === process.env ? (getContractAddress(chainId, 'AssurancePoolV2') ?? undefined) : undefined)),
    clFees: pick('ASSURANCE_CL_FEES_ADDRESS', d?.clFees),
    clOperating: pick('ASSURANCE_CL_OPERATING_ADDRESS', d?.clOperating),
    clearLendingSafe: pick('ASSURANCE_CLEAR_LENDING_SAFE', d?.clearLendingSafe),
    treasurySafe: pick('ASSURANCE_TREASURY_SAFE', d?.treasurySafe),
    payerEnabled: on(env.ASSURANCE_FEE_PAYER_ENABLED),
    payerMode: mode,
    cdpAccountName,
    feeBps: bps(env.ASSURANCE_FEE_BPS, 800n),
    interchangeBps: bps(env.ASSURANCE_INTERCHANGE_BPS, 2500n),
  };
}

/** A block explorer link for a transaction, where we know the chain's explorer. */
export function txLink(chainId: number, hash: string | null | undefined): string | null {
  if (!hash) return null;
  const base = { 84532: 'https://sepolia.basescan.org', 8453: 'https://basescan.org' }[chainId];
  return base ? `${base}/tx/${hash}` : null;
}
