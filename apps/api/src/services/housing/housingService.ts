import { ethers } from 'ethers';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider } from '../chain/provider.js';
import { scanLogs } from '../chain/logScan.js';
import { keeperChainId, liveRunner, type CallRunner } from '../chain/keeperKit.js';
import { describeHousingRefusal } from '../chain/chainErrors.js';
import { asOperator } from '../chain/operatorQueue.js';
import { CREDIT_UNITS } from '../chain/creditsMint.js';

/*
 * A member's Housing Allowance, read from the HousingAllowanceRecord, and the two things a member does
 * to it themselves:
 *
 *   - Redeem credits into the Credit Portion. The member signs RedeemCredits (EIP-712, domain
 *     "Clear Credits" v1 on the Points Issuer); the API submits PointsIssuer.redeem with that signature
 *     from the credit operator's wallet, which only pays the gas. The contracts decide everything: an
 *     ELPA must be signed for the home, the $54,000 lifetime cap, the member's balance.
 *   - Pay toward the home in USDC (the Member Portion). The API prepares the two calls the member's
 *     own wallet sends: approve the record for the amount, then contribute(homeId, amount), which moves
 *     the USDC straight from the member to the home's payee. The API never holds or moves it.
 *
 * Opening a record, recording a fiat payment, moves, ends and price changes are the writer's (the
 * Clear Treasury Safe's), proposed and approved by two people in Command (services/command).
 *
 * Amounts on chain are USD and credits at 6 decimals; here they are dollars and whole credits.
 */

export const RECORD_ABI = [
  'function recordOf(address member, uint256 homeId) view returns (tuple(uint128 creditPortion, uint128 memberPortion, uint128 structurePrice, uint128 refundDue, uint64 signedAt, uint64 endedAt, uint8 status))',
  'function occupantOf(uint256 homeId) view returns (address)',
  'function payeeOf(uint256 homeId) view returns (address)',
  'function isRedeemable(uint256 homeId) view returns (bool)',
  'function lifetimeCreditPortion(address member) view returns (uint256)',
  'function creditCap() view returns (uint256)',
  'function usdc() view returns (address)',
  'function contribute(uint256 homeId, uint256 amount)',
  'event RecordOpened(address indexed member, uint256 indexed homeId, uint256 structurePrice, uint256 carriedCredit, bytes32 ref)',
  'event Moved(address indexed member, uint256 indexed fromHome, uint256 indexed toHome, uint256 deductions, uint256 credit, uint256 refundDue, bytes32 ref)',
] as const;

export const ISSUER_REDEEM_ABI = [
  'function redeem(address member, uint256 homeId, uint256 amount, uint256 deadline, bytes sig) returns (uint256)',
  'function nonces(address member) view returns (uint256)',
  'function quote(address member, uint256 amount) view returns (uint256)',
  'function balanceOf(address member) view returns (uint256)',
] as const;

const ERC20_APPROVE = ['function approve(address spender, uint256 amount) returns (bool)'] as const;

export const STATUS = ['none', 'signed', 'redeemed', 'moved', 'ended', 'lapsed'] as const;
export type HousingStatus = (typeof STATUS)[number];

/** Where the record was deployed on Base Sepolia (deploy 29): nothing of it exists before. */
export const RECORD_START_BLOCK: Record<number, number> = { 84532: 63_636_000 };

/** How long a member has to sign a redemption before it expires. */
const REDEEM_WINDOW_SECONDS = 30 * 60;

const USD = 1_000_000n;
const dollars = (v: bigint) => Number(v) / Number(USD);
const usdUnits = (d: number) => BigInt(Math.round(d * 100)) * (USD / 100n);

export class HousingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface HomeRecord {
  homeId: string;
  status: HousingStatus;
  structurePrice: number;
  creditPortion: number;
  memberPortion: number;
  total: number;
  refundDue: number;
  signedAt: string | null;
  endedAt: string | null;
  /** The member's record is the live one on this home. */
  live: boolean;
  redeemable: boolean;
  /** Payments toward the home can be made (the admin has set where they go). */
  payable: boolean;
}

export interface HousingView {
  member: string;
  homes: HomeRecord[];
  /** Housing Allowance credited from credits, every home and lapsed amounts included, and its cap. */
  creditPortionUsed: number;
  creditPortionCap: number;
}

type Raw = { creditPortion: bigint; memberPortion: bigint; structurePrice: bigint; refundDue: bigint; signedAt: bigint; endedAt: bigint; status: bigint | number };

/** What the service reads and sends. Injected, so tests use a fake chain. */
export interface HousingChain {
  chainId: number;
  record: string;
  issuer: string;
  /** Every home this member has had a record on: opened, or moved into or out of. */
  homesOf(member: string): Promise<bigint[]>;
  recordOf(member: string, homeId: bigint): Promise<Raw>;
  occupantOf(homeId: bigint): Promise<string>;
  payeeOf(homeId: bigint): Promise<string>;
  isRedeemable(homeId: bigint): Promise<boolean>;
  lifetimeCreditPortion(member: string): Promise<bigint>;
  creditCap(): Promise<bigint>;
  usdc(): Promise<string>;
  nonces(member: string): Promise<bigint>;
  quote(member: string, amount: bigint): Promise<bigint>;
  creditBalance(member: string): Promise<bigint>;
  /** The relayer that submits a signed redemption: simulates, then sends. */
  relayer: CallRunner | null;
  now(): number;
}

