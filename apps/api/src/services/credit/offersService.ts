import { ethers } from 'ethers';
import { getPostgresPool } from '../../config/postgres.js';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider, writesAs } from '../chain/provider.js';
import { asOperator } from '../chain/operatorQueue.js';
import { memberWallets, verified } from './termLimitService.js';

/*
 * The co-op's $10 to each new member, from OffersIssuer's capped line.
 *
 * A verified member who hasn't had one is given it: the contract draws it from its own line, so the
 * co-op owes it there and nothing is funded in advance. An offer left unspent past its window comes
 * back off the member and off the line. And the line is paid down from the Safe's USDC, up to the
 * allowance the Safe has given the contract, whenever there is something owed and an allowance to
 * pay it with. The contract enforces one per member and the cap; this only decides when to ask.
 *
 * Everything that touches the chain or a database comes in as `deps`, so the behaviour can be
 * tested with none of them.
 */

const ISSUER_ABI = [
  'function grantedAt(address member) view returns (uint64)',
  'function expiresAt(address member) view returns (uint256)',
  'function owed() view returns (uint256)',
  'function offersLeft() view returns (uint256)',
  'function treasuryAvailable() view returns (uint256)',
  'function grant(address member)',
  'function expire(address member) returns (uint256)',
  'function settle() returns (uint256)',
];

