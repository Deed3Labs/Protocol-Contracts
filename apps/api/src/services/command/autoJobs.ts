import { getAddress, isAddress } from 'viem';
import type { Queryable } from '../../db/db.js';
import { assuranceFeeConfig } from '../assuranceFees/config.js';
import { allItems } from '../assuranceFees/store.js';
import { lastKeeperRun, type KeeperRun } from '../payoutFunding/keeperRuns.js';
import { topUpConfigFromEnv } from '../payoutFunding/topUp.js';
import { topUpAccountName } from '../payoutFunding/topUpCdp.js';
import { deskAccountName, deskConfigFromEnv, settlementFundingEnabled } from '../settlementFunding/config.js';
import { payoutTopUpsLive, type TopUpsCard } from './payoutTopUps.js';
import { settlementFundingLive, type SettlementCard } from './settlementFunding.js';

/*
 * Build → Security, "Automatic jobs" (brief update 2, section 6; the reference's `AUTO`): the API's jobs
 * that move money or read for it. Each is read the way Money reads it: the payout top-ups from what the job
 * recorded (payoutTopUpsLive, migration 0078), the Assurance fee payer from its items and pool readings
 * (migration 0077), the payout funding keeper from its last pass in this server (keeperRuns.ts: it keeps
 * nothing else), and the settlement funding desk (decision 54) from what it recorded (settlementFundingLive,
 * the same record as Money's "Card settlement funding" card). Nothing here reads the chain.
 *
 * A job whose switch isn't set is "Not on yet" and waits (st 'wait'), whatever it recorded before; on, it's
 * its last run, 'ok', or 'bad' when it stopped, failed or needs a person. Wallets are the configured
 * addresses, shortened; no key is ever read.
 */

type Env = Record<string, string | undefined>;

export interface AutoJob {
  id: 'topup' | 'fees' | 'keeper' | 'settlement';
  /** what it is, and what it does */
  t: string;
  d: string;
  /** its wallet's name, and address (shortened) */
  w: string;
  a: string;
  /** the most it can move */
  lim: [string, string];
  /** its last run, and a line under it */
  run: [string, string];
  st: 'ok' | 'wait' | 'bad';
  /** when it last ran (ms), when known */
  at: number | null;
  /** how it's switched off */
  off: [string, string];
}

export interface AutoJobsDeps {
  env?: Env;
  /** the top-up job's record (payoutTopUpsLive unless given) */
  topUps?: (db: Queryable) => Promise<TopUpsCard | null>;
  /** the keeper's last pass in this server (keeperRuns.ts unless given) */
  keeper?: () => KeeperRun | null;
  /** the settlement funding desk's record (settlementFundingLive unless given) */
  settlement?: (db: Queryable, env: Env) => Promise<SettlementCard | null>;
}

/** The same switch test the jobs use. */
const on = (v: string | undefined) => /^(1|true|on|yes)$/i.test((v ?? '').trim());
const short = (a: string | null | undefined) => (a && isAddress(a.trim()) ? `${getAddress(a.trim()).slice(0, 6)}…${getAddress(a.trim()).slice(-4)}` : '—');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const when = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
};
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
const chainOf = (env: Env) => {
  const n = Number((env.SAVINGS_DEFAULT_CHAIN_ID || env.SEND_DEFAULT_CHAIN_ID || '').trim());
  return Number.isInteger(n) && n > 0 ? n : 84532;
};

const TOPUP_OUTCOME: Record<string, [string, AutoJob['st']]> = {
  idle: ['Nothing to top up', 'ok'],
  funded: ['Topped up the pool', 'ok'],
  pending: ['A top-up is in flight', 'ok'],
  busy: ['A top-up is in flight', 'ok'],
  setup: ['Its setup on chain isn’t finished', 'wait'],
  'needs-human': ['Over the limit: a Safe batch waits for CL Operating', 'bad'],
  'operating-short': ['CL Operating lacks the money', 'bad'],
  failed: ['A top-up failed', 'bad'],
  halted: ['Stopped until a person clears it', 'bad'],
};

