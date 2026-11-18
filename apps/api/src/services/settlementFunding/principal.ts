import { parseAbi, hexToString, type Abi } from 'viem';
import type { Queryable } from '../../db/db.js';
import { events, offersAddress, type ChainReader } from '../command/onchain.js';
import { SETTLEMENT_LANE_VIEW } from './abi.js';

/*
 * The Pool Tier principal (IV-02 §4.3, §4.1 as amended; decision 54): what the two VALUATION_ROLE
 * signers should post with `postPoolTierPrincipal(value, evidenceHash)`. Read-only. Nothing here
 * posts it, and nothing should: the posting is two people's judgment, and this is their worksheet.
 *
 * It is the outstanding principal of the pool-funded credit, plus Margin Advances:
 *   - the RevolvingIssuer's Pool Tiers: savings-backed (now a Pool Tier, IV-02 §4.1), income-backed
 *     and Clear Boost. Asset-backed credit (BOND, POOL_SHARE) stays out of the pool (§4.2), and so
 *     does the WORKOUT position. The kinds are POOL_FUNDED_TIER_KINDS, default SAVINGS,INCOME,BOOST;
 *   - the TermIssuer's open plans: Partner Credit and Clear Cash draws;
 *   - Margin Advances: what the Savings-Backed Margin has paid into the CSA and the desk has not yet
 *     restored (ops.settlement_funding_moves).
 * Principal only: carry is not principal (`principalOnlyOf`, a plan's `principalOutstanding`).
 *
 * Before decision 54 there was no POOL_FUNDED_TIER_KINDS anywhere in the API (the per-purchase
 * borrow in poolFunding.ts, removed by #887 under decision 17, had none either), so it is defined
 * here, where the helper needs it.
 */

export const DEFAULT_POOL_FUNDED_TIER_KINDS = ['SAVINGS', 'INCOME', 'BOOST'] as const;

/** POOL_FUNDED_TIER_KINDS (comma-separated tier kinds), default savings-, income-backed and Boost. */
export function poolFundedTierKinds(env: Record<string, string | undefined> = process.env): string[] {
  const raw = (env.POOL_FUNDED_TIER_KINDS ?? '').split(',').map((k) => k.trim().toUpperCase()).filter(Boolean);
  return raw.length ? [...new Set(raw)] : [...DEFAULT_POOL_FUNDED_TIER_KINDS];
}

export interface PrincipalInputs {
  tiers: Array<{ id: number; kind: string }>;
  /** principalOnlyOf(member, tier), per member, per tier id. */
  principals: Array<{ member: string; tierId: number; principal: bigint }>;
  termPlans: Array<{ id: number; outstanding: bigint; closed: boolean }>;
  marginAdvances: bigint;
  posted: { value: bigint; postedAt: number } | null;
  deployedBalance: bigint | null;
  headroom: bigint | null;
}

export interface PoolTierPrincipal {
  /** What to post: everything below, in USDC base units. */
  total: bigint;
  tiers: Array<{ kind: string; principal: bigint; members: number }>;
  term: { principal: bigint; plans: number };
  marginAdvances: bigint;
  kinds: string[];
  posted: { value: bigint; postedAt: number } | null;
  /** total - posted value: positive means the posting is behind the book. */
  difference: bigint | null;
  deployedBalance: bigint | null;
  headroom: bigint | null;
  /** The settlement lane's ceiling on the Deployed Balance: posted principal plus headroom. */
  laneCeiling: bigint | null;
}

export function computePoolTierPrincipal(input: PrincipalInputs, kinds: string[]): PoolTierPrincipal {
  const pooled = new Map(input.tiers.filter((t) => kinds.includes(t.kind.toUpperCase())).map((t) => [t.id, t.kind.toUpperCase()]));
  const byKind = new Map<string, { principal: bigint; members: Set<string> }>(kinds.map((k) => [k, { principal: 0n, members: new Set<string>() }]));
  for (const p of input.principals) {
    const kind = pooled.get(p.tierId);
    if (!kind || p.principal <= 0n) continue;
    const k = byKind.get(kind)!;
    k.principal += p.principal;
    k.members.add(p.member.toLowerCase());
  }
  const open = input.termPlans.filter((p) => !p.closed && p.outstanding > 0n);
  const term = open.reduce((a, p) => a + p.outstanding, 0n);
  const tiers = [...byKind].map(([kind, v]) => ({ kind, principal: v.principal, members: v.members.size }));
  const total = tiers.reduce((a, t) => a + t.principal, 0n) + term + input.marginAdvances;
  return {
    total,
    tiers,
    term: { principal: term, plans: open.length },
    marginAdvances: input.marginAdvances,
    kinds,
    posted: input.posted,
    difference: input.posted ? total - input.posted.value : null,
    deployedBalance: input.deployedBalance,
    headroom: input.headroom,
    laneCeiling: input.posted && input.headroom !== null ? input.posted.value + input.headroom : null,
  };
}