const RECORD = new ethers.Interface(RECORD_ABI as unknown as string[]);
const ISSUER = new ethers.Interface(ISSUER_REDEEM_ABI as unknown as string[]);
const ERC20 = new ethers.Interface(ERC20_APPROVE as unknown as string[]);

const iso = (s: bigint) => (s > 0n ? new Date(Number(s) * 1000).toISOString() : null);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function parseHomeId(raw: unknown): bigint {
  const s = String(raw ?? '').trim();
  if (!/^\d{1,78}$/.test(s) || BigInt(s) === 0n) throw new HousingError(400, 'BAD_HOME', 'A home is its Clear Deed’s token id: a whole number');
  return BigInt(s);
}

export async function readHousing(chain: HousingChain, member: string): Promise<HousingView> {
  const [ids, used, cap] = await Promise.all([chain.homesOf(member), chain.lifetimeCreditPortion(member), chain.creditCap()]);
  const homes = await Promise.all(
    ids.map(async (homeId): Promise<HomeRecord> => {
      const [r, occupant, payee, redeemable] = await Promise.all([chain.recordOf(member, homeId), chain.occupantOf(homeId), chain.payeeOf(homeId), chain.isRedeemable(homeId)]);
      const live = same(occupant, member);
      return {
        homeId: homeId.toString(),
        status: STATUS[Number(r.status)] ?? 'none',
        structurePrice: dollars(r.structurePrice),
        creditPortion: dollars(r.creditPortion),
        memberPortion: dollars(r.memberPortion),
        total: dollars(r.creditPortion + r.memberPortion),
        refundDue: dollars(r.refundDue),
        signedAt: iso(r.signedAt),
        endedAt: iso(r.endedAt),
        live,
        redeemable: live && redeemable,
        payable: payee !== ethers.ZeroAddress,
      };
    }),
  );
  return { member, homes, creditPortionUsed: dollars(used), creditPortionCap: dollars(cap) };
}

async function signedRecord(chain: HousingChain, member: string, homeId: bigint): Promise<Raw> {
  const r = await chain.recordOf(member, homeId);
  if (STATUS[Number(r.status)] !== 'signed') {
    throw new HousingError(409, 'NOT_SIGNED', 'This wallet has no signed ELPA for that home, so nothing can go into its Housing Allowance');
  }
  return r;
}

/**
 * What the member signs to redeem `credits` into a home's Housing Allowance, and what it would add.
 * Refused here when it plainly can't succeed (no signed record, not enough credits, past the cap), so
 * the member is never asked to sign something the chain would refuse.
 */
