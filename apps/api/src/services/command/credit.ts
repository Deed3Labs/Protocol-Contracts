import { DAY } from '@clear/command-types';
import type { Queryable } from '../../db/db.js';
import { events, type ChainReader } from './onchain.js';

/*
 * Money's on-chain book (docs/ui-redesign-plan.md, gaps): what the PayoutPool owes shops and when,
 * what members owe and when it's due, the month's credit, how late balances are and what was lost.
 * The contracts' reads say where things stand now; the events the indexer keeps say what happened
 * this month. Nothing here is worked out in the browser.
 */

const big = (v: unknown) => BigInt(String(v ?? 0));
const lc = (a: unknown) => String(a ?? '').toLowerCase();
/** Days from now, rounded up; what's already due is today. */
const dayOf = (t: number, now: number) => Math.max(0, Math.ceil((t - now) / DAY));
const round2 = (n: number) => Math.round(n * 100) / 100;
/** A member as Money names one: never their name or address, only the last four of it. */
export const memberLabel = (a: string) => `Member M•••${a.slice(-4).toLowerCase()}`;

/** [days from today, in or out, amount, who, what]: the next 30 days' payments, as Money's FLOWS. */
export type Flow = [number, 'in' | 'out', number, string, string];

/** Each shop's name by its wallet, from the merchant app's profiles (none when that schema isn't there). */
export async function shopNames(db: Queryable): Promise<Map<string, string>> {
  try {
    const { rows } = await db.query<{ merchant: string; name: string }>('SELECT lower(merchant) AS merchant, name FROM merchant.profiles');
    return new Map(rows.map((r) => [r.merchant, r.name]));
  } catch {
    return new Map();
  }
}

// ── What the PayoutPool owes shops ──────────────────────────────────────────

export interface PayoutClaim {
  id: number;
  merchant: string;
  name: string;
  amount: number;
  claimedAt: number;
  dueBy: number;
  paid: boolean;
}
export interface PayoutsLive {
  /** What the pool holds to pay claims with, and what its unpaid claims add up to. */
  held: number;
  queued: number;
  shortfall: number;
  /** The unpaid claims, oldest first. */
  claims: PayoutClaim[];
  /** What shops have earned but not yet redeemed (no claim, so no due date yet). */
  unredeemed: number;
  /** The unpaid claims as payments out, by when they're due. */
  out: Flow[];
  /** What's due to shops in the next 14 days. */
  owed14: number;
}

/** The most claims read in one go: the unpaid ones are the newest, the pool pays them oldest first. */
const MAX_CLAIMS = 500;

/**
 * The PayoutPool's unpaid claims. A claim exists once a shop redeems what its sales earned; it's due
 * its payout window after (MerchantRegistry: NET-14, NET-30). What a shop hasn't redeemed yet is
 * counted, not scheduled: it has no due date until it's a claim.
 */
