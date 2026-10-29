import chain from '@clear/command-types/src/chain/base-sepolia.json';
import FINGERPRINTS from '@clear/command-types/src/chain/code.json';
import { createHash } from 'node:crypto';
import { DAY } from '@clear/command-types';
import { erc20Abi, getAddress, keccak256, toHex, type Abi, type Address } from 'viem';
import type { Queryable } from '../../db/db.js';
import { publicFirst } from './indexer.js';

/*
 * What Command reads from the chain (docs/command-center-plan.md, Phase 5b): the yield pool and the
 * contracts' releases, from the events the indexer keeps, with the figures that are the contract's
 * own to say (its assets, its rates, who holds what now) read from it on the server, never worked out
 * in the browser.
 *
 * Contracts are named, never addressed: the generated ABIs (packages/command-types) say where each
 * one is, and the indexer's inventory says what it found.
 */

const C = chain.contracts as Record<string, { address: string; functions: Abi; events: Abi }>;

export interface ChainCall {
  /** A deployed contract by name, or 'ERC20' with an address for a token the protocol uses. */
  contract: string;
  fn: string;
  args?: unknown[];
  address?: string;
}
/** Reads from the deployed contracts, every call in one request. */
export interface ChainReader {
  read(calls: ChainCall[]): Promise<unknown[]>;
  /** The code running at an address: behind a proxy (EIP-1967), its implementation's. */
  codeOf?(address: string): Promise<{ implementation: string; code: string }>;
}

// EIP-1967's implementation slot: keccak256('eip1967.proxy.implementation') - 1
const IMPLEMENTATION_SLOT = toHex(BigInt(keccak256(toHex('eip1967.proxy.implementation'))) - 1n, { size: 32 });

export function liveChainReader(chainId = chain.chainId): ChainReader {
  const ask = publicFirst(chainId);
  return {
    codeOf: async (address) => {
      const slot = (await ask((c) => c.getStorageAt({ address: getAddress(address), slot: IMPLEMENTATION_SLOT }))) as string | undefined;
      const implementation = slot && BigInt(slot) ? getAddress(`0x${slot.slice(-40)}`) : getAddress(address);
      return { implementation, code: ((await ask((c) => c.getCode({ address: implementation }))) as string | undefined) ?? '0x' };
    },
    read: (calls) =>
      ask((c) =>
        c.multicall({
          allowFailure: false,
          contracts: calls.map((k) =>
            k.contract === 'ERC20'
              ? { address: getAddress(k.address!), abi: erc20Abi, functionName: k.fn, args: k.args ?? [] }
              : { address: getAddress(C[k.contract].address), abi: C[k.contract].functions, functionName: k.fn, args: k.args ?? [] },
          ) as any,
        }),
      ) as Promise<unknown[]>,
  };
}

export interface Ev {
  contract: string;
  event: string;
  args: Record<string, string>;
  at: number;
  tx: string;
}

export async function events(db: Queryable, contracts: string[], names: string[]): Promise<Ev[]> {
  const { rows } = await db.query<{ contract: string; event: string; args: Record<string, string>; block_time: Date; tx_hash: string }>(
    `SELECT contract, event, args, block_time, tx_hash FROM command.chain_events
      WHERE chain_id = $1 AND contract = ANY($2) AND event = ANY($3) ORDER BY block_number, log_index`,
    [chain.chainId, contracts, names],
  );
  return rows.map((r) => ({ contract: r.contract, event: r.event, args: r.args, at: new Date(r.block_time).getTime(), tx: r.tx_hash }));
}

/** The indexer's inventory: each address's contract name. */
async function names(db: Queryable): Promise<Map<string, string>> {
  const { rows } = await db.query<{ address: string; name: string }>('SELECT address, name FROM command.chain_contracts WHERE chain_id = $1', [chain.chainId]);
  return new Map(rows.map((r) => [r.address.toLowerCase(), r.name]));
}

const big = (v: unknown) => BigInt(String(v ?? 0));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// ── The yield pool ──────────────────────────────────────────────────────────

