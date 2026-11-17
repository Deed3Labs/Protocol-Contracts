// @ts-nocheck: reads the section data the API fills (money.PAYOUT_TOPUPS), which is untyped, as the sections are.
import { Fragment } from 'react';

/*
 * Money · Pools · Payout pool: the automatic top-ups card (decision 51). The API sends what the
 * payout top-up job recorded (services/command/payoutTopUps.ts); the demo shows the same sample the
 * seeded API does. Returns the card's right label, body and foot for money2's `cell`.
 */

const DAY = 86_400_000;
const hx = (n) => '0x' + n.toString(16).padStart(64, '0');

/** The demo's card: a quiet week with one automatic top-up (the seeded API sends the same). */
export function demoTopUps(now) {
  return {
    enabled: true, chainId: 84532, explorer: 'https://sepolia.basescan.org/tx/', lastCheck: now - 6 * 60_000,
    wallet: '0xC0C4EC7875D1838C0AE610accC16AAdCDb475068', safe: '0xfAFf1081F77bF528bA21eea590f251a755bCdf65',
    low: { days: 14, due: 4820.4, short: 0 }, target: { days: 30, due: 9310.75, short: 0 }, margin: 100, operating: 18400,
    allowance: { cap: 5000, spent: 3216.3, remaining: 1783.7, resetMinutes: 10080, resetsAt: now + 3 * DAY },
    outcome: 'idle',
    recent: [{ id: 1, at: now - 4 * DAY, amount: 3216.3, trigger: 'low-water', status: 'funded', txs: [['pull', hx(0xa1)], ['approve', hx(0xa2)], ['fund', hx(0xa3)]] }],
    needsHuman: null, halted: null,
  };
}

const when = (t) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const ago = (t, now) => {
  const m = Math.max(0, Math.round((now - t) / 60_000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const TRIGGER = { 'low-water': '14-day low-water', overdue: 'claims overdue', 'wallet-balance': 'remainder from CL Operating' };

export function topUpsParts(T, money, now = Date.now()) {
  const short = (p) => (p.short ? `${money(p.short)} short` : 'covered');
  const per = T.allowance.resetMinutes % 1440 === 0 ? `${T.allowance.resetMinutes / 1440} days` : `${T.allowance.resetMinutes} min`;
  const rows = [
    ['Last check', T.lastCheck ? ago(T.lastCheck, now) : 'not yet'],
    [`Due in ${T.low.days} days · moves if short`, `${money(T.low.due)} · ${short(T.low)}`],
    [`Due in ${T.target.days} days · refills to`, `${money(T.target.due)} · ${short(T.target)}`],
    [`Spending limit · every ${per}`, `${money(T.allowance.spent)} of ${money(T.allowance.cap)} used`],
    ['Left this period', `${money(T.allowance.remaining)}${T.allowance.resetsAt ? ` · resets ${when(T.allowance.resetsAt)}` : ''}`],
    ['In CL Operating', money(T.operating)],
  ];
  const batchHref = T.needsHuman?.batch ? 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(T.needsHuman.batch, null, 2)) : null;
  const body = (
    <>
      {T.halted ? (
        <div className="nl">
          <div className="nl-r">
            <span className="leaf"><b>!</b></span>
            <span><b>{`Stopped after top-up #${T.halted.id}`}</b><span>{`${T.halted.error}. Nothing moves until someone clears it: bun src/scripts/clearPayoutTopUpHalt.ts ${T.halted.id}`}</span></span>
            <b />
          </div>
        </div>
      ) : ''}
      {T.needsHuman ? (
        <div className="nl">
          <div className="nl-r">
            <span className="leaf"><b>!</b></span>
            <span><b>{`Needs CL Operating’s owners: ${money(T.needsHuman.remainder)}`}</b><span>{T.needsHuman.why === 'cap-exhausted' ? 'The spending limit is used up this period. ' : 'More than the spending limit allows. '}{'Load the batch on CL Operating in the Safe app; the bot funds it on its next check.'}</span></span>
            {batchHref ? <a className="btn sm-b" download="payout-topup-remainder.json" href={batchHref}>Safe batch</a> : <b />}
          </div>
        </div>
      ) : ''}
      <div className="led npl">{rows.map(([k, v], i) => <div key={i}><span>{k}</span><b>{v}</b></div>)}</div>
      <div className="nl">
        {T.recent.length ? T.recent.map((r) => (
          <div key={r.id} className="nl-r">
            <span className="leaf"><b>{new Date(r.at).getUTCDate()}</b><span>{new Date(r.at).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</span></span>
            <span>
              <b>{`Top-up #${r.id} · ${TRIGGER[r.trigger] ?? r.trigger}`}</b>
              <span>{r.status === 'funded' ? 'Funded' : r.status === 'failed' ? 'Failed' : 'In flight'}{r.txs.map(([k, h]) => <Fragment key={k}>{' · '}<a href={T.explorer + h} target="_blank" rel="noreferrer">{k}</a></Fragment>)}</span>
            </span>
            <b>{money(r.amount)}</b>
          </div>
        )) : <p className="nmv-e">No automatic top-ups yet.</p>}
      </div>
    </>
  );
  const foot = <><span>{`Moves only when ${T.low.days} days is short · never more than the Safe spending limit`}</span><span /></>;
  const right = <span className="lbl">{`Bot · ${T.outcome === 'idle' ? 'nothing to do' : T.outcome || 'on'}`}</span>;
  return [right, body, foot];
}

