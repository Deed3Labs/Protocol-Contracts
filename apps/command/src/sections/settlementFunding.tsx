// @ts-nocheck: reads the section data the API fills (money.SETTLEMENT_FUNDING, contracts.AUTOMATIC_JOBS), which is untyped, as the sections are.
import { Fragment, useEffect, useState } from 'react';
import { api } from '../live/api';
import { demoTopUps } from './payoutTopUps';

/*
 * Card settlement funding (decision 54), on Money · Pools · Yield pool, in the automatic top-ups
 * card's style. The settlement funding desk (apps/api jobs/fundingDesk.ts) funds the Credit
 * Settlement Account before each card settlement cut-off: first from the Collection Account (members'
 * repayments, by book transfer), then from the Yield Pool through the settlement lane, within a
 * per-period limit two DEPLOYER_ROLE signers set once. The API sends what the desk recorded
 * (services/command/settlementFunding.ts); the demo shows the same sample the seeded API does.
 *
 * Also here: the Pool Tier principal worksheet (GET /pool-tier-principal), a read-only suggestion for
 * the two valuation signers, and Build → Security's automatic jobs (the demo's rows).
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const hx = (n) => '0x' + n.toString(16).padStart(64, '0');

/** The demo's card: a weekday with a book transfer and one lane Deployment on their way (the seeded API sends the same). */
export function demoSettlement(now) {
  const next = now + 5 * HOUR;
  return {
    enabled: true, dryRun: false, returnsEnabled: false, chainId: 84532, explorer: 'https://sepolia.basescan.org/tx/', lastCheck: now - 9 * 60_000, outcome: 'funded',
    wallet: '0x5e77ed5fd1b3a6a0c3e5c0de57a1c0b3d5a9e2f4', forwarder: '0x9f0ad1e3a9cb0e7f2d4c5b6a7e8f9a0b1c2d3e4f', safe: '0xfAFf1081F77bF528bA21eea590f251a755bCdf65',
    offRamp: { name: 'mock', rail: 'same-day ACH', address: '0x0ff0000000000000000000000000000000000c5a' }, bank: 'lithic',
    cutoff: { next, through: next, rollover: false, forcedAt: next - 5 * HOUR, latencyMinutes: 240, measuredMinutes: 212 },
    byCutoff: [[next, 2316.4]],
    due: 2316.4, dueSettled: 2316.4, duePending: 0, buffer: 1000, target: 3316.4, csa: 1120.15, inFlight: 2196.25, need: 0, surplus: 0, pendingCredit: 684.9,
    netting: { collection: 412.6, bookedToday: 1412.6, drawsDue: 2316.4 },
    today: { day: new Date(now).toISOString().slice(0, 10), sent: 0, booked: 1412.6, returnedPool: 0, returnedMargin: 0, marginAdvanced: 0 },
    week: { days: 5, sent: 3850, booked: 6204.35, returnedPool: 640, returnedMargin: 0 },
    lane: { upgraded: true, stopped: false, cap: 5000, used: 1783.65, left: 3216.35, periodSeconds: 604800, periodStart: now - 3 * DAY, headroom: 1000, headroomUsed: 0, principal: 9400, deployed: 8870, poolRoom: 1530 },
    allowance: { cap: 5000, spent: 1783.65, remaining: 3216.35, resetMinutes: 10080 },
    setup: [], needsHuman: null, halted: null, marginOutstanding: 0,
    recent: [
      { id: 2, at: now - 2 * HOUR, kind: 'deploy', status: 'forwarded', amount: 783.65, cutoffAt: next, txs: [['deploySettlement', hx(0xb1)], ['forward', hx(0xb2)]], error: null },
      { id: 1, at: now - 2 * HOUR, kind: 'book', status: 'booked', amount: 1412.6, cutoffAt: next, txs: [], error: null },
    ],
  };
}