export interface YieldEntry {
  at: number;
  what: string;
  detail: string;
  amount: number;
}
export interface YieldPoolLive {
  /** What the contract says now, in dollars, and its rates per cycle in basis points. */
  assets: number;
  supply: number;
  lent: number;
  cash: number;
  queued: number;
  principal: number;
  utilBps: number;
  borrowBps: number;
  supplyBps: number;
  curve: { base: number; s1: number; s2: number; kink: number };
  cycleDays: number;
  /** What the PayoutPool owes it for shop payouts it covered. */
  toPayouts: number;
  /** What the PayoutPool's queued claims need beyond what it holds: what it would draw from the pool. */
  payoutShort: number;
  opened: number | null;
  /** Each holder of the pool's shares: a masked id, what the shares are worth, first deposit, what's pledged. */
  depositors: Array<{ id: string; assets: number; since: number; pledged: number }>;
  /** End of each day from the opening (the last 30 at most), today being the contract's own reads. */
  days: number[];
  assetsByDay: number[];
  lentByDay: number[];
  /** Cash not lent out, at the end of each of the last six weeks, then now. */
  cashWeeks: number[];
  entries: YieldEntry[];
}

const POOL_EVENTS = ['Deposit', 'Withdraw', 'WithdrawalQueued', 'WithdrawalClaimed', 'Borrowed', 'Repaid', 'LossAbsorbed', 'Transfer'];
const ZERO = '0x0000000000000000000000000000000000000000';

/**
 * The yield pool, as Money draws it. The events give its history and who holds its shares; the
 * contract's reads give where it stands now, so a token sent to it outside any event still counts.
 */
export async function yieldPoolLive(db: Queryable, reader: ChainReader, now: number): Promise<YieldPoolLive> {
  const ev = await events(db, ['LendingPool', 'PayoutPool'], [...POOL_EVENTS, 'InterestPaid']);
  const pool = getAddress(C.LendingPool.address);

  // the pool's books replayed event by event: cash in it, out on loan, owed to the queue
  let cash = 0n,
    lent = 0n,
    queued = 0n,
    principal = 0n;
  const states: Array<{ at: number; cash: bigint; lent: bigint; queued: bigint }> = [];
  const holders = new Map<string, number>();
  const interest = new Set(ev.filter((e) => e.contract === 'PayoutPool' && e.event === 'InterestPaid' && getAddress(e.args.lender) === pool).map((e) => `${e.tx}:${e.args.amount}`));
  for (const e of ev.filter((x) => x.contract === 'LendingPool')) {
    const a = e.args;
    if (e.event === 'Deposit') (cash += big(a.assets)), (principal += big(a.assets));
    else if (e.event === 'Withdraw') (cash -= big(a.assets)), (principal -= big(a.assets));
    else if (e.event === 'WithdrawalQueued') (queued += big(a.assets)), (principal -= big(a.assets));
    else if (e.event === 'WithdrawalClaimed') (cash -= big(a.assets)), (queued -= big(a.assets));
    else if (e.event === 'Borrowed') (cash -= big(a.amount)), (lent += big(a.amount));
    else if (e.event === 'Repaid') (cash += big(a.amount)), (lent = big(a.amount) > lent ? 0n : lent - big(a.amount));
    else if (e.event === 'LossAbsorbed') lent -= big(a.absorbed);
    else if (e.event === 'Transfer' && a.to !== ZERO && !holders.has(getAddress(a.to))) holders.set(getAddress(a.to), e.at);
    states.push({ at: e.at, cash, lent, queued });
  }

  const who = [...holders.keys()];
  const [totalAssets, totalSupply, totalBorrowed, availableCash, queuedAssets, util, borrowBps, supplyBps, base, s1, s2, kink, decimals, cycle, toPayouts, payoutShort, ...per] = await reader.read([
    ...['totalAssets', 'totalSupply', 'totalBorrowed', 'availableCash', 'queuedAssets', 'utilizationBps', 'borrowRatePerCycle', 'supplyRatePerCycle', 'baseRatePerCycle', 'slope1PerCycle', 'slope2PerCycle', 'kinkBps', 'decimals'].map((fn) => ({ contract: 'LendingPool', fn })),
    { contract: 'RevolvingIssuer', fn: 'cycleLength' },
    { contract: 'PayoutPool', fn: 'borrowedFromYield' },
    { contract: 'PayoutPool', fn: 'shortfall' },
    ...who.flatMap((h) => [
      { contract: 'LendingPool', fn: 'balanceOf', args: [h] },
      { contract: 'LendingPool', fn: 'encumberedOf', args: [h] },
    ]),
  ]);
  const unit = 10 ** Number(decimals);
  const usd = (v: bigint) => Math.round((Number(v) / unit) * 100) / 100;
  const worth = (shares: bigint) => (big(totalSupply) === 0n ? 0n : (shares * big(totalAssets)) / big(totalSupply));

  const firstDeposit = new Map<string, number>();
  for (const e of ev) if (e.event === 'Deposit' && !firstDeposit.has(getAddress(e.args.owner))) firstDeposit.set(getAddress(e.args.owner), e.at);
  const depositors = who
    .map((h, i) => ({ h, shares: big(per[i * 2]), pledged: big(per[i * 2 + 1]) }))
    .filter((d) => d.shares > 0n)
    .map((d) => ({ id: d.h.slice(-4).toLowerCase(), assets: usd(worth(d.shares)), since: firstDeposit.get(d.h) ?? holders.get(d.h)!, pledged: usd(worth(d.pledged > d.shares ? d.shares : d.pledged)) }))
    .sort((a, b) => b.assets - a.assets || a.since - b.since);

  const opened = ev.find((e) => e.contract === 'LendingPool' && e.event === 'Deposit')?.at ?? null;
  const today = Math.floor(now / DAY) * DAY;
  const at = (t: number) => {
    let s = { cash: 0n, lent: 0n, queued: 0n };
    for (const x of states) if (x.at < t) s = x;
    return s;
  };
  const first = opened == null ? today : Math.max(Math.floor(opened / DAY) * DAY, today - 29 * DAY);
  const days: number[] = [];
  for (let d = first; d <= today; d += DAY) days.push(d);
  const past = days.slice(0, -1).map((d) => at(d + DAY));
  const cashWeeks = [6, 5, 4, 3, 2, 1].map((k) => {
    const s = at(today + DAY - k * 7 * DAY);
    return usd(s.cash > s.queued ? s.cash - s.queued : 0n);
  });

  return {
    assets: usd(big(totalAssets)),
    supply: usd(big(totalSupply)),
    lent: usd(big(totalBorrowed)),
    cash: usd(big(availableCash)),
    queued: usd(big(queuedAssets)),
    principal: usd(principal),
    utilBps: Number(util),
    borrowBps: Number(borrowBps),
    supplyBps: Number(supplyBps),
    curve: { base: Number(base), s1: Number(s1), s2: Number(s2), kink: Number(kink) / 10_000 },
    // a cycle is the credit line's: 30 days until the issuer has a tier to say otherwise
    cycleDays: Number(cycle) ? Number(cycle) / 86_400 : 30,
    toPayouts: usd(big(toPayouts)),
    payoutShort: usd(big(payoutShort)),
    opened,
    depositors,
    days,
    assetsByDay: [...past.map((s) => usd(s.cash + s.lent - s.queued)), usd(big(totalAssets))],
    lentByDay: [...past.map((s) => usd(s.lent)), usd(big(totalBorrowed))],
    cashWeeks: [...cashWeeks, usd(big(availableCash))],
    entries: entries(ev, await names(db), interest, usd, opened),
  };
}