export async function payoutsLive(db: Queryable, reader: ChainReader, now: number): Promise<PayoutsLive> {
  const [count, next, held, queued, shortfall, token, merchants] = await reader.read([
    { contract: 'PayoutPool', fn: 'claimCount' },
    { contract: 'PayoutPool', fn: 'nextUnpaid' },
    { contract: 'PayoutPool', fn: 'held' },
    { contract: 'PayoutPool', fn: 'queuedTotal' },
    { contract: 'PayoutPool', fn: 'shortfall' },
    { contract: 'PayoutPool', fn: 'reserveToken' },
    { contract: 'MerchantRegistry', fn: 'merchantCount' },
  ]);
  const [decimals] = await reader.read([{ contract: 'ERC20', address: String(token), fn: 'decimals' }]);
  const usd = (v: unknown) => round2(Number(big(v)) / 10 ** Number(decimals));
  const total = Number(big(count));
  const from = Math.max(Number(big(next)), total - MAX_CLAIMS);
  const ids = Array.from({ length: Math.max(0, total - from) }, (_, i) => from + i);
  const raw = ids.length ? await reader.read(ids.map((i) => ({ contract: 'PayoutPool', fn: 'claimAt', args: [BigInt(i)] }))) : [];
  const shops = Array.from({ length: Number(big(merchants)) }, (_, i) => i);
  const addrs = shops.length ? ((await reader.read(shops.map((i) => ({ contract: 'MerchantRegistry', fn: 'merchantAt', args: [BigInt(i)] })))) as string[]) : [];
  const owedTo = addrs.length ? await reader.read(addrs.map((a) => ({ contract: 'PayoutPool', fn: 'redeemableOf', args: [a] }))) : [];
  const name = await shopNames(db);
  const named = (a: string) => name.get(lc(a)) ?? `Shop ${a.slice(0, 6)}…${a.slice(-4)}`;

  const claims: PayoutClaim[] = raw
    .map((r, i) => {
      const [merchant, amount, claimedAt, dueBy, paid] = r as [string, bigint, bigint, bigint, boolean];
      return { id: ids[i], merchant: lc(merchant), name: named(merchant), amount: usd(amount), claimedAt: Number(claimedAt) * 1000, dueBy: Number(dueBy) * 1000, paid: !!paid };
    })
    .filter((c) => !c.paid);
  const out: Flow[] = claims.map((c) => [dayOf(c.dueBy, now), 'out', c.amount, c.name, `NET-${Math.round((c.dueBy - c.claimedAt) / DAY)} payout · claim #${c.id}`]);
  return {
    held: usd(held),
    queued: usd(queued),
    shortfall: usd(shortfall),
    claims,
    unredeemed: round2(owedTo.reduce<number>((a, v) => a + usd(v), 0)),
    out,
    owed14: round2(out.filter((f) => f[0] <= 14).reduce((a, f) => a + f[2], 0)),
  };
}

// ── What members owe ────────────────────────────────────────────────────────

export interface CreditLive {
  members: number;
  /** What members owe now, and the limits they have. */
  credit: number;
  limits: number;
  /** This month (UTC): owed on the 1st, spent on credit, carry added, repaid; owed now = start + spent + carry − repaid. */
  month: string;
  start: number;
  spent: number;
  carry: number;
  repaid: number;
  /** How many members repay on autopay. */
  autopay: number;
  /** What's owed by how late it is: Current, 1–30, 31–60, Over 60 days. */
  aging: Array<[string, number]>;
  /** Each balance written off: [days ago (negative), who, an id, amount], newest first; and what the AssurancePool paid for them. */
  losses: Array<[number, string, string, number]>;
  lost: number;
  poolPaid: number;
  /** How many members have each limit, smallest first. */
  limitSizes: Array<[string, number]>;
  /** This month's purchases on credit at each shop: [name, amount, a loss on its book (0/1)]. */
  shops: Array<[string, number, number]>;
  /** Repayments due in the next 30 days, by day: plan installments and revolving balances at their period's end. */
  in: Flow[];
  /** What's due from members in the next 14 days. */
  due14: number;
  /** Members with more than one late plan count once; how many are late at all. */
  late: number;
  /** How many members owe anything now. */
  owing: number;
}

const BUCKETS = ['Current', '1–30 days', '31–60 days', 'Over 60'];
const bucketOf = (daysLate: number) => (daysLate <= 0 ? 0 : daysLate <= 30 ? 1 : daysLate <= 60 ? 2 : 3);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The credit book. Members are the credit lines ClearCredit has opened; each one's balance, limit,
 * revolving period and autopay are read now, and their term plans' schedules. The month is the
 * events since the 1st: purchases at shops and card spend settled on-chain (less reversals), carry
 * accrued, and repayments.
 */