async function topUpJob(db: Queryable, env: Env, read: (db: Queryable) => Promise<TopUpsCard | null>): Promise<AutoJob> {
  const config = topUpConfigFromEnv(env);
  const enabled = on(env.PAYOUT_TOPUP_ENABLED);
  const card = enabled ? await read(db).catch(() => null) : null;
  const wallet = (env.PAYOUT_TOPUP_WALLET || '').trim() || card?.wallet || '';
  const every = (min: number) => (min === 10_080 ? 'a week' : min % 1440 === 0 ? `every ${min / 1440} days` : `every ${min} minutes`);
  const base = {
    id: 'topup' as const,
    t: 'Payout top-ups',
    d: `Decision 51 · CL Operating to the PayoutPool when ${config.lowDays} days is short`,
    w: topUpAccountName(chainOf(env), env),
    a: short(wallet),
    off: ['PAYOUT_TOPUP_ENABLED', 'Or CL Operating removes the delegate'] as [string, string],
  };
  const lim: [string, string] =
    card && card.allowance.cap
      ? [`${usd(card.allowance.cap)} ${every(card.allowance.resetMinutes)}`, `Set on chain · ${usd(card.allowance.spent)} spent this period`]
      : ['The weekly limit set on chain', 'On CL Operating’s AllowanceModule'];
  if (!enabled) return { ...base, lim, run: ['Not on yet', 'Turns on when PAYOUT_TOPUP_ENABLED is set'], st: 'wait', at: null };
  if (!card) return { ...base, lim, run: ['Not run yet', `Checks every ${config.checkMinutes} minutes once started`], st: 'wait', at: null };
  if (card.halted) return { ...base, lim, run: ['Stopped', `Top-up ${card.halted.id} failed: ${card.halted.error || 'see its record'}`], st: 'bad', at: card.lastCheck };
  const [line, st] = TOPUP_OUTCOME[card.outcome] ?? [card.outcome || 'Checked', 'ok'];
  return { ...base, lim, run: [`Checked ${when(card.lastCheck!)}`, line], st, at: card.lastCheck };
}

async function feeJob(db: Queryable, env: Env): Promise<AutoJob> {
  const config = assuranceFeeConfig(env);
  const base = {
    id: 'fees' as const,
    t: 'Assurance fee payer',
    d: 'Clear Lending’s monthly fee and recoveries into the Credit Backstop',
    w: config.cdpAccountName ?? 'CL Fees',
    a: short(config.clFees),
    lim: ['Only what CL Operating sent it', 'Fee and recovery tags · exactly the recorded amount'] as [string, string],
    off: ['ASSURANCE_FEE_PAYER_ENABLED', 'Or the pool drops it as a payer'] as [string, string],
  };
  if (!config.payerEnabled || !config.pool)
    return {
      ...base,
      run: ['Not on yet', !config.pool ? `Needs the new pool’s address · ASSURANCE_POOL_V2_${config.chainId}` : 'Turns on when ASSURANCE_FEE_PAYER_ENABLED is set'],
      st: 'wait',
      at: null,
    };
  const items = await allItems(db, config.chainId).catch(() => []);
  const { rows } = await db
    .query<{ at: Date | null }>('SELECT max(read_at) AS at FROM command.assurance_snapshots WHERE chain_id = $1', [config.chainId])
    .catch(() => ({ rows: [] as { at: Date | null }[] }));
  const readAt = rows[0]?.at ? new Date(rows[0].at).getTime() : null;
  const failed = items.find((i) => i.status === 'failed');
  if (failed)
    return {
      ...base,
      run: ['Stopped', `${failed.kind === 'fee' ? 'The fee' : failed.kind === 'recovery' ? 'A recovery' : 'A repayment'} for ${failed.month.slice(0, 7)} failed: ${failed.error ?? 'see its record'}`],
      st: 'bad',
      at: readAt,
    };
  const paid = items.filter((i) => i.paidAt).sort((a, b) => b.paidAt!.getTime() - a.paidAt!.getTime())[0];
  const owed = items.filter((i) => ['due', 'funding_proposed', 'funded', 'sending'].includes(i.status)).length;
  if (readAt == null && !paid) return { ...base, run: ['Not run yet', 'Reads the pool hourly once started'], st: 'wait', at: null };
  const at = Math.max(readAt ?? 0, paid?.paidAt?.getTime() ?? 0);
  return {
    ...base,
    run: [`Checked ${when(at)}`, owed ? `${owed} to pay` : paid ? `Last paid ${usd(Number(paid.amount) / 1e6)} on ${when(paid.paidAt!.getTime()).split(',')[0]}` : 'Nothing to pay'],
    st: 'ok',
    at,
  };
}

function keeperJob(env: Env, last: () => KeeperRun | null): AutoJob {
  const base = {
    id: 'keeper' as const,
    t: 'Payout funding keeper',
    d: 'Checks the deadline rule and the 30-day standing balance',
    w: 'No wallet',
    a: 'read-only',
    lim: ['Moves nothing', 'Emails ops once a day when Amber or Red'] as [string, string],
    off: ['PAYOUT_KEEPER_ENABLED', 'It only reads'] as [string, string],
  };
  if (!on(env.PAYOUT_KEEPER_ENABLED)) return { ...base, run: ['Not on yet', 'Turns on when PAYOUT_KEEPER_ENABLED is set'], st: 'wait', at: null };
  const r = last();
  if (!r) return { ...base, run: ['Not run yet', 'Checks hourly'], st: 'wait', at: null };
  if (r.result === 'failed') return { ...base, run: [`Couldn’t read the chain · ${when(r.at)}`, 'Ops is told after three in a row'], st: 'bad', at: r.at };
  if (r.result === 'GREEN') return { ...base, run: [`Green · ${when(r.at)}`, 'Funded ahead of every deadline'], st: 'ok', at: r.at };
  return { ...base, run: [`${r.result === 'RED' ? 'Red' : 'Amber'} · ${when(r.at)}`, 'Ops is emailed once a day'], st: 'bad', at: r.at };
}