/** The pool's cash in and out, a line a day for each kind, newest first, as Money's account pane lists them. */
function entries(ev: Ev[], byAddress: Map<string, string>, interest: Set<string>, usd: (v: bigint) => number, opened: number | null): YieldEntry[] {
  const name = (a: string) => byAddress.get(a.toLowerCase()) ?? short(getAddress(a));
  const lines = new Map<string, { at: number; what: string; detail: (n: number) => string; amount: bigint; who: Set<string> }>();
  const add = (at: number, what: string, detail: (n: number) => string, amount: bigint, who: string) => {
    const day = Math.floor(at / DAY) * DAY;
    const k = `${day}|${what}|${detail(0)}`;
    const l = lines.get(k) ?? { at: day, what, detail, amount: 0n, who: new Set<string>() };
    l.amount += amount;
    l.who.add(who.toLowerCase());
    lines.set(k, l);
  };
  const members = (n: number) => `${n} member${n === 1 ? '' : 's'}`;
  for (const e of ev.filter((x) => x.contract === 'LendingPool')) {
    const a = e.args;
    if (e.event === 'Deposit') {
      const founding = opened != null && Math.floor(e.at / DAY) === Math.floor(opened / DAY);
      add(e.at, founding ? 'Opened' : 'Deposits', (n) => (founding ? `Founding deposits · ${members(n)}` : members(n)), big(a.assets), a.owner);
    } else if (e.event === 'Withdraw') add(e.at, 'Withdrawals', (n) => `${members(n)} · paid at once`, -big(a.assets), a.owner);
    else if (e.event === 'WithdrawalClaimed') add(e.at, 'Withdrawals', (n) => `${members(n)} · from the queue`, -big(a.assets), a.receiver);
    else if (e.event === 'Borrowed') {
      const to = name(a.borrower);
      add(e.at, to === 'PayoutPool' ? 'Lent to shop payouts' : 'Lent', () => to, -big(a.amount), a.borrower);
    } else if (e.event === 'Repaid') {
      const from = name(a.from);
      if (interest.has(`${e.tx}:${a.amount}`)) add(e.at, 'Interest from credit', () => 'Shop payouts · carry', big(a.amount), a.from);
      else add(e.at, 'Repaid', () => from, big(a.amount), a.from);
    }
  }
  return [...lines.values()]
    .map((l) => ({ at: l.at, what: l.what, detail: l.detail(l.who.size), amount: usd(l.amount) }))
    .sort((x, y) => y.at - x.at)
    .slice(0, 50);
}

