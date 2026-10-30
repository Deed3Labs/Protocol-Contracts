// @ts-nocheck: ported from the redesign's MEMBERS2 module (design/command-center-ui) with scripts/port/module.cjs; its data is its own.
import { Fragment } from 'react';
import { attrs, css, hasHtml, html } from '../runtime/dom';
import { REAL } from '../live/env';
import { api } from '../live/api';
import { run } from '../live/actions';
import { addReveal } from './admin2';
import { CC } from './cc';
import { INBOX, RANGE } from './data';
import { membersLive } from './membersLive';
import { registerPage, shadowHost } from './pageHost';
import { render as redraw, toast } from './shell';

/*
 * Members (design/command-center-ui, the MEMBERS2 module): everyone from the waitlist to active, as one
 * set, in four tabs (People, Batches, Nudges, Waitlist). It lives in its own shadow root (pageHost.tsx),
 * with Growth's sheet and its own (m) adopted. Names and contacts are masked; every reveal is logged.
 * Links out go through CC.go, so they land on the right page and pane.
 */

/** The page's skeleton: the reference template's markup, drawn once into the shadow root. */
function skeleton() {
  return <div className="gw mw"><div className="hdr stack" id="hdr" /><nav className="gtabs" aria-label="Members views"><button data-mtab="people">People</button><button data-mtab="batches">Batches</button><button data-mtab="nudges">Nudges</button><button data-mtab="waitlist">Waitlist</button></nav><div className="ctl" id="ctl" /><div id="mv" /></div>;
}
function makeMembers() {
  const { host, R, W, into, $g: $m } = shadowHost('members', skeleton());
  // live, every dataset is the API's (membersLive.ts); the prototype draws the reference's own
  const LV = REAL ? membersLive() : null;
  const MLIVE = () => host.isConnected && CC.route() === 'members';
  const RO = () => CC.viewing() && CC.level('members') < 3;
  // Totals: the view previewed at that level, or live at it (the API sent no names)
  const TOT = () => CC.viewing() && CC.level('members') === 1 || LV?.names === 'none';
  const barH = () => {
    const b = document.querySelector('.top');
    return b ? b.getBoundingClientRect().bottom : 0;
  };
  const tabTop = () => {
    const tb = R.querySelector('.gtabs');
    if (!tb) return;
    const y = tb.getBoundingClientRect().top - barH();
    if (y < 0) window.scrollTo({
      top: window.scrollY + y,
      behavior: 'instant'
    });
  };
  const setHash = () => {
    if (!MLIVE()) return;
    try {
      history.replaceState(null, '', '#members' + (M.tab === 'people' ? '' : '/' + M.tab));
    } catch (e) {}
  };

  /* ══ Members: where you deal with people ═════════════════════════════════════════════
     Everyone from the waitlist to active, as one set. Counts match Growth: 1,800 joined, 1,500 waiting,
     300 invited in 12 batches, 188 opened, 124 activated (64 opened but not funded), 109 first $10 spends.
     Names and contacts are masked; every reveal is logged. Account changes need a second person. */
  const TODAY = LV ? LV.TODAY : 78,
    D0 = LV ? LV.D0 : [2026, 7, 4];
  const dayDate = i => new Date(D0[0], D0[1], D0[2] + i);
  const dFmt = i => {
    const d = dayDate(i);
    return `${d.getDate()} ${d.toLocaleString('en', {
      month: 'short'
    })}`;
  };
  const tFmt = jt => {
    const h = jt % 1 * 24,
      hh = Math.floor(h),
      mm = Math.floor((h - hh) * 60);
    return `${hh % 12 || 12}:${String(mm).padStart(2, '0')}${hh < 12 ? 'am' : 'pm'}`;
  };
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const pct = (a, b) => b ? a / b * 100 : 0;
  const p1 = v => v.toFixed(1) + '%';
  function rng(seed) {
    let s = seed;
    return () => (s = s * 16807 % 2147483647, (s - 1) / 2147483646);
  }
  const CITIES = LV ? LV.CITIES : [['Redlands', .31], ['San Bernardino', .25], ['Riverside', .18], ['Fontana', .06], ['Highland', .05], ['Rialto', .04], ['Loma Linda', .04], ['Colton', .04], ['Yucaipa', .03]];
  const SHOPS = LV ? LV.SHOPS : [["Rosa’s Panadería", 'Redlands'], ['Inland Cycle Works', 'Redlands'], ['Uptown Barber', 'Redlands'], ['State St. Books', 'Redlands'], ['Mesa Laundry', 'San Bernardino'], ['La Michoacana', 'San Bernardino'], ['Arrowhead Nails', 'San Bernardino'], ['Citrus Bowl Café', 'Riverside'], ['Orange St. Laundromat', 'Redlands'], ['Redlands Tire & Lube', 'Redlands']];
  const LET = 'ABCDEFGHJKLMNPRSTVWY';
  const STAGES = [
  // key, label, colour, steps done (of invited · opened · funded · spent)
  ['waiting', 'On the waitlist', 'color-mix(in srgb,var(--fg) 14%,transparent)', 0], ['invited', 'Invited, not opened', 'color-mix(in srgb,var(--fg) 34%,transparent)', 1], ['opened', 'Opened, not funded', 'var(--land)', 2], ['active', 'Active, no spend yet', 'color-mix(in srgb,var(--fg) 70%,transparent)', 3], ['spent', 'Active and spending', 'var(--fg)', 4]];
  const STG = Object.fromEntries(STAGES.map(s => [s[0], s]));
  const BATCH = LV ? LV.BATCH : [
  // batch, invite day, invited, opened, activated, spent
  [1, 42, 25, 16, 13, 12], [2, 49, 25, 16, 13, 12], [3, 56, 25, 17, 13, 12], [4, 56, 25, 17, 13, 12], [5, 63, 25, 19, 13, 12], [6, 63, 25, 18, 13, 11], [7, 63, 25, 18, 12, 10], [8, 70, 25, 17, 11, 9], [9, 70, 25, 17, 10, 9], [10, 70, 25, 17, 10, 8], [11, 77, 25, 8, 2, 1], [12, 77, 25, 8, 1, 1]]; // 300 · 188 · 124 · 109
  const FUND = ['Bank', 'Bank', 'Bank', '$5', '$5', 'Deposit'];

  /* build the 1,800 people once */
  const PEOPLE = LV ? LV.PEOPLE : (() => {
    const r = rng(909),
      out = [];
    let id = 1;
    const pickCity = () => {
      let x = r(),
        a = 0;
      for (const [c, w] of CITIES) {
        a += w;
        if (x < a) return c;
      }
      return 'Redlands';
    };
    const mk = (joined, extra) => {
      const city = pickCity();
      const src = r() < .824 ? 'Poster' : r() < .5 ? 'Website' : r() < .6 ? 'Social' : 'Search';
      const shopPool = SHOPS.filter(s => s[1] === city);
      const shop = src === 'Poster' ? shopPool.length ? shopPool[Math.floor(r() * shopPool.length)][0] : SHOPS[Math.floor(r() * SHOPS.length)][0] : null;
      const p = {
        id: 'M-' + String(id++).padStart(4, '0'),
        f: LET[Math.floor(r() * LET.length)],
        l: LET[Math.floor(r() * LET.length)],
        city,
        src,
        shop,
        joined,
        phone: r() < .62,
        notes: [],
        tags: [],
        log: [],
        ...extra
      };
      p.name = p.f + '•'.repeat(3 + Math.floor(r() * 4)) + ' ' + p.l + '•'.repeat(2 + Math.floor(r() * 4));
      return p;
    };
    // the first 300 joined before the posters went up (18 Aug – 13 Sep) and were invited batch by batch
    let jd = 14;
    BATCH.forEach(([b, day, n, o, a, s]) => {
      for (let i = 0; i < n; i++) {
        jd += .07 + r() * .035;
        const stage = i < s ? 'spent' : i < a ? 'active' : i < o ? 'opened' : 'invited';
        const opened = stage !== 'invited' ? day + Math.floor(r() * Math.min(5, TODAY - day + 1)) : null;
        const act = stage === 'active' || stage === 'spent' ? Math.min(TODAY, opened + Math.floor(r() * 6)) : null;
        out.push(mk(Math.floor(jd), {
          jt: jd,
          stage,
          batch: b,
          invited: day,
          opened,
          act,
          fund: act ? FUND[Math.floor(r() * FUND.length)] : null,
          spentAt: stage === 'spent' ? SHOPS[Math.floor(r() * SHOPS.length)][0] : null,
          app: stage !== 'invited',
          lastSeen: act ? TODAY - Math.floor(r() * (r() < .12 ? 24 : 9)) : opened,
          nudges: stage === 'opened' && r() < .5 ? 1 : 0
        }));
      }
    });
    // the 1,500 waiting: a slow first week, then joins climb from ~40 to 49 a day (Growth's weekly joins)
    // the last seven days are fixed to Growth's 318 joins a week (49 today); the weeks before take the rest of the 1,500
    const LAST7 = [41, 43, 44, 46, 47, 48, 49],
      perDay = [];
    for (let d = 40; d <= TODAY; d++) perDay.push([d, d < 47 ? 9 : d > TODAY - 7 ? LAST7[d - (TODAY - 6)] : Math.round(42 + (d - 47) * 2 / 24)]);
    let short = 1500 - perDay.reduce((s, x) => s + x[1], 0);
    for (let i = 7; short !== 0; i = i < perDay.length - 8 ? i + 1 : 7) {
      perDay[i][1] += Math.sign(short);
      short -= Math.sign(short);
    }
    perDay.forEach(([d, n]) => {
      for (let k = 0; k < n; k++) out.push(mk(d, {
        jt: d + (8 + r() * 13) / 24,
        stage: 'waiting',
        app: false
      }));
    });
    out.filter(p => p.stage === 'waiting').sort((a, b) => a.jt - b.jt).forEach((p, i) => {
      p.pos = i + 1;
      if (i < 25) p.b13 = true;
    });
    // a couple of records with history, so the panel has something to show
    const ex = out.find(p => p.stage === 'opened');
    ex.notes.push({
      by: 'Marcus Lee',
      at: TODAY - 3,
      t: 'Said the bank link kept failing on their phone. Suggested the $5 option.'
    });
    ex.tags.push('Bank link issue');
    ex.nudges = 1;
    ex.log.push({
      at: TODAY - 5,
      t: 'Nudged by email · opened it, didn’t act'
    });
    return out;
  })();
  const WAITING = PEOPLE.filter(p => p.stage === 'waiting').sort((a, b) => a.pos - b.pos);
  // the batch waiting for a second person (13 in the reference) and the one being planned (14)
  const N13 = LV ? LV.NEXT?.number ?? null : 13,
    N14 = LV ? LV.B14N : 14,
    S13 = LV ? LV.NEXT?.size ?? 0 : 25;
  const JOINS = WAITING.filter(p => p.joined > TODAY - 7).length; // joins this week (~320)
  const QUIET = p => p.act && TODAY - p.lastSeen >= 21;
  const LEFT = p => p.invited != null ? 90 - (TODAY - p.invited) : null;
  const median = a => {
    const s = a.slice().sort((x, y) => x - y);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };

  /* state */
  const M = {
    fshow: false,
    tab: 'people',
    q: '',
    F: {
      city: new Set(),
      src: new Set(),
      shop: new Set()
    },
    stage: 'all',
    sort: 'joined',
    page: 0,
    open: null,
    bopen: null,
    reveal: new Set(),
    audit: [],
    b: {
      size: 25,
      how: 'oldest',
      cities: new Set(LV ? [] : ['Riverside']),
      shops: new Set(),
      picked: [],
      pace: 50,
      proposed: false,
      hq: ''
    },
    b13: LV && !LV.NEXT ? 'none' : 'pending',
    real: {},
    ng: 'opened',
    msg: {},
    wqx: {},
    force: null,
    when: 'now',
    pv: 'push',
    sent: [],
    approvals: [],
    wq: 'next'
  };
  const passF = p => (!M.F.city.size || M.F.city.has(p.city)) && (!M.F.src.size || M.F.src.has(p.src)) && (!M.F.shop.size || M.F.shop.has(p.shop));
  const cnt = (st, list = PEOPLE) => list.filter(p => p.stage === st).length;
  const fdesc = () => {
    const p = [];
    if (M.F.city.size) p.push(M.F.city.size === 1 ? [...M.F.city][0] : M.F.city.size + ' cities');
    if (M.F.src.size) p.push([...M.F.src].join(' + '));
    if (M.F.shop.size) p.push(M.F.shop.size === 1 ? [...M.F.shop][0] : M.F.shop.size + ' shops');
    return p.join(' · ');
  };
  const waitWeeks = () => Math.ceil(Math.max(0, WAITING.length - (M.b13 === 'pending' ? S13 : 0)) / M.b.pace);
  const ICON = {
    x: <svg className="i" viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15" /></svg>,
    lock: <svg className="i" viewBox="0 0 20 20" style={css("width:14px;height:14px;vertical-align:-2px")}><path d="M5 9h10v8H5z" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></svg>,
    eye: <svg className="i" viewBox="0 0 20 20" style={css("width:14px;height:14px")}><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" /><circle cx="10" cy="10" r="2.5" /></svg>,
    warn: <svg className="i" viewBox="0 0 20 20" style={css("width:15px;height:15px;flex:none")}><path d="M10 3l8 14H2z" /><path d="M10 8v4M10 14v1" /></svg>
  };

  /* ── header ── */
  function renderHdr() {
    const L = PEOPLE.filter(passF),
      W = L.filter(p => p.stage === 'waiting'),
      w = W.length,
      inv = L.length - w,
      o = cnt('opened', L),
      act = cnt('active', L) + cnt('spent', L),
      nev = cnt('invited', L);
    const old = W.filter(p => TODAY - p.joined >= 28).length,
      med = median(W.map(p => TODAY - p.joined));
    const byCity = CITIES.map(([c]) => [c, W.filter(p => p.city === c)]).filter(x => x[1].length).sort((a, b) => b[1].length - a[1].length);
    const S = {
      people: <>{fmt(L.length)}{" people have joined. "}<a data-mtab="nudges">{fmt(o)}{" opened the app but haven’t funded"}</a>{", and "}{fmt(nev)}{" haven’t opened their invite."}</>,
      batches: M.b13 === 'pending' ? <><a data-bjump="b13">{"Batch "}{N13}{LV ? ' is waiting for a second person.' : ' is waiting for your approval.'}</a>{" At "}{M.b.pace}{" invites a week, someone who joins today waits about "}{waitWeeks()}{" weeks."}</> : <>{"At "}{M.b.pace}{" invites a week, someone who joins today waits about "}{waitWeeks()}{" weeks. "}<a data-bjump="b14">{"Batch "}{N14}</a>{" is next."}</>,
      nudges: <>{fmt(nev)}{" people never opened their invite and "}<a data-ng="opened">{fmt(o)}{" stopped before funding"}</a>{LV ? '.' : '. Push works best: 31–44% act within a week.'}</>,
      waitlist: `${fmt(w)} people are waiting, ${fmt(old)} of them for four weeks or more.${byCity.length > 1 ? ` ${byCity[0][0]} has the most, ${fmt(byCity[0][1].length)}.` : ''}`
    }[M.tab];
    html($m('hdr'), <><span className="when"><span className="dot" />Members{LV ? '' : ' · Demo data'}{fdesc() && M.tab !== 'batches' ? ' · ' + fdesc() : ''}</span><p className="brief">{S}</p><div className="strip"><div className="sc"><span className="lbl">Waitlist</span><div className="sc-v">{fmt(w)}{" "}<small>+{fmt(JOINS)}{" this week"}</small></div><div className="mb"><i style={css(`width:${pct(old, w)}%`)} /></div><div className="sc-s">{fmt(old)}{" waited 4+ weeks · median "}{med}{" days"}</div></div><div className="sc"><span className="lbl">Invited</span><div className="sc-v">{fmt(inv)}{" "}<small>{LV ? `${BATCH.length} ${BATCH.length === 1 ? 'batch' : 'batches'}` : '12 batches'}</small></div><div className="mb"><i style={css(`width:${pct(inv - nev, inv)}%`)} /><span className="hroom" style={css(`left:${pct(inv - nev, inv)}%;right:0`)} /></div><div className="sc-s">{fmt(nev)}{" haven’t opened yet"}</div></div><div className="sc"><span className="lbl">Active</span><div className="sc-v">{fmt(act)}{" "}<small>{p1(pct(act, inv))}</small></div><div className="mb"><i style={css(`width:${pct(act, inv)}%`)} /><i style={css(`left:${pct(act, inv)}%;width:${pct(o, inv)}%;background:var(--land)`)} /></div><div className="sc-s">{fmt(cnt('spent', L))}{" have spent their $10"}</div></div><div className="sc"><span className="lbl">Stuck at funding</span><div className="sc-v">{fmt(o)}</div><div className="mb"><i style={css(`width:${pct(o, inv)}%;background:var(--land)`)} /></div><div className="sc-s">Opened the app, no money in yet</div></div></div></>);
  }

  /* ── control bar: search + filters (People, Nudges, Waitlist) ── */
  const caret = <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 4.5l3 3 3-3" /></svg>;
  const FDEF = {
    city: ['City', CITIES.map(c => c[0])],
    // live, the API knows a poster or the website: Social and Search aren't told apart yet
    src: ['Joined from', LV ? ['Poster', 'Website'] : ['Poster', 'Website', 'Social', 'Search']],
    shop: ['Poster shop', SHOPS.map(s => s[0])]
  };
  let openMenu = null;
  function renderCtl() {
    const el = $m('ctl');
    el.hidden = M.tab === 'batches';
    if (el.hidden) return;
    const fl = k => {
      const set = M.F[k],
        [n, opts] = FDEF[k];
      const label = set.size === 0 ? n : set.size === 1 ? <>{n}{": "}<b>{[...set][0]}</b></> : <>{n}{": "}<b>{set.size}</b></>;
      const menu = openMenu === k ? <div className="menu">{opts.map((o, __k) => <label key={__k}><input type="checkbox" data-mf={k} defaultValue={o} {...attrs(set.has(o) ? 'checked' : '')} /><span>{o}</span><span className="n">{fmt(PEOPLE.filter(p => (k === 'city' ? p.city : k === 'src' ? p.src : p.shop) === o).length)}</span></label>)}<div className="mf"><button data-mfclear={k}>Clear</button><button data-mfclose="">Done</button></div></div> : '';
      return <div className="fl"><button className={set.size ? 'on' : ''} data-mfopen={k}>{label}{caret}</button>{menu}</div>;
    };
    const any = Object.values(M.F).some(s => s.size);
    html(el, <><label className="msearch"><svg className="i" viewBox="0 0 20 20"><circle cx="9" cy="9" r="5" /><path d="M13 13l4 4" /></svg><input id="mq" placeholder="Find someone by member ID, city or shop" defaultValue={M.q} /></label>{['city', 'src', 'shop'].map(((x, __k) => <Fragment key={__k}>{fl(x)}</Fragment>))}{any ? <button className="clear" data-mfall="">Clear filters</button> : ''}</>);
  }

  /* ── People ── */
  const PAGE = 12;
  const pips = p => {
    const n = STG[p.stage][3];
    return <span className="pips" title={`${n} of 4 steps`}>{[0, 1, 2, 3].map((i, __k) => <i key={__k} className={i < n ? 'on' : ''} style={css(i < n ? `background:${STG[p.stage][2]}` : '')} />)}</span>;
  };
  function stageCell(p) {
    return <span className="stg">{pips(p)}{STG[p.stage][1]}</span>;
  }
  function nextCell(p) {
    const left = LEFT(p);
    if (p.stage === 'waiting') return p.b13 && M.b13 === 'pending' ? <span className="nx2"><b className="tlv">{"Batch "}{N13}</b><span>#{fmt(p.pos)}{" · needs approval"}</span></span> : <span className="nx2"><b>#{fmt(p.pos)}</b><span>{"in line · "}{p.joined === TODAY ? 'joined today' : 'waited ' + (TODAY - p.joined) + 'd'}</span></span>;
    if (p.stage === 'spent') return <span className="nx2"><b>Done</b><span>{"Spent at "}{p.spentAt}</span></span>;
    if (p.stage === 'active') return <span className="nx2"><b>Spend $10</b><span>{"Funded by "}{p.fund === 'Deposit' ? 'direct deposit' : p.fund === '$5' ? '$5' : 'bank'}</span></span>;
    // the 90-day window used up so far, full once it's past (the bar never runs past its own end)
    const used = Math.min(100, Math.max(0, (90 - left) / 90 * 100));
    return <span className="nx2 w"><span className="wrow"><span className={`wbar ${left < 30 ? 'lo' : ''}`}><i style={css(`width:${used}%`)} /></span><b className={left < 30 ? 'warn' : ''}>{left < 0 ? `${-left}d over` : `${left}d left`}</b></span><span>{p.stage === 'invited' ? 'Open the invite' : 'Fund the account'}</span></span>;
  }
  function renderPeople() {
    const L = PEOPLE.filter(passF);
    const q = M.q.trim().toLowerCase();
    let rows = L.filter(p => M.stage === 'all' || (M.stage === 'quiet' ? QUIET(p) : p.stage === M.stage)).filter(p => !q || p.id.toLowerCase().includes(q) || p.city.toLowerCase().includes(q) || (p.shop || '').toLowerCase().includes(q));
    const order = {
      spent: 0,
      active: 1,
      opened: 2,
      invited: 3,
      waiting: 4
    };
    rows.sort((a, b) => M.sort === 'window' ? (LEFT(a) ?? 999) - (LEFT(b) ?? 999) || a.pos - b.pos : M.sort === 'stage' ? order[a.stage] - order[b.stage] : b.jt - a.jt);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    M.page = Math.min(M.page, pages - 1);
    const view = rows.slice(M.page * PAGE, M.page * PAGE + PAGE);
    const tot = L.length,
      quiet = L.filter(QUIET).length;
    const tiles = <div className="sb-tiles">{STAGES.map(([k, lab, col], __k) => {
        const n = cnt(k, L);
        return <button key={__k} className={`sb-t ${M.stage === k ? 'on' : ''}`} data-mstage={k} aria-pressed={M.stage === k}><span className="sb-l"><i style={css(`background:${col}`)} />{lab}</span><b>{fmt(n)}</b><span className="sb-p">{p1(pct(n, tot))}{" of everyone"}</span></button>;
      })}</div>;
    html($m('mv'), <section className="band" style={css("margin-top:0")}><div className="bento"><div className="cell s12"><div className="hd"><h2>{M.stage === 'all' ? 'Everyone' : M.stage === 'quiet' ? 'Quiet for 3+ weeks' : STG[M.stage][1]}</h2><div className="r">{M.stage !== 'all' ? <button className="clear" data-mstage="all">Show everyone</button> : quiet ? <button className="clear" data-mstage="quiet">{quiet}{" quiet for 3+ weeks"}</button> : ''}<div className="seg sm" role="group" aria-label="Sort">{[['joined', 'Newest'], ['stage', 'Stage'], ['window', 'Window left']].map(([k, t], __k) => <button key={__k} data-msort={k} aria-pressed={M.sort === k}>{t}</button>)}</div></div></div>{tiles}<div className="bt-wrap"><table className="bt pp"><colgroup><col style={css("width:27%")} /><col style={css("width:23%")} /><col style={css("width:11%")} /><col style={css("width:20%")} /><col style={css("width:19%")} /></colgroup><thead><tr><th className="c-nm">Member</th><th style={css("text-align:left")}>Stage</th><th>Joined</th><th style={css("text-align:left")}>From</th><th>Next</th></tr></thead><tbody>{view.length ? view.map((p, __k) => {
                  const shown = M.reveal.has(p.id);
                  return <tr key={__k} data-mp={p.id} className={M.open === p.id ? 'sel' : ''}><td className="tn"><span className="pn"><b className={shown ? '' : 'msk'}>{shown ? realName(p) : p.name}</b><span>{p.id}{" · "}{p.city}</span></span></td><td style={css("text-align:left")}>{stageCell(p)}{QUIET(p) ? <em className="m-qt">Quiet</em> : ''}</td><td>{dFmt(p.joined)}</td><td style={css("text-align:left")} className="fr">{p.src === 'Poster' ? <><span className="sub">Poster ·</span>{" "}{p.shop}</> : p.src}</td><td>{nextCell(p)}</td></tr>;
                }) : <tr><td colSpan="5" className="tn"><span className="quiet">Nobody matches.</span></td></tr>}</tbody></table></div><div className="bk-ft"><span>{ICON.lock}{" Names are masked · showing one is logged in Records"}</span><span className="pg2"><span>{rows.length ? fmt(M.page * PAGE + 1) : 0}–{fmt(Math.min(rows.length, (M.page + 1) * PAGE))}{" of "}{fmt(rows.length)}</span><button data-mpage="-1" {...attrs(M.page === 0 ? 'disabled' : '')} aria-label="Previous"><svg viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg></button><button data-mpage="1" {...attrs(M.page >= pages - 1 ? 'disabled' : '')} aria-label="Next"><svg viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5" /></svg></button></span></div></div></div></section>);
  }
  const realName = p => {
    // live, the name the API sent for this person when it was shown (POST /members/:id/reveal)
    if (LV) return M.real[p.id] ?? p.name;
    const F = ['Maria', 'James', 'Ana', 'Kevin', 'Lena', 'Sam', 'Tomas', 'Grace', 'Rosa', 'Eli', 'Nadia', 'Victor', 'Diane', 'Marco', 'Tasha', 'Hugo', 'Iris', 'Omar', 'Paula', 'Wes'];
    const Lx = ['Torres', 'Ortiz', 'Reyes', 'Walker', 'Hughes', 'Nguyen', 'Brooks', 'Kim', 'Alvarez', 'Vega', 'Patel', 'Lopez', 'Diaz', 'Price', 'Young', 'Stone', 'Moreno', 'Wright', 'Bell', 'Cruz'];
    return F[LET.indexOf(p.f) % F.length] + ' ' + Lx[LET.indexOf(p.l) % Lx.length];
  };

  /* member record: side panel */
  function ensurePanel() {
    let pn = $m('mpanel');
    if (!pn) {
      const sc = document.createElement('div');
      sc.id = 'mscrim';
      sc.className = 'scrim';
      W.appendChild(sc);
      pn = document.createElement('aside');
      pn.id = 'mpanel';
      pn.className = 'panel mpanel';
      W.appendChild(pn);
    }
    return pn;
  }
  function renderPanel() {
    const pn = ensurePanel();
    if (!M.open && !M.nudge && !M.bopen) {
      W.classList.remove('pn');
      return;
    }
    W.classList.add('pn');
    if (M.nudge) return renderComposer(pn);
    if (M.bopen) return renderBatchPanel(pn);
    const p = PEOPLE.find(x => x.id === M.open),
      shown = M.reveal.has(p.id),
      left = LEFT(p);
    const steps = [['Joined', p.joined], ['Invited', p.invited], ['Opened the app', p.opened], [`Funded${p.fund ? ' · ' + (p.fund === 'Deposit' ? 'direct deposit' : p.fund === '$5' ? '$5' : 'bank') : ''}`, p.act], [`First $10 spend${p.spentAt ? ' · ' + p.spentAt : ''}`, p.stage === 'spent' ? LV ? p.spentDay : Math.min(TODAY, (p.act || TODAY) + 2) : null]];
    const pend = M.approvals.filter(a => a.id === p.id);
    const ch = chanFor(p),
      inB14 = batchPool().pick.includes(p);
    const place = p.stage !== 'waiting' ? <div><span>Batch</span><b>{LV && !p.batch ? 'None · joined another way' : <>{p.batch}{" · sent "}{dFmt(p.invited)}</>}</b></div> : <div><span>Place in line</span><b>#{fmt(p.pos)}{" of "}{fmt(WAITING.length)}{p.b13 && M.b13 === 'pending' ? ` · batch ${N13}` : inB14 ? ` · batch ${N14}` : ''}</b></div>;
    html(pn, <><div className="pn-hd"><span className="lbl">{p.id}</span>{stageCell(p)}<button className="x" data-mclose="" aria-label="Close">{ICON.x}</button></div><div className="pn-b"><div className="who3"><h3 className={shown ? '' : 'msk'}>{shown ? realName(p) : p.name}</h3>{shown ? <>{LV ? '' : <div className="ct3"><span>{realName(p).split(' ')[0].toLowerCase()}@gmail.com</span>{p.phone ? <span>{'(909) 555-01' + String(LET.indexOf(p.f)).padStart(2, '0')}</span> : ''}</div>}<span className="lg3">{"You showed this at "}{new Date().toTimeString().slice(0, 5)}{" · logged"}</span></> : <><button className="btn" style={css("height:30px;font-size:13px")} data-mreveal={p.id}>{ICON.eye}{LV ? 'Show name' : 'Show name and contact'}</button><span className="lg3">Showing is logged in Records</span></>}</div><div className="led"><div><span>City</span><b>{p.city}</b></div><div><span>Joined from</span><b>{p.src === 'Poster' ? 'Poster at ' + p.shop : p.src}</b></div><div><span>Reachable by</span><b>{['Email', p.phone ? 'Text' : null, p.app ? 'Push' : null].filter(Boolean).join(' · ')}</b></div>{place}</div><div><span className="lbl">Journey</span><div className="jy">{steps.map(([t, d], i) => <div key={i} className={`jy-r ${d != null ? 'done' : ''} ${d == null && (i === 0 || steps[i - 1][1] != null) ? 'next' : ''}`}><i /><span>{t}</span><b>{d != null ? dFmt(d) : d == null && (i === 0 || steps[i - 1][1] != null) ? 'Next step' : ''}</b></div>)}</div></div>{left != null && !p.act ? <div className="w90"><div className="w90-h"><span className="lbl">90-day window</span><b className={left < 30 ? 'warn' : ''}>{left < 0 ? `${-left} days over` : `${left} days left`}</b></div><span className={`wbar big ${left < 30 ? 'lo' : ''}`}><i style={css(`width:${Math.min(100, Math.max(0, (90 - left) / 90 * 100))}%`)} /></span><span className="small quiet">{left < 0 ? 'Closed ' : 'Closes '}{dFmt(p.invited + 90)}</span></div> : ''}{LV ? <div><span className="lbl">Notes and tags</span>{LV.names === 'none' ? <p className="small quiet" style={css("margin:6px 0 0")}>Notes and tags stay hidden at Totals.</p> : <><div className="tg3">{p.tags.map((t, __k) => <span key={__k} className="chip plain nodot">{t}{RO() ? '' : <button className="untag" data-muntag={`${p.id}|${t}`} aria-label={`Take off ${t}`}>×</button>}</span>)}{RO() ? '' : <button className="chip plain nodot addtag" data-maddtag={p.id}>+ Tag</button>}</div>{p.notes.length ? p.notes.map((n, __k) => <div key={__k} className="nt3"><p>{n.t}</p><span>{n.by}{" · "}{dFmt(n.at)}</span></div>) : (LV ? <div className="lv-e"><span>No notes yet.</span></div> : <p className="small quiet" style={css("margin:6px 0 0")}>No notes yet.</p>)}{RO() ? '' : <div className="nt3-in"><textarea id="mnote" rows="2" placeholder="Add a note for the team · no emails or phone numbers" /><button className="btn" style={css("height:32px")} data-mnote={p.id}>Add</button></div>}</>}</div> : <div><span className="lbl">Notes and tags</span><div className="tg3">{p.tags.map((t, __k) => <span key={__k} className="chip plain nodot">{t}</span>)}<button className="chip plain nodot addtag" data-maddtag={p.id}>+ Tag</button></div>{p.notes.length ? p.notes.map((n, __k) => <div key={__k} className="nt3"><p>{n.t}</p><span>{n.by}{" · "}{dFmt(n.at)}</span></div>) : (LV ? <div className="lv-e"><span>No notes yet.</span></div> : <p className="small quiet" style={css("margin:6px 0 0")}>No notes yet.</p>)}<div className="nt3-in"><textarea id="mnote" rows="2" placeholder="Add a note for the team" /><button className="btn" style={css("height:32px")} data-mnote={p.id}>Add</button></div></div>}{p.log.length || pend.length ? <div><span className="lbl">History</span>{pend.map((a, __k) => <div key={__k} className="hs3 pend"><b>{a.what}</b><span>Proposed by you · waiting for a second person</span></div>)}{p.log.map((l, __k) => <div key={__k} className="hs3"><b>{l.t}</b><span>{dFmt(l.at)}</span></div>)}</div> : ''}</div><div className="pn-ft mft">{p.stage === 'waiting' && !p.b13 ? <button className={`btn ${inB14 ? '' : 'p'}`} data-mpick={p.id} {...attrs(inB14 ? 'disabled' : '')}>{inB14 ? `In batch ${N14} ✓` : `Add to batch ${N14}`}</button> : ''}{['invited', 'opened', 'active'].includes(p.stage) ? <button className="btn p" data-mnudge1={p.id}>{LV ? 'Nudge' : <>{"Nudge by "}{ch}</>}</button> : ''}{LV ? p.stage === 'waiting' ? '' : <div className="more3"><button className="btn" data-mmore="" aria-expanded="false">More ▾</button><div className="mm3" hidden>{p.stage === 'invited' ? <button data-mlive={`resend|${p.id}`}>{"Resend the invite "}<span>Logged</span></button> : <button data-mlive={`off|${p.id}`} className="dz">{"Turn off their access "}<span>Logged</span></button>}</div></div> : <div className="more3"><button className="btn" data-mmore="" aria-expanded="false">More ▾</button><div className="mm3" hidden>{p.invited != null && !p.act ? <><button data-mprop={`Resend the invite|${p.id}`}>{"Resend the invite "}<span>2nd approval</span></button><button data-mprop={`Extend the window 30 days|${p.id}`}>{"Extend the window 30 days "}<span>2nd approval</span></button></> : ''}{p.act ? <button data-mprop={`Freeze the account|${p.id}`}>{"Freeze the account "}<span>2nd approval</span></button> : ''}<button data-mprop={`Close the account|${p.id}`} className="dz">{"Close the account "}<span>2nd approval</span></button></div></div>}</div></>);
  }
  /* best channel each person has, given what Clear has set up */
  const SETUP = {
    email: true,
    text: false,
    push: true
  };
  const chanFor = p => p.app && SETUP.push ? 'push' : p.phone && SETUP.text ? 'text' : 'email';
  const CH = {
    push: 'Push',
    text: 'Text',
    email: 'Email'
  };
  const CHCOL = {
    push: 'var(--fg)',
    email: 'color-mix(in srgb,var(--fg) 40%,transparent)',
    text: 'var(--land)'
  };

  /* ── Batches ── */
  function batchPool() {
    const W = WAITING.filter(p => !(p.b13 && M.b13 === 'pending'));
    let pool = W;
    if (M.b.how === 'city') pool = W.filter(p => M.b.cities.has(p.city));
    if (M.b.how === 'shop') pool = W.filter(p => p.shop && M.b.shops.has(p.shop));
    if (M.b.how === 'picked') pool = M.b.picked.map(id => PEOPLE.find(p => p.id === id));
    const pick = pool.slice(0, M.b.size);
    const last = pick.length ? Math.max(...pick.map(x => x.pos)) : 0;
    const skipped = M.b.how === 'oldest' ? 0 : W.filter(p => p.pos < last && !pick.includes(p)).length;
    return {
      W,
      pick,
      skipped
    };
  }
  const mix = (key, list) => {
    const m = {};
    list.forEach(p => {
      const k = key(p);
      m[k] = (m[k] || 0) + 1;
    });
    const e = Object.entries(m).sort((x, y) => y[1] - x[1]);
    return e.length > 4 ? e.slice(0, 3).concat([['Other', e.slice(3).reduce((s, x) => s + x[1], 0)]]) : e;
  };
  const MCOL = ['var(--fg)', 'var(--land)', 'color-mix(in srgb,var(--fg) 45%,transparent)', 'color-mix(in srgb,var(--fg) 20%,transparent)'];
  const mixBar = (label, C) => <div className="mx"><span className="lbl">{label}</span><div className="mb2">{C.map(([k, v], i) => <i key={i} style={css(`flex:${v};background:${MCOL[i]}`)} title={`${k} ${v}`} />)}</div><div className="mk2">{C.map(([k, v], i) => <span key={i}><i style={css(`background:${MCOL[i]}`)} />{k}{" "}<b>{v}</b></span>)}</div></div>;
  const personRow = (p, extra = '') => <button className="pr3" data-mp={p.id}><span className="pr3-n"><b className="msk">{p.name}</b><span>{p.city}{" · "}{p.src === 'Poster' ? p.shop : p.src}</span></span>{extra}<span className="pr3-w">{TODAY - p.joined}d</span></button>;
  function pipeline() {
    const pace = M.b.pace,
      per = pace / 25,
      H = 150;
    const byDay = {};
    BATCH.forEach(b => {
      (byDay[b[1]] ||= []).push({
        kind: 'sent',
        b
      });
    });
    const weeks = Object.keys(byDay).map(Number).sort((a, b) => a - b).map(d => ({
      label: dFmt(d),
      items: byDay[d]
    }));
    const now = [];
    if (M.b13 !== 'back' && M.b13 !== 'none') now.push({
      kind: M.b13 === 'approved' ? 'go' : 'b13',
      n: 13
    });
    now.push({
      kind: 'b14',
      n: 14
    });
    weeks.push({
      label: 'This week',
      now: true,
      items: now
    });
    let n = N14 + 1;
    for (let w = 1; w <= 2; w++) {
      weeks.push({
        label: dFmt(TODAY + 7 * w),
        fut: true,
        items: per > 3 ? [{
          kind: 'next',
          n,
          many: per
        }] : Array.from({
          length: per
        }, () => ({
          kind: 'next',
          n: n++
        }))
      });
      if (per > 3) n += per;
    }
    const col = it => {
      if (it.kind === 'sent') {
        const [b, d, i, o, a, s] = it.b;
        const seg = (v, c, cls = '') => v ? <i className={cls} style={css(`height:${v / (i || 1) * 100}%;${c ? 'background:' + c : ''}`)} /> : '';
        return <button className="pl-c" data-bopen={b} title={`Batch ${b} · sent ${dFmt(d)} · ${o} opened · ${a} active · ${s} spent`}><span className="pl-v">{a}</span><span className="pl-b">{seg(s, 'var(--fg)')}{seg(a - s, 'color-mix(in srgb,var(--fg) 62%,transparent)')}{seg(o - a, 'var(--land)')}{seg(i - o, '', 'hatch')}</span><span className="pl-n">{b}</span></button>;
      }
      if (it.kind === 'b13') return <button className="pl-c" data-bjump="b13" title={`Batch ${N13} · ${LV ? 'waiting for a second person' : 'needs your approval'}`}><span className="pl-v tlv">{S13}</span><span className="pl-b pend" /><span className="pl-n tlv">{N13}</span></button>;
      if (it.kind === 'go') return <button className="pl-c" data-bjump="b13" title="Batch 13 · approved, sending tomorrow"><span className="pl-v ok">25</span><span className="pl-b m-go" /><span className="pl-n">13</span></button>;
      if (it.kind === 'b14') {
        const k = batchPool().pick.length;
        return <button className="pl-c" data-bjump="b14" title={`Batch ${N14} · planning, ${k} of ${M.b.size}`}><span className="pl-v">{M.b.size}</span><span className="pl-b plan" /><span className="pl-n">{N14}</span></button>;
      }
      return <span className="pl-c fut" title={`${it.many ? `${it.many} batches` : 'Batch ' + it.n} at this pace`}><span className="pl-v">{it.many ? '×' + it.many : ''}</span><span className="pl-b ghost" /><span className="pl-n">{it.many ? `${it.n}–${it.n + it.many - 1}` : it.n}</span></span>;
    };
    const ax = <div className="pl-w pl-ax"><div className="pl-cs"><span className="pl-c"><span className="pl-v">Active</span><span className="pl-b" /><span className="pl-n">Batch</span></span></div><span className="pl-d">Sent</span></div>;
    return <div className="pl" style={css(`--h:${H}px`)}>{weeks.map((w, __k) => <div key={__k} className={`pl-w ${w.now ? 'm-now' : ''} ${w.fut ? 'fut' : ''}`} style={css(`flex:${w.items.length}`)}><div className="pl-cs">{w.items.map(((x, __k) => <Fragment key={__k}>{col(x)}</Fragment>))}</div><span className="pl-d">{w.label}</span></div>)}</div>;
  }
  function renderBatches() {
    const {
        pick,
        skipped,
        W
      } = batchPool(),
      b = M.b,
      net = JOINS - b.pace;
    const B13 = WAITING.filter(p => p.b13);
    const sizeSeg = <div className="seg sm" role="group" aria-label="Batch size">{[25, 50, 75, 100].map((n, __k) => <button key={__k} data-bsize={n} aria-pressed={b.size === n}>{n}</button>)}</div>;
    const HOW = [['oldest', 'Oldest first', 'Whoever has waited longest. Nothing to explain.'], ['city', 'By city', 'Where a shop just went live or posters just went up.'], ['shop', 'By poster shop', 'People who signed up at one shop’s poster.'], ['picked', 'Hand-picked', 'Choose people yourself. Each pick is logged.']];
    const opts = b.how === 'city' ? <div className="chips2">{CITIES.map(([c], __k) => <button key={__k} className={b.cities.has(c) ? 'on' : ''} data-bcity={c}>{c}{" "}<span>{fmt(W.filter(p => p.city === c).length)}</span></button>)}</div> : b.how === 'shop' ? <div className="chips2">{SHOPS.map(([s], __k) => <button key={__k} className={b.shops.has(s) ? 'on' : ''} data-bshop={s}>{s}{" "}<span>{fmt(W.filter(p => p.shop === s).length)}</span></button>)}</div> : '';
    // right side of Plan: the people in it, or the queue to pick from
    const hq = b.hq.trim().toLowerCase();
    const cand = b.how === 'picked' ? [...b.picked.map(id => PEOPLE.find(p => p.id === id)), ...W.filter(p => !b.picked.includes(p.id))].filter(p => !hq || p.id.toLowerCase().includes(hq) || p.city.toLowerCase().includes(hq) || (p.shop || '').toLowerCase().includes(hq)).slice(0, 40) : [];
    const from = p => p.src === 'Poster' ? p.shop : p.src;
    const pkRow = p => {
      const on = b.picked.includes(p.id),
        full = !on && b.picked.length >= b.size;
      return <label className={`br5 m-pk ${on ? 'on' : ''} ${full ? 'm-off' : ''}`}><input type="checkbox" data-bpick={p.id} {...attrs(on ? 'checked' : '')} {...attrs(full ? 'disabled' : '')} /><span className="br5-p">#{fmt(p.pos)}</span><span className="pr3-n"><b className="msk">{p.name}</b><span>{p.city}</span></span><span className="br5-f">{from(p)}</span><span className="br5-w">{TODAY - p.joined}d</span></label>;
    };
    const pRow = p => <button className="br5" data-mp={p.id}><span className="br5-p">#{fmt(p.pos)}</span><span className="pr3-n"><b className="msk">{p.name}</b><span>{p.city}</span></span><span className="br5-f">{from(p)}</span><span className="br5-w">{TODAY - p.joined}d</span></button>;
    const lh = pk => <div className={`br5-h ${pk ? 'm-pk' : ''}`}>{pk ? <span /> : ''}<span>In line</span><span>Member</span><span>Came from</span><span>Waited</span></div>;
    const list = b.how === 'picked' ? <>{lh(true)}<div className="bp5-list">{cand.length ? cand.map(((x, __k) => <Fragment key={__k}>{pkRow(x)}</Fragment>)) : (LV ? <div className="lv-e"><span>Nobody in the queue matches.</span></div> : <p className="small quiet" style={css("padding:14px 0;margin:0")}>Nobody in the queue matches.</p>)}</div></> : pick.length ? <>{lh(false)}<div className="bp5-list">{pick.map(((x, __k) => <Fragment key={__k}>{pRow(x)}</Fragment>))}</div></> : <div className="bp5-list">{LV ? <div className="lv-e"><span>Nobody matches yet. Pick a city or shop above.</span></div> : <p className="small quiet" style={css("padding:14px 0;margin:0")}>Nobody matches yet. Pick a city or shop above.</p>}</div>;
    const waits = pick.map(p => TODAY - p.joined);
    const ready = pick.length === b.size;
    const b13cell = LV ? liveB13(B13) : M.b13 === 'pending' ? <><div className="hd"><h2>Batch 13</h2><div className="r"><span className="chip live">Needs your approval</span></div></div><div className="b3"><div className="b3-top"><div className="ugrid pend">{B13.map((_, __k) => <i key={__k} />)}</div><div className="b3-s"><div className="m-big">{"25 "}<small>people</small></div><span>{"Proposed by "}<b>Marcus Lee</b>{" on 19 Oct · oldest first"}</span><span>You’d be the second person. Invites go out the next morning.</span></div></div><div className="led"><div><span>Joined</span><b>{dFmt(Math.min(...B13.map(p => p.joined)))}{" · the first week of posters"}</b></div><div><span>Window would close</span><b>{dFmt(TODAY + 1 + 90)}</b></div></div>{mixBar('Where they live', mix(p => p.city, B13))}<div className="b3-l">{B13.map(((x, __k) => <Fragment key={__k}>{personRow(x)}</Fragment>))}</div></div><div className="b3-ft"><button className="lnk3" data-b13="back">Send it back</button><button className="btn p" data-b13="approve">Approve batch 13</button></div></> : M.b13 === 'approved' ? <><div className="hd"><h2>Batch 13</h2><div className="r"><span className="chip ok">Approved</span></div></div><div className="b3"><div className="b3-top"><div className="ugrid m-go">{B13.map((_, __k) => <i key={__k} />)}</div><div className="b3-s"><div className="m-big">{"25 "}<small>people</small></div><span>Approved by you · proposed by Marcus Lee</span><span>Invites go out tomorrow at 9:00am. Their 90 days start then.</span></div></div><div className="b3-done">{"Logged in Records as "}<b>Kai approved batch 13</b>.</div></div><div className="b3-ft"><span className="small quiet">Two people signed off</span><button className="lnk3" data-b13="undo">Undo</button></div></> : <><div className="hd"><h2>Batch 13</h2><div className="r"><span className="chip under">Sent back</span></div></div><div className="b3"><div className="b3-done">Marcus Lee gets a note. The 25 people go back to the front of the queue, so batch 14 now starts with them.</div></div><div className="b3-ft"><span className="small quiet">Logged in Records</span><button className="lnk3" data-b13="undo">Undo</button></div></>;
    html($m('mv'), <><section className="band" style={css("margin-top:0")}><div className="bento"><div className="cell s12"><div className="hd"><h2>Every batch</h2><div className="r"><span className="lbl">Invites a week</span><div className="seg sm" role="group" aria-label="Invites a week">{[25, 50, 100, 200, 325].map((n, __k) => <button key={__k} data-bpace={n} aria-pressed={b.pace === n}>{n}</button>)}</div></div></div><div className="pl-wrap"><div className="pl-main">{pipeline()}<div className="pl-k">{LV ? BATCH.length ? <span><b className="pl-kn">{BATCH.at(-1)[4]}</b>{"active of "}{BATCH.at(-1)[2]}</span> : '' : <span><b className="pl-kn">13</b>active of 25</span>}<span><i style={css("background:var(--fg)")} />Spent $10</span><span><i style={css("background:color-mix(in srgb,var(--fg) 62%,transparent)")} />Active</span><span><i style={css("background:var(--land)")} />Not funded</span><span><i className="hatch" />Not opened</span><span><i className="kpend" />Needs approval</span><span><i className="kplan" />Planning</span><span><i className="kghost" />At this pace</span></div></div><div className="pl-side"><span className="lbl">{"At "}{b.pace}{" a week"}</span><div className="pl-big"><b>{waitWeeks()}</b>{" weeks"}</div><span className="pl-sub">for someone who joins today</span><div className="pl-rows"><div><span>Waitlist in 4 weeks</span><b className={net > 0 ? 'warn' : 'ok'}>{fmt(Math.max(0, WAITING.length + 4 * net))}</b></div><div><span>Joins a week</span><b>{fmt(JOINS)}</b></div><div><span>To keep up</span><b>{fmt(Math.ceil(JOINS / 25) * 25)}{" a week"}</b></div></div></div></div><div className="bk-ft"><span>{LV ? lastSentFoot() : 'Batches 11 and 12 went out on 20 Oct, so most of them haven’t opened yet. Click a batch to see who’s in it.'}</span><button data-gto="cohorts">How each week activates · Cohorts →</button></div></div></div></section><section className="band"><div className="bento"><div className="cell s5" id="b13">{b13cell}</div><div className="cell s7" id="b14"><div className="hd"><h2>{"Plan batch "}{N14}</h2><div className="r"><span className="lbl">Size</span>{sizeSeg}</div></div><div className="hw4" role="group" aria-label="Who goes first">{HOW.map(([k, t], __k) => <button key={__k} data-bhow={k} aria-pressed={b.how === k}>{t}</button>)}</div><div className="bp5"><div className="bp5-rule"><p>{HOW.find(h => h[0] === b.how)[2]}</p>{b.how === 'picked' ? <label className="msearch sm"><svg className="i" viewBox="0 0 20 20"><circle cx="9" cy="9" r="5" /><path d="M13 13l4 4" /></svg><input id="bq" placeholder="Search the queue: ID, city or shop" defaultValue={b.hq} /></label> : opts}</div><div className="bp5-sum"><div className="bp5-c"><div className="ugrid sz" style={css(`--cols:${b.size / 5}`)}>{Array.from({
                      length: b.size
                    }, (_, i) => <i key={i} className={i < pick.length ? 'on' : ''} />)}</div><div><div className="m-big">{pick.length}{" "}<small>{"of "}{b.size}</small></div><span>{pick.length ? `Waited ${Math.min(...waits) === Math.max(...waits) ? Math.min(...waits) : Math.min(...waits) + '–' + Math.max(...waits)} days` : 'Nobody picked yet'}</span>{b.how === 'picked' && b.picked.length ? <button className="lnk3" data-bclearpick="">Clear picks</button> : ''}</div></div>{pick.length ? <div className="bp5-mx">{mixBar('Where they live', mix(p => p.city, pick))}{mixBar('How they joined', mix(p => p.src, pick))}</div> : ''}</div>{skipped ? <div className="fair">{ICON.warn}<span>{"Skips "}<b>{fmt(skipped)}</b>{" people who’ve waited longer. You’ll say why when you propose it."}</span></div> : ''}{list}</div><button className={`foot ${b.proposed ? 'done' : ''}`} data-bpropose="" {...attrs(!ready || b.proposed ? 'disabled' : '')}><span>{b.proposed ? `Batch ${N14} proposed · waiting for a second person` : !ready ? `Pick ${b.size - pick.length} more to propose it` : `Propose batch ${N14} · ${b.size} people · needs a second person`}</span><span>{b.proposed ? '✓' : '→'}</span></button></div></div></section></>);
  }
  /* live: the batch waiting for a second person, approved or sent back in Needs you (the API's proposals) */
  const HOWN = {
    oldest: 'oldest first',
    cities: 'by city',
    shops: 'by poster shop',
    picked: 'hand-picked',
    posters: 'posters first',
    city: 'Redlands first'
  };
  function liveB13(B13) {
    const nx = LV.NEXT;
    if (!nx) return <><div className="hd"><h2>Waiting for approval</h2></div><div className="b3">{LV ? <div className="lv-e"><span>No batch is waiting. Propose one beside this; someone else approves it in Needs you.</span></div> : <div className="b3-done">No batch is waiting. Propose one beside this; someone else approves it in Needs you.</div>}</div></>;
    return <><div className="hd"><h2>{"Batch "}{N13}</h2><div className="r"><span className="chip live">Needs a second person</span></div></div><div className="b3"><div className="b3-top"><div className="ugrid pend">{Array.from({
              length: S13
            }, (_, k) => <i key={k} />)}</div><div className="b3-s"><div className="m-big">{S13}{" "}<small>{S13 === 1 ? 'person' : 'people'}</small></div><span>{"Proposed by "}<b>{nx.proposedBy}</b>{nx.proposedAt != null ? ` on ${dFmt(nx.proposedAt)}` : ''}{" · "}{HOWN[nx.order] ?? HOWN.oldest}</span><span>Someone other than them approves it in Needs you. Invites go out once it’s approved.</span></div></div><div className="led"><div><span>Longest waiting</span><b>{"Joined "}{dFmt(nx.joinedFrom)}</b></div><div><span>Window would close</span><b>90 days after it sends</b></div></div>{B13.length ? mixBar('Where they live', mix(p => p.city, B13)) : ''}<div className="b3-l">{B13.map(((x, __k) => <Fragment key={__k}>{personRow(x)}</Fragment>))}</div></div><div className="b3-ft"><span className="small quiet">Logged in Records</span><button className="lnk3" data-go="waiting">Approve or send back in Needs you →</button></div></>;
  }
  /* live: which batches went out last, and when */
  function lastSentFoot() {
    if (!BATCH.length) return 'No batch has gone out yet.';
    const d = BATCH.at(-1)[1],
      last = BATCH.filter(x => x[1] === d).map(x => x[0]);
    const nm = last.length === 1 ? `Batch ${last[0]} went` : `Batches ${last.slice(0, -1).join(', ')} and ${last.at(-1)} went`;
    return `${nm} out on ${dFmt(d)}. Click a batch to see who’s in it.`;
  }
  function renderBatchPanel(pn) {
    const row = BATCH.find(x => x[0] === M.bopen),
      [bn, d, i, o, a, s] = row,
      ppl = PEOPLE.filter(p => p.batch === bn),
      left = 90 - (TODAY - d);
    const order = {
      spent: 0,
      active: 1,
      opened: 2,
      invited: 3
    };
    ppl.sort((x, y) => order[x.stage] - order[y.stage]);
    const notOpened = ppl.filter(p => p.stage === 'invited'),
      notFunded = ppl.filter(p => p.stage === 'opened');
    html(pn, <><div className="pn-hd"><span className="lbl">{"Batch "}{bn}</span><span className="chip plain nodot">{"Sent "}{dFmt(d)}</span><button className="x" data-mclose="" aria-label="Close">{ICON.x}</button></div><div className="pn-b"><h3>{"Batch "}{bn}</h3><div className="bx4">{[['Invited', i], ['Opened', o], ['Funded', a], ['Spent $10', s]].map(([t, v], __k) => <div key={__k}><span className="lbl">{t}</span><b>{v}</b></div>)}</div><div className="w90"><div className="w90-h"><span className="lbl">90-day window</span><b className={left < 30 ? 'warn' : ''}>{left}{" days left"}</b></div><span className={`wbar big ${left < 30 ? 'lo' : ''}`}><i style={css(`width:${(90 - left) / 90 * 100}%`)} /></span><span className="small quiet">{"Closes "}{dFmt(d + 90)}{" for anyone who hasn’t funded"}</span></div><div><span className="lbl">Who’s in it</span><div className="bpl">{ppl.map((p, __k) => <button key={__k} className="bpl-r" data-mp={p.id}><b className="msk">{p.name}</b>{stageCell(p)}</button>)}</div></div></div><div className="pn-ft">{LV ? '' : notOpened.length ? <button className="btn p" style={css("height:40px")} data-mnudgeids={`invited|${notOpened.map(p => p.id).join(',')}`}>{"Nudge the "}{notOpened.length}{" who haven’t opened"}</button> : notFunded.length ? <button className="btn p" style={css("height:40px")} data-mnudgeids={`opened|${notFunded.map(p => p.id).join(',')}`}>{"Nudge the "}{notFunded.length}{" who haven’t funded"}</button> : ''}<button className="btn" style={css("height:40px;margin-left:auto")} data-mclose="">Close</button></div></>);
  }

  /* ── Nudges ── */
  const GROUPS = [{
    k: 'invited',
    t: 'Invited, never opened',
    short: 'never opened',
    msg: 'Your spot at Clear is ready. It takes two minutes to set up, and there’s $10 waiting at {shop}.',
    sub: 'Your spot at Clear is ready',
    cta: 'Open Clear',
    last: ['9 Oct', 18, 'Email', 96, 52]
  }, {
    k: 'opened',
    t: 'Opened, not funded',
    short: 'didn’t fund',
    msg: 'You’re one step away. Link a bank or add $5 to unlock your $10 at {shop}. {days} days left.',
    sub: 'One step left to unlock your $10',
    cta: 'Finish setting up',
    last: ['12 Oct', 31, 'Push', 41, 78]
  }, {
    k: 'active',
    t: 'Funded, no spend yet',
    short: 'haven’t spent',
    msg: 'Your $10 is still waiting at {shop}. Show the QR at the counter.',
    sub: 'Your $10 is waiting',
    cta: 'Show my QR',
    last: ['14 Oct', 44, 'Push', 22, 86]
  }, {
    k: 'quiet',
    t: 'Quiet for 3+ weeks',
    short: 'quiet 3+ weeks',
    msg: 'It’s been a while. Here’s what’s new at Clear this month.',
    sub: 'What’s new at Clear',
    cta: 'See what’s new',
    last: null
  }];
  const FLOWS = [{
    k: 'f1',
    day: 2,
    when: '2 days after the invite',
    who: 'Hasn’t opened it',
    ch: 'Email',
    on: true,
    wk: 38,
    acted: 21
  }, {
    k: 'f2',
    day: 7,
    when: '7 days after the invite',
    who: 'Still hasn’t opened',
    ch: 'Email',
    on: true,
    wk: 24,
    acted: 9
  }, {
    k: 'f3',
    day: 10,
    when: '3 days after opening',
    who: 'Hasn’t funded',
    ch: 'Push',
    on: true,
    wk: 17,
    acted: 29
  }, {
    k: 'f4',
    day: 13,
    when: '5 days after funding',
    who: 'Hasn’t spent the $10',
    ch: 'Push',
    on: false,
    wk: 0,
    acted: null
  }, {
    k: 'f5',
    day: 75,
    when: '15 days before the window closes',
    who: 'Hasn’t funded',
    ch: 'Email and push',
    on: true,
    wk: 0,
    acted: null,
    first: 'First ones go out 30 Nov'
  }];
  if (LV) GROUPS.forEach(g => g.last = null);
  const grpList = (k, L) => k === 'quiet' ? L.filter(QUIET) : L.filter(p => p.stage === k);
  const fill = (t, p) => t.replace(/\{shop\}/g, p ? p.shop || 'a Clear shop near you' : 'their poster shop').replace(/\{days\}/g, p && LEFT(p) != null ? LEFT(p) : '54').replace(/\{first\}/g, 'Maria');
  function renderNudges() {
    const L = PEOPLE.filter(passF),
      inv = L.filter(p => p.invited != null);
    const N = {
        inv: inv.length,
        op: inv.filter(p => p.opened != null).length,
        fd: inv.filter(p => p.act).length,
        sp: cnt('spent', L)
      },
      quiet = L.filter(QUIET).length;
    const max = Math.max(N.inv, 1);
    const gstat = g => {
      const sent = M.sent.find(s => s.k === g.k),
        list = grpList(g.k, L),
        u30 = list.filter(p => LEFT(p) != null && LEFT(p) < 30).length;
      return sent ? <span className="ok">{"Sent "}{sent.when}{" · results in 7 days"}</span> : <>{g.last ? <>{"Last "}{g.last[0]}{" · "}<b>{g.last[1]}% acted</b></> : LV ? 'No nudge history yet' : 'Never nudged'}{u30 ? <>{" · "}<span className="warn">{u30}{" under 30 days"}</span></> : ''}</>;
    };
    // left: the funnel, one step a row; the hatched gap is the group that stopped there
    const step = (label, v, prev, gk) => {
      const on = gk && M.ng === gk,
        pc = prev ? Math.round(v / prev * 100) : null;
      const inner = <><span className="nf5-s"><span>{label}</span><span className="nf5-p">{prev == null ? 'Everyone we invited' : pc == null ? 'Nobody at the step before yet' : `${pc}% of the step before`}</span></span><b className="nf5-v">{fmt(v)}</b><span className="nf-b"><i className="m-v" style={css(`width:${v / max * 100}%`)} />{prev != null && prev > v ? <i className={`m-gap ${on ? 'm-sel' : ''}`} style={css(`left:${v / max * 100}%;width:${(prev - v) / max * 100}%`)} /> : ''}</span></>;
      return gk ? <button className={`nf5-r ${on ? 'on' : ''}`} data-ng={gk} aria-pressed={on}>{inner}</button> : <div className="nf5-r">{inner}</div>;
    };
    // right: the groups, as a list
    const META = {
      invited: 'Got the invite, never opened the app',
      opened: 'Opened the app, no money in yet',
      active: 'Funded, haven’t used their $10',
      quiet: 'Funded, not seen in 3+ weeks'
    };
    const grow = (gk, n) => {
      const g = GROUPS.find(x => x.k === gk),
        on = M.ng === gk;
      return <button className={`ng5 ${on ? 'on' : ''}`} data-ng={gk} aria-pressed={on}><span className="ng5-t"><i className={`ng5-sw ${gk === 'quiet' ? 'q' : ''}`} /><b>{fmt(n)}</b>{" "}{g.short}<span className="ng5-ar">{LV ? 'See them →' : on ? 'Nudging ↓' : 'Nudge →'}</span></span><span className="ng5-m">{META[gk]}</span><span className="ng5-s">{gstat(g)}</span></button>;
    };
    const g = GROUPS.find(x => x.k === M.ng),
      list = grpList(g.k, L),
      msg = M.msg[g.k] ?? g.msg,
      sample = list[0];
    const m = {
      push: 0,
      email: 0,
      text: 0
    };
    list.forEach(p => m[M.force || chanFor(p)]++);
    const sent = M.sent.find(s => s.k === g.k);
    const exp = g.last ? Math.round(list.length * g.last[1] / 100) : null;
    const deed = {
      invited: 'open the app',
      opened: 'fund',
      active: 'spend their $10',
      quiet: 'come back'
    }[g.k];
    const pvCh = M.pv === 'push' && !m.push && m.email ? 'email' : M.pv;
    const preview = pvCh === 'push' ? <div className="pv-ph"><span className="pv-tm">12:00</span><span className="pv-dt">Sunday, 25 October</span><div className="pv-nt"><span className="pv-ic">C</span><div><div className="pv-nh"><b>Clear</b><span>now</span></div><b className="pv-st">{fill(g.sub, sample)}</b><p>{fill(msg, sample)}</p></div></div></div> : <div className="pv-em"><div className="pv-eh"><div><span>From</span><b>{"Clear <hello@useclear.org>"}</b></div><div><span>Subject</span><b>{fill(g.sub, sample)}</b></div></div><div className="pv-eb"><p>{"Hi "}{fill('{first}', sample)},</p><p>{fill(msg, sample)}</p><span className="pv-cta">{g.cta}</span><p className="pv-fine">You’re getting this because you joined Clear at useclear.org. Unsubscribe</p></div></div>;
    const fon = FLOWS.filter(f => f.on),
      fx = d => d <= 14 ? d / 14 * 32 : 32 + (d - 14) / 76 * 68; // first two weeks get a third of the axis
    html($m('mv'), <><section className="band" style={css("margin-top:0")}><div className="bento"><div className="cell s12"><div className="hd"><h2>Where people stop</h2><div className="r"><span className="lbl">Pick a group to nudge</span></div></div><div className="nf5"><div className="nf5-f">{step('Invited', N.inv, null, null)}{step('Opened the app', N.op, N.inv, 'invited')}{step('Funded', N.fd, N.op, 'opened')}{step('Spent their $10', N.sp, N.fd, 'active')}</div><div className="nf5-g">{grow('invited', N.inv - N.op)}{grow('opened', N.op - N.fd)}{grow('active', N.fd - N.sp)}{grow('quiet', quiet)}</div></div><div className="bk-ft"><span>{LV ? 'The hatched part of each bar is who stopped there. Pick a group to see who’s in it.' : 'The hatched part of each bar is who stopped there. Follow-ups below already reach most of them.'}</span>{LV ? <span /> : <button data-ngjump="">Write the nudge ↓</button>}</div></div></div></section>{LV ? nudgesNotReal() : <><section className="band"><div className="bento"><div className="cell s7" id="ncomp"><div className="hd"><h2>{"Nudge "}{fmt(list.length)}{" "}{list.length === 1 ? 'person' : 'people'}</h2><span className="chip plain nodot">{g.t}</span></div><div className="nc"><div className="nc-r"><span className="lbl">Message</span><div><textarea id="ncmsg" rows="3" defaultValue={msg} /><div className="nc-tk"><span>Fill in per person</span>{[['{shop}', 'Their poster shop'], ['{days}', 'Days left'], ['{first}', 'First name']].map(([t, n], __k) => <button key={__k} data-tok={t}>{n}</button>)}</div></div></div><div className="nc-r"><span className="lbl">Send by</span><div><div className="seg sm" role="group" aria-label="Channel">{[['', 'Best for each'], ['push', 'Push'], ['email', 'Email'], ['text', 'Text']].map(([k, t], __k) => <button key={__k} data-mforce={k} aria-pressed={(M.force || '') === k} {...attrs(k === 'text' && !SETUP.text ? 'disabled title="Texting isn’t set up"' : '')}>{t}</button>)}</div><div className="nc-mx"><span className="mb2">{['push', 'email'].map((c, __k) => m[c] ? <i key={__k} style={css(`flex:${m[c]};background:${CHCOL[c]}`)} /> : '')}</span><span className="mk2">{['push', 'email'].filter(c => m[c]).map((c, __k) => <span key={__k}><i style={css(`background:${CHCOL[c]}`)} />{CH[c]}{" "}<b>{m[c]}</b></span>)}<span className="z">Text isn’t set up</span></span></div><p className="nc-h">{M.force ? `Everyone gets ${CH[M.force].toLowerCase()}.` : 'Push if they have the app, otherwise email.'}</p></div></div><div className="nc-r"><span className="lbl">When</span><div><div className="seg sm" role="group" aria-label="When">{[['now', 'Now'], ['sun', 'Sunday, noon'], ['tue', 'Tuesday, 6pm']].map(([k, t], __k) => <button key={__k} data-mwhen={k} aria-pressed={M.when === k}>{t}</button>)}</div><p className="nc-h">{M.when === 'now' ? 'Goes out as soon as you send.' : M.when === 'sun' ? 'Sunday at noon is when most people open the app.' : 'Tuesday evening gets the most email opens.'}</p></div></div></div><div className="nc-ft"><span>{sent ? <><b className="ok">{"Sent "}{sent.when}</b>{" · logged in Records"}</> : exp != null ? <>{"If it does as well as last time, about "}<b>{fmt(exp)}</b>{" will "}{deed}{" this week."}</> : 'Never nudged before. Results show up here after a week.'}</span><button className="btn p" data-ngsend="" {...attrs(!list.length || sent ? 'disabled' : '')}>{sent ? 'Sent ✓' : `${M.when === 'now' ? 'Send to' : 'Schedule for'} ${fmt(list.length)}`}</button></div></div><div className="cell s5"><div className="hd"><h2>Preview</h2><div className="r"><div className="seg sm" role="group" aria-label="Preview">{['push', 'email'].map((c, __k) => <button key={__k} data-pv={c} aria-pressed={pvCh === c} {...attrs(!m[c] && !M.force ? '' : '')}>{CH[c]}</button>)}</div></div></div><div className="pv">{preview}</div><div className="bk-ft"><span>{"Filled in for "}{sample ? sample.id : 'a sample person'}{sample && sample.shop ? ' · ' + sample.shop : ''}</span><button data-mtab="people" data-mstagego={g.k}>{"All "}{fmt(list.length)}{" in People →"}</button></div></div></div></section><section className="band"><div className="bento"><div className="cell s7"><div className="hd"><h2>Follow-ups that run on their own</h2><div className="r"><span className="lbl">{fon.length}{" on · "}{fmt(fon.reduce((s, f) => s + f.wk, 0))}{" sent this week"}</span></div></div><div className="fu-tr"><div className="fu-ax"><i className="fu-gap" style={css(`left:${fx(13)}%;width:${fx(75) - fx(13)}%`)}><span>{"Nothing for "}{75 - 13}{" days"}</span></i>{FLOWS.map((f, i) => <b key={i} className={`fu-m ${f.on ? '' : 'm-off'}`} style={css(`left:${fx(f.day)}%`)}>{i + 1}</b>)}</div><div className="fu-sc"><span style={css("left:0")}>Invited</span><span style={css(`left:${fx(7)}%`)}>Day 7</span><span style={css(`left:${fx(14)}%`)}>Day 14</span><span style={css(`left:${fx(30)}%`)}>Day 30</span><span style={css(`left:${fx(60)}%`)}>Day 60</span><span style={css("right:0")}>Day 90 · closes</span></div></div><div className="fu-l">{FLOWS.map((f, i) => <div key={i} className={`fu-r ${f.on ? '' : 'm-off'}`}><b className="fu-n">{i + 1}</b><span className="fu-t"><b>{f.when}</b><span>{f.who}{" · "}{f.ch}</span></span><span className="fu-s">{f.first && f.on ? f.first : f.on ? <>{f.wk}{" this week"}{f.acted != null ? <>{" · "}<b>{f.acted}% acted</b></> : ''}</> : 'Off'}</span><button className="sw4" role="switch" aria-checked={f.on} aria-label={f.when} data-flow={f.k}><i /></button></div>)}</div><div className="bk-ft"><span>Between day 13 and day 75 nobody hears from Clear.</span><button data-fuadd="">Add a follow-up at day 30 →</button></div></div><div className="cell s5"><div className="hd"><h2>How the last nudges did</h2><div className="r"><span className="lbl">Acted within 7 days</span></div></div><div className="pn3">{[...M.sent.map(s => ({
                t: GROUPS.find(x => x.k === s.k).t,
                d: s.when,
                ch: Object.keys(s.mix).filter(c => s.mix[c]).map(c => CH[c]).join(' + '),
                n: s.n,
                o: null,
                a: null
              })), ...GROUPS.filter(x => x.last).sort((x, y) => parseInt(y.last[0]) - parseInt(x.last[0])).map(x => ({
                t: x.t,
                d: x.last[0],
                ch: x.last[2],
                n: x.last[3],
                o: x.last[4],
                a: x.last[1]
              }))].map((r, __k) => <div key={__k} className="pn3-r"><div className="pn3-t"><b>{r.t}</b><span>{r.d}{" · "}{r.ch}{" · "}{fmt(r.n)}{" people"}</span></div>{r.a == null ? <div className="pn3-w">Waiting on results</div> : <div className="pn3-b"><span className="pn3-bar"><i className="o" style={css(`width:${r.o}%`)} /><i className="a" style={css(`width:${r.a}%`)} /></span><span className="pn3-n"><span>{r.o}% opened</span><b>{r.a}% acted</b></span></div>}</div>)}</div><div className="bk-ft"><span>Push gets about twice the action email does.</span><button data-gto="settings">Set up texting →</button></div></div></div></section></>}</>);
  }
  /* live: a group's nudge, the follow-ups and their results have no source yet; each says what it needs */
  const NUDGE_NEEDS = [['Nudge a group', 'Group nudges need a message, a channel and a time the API can send. Today it records one person’s nudge (from their record in People) for the outside system.'], ['Follow-ups that run on their own', 'Follow-ups need rules the API runs on a schedule, and which channels are set up (email, push, text).'], ['How the last nudges did', 'Results need each nudge’s sends, opens and who acted within 7 days.']];
  function nudgesNotReal() {
    return <section className="band"><div className="bento">{NUDGE_NEEDS.map(([nm, need], i) => <div key={i} className={`cell ${i ? 's6' : 's12'}`}><div className="hd"><h2>{nm}</h2><div className="r"><span className="lbl">Not real yet</span></div></div><div className="bk-empty hatch" style={css("min-height:120px;opacity:.5")} /><div className="bk-empty">{need}</div></div>)}</div></section>;
  }
  function renderComposer(pn) {
    const g = GROUPS.find(x => x.k === M.nudge.k) || GROUPS[1];
    const L = M.nudge.ids.map(id => PEOPLE.find(p => p.id === id));
    const m = {
      push: 0,
      text: 0,
      email: 0
    };
    L.forEach(p => m[M.nudge.force || chanFor(p)]++);
    html(pn, <><div className="pn-hd"><span className="lbl">Nudge</span><span className="chip plain nodot">{L.length === 1 ? L[0].id : g.t}</span><button className="x" data-mclose="" aria-label="Close">{ICON.x}</button></div><div className="pn-b"><h3>{L.length === 1 ? 'Nudge one person' : `Nudge ${fmt(L.length)} people`}</h3><div><span className="lbl">Message</span><textarea className="cmp" rows="4" defaultValue={g.msg} /><span className="small quiet">{"{shop} and {days} fill in per person. The message links straight to the next step in the app."}</span></div><div><span className="lbl">Send by</span><div style={css("margin-top:8px")} className="seg sm">{[['', 'Best for each'], ['push', 'Push'], ['email', 'Email'], ['text', 'Text']].map(([k, t], __k) => <button key={__k} data-mforce1={k} aria-pressed={(M.nudge.force || '') === k} {...attrs(k === 'text' && !SETUP.text ? 'disabled title="Texting isn’t set up"' : '')}>{t}</button>)}</div><p className="small quiet" style={css("margin:10px 0 0")}>{['push', 'email'].filter(c => m[c]).map(c => `${CH[c]} to ${m[c]}`).join(' · ')}</p></div></div><div className="pn-ft"><span className="nx">Logged in Records</span><button className="btn" style={css("height:40px")} data-mclose="">Cancel</button><button className="btn p" style={css("height:40px")} data-msend="">Send{L.length === 1 ? '' : ' to ' + fmt(L.length)}</button></div></>);
    M.nudge._n = L.length;
    M.nudge._mix = m;
  }

  /* ── Waitlist ── */
  function renderWaitlist() {
    const W = WAITING.filter(passF),
      pace = M.b.pace;
    const {
        pick
      } = batchPool(),
      in14 = new Set(pick.map(p => p.id));
    const wk = [[0, 7, 'This week'], [7, 14, '1 week'], [14, 21, '2 weeks'], [21, 28, '3 weeks'], [28, 35, '4 weeks'], [35, 99, '5+ weeks']].map(([a, b, t]) => [t, W.filter(p => TODAY - p.joined >= a && TODAY - p.joined < b).length, a >= 28]);
    const bm = Math.max(...wk.map(x => x[1]), 1),
      med = median(W.map(p => TODAY - p.joined)),
      old = wk[4][1] + wk[5][1];
    const qrow = (p, right) => <button className="qr3" data-mp={p.id}><span className="qp">#{fmt(p.pos)}</span><span className="pr3-n"><b className="msk">{p.name}</b><span>{p.city}{" · "}{p.src === 'Poster' ? p.shop : p.src}{" · joined "}{dFmt(p.joined)}{", "}{tFmt(p.jt)}</span></span>{right}</button>;
    // the reference's body was a string, empty when nobody matched
    let body, none;
    if (M.wq === 'next') {
      const g13 = M.b13 === 'pending' ? W.filter(p => p.b13) : [],
        g14 = W.filter(p => in14.has(p.id)),
        rest = W.filter(p => !(p.b13 && M.b13 === 'pending') && !in14.has(p.id));
      const per = pace / 25,
        nb = i => N14 + 1 + Math.floor(i / 25),
        nd = i => TODAY + 7 + 7 * Math.floor(Math.floor(i / 25) / per);
      // each group shows 2 at first; small groups open fully, the long tail opens 20 at a time
      const grp = (k, t, s, cls, ppl, right) => {
        if (!ppl.length) return '';
        const n = Math.min(ppl.length, M.wqx[k] || 2),
          left = ppl.length - n,
          step = ppl.length <= 100 ? left : Math.min(20, left);
        return <><div className={`qg ${cls}`}><span className="qg-t"><b>{t}</b><span>{s}</span></span><span className="qg-n">{fmt(ppl.length)}</span></div>{ppl.slice(0, n).map(((x, __k) => <Fragment key={__k}>{right(x)}</Fragment>))}{left || n > 2 ? <div className="qm">{left ? <button data-wqmore={`${k}|${n + step}`}>{step === left ? `Show ${left === ppl.length - 2 ? 'the other ' : ''}${fmt(left)}` : `Show ${step} more`}<span>{step === left ? '' : ` · ${fmt(left)} left`}</span></button> : ''}{n > 2 ? <button data-wqmore={`${k}|2`} className="lss">Show fewer</button> : ''}</div> : ''}</>;
      };
      none = !g13.length && !g14.length && !rest.length;
      body = <>{grp('b13', `Batch ${N13}`, LV ? 'Waiting for a second person' : 'Waiting on your approval', 'tlv', g13, p => qrow(p, <span className="qw">{TODAY - p.joined}d</span>))}{grp('b14', `Batch ${N14}`, M.b.how === 'oldest' ? 'As planned, oldest first' : 'As planned, ' + {
          city: 'by city',
          shop: 'by poster shop',
          picked: 'hand-picked'
        }[M.b.how], '', g14, p => qrow(p, <span className="qw">{TODAY - p.joined}d</span>))}{grp('rest', `Then, at ${pace} a week`, `The rest, in the order they joined`, 'fut', rest, p => {
          const i = rest.indexOf(p);
          return qrow(p, <span className="qw"><b>{"Batch "}{nb(i)}</b><span>{"about "}{dFmt(nd(i))}</span></span>);
        })}</>;
    } else {
      none = !W.length;
      body = W.slice().sort((a, b) => b.jt - a.jt).slice(0, 11).map((p, __k) => <Fragment key={__k}>{qrow(p, <span className="qw"><b>{p.joined === TODAY ? 'Today' : dFmt(p.joined)}</b><span>{tFmt(p.jt)}</span></span>)}</Fragment>);
    }
    // by city
    const cities = CITIES.map(([c]) => {
      const ppl = W.filter(p => p.city === c);
      return {
        c,
        n: ppl.length,
        old: ppl.filter(p => TODAY - p.joined >= 28).length,
        wk: ppl.filter(p => p.joined > TODAY - 7).length,
        post: ppl.filter(p => p.src === 'Poster').length,
        shops: SHOPS.filter(s => s[1] === c).length,
        med: median(ppl.map(p => TODAY - p.joined))
      };
    }).filter(x => x.n).sort((a, b) => b.n - a.n);
    const cm = Math.max(...cities.map(x => x.n), 1);
    html($m('mv'), <><section className="band" style={css("margin-top:0")}><div className="bento"><div className="cell s7"><div className="hd"><h2>The queue</h2><div className="r"><div className="seg sm" role="group" aria-label="Queue view"><button data-wq="next" aria-pressed={M.wq === 'next'}>Next in line</button><button data-wq="new" aria-pressed={M.wq === 'new'}>Just joined</button></div></div></div><div className="ql3">{none ? (LV ? <div className="lv-e"><span>Nobody matches.</span></div> : <p className="small quiet" style={css("padding:22px;margin:0")}>Nobody matches.</p>) : body}</div><button className="foot" data-mtab="people" data-mstagego="waiting"><span>{"All "}{fmt(W.length)}{" on the waitlist"}</span><span>People →</span></button></div><div className="cell s5"><div className="hd"><h2>How long they’ve waited</h2><div className="r"><span className="lbl">{"Median "}{med}{" days"}</span></div></div><div className="wt3">{wk.map(([t, v, o], __k) => <div key={__k} className={`wt3-r ${o ? 'old' : ''}`}><span className="wt3-l">{t}</span><span className="wt3-b"><i style={css(`width:${v / bm * 100}%`)} /></span><b>{fmt(v)}</b></div>)}</div><div className="bk-ft"><span><b>{fmt(old)}</b>{" have waited four weeks or more"}</span><button data-mtab="batches">{"Plan batch "}{N14}{" →"}</button></div></div></div></section><section className="band"><div className="bento"><div className="cell s12"><div className="hd"><h2>Where they’re waiting</h2><div className="r"><span className="lbl">For batches by city</span></div></div>{LV && !cities.length ? <div className="lv-e"><span>No one is waiting in any city yet</span></div> : <div className="bt-wrap"><table className="bt wc"><colgroup><col style={css("width:18%")} /><col style={css("width:26%")} /><col style={css("width:11%")} /><col style={css("width:12%")} /><col style={css("width:11%")} /><col style={css("width:10%")} /><col style={css("width:12%")} /></colgroup><thead><tr><th className="c-nm">City</th><th style={css("text-align:left")}>Waiting</th><th>4+ weeks</th><th>This week</th><th>Posters</th><th>Shops live</th><th /></tr></thead><tbody>{cities.map((x, __k) => <tr key={__k}><td className="tn"><b>{x.c}</b></td><td style={css("text-align:left")}><span className="wc-b"><span className="m-bar"><i style={css(`width:${x.n / cm * 100}%`)} /></span><b>{fmt(x.n)}</b></span></td><td>{fmt(x.old)}</td><td>+{fmt(x.wk)}</td><td>{Math.round(pct(x.post, x.n))}%</td><td>{LV ? <span className="quiet">—</span> : x.shops || <span className="quiet">None</span>}</td><td><button className="lnk4" data-bcitygo={x.c}>Plan a batch →</button></td></tr>)}</tbody></table></div>}<div className="bk-ft"><span>{LV ? 'Shops live in each city isn’t here yet: Merchants has them.' : 'Cities with no live shop can’t spend their $10 nearby yet. Invite them once a shop signs.'}</span><button data-gto="merchants">Shops signing · Merchants →</button></div></div></div></section>{formsCell()}</>);
  }

  /* ── render + events ── */
  function render() {
    R.querySelectorAll('.gtabs [data-mtab]').forEach(b => b.setAttribute('aria-current', b.dataset.mtab === M.tab ? 'page' : 'false'));
    renderHdr();
    renderCtl();
    ({
      people: renderPeople,
      batches: renderBatches,
      nudges: renderNudges,
      waitlist: renderWaitlist
    })[M.tab]();
    renderPanel();
  }
  const closeAll = () => {
    M.open = null;
    M.nudge = null;
    M.bopen = null;
  };
  /* live, a change goes through the API (POST /actions/members/<kind>, as the old page's flows did): the
     section loads again, and the page is built again from what the server now holds */
  const person = id => PEOPLE.find(p => p.id === id);
  function liveAct(kind, body, done) {
    run('members', kind, body, r => {
      if (r.queued) toast(<>{done}{" · recorded for the outside system, nothing is sent yet"}</>);else if (!r.proposal) toast(done);
      redraw();
    });
  }
  /* live, one person's name, for a reason (POST /members/:id/reveal: Approve, logged); a blank reason is a rush, flagged */
  async function reveal(p) {
    const why = window.prompt('Why do you need to see this person’s name? This is logged.');
    if (why == null) return;
    try {
      const r = await api('POST', `/members/${p.apiId}/reveal`, why.trim() ? {
        reason: why.trim()
      } : {
        rush: true
      });
      M.real[p.id] = [r.first, r.last].filter(Boolean).join(' ') || p.id;
      M.reveal.add(p.id);
      addReveal(p.id, 'Name');
      toast(why.trim() ? 'Shown · logged in Records with your reason' : 'Shown · logged in Records as a rush, without a reason');
      render();
    } catch (e) {
      toast(e.message);
    }
  }
  /* live, the plan proposed as the API's batch: who goes first as its order, the reason for any skips */
  function proposeLive() {
    const {
        pick,
        skipped
      } = batchPool(),
      b = M.b;
    let why = '';
    if (skipped) {
      why = window.prompt(`This skips ${fmt(skipped)} people who’ve waited longer. Say why; it’s logged.`);
      if (why == null) return;
    }
    const body = {
      size: b.size,
      order: {
        oldest: 'oldest',
        city: 'cities',
        shop: 'shops',
        picked: 'picked'
      }[b.how],
      why: why.trim()
    };
    if (b.how === 'city') body.cities = [...b.cities];
    if (b.how === 'shop') body.posters = [...new Set(WAITING.filter(p => p.poster && b.shops.has(p.shop)).map(p => p.poster))];
    if (b.how === 'picked') body.ids = pick.map(p => p.apiId);
    M.b.proposed = true;
    render();
    run('members', 'batch', body, () => redraw());
  }
  R.addEventListener('click', e => {
    if (e.target.id === 'mscrim') {
      closeAll();
      return render();
    }
    const t = e.target.closest('button,[data-mp],a,input,label');
    if (!t) {
      if (openMenu) {
        openMenu = null;
        renderCtl();
      }
      const mm = R.querySelector('.mm3');
      if (mm) mm.hidden = true;
      return;
    }
    const d = t.dataset;
    if (d.mtab) {
      M.tab = d.mtab;
      if (d.mstagego) {
        M.stage = d.mstagego;
        M.page = 0;
      }
      closeAll();
      render();
      setHash();
      tabTop();
      return;
    }
    if (d.mfopen) {
      openMenu = openMenu === d.mfopen ? null : d.mfopen;
      return renderCtl();
    }
    if (d.mf) {
      const s = M.F[d.mf];
      t.checked ? s.add(t.value) : s.delete(t.value);
      M.page = 0;
      const o = openMenu;
      render();
      openMenu = o;
      renderCtl();
      return;
    }
    if (d.mfclear) {
      M.F[d.mfclear].clear();
      return render();
    }
    if (t.hasAttribute('data-mfclose')) {
      openMenu = null;
      return renderCtl();
    }
    if (t.hasAttribute('data-mfall')) {
      Object.values(M.F).forEach(s => s.clear());
      return render();
    }
    if (d.mstage) {
      M.stage = M.stage === d.mstage && d.mstage !== 'all' ? 'all' : d.mstage;
      M.page = 0;
      return render();
    }
    if (d.msort) {
      M.sort = d.msort;
      return render();
    }
    if (d.mpage) {
      M.page += +d.mpage;
      return render();
    }
    if (d.mp) {
      if (TOT()) return toast('Names stay hidden in this view · co-op totals only');
      closeAll();
      M.open = d.mp;
      return render();
    }
    if (t.hasAttribute('data-mclose')) {
      closeAll();
      return render();
    }
    if (d.mreveal && LV) {
      reveal(person(d.mreveal));
      return;
    }
    if (d.mreveal) {
      M.reveal.add(d.mreveal);
      M.audit.push({
        id: d.mreveal,
        at: new Date()
      });
      // the reference logs it in Records' Reveals tab too (ADMIN2.addReveal); that comes with Records' port
      toast(<>{"Shown · logged in Records as "}<b>{"Kai showed "}{d.mreveal}</b></>);
      return render();
    }
    // live, notes and tags are Command's (POST /actions/members/note|tag|untag), by the person's masked number
    if (d.mnote && LV) {
      const v = $m('mnote').value.trim();
      if (!v) return;
      return liveAct('note', {
        subject: d.mnote,
        text: v
      }, 'Note added · logged in Records');
    }
    if (d.maddtag && LV) {
      const tag = window.prompt('Tag them with what? (Follow up, Spanish speaker, Shop owner…) No names, emails or phone numbers.');
      if (tag == null || !tag.trim()) return;
      return liveAct('tag', {
        subject: d.maddtag,
        tag: tag.trim()
      }, 'Tagged · logged in Records');
    }
    if (d.muntag && LV) {
      const i = d.muntag.indexOf('|');
      return liveAct('untag', {
        subject: d.muntag.slice(0, i),
        tag: d.muntag.slice(i + 1)
      }, 'Tag taken off · logged in Records');
    }
    if (d.mnote) {
      const v = $m('mnote').value.trim();
      if (!v) return;
      PEOPLE.find(p => p.id === d.mnote).notes.push({
        by: 'Kai',
        at: TODAY,
        t: v
      });
      return render();
    }
    if (d.maddtag) {
      const p = PEOPLE.find(x => x.id === d.maddtag);
      const opts = ['Follow up', 'Bank link issue', 'Spanish speaker', 'VIP', 'Shop owner'];
      const nx = opts.find(o => !p.tags.includes(o));
      if (nx) p.tags.push(nx);
      return render();
    }
    if (t.hasAttribute('data-mmore')) {
      const mm = t.parentElement.querySelector('.mm3');
      mm.hidden = !mm.hidden;
      return;
    }
    if (d.mlive) {
      const [kind, id] = d.mlive.split('|'),
        p = person(id);
      t.closest('.mm3').hidden = true;
      if (kind === 'resend') return liveAct('resend', {
        id: p.apiId
      }, 'Invite resent');
      const why = window.prompt('Why turn off their access? This is logged.');
      if (why == null) return;
      return liveAct('off', {
        id: p.apiId,
        reason: why.trim()
      }, 'Access turned off');
    }
    if (d.mprop) {
      const [what, id] = d.mprop.split('|');
      M.approvals.push({
        what,
        id
      });
      toast(<><b>{what}</b>{" proposed · it needs a second person in Needs you"}</>);
      return render();
    }
    if (d.mpick) {
      if (!M.b.picked.includes(d.mpick)) M.b.picked.push(d.mpick);
      M.b.how = 'picked';
      M.b.proposed = false;
      toast(`Added to batch ${N14} · ${M.b.picked.length} hand-picked`);
      return render();
    }
    if (d.mnudge1 && LV) return liveAct('nudge', {
      id: person(d.mnudge1).apiId
    }, 'Nudge recorded');
    if (d.mnudge1) {
      M.nudge = {
        k: PEOPLE.find(p => p.id === d.mnudge1).stage,
        ids: [d.mnudge1]
      };
      return render();
    }
    if (d.mnudgeids) {
      const [k, ids] = d.mnudgeids.split('|');
      M.nudge = {
        k,
        ids: ids.split(',')
      };
      M.bopen = null;
      return render();
    }
    if (d.mforce1 !== undefined) {
      M.nudge.force = d.mforce1 || null;
      return renderPanel();
    }
    if (t.hasAttribute('data-msend')) {
      const n = M.nudge._n,
        mix = M.nudge._mix;
      M.nudge.ids.forEach(id => {
        const p = PEOPLE.find(x => x.id === id);
        p.log.unshift({
          at: TODAY,
          t: `Nudged by ${CH[M.nudge.force || chanFor(p)].toLowerCase()} · just now`
        });
      });
      const one = M.nudge.ids.length === 1 ? M.nudge.ids[0] : null;
      M.nudge = null;
      if (one) M.open = one;
      toast(<>{"Nudge sent to "}<b>{fmt(n)}</b>{" · logged in Records"}</>);
      return render();
    }
    // nudges tab
    // live there's no group nudge to write yet: a group opens its people
    if (d.ng && LV) {
      M.tab = 'people';
      M.stage = d.ng;
      M.page = 0;
      closeAll();
      render();
      setHash();
      tabTop();
      return;
    }
    if (d.ng) {
      if (M.tab !== 'nudges') {
        M.tab = 'nudges';
      }
      M.ng = d.ng;
      M.force = null;
      render();
      if (t.closest('.brief')) $m('ncomp').scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
      return;
    }
    if (t.hasAttribute('data-ngjump')) {
      $m('ncomp').scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
      return;
    }
    if (d.mforce !== undefined) {
      M.force = d.mforce || null;
      return render();
    }
    if (d.mwhen) {
      M.when = d.mwhen;
      return render();
    }
    if (d.pv) {
      M.pv = d.pv;
      return render();
    }
    if (d.tok) {
      const ta = $m('ncmsg'),
        s = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, s) + d.tok + ta.value.slice(ta.selectionEnd ?? s);
      M.msg[M.ng] = ta.value;
      render();
      const n2 = $m('ncmsg');
      n2.focus();
      n2.setSelectionRange(s + d.tok.length, s + d.tok.length);
      return;
    }
    if (t.hasAttribute('data-ngsend')) {
      const L = grpList(M.ng, PEOPLE.filter(passF)),
        mx = {
          push: 0,
          email: 0,
          text: 0
        };
      L.forEach(p => mx[M.force || chanFor(p)]++);
      const when = M.when === 'now' ? 'today' : M.when === 'sun' ? 'for Sunday noon' : 'for Tuesday 6pm';
      M.sent.unshift({
        k: M.ng,
        n: L.length,
        mix: mx,
        when
      });
      toast(<>{"Nudge "}{M.when === 'now' ? 'sent' : 'scheduled'}{" to "}<b>{fmt(L.length)}</b>{" · logged in Records"}</>);
      return render();
    }
    if (d.flow) {
      const f = FLOWS.find(x => x.k === d.flow);
      f.on = !f.on;
      toast(<>{f.when}{" · "}<b>{f.on ? 'on' : 'off'}</b>{" · logged in Records"}</>);
      return render();
    }
    if (t.hasAttribute('data-fuadd')) {
      toast('Opens the follow-up editor');
      return;
    }
    // batches
    if (d.bopen) {
      if (TOT()) return toast('Names stay hidden in this view · co-op totals only');
      closeAll();
      M.bopen = +d.bopen;
      return render();
    }
    if (d.bjump) {
      if (M.tab !== 'batches') {
        M.tab = 'batches';
        render();
      }
      $m(d.bjump).scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
      return;
    }
    if (d.bpace) {
      M.b.pace = +d.bpace;
      return render();
    }
    if (d.b13) {
      M.b13 = d.b13 === 'undo' ? 'pending' : d.b13 === 'approve' ? 'approved' : 'back';
      M.b.proposed = false;
      if (d.b13 === 'approve') toast('Batch 13 approved · invites go out tomorrow at 9:00am');
      if (d.b13 === 'back') toast('Batch 13 sent back to Marcus Lee');
      return render();
    }
    if (d.bsize) {
      M.b.size = +d.bsize;
      M.b.proposed = false;
      if (M.b.picked.length > M.b.size) M.b.picked.length = M.b.size;
      return render();
    }
    if (d.bhow) {
      M.b.how = d.bhow;
      M.b.proposed = false;
      return render();
    }
    if (d.bcity) {
      const s = M.b.cities;
      s.has(d.bcity) ? s.delete(d.bcity) : s.add(d.bcity);
      M.b.proposed = false;
      return render();
    }
    if (d.bcitygo) {
      M.b.how = 'city';
      M.b.cities = new Set([d.bcitygo]);
      M.b.proposed = false;
      M.tab = 'batches';
      render();
      $m('b14').scrollIntoView({
        block: 'center'
      });
      return;
    }
    if (d.bshop) {
      const s = M.b.shops;
      s.has(d.bshop) ? s.delete(d.bshop) : s.add(d.bshop);
      M.b.proposed = false;
      return render();
    }
    if (d.bpick) {
      const a = M.b.picked,
        i = a.indexOf(d.bpick);
      i >= 0 ? a.splice(i, 1) : a.push(d.bpick);
      M.b.proposed = false;
      return render();
    }
    if (t.hasAttribute('data-bclearpick')) {
      M.b.picked = [];
      return render();
    }
    if (t.hasAttribute('data-bpropose') && LV) return proposeLive();
    if (t.hasAttribute('data-bpropose')) {
      M.b.proposed = true;
      toast('Batch 14 proposed · it shows in Needs you for a second person');
      return render();
    }
    if (d.wq) {
      M.wq = d.wq;
      return render();
    }
    if (d.wqmore) {
      const [k, n] = d.wqmore.split('|');
      M.wqx[k] = +n;
      const sc = R.querySelector('.ql3').scrollTop;
      render();
      R.querySelector('.ql3').scrollTop = sc;
      return;
    }
    if (d.go || d.gto) {
      const k = d.go || d.gto;
      if (k === 'cohorts') return CC.go('growth', 'cohorts');
      if (k === 'settings') return CC.go('team');
      return CC.go(k);
    }
    if (t.hasAttribute('data-mfreveal')) {
      M.fshow = !M.fshow;
      if (M.fshow) toast('Details shown · logged in Records');
      return render();
    }
  });
  R.addEventListener('input', e => {
    if (e.target.id === 'mq') {
      M.q = e.target.value;
      M.page = 0;
      if (M.tab !== 'people') {
        M.tab = 'people';
        render();
      } else {
        renderHdr();
        renderPeople();
      }
      const i = $m('mq');
      i.focus();
      i.setSelectionRange(i.value.length, i.value.length);
    }
    if (e.target.id === 'bq') {
      M.b.hq = e.target.value;
      renderBatches();
      const i = $m('bq');
      i.focus();
      i.setSelectionRange(i.value.length, i.value.length);
    }
    if (e.target.id === 'ncmsg') {
      M.msg[M.ng] = e.target.value;
      const g = GROUPS.find(x => x.k === M.ng),
        L = grpList(M.ng, PEOPLE.filter(passF)),
        s = L[0];
      R.querySelectorAll('.pv-nt p, .pv-eb p:nth-child(2)').forEach(p => p.textContent = fill(e.target.value, s));
    }
  });
  document.addEventListener('keydown', e => {
    if (!MLIVE()) return;
    if (e.key === 'Escape') {
      if (M.open || M.nudge || M.bopen) {
        closeAll();
        render();
      } else if (openMenu) {
        openMenu = null;
        renderCtl();
      }
    }
  });
  window.addEventListener('scroll', () => {
    if (!MLIVE()) return;
    const c = $m('ctl');
    if (c) c.classList.toggle('stuck', !c.hidden && c.getBoundingClientRect().top <= barH() + .5);
  }, {
    passive: true
  });

  /* the join form: what came in through useclear.org/join, newest first. Masked until shown; showing is logged. */
  // the reference's shared forms helpers (beside its Growth forms pane); INBOX and RANGE are data.tsx's, the same rows
  const mask = s => s[0] + '•'.repeat(Math.max(2, Math.min(5, s.length - 1)));
  const maskMail = m => {
    const [u, d] = m.split('@');
    return u[0] + '•••@' + d[0] + '•••.' + d.split('.').pop();
  };
  const FORM_META = {
    'Waitlist': [0, 'Waitlist sign-ups', '/join', 'They join the waitlist and wait for a batch'],
    'Shop enquiry': [1, 'Shop enquiries', '/shops', 'Shops asking to take Clear · add the good ones to the board'],
    'Land offer': [2, 'Land offers', '/contribute', 'Land or buildings offered to the co-op · Holdings reviews them'],
    'Work with us': [3, 'Work with us', '/work', 'People asking to join the team · grant access here once they start']
  };
  function formsCell() {
    const rows = LV ? LV.FORMS : INBOX.filter(x => x.type === 'Waitlist'),
      [i,, page, what] = FORM_META['Waitlist'],
      fresh = rows.filter(x => x.st === 'New').length,
      show = M.fshow && !RO();
    return <section className="band"><div className="bento"><div className="cell s12"><div className="hd"><h2>From the join form</h2><div className="r"><span className="lbl">{LV ? rows.length ? fresh ? `${fresh} not invited yet` : 'All of them invited' : 'Nothing in the last 30 days' : fresh ? fresh + ' new since this morning' : 'Nothing new since this morning'}</span></div></div><div className="bt-wrap"><table className="bt fm"><colgroup><col style={css("width:22%")} /><col style={css("width:26%")} /><col style={css("width:16%")} /><col style={css("width:20%")} /><col style={css("width:8%")} /><col style={css("width:8%")} /></colgroup><thead><tr><th className="c-nm">Name</th><th style={css("text-align:left")}>Email</th><th style={css("text-align:left")}>City</th><th style={css("text-align:left")}>Came from</th><th>At</th><th>Status</th></tr></thead><tbody>{!rows.length ? <tr><td colSpan="6" className="tn"><span className="quiet">Nobody in the last 30 days.</span></td></tr> : rows.map((x, __k) => <tr key={__k}><td className="tn"><b className={show ? '' : 'msk'}>{show ? x.who.join(' ') : x.who.map(mask).join(' ')}</b></td><td style={css("text-align:left")} className="fm-m">{show ? x.mail : maskMail(x.mail)}</td><td style={css("text-align:left")}>{x.city}</td><td style={css("text-align:left")} className="fr">{x.src}</td><td className="fm-m">{x.when}</td><td><span className={`chip ${x.st === 'New' ? 'under' : x.st === 'Invited' ? 'ok' : 'plain'}`}>{x.st}</span></td></tr>)}</tbody></table></div><div className="bk-ft"><span>{ICON.lock}{" "}{fmt(LV ? LV.formsMonth : RANGE.month.forms[i])}{" in the last 30 days from useclear.org"}{page}{" · "}{RO() ? 'names and emails stay hidden in this view' : show ? 'details shown · this is logged' : 'names and emails are masked'}</span>{RO() || LV ? <span /> : <button data-mfreveal="">{show ? 'Hide details' : 'Show details'}</button>}</div></div></div></section>;
  }
  const TABS = ['people', 'batches', 'nudges', 'waitlist'];
  let pend = null;
  function jump(id) {
    requestAnimationFrame(() => {
      const el = $m(id);
      if (!el) return;
      const y = el.getBoundingClientRect().top - barH() - 12;
      window.scrollTo({
        top: window.scrollY + y,
        behavior: 'smooth'
      });
    });
  }
  function mount() {
    // the slot is the shell's: the host goes inside it
    if (!into('m-slot')) return;
    W.classList.toggle('ro', RO());
    W.classList.toggle('tot', TOT());
    if (TOT() && M.tab === 'people') M.tab = 'batches';
    render();
    if (pend) {
      const p = pend;
      pend = null;
      if (p === 'b13' || p === 'b14') jump(p);
    }
  }
  function unmount() {
    if (W.classList.contains('pn')) {
      closeAll();
      W.classList.remove('pn');
    }
  }
  // p: a tab, or b13 / b14 (Batches, scrolled to that card), or nudges:<group>
  function setTab(p) {
    if (!p) return;
    const [k, x] = String(p).split(':');
    if (k === 'b13' || k === 'b14') {
      M.tab = 'batches';
      pend = k;
    } else if (TABS.includes(k)) {
      M.tab = k;
      if (k === 'nudges' && x) M.ng = x;
      if (k === 'people' && x) {
        M.stage = x;
        M.page = 0;
      }
    }
    closeAll();
  }
  return {
    mount,
    unmount,
    setTab: (_r, sub) => setTab(sub),
    tab: () => M.tab,
    host
  };
}
registerPage(['members'], 'm-slot', makeMembers, {
  live: true
});