const when = (t) => new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const ago = (t, now) => {
  const m = Math.max(0, Math.round((now - t) / 60_000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const period = (sec) => (!sec ? 'period' : sec % 86400 === 0 ? (sec === 86400 ? 'day' : sec === 604800 ? 'week' : `${sec / 86400} days`) : `${Math.round(sec / 60)} min`);
const KIND = {
  book: 'Book transfer from the Collection Account',
  deploy: 'Settlement Funding from the Yield Pool',
  'return-pool': 'Return to the Yield Pool',
  'return-margin': 'Savings-Backed Margin restored',
  'margin-advance': 'Savings-Backed Margin advance',
};
const STATUS = (s) => (s === 'done' ? 'Done' : s === 'failed' ? 'Failed' : ['booked', 'forwarded', 'sent'].includes(s) ? 'On its way' : 'In flight');
const OUTCOME = {
  idle: 'nothing to do', waiting: 'waiting for the window', funded: 'funded', pending: 'in flight', returned: 'returned', 'returns-off': 'surplus idle · Returns off',
  'needs-human': 'needs a person', setup: 'lane not set up', unknown: 'can’t read the CSA', 'dry-run': 'dry run', halted: 'stopped', failed: 'check failed',
};

/** Which state the card is in: halted, lane not set up, short, or normal. */
export function settlementState(S) {
  if (S.halted) return 'halted';
  if (S.setup?.length) return 'setup';
  if (S.needsHuman) return 'short';
  return 'normal';
}

const batchHref = (b) => 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(b, null, 2));

/** The card's right label, body and foot for money2's `cell`. */
export function settlementParts(S, money, now = Date.now()) {
  const csaText = S.csa == null ? 'Can’t be read · nothing moves' : money(S.csa);
  const rows = [
    ['Last check', S.lastCheck ? ago(S.lastCheck, now) : 'not yet'],
    [`Next cut-off · ${S.cutoff.next ? when(S.cutoff.next) : '—'}${S.cutoff.rollover ? ` · through ${when(S.cutoff.through)}` : ''}`, `${money(S.due)} due`],
    ['Credit Settlement Account · buffer', `${csaText} · ${money(S.buffer)} buffer`],
    ['On its way to the CSA', money(S.inFlight)],
    [`Still needed · forced run ${S.cutoff.forcedAt ? when(S.cutoff.forcedAt) : '—'}`, S.need > 0 ? money(S.need) : S.surplus > 0 ? `covered · ${money(S.surplus)} over` : 'covered'],
    ['Today’s netting · Collection Account', `${S.netting.collection == null ? 'Can’t be read' : money(S.netting.collection)} · ${money(S.netting.bookedToday)} booked to the CSA`],
    ['New card draws due · authorized, not settled', `${money(S.netting.drawsDue)} · ${money(S.pendingCredit)}`],
    ['Settlement Funding today · sent / returned', `${money(S.today.sent)} / ${money(S.today.returnedPool)}`],
    [`Last ${S.week.days || 0} days reconciled · sent / returned`, `${money(S.week.sent)} / ${money(S.week.returnedPool + S.week.returnedMargin)}`],
    [
      `Funder limit · every ${period(S.lane.periodSeconds)}${S.lane.periodStart ? ` · since ${when(S.lane.periodStart)}` : ''}`,
      !S.lane.upgraded ? 'Not on chain yet' : `${money(S.lane.used)} of ${money(S.lane.cap)} used${S.lane.stopped ? ' · stopped' : ''}`,
    ],
    ['Settlement Headroom · over the posted principal', S.lane.upgraded ? `${money(S.lane.headroomUsed)} of ${money(S.lane.headroom)} used` : '—'],
    ...(S.marginOutstanding ? [['Savings-Backed Margin to restore', money(S.marginOutstanding)]] : []),
  ];
  const note = (title, words, extra = <b />) => (
    <div className="nl">
      <div className="nl-r">
        <span className="leaf"><b>!</b></span>
        <span><b>{title}</b><span>{words}</span></span>
        {extra}
      </div>
    </div>
  );
  const N = S.needsHuman;
  const body = (
    <>
      {S.halted ? note(`Stopped after move #${S.halted.id}`, `${S.halted.error}. Nothing moves until someone looks and clears it: bun src/scripts/clearSettlementFundingHalt.ts ${S.halted.id} "<your name>"`) : ''}
      {S.setup?.length ? note('The settlement lane isn’t set up', `${S.setup.join('; ')}. The one-time steps are stage SL of scripts/signing_plan.ts, on the signing page: the upgrade (SL-upgrade-schedule, then SLx-upgrade-execute), SL-funder-1/2, SL-headroom-1/2 and CL Operating’s batch (SL-cl-operating-*). Until then the CSA is funded from the Collection Account, and by people.`) : ''}
      {N && N.capShort ? note(
        `Over the limit: ${money(N.capShort)} needs two deployers and CL Operating’s owners`,
        'The lane’s limit (or the forwarder’s allowance) is used up this period. Two DEPLOYER_ROLE signers send the Deployment batch; then CL Operating’s owners sign the transfer to the off-ramp.',
        N.batches ? <span><a className="btn sm-b" download="settlement-remainder-deployers.json" href={batchHref(N.batches.deployers)}>Deployers</a>{' '}<a className="btn sm-b" download="settlement-remainder-cl-operating.json" href={batchHref(N.batches.clOperating)}>CL Operating</a></span> : <b />,
      ) : ''}
      {N && N.poolShort ? note(
        `Short ${money(N.poolShort)} for the cut-off`,
        `Neither the Collection Account nor the Yield Pool covers it${N.blocked?.length ? ` (${N.blocked.join('; ')})` : ''}. In order: the Savings-Backed Margin at the bank (then record it), BondVault excess where its documents allow, Clear Lending’s treasury. The ESA vault is never a source.`,
      ) : ''}
      <div className="led npl">{rows.map(([k, v], i) => <div key={i}><span>{k}</span><b>{v}</b></div>)}</div>
      <p className="small quiet" style={{ padding: '0 22px' }}>Collections and new draws are not matched one against the other: members’ repayments in the Collection Account net against the draws due by book transfer to the CSA, and the pool funds only the rest.</p>
      <div className="nl">
        {S.recent.length ? S.recent.map((r) => (
          <div key={r.id} className="nl-r">
            <span className="leaf"><b>{new Date(r.at).getUTCDate()}</b><span>{new Date(r.at).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</span></span>
            <span>
              <b>{`#${r.id} · ${KIND[r.kind] ?? r.kind}`}</b>
              <span>{STATUS(r.status)}{r.error ? ` · ${r.error}` : ''}{r.txs.map(([k, h]) => <Fragment key={k}>{' · '}<a href={S.explorer + h} target="_blank" rel="noreferrer">{k}</a></Fragment>)}</span>
            </span>
            <b>{money(r.amount)}</b>
          </div>
        )) : <p className="nmv-e">No settlement funding moves yet.</p>}
      </div>
    </>
  );
  const foot = <><span>Funds each cut-off, never a swipe · Collection Account first · never past the funder limit · the ESA vault never funds</span><span /></>;
  const right = <span className="lbl">{`Desk · ${S.dryRun ? 'dry run · ' : ''}${OUTCOME[S.outcome] ?? (S.outcome || 'on')}`}</span>;
  return [right, body, foot];
}

/* ── the Pool Tier principal worksheet (read-only) ── */

const TIER = { SAVINGS: 'Savings-backed', INCOME: 'Income-backed', BOOST: 'Clear Boost', PARTNER: 'Partner Credit', CASH: 'Clear Cash' };
const u = (v) => ({ units: String(Math.round(v * 1e6)), usd: v });

/** The demo's worksheet (the API's GET /pool-tier-principal shape). */
export function demoPrincipal(now) {
  return {
    total: u(9585.4),
    tiers: [
      { kind: 'SAVINGS', principal: u(4210), members: 14 },
      { kind: 'INCOME', principal: u(2875.4), members: 6 },
      { kind: 'BOOST', principal: u(500), members: 4 },
    ],
    term: { principal: u(2000), plans: 3 },
    marginAdvances: u(0),
    kinds: ['SAVINGS', 'INCOME', 'BOOST'],
    posted: { value: u(9400), postedAt: Math.floor((now - 6 * DAY) / 1000) },
    difference: u(185.4),
    deployedBalance: u(8870),
    headroom: u(1000),
    laneCeiling: u(10400),
    note: 'What the two VALUATION_ROLE signers should post with postPoolTierPrincipal(value, evidenceHash). Read-only: nothing posts it automatically.',
  };
}

/** The Yield Pool's posted Pool Tier principal and, beside it, what the worksheet suggests. Live, read when shown. */
export function PoolTierPrincipal({ demo, money, cls = 's5' }) {
  const [P, setP] = useState(demo ? demoPrincipal(Date.now()) : null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (demo) return undefined;
    let off = false;
    api('GET', '/pool-tier-principal')
      .then((r) => !off && setP(r))
      .catch((e) => !off && setError(e instanceof Error ? e.message : 'The book could not be read'));
    return () => {
      off = true;
    };
  }, [demo]);
  const m = (x) => (x == null ? '—' : money(x.usd));
  const rows = P
    ? [
        ...P.tiers.map((t) => [`${TIER[t.kind] ?? t.kind} · ${t.members} ${t.members === 1 ? 'member' : 'members'}`, m(t.principal)]),
        [`Term plans · ${P.term.plans} open`, m(P.term.principal)],
        ['Savings-Backed Margin advances', m(P.marginAdvances)],
        ['Posted now', P.posted ? `${m(P.posted.value)} · ${new Date(P.posted.postedAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Never posted'],
        ['Suggested less posted', m(P.difference)],
        ['Deployed Balance', m(P.deployedBalance)],
        ['Settlement lane ceiling · posted + headroom', P.laneCeiling ? `${m(P.laneCeiling)} · ${m(P.headroom)} headroom` : 'No lane yet'],
      ]
    : [];
  return (
    <div className={`cell ${cls}`} data-pool-tier-principal="">
      <div className="hd"><h2>Pool Tier principal</h2><div className="r"><span className="lbl">Suggested — the valuation signers post it</span></div></div>
      <div className="npd">
        {P ? (
          <>
            <div className="m-big">{m(P.posted?.value ?? null)}{' '}<small>{`posted · ${m(P.total)} suggested — the valuation signers post it`}</small></div>
            <div className="led">{rows.map(([k, v], i) => <div key={i}><span>{k}</span><b>{v}</b></div>)}</div>
          </>
        ) : error ? <p className="nmv-e">{error}</p> : <p className="nmv-e">Reading the book…</p>}
      </div>
      <div className="bk-ft"><span>Read-only · two VALUATION_ROLE signers post it with postPoolTierPrincipal · nothing posts it automatically</span><span /></div>
    </div>
  );
}

/* ── Build → Security: the automatic jobs ── */

/** The demo's rows (the seeded API sends the same): the payout top-up bot and the settlement funding desk. */
export function demoJobs(now) {
  const T = demoTopUps(now);
  const S = demoSettlement(now);
  return [
    { id: 'payout-topups', name: 'Payout top-ups', state: 'on', wallet: T.wallet, lastCheck: T.lastCheck, calls: 'AllowanceModule pull from CL Operating · approve and fund on the PayoutPool', limit: { cap: T.allowance.cap, periodSeconds: T.allowance.resetMinutes * 60, used: T.allowance.spent, allowance: T.allowance.cap }, stop: 'CL Operating’s owners remove the bot as delegate (AllowanceModule.removeDelegate)', note: '' },
    { id: 'settlement-funding', name: 'Settlement funding', state: 'on', wallet: S.wallet, lastCheck: S.lastCheck, calls: 'deploySettlement on the Yield Pool · forward on the SettlementForwarder · approve and returnFunds for a Return', limit: { cap: S.lane.cap, periodSeconds: S.lane.periodSeconds, used: S.lane.used, allowance: S.allowance.cap }, stop: 'stopSettlementFunder() · one DEPLOYER_ROLE or CCO_ROLE holder · restarting takes two deployers (SL-funder-1/2)', note: '' },
  ];
}

const JOB_STATE = { on: 'On', off: 'Off · never checked', stopped: 'Stopped', setup: 'Lane not set up', 'dry-run': 'Dry run' };
const shortA = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : 'No wallet yet');

const dollars = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The automatic jobs' ledger rows: [name, what it may call and how it is stopped, its state, wallet and limit]. */
export function jobRows(jobs, now = Date.now(), money = dollars) {
  return (jobs ?? []).map((j) => [
    j.name,
    `${j.calls} · stop: ${j.stop}${j.note ? ` · ${j.note}` : ''}`,
    `${JOB_STATE[j.state] ?? j.state} · ${shortA(j.wallet)}${j.limit ? ` · ${money(j.limit.used)} of ${money(j.limit.cap)} per ${period(j.limit.periodSeconds)}` : ''}${j.lastCheck ? ` · ${ago(j.lastCheck, now)}` : ''}`,
  ]);
}