// ── The savings reserve ─────────────────────────────────────────────────────

export interface ReserveLive {
  /** CLRUSD in issue, and the USDC the savings vault holds against it, in dollars. */
  clrusd: number;
  usdc: number;
  /** The vault's USDC less what's issued: negative is a shortfall. */
  difference: number;
  /** CLRUSD in issue at the end of each of the last six weeks, then now. */
  weeks: number[];
}

/**
 * Member savings, as the vault backs them (Kai, 2026-10-24): CLRUSD's supply against the USDC
 * ESADepositVault holds, the comparison the vault itself makes. The USDC is the protocol's reserve
 * token (the LendingPool's asset), so no address is written down here. The weeks are CLRUSD's mints
 * and burns, from the indexer.
 */
export async function reserveLive(db: Queryable, reader: ChainReader, now: number): Promise<ReserveLive> {
  const [supply, decimals, usdcAddress] = await reader.read([
    { contract: 'ClearUSDUpgradeable', fn: 'totalSupply' },
    { contract: 'ClearUSDUpgradeable', fn: 'decimals' },
    { contract: 'LendingPool', fn: 'asset' },
  ]);
  const [held, usdcDecimals] = await reader.read([
    { contract: 'ERC20', address: String(usdcAddress), fn: 'balanceOf', args: [getAddress(C.ESADepositVault.address)] },
    { contract: 'ERC20', address: String(usdcAddress), fn: 'decimals' },
  ]);
  const dollars = (v: bigint, d: unknown) => Math.round((Number(v) / 10 ** Number(d)) * 100) / 100;
  const moves = (await events(db, ['ClearUSDUpgradeable'], ['Transfer'])).filter((e) => e.args.from === ZERO || e.args.to === ZERO);
  const today = Math.floor(now / DAY) * DAY;
  const at = (t: number) => moves.filter((e) => e.at < t).reduce((s, e) => s + (e.args.from === ZERO ? big(e.args.value) : -big(e.args.value)), 0n);
  const clrusd = dollars(big(supply), decimals),
    usdc = dollars(big(held), usdcDecimals);
  return {
    clrusd,
    usdc,
    difference: Math.round((usdc - clrusd) * 100) / 100,
    weeks: [...[6, 5, 4, 3, 2, 1].map((k) => dollars(at(today + DAY - k * 7 * DAY), decimals)), clrusd],
  };
}

export interface CoopLive {
  /** Where the co-op's fee on each financed sale is credited: TermIssuer's fee recipient, else its carry treasury. */
  recipient: string;
  /** Whose holdings are counted: the Ops Safe when it's set, else the fee recipient. */
  holder: string;
  /** What it holds, in dollars: USDC (the Ops Safe's only), and CLRUSD credited to it. */
  usdc: number;
  clrusd: number;
  /** The two together: the co-op's own money on chain, spent only by a member vote. */
  balance: number;
  /** The balance at the end of each of the last six weeks, then now. */
  weeks: number[];
}

/**
 * The co-op's balance: what its treasury, the Ops Safe, holds on chain. That's USDC (the protocol's
 * reserve token, the LendingPool's asset) and the ClearCredit it's been credited: a financed sale pays
 * the shop the price less its fee and credits the co-op the difference at TermIssuer's fee recipient
 * (the Ops Safe since 28 Oct). Without the Safe set, the fee recipient's ClearCredit alone, as before:
 * its USDC may not be the co-op's (the carry treasury is the PayoutPool).
 * The weeks are ClearCredit's transfers to and from the holder, from the indexer. USDC isn't one of our
 * contracts, so its transfers aren't indexed: its history is today's figure.
 */