export async function prepareRedeem(chain: HousingChain, member: string, homeId: bigint, credits: number) {
  if (!Number.isInteger(credits) || credits <= 0) throw new HousingError(400, 'BAD_AMOUNT', 'Redeem a whole number of credits');
  await signedRecord(chain, member, homeId);
  const amount = BigInt(credits) * CREDIT_UNITS;
  const [balance, nonce, usd, used, cap] = await Promise.all([
    chain.creditBalance(member),
    chain.nonces(member),
    chain.quote(member, amount),
    chain.lifetimeCreditPortion(member),
    chain.creditCap(),
  ]);
  if (balance < amount) throw new HousingError(409, 'NOT_ENOUGH', `You have ${Number(balance / CREDIT_UNITS)} credits`);
  if (used + usd > cap) throw new HousingError(409, 'OVER_CAP', `That would pass the $${dollars(cap).toLocaleString('en-US')} limit on Housing Allowance from credits`);
  const deadline = BigInt(chain.now() + REDEEM_WINDOW_SECONDS);
  return {
    usd: dollars(usd),
    deadline: deadline.toString(),
    typedData: {
      domain: { name: 'Clear Credits', version: '1', chainId: chain.chainId, verifyingContract: chain.issuer },
      types: {
        RedeemCredits: [
          { name: 'member', type: 'address' },
          { name: 'homeId', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'RedeemCredits' as const,
      message: { member, homeId: homeId.toString(), amount: amount.toString(), nonce: nonce.toString(), deadline: deadline.toString() },
    },
  };
}

/** Submits a member's signed redemption. The Points Issuer checks the signature and every limit. */
export async function submitRedeem(chain: HousingChain, member: string, homeId: bigint, credits: number, deadline: string, signature: string) {
  if (!chain.relayer) throw new HousingError(503, 'NO_RELAYER', 'Redemptions can’t be sent right now');
  if (!Number.isInteger(credits) || credits <= 0) throw new HousingError(400, 'BAD_AMOUNT', 'Redeem a whole number of credits');
  if (!/^\d+$/.test(deadline)) throw new HousingError(400, 'BAD_DEADLINE', 'deadline is the one the signature was made for');
  if (!ethers.isHexString(signature) || ethers.dataLength(signature) < 65) throw new HousingError(400, 'BAD_SIGNATURE', 'signature is required');
  const call = { to: chain.issuer, data: ISSUER.encodeFunctionData('redeem', [member, homeId, BigInt(credits) * CREDIT_UNITS, BigInt(deadline), signature]) };
  const sim = await chain.relayer.simulate(call);
  if (sim.kind === 'refused') throw new HousingError(409, sim.error.name, sim.sentence);
  if (sim.kind === 'failed') throw new HousingError(502, 'FAILED', 'The redemption could not be sent. Nothing was redeemed.');
  const usd = sim.returnData && sim.returnData !== '0x' ? dollars(ISSUER.decodeFunctionResult('redeem', sim.returnData)[0] as bigint) : null;
  const sent = await chain.relayer.send(call);
  if (sent.status !== 1) throw new HousingError(502, 'REVERTED', 'The redemption did not go through. Nothing was redeemed.');
  return { tx: sent.hash, usd };
}

/**
 * The calls the member's own wallet sends to pay `usd` toward a home: approve the record for exactly
 * that, then contribute. Checked first, so the wallet is never asked to send what the record refuses.
 */
export async function prepareContribute(chain: HousingChain, member: string, homeId: bigint, usd: number) {
  if (!Number.isFinite(usd) || usd <= 0 || usd > 10_000_000) throw new HousingError(400, 'BAD_AMOUNT', 'Pay a positive dollar amount');
  await signedRecord(chain, member, homeId);
  if ((await chain.payeeOf(homeId)) === ethers.ZeroAddress) {
    throw new HousingError(409, 'NO_PAYEE', 'Payments toward this home aren’t set up yet');
  }
  const amount = usdUnits(usd);
  const usdc = await chain.usdc();
  return {
    usd: dollars(amount),
    calls: [
      { to: usdc, value: '0', data: ERC20.encodeFunctionData('approve', [chain.record, amount]), label: `Let the Housing Allowance Record take $${dollars(amount).toFixed(2)}` },
      { to: chain.record, value: '0', data: RECORD.encodeFunctionData('contribute', [homeId, amount]), label: `Pay $${dollars(amount).toFixed(2)} toward home ${homeId}` },
    ],
  };
}

/** The live chain, from the configured addresses; null where the record isn't deployed. */
export function liveHousingChain(env: Record<string, string | undefined> = process.env): HousingChain | null {
  const chainId = keeperChainId(env);
  const record = getContractAddress(chainId, 'HousingAllowanceRecord');
  const issuer = getContractAddress(chainId, 'PointsIssuer');
  if (!record || !issuer) return null;
  const provider = chainProvider(chainId);
  const rec = new ethers.Contract(record, RECORD_ABI as unknown as string[], provider);
  const iss = new ethers.Contract(issuer, ISSUER_REDEEM_ABI as unknown as string[], provider);
  const key = (env.CREDIT_OPERATOR_PRIVATE_KEY || '').trim();
  const start = RECORD_START_BLOCK[chainId];
  return {
    chainId,
    record,
    issuer,
    homesOf: async (member) => {
      // One scan of each event for everyone, cached; filtered to the member here.
      const [opened, moved] = await Promise.all([
        scanLogs(`housing:${record}:opened`, rec, rec.filters.RecordOpened(), chainId, start),
        scanLogs(`housing:${record}:moved`, rec, rec.filters.Moved(), chainId, start),
      ]);
      const ids = new Set<bigint>();
      for (const log of opened) {
        const p = RECORD.parseLog(log);
        if (p && same(p.args.member, member)) ids.add(p.args.homeId as bigint);
      }
      for (const log of moved) {
        const p = RECORD.parseLog(log);
        if (p && same(p.args.member, member)) {
          ids.add(p.args.fromHome as bigint);
          ids.add(p.args.toHome as bigint);
        }
      }
      return [...ids].sort((a, b) => (a < b ? -1 : 1));
    },
    recordOf: async (member, homeId) => {
      const r = await rec.recordOf(member, homeId);
      return { creditPortion: r.creditPortion, memberPortion: r.memberPortion, structurePrice: r.structurePrice, refundDue: r.refundDue, signedAt: r.signedAt, endedAt: r.endedAt, status: r.status };
    },
    occupantOf: (homeId) => rec.occupantOf(homeId),
    payeeOf: (homeId) => rec.payeeOf(homeId),
    isRedeemable: (homeId) => rec.isRedeemable(homeId),
    lifetimeCreditPortion: (member) => rec.lifetimeCreditPortion(member),
    creditCap: () => rec.creditCap(),
    usdc: () => rec.usdc(),
    nonces: (member) => iss.nonces(member),
    quote: (member, amount) => iss.quote(member, amount),
    creditBalance: (member) => iss.balanceOf(member),
    relayer: key ? liveRunner(chainId, key, { describe: describeHousingRefusal, lock: asOperator }) : null,
    now: () => Math.floor(Date.now() / 1000),
  };
}