const ISSUER = parseAbi([
  'function tierCount() view returns (uint256)',
  'function tierAt(uint256 tierId) view returns (bytes32 kind, uint256 ratePerCycle, bool active)',
  'function principalOnlyOf(address member, uint256 tierId) view returns (uint256)',
]) as Abi;
const TERM = parseAbi([
  'function planCount() view returns (uint256)',
  'function planAt(uint256 planId) view returns (address member, uint256 principal, uint256 principalOutstanding, uint256 repaid, uint64 openedAt, uint32 installments, uint64 installmentLength, uint256 ratePerCycle, bool closed)',
]) as Abi;
const POOL = parseAbi([
  'function poolTierPrincipal() view returns (uint256 value, uint256 postedAt)',
  'function deployedBalance() view returns (uint256)',
  SETTLEMENT_LANE_VIEW,
]) as Abi;

const kindText = (v: unknown) => {
  try {
    return hexToString(String(v) as `0x${string}`).replace(/\0+$/, '');
  } catch {
    return String(v);
  }
};

async function chunked(reader: ChainReader, calls: Parameters<ChainReader['read']>[0], size = 200): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let i = 0; i < calls.length; i += size) out.push(...(await reader.read(calls.slice(i, i + size))));
  return out;
}

/**
 * Reads the book from the chain: members from the indexer's CreditLineCreated events (the $10 offers'
 * own line excluded, as Money does), each Pool Tier's principal per member, every term plan, and the
 * pool's posted principal; the Margin Advances come from the desk's records.
 */
export async function readPoolTierPrincipal(input: {
  db: Queryable;
  reader: ChainReader;
  marginAdvances: bigint;
  env?: Record<string, string | undefined>;
}): Promise<PoolTierPrincipal> {
  const { reader } = input;
  const kinds = poolFundedTierKinds(input.env);
  const offers = offersAddress();
  const lines = await events(input.db, ['ClearCredit'], ['CreditLineCreated']);
  const members = [...new Set(lines.map((e) => String(e.args.member ?? '').toLowerCase()))].filter((m) => m && m !== offers);

  const [count, planCount] = await reader.read([
    { contract: 'RevolvingIssuer', fn: 'tierCount', abi: ISSUER },
    { contract: 'TermIssuer', fn: 'planCount', abi: TERM },
  ]);
  const n = Number(count);
  const tierReads = n ? await reader.read(Array.from({ length: n }, (_, i) => ({ contract: 'RevolvingIssuer', fn: 'tierAt', args: [BigInt(i)], abi: ISSUER }))) : [];
  const tiers = tierReads.map((t, id) => ({ id, kind: kindText((t as unknown[])[0]) }));
  const pooledIds = tiers.filter((t) => kinds.includes(t.kind.toUpperCase())).map((t) => t.id);
  const pairs = members.flatMap((member) => pooledIds.map((tierId) => ({ member, tierId })));
  const principalReads = await chunked(reader, pairs.map((p) => ({ contract: 'RevolvingIssuer', fn: 'principalOnlyOf', args: [p.member, BigInt(p.tierId)], abi: ISSUER })));
  const principals = pairs.map((p, i) => ({ ...p, principal: BigInt(String(principalReads[i] ?? 0)) }));

  const plans = Number(planCount);
  const planReads = await chunked(reader, Array.from({ length: plans }, (_, i) => ({ contract: 'TermIssuer', fn: 'planAt', args: [BigInt(i)], abi: TERM })));
  const termPlans = planReads.map((p, id) => {
    const r = p as unknown[];
    return { id, outstanding: BigInt(String(r[2] ?? 0)), closed: Boolean(r[8]) };
  });

  let posted: PrincipalInputs['posted'] = null;
  let deployedBalance: bigint | null = null;
  let headroom: bigint | null = null;
  try {
    const [pp, db] = await reader.read([
      { contract: 'LendingPool', fn: 'poolTierPrincipal', abi: POOL },
      { contract: 'LendingPool', fn: 'deployedBalance', abi: POOL },
    ]);
    const [value, at] = pp as [bigint, bigint];
    posted = BigInt(at) === 0n ? null : { value: BigInt(value), postedAt: Number(at) };
    deployedBalance = BigInt(String(db));
  } catch {
    // A pool from before Phase 2f has neither.
  }
  try {
    // The settlement lane's one view, its last field the Settlement Headroom: it reverts until the
    // lane's upgrade (decision 54, stage SL) is executed.
    const [lane] = await reader.read([{ contract: 'LendingPool', fn: 'settlementLane', abi: POOL }]);
    headroom = BigInt(String((lane as unknown[])[7]));
  } catch {
    headroom = null;
  }
  return computePoolTierPrincipal({ tiers, principals, termPlans, marginAdvances: input.marginAdvances, posted, deployedBalance, headroom }, kinds);
}

/** JSON for the API: amounts as base-unit strings and as dollars. */
export function principalJson(p: PoolTierPrincipal) {
  const u = (v: bigint | null) => (v === null ? null : { units: v.toString(), usd: Number(v) / 1e6 });
  return {
    total: u(p.total),
    tiers: p.tiers.map((t) => ({ kind: t.kind, principal: u(t.principal), members: t.members })),
    term: { principal: u(p.term.principal), plans: p.term.plans },
    marginAdvances: u(p.marginAdvances),
    kinds: p.kinds,
    posted: p.posted ? { value: u(p.posted.value), postedAt: p.posted.postedAt } : null,
    difference: u(p.difference),
    deployedBalance: u(p.deployedBalance),
    headroom: u(p.headroom),
    laneCeiling: u(p.laneCeiling),
    note: 'What the two VALUATION_ROLE signers should post with postPoolTierPrincipal(value, evidenceHash). Read-only: nothing posts it automatically.',
  };
}