export async function coopLive(db: Queryable, reader: ChainReader, now: number, safe: string | null = null): Promise<CoopLive> {
  const [fee, treasury, decimals, usdcAddress] = await reader.read([
    { contract: 'TermIssuer', fn: 'feeRecipient' },
    { contract: 'TermIssuer', fn: 'carryTreasury' },
    { contract: 'ClearCredit', fn: 'decimals' },
    { contract: 'LendingPool', fn: 'asset' },
  ]);
  const recipient = getAddress(String(fee) === ZERO ? String(treasury) : String(fee));
  const holder = safe ? getAddress(safe) : recipient;
  const [held, cash, usdcDecimals] = await reader.read([
    { contract: 'ClearCredit', fn: 'balanceOf', args: [holder] },
    ...(safe
      ? [
          { contract: 'ERC20', address: String(usdcAddress), fn: 'balanceOf', args: [holder] },
          { contract: 'ERC20', address: String(usdcAddress), fn: 'decimals' },
        ]
      : []),
  ]);
  const dollars = (v: bigint, d: unknown = decimals) => Math.round((Number(v) / 10 ** Number(d)) * 100) / 100;
  const me = holder.toLowerCase();
  const moves = (await events(db, ['ClearCredit'], ['Transfer'])).filter((e) => String(e.args.to).toLowerCase() === me || String(e.args.from).toLowerCase() === me);
  const today = Math.floor(now / DAY) * DAY;
  const at = (t: number) => moves.filter((e) => e.at < t).reduce((s, e) => s + (String(e.args.to).toLowerCase() === me ? big(e.args.value) : -big(e.args.value)), 0n);
  const clrusd = dollars(big(held)),
    usdc = safe ? dollars(big(cash), usdcDecimals) : 0;
  const balance = Math.round((usdc + clrusd) * 100) / 100;
  return {
    recipient,
    holder,
    usdc,
    clrusd,
    balance,
    weeks: [...[6, 5, 4, 3, 2, 1].map((k) => Math.round((Math.max(0, dollars(at(today + DAY - k * 7 * DAY))) + usdc) * 100) / 100), balance],
  };
}

// ── Bonds ───────────────────────────────────────────────────────────────────

export interface BondLive {
  id: string;
  face: number;
  price: number;
  issuedAt: number;
  maturesAt: number;
  /** Who holds it now, from its ERC-1155 transfers; null if it has none. */
  holder: string | null;
  /** Redeemed at maturity or early, or rolled into a new bond. */
  closed: boolean;
}

const BOND_EVENTS = ['BondMinted', 'BondRedeemed', 'RedeemedEarly', 'BondRolled', 'TransferSingle', 'TransferBatch'];

/**
 * Every BurnerBond, from its events: what it was minted for (face value, price paid, maturity), who
 * holds it now, and whether it's closed. Amounts are in the bond's own token (underlyingToken), read
 * with its decimals.
 */
export async function bondsLive(db: Queryable, reader: ChainReader): Promise<BondLive[]> {
  const ev = await events(db, ['BurnerBond'], BOND_EVENTS);
  if (!ev.some((e) => e.event === 'BondMinted')) return [];
  const [token] = await reader.read([{ contract: 'BurnerBond', fn: 'underlyingToken' }]);
  const [decimals] = await reader.read([{ contract: 'ERC20', address: String(token), fn: 'decimals' }]);
  const usd = (v: unknown) => Math.round((Number(big(v)) / 10 ** Number(decimals)) * 100) / 100;
  const bonds = new Map<string, BondLive>();
  // a mint's transfer comes before its BondMinted, so holders are kept apart and joined at the end
  const holders = new Map<string, string>();
  const moved = (id: unknown, to: unknown) => String(to).toLowerCase() !== ZERO && holders.set(String(id), getAddress(String(to)));
  const close = (id: unknown) => {
    const b = bonds.get(String(id));
    if (b) b.closed = true;
  };
  for (const { event, args: a, at } of ev) {
    if (event === 'BondMinted')
      bonds.set(String(a.bondId), { id: String(a.bondId), face: usd(a.faceValue), price: usd(a.purchasePrice), issuedAt: at, maturesAt: Number(a.maturityDate) * 1000, holder: null, closed: false });
    else if (event === 'TransferSingle') moved(a.id, a.to);
    else if (event === 'TransferBatch') for (const id of a.ids as unknown as string[]) moved(id, a.to);
    else if (event === 'BondRolled') close(a.oldBondId);
    else close(a.bondId);
  }
  return [...bonds.values()].map((b) => ({ ...b, holder: holders.get(b.id) ?? null }));
}