function chainId(): number {
  const parsed = Number((process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}
const operatorKey = () => (process.env.CREDIT_OPERATOR_PRIVATE_KEY || '').trim();
const issuerAddress = () => getContractAddress(chainId(), 'OffersIssuer');

/**
 * Whether offers are given automatically. On in test (Base Sepolia) unless switched off, and off
 * everywhere else until `AUTO_OFFERS=on`: money handed to real members waits to be signed off.
 */
export function autoOffersOn(): boolean {
  const flag = (process.env.AUTO_OFFERS ?? '').trim();
  if (flag === 'on') return true;
  if (flag) return false;
  return chainId() === 84532;
}

/** The contract, the operator key, and the database the members are in. */
export function isOffersConfigured(): boolean {
  return Boolean(issuerAddress() && operatorKey() && getPostgresPool());
}

export interface OfferState {
  /** When they were given it, ms; 0 if never. */
  grantedAt: number;
  /** When what's left of it can come back, ms; 0 if nothing is left. */
  expiresAt: number;
}

export interface LineState {
  owed: bigint;
  offersLeft: bigint;
  treasuryAvailable: bigint;
}

export interface OffersDeps {
  enabled(): boolean;
  configured(): boolean;
  now(): number;
  memberWallets(): Promise<string[]>;
  verified(wallet: string): Promise<boolean>;
  readOffer(wallet: string): Promise<OfferState>;
  readLine(): Promise<LineState>;
  /** Each sends its transaction, waits for it to land, and returns its hash. */
  grant(wallet: string): Promise<string>;
  expire(wallet: string): Promise<string>;
  settle(): Promise<string>;
}

export interface OfferResult {
  wallet: string;
  action: 'granted' | 'expired' | 'has-one' | 'unverified' | 'cap-reached' | 'failed';
  txHash?: string;
  reason?: string;
}

export interface OffersPass {
  results: OfferResult[];
  /** The line paid down this pass, when it was. */
  settled?: string;
}

// ---------------------------------------------------------------------------------------------
// The real dependencies.
// ---------------------------------------------------------------------------------------------

function issuer(runner: ethers.ContractRunner): ethers.Contract {
  return new ethers.Contract(issuerAddress()!, ISSUER_ABI, runner);
}

let writer: ethers.Contract | null = null;
function write(): ethers.Contract {
  if (!writer) writer = issuer(writesAs(new ethers.Wallet(operatorKey(), chainProvider(chainId()))));
  return writer;
}

async function send(tx: Promise<ethers.ContractTransactionResponse>): Promise<string> {
  const sent = await tx;
  await sent.wait(1);
  return sent.hash;
}

export const realOffersDeps: OffersDeps = {
  enabled: autoOffersOn,
  configured: isOffersConfigured,
  now: () => Date.now(),
  memberWallets,
  verified,
  readOffer: async (wallet) => {
    const c = issuer(chainProvider(chainId()));
    const [granted, expires] = await Promise.all([c.grantedAt(wallet) as Promise<bigint>, c.expiresAt(wallet) as Promise<bigint>]);
    return { grantedAt: Number(granted) * 1000, expiresAt: Number(expires) * 1000 };
  },
  readLine: async () => {
    const c = issuer(chainProvider(chainId()));
    const [owed, offersLeft, treasuryAvailable] = await Promise.all([c.owed(), c.offersLeft(), c.treasuryAvailable()]);
    return { owed: BigInt(owed), offersLeft: BigInt(offersLeft), treasuryAvailable: BigInt(treasuryAvailable) };
  },
  grant: (wallet) => send(write().grant(wallet)),
  expire: (wallet) => send(write().expire(wallet)),
  settle: () => send(write().settle()),
};

// ---------------------------------------------------------------------------------------------
// The rule, applied.
// ---------------------------------------------------------------------------------------------

function failure(wallet: string, error: unknown): OfferResult {
  const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
  console.error(`[offers] ${wallet} failed: ${reason}`);
  return { wallet, action: 'failed', reason };
}

async function evaluate(wallet: string, deps: OffersDeps): Promise<OfferResult> {
  const offer = await deps.readOffer(wallet);
  if (offer.grantedAt) {
    // Given already: what's left of it comes back once its window has passed.
    if (offer.expiresAt && deps.now() >= offer.expiresAt) {
      const txHash = await deps.expire(wallet);
      console.log(`[offers] ${wallet} unspent offer expired (${txHash})`);
      return { wallet, action: 'expired', txHash };
    }
    return { wallet, action: 'has-one' };
  }
  if (!(await deps.verified(wallet))) return { wallet, action: 'unverified' };
  // Read again inside the queue: a grant ahead of this one may have used the last of the cap.
  if ((await deps.readLine()).offersLeft === 0n) return { wallet, action: 'cap-reached' };
  const txHash = await deps.grant(wallet);
  console.log(`[offers] ${wallet} given their offer (${txHash})`);
  return { wallet, action: 'granted', txHash };
}

/**
 * The offer, for a member who has just finished joining. Never throws: it runs fire-and-forget at
 * the end of a request, and the hourly pass catches anyone it misses.
 */
export async function grantOffer(wallet: string, deps: OffersDeps = realOffersDeps): Promise<OfferResult | null> {
  const w = String(wallet || '').trim().toLowerCase();
  if (!w || !deps.configured() || !deps.enabled()) return null;
  try {
    return await asOperator(() => evaluate(w, deps));
  } catch (error) {
    return failure(w, error);
  }
}

/** Every member once: give the offer to whoever is due one, take back what has expired, and pay the line down. */
export async function reviewOffers(deps: OffersDeps = realOffersDeps): Promise<OffersPass> {
  if (!deps.configured() || !deps.enabled()) return { results: [] };
  const results: OfferResult[] = [];
  for (const wallet of await deps.memberWallets()) {
    const w = wallet.toLowerCase();
    try {
      results.push(await asOperator(() => evaluate(w, deps)));
    } catch (error) {
      results.push(failure(w, error));
    }
  }
  // Paid down whenever something is owed and the Safe has allowed something to pay it with. The
  // repayment goes to the payout pool first, so shops redeeming offers are paid out of it.
  let settled: string | undefined;
  try {
    const line = await deps.readLine();
    if (line.owed > 0n && line.treasuryAvailable > 0n) {
      settled = await asOperator(() => deps.settle());
      console.log(`[offers] line paid down (${settled})`);
    }
  } catch (error) {
    console.error(`[offers] paying the line down failed: ${(error as Error)?.message}`);
  }
  return { results, settled };
}
