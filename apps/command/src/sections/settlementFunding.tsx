// @ts-nocheck: reads the section data the API fills (money.SETTLEMENT_FUNDING), which is untyped, as the sections are.
import { Fragment, useEffect, useState } from 'react';
import { api } from '../live/api';

/*
 * The Pool Tier principal worksheet (GET /pool-tier-principal), a read-only suggestion for
 * the two valuation signers. The desk's row in Build → Security's automatic jobs is the API's AUTO
 * (autoJobs.ts), with a demo row beside the others in build2.tsx.
 */

const DAY = 86_400_000;

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