export interface AssurancePoolLive {
  total: number;
  primary: number;
  buffer: number;
  excess: number;
  /** The target RTD, as a fraction (the AssuranceOracle's). */
  target: number;
  /** The pool's exposure, in the reserve token: what it would pay if every member defaulted. */
  exposure: number;
  /** Primary reserve ÷ exposure, as a fraction; null with nothing out, when the contract calls it undefined. */
  rtd: number | null;
  /** Whether the pool is reserved to its target: always, with nothing out. */
  valid: boolean;
  /** Primary reserve less what the target needs against the exposure: above it when positive, below when negative. */
  gap: number;
  /** More exposure the primary reserve could take before RTD falls under the target. */
  room: number;
}

/**
 * What the AssurancePool holds against losses (its primary, buffer and excess reserves) and its RTD as
 * the contract has it: the primary reserve alone against the pool's exposure, never the buffer or
 * anything outside the pool. Amounts in its reserve token.
 */
export async function assurancePoolLive(reader: ChainReader): Promise<AssurancePoolLive> {
  const [primary, buffer, excess, token, target, rtd, exposure, valid] = await reader.read([
    { contract: 'AssurancePool', fn: 'primaryBalance' },
    { contract: 'AssurancePool', fn: 'bufferBalance' },
    { contract: 'AssurancePool', fn: 'excessBalance' },
    { contract: 'AssurancePool', fn: 'reserveToken' },
    { contract: 'AssurancePool', fn: 'targetRTD' },
    { contract: 'AssurancePool', fn: 'RTD' },
    { contract: 'AssurancePool', fn: 'poolExposure' },
    { contract: 'AssurancePool', fn: 'hasValidRTD' },
  ]);
  const [decimals, exposureReserve] = await reader.read([
    { contract: 'ERC20', address: String(token), fn: 'decimals' },
    { contract: 'AssurancePool', fn: 'convertStableCreditToReserveToken', args: [big(exposure)] },
  ]);
  const usd = (v: unknown) => Math.round((Number(big(v)) / 10 ** Number(decimals)) * 100) / 100;
  const frac = (v: unknown) => Number(big(v)) / 1e18;
  const [p, b, e, x] = [usd(primary), usd(buffer), usd(excess), usd(exposureReserve)];
  const t = frac(target);
  return {
    total: Math.round((p + b + e) * 100) / 100,
    primary: p,
    buffer: b,
    excess: e,
    target: t,
    exposure: x,
    rtd: x ? frac(rtd) : null,
    valid: valid === true || valid === 'true',
    gap: Math.round((p - t * x) * 100) / 100,
    room: t ? Math.max(0, Math.round((p / t - x) * 100) / 100) : 0,
  };
}

export interface BondVaultLive {
  /** What it holds: the bond buyers' money. */
  held: number;
  /** What it must keep back: the face falling due inside its window, or its floor across all outstanding, whichever is more. */
  required: number;
  /** What the Safe may take for the co-op's use: what it holds less what it must keep. */
  deployable: number;
  floorPct: number;
  windowDays: number;
}

/** BondVault as the contract has it: what it holds, keeps back and lets the Safe take, in its reserve token. */
export async function bondVaultLive(reader: ChainReader): Promise<BondVaultLive> {
  const [held, required, deployable, floorBps, window, token] = await reader.read([
    { contract: 'BondVault', fn: 'held' },
    { contract: 'BondVault', fn: 'requiredReserve' },
    { contract: 'BondVault', fn: 'deployableExcess' },
    { contract: 'BondVault', fn: 'minReserveBps' },
    { contract: 'BondVault', fn: 'reserveWindow' },
    { contract: 'BondVault', fn: 'reserveToken' },
  ]);
  const [decimals] = await reader.read([{ contract: 'ERC20', address: String(token), fn: 'decimals' }]);
  const usd = (v: unknown) => Math.round((Number(big(v)) / 10 ** Number(decimals)) * 100) / 100;
  return { held: usd(held), required: usd(required), deployable: usd(deployable), floorPct: Number(floorBps) / 100, windowDays: Math.round(Number(window) / 86400) };
}

// ── Releases ────────────────────────────────────────────────────────────────

export interface Release {
  version: string;
  at: number;
  implementation: string;
}

/**
 * Each proxy's releases, from its Upgraded events: the implementation it points at, and when. The
 * contracts don't name their versions, so they're counted, v1.0 being the first.
 */