const SETTLEMENT_OUTCOME: Record<string, [string, AutoJob['st']]> = {
  idle: ['Nothing to fund', 'ok'],
  waiting: ['Waiting for the funding window', 'ok'],
  funded: ['Funded the Credit Settlement Account', 'ok'],
  pending: ['A move is on its way to the CSA', 'ok'],
  returned: ['Returned the surplus', 'ok'],
  'returns-off': ['Surplus idle · Returns are off', 'ok'],
  'dry-run': ['Dry run: decided, sent nothing', 'ok'],
  setup: ['The settlement lane isn’t set up', 'wait'],
  'needs-human': ['Over the limit or short: a person is needed', 'bad'],
  unknown: ['Can’t read the CSA · nothing moved', 'bad'],
  failed: ['A check failed', 'bad'],
  halted: ['Stopped until a person clears it', 'bad'],
};

/** The settlement funding desk (decision 54): the CSA before each card cut-off, Collection Account first, then the Yield Pool's lane. */
async function settlementJob(db: Queryable, env: Env, read: (db: Queryable, env: Env) => Promise<SettlementCard | null>): Promise<AutoJob> {
  const enabled = settlementFundingEnabled(env);
  const card = enabled ? await read(db, env).catch(() => null) : null;
  const wallet = (env.SETTLEMENT_DESK_WALLET || '').trim() || card?.wallet || '';
  const per = (sec: number) => (sec === 604_800 ? 'a week' : sec === 86_400 ? 'a day' : sec > 0 && sec % 86_400 === 0 ? `every ${sec / 86_400} days` : sec > 0 ? `every ${Math.round(sec / 60)} minutes` : 'a period');
  const base = {
    id: 'settlement' as const,
    t: 'Settlement funding',
    d: 'Decision 54 · the Credit Settlement Account before each card cut-off: Collection Account first, then the Yield Pool',
    w: deskAccountName(card?.chainId ?? chainOf(env), env),
    a: short(wallet),
    off: ['SETTLEMENT_FUNDING_ENABLED', 'Or stopSettlementFunder() on the Yield Pool'] as [string, string],
  };
  const lim: [string, string] =
    card && card.lane.upgraded && card.lane.cap
      ? [`${usd(card.lane.cap)} ${per(card.lane.periodSeconds)}`, `The lane’s limit, set on chain by two deployers · ${usd(card.lane.used)} used this period`]
      : ['The lane’s limit set on chain', 'By two DEPLOYER_ROLE signers · SL-funder-1/2'];
  if (!enabled) return { ...base, lim, run: ['Not on yet', 'Turns on when SETTLEMENT_FUNDING_ENABLED is set'], st: 'wait', at: null };
  if (!card || !card.lastCheck) return { ...base, lim, run: ['Not run yet', `Checks every ${deskConfigFromEnv(env).checkMinutes} minutes once started`], st: 'wait', at: null };
  const at = card.lastCheck;
  if (card.halted) return { ...base, lim, run: ['Stopped', `Move ${card.halted.id} failed: ${card.halted.error || 'see its record'}`], st: 'bad', at };
  if (card.lane.stopped) return { ...base, lim, run: ['Stopped on chain', 'stopSettlementFunder was called · two deployers restart it (SL-funder-1/2)'], st: 'bad', at };
  if (card.setup.length) return { ...base, lim, run: [`Checked ${when(at)}`, `The settlement lane isn’t set up: ${card.setup[0]}`], st: 'wait', at };
  const [line, st] = SETTLEMENT_OUTCOME[card.outcome] ?? [card.outcome || 'Checked', 'ok'];
  return { ...base, lim, run: [`Checked ${when(at)}`, card.dryRun && card.outcome !== 'dry-run' ? `Dry run · ${line}` : line], st, at };
}

export async function autoJobs(db: Queryable, deps: AutoJobsDeps = {}): Promise<AutoJob[]> {
  const env = deps.env ?? process.env;
  return [
    await topUpJob(db, env, deps.topUps ?? payoutTopUpsLive),
    await feeJob(db, env),
    keeperJob(env, deps.keeper ?? lastKeeperRun),
    await settlementJob(db, env, deps.settlement ?? ((d, e) => settlementFundingLive(d, e))),
  ];
}
