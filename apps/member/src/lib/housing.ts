import { decodeFunctionData, getAddress, isAddress, parseAbi } from 'viem';
import { signTypedData, switchChain } from '@wagmi/core';
import { wagmiAdapter } from '@/AppKitProvider';
import { requireStepUp } from '@/lib/stepUp';
import type { CreditsOnChain, HousingHomeRecord, HousingRead, PreparedCall, RedeemTypedData } from '@/utils/apiClient';

/*
 * A member's Housing Allowance: their equity toward a Clear home, recorded on chain in the
 * HousingAllowanceRecord. One total, in two parts that are always shown apart:
 *
 *   - From credits: credits redeemed at $1 each once an ELPA is signed, up to $54,000 in all. Never
 *     cash.
 *   - Your money: savings or USDC the member sends, and fiat payments Clear records.
 *
 * The figures come from the chain through the API (GET /api/housing). Two things a member does here
 * themselves, and both are checked against the screen before anything is signed or sent:
 *
 *   - Redeem credits: they sign RedeemCredits (EIP-712, the Points Issuer's "Clear Credits" v1
 *     domain); the API submits it. `redeemMismatch` refuses typed data that is not this member, this
 *     home, this many credits, this network and this Points Issuer.
 *   - Add savings or USDC: their own wallet sends approve + contribute, straight to the home's payee.
 *     `contributeMismatch` refuses calls that do not go to this USDC and this record for this amount.
 */

export interface HousingHome extends HousingHomeRecord {
  /** The home's name from Clear's books when known, else its deed number. */
  name: string;
}

export interface Housing {
  /** The account the records are against (the member's smart account). */
  member: string;
  /** The home the member's record is live on, else the newest record they had. Null for none. */
  home: HousingHome | null;
  creditsToRedeem: number;
  creditsEarned: number;
  /** Housing Allowance credited from credits, every home included, and the lifetime limit. */
  creditPortionUsed: number;
  creditPortionCap: number;
}

export const NO_HOUSING: Housing = { member: '', home: null, creditsToRedeem: 0, creditsEarned: 0, creditPortionUsed: 0, creditPortionCap: 54_000 };

/** Credits have 6 decimals on their ledger, like USDC. */
export const CREDIT_UNITS = 1_000_000n;

/** The live record if there is one, else the most recent. */
export function pickHome(read: HousingRead | null, name?: string): HousingHome | null {
  if (!read || read.homes.length === 0) return null;
  const live = read.homes.find((h) => h.live) ?? [...read.homes].sort((a, b) => (b.signedAt ?? '').localeCompare(a.signedAt ?? ''))[0];
  return { ...live, name: name || `Home #${live.homeId}` };
}

export function housingFrom(read: HousingRead | null, credits: CreditsOnChain | null, name?: string): Housing {
  return {
    member: read?.member ?? '',
    home: pickHome(read, name),
    creditsToRedeem: credits?.balance ?? 0,
    creditsEarned: credits?.earned ?? 0,
    creditPortionUsed: read?.creditPortionUsed ?? 0,
    creditPortionCap: read?.creditPortionCap ?? NO_HOUSING.creditPortionCap,
  };
}

/** How much more can come from credits, ever. */
export const creditRoom = (h: Pick<Housing, 'creditPortionUsed' | 'creditPortionCap'>) => Math.max(0, h.creditPortionCap - h.creditPortionUsed);

/** What can be redeemed now: the credits held, no more than the room left (1 credit = $1 today). */
export const redeemableNow = (h: Housing) => Math.max(0, Math.min(Math.floor(h.creditsToRedeem), Math.floor(creditRoom(h))));

/** The share of the price each part covers, for the bar. */
export function priceShares(home: Pick<HousingHome, 'creditPortion' | 'memberPortion' | 'structurePrice'>): { credits: number; money: number } {
  const p = home.structurePrice;
  if (!(p > 0)) return { credits: 0, money: 0 };
  const credits = Math.min(100, (home.creditPortion / p) * 100);
  return { credits, money: Math.min(100 - credits, (home.memberPortion / p) * 100) };
}