export async function creditLive(db: Queryable, reader: ChainReader, now: number): Promise<CreditLive> {
  const lines = await events(db, ['ClearCredit'], ['CreditLineCreated']);
  const members = [...new Set(lines.map((e) => lc(e.args.member)))];
  const [decimals] = await reader.read([{ contract: 'ClearCredit', fn: 'decimals' }]);
  const usd = (v: unknown) => round2(Number(big(v)) / 10 ** Number(decimals));
  const per = 5;
  const reads = members.length
    ? await reader.read(
        members.flatMap((m) => [
          { contract: 'ClearCredit', fn: 'creditBalanceOf', args: [m] },
          { contract: 'ClearCredit', fn: 'creditLimitOf', args: [m] },
          { contract: 'RevolvingIssuer', fn: 'periodExpirationOf', args: [m] },
          { contract: 'RevolvingIssuer', fn: 'autoRepayEnabled', args: [m] },
          { contract: 'TermIssuer', fn: 'plansOf', args: [m] },
        ]),
      )
    : [];
  const who = members.map((m, i) => {
    const r = reads.slice(i * per, i * per + per);
    return { m, balance: usd(r[0]), limit: usd(r[1]), periodEnd: Number(big(r[2])) * 1000, autopay: r[3] === true, plans: ((r[4] as bigint[]) ?? []).map((p) => Number(p)) };
  });

  // each plan's schedule: who, what's left, its installments, and since when it's behind
  const planIds = who.flatMap((w) => w.plans);
  const pr = planIds.length
    ? await reader.read(
        planIds.flatMap((p) => [
          { contract: 'TermIssuer', fn: 'planAt', args: [BigInt(p)] },
          { contract: 'TermIssuer', fn: 'scheduleOf', args: [BigInt(p)] },
          { contract: 'TermIssuer', fn: 'delinquentSince', args: [BigInt(p)] },
        ]),
      )
    : [];
  const plans = planIds.map((id, i) => {
    const [member, , outstanding, repaid, , , length, , closed] = pr[i * 3] as [string, bigint, bigint, bigint, bigint, number, bigint, bigint, boolean];
    const [inst, scheduleTotal, installments, start] = pr[i * 3 + 1] as [bigint, bigint, number, bigint];
    return {
      id,
      member: lc(member),
      outstanding: usd(outstanding),
      repaid: usd(repaid),
      length: Number(length) * 1000,
      closed: !!closed,
      inst: usd(inst),
      total: usd(scheduleTotal),
      installments: Number(installments),
      start: Number(start) * 1000,
      behindSince: Number(big(pr[i * 3 + 2])) * 1000,
    };
  });

  // how late each member is: a plan behind since its first missed installment, or a revolving period ended unpaid
  const aging = BUCKETS.map((k) => [k, 0] as [string, number]);
  let late = 0;
  for (const w of who) {
    if (w.balance <= 0) continue;
    const mine = plans.filter((p) => p.member === w.m && !p.closed);
    const revolving = Math.max(0, w.balance - mine.reduce((a, p) => a + p.outstanding, 0));
    const termLate = Math.max(0, ...mine.map((p) => (p.behindSince ? (now - p.behindSince) / DAY : 0)));
    const revLate = revolving > 0 && w.periodEnd && w.periodEnd < now ? (now - w.periodEnd) / DAY : 0;
    const days = Math.floor(Math.max(termLate, revLate));
    aging[bucketOf(days)][1] = round2(aging[bucketOf(days)][1] + w.balance);
    if (days > 0) late++;
  }

  // repayments due in 30 days: each open plan's next installments not already paid ahead, and revolving balances at their period's end
  const horizon = now + 30 * DAY;
  const due = new Map<number, { amount: number; plans: number; cards: number; autopay: number }>();
  const add = (day: number, amount: number, kind: 'plans' | 'cards', autopay: boolean) => {
    const d = due.get(day) ?? { amount: 0, plans: 0, cards: 0, autopay: 0 };
    d.amount = round2(d.amount + amount);
    d[kind]++;
    if (autopay) d.autopay++;
    due.set(day, d);
  };
  const auto = new Map(who.map((w) => [w.m, w.autopay]));
  for (const p of plans) {
    if (p.closed || !p.inst || !p.length) continue;
    for (let k = 1; k <= p.installments; k++) {
      const at = p.start + k * p.length;
      if (at > horizon) break;
      const paid = p.repaid - (k - 1) * p.inst;
      if (paid >= p.inst) continue;
      add(dayOf(at, now), round2(Math.min(p.inst - Math.max(0, paid), p.total - p.repaid)), 'plans', !!auto.get(p.member));
    }
  }
  for (const w of who) {
    const revolving = w.balance - plans.filter((p) => p.member === w.m && !p.closed).reduce((a, p) => a + p.outstanding, 0);
    if (revolving > 0.005 && w.periodEnd && w.periodEnd <= horizon) add(dayOf(w.periodEnd, now), round2(revolving), 'cards', w.autopay);
  }
  const IN: Flow[] = [...due.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, d]) => {
      const parts = [d.plans ? `${d.plans} plan ${d.plans === 1 ? 'installment' : 'installments'}` : '', d.cards ? `${d.cards} card ${d.cards === 1 ? 'balance' : 'balances'}` : ''].filter(Boolean);
      return [day, 'in', d.amount, 'Member repayments', `${parts.join(' · ')}${d.autopay ? ` · ${d.autopay} on autopay` : ''}`];
    });

  // the month so far, from the events
  const t = new Date(now);
  const first = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1);
  const ev = (await events(db, ['ClearCredit', 'RevolvingIssuer', 'TermIssuer', 'AssurancePool'], [
    'PurchaseOriginated', 'PurchaseReversed', 'CardSpendSettled', 'CardSpendReversed', 'CarryAccrued', 'CreditBalanceRepaid', 'CreditLineWrittenOff', 'TermDefaulted', 'AccountReimbursed',
  ]));
  const month = ev.filter((e) => e.at >= first);
  const sum = (name: string, key: string) => round2(month.filter((e) => e.event === name).reduce((a, e) => a + usd(e.args[key]), 0));
  const spent = round2(sum('PurchaseOriginated', 'purchase') - sum('PurchaseReversed', 'purchase') + sum('CardSpendSettled', 'amount') - sum('CardSpendReversed', 'amount'));
  const carry = sum('CarryAccrued', 'amount');
  const repaid = sum('CreditBalanceRepaid', 'amount');
  const credit = round2(who.reduce((a, w) => a + w.balance, 0));

  const name = await shopNames(db);
  const byShop = new Map<string, number>();
  for (const e of month.filter((x) => x.event === 'PurchaseOriginated' || x.event === 'PurchaseReversed')) {
    const n = name.get(lc(e.args.merchant)) ?? `Shop ${String(e.args.merchant).slice(0, 6)}…`;
    byShop.set(n, round2((byShop.get(n) ?? 0) + (e.event === 'PurchaseReversed' ? -1 : 1) * usd(e.args.purchase)));
  }

  // losses, all time: a revolving line written off, a term plan defaulted; and what the AssurancePool paid for them
  const lossEv = ev.filter((e) => e.event === 'CreditLineWrittenOff' || e.event === 'TermDefaulted');
  const losses = lossEv
    .map((e) => [-Math.floor((now - e.at) / DAY), memberLabel(lc(e.args.member)), `${e.tx.slice(0, 10)}`, usd(e.event === 'TermDefaulted' ? e.args.writtenOff : e.args.amount)] as [number, string, string, number])
    .reverse();
  const poolPaid = round2(ev.filter((e) => e.event === 'AccountReimbursed').reduce((a, e) => a + usd(e.args.amount), 0));

  const sizes = new Map<number, number>();
  for (const w of who) if (w.limit > 0) sizes.set(Math.round(w.limit), (sizes.get(Math.round(w.limit)) ?? 0) + 1);

  return {
    members: members.length,
    credit,
    limits: round2(who.reduce((a, w) => a + w.limit, 0)),
    month: MONTHS[t.getUTCMonth()],
    start: round2(credit - spent - carry + repaid),
    spent,
    carry,
    repaid,
    autopay: who.filter((w) => w.autopay).length,
    aging,
    losses,
    lost: round2(losses.reduce((a, l) => a + l[3], 0)),
    poolPaid,
    limitSizes: [...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([v, n]) => [`$${v.toLocaleString('en-US')}`, n]),
    shops: [...byShop.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([n, v]) => [n, v, 0]),
    in: IN,
    due14: round2(IN.filter((f) => f[0] <= 14).reduce((a, f) => a + f[2], 0)),
    late,
    owing: who.filter((w) => w.balance > 0).length,
  };
}