export async function releasesLive(db: Queryable): Promise<Map<string, Release[]>> {
  const out = new Map<string, Release[]>();
  for (const e of await events(db, Object.keys(C), ['Upgraded'])) {
    const list = out.get(e.contract) ?? [];
    const impl = getAddress(e.args.implementation);
    // the same implementation again (a re-run initializer) isn't a release
    if (list.at(-1)?.implementation === impl) continue;
    list.push({ version: `v1.${list.length}`, at: e.at, implementation: impl });
    out.set(e.contract, list);
  }
  return out;
}

/** The deployed contract a map entry stands for: ClearUSD is ClearUSDUpgradeable, SavingsIntent its factory. */
export function deployedName(name: string, deployed: Set<string>): string | null {
  return [`${name}Upgradeable`, name, `${name}Factory`].find((n) => deployed.has(n)) ?? null;
}

/**
 * Where each deployed contract is, by name, from the indexer's inventory, and when it was deployed:
 * worked out from its deploy block and the newest event's time, Base's blocks being 2 seconds apart.
 */
export async function inventory(db: Queryable): Promise<Map<string, { address: Address; deployed: boolean; deployedAt: number | null }>> {
  const { rows } = await db.query<{ name: string; address: string; deploy_block: string | null }>('SELECT name, address, deploy_block FROM command.chain_contracts WHERE chain_id = $1', [chain.chainId]);
  const { rows: anchor } = await db.query<{ block_number: string; block_time: Date }>('SELECT block_number, block_time FROM command.chain_events WHERE chain_id = $1 ORDER BY block_number DESC LIMIT 1', [chain.chainId]);
  const at = (b: string | null) => (b == null || !anchor.length ? null : new Date(anchor[0].block_time).getTime() - (Number(anchor[0].block_number) - Number(b)) * 2000);
  return new Map(rows.map((r) => [r.name, { address: getAddress(r.address), deployed: r.deploy_block != null, deployedAt: at(r.deploy_block) }]));
}

export { short as shortAddress };

// ── Who can do what ─────────────────────────────────────────────────────────

/** Who holds each power over the contracts, as Build's grid draws it: its holders, and a row a power (1 holds it). */
export interface KeyRoles {
  holders: string[];
  roles: Array<[string, number[]]>;
}

const ADMIN_ROLE = `0x${'0'.repeat(64)}`;
const roleId = (name: string) => keccak256(toHex(name));
// AccessManager's operator role is the bytes32 of "OPERATOR", not a hash (AccessManager.sol)
const AM_OPERATOR = toHex('OPERATOR', { size: 32 });

/**
 * Who can do what, replayed from the events the indexer keeps: every contract's role grants and
 * revokes (OpenZeppelin AccessControl has no list of members to read), owners, NetworkRegistry's
 * issuers and the AssurancePool's allowed callers. A holder is named as the contract it is, the Ops
 * Safe, or its address shortened.
 */
