// @ts-nocheck: ported from the redesign's GROWTH module (design/command-center-ui) with scripts/port/convert.cjs; its data is its own.
import { Fragment } from 'react';
import { attrs, css, hasHtml, html } from '../runtime/dom';
import { api } from '../live/api';
import { LIVE as LIVE_APP, REAL } from '../live/env';
import { CC } from './cc';
import { growthLive } from './growthLive';
import { registerPage, shadowHost } from './pageHost';

/*
 * Growth (design/command-center-ui, the GROWTH module): one funnel, five lenses (Overview, Traffic,
 * Campaigns, Cohorts, Apps), with page-wide City, Source, Shop and Design filters. It lives in its own
 * shadow root (pageHost.tsx), so its styles and the rest of the app's never touch: theme tokens inherit
 * in, nothing else does. Links out go through CC.go, so they land on the right page and pane.
 */

/** The page's skeleton: the reference template's markup, drawn once into the shadow root. */
function skeleton() {
  return <div className="gw"><div className="hdr stack" id="hdr" /><nav className="gtabs" aria-label="Growth views"><button data-tab="overview" aria-current="page">Overview</button><button data-tab="traffic">Traffic</button><button data-tab="campaigns">Campaigns</button><button data-tab="cohorts">Cohorts</button><button data-tab="apps">Apps</button><button className="tabr" data-copy="" title="Copy a link to this view"><svg className="i" viewBox="0 0 20 20" style={css("width:15px;height:15px")}><path d="M8 12l4-4" /><path d="M9 5l1.5-1.5a3.5 3.5 0 0 1 5 5L14 10M11 15l-1.5 1.5a3.5 3.5 0 0 1-5-5L6 10" /></svg><span>Copy link</span></button></nav><div className="ctl" id="ctl" /><div id="ov"><section className="band"><div className="bento"><div className="cell s12" id="funnel" /></div></section><section className="band" style={css("margin-top:0")}><div className="bento" style={css("border-top:0")}><div className="cell s12" id="bk" /></div></section><section className="band"><div className="bento"><div className="cell s8"><div id="trh" /><div id="trend" /><div id="trx" hidden /><div className="tr-k" id="trk" /><button className="foot" data-tab="cohorts"><span>6.4 joins for every invite this week · see how each invite week activates</span><span>Cohorts →</span></button></div><div className="cell s4"><div className="hd" id="wlh"><h2>Waitlist</h2><div className="r"><span className="lbl">1,500 waiting · 16-day median</span></div></div><div className="wl" id="wl" /></div></div></section><section className="band"><div className="bento" id="moves" /></section></div><div id="tf" hidden /><div id="cp" hidden /><div id="ch" hidden /><div id="ap" hidden /></div>;
}
function makeGrowth() {
  // live, every dataset is the API's (growthLive.ts); the reference's figures are the prototype's alone
  const L = REAL ? growthLive() : null;
  const { host, R, W, into, $g } = shadowHost('growth', skeleton());
  const BODY = {
    appendChild: x => W.appendChild(x),
    classList: {
      add: c => {
        W.classList.add(c);
        if (c === 'sh') document.body.style.overflow = 'hidden';
      },
      remove: c => {
        W.classList.remove(c);
        if (c === 'sh') document.body.style.overflow = '';
      }
    }
  };
  const GLIVE = () => host.isConnected && CC.route() === 'growth';
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
    try {
      history.replaceState(null, '', '#growth' + (S.tab === 'overview' ? '' : '/' + S.tab));
    } catch (e) {}
  };
  /* ── Growth: one funnel, one lens ─────────────────────────────────────────
     Every number on the page comes from the rows below, so totals always add up.
     Each row is the six-step funnel: visits, joined, invited, opened, activated, first $10 spend. */
  const STG = ['Visits', 'Joined', 'Invited', 'Opened', 'Activated', 'First spend'];
  const STEP = ['Visit → join', 'Join → invite', 'Invite → open', 'Open → active', 'Active → spend'];
  const STEP_LONG = ['visit to join', 'join to invite', 'invite to open', 'open to active', 'active to first spend'];
  const D = L ? L.D : {
    source: {
      name: 'Source',
      rows: [{
        n: 'Posters',
        f: [4812, 1106, 255, 160, 108, 97]
      }, {
        n: 'Direct',
        f: [12988, 98, 22, 14, 9, 6]
      }, {
        n: 'Social',
        f: [10420, 61, 14, 9, 4, 4]
      }, {
        n: 'Search',
        f: [8190, 37, 9, 5, 3, 2]
      }]
    },
    city: {
      name: 'City',
      rows: [{
        n: 'Redlands',
        f: [11208, 520, 120, 76, 51, 45],
        s: '33 posters'
      }, {
        n: 'San Bernardino',
        f: [9102, 330, 76, 48, 32, 28],
        s: '18 posters'
      }, {
        n: 'Riverside',
        f: [6655, 240, 55, 34, 22, 20],
        s: '13 posters'
      }, {
        n: 'Fontana',
        f: [1850, 52, 12, 8, 5, 4],
        s: '4 posters'
      }, {
        n: 'Rialto',
        f: [1210, 38, 9, 6, 4, 4],
        s: '4 posters'
      }, {
        n: 'Highland',
        f: [1120, 40, 9, 5, 3, 3],
        s: '4 posters'
      }, {
        n: 'Loma Linda',
        f: [1040, 30, 7, 4, 3, 2],
        s: '4 posters'
      }, {
        n: 'Colton',
        f: [980, 26, 6, 4, 2, 2],
        s: '4 posters'
      }, {
        n: 'Elsewhere',
        f: [3245, 26, 6, 3, 2, 1],
        s: 'No posters'
      }]
    },
    shop: {
      name: 'Shop',
      posters: 1,
      rows: [{
        n: "Rosa’s Panadería",
        s: 'Redlands · 4 posters',
        f: [842, 219, 50, 32, 22, 22]
      }, {
        n: 'Inland Cycle Works',
        s: 'Redlands · 3 posters',
        f: [611, 128, 29, 18, 12, 11]
      }, {
        n: 'Mesa Laundry',
        s: 'San Bernardino · 3',
        f: [530, 127, 29, 18, 12, 10]
      }, {
        n: 'Uptown Barber',
        s: 'Redlands · 3 posters',
        f: [402, 125, 29, 19, 14, 13]
      }, {
        n: 'Citrus Bowl Café',
        s: 'Riverside · 3 posters',
        f: [366, 70, 16, 10, 6, 6]
      }, {
        n: 'Redlands Tire & Lube',
        s: 'Redlands · 2 posters',
        f: [301, 36, 8, 5, 3, 2]
      }, {
        n: 'State St. Books',
        s: 'Redlands · 3 posters',
        f: [288, 81, 19, 12, 8, 7]
      }, {
        n: 'La Michoacana',
        s: 'San Bernardino · 3',
        f: [254, 64, 15, 9, 6, 6]
      }, {
        n: 'Arrowhead Nails',
        s: 'San Bernardino · 2',
        f: [221, 40, 9, 6, 4, 3]
      }, {
        n: 'Orange St. Laundromat',
        s: 'Redlands · 2 posters',
        f: [197, 39, 9, 6, 4, 3]
      }, {
        n: 'Community boards',
        s: '6 boards',
        f: [314, 47, 11, 6, 4, 3]
      }, {
        n: '20 more shops',
        s: 'Inland Empire · 68 posters',
        f: [486, 130, 31, 19, 13, 11]
      }]
    },
    design: {
      name: 'Design',
      posters: 1,
      rows: [{
        n: 'A · The neighbor',
        s: '41 posters',
        f: [2011, 501, 116, 73, 49, 44]
      }, {
        n: 'B · $10 on us',
        s: '38 posters',
        f: [2104, 465, 107, 67, 45, 40]
      }, {
        n: 'C · The map',
        s: '23 posters',
        f: [697, 140, 32, 20, 14, 13]
      }]
    },
    page: {
      name: 'Page',
      onlyStep: 0,
      rows: [{
        n: '/join',
        f: [9600, 1012]
      }, {
        n: '/',
        s: 'Home',
        f: [8200, 121]
      }, {
        n: '/how',
        f: [2900, 74]
      }, {
        n: '/housing',
        f: [820, 58]
      }, {
        n: '/coop',
        f: [500, 37]
      }, {
        n: '/s/:shop',
        s: 'Poster pages hand off to /join',
        f: [4812, 0]
      }, {
        n: '/shops',
        s: 'Hands off to /join',
        f: [1800, 0]
      }, {
        n: '/contribute',
        s: 'Hands off to /join',
        f: [1000, 0]
      }]
    },
    week: {
      name: 'Invite week',
      minStep: 2
    }
  };
  const COHORT = L ? L.COHORT : [['15 Sep', 25, [16, 28, 36, 44, 48]], ['22 Sep', 25, [20, 32, 40, 48, 52]], ['29 Sep', 50, [18, 30, 38, 42]], ['6 Oct', 75, [21, 33, 40]], ['13 Oct', 75, [19, 31]], ['20 Oct', 50, [12]]];

  /* ══ Traffic: who's coming, from where, on what, and when ═════════════════════════════
     Everything here is what Umami measures: page views, visitors (estimated, no cookies), referrers,
     UTM tags, devices, browsers, cities, pages, events and real-time. 30-day base; the period and
     filters scale it through the same visits figure the funnel uses, so Traffic and Overview agree. */
  const PROPS = L ? L.PROPS : [
  // property, 30-day visits, colour
  ['useclear.org', 24820, 'var(--fg)'], ['Poster pages', 4812, 'var(--live)'], ['Shop', 4236, 'var(--land)'], ['Apps (web)', 2542, 'color-mix(in srgb,var(--fg) 30%,transparent)']];
  const CHANNELS = L ? L.CHANNELS : [
  // channel, 30-day visits, bounce %, join rate %, change, referrers
  ['Direct', 12988, 51, 0.8, 6.2, [['Typed or bookmarked', 9120], ['Untagged links (texts, DMs)', 3868]]], ['Social', 10420, 58, 0.6, 18.4, [['instagram.com', 4010, 41.0], ['nextdoor.com', 2400, 22.5], ['facebook.com', 2180, 4.1], ['tiktok.com', 1830, 63.0]]], ['Search', 8190, 41, 0.5, 9.8, [['google.com', 7120], ['bing.com', 1070]]], ['Posters', 4812, 22, 23.0, 31.6, [['QR scans', 4812]]]];
  const PAGES = L ? L.PAGES : [
  // path, property, entries, bounce %, avg seconds, joins started here
  ['/join', 'useclear.org', 9600, 18, 96, 1012], ['/', 'useclear.org', 8200, 49, 64, 121], ['/s/:shop', 'Poster pages', 4812, 22, 41, null], ['/how', 'useclear.org', 2900, 38, 142, 74], ['/shop', 'Shop', 2950, 44, 88, null], ['/shops', 'useclear.org', 1800, 40, 77, null], ['/app', 'Apps (web)', 1820, 12, 30, null], ['/contribute', 'useclear.org', 1000, 46, 121, null], ['/housing', 'useclear.org', 820, 35, 133, 58], ['/shop/hoodie', 'Shop', 760, 52, 48, null], ['/merchant', 'Apps (web)', 722, 9, 25, null], ['/shop/logo-tee', 'Shop', 526, 55, 41, null], ['/coop', 'useclear.org', 500, 42, 118, 37]];
  const DEV = L ? L.DEV : [['Phone', 28545], ['Desktop', 6590], ['Tablet', 1275]];
  const BROWSERS = L ? L.BROWSERS : [['Safari', 15100], ['Chrome', 14900], ['Samsung Internet', 3800], ['Other', 2610]];
  const TF_CITY = L ? L.TF_CITY : [['Redlands', 11208, 33], ['San Bernardino', 9102, 18], ['Riverside', 6655, 13], ['Fontana', 1850, 4], ['Rialto', 1210, 4], ['Highland', 1120, 4], ['Loma Linda', 1040, 4], ['Colton', 980, 4], ['Elsewhere', 3245, 0]];
  const W_CH = L ? L.W_CH : {
    Posters: [0, 0, 180, 390, 560, 720, 860, 990, 1100, 1210, 1250, 1377],
    Direct: [2100, 2150, 2230, 2310, 2400, 2520, 2640, 2760, 2880, 2900, 2960, 3204],
    Social: [900, 980, 1050, 1180, 1300, 1450, 1640, 1820, 2010, 2200, 2330, 2510],
    Search: [1200, 1230, 1260, 1300, 1360, 1420, 1500, 1560, 1630, 1700, 1699, 1815]
  };
  const CH_COL = {
    Posters: 'var(--live)',
    Direct: 'var(--fg)',
    Social: 'var(--land)',
    Search: 'color-mix(in srgb,var(--fg) 30%,transparent)'
  };
  const LIVE = L ? L.LIVE : [['/join', 'Poster · Uptown Barber', 'Redlands', 'Phone', 0], ['/', 'instagram.com', 'Riverside', 'Phone', 1], ['/s/rosas-panaderia', 'QR scan', 'Redlands', 'Phone', 1], ['/how', 'google.com', 'San Bernardino', 'Desktop', 2], ['/shop', 'Direct', 'Fontana', 'Phone', 3], ['/join', 'nextdoor.com', 'Redlands', 'Phone', 4]];
  let liveTimer = null;
  /* the live view: one square per person on the sites now, grouped by the page they're on, coloured by where they came from */
  const LV = {
    people: [],
    mins: [],
    last: null,
    wk: 19,
    feed: [],
    clock: 16 * 3600 + 3 * 60 + 20
  };
  const LV_DEV = ['Phone', 'Phone', 'Phone', 'Phone', 'Desktop', 'Tablet'];
  const lvTime = s => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  if (!L) (() => {
    const seed = [['/join', 'Posters'], ['/join', 'Posters'], ['/join', 'Social'], ['/join', 'Posters'], ['/join', 'Direct'], ['/join', 'Search'], ['/join', 'Posters'], ['/', 'Social'], ['/', 'Direct'], ['/', 'Search'], ['/', 'Social'], ['/', 'Direct'], ['/s/:shop', 'Posters'], ['/s/:shop', 'Posters'], ['/s/:shop', 'Posters'], ['/s/:shop', 'Posters'], ['/shop', 'Direct'], ['/shop', 'Social'], ['/shop', 'Social'], ['/how', 'Search'], ['/how', 'Direct'], ['/app', 'Direct'], ['/housing', 'Search']];
    seed.forEach((p, i) => LV.people.push({
      page: p[0],
      ch: p[1],
      id: i
    }));
    const r = rng(77);
    for (let i = 0; i < 30; i++) LV.mins.push(Math.round(14 + 8 * Math.sin(i / 5) + r() * 6));
    LV.mins[29] = LV.people.length;
    const fs = [['in', '/join', 'Posters', 'Uptown Barber poster', 'Redlands'], ['in', '/', 'Social', 'instagram.com', 'Riverside'], ['out', '/how', 'Search', 'google.com', 'Colton'], ['in', '/s/:shop', 'Posters', 'Rosa’s Panadería poster', 'Redlands'], ['in', '/how', 'Search', 'google.com', 'San Bernardino'], ['out', '/shop', 'Direct', 'a typed link', 'Fontana'], ['in', '/shop', 'Direct', 'a typed link', 'Fontana'], ['in', '/join', 'Social', 'nextdoor.com', 'Redlands'], ['out', '/', 'Social', 'tiktok.com', 'Rialto'], ['in', '/app', 'Direct', 'a typed link', 'Redlands'], ['in', '/s/:shop', 'Posters', 'Mesa Laundry poster', 'San Bernardino'], ['in', '/housing', 'Search', 'google.com', 'Highland']];
    fs.forEach((f, i) => LV.feed.push({
      k: f[0],
      page: f[1],
      ch: f[2],
      from: f[3],
      city: f[4],
      dev: LV_DEV[i % LV_DEV.length],
      t: lvTime(LV.clock - i * 23 - Math.round(r() * 12))
    }));
  })();
  const LV_PAGES = ['/join', '/', '/s/:shop', '/shop', '/how', '/app', '/housing'];
  const LV_FROM = {
    Posters: ['Uptown Barber poster', 'Rosa’s Panadería poster', 'Mesa Laundry poster'],
    Social: ['instagram.com', 'tiktok.com', 'nextdoor.com'],
    Search: ['google.com'],
    Direct: ['a typed link']
  };
  const LV_CITY = ['Redlands', 'San Bernardino', 'Riverside', 'Fontana', 'Colton'];
  /* live, Traffic's notes are worked out from the feed's rows rather than written for the reference's */
  function tfChannelsFoot() {
    const rate = c => c[1] ? c[3] : 0,
      p = CHANNELS.find(c => c[0] === 'Posters'),
      rest = CHANNELS.filter(c => c[0] !== 'Posters' && c[1]);
    const all = CHANNELS.reduce((a, c) => a + c[1], 0);
    if (!p || !p[1] || !all) return 'No visits counted by channel yet';
    const others = rest.reduce((a, c) => a + c[1] * rate(c), 0) / (rest.reduce((a, c) => a + c[1], 0) || 1);
    return `Posters bring ${Math.round(p[1] / all * 100)}% of visits${others ? ` and join at ${(rate(p) / others).toFixed(1)}× the rest` : ''}`;
  }
  function tfCityFoot(rows) {
    const per = rows.filter(c => c.posters).map(c => [c.n, c.v / c.posters]).sort((a, b) => b[1] - a[1]);
    return per.length ? `${per[0][0]} gets the most per poster` : 'No posters counted by city yet';
  }
  /* the pages people are on, busiest first: the reference's own list, live every page someone is on */
  const lvGroups = people => (L ? [...new Set(people.map(p => p.page))] : LV_PAGES).map(pg => [pg, people.filter(p => p.page === pg)]).filter(g => g[1].length).sort((a, b) => b[1].length - a[1].length);
  const lvClock = t => new Date(t).toLocaleTimeString('en-GB', {
    hour12: false
  });
  /* live: read who's on the site now, then draw it; not again within 15 seconds when Traffic redraws */
  LV.st = 'wait';
  let lvAt = 0;
  async function pollNow(force) {
    if (!L || !force && Date.now() - lvAt < 15000) return;
    lvAt = Date.now();
    // the empty preview has no API: nothing on the sites
    const r = LIVE_APP ? await api('GET', '/growth/now').catch(e => ({
      err: e.message || 'The site feed didn’t answer.'
    })) : {
      people: [],
      mins: Array(30).fill(0),
      wk: 0,
      feed: []
    };
    if (r.off) Object.assign(LV, {
      st: 'off',
      msg: `The site feed is off: ${r.off}.`
    });else if (r.err) Object.assign(LV, {
      st: 'err',
      msg: r.err
    });else {
      const was = new Set(LV.people.map(p => p.id));
      const seen = LV.st === 'ok';
      LV.st = 'ok';
      LV.msg = '';
      // a person is their page and source: one square each, the new ones popping in after the first read
      LV.people = r.people.map((p, i) => ({
        ...p,
        id: `${p.page}|${p.ch}|${r.people.slice(0, i).filter(q => q.page === p.page && q.ch === p.ch).length}`
      }));
      const fresh = seen ? LV.people.find(p => !was.has(p.id)) : null;
      LV.last = fresh ? fresh.id : null;
      LV.mins = r.mins;
      LV.wk = r.wk;
      LV.feed = r.feed.map(f => ({
        k: 'in',
        page: f.page,
        ch: f.ch,
        from: f.from,
        city: f.place,
        dev: f.dev,
        t: lvClock(f.at)
      }));
      const a = r.feed[0];
      LV.tick = a ? <><span className="lv2-dot" style={css(`background:${CH_COL[a.ch]}`)} /><span><b>{lvClock(a.at).slice(0, 5)}</b>{" · someone in "}{a.place}{" opened "}<span className="mono">{a.page}</span>{" from "}{a.from}</span></> : 'Nobody arrived in the last 30 minutes.';
      LV.fresh = !!fresh;
    }
    if (S.tab !== 'traffic' || !GLIVE()) return;
    renderLive();
    if (CS.open === 'live') {
      const p = $g('cpanel');
      if (p) {
        const b = p.querySelector('.pn-b'),
          y = b ? b.scrollTop : 0;
        renderLivePanel(p);
        const b2 = p.querySelector('.pn-b');
        if (b2) b2.scrollTop = y;
      }
    }
    LV.fresh = false;
  }
  function renderLive() {
    const el = $g('live');
    if (!el) return;
    // live, the people and the minutes are Umami's real-time view (GET /growth/now), read every 20 seconds
    if (L && LV.st !== 'ok') return html(el, <><div className="hd"><h2>Right now</h2><div className="r"><span className="lbl">{LV.st === 'off' ? 'Off' : LV.st === 'err' ? 'Not answering' : 'Reading'}</span></div></div><div className="lv-e"><span>{LV.msg || 'Reading the site feed…'}</span></div></>);
    const n = LV.people.length,
      mx = Math.max(...LV.mins, n, 1);
    const groups = lvGroups(LV.people);
    const d = n - LV.wk;
    html(el, <><div className="hd"><h2>Right now</h2><div className="r"><span className="lbl"><span className="dot pulse" style={css("color:var(--settled)")} />{" Live"}</span></div></div><div className="lv2-top"><span className="big num">{n}</span><span className="lv2-s"><b>on Clear's sites now</b><span className={`dl ${d >= 0 ? 'up' : 'dn'}`}>{d >= 0 ? '+' : ''}{d}{" vs this time last week"}</span></span></div><div className="lv2-m">{LV.mins.map((v, i) => <i key={i} className={i === 29 ? 'now' : ''} style={css(`height:${Math.max(6, v / mx * 100)}%`)} />)}</div><div className="lv2-ax"><span>30 min ago</span><span>Now</span></div>{L && !n ? <div className="lv-e"><span>Nobody is on the sites right now.</span></div> : <div className="lv2-g">{groups.map(([pg, ps], __k) => <div key={__k} className="lv2-r"><span className="lv2-p">{pg}</span><span className="lv2-u">{ps.map((p, __k) => <i key={__k} className={p.id === LV.last ? 'new' : ''} style={css(`background:${CH_COL[p.ch]}`)} title={p.ch} />)}</span><b>{ps.length}</b></div>)}</div>}<div className="lv2-t" id="lvt">{LV.tick || 'Watching for arrivals…'}</div><button className="foot" data-livep="">{"Open the full live view "}<span>→</span></button></>);
  }
  /* the full live view: the same feed, bigger, in the side panel */
  function renderLivePanel(p) {
    const n = LV.people.length,
      mx = Math.max(...LV.mins, n, 1),
      d = n - LV.wk;
    const groups = lvGroups(LV.people);
    const chs = Object.keys(CH_COL).map(ch => [ch, LV.people.filter(x => x.ch === ch).length]);
    html(p, <><div className="pn-hd"><span className="dot pulse" style={css("color:var(--settled)")} /><span className="lbl">Live view</span><button className="x" data-cclose="" aria-label="Close"><svg className="i" viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15" /></svg></button></div><div className="pn-b lp"><div className="lp-top"><span className="big num">{n}</span><span className="lv2-s"><b>people on Clear's sites now</b><span className={`dl ${d >= 0 ? 'up' : 'dn'}`}>{d >= 0 ? '+' : ''}{d}{" vs this time last week"}</span></span></div><div><div className="lv2-m lp-m">{LV.mins.map((v, i) => <i key={i} className={i === 29 ? 'now' : ''} style={css(`height:${Math.max(6, v / mx * 100)}%`)} title={`${v} on the sites`} />)}</div><div className="lv2-ax lp-ax"><span>30 min ago</span><span>15 min</span><span>Now</span></div></div><div className="lp-sec"><div className="lp-sh"><span className="lbl">By page</span><span className="lp-key">{chs.map(([ch, c], __k) => <span key={__k}><i style={css(`background:${CH_COL[ch]}`)} />{ch}{" "}<b>{c}</b></span>)}</span></div>{groups.map(([pg, ps], __k) => <div key={__k} className="lp-r"><span className="lp-p">{pg}</span><span className="lp-u">{ps.map((x, __k) => <i key={__k} className={x.id === LV.last ? 'new' : ''} style={css(`background:${CH_COL[x.ch]}`)} title={x.ch} />)}</span><b>{ps.length}</b></div>)}{L && !n ? <div className="lv-e"><span>Nobody is on the sites right now.</span></div> : null}</div><div className="lp-sec"><div className="lp-sh"><span className="lbl">{L ? 'Arrivals' : 'Arrivals and leaves'}</span><span className="lbl">{L ? 'Last 30 minutes' : <>{"Last "}{LV.feed.length}</>}</span></div>{L && !LV.feed.length ? <div className="lv-e"><span>Nobody arrived in the last 30 minutes.</span></div> : null}{LV.feed.map((f, i) => <div key={i} className={`lp-f ${i === 0 && LV.fresh ? 'fresh' : ''} ${f.k}`}><span className="lp-t">{f.t}</span><i style={css(f.k === 'in' ? `background:${CH_COL[f.ch]}` : `box-shadow:inset 0 0 0 1.5px ${CH_COL[f.ch]}`)} /><span className="lp-w"><b>{f.k === 'in' ? 'Arrived on' : 'Left'}{" "}<span className="mono">{f.page}</span></b><span>{f.k === 'in' ? 'From ' + f.from + ' · ' : ''}{f.city}{" · "}{f.dev}</span></span></div>)}</div></div><div className="pn-ft"><span className="nx">{L ? 'Updates every 20 seconds' : 'Updates every few seconds'}{" · first-party, no cookies"}</span><button className="btn" style={css("height:40px")} data-cclose="">Close</button></div></>);
  }
  function liveStep() {
    const r = Math.random();
    if (r < .58 || LV.people.length < 14) {
      const ch = ['Posters', 'Posters', 'Social', 'Direct', 'Search'][Math.floor(Math.random() * 5)];
      const page = ch === 'Posters' ? Math.random() < .6 ? '/s/:shop' : '/join' : LV_PAGES[Math.floor(Math.random() * 5)];
      const id = Date.now();
      LV.people.push({
        page,
        ch,
        id
      });
      LV.last = id;
      const from = LV_FROM[ch][Math.floor(Math.random() * LV_FROM[ch].length)],
        city = LV_CITY[Math.floor(Math.random() * LV_CITY.length)];
      LV.tick = <><span className="lv2-dot" style={css(`background:${CH_COL[ch]}`)} /><span><b>Just now</b>{" · someone in "}{city}{" opened "}<span className="mono">{page}</span>{" from "}{from}</span></>;
      LV.feed.unshift({
        k: 'in',
        page,
        ch,
        from,
        city,
        dev: LV_DEV[Math.floor(Math.random() * LV_DEV.length)],
        t: lvTime(LV.clock)
      });
    } else {
      const i = Math.floor(Math.random() * LV.people.length);
      const p = LV.people.splice(i, 1)[0];
      LV.last = null;
      LV.tick = <><span className="lv2-dot" style={css("background:var(--hair)")} /><span><b>Just now</b>{" · someone left "}<span className="mono">{p.page}</span></span></>;
      LV.feed.unshift({
        k: 'out',
        page: p.page,
        ch: p.ch,
        from: '',
        city: LV_CITY[Math.floor(Math.random() * LV_CITY.length)],
        dev: LV_DEV[Math.floor(Math.random() * LV_DEV.length)],
        t: lvTime(LV.clock)
      });
    }
    LV.clock += 3 + Math.floor(Math.random() * 5);
    LV.feed.length = Math.min(LV.feed.length, 20);
    LV.fresh = true;
    LV.mins[29] = LV.people.length;
    if (Math.random() < .2) {
      LV.mins.shift();
      LV.mins.push(LV.people.length);
    }
    renderLive();
    if (CS.open === 'live') {
      const p = $g('cpanel');
      if (p) {
        const b = p.querySelector('.pn-b'),
          y = b ? b.scrollTop : 0;
        renderLivePanel(p);
        const b2 = p.querySelector('.pn-b');
        if (b2) b2.scrollTop = y;
      }
    }
    LV.fresh = false;
  }
  const TS = {
    iso: null,
    prop: 'all',
    open: new Set(['Social']),
    heat: 'visits',
    pgSort: 'entries'
  };
  const secs = s => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  // the 30-day visits every Traffic figure scales from: live, the site feed's
  const VIS30 = L ? PROPS.reduce((a, p) => a + p[1], 0) : 36410;
  function tfScale() {
    const T = totals();
    return {
      T,
      k: T[0] / (VIS30 || 1)
    };
  }
  const propShare = () => TS.prop === 'all' ? 1 : PROPS.find(p => p[0] === TS.prop)[1] / (VIS30 || 1);
  function renderTraffic() {
    const {
        T,
        k
      } = tfScale(),
      ps = propShare(),
      V = T[0] * ps;
    const chRows = rowsFor('source').map(r => {
      // a row with no channel (live: invites, which no source brought) has no bounce, rate or referrers
      const c = CHANNELS.find(c => c[0] === r.n) ?? [r.n, 0, 0, 0, 0, []];
      return {
        n: r.n,
        v: r.v[0] * ps,
        bounce: c[2],
        join: c[3],
        chg: c[4],
        refs: c[5]
      };
    });
    const devAll = DEV.reduce((a, d) => a + d[1], 0),
      devShare = n => devAll ? (DEV.find(d => d[0] === n)?.[1] ?? 0) / devAll : 0;
    const ratio = L ? L.visitorsRatio : .69;
    const visitors = V * ratio,
      phone = L ? devShare('Phone') : .784,
      bounced = chRows.reduce((a, r) => a + r.v * r.bounce / 100, 0) / (V || 1);
    const ig = CHANNELS[1]?.[5]?.[0];
    // live, the busiest hour of the week by the site feed's share of visits
    const busiest = L ? (() => {
      let best = null,
        top = 0;
      L.HEAT.forEach(x => x.v.forEach((v, h) => {
        if (v > top) {
          top = v;
          best = `${x.d} ${String(h).padStart(2, '0')}:00`;
        }
      }));
      return best;
    })() : null;
    // header
    html($g('hdr'), <><span className="when"><span className="dot" />Growth · Traffic · {L ? 'Plausible' : 'Umami, first-party · Demo data'}</span><p className="brief">{fmt(V)}{" visits from about "}{fmt(visitors)}{" people, "}{Math.round(phone * 100)}{"% on a phone. "}{L ? (busiest ? <><a data-heatjump="">{busiest}</a>{" is the busiest hour. "}</> : '') : <><a data-ref="tiktok.com">TikTok</a>{" is the fastest-growing referrer, and "}<a data-heatjump="">Sunday at noon</a>{" is the busiest hour. "}</>}<span className="q">{perName()}{filterDesc() ? ' · ' + filterDesc() : ''}{TS.prop !== 'all' ? ' · ' + TS.prop : ''}.</span></p><div className="strip"><div className="sc"><span className="lbl">{"Visits · "}{perName()}</span><div className="sc-v">{fmt(V)}</div><div className="mb">{PROPS.reduce((acc, p, i) => {
              const w = TS.prop === 'all' ? p[1] / (VIS30 || 1) * 100 : p[0] === TS.prop ? 100 : 0;
              acc.h.push(<i key={i} style={css(`left:${acc.x}%;width:${w}%;background:${p[2]}`)} />);
              acc.x += w;
              return acc;
            }, {
              h: [],
              x: 0
            }).h}</div><div className="sc-s">{TS.prop === 'all' ? `Across ${PROPS.length === 1 ? 'one property' : `${PROPS.length} properties`}` : TS.prop}</div></div><div className="sc"><span className="lbl">Visitors · estimated</span><div className="sc-v">{fmt(visitors)}</div><div className="mb"><i style={css(`width:${Math.round(ratio * 100)}%`)} /><i style={css(`left:${Math.round(ratio * 100)}%;width:${100 - Math.round(ratio * 100)}%;background:var(--land)`)} /></div><div className="sc-s">{V ? `${100 - Math.round(ratio * 100)}% came back more than once` : 'No visits counted yet'}</div></div><div className="sc"><span className="lbl">On a phone</span><div className="sc-v">{Math.round(phone * 100)}%</div><div className="mb"><i style={css(`width:${+(phone * 100).toFixed(1)}%`)} /><i style={css(`left:${+(phone * 100).toFixed(1)}%;width:${+((L ? devShare('Desktop') : .181) * 100).toFixed(1)}%;background:var(--land)`)} /></div><div className="sc-s">{L ? `Desktop ${Math.round(devShare('Desktop') * 100)}% · tablet ${Math.round(devShare('Tablet') * 100)}%` : 'Desktop 18% · tablet 4%'}</div></div>{L ? <div className="sc"><span className="lbl">Bounced</span><div className="sc-v">—</div><div className="mb hatch" /><div className="sc-s">Not measured yet</div></div> : <div className="sc"><span className="lbl">Bounced</span><div className="sc-v">{p1(bounced * 100)}</div><div className="mb"><i style={css(`width:${bounced * 100}%;background:var(--underway)`)} /></div><div className="sc-s">{"Left after one page · posters "}{CHANNELS[3][2]}%</div></div>}</div></>);

    // property switch (Traffic-only lens) + visits over time + live
    const el = $g('tf');
    const props = <div className="tf-props seg" role="group" aria-label="Property"><button data-prop="all" aria-pressed={TS.prop === 'all'}>All properties</button>{PROPS.map((p, __k) => <button key={__k} data-prop={p[0]} aria-pressed={TS.prop === p[0]}><i style={css(`background:${p[2]}`)} />{p[0]}</button>)}</div>;

    // visits over time, stacked by channel
    const [a, b] = S.range,
      n = b - a + 1,
      gran = S.gran === 'auto' ? n <= 21 ? 'day' : 'week' : S.gran;
    const buckets = [];
    if (gran === 'day') for (let d = a; d <= b; d++) buckets.push([d, d]);else for (let e = b; e >= a; e -= 7) buckets.unshift([Math.max(a, e - 6), e]);
    const tot0 = sumR(0, a, b) || 1;
    const wkOf = d => Math.max(0, 11 - Math.floor((TODAY - d) / 7));
    const chShare = (ch, d) => {
      const w = wkOf(d),
        s = W_CH.Posters[w] + W_CH.Direct[w] + W_CH.Social[w] + W_CH.Search[w];
      return s ? (W_CH[ch]?.[w] ?? 0) / s : 0;
    };
    const visibleCh = chRows.map(r => r.n);
    const stacks = buckets.map(([x, y]) => {
      const out = {};
      let tot = 0;
      visibleCh.forEach(ch => {
        let v = 0;
        for (let d = x; d <= y; d++) v += DAILY[0][d] * chShare(ch, d);
        out[ch] = v;
        tot += v;
      });
      return {
        out,
        tot
      };
    });
    const scaleTo = V / (stacks.reduce((s, x) => s + x.tot, 0) || 1);
    stacks.forEach(s => {
      Object.keys(s.out).forEach(ch => s.out[ch] *= scaleTo);
      s.tot *= scaleTo;
    });
    const pr = prevRange(),
      prevTot = pr && cmpOn() ? buckets.map(([x, y]) => {
        const off = n;
        return sumR(0, x - off, y - off) / tot0 * V;
      }) : null;
    const isoK = TS.iso && visibleCh.includes(TS.iso) ? TS.iso : null;
    const raw = isoK ? Math.max(5, ...stacks.map(s => s.out[isoK]), ...(prevTot || [0]).map((v, i) => v * stacks[i].out[isoK] / (stacks[i].tot || 1))) : Math.max(5, ...stacks.map(s => s.tot), ...(prevTot || [0])),
      mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(s => raw / s <= 4) || mag * 10,
      ymax = Math.ceil(raw * 1.18 / step) * step;
    const ticks = [];
    for (let v = 0; v <= ymax + 1e-9; v += step) ticks.push(v);
    const every = buckets.length <= 12 ? 1 : Math.ceil(buckets.length / 8);
    // each period: last period as a hatched ghost on the left, this period stacked by channel on the right, total on top.
    // Clicking a channel in the key isolates it (the others fade) — the same rows that filter the page below.
    const dense = buckets.length > 16,
      part = i => gran === 'week' && buckets[i][1] - buckets[i][0] < 6;
    const iso = TS.iso && visibleCh.includes(TS.iso) ? TS.iso : null;
    const chart = <div className="tfc"><div className="bc-y">{ticks.map((v, __k) => <span key={__k} style={css(`bottom:${v / ymax * 100}%`)}>{fmt(v)}</span>)}</div><div className="bc-p">{ticks.map((v, __k) => <i key={__k} className="bc-g" style={css(`bottom:${v / ymax * 100}%`)} />)}<div className={`bc-cols ${dense ? 'dense' : ''}`}>{stacks.map((s, i) => {
            const shown = iso ? s.out[iso] : s.tot;
            const pv = prevTot ? prevTot[i] : null;
            const ch = pv ? pct(shown - (iso ? pv * (s.out[iso] / s.tot) : pv), iso ? pv * (s.out[iso] / s.tot) : pv) : null;
            return <div key={i} className={`bc-c tf-c ${part(i) ? 'part' : ''}`} tabIndex="0" data-tt={`${gran === 'day' ? dFmt(buckets[i][1]) : part(i) ? dFmt(buckets[i][0]) + ' – ' + dFmt(buckets[i][1]) + ' (part week)' : 'Week of ' + dFmt(buckets[i][0])}|${visibleCh.map(c => c + ':' + Math.round(s.out[c])).join(',')}|${Math.round(s.tot)}|${pv ? Math.round(pv) : ''}`}><div className="tf-pair">{pv != null && !dense ? <div className="tf-gh" style={css(`height:${(iso ? pv * (s.out[iso] / s.tot) : pv) / ymax * 100}%`)} /> : ''}<div className="tf-st">{(iso ? [iso] : visibleCh.slice().reverse()).map((c, __k) => <i key={__k} style={css(`height:${s.out[c] / ymax * 100}%;background:${CH_COL[c]}`)} />)}{!dense ? <span className="tf-tot" style={css(`bottom:${shown / ymax * 100}%`)}>{fmt(shown)}{ch != null && !part(i) ? <em className={ch >= 0 ? 'up' : 'dn'}>{ch >= 0 ? '+' : ''}{ch.toFixed(0)}%</em> : ''}</span> : ''}</div>{pv != null && dense ? <b className="tf-pv" style={css(`bottom:${pv / ymax * 100}%`)} /> : ''}</div><span className={`bc-x ${i % 2 ? 'odd' : ''}`}>{i % every === 0 || i === buckets.length - 1 ? gran === 'day' ? dFmt(buckets[i][1]) : dFmt(buckets[i][0]) + (part(i) ? ` · ${buckets[i][1] - buckets[i][0] + 1}d` : '') : ''}</span></div>;
          })}</div><div className="bc-tip" id="tftip" hidden /></div></div>;

    // channels with referrers
    // one scale for every bar in the table: share of all visits. A referrer's bar is a slice of its channel's bar,
    // so they line up and nest; "of Social" gives the within-channel share as a second, quieter number.
    const maxS = Math.max(...chRows.map(r => pct(r.v, V)), 1);
    const chTable = chRows.sort((x, y) => y.v - x.v).map((r, __k) => {
      const open = TS.open.has(r.n),
        refT = r.refs.reduce((s, x) => s + x[1], 0);
      const refs = open && r.refs.length > 1 ? r.refs.map(([rn, rv, growth], __k) => {
        const v = r.v * rv / refT,
          sAll = pct(v, V);
        return <tr key={__k} className="sub" data-ref={rn}><td className="tn"><span className="ind">{rn}</span><span className="of">{Math.round(rv / refT * 100)}{"% of "}{r.n.toLowerCase()}</span></td><td>{fmt(v)}</td><td><span className="shb thin"><i style={css(`width:${sAll / maxS * 100}%;background:${CH_COL[r.n]}`)} /></span><span className="shp sub">{p1(sAll)}</span></td><td /><td /><td>{growth != null && cmpOn() ? <span className="dl up">+{growth.toFixed(1)}%</span> : ''}</td></tr>;
      }) : '';
      const canOpen = r.refs.length > 1;
      return <Fragment key={__k}><tr data-row-src={r.n} className={open && canOpen ? 'opened' : ''}><td className="tn">{canOpen ? <button className="tw" data-twist={r.n} aria-expanded={open}>{open ? '−' : '+'}</button> : <i className="tw-x" />}<i className="swt" style={css(`background:${CH_COL[r.n]}`)} /><b>{r.n}</b></td><td>{fmt(r.v)}</td><td><span className="shb"><i style={css(`width:${pct(r.v, V) / maxS * 100}%;background:${CH_COL[r.n]}`)} /></span><span className="shp">{p1(pct(r.v, V))}</span></td><td>{r.bounce}%</td><td className={r.join > 5 ? 'good' : ''}>{p1(r.join)}</td><td>{cmpOn() ? <span className={`dl ${r.chg >= 0 ? 'up' : 'dn'}`}>+{r.chg.toFixed(1)}%</span> : ''}</td></tr>{refs}</Fragment>;
    });

    // when: 7×24 heatmap, Sunday noon and weekday evenings
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    // live, each hour's share of visits from the site feed (Mon first); the reference draws a modelled week
    const HEATL = L ? L.HEAT : null,
      heatTop = HEATL ? Math.max(0, ...HEATL.flatMap(x => x.v)) : 0;
    const hv = (d, h) => HEATL ? heatTop ? (HEATL[d]?.v[h] ?? 0) / heatTop * 1.3 : 0 : hvRef(d, h);
    const hvRef = (d, h) => {
      const ev = Math.exp(-((h - 19.5) ** 2) / 6),
        noon = Math.exp(-((h - 12.5) ** 2) / 5),
        morn = Math.exp(-((h - 8) ** 2) / 3) * .35;
      const night = h < 6 ? .04 : 0;
      return d === 6 ? .25 + noon * 1.0 + ev * .55 + night : d === 5 ? .2 + noon * .7 + ev * .65 + night : .12 + morn + noon * .35 + ev * (d === 4 ? .75 : .85) + night;
    };
    const heatMax = 1.3;
    const heat = <div className="hmx"><div className="hmx-h"><span />{Array.from({
          length: 24
        }, (_, h) => <span key={h}>{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>)}</div>{days.map((dn, d) => <div key={d} className="hmx-r"><span>{dn}</span>{Array.from({
          length: 24
        }, (_, h) => {
          const v = Math.min(1, hv(d, h) / heatMax);
          return <i key={h} className={hv(d, h) > 0.97 ? 'pk' : ''} style={css(`background:color-mix(in srgb,var(--fg) ${Math.round(4 + v * 86)}%,transparent)`)} title={`${dn} ${String(h).padStart(2, '0')}:00 · ${HEATL ? `${((HEATL[d]?.v[h] ?? 0) * 100).toFixed(1)}% of visits` : `${fmt(V / 7 / 24 * hv(d, h) / 0.42)} visits`}`} />;
        })}</div>)}<div className="hmx-k"><span className="pkk"><i className="pk" />Busiest hours</span><span>Quiet</span>{[8, 30, 55, 80, 90].map((x, __k) => <i key={__k} style={css(`background:color-mix(in srgb,var(--fg) ${x}%,transparent)`)} />)}<span>Busy</span></div></div>;

    // devices + browsers
    const devT = DEV.reduce((s, d) => s + d[1], 0),
      brT = BROWSERS.reduce((s, b) => s + b[1], 0);
    const devices = <div className="dv"><div className="dv-bar">{DEV.map((d, i) => <i key={i} style={css(`flex:${d[1]};background:${['var(--fg)', 'var(--land)', 'color-mix(in srgb,var(--fg) 30%,transparent)'][i]}`)} />)}</div><div className="dv-k">{DEV.map((d, i) => <span key={i}><i style={css(`background:${['var(--fg)', 'var(--land)', 'color-mix(in srgb,var(--fg) 30%,transparent)'][i]}`)} />{d[0]}<b>{p1(d[1] / devT * 100)}</b></span>)}</div><div className="dv-l"><span className="lbl">Browsers</span>{BROWSERS.map((b, __k) => <div key={__k}><span>{b[0]}</span><span className="shb"><i style={css(`width:${b[1] / BROWSERS[0][1] * 100}%`)} /></span><b>{p1(b[1] / brT * 100)}</b></div>)}</div></div>;

    // cities
    const cityRows = rowsFor('city').map(r => ({
      n: r.n,
      v: r.v[0] * ps,
      posters: (TF_CITY.find(c => c[0] === r.n) || [0, 0, 0])[2]
    }));
    const cmax = Math.max(...cityRows.map(c => c.v), 1);
    const cities = cityRows.map((c, __k) => <div key={__k} className="cty" data-city={c.n}><span className="ct-n">{c.n}</span><span className="shb"><i style={css(`width:${c.v / cmax * 100}%`)} /></span><b>{fmt(c.v)}</b><span className="ct-p">{c.posters ? `${fmt(c.v / c.posters)}/poster` : 'no posters'}</span></div>);

    // pages
    const pg = PAGES.filter(p => TS.prop === 'all' || p[1] === TS.prop).map(p => ({
      path: p[0],
      prop: p[1],
      e: p[2] * k,
      b: p[3],
      t: p[4],
      j: p[5] != null ? p[5] * k : null
    }));
    const pgKey = TS.pgSort;
    pg.sort((x, y) => pgKey === 'bounce' ? y.b - x.b : pgKey === 'time' ? y.t - x.t : pgKey === 'joins' ? (y.j ?? -1) - (x.j ?? -1) : y.e - x.e);
    const pth = (k2, t) => <th data-pgsort={k2} className={TS.pgSort === k2 ? 's' : ''}>{t}{TS.pgSort === k2 ? ' ↓' : ''}</th>;
    const pages = <div className="bt-wrap"><table className="bt pg"><thead><tr><th className="c-nm">Page</th>{pth('entries', 'Entries')}{pth('bounce', 'Bounced')}{pth('time', 'Time on page')}{pth('joins', 'Joins started')}</tr></thead><tbody>{pg.map((p, __k) => <tr key={__k}><td className="tn c-nm"><b className="mono">{p.path}</b><span><i className="swt" style={css(`background:${PROPS.find(x => x[0] === p.prop)[2]}`)} />{p.prop}</span></td><td>{fmt(p.e)}</td><td className={p.b >= 50 ? 'warn' : ''}>{p.b}%</td><td>{secs(p.t)}</td><td>{p.j == null ? <span className="quiet small">—</span> : fmt(p.j)}</td></tr>)}</tbody></table></div>;
    html(el, <>{props}<section className="band" style={css("margin-top:0")}><div className="bento"><div className="cell s8"><div className="hd"><h2>Visits over time</h2><div className="r"><span className="lbl">{"By "}{gran}</span><div className="seg sm" role="group" aria-label="Granularity">{[['auto', 'Auto'], ['day', 'Daily'], ['week', 'Weekly']].map(([k2, t], __k) => <button key={__k} data-gran={k2} aria-pressed={S.gran === k2}>{t}</button>)}</div></div></div>{chart}<div className="tr-k tf-k">{visibleCh.map((ch, __k) => <button key={__k} data-iso={ch} className={`${iso === ch ? 'on' : ''} ${iso && iso !== ch ? 'off' : ''}`}><i style={css(`background:${CH_COL[ch]};width:10px;height:10px`)} />{ch}</button>)}{prevTot ? <span className="gh-k"><i className="tf-gh-k" />{cmpName()}</span> : ''}{iso ? <button className="clear" data-iso="">Show all</button> : ''}</div></div><div className="cell s4" id="live" /></div></section><section className="band"><div className="bento"><div className="cell s12"><div className="hd"><h2>Channels and referrers</h2><div className="r"><span className="lbl">Click a row to filter · + for referrers</span></div></div>{L && !chRows.length ? <div className="lv-e"><span>No visits by channel yet</span></div> : <div className="bt-wrap"><table className="bt ch"><thead><tr><th className="c-nm">Channel</th><th>Visits</th><th>Share</th><th>Bounced</th><th>Join rate</th><th>{cmpOn() ? 'Change' : ''}</th></tr></thead><tbody>{chTable}</tbody></table></div>}<div className="bk-ft">{L ? <span>{tfChannelsFoot()}</span> : <span>{"Posters bring 13% of visits but convert "}<b>37×</b>{" better than every other channel combined"}</span>}<button data-tab="campaigns">Compare campaigns →</button></div></div></div></section><section className="band"><div className="bento"><div className="cell s7" id="heat"><div className="hd"><h2>When they visit</h2><div className="r"><span className="lbl">{"By hour · "}{perName()}</span></div></div>{heat}<div className="bk-ft">{L ? <span>{busiest ? <>{"Busiest: "}<b>{busiest}</b></> : 'No visits counted yet'}</span> : <span>{"Busiest: "}<b>Sunday 12:00–14:00</b>{" and "}<b>weekdays 18:00–21:00</b></span>}{L ? <span /> : <button data-act="" data-newcamp="">Plan a campaign for those windows →</button>}</div></div><div className="cell s5"><div className="hd"><h2>Devices</h2><div className="r"><span className="lbl">{perName()}</span></div></div>{devices}<div className="bk-ft">{L ? <span>By screen size, as Plausible counts it</span> : <span>{"Poster scans are "}<b>99% phone</b></span>}<span /></div></div></div></section><section className="band"><div className="bento"><div className="cell s5"><div className="hd"><h2>Where they're from</h2><div className="r"><span className="lbl">City · visits per poster</span></div></div>{L && !cityRows.length ? <div className="lv-e"><span>No visits by city yet</span></div> : <div className="ct-l">{cities}</div>}<div className="bk-ft">{L ? <span>{tfCityFoot(cityRows)}</span> : <span>Riverside gets the most per poster</span>}<button data-go="field" data-gp="placement">Poster placement in Field →</button></div></div><div className="cell s7"><div className="hd"><h2>Pages</h2><div className="r"><span className="lbl">{"Where visits start · "}{TS.prop === 'all' ? 'all properties' : TS.prop}</span></div></div>{L && !pg.length ? <div className="lv-e"><span>No visits by page yet</span></div> : pages}<div className="bk-ft"><span>{"Pages with "}<b className="warn">50%+</b>{" bounced are worth a look"}</span><span /></div></div></div></section><div className="src-note"><span><b>Source:</b>{L ? ' Plausible, on useclear.org. No cookies, no ad trackers; visitor counts are estimates and nobody is followed across sites.' : " Umami, first-party on our servers. No cookies, no ad trackers; visitor counts are estimates and nobody is followed across sites."}</span>{L ? null : <button className="btn" style={css("height:32px")} data-act="">Add a data source</button>}</div></>);
    renderLive();
    clearInterval(liveTimer);
    if (L) {
      pollNow();
      // every 20 seconds while Traffic shows, skipped while the tab is in the background
      liveTimer = setInterval(() => {
        if (S.tab !== 'traffic' || !$g('live') || !GLIVE()) return clearInterval(liveTimer);
        if (!document.hidden) pollNow(true);
      }, 20000);
    } else liveTimer = setInterval(() => {
      if (S.tab !== 'traffic' || !$g('live') || !GLIVE()) return clearInterval(liveTimer);
      liveStep();
    }, 3200);
  }
  R.addEventListener('mouseover', e => {
    const c = e.target.closest('.tf-c');
    const tip = $g('tftip');
    if (!tip) return;
    if (!c) {
      tip.hidden = true;
      return;
    }
    const [t, parts, tot, prev] = c.dataset.tt.split('|');
    const p = c.parentElement.getBoundingClientRect(),
      r = c.getBoundingClientRect();
    html(tip, <><b>{t}</b>{parts.split(',').map((x, __k) => {
        const [ch, v] = x.split(':');
        return <span key={__k}><i style={css(`background:${CH_COL[ch]}`)} />{ch}<em>{fmt(+v)}</em></span>;
      })}<span className="nt">Total<em style={css("color:var(--fg)")}>{fmt(+tot)}</em></span>{prev ? <span>{cmpName()}<em>{fmt(+prev)}</em></span> : ''}</>);
    tip.hidden = false;
    const tw = tip.offsetWidth;
    let x = r.right - p.left + 8;
    if (x + tw > p.width) x = r.left - p.left - tw - 8;
    tip.style.left = Math.max(0, x) + 'px';
  });

  /* ══ Campaigns: what did we do, and what did it get us? ══════════════════════════════
     A campaign is labelled traffic (UTM tags, poster QR codes, referral codes) plus what it cost.
     Numbers are the 30-day base and scale with the period by how much of each campaign's run falls
     inside it. Visits and joins tie back to Traffic's channels and Overview's funnel; "Untagged" is the rest. */
  const CAMPS = L ? L.CAMPS : [{
    id: 'pa',
    n: 'The neighbor',
    sub: 'Poster design A',
    type: 'Posters',
    start: 14,
    end: null,
    posters: 41,
    print: 98.40,
    offer: 440,
    ads: 0,
    credit: 0,
    f: [2011, 501, 116, 73, 49, 44],
    utm: 'qr · poster · design-a',
    note: 'Neighbor photo, “Your shop is part of this.”'
  }, {
    id: 'pb',
    n: '$10 on us',
    sub: 'Poster design B',
    type: 'Posters',
    start: 21,
    end: null,
    posters: 38,
    print: 91.20,
    offer: 400,
    ads: 0,
    credit: 0,
    f: [2104, 465, 107, 67, 45, 40],
    utm: 'qr · poster · design-b',
    note: 'Leads with the $10 to spend at this shop.'
  }, {
    id: 'pc',
    n: 'The map',
    sub: 'Poster design C',
    type: 'Posters',
    start: 42,
    end: null,
    posters: 23,
    print: 55.20,
    offer: 130,
    ads: 0,
    credit: 0,
    f: [697, 140, 32, 20, 14, 13],
    utm: 'qr · poster · design-c',
    note: 'Map of partner shops nearby.'
  }, {
    id: 'rl',
    n: 'Co-op reels',
    sub: 'Instagram + TikTok, organic',
    type: 'Social',
    start: 28,
    end: null,
    print: 0,
    offer: 0,
    ads: 0,
    credit: 0,
    f: [2640, 31, 7, 5, 2, 2],
    utm: 'social · reel · coop-reels',
    note: 'Weekly 30-second reels. Time only, no spend.'
  }, {
    id: 'nd',
    n: 'Nextdoor posts',
    sub: 'Neighborhood posts, organic',
    type: 'Social',
    start: 35,
    end: null,
    print: 0,
    offer: 0,
    ads: 0,
    credit: 0,
    f: [1710, 18, 4, 3, 1, 1],
    utm: 'social · post · nextdoor',
    note: 'One post per neighborhood every two weeks.'
  }, {
    id: 'ig',
    n: 'Instagram test ads',
    sub: 'Paid · Redlands + San Bernardino',
    type: 'Ads',
    start: 63,
    end: 77,
    print: 0,
    offer: 0,
    ads: 300,
    credit: 0,
    f: [1410, 22, 5, 3, 1, 1],
    utm: 'paid · instagram · test-1',
    note: 'Two-week test, $300 budget, ended 20 Oct.'
  }, {
    id: 'rf',
    n: 'Member referrals',
    sub: 'Codes, $5 credit when activated',
    type: 'Referrals',
    start: 56,
    end: null,
    print: 0,
    offer: 0,
    ads: 0,
    credit: 45,
    f: [380, 38, 9, 7, 9, 6],
    utm: 'referral · code',
    note: 'Members share a code; $5 credit when their invitee activates.'
  }];
  const UNTAGGED = {
    n: 'Untagged',
    sub: 'Direct, search and links without tags',
    f: [25458, 87, 20, 10, 3, 2]
  };
  const TYPE_COL = {
    Posters: 'var(--live)',
    Social: 'var(--land)',
    Ads: 'var(--underway)',
    Referrals: 'var(--fg)'
  };
  const CS = {
    sort: 'joins',
    open: null
  };
  const spendOf = c => c.print + c.offer + c.ads + c.credit;

  /* period scaling: the share of each campaign's 30-day result that falls in the chosen range */
  function campScaled() {
    const [a, b] = S.range,
      P = factor(a, b),
      base = [TODAY - 29, TODAY];
    const ov = (s, e, x, y) => Math.max(0, Math.min(e, y) - Math.max(s, x) + 1);
    let mult = 1;
    if (S.F.city.size) {
      const sh = share('city');
      mult = sh[1] || 0;
    }
    const typeOk = c => {
      if (S.F.design.size) return c.type === 'Posters' && [...S.F.design].some(d => d.startsWith(c.sub.slice(-1)));
      if (S.F.shop.size) return c.type === 'Posters';
      if (S.F.source.size) return [...S.F.source].some(s => s === 'Posters' ? c.type === 'Posters' : s === 'Social' ? c.type === 'Social' || c.type === 'Ads' : s === 'Direct' ? c.type === 'Referrals' : false);
      return true;
    };
    return CAMPS.filter(typeOk).map(c => {
      const end = c.end ?? TODAY,
        inBase = ov(c.start, end, ...base) || 1,
        inR = ov(c.start, end, a, b);
      const dayK = inR / inBase;
      // each step scales by the site's own daily shape over the days this campaign ran, so growth and start dates both count
      const vv = c.f.map((x, i) => {
        const den = sumR(i, Math.max(c.start, base[0]), Math.min(end, base[1]));
        const num = sumR(i, Math.max(c.start, a), Math.min(end, b));
        return Math.round(x * (den ? num / den : dayK) * mult);
      });
      const sp = {
        print: c.start >= a && c.start <= b ? c.print : S.per === 'all' ? c.print : c.print * dayK,
        offer: c.offer * dayK * mult,
        ads: c.ads * dayK,
        credit: c.credit * dayK * mult
      };
      return {
        ...c,
        v: vv,
        sp,
        spend: sp.print + sp.offer + sp.ads + sp.credit,
        inR
      };
    }).filter(c => c.inR > 0);
  }
  function renderCampaigns() {
    const rows = campScaled();
    const J = rows.reduce((s, c) => s + c.v[1], 0),
      SP = rows.reduce((s, c) => s + c.spend, 0),
      ACT = rows.reduce((s, c) => s + c.v[4], 0);
    const OFFER = rows.reduce((s, c) => s + c.sp.offer, 0),
      T = totals();
    const cpj = J ? SP / J : 0;
    const posters = rows.filter(c => c.type === 'Posters'),
      pJ = posters.reduce((s, c) => s + c.v[1], 0),
      pS = posters.reduce((s, c) => s + c.spend, 0);
    const ads = rows.find(c => c.id === 'ig');
    const money = v => '$' + v.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    const money0 = v => '$' + Math.round(v).toLocaleString('en-US');
    html($g('hdr'), <><span className="when"><span className="dot" />Growth · Campaigns{L ? '' : ' · Demo data'}</span><p className="brief">{"Campaigns cost "}{money(SP)}{" and brought "}{fmt(J)}{" joins, "}{money(cpj)}{" each."}{pJ ? ` Posters are the cheapest at about ${money(pS / pJ)} a join` : ''}{ads && ads.v[1] ? <>{"; the "}<a data-camp="ig">Instagram test ads</a>{" cost "}{money(ads.spend / ads.v[1])}{" a join."}</> : '.'}{" "}<span className="q">{perName()}{filterDesc() ? ' · ' + filterDesc() : ''}.</span></p><div className="strip"><div className="sc"><span className="lbl">{"Spent · "}{perName()}</span><div className="sc-v"><span>{money0(SP)}<span className="ct">.{(SP % 1).toFixed(2).slice(2)}</span></span></div><div className="mb">{(() => {
              let x = 0;
              return [['offer', 'var(--live)'], ['print', 'var(--fg)'], ['ads', 'var(--underway)'], ['credit', 'var(--land)']].map(([k, col], __k) => {
                const t = rows.reduce((s, c) => s + c.sp[k], 0),
                  w = SP ? t / SP * 100 : 0,
                  h = <i style={css(`left:${x}%;width:${w}%;background:${col}`)} />;
                x += w;
                return h;
              });
            })()}</div><div className="sc-s">{SP ? Math.round(OFFER / SP * 100) : 0}% is the $10 offer, spent in shops</div></div><div className="sc"><span className="lbl">Joins from campaigns</span><div className="sc-v">{fmt(J)}{" "}<small>{T[1] ? Math.round(J / T[1] * 100) : 0}%</small></div><div className="mb"><i style={css(`width:${T[1] ? J / T[1] * 100 : 0}%`)} /></div><div className="sc-s">of all joins carry a campaign tag</div></div><div className="sc"><span className="lbl">Cost per join</span><div className="sc-v"><span>${Math.floor(cpj)}<span className="ct">.{(cpj % 1).toFixed(2).slice(2)}</span></span></div><div className="mb"><i style={css(`width:${Math.min(100, cpj / 5 * 100)}%`)} /></div><div className="sc-s">{ACT ? money(SP / ACT) : '—'}{" per activated member"}</div></div><div className="sc"><span className="lbl">Live campaigns</span><div className="sc-v">{CAMPS.filter(c => !c.end).length}{" "}<small>{"of "}{CAMPS.length}</small></div><div className="units cmp-u">{CAMPS.map((c, __k) => <i key={__k} style={css(`background:${c.end ? 'none' : TYPE_COL[c.type]};box-shadow:${c.end ? 'inset 0 0 0 1.5px var(--fg-50)' : 'none'}`)} />)}</div><div className="sc-s">Instagram test ended 20 Oct</div></div></div></>);

    /* calendar: one lane per campaign on the shared day grid; joins a day underneath so lift lines up with launches */
    const [a, b] = S.range,
      n = b - a + 1;
    const showA = Math.max(0, a),
      cols = b - showA + 1;
    const X = d => (Math.max(showA, Math.min(b + 1, d)) - showA) / cols * 100;
    const months = [];
    for (let d = showA; d <= b; d++) {
      const dt = dayDate(d);
      if (d === showA || dt.getDate() === 1) months.push([d, dt.toLocaleString('en', {
        month: 'long'
      })]);
    }
    const dayTicks = [];
    const stepD = cols <= 10 ? 1 : cols <= 40 ? 7 : 14;
    for (let d = b; d >= showA; d -= stepD) dayTicks.unshift(d);
    const jd = [];
    for (let d = showA; d <= b; d++) jd.push(DAILY[1][d]);
    const jmx = Math.max(...jd, 1);
    const lanes = CAMPS.map((c, __k) => {
      const r = rows.find(x => x.id === c.id),
        end = c.end ?? TODAY,
        vis = end >= showA && c.start <= b;
      const x0 = X(c.start),
        x1 = X(end + 1),
        cut = c.start < showA;
      return <div key={__k} className={`cg2-l ${CS.open === c.id ? 'on' : ''}`} data-camp={c.id}><span className="cg2-n"><i style={css(`background:${TYPE_COL[c.type]}`)} /><b>{c.n}</b><span>{c.type}</span></span><span className="cg2-t">{vis ? <span className={`cg2-bar ${c.end ? 'ended' : ''} ${cut ? 'cut' : ''}`} style={css(`left:${x0}%;width:${Math.max(.8, x1 - x0)}%;--c:${TYPE_COL[c.type]}`)}><span className="cg2-bl">{cut ? '← ' : ''}{r ? fmt(r.v[1]) + ' joins' : ''}{c.end ? ' · ended ' + dFmt(c.end) : ''}</span></span> : <span className="cg2-none">{c.start > b ? 'Starts ' + dFmt(c.start) : 'Not running in this period'}</span>}</span></div>;
    });
    // month band: one segment per month in view, alternating tint, label inside; Mondays as faint guides through every lane
    const mSegs = months.map(([d, m], i) => {
      const nx = months[i + 1] ? months[i + 1][0] : b + 1;
      return <span key={i} className={`cg2-ms ${i % 2 ? 'alt' : ''}`} style={css(`left:${X(d)}%;width:${X(nx) - X(d)}%`)}><b>{m}</b></span>;
    });
    const guides = [];
    for (let d = showA; d <= b; d++) if (dayDate(d).getDay() === 1) guides.push(<i key={d} style={css(`left:${(d - showA) / cols * 100}%`)} />);
    const nowX = ((TODAY - showA + .5) / cols * 100).toFixed(3);
    const cal = <div className="cg2"><div className="cg2-hd"><span /><span className="cg2-t"><span className="cg2-mb">{mSegs}</span>{dayTicks.map((d, __k) => <span key={__k} className={`cg2-dt ${d === TODAY ? 'td' : ''}`} style={css(`left:${(d - showA + .5) / cols * 100}%`)}>{d === TODAY ? 'Today' : dayDate(d).getDate()}</span>)}</span></div><div className="cg2-body"><span /><span className="cg2-gd">{guides}<i className="cg2-now" style={css(`left:${nowX}%`)} /></span></div>{lanes}<div className="cg2-l cg2-j"><span className="cg2-n"><b>All joins a day</b><span>for lift</span></span><span className="cg2-t"><span className="cg2-jb">{jd.map((v, i) => <i key={i} style={css(`left:${i / cols * 100}%;width:${100 / cols}%;height:${Math.max(2, v / jmx * 100)}%`)} />)}</span></span></div></div>;

    /* table: one row per campaign, untagged at the bottom; cost per join drawn so lower reads as better */
    const key = CS.sort,
      sorted = rows.slice().sort((x, y) => key === 'cpj' ? (x.v[1] ? x.spend / x.v[1] : 1e9) - (y.v[1] ? y.spend / y.v[1] : 1e9) : key === 'spend' ? y.spend - x.spend : key === 'visits' ? y.v[0] - x.v[0] : y.v[1] - x.v[1]);
    const maxC = 5;
    const th = (k, t, cls = '') => <th data-csort={k} className={`${CS.sort === k ? 's' : ''} ${cls}`}>{t}{CS.sort === k ? ' ↓' : ''}</th>;
    // two groups: what it got (results) and what it cost; cost per join closes the row as the punchline
    const table = <div className="bt-wrap"><table className="bt cp"><colgroup><col style={css("width:27%")} /><col style={css("width:10%")} /><col style={css("width:9%")} /><col style={css("width:8%")} /><col style={css("width:9%")} /><col style={css("width:17%")} /><col style={css("width:8%")} /><col style={css("width:12%")} /></colgroup><thead><tr><th className="c-nm">Campaign</th>{th('spend', 'Spent')}{th('visits', 'Visits')}{th('joins', 'Joins')}<th>Join rate</th>{th('cpj', 'Cost per join')}<th>Activated</th><th>$10 redeemed</th></tr></thead><tbody>{sorted.map((c, __k) => {
            const cj = c.v[1] ? c.spend / c.v[1] : null;
            return <tr key={__k} data-camp={c.id} className={CS.open === c.id ? 'sel' : ''}><td className="tn"><span className="cp-n"><i className="swt" style={css(`background:${TYPE_COL[c.type]}`)} /><b>{c.n}</b>{c.end ? <em className="chip plain nodot">Ended</em> : ''}</span><span className="cp-s">{c.sub}</span></td><td>{c.spend ? money(c.spend) : <span className="quiet">$0</span>}</td><td>{fmt(c.v[0])}</td><td><b>{fmt(c.v[1])}</b></td><td className={pct(c.v[1], c.v[0]) > 10 ? 'good' : ''}>{p1(pct(c.v[1], c.v[0]))}</td><td>{cj == null ? '—' : c.spend === 0 ? <span className="cpj"><span className="shb nob" /><b className="quiet">Free</b></span> : <span className="cpj"><span className={`shb ${cj > maxC ? 'over' : ''}`}><i className={cj > maxC ? 'lo' : ''} style={css(`width:${Math.min(cj, maxC) / maxC * 100}%`)} /></span><b className={cj > maxC ? 'warn' : ''}>{money(cj)}</b></span>}</td><td>{fmt(c.v[4])}</td><td>{c.sp.offer ? <span className="rd"><b>{money0(c.sp.offer)}</b><span>{fmt(c.v[5])}{" spends"}</span></span> : <span className="quiet">—</span>}</td></tr>;
          })}<tr className="untag"><td className="tn"><span className="cp-n"><i className="swt" style={css("background:var(--hair);box-shadow:inset 0 0 0 1px var(--fg-50)")} /><b>{UNTAGGED.n}</b></span><span className="cp-s">{UNTAGGED.sub}</span></td><td><span className="quiet">—</span></td><td>{fmt(UNTAGGED.f[0] * factor(a, b)[0])}</td><td>{fmt(UNTAGGED.f[1] * factor(a, b)[1])}</td><td>{p1(pct(UNTAGGED.f[1], UNTAGGED.f[0]))}</td><td><span className="quiet">—</span></td><td>{fmt(UNTAGGED.f[4] * factor(a, b)[4])}</td><td><span className="quiet">—</span></td></tr></tbody></table></div>;

    /* poster design test */
    const des = rows.filter(c => c.type === 'Posters'),
      dmax = Math.max(...des.map(c => pct(c.v[1], c.v[0])), 1);
    const best = des.slice().sort((x, y) => pct(y.v[1], y.v[0]) - pct(x.v[1], x.v[0]))[0];
    const design = des.length ? <div className="ds">{des.map((c, __k) => {
        const r = pct(c.v[1], c.v[0]);
        return <div key={__k} className={`ds-r ${c === best ? 'win' : ''}`} data-camp={c.id}><div className="ds-h"><span className="ds-ic">{c.sub.slice(-1)}</span><span><b>{c.n}</b><span>{c.posters}{" posters · "}{fmt(c.v[0] / c.posters)}{" scans each"}</span></span>{c === best ? <span className="chip ok">Best</span> : ''}</div><div className="ds-b"><span className="lbl">Join rate</span><span className="shb"><i style={css(`width:${r / dmax * 100}%;background:${c === best ? 'var(--settled)' : 'var(--fg)'}`)} /></span><b>{p1(r)}</b></div><div className="ds-b"><span className="lbl">Per join</span><span className="shb"><i className="q" style={css(`width:${c.spend / c.v[1] / 2 * 100}%`)} /></span><b>{money(c.spend / c.v[1])}</b></div></div>;
      })}</div> : <div className="bk-empty">No poster campaigns match these filters.</div>;

    /* where the money went: a waterfall with the hatched drops from the Shop page */
    const parts = [['$10 offer', rows.reduce((s, c) => s + c.sp.offer, 0), 'Spent at partner shops'], ['Printing', rows.reduce((s, c) => s + c.sp.print, 0), 'Posters, $2.40 each'], ['Ads', rows.reduce((s, c) => s + c.sp.ads, 0), 'Instagram test'], ['Referral credit', rows.reduce((s, c) => s + c.sp.credit, 0), '$5 per activation']].filter(p => p[1] > 0);
    let run = SP;
    const wmax = SP || 1;
    const wf = <><div className="wf2"><div className="wf2-c"><span className="wf2-v">{money0(SP)}</span><i className="tot" style={css("height:100%")} /><span className="wf2-l">Spent</span></div>{parts.map(([nm, v, s], __k) => {
          const top = run / wmax * 100,
            h = v / wmax * 100;
          run -= v;
          return <div key={__k} className="wf2-c"><span className="wf2-v" style={css(`bottom:calc(${top}% + 6px)`)}>−{money0(v)}</span><i className="drop" style={css(`bottom:${top - h}%;height:${h}%`)} /><span className="wf2-l">{nm}</span><b className="wf2-j" style={css(`bottom:${top - h}%`)} /></div>;
        })}</div><div className="wf2-k">{parts.map(([nm, v, s], __k) => <div key={__k}><span>{nm}</span><span className="quiet">{s}</span><b>{SP ? Math.round(v / SP * 100) : 0}%</b></div>)}</div></>;
    html($g('cp'), <><section className="band" style={css("margin-top:0")}><div className="bento"><div className="cell s12"><div className="hd cp-hd"><h2>What ran when</h2><div className="r"><span className="lbl cp-hint">{perName()}{" · click a campaign for its detail"}</span><button className="btn" style={css("height:32px")} data-newcamp="" data-act=""><span className="nc-l">+ New campaign</span><span className="nc-s">+ New</span></button></div></div>{cal}<div className="bk-ft"><span>{showA > 42 ? <>{"Every poster design was up this whole period. Pick "}<b>Since launch</b>{" to see what each start did to joins."}</> : <>{"Joins jumped the week "}<b>The map</b>{" went up; the Instagram test barely moved them."}</>}</span>{showA > 42 ? <button data-per="all">Since launch →</button> : <span />}</div></div></div></section><section className="band"><div className="bento"><div className="cell s12"><div className="hd"><h2>Every campaign</h2><div className="r"><span className="lbl">Cost bars run $0–$5 · click a row for detail</span></div></div>{table}<div className="bk-ft"><span><b>{T[1] ? Math.round((T[1] - J) / T[1] * 100) : 0}%</b>{" of joins have no tag. Tagging every link you share makes this table more complete."}</span><button data-newcamp="" data-act="">Make a tagged link →</button></div></div></div></section><section className="band"><div className="bento"><div className="cell s7"><div className="hd"><h2>Poster design test</h2><div className="r"><span className="lbl">Same offer, different poster</span></div></div>{design}<div className="bk-ft"><span>{best ? <><b>{best.n}</b>{" converts best on the same $10 offer"}</> : ''}</span><button data-act="" data-go="field" data-gp="posters">Plan swaps in Field →</button></div></div><div className="cell s5"><div className="hd"><h2>Where the money went</h2><div className="r"><span className="lbl">{perName()}</span></div></div>{wf}<div className="bk-ft"><span><b>{money0(OFFER)}</b>{" went straight to partner shops as $10 spends"}</span><span /></div></div></div></section></>);
    renderCampPanel();
  }

  /* detail panel: the campaign's own funnel, spend and tags */
  function renderCampPanel() {
    let p = $g('cpanel'),
      sc = $g('cscrim');
    if (!p) {
      sc = document.createElement('div');
      sc.id = 'cscrim';
      sc.className = 'scrim';
      BODY.appendChild(sc);
      p = document.createElement('aside');
      p.id = 'cpanel';
      p.className = 'panel';
      BODY.appendChild(p);
    }
    if (!CS.open) {
      BODY.classList.remove('pn');
      p.classList.remove('wide');
      return;
    }
    p.classList.toggle('wide', CS.open === 'live');
    if (CS.open === 'live') {
      renderLivePanel(p);
      BODY.classList.add('pn');
      return;
    }
    const money = v => '$' + v.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    if (CS.open === 'new') {
      html(p, <><div className="pn-hd"><span className="lbl">New campaign</span><button className="x" data-cclose="" aria-label="Close"><svg className="i" viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15" /></svg></button></div><div className="pn-b"><h3>Make a tagged link</h3><p className="small quiet" style={css("margin:0")}>Every link you share with these tags shows up here as its own campaign.</p><label className="fld"><span className="lbl">Name</span><input id="nc-n" defaultValue="Fall farmers market" /></label><label className="fld"><span className="lbl">Type</span><select id="nc-t"><option>Social</option><option>Posters</option><option>Ads</option><option>Referrals</option><option>Event</option></select></label><label className="fld"><span className="lbl">Where it'll be shared</span><input id="nc-s" defaultValue="flyer" /></label><div className="fld"><span className="lbl">Link</span><code className="lnkc" id="nc-l" /></div><div className="qr" aria-hidden="true">{Array.from({
              length: 121
            }, (_, i) => <i key={i} style={css(`background:${(i * 37 % 11 + i % 7) % 3 ? 'var(--fg)' : 'transparent'}`)} />)}</div></div><div className="pn-ft"><span className="nx" /><button className="btn" style={css("height:40px")} data-cclose="">Cancel</button><button className="btn p" style={css("height:40px")} data-cclose="">Copy link and QR</button></div></>);
      const upd = () => {
        const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        $g('nc-l').textContent = `useclear.org/join?utm_campaign=${slug($g('nc-n').value)}&utm_medium=${slug($g('nc-t').value)}&utm_source=${slug($g('nc-s').value)}`;
      };
      p.querySelectorAll('input,select').forEach(e => e.addEventListener('input', upd));
      upd();
    } else {
      const c = campScaled().find(x => x.id === CS.open) || CAMPS.find(x => x.id === CS.open);
      const v = c.v || c.f,
        sp = c.sp || {
          print: c.print,
          offer: c.offer,
          ads: c.ads,
          credit: c.credit
        },
        spend = sp.print + sp.offer + sp.ads + sp.credit;
      const fmax = Math.max(v[0], 1),
        hh = x => 4 + 96 * Math.pow(Math.max(x, 1) / fmax, .3);
      html(p, <><div className="pn-hd"><span className="swt" style={css(`width:10px;height:10px;display:inline-block;background:${TYPE_COL[c.type]}`)} /><span className="lbl">{c.type}</span>{c.end ? <span className="chip plain nodot">Ended</span> : <span className="chip ok">Live</span>}<button className="x" data-cclose="" aria-label="Close"><svg className="i" viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15" /></svg></button></div><div className="pn-b"><div><span className="lbl">{c.sub}{" · "}{dFmt(c.start)}{" – "}{c.end ? dFmt(c.end) : 'now'}</span><h3>{c.n}</h3></div><div className="pn-big"><div><span className="lbl">Cost per join</span><b>{v[1] ? spend ? money(spend / v[1]) : 'Free' : '—'}</b></div><div><span className="lbl">Joins</span><b>{fmt(v[1])}</b></div></div><div className="pn-fn">{['Visits', 'Joined', 'Invited', 'Opened', 'Active', 'Spent $10'].map((s, i) => <div key={i}><span className="lbl">{s}</span><i style={css(`width:${hh(v[i])}%;background:${i === 5 ? 'var(--fg)' : TYPE_COL[c.type]};opacity:${i === 5 ? 1 : .35 + .65 * (1 - i / 6)}`)} /><b>{fmt(v[i])}</b></div>)}</div><div className="led">{[['Printing', sp.print], ['$10 offer redeemed', sp.offer], ['Ads', sp.ads], ['Referral credit', sp.credit]].filter(x => x[1] > 0).map(([k, x], __k) => <div key={__k}><span>{k}</span><b>{money(x)}</b></div>)}<div className="t"><span>Spent</span><b>{money(spend)}</b></div></div>{c.posters ? <div className="led"><div><span>Posters up</span><b>{c.posters}</b></div><div><span>Scans per poster</span><b>{fmt(v[0] / c.posters)}</b></div></div> : ''}<div className="led"><div><span>Tags</span><b className="mono">{c.utm}</b></div><div><span>Note</span><b>{c.note}</b></div></div></div><div className="pn-ft"><span className="nx" /><button className="btn" style={css("height:40px")} data-cfilter={c.id}>Filter Growth to this</button><button className="btn p" style={css("height:40px")} data-cclose="" data-act="">{c.end ? 'Run it again' : 'Edit campaign'}</button></div></>);
    }
    BODY.classList.add('pn');
  }

  /* ══ Cohorts: do the people we invite stick? ═════════════════════════════════════════
     A cohort is everyone invited in the same week. Activated = account + a bank, a $5 deposit or direct
     deposit, inside 90 days of the invite. Totals match Overview: 300 invited, 124 activated, 64 opened
     but not funded. The period picks which invite weeks are shown; city and source scale the counts. */
  const COH = L ? L.COH : [
  // invite week start (day index), batches, invited, activated, opened-not-funded, still active %, spent $10 %
  {
    d: 42,
    tau: 7.5,
    n: '15 Sep',
    b: 'Batch 1',
    inv: 25,
    act: 13,
    open: 3,
    keep: 77,
    spent: 92
  }, {
    d: 49,
    tau: 7,
    n: '22 Sep',
    b: 'Batch 2',
    inv: 25,
    act: 13,
    open: 4,
    keep: 81,
    spent: 92
  }, {
    d: 56,
    tau: 6.2,
    n: '29 Sep',
    b: 'Batches 3–4',
    inv: 50,
    act: 26,
    open: 8,
    keep: 85,
    spent: 88
  }, {
    d: 63,
    tau: 5.4,
    n: '6 Oct',
    b: 'Batches 5–7',
    inv: 75,
    act: 38,
    open: 17,
    keep: 89,
    spent: 87
  }, {
    d: 70,
    tau: 4.6,
    n: '13 Oct',
    b: 'Batches 8–10',
    inv: 75,
    act: 31,
    open: 20,
    keep: 94,
    spent: 84
  }, {
    d: 77,
    tau: 4.6,
    n: '20 Oct',
    b: 'Batches 11–12',
    inv: 50,
    act: 3,
    open: 12,
    keep: 100,
    spent: 67
  }];
  const HOW = [['Connected a bank', 71, 89, 'var(--fg)'], ['Added $5', 38, 68, 'var(--land)'], ['Direct deposit', 15, 100, 'var(--live)']];
  const TAU = 6;
  const CHS = {
    metric: 'act',
    hov: null
  };
  const cum = (c, day) => {
    const t = c.tau || TAU,
      el = TODAY - c.d;
    const fin = c.act / c.inv;
    const k = 1 - Math.exp(-el / t);
    return Math.min(1, fin * (1 - Math.exp(-day / t)) / (k || 1));
  };
  function cohRows() {
    const [a, b] = S.range;
    let mult = 1;
    if (S.F.city.size) mult *= share('city')[2] || 0;
    if (S.F.source.size) mult *= share('source')[2] || 0;
    if (S.F.shop.size) mult *= share('shop')[2] || 0;else if (S.F.design.size) mult *= share('design')[2] || 0;
    return COH.filter(c => c.d + 6 >= a && c.d <= b).map(c => ({
      ...c,
      I: c.inv * mult,
      A: c.act * mult,
      O: c.open * mult,
      el: TODAY - c.d
    }));
  }
  function renderCohorts() {
    const rows = cohRows(),
      el = $g('ch');
    const I = rows.reduce((s, c) => s + c.I, 0),
      A = rows.reduce((s, c) => s + c.A, 0),
      O = rows.reduce((s, c) => s + c.O, 0);
    const keep = A ? rows.reduce((s, c) => s + c.A * c.keep, 0) / A : 0;
    if (!rows.length) {
      html($g('hdr'), <><span className="when"><span className="dot" />Growth · Cohorts{L ? '' : ' · Demo data'}</span><p className="brief">{"Nobody was invited in this period. "}<span className="q">Invites started 15 Sep; pick a longer period.</span></p></>);
      html(el, <div className="bento"><div className="cell s12"><div className="bk-empty">{"No invite weeks fall inside "}{perName()}{". "}<button className="clear" data-per="all">Show since launch</button></div></div></div>);
      return;
    }
    html($g('hdr'), <><span className="when"><span className="dot" />Growth · Cohorts{L ? '' : ' · Demo data'}</span><p className="brief">{"Most people who activate do it in the first week, and "}<a data-cjump="how">direct deposit</a>{" members are the ones who stay. "}<span className="q">{rows.length === COH.length ? 'All ' + COH.length + ' invite weeks' : rows.length + ' invite week' + (rows.length > 1 ? 's' : '')}{filterDesc() ? ' · ' + filterDesc() : ''}.</span></p><div className="strip"><div className="sc"><span className="lbl">Invited</span><div className="sc-v">{fmt(I)}</div><div className="mb"><i style={css(`width:${I / 1800 * 100}%`)} /><span className="hroom" style={css(`left:${I / 1800 * 100}%;right:0`)} /></div><div className="sc-s">of 1,800 who joined · rest still waiting</div></div><div className="sc"><span className="lbl">Activated</span><div className="sc-v">{fmt(A)}{" "}<small>{p1(pct(A, I))}</small></div><div className="mb"><i style={css(`width:${pct(A, I)}%`)} /><i style={css(`left:${pct(A, I)}%;width:${pct(O, I)}%;background:var(--land)`)} /></div><div className="sc-s">{fmt(O)}{" more opened but haven't funded"}</div></div><div className="sc"><span className="lbl">Days to activate</span><div className="sc-v">{"6 "}<small>median</small></div><div className="mb"><i style={css(`width:${6 / 90 * 100}%`)} /></div><div className="sc-s">of a 90-day window</div></div><div className="sc"><span className="lbl">Still active</span><div className="sc-v">{Math.round(keep)}%</div><div className="mb"><i style={css(`width:${keep}%;background:var(--settled)`)} /></div><div className="sc-s">used Clear in the last 14 days</div></div></div></>);

    /* cohort grid: rows are invite weeks, columns weeks since invite; cells not reached yet are hatched */
    const M = {
      act: ['Activated', 'share of each week’s invites who had activated'],
      keep: ['Still active', 'share of activated members still using Clear'],
      spent: ['Spent their $10', 'share of activated members who spent the $10 at a shop']
    };
    const W = 6,
      cell = (c, w) => {
        const reached = w * 7 <= c.el,
          partial = !reached && (w - 1) * 7 < c.el;
        if (!reached && !partial) return <div className="cg-na" />;
        let v;
        if (CHS.metric === 'act') v = cum(c, Math.min(w * 7, c.el)) * 100;else {
          const base = CHS.metric === 'keep' ? c.keep : c.spent;
          v = base + (W - w) * (CHS.metric === 'keep' ? 2.2 : -1.5);
          v = Math.max(0, Math.min(100, v));
        }
        const shade = CHS.metric === 'act' ? v / 60 : v / 100;
        return <div className={`cg-v ${partial ? 'part' : ''}`} style={css(`background:color-mix(in srgb,var(--fg) ${Math.round(8 + shade * 80)}%,transparent);color:${shade > .45 ? 'var(--ground)' : 'var(--fg)'}`)} title={`${c.n} · week ${w}${partial ? ' so far' : ''} · ${Math.round(v)}%`}>{Math.round(v)}%{partial ? <small>so far</small> : ''}</div>;
      };
    const grid = <div className="cgw"><div className="cgx" style={css(`grid-template-columns:150px 74px repeat(${W},minmax(56px,1fr)) 150px`)}><div className="h">Invite week</div><div className="h hr">Invited</div>{Array.from({
          length: W
        }, (_, i) => <div key={i} className="h c">{"Week "}{i + 1}</div>)}<div className="h hn">Now</div>{rows.map((c, __k) => <Fragment key={__k}><div className="rn" data-coh={c.n}><b>{c.n}</b><span>{c.b}</span></div><div className="inv num">{fmt(c.I)}</div>{Array.from({
            length: W
          }, (_, i) => cell(c, i + 1))}<div className="now"><span className="cgu">{(() => {
                const t = Math.round(c.I),
                  a = Math.round(c.A),
                  o = Math.round(c.O);
                return <><i style={css(`flex:${a};background:var(--fg)`)} /><i style={css(`flex:${o};background:var(--land)`)} /><i style={css(`flex:${Math.max(0, t - a - o)};background:var(--hair)`)} /></>;
              })()}</span><b>{p1(pct(c.A, c.I))}</b></div></Fragment>)}</div></div>;

    /* time to activate: how many activated how soon after the invite; the first week is the dark part */
    const TT = [['Same day', 31], ['1–3 days', 27], ['4–7 days', 29], ['1–2 weeks', 21], ['2–4 weeks', 12], ['4+ weeks', 4]];
    const ttT = TT.reduce((s, x) => s + x[1], 0),
      ttM = Math.max(...TT.map(x => x[1]));
    let ttC = 0;
    const wk1 = Math.round((TT[0][1] + TT[1][1] + TT[2][1]) / ttT * 100);
    const curves = <div className="tt"><div className="tt-big"><span className="big">{wk1}%</span><span>of activations happen in the first week after the invite</span></div><div className="tt-bars">{TT.map(([n, v], i) => {
          ttC += v;
          const c = Math.round(ttC / ttT * 100);
          return <div key={i} className={`tt-c ${i < 3 ? 'w1' : ''}`}><span className="tt-v">{fmt(v * A / 124)}</span><i style={css(`height:${v / ttM * 100}%`)} /><span className="tt-l">{n}</span><span className="tt-cum">{c}%</span></div>;
        })}<span className="tt-br" style={css("left:0;width:50%")}><b>First week</b></span></div><div className="tt-k"><span><i className="d" />First week</span><span><i />Later</span><span className="tt-ck">Bottom row: share activated by then</span></div></div>;

    /* how they activated, and who stayed */
    const hT = HOW.reduce((s, h) => s + h[1], 0);
    const how = <div className="hw"><div className="hw-bar">{HOW.map((h, __k) => <i key={__k} style={css(`flex:${h[1]};background:${h[3]}`)} />)}</div>{HOW.map((h, __k) => <div key={__k} className="hw-r"><span className="hw-n"><i style={css(`background:${h[3]}`)} /><b>{h[0]}</b><span>{fmt(h[1] * A / 124)}{" · "}{p1(h[1] / hT * 100)}</span></span><span className="hw-k"><span className="lbl">Still active</span><span className="shb"><i style={css(`width:${h[2]}%;background:${h[2] >= 95 ? 'var(--settled)' : h[2] < 75 ? 'var(--underway)' : 'var(--fg)'}`)} /></span><b>{h[2]}%</b></span></div>)}</div>;

    /* the 90-day window: each invite week's window on one axis, today marked, what's left to do */
    const w0 = Math.min(...rows.map(c => c.d)),
      w1 = Math.max(...rows.map(c => c.d)) + 96,
      span = w1 - w0 + 1;
    const WX = d => (d - w0) / span * 100;
    const mo = [];
    for (let d = w0; d <= w1; d++) {
      const dt = dayDate(d);
      if (d === w0 || dt.getDate() === 1) mo.push([d, dt.toLocaleString('en', {
        month: 'short'
      })]);
    }
    const lanes = rows.map((c, __k) => {
      const left = 90 - c.el,
        still = Math.round(c.I - c.A);
      return <div key={__k} className="wn-l"><span className="wn-n"><b>{c.n}</b><span>{fmt(c.I)}{" invited"}</span></span><span className="wn-t"><span className="wn-w" style={css(`left:${WX(c.d)}%;width:${WX(c.d + 90) - WX(c.d)}%`)}><i style={css(`width:${c.el / 90 * 100}%`)} /></span></span><span className="wn-r"><b>{fmt(still)}</b>{" not active · "}{left}{" days left"}</span></div>;
    });
    const windowV = <div className="wn"><div className="wn-hd"><span /><span className="wn-t">{mo.map(([d, m], i) => {
            const nx = mo[i + 1] ? mo[i + 1][0] : w1 + 1;
            return <span key={i} className={`wn-m ${i % 2 ? 'alt' : ''}`} style={css(`left:${WX(d)}%;width:${WX(nx) - WX(d)}%`)}>{m}</span>;
          })}</span><span /></div><div className="wn-body"><span /><span className="wn-t"><i className="wn-now" style={css(`left:${WX(TODAY)}%;border-left-color:var(--live)`)}><b>Today</b></i></span><span /></div>{lanes}</div>;
    html(el, <><section className="band" style={css("margin-top:0")}><div className="bento"><div className="cell s12"><div className="hd"><h2>By invite week</h2><div className="r"><div className="seg sm" role="group" aria-label="Measure">{Object.entries(M).map(([k, [t]], __k) => <button key={__k} data-cmetric={k} aria-pressed={CHS.metric === k}><span className="lg">{t}</span><span className="st">{{
                        act: 'Activated',
                        keep: 'Active',
                        spent: '$10'
                      }[k]}</span></button>)}</div></div></div>{grid}<div className="bk-ft"><span>{M[CHS.metric][0]}{": "}{M[CHS.metric][1]}{" by the end of each week. Outlined = this week so far."}</span><span className="cg-k"><i style={css("background:var(--fg)")} />Active<i style={css("background:var(--land)")} />Opened<i style={css("background:var(--hair)")} />Not yet</span></div></div></div></section><section className="band"><div className="bento"><div className="cell s7"><div className="hd"><h2>How fast they activate</h2><div className="r"><span className="lbl">{fmt(A)}{" activations · time after invite"}</span></div></div>{curves}<div className="bk-ft"><span>After the first week activations slow to a trickle, so that's when to nudge.</span><button data-go="members" data-gp="nudges:opened">Nudge in Members →</button></div></div><div className="cell s5" id="how"><div className="hd"><h2>How they activated</h2><div className="r"><span className="lbl">{fmt(A)}{" activations"}</span></div></div>{how}<div className="bk-ft"><span>{"Every direct deposit member stayed. "}<b>$5</b>{" deposits drift most."}</span><span /></div></div></div></section><section className="band"><div className="bento"><div className="cell s12"><div className="hd"><h2>The 90-day window</h2><div className="r"><span className="lbl">Activation has to happen inside it</span></div></div>{windowV}<div className="bk-ft"><span><b>{fmt(I - A)}</b>{" invited people aren't active yet. The first window closes "}<b>{dFmt(w0 + 90)}</b>.</span><button data-go="members" data-gp="people">See them in Members →</button></div></div></div></section></>);
  }
  R.addEventListener('mouseover', e => {
    if (S.tab !== 'cohorts') return;
    const t = e.target.closest('[data-coh]');
    const k = t ? t.dataset.coh : null;
    if (k === CHS.hov) return;
    CHS.hov = k;
    R.querySelectorAll('.cv-l').forEach(l => {
      l.classList.toggle('on', l.dataset.coh === k);
      l.classList.toggle('dim', !!k && l.dataset.coh !== k);
    });
    R.querySelectorAll('.cv-e').forEach(l => l.classList.toggle('on', l.dataset.coh === k));
  });

  /* ══ Apps: what do members and merchants do once they're in? ═════════════════════════
     The member app (invite-only since 15 Sep) and the merchant app (tablet, partner shops).
     Daily active counts follow activations and shops going live, so they agree with Cohorts and Merchants.
     Events are first-party: Umami custom events plus Clear's own records. No session replay. */
  const APPS = {
    member: {
      n: 'Member app',
      col: 'var(--fg)'
    },
    merchant: {
      n: 'Merchant app',
      col: 'var(--land)'
    }
  };
  const AS = {
    feat: 'member'
  };
  // cumulative activated members by day, and shops live by day (12 transacting by today)
  const actByDay = d => {
    let s = 0;
    COH.forEach(c => {
      if (d >= c.d) s += cum(c, Math.min(d - c.d, TODAY - c.d)) * c.inv;
    });
    return s;
  };
  const shopsByDay = d => d < 44 ? 0 : Math.min(12, Math.round(2 + (d - 44) * 10 / 34));
  const dau = d => {
    const dow = dayDate(d).getDay(),
      w = dow === 0 ? .78 : dow === 6 ? .9 : 1;
    const r = rng(d * 7 + 3)();
    return {
      m: actByDay(d) * (.52 + r * .08) * w,
      s: shopsByDay(d) * (dow === 0 ? .55 : .85 + r * .1)
    };
  };
  const FEAT = L ? L.FEAT : {
    member: [['Check balance', 96, 'Opened the home screen'], ['Pay at a shop', 81, 'Clear Pay QR at a partner'], ['Move money', 54, 'In or out of Clear'], ['Savings and Earn', 22, 'Opened or added to savings'], ['Invite a friend', 18, 'Shared a referral code'], ['Term plans', 9, 'Looked at or picked a plan'], ['Shop', 6, 'Bought merch in the app']],
    merchant: [['Take a payment', 100, 'Charged a member'], ['Check payouts', 75, 'Opened payouts'], ['Scan a $10', 67, 'Redeemed a member’s $10'], ['Manage staff', 33, 'Added or edited staff'], ['Refund', 17, 'Refunded a payment'], ['Order hardware', 8, 'Asked for a counter device']]
  };
  const ONB = L ? L.ONB : [['Opened the invite', 188], ['Created an account', 171], ['Verified ID', 152], ['Funded: bank, $5 or direct deposit', 124], ['First $10 spend', 109]];
  const ERRS = L ? L.ERRS : [{
    t: 'Bank link fails on Samsung Internet',
    app: 'member',
    n: 14,
    sev: 'absent',
    own: 'Dana Ruiz is on it',
    prog: [3, 5]
  }, {
    t: 'QR scan is slow in low light',
    app: 'merchant',
    n: 9,
    sev: 'underway',
    own: 'Fix ships Thursday',
    prog: null
  }, {
    t: 'ID check times out on older phones',
    app: 'member',
    n: 6,
    sev: 'underway',
    own: null,
    prog: null
  }, {
    t: 'Payout email lands in spam',
    app: 'merchant',
    n: 4,
    sev: 'underway',
    own: 'Marcus Lee is on it',
    prog: null
  }, {
    t: 'Balance shows $0 for a second on open',
    app: 'member',
    n: 3,
    sev: 'live',
    own: null,
    prog: null
  }];
  function renderApps() {
    const el = $g('ap');
    let mult = 1;
    if (S.F.city.size) mult *= share('city')[4] || 0;
    if (S.F.source.size) mult *= share('source')[4] || 0;
    const [a, b] = S.range,
      A0 = Math.max(a, 42);
    const days = [];
    for (let d = A0; d <= b; d++) days.push(d);
    const live = days.length > 0;
    const dv = days.map(d => {
      const x = dau(d);
      return {
        d,
        m: x.m * mult,
        s: x.s
      };
    });
    const avg = k => dv.length ? dv.reduce((s, x) => s + x[k], 0) / dv.length : 0;
    const last7 = dv.slice(-7),
      wauM = Math.round(actByDay(b) * .79 * mult),
      dauM = last7.length ? last7.reduce((s, x) => s + x.m, 0) / last7.length : 0;
    const stick = wauM ? dauM / wauM * 100 : 0;
    const shopsLive = shopsByDay(b);
    html($g('hdr'), <><span className="when"><span className="dot" />Growth · Apps{L ? '' : ' · Demo data'}</span><p className="brief">{live ? <>{"About "}{fmt(dauM)}{" members open Clear on a typical day, and most of them "}<a data-ajump="feat">pay at a shop</a>{". The biggest drop in onboarding is "}<a data-ajump="onb">funding the account</a>.</> : 'The apps weren’t live yet in this period.'}{" "}<span className="q">{perName()}{filterDesc() ? ' · ' + filterDesc() : ''}.</span></p><div className="strip"><div className="sc"><span className="lbl">Active members · this week</span><div className="sc-v">{fmt(wauM)}{" "}<small>{"of "}{fmt(actByDay(b) * mult)}</small></div><div className="mb"><i style={css("width:79%")} /></div><div className="sc-s">79% of activated members</div></div><div className="sc"><span className="lbl">Daily, on average</span><div className="sc-v">{fmt(dauM)}{" "}<small>{Math.round(stick)}%</small></div><div className="mb"><i style={css(`width:${stick}%`)} /></div><div className="sc-s">of weekly actives, each day</div></div><div className="sc"><span className="lbl">Shops on the merchant app</span><div className="sc-v">{shopsLive}{" "}<small>of 30</small></div><div className="mb"><i style={css(`width:${shopsLive / 30 * 100}%;background:var(--land)`)} /><i style={css(`left:${shopsLive / 30 * 100}%;width:20%`)} className="hatch" /></div><div className="sc-s">6 signing · 19 staff logins</div></div><div className="sc"><span className="lbl">Crash-free sessions</span><div className="sc-v">99.4%</div><div className="mb"><i style={css("width:99.4%;background:var(--settled)")} /></div><div className="sc-s">{ERRS.length}{" open issues · "}{ERRS.filter(e => !e.own).length}{" with no owner"}</div></div></div></>);
    if (!live) {
      html(el, <div className="bento"><div className="cell s12"><div className="bk-empty">{"The member app opened to the first batch on 15 Sep. "}<button className="clear" data-per="all">Show since launch</button></div></div></div>);
      return;
    }

    /* daily active: members and shops side by side; weekly view averages the days */
    const n = days.length,
      gran = S.gran === 'auto' ? n <= 21 ? 'day' : 'week' : S.gran;
    const bk = [];
    if (gran === 'day') dv.forEach(x => bk.push([x.d, x.d, [x]]));else for (let e = dv.length - 1; e >= 0; e -= 7) {
      const g = dv.slice(Math.max(0, e - 6), e + 1);
      bk.unshift([g[0].d, g[g.length - 1].d, g]);
    }
    const bm = bk.map(([x, y, g]) => ({
      x,
      y,
      m: g.reduce((s, v) => s + v.m, 0) / g.length,
      s: g.reduce((s, v) => s + v.s, 0) / g.length
    }));
    const raw = Math.max(5, ...bm.map(v => v.m)),
      mag = Math.pow(10, Math.floor(Math.log10(raw))),
      step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(s => raw / s <= 4) || mag * 10,
      ymax = Math.ceil(raw * 1.12 / step) * step;
    const ticks = [];
    for (let v = 0; v <= ymax + 1e-9; v += step) ticks.push(v);
    const every = bm.length <= 12 ? 1 : Math.ceil(bm.length / 8);
    const chart = <div className="tfc"><div className="bc-y">{ticks.map((v, __k) => <span key={__k} style={css(`bottom:${v / ymax * 100}%`)}>{fmt(v)}</span>)}</div><div className="bc-p">{ticks.map((v, __k) => <i key={__k} className="bc-g" style={css(`bottom:${v / ymax * 100}%`)} />)}<div className={`bc-cols ${bm.length > 16 ? 'dense' : ''}`}>{bm.map((v, i) => <div key={i} className="bc-c ap-c" title={`${gran === 'day' ? dFmt(v.y) : 'Week of ' + dFmt(v.x)} · ${fmt(v.m)} members · ${fmt(v.s)} shops a day`}><div className="ap-pair"><i style={css(`height:${v.m / ymax * 100}%;background:var(--fg)`)} /><i style={css(`height:${v.s / ymax * 100}%;background:var(--land)`)} /></div><span className={`bc-x ${i % 2 ? 'odd' : ''}`}>{i % every === 0 || i === bm.length - 1 ? gran === 'day' ? dFmt(v.y) : dFmt(v.x) : ''}</span></div>)}</div></div></div>;

    /* features: share of active users who used each, for the chosen app */
    const F = FEAT[AS.feat],
      fcol = APPS[AS.feat].col;
    const feats = <div className="ft2">{F.map(([nm, p, s], __k) => <div key={__k} className="ft2-r"><span className="ft2-n"><b>{nm}</b><span>{s}</span></span><span className="shb"><i style={css(`width:${p}%;background:${fcol}`)} /></span><b className="ft2-p">{p}%</b></div>)}</div>;

    /* onboarding: each step's count, and what fell off between steps */
    const om = ONB[0][1];
    let worst = 0,
      wi = 0;
    ONB.forEach((s, i) => {
      if (i && ONB[i - 1][1] - s[1] > worst) {
        worst = ONB[i - 1][1] - s[1];
        wi = i;
      }
    });
    const onb = <div className="ob">{ONB.map(([nm, v], i) => {
        const vv = v * mult,
          drop = i ? (ONB[i - 1][1] - v) * mult : 0;
        return <Fragment key={i}>{i ? <div className={`ob-d ${i === wi ? 'hot' : ''}`}><span>−{fmt(drop)}</span>{i === wi ? <em>Biggest drop</em> : ''}</div> : ''}<div className="ob-r"><span className="ob-n">{nm}</span><span className="ob-b"><i style={css(`width:${v / om * 100}%;${i === ONB.length - 1 ? 'background:var(--fg)' : ''}`)} /></span><b>{fmt(vv)}</b><span className="ob-p">{p1(v / om * 100)}</span></div></Fragment>;
      })}</div>;

    /* issues: Home's list rule */
    const errs = ERRS.length ? <div className="isl"><div className="al">{ERRS.map((e, __k) => <div key={__k} className="alr"><div className="al-m"><div className="al-t"><i className="sv" style={css(`background:var(--${e.sev})`)} /><b>{e.t}</b><span className="age">{e.n}{" sessions"}</span></div><span className="m">{APPS[e.app].n}</span></div><div className={`own ${e.own ? '' : 'none'}`}><span className="who">{e.own || 'Nobody’s on it'}</span>{e.prog ? <span className="pg"><i><b style={css(`width:${e.prog[0] / e.prog[1] * 100}%`)} /></i>{e.prog[0]}/{e.prog[1]}</span> : e.own ? '' : <button className="lnk" data-act="">Assign →</button>}</div></div>)}</div></div> : <div className="bk-empty">No open issues.</div>;
    html(el, <><section className="band" style={css("margin-top:0")}><div className="bento"><div className="cell s8"><div className="hd"><h2>Active each day</h2><div className="r"><span className="lbl">{gran === 'week' ? 'Daily average, by week' : 'By day'}</span><div className="seg sm" role="group" aria-label="Granularity">{[['auto', 'Auto'], ['day', 'Daily'], ['week', 'Weekly']].map(([k, t], __k) => <button key={__k} data-gran={k} aria-pressed={S.gran === k}>{t}</button>)}</div></div></div>{chart}<div className="tr-k"><span><i style={css("background:var(--fg);width:10px;height:10px")} />Members on the member app</span><span><i style={css("background:var(--land);width:10px;height:10px")} />Shops on the merchant app</span></div><button className="foot" data-tab="cohorts"><span>Grows with every batch that activates</span><span>Cohorts →</span></button></div><div className="cell s4" id="onb"><div className="hd"><h2>Onboarding</h2><div className="r"><span className="lbl">Member app · all invites</span></div></div>{onb}<button className="foot" data-go="members" data-gp="nudges:opened"><span>{fmt(64 * mult)}{" stuck at funding"}</span><span>Nudge in Members →</span></button></div></div></section><section className="band"><div className="bento"><div className="cell s7" id="feat"><div className="hd"><h2>What they use</h2><div className="r"><div className="seg sm" role="group" aria-label="App">{Object.entries(APPS).map(([k, v], __k) => <button key={__k} data-afeat={k} aria-pressed={AS.feat === k}>{v.n}</button>)}</div></div></div>{feats}<div className="bk-ft"><span>{"Share of this week’s active "}{AS.feat === 'member' ? 'members' : 'shops'}{" who used each"}</span><span /></div></div><div className="cell s5"><div className="hd"><h2>Issues</h2><div className="r"><span className="lbl">{ERRS.length}{" open · "}{ERRS.filter(e => !e.own).length}{" with no owner"}</span></div></div>{errs}<button className="foot" data-go="records" data-gp="log"><span>Error log</span><span>→</span></button></div></div></section><div className="src-note"><span><b>Source:</b>{" first-party events from both apps (Umami custom events) and Clear’s own records. No session recording, nothing sold or shared."}</span>{L ? null : <button className="btn" style={css("height:32px")} data-act="">Add a data source</button>}</div></>);
  }

  /* ── Time: every period is a day range on one daily series, so any range adds up ──
     Day 0 is Tue 4 Aug (posters went up the following week); day 78 is today, Wed 21 Oct. */
  const TODAY = L ? L.TODAY : 78,
    D0 = L ? L.D0 : [2026, 7, 4];
  const dayDate = i => new Date(D0[0], D0[1], D0[2] + i);
  const dFmt = (i, y) => {
    const d = dayDate(i);
    return `${d.getDate()} ${d.toLocaleString('en', {
      month: 'short'
    })}`;
  };
  const W_VIS = L ? L.W_VIS : [4200, 4360, 4720, 5180, 5620, 6110, 6640, 7130, 7620, 8010, 8239, 8906];
  const W_JOIN = L ? L.W_JOIN : [20, 28, 40, 30, 75, 95, 130, 204, 270, 290, 300, 318],
    W_INV = L ? L.W_INV : [0, 0, 0, 0, 0, 0, 25, 25, 50, 75, 75, 50],
    W_ACT = L ? L.W_ACT : [0, 0, 0, 0, 0, 0, 9, 16, 24, 33, 35, 27];
  const W_OPEN = L ? L.W_OPEN : W_INV.map(v => Math.round(v * .627)),
    W_SPEND = L ? L.W_SPEND : W_ACT.map(v => Math.round(v * .88));
  // spread each week over its 7 days, counted back from today; weekdays a little busier than weekends, Sundays busiest for visits
  const DAILY = [W_VIS, W_JOIN, W_INV, W_OPEN, W_ACT, W_SPEND].map((W, si) => {
    const out = new Array(TODAY + 1).fill(0);
    for (let d = 0; d <= TODAY; d++) {
      const wk = 11 - Math.floor((TODAY - d) / 7);
      if (wk < 0) continue;
      const dow = dayDate(d).getDay();
      const wgt = si === 2 ? dow === 2 ? 1 : 0 : dow === 0 ? 1.25 : dow === 6 ? 1.1 : .93;
      out[d] = W[wk] * (si === 2 ? wgt : wgt / 7);
    }
    return out;
  });
  const sumR = (si, a, b) => {
    let s = 0;
    for (let d = Math.max(a, 0); d <= Math.min(b, TODAY); d++) s += DAILY[si][d];
    return s;
  };
  const BASE = [0, 1, 2, 3, 4, 5].map(si => sumR(si, TODAY - 29, TODAY)); // the 30-day rows in D are this window
  const PRESETS = [['today', 'Today', [TODAY, TODAY]], ['7d', '7 days', [TODAY - 6, TODAY]], ['30d', '30 days', [TODAY - 29, TODAY]], ['90d', '90 days', [TODAY - 89, TODAY]], ['all', 'Since launch', [0, TODAY]]];
  const MORE = [
  // the custom picker's quick picks; the last two are anchored to real events
  ...(L ? (() => {
    // live, the weeks start on Monday and the month on the 1st, counted back from today
    const now = new Date(), mon = (now.getDay() + 6) % 7, dom = now.getDate() - 1;
    return [['Yesterday', [TODAY - 1, TODAY - 1]], ['This week', [TODAY - mon, TODAY]], ['Last week', [TODAY - mon - 7, TODAY - mon - 1]], ['This month', [Math.max(0, TODAY - dom), TODAY]]];
  })() : [['Yesterday', [TODAY - 1, TODAY - 1]], ['This week', [TODAY - 2, TODAY]], ['Last week', [TODAY - 9, TODAY - 3]], ['This month', [TODAY - 20, TODAY]], ['September', [28, 57]], ['Since posters went up · 18 Aug', [14, TODAY]], ['Since invites started · 15 Sep', [42, TODAY]]])];
  const S = {
    tab: 'overview',
    per: '30d',
    range: [TODAY - 29, TODAY],
    cmp: true,
    gran: 'auto',
    step: 0,
    dim: 'source',
    view: 'list',
    sort: 'in',
    dir: -1,
    F: {
      city: new Set(),
      source: new Set(),
      shop: new Set(),
      design: new Set()
    },
    open: null,
    sheet: null,
    pick: null,
    cal: 1,
    pace: 50
  };
  const span = () => S.range[1] - S.range[0] + 1;
  const factor = (a, b) => [0, 1, 2, 3, 4, 5].map(si => BASE[si] ? sumR(si, a, b) / BASE[si] : 0);
  const prevRange = () => {
    const n = span(),
      a = S.range[0] - n,
      b = S.range[0] - 1;
    return b < 0 ? null : [Math.max(a, 0), b];
  };
  const perName = () => {
    const p = PRESETS.find(p => p[0] === S.per);
    if (p) return p[1];
    const m = MORE.find(m => m[1][0] === S.range[0] && m[1][1] === S.range[1]);
    if (m) return m[0].split(' · ')[0];
    return S.range[0] === S.range[1] ? dFmt(S.range[0]) : `${dFmt(S.range[0])} – ${dFmt(S.range[1])}`;
  };
  const cmpOn = () => S.cmp && !!prevRange();
  const cmpName = () => {
    const n = span();
    return n === 1 ? 'the day before' : `the ${n} days before`;
  };
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const pct = (a, b) => b ? a / b * 100 : 0;
  const p1 = v => v.toFixed(1) + '%';
  function rng(seed) {
    let s = seed;
    return () => (s = s * 16807 % 2147483647, (s - 1) / 2147483646);
  }
  const hash = t => [...t].reduce((a, c) => a * 31 + c.charCodeAt(0) >>> 0, 7);
  const STEP_SHORT = ['Visit → join', 'Join → invite', 'Invite → open', 'Open → active', 'Active → spend'];

  /* rows for a dimension, scaled to the range and to every other dimension's filter */
  const ALL = () => D.source.rows.reduce((a, r) => a.map((v, i) => v + r.f[i]), [0, 0, 0, 0, 0, 0]);
  function share(dimKey) {
    const all = ALL(),
      sel = S.F[dimKey];
    const pick = D[dimKey].rows.filter(r => sel.has(r.n)).reduce((a, r) => a.map((v, i) => v + (r.f[i] || 0)), [0, 0, 0, 0, 0, 0]);
    return all.map((v, i) => v ? pick[i] / v : 0);
  }
  function rowsFor(dimKey, rng2) {
    const P = factor(...(rng2 || S.range));
    let mult = [1, 1, 1, 1, 1, 1];
    Object.keys(S.F).forEach(k => {
      if (k !== dimKey && S.F[k].size) {
        const sh = share(k);
        mult = mult.map((m, i) => m * sh[i]);
      }
    });
    if (D[dimKey].posters && S.F.source.size && !S.F.source.has('Posters')) return [];
    if (D[dimKey].posters && S.F.source.size) {
      const sh = share('source');
      mult = mult.map((m, i) => m / (sh[i] || 1));
    }
    let rows = D[dimKey].rows;
    if (S.F[dimKey].size) rows = rows.filter(r => S.F[dimKey].has(r.n));
    return rows.map(r => ({
      ...r,
      v: r.f.map((x, i) => Math.round(x * P[i] * mult[i]))
    }));
  }
  const baseDim = () => S.F.shop.size ? 'shop' : S.F.design.size ? 'design' : 'source';
  const totals = rng2 => rowsFor(baseDim(), rng2).reduce((a, r) => a.map((v, i) => v + r.v[i]), [0, 0, 0, 0, 0, 0]);
  const filterDesc = () => {
    const p = [];
    Object.entries(S.F).forEach(([k, set]) => {
      if (set.size) p.push(set.size === 1 ? [...set][0] : `${set.size} ${k === 'city' ? 'cities' : D[k].name.toLowerCase() + 's'}`);
    });
    return p.join(' · ');
  };
  const nFilters = () => Object.values(S.F).reduce((a, s) => a + s.size, 0);
  const rates = T => STEP.map((_, k) => pct(T[k + 1], T[k]));
  const weakest = T => {
    const r = rates(T);
    let w = -1;
    r.forEach((v, k) => {
      if (T[k + 1] > 0 && T[k] >= 10 && (w < 0 || v < r[w])) w = k;
    });
    return w < 0 ? 0 : w;
  };

  /* ── header ── */
  function renderHdr(T) {
    const r = rates(T),
      weak = weakest(T),
      fd = filterDesc();
    const ratio = (W_JOIN[11] / W_INV[11]).toFixed(1);
    const posterRow = rowsFor('source').find(x => x.n === 'Posters'),
      pj = posterRow ? posterRow.v[1] : 0;
    // live, a week with no invites can't make a ratio: it says what happened instead
    const lead = !L || W_INV[11] ? <>{ratio}{" people join for every one we invite, and "}</> : <>{fmt(W_JOIN[11])}{W_JOIN[11] === 1 ? ' person' : ' people'}{" joined this week and nobody was invited; "}</>;
    const wl = L ? L.WL : { waiting: 1500, joined: 1800, medianDays: 16 },
      wlInv = wl.joined - wl.waiting,
      wlPct = wl.joined ? wlInv / wl.joined * 100 : 0;
    const sent = <><>{lead}<a data-step={weak}>{STEP_LONG[weak]}</a>{" is the weakest step at "}{p1(r[weak])}{". "}</>{fd || S.per !== '30d' ? <span className="q">{"Showing "}{fd ? fd + ', ' : ''}{perName().toLowerCase() === 'today' ? 'today' : perName()}.</span> : <span className="q">{"Posters bring "}{Math.round(pct(pj, T[1]))}% of joins.</span>}</>;
    html($g('hdr'), <><span className="when"><span className="dot" />Growth · {L ? 'Live' : 'Soft launch · day 78 · Demo data'}</span><p className="brief">{sent}</p><div className="strip"><div className="sc"><span className="lbl">{"Joined · "}{perName()}</span><div className="sc-v">{fmt(T[1])}</div><div className="mb"><i style={css(`width:${pct(pj, T[1])}%`)} /></div><div className="sc-s">{Math.round(pct(pj, T[1]))}% from posters</div></div><div className="sc"><span className="lbl">Waitlist · now</span><div className="sc-v">{fmt(wl.waiting)}</div><div className="mb"><i style={css(`width:${+wlPct.toFixed(1)}%`)} /><span className="hroom" style={css(`left:${+wlPct.toFixed(1)}%;right:0`)} /></div><div className="sc-s">{fmt(wlInv)}{" of "}{fmt(wl.joined)}{" invited · "}{wl.medianDays == null ? 'no one invited yet' : `${wl.medianDays}-day wait`}</div></div><div className="sc"><span className="lbl">{"Activated · "}{perName()}</span><div className="sc-v">{fmt(T[4])}{" "}<small>{p1(pct(T[4], T[2]))}</small></div><div className="mb"><i style={css(`width:${Math.min(100, pct(T[4], T[2]))}%`)} /><i style={css(`left:${Math.min(100, pct(T[4], T[2]))}%;width:${Math.max(0, Math.min(100 - pct(T[4], T[2]), pct(T[3] - T[4], T[2])))}%;background:var(--land)`)} /></div><div className="sc-s">{"of invited · "}{fmt(Math.max(0, T[3] - T[4]))}{" opened, not funded"}</div></div><div className="sc"><span className="lbl">First $10 spends</span><div className="sc-v">{fmt(T[5])}</div><div className="mb"><i style={css(`width:${Math.min(100, pct(T[5], T[4]))}%`)} /></div><div className="sc-s">{p1(pct(T[5], T[4]))}{" of active · $"}{fmt(T[5] * 10)}{" to shops"}</div></div></div></>);
  }

  /* ── control bar: desktop shows everything; phones get two buttons that open sheets ── */
  const caret = <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 4.5l3 3 3-3" /></svg>;
  const calIc = <svg className="i" viewBox="0 0 20 20" style={css("width:15px;height:15px")}><path d="M3 5h14v12H3z" /><path d="M3 9h14M7 3v4M13 3v4" /></svg>;
  const filIc = <svg className="i" viewBox="0 0 20 20" style={css("width:15px;height:15px")}><path d="M3 5h14M6 10h8M8.5 15h3" /></svg>;
  const linkIc = <svg className="i" viewBox="0 0 20 20" style={css("width:15px;height:15px")}><path d="M8 12l4-4" /><path d="M9 5l1.5-1.5a3.5 3.5 0 0 1 5 5L14 10M11 15l-1.5 1.5a3.5 3.5 0 0 1-5-5L6 10" /></svg>;
  function fChecks(k) {
    const set = S.F[k];
    return D[k].rows.map((r, __k) => <label key={__k}><input type="checkbox" data-fv={k} defaultValue={r.n} {...attrs(set.has(r.n) ? 'checked' : '')} /><span>{r.n}</span><span className="n">{fmt(r.f[0])}</span></label>);
  }
  function renderCtl() {
    const fl = k => {
      const set = S.F[k],
        n = D[k].name;
      const label = set.size === 0 ? n : set.size === 1 ? <>{n}{": "}<b>{[...set][0]}</b></> : <>{n}{": "}<b>{set.size}</b></>;
      const menu = S.open === k ? <div className="menu" data-menu={k}>{fChecks(k)}<div className="mf"><button data-fclear={k}>Clear</button><button data-fclose="">Done</button></div></div> : '';
      return <div className="fl cw"><button className={set.size ? 'on' : ''} data-fopen={k}>{label}{caret}</button>{menu}</div>;
    };
    const custom = !PRESETS.some(p => p[0] === S.per);
    const n = nFilters();
    html($g('ctl'), <><div className="seg cw" role="group" aria-label="Period">{PRESETS.map(([k, v], __k) => <button key={__k} data-per={k} aria-pressed={S.per === k} {...attrs(k === '90d' ? 'title="Same as since launch until 2 Nov"' : '')}>{v}</button>)}<button data-custom="" aria-pressed={custom} className="cbtn">{calIc}{custom ? perName() : 'Custom'}</button></div><button className="mbtn cc" data-sheet="period">{calIc}<b>{perName()}</b>{caret}</button><button className="tog" data-cmp="" aria-pressed={cmpOn()} {...attrs(prevRange() ? '' : 'disabled')} title={prevRange() ? 'Compare to ' + cmpName() : 'Nothing to compare before launch'}><i /><span className="d-only">Compare</span><span className="m-only">vs before</span></button><span className="vsep cw" />{['city', 'source', 'shop', 'design'].map(fl)}<button className={`mbtn cc ${n ? 'on' : ''}`} data-sheet="filters">{filIc}Filters{n ? <b>{n}</b> : ''}</button><div className="rt">{n ? <button className="clear" data-fclearall="">Clear<span className="cw">{" filters"}</span></button> : ''}</div>{S.open === 'custom' ? calPop() : ''}</>);
  }

  /* the custom range picker: quick picks on the left, two months on the right */
  function monthGrid(y, m) {
    const first = new Date(y, m, 1),
      days = new Date(y, m + 1, 0).getDate(),
      lead = (first.getDay() + 6) % 7;
    const idx = d => Math.round((new Date(y, m, d) - dayDate(0)) / 864e5);
    const [a, b] = S.pick ? S.pick.length === 1 ? [S.pick[0], S.pick[0]] : S.pick : S.range;
    const cells = [];
    for (let d = 1; d <= days; d++) {
      const i = idx(d),
        off = i < 0 || i > TODAY;
      cells.push(<button key={d} {...attrs(off ? 'disabled' : '')} data-day={i} className={`${i >= a && i <= b ? 'in' : ''} ${i === a ? 's' : ''} ${i === b ? 'e' : ''} ${i === TODAY ? 't' : ''}`}>{d}</button>);
    }
    return <div className="cm" key={`${y}-${m}`}><div className="cm-h">{first.toLocaleString('en', { month: 'long' })}</div><div className="cm-g">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x, __k) => <span key={`w${__k}`} className="w">{x}</span>)}{Array.from({ length: lead }, (_, k) => <span key={`l${k}`} />)}{cells}</div></div>;
  }
  function calPop() {
    const months = [[2026, 7], [2026, 8], [2026, 9]],
      view = months.slice(S.cal, S.cal + 2);
    const lab = S.pick ? S.pick.length === 1 ? `${dFmt(S.pick[0])} – pick an end day` : `${dFmt(S.pick[0])} – ${dFmt(S.pick[1])}` : `${dFmt(S.range[0])} – ${dFmt(S.range[1])}`;
    return <div className={`cal ${S.sheet ? 'as-sheet' : ''}`} data-menu="custom"><div className="cal-q">{MORE.map(([t, r], __k) => <button key={__k} data-quick={r.join(',')} className={r[0] === S.range[0] && r[1] === S.range[1] ? 'on' : ''}>{t.includes(' · ') ? <>{t.split(' · ')[0]}<span> · {t.split(' · ').slice(1).join(' · ')}</span></> : t}</button>)}</div><div className="cal-m"><div className="cal-nav"><button data-calnav="-1" {...attrs(S.cal === 0 ? 'disabled' : '')} aria-label="Earlier">‹</button><span>{lab}</span><button data-calnav="1" {...attrs(S.cal === 1 ? 'disabled' : '')} aria-label="Later">›</button></div><div className="cal-2">{view.map(([y, m]) => monthGrid(y, m))}</div><div className="mf"><button data-calcancel="">Cancel</button><button className="btn p" style={css("height:32px")} data-calapply="" {...attrs(S.pick && S.pick.length === 1 ? 'disabled' : '')}>Apply</button></div></div></div>;
  }

  /* phone sheets */
  function renderSheet() {
    let el = $g('sheet');
    if (!S.sheet) {
      if (el) el.remove();
      BODY.classList.remove('sh');
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'sheet';
      BODY.appendChild(el);
    }
    BODY.classList.add('sh');
    const body = S.sheet === 'period' ? <><div className="sh-sec"><span className="lbl">Period</span><div className="sh-chips">{PRESETS.map(([k, v], __k) => <button key={__k} data-per={k} aria-pressed={S.per === k}>{v}</button>)}</div></div><div className="sh-sec"><span className="lbl">Quick picks</span><div className="sh-list">{MORE.map(([t, r], __k) => <button key={__k} data-quick={r.join(',')} className={r[0] === S.range[0] && r[1] === S.range[1] ? 'on' : ''}>{t}</button>)}</div></div><div className="sh-sec"><span className="lbl">Or pick days</span><div className="cal-2 one">{monthGrid(2026, S.cal === 0 ? 8 : 9)}</div><div className="cal-nav sm"><button data-calnav="-1" {...attrs(S.cal === 0 ? 'disabled' : '')}>‹ September</button><button data-calnav="1" {...attrs(S.cal === 1 ? 'disabled' : '')}>October ›</button></div></div></> : ['city', 'source', 'shop', 'design'].map((k, __k) => <div key={__k} className="sh-sec"><div className="sh-h"><span className="lbl">{D[k].name}</span>{S.F[k].size ? <button data-fclear={k}>Clear</button> : ''}</div><div className="menu flat">{fChecks(k)}</div></div>);
    const T = totals();
    html(el, <><div className="sh-scrim" data-sheetclose="" /><div className="sh-panel" role="dialog" aria-label={S.sheet === 'period' ? 'Period' : 'Filters'}><div className="sh-top"><b>{S.sheet === 'period' ? 'Period' : 'Filters'}</b><button data-sheetclose="" aria-label="Close">✕</button></div><div className="sh-body">{body}</div><div className="sh-ft">{S.sheet === 'filters' && nFilters() ? <button className="clear" data-fclearall="">Clear all</button> : <span />}<button className="btn p" data-sheetclose="" {...attrs(S.pick && S.pick.length === 1 ? 'disabled' : '')}>{S.sheet === 'period' ? S.pick ? 'Apply ' + (S.pick.length === 2 ? dFmt(S.pick[0]) + ' – ' + dFmt(S.pick[1]) : '') : 'Done' : `Show ${fmt(T[0])} visits`}</button></div></div></>);
  }

  /* ── funnel: horizontal on wide screens, a vertical ladder on phones ── */
  function renderFunnel(T) {
    const pr = prevRange(),
      P = pr ? totals(pr) : null,
      on = cmpOn();
    const dlt = i => {
      if (!on || !P[i]) return <span className="dl">{" "}</span>;
      const d = pct(T[i] - P[i], P[i]);
      return <span className={`dl ${d >= 0 ? 'up' : 'dn'}`}>{d >= 0 ? '+' : ''}{d.toFixed(1)}%</span>;
    };
    const r = rates(T),
      weak = weakest(T);
    const w = 1000 / 6,
      mid = 60,
      hh = v => 6 + 104 * Math.pow(Math.max(v, 1) / Math.max(T[0], 1), .25);
    let top = '',
      bot = '';
    T.forEach((v, i) => {
      const h = hh(v),
        x1 = i * w + (i < 5 ? w * .62 : w),
        t = mid - h / 2,
        b = mid + h / 2;
      top += `${i ? '' : 'M0 ' + t}L${x1} ${t}`;
      if (i < 5) {
        const h2 = hh(T[i + 1]);
        top += `C${x1 + w * .2} ${t} ${(i + 1) * w - w * .16} ${mid - h2 / 2} ${(i + 1) * w} ${mid - h2 / 2}`;
      }
      let seg = `L${x1} ${b}`;
      if (i < 5) {
        const h2 = hh(T[i + 1]);
        seg = `L${(i + 1) * w} ${mid + h2 / 2}C${(i + 1) * w - w * .16} ${mid + h2 / 2} ${x1 + w * .2} ${b} ${x1} ${b}`;
      }
      bot = seg + bot;
    });
    const path = `${top}L1000 ${mid + hh(T[5]) / 2}${bot.replace(/^L1000 [\d.]+/, '')}L0 ${mid + hh(T[0]) / 2}Z`;
    const k = S.step,
      sx = k * w + w * .5,
      ex = (k + 1) * w + w * .5;
    const vw = v => 8 + 92 * Math.pow(Math.max(v, 1) / Math.max(T[0], 1), .25);
    html($g('funnel'), <><div className="hd"><h2>Funnel</h2><div className="r"><span className="lbl">{perName()}{filterDesc() ? ' · ' + filterDesc() : ''}<span className="d-only">{on ? ' · change vs ' + cmpName() : ''}</span></span></div></div><div className="fh d-only"><div className="fh-cols">{T.map((v, i) => <div key={i} className="fh-c"><span className="lbl">{STG[i]}</span><span className="v">{fmt(v)}</span>{dlt(i)}</div>)}</div><svg viewBox="0 0 1000 120" preserveAspectRatio="none"><defs><clipPath id="fc"><path d={path} /></clipPath></defs><path className="body" d={path} /><rect className="sel" clipPath="url(#fc)" x={sx} y="0" width={ex - sx} height="120" /><rect className="last" clipPath="url(#fc)" x={5 * w} y="0" width={w} height="120" /></svg><div className="steps">{STEP_SHORT.map((s, i) => <div key={i} className="st" style={css(`grid-column:${2 * i + 2} / span 2`)}><button data-step={i} aria-pressed={S.step === i} className={i === weak ? 'weak' : ''} title={`${s} · ${p1(r[i])}`}><span className="sl">{s}</span><span className="sa">→</span><b>{p1(r[i])}</b></button></div>)}</div></div><div className="fv m-only">{T.map((v, i) => <Fragment key={i}><div className="fv-r"><span className="lbl">{STG[i]}</span><span className="fv-b"><i className={`${i === 5 ? 'k' : ''} ${i === S.step || i === S.step + 1 ? 'sel' : ''}`} style={css(`width:${vw(v)}%`)} /></span><span className="v">{fmt(v)}</span>{dlt(i)}</div>{i < 5 ? <button className={`fv-s ${i === weak ? 'weak' : ''}`} data-step={i} aria-pressed={S.step === i}><span>{"↓ "}{STEP_SHORT[i]}</span><b>{p1(r[i])}</b></button> : ''}</Fragment>)}</div><div className="fh-note"><span>{S.step === weak ? <b>Weakest step.</b> : <b>{STEP[S.step]}.</b>}{" "}{fmt(T[S.step] - T[S.step + 1])}{" of "}{fmt(T[S.step])}{" "}{STG[S.step].toLowerCase()}{" didn't reach "}{STG[S.step + 1].toLowerCase()}.</span></div></>);
  }

  /* ── breakdown ── */
  function spark(seed, up) {
    const r = rng(seed);
    let v = 10,
      pts = [];
    for (let i = 0; i < 14; i++) {
      v += (r() - .45 + (up ? .12 : 0)) * 3;
      pts.push(v);
    }
    const mn = Math.min(...pts),
      mx = Math.max(...pts);
    return <svg className="sp" viewBox="0 0 84 22" preserveAspectRatio="none"><path d={pts.map((p, i) => `${i ? 'L' : 'M'}${(i / 13 * 84).toFixed(1)} ${(20 - (p - mn) / (mx - mn || 1) * 18).toFixed(1)}`).join('')} /></svg>;
  }
  function dimOk(k) {
    const d = D[k];
    if (d.onlyStep !== undefined && S.step !== d.onlyStep) return false;
    if (d.minStep !== undefined && S.step < d.minStep) return false;
    return true;
  }
  function renderBk() {
    if (!dimOk(S.dim)) S.dim = 'source';
    const k = S.step,
      el = $g('bk');
    const dims = Object.keys(D).map((key, __k) => <button key={__k} data-dim={key} aria-pressed={S.dim === key} {...attrs(dimOk(key) ? '' : 'disabled title="Not available for this step"')}>{D[key].name}</button>);
    const views = S.dim === 'week' ? '' : <div className="vw" role="group" aria-label="View"><button data-view="list" aria-pressed={S.view === 'list'} title="List"><svg className="i" viewBox="0 0 20 20" style={css("width:15px;height:15px")}><path d="M3 5h14M3 10h14M3 15h14" /></svg></button><button data-view="chart" aria-pressed={S.view === 'chart'} title="Rate against volume"><svg className="i" viewBox="0 0 20 20" style={css("width:15px;height:15px")}><path d="M3 3v14h14" /><rect x="6" y="10" width="2.5" height="2.5" /><rect x="10" y="6" width="2.5" height="2.5" /><rect x="13" y="11" width="2.5" height="2.5" /></svg></button></div>;
    const note = D[S.dim].posters ? ' · posters only' : '';
    let body = '',
      foot = '';
    if (S.dim === 'week') {
      const cols = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'];
      body = <div className="hm-wrap"><div className="hm" style={css("grid-template-columns:96px 60px repeat(5,minmax(52px,1fr))")}><div className="h" /><div className="h">People</div>{cols.map((c, __k) => <div key={__k} className="h">{c}</div>)}{COH.map(c => [c.n, c.inv, Array.from({
            length: 5
          }, (_, i) => (i + 1) * 7 <= c.el || i * 7 < c.el ? Math.round(cum({
            ...c,
            el: undefined,
            ...c
          }, Math.min((i + 1) * 7, TODAY - c.d)) * 100) : undefined).filter(x => x !== undefined)]).map(([w, n, v], __k) => <Fragment key={__k}><div className="r">{w}</div><div>{n}</div>{cols.map((_, i) => v[i] !== undefined ? <div key={i} style={css(`background:color-mix(in srgb,var(--fg) ${Math.round(12 + v[i] * 1.5)}%,transparent);color:${v[i] > 34 ? 'var(--ground)' : 'var(--fg)'}`)}>{v[i]}%</div> : <div key={i} className="na" />)}</Fragment>)}</div></div>;
      foot = <><span>{"Share of each invite week that's active. "}<b>About half</b>{" activate by week three."}</span><button data-go="members" data-gp="nudges:opened">Nudge the stuck in Members →</button></>;
    } else {
      const pr = prevRange(),
        on = cmpOn();
      const prevRows = on ? Object.fromEntries(rowsFor(S.dim, pr).map(r => [r.n, r.v])) : {};
      let rows = rowsFor(S.dim).map(r => ({
        ...r,
        in: r.v[k],
        out: r.v[k + 1] || 0
      }));
      const sumIn = rows.reduce((a, r) => a + r.in, 0),
        sumOut = rows.reduce((a, r) => a + r.out, 0),
        avg = pct(sumOut, sumIn);
      const hand = r => S.dim === 'page' && r.f[1] === 0;
      rows.forEach(r => {
        r.rate = r.in && !hand(r) ? pct(r.out, r.in) : null;
        const pv = prevRows[r.n];
        const j = rng(hash(r.n + k))();
        r.prev = pv && pv[k] ? pct(pv[k + 1], pv[k]) * (0.92 + j * 0.16) : null;
      });
      const key = S.sort === 'in' ? 'in' : S.sort === 'out' ? 'out' : 'rate';
      rows.sort((a, b) => ((a[key] ?? -1) - (b[key] ?? -1)) * S.dir);
      const mx = Math.max(...rows.map(r => r.rate || 0), avg) * 1.12 || 1;
      const cls = r => r.rate == null ? '' : r.rate > avg * 1.2 ? 'hi' : r.rate < avg * .7 ? 'lo' : '';
      const th = (k2, t, c) => <th data-sort={k2} className={`${S.sort === k2 ? 's' : ''} ${c || ''}`}>{t}{S.sort === k2 ? S.dir < 0 ? ' ↓' : ' ↑' : ''}</th>;
      if (!rows.length) body = <div className="bk-empty">{"No "}{D[S.dim].name.toLowerCase()}{" rows match these filters. Shop and design only cover posters, so add Posters to the source filter."}</div>;else if (S.view === 'list') {
        body = <div className="bt-wrap"><table className="bt"><thead><tr><th className="c-nm">{D[S.dim].name}</th>{th('in', STG[k], 'c-in')}{th('out', STG[k + 1], 'c-out')}{th('rate', 'Rate', 'c-rt')}{on ? <th className="c-cmp">Change</th> : ''}<th className="c-sp">Last 14 days</th></tr></thead><tbody>{rows.map((r, __k) => {
                const d = r.rate != null && r.prev != null ? r.rate - r.prev : null;
                return <tr key={__k} data-row={r.n} title={`Filter the page to ${r.n}`}><td className="tn c-nm"><b>{r.n}</b>{r.s ? <span>{r.s}</span> : ''}<span className="m-only mi">{fmt(r.in)}{" → "}{r.rate == null ? '—' : fmt(r.out)}</span></td><td className="c-in">{fmt(r.in)}</td><td className="c-out">{r.rate == null ? <span className="quiet">—</span> : fmt(r.out)}</td><td className="c-rt">{r.rate == null ? <span className="quiet small">Hands off</span> : <div className="rb"><span className="bar"><i className={cls(r)} style={css(`width:${r.rate / mx * 100}%`)} /><s style={css(`left:${avg / mx * 100}%`)} /></span><b>{p1(r.rate)}</b></div>}</td>{on ? <td className="c-cmp">{d == null ? '' : Math.abs(d) < .05 ? <span className="dl">±0.0 pts</span> : <span className={`dl ${d >= 0 ? 'up' : 'dn'}`}>{d >= 0 ? '+' : ''}{d.toFixed(1)}{" pts"}</span>}</td> : ''}<td className="c-sp">{spark(hash(r.n) + k, r.rate > avg)}</td></tr>;
              })}<tr className="tot"><td className="c-nm">All{D[S.dim].posters ? ' posters' : ''}<span className="m-only mi">{fmt(sumIn)}{" → "}{fmt(sumOut)}</span></td><td className="c-in">{fmt(sumIn)}</td><td className="c-out">{fmt(sumOut)}</td><td className="c-rt"><div className="rb"><span className="bar" style={css("background:none")}><s style={css(`left:${avg / mx * 100}%`)} /></span><b>{p1(avg)}</b></div></td>{on ? <td className="c-cmp" /> : ''}<td className="c-sp" /></tr></tbody></table></div>;
      } else {
        const pts = rows.filter(r => r.rate != null && r.in > 0);
        const lx = v => Math.log10(Math.max(v, 1)),
          xmin = Math.min(...pts.map(p => lx(p.in))) - .15,
          xmax = Math.max(...pts.map(p => lx(p.in))) + .15;
        const ymax = Math.ceil(Math.max(...pts.map(p => p.rate), avg) * 1.15 / 5) * 5 || 5;
        const X = v => (lx(v) - xmin) / (xmax - xmin) * 100,
          Y = v => 100 - v / ymax * 100;
        const avgIn = Math.pow(10, pts.reduce((a, p) => a + lx(p.in), 0) / pts.length);
        body = <><div className="sc2"><div className="ax" /><div className="q good" style={css(`left:0;top:0;width:${X(avgIn)}%;height:${Y(avg)}%`)} /><div className="q bad" style={css(`left:${X(avgIn)}%;top:${Y(avg)}%;right:0;bottom:0`)} /><div className="av" style={css(`left:0;right:0;top:${Y(avg)}%;border-top-width:1px`)} /><div className="av" style={css(`top:0;bottom:0;left:${X(avgIn)}%;border-left-width:1px`)} /><span className="ql" style={css("left:8px;top:8px")}>Converts, needs volume</span><span className="ql" style={css("right:8px;bottom:8px")}>Busy, weak</span>{[0, .5, 1].map((f, __k) => <span key={__k} className="yl" style={css(`top:${100 - f * 100}%`)}>{(ymax * f).toFixed(0)}%</span>)}{[...new Set([0, .5, 1].map(f => Math.round(Math.pow(10, xmin + (xmax - xmin) * f))))].map((v, __k) => <span key={__k} className="xl" style={css(`left:${X(v)}%`)}>{fmt(v)}</span>)}{pts.map((p, __k) => <span key={__k} className={`pt2 ${cls(p)}`} style={css(`left:${X(p.in)}%;top:${Y(p.rate)}%`)} data-row={p.n} title={`${p.n} · ${p1(p.rate)}`}><i /><span>{p.n}{" · "}{p1(p.rate)}</span></span>)}</div><div className="tr-x sc2-x"><span>{STG[k]}{" → (log scale)"}</span><span>Rate ↑</span></div></>;
      }
      if (rows.length) {
        const ranked = rows.filter(r => r.rate != null && r.in >= sumIn * .02).sort((a, b) => b.rate - a.rate);
        const best = ranked[0],
          worst = ranked[ranked.length - 1];
        foot = best && worst && best !== worst ? <><span>{"Best "}<b>{best.n}{", "}{p1(best.rate)}</b>{" · lowest "}<b>{worst.n}{", "}{p1(worst.rate)}</b><span className="d-only">{" · average "}{p1(avg)}</span></span><button data-row={best.n}>{"Filter to "}{best.n}{" →"}</button></> : <><span>{"Average "}{p1(avg)}</span><span /></>;
      }
    }
    html(el, <><div className="bk-hd"><h2>{STEP[k]}{", by "}{D[S.dim].name.toLowerCase()}<span>{note}</span></h2><div className="dims-wrap"><div className="dims">{dims}</div></div>{views}</div>{body}<div className="bk-ft">{foot}</div></>);
  }

  /* ── trend: joins and invites side by side per day or week; the number on top is what the waitlist gained ── */
  function renderTrend() {
    const [a, b] = S.range,
      n = b - a + 1;
    const gran = S.gran === 'auto' ? n <= 21 ? 'day' : 'week' : S.gran;
    let buckets = [];
    if (gran === 'day') for (let d = a; d <= b; d++) buckets.push([d, d]);else {
      for (let e = b; e >= a; e -= 7) buckets.unshift([Math.max(a, e - 6), e]);
    }
    const T = totals(); // scale to the funnel's totals so filters apply and the numbers match the page
    const ser = si => {
      const tot = sumR(si, a, b) || 1;
      return buckets.map(([x, y]) => Math.round(sumR(si, x, y) * T[si] / tot));
    };
    const J = ser(1),
      I = ser(2),
      A = ser(4),
      m = buckets.length;
    const raw = Math.max(5, ...J, ...I),
      mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(s => raw / s <= 4) || mag * 10,
      ymax = Math.ceil(raw * 1.08 / step) * step;
    const ticks = [];
    for (let v = 0; v <= ymax + 1e-9; v += step) ticks.push(v);
    const part = i => gran === 'week' && buckets[i][1] - buckets[i][0] < 6;
    const lab = i => gran === 'day' ? dFmt(buckets[i][1]) : dFmt(buckets[i][0]) + (part(i) ? ` · ${buckets[i][1] - buckets[i][0] + 1}d` : '');
    const every = m <= 12 ? 1 : Math.ceil(m / 8);
    const host = $g('trend');
    html(host, <><div className="bc-y">{ticks.map((v, __k) => <span key={__k} style={css(`bottom:${v / ymax * 100}%`)}>{fmt(v)}</span>)}</div><div className="bc-p">{ticks.map((v, __k) => <i key={__k} className="bc-g" style={css(`bottom:${v / ymax * 100}%`)} />)}<div className={`bc-cols ${m > 16 ? 'dense' : ''}`}>{buckets.map((bk, i) => {
            const net = J[i] - I[i];
            return <div key={i} className={`bc-c ${part(i) ? 'part' : ''}`} tabIndex="0" data-tip={`${gran === 'day' ? dFmt(bk[1]) : part(i) ? `${dFmt(bk[0])} – ${dFmt(bk[1])} (part week)` : 'Week of ' + dFmt(bk[0])}|${J[i]}|${I[i]}|${A[i]}|${net}`}><span className={`bc-net ${net > 0 ? 'up' : 'dn'}`} style={css(`bottom:calc(${Math.max(J[i], I[i]) / ymax * 100}% + 6px)`)}>{net > 0 ? '+' : ''}{fmt(net)}</span><div className="bc-bars"><i className="j" style={css(`height:${J[i] / ymax * 100}%`)} /><i className="v" style={css(`height:${I[i] / ymax * 100}%`)} /><i className="a" style={css(`height:${A[i] / ymax * 100}%`)} /></div><span className={`bc-x ${i % 2 ? 'odd' : ''}`}>{i % every === 0 || i === m - 1 ? lab(i) : ''}</span></div>;
          })}</div><div className="bc-tip" id="bctip" hidden /></div></>);
    const s = arr => fmt(arr.reduce((x, y) => x + y, 0)),
      tot = J.reduce((x, y) => x + y, 0) - I.reduce((x, y) => x + y, 0);
    html($g('trx'), '');
    html($g('trk'), <><span><i style={css("background:var(--fg);height:10px;width:10px")} />{"Joined "}<b>{s(J)}</b></span><span><i style={css("background:var(--land);height:10px;width:10px")} />{"Invited "}<b>{s(I)}</b></span><span><i style={css("background:color-mix(in srgb,var(--fg) 22%,transparent);height:10px;width:10px")} />{"Activated "}<b>{s(A)}</b></span><span className="bc-k"><b className="up">+{fmt(tot)}</b>{" added to the waitlist"}</span></>);
    html($g('trh'), <><h2>Joins against invites</h2><div className="r"><span className="lbl">{perName()}{" · "}{gran === 'day' ? 'by day' : 'by week'}</span><div className="seg sm" role="group" aria-label="Granularity">{[['auto', 'Auto'], ['day', 'Daily'], ['week', 'Weekly']].map(([k, t], __k) => <button key={__k} data-gran={k} aria-pressed={S.gran === k} {...attrs(k === 'day' && n > 92 ? 'disabled' : '')}>{t}</button>)}</div></div></>);
  }
  R.addEventListener('mouseover', e => {
    const c = e.target.closest('.bc-c:not(.tf-c)');
    const tip = $g('bctip');
    if (!tip || S.tab !== 'overview') return;
    if (!c) {
      tip.hidden = true;
      return;
    }
    const [t, j, i, a, net] = c.dataset.tip.split('|');
    const p = c.parentElement.getBoundingClientRect(),
      r = c.getBoundingClientRect();
    html(tip, <><b>{t}</b><span><i style={css("background:var(--fg)")} />Joined<em>{fmt(+j)}</em></span><span><i style={css("background:var(--land)")} />Invited<em>{fmt(+i)}</em></span><span><i style={css("background:color-mix(in srgb,var(--fg) 22%,transparent)")} />Activated<em>{fmt(+a)}</em></span><span className="nt">Waitlist<em>{+net > 0 ? '+' : ''}{fmt(+net)}</em></span></>);
    tip.hidden = false;
    const tw = tip.offsetWidth;
    let x = r.right - p.left + 8;
    if (x + tw > p.width) x = r.left - p.left - tw - 8;
    tip.style.left = Math.max(0, x) + 'px';
  });

  /* ── waitlist: the people, not a projection. Next in line = who batch 14 would invite; Just joined = live. ── */
  const WAIT_NEXT = L ? L.WAIT_NEXT : [['M', 'T', 'Redlands', "Poster · Rosa’s Panadería", '12 Sep'], ['J', 'O', 'San Bernardino', 'Poster · Mesa Laundry', '12 Sep'], ['A', 'R', 'Redlands', 'Website · /join', '13 Sep'], ['K', 'W', 'Riverside', 'Poster · Citrus Bowl Café', '13 Sep'], ['L', 'H', 'Redlands', 'Poster · Uptown Barber', '13 Sep'], ['S', 'N', 'Colton', 'Social · Instagram', '14 Sep']];
  const WAIT_NEW = L ? L.WAIT_NEW : [['D', 'P', 'San Bernardino', 'Poster · Mesa Laundry', 2], ['T', 'B', 'Riverside', 'Search', 11], ['G', 'K', 'Redlands', 'Poster · Uptown Barber', 19], ['R', 'A', 'Redlands', "Poster · Rosa’s Panadería", 34], ['E', 'V', 'Fontana', 'Social · TikTok', 52], ['N', 'C', 'Redlands', 'Website · /join', 71]];
  const LIVE_POOL = L ? L.LIVE_POOL : [['B', 'S', 'Highland', 'Poster · Highland Hardware'], ['I', 'M', 'Redlands', 'Poster · State St. Books'], ['F', 'L', 'San Bernardino', 'Social · Instagram'], ['C', 'J', 'Rialto', 'Search']];
  let wlTimer = null,
    wlCount = L ? L.WL.waiting : 1500;
  const mask = (f, l) => <>{f}<span className="msk">•••••</span>{" "}{l}.</>;
  const daysSince = d => {
    const [dd, mm] = d.split(' ');
    const dt = new Date(2026, mm === 'Sep' ? 8 : 9, +dd);
    return Math.round((dayDate(TODAY) - dt) / 864e5);
  };
  const ago = m => m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ago`;
  function renderWl() {
    // live, the people waiting are Members' to show (masked there); Growth says how many
    if (L) return html($g('wl'), <><div className="wl-list"><div className="bk-empty">{L.WL.waiting ? `${fmt(L.WL.waiting)} ${L.WL.waiting === 1 ? 'person is' : 'people are'} waiting. Who they are shows in Members, masked.` : 'Nobody is waiting.'}</div></div><button className="foot" data-go="members" data-gp="waitlist">{`See the waitlist in Members`}{" "}<span>→</span></button></>);
    const tab = S.wl || 'next';
    const rows = tab === 'next' ? WAIT_NEXT.slice(0, 5).map((r, i) => {
      const w = daysSince(r[4]);
      return <div key={i} className="wr"><span className="wr-n">{i + 1}</span><span className="wr-m"><b>{mask(r[0], r[1])}</b><span>{r[2]}{" · "}{r[3]}</span></span><span className="wr-r"><b>{w}{" days"}</b><span className="wr-bar"><i style={css(`width:${Math.min(100, w / 60 * 100)}%`)} /><s style={css(`left:${24 / 60 * 100}%`)} /></span></span></div>;
    }) : WAIT_NEW.slice(0, 5).map((r, i) => <div key={i} className={`wr nn ${r.isNew ? 'fresh' : ''}`}><span className="wr-m"><b>{mask(r[0], r[1])}</b><span>{r[2]}{" · "}{r[3]}</span></span><span className="wr-r"><b className="t">{ago(r[4])}</b><span className="wr-pos">#{fmt(wlCount - i)}{" in line"}</span></span></div>);
    html($g('wl'), <><div className="wl-sub"><div className="seg sm" role="group" aria-label="Waitlist view"><button data-wl="next" aria-pressed={tab === 'next'}>Next in line</button><button data-wl="new" aria-pressed={tab === 'new'}>Just joined</button></div><span className="wl-note">{tab === 'next' ? 'Batch 14 takes 25' : <><span className="dot" style={css("color:var(--settled)")} />{" Live"}</>}</span></div><div className="wl-list">{rows}</div>{tab === 'next' ? <div className="wl-key"><span className="wr-bar"><i style={css("width:40%")} /><s style={css("left:40%")} /></span>Waited, against the 16-day median</div> : <div className="wl-key">Names stay masked until you open someone in Members</div>}<button className="foot" data-go="members" data-gp={tab === 'next' ? 'b14' : 'waitlist'}>{tab === 'next' ? 'Plan batch 14 in Members' : `See all ${fmt(wlCount)} in Members`}{" "}<span>→</span></button></>);
    clearInterval(wlTimer);
    if (tab === 'new' && !L) wlTimer = setInterval(() => {
      if (!GLIVE()) return clearInterval(wlTimer);
      const p = LIVE_POOL[(wlCount - 1500) % LIVE_POOL.length];
      WAIT_NEW.forEach(r => {
        r[4] += 1;
        r.isNew = false;
      });
      const n = [p[0], p[1], p[2], p[3], 0];
      n.isNew = true;
      WAIT_NEW.unshift(n);
      WAIT_NEW.length = 6;
      wlCount++;
      R.querySelector('#wlh .r .lbl').textContent = `${fmt(wlCount)} waiting · 16-day median`;
      renderWl();
    }, 9000);
  }
  function renderMoves() {
    // the moves are worked out from shop, design and city numbers the API doesn't have yet (docs/ui-redesign-plan.md, gaps)
    if (L) return html($g('moves'), <div className="cell s12"><div className="hd"><h2>Next moves</h2><div className="r"><span className="lbl">Not real yet</span></div></div><div className="bk-empty">Worked out once joins and first spends are counted by shop, design and city.</div></div>);
    // each move: what to do, the evidence drawn as two bars, and what it should be worth
    const bars = (a, b, la, lb, max, fa) => <div className="mv-ev"><div><span>{la}</span><b>{fa(a)}</b></div><i className="mv-b"><i style={css(`width:${a / max * 100}%`)} /></i><div><span>{lb}</span><b>{fa(b)}</b></div><i className="mv-b q"><i style={css(`width:${b / max * 100}%`)} /></i></div>;
    const M = [{
      k: 'Swap a design',
      imp: '≈ +38 joins a month',
      t: 'Redlands Tire & Lube',
      m: 'Lowest join rate of the top shops, on decent traffic.',
      ev: bars(12.0, 24.9, 'This shop, design C', 'Design A average', 30, v => v.toFixed(1) + '%'),
      go: 'Plan the swap in Field',
      to: ['field', 'plan']
    }, {
      k: 'Add posters',
      imp: '≈ +60 joins a month',
      t: 'Riverside',
      m: 'Each poster there pulls more visits than anywhere else.',
      ev: bars(512, 357, 'Visits per poster', 'All-city average', 600, v => fmt(v)),
      go: 'Add to the Field route',
      to: ['field', 'plan']
    }, {
      k: 'Raise the invite pace',
      imp: 'Waitlist stops growing',
      t: 'Invite 300+ a week',
      m: 'Joins outrun invites 6.4 to 1, so the wait keeps getting longer.',
      ev: bars(318, 50, 'Joins a week', 'Invites a week', 360, v => fmt(v)),
      go: 'Plan batch 14 in Members',
      to: ['members', 'b14']
    }];
    html($g('moves'), <div className="cell s12"><div className="hd"><h2>Next moves</h2><div className="r"><span className="lbl">Worked out from the numbers above</span></div></div><div className="mv-g">{M.map((m, __k) => <div key={__k} className="mv"><div className="mv-h"><span className="lbl">{m.k}</span><span className="chip ok">{m.imp}</span></div><b className="mv-t">{m.t}</b><span className="mv-m">{m.m}</span>{m.ev}<button className="btn mv-go" data-act="" data-go={m.to[0]} data-gp={m.to[1]}>{m.go}{" →"}</button></div>)}</div></div>);
  }
  function render() {
    R.querySelectorAll('.gtabs [data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === S.tab ? 'page' : 'false'));
    ['ov', 'tf', 'cp', 'ch', 'ap'].forEach(id => {
      const e = $g(id);
      if (e) e.hidden = !(id === 'ov' && S.tab === 'overview' || id === 'tf' && S.tab === 'traffic' || id === 'cp' && S.tab === 'campaigns' || id === 'ch' && S.tab === 'cohorts' || id === 'ap' && S.tab === 'apps');
    });
    if (S.tab !== 'campaigns' && typeof CS !== 'undefined' && CS.open) {
      CS.open = null;
      renderCampPanel();
    }
    renderCtl();
    renderSheet();
    if (S.tab === 'overview') {
      const T = totals();
      renderHdr(T);
      renderFunnel(T);
      renderBk();
      renderTrend();
      if (L) {
        const lbl = R.querySelector('#wlh .r .lbl'),
          foot = R.querySelector('#ov .cell.s8 > .foot > span');
        if (lbl) lbl.textContent = `${fmt(L.WL.waiting)} waiting${L.WL.medianDays == null ? '' : ` · ${L.WL.medianDays}-day median`}`;
        if (foot) foot.textContent = W_INV[11] ? `${(W_JOIN[11] / W_INV[11]).toFixed(1)} joins for every invite this week · see how each invite week activates` : 'No invites this week · see how each invite week activates';
      }
    } else if (L && NOT_REAL[S.tab]) notReal(S.tab);else if (S.tab === 'traffic') renderTraffic();else if (S.tab === 'campaigns') renderCampaigns();else if (S.tab === 'cohorts') renderCohorts();else if (S.tab === 'apps') renderApps();else {
      const nm = {
        campaigns: 'Campaigns',
        cohorts: 'Cohorts',
        apps: 'Apps'
      }[S.tab];
      html($g('hdr'), <><span className="when"><span className="dot" />{"Growth · "}{nm}</span><p className="brief">{nm}{" is next. "}<span className="q">We're designing one tab at a time.</span></p></>);
      html($g('tp'), <div className="bento"><div className="cell s12"><div className="bk-empty">{nm}{" hasn't been designed yet."}</div></div></div>);
    }
  }
  /* live, a tab whose numbers the API doesn't have yet says so, hatched, and what it needs (docs/ui-redesign-plan.md, gaps) */
  const NOT_REAL = {
    campaigns: ['cp', 'Campaigns', 'Campaigns need tagged links (UTM) counted by the site feed, with what each cost and the $10 offers they carried.'],
    cohorts: ['ch', 'Cohorts', 'Cohorts need each invite week’s activations by days since the invite, and who is still active and has spent their $10.'],
    apps: ['ap', 'Apps', 'Apps need the member and merchant apps’ own events: who opens them each day, what they use, onboarding steps and errors.']
  };
  function notReal(tab) {
    const [id, nm, need] = NOT_REAL[tab];
    html($g('hdr'), <><span className="when"><span className="dot" />{"Growth · "}{nm}</span><p className="brief">{"Nothing to show yet. "}<span className="q">{need}</span></p></>);
    html($g(id), <section className="band"><div className="bento"><div className="cell s12"><div className="hd"><h2>{nm}</h2><div className="r"><span className="lbl">Not real yet</span></div></div><div className="bk-empty hatch" style={css("min-height:160px;opacity:.5")} /><div className="bk-empty">{need}</div></div></div></section>);
  }
  function closePanel() {
    CS.open = null;
    if (S.tab === 'campaigns') renderCampaigns();else renderCampPanel();
  }
  function setRange(r, key) {
    S.range = r.slice();
    S.per = key || (PRESETS.find(p => p[2][0] === r[0] && p[2][1] === r[1]) || [])[0] || 'custom';
    S.pick = null;
    S.open = null;
  }
  R.addEventListener('click', e => {
    if (e.target.id === 'cscrim') return closePanel();
    const t = e.target.closest('button,[data-row],[data-row-src],[data-city],[data-camp],th[data-csort],a,input,[data-sheetclose]');
    if (!t) {
      if (S.open) {
        S.open = null;
        S.pick = null;
        renderCtl();
      }
      return;
    }
    if (t.dataset.go) {
      CC.go(t.dataset.go, t.dataset.gp);
      return;
    }
    if (t.dataset.per) {
      const p = PRESETS.find(p => p[0] === t.dataset.per);
      setRange([Math.max(0, p[2][0]), p[2][1]], p[0]);
      if (S.sheet) S.sheet = null;
      return render();
    }
    if (t.hasAttribute('data-custom')) {
      S.open = S.open === 'custom' ? null : 'custom';
      S.pick = null;
      S.cal = 1;
      return renderCtl();
    }
    if (t.dataset.quick) {
      setRange(t.dataset.quick.split(',').map(Number));
      if (S.sheet) S.sheet = null;
      return render();
    }
    if (t.dataset.calnav) {
      S.cal = Math.max(0, Math.min(1, S.cal + +t.dataset.calnav));
      return S.sheet ? renderSheet() : renderCtl();
    }
    if (t.dataset.day !== undefined) {
      const d = +t.dataset.day;
      S.pick = !S.pick || S.pick.length === 2 ? [d] : [Math.min(S.pick[0], d), Math.max(S.pick[0], d)];
      return S.sheet ? renderSheet() : renderCtl();
    }
    if (t.hasAttribute('data-calapply')) {
      if (S.pick && S.pick.length === 2) setRange(S.pick);
      return render();
    }
    if (t.hasAttribute('data-calcancel')) {
      S.open = null;
      S.pick = null;
      return renderCtl();
    }
    if (t.hasAttribute('data-sheetclose')) {
      if (S.sheet === 'period' && S.pick && S.pick.length === 2) setRange(S.pick);
      S.sheet = null;
      S.pick = null;
      return render();
    }
    if (t.dataset.sheet) {
      S.sheet = t.dataset.sheet;
      S.cal = 1;
      S.pick = null;
      return renderSheet();
    }
    if (t.dataset.tab) {
      S.tab = t.dataset.tab;
      S.open = null;
      S.pick = null;
      tabTop();
      setHash();
      return render();
    }
    if (t.dataset.cmetric) {
      CHS.metric = t.dataset.cmetric;
      return renderCohorts();
    }
    if (t.dataset.cjump) {
      $g(t.dataset.cjump).scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
      return;
    }
    if (t.dataset.camp) {
      CS.open = t.dataset.camp;
      return renderCampaigns();
    }
    if (t.hasAttribute('data-newcamp')) {
      CS.open = 'new';
      return renderCampPanel();
    }
    if (t.hasAttribute('data-cclose')) return closePanel();
    if (t.hasAttribute('data-livep')) {
      CS.open = 'live';
      return renderCampPanel();
    }
    if (t.dataset.csort) {
      CS.sort = t.dataset.csort;
      return renderCampaigns();
    }
    if (t.dataset.cfilter) {
      const c = CAMPS.find(x => x.id === t.dataset.cfilter);
      Object.values(S.F).forEach(s => s.clear());
      if (c.type === 'Posters') {
        const d = D.design.rows.find(r => r.n.startsWith(c.sub.slice(-1)));
        S.F.design.add(d.n);
      } else S.F.source.add(c.type === 'Referrals' ? 'Direct' : 'Social');
      CS.open = null;
      return render();
    }
    if (t.dataset.gran) {
      S.gran = t.dataset.gran;
      return S.tab === 'traffic' ? renderTraffic() : S.tab === 'apps' ? renderApps() : renderTrend();
    }
    if (t.dataset.afeat) {
      AS.feat = t.dataset.afeat;
      return renderApps();
    }
    if (t.dataset.ajump) {
      $g(t.dataset.ajump).scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
      return;
    }
    if (t.dataset.prop) {
      TS.prop = t.dataset.prop;
      return renderTraffic();
    }
    if (t.dataset.iso !== undefined) {
      TS.iso = t.dataset.iso && TS.iso !== t.dataset.iso ? t.dataset.iso : null;
      return renderTraffic();
    }
    if (t.dataset.twist) {
      const n = t.dataset.twist;
      TS.open.has(n) ? TS.open.delete(n) : TS.open.add(n);
      return renderTraffic();
    }
    if (t.dataset.pgsort) {
      TS.pgSort = t.dataset.pgsort;
      return renderTraffic();
    }
    if (t.hasAttribute('data-heatjump')) {
      $g('heat').scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
      return;
    }
    if (t.dataset.city) {
      S.F.city.clear();
      S.F.city.add(t.dataset.city);
      return render();
    }
    if (t.dataset.rowSrc) {
      S.F.source.clear();
      S.F.source.add(t.dataset.rowSrc);
      return render();
    }
    if (t.dataset.wl) {
      S.wl = t.dataset.wl;
      return renderWl();
    }
    if (t.hasAttribute('data-cmp')) {
      S.cmp = !S.cmp;
      return render();
    }
    if (t.dataset.fopen) {
      S.open = S.open === t.dataset.fopen ? null : t.dataset.fopen;
      return renderCtl();
    }
    if (t.dataset.fclear) {
      S.F[t.dataset.fclear].clear();
      return render();
    }
    if (t.hasAttribute('data-fclose')) {
      S.open = null;
      return renderCtl();
    }
    if (t.hasAttribute('data-fclearall')) {
      Object.values(S.F).forEach(s => s.clear());
      return render();
    }
    if (t.dataset.fv) {
      const set = S.F[t.dataset.fv];
      t.checked ? set.add(t.value) : set.delete(t.value);
      const o = S.open;
      render();
      S.open = o;
      renderCtl();
      return;
    }
    if (t.dataset.step) {
      S.step = +t.dataset.step;
      return render();
    }
    if (t.dataset.dim) {
      S.dim = t.dataset.dim;
      S.sort = 'in';
      S.dir = -1;
      return renderBk();
    }
    if (t.dataset.view) {
      S.view = t.dataset.view;
      return renderBk();
    }
    if (t.dataset.row) {
      const set = S.F[S.dim];
      if (!set) return;
      set.clear();
      set.add(t.dataset.row);
      return render();
    }
    if (t.hasAttribute('data-copy')) {
      try {
        navigator.clipboard.writeText(location.href.split('#')[0] + '#growth' + (S.tab === 'overview' ? '' : '/' + S.tab));
      } catch (err) {}
      t.classList.add('done');
      const o = hasHtml(t);
      html(t, '✓ Copied');
      setTimeout(() => {
        t.classList.remove('done');
        html(t, o);
      }, 1400);
      return;
    }
  });
  R.addEventListener('click', e => {
    if (e.target.closest('th[data-pgsort]')) {
      TS.pgSort = e.target.closest('th').dataset.pgsort;
      return renderTraffic();
    }
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const k = th.dataset.sort;
    if (S.sort === k) S.dir *= -1;else {
      S.sort = k;
      S.dir = -1;
    }
    renderBk();
  });
  document.addEventListener('keydown', e => {
    if (!GLIVE()) return;
    if (e.key === 'Escape' && typeof CS !== 'undefined' && CS.open) {
      closePanel();
      return;
    }
    if (e.key === 'Escape') {
      if (S.sheet) {
        S.sheet = null;
        renderSheet();
      } else if (S.open) {
        S.open = null;
        S.pick = null;
        renderCtl();
      }
    }
  });
  window.addEventListener('scroll', () => {
    if (!GLIVE()) return;
    const c = $g('ctl');
    c.classList.toggle('stuck', c.getBoundingClientRect().top <= barH() + 0.5);
  }, {
    passive: true
  });
  function applyFlags(hs) {
    if (hs.includes('chart')) S.view = 'chart';
    if (hs.includes('shop')) S.dim = 'shop';
    if (hs.includes('f')) S.F.city.add('Redlands');
    if (hs.includes('7d')) setRange([TODAY - 6, TODAY], '7d');
    if (hs.includes('today')) setRange([TODAY, TODAY], 'today');
    if (hs.includes('all')) setRange([0, TODAY], 'all');
    if (hs.includes('cal')) S.open = 'custom';
    if (hs.includes('traffic')) S.tab = 'traffic';
    if (hs.includes('campaigns')) S.tab = 'campaigns';
    if (hs.includes('cohorts')) S.tab = 'cohorts';
    if (hs.includes('apps')) S.tab = 'apps';
    if (hs.includes('cpanel')) CS.open = 'pa';
    if (hs.includes('newcamp')) CS.open = 'new';
    if (hs.includes('sheetf')) S.sheet = 'filters';
    if (hs.includes('sheetp')) S.sheet = 'period';
  }
  const TABS = ['overview', 'traffic', 'campaigns', 'cohorts', 'apps'];
  let ready = false,
    pend = null,
    mo = null;
  function scrubNow() {
    if (CC.viewing() && CC.level('growth') === 1) CC.scrub(W);
  }
  function mount() {
    // the slot is the shell's: the host goes inside it
    if (!into('g-slot')) return;
    // the shell sets #growth as it goes; the tab shown goes after it, so a reload opens it again
    setHash();
    W.classList.toggle('ro', CC.viewing() && CC.level('growth') < 3);
    if (!ready) {
      ready = true;
      if (pend) applyFlags(pend);
      render();
      renderWl();
      renderMoves();
    } else {
      render();
      renderWl();
    }
    if (!mo) {
      mo = new MutationObserver(scrubNow);
      mo.observe(R, {
        subtree: true,
        childList: true,
        characterData: true
      });
    }
    scrubNow();
  }
  function unmount() {
    clearInterval(liveTimer);
    clearInterval(wlTimer);
    if (W.classList.contains('sh')) {
      W.classList.remove('sh');
      document.body.style.overflow = '';
    }
  }
  function setTab(sub) {
    const hs = String(sub || '').split(','),
      t = hs.find(x => TABS.includes(x));
    if (t) S.tab = t;
    if (ready) applyFlags(hs);else pend = hs;
  }
  return {
    mount,
    unmount,
    setTab: (_r, sub) => setTab(sub),
    tab: () => S.tab,
    host
  };
}
registerPage(['growth'], 'g-slot', makeGrowth, { live: true });