const same = (a: string, b: string) => isAddress(a) && isAddress(b) && getAddress(a) === getAddress(b);

/** Why typed data is not the redemption on screen, or null when it is. */
export function redeemMismatch(args: {
  typedData: RedeemTypedData;
  shown: { member: string; homeId: string; credits: number };
  expected: { chainId: number; pointsIssuer: string };
  nowSeconds: number;
}): string | null {
  const { domain, message, primaryType } = args.typedData;
  if (primaryType !== 'RedeemCredits') return 'not a redemption';
  if (domain.name !== 'Clear Credits' || domain.version !== '1') return 'wrong signing domain';
  if (Number(domain.chainId) !== args.expected.chainId) return 'wrong network';
  if (!same(domain.verifyingContract, args.expected.pointsIssuer)) return 'wrong contract';
  if (!same(message.member, args.shown.member)) return 'wrong account';
  if (message.homeId !== args.shown.homeId) return 'wrong home';
  if (BigInt(message.amount) !== BigInt(args.shown.credits) * CREDIT_UNITS) return 'wrong amount';
  const deadline = Number(message.deadline);
  if (!(deadline > args.nowSeconds) || deadline > args.nowSeconds + 3600) return 'wrong deadline';
  return null;
}

/** Check the redemption against the screen, Face ID, then the member's own wallet signs it. */
export async function signRedeem(args: Parameters<typeof redeemMismatch>[0]): Promise<string> {
  const mismatch = redeemMismatch(args);
  if (mismatch) throw new Error(`This is not the redemption on your screen (${mismatch}). Nothing was signed.`);
  await requireStepUp();
  const config = wagmiAdapter.wagmiConfig;
  try {
    await switchChain(config, { chainId: args.expected.chainId });
  } catch {
    /* already on it, or the wallet declined: the domain binds the chain either way */
  }
  const m = args.typedData.message;
  return signTypedData(config, {
    account: args.shown.member as `0x${string}`,
    domain: { ...args.typedData.domain, verifyingContract: args.typedData.domain.verifyingContract as `0x${string}` },
    types: { RedeemCredits: args.typedData.types.RedeemCredits },
    primaryType: 'RedeemCredits',
    message: { member: m.member as `0x${string}`, homeId: BigInt(m.homeId), amount: BigInt(m.amount), nonce: BigInt(m.nonce), deadline: BigInt(m.deadline) },
  } as Parameters<typeof signTypedData>[1]);
}

const CONTRIBUTE_ABI = parseAbi(['function approve(address spender, uint256 amount)', 'function contribute(uint256 homeId, uint256 amount)']);

/** Why the API's payment calls are not the payment on screen, or null when they are. */
export function contributeMismatch(args: {
  calls: PreparedCall[];
  shown: { homeId: string; units: bigint };
  expected: { usdc: string; record: string };
}): string | null {
  if (args.calls.length !== 2) return 'unexpected calls';
  const [approve, contribute] = args.calls;
  if (BigInt(approve.value || '0') !== 0n || BigInt(contribute.value || '0') !== 0n) return 'sends ETH';
  if (!same(approve.to, args.expected.usdc) || !same(contribute.to, args.expected.record)) return 'wrong contract';
  try {
    const a = decodeFunctionData({ abi: CONTRIBUTE_ABI, data: approve.data as `0x${string}` });
    const c = decodeFunctionData({ abi: CONTRIBUTE_ABI, data: contribute.data as `0x${string}` });
    if (a.functionName !== 'approve' || c.functionName !== 'contribute') return 'unexpected calls';
    const [spender, allowance] = a.args as [string, bigint];
    const [homeId, amount] = c.args as [bigint, bigint];
    if (!same(spender, args.expected.record)) return 'wrong spender';
    if (allowance !== args.shown.units || amount !== args.shown.units) return 'wrong amount';
    if (homeId.toString() !== args.shown.homeId) return 'wrong home';
  } catch {
    return 'unreadable calls';
  }
  return null;
}

/** Dollars to USDC units (6 decimals), to the cent. */
export const usdUnits = (usd: number) => BigInt(Math.round(usd * 100)) * 10_000n;