export async function keyRolesLive(db: Queryable, opsSafe: string | null): Promise<KeyRoles> {
  const ev = await events(db, Object.keys(C), ['RoleGranted', 'RoleRevoked', 'OwnershipTransferred', 'IssuerRegistered', 'IssuerDeregistered', 'WithdrawalCallerUpdated']);
  const name = await names(db);
  // what each address holds now, per contract and role
  const held = new Map<string, Set<string>>();
  const set = (key: string, who: string, on: boolean) => {
    const s = held.get(key) ?? new Set<string>();
    if (on) s.add(who.toLowerCase());
    else s.delete(who.toLowerCase());
    held.set(key, s);
  };
  for (const e of ev) {
    const a = e.args;
    if (e.event === 'RoleGranted' || e.event === 'RoleRevoked') set(`${e.contract}|${String(a.role).toLowerCase()}`, a.account, e.event === 'RoleGranted');
    else if (e.event === 'OwnershipTransferred') {
      held.set(`${e.contract}|owner`, new Set());
      if (a.newOwner && a.newOwner !== ZERO) set(`${e.contract}|owner`, a.newOwner, true);
    } else if (e.event === 'IssuerRegistered' || e.event === 'IssuerDeregistered') set('issuers', a.issuer, e.event === 'IssuerRegistered');
    else if (e.event === 'WithdrawalCallerUpdated') set('assurance-callers', a.caller, String(a.allowed) === 'true');
  }
  const who = (pick: (contract: string, role: string) => boolean) => {
    const out = new Set<string>();
    for (const [key, s] of held) {
      const [contract, role] = key.split('|');
      if (pick(contract, role ?? '')) for (const x of s) out.add(x);
    }
    return out;
  };
  const ROWS: Array<[string, Set<string>]> = [
    ['Upgrade and admin', who((c, r) => r === ADMIN_ROLE || r === 'owner')],
    ['Pause', who((c, r) => r === roleId('PAUSER_ROLE') || (r === 'owner' && (c === 'RevolvingIssuer' || c === 'TermIssuer')))],
    ['Mint credit', who((c) => c === 'issuers')],
    ['Run credit operations', who((c, r) => c === 'AccessManager' && r === AM_OPERATOR.toLowerCase())],
    ['Set shop terms', who((c, r) => c === 'MerchantRegistry' && r === roleId('OPERATOR_ROLE'))],
    ['Claim from AssurancePool', who((c) => c === 'assurance-callers')],
  ];
  const label = (a: string) => (opsSafe && a === opsSafe.toLowerCase() ? 'Ops Safe' : (name.get(a) ?? short(getAddress(a))));
  // holders by how many powers they hold, the Ops Safe first
  const count = new Map<string, number>();
  for (const [, s] of ROWS) for (const a of s) count.set(a, (count.get(a) ?? 0) + 1);
  const addrs = [...count.keys()].sort((a, b) => Number(label(b) === 'Ops Safe') - Number(label(a) === 'Ops Safe') || count.get(b)! - count.get(a)! || label(a).localeCompare(label(b)));
  // the grid (bx.css .bd-ro-r) has room for six: past that, the holders with fewest powers share one column
  const shown = addrs.length > MAX_HOLDERS ? addrs.slice(0, MAX_HOLDERS - 1) : addrs,
    rest = addrs.slice(shown.length);
  return {
    holders: [...shown.map(label), ...(rest.length ? [`${rest.length} others`] : [])],
    roles: ROWS.map(([t, s]) => [t, [...shown.map((a) => (s.has(a) ? 1 : 0)), ...(rest.length ? [rest.some((a) => s.has(a)) ? 1 : 0] : [])]]),
  };
}
const MAX_HOLDERS = 6;

// ── Is it what dev compiles? ────────────────────────────────────────────────

const NESTED_META = Buffer.from('a264697066735822', 'hex');
/** The masked sha256 of runtime bytecode, as scripts/command/code-fingerprints.mjs takes it: immutables zeroed, metadata cut off (and zeroed in any contract it creates). */
export function codeFingerprint(hex: string, immutables: Array<[number, number]>): string {
  let b = Buffer.from(String(hex).replace(/^0x/, ''), 'hex');
  for (const [start, length] of immutables) b.fill(0, start, start + length);
  if (b.length >= 2) {
    const meta = b.readUInt16BE(b.length - 2);
    if (meta + 2 <= b.length) b = b.subarray(0, b.length - 2 - meta);
  }
  // and the metadata of any contract it creates (its creation code is inside): solc's 53-byte block,
  // a2 64 'ipfs' 58 22 <34-byte hash> 64 'solc' 43 <version> 00 33, zeroed wherever it is
  b = Buffer.from(b);
  for (let i = b.indexOf(NESTED_META); i >= 0; i = b.indexOf(NESTED_META, i + 53)) b.fill(0, i, Math.min(b.length, i + 53));
  return createHash('sha256').update(b).digest('hex');
}

const CODE_TTL_MS = 10 * 60e3;
let codeCache: { at: number; same: Map<string, boolean> } | null = null;

/**
 * Whether each deployed contract runs what this branch compiles: the chain's code (its implementation's,
 * behind a proxy) against packages/command-types' code.json, made from dev's compile and kept current by
 * CI. A contract with no fingerprint, or whose code can't be read, isn't in the answer. Kept ten minutes:
 * code only changes with an upgrade.
 */
type Fingerprints = Record<string, { sha256: string; immutables: Array<[number, number]> }>;
export async function codeMatchLive(reader: ChainReader, now = Date.now(), fingerprints = FINGERPRINTS.contracts as unknown as Fingerprints): Promise<Map<string, boolean>> {
  if (codeCache && now - codeCache.at < CODE_TTL_MS) return codeCache.same;
  const same = new Map<string, boolean>();
  if (reader.codeOf)
    for (const [name, fp] of Object.entries(fingerprints)) {
      const address = C[name]?.address;
      if (!address) continue;
      try {
        const { code } = await reader.codeOf(address);
        if (code && code !== '0x') same.set(name, codeFingerprint(code, fp.immutables) === fp.sha256);
      } catch {
        // unread: neither the same nor different
      }
    }
  codeCache = { at: now, same };
  return same;
}
/** For tests: forget what was read. */
export const forgetCodeMatch = () => {
  codeCache = null;
};
