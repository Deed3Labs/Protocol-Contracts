// @ts-nocheck: ported from the redesign's FM2 module (design/command-center-ui) with scripts/port/module.cjs; its data is its own.
import { Fragment } from 'react';
import { act, addFile, run } from '../live/actions';
import { LIVE as LIVE_APP, REAL } from '../live/env';
import { mapRequest, mapStyle } from '../live/map';
import { loadSection, needsData } from '../live/sections';
import { attrs, css, hasHtml, html, swapClass } from '../runtime/dom';
import { CC } from './cc';
import { S } from './data';
import { INBOX, mask } from './fm2Data';
import { SRC_OUT, VISIT_OUT, fmLive, visitText } from './fmLive';
import { registerPage, shadowHost } from './pageHost';
import { openItem, render as renderShell, toast, vLevel } from './shell';

/*
 * Field and Merchants (design/command-center-ui, the FM2 module): one module draws both pages, because they share
 * data (routes, visits, leads and shops): planning or logging a visit in Merchants lands in Field, and Field's
 * follow-ups come from the Merchants pipeline. Field has Today, Plan, Visits, Posters and Placement; Merchants has
 * Overview, Pipeline, Partners, Payouts and Devices. It lives in its own shadow root (pageHost.tsx), with the shell
 * of whichever page is shown; its inner module reads the root through a document stand-in (DOCP), as the reference
 * has it. Links out go through CC.go, so they land on the right page and tab.
 *
 * Maps: real streets (MapLibre on OpenFreeMap's positron, recoloured), drawn over a drawn map that shows until the
 * live one has tiles, and stays when it can't load (no network, or the checks, which block both).
 *
 * Live (REAL), its datasets are fmLive()'s (`LV`: named so, not L, as the module uses L for its own locals): the
 * field and merchants sections, the pipeline and the team. Each page loads the other's section too, as they share
 * data. What nothing records yet says "Not real yet" with what it needs, its buttons hidden; the actions go through
 * the API (POST /actions/field/… and /actions/merchants/…), and the page is built again from what the server holds.
 */

/** The page's skeleton: the reference template's markup. */
function skeleton() {
  return <div className="gw fxw"><div className="fx-shell" /></div>;
}
/** An option the reference's markup marks `selected`: its select starts on it (defaultValue), and it keeps the attribute, as the reference's DOM has it. */
const picked = (on) => (on ? { ref: (el) => el?.setAttribute('selected', '') } : {});
/** Live: the other page's section being loaded, or that couldn't be (no access), so it's asked for once. */
const OTHER = new Set<string>();
function makeFieldMerchants() {
  // field and merchants share one chain of sheets (g, fm), so one host draws both
  const { host, R: SR, W, into } = shadowHost('field', skeleton());
  host.classList.add('fx-host');
  const SH = SR.querySelector('.fx-shell');
  let PAGE = 'field',
    pend = null;
  const LIVE = () => host.isConnected && CC.route() === PAGE;
  const RO = () => CC.viewing() && vLevel(PAGE) < 3;
  const TOT = () => CC.viewing() && vLevel(PAGE) === 1;
  const LV = REAL ? fmLive() : null;
  const meKey = () => {
    if (LV) return LV.meK;
    const v = S.view;
    if (!v) return 'kai';
    const p = {
      K: 'kai',
      ML: 'marcus',
      DR: 'dana',
      PS: 'priya'
    }[v.person];
    if (p) return p;
    return {
      admin: 'kai',
      field: 'marcus',
      protocol: 'dana'
    }[v.g] || 'viewer';
  };
  const barH = () => {
    const b = document.querySelector('.top');
    return b ? b.getBoundingClientRect().bottom : 0;
  };
  const ROOT_EV = new Set(['click', 'input', 'change', 'dragstart', 'dragover', 'dragenter', 'dragleave', 'dragend', 'drop', 'pointerdown', 'touchstart', 'touchmove']);
  const DOCP = {
    getElementById: id => SR.getElementById(id),
    querySelector: q => SR.querySelector(q),
    querySelectorAll: q => SR.querySelectorAll(q),
    elementFromPoint: (x, y) => SR.elementFromPoint(x, y),
    createElement: t => document.createElement(t),
    get body() {
      return W;
    },
    get documentElement() {
      return document.documentElement;
    },
    get head() {
      return document.head;
    },
    get fonts() {
      return document.fonts;
    },
    get activeElement() {
      return SR.activeElement;
    },
    addEventListener: (t, f, o) => (ROOT_EV.has(t) ? SR : document).addEventListener(t, f, o),
    removeEventListener: (t, f, o) => (ROOT_EV.has(t) ? SR : document).removeEventListener(t, f, o)
  };
  const HOME = {
    field: 'today',
    merchants: 'overview'
  };
  const MAPF = {
    route: 'today',
    today: 'today',
    plan: 'plan',
    visits: 'visits',
    posters: 'posters',
    placement: 'placement'
  };
  const MAPX = {
    overview: 'overview',
    needs: 'overview',
    pipeline: 'pipeline',
    enquiries: 'pipeline',
    board: 'pipeline',
    partners: 'partners',
    payouts: 'payouts',
    devices: 'devices',
    hardware: 'devices'
  };
  let API = null;
  function setHash() {
    if (!LIVE()) return;
    const t = API.tab(PAGE);
    try {
      history.replaceState(null, '', '#' + PAGE + (t === HOME[PAGE] ? '' : '/' + t));
    } catch (e) {}
  }
  // links out of the module land on the right page and tab
  function goOut(t) {
    const d = t.dataset,
      [r, sub] = (d.fgo || d.xgo).split('/');
    if (r === 'growth') return CC.go('growth', sub);
    if (r === 'field' || r === 'merchants') {
      if (d.fshop) setTab('merchants', 'shop:' + d.fshop);else if (sub) setTab(r, sub);
      if (PAGE === r && LIVE()) {
        API.render();
        setHash();
        window.scrollTo({
          top: 0
        });
        return;
      }
      return CC.go(r);
    }
    return CC.go(r);
  }
  API = (document => {
    /* ══ Field data — copied from the Command Center so every number matches ═══════════════════════════
       102 posters · 94 up, 4 swap due, 3 faded, 1 missing · 4,812 scans in 30 days · route of 8 stops, Marcus Lee, 3 done.
       Demo "today" is Wed 21 Oct 2026. */
    function rng(seed) {
      let s = seed;
      return () => (s = s * 16807 % 2147483647, (s - 1) / 2147483646);
    }
    function series(n, total, shape, seed) {
      const r = rng(seed);
      const w = [];
      for (let i = 0; i < n; i++) w.push(shape(i) * (0.85 + 0.3 * r()));
      const sw = w.reduce((a, b) => a + b, 0);
      const v = w.map(x => Math.round(x / sw * total));
      v[n - 1] += total - v.reduce((a, b) => a + b, 0);
      return v;
    }
    const int = n => Math.round(n).toLocaleString('en-US');
    const SHOPS = [['rosas', "Rosa’s Panadería", 4, 842, 219, 26, 22, 'Redlands'], ['icw', 'Inland Cycle Works', 3, 611, 128, 14, 11, 'Redlands'], ['mesa', 'Mesa Laundry', 3, 530, 127, 13, 10, 'San Bernardino'], ['uptown', 'Uptown Barber', 3, 402, 125, 16, 13, 'Redlands'], ['citrus', 'Citrus Bowl Café', 3, 366, 70, 7, 6, 'Riverside'], ['tire', 'Redlands Tire & Lube', 2, 301, 36, 3, 2, 'Redlands'], ['books', 'State St. Books', 3, 288, 81, 9, 7, 'Redlands'], ['mich', 'La Michoacana', 3, 254, 64, 7, 6, 'San Bernardino'], ['nails', 'Arrowhead Nails', 2, 221, 40, 4, 3, 'San Bernardino'], ['orange', 'Orange St. Laundromat', 2, 197, 39, 4, 3, 'Redlands']];
    const BOARDS = ['boards', 'Community boards', 6, 314, 47, 5, 3, '6 boards'];
    const OTHERS = ['others', '20 more shops', 68, 486, 130, 16, 11, 'Inland Empire'];
    const OTHER_SHOPS = ['Fontana Tacos', 'Highland Hardware', 'Yucaipa Feed & Seed', 'Loma Linda Pharmacy', 'Colton Cuts', 'Rialto Donuts', 'Bloomington Market', 'Mentone Coffee', 'Calimesa Cleaners', 'Grand Terrace Deli', 'Muscovy Tea', 'Sixth St. Tailor', 'Brookside Pet Wash', 'Cajon Phone Repair', 'Valley Shoe Repair', 'Kendall Thrift', 'Tippecanoe Tires', 'Victoria Ave. Florist', 'Base Line Pho', 'Citrus Plaza Optical'];
    const OTHER_CITY = ['Fontana', 'Highland', 'Yucaipa', 'Loma Linda', 'Colton', 'Rialto', 'Bloomington', 'Mentone', 'Calimesa', 'Grand Terrace', 'Redlands', 'Riverside', 'Redlands', 'San Bernardino', 'Redlands', 'San Bernardino', 'Redlands', 'Riverside', 'San Bernardino', 'Riverside'];
    const BOARD_SITES = ['Smiley Library', 'UR Commons', 'Sylvan Park', 'Ed Hales Park', 'Feldheym Library', 'Riverside Main Library'];
    const BOARD_CITY = ['Redlands', 'Redlands', 'Redlands', 'Redlands', 'San Bernardino', 'Riverside'];
    const DESIGNS = LV ? LV.DESIGNS : {
      A: {
        name: 'The neighbor',
        posters: 41,
        scans: 2011,
        joined: 501
      },
      B: {
        name: '$10 on us',
        posters: 38,
        scans: 2104,
        joined: 465
      },
      C: {
        name: 'The map',
        posters: 23,
        scans: 697,
        joined: 140
      }
    };
    const TODAY = LV ? LV.TODAY : Date.UTC(2026, 9, 21),
      DAY = 864e5,
      MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const fmtD = t => {
      const d = new Date(t);
      return d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
    };
    const fmtWD = t => {
      const d = new Date(t);
      return WD[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
    };
    const daysTo = t => Math.round((t - TODAY) / DAY);
    const POSTERS = LV ? LV.POSTERS : (() => {
      const r = rng(41);
      const list = [];
      const split = (total, n) => {
        const w = Array.from({
          length: n
        }, () => 0.6 + r());
        const sw = w.reduce((a, b) => a + b, 0);
        const v = w.map(x => Math.floor(x / sw * total));
        let k = total - v.reduce((a, b) => a + b, 0);
        for (let i = 0; k > 0; i = (i + 1) % n, k--) v[i]++;
        return v;
      };
      SHOPS.forEach(s => split(s[3], s[2]).forEach(v => list.push({
        shop: s[1],
        shopId: s[0],
        city: s[7],
        scans: v
      })));
      const otherCounts = OTHER_SHOPS.map((_, i) => i < 8 ? 4 : 3);
      const otherScans = split(OTHERS[3], 68);
      let k = 0;
      OTHER_SHOPS.forEach((n, i) => {
        for (let j = 0; j < otherCounts[i]; j++) list.push({
          shop: n,
          shopId: 'o' + i,
          city: OTHER_CITY[i],
          scans: otherScans[k++]
        });
      });
      split(BOARDS[3], 6).forEach((v, i) => list.push({
        shop: BOARD_SITES[i],
        shopId: 'b' + i,
        city: BOARD_CITY[i],
        scans: v,
        board: true
      }));
      const des = [...Array(41).fill('A'), ...Array(38).fill('B'), ...Array(23).fill('C')];
      for (let i = des.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [des[i], des[j]] = [des[j], des[i]];
      }
      list.forEach((p, i) => {
        p.n = i + 1;
        p.design = des[i];
        p.hung = TODAY - (6 + Math.floor(r() * 50)) * DAY;
        p.checked = TODAY - Math.floor(r() * 12) * DAY;
        p.status = 'up';
      });
      const mesa = list.filter(p => p.shopId === 'mesa')[2],
        p44 = list.find(p => p.n === 44);
      [mesa.n, p44.n] = [44, mesa.n];
      const byN = n => list.find(p => p.n === n);
      [[44, 'faded', -64], [71, 'faded', -40], [90, 'faded', -35], [63, 'missing', -30]].forEach(([n, st, h]) => {
        const p = byN(n);
        p.status = st;
        p.hung = TODAY + h * DAY;
      });
      [[12, -57], [27, -56], [55, -55], [81, -54]].forEach(([n, h]) => {
        const p = byN(n);
        p.status = 'due';
        p.hung = TODAY + h * DAY;
      });
      list.forEach(p => {
        p.swap = p.hung + 60 * DAY;
        if (p.status === 'up' && daysTo(p.swap) < 8) p.hung += 10 * DAY, p.swap += 10 * DAY;
      });
      byN(44).checked = TODAY - 2 * DAY;
      return list.sort((a, b) => a.n - b.n);
    })();
    const pid = n => 'P-' + String(n).padStart(3, '0');
    const ST = {
      up: ['settled', 'Up'],
      due: ['underway', 'Swap due'],
      faded: ['underway', 'Faded'],
      missing: ['absent', 'Missing']
    };
    function designThumb(k, size = 40) {
      const h = size * 1.3;
      const inner = k === 'A' ? <><rect x="5" y="8" width="22" height="5" style={css("fill:var(--fg)")} /><rect x="5" y="16" width="16" height="5" style={css("fill:var(--fg)")} /><circle cx="25" cy="34" r="5" style={css("fill:none;stroke:var(--fg);stroke-width:1.5")} /><rect x="5" y="44" width="10" height="2" style={css("fill:var(--fg-50)")} /></> : k === 'B' ? <><text x="5" y="27" style={css("font:800 15px var(--f-display);fill:var(--fg);letter-spacing:-.04em")}>$10</text><rect x="5" y="33" width="20" height="3" style={css("fill:var(--fg)")} /><rect x="5" y="44" width="10" height="2" style={css("fill:var(--fg-50)")} /></> : <><path d="M5 12h22M5 20h22M5 28h22M11 6v32M19 6v32" style={css("stroke:var(--fg-50);stroke-width:1;fill:none")} /><rect x="16" y="17" width="6" height="6" style={css("fill:var(--fg)")} /><rect x="5" y="44" width="10" height="2" style={css("fill:var(--fg-50)")} /></>;
      return <svg className="thumb" viewBox="0 0 32 52" width={size} height={h} aria-hidden="true"><rect x=".5" y=".5" width="31" height="51" style={css("fill:var(--raised);stroke:var(--line)")} />{inner}</svg>;
    }

    /* a spare Clear Point battery, drawn in the same frame as the poster designs so the van list reads as one set */
    function batteryThumb(size = 40, charge = 3) {
      const h = size * 1.3;
      return <svg className="thumb" viewBox="0 0 32 52" width={size} height={h} aria-hidden="true"><rect x=".5" y=".5" width="31" height="51" style={css("fill:var(--raised);stroke:var(--line)")} /><rect x="13" y="8" width="6" height="3" style={css("fill:var(--fg)")} /><rect x="9" y="11" width="14" height="28" style={css("fill:none;stroke:var(--fg);stroke-width:1.6")} />{[0, 1, 2].map((i, __k) => <rect key={__k} x="12" y={31 - i * 8} width="8" height="5" style={css(`fill:${i < charge ? 'var(--fg)' : 'none'};stroke:${i < charge ? 'none' : 'var(--fg-50)'};stroke-width:1`)} />)}<rect x="5" y="44" width="10" height="2" style={css("fill:var(--fg-50)")} /></svg>;
    }

    /* today's route (Marcus Lee, started 08:50) */
    const posterAt = (shop, n) => n ? POSTERS.find(p => p.n === n) : POSTERS.find(p => p.shop === shop);
    const STOPS = LV ? LV.STOPS : [{
      id: 'uptown',
      name: 'Uptown Barber',
      city: 'Redlands',
      where: 'E Citrus Ave',
      eta: '09:05',
      tasks: [{
        kind: 'poster',
        n: 12,
        t: 'Swap P-012',
        done: '09:12',
        out: 'Replaced',
        photo: 1
      }]
    }, {
      id: 'shoe',
      name: 'Valley Shoe Repair',
      city: 'Redlands',
      where: 'State St',
      eta: '09:30',
      tasks: [{
        kind: 'poster',
        n: 81,
        t: 'Swap P-081',
        done: '09:41',
        out: 'Replaced',
        photo: 1
      }]
    }, {
      id: 'pet',
      name: 'Brookside Pet Wash',
      city: 'Redlands',
      where: 'Brookside Ave',
      eta: '10:00',
      tasks: [{
        kind: 'poster',
        shop: 'Brookside Pet Wash',
        t: 'Check the poster',
        done: '10:08',
        out: 'Checked'
      }]
    }, {
      id: 'orange',
      name: 'Orange St. Laundromat',
      city: 'Redlands',
      where: 'N Orange St',
      eta: '10:30',
      tasks: [{
        kind: 'poster',
        n: 27,
        t: 'Swap P-027'
      }, {
        kind: 'device',
        t: 'Plug in the counter Clear Point',
        note: 'Offline since 08:40'
      }]
    }, {
      id: 'mesa',
      name: 'Mesa Laundry',
      city: 'San Bernardino',
      where: 'W Highland Ave',
      eta: '11:15',
      tasks: [{
        kind: 'poster',
        n: 44,
        t: 'Replace P-044',
        note: 'Sun-faded, 4 days late'
      }]
    }, {
      id: 'bmkt',
      name: 'Bloomington Market',
      city: 'Bloomington',
      where: 'Valley Blvd',
      eta: '11:50',
      tasks: [{
        kind: 'poster',
        n: 55,
        t: 'Swap P-055'
      }]
    }, {
      id: 'citrus',
      name: 'Citrus Bowl Café',
      city: 'Riverside',
      where: 'Main St',
      eta: '12:40',
      tasks: [{
        kind: 'device',
        t: 'Swap the battery on table 4',
        note: 'Battery low since 19:12'
      }]
    }, {
      id: 'tailor',
      name: 'Sixth St. Tailor',
      city: 'Riverside',
      where: 'Sixth St',
      eta: '13:20',
      tasks: [{
        kind: 'poster',
        n: 71,
        t: 'Replace P-071',
        note: 'Faded'
      }, {
        kind: 'merchant',
        t: 'Follow up on the merchant app',
        note: 'From Merchants · signed in Sep, hasn’t charged anyone yet'
      }]
    }];
    LV || STOPS.forEach(s => s.tasks.forEach(t => {
      if (t.kind === 'poster') {
        const p = posterAt(t.shop, t.n);
        t.p = p;
        if (t.shop) t.t = `Check ${pid(p.n)}`;
      }
    }));
    const SHOP_INFO = LV ? LV.SHOP_INFO : {
      uptown: ['8 pm', 'Andre', '12 Sep'],
      shoe: ['6 pm', 'Luis', '2 Sep'],
      pet: ['7 pm', 'Kim', '29 Sep'],
      orange: ['10 pm', 'Ms. Tran', '26 Aug'],
      mesa: ['11 pm', 'Dana', '19 Oct'],
      bmkt: ['9 pm', 'Hector', '24 Aug'],
      citrus: ['3 pm', 'Sofia', '14 Oct'],
      tailor: ['6 pm', 'Mr. Ruiz', '30 Aug']
    };
    const OUT = {
      Checked: ['settled', 'Up and fine'],
      Damaged: ['underway', 'Torn, faded or wet'],
      Replaced: ['settled', 'New poster up'],
      Missing: ['absent', 'Gone from the window']
    };
    const VAN = {
      A: 4,
      B: 3,
      C: 2
    };
    const PEOPLE_F = {
      marcus: ['Marcus Lee', 'ML'],
      dana: ['Dana Ruiz', 'DR'],
      kai: ['Kai', 'KK']
    };
    /* who can take routes: anyone whose group has Field access (set in Permissions). Priya is on the team but has no Field access. */
    const TEAM = LV ? LV.TEAM : {
      kai: {
        n: 'Kai',
        ini: 'KK',
        role: 'Admin',
        field: true,
        admin: true
      },
      marcus: {
        n: 'Marcus Lee',
        ini: 'ML',
        role: 'Field',
        field: true
      },
      dana: {
        n: 'Dana Ruiz',
        ini: 'DR',
        role: 'Ops',
        field: true
      },
      priya: {
        n: 'Priya Shah',
        ini: 'PS',
        role: 'Finance',
        field: false
      }
    };

    /* waiting by city — Members' waitlist (1,500) */
    const WAITING_BY_CITY = LV ? LV.WAITING_BY_CITY : {
      Redlands: 447,
      'San Bernardino': 389,
      Riverside: 265,
      Fontana: 94,
      'Loma Linda': 68,
      Colton: 63,
      Highland: 62,
      Rialto: 60,
      Yucaipa: 52
    };
    /* merchants in each city: live on the merchant app, and signing (Merchants page) */
    const LIVE_BY_CITY = LV ? LV.LIVE_BY_CITY : {
      Redlands: 7,
      'San Bernardino': 4,
      Riverside: 1,
      Highland: 1
    };
    const SIGNING_BY_CITY = LV ? LV.SIGNING_BY_CITY : {
      Redlands: 1
    };

    /* geography: a drawn map, not a street map. lat/lon of each city's centre */
    const GEO = {
      Riverside: [33.9806, -117.3755],
      'Grand Terrace': [34.0339, -117.3134],
      Colton: [34.0739, -117.3137],
      Bloomington: [34.0703, -117.3959],
      Fontana: [34.0922, -117.4350],
      Rialto: [34.1064, -117.3703],
      'San Bernardino': [34.1083, -117.2898],
      Highland: [34.1283, -117.2086],
      'Loma Linda': [34.0483, -117.2611],
      Redlands: [34.0556, -117.1825],
      Mentone: [34.0700, -117.1340],
      Yucaipa: [34.0336, -117.0431],
      Calimesa: [34.0039, -117.0617]
    };
    /* the same drawn geography as Merchants' corridor map: hills, badlands, the Santa Ana River, the street grid and the freeways */
    const GEO2 = {
      hills: [[-117.70, 34.40], [-117.70, 34.19], [-117.55, 34.185], [-117.45, 34.178], [-117.36, 34.172], [-117.30, 34.168], [-117.25, 34.155], [-117.20, 34.142], [-117.14, 34.128], [-117.07, 34.118], [-116.98, 34.105], [-116.85, 34.10], [-116.85, 34.40]],
      badl: [[-117.30, 33.985], [-117.27, 34.012], [-117.22, 34.026], [-117.15, 34.020], [-117.095, 34.004], [-117.075, 33.975], [-117.09, 33.93], [-117.20, 33.90], [-117.29, 33.93]],
      jurupa: [[-117.52, 34.032], [-117.46, 34.046], [-117.42, 34.040], [-117.41, 34.020], [-117.45, 34.004], [-117.52, 34.008]],
      river: [[-116.98, 34.115], [-117.09, 34.098], [-117.15, 34.088], [-117.21, 34.080], [-117.26, 34.072], [-117.30, 34.058], [-117.33, 34.035], [-117.36, 34.008], [-117.40, 33.988], [-117.44, 33.964], [-117.52, 33.930], [-117.60, 33.90]],
      fwy: {
        '10': [[-117.70, 34.071], [-117.47, 34.070], [-117.40, 34.068], [-117.33, 34.066], [-117.29, 34.064], [-117.25, 34.062], [-117.20, 34.059], [-117.15, 34.050], [-117.10, 34.038], [-117.06, 34.010], [-117.04, 33.975], [-117.00, 33.93], [-116.90, 33.90]],
        '215': [[-117.22, 33.84], [-117.30, 33.94], [-117.33, 33.975], [-117.325, 34.02], [-117.31, 34.05], [-117.305, 34.075], [-117.295, 34.11], [-117.31, 34.15], [-117.38, 34.24]],
        '210': [[-117.70, 34.132], [-117.47, 34.131], [-117.38, 34.130], [-117.30, 34.131], [-117.24, 34.128], [-117.20, 34.118], [-117.185, 34.09], [-117.18, 34.062]],
        '60': [[-117.70, 34.02], [-117.47, 34.005], [-117.40, 33.99], [-117.345, 33.978], [-117.33, 33.975], [-117.30, 33.94], [-117.22, 33.937], [-116.95, 33.93]],
        '15': [[-117.55, 33.80], [-117.53, 33.98], [-117.52, 34.07], [-117.48, 34.20]]
      },
      shields: [['10', -117.375, 34.067], ['215', -117.326, 34.0], ['210', -117.42, 34.1305], ['60', -117.455, 33.999], ['10', -117.08, 34.026], ['215', -117.30, 34.095], ['210', -117.215, 34.123]]
    };
    const pip = (pt, poly) => {
      let ins = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i],
          [xj, yj] = poly[j];
        if (yi > pt[1] !== yj > pt[1] && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) ins = !ins;
      }
      return ins;
    };
    const KX = Math.cos(34.05 * Math.PI / 180),
      FULL = [-117.47, -117.01, 33.955, 34.150];
    /* where the route's shops actually are (approximately, on the streets the route names) */
    const SHOP_LL = {
      'Uptown Barber': [34.0560, -117.1795],
      'Valley Shoe Repair': [34.0556, -117.1838],
      'Brookside Pet Wash': [34.0478, -117.2032],
      'Orange St. Laundromat': [34.0628, -117.1828],
      'Mesa Laundry': [34.1361, -117.3002],
      'Bloomington Market': [34.0641, -117.3960],
      'Citrus Bowl Café': [33.9818, -117.3754],
      'Sixth St. Tailor': [33.9853, -117.3718],
      'Victoria Ave. Florist': [33.9310, -117.4040],
      'Magnolia Laundry': [33.9440, -117.4010],
      'Calimesa Cleaners': [34.0040, -117.0600],
      'Cajon Phone Repair': [34.1205, -117.2990],
      'Highland Hardware': [34.1290, -117.2070],
      'Sierra Lakes Barber': [34.1440, -117.4380]
    };
    const hashN = s => {
      let h = 7;
      for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 9973;
      return h;
    };
    const shopLL = (name, city) => {
      if (SHOP_LL[name]) return SHOP_LL[name];
      // a city off the drawn map (live data can name any) sits at Redlands, the map's middle
      const [la, lo] = GEO[city] || GEO.Redlands;
      const h = hashN(name),
        a = h % 360 * Math.PI / 180,
        d = .004 + h % 9 * .001;
      return [la + Math.sin(a) * d, lo + Math.cos(a) * d / KX];
    };
    /* a map is a projection fitted to some bounds at a given width:height. Lines are SVG; pins and labels are HTML laid over it,
       so they keep their size whatever the map's size. */
    function mkMap(bounds, aspect) {
      let [lo0, lo1, la0, la1] = bounds;
      const w = (lo1 - lo0) * KX,
        h = la1 - la0;
      if (w / h < aspect) {
        const d = (h * aspect - w) / KX / 2;
        lo0 -= d;
        lo1 += d;
      } else {
        const d = (w / aspect - h) / 2;
        la0 -= d;
        la1 += d;
      }
      const W = 1000,
        H = W / aspect,
        p = (la, lo) => [(lo - lo0) / (lo1 - lo0) * W, (la1 - la) / (la1 - la0) * H];
      return {
        W,
        H,
        aspect,
        p,
        at: (la, lo) => {
          const [x, y] = p(la, lo);
          return `left:${(x / W * 100).toFixed(2)}%;top:${(y / H * 100).toFixed(2)}%`;
        },
        inside: (la, lo) => lo > lo0 && lo < lo1 && la > la0 && la < la1
      };
    }
    const boundsOf = (pts, pad = .02) => {
      const lo = pts.map(p => p[1]),
        la = pts.map(p => p[0]);
      return [Math.min(...lo) - pad, Math.max(...lo) + pad, Math.min(...la) - pad, Math.max(...la) + pad];
    };
    function areaMap(m, {
      svg = '',
      pins = '',
      cls = '',
      labelGap = null,
      // a label gap as CSS: the reference wrote px, then rewrote them for Placement's map in the finished string
      gapOf = g => `${g}px`
    } = {}) {
      const G = GEO2,
        P = (pts, close) => 'M' + pts.map(([g, t]) => m.p(t, g).map(v => v.toFixed(1)).join(',')).join(' L') + (close ? ' Z' : '');
      const h = (a, b) => {
        const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
        return s - Math.floor(s);
      };
      const off = (g, t) => pip([g, t], G.hills) || pip([g, t], G.badl) || pip([g, t], G.jurupa) || t < 33.92 || g > -117.13 && t < 34.0;
      const st = []; // minor streets: a broken grid, thinner to the east where it is less built up
      for (let t = 33.93; t <= 34.17; t += 0.0065) for (let g = -117.62; g < -116.96; g += 0.026) {
        const g2 = g + 0.026;
        if (h(g, t) > (g > -117.15 ? .62 : .28) && !off(g, t) && !off(g2, t)) st.push(P([[g, t], [g2, t]]));
      }
      for (let g = -117.62; g <= -116.96; g += 0.0075) for (let t = 33.93; t < 34.17; t += 0.022) {
        const t2 = t + 0.022;
        if (h(t, g) > (g > -117.15 ? .62 : .28) && !off(g, t) && !off(g, t2)) st.push(P([[g, t], [g, t2]]));
      }
      const ar = []; // main roads on the real grid
      [34.136, 34.106, 34.077, 34.048].forEach(t => ar.push(P([[-117.66, t], [t > 34.06 ? -117.12 : -117.24, t]])));
      ar.push(P([[-117.52, 33.975], [-117.30, 33.975]]));
      [-117.435, -117.37, -117.31, -117.27, -117.20, -117.16].forEach(g => ar.push(P([[g, g > -117.3 ? 34.03 : 33.99], [g, g > -117.22 ? 34.135 : 34.162]])));
      [-117.40, -117.36].forEach(g => ar.push(P([[g, 33.93], [g, 34.0]])));
      ar.push(P([[-117.085, 34.085], [-117.06, 34.04], [-117.04, 33.995]]));
      const fw = Object.values(G.fwy).map(p => P(p)).join(' ');
      const base = <><path className="fb-hl" d={P(G.hills, 1)} /><path className="fb-hl lo" d={P(G.badl, 1)} /><path className="fb-hl lo" d={P(G.jurupa, 1)} /><path className="fb-st" d={st.join(' ')} /><path className="fb-wt" d={P(G.river)} /><path className="fb-ar" d={ar.join(' ')} /><path className="fb-fc" d={fw} /><path className="fb-fw" d={fw} /></>;
      const shields = G.shields.filter(([, g, t]) => m.inside(t, g)).map(([n, g, t], __k) => {
        const [x, y] = m.p(t, g);
        return x > m.W * .06 && x < m.W * .94 && y > m.H * .06 && y < m.H * .94 ? <span key={__k} className="fm-fl" style={css(m.at(t, g))}>{n}</span> : '';
      });
      const cities = Object.entries(GEO).filter(([c, [la, lo]]) => m.inside(la, lo)).map(([c, [la, lo]], __k) => <span key={__k} className="fm-cl" style={css(`${m.at(la, lo)};${labelGap ? `--g:${gapOf(labelGap(c))}` : ''}`)}>{c}</span>);
      return <div className={`fmw ${cls}`} style={css(`aspect-ratio:${m.aspect.toFixed(3)}`)}><svg viewBox={`0 0 ${m.W} ${m.H.toFixed(1)}`} preserveAspectRatio="none" aria-hidden="true">{base}{svg}</svg>{shields}{cities}{pins}</div>;
    }
    /* things that need a visit but aren't on today's route — the Plan tab's pool */
    const POOL = LV ? LV.POOL : (() => {
      const onToday = new Set(STOPS.flatMap(s => s.tasks.filter(t => t.p).map(t => t.p.n)));
      const out = [];
      POSTERS.filter(p => !onToday.has(p.n) && (p.status !== 'up' || daysTo(p.swap) <= 12)).sort((a, b) => a.swap - b.swap).forEach(p => {
        const st = p.status === 'missing' ? 'Missing' : p.status === 'faded' ? 'Faded' : daysTo(p.swap) < 0 ? 'Swap late' : 'Swap due';
        out.push({
          id: 'p' + p.n,
          kind: 'poster',
          shop: p.shop,
          city: p.city,
          what: `${st === 'Missing' ? 'Put up a new' : st === 'Faded' ? 'Replace' : 'Swap'} ${pid(p.n)}`,
          why: st === 'Missing' ? 'Gone from the window' : st === 'Faded' ? 'Faded in the sun' : daysTo(p.swap) <= 0 ? `${-daysTo(p.swap)} days late` : `Due ${fmtD(p.swap)}`,
          design: p.design,
          sev: st === 'Missing' ? 'absent' : st === 'Faded' || st === 'Swap late' ? 'underway' : 'line',
          mins: 18,
          n: p.n
        });
      });
      // merchant work, from the Merchants pipeline: prospect walk-ins, follow-ups, demos, signings
      [['m1', 'Mission Auto Care', 'Redlands', 'Demo the merchant app', 'Demo set for Thu 22 Oct', 'talking', 'marcus', 9000, 40], ['m2', 'Orange Show Tires', 'San Bernardino', 'Bring the numbers', 'Asked for pricing', 'talking', 'marcus', 7500, 30], ['m3', 'Sun Valley HVAC', 'Highland', 'Ride-along with the owner', 'Set for Fri', 'talking', 'marcus', 12000, 60], ['m4', 'Barton Rd. Appliance', 'Grand Terrace', 'Second visit', 'Liked the first pitch', 'talking', 'dana', 5500, 30], ['m5', 'Tri-City Transmission', 'San Bernardino', 'Talk terms', 'Wants NET-14 instead of NET-30', 'talking', 'marcus', 8000, 30], ['m6', 'Inland Cycle Works', 'Redlands', 'Sign the agreement', 'Founding seat 4 of 5', 'signing', 'kai', 0, 30], ['m7', 'Cypress Dental', 'Redlands', 'Meet the owner', 'Owner call Mon, visit after', 'talking', 'kai', 6000, 30], ['m8', 'Redlands Smog & Brake', 'Redlands', 'Walk in', 'Prospect · never visited', 'prospect', 'marcus', 5000, 15], ['m9', 'IE Mattress Outlet', 'Colton', 'Walk in', 'Prospect · never visited', 'prospect', 'dana', 6500, 15], ['m10', 'Fontana Furniture', 'Fontana', 'Walk in', 'Prospect · never visited', 'prospect', 'dana', 7000, 15]].forEach(([id, shop, city, what, why, stage, owner, val, mins]) => out.push({
        id,
        kind: 'merchant',
        shop,
        city,
        what,
        why,
        stage,
        owner,
        val,
        mins,
        sev: stage === 'signing' ? 'underway' : stage === 'talking' ? 'live' : 'line'
      }));
      out.push({
        id: 'd1',
        kind: 'device',
        shop: 'Cajon Phone Repair',
        city: 'San Bernardino',
        what: 'Re-pair the Tap reader',
        why: 'From Merchants · since Monday',
        sev: 'underway',
        mins: 20
      });
      out.push({
        id: 'd2',
        kind: 'device',
        shop: 'Highland Hardware',
        city: 'Highland',
        what: 'Drop off a receipt roll',
        why: 'From Merchants · asked yesterday',
        sev: 'line',
        mins: 10
      });
      out.push({
        id: 'n1',
        kind: 'new',
        shop: 'Magnolia Laundry',
        city: 'Riverside',
        what: 'Put up a first poster',
        why: 'From Placement · owner said yes',
        sev: 'live',
        mins: 25,
        design: 'B'
      });
      out.push({
        id: 'n2',
        kind: 'new',
        shop: 'Sierra Lakes Barber',
        city: 'Fontana',
        what: 'Put up a first poster',
        why: 'From Placement · owner said yes',
        sev: 'live',
        mins: 25,
        design: 'B'
      });
      return out;
    })();
    /* the coming week: routes already planned */
    const WEEK = [
    // day offset, who, stop ids (from POOL), planned
    {
      d: 0,
      who: 'marcus',
      live: true
    }, {
      d: 1,
      who: 'marcus',
      ids: []
    }, {
      d: 2,
      who: 'dana',
      ids: []
    }, {
      d: 5,
      who: 'marcus',
      ids: []
    }, {
      d: 6,
      who: null,
      ids: []
    }, {
      d: 7,
      who: null,
      ids: []
    }];
    Object.defineProperty(TEAM, 'viewer', {
      value: {
        n: 'Viewer',
        ini: 'VW',
        role: 'Read-only',
        field: false
      },
      enumerable: false
    });

    /* ══ Field maps: real streets, the full detail of OpenFreeMap's Positron, recoloured into the Command Center's palette ══
       Positron is the same detailed street style the Merchants corridor map uses. We fetch it, keep every layer, and remap each
       colour by how light or dark it is: Positron's background becomes our ground, anything darker leans toward our ink,
       anything lighter (road fills, halos) toward our raised tone. Parks take our land green, water a trace of our blue.
       So the hierarchy and detail stay, and it sits in the page like it belongs. Light and dark themes both work.
       Each slot keeps one live map for the session; renders re-attach it and update pins and lines without reloading tiles.
       Route lines follow real streets (OSRM); if routing can't be reached they fall back to straight legs. */
    // the reference loads MapLibre from a CDN; the app bundles it (its CSP allows only its own scripts), as the old
    // Merchants map does, and takes the style from env (live/map.ts: OpenFreeMap's positron unless set otherwise)
    const ML_STYLE = mapStyle();
    const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
    const FM = {
      slots: {},
      specs: {},
      lib: null,
      raw: null,
      routes: {}
    };
    function fmLib() {
      if (FM.lib) return FM.lib;
      FM.lib = (window.maplibregl ? Promise.resolve() : import('maplibre-gl').then(m => {
        window.maplibregl = m.default ?? m;
      }))
      // MapLibre's own sheet, inside the root, as the reference's link is
      .then(() => import('./fm2MapCss')).then(c => {
        const st = document.createElement('style');
        st.textContent = c.default;
        SR.appendChild(st);
      }).then(() => FM.raw || fetch(mapRequest(ML_STYLE).url).then(r => {
        if (!r.ok) throw 0;
        return r.json();
      }).then(j => {
        FM.raw = j;
      }));
      return FM.lib;
    }

    /* ── colour remapping ── */
    const fmTok = () => {
      const cs = getComputedStyle(document.documentElement),
        rgb = v => {
          const s = cs.getPropertyValue(v).trim();
          if (s.startsWith('#')) {
            const h = s.length === 4 ? s.slice(1).split('').map(c => c + c).join('') : s.slice(1, 7);
            return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
          }
          const m = s.match(/[\d.]+/g);
          return m ? m.slice(0, 3).map(Number) : [0, 0, 0];
        };
      return {
        fg: rgb('--fg'),
        ground: rgb('--ground'),
        raised: rgb('--raised'),
        land: rgb('--land'),
        live: rgb('--live'),
        dark: document.documentElement.dataset.theme === 'dark' || !document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches
      };
    };
    const mixc = (a, b, t) => a.map((v, i) => v * t + b[i] * (1 - t));
    const rgbs = (c, a = 1) => `rgba(${c.map(v => Math.round(Math.max(0, Math.min(255, v)))).join(',')},${+a.toFixed(3)})`;
    function parseCol(s) {
      // #rgb, #rrggbb, rgb(a), hsl(a) → [r,g,b,a] or null
      s = s.trim();
      let m;
      if (m = s.match(/^#([0-9a-f]{3,8})$/i)) {
        let h = m[1];
        if (h.length < 6) h = h.split('').map(c => c + c).join('');
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
      }
      if (m = s.match(/^rgba?\(([^)]+)\)$/i)) {
        const p = m[1].split(',').map(x => parseFloat(x));
        return [p[0], p[1], p[2], p[3] == null ? 1 : p[3]];
      }
      if (m = s.match(/^hsla?\(([^)]+)\)$/i)) {
        const p = m[1].split(',').map(x => parseFloat(x));
        const h = p[0] / 360,
          sa = p[1] / 100,
          l = p[2] / 100;
        const q = l < .5 ? l * (1 + sa) : l + sa - l * sa,
          pp = 2 * l - q,
          f = t => {
            t = (t + 1) % 1;
            return t < 1 / 6 ? pp + (q - pp) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? pp + (q - pp) * (2 / 3 - t) * 6 : pp;
          };
        return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255, p[3] == null ? 1 : p[3]];
      }
      return null;
    }
    function fmRemap(raw, T) {
      const LBG = .945; // Positron's background lightness
      const lum = c => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
      const conv = (s, hint) => {
        const c = parseCol(s);
        if (!c) return s;
        const L = lum(c);
        if (hint === 'water') return rgbs(mixc(T.live, T.ground, T.dark ? .22 : .14), c[3]);
        if (hint === 'park') return rgbs(mixc(T.land, T.ground, T.dark ? .22 : .16), c[3]);
        if (L >= LBG) return rgbs(mixc(T.raised, T.ground, Math.min(1, (L - LBG) / (1 - LBG)) * (T.dark ? .8 : 1.6)), c[3]);
        const t = Math.min(1, Math.pow((LBG - L) / LBG, .85) * 1.12);
        return rgbs(mixc(T.fg, T.ground, t), c[3]);
      };
      const walk = (v, hint) => typeof v === 'string' ? conv(v, hint) : Array.isArray(v) ? v.map(x => walk(x, hint)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, hint)])) : v;
      const st = JSON.parse(JSON.stringify(raw));
      st.layers = st.layers.filter(l => !/^label_country|^label_state|boundary_disputed|ne2_shaded/.test(l.id) && l.source !== 'ne2_shaded').map(l => {
        const hint = /water/.test(l.id) && l.type !== 'symbol' ? 'water' : /^park|landcover_wood|landcover_grass/.test(l.id) ? 'park' : null;
        if (l.paint) l.paint = walk(l.paint, hint);
        if (l.type === 'symbol' && l.layout && /^label_(city|town|village|other)/.test(l.id)) l.layout = Object.assign({}, l.layout, {
          'text-transform': 'uppercase',
          'text-letter-spacing': .12
        });
        return l;
      });
      delete st.sources.ne2_shaded;
      return st;
    }
    function fmStyle() {
      return fmRemap(FM.raw, fmTok());
    }

    /* ── our layers: the route, cased so it reads over streets ── */
    function fmRouteLayers() {
      const T = fmTok(),
        fg = rgbs(T.fg),
        gr = rgbs(T.ground);
      return [{
        id: 'route-case',
        type: 'line',
        source: 'route',
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        },
        paint: {
          'line-color': gr,
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 6, 15, 10],
          'line-opacity': .9
        }
      }, {
        id: 'route-next',
        type: 'line',
        source: 'route',
        filter: ['==', ['get', 'k'], 'next'],
        layout: {
          'line-cap': 'butt',
          'line-join': 'round'
        },
        paint: {
          'line-color': fg,
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.4, 15, 4],
          'line-dasharray': [1.6, 1.4],
          'line-opacity': .75
        }
      }, {
        id: 'route-done',
        type: 'line',
        source: 'route',
        filter: ['==', ['get', 'k'], 'done'],
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        },
        paint: {
          'line-color': fg,
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3, 15, 5]
        }
      }];
    }
    /* legs: road-following geometry when we have it, straight lines until then */
    const fmKey = pts => pts.map(p => p.map(v => v.toFixed(4)).join(',')).join(';');
    function fmRouteGeo(spec) {
      const pts = spec.route || [];
      if (pts.length < 2) return {
        type: 'FeatureCollection',
        features: []
      };
      const legs = FM.routes[fmKey(pts)] || pts.slice(1).map((p, i) => [pts[i], p]);
      return {
        type: 'FeatureCollection',
        features: legs.map((coords, i) => ({
          type: 'Feature',
          properties: {
            k: i < (spec.done || 0) ? 'done' : 'next'
          },
          geometry: {
            type: 'LineString',
            coordinates: coords
          }
        }))
      };
    }
    function fmRoute(slot) {
      const spec = FM.specs[slot],
        pts = spec && spec.route;
      if (!pts || pts.length < 2) return;
      const key = fmKey(pts);
      if (FM.routes[key] || FM.routes[key + '?']) return;
      FM.routes[key + '?'] = 1;
      fetch(`${OSRM}${pts.map(p => p.join(',')).join(';')}?overview=full&geometries=geojson`).then(r => r.json()).then(j => {
        if (!j.routes || !j.routes[0]) return;
        const line = j.routes[0].geometry.coordinates,
          wp = j.waypoints.map(w => w.location);
        // split the whole line at each waypoint (walking forward), so each leg can be coloured done or next
        const near = (from, p) => {
          let bi = from,
            bd = 1e9;
          for (let i = from; i < line.length; i++) {
            const d = (line[i][0] - p[0]) ** 2 + (line[i][1] - p[1]) ** 2;
            if (d < bd) {
              bd = d;
              bi = i;
            }
          }
          return bi;
        };
        const cut = [0];
        for (let i = 1; i < wp.length - 1; i++) cut.push(near(cut[cut.length - 1], wp[i]));
        cut.push(line.length - 1);
        FM.routes[key] = cut.slice(1).map((c, i) => line.slice(cut[i], c + 1));
        Object.keys(FM.slots).forEach(s => {
          const sp = FM.specs[s];
          if (sp && sp.route && fmKey(sp.route) === key) fmApply(s);
        });
      }).catch(() => {});
    }
    function fmApply(slot) {
      const s = FM.slots[slot],
        spec = FM.specs[slot];
      if (!s || !s.map || !s.ok || !spec) return;
      const style = s.map.getStyle();
      if (!style.sources.route) s.map.addSource('route', {
        type: 'geojson',
        data: fmRouteGeo(spec)
      });else s.map.getSource('route').setData(fmRouteGeo(spec));
      if (!style.layers.find(l => l.id === 'route-case')) fmRouteLayers().forEach(l => s.map.addLayer(l));
      fmRoute(slot);
      (s.marks || []).forEach(m => m.remove());
      s.marks = (spec.pins || []).map(p => {
        const el = document.createElement('div');
        html(el, p.html);
        const node = el.firstElementChild;
        return new maplibregl.Marker({
          element: node,
          anchor: 'center'
        }).setLngLat(p.ll).addTo(s.map);
      });
      s.marks.forEach(m => {
        const e = m.getElement();
        if (e.classList.contains('fsp')) e.style.zIndex = e.classList.contains('now') ? 3 : e.classList.contains('done') ? 1 : 2;
      });
      fmLayoutLive(slot);
      const key = JSON.stringify(spec.bounds);
      if (key !== s.boundsKey) {
        s.boundsKey = key;
        s.map.fitBounds(spec.bounds, {
          padding: spec.pad || 40,
          duration: s.fitted ? 500 : 0,
          maxZoom: 14
        });
        s.fitted = true;
      }
    }
    /* ── stop tags: place each tag near its dot without covering another tag or any dot ──
       anchors and sizes in px; returns each tag's centre offset from its dot. Works the same on the drawn and the live map. */
    function fmPlaceTags(anchors, sizes, W, H, prefer) {
      const n = anchors.length,
        D = 16;
      // start each tag pointing away from its close neighbours, so a tight cluster fans out instead of stacking
      const pos = anchors.map((a, i) => {
        const nb = anchors.filter((b, j) => j !== i && Math.hypot(b[0] - a[0], b[1] - a[1]) < 60);
        let dx = 0,
          dy = -1;
        if (nb.length) {
          const cx = nb.reduce((s, b) => s + b[0], 0) / nb.length,
            cy = nb.reduce((s, b) => s + b[1], 0) / nb.length;
          dx = a[0] - cx;
          dy = a[1] - cy;
          const d = Math.hypot(dx, dy);
          if (d < .5) {
            dx = Math.cos(i * 2.4);
            dy = Math.sin(i * 2.4);
          } else {
            dx /= d;
            dy /= d;
          }
        }
        return [a[0] + dx * (D + sizes[i][0] / 2), a[1] + dy * (D + sizes[i][1] / 2)];
      });
      const hw = i => sizes[i][0] / 2 + 3,
        hh = i => sizes[i][1] / 2 + 3;
      for (let it = 0; it < 140; it++) {
        for (let i = 0; i < n; i++) {
          // spring back toward a spot just off the dot, in whatever direction the tag has been pushed
          let dx = pos[i][0] - anchors[i][0],
            dy = pos[i][1] - anchors[i][1],
            d = Math.hypot(dx, dy);
          if (d < .1) {
            dx = 0;
            dy = -1;
            d = 1;
          }
          const want = D + Math.max(sizes[i][1] / 2, Math.abs(dx / d) * sizes[i][0] / 2) - 4,
            k = .12;
          pos[i][0] += (anchors[i][0] + dx / d * want - pos[i][0]) * k;
          pos[i][1] += (anchors[i][1] + dy / d * want - pos[i][1]) * k;
        }
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
          // tags push each other apart
          const ox = hw(i) + hw(j) - Math.abs(pos[i][0] - pos[j][0]),
            oy = hh(i) + hh(j) - Math.abs(pos[i][1] - pos[j][1]);
          if (ox > 0 && oy > 0) {
            if (ox < oy) {
              const s = (pos[i][0] < pos[j][0] ? -1 : 1) * ox / 2;
              pos[i][0] += s;
              pos[j][0] -= s;
            } else {
              const s = (pos[i][1] < pos[j][1] ? -1 : 1) * oy / 2;
              pos[i][1] += s;
              pos[j][1] -= s;
            }
          }
        }
        for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
          // and never sit on a dot
          const ox = hw(i) + 5 - Math.abs(pos[i][0] - anchors[k][0]),
            oy = hh(i) + 5 - Math.abs(pos[i][1] - anchors[k][1]);
          if (ox > 0 && oy > 0) {
            if (ox < oy) pos[i][0] += (pos[i][0] < anchors[k][0] ? -1 : 1) * ox;else pos[i][1] += (pos[i][1] < anchors[k][1] ? -1 : 1) * oy;
          }
        }
        for (let i = 0; i < n; i++) {
          pos[i][0] = Math.max(hw(i) + 2, Math.min(W - hw(i) - 2, pos[i][0]));
          pos[i][1] = Math.max(hh(i) + 2, Math.min(H - hh(i) - 2, pos[i][1]));
        }
      }
      return pos.map((p, i) => [p[0] - anchors[i][0], p[1] - anchors[i][1]]);
    }
    function fmSetTags(els, offs) {
      els.forEach((el, i) => {
        const [dx, dy] = offs[i],
          t = el.querySelector('.fsp-t'),
          ln = el.querySelector('line');
        t.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px))`;
        // the leader runs from the dot to the nearest edge of the tag
        const w = t.offsetWidth / 2,
          h = t.offsetHeight / 2,
          s = Math.min(w / Math.abs(dx || 1e-6), h / Math.abs(dy || 1e-6), 1),
          ex = dx - dx * s,
          ey = dy - dy * s;
        ln.setAttribute('x2', ex.toFixed(1));
        ln.setAttribute('y2', ey.toFixed(1));
        el.classList.toggle('near', Math.hypot(ex, ey) < 5);
      });
    }
    function fmLayoutDrawn() {
      document.querySelectorAll('.fm-fb .fmw').forEach(box => {
        const els = [...box.querySelectorAll('.fsp')];
        if (!els.length) return;
        const W = box.clientWidth,
          H = box.clientHeight;
        if (!W) return;
        const anchors = els.map(e => [parseFloat(e.style.left) / 100 * W, parseFloat(e.style.top) / 100 * H]),
          sizes = els.map(e => {
            const t = e.querySelector('.fsp-t');
            return [t.offsetWidth, t.offsetHeight];
          });
        fmSetTags(els, fmPlaceTags(anchors, sizes, W, H));
      });
    }
    function fmLayoutLive(slot) {
      const s = FM.slots[slot];
      if (!s || !s.map || !s.marks || !s.marks.length) return;
      const els = s.marks.map(m => m.getElement()).filter(e => e.classList.contains('fsp'));
      if (!els.length) return;
      const W = s.el.clientWidth,
        H = s.el.clientHeight,
        anchors = s.marks.map(m => {
          const p = s.map.project(m.getLngLat());
          return [p.x, p.y];
        });
      fmSetTags(els, fmPlaceTags(anchors, els.map(e => {
        const t = e.querySelector('.fsp-t');
        return [t.offsetWidth, t.offsetHeight];
      }), W, H));
    }
    /* stops a few streets apart sit on top of each other when zoomed out: nudge their pins apart on screen, never on the map */
    function fmSpread(slot) {
      const s = FM.slots[slot];
      if (!s || !s.map || !s.marks || !s.marks.length) return;
      const pts = s.marks.map(m => s.map.project(m.getLngLat())),
        off = pts.map(() => [0, 0]);
      for (let it = 0; it < 24; it++) for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[j].x + off[j][0] - pts[i].x - off[i][0],
          dy = pts[j].y + off[j][1] - pts[i].y - off[i][1],
          d = Math.hypot(dx, dy) || .01;
        if (d < 30) {
          const k = (30 - d) / 2 / d;
          off[i][0] -= dx * k;
          off[i][1] -= dy * k;
          off[j][0] += dx * k;
          off[j][1] += dy * k;
        }
      }
      s.marks.forEach((m, i) => {
        m.setOffset(off[i]);
        m.getElement().classList.toggle('moved', Math.hypot(...off[i]) > 4);
      });
    }
    /* a name label near the right edge would be cut off: put it on the left instead */
    function fmFlip(slot) {
      const s = FM.slots[slot];
      if (!s || !s.map || !s.marks) return;
      const w = s.el.clientWidth;
      s.marks.forEach(m => {
        const x = s.map.project(m.getLngLat()).x + (m.getOffset().x || 0);
        m.getElement().querySelector('.fpin')?.classList.toggle('flip', x > w - 190);
      });
    }
    function fmInit(slot) {
      const s = FM.slots[slot],
        spec = FM.specs[slot];
      if (!window.maplibregl || !FM.raw) {
        return fmFail(slot);
      }
      let tiles = false,
        errs = 0;
      try {
        s.map = new maplibregl.Map({
          container: s.el,
          style: fmStyle(),
          transformRequest: url => mapRequest(url),
          bounds: spec.bounds,
          fitBoundsOptions: {
            padding: spec.pad || 40,
            maxZoom: 14
          },
          attributionControl: {
            compact: true
          },
          scrollZoom: false,
          dragRotate: false,
          pitchWithRotate: false,
          cooperativeGestures: matchMedia('(max-width:760px)').matches
        });
      } catch (e) {
        return fmFail(slot);
      }
      s.boundsKey = JSON.stringify(spec.bounds);
      s.fitted = true;
      s.map.touchZoomRotate.disableRotation();
      s.map.addControl(new maplibregl.NavigationControl({
        showCompass: false
      }), 'top-right');
      const live = () => {
        if (s.live || s.fail) return;
        s.live = true;
        const h = document.querySelector(`[data-fmslot="${slot}"]`);
        h && h.classList.add('live');
        s.map.resize();
      };
      s.map.on('data', e => {
        if (e.dataType === 'source' && e.tile) {
          tiles = true;
          if (s.ok) live();
        }
      });
      s.map.on('error', () => {
        errs++;
        if (!tiles && errs >= 4) fmFail(slot);
      });
      s.map.on('load', () => {
        s.ok = true;
        fmApply(slot);
        if (tiles) live();
      });
      let raf = 0;
      s.map.on('move', () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => fmLayoutLive(slot));
      });
      setTimeout(() => {
        if (!tiles) fmFail(slot);
      }, 10000);
    }
    function fmFail(slot) {
      const s = FM.slots[slot];
      if (!s) return;
      s.fail = true;
      s.live = false;
      try {
        s.map && s.map.remove();
      } catch (e) {}
      s.map = null;
      const h = document.querySelector(`[data-fmslot="${slot}"]`);
      h && h.classList.remove('live');
    }
    /* called after every render: put each slot's live map back in place and update it */
    function fmMountAll() {
      document.querySelectorAll('[data-fmslot]').forEach(host => {
        const slot = host.dataset.fmslot;
        let s = FM.slots[slot];
        if (!s) {
          s = FM.slots[slot] = {
            el: document.createElement('div')
          };
          s.el.className = 'fm-gl';
          fmLib().then(() => fmInit(slot), () => fmFail(slot));
        }
        if (s.fail) return;
        host.querySelector('.fm-slot').appendChild(s.el);
        if (s.live) host.classList.add('live');
        if (s.map) {
          s.map.resize();
          fmApply(slot);
        }
      });
    }
    /* a map slot: the drawn map shows until the live one is ready, then hides */
    const fmSlot = (slot, spec, fallback, cls = '') => {
      FM.specs[slot] = spec;
      return <div className={`fmh ${cls}`} data-fmslot={slot}><div className="fm-fb">{fallback}</div><div className="fm-slot" /></div>;
    };
    /* theme change: rebuild the colours on every live map */
    function fmRestyle() {
      Object.entries(FM.slots).forEach(([slot, s]) => {
        if (!s.map || !s.ok || !FM.raw) return;
        s.map.setStyle(fmStyle());
        s.map.once('styledata', () => fmApply(slot));
      });
    }

    /* ══ Plan: everyone's routes for the coming days ═════════════════════════════════════════════
       The week is shared: every route, for everyone, by day. A route belongs to one person on one day.
       Who can do what comes from the signed-in person (Permissions), not a switch on the page:
       · an admin plans any route and assigns it to themselves or to anyone with Field access, then sends it;
       · someone with Field access (a rep) plans only their own routes and saves them; everyone else's are read-only.
       A route is more than posters: merchant work from the Merchants pipeline (walk-ins, follow-ups, demos, signings)
       and counter-device fixes go on it too. Routes don't move money, so there's no second approval. */
    const dayT = d => TODAY + d * DAY;
    const POOLBY = Object.fromEntries(POOL.map(x => [x.id, x]));
    const DAYS = LV ? LV.DAYS : [1, 2, 5, 6, 7];
    const STARTS = {
      office: ['Office', 'Redlands', [34.0556, -117.1825]],
      marcus: ['Marcus’s place', 'San Bernardino', [34.1170, -117.3010]],
      dana: ['Dana’s place', 'Riverside', [33.9530, -117.3960]],
      kai: ['Kai’s place', 'Redlands', [34.0420, -117.1700]]
    };
    const R = {
      me: LV ? LV.meK : 'kai',
      sel: 'r1',
      pf: 'all',
      // live, no route is planned to be near to: the most urgent first
      near: !LV,
      show: false,
      snoozed: new Set(),
      dropped: new Set(),
      adhoc: 0,
      nid: 9,
      panel: null,
      q: '',
      addSel: null,
      addTask: 'check',
      drag: null,
      // live, no routes are planned ahead yet (docs/ui-redesign-plan.md, gaps)
      routes: LV ? [] : [{
        id: 'r1',
        d: 1,
        who: 'marcus',
        ids: ['p90', 'n1', 'p63'],
        status: 'draft',
        by: 'kai',
        start: 'office'
      }, {
        id: 'r2',
        d: 1,
        who: 'dana',
        ids: ['m4', 'm9'],
        status: 'sent',
        by: 'kai',
        start: 'dana',
        sentAt: 'Wed 21 Oct, 08:10'
      }, {
        id: 'r3',
        d: 2,
        who: 'dana',
        ids: ['d1', 'd2'],
        status: 'accepted',
        by: 'kai',
        start: 'dana',
        sentAt: 'Tue 20 Oct',
        okAt: 'Tue 20 Oct'
      }, {
        id: 'r4',
        d: 2,
        who: 'marcus',
        ids: ['m3', 'p55'],
        status: 'accepted',
        by: 'marcus',
        start: 'marcus',
        okAt: 'Wed 21 Oct, 07:55'
      }, {
        id: 'r5',
        d: 5,
        who: 'kai',
        ids: ['m6', 'm7'],
        status: 'accepted',
        by: 'kai',
        start: 'kai',
        okAt: 'Tue 20 Oct'
      }]
    };
    const ME = () => TEAM[R.me],
      isAdmin = () => !RO() && !!ME().admin;
    const RT = id => R.routes.find(r => r.id === id);
    const routeOf = item => R.routes.find(r => r.ids.includes(item)) || null;
    const dayOf = item => {
      const r = routeOf(item);
      return r ? r.d : null;
    };
    const canEdit = r => !RO() && !!r && (isAdmin() || r.who === R.me);
    const firstName = k => TEAM[k].n.split(' ')[0];
    const stopsOf = r => r.ids.map(id => POOLBY[id]).filter(Boolean);
    const km = (a, b) => {
      const dl = (b[0] - a[0]) * Math.PI / 180,
        dn = (b[1] - a[1]) * Math.PI / 180,
        h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dn / 2) ** 2;
      return 2 * 6371 * Math.asin(Math.sqrt(h)) * 1.3;
    }; // road ≈ 1.3× straight line
    const llOf = x => shopLL(x.shop, x.city);
    const drive = (a, b) => Math.round(3 + km(a, b) * 1.4);
    const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
    const hm = m => m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
    function plan(r) {
      const st = stopsOf(r),
        home = STARTS[r.start][2];
      let t = 9 * 60,
        at = home,
        miles = 0;
      const times = [];
      st.forEach(x => {
        const ll = llOf(x);
        t += drive(at, ll);
        miles += km(at, ll);
        times.push(t);
        t += x.mins;
        at = ll;
      });
      if (st.length) {
        t += drive(at, home);
        miles += km(at, home);
      }
      return {
        st,
        times,
        mins: st.length ? t - 9 * 60 : 0,
        back: st.length ? hhmm(t) : null,
        miles: Math.round(miles * 0.621)
      };
    }
    function bestOrder(r) {
      const left = stopsOf(r);
      let at = STARTS[r.start][2];
      const out = [];
      while (left.length) {
        left.sort((a, b) => km(at, llOf(a)) - km(at, llOf(b)));
        const n = left.shift();
        out.push(n.id);
        at = llOf(n);
      }
      r.ids = out;
    }
    R.routes.forEach(bestOrder);
    const STATUS = {
      draft: ['Draft', ''],
      sent: ['Sent', 'tlv'],
      accepted: ['Accepted', 'ok']
    };
    const statusChip = r => {
      const [t, c] = STATUS[r.status];
      return <span className={`fst ${c}`}>{t}</span>;
    };
    /* a change to a route someone else already has sends it back to draft, so it gets sent again */
    const dirty = r => {
      if (!r) return;
      if (r.status !== 'draft' && r.who !== R.me) {
        r.status = 'draft';
        r.changed = true;
      } else if (r.who === R.me && r.status === 'accepted') {
        r.status = 'draft';
        r.changed = true;
      }
    };
    const KIND = {
      poster: 'Poster',
      new: 'New poster',
      device: 'Counter device',
      merchant: 'Merchant',
      visit: 'Visit'
    };
    const STAGES_M = [['prospect', 'Prospect'], ['talking', 'Talking'], ['signing', 'Signing'], ['signed', 'Signed']];
    const tomorrowFor = who => R.routes.find(r => r.d === 1 && r.who === who) || R.routes.find(r => r.d === 1);
    /* the signed-in person comes from the app: Kai, or whoever this view belongs to */
    function renderMe() {
      const k = meKey();
      if (R.me === k) return;
      R.me = k;
      R.panel = null;
      const own = R.routes.find(x => x.who === R.me);
      if (own && !canEdit(RT(R.sel))) R.sel = own.id;
    }
    function renderPlan() {
      renderMe();
      let r = RT(R.sel);
      if (!r) {
        r = R.routes.find(x => x.who === R.me) || R.routes[0];
        R.sel = r && r.id;
      }
      const me = R.me,
        edit = canEdit(r),
        P = r ? plan(r) : null;
      /* the week: one fixed-height strip for the whole team. Each day: the date, one avatar per route (the ring is its status),
         how much of the team's field time is used, and the one thing that needs you. More than five people collapse into +N. */
      const fieldN = Object.values(TEAM).filter(t => t.field).length,
        CAP = Math.max(1, fieldN) * 300;
      // live, nothing stores a route planned ahead, so none is started here
      const canAddOn = d => !LV && (isAdmin() || !R.routes.some(x => x.d === d && x.who === me));
      const av = x => <button className={`fwa ${x.status} ${R.sel === x.id ? 'on' : ''} ${x.who === me ? 'me' : ''}`} data-froute={x.id} aria-pressed={R.sel === x.id} title={`${x.who === me ? 'You' : TEAM[x.who].n} · ${STATUS[x.status][0]} · ${plan(x).st.length} stops`}>{TEAM[x.who].ini}</button>;
      const dayCol = (d, live) => {
        const rs = live ? [] : R.routes.filter(x => x.d === d),
          mins = live ? LV ? STOPS.length * (LV.ROUTE.minutesPerStop || 0) : 8 * 34 : rs.reduce((s, x) => s + plan(x).mins, 0),
          stops = live ? LV ? STOPS.length : 8 : rs.reduce((s, x) => s + x.ids.length, 0);
        const selHere = rs.some(x => x.id === R.sel),
          dt = new Date(dayT(live ? 0 : d)),
          toSend = rs.filter(x => x.status === 'draft' && x.ids.length && x.who !== me).length,
          mineDraft = rs.filter(x => x.status === 'draft' && x.who === me && x.ids.length).length,
          waiting = rs.filter(x => x.status === 'sent').length;
        const need = live ? LV ? STOPS.length ? <span className="tlv">{`${staffFirst()} is on stop ${Math.min(STOPS.length, STOPS.filter(stopDone).length + 1)} of ${STOPS.length}`}</span> : <span className="quiet">Nobody out</span> : <span className="tlv">{"Marcus is on stop "}{STOPS.filter(stopDone).length + 1}{" of 8"}</span> : !rs.length ? <span className="quiet">Nobody out</span> : toSend && isAdmin() ? <span className="warn">{toSend}{" not sent"}</span> : mineDraft ? <span className="warn">Yours isn’t saved</span> : waiting ? <span className="tlv">{waiting}{" waiting to accept"}</span> : <span className="ok">All set</span>;
        const shown = rs.slice(0, 5),
          more = rs.length - shown.length,
          selOver = more && rs.slice(5).some(x => x.id === R.sel);
        const segs = live ? <i className="me" style={css(`width:${mins / CAP * 100}%`)} /> : rs.map((x, __k) => <i key={__k} className={x.id === R.sel ? 'on' : ''} style={css(`width:${plan(x).mins / CAP * 100}%`)} />);
        return <div className={`fwd3 ${live ? 'live' : ''} ${selHere ? 'sel' : ''}`}><div className="fwd3-h"><span className="lbl">{live ? 'Today' : d === 1 ? 'Tomorrow' : WD[dt.getUTCDay()]}</span>{!live && canAddOn(d) ? <button className="fwd3-add" data-fnewroute={d} aria-label={`${isAdmin() ? 'New route' : 'Plan my route'} on ${fmtWD(dayT(d))}`}>+</button> : ''}</div><div className="fwd3-n"><b>{dt.getUTCDate()}</b><span>{MON[dt.getUTCMonth()]}</span></div><div className="fwd3-a">{live ? LV ? STOPS.length ? <span className="fwa live">{TEAM[LV.staffK]?.ini || '·'}</span> : <span className="fwa none" /> : <span className="fwa live">ML</span> : shown.map((x, i) => <Fragment key={i}>{av(x, i)}</Fragment>)}{more ? <button className={`fwa more ${selOver ? 'on' : ''}`} data-fdaymore={d} title={rs.slice(5).map(x => TEAM[x.who].n).join(', ')}>+{more}</button> : ''}{!live && !rs.length ? <span className="fwa none" /> : ''}</div><div className="fwd3-b"><span className="fwd3-bar">{segs}</span><span className="fwd3-t">{stops ? `${stops} stop${stops === 1 ? '' : 's'} · ${hm(mins)}` : '–'}</span></div><div className="fwd3-s">{need}</div></div>;
      };
      const week = <div className="cell s12"><div className="hd"><h2>The week</h2><div className="r"><span className="lbl">{fieldN}{LV && fieldN === 1 ? ' person with Field access' : " people with Field access"}</span></div></div><div className="fwk3">{dayCol(0, true)}{DAYS.map(d => <Fragment key={d}>{dayCol(d, false)}</Fragment>)}</div><div className="bk-ft"><span>{"The bar is the team’s field time used, out of "}{fieldN}{" × 5 hours. "}{isAdmin() ? 'Click a person to open their route.' : 'You can change your own routes.'}</span><span className="f-key fsq-k"><i className="fsq draft" />{"Draft "}<i className="fsq sent" />{"Sent "}<i className="fsq accepted" />Accepted</span></div></div>;

      /* what needs a visit */
      const center = P && P.st.length ? [P.st.reduce((s, x) => s + llOf(x)[0], 0) / P.st.length, P.st.reduce((s, x) => s + llOf(x)[1], 0) / P.st.length] : STARTS[r ? r.start : 'office'][2];
      const sevRank = {
        absent: 0,
        underway: 1,
        live: 2,
        line: 3
      };
      const kindOk = x => R.pf === 'all' || (R.pf === 'poster' ? x.kind === 'poster' || x.kind === 'new' : x.kind === R.pf);
      let items = POOL.filter(x => !R.dropped.has(x.id) && (R.show || !R.snoozed.has(x.id)) && kindOk(x));
      items.sort((a, b) => R.near ? km(center, llOf(a)) - km(center, llOf(b)) : sevRank[a.sev] - sevRank[b.sev]);
      const unplanned = POOL.filter(x => !R.dropped.has(x.id) && !R.snoozed.has(x.id) && !routeOf(x.id)).length;
      const poolRow = x => {
        const on = routeOf(x.id),
          here = r && on === r,
          dist = Math.round(km(center, llOf(x)) * 0.621),
          moveOk = !on || canEdit(on);
        const act = !edit ? '' : here ? <button className="btn sm-b on" data-fadd={x.id} aria-label={`Take ${x.shop} off this route`}>Added ✓</button> : on && !moveOk ? <span className="fp-taken">{firstName(on.who)}{" · "}{fmtWD(dayT(on.d)).slice(0, 3)}</span> : on ? <button className="btn sm-b" data-fadd={x.id}>Move here</button> : <button className="btn sm-b" data-fadd={x.id}>Add</button>;
        const lead = x.kind === 'merchant' && x.owner ? <span className={`fch ${x.owner === me ? 'ok' : ''}`}>{x.owner === me ? 'Your lead' : firstName(x.owner) + '’s lead'}</span> : '';
        return <div className={`fp-r ${here ? 'on' : ''} ${R.snoozed.has(x.id) ? 'snz' : ''}`}><i className="fl-sv" style={css(`background:${sevCol(x.sev)}`)} /><button className="fp-k" data-fitem={x.id}><b>{x.shop}</b><span>{x.what}{" · "}{x.why}</span></button><span className="fp-m">{lead || (on && !here ? <span className="fch">{fmtWD(dayT(on.d)).slice(0, 3)}</span> : R.snoozed.has(x.id) ? <span className="fch">Snoozed</span> : LV ? x.city : `${dist} mi`)}</span>{act}</div>;
      };
      const nK = k => POOL.filter(x => !R.dropped.has(x.id) && !routeOf(x.id) && (k === 'poster' ? x.kind === 'poster' || x.kind === 'new' : x.kind === k)).length;
      const pool = <div className="cell s5" id="fpool"><div className="hd"><h2>Needs a visit</h2><div className="r"><span className="lbl">{unplanned}{" not planned"}</span></div></div><div className="fp-tb"><div className="seg sm" role="group" aria-label="Show">{[['all', 'All'], ['poster', 'Posters'], ['merchant', 'Merchants'], ['device', 'Devices']].map(([k, t], __k) => <button key={__k} data-fpf2={k} aria-pressed={R.pf === k}>{t}</button>)}</div><div className="seg sm" role="group" aria-label="Sort">{[[true, 'Nearest'], [false, 'Most urgent']].map(([k, t], __k) => <button key={__k} data-fnear={k} aria-pressed={R.near === k}>{t}</button>)}</div></div><div className="fp-l">{items.length ? items.map((x, i) => <Fragment key={i}>{poolRow(x, i)}</Fragment>) : <p className="small quiet" style={css("padding:16px 22px;margin:0")}>Nothing here needs a visit.</p>}</div><div className="bk-ft"><span>{R.pf === 'merchant' ? 'From the Merchants pipeline' : R.near ? 'Nearest to this route first' : 'Most urgent first'}{R.snoozed.size ? ` · ${R.snoozed.size} snoozed` : ''}</span>{R.pf === 'merchant' ? <button data-fgo="merchants/pipeline">Pipeline · Merchants →</button> : R.snoozed.size ? <button data-fshowsnz="">{R.show ? 'Hide' : 'Show'}{" snoozed"}</button> : <span />}</div></div>;

      /* the selected route */
      let builder;
      if (!r && LV) builder = notReal('s7', 'Routes ahead', 'Needs routes planned for the coming days: who goes, which stops, and whether they’ve accepted. Today’s route comes from the phone.', 'froute');
      else if (!r) {
        builder = <div className="cell s7" id="froute"><div className="hd"><h2>No route picked</h2></div><div className="fb"><div className="fb-empty" style={css("padding:28px 22px")}><b>Pick a route in the week</b><span>{"Or add one with + "}{isAdmin() ? 'Route' : 'My route'}.</span></div></div><div className="f-ft2"><span /><span /></div></div>;
      } else {
        const ov = P.mins > 300,
          own = r.who === me,
          field = Object.entries(TEAM).filter(([, t]) => t.field);
        const stopRow = (x, i) => <div className="fb-r" draggable={edit} data-fdrag={i}><span className="fb-h" aria-hidden="true">{edit ? '⠿' : ''}</span><span className="fb-n">{i + 1}</span><button className="fs-k" data-fitem={x.id}><b>{x.shop}</b><span>{KIND[x.kind]}{" · "}{x.what}</span></button><span className="fs-e">{hhmm(P.times[i])}</span>{edit ? <span className="fb-a"><button data-fmv={`${i}|-1`} {...attrs(i === 0 ? 'disabled' : '')} aria-label="Move up">↑</button><button data-fmv={`${i}|1`} {...attrs(i === P.st.length - 1 ? 'disabled' : '')} aria-label="Move down">↓</button><button data-fadd={x.id} aria-label={`Take ${x.shop} off`}>{ICO.x}</button></span> : ''}</div>;
        const whoCtl = isAdmin() ? <label className="fb-sel"><span className="lbl">Assigned to</span><select id="fwho" defaultValue={r.who}>{field.map(([k, t], __k) => <option key={__k} value={k} {...picked(r.who === k)}>{k === me ? 'Me (' + t.n + ')' : t.n}</option>)}</select></label> : <span className="lbl">{own ? 'Your route' : TEAM[r.who].n + '’s route · read-only'}</span>;
        const foot = !edit ? <div className="f-ft2"><span className="small quiet">{"Planned by "}{r.by === r.who ? firstName(r.who) : firstName(r.by)}{" · only "}{firstName(r.who)}{" or an admin can change it"}</span><span /></div> : own ? <div className="f-ft2"><span className="small quiet">{r.status === 'accepted' ? `Saved · it’s on your phone${!isAdmin() ? ' and Kai can see it' : ''}` : r.changed ? 'Changed since you saved it' : 'Draft · save it to put it on your phone'}</span><button className="btn p" data-fsaveme="" {...attrs(!P.st.length || r.status === 'accepted' ? 'disabled' : '')}>{r.status === 'accepted' ? 'Saved ✓' : 'Save my route'}</button></div> : r.status === 'sent' ? <div className="f-ft2"><span className="small quiet">{"Sent "}{r.sentAt}{" · waiting for "}{firstName(r.who)}{" to accept"}</span><button className="lnk3" data-funsend="">Take it back</button></div> : r.status === 'accepted' ? <div className="f-ft2"><span className="small"><b className="ok">{firstName(r.who)}{" "}{r.by === r.who ? 'planned and saved it' : 'accepted'}</b>{" "}<span className="quiet">{"· "}{r.okAt}</span></span><span className="small quiet">Changing it sends it again</span></div> : <div className="f-ft2"><span className="small quiet">{r.changed ? 'Changed since it was sent' : 'Draft · only you can see it'}</span><button className="btn p" data-fsend="" {...attrs(!P.st.length ? 'disabled' : '')}>{"Send to "}{firstName(r.who)}</button></div>;
        const sib = R.routes.filter(x => x.d === r.d);
        builder = <div className="cell s7" id="froute"><div className="hd"><h2>{fmtWD(dayT(r.d))}</h2>{statusChip(r)}<div className="r">{whoCtl}</div></div>{sib.length > 1 ? <div className="fsib" role="tablist" aria-label={`Routes on ${fmtWD(dayT(r.d))}`}>{sib.map((x, __k) => <button key={__k} role="tab" aria-selected={x.id === r.id} data-froute={x.id}><span className="av sm">{TEAM[x.who].ini}</span>{x.who === me ? 'You' : TEAM[x.who].n}<i className={`fsq ${x.status}`} /></button>)}</div> : ''}<div className="fb"><div className="fb-m" data-fit="plan">{fitMap('plan', a => routeMap('plan', P.st.map(x => ({
                name: x.shop,
                city: x.city
              })), -1, a), 2.6)}</div><div className="fb-s"><div><span className="lbl">Stops</span><b>{P.st.length}</b></div><div><span className="lbl">About</span><b className={ov ? 'warn' : ''}>{P.st.length ? hm(P.mins) : '–'}</b></div><div><span className="lbl">Miles</span><b>{P.st.length ? P.miles : '–'}</b></div><div><span className="lbl">Back by</span><b>{P.back || '–'}</b></div></div>{edit ? <div className="fb-tb"><label className="fb-sel"><span className="lbl">Start</span><select id="fstart" defaultValue={r.start}>{Object.entries(STARTS).filter(([k]) => k === 'office' || k === r.who).map(([k, [n]], __k) => <option key={__k} value={k} {...picked(r.start === k)}>{n}</option>)}</select></label><span className="fb-tbr"><button className="btn sm-b" data-fbest="" {...attrs(P.st.length < 3 ? 'disabled' : '')}>Best order</button><button className="btn sm-b" data-faddstop="">+ Add a stop</button></span></div> : ''}{ov ? <div className="fair fb-warn">{ICO.warn}<span>That’s over a 5-hour day. Move a stop to another day or split the route.</span></div> : ''}<div className="fb-l">{P.st.length ? <>{P.st.map((x, i) => <Fragment key={i}>{stopRow(x, i)}</Fragment>)}<div className="fb-end"><span className="fb-n">⌂</span><span>{"Back at "}{STARTS[r.start][0].toLowerCase()}</span><span className="fs-e">{P.back}</span></div></> : <div className="fb-empty"><b>No stops yet</b><span>{edit ? 'Add things from Needs a visit, or add a stop of your own.' : 'Nothing planned for this route.'}</span></div>}</div></div>{foot}</div>;
      }
      html(document.getElementById('fv'), <><section className="band" style={css("margin-top:0")}><div className="bento">{week}</div></section><section className="band"><div className="bento">{builder}{pool}</div></section></>);
    }

    /* ── panels ── */
    const TASKS = [['check', 'Check the poster', 12, 'visit'], ['swap', 'Swap the poster', 18, 'poster'], ['new', 'Put up a new poster', 25, 'new'], ['walkin', 'Walk in and pitch', 15, 'merchant'], ['follow', 'Follow up', 20, 'merchant'], ['demo', 'Demo the merchant app', 40, 'merchant'], ['device', 'Fix a counter device', 20, 'device'], ['talk', 'Talk to the owner', 15, 'visit']];
    const SHOPLIST = (() => {
      const s = new Map();
      SHOPS.forEach(x => s.set(x[1], [x[7], 'Partner']));
      OTHER_SHOPS.forEach((n, i) => s.set(n, [OTHER_CITY[i], 'Partner']));
      [['Magnolia Laundry', 'Riverside'], ['Sierra Lakes Barber', 'Fontana'], ['Brockton Coffee', 'Riverside'], ['Baseline Cuts', 'Rialto'], ['Kingston Vet', 'Redlands'], ['Lugonia Auto Glass', 'Redlands'], ['Sunset Muffler', 'Rialto'], ['University Optometry', 'Redlands'], ['Yucaipa Pet Clinic', 'Yucaipa']].forEach(([n, c]) => s.set(n, [c, 'Prospect']));
      return [...s.entries()];
    })();
    function planPanel(pn) {
      const P = R.panel,
        r = RT(R.sel),
        dayName = r ? fmtWD(dayT(r.d)) : '';
      if (P.k === 'item') {
        const x = POOLBY[P.id],
          on = routeOf(x.id),
          p = x.n ? POSTERS.find(q => q.n === x.n) : null,
          L = p ? life(p) : null;
        // live, a shop's hours and contact aren't kept for what needs a visit (today's stops have them)
        const info = LV ? '–' : ['8 pm', '6 pm', '7 pm', '9 pm', '5 pm'][hashN(x.shop) % 5],
          who = LV ? '–' : ['the owner', 'Luis', 'Kim', 'Ms. Tran', 'Hector', 'Sofia'][hashN(x.shop) % 6];
        const si = x.kind === 'merchant' ? STAGES_M.findIndex(s => s[0] === x.stage) : -1;
        const btn = !r || !canEdit(r) ? '' : on === r ? <button className="btn p" data-fadd={x.id}>{"Take off "}{dayName.slice(0, 3)}</button> : on && !canEdit(on) ? <span className="small quiet">{"On "}{firstName(on.who)}{"’s "}{fmtWD(dayT(on.d)).slice(0, 3)}{" route"}</span> : <button className="btn p" data-fadd={x.id} title={`${r.who === R.me ? 'Your' : firstName(r.who) + '’s'} ${dayName} route`}>{on ? 'Move' : 'Add'}{" to "}{dayName.slice(0, 3)}</button>;
        html(pn, <><div className="pn-hd"><span className="lbl">{KIND[x.kind]}</span><i className="fl-sv" style={css(`background:${sevCol(x.sev)}`)} /><button className="x" data-fclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><div className="fpr-top">{p ? designThumb(p.design, 48) : x.kind === 'device' ? batteryThumb(48, 1) : x.kind === 'merchant' ? <span className="fshop">{x.shop.split(' ').map(w => w[0]).slice(0, 2).join('')}</span> : designThumb(x.design || 'B', 48)}<div><h3>{x.shop}</h3><span className="small quiet">{x.city}</span></div></div><div className="fit"><b>{x.what}</b><span>{x.why}</span></div>{x.kind === 'merchant' ? <div><div className="w90-h"><span className="lbl">In the Merchants pipeline</span>{x.owner ? <b>{x.owner === R.me ? 'Your lead' : firstName(x.owner) + '’s lead'}</b> : ''}</div><div className="fpl">{STAGES_M.map(([k, t], i) => <span key={i} className={i < si ? 'past' : i === si ? 'now' : ''}>{t}</span>)}</div>{x.val ? <span className="small quiet">Could finance about ${int(x.val)}{" a month"}</span> : ''}</div> : ''}{p ? <div className="w90"><div className="w90-h"><span className="lbl">{"Poster "}{pid(p.n)}{" · 60-day life"}</span><b className={L.d < 0 || p.status !== 'up' ? 'warn' : ''}>{p.status === 'missing' ? 'Gone' : L.d < 0 ? `${-L.d} days late` : `${L.d} days left`}</b></div><span className={`wbar big ${L.d < 10 || p.status !== 'up' ? 'lo' : ''}`}><i style={css(`width:${L.pct * 100}%`)} /></span><span className="small quiet">{"Design "}{p.design}{" · "}{p.scans}{" scans in 30 days · hung "}{fmtD(p.hung)}</span></div> : ''}<div className="led"><div><span>Open until</span><b>{info}</b></div><div><span>Ask for</span><b>{who}</b></div><div><span>Takes about</span><b>{x.mins}{" min"}</b></div><div><span>Planned</span><b>{on ? `${fmtWD(dayT(on.d))} · ${on.who === R.me ? 'you' : firstName(on.who)}` : 'Not yet'}</b></div></div>{x.kind === 'merchant' ? <p className="small quiet" style={css("margin:0")}>Whatever happens on the visit gets logged back to this shop in Merchants.</p> : x.kind === 'device' ? <p className="small quiet" style={css("margin:0")}>From Merchants. Bring a spare battery and a receipt roll.</p> : x.kind === 'new' ? <p className="small quiet" style={css("margin:0")}>{"From Placement. The owner said yes; bring design "}{x.design}.</p> : ''}</div><div className="pn-ft mft">{btn}{x.kind === 'merchant' ? <button className="btn" data-fgo="merchants" data-fshop={x.shop}>In Merchants ↗</button> : ''}{LV ? '' : <div className="more3"><button className="btn" data-fmore="">More ▾</button><div className="mm3" hidden><button data-fsnooze={x.id}>{R.snoozed.has(x.id) ? 'Unsnooze' : 'Snooze a week'}{" "}<span>Hides it</span></button><button className="dz" data-fdrop={x.id}>{"Not needed "}<span>Logged</span></button></div></div>}</div></>);
        return;
      }
      if (P.k === 'add') {
        const q = R.q.trim().toLowerCase(),
          list = SHOPLIST.filter(([n, [c]]) => !q || n.toLowerCase().includes(q) || c.toLowerCase().includes(q)).slice(0, 8);
        html(pn, <><div className="pn-hd"><span className="lbl">{"Add a stop · "}{dayName}</span><button className="x" data-fclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><div><span className="lbl">Shop</span><label className="msearch" style={css("margin-top:8px;max-width:none")}><svg className="i" viewBox="0 0 20 20"><circle cx="9" cy="9" r="5" /><path d="M13 13l4 4" /></svg><input id="faddq" placeholder="Search partners and prospects" defaultValue={R.q} autoComplete="off" /></label><div className="fad-l">{list.length ? list.map(([n, [c, k]], __k) => <button key={__k} className={`fad-r ${R.addSel === n ? 'on' : ''}`} data-faddsel={n}><b>{n}</b><span>{c}{" · "}{k}</span></button>) : <p className="small quiet" style={css("margin:8px 0")}>No shop matches. Add new prospects in Merchants first.</p>}</div></div><div><span className="lbl">What to do there</span><div className="fad-t">{TASKS.map(([k, t, m], __k) => <button key={__k} className={R.addTask === k ? 'on' : ''} data-ftask={k} aria-pressed={R.addTask === k}><b>{t}</b><span>{"about "}{m}{" min"}</span></button>)}</div></div><label><span className="lbl">Note for whoever goes</span><textarea id="faddnote" className="cmp" rows="2" placeholder="Optional" /></label></div><div className="pn-ft"><span className="nx">{R.addSel ? R.addSel : 'Pick a shop'}</span><button className="btn" data-fclose="">Cancel</button><button className="btn p" data-faddgo="" {...attrs(!R.addSel ? 'disabled' : '')}>{"Add to "}{dayName.slice(0, 3)}</button></div></>);
        return;
      }
      if (P.k === 'send') {
        const Pl = plan(r),
          load = {
            A: 0,
            B: 0,
            C: 0
          };
        let dev = 0,
          mer = 0;
        Pl.st.forEach(x => {
          if (x.design) load[x.design]++;
          if (x.kind === 'device') dev++;
          if (x.kind === 'merchant') mer++;
        });
        const nm = TEAM[r.who].n;
        html(pn, <><div className="pn-hd"><span className="lbl">Send the route</span><button className="x" data-fclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><h3>{dayName}{" · "}{nm}</h3><div className="bx4">{[['Stops', Pl.st.length], ['About', hm(Pl.mins)], ['Miles', Pl.miles], ['Back by', Pl.back]].map(([t, v], __k) => <div key={__k}><span className="lbl">{t}</span><b style={css("font-size:16px;white-space:nowrap")}>{v}</b></div>)}</div><div><span className="lbl">The stops</span><div className="fsd">{Pl.st.map((x, i) => <div key={i}><span className="fb-n">{i + 1}</span><span><b>{x.shop}</b><span className="small quiet">{" · "}{x.what}</span></span><span>{hhmm(Pl.times[i])}</span></div>)}</div></div><div><span className="lbl">Bring</span><div className="fv fsl">{Object.entries(load).filter(([, v]) => v).map(([k, v], __k) => <div key={__k} className="fv-r">{designThumb(k, 20)}<span className="fv-k"><b>{v}{" × design "}{k}</b><span>{DESIGNS[k].name}</span></span></div>)}{dev ? <div className="fv-r">{batteryThumb(20)}<span className="fv-k"><b>{dev}{" spare batter"}{dev === 1 ? 'y' : 'ies'}{" and receipt rolls"}</b><span>For the counter device fixes</span></span></div> : ''}{mer ? <div className="fv-r"><span className="fshop sm">M</span><span className="fv-k"><b>Merchant kit</b><span>{"Agreements, a demo tablet and window stickers · "}{mer}{" merchant stop"}{mer === 1 ? '' : 's'}</span></span></div> : ''}</div></div><label><span className="lbl">{"Note for "}{firstName(r.who)}</span><textarea id="fsendnote" className="cmp" rows="3" placeholder="Anything they should know" /></label></div><div className="pn-ft"><span className="nx">{firstName(r.who)}{" gets it on the phone"}</span><button className="btn" data-fclose="">Not yet</button><button className="btn p" data-fsendgo="">Send</button></div></>);
        return;
      }
      if (P.k === 'newroute') {
        const who = isAdmin() ? P.who : R.me,
          field = Object.entries(TEAM);
        html(pn, <><div className="pn-hd"><span className="lbl">{isAdmin() ? 'New route' : 'Plan my route'}</span><button className="x" data-fclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><h3>{isAdmin() ? 'Who and when' : 'Pick a day'}</h3><div><span className="lbl">Day</span><div className="fad-t">{DAYS.concat([8, 9]).map((d, __k) => {
                  const taken = who && R.routes.some(x => x.d === d && x.who === who),
                    n = R.routes.filter(x => x.d === d).length;
                  return <button key={__k} className={P.d === d ? 'on' : ''} data-fnrday={d} {...attrs(taken ? 'disabled' : '')}><b>{d === 1 ? 'Tomorrow · ' : ''}{fmtWD(dayT(d))}</b><span>{taken ? (who === R.me ? 'You' : firstName(who)) + ' already have one' : n ? n + ' other route' + (n === 1 ? '' : 's') : 'Nothing planned'}</span></button>;
                })}</div></div>{isAdmin() ? <div><span className="lbl">Who goes</span><div className="fwho">{field.map(([k, t], __k) => <button key={__k} data-fnrwho={k} aria-pressed={who === k} {...attrs(!t.field ? 'disabled' : '')}><span className="av sm">{t.ini}</span><span><b>{k === R.me ? 'Me' : t.n}</b><span>{t.role}{t.field ? '' : ' · no Field access'}</span></span></button>)}</div><p className="small quiet" style={css("margin:8px 0 0")}>Only people with Field access can take a route. Change access in Permissions.</p></div> : <p className="small quiet" style={css("margin:0")}>You can plan routes for yourself. To plan for someone else, ask an admin.</p>}</div><div className="pn-ft"><span className="nx">Then add its stops</span><button className="btn" data-fclose="">Cancel</button><button className="btn p" data-fnrgo="" {...attrs(!P.d || !who ? 'disabled' : '')}>Start the route</button></div></>);
        return;
      }
    }

    /* ── plan events (before Field's main handler) ── */
    document.addEventListener('click', e => {
      const t = e.target.closest('button,select,input');
      const menu = document.querySelector('.fme-m');
      if (menu && !menu.hidden && !(t && t.closest('#fme'))) menu.hidden = true;
      if (!t) return;
      const d = t.dataset,
        r = RT(R.sel);
      const done = () => {
        e.stopImmediatePropagation();
        render();
      };
      if (t.hasAttribute('data-fmeopen')) {
        const m = document.querySelector('.fme-m');
        m.hidden = !m.hidden;
        e.stopImmediatePropagation();
        return;
      }
      if (d.fme) {
        R.me = d.fme;
        R.panel = null;
        const own = R.routes.find(x => x.who === R.me);
        if (own && !canEdit(RT(R.sel))) R.sel = own.id;
        toast(`Signed in as ${TEAM[R.me].n} · ${TEAM[R.me].admin ? 'admin' : 'Field access'}`);
        return done();
      }
      if (d.fdaymore) {
        const rs = R.routes.filter(x => x.d === +d.fdaymore);
        R.sel = rs[5].id;
        return done();
      }
      if (d.froute) {
        R.sel = d.froute;
        R.panel = null;
        if (F.tab !== 'plan') F.tab = 'plan';
        return done();
      }
      if (d.fpf2) {
        R.pf = d.fpf2;
        return done();
      }
      if (d.fnear) {
        R.near = d.fnear === 'true';
        return done();
      }
      if (t.hasAttribute('data-fshowsnz')) {
        R.show = !R.show;
        return done();
      }
      if (d.fitem) {
        R.panel = {
          k: 'item',
          id: d.fitem
        };
        F.scan = null;
        F.poster = null;
        return done();
      }
      if (d.fadd) {
        if (!canEdit(r)) return;
        const id = d.fadd,
          on = routeOf(id);
        if (on === r) {
          r.ids = r.ids.filter(x => x !== id);
          toast(`${POOLBY[id].shop} taken off`);
        } else {
          if (on) {
            if (!canEdit(on)) return;
            on.ids = on.ids.filter(x => x !== id);
            dirty(on);
          }
          r.ids.push(id);
          toast(`${POOLBY[id].shop} ${on ? 'moved' : 'added'} to ${r.who === R.me ? 'your' : firstName(r.who) + '’s'} ${fmtWD(dayT(r.d)).slice(0, 3)} route`);
        }
        dirty(r);
        if (R.panel && R.panel.k === 'item' && t.closest('.panel')) R.panel = null;
        return done();
      }
      if (d.fmv) {
        const [i, dir] = d.fmv.split('|').map(Number),
          a = r.ids,
          j = i + dir;
        [a[i], a[j]] = [a[j], a[i]];
        dirty(r);
        return done();
      }
      if (t.hasAttribute('data-fbest')) {
        bestOrder(r);
        dirty(r);
        toast('Stops put in the shortest order');
        return done();
      }
      if (t.hasAttribute('data-fsaveme')) {
        r.status = 'accepted';
        r.by = R.me;
        r.okAt = 'just now';
        r.changed = false;
        toast(isAdmin() ? 'Saved · it’s on your phone' : 'Saved · it’s on your phone and Kai can see it');
        return done();
      }
      if (t.hasAttribute('data-fsend')) {
        R.panel = {
          k: 'send'
        };
        return done();
      }
      if (t.hasAttribute('data-fsendgo')) {
        r.status = 'sent';
        r.sentAt = 'just now';
        r.changed = false;
        R.panel = null;
        toast(`Sent · ${TEAM[r.who].n} gets it on the phone`);
        return done();
      }
      if (t.hasAttribute('data-funsend')) {
        r.status = 'draft';
        toast('Taken back · it’s a draft again');
        return done();
      }
      if (t.hasAttribute('data-faddstop')) {
        R.panel = {
          k: 'add'
        };
        R.q = '';
        R.addSel = null;
        R.addTask = 'check';
        return done();
      }
      if (d.faddsel) {
        R.addSel = d.faddsel;
        e.stopImmediatePropagation();
        return renderPanel();
      }
      if (d.ftask) {
        R.addTask = d.ftask;
        e.stopImmediatePropagation();
        return renderPanel();
      }
      if (t.hasAttribute('data-faddgo')) {
        const task = TASKS.find(x => x[0] === R.addTask),
          [city, kd] = SHOPLIST.find(x => x[0] === R.addSel)[1],
          id = 'a' + ++R.adhoc,
          note = (document.getElementById('faddnote') || {}).value || '';
        const x = {
          id,
          kind: task[3],
          shop: R.addSel,
          city,
          what: task[1],
          why: note || (kd === 'Prospect' ? 'Prospect · added by hand' : 'Added by hand'),
          sev: 'line',
          mins: task[2],
          design: task[3] === 'new' || task[3] === 'poster' ? 'B' : undefined,
          stage: kd === 'Prospect' ? 'prospect' : undefined
        };
        POOL.push(x);
        POOLBY[id] = x;
        r.ids.push(id);
        dirty(r);
        R.panel = null;
        toast(`${R.addSel} added`);
        return done();
      }
      if (d.fnewroute !== undefined && t.hasAttribute('data-fnewroute')) {
        R.panel = {
          k: 'newroute',
          d: d.fnewroute ? +d.fnewroute : null,
          who: isAdmin() ? null : R.me
        };
        return done();
      }
      if (d.fnrday) {
        R.panel.d = +d.fnrday;
        e.stopImmediatePropagation();
        return renderPanel();
      }
      if (d.fnrwho) {
        R.panel.who = d.fnrwho;
        if (R.routes.some(x => x.d === R.panel.d && x.who === d.fnrwho)) R.panel.d = null;
        e.stopImmediatePropagation();
        return renderPanel();
      }
      if (t.hasAttribute('data-fnrgo')) {
        const {
            d: dd
          } = R.panel,
          who = isAdmin() ? R.panel.who : R.me,
          id = 'r' + ++R.nid;
        if (!DAYS.includes(dd)) {
          DAYS.push(dd);
          DAYS.sort((a, b) => a - b);
        }
        R.routes.push({
          id,
          d: dd,
          who,
          ids: [],
          status: 'draft',
          by: R.me,
          start: STARTS[who] ? who : 'office'
        });
        R.sel = id;
        R.panel = null;
        toast(`${fmtWD(dayT(dd))} · route started for ${who === R.me ? 'you' : TEAM[who].n}`);
        return done();
      }
      if (d.fsnooze) {
        R.snoozed.has(d.fsnooze) ? R.snoozed.delete(d.fsnooze) : R.snoozed.add(d.fsnooze);
        toast(R.snoozed.has(d.fsnooze) ? 'Snoozed for a week' : 'Back in the list');
        R.panel = null;
        return done();
      }
      if (d.fdrop) {
        const on = routeOf(d.fdrop);
        if (on) {
          on.ids = on.ids.filter(x => x !== d.fdrop);
          dirty(on);
        }
        R.dropped.add(d.fdrop);
        toast('Marked not needed · logged in Records');
        R.panel = null;
        return done();
      }
      if (t.hasAttribute('data-fmore')) {
        const mm = t.parentElement.querySelector('.mm3');
        mm.hidden = !mm.hidden;
        e.stopImmediatePropagation();
        return;
      }
    }, true);
    document.addEventListener('change', e => {
      const r = RT(R.sel);
      if (e.target.id === 'fstart') {
        r.start = e.target.value;
        dirty(r);
        render();
      }
      if (e.target.id === 'fwho') {
        const w = e.target.value;
        if (R.routes.some(x => x !== r && x.d === r.d && x.who === w)) {
          toast(`${TEAM[w].n} already has a route that day`);
          render();
          return;
        }
        r.who = w;
        if (r.start !== 'office') r.start = STARTS[w] ? w : 'office';
        dirty(r);
        r.status = 'draft';
        render();
      }
    });
    document.addEventListener('input', e => {
      if (e.target.id === 'faddq') {
        R.q = e.target.value;
        renderPanel();
        const i = document.getElementById('faddq');
        i.focus();
        i.setSelectionRange(i.value.length, i.value.length);
      }
    });
    document.addEventListener('dragstart', e => {
      const row = e.target.closest && e.target.closest('[data-fdrag]');
      if (!row) return;
      R.drag = +row.dataset.fdrag;
      row.classList.add('drag');
      e.dataTransfer.effectAllowed = 'move';
    });
    document.addEventListener('dragover', e => {
      const row = e.target.closest && e.target.closest('[data-fdrag]');
      if (R.drag == null || !row) return;
      e.preventDefault();
      document.querySelectorAll('.fb-r.over').forEach(x => x.classList.remove('over'));
      row.classList.add('over');
    });
    document.addEventListener('drop', e => {
      const row = e.target.closest && e.target.closest('[data-fdrag]');
      if (R.drag == null || !row) return;
      e.preventDefault();
      const r = RT(R.sel),
        a = r.ids,
        to = +row.dataset.fdrag,
        [m] = a.splice(R.drag, 1);
      a.splice(to, 0, m);
      R.drag = null;
      dirty(r);
      render();
    });
    document.addEventListener('dragend', () => {
      R.drag = null;
      document.querySelectorAll('.fb-r.drag,.fb-r.over').forEach(x => x.classList.remove('drag', 'over'));
    });

    /* ══ Visits: what happened in the field, and what it leads to ════════════════════════════════
       Every finished stop by anyone, with its outcome. Merchant visits carry a pipeline outcome that updates the shop in Merchants.
       Follow-ups are the merchant leads with a next step, sorted by when it's due; "gone quiet" are partners and leads nobody has seen lately.
       Ties: Uptown Barber signed today (Merchants: founding seat 3 of 5), Mission Auto Care's demo is tomorrow, Inland Cycle Works is signing. */
    const V = {
      kind: 'all',
      who: 'all',
      lf: 'due'
    };
    const OUTC = {
      // outcome → tone, label, pipeline stage it leads to (merchant)
      'Not in': ['line', 'Nobody to talk to', null],
      'Not interested': ['absent', 'Said no for now', 'closed'],
      'Interested': ['live', 'Wants to hear more', null],
      'Demo booked': ['live', 'Demo on the calendar', 'talking'],
      'Ready to sign': ['underway', 'Agreement next', 'signing'],
      'Signed': ['settled', 'Agreement signed', 'signed'],
      'Replaced': ['settled', 'New poster up', null],
      'Checked': ['settled', 'Up and fine', null],
      'Damaged': ['underway', 'Needs a swap', null],
      'Missing': ['absent', 'Gone from the window', null],
      'Fixed': ['settled', 'Working again', null],
      'Couldn’t fix': ['absent', 'Needs another visit', null]
    };
    const STAGE_N = {
      prospect: 'Prospect',
      talking: 'Talking',
      signing: 'Signing',
      signed: 'Signed',
      closed: 'Closed'
    };
    /* merchant leads: shop, city, stage, owner, last visit (days ago, null = never), next step, due (days from today), could finance a month */
    const LEADS = LV ? LV.LEADS : [['Mission Auto Care', 'Redlands', 'talking', 'marcus', 7, 'Demo the merchant app', 1, 9000], ['Orange Show Tires', 'San Bernardino', 'talking', 'marcus', 8, 'Bring the numbers', -2, 7500], ['Tri-City Transmission', 'San Bernardino', 'talking', 'marcus', 6, 'Talk terms · wants NET-14', -4, 8000], ['Barton Rd. Appliance', 'Grand Terrace', 'talking', 'dana', 9, 'Second visit', 0, 5500], ['Sun Valley HVAC', 'Highland', 'talking', 'marcus', 5, 'Ride-along with the owner', 2, 12000], ['Inland Cycle Works', 'Redlands', 'signing', 'kai', 2, 'Sign the agreement', 5, 0], ['Cypress Dental', 'Redlands', 'talking', 'kai', null, 'Meet the owner', 5, 6000], ['Kingston Vet', 'Redlands', 'talking', 'kai', null, 'Visit after the intro email', 8, 4500], ['Kendall Thrift', 'San Bernardino', 'signed', 'dana', 49, 'Check in · no charges in 3 weeks', null, 0], ['Base Line Pho', 'San Bernardino', 'signed', 'marcus', 54, 'Check in · poster faded?', null, 0], ['Citrus Plaza Optical', 'Redlands', 'signed', 'dana', 57, 'Check in · staff not set up', null, 0], ['Redlands Smog & Brake', 'Redlands', 'prospect', 'marcus', null, 'Walk in', null, 5000], ['IE Mattress Outlet', 'Colton', 'prospect', 'dana', null, 'Walk in', null, 6500], ['Fontana Furniture', 'Fontana', 'prospect', 'dana', null, 'Walk in', null, 7000], ['Lugonia Auto Glass', 'Redlands', 'prospect', 'marcus', null, 'Walk in', null, 4000], ['Sunset Muffler', 'Rialto', 'prospect', 'marcus', null, 'Walk in', null, 3500]].map(([shop, city, stage, owner, last, next, due, val]) => ({
      shop,
      city,
      stage,
      owner,
      last,
      next,
      due,
      val
    }));
    /* the visit log: today's finished stops, then two weeks of history (weekdays) */
    const VLOG = LV ? LV.VLOG : (() => {
      const r = rng(77),
        out = [],
        pick = a => a[Math.floor(r() * a.length)];
      const posterShops = POSTERS.filter(p => !p.board);
      // fixed story entries
      const fixed = [[0, '09:20', 'marcus', 'Uptown Barber', 'Redlands', 'merchant', 'Sign the agreement', 'Signed', 'Founding seat 3 of 5. Andre wants the counter device by Friday.', 'signing'], [-2, '14:10', 'kai', 'Inland Cycle Works', 'Redlands', 'merchant', 'Walk through the agreement', 'Ready to sign', 'Owner wants a lawyer to read it. Signing next week.', 'talking'], [-2, '11:30', 'dana', 'Mesa Laundry', 'San Bernardino', 'poster', 'Check P-044', 'Damaged', 'Sun-faded. Window faces south; try the side window next time.', null], [-5, '15:40', 'marcus', 'Sun Valley HVAC', 'Highland', 'merchant', 'Walk in', 'Interested', 'Owner wants to see it on a real job. Ride-along Friday.', 'prospect'], [-6, '13:05', 'marcus', 'Tri-City Transmission', 'San Bernardino', 'merchant', 'Follow up', 'Interested', 'Likes it, but only on NET-14. Need an answer on terms.', 'talking'], [-7, '10:15', 'marcus', 'Mission Auto Care', 'Redlands', 'merchant', 'Walk in', 'Demo booked', 'Service manager Luis. Demo Thu 22 Oct, 10 am.', 'prospect'], [-8, '16:00', 'marcus', 'Orange Show Tires', 'San Bernardino', 'merchant', 'Walk in', 'Interested', 'Asked what it costs them. Promised to bring the numbers.', 'prospect'], [-9, '12:20', 'dana', 'Barton Rd. Appliance', 'Grand Terrace', 'merchant', 'Walk in', 'Interested', 'Good first talk. Owner back from vacation the 21st.', 'prospect'], [-9, '14:45', 'dana', 'Baseline Cuts', 'Rialto', 'merchant', 'Walk in', 'Not interested', 'Already takes a buy-now-pay-later app.', 'prospect'], [-12, '11:00', 'marcus', 'Mesa Laundry', 'San Bernardino', 'merchant', 'Walk in', 'Not in', 'Owner out. Came back on the 9th.', null]];
      fixed.forEach(([d, t, who, shop, city, kind, what, outc, note, from]) => out.push({
        d,
        t,
        who,
        shop,
        city,
        kind,
        what,
        out: outc,
        note,
        photo: kind === 'poster',
        from,
        to: from && OUTC[outc][2] && OUTC[outc][2] !== from ? OUTC[outc][2] : null
      }));
      // today's finished route stops
      STOPS.forEach(s => s.tasks.forEach(tk => {
        if (tk.done) out.push({
          d: 0,
          t: tk.done,
          who: 'marcus',
          shop: s.name,
          city: s.city,
          kind: tk.kind,
          what: tk.t,
          out: tk.out || 'Fixed',
          note: '',
          photo: !!tk.photo
        });
      }));
      // history: posters on Marcus's routes, devices and merchants mostly Dana
      for (let d = -1; d >= -14; d--) {
        const wd = new Date(dayT(d)).getUTCDay();
        if (wd === 0 || wd === 6) continue;
        const n = 4 + Math.floor(r() * 4);
        let t = 9 * 60 + 10;
        for (let i = 0; i < n; i++) {
          const p = pick(posterShops),
            o = r() < .55 ? 'Checked' : r() < .75 ? 'Replaced' : r() < .6 ? 'Damaged' : 'Missing';
          t += 20 + Math.floor(r() * 25);
          out.push({
            d,
            t: hhmm(t),
            who: 'marcus',
            shop: p.shop,
            city: p.city,
            kind: 'poster',
            what: `${o === 'Replaced' ? 'Swap' : 'Check'} ${pid(p.n)}`,
            out: o,
            note: '',
            photo: r() < .7
          });
        }
        if (r() < .6) {
          const sh = pick(['Cajon Phone Repair', 'Highland Hardware', 'Citrus Bowl Café', 'Rosa’s Panadería', 'State St. Books']);
          const ok = r() < .8;
          out.push({
            d,
            t: hhmm(13 * 60 + Math.floor(r() * 120)),
            who: 'dana',
            shop: sh,
            city: (SHOPLIST.find(x => x[0] === sh) || [0, ['Redlands']])[1][0],
            kind: 'device',
            what: pick(['Swap the battery', 'Re-pair the Tap reader', 'Drop off receipt rolls']),
            out: ok ? 'Fixed' : 'Couldn’t fix',
            note: '',
            photo: false
          });
        }
      }
      return out.sort((a, b) => b.d - a.d || b.t.localeCompare(a.t));
    })();
    const vDay = d => d === 0 ? 'Today' : d === -1 ? 'Yesterday' : fmtWD(dayT(d));
    const visitsIn = days => VLOG.filter(v => v.d > -days);
    const dueLeads = () => LEADS.filter(l => l.due != null && l.stage !== 'closed');
    const quietLeads = () => LEADS.filter(l => l.stage === 'signed' && l.last != null && l.last >= 30);
    const newLeads = () => LEADS.filter(l => l.stage === 'prospect' && l.last == null);
    const leadPool = l => POOL.find(x => x.kind === 'merchant' && x.shop === l.shop);
    const leadRoute = l => {
      const x = leadPool(l);
      return x ? routeOf(x.id) : null;
    };
    function renderVisits() {
      const me = R.me;
      /* follow-ups */
      const lists = {
        due: [dueLeads(), 'Next step due'],
        quiet: [quietLeads(), 'Partners nobody’s seen in 30+ days'],
        new: [newLeads(), 'Prospects never visited']
      };
      const L = lists[V.lf][0].slice().sort((a, b) => V.lf === 'due' ? a.due - b.due : V.lf === 'quiet' ? b.last - a.last : (b.val || 0) - (a.val || 0));
      const dueTxt = l => l.due == null ? l.last == null ? 'Never visited' : `Last seen ${l.last} days ago` : l.due < 0 ? `${-l.due} day${l.due === -1 ? '' : 's'} overdue` : l.due === 0 ? 'Due today' : l.due === 1 ? 'Due tomorrow' : `Due ${fmtWD(dayT(l.due)).slice(0, 3)}`;
      const sev = l => l.due != null && l.due < 0 ? 'absent' : l.due === 0 || l.due === 1 ? 'underway' : l.stage === 'signed' ? 'underway' : 'line';
      const fuRow = l => {
        const rt = leadRoute(l);
        return <div className="vf-r"><div className="vf-t"><i className="sv" style={css(`background:${sevCol(sev(l))}`)} /><button className="vf-n" data-flead={l.shop}><b>{l.shop}</b></button><span className={`vf-a ${l.due != null && l.due < 0 ? 'bad' : ''}`}>{dueTxt(l)}</span></div><span className="vf-m">{l.next}{" · "}{STAGE_N[l.stage]}{" · "}{l.owner === me ? 'your lead' : firstName(l.owner) + '’s lead'}{l.last != null && l.due != null ? ` · last visit ${l.last}d ago` : ''}</span><div className="vf-s">{rt ? <><span className="vf-on">{"On "}{rt.who === me ? 'your' : firstName(rt.who) + '’s'}{" "}{fmtWD(dayT(rt.d)).slice(0, 3)}{" route"}</span><button className="lnk3" data-froute={rt.id} data-ftabgo="plan">Open →</button></> : <><span className="vf-off">Not on a route</span>{LV ? '' : <button className="lnk3" data-fleadroute={l.shop}>{"Add to "}{l.owner === me ? 'your' : firstName(l.owner) + '’s'}{" route →"}</button>}</>}</div></div>;
      };
      const fu = <div className="cell s7"><div className="hd"><h2>Follow-ups</h2><div className="r"><div className="seg sm" role="group" aria-label="Show">{[['due', 'Due ' + dueLeads().length], ['quiet', 'Gone quiet ' + quietLeads().length], ['new', 'Never visited ' + newLeads().length]].map(([k, t], __k) => <button key={__k} data-vlf={k} aria-pressed={V.lf === k}>{t}</button>)}</div></div></div><div className="vf-l">{L.length ? L.map((x, i) => <Fragment key={i}>{fuRow(x, i)}</Fragment>) : <p className="small quiet" style={css("padding:18px 22px;margin:0")}>Nothing here.</p>}</div><div className="bk-ft"><span>{lists[V.lf][1]}. These come from the Merchants pipeline.</span><button data-fgo="merchants/pipeline">Pipeline · Merchants →</button></div></div>;
      /* what merchant visits led to, last 30 days */
      const mv = VLOG.filter(v => v.kind === 'merchant' && v.d > -30),
        cnt = k => mv.filter(v => v.out === k).length;
      const steps = [['Merchant visits', mv.length], ['Talked to someone', mv.length - cnt('Not in')], ['Interested or further', mv.filter(v => ['Interested', 'Demo booked', 'Ready to sign', 'Signed'].includes(v.out)).length], ['Demo or further', mv.filter(v => ['Demo booked', 'Ready to sign', 'Signed'].includes(v.out)).length], ['Signed', cnt('Signed')]];
      const fn = <div className="cell s5"><div className="hd"><h2>What visits led to</h2><div className="r"><span className="lbl">Merchants · 30 days</span></div></div><div className="vfn">{steps.map(([t, n], i) => <Fragment key={i}>{i ? <div className="vfn-c"><span /><span><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1v8M2 6l3 3 3-3" /></svg><b>{steps[i - 1][1] ? Math.round(n / steps[i - 1][1] * 100) : 0}%</b>{" kept going"}</span></div> : ''}<div className="vfn-r"><span>{t}</span><span className="vfn-b"><i style={css(`width:${n / Math.max(1, steps[0][1]) * 100}%`)} className={i === steps.length - 1 ? 'on' : ''} /></span><b>{n}</b></div></Fragment>)}</div><div className="vfn-n">{mv.filter(v => v.to).length}{" visits moved a shop forward in the pipeline"}</div><div className="bk-ft"><span>{cnt('Not in') ? `Nobody was in ${cnt('Not in') === 1 ? 'once' : cnt('Not in') + ' times'}.${LV ? '' : ' Mornings work better.'}` : LV && !mv.length ? 'No merchant visits logged yet.' : 'Someone was in every time.'}</span><span /></div></div>;
      /* the log */
      const who = Object.entries(TEAM).filter(([, t]) => t.field);
      const rows = VLOG.filter(v => (V.kind === 'all' || (V.kind === 'poster' ? v.kind === 'poster' : v.kind === V.kind)) && (V.who === 'all' || v.who === V.who));
      let lastD = null;
      const log = rows.slice(0, 60).map((v, i) => {
        const hd = v.d !== lastD ? <div className="vl-g"><span>{vDay(v.d)}</span><span>{rows.filter(x => x.d === v.d).length}{" visits"}</span></div> : '';
        lastD = v.d;
        const o = OUTC[v.out] || ['line', ''];
        return <Fragment key={i}>{hd}<button className="vl-r" data-fvisit={VLOG.indexOf(v)}><span className="vl-tm">{v.t}</span><span className={`av sm ${v.who === me ? '' : 'dim'}`}>{TEAM[v.who].ini}</span><span className="vl-k"><b>{v.shop}</b><span>{KIND[v.kind]}{" · "}{v.what}</span></span><span className="vl-o"><i className="sv" style={css(`background:${sevCol(o[0])}`)} />{v.out}{v.to && STAGE_N[v.to] !== v.out ? <span className="vl-st">{"→ "}{STAGE_N[v.to]}</span> : ''}</span><span className="vl-x">{v.note ? <span title="Has a note">Note</span> : ''}{v.photo ? <span title="Has a photo">Photo</span> : ''}</span></button></Fragment>;
      });
      const lg = <div className="cell s12"><div className="hd"><h2>Every visit</h2><div className="r"><div className="seg sm" role="group" aria-label="Kind">{[['all', 'All'], ['poster', 'Posters'], ['merchant', 'Merchants'], ['device', 'Devices']].map(([k, t], __k) => <button key={__k} data-vkind={k} aria-pressed={V.kind === k}>{t}</button>)}</div><div className="seg sm" role="group" aria-label="Who">{[['all', 'Everyone'], ...who.map(([k, t]) => [k, k === me ? 'You' : t.n.split(' ')[0]])].map(([k, t], __k) => <button key={__k} data-vwho={k} aria-pressed={V.who === k}>{t}</button>)}</div></div></div><div className="vl-l">{log || <p className="small quiet" style={css("padding:18px 22px;margin:0")}>No visits match.</p>}</div><div className="bk-ft"><span>{rows.length}{LV ? ' visits in 30 days' : " visits in two weeks"}{V.who !== 'all' ? ' by ' + (V.who === me ? 'you' : TEAM[V.who].n) : ''}. Click one to see it.</span><button data-fgo="records">Audit log · Records →</button></div></div>;
      /* by person, last 14 days */
      const pr = who.map(([k, t]) => {
        const vs = VLOG.filter(v => v.who === k),
          days = new Set(vs.map(v => v.d)).size;
        return {
          k,
          t,
          n: vs.length,
          days,
          po: vs.filter(v => v.kind === 'poster').length,
          me2: vs.filter(v => v.kind === 'merchant').length,
          dv: vs.filter(v => v.kind === 'device').length,
          fwd: vs.filter(v => v.to).length
        };
      });
      const pmx = Math.max(...pr.map(p => p.n), 1);
      const ppl = <div className="cell s12"><div className="hd"><h2>By person</h2><div className="r"><span className="lbl">{LV ? 'Last 30 days' : 'Last 14 days'}</span></div></div><div className="bt-wrap"><table className="bt vp"><colgroup><col style={css("width:22%")} /><col style={css("width:10%")} /><col style={css("width:34%")} /><col style={css("width:12%")} /><col style={css("width:12%")} /><col style={css("width:10%")} /></colgroup><thead><tr><th className="c-nm">Person</th><th>Days out</th><th style={css("text-align:left")}>Visits</th><th>Merchant</th><th>Moved forward</th><th /></tr></thead><tbody>{pr.map((p, __k) => <tr key={__k}><td className="tn"><span className="vp-n"><span className="av sm">{p.t.ini}</span><b>{p.k === me ? 'You' : p.t.n}</b></span></td><td>{p.days}</td><td style={css("text-align:left")}><span className="vp-b"><span className="vp-bar">{[['po', 'var(--fg)'], ['me2', 'var(--live)'], ['dv', 'var(--land)']].map(([f, c], __k) => p[f] ? <i key={__k} style={css(`width:${p[f] / pmx * 100}%;background:${c}`)} title={p[f]} /> : '')}</span><b>{p.n}</b></span></td><td>{p.me2}</td><td>{p.fwd ? <b className="ok">{p.fwd}</b> : <span className="quiet">0</span>}</td><td><button className="lnk4" data-vwho={p.k}>Their visits</button></td></tr>)}</tbody></table></div><div className="bk-ft"><span className="f-key"><i style={css("background:var(--fg)")} />{"Posters "}<i style={css("background:var(--live)")} />{"Merchants "}<i style={css("background:var(--land)")} />Devices</span><span /></div></div>;
      html(document.getElementById('fv'), <><section className="band" style={css("margin-top:0")}><div className="bento">{fu}{fn}</div></section><section className="band"><div className="bento">{lg}</div></section><section className="band"><div className="bento">{ppl}</div></section></>);
    }

    /* ── panels: a visit, and logging a merchant visit ── */
    const VPANELS = ['visit', 'log', 'lead'];
    function visitPanel(pn) {
      const P = R.panel;
      if (P.k === 'visit') {
        const v = VLOG[P.i],
          o = OUTC[v.out] || ['line', ''];
        html(pn, <><div className="pn-hd"><span className="lbl">{KIND[v.kind]}{" visit"}</span><span className={`fst ${o[0] === 'settled' ? 'ok' : o[0] === 'live' ? 'tlv' : ''}`}>{v.out}</span><button className="x" data-fclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><div className="fpr-top"><span className="fshop">{v.shop.split(' ').map(w => w[0]).slice(0, 2).join('')}</span><div><h3>{v.shop}</h3><span className="small quiet">{v.city}{" · "}{vDay(v.d)}{", "}{v.t}{" · "}{TEAM[v.who].n}</span></div></div><div className="fit"><b>{v.what}</b><span>{v.out}{" · "}{o[1]}</span></div>{v.to ? <div><span className="lbl">Pipeline</span><div className="vst"><span>{STAGE_N[v.from]}</span><span className="vst-a">→</span><b>{STAGE_N[v.to]}</b></div><span className="small quiet">Updated the shop in Merchants</span></div> : ''}<div><span className="lbl">Note</span><p className="vnote">{v.note || <span className="quiet">No note</span>}</p></div>{v.photo ? <div><span className="lbl">Photo</span><div className="vph">{v.kind === 'poster' && !LV ? designThumb('B', 40) : ''}<span>{"Taken at "}{v.t}</span></div></div> : ''}</div><div className="pn-ft">{v.kind === 'merchant' ? <button className="btn" data-fgo="merchants" data-fshop={v.shop}>In Merchants ↗</button> : ''}<button className="btn" style={css("margin-left:auto")} data-fclose="">Close</button></div></>);
        return;
      }
      if (P.k === 'lead') {
        const l = LEADS.find(x => x.shop === P.shop),
          rt = leadRoute(l),
          hist = VLOG.filter(v => v.shop === l.shop),
          si = STAGES_M.findIndex(s => s[0] === l.stage);
        html(pn, <><div className="pn-hd"><span className="lbl">{"Merchant · "}{STAGE_N[l.stage]}</span><button className="x" data-fclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><div className="fpr-top"><span className="fshop">{l.shop.split(' ').map(w => w[0]).slice(0, 2).join('')}</span><div><h3>{l.shop}</h3><span className="small quiet">{l.city}{" · "}{l.owner === R.me ? 'your lead' : firstName(l.owner) + '’s lead'}</span></div></div><div className="fit"><b>{l.next}</b><span>{l.due == null ? l.last == null ? 'Never visited' : `Nobody’s been in ${l.last} days` : l.due < 0 ? `${-l.due} days overdue` : l.due === 0 ? 'Due today' : 'Due ' + fmtWD(dayT(l.due))}</span></div><div><span className="lbl">In the Merchants pipeline</span><div className="fpl">{STAGES_M.map(([k, t], i) => <span key={i} className={i < si ? 'past' : i === si ? 'now' : ''}>{t}</span>)}</div>{l.val ? <span className="small quiet">Could finance about ${int(l.val)}{" a month"}</span> : ''}</div><div><span className="lbl">Visits</span>{hist.length ? hist.map((v, __k) => <div key={__k} className="hs3"><b>{v.out}{v.to ? ' → ' + STAGE_N[v.to] : ''}</b><span>{vDay(v.d)}{" · "}{firstName(v.who)}</span></div>) : <p className="small quiet" style={css("margin:6px 0 0")}>No visits yet.</p>}</div></div><div className="pn-ft mft">{LV ? '' : rt ? <button className="btn" data-froute={rt.id} data-ftabgo="plan">{"On "}{firstName(rt.who)}{"’s "}{fmtWD(dayT(rt.d)).slice(0, 3)}{" route →"}</button> : <button className="btn" data-fleadroute={l.shop}>Add to a route</button>}{LV && RO() ? '' : <button className="btn p" data-flog={l.shop}>Log a visit</button>}</div></>);
        return;
      }
      if (P.k === 'log') {
        const l = LEADS.find(x => x.shop === P.shop) || {
            shop: P.shop,
            stage: 'signed',
            city: ''
          },
          sel = P.out,
          nxt = OUTC[sel] && OUTC[sel][2];
        const moves = sel && nxt && nxt !== l.stage && !(nxt === 'talking' && l.stage !== 'prospect');
        html(pn, <><div className="pn-hd"><span className="lbl">Log a visit</span><button className="x" data-fclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><h3>{l.shop}</h3><div><span className="lbl">What happened</span><div className="fad-t">{['Not in', 'Not interested', 'Interested', 'Demo booked', 'Ready to sign', 'Signed'].map((k, __k) => <button key={__k} className={sel === k ? 'on' : ''} data-vout={k} aria-pressed={sel === k}><b>{k}</b><span>{OUTC[k][1]}</span></button>)}</div></div>{moves ? <div className="fnote">{"Moves "}{l.shop}{" from "}<b>{STAGE_N[l.stage]}</b>{" to "}<b>{STAGE_N[nxt]}</b>{" in Merchants."}</div> : ''}<div><span className="lbl">Next step</span><input id="vnext" className="vin" placeholder={sel === 'Demo booked' ? 'Demo the merchant app' : sel === 'Ready to sign' ? 'Sign the agreement' : sel === 'Not interested' ? 'No next step' : 'What happens next'} defaultValue={P.next || ''} /><div className="seg sm" style={css("margin-top:8px")} role="group" aria-label="When">{[['1', 'Tomorrow'], ['3', 'This week'], ['7', 'Next week'], ['', 'None']].map(([k, t], __k) => <button key={__k} data-vwhen={k} aria-pressed={(P.when ?? '3') === k}>{t}</button>)}</div></div><label><span className="lbl">Note</span><textarea id="vnote" className="cmp" rows="3" placeholder="Who you talked to, what they said" /></label></div><div className="pn-ft"><span className="nx">{sel ? 'Saved to Merchants and Records' : 'Pick what happened'}</span><button className="btn" data-fclose="">Cancel</button><button className="btn p" data-vsave="" {...attrs(!sel ? 'disabled' : '')}>Save the visit</button></div></>);
        return;
      }
    }
    /* add a lead to its owner's next route: tomorrow's if they have one, otherwise a new draft for tomorrow */
    function leadToRoute(shop, who) {
      const l = LEADS.find(x => x.shop === shop);
      let x = leadPool(l);
      if (!x) {
        x = {
          id: 'm' + (POOL.length + 100),
          kind: 'merchant',
          shop: l.shop,
          city: l.city,
          what: l.next,
          why: l.stage === 'signed' ? `Partner · last seen ${l.last} days ago` : l.last == null ? 'Never visited' : `Last visit ${l.last} days ago`,
          stage: l.stage,
          owner: l.owner,
          val: l.val,
          mins: l.stage === 'prospect' ? 15 : 30,
          sev: 'live'
        };
        POOL.push(x);
        POOLBY[x.id] = x;
      }
      const w = who || l.owner;
      let r = R.routes.find(q => q.d === 1 && q.who === w);
      if (!r) {
        r = {
          id: 'r' + ++R.nid,
          d: 1,
          who: w,
          ids: [],
          status: 'draft',
          by: R.me,
          start: STARTS[w] ? w : 'office'
        };
        R.routes.push(r);
      }
      if (!r.ids.includes(x.id)) r.ids.push(x.id);
      dirty(r);
      return r;
    }
    document.addEventListener('click', e => {
      const t = e.target.closest('button,a');
      if (!t) return;
      const d = t.dataset;
      const done = () => {
        e.stopImmediatePropagation();
        render();
      };
      if (d.vlf) {
        if (F.tab !== 'visits') F.tab = 'visits';
        V.lf = d.vlf;
        return done();
      }
      if (d.vkind) {
        V.kind = d.vkind;
        return done();
      }
      if (d.vwho) {
        V.who = d.vwho;
        done();
        if (t.closest('.vp')) document.querySelector('.vl-l').scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
        return;
      }
      if (d.fvisit) {
        R.panel = {
          k: 'visit',
          i: +d.fvisit
        };
        return done();
      }
      if (d.flead) {
        R.panel = {
          k: 'lead',
          shop: d.flead
        };
        return done();
      }
      if (d.ftabgo && d.froute) {
        R.sel = d.froute;
        if (PAGE === 'merchants') {
          F._tab = d.ftabgo;
          R.panel = null;
          e.stopImmediatePropagation();
          return CC.go('field');
        }
        F.tab = d.ftabgo;
        R.panel = null;
        e.stopImmediatePropagation();
        render();
        setHash();
        window.scrollTo({
          top: 0
        });
        return;
      }
      if (d.fleadroute) {
        const r = leadToRoute(d.fleadroute);
        R.panel = null;
        toast(`${d.fleadroute} added to ${r.who === R.me ? 'your' : TEAM[r.who].n + '’s'} route tomorrow · ${r.status === 'draft' ? 'not sent yet' : 'sent'}`);
        return done();
      }
      if (d.flog) {
        R.panel = {
          k: 'log',
          shop: d.flog,
          out: null
        };
        return done();
      }
      if (d.vout) {
        R.panel.out = d.vout;
        R.panel.next = (document.getElementById('vnext') || {}).value || '';
        if (d.vout === 'Not interested' || d.vout === 'Signed') R.panel.when = '';
        e.stopImmediatePropagation();
        return renderPanel();
      }
      if (d.vwhen !== undefined) {
        R.panel.when = d.vwhen;
        R.panel.next = (document.getElementById('vnext') || {}).value || '';
        e.stopImmediatePropagation();
        return renderPanel();
      }
      if (t.hasAttribute('data-vsave') && LV) {
        // live: the visit is a line in the shop's pipeline log, and its outcome moves the card (Not interested takes it off)
        const P = R.panel,
          l = LEADS.find(x => x.shop === P.shop),
          m = l && MS.find(x => x.id === l.id),
          nxt = OUTC[P.out][2],
          note = ((document.getElementById('vnote') || {}).value || '').trim(),
          next = ((document.getElementById('vnext') || {}).value || '').trim(),
          moves = l && nxt && nxt !== l.stage && !(nxt === 'talking' && l.stage !== 'prospect'),
          w = P.when ?? '3';
        R.panel = null;
        if (!m || !m.card) {
          toast('This shop isn’t in the pipeline yet');
          return done();
        }
        const c = m.card,
          closing = moves && nxt === 'closed';
        cardSave(c, {
          stage: moves && !closing ? nxt : c.stage,
          next: next || (P.out === 'Demo booked' ? 'Demo the merchant app' : P.out === 'Ready to sign' ? 'Sign the agreement' : c.next || null),
          due: w === '' ? null : TODAY + +w * DAY
        }, [{
          text: visitText(P.out, moves ? l.stage : null, moves ? nxt : null, note),
          type: 'visit'
        }], closing ? () => run('merchants', 'card-remove', {
          id: c.id,
          reason: 'Not interested'
        }, () => renderShell()) : null, `Visit saved${moves && !closing ? ` · ${P.shop} is now ${STAGE_N[nxt]} in Merchants` : ''}`);
        return done();
      }
      if (t.hasAttribute('data-vsave')) {
        const P = R.panel,
          l = LEADS.find(x => x.shop === P.shop),
          nxt = OUTC[P.out][2],
          note = (document.getElementById('vnote') || {}).value || '',
          next = (document.getElementById('vnext') || {}).value || '';
        const from = l ? l.stage : null,
          moves = l && nxt && nxt !== l.stage && !(nxt === 'talking' && l.stage !== 'prospect');
        const now = new Date(),
          tm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        VLOG.unshift({
          d: 0,
          t: tm,
          who: R.me,
          shop: P.shop,
          city: l ? l.city : '',
          kind: 'merchant',
          what: l ? l.next : 'Follow up',
          out: P.out,
          note,
          photo: false,
          from,
          to: moves ? nxt : null
        });
        if (l) {
          if (moves) l.stage = nxt;
          l.last = 0;
          const w = P.when ?? '3';
          l.due = w === '' ? null : +w;
          if (next) l.next = next;else if (P.out === 'Demo booked') l.next = 'Demo the merchant app';else if (P.out === 'Ready to sign') l.next = 'Sign the agreement';
        }
        if (P.stop != null) {
          const cur = curStop(),
            tk = cur && cur.tasks[P.stop];
          if (tk) {
            tk.done = tm;
            tk.out = P.out;
          }
        }
        R.panel = null;
        toast(`Visit saved${moves ? ` · ${P.shop} is now ${STAGE_N[nxt]} in Merchants` : ''}`);
        return done();
      }
    }, true);

    /* ══ Field: posters and the people who keep them up ══════════════════════════════════════════
       Today is the phone on the route. Plan builds the next routes at a desk. Posters is the fleet.
       Placement is where the next posters go. Counter devices belong to Merchants; Field only gets the fixes as stops. */
    const F = {
      _tab: 'today',
      get tab() {
        return this._tab;
      },
      set tab(v) {
        this._tab = v;
        if (PAGE === 'merchants' && LIVE()) setTimeout(() => CC.go('field'));
      },
      scan: null,
      outcome: null,
      poster: null,
      pf: 'all',
      pq: '',
      page: 0,
      place: null,
      day: 1,
      who: {
        1: 'marcus',
        2: 'dana',
        5: 'marcus'
      },
      plan: {
        1: new Set(['p90', 'p63', 'n1']),
        2: new Set(['d1', 'd2']),
        5: new Set()
      },
      saved: {},
      later: new Set()
    };
    const PHONE = () => matchMedia('(max-width:760px)').matches;
    const stopDone = s => s.tasks.every(t => t.done);
    const curStop = () => STOPS.find(s => !stopDone(s));
    const ICO = {
      x: <svg className="i" viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15" /></svg>,
      chk: <svg className="i" viewBox="0 0 20 20"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>,
      scan: <svg className="i" viewBox="0 0 20 20"><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4M6 10h8" /></svg>,
      out: <svg className="i" viewBox="0 0 20 20"><path d="M11 4h5v5M16 4l-7 7M14 12v4H4V6h4" /></svg>,
      cam: <svg className="i" viewBox="0 0 20 20"><path d="M3 7h3l1.5-2h5L14 7h3v9H3z" /><circle cx="10" cy="11.5" r="2.8" /></svg>,
      warn: <svg className="i" viewBox="0 0 20 20" style={css("width:15px;height:15px;flex:none")}><path d="M10 3l8 14H2z" /><path d="M10 8v4M10 14v1" /></svg>
    };
    const sevCol = s => `var(--${s === 'line' ? 'line' : s})`;

    /* ── header: brief + the same four vitals on every tab ── */
    function renderHdr() {
      if (LV) return renderHdrLive();
      const up = POSTERS.filter(p => p.status === 'up').length,
        due = POSTERS.filter(p => p.status === 'due').length,
        faded = POSTERS.filter(p => p.status === 'faded').length,
        miss = POSTERS.filter(p => p.status === 'missing').length,
        tot = POSTERS.length;
      const done = STOPS.filter(stopDone).length,
        cur = curStop();
      const scans = POSTERS.reduce((s, p) => s + p.scans, 0),
        soon = POSTERS.filter(p => p.status === 'up' && daysTo(p.swap) <= 14).length;
      const city = cityRows(),
        best = city.slice().sort((a, b) => b.per - a.per)[0],
        gap = city.filter(c => c.waiting && !c.posters).sort((a, b) => b.waiting - a.waiting)[0] || city.slice().sort((a, b) => b.waiting / Math.max(1, b.posters) - a.waiting / Math.max(1, a.posters))[0];
      const late = POSTERS.find(p => p.n === 44);
      const S = {
        today: cur ? <><a data-ftab="today" data-fjump="fnow">{"Marcus Lee is at "}{cur.name}</a>{", stop "}{STOPS.indexOf(cur) + 1}{" of "}{STOPS.length}{". Next is "}{STOPS[STOPS.indexOf(cur) + 1]?.name || 'the last stop'}{", where "}{pid(44)}{" is "}{-daysTo(late.swap)}{" days past its swap."}</> : 'Today’s route is done. Anything left moves to tomorrow.',
        plan: (() => {
          const tm = R.routes.filter(x => x.d === 1),
            draft = tm.filter(x => x.status !== 'accepted'),
            open = POOL.filter(x => !R.dropped.has(x.id) && !R.snoozed.has(x.id) && !routeOf(x.id)).length,
            mer = POOL.filter(x => x.kind === 'merchant' && !routeOf(x.id)).length;
          return <>{tm.length}{" route"}{tm.length === 1 ? '' : 's'}{" tomorrow"}{draft.length ? <>{", "}{draft.map((x, __k) => <Fragment key={__k}>{__k ? ' and ' : ''}<a data-froute={x.id}>{firstName(x.who)}{"’s "}{x.status === 'sent' ? 'isn’t accepted yet' : 'isn’t sent yet'}</a></Fragment>)}</> : ', all accepted'}{". "}<a data-ftab="plan" data-fjump="fpool">{open}{" things need a visit"}</a>{" and aren’t on any route, "}{mer}{" of them merchant visits."}</>;
        })(),
        visits: (() => {
          const od = dueLeads().filter(l => l.due < 0),
            sg = VLOG.find(v => v.out === 'Signed' && v.d === 0);
          return <>{sg ? <>{firstName(sg.who)}{" signed "}<a data-fvisit={VLOG.indexOf(sg)}>{sg.shop}</a>{" today. "}</> : ''}{od.length ? <><a data-vlf="due">{od.length}{" follow-up"}{od.length === 1 ? ' is' : 's are'}{" overdue"}</a>{", "}{od.map(l => l.shop).join(' and ')}.</> : 'No follow-ups are overdue.'}</>;
        })(),
        posters: `${up} of ${tot} posters are up. ${pid(44)} at Mesa Laundry is ${-daysTo(late.swap)} days past its swap, and ${soon} more come due in the next two weeks.`,
        placement: `${best.city} gets ${best.per} scans a poster, the most of any city, from ${best.posters} posters. ${gap.city} has ${int(gap.waiting)} people waiting and ${gap.posters ? 'only ' + gap.posters + ' poster' + (gap.posters === 1 ? '' : 's') : 'no posters'}.`
      }[F.tab];
      html(document.getElementById('hdr'), <><span className="when"><span className="dot" />Field · Wed 21 Oct · Demo data</span><p className="brief">{S}</p><div className="strip"><div className="sc"><span className="lbl">Posters up</span><div className="sc-v">{up}{" "}<small>{"of "}{tot}</small></div><div className="mb"><i style={css(`width:${up / tot * 100}%`)} /><i style={css(`left:${up / tot * 100}%;width:${due / tot * 100}%;background:var(--land)`)} /><i style={css(`left:${(up + due) / tot * 100}%;width:${faded / tot * 100}%;background:var(--underway)`)} /><i style={css(`left:${(up + due + faded) / tot * 100}%;width:${miss / tot * 100}%;background:var(--absent)`)} /></div><div className="sc-s">{due}{" swap due · "}{faded}{" faded · "}{miss}{" missing"}</div></div><div className="sc"><span className="lbl">Today’s route</span><div className="sc-v">{done}{" "}<small>{"of "}{STOPS.length}{" stops"}</small></div><div className="mb"><i style={css(`width:${done / STOPS.length * 100}%`)} /><span className="hroom" style={css(`left:${done / STOPS.length * 100}%;right:0`)} /></div><div className="sc-s">Marcus Lee · back by 14:00</div></div><div className="sc"><span className="lbl">Visits · 7 days</span><div className="sc-v">{visitsIn(7).length}{" "}<small>{visitsIn(7).filter(v => v.kind === 'merchant').length}{" merchant"}</small></div><div className="mb"><i style={css(`width:${visitsIn(7).filter(v => v.kind === 'poster').length / Math.max(1, visitsIn(7).length) * 100}%`)} /><i style={css(`left:${visitsIn(7).filter(v => v.kind === 'poster').length / Math.max(1, visitsIn(7).length) * 100}%;width:${visitsIn(7).filter(v => v.kind === 'merchant').length / Math.max(1, visitsIn(7).length) * 100}%;background:var(--live)`)} /></div><div className="sc-s">{visitsIn(7).filter(v => v.to).length}{" moved a shop forward · "}{new Set(visitsIn(7).map(v => v.who)).size}{" people out"}</div></div><div className="sc"><span className="lbl">Follow-ups due</span><div className="sc-v">{dueLeads().filter(l => l.due <= 2).length}{" "}<small>next 2 days</small></div><div className="mb"><i style={css(`width:${dueLeads().filter(l => l.due < 0).length / Math.max(1, dueLeads().length) * 100}%;background:var(--absent)`)} /><i style={css(`left:${dueLeads().filter(l => l.due < 0).length / Math.max(1, dueLeads().length) * 100}%;width:${dueLeads().filter(l => l.due >= 0 && l.due <= 2).length / Math.max(1, dueLeads().length) * 100}%;background:var(--underway)`)} /></div><div className="sc-s">{dueLeads().filter(l => l.due < 0).length}{" overdue · "}{dueLeads().filter(l => !leadRoute(l)).length}{" not on a route"}</div></div></div></>);
    }

    /* ══ Live (REAL): the header from the route, the posters and the pipeline as they are ═════════ */
    /** The route's person, by first name; "The route" when there's none today. */
    const staffFirst = () => LV.ROUTE.staff ? LV.ROUTE.staff.split(' ')[0] : 'The route';
    /** The poster furthest past its swap (still in a window), if any is. */
    const latePoster = () => POSTERS.filter(p => p.status !== 'missing' && daysTo(p.swap) < 0).sort((a, b) => a.swap - b.swap)[0];
    function renderHdrLive() {
      const up = POSTERS.filter(p => p.status === 'up').length,
        due = POSTERS.filter(p => p.status === 'due').length,
        faded = POSTERS.filter(p => p.status === 'faded').length,
        miss = POSTERS.filter(p => p.status === 'missing').length,
        tot = POSTERS.length,
        T = Math.max(1, tot);
      const done = STOPS.filter(stopDone).length,
        cur = curStop(),
        N = STOPS.length;
      const soon = POSTERS.filter(p => p.status === 'up' && daysTo(p.swap) >= 0 && daysTo(p.swap) <= 14).length,
        late = latePoster();
      const city = cityRows().filter(c => c.posters),
        best = city.slice().sort((a, b) => b.per - a.per)[0],
        gap = LV.waitingKnown ? city.concat(cityRows().filter(c => !c.posters)).filter(c => c.waiting).sort((a, b) => b.waiting / Math.max(1, b.posters) - a.waiting / Math.max(1, a.posters))[0] : null;
      const open = POOL.filter(x => !R.dropped.has(x.id) && !R.snoozed.has(x.id)).length,
        mer = POOL.filter(x => x.kind === 'merchant').length;
      const nextLate = cur ? (STOPS[STOPS.indexOf(cur) + 1]?.tasks || []).map(t => t.p).find(p => p && daysTo(p.swap) < 0) : null;
      const S = {
        today: !N ? <>{"Nobody is out on a route today. "}<a data-ftab="plan" data-fjump="fpool">{open}{open === 1 ? ' thing needs' : ' things need'}{" a visit"}</a>.</> : cur ? <><a data-ftab="today" data-fjump="fnow">{LV.ROUTE.staff || 'The route'}{" is at "}{cur.name}</a>{", stop "}{STOPS.indexOf(cur) + 1}{" of "}{N}{". Next is "}{STOPS[STOPS.indexOf(cur) + 1]?.name || 'the last stop'}{nextLate ? `, where ${pid(nextLate.n)} is ${-daysTo(nextLate.swap)} days past its swap.` : '.'}</> : 'Today’s route is done.',
        plan: <>{"Routes for the coming days aren’t planned here yet. "}<a data-ftab="plan" data-fjump="fpool">{open}{open === 1 ? ' thing needs' : ' things need'}{" a visit"}</a>{`, ${mer} of them merchant visits.`}</>,
        visits: (() => {
          const od = dueLeads().filter(l => l.due < 0),
            sg = VLOG.find(v => v.out === 'Signed' && v.d === 0);
          return <>{sg ? <>{firstName(sg.who)}{" signed "}<a data-fvisit={VLOG.indexOf(sg)}>{sg.shop}</a>{" today. "}</> : ''}{od.length ? <><a data-vlf="due">{od.length}{" follow-up"}{od.length === 1 ? ' is' : 's are'}{" overdue"}</a>{", "}{od.slice(0, 3).map(l => l.shop).join(' and ')}{od.length > 3 ? ` and ${od.length - 3} more` : ''}.</> : 'No follow-ups are overdue.'}</>;
        })(),
        posters: !tot ? 'No posters are up yet. They show here once the first one is added.' : `${up} of ${tot} posters are up.${late ? ` ${pid(late.n)} at ${late.shop} is ${-daysTo(late.swap)} days past its swap, and ${soon} more ${soon === 1 ? 'comes' : 'come'} due in the next two weeks.` : ` ${soon} ${soon === 1 ? 'comes' : 'come'} due in the next two weeks.`}`,
        placement: !best ? 'No posters are up yet, so there’s nothing to compare.' : `${best.city} gets ${best.per} scans a poster, the most of any city, from ${best.posters} poster${best.posters === 1 ? '' : 's'}.${gap ? ` ${gap.city} has ${int(gap.waiting)} people waiting and ${gap.posters ? 'only ' + gap.posters + ' poster' + (gap.posters === 1 ? '' : 's') : 'no posters'}.` : ''}`
      }[F.tab];
      const v7 = visitsIn(7),
        V7 = Math.max(1, v7.length),
        dl = dueLeads(),
        DL = Math.max(1, dl.length);
      html(document.getElementById('hdr'), <><span className="when"><span className="dot" />{`Field · ${fmtWD(TODAY)}`}</span><p className="brief">{S}</p><div className="strip"><div className="sc"><span className="lbl">Posters up</span><div className="sc-v">{up}{" "}<small>{"of "}{tot}</small></div><div className="mb"><i style={css(`width:${up / T * 100}%`)} /><i style={css(`left:${up / T * 100}%;width:${due / T * 100}%;background:var(--land)`)} /><i style={css(`left:${(up + due) / T * 100}%;width:${faded / T * 100}%;background:var(--underway)`)} /><i style={css(`left:${(up + due + faded) / T * 100}%;width:${miss / T * 100}%;background:var(--absent)`)} /></div><div className="sc-s">{due}{" swap due · "}{faded}{" faded · "}{miss}{" missing"}</div></div><div className="sc"><span className="lbl">Today’s route</span><div className="sc-v">{done}{" "}<small>{"of "}{N}{" stops"}</small></div><div className="mb"><i style={css(`width:${done / Math.max(1, N) * 100}%`)} /><span className="hroom" style={css(`left:${done / Math.max(1, N) * 100}%;right:0`)} /></div><div className="sc-s">{N ? `${LV.ROUTE.staff || 'Someone'}${LV.ROUTE.backBy ? ' · back by ' + LV.ROUTE.backBy : ''}` : 'No route today'}</div></div><div className="sc"><span className="lbl">Visits · 7 days</span><div className="sc-v">{v7.length}{" "}<small>{v7.filter(v => v.kind === 'merchant').length}{" merchant"}</small></div><div className="mb"><i style={css(`width:${v7.filter(v => v.kind === 'poster').length / V7 * 100}%`)} /><i style={css(`left:${v7.filter(v => v.kind === 'poster').length / V7 * 100}%;width:${v7.filter(v => v.kind === 'merchant').length / V7 * 100}%;background:var(--live)`)} /></div><div className="sc-s">{v7.filter(v => v.to).length}{" moved a shop forward · "}{new Set(v7.map(v => v.who)).size}{" people out"}</div></div><div className="sc"><span className="lbl">Follow-ups due</span><div className="sc-v">{dl.filter(l => l.due <= 2).length}{" "}<small>next 2 days</small></div><div className="mb"><i style={css(`width:${dl.filter(l => l.due < 0).length / DL * 100}%;background:var(--absent)`)} /><i style={css(`left:${dl.filter(l => l.due < 0).length / DL * 100}%;width:${dl.filter(l => l.due >= 0 && l.due <= 2).length / DL * 100}%;background:var(--underway)`)} /></div><div className="sc-s">{dl.filter(l => l.due < 0).length}{" overdue · "}{dl.length}{" from the pipeline"}</div></div></div></>);
    }
    /** A cell with no real source yet: hatched, with what it needs (as Money's and Build's). */
    const notReal = (cls, title, need, id) => <div className={`cell ${cls}`} {...attrs(id ? `id="${id}"` : '')}><div className="hd"><h2>{title}</h2><div className="r"><span className="lbl">Not real yet</span></div></div><div className="bk-empty hatch" style={css("min-height:120px;opacity:.5")} /><div className="bk-empty">{need}</div><div className="bk-ft"><span /><span /></div></div>;
    /** Runs a field action, then draws the shell again: the page is built again from what the server now holds. */
    const fieldDo = (kind, body, done) => run('field', kind, body, () => {
      if (done) toast(done);
      renderShell();
    });
    /**
     * Saves a pipeline card whole, as the API takes it (POST /actions/merchants/card-save), with what changed and the
     * log lines to add; then `then`, or the shell draws again. The card is the API's, so nothing it holds is lost.
     */
    const cardSave = (c, patch, log, then, msg) => run('merchants', 'card-save', {
      id: c.id,
      name: c.name || 'Untitled',
      kind: c.kind || '',
      city: c.city || '',
      stage: c.stage,
      owner: c.owner ?? null,
      val: c.val ?? null,
      next: c.next || null,
      due: c.due ?? null,
      contact: Object.fromEntries(['name', 'role', 'phone', 'email'].map(k => [k, String(c.contact?.[k] ?? '')])),
      source: c.source || '',
      addr: c.addr || '',
      note: c.note || '',
      flag: !!c.flag,
      ...patch,
      log: log || []
    }, r => {
      if (msg) toast(msg);
      if (then) then(r);else renderShell();
    });

    /* ── shared bits ── */
    const chip = (t, cls = '') => <span className={`fch ${cls}`}>{t}</span>;
    const stopMark = (i, st) => <span className={`fno ${st}`}>{st === 'done' ? ICO.chk : i + 1}</span>;

    /* ══ Today ══ */
    /* maps fill their space edge to edge: draw at the box's own shape, and redraw if the box changes shape */
    const FIT = {};
    function fitMap(k, build, asp0) {
      const f = FIT[k] ||= {
        asp: asp0
      };
      f.build = build;
      return build(f.asp);
    }
    function fitMaps() {
      let changed = false;
      Object.entries(FIT).forEach(([k, f]) => {
        const w = document.querySelector(`[data-fit="${k}"]`);
        if (!w || !w.clientHeight || !w.clientWidth) return;
        const a = w.clientWidth / w.clientHeight;
        if (Math.abs(a - f.asp) / f.asp > .03) {
          f.asp = a;
          html(w, f.build(a));
          changed = true;
        }
      });
      if (changed) fmMountAll();
      requestAnimationFrame(fmLayoutDrawn);
    }
    function routeMap(slot, list, curIdx, aspect) {
      // list: [{name, city}], curIdx: index of the stop you're at (-1 = a plan, nothing done)
      const LL = list.map(s => shopLL(s.name, s.city)),
        m = mkMap(list.length ? boundsOf(LL, .018) : FULL, aspect);
      const P = LL.map(([la, lo]) => m.p(la, lo));
      const pos = q => `left:${(q[0] / m.W * 100).toFixed(2)}%;top:${(q[1] / m.H * 100).toFixed(2)}%`;
      const state = i => curIdx < 0 ? 'next' : i < curIdx ? 'done' : i === curIdx ? 'now' : 'next';
      // a stop: a dot on the exact spot, and a numbered tag that moves out of the way of other stops, tied back by a leader line
      const pin = (s, i, style = '') => {
        const st = state(i);
        return <span className={`fsp ${st}`} {...attrs(style)} aria-label={`${i + 1}. ${s.name}${st === 'done' ? ', done' : st === 'now' ? ', you are here' : ''}`}><svg className="fsp-l" aria-hidden="true"><line x1="0" y1="0" x2="0" y2="0" /></svg><i className="fsp-d" /><b className="fsp-t">{i + 1}<em>{s.name}</em></b></span>;
      };
      const leg = (q, i) => `M${P[i].map(v => v.toFixed(1)).join(',')} L${q.map(v => v.toFixed(1)).join(',')}`;
      const svg = <>{P.slice(1).map((q, i) => <path key={i} className="fm-rc" d={leg(q, i)} />)}{P.slice(1).map((q, i) => <path key={i} className={`fm-rt ${curIdx >= 0 && i < curIdx ? 'done' : ''}`} d={leg(q, i)} />)}</>;
      const fallback = areaMap(m, {
        svg,
        pins: list.map((s, i) => pin(s, i, `style="${pos(P[i])}"`)),
        cls: 'rt'
      });
      const lngLat = LL.map(([la, lo]) => [lo, la]),
        bb = list.length ? boundsOf(LL, .01) : FULL;
      return fmSlot(slot, {
        bounds: [[bb[0], bb[2]], [bb[1], bb[3]]],
        pad: 36,
        route: lngLat,
        done: Math.max(0, curIdx),
        pins: list.map((s, i) => ({
          ll: lngLat[i],
          html: pin(s, i)
        }))
      }, fallback, 'rt');
    }
    function renderToday() {
      if (LV) return renderTodayLive();
      const done = STOPS.filter(stopDone).length,
        cur = curStop(),
        ci = cur ? STOPS.indexOf(cur) : STOPS.length,
        nx = cur ? STOPS[ci + 1] : null;
      const leftMins = STOPS.filter(s => !stopDone(s)).length * 34;
      const info = cur ? SHOP_INFO[cur.id] : null;
      const now = cur ? <div className="cell s7" id="fnow"><div className="hd"><h2>{"Now · stop "}{ci + 1}{" of "}{STOPS.length}</h2><div className="r"><span className="lbl">{"ETA "}{cur.eta}</span></div></div><div className="fn-top"><p className="fn-name">{cur.name}</p><span>{cur.where}{" · "}{cur.city}</span></div><div className="fn-facts"><div><span className="lbl">Open until</span><b>{info[0]}</b></div><div><span className="lbl">Ask for</span><b>{info[1]}</b></div><div><span className="lbl">Last visit</span><b>{info[2]}</b></div></div><div className="fn-tasks">{cur.tasks.map((t, i) => <div key={i} className={`fn-t ${t.done ? 'done' : ''}`}><span className="fn-c">{t.done ? ICO.chk : ''}</span><span className="fn-k"><b>{t.t}</b><span>{t.done ? `${t.out} at ${t.done}` : t.kind === 'poster' ? `Design ${t.p.design} · ${t.note || 'Scan the code to log it'}` : t.note}</span></span>{t.done ? '' : t.kind === 'poster' ? <button className="btn sm-b" data-fscan={t.p.n}>{ICO.scan}Scan</button> : t.kind === 'merchant' ? <button className="btn sm-b" data-fdev={i}>Log the visit</button> : <button className="btn sm-b" data-fdev={i}>Mark done</button>}</div>)}</div><div className="f-ft2"><button className="lnk3" data-fskip="">Skip{nx ? ` · next is ${nx.name}` : ''}</button><a className="lnk3" href={`https://maps.google.com/?q=${encodeURIComponent(cur.name + ' ' + cur.city + ' CA')}`} target="_blank" rel="noopener">Directions ↗</a></div></div> : <div className="cell s7" id="fnow"><div className="hd"><h2>Route done</h2></div><div className="fn-top"><p className="fn-name">{"All "}{STOPS.length}{" stops logged"}</p><span>Anything left over moves to tomorrow.</span></div><div className="f-ft2"><span className="small quiet">Back at 13:52</span><button className="lnk3" data-ftab="plan">Plan tomorrow →</button></div></div>;
      const map = <div className="cell s5"><div className="hd"><h2>The route</h2><div className="r"><span className="lbl">{int(31)}{" mi · 8 stops"}</span></div></div><div className="fm-wrap" data-fit="today">{fitMap('today', a => routeMap('today', STOPS, ci, a), .86)}</div><div className="bk-ft"><span><b>{done}{" of "}{STOPS.length}</b>{" done · about "}{Math.floor(leftMins / 60)}{" h "}{leftMins % 60}{" min left"}</span><span className="f-key"><i className="k-done" />{"Done "}<i className="k-now" />{"Now "}<i className="k-next" />Next</span></div></div>;
      // stops, grouped by city
      const groups = [];
      STOPS.forEach((s, i) => {
        const g = groups[groups.length - 1];
        if (g && g.city === s.city) g.stops.push([s, i]);else groups.push({
          city: s.city,
          stops: [[s, i]]
        });
      });
      const list = <div className="cell s7"><div className="hd"><h2>Stops</h2><div className="r"><span className="lbl">Marcus Lee · started 08:50</span></div></div><div className="fs-l">{groups.map((g, __k) => <Fragment key={__k}><div className="fs-g"><span className="lbl">{g.city}</span><span>{g.stops.filter(([s]) => stopDone(s)).length}{" of "}{g.stops.length}</span></div>{g.stops.map(([s, i], __k) => {
              const d = stopDone(s),
                isNow = s === cur;
              return <div key={__k} className={`fs-r ${d ? 'done' : ''} ${isNow ? 'now' : ''}`}>{stopMark(i, d ? 'done' : isNow ? 'now' : 'next')}<span className="fs-k"><b>{s.name}</b><span>{s.where}</span></span><span className="fs-t">{s.tasks.map((t, i) => <Fragment key={i}>{chip(t.kind === 'poster' ? pid(t.p.n) : t.kind === 'merchant' ? 'Merchant' : 'Device', t.done ? 'ok' : '')}</Fragment>)}</span><span className="fs-e">{d ? s.tasks[s.tasks.length - 1].done : isNow ? <b className="warn">Now</b> : s.eta}</span></div>;
            })}</Fragment>)}</div><div className="bk-ft"><span>Back by 14:00 if nothing runs long</span><button data-ftab="plan">Plan tomorrow →</button></div></div>;
      // the van: what's loaded against what today still needs
      const need = {
        A: 0,
        B: 0,
        C: 0
      };
      STOPS.forEach(s => s.tasks.forEach(t => {
        if (t.kind === 'poster' && !t.done && /^(Swap|Replace)/.test(t.t)) need[t.p.design]++;
      }));
      const needN = Object.values(need).reduce((a, b) => a + b, 0);
      const van = <div className="cell s5"><div className="hd"><h2>In the van</h2><div className="r"><span className="lbl">Loaded 08:40</span></div></div><div className="fv">{Object.keys(VAN).map((k, __k) => <div key={__k} className="fv-r">{designThumb(k, 22)}<span className="fv-k"><b>{"Design "}{k}</b><span>{need[k]}{" still to put up · "}{VAN[k]}{" loaded"}</span></span><span className="fv-u">{Array.from({
                length: VAN[k]
              }, (_, i) => <i key={i} className={i < need[k] ? 'need' : ''} />)}</span></div>)}<div className="fv-r">{batteryThumb(22)}<span className="fv-k"><b>Clear Point batteries</b><span>1 for Citrus Bowl table 4 · 2 loaded</span></span><span className="fv-u"><i className="need" /><i /></span></div></div><div className="bk-ft"><span><b>{needN}</b>{" posters still to put up today"}</span><span className="f-key"><i className="k-need" />{"Needed "}<i className="k-spare" />Spare</span></div></div>;
      // logged today
      const log = [];
      STOPS.forEach(s => s.tasks.forEach(t => {
        if (t.done) log.push({
          s,
          t
        });
      }));
      log.sort((a, b) => b.t.done.localeCompare(a.t.done));
      const cnt = k => log.filter(l => l.t.out === k).length,
        devN = log.filter(l => l.t.kind === 'device').length;
      const tiles = [...Object.keys(OUT).map(k => [k, cnt(k), OUT[k][1], OUT[k][0]]), ['Devices', devN, 'Fixed', 'settled']];
      const logged = <div className="cell s12"><div className="hd"><h2>Logged today</h2><div className="r"><span className="lbl">{log.length}{" things · "}{log.filter(l => l.t.photo).length}{" with a photo"}</span></div></div><div className="fl-tiles">{tiles.map(([k, n, s, c], __k) => <div key={__k} className={`fl-t ${n ? '' : 'z'}`}><span className="lbl">{k}</span><b style={css(n ? `color:var(--${c === 'settled' ? 'fg' : c})` : '')}>{n}</b><span>{s}</span></div>)}</div><div className="fl-l">{log.length ? log.map((l, __k) => <div key={__k} className="fl-r"><span className="fl-tm">{l.t.done}</span><i className="fl-sv" style={css(`background:var(--${l.t.kind === 'poster' ? OUT[l.t.out][0] : 'settled'})`)} /><span className="fl-k"><b>{l.t.kind === 'poster' ? `${l.t.out} ${pid(l.t.p.n)}` : 'Fixed the counter device'}</b><span>{l.s.name}{l.t.noteIn ? ' · ' + l.t.noteIn : ''}</span></span><span className="fl-d">{l.t.kind === 'poster' ? <>{designThumb(l.t.p.design, 16)}{" Design "}{l.t.p.design}</> : 'Counter device'}</span><span className="fl-ph">{l.t.photo ? <>{ICO.cam}Photo</> : <span className="quiet">No photo</span>}</span></div>) : <p className="small quiet" style={css("padding:18px 22px;margin:0")}>Scans show up here as they happen.</p>}</div><div className="bk-ft"><span>Every scan is logged with the time and place</span><button data-fgo="records">Audit log · Records →</button></div></div>;
      // found on earlier checks, not on today's route
      const later = POOL.filter(x => x.kind !== 'new' && (x.sev === 'absent' || x.sev === 'underway')).slice(0, 3);
      const lat = <div className="cell s12"><div className="hd"><h2>Found on earlier checks</h2><div className="r"><span className="lbl">Not on today’s route</span></div></div><div className="fw-l">{later.map((x, __k) => <div key={__k} className="fw-r"><i className="fl-sv" style={css(`background:${sevCol(x.sev)}`)} /><span className="fw-k"><b>{x.shop}</b><span>{x.city}</span></span><span className="fw-w"><b>{x.what}</b><span>{x.why}</span></span><span className="fw-m">+{x.mins}{" min"}</span><button className={`btn sm-b ${F.later.has(x.id) ? 'on' : ''}`} data-flater={x.id}>{F.later.has(x.id) ? 'Added ✓' : 'Add to today'}</button></div>)}</div><div className="bk-ft"><span>{"Adding all "}{later.length}{" makes today about "}{later.reduce((s, x) => s + x.mins, 0)}{" min longer"}</span><button data-ftab="plan">Put them on another day →</button></div></div>;
      html(document.getElementById('fv'), <>{PHONE() ? [now, list, map, van].map((c, i) => <section key={i} className="band" {...attrs(i ? '' : 'style="margin-top:0"')}><div className="bento">{swapClass(c, /cell s[57]/, 'cell s12')}</div></section>) : <><section className="band" style={css("margin-top:0")}><div className="bento">{now}{van}</div></section><section className="band"><div className="bento">{list}{map}</div></section></>}<section className="band"><div className="bento">{logged}</div></section><section className="band"><div className="bento">{lat}</div></section><div className="fbar"><button className="btn p" data-fscan="pick">{ICO.scan}Scan a poster</button></div></>);
    }

    /* live: today's route as the phone has it, what was found on earlier checks, and no van (nothing records its load) */
    function renderTodayLive() {
      const N = STOPS.length,
        done = STOPS.filter(stopDone).length,
        cur = curStop(),
        ci = cur ? STOPS.indexOf(cur) : N,
        nx = cur ? STOPS[ci + 1] : null,
        per = LV.ROUTE.minutesPerStop || 0,
        leftMins = STOPS.filter(s => !stopDone(s)).length * per,
        staff = LV.ROUTE.staff || 'Someone';
      const info = cur ? SHOP_INFO[cur.id] || ['', '', ''] : null;
      const sub = t => t.done ? `${t.out || 'Done'} at ${t.done}` : t.kind === 'poster' ? `Design ${t.p.design} · ${t.note || 'Scan the code to log it'}` : t.note || '';
      const now = !N ? <div className="cell s7" id="fnow"><div className="hd"><h2>No route today</h2></div><div className="fn-top"><p className="fn-name">Nobody is out</p><span>A route shows here once the field team starts one on the phone.</span></div><div className="f-ft2"><span className="small quiet">Routes ahead aren’t planned here yet</span><button className="lnk3" data-ftab="plan">What needs a visit →</button></div></div> : cur ? <div className="cell s7" id="fnow"><div className="hd"><h2>{"Now · stop "}{ci + 1}{" of "}{N}</h2><div className="r"><span className="lbl">{cur.eta ? 'ETA ' + cur.eta : ''}</span></div></div><div className="fn-top"><p className="fn-name">{cur.name}</p><span>{[cur.where, cur.city].filter(Boolean).join(' · ')}</span></div><div className="fn-facts"><div><span className="lbl">Open until</span><b>{info[0] || '–'}</b></div><div><span className="lbl">Ask for</span><b>{info[1] || '–'}</b></div><div><span className="lbl">Last visit</span><b>{info[2] || '–'}</b></div></div><div className="fn-tasks">{cur.tasks.map((t, i) => <div key={i} className={`fn-t ${t.done ? 'done' : ''}`}><span className="fn-c">{t.done ? ICO.chk : ''}</span><span className="fn-k"><b>{t.t}</b><span>{sub(t)}</span></span>{t.done ? '' : t.kind === 'poster' ? <button className="btn sm-b" data-fscan={t.p.n}>{ICO.scan}Scan</button> : <button className="btn sm-b" data-fdev={i}>Mark done</button>}</div>)}</div><div className="f-ft2"><button className="lnk3" data-fskip="">Skip{nx ? ` · next is ${nx.name}` : ''}</button><a className="lnk3" href={`https://maps.google.com/?q=${encodeURIComponent(cur.name + ' ' + cur.city)}`} target="_blank" rel="noopener">Directions ↗</a></div></div> : <div className="cell s7" id="fnow"><div className="hd"><h2>Route done</h2></div><div className="fn-top"><p className="fn-name">{"All "}{N}{" stops logged"}</p><span>Anything left over goes back to what needs a visit.</span></div><div className="f-ft2"><span className="small quiet">{LV.ROUTE.backBy ? 'Back by ' + LV.ROUTE.backBy : ''}</span><button className="lnk3" data-ftab="plan">What needs a visit →</button></div></div>;
      const map = <div className="cell s5"><div className="hd"><h2>The route</h2><div className="r"><span className="lbl">{LV.ROUTE.miles ? int(LV.ROUTE.miles) + ' mi · ' : ''}{N}{N === 1 ? ' stop' : ' stops'}</span></div></div><div className="fm-wrap" data-fit="today">{fitMap('today', a => routeMap('today', STOPS, ci, a), .86)}</div><div className="bk-ft"><span><b>{done}{" of "}{N}</b>{" done"}{per ? ` · about ${Math.floor(leftMins / 60)} h ${leftMins % 60} min left` : ''}</span><span className="f-key"><i className="k-done" />{"Done "}<i className="k-now" />{"Now "}<i className="k-next" />Next</span></div></div>;
      const groups = [];
      STOPS.forEach((s, i) => {
        const g = groups[groups.length - 1];
        if (g && g.city === s.city) g.stops.push([s, i]);else groups.push({
          city: s.city,
          stops: [[s, i]]
        });
      });
      const list = <div className="cell s7"><div className="hd"><h2>Stops</h2><div className="r"><span className="lbl">{staff}{LV.ROUTE.started ? ' · started ' + LV.ROUTE.started : ''}</span></div></div><div className="fs-l">{groups.map((g, __k) => <Fragment key={__k}><div className="fs-g"><span className="lbl">{g.city}</span><span>{g.stops.filter(([s]) => stopDone(s)).length}{" of "}{g.stops.length}</span></div>{g.stops.map(([s, i], __k) => {
              const d = stopDone(s),
                isNow = s === cur;
              return <div key={__k} className={`fs-r ${d ? 'done' : ''} ${isNow ? 'now' : ''}`}>{stopMark(i, d ? 'done' : isNow ? 'now' : 'next')}<span className="fs-k"><b>{s.name}</b><span>{s.where}</span></span><span className="fs-t">{s.tasks.map((t, i) => <Fragment key={i}>{chip(t.kind === 'poster' ? pid(t.p.n) : 'Device', t.done ? 'ok' : '')}</Fragment>)}</span><span className="fs-e">{d ? s.tasks[s.tasks.length - 1].done : isNow ? <b className="warn">Now</b> : s.eta}</span></div>;
            })}</Fragment>)}</div><div className="bk-ft"><span>{LV.ROUTE.backBy ? `Back by ${LV.ROUTE.backBy} if nothing runs long` : ''}</span><button data-ftab="plan">What needs a visit →</button></div></div>;
      const van = notReal('s5', 'In the van', 'Needs what was loaded into the van this morning: posters by design, spare batteries and receipt rolls.');
      const log = [];
      STOPS.forEach(s => s.tasks.forEach(t => {
        if (t.done) log.push({
          s,
          t
        });
      }));
      log.sort((a, b) => b.t.done.localeCompare(a.t.done));
      const cnt = k => log.filter(l => l.t.kind === 'poster' && l.t.out === k).length,
        devN = log.filter(l => l.t.kind !== 'poster').length,
        tone = l => l.t.kind === 'poster' ? (OUT[l.t.out] || ['settled'])[0] : 'settled';
      const tiles = [...Object.keys(OUT).map(k => [k, cnt(k), OUT[k][1], OUT[k][0]]), ['Devices', devN, 'Fixed', 'settled']];
      const logged = <div className="cell s12"><div className="hd"><h2>Logged today</h2><div className="r"><span className="lbl">{log.length}{" things · "}{log.filter(l => l.t.photo).length}{" with a photo"}</span></div></div><div className="fl-tiles">{tiles.map(([k, n, s, c], __k) => <div key={__k} className={`fl-t ${n ? '' : 'z'}`}><span className="lbl">{k}</span><b style={css(n ? `color:var(--${c === 'settled' ? 'fg' : c})` : '')}>{n}</b><span>{s}</span></div>)}</div><div className="fl-l">{log.length ? log.map((l, __k) => <div key={__k} className="fl-r"><span className="fl-tm">{l.t.done}</span><i className="fl-sv" style={css(`background:var(--${tone(l)})`)} /><span className="fl-k"><b>{l.t.kind === 'poster' ? `${l.t.out} ${pid(l.t.p.n)}` : l.t.kind === 'device' ? 'Fixed the counter device' : l.t.t}</b><span>{l.s.name}{l.t.note ? ' · ' + l.t.note : ''}</span></span><span className="fl-d">{l.t.kind === 'poster' ? <>{designThumb(l.t.p.design, 16)}{" Design "}{l.t.p.design}</> : 'Counter device'}</span><span className="fl-ph">{l.t.photo ? <>{ICO.cam}Photo</> : <span className="quiet">No photo</span>}</span></div>) : <p className="small quiet" style={css("padding:18px 22px;margin:0")}>Scans show up here as they happen.</p>}</div><div className="bk-ft"><span>Every scan is logged with the time</span><button data-fgo="records">Audit log · Records →</button></div></div>;
      const later = LV.LATER;
      const lat = <div className="cell s12"><div className="hd"><h2>Found on earlier checks</h2><div className="r"><span className="lbl">Not on today’s route</span></div></div><div className="fw-l">{later.length ? later.map((x, __k) => <div key={__k} className="fw-r"><i className="fl-sv" style={css(`background:${sevCol(x.sev)}`)} /><span className="fw-k"><b>{x.shop}</b><span>{x.city}</span></span><span className="fw-w"><b>{x.what}</b><span>{x.why}</span></span><span className="fw-m">{x.mins ? `+${x.mins} min` : ''}</span>{N && !RO() ? <button className="btn sm-b" data-flater={x.shop}>Add to today</button> : <span />}</div>) : <p className="small quiet" style={css("padding:18px 22px;margin:0")}>Shops land here when a check finds a problem.</p>}</div><div className="bk-ft"><span>{later.length && N ? `Adding all ${later.length} makes today about ${later.reduce((s, x) => s + x.mins, 0)} min longer` : later.length ? 'They can join a route once one is out today' : ''}</span><span /></div></div>;
      const top = N ? [now, list, map, van] : [now, van];
      html(document.getElementById('fv'), <>{PHONE() ? top.map((c, i) => <section key={i} className="band" {...attrs(i ? '' : 'style="margin-top:0"')}><div className="bento">{swapClass(c, /cell s[57]/, 'cell s12')}</div></section>) : <><section className="band" style={css("margin-top:0")}><div className="bento">{now}{van}</div></section>{N ? <section className="band"><div className="bento">{list}{map}</div></section> : ''}</>}<section className="band"><div className="bento">{logged}</div></section><section className="band"><div className="bento">{lat}</div></section>{POSTERS.length && !RO() ? <div className="fbar"><button className="btn p" data-fscan="pick">{ICO.scan}Scan a poster</button></div> : ''}</>);
    }

    /* ══ Posters ══ */
    const life = p => {
      const age = daysTo(TODAY) - daysTo(p.hung),
        d = daysTo(p.swap);
      return {
        pct: Math.min(1, Math.max(0, (60 - d) / 60)),
        d
      };
    };
    function renderPosters() {
      const need = POSTERS.filter(p => p.status !== 'up').sort((a, b) => a.swap - b.swap);
      // swaps coming due, by week, with anything overdue first
      const wk = [['Late', -999, 0]];
      for (let w = 0; w < 8; w++) wk.push([w === 0 ? 'This week' : fmtD(TODAY + w * 7 * DAY), w * 7, w * 7 + 7]);
      const wc = wk.map(([t, a, b]) => [t, POSTERS.filter(p => p.status !== 'missing' && daysTo(p.swap) >= a && daysTo(p.swap) < b).length]);
      const wmx = Math.max(...wc.map(x => x[1]), 1);
      const due = <div className="cell s7"><div className="hd"><h2>Swaps coming due</h2><div className="r"><span className="lbl">Each poster lasts 60 days</span></div></div><div className="fd">{wc.map(([t, v], i) => <div key={i} className={`fd-c ${i === 0 ? 'late' : ''} ${i === 1 ? 'now' : ''}`}><b>{v}</b><span className="fd-b"><i style={css(`height:${v / wmx * 100}%`)} /></span><span className="fd-l">{t}</span></div>)}</div><div className="bk-ft"><span>{LV && !wc.slice(2).some(x => x[1]) ? 'No swaps come due in the next eight weeks.' : <>{"The week of "}{wc.slice(2).sort((a, b) => b[1] - a[1])[0][0]}{" is the busiest. Spread it over two routes."}</>}</span><button data-ftab="plan">Plan →</button></div></div>;
      const nowL = <div className="cell s5"><div className="hd"><h2>Needs you now</h2><div className="r"><span className="lbl">{need.length}{" posters"}</span></div></div><div className="fq">{need.map((p, __k) => {
            const d = daysTo(p.swap);
            return <button key={__k} className="fq-r" data-fposter={p.n}><span className="fq-t"><i className="sv" style={css(`background:var(--${ST[p.status][0]})`)} /><b>{pid(p.n)}{" · "}{p.shop}</b><span className="fq-a">{p.status === 'missing' ? 'Missing' : p.status === 'faded' ? 'Faded' : d < 0 ? `${-d}d late` : `in ${d}d`}</span></span><span className="fq-m">{p.city}{" · design "}{p.design}{" · "}{STOPS.some(s => s.tasks.some(t => t.p && t.p.n === p.n)) ? <b>on today’s route</b> : routeOf('p' + p.n) ? `on ${firstName(routeOf('p' + p.n).who)}’s ${fmtWD(dayT(dayOf('p' + p.n))).slice(0, 3)} route` : <span className="warn">not on a route</span>}</span></button>;
          })}</div><div className="bk-ft"><span>Swaps go on a route as they come due</span><button data-ftab="plan">Plan →</button></div></div>;
      // inventory
      const q = F.pq.trim().toLowerCase();
      let rows = POSTERS.filter(p => F.pf === 'all' || (F.pf === 'need' ? p.status !== 'up' : p.design === F.pf)).filter(p => !q || pid(p.n).toLowerCase().includes(q) || p.shop.toLowerCase().includes(q) || p.city.toLowerCase().includes(q));
      rows = rows.slice().sort((a, b) => a.swap - b.swap);
      const PG = 12,
        pages = Math.max(1, Math.ceil(rows.length / PG));
      F.page = Math.min(F.page, pages - 1);
      const view = rows.slice(F.page * PG, F.page * PG + PG),
        smx = Math.max(...POSTERS.map(p => p.scans));
      const inv = <div className="cell s12"><div className="hd"><h2>Every poster</h2><div className="r"><div className="seg sm" role="group" aria-label="Show">{[['all', 'All ' + POSTERS.length], ['need', 'Needs you ' + need.length], ['A', 'Design A'], ['B', 'Design B'], ['C', 'Design C']].map(([k, t], __k) => <button key={__k} data-fpf={k} aria-pressed={F.pf === k}>{t}</button>)}</div></div></div><div className="fi-s"><label className="msearch"><svg className="i" viewBox="0 0 20 20"><circle cx="9" cy="9" r="5" /><path d="M13 13l4 4" /></svg><input id="fpq" placeholder="Find a poster by code, shop or city" defaultValue={F.pq} /></label><span className="small quiet">Soonest swap first</span></div><div className="bt-wrap"><table className="bt fi"><colgroup><col style={css("width:22%")} /><col style={css("width:20%")} /><col style={css("width:28%")} /><col style={css("width:16%")} /><col style={css("width:14%")} /></colgroup><thead><tr><th className="c-nm">Poster</th><th style={css("text-align:left")}>Where</th><th style={css("text-align:left")}>Life · 60 days</th><th>Scans · 30 days</th><th>Status</th></tr></thead><tbody>{view.length ? view.map((p, __k) => {
                const L = life(p);
                return <tr key={__k} data-fposter={p.n}><td className="tn"><span className="fi-p">{designThumb(p.design, 18)}<span className="pn"><b>{pid(p.n)}</b><span>{"Design "}{p.design}{" · "}{DESIGNS[p.design].name}</span></span></span></td><td style={css("text-align:left")}><span className="pn"><b className="fi-sh">{p.shop}</b><span>{p.city}</span></span></td><td style={css("text-align:left")}><span className="fi-l"><span className={`fi-lb ${p.status === 'up' ? '' : 'bad'}`}><i style={css(`width:${L.pct * 100}%`)} /></span><span className={L.d < 0 || p.status !== 'up' ? 'warn' : ''}>{p.status === 'missing' ? 'Gone' : L.d < 0 ? `${-L.d}d late` : `swap ${fmtD(p.swap)}`}</span></span></td><td><span className="fi-sc"><span className="fi-sb"><i style={css(`width:${p.scans / smx * 100}%`)} /></span><b>{p.scans}</b></span></td><td>{chip(ST[p.status][1], p.status === 'up' ? 'ok' : p.status === 'missing' ? 'bad' : 'warn')}</td></tr>;
              }) : <tr><td colSpan="5" className="tn"><span className="quiet">No posters match.</span></td></tr>}</tbody></table></div><div className="bk-ft"><span>{rows.length ? `${F.page * PG + 1}–${Math.min(rows.length, (F.page + 1) * PG)} of ${rows.length}` : '0 posters'}</span><span className="pg2"><button data-fpage="-1" {...attrs(F.page === 0 ? 'disabled' : '')} aria-label="Previous"><svg viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg></button><button data-fpage="1" {...attrs(F.page >= pages - 1 ? 'disabled' : '')} aria-label="Next"><svg viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5" /></svg></button></span></div></div>;
      html(document.getElementById('fv'), <><section className="band" style={css("margin-top:0")}><div className="bento">{due}{nowL}</div></section><section className="band"><div className="bento">{inv}</div></section></>);
    }

    /* ══ Placement ══ */
    function cityRows() {
      const cities = Object.keys(GEO).map(c => {
        const ps = POSTERS.filter(p => p.city === c),
          sc = ps.reduce((s, p) => s + p.scans, 0);
        return {
          city: c,
          posters: ps.length,
          scans: sc,
          per: ps.length ? Math.round(sc / ps.length) : 0,
          waiting: WAITING_BY_CITY[c] || 0,
          live: LIVE_BY_CITY[c] || 0,
          signing: SIGNING_BY_CITY[c] || 0
        };
      });
      const avg = POSTERS.reduce((s, p) => s + p.scans, 0) / POSTERS.length;
      cities.forEach(c => {
        // a simple, explainable rule: add where scans a poster beat the average or people wait with few posters; hold where a shop can't take the $10 yet
        const perWait = c.waiting / Math.max(1, c.posters);
        c.add = c.per > avg * 1.15 ? 3 : perWait > 20 ? 2 : c.per && c.per < avg * .6 ? 0 : 1;
        c.why = c.per > avg * 1.15 ? `Each poster pulls ${c.per} scans, ${Math.round((c.per / avg - 1) * 100)}% above average` : perWait > 20 ? `${int(c.waiting)} waiting for ${c.posters} poster${c.posters === 1 ? '' : 's'}` : c.per && c.per < avg * .6 ? 'Posters here pull below average' : 'About average';
        c.note = !c.live ? 'No live shop yet' : '';
        c.score = c.per / avg + perWait / 30 + (c.live ? 0.3 : 0);
      });
      return cities.sort((a, b) => b.score - a.score);
    }
    const placeSize = () => {
      const fv = document.getElementById('fv'),
        w = fv && fv.clientWidth ? fv.clientWidth - 2 : 1126,
        one = matchMedia('(max-width:1024px)').matches;
      return {
        w: one ? w : w - (matchMedia('(max-width:1180px)').matches ? 300 : 340),
        h: PHONE() ? 320 : one ? 420 : 520
      };
    };
    function renderPlacement() {
      if (LV) return renderPlacementLive();
      const C = cityRows(),
        avg = Math.round(POSTERS.reduce((s, p) => s + p.scans, 0) / POSTERS.length),
        top = C.filter(c => c.add >= 2).slice(0, 4);
      const wmx = Math.max(...C.map(c => c.waiting)),
        sel = F.place;
      const sz = placeSize(),
        pm = mkMap(FULL, sz.w / sz.h),
        rOf = c => c.waiting ? Math.round(9 + Math.sqrt(c.waiting / wmx) * 30) : 0;
      F.asp = sz.w / sz.h;
      const bubbles = C.map((c, __k) => {
        const r = rOf(c),
          on = sel === c.city,
          sq = Math.min(14, 5 + c.posters / 3);
        return <button key={__k} className={`fbub ${on ? 'on' : ''} ${c.add >= 2 ? 'add' : ''}`} data-fplace={on ? '' : c.city} style={css(`${pm.at(...GEO[c.city])};--r:${(r / 7.6).toFixed(2)}`)} aria-label={`${c.city}: ${c.waiting} waiting, ${c.posters} posters`}>{r ? <i className="fbub-w" /> : ''}<b style={css(`width:${sq}px;height:${sq}px`)} />{c.add >= 2 ? <em>+{c.add}</em> : ''}</button>;
      });
      const liveB = C.map((c, __k) => {
        const r = rOf(c),
          on = sel === c.city,
          sq = Math.min(14, 5 + c.posters / 3);
        const [la, lo] = GEO[c.city];
        return {
          ll: [lo, la],
          html: <div className="fm-mk"><button className={`fbub ${on ? 'on' : ''} ${c.add >= 2 ? 'add' : ''}`} data-fplace={on ? '' : c.city} style={css(`--rpx:${r}px`)} aria-label={c.city}>{r ? <i className="fbub-w" /> : ''}<b style={css(`width:${sq}px;height:${sq}px`)} />{c.add >= 2 ? <em>+{c.add}</em> : ''}</button></div>
        };
      });
      const pmapD = areaMap(pm, {
        pins: bubbles,
        cls: 'place',
        labelGap: city => Math.max(10, rOf(C.find(c => c.city === city)) + 4),
        gapOf: g => `max(10px, calc(${(g / 7.6).toFixed(2)}cqw))`
      });
      const pmap = fmSlot('place', {
        bounds: [[FULL[0], FULL[2]], [FULL[1], FULL[3]]],
        pad: 24,
        pins: liveB
      }, pmapD, 'place');
      const cand = POOL.filter(x => x.kind === 'new').concat([{
        shop: 'Brockton Coffee',
        city: 'Riverside',
        why: 'Asked about Clear at the farmers market',
        id: 'c3'
      }, {
        shop: 'Baseline Cuts',
        city: 'Rialto',
        why: 'Prospect in Merchants · talking',
        id: 'c4'
      }]);
      const candRow = x => {
        const on = x.kind === 'new' && dayOf(x.id) != null;
        return <div className="fpm-c"><span><b>{x.shop}</b><span>{x.why.replace('From Placement · ', '')}</span></span>{x.kind === 'new' ? <button className={`btn sm-b ${on ? 'on' : ''}`} data-fnew={x.id}>{on ? 'On route ✓' : 'Add to route'}</button> : <button className="btn sm-b" data-fgo="merchants/pipeline">Ask first</button>}</div>;
      };
      const c = sel && C.find(x => x.city === sel),
        here = c ? cand.filter(x => x.city === c.city) : [];
      const side = c ? <><div className="fpm-h"><b>{c.city}</b><button className="lnk3" data-fplace="">All suggestions</button></div><div className="fpm-d"><div className="fpm-big"><span className={`m-big ${c.add >= 2 ? 'warn' : ''}`}>{c.add ? `+${c.add}` : 'Hold'}{" "}<small>{c.add ? `poster${c.add === 1 ? '' : 's'} suggested` : 'no new posters for now'}</small></span><span className="fpm-y">{c.why}</span></div><div className="led fpm-l"><div><span>Posters up</span><b>{c.posters}</b></div><div><span>Scans a poster</span><b>{c.per || '–'}{" "}<span className="quiet">{"· average "}{avg}</span></b></div><div><span>People waiting</span><b>{int(c.waiting)}</b></div><div><span>Shops taking cards</span><b>{c.live || <span className="warn">None yet</span>}</b></div></div><div className="fpm-cs"><span className="lbl">Shops that could take one</span>{here.length ? here.map((x, i) => <Fragment key={i}>{candRow(x, i)}</Fragment>) : <p className="small quiet" style={css("margin:6px 0 0")}>{"None lined up in "}{c.city}{" yet. "}<button className="lnk3" data-fgo="merchants/pipeline">Find one in Merchants</button></p>}</div></div></> : <><div className="fpm-h"><span className="lbl">Suggested next</span><span className="fpm-ht">+{top.reduce((a, x) => a + x.add, 0)}{" posters in "}{top.length}{" cities"}</span></div>{top.map((c, __k) => <button key={__k} className="fpm-r" data-fplace={c.city}><span className="fpm-t"><b>{c.city}</b><span className="fpm-a">{"Add "}{c.add}</span></span><span className="fpm-y">{c.why}</span><span className="fpm-n">{c.posters}{" posters · "}{c.per}{" scans each · "}{int(c.waiting)}{" waiting"}{c.note ? <>{" · "}<span className="warn">{c.note}</span></> : ''}</span></button>)}</>;
      const map = <div className="cell s12"><div className="hd"><h2>Where the next posters go</h2><div className="r"><span className="lbl">{"Average "}{avg}{" scans a poster"}</span></div></div><div className="fpm"><div className="fpm-m">{pmap}</div><div className="fpm-s">{side}</div></div><div className="bk-ft"><span className="f-key fpm-k"><span><i className="k-wait" />People waiting</span><span><i className="k-post" />Posters up</span><span><b className="warn">+3</b>{" Suggested"}</span></span><span className="small quiet d-only">{sel ? 'Click the city again to go back' : 'Click a city to see why'}</span></div></div>;
      const cmx = Math.max(...C.map(c => c.per));
      const table = <div className="cell s12"><div className="hd"><h2>Cities</h2><div className="r"><span className="lbl">Last 30 days</span></div></div><div className="bt-wrap"><table className="bt fc"><colgroup><col style={css("width:17%")} /><col style={css("width:9%")} /><col style={css("width:24%")} /><col style={css("width:10%")} /><col style={css("width:10%")} /><col style={css("width:13%")} /><col style={css("width:17%")} /></colgroup><thead><tr><th className="c-nm">City</th><th>Posters</th><th style={css("text-align:left")}>Scans a poster</th><th>Waiting</th><th>Shops live</th><th>Suggest</th><th /></tr></thead><tbody>{C.slice().sort((a, b) => b.posters - a.posters).map((c, __k) => <tr key={__k} className={sel === c.city ? 'sel' : ''}><td className="tn"><b>{c.city}</b></td><td>{c.posters}</td><td style={css("text-align:left")}><span className="fi-sc l"><span className="fi-sb"><i style={css(`width:${c.per / cmx * 100}%`)} className={c.per > avg * 1.15 ? 'hi' : ''} /><s style={css(`left:${avg / cmx * 100}%`)} /></span><b>{c.per}</b></span></td><td>{c.waiting ? int(c.waiting) : <span className="quiet">–</span>}</td><td>{c.live || <span className="quiet">None</span>}</td><td>{c.add ? <b className={c.add >= 2 ? 'warn' : ''}>+{c.add}</b> : <span className="quiet">Hold</span>}</td><td><button className="lnk4" data-fplace={c.city}>See on the map</button></td></tr>)}</tbody></table></div><div className="bk-ft"><span>The line in each bar is the average</span><button data-fgo="growth">Scans by shop · Growth →</button></div></div>;
      const shops = <div className="cell s7"><div className="hd"><h2>Shops that could take a poster</h2><div className="r"><span className="lbl">{cand.length}{" shops"}</span></div></div><div className="fw-l">{cand.map((x, __k) => {
            const on = x.kind === 'new' && dayOf(x.id) != null;
            return <div key={__k} className="fw-r c"><span className="fw-k"><b>{x.shop}</b><span>{x.city}</span></span><span className="fw-w"><span>{x.why.replace('From Placement · ', '')}</span></span>{x.kind === 'new' ? <button className={`btn sm-b ${on ? 'on' : ''}`} data-fnew={x.id}>{on ? 'On route ✓' : 'Add to route'}</button> : <button className="btn sm-b" data-fgo="merchants/pipeline">Ask first</button>}</div>;
          })}</div><div className="bk-ft"><span>A shop has to say yes before a poster goes up</span><button data-fgo="merchants/pipeline">Prospects · Merchants →</button></div></div>;
      const dv = Object.entries(DESIGNS).map(([k, d]) => [k, d, Math.round(d.scans / d.posters), Math.round(d.joined / d.scans * 100)]),
        dmx = Math.max(...dv.map(x => x[2]));
      const des = <div className="cell s5"><div className="hd"><h2>Which design</h2><div className="r"><span className="lbl">Scans a poster</span></div></div><div className="fdz">{dv.map(([k, d, per, j], __k) => <div key={__k} className="fdz-r">{designThumb(k, 26)}<span className="fdz-k"><b>{"Design "}{k}{" · "}{d.name}</b><span>{d.posters}{" posters · "}{j}% of scans join</span></span><span className="fi-sc"><span className="fi-sb"><i style={css(`width:${per / dmx * 100}%`)} /></span><b>{per}</b></span></div>)}</div><div className="bk-ft"><span>New posters go up as design B. Swap C as it comes due.</span><button data-fgo="growth/campaigns">Campaigns →</button></div></div>;
      html(document.getElementById('fv'), <><section className="band" style={css("margin-top:0")}><div className="bento">{map}</div></section><section className="band"><div className="bento">{table}</div></section><section className="band"><div className="bento">{shops}{des}</div></section></>);
    }

    /* live: posters, scans and shops by city as they are; where the next posters go (the scoring) isn't real yet */
    function renderPlacementLive() {
      const C = cityRows().map(c => ({
          ...c,
          add: 0
        })),
        known = LV.waitingKnown,
        avg = Math.round(POSTERS.reduce((s, p) => s + p.scans, 0) / Math.max(1, POSTERS.length));
      const wmx = Math.max(1, ...C.map(c => c.waiting)),
        sel = F.place;
      const sz = placeSize(),
        pm = mkMap(FULL, sz.w / sz.h),
        rOf = c => c.waiting ? Math.round(9 + Math.sqrt(c.waiting / wmx) * 30) : 0;
      F.asp = sz.w / sz.h;
      const bubbles = C.map((c, __k) => {
        const r = rOf(c),
          on = sel === c.city,
          sq = Math.min(14, 5 + c.posters / 3);
        return <button key={__k} className={`fbub ${on ? 'on' : ''}`} data-fplace={on ? '' : c.city} style={css(`${pm.at(...GEO[c.city])};--r:${(r / 7.6).toFixed(2)}`)} aria-label={`${c.city}: ${known ? c.waiting + ' waiting, ' : ''}${c.posters} posters`}>{r ? <i className="fbub-w" /> : ''}<b style={css(`width:${sq}px;height:${sq}px`)} /></button>;
      });
      const liveB = C.map(c => {
        const r = rOf(c),
          on = sel === c.city,
          sq = Math.min(14, 5 + c.posters / 3);
        const [la, lo] = GEO[c.city];
        return {
          ll: [lo, la],
          html: <div className="fm-mk"><button className={`fbub ${on ? 'on' : ''}`} data-fplace={on ? '' : c.city} style={css(`--rpx:${r}px`)} aria-label={c.city}>{r ? <i className="fbub-w" /> : ''}<b style={css(`width:${sq}px;height:${sq}px`)} /></button></div>
        };
      });
      const pmapD = areaMap(pm, {
        pins: bubbles,
        cls: 'place',
        labelGap: city => Math.max(10, rOf(C.find(c => c.city === city)) + 4),
        gapOf: g => `max(10px, calc(${(g / 7.6).toFixed(2)}cqw))`
      });
      const pmap = fmSlot('place', {
        bounds: [[FULL[0], FULL[2]], [FULL[1], FULL[3]]],
        pad: 24,
        pins: liveB
      }, pmapD, 'place');
      const NOT_YET = 'Where the next posters go isn’t suggested yet: that needs a score from scans, people waiting and the shops that said yes.';
      const c = sel && C.find(x => x.city === sel),
        ranked = C.filter(x => x.posters).sort((a, b) => b.per - a.per);
      const side = c ? <><div className="fpm-h"><b>{c.city}</b><button className="lnk3" data-fplace="">All cities</button></div><div className="fpm-d"><div className="led fpm-l"><div><span>Posters up</span><b>{c.posters}</b></div><div><span>Scans a poster</span><b>{c.per || '–'}{" "}<span className="quiet">{"· average "}{avg}</span></b></div><div><span>People waiting</span><b>{known ? int(c.waiting) : '–'}</b></div><div><span>Shops taking cards</span><b>{c.live || <span className="warn">None yet</span>}</b></div></div><p className="small quiet" style={css("margin:0")}>{NOT_YET}</p></div></> : <><div className="fpm-h"><span className="lbl">Where posters pull most</span><span className="fpm-ht">{ranked.length}{ranked.length === 1 ? ' city' : ' cities'}</span></div>{ranked.slice(0, 4).map((c, __k) => <button key={__k} className="fpm-r" data-fplace={c.city}><span className="fpm-t"><b>{c.city}</b><span className="fpm-a">{c.per}{" a poster"}</span></span><span className="fpm-n">{c.posters}{c.posters === 1 ? ' poster' : ' posters'}{known ? ` · ${int(c.waiting)} waiting` : ''}{c.live ? ` · ${c.live} taking cards` : ''}</span></button>)}{ranked.length ? '' : <p className="small quiet" style={css("margin:6px 0 0")}>No posters are up yet.</p>}<p className="small quiet" style={css("margin:10px 0 0")}>{NOT_YET}</p></>;
      const map = <div className="cell s12"><div className="hd"><h2>Where the posters are</h2><div className="r"><span className="lbl">{"Average "}{avg}{" scans a poster"}</span></div></div><div className="fpm"><div className="fpm-m">{pmap}</div><div className="fpm-s">{side}</div></div><div className="bk-ft"><span className="f-key fpm-k">{known ? <span><i className="k-wait" />People waiting</span> : ''}<span><i className="k-post" />Posters up</span></span><span className="small quiet d-only">{sel ? 'Click the city again to go back' : 'Click a city to see it'}</span></div></div>;
      const rows = C.filter(c => c.posters || c.waiting || c.live).sort((a, b) => b.posters - a.posters),
        cmx = Math.max(1, ...C.map(c => c.per));
      const table = <div className="cell s12"><div className="hd"><h2>Cities</h2><div className="r"><span className="lbl">Last 30 days</span></div></div><div className="bt-wrap"><table className="bt fc"><colgroup><col style={css("width:17%")} /><col style={css("width:9%")} /><col style={css("width:24%")} /><col style={css("width:10%")} /><col style={css("width:10%")} /><col style={css("width:13%")} /><col style={css("width:17%")} /></colgroup><thead><tr><th className="c-nm">City</th><th>Posters</th><th style={css("text-align:left")}>Scans a poster</th><th>Waiting</th><th>Shops live</th><th>Suggest</th><th /></tr></thead><tbody>{rows.length ? rows.map((c, __k) => <tr key={__k} className={sel === c.city ? 'sel' : ''}><td className="tn"><b>{c.city}</b></td><td>{c.posters}</td><td style={css("text-align:left")}><span className="fi-sc l"><span className="fi-sb"><i style={css(`width:${c.per / cmx * 100}%`)} /><s style={css(`left:${Math.min(100, avg / cmx * 100)}%`)} /></span><b>{c.per}</b></span></td><td>{known && c.waiting ? int(c.waiting) : <span className="quiet">–</span>}</td><td>{c.live || <span className="quiet">None</span>}</td><td><span className="quiet">Not yet</span></td><td><button className="lnk4" data-fplace={c.city}>See on the map</button></td></tr>) : <tr><td colSpan="7" className="tn"><span className="quiet">No posters or shops yet.</span></td></tr>}</tbody></table></div><div className="bk-ft"><span>{known ? 'The line in each bar is the average' : 'The line in each bar is the average. People waiting show once Members has loaded.'}</span><button data-fgo="growth">Scans by shop · Growth →</button></div></div>;
      const shops = notReal('s7', 'Shops that could take a poster', 'Needs the shops that said yes to a poster, from a visit or the pipeline, with when they agreed.');
      const dv = Object.entries(DESIGNS).map(([k, d]) => [k, d, d.posters ? Math.round(d.scans / d.posters) : 0, d.scans ? Math.round(d.joined / d.scans * 100) : 0]),
        dmx = Math.max(1, ...dv.map(x => x[2])),
        topD = dv.slice().sort((a, b) => b[2] - a[2])[0];
      const des = <div className="cell s5"><div className="hd"><h2>Which design</h2><div className="r"><span className="lbl">Scans a poster</span></div></div><div className="fdz">{dv.length ? dv.map(([k, d, per, j], __k) => <div key={__k} className="fdz-r">{designThumb(k, 26)}<span className="fdz-k"><b>{"Design "}{k}{" · "}{d.name}</b><span>{d.posters}{d.posters === 1 ? ' poster · ' : ' posters · '}{j}% of scans join</span></span><span className="fi-sc"><span className="fi-sb"><i style={css(`width:${per / dmx * 100}%`)} /></span><b>{per}</b></span></div>) : <p className="small quiet" style={css("padding:16px 22px;margin:0")}>No designs yet.</p>}</div><div className="bk-ft"><span>{topD && topD[2] ? `Design ${topD[0]} pulls the most scans a poster.` : 'No scans yet.'}</span><button data-fgo="growth/campaigns">Campaigns →</button></div></div>;
      html(document.getElementById('fv'), <><section className="band" style={css("margin-top:0")}><div className="bento">{map}</div></section><section className="band"><div className="bento">{table}</div></section><section className="band"><div className="bento">{shops}{des}</div></section></>);
    }

    /* ══ Panels: scan sheet and poster record ══ */
    function ensurePanel() {
      let pn = document.getElementById('fpanel');
      if (!pn) {
        const sc = document.createElement('div');
        sc.id = 'fscrim';
        sc.className = 'scrim';
        document.body.appendChild(sc);
        pn = document.createElement('aside');
        pn.id = 'fpanel';
        pn.className = 'panel fpanel';
        document.body.appendChild(pn);
      }
      return pn;
    }
    function renderPanel() {
      const pn = ensurePanel();
      if (F.scan == null && F.poster == null && !R.panel) {
        document.body.classList.remove('pn');
        return;
      }
      document.body.classList.add('pn');
      if (R.panel) return (VPANELS.includes(R.panel.k) ? visitPanel : planPanel)(pn);
      if (F.scan != null) return scanSheet(pn);
      const p = POSTERS.find(x => x.n === F.poster),
        L = life(p),
        sp = series(14, Math.max(14, Math.round(p.scans * 14 / 30)), i => .8 + .25 * Math.sin((i + p.n) / 2.2), p.n);
      const smx = Math.max(...sp, 1),
        onRoute = STOPS.some(s => s.tasks.some(t => t.p && t.p.n === p.n)),
        planned = dayOf('p' + p.n) != null ? [dayOf('p' + p.n)] : null;
      html(pn, <><div className="pn-hd"><span className="lbl">{pid(p.n)}</span>{chip(ST[p.status][1], p.status === 'up' ? 'ok' : p.status === 'missing' ? 'bad' : 'warn')}<button className="x" data-fclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><div className="fpr-top">{designThumb(p.design, 56)}<div><h3>{p.shop}</h3><span className="small quiet">{p.city}{" · design "}{p.design}{", "}{DESIGNS[p.design].name}</span></div></div><div className="w90"><div className="w90-h"><span className="lbl">Life · 60 days</span><b className={L.d < 0 || p.status !== 'up' ? 'warn' : ''}>{p.status === 'missing' ? 'Gone from the window' : L.d < 0 ? `${-L.d} days late` : `${L.d} days left`}</b></div><span className={`wbar big ${L.d < 10 || p.status !== 'up' ? 'lo' : ''}`}><i style={css(`width:${L.pct * 100}%`)} /></span><span className="small quiet">{"Hung "}{fmtD(p.hung)}{" · swap by "}{fmtD(p.swap)}</span></div>{LV ? <div><div className="w90-h"><span className="lbl">Scans</span><b>{p.scans}{" in 30 days"}</b></div><span className="small quiet">Scans by day aren’t kept yet</span></div> : <div><div className="w90-h"><span className="lbl">Scans · last 14 days</span><b>{p.scans}{" in 30 days"}</b></div><div className="fpr-sp">{sp.map((v, __k) => <i key={__k} style={css(`height:${v / smx * 100}%`)} />)}</div></div>}<div className="led"><div><span>Last checked</span><b>{fmtD(p.checked)}</b></div><div><span>Code</span><b>useclear.org/s/{p.shopId}</b></div><div><span>Route</span><b>{onRoute ? LV ? `Today, ${LV.ROUTE.staff || 'on the route'}` : 'Today, Marcus Lee' : planned ? fmtWD(dayT(+planned[0])) : 'Not on a route'}</b></div></div><div><span className="lbl">History</span><div className="hs3"><b>{"Hung, design "}{p.design}</b><span>{fmtD(p.hung)}</span></div><div className="hs3"><b>Checked · up and fine</b><span>{fmtD(Math.max(p.hung + DAY, p.checked))}</span></div>{p.status !== 'up' ? <div className="hs3"><b className="warn">{ST[p.status][1]}</b><span>{fmtD(p.checked)}</span></div> : ''}</div></div><div className="pn-ft mft">{!LV && (!onRoute && !planned && p.status !== 'up' || !onRoute && !planned && L.d <= 14) ? <button className="btn p" data-fputroute={p.n}>Add to tomorrow’s route</button> : ''}<button className="btn" data-fscan={p.n}>{ICO.scan}Log a check</button><button className="btn" style={css("margin-left:auto")} data-fclose="">Close</button></div></>);
    }
    function scanSheet(pn) {
      const p = F.scan === 'pick' ? null : POSTERS.find(x => x.n === F.scan);
      const task = p && STOPS.flatMap(s => s.tasks.map(t => ({
        s,
        t
      }))).find(x => x.t.p && x.t.p.n === p.n);
      let body, foot;
      if (!p) {
        const cur = curStop(),
          sug = cur ? cur.tasks.filter(t => t.kind === 'poster' && !t.done) : [];
        body = <><div className="vf"><i /><i /><i /><i /><span>Point at the code on the poster</span></div><div><span className="lbl">At this stop</span><div className="fcodes">{(sug.length ? sug : LV ? [] : [{
                p: POSTERS.find(x => x.n === 44)
              }]).map((t, __k) => <button key={__k} className="fcode" data-fpickc={t.p.n}>{designThumb(t.p.design, 18)}<b>{pid(t.p.n)}</b><span>{t.p.shop}</span><span>→</span></button>)}</div></div><div><span className="lbl">Or type the code</span><div className="fcin"><input id="fcode" inputMode="numeric" placeholder="P-027" autoComplete="off" aria-label="Poster code" /><button className="btn" data-fcode="">Look it up</button></div></div></>;
        foot = <><span className="nx">Every scan is logged with time and place</span><button className="btn" data-fclose="">Cancel</button></>;
      } else {
        const sel = F.outcome || (task && /^(Swap|Replace)/.test(task.t.t) ? 'Replaced' : 'Checked');
        F.outcome = sel;
        body = <><div className="fpr-top">{designThumb(p.design, 44)}<div><span className="lbl">{pid(p.n)}{" · design "}{p.design}</span><h3>{p.shop}</h3><span className="small quiet">{"Hung "}{fmtD(p.hung)}{" · "}{p.scans}{" scans in 30 days"}</span></div></div>{task ? <div className="fnote"><b>On today’s route.</b>{" "}{task.t.t}{task.t.note ? ', ' + task.t.note.toLowerCase() : ''}.</div> : ''}<div><span className="lbl">What did you find?</span><div className="fog">{Object.keys(OUT).map((k, __k) => <button key={__k} className={`fo ${sel === k ? 'on' : ''}`} data-fout={k} aria-pressed={sel === k}><i className="fl-sv" style={css(`background:var(--${OUT[k][0]})`)} /><b>{k}</b><span>{OUT[k][1]}</span></button>)}</div></div><div className="fph-row"><label className="fph">{ICO.cam}<span>Take a photo</span><input type="file" accept="image/*" capture="environment" hidden /></label><input id="fnoteIn" placeholder="Note (optional)" autoComplete="off" /></div><div className="led">{sel === 'Replaced' ? <><div><span>New poster</span><b>{"Design "}{p.design}, same code</b></div><div><span>Next swap</span><b>{fmtD(TODAY + 60 * DAY)}</b></div></> : sel === 'Missing' ? <div><span>Next</span><b>{LV ? 'A new poster goes on what needs a visit' : 'A new poster goes on tomorrow’s route'}</b></div> : sel === 'Damaged' ? <div><span>Next</span><b>{LV ? 'A swap goes on what needs a visit' : 'A swap goes on tomorrow’s route'}</b></div> : <div><span>Next check</span><b>On the next pass</b></div>}</div></>;
        foot = <><button className="btn" data-fscan="pick">Scan another</button><button className="btn p" style={css("margin-left:auto")} data-fsavescan={p.n}>{"Save · "}{sel.toLowerCase()}</button></>;
      }
      html(pn, <><div className="pn-hd"><span className="lbl">{p ? 'Log a poster' : 'Scan a poster'}</span><button className="x" data-fclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b">{body}</div><div className="pn-ft">{foot}</div></>);
    }

    /* ── render + events ── */
    function renderField() {
      document.querySelectorAll('.gtabs [data-ftab]').forEach(b => b.setAttribute('aria-current', b.dataset.ftab === F.tab ? 'page' : 'false'));
      renderHdr();
      renderMe();
      ({
        today: renderToday,
        plan: renderPlan,
        visits: renderVisits,
        posters: renderPosters,
        placement: renderPlacement
      })[F.tab]();
      renderPanel();
      fmMountAll();
      fitMaps();
    }
    const closeP = () => {
      F.scan = null;
      F.poster = null;
      F.outcome = null;
      R.panel = null;
    };
    document.addEventListener('click', e => {
      if (PAGE !== 'field') return;
      if (e.target.id === 'fscrim') {
        closeP();
        return render();
      }
      const t = e.target.closest('button,a,input,label,tr[data-fposter]');
      if (!t) return;
      const d = t.dataset;
      if (d.ftab) {
        F.tab = d.ftab;
        closeP();
        render();
        setHash();
        if (d.fjump) {
          const el = document.getElementById(d.fjump);
          el && el.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        } else window.scrollTo({
          top: 0
        });
        return;
      }
      if (d.fscan) {
        F.poster = null;
        F.outcome = null;
        F.scan = d.fscan === 'pick' ? 'pick' : +d.fscan;
        return render();
      }
      if (d.fpickc) {
        F.scan = +d.fpickc;
        F.outcome = null;
        return renderPanel();
      }
      if (t.hasAttribute('data-fcode')) {
        const v = (document.getElementById('fcode').value.match(/\d+/) || [])[0];
        const p = v && POSTERS.find(x => x.n === +v);
        if (p) {
          F.scan = p.n;
          F.outcome = null;
          return renderPanel();
        }
        toast('No poster with that code');
        return;
      }
      if (d.fout) {
        F.outcome = d.fout;
        return renderPanel();
      }
      if (d.fsavescan && LV) {
        // live: the photo is stored first, then the scan saves with it, and the page is built again from the server
        const n = +d.fsavescan,
          p = POSTERS.find(x => x.n === n),
          out = F.outcome,
          note = ((document.getElementById('fnoteIn') || {}).value || '').trim(),
          file = document.querySelector('.fph input')?.files?.[0];
        closeP();
        if (!LIVE_APP) return render();
        (file ? addFile('field', file) : Promise.resolve(null)).then(photo => act('field', 'scan', {
          n,
          outcome: out.toLowerCase(),
          note,
          photo
        })).then(() => {
          toast(`${out} · ${pid(n)} at ${p.shop} is logged`);
          renderShell();
        }, err => toast(err.message));
        return render();
      }
      if (d.fsavescan) {
        const n = +d.fsavescan,
          p = POSTERS.find(x => x.n === n),
          out = F.outcome,
          task = STOPS.flatMap(s => s.tasks).find(x => x.p && x.p.n === n);
        if (task) {
          task.done = '10:3' + (4 + Math.floor(Math.random() * 5));
          task.out = out;
          task.photo = 0;
          task.noteIn = (document.getElementById('fnoteIn') || {}).value || '';
        }
        if (out === 'Replaced') {
          p.status = 'up';
          p.hung = TODAY;
          p.swap = TODAY + 60 * DAY;
        } else if (out === 'Missing') p.status = 'missing';else if (out === 'Damaged') p.status = 'faded';
        p.checked = TODAY;
        closeP();
        toast(`${out} · ${pid(n)} at ${p.shop} is logged`);
        return render();
      }
      if (d.fdev && LV) {
        const cur = curStop();
        return fieldDo('task-done', {
          stop: cur.id,
          position: +d.fdev
        }, `Marked done · ${cur.name}`);
      }
      if (d.fdev && curStop().tasks[+d.fdev].kind === 'merchant') {
        R.panel = {
          k: 'log',
          shop: curStop().name,
          out: null,
          stop: +d.fdev
        };
        return render();
      }
      if (d.fdev) {
        const cur = curStop();
        const tk = cur.tasks[+d.fdev];
        tk.done = '10:3' + (4 + Math.floor(Math.random() * 5));
        toast('Counter device marked fixed · Merchants sees it');
        return render();
      }
      if (t.hasAttribute('data-fskip') && LV) {
        const cur = curStop();
        return fieldDo('skip', {
          stop: cur.id
        }, `${cur.name} moved to the end of the route`);
      }
      if (t.hasAttribute('data-fskip')) {
        const cur = curStop();
        const i = STOPS.indexOf(cur);
        STOPS.push(STOPS.splice(i, 1)[0]);
        toast(`${cur.name} moved to the end of the route`);
        return render();
      }
      if (d.flater && LV) return fieldDo('add-later', {
        shop: d.flater
      }, `${d.flater} added to the end of today’s route`);
      if (d.flater) {
        F.later.has(d.flater) ? F.later.delete(d.flater) : F.later.add(d.flater);
        toast(F.later.has(d.flater) ? 'Added to the end of today’s route' : 'Taken off today’s route');
        return render();
      }
      if (d.fposter) {
        F.scan = null;
        F.poster = +d.fposter;
        return render();
      }
      if (t.hasAttribute('data-fclose')) {
        closeP();
        return render();
      }
      if (d.fputroute && LV) return;
      if (d.fputroute) {
        const r = tomorrowFor('marcus');
        r.ids.push('p' + d.fputroute);
        dirty(r);
        toast(`${pid(+d.fputroute)} added to ${firstName(r.who)}’s route tomorrow`);
        return render();
      }
      // posters
      if (d.fpf) {
        F.pf = d.fpf;
        F.page = 0;
        return render();
      }
      if (d.fpage) {
        F.page += +d.fpage;
        return render();
      }
      // placement
      if (d.fplace !== undefined) {
        F.place = d.fplace || null;
        if (F.tab !== 'placement') {
          F.tab = 'placement';
        }
        render();
        if (d.fplace && t.closest('.fc')) document.querySelector('.fpm').scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
        return;
      }
      if (d.fnew && LV) return;
      if (d.fnew) {
        const on = routeOf(d.fnew),
          r = on || tomorrowFor('marcus');
        if (on) on.ids = on.ids.filter(x => x !== d.fnew);else r.ids.push(d.fnew);
        dirty(r);
        toast(on ? 'Taken off its route' : `Added to ${firstName(r.who)}’s route tomorrow`);
        return render();
      }
      if (d.fgo) return goOut(t);
    });
    let wasPhone = PHONE(),
      rsF;
    addEventListener('resize', () => {
      if (!LIVE() || PAGE !== 'field') return;
      if (PHONE() !== wasPhone) {
        wasPhone = PHONE();
        render();
      } else fitMaps();
      clearTimeout(rsF);
      rsF = setTimeout(() => {
        if (F.tab !== 'placement' || !F.asp) return;
        const z = placeSize();
        if (Math.abs(z.w / z.h - F.asp) / F.asp > .04) render();
      }, 140);
    });
    document.addEventListener('input', e => {
      if (PAGE !== 'field') return;
      if (e.target.id === 'fpq') {
        F.pq = e.target.value;
        F.page = 0;
        renderPosters();
        const i = document.getElementById('fpq');
        i.focus();
        i.setSelectionRange(i.value.length, i.value.length);
      }
    });
    document.addEventListener('keydown', e => {
      if (!LIVE() || PAGE !== 'field') return;
      if (e.key === 'Escape' && (F.scan != null || F.poster != null || R.panel)) {
        closeP();
        render();
      }
      if (e.key === 'Enter' && e.composedPath()[0].id === 'fcode') document.querySelector('[data-fcode]').click();
    });

    /* ══ Merchants data — the artifact's own figures, joined to Field's leads, visits and routes ══════════════
       30 partners: 12 transacting (Uptown Barber signed today), 1 signing (Inland Cycle Works, founding seat 4 of 5), 17 signed for posters
       and $10 redemptions only. 14 prospects in the pipeline (7 talking, 7 not visited yet). Oct cleared $19,825.70.
       Next monthly run Mon 2 Nov $9,510.65; Rosa's NET-14 payout $412.60 tomorrow; $430.00 in $10 redemptions owed across 11 shops. */
    const shim = {
      F: null
    };
    const money = n => (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    const TX = [
    // id, name, kind, city, founding, fee %, terms, cap, cap hits (7d), originations, lost, Oct cleared, Oct txns, Sept cleared, hardware
    ['rosas', "Rosa’s Panadería", 'Bakery', 'Redlands', 1, 2.0, 'NET-14', 100, 3, 41, 0, 1284.40, 23, 372.60, 'Point · Tap'], ['uptown', 'Uptown Barber', 'Barber', 'Redlands', 1, 0, 'NET-30', 100, 0, 7, 0, 412.00, 7, 0, 'Point'], ['mesa', 'Mesa Laundry', 'Laundromat', 'San Bernardino', 1, 2.0, 'NET-30', 120, 1, 36, 0, 968.10, 29, 640.20, 'Point'], ['tire', 'Redlands Tire & Lube', 'Auto and tires', 'Redlands', 0, 2.5, 'NET-30', 500, 2, 22, 1, 7940.00, 19, 5210.00, 'Tap · Counter'], ['citrus', 'Citrus Bowl Café', 'Café', 'Riverside', 0, 2.5, 'NET-30', 100, 0, 31, 1, 702.50, 27, 588.40, 'Point · 6 tables'], ['books', 'State St. Books', 'Books', 'Redlands', 0, 2.5, 'NET-30', 150, 0, 19, 0, 611.80, 16, 402.90, 'Point'], ['mich', 'La Michoacana', 'Ice cream', 'San Bernardino', 0, 2.5, 'NET-30', 100, 1, 44, 0, 498.20, 38, 455.10, 'Point'], ['nails', 'Arrowhead Nails', 'Nail salon', 'San Bernardino', 0, 2.5, 'NET-14', 150, 0, 14, 0, 1036.00, 14, 720.00, 'Point'], ['hdw', 'Highland Hardware', 'Hardware', 'Highland', 0, 2.5, 'NET-30', 300, 1, 17, 0, 2310.40, 17, 1488.60, 'Tap · Counter'], ['phone', 'Cajon Phone Repair', 'Phone repair', 'San Bernardino', 0, 2.5, 'NET-14', 300, 2, 21, 1, 3120.00, 21, 2240.00, 'Tap'], ['pet', 'Brookside Pet Wash', 'Pet care', 'Redlands', 0, 2.5, 'NET-30', 150, 0, 12, 0, 540.00, 12, 310.00, 'Point'], ['orange', 'Orange St. Laundromat', 'Laundromat', 'Redlands', 0, 2.5, 'NET-30', 100, 0, 15, 0, 402.30, 15, 286.80, 'Point']];
    const SIGNED = [['icw', 'Inland Cycle Works', 'Bikes and repair', 'Redlands', 'signing'], ['shoe', 'Valley Shoe Repair', 'Shoe repair', 'Redlands'], ['tacos', 'Fontana Tacos', 'Restaurant', 'Fontana'], ['feed', 'Yucaipa Feed & Seed', 'Farm supply', 'Yucaipa'], ['pharm', 'Loma Linda Pharmacy', 'Pharmacy', 'Loma Linda'], ['cuts', 'Colton Cuts', 'Barber', 'Colton'], ['donut', 'Rialto Donuts', 'Bakery', 'Rialto'], ['bmkt', 'Bloomington Market', 'Grocery', 'Bloomington'], ['mcof', 'Mentone Coffee', 'Café', 'Mentone'], ['clean', 'Calimesa Cleaners', 'Dry cleaning', 'Calimesa'], ['deli', 'Grand Terrace Deli', 'Deli', 'Grand Terrace'], ['tea', 'Muscovy Tea', 'Tea', 'Redlands'], ['tailor', 'Sixth St. Tailor', 'Tailor', 'Riverside'], ['thrift', 'Kendall Thrift', 'Thrift', 'San Bernardino'], ['tires2', 'Tippecanoe Tires', 'Auto and tires', 'San Bernardino'], ['flor', 'Victoria Ave. Florist', 'Florist', 'Riverside'], ['pho', 'Base Line Pho', 'Restaurant', 'San Bernardino'], ['opt', 'Citrus Plaza Optical', 'Optical', 'Redlands']];
    const PROSPECTS = [/* name, kind, city, est financed/mo, owner, next step, stage, source */
    ['Mission Auto Care', 'Auto repair', 'Redlands', 9000, 'marcus', 'Demo the merchant app', 'talking', 'walkin'], ['Orange Show Tires', 'Tires', 'San Bernardino', 7500, 'marcus', 'Bring the numbers', 'talking', 'walkin'], ['Cypress Dental', 'Dental', 'Redlands', 6000, 'kai', 'Meet the owner', 'talking', 'hand'], ['Sun Valley HVAC', 'HVAC', 'Highland', 12000, 'marcus', 'Ride-along with the owner', 'talking', 'enquiry'], ['Barton Rd. Appliance', 'Appliances', 'Grand Terrace', 5500, 'dana', 'Second visit', 'talking', 'walkin'], ['Tri-City Transmission', 'Auto repair', 'San Bernardino', 8000, 'marcus', 'Talk terms · wants NET-14', 'talking', 'walkin'], ['Kingston Vet', 'Veterinary', 'Redlands', 4500, 'kai', 'Visit after the intro email', 'talking', 'enquiry'], ['Redlands Smog & Brake', 'Auto repair', 'Redlands', 5000, 'marcus', 'Walk in', 'prospect', 'hand'], ['IE Mattress Outlet', 'Mattresses', 'Colton', 6500, 'dana', 'Walk in', 'prospect', 'enquiry'], ['Lugonia Auto Glass', 'Auto glass', 'Redlands', 4000, 'marcus', 'Walk in', 'prospect', 'poster'], ['Sunset Muffler', 'Auto repair', 'Rialto', 3500, 'marcus', 'Walk in', 'prospect', 'hand'], ['University Optometry', 'Optical', 'Redlands', 3000, 'dana', 'Walk in', 'prospect', 'enquiry'], ['Fontana Furniture', 'Furniture', 'Fontana', 7000, 'dana', 'Walk in', 'prospect', 'poster'], ['Yucaipa Pet Clinic', 'Veterinary', 'Yucaipa', 4000, 'kai', 'Walk in', 'prospect', 'hand']];
    const OWED = LV ? LV.OWED : {
      mesa: 80,
      icw: 60,
      rosas: 40,
      uptown: 50,
      tire: 20,
      citrus: 30,
      books: 20,
      mich: 40,
      nails: 30,
      hdw: 20,
      tacos: 40
    };
    const SRC = {
      walkin: 'Field walk-in',
      enquiry: 'Shop enquiry',
      poster: 'Next to a poster shop',
      hand: 'Added by hand'
    };
    const FLEET = LV ? LV.FLEET : {
      citrus: {
        P: ['on'],
        t: ['on', 'on', 'on', 'low', 'on', 'off'],
        note: 'Table 4 battery low · table 6 offline since Tue',
        seen: '2 min ago'
      },
      orange: {
        P: ['off'],
        note: 'Point unplugged since 08:40',
        seen: '08:40'
      },
      rosas: {
        P: ['on'],
        T: ['on'],
        seen: 'Now'
      },
      tire: {
        T: ['on'],
        C: ['on'],
        seen: 'Now'
      },
      hdw: {
        T: ['on'],
        C: ['on'],
        seen: '1 min ago'
      },
      uptown: {
        P: ['on'],
        seen: 'Now'
      },
      mesa: {
        P: ['on'],
        seen: '3 min ago'
      },
      books: {
        P: ['on'],
        seen: 'Now'
      },
      mich: {
        P: ['on'],
        seen: 'Now'
      },
      nails: {
        P: ['on'],
        seen: '4 min ago'
      },
      phone: {
        T: ['on'],
        seen: 'Now'
      },
      pet: {
        P: ['on'],
        seen: '1 min ago'
      }
    };
    const DTYPE = [['P', 'Clear Point', 'At the counter'], ['t', 'Table Point', 'At the table'], ['T', 'Tap dock', 'Card reader'], ['C', 'Counter', 'Tablet']];
    const OWNER_TX = {
      rosas: 'kai',
      uptown: 'marcus',
      mesa: 'dana',
      tire: 'marcus',
      citrus: 'dana',
      books: 'marcus',
      mich: 'dana',
      nails: 'dana',
      hdw: 'dana',
      phone: 'dana',
      pet: 'marcus',
      orange: 'marcus'
    };

    /* one list of every shop, every stage */
    const MS = LV ? LV.MS : (() => {
      const out = [];
      const lead = n => LEADS.find(l => l.shop === n);
      const lastVisit = n => {
        const v = VLOG.filter(x => x.shop === n);
        return v.length ? -Math.max(...v.map(x => x.d)) : null;
      };
      TX.forEach(r => {
        const [id, name, kind, city, founding, fee, terms, cap, hits, orig, lost, oct, octN, sept, hw] = r;
        out.push({
          id,
          name,
          kind,
          city,
          stage: 'transacting',
          founding: !!founding,
          fee,
          terms,
          cap,
          hits,
          orig,
          lost,
          oct,
          octN,
          sept,
          hw,
          owed: OWED[id] || 0,
          owner: OWNER_TX[id],
          posters: POSTERS.filter(p => p.shop === name).length,
          next: id === 'orange' ? 'Plug the Clear Point back in' : id === 'citrus' ? 'Swap table 4’s battery' : null,
          due: id === 'orange' || id === 'citrus' ? 0 : null,
          last: lastVisit(name) ?? (id === 'uptown' ? 0 : 6 + hashN(name) % 20),
          source: id === 'uptown' || id === 'rosas' || id === 'mesa' ? 'poster' : 'walkin',
          since: founding ? ['Aug', 'Sep', 'Today'][['rosas', 'mesa', 'uptown'].indexOf(id)] : 'Sep'
        });
      });
      SIGNED.forEach(([id, name, kind, city, st]) => {
        const l = lead(name);
        out.push({
          id,
          name,
          kind,
          city,
          stage: st === 'signing' ? 'signing' : 'signed',
          founding: st === 'signing',
          owed: OWED[id] || 0,
          owner: l ? l.owner : ['marcus', 'dana'][hashN(name) % 2],
          posters: POSTERS.filter(p => p.shop === name).length,
          next: l ? l.next : st === 'signing' ? 'Sign the agreement' : 'Pitch card payments',
          due: l ? l.due : null,
          last: l ? l.last : lastVisit(name) ?? 8 + hashN(name) % 30,
          source: 'poster',
          hw: 'Poster only'
        });
      });
      PROSPECTS.forEach(([name, kind, city, val, owner, next, stage, source]) => {
        const l = lead(name);
        out.push({
          id: 'p-' + hashN(name),
          name,
          kind,
          city,
          stage,
          val,
          owner,
          next: l ? l.next : next,
          due: l ? l.due : null,
          last: l ? l.last : null,
          source,
          posters: 0,
          hw: '–'
        });
      });
      return out;
    })();
    const MSBY = Object.fromEntries(MS.map(m => [m.id, m]));
    const TXO = MS.filter(m => m.stage === 'transacting');
    const capRaise = m => m.id === 'rosas' ? 'pending' : m.hits > 0 && m.lost === 0 && m.orig >= 15 ? 'raise' : m.hits > 0 ? 'hold' : 'ok';
    const payOf = m => {
      const fee = m.id === 'rosas' ? 0 : +(m.sept * m.fee / 100).toFixed(2);
      return {
        sales: m.sept,
        fee,
        red: OWED[m.id] || 0,
        total: +(m.sept - fee + (OWED[m.id] || 0)).toFixed(2)
      };
    };
    /* shop enquiries: the app's own form inbox (useclear.org/shops), masked until shown */
    // live, the site's shop enquiries don't come with their details yet: the cell says so
    const ENQ = LV ? [] : INBOX.filter(x => x.type === 'Shop enquiry').map((x, i) => ({
      id: 'e' + (i + 1),
      name: x.who.join(' '),
      mask: x.who.map(mask).join(' '),
      city: x.city,
      kind: x.kind,
      from: x.src,
      when: /^\d/.test(x.when) ? 'Today ' + x.when : x.when,
      msg: x.msg,
      st: {
        New: 'new',
        Replied: 'replied',
        'Not a fit': 'notfit',
        Added: 'added'
      }[x.st] || 'new',
      known: x.known,
      why: x.why
    }));
    const XAPI = (() => {
      /* ══ Merchants: every shop from first visit to monthly payout ════════════════════════════════
         Overview · Pipeline (prospect → signing, plus shop enquiries) · Partners (signed and transacting) · Payouts · Devices.
         One shop record opens from anywhere. It shares Field's routes, visits and leads: planning or logging a visit here lands in Field.
         Reps edit their own leads and see the rest read-only. Money changes (caps, terms, payouts) need a second person. */
      const X = {
        kst: 'prospect',
        tab: 'overview',
        open: null,
        pf: 'all',
        bq: '',
        note: {},
        enqSt: {},
        approvals: []
      };
      const STG5 = [['prospect', 'Prospect'], ['talking', 'Talking'], ['signing', 'Signing'], ['signed', 'Signed'], ['transacting', 'Transacting']];
      const STGN = Object.fromEntries(STG5);
      const STGCOL = {
        prospect: 'color-mix(in srgb,var(--fg) 14%,transparent)',
        talking: 'color-mix(in srgb,var(--fg) 34%,transparent)',
        signing: 'var(--live)',
        signed: 'color-mix(in srgb,var(--fg) 58%,transparent)',
        transacting: 'var(--fg)'
      };
      const ini = n => n.replace(/[’'.&]/g, '').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
      // live, a shop is edited through its pipeline card: one the merchant app has but the pipeline doesn't is read-only here
      const mine = m => m.owner === R.me,
        canEditM = m => !RO() && (!LV || !!m.card) && (isAdmin() || mine(m));
      const whose = m => m.owner === R.me ? 'your lead' : `${firstName(m.owner)}’s`;
      const dueTxtM = m => m.due == null ? '' : m.due < 0 ? `${-m.due}d overdue` : m.due === 0 ? 'today' : m.due === 1 ? 'tomorrow' : fmtWD(dayT(m.due)).slice(0, 3);
      const routeFor = m => {
        const l = LEADS.find(x => x.shop === m.name);
        if (!l) return null;
        const x = POOL.find(p => p.kind === 'merchant' && p.shop === m.name);
        return x ? routeOf(x.id) : null;
      };
      const devFix = m => STOPS.find(s => s.name === m.name && s.tasks.some(t => t.kind === 'device'));
      const lastTxt = d => d == null ? 'Never visited' : d === 0 ? 'Visited today' : `Last visit ${d}d ago`;
      const IN_TALKS = () => MS.filter(m => m.stage === 'talking');
      const sumVal = a => a.reduce((s, m) => s + (m.val || 0), 0);
      /* a lead in Field for any shop, so Plan a visit and Log a visit work for partners too */
      function ensureLead(m) {
        let l = LEADS.find(x => x.shop === m.name);
        if (!l) {
          l = {
            shop: m.name,
            city: m.city,
            stage: m.stage === 'transacting' ? 'signed' : m.stage,
            owner: m.owner,
            last: m.last,
            next: m.next || (m.stage === 'signed' ? 'Pitch card payments' : 'Check in'),
            due: m.due,
            val: m.val || 0
          };
          LEADS.push(l);
        }
        return l;
      }

      /* ── header ── */
      function renderHdr() {
        if (LV) return renderMHdrLive();
        const tx = TXO.length,
          all = MS.filter(m => ['transacting', 'signing', 'signed'].includes(m.stage)).length,
          sg = MS.filter(m => m.stage === 'signing').length,
          sd = MS.filter(m => m.stage === 'signed').length;
        const oct = TXO.reduce((s, m) => s + m.oct, 0),
          sales = TXO.reduce((s, m) => s + m.octN, 0),
          lost = TXO.reduce((s, m) => s + m.lost, 0),
          orig = TXO.reduce((s, m) => s + m.orig, 0);
        const talks = IN_TALKS(),
          od = MS.filter(m => m.due != null && m.due < 0 && ['prospect', 'talking', 'signing'].includes(m.stage));
        const S = {
          overview: <>{"Uptown Barber signed today, the third founding shop. "}<a data-xopen="icw">Inland Cycle Works</a>{" signs next for seat 4 of 5."}</>,
          pipeline: <>{talks.length}{" shops are talking, worth "}{money(sumVal(talks)).replace('.00', '')}{" a month in financed work. "}{od.length ? <><a data-xopen={od[0].id}>{od.length}{" follow-up"}{od.length === 1 ? ' is' : 's are'}{" overdue"}</a>.</> : 'No follow-ups are overdue.'}</>,
          partners: `${tx} of ${all} partners take card payments. ${sd} host a poster but haven’t turned payments on.`,
          payouts: <>{"Rosa’s NET-14 payout of $412.60 goes tomorrow. The monthly run of $9,510.65 is Mon 2 Nov and "}<a data-xtab="payouts">needs a second approval</a>.</>,
          devices: <>{"Two shops need a device visit. "}<a data-xopen="orange">Orange St. Laundromat</a>{" is on Marcus’s route today, and Citrus Bowl Café is stop 7."}</>
        }[X.tab];
        html(document.getElementById('hdr'), <><span className="when"><span className="dot" />Merchants · Wed 21 Oct · Demo data</span><p className="brief">{S}</p><div className="strip"><div className="sc"><span className="lbl">Transacting</span><div className="sc-v">{tx}{" "}<small>{"of "}{all}{" partners"}</small></div><div className="mb"><i style={css(`width:${tx / all * 100}%`)} /><i style={css(`left:${tx / all * 100}%;width:${sg / all * 100}%;background:var(--live)`)} /><span className="hroom" style={css(`left:${(tx + sg) / all * 100}%;right:0`)} /></div><div className="sc-s">{sg}{" signing · "}{sd}{" on posters only"}</div></div><div className="sc"><span className="lbl">In talks</span><div className="sc-v">{talks.length}{" "}<small>{money(sumVal(talks)).replace('.00', '')}/mo</small></div><div className="mb"><i style={css(`width:${talks.length / MS.filter(m => ['prospect', 'talking', 'signing'].includes(m.stage)).length * 100}%;background:color-mix(in srgb,var(--fg) 45%,transparent)`)} /></div><div className="sc-s">{MS.filter(m => m.stage === 'prospect').length}{" prospects not visited yet"}</div></div><div className="sc"><span className="lbl">Cleared · October</span><div className="sc-v">{money(oct).replace(/\.\d+$/, '')}<small className="ct">{money(oct).match(/\.\d+$/)[0]}</small></div><div className="mb"><i style={css(`width:${7940 / oct * 100}%`)} /><i style={css(`left:${7940 / oct * 100}%;width:${(oct - 7940) / oct * 100}%;background:color-mix(in srgb,var(--fg) 40%,transparent)`)} /></div><div className="sc-s">{sales}{" sales · loss "}{(lost / orig * 100).toFixed(1)}%</div></div><div className="sc"><span className="lbl">Payouts · 14 days</span><div className="sc-v">$12,839<small className="ct">.25</small></div><div className="mb"><i style={css("width:3.2%;background:var(--underway)")} /><i style={css("left:3.2%;width:74%")} /><i style={css("left:77.2%;width:22.8%;background:color-mix(in srgb,var(--fg) 40%,transparent)")} /></div><div className="sc-s">$430.00 in $10 redemptions owed</div></div></div></>);
      }

      /* ── the map: cities as tags with one square per shop, tied to their place ── */
      const CK = {
        transacting: 'var(--fg)',
        signing: 'var(--live)',
        signed: 'color-mix(in srgb,var(--fg) 45%,transparent)',
        talking: 'color-mix(in srgb,var(--fg) 18%,transparent)',
        prospect: 'color-mix(in srgb,var(--fg) 18%,transparent)'
      };
      function cityList() {
        const by = {};
        MS.forEach(m => {
          (by[m.city] ||= []).push(m);
        });
        const order = {
          transacting: 0,
          signing: 1,
          signed: 2,
          talking: 3,
          prospect: 4
        };
        return Object.entries(by).filter(([c]) => GEO[c]).map(([c, l]) => ({
          c,
          l: l.sort((a, b) => order[a.stage] - order[b.stage] || (b.oct || 0) - (a.oct || 0)),
          tx: l.filter(m => m.stage === 'transacting').length,
          oct: l.reduce((s, m) => s + (m.oct || 0), 0)
        })).sort((a, b) => b.tx - a.tx || b.l.length - a.l.length);
      }
      /* the map fills its cell, so its shape follows the space it gets: beside the city list on desktop, full width above it on tablet and phone */
      const corrSize = () => {
        const mv = document.getElementById('mv'),
          w = mv && mv.clientWidth ? mv.clientWidth - 2 : 1126,
          one = matchMedia('(max-width:1024px)').matches;
        return {
          w: one ? w : w - 320,
          h: PHONE() ? 340 : one ? 440 : 560
        };
      };
      function corridor() {
        const C = cityList(),
          sz = corrSize(),
          m = mkMap(FULL, sz.w / sz.h);
        X.asp = sz.w / sz.h;
        const tag = (c, live) => <span className={`fsp mcity ${X.city === c.c ? 'now' : ''} ${c.tx ? '' : 'minor'} ${!c.tx && X.city !== c.c ? 'z' : ''}`} data-xcity={c.c} style={live ? undefined : css(m.at(...GEO[c.c]))}><svg className="fsp-l" aria-hidden="true"><line x1="0" y1="0" x2="0" y2="0" /></svg><i className="fsp-d" /><b className="fsp-t"><span className="mc-h"><b>{c.c}</b><span>{c.tx}/{c.l.length}</span></span><span className="mc-q">{c.l.slice(0, 18).map((s, __k) => <i key={__k} style={css(`background:${CK[s.stage]}`)} title={`${s.name} · ${STGN[s.stage]}`} />)}{c.l.length > 18 ? <em>+{c.l.length - 18}</em> : ''}</span></b></span>;
        const pins = C.map((c, i) => <Fragment key={i}>{tag(c)}</Fragment>),
          live = C.map(c => {
            const [la, lo] = GEO[c.c];
            return {
              ll: [lo, la],
              html: tag(c, true)
            };
          });
        return fmSlot('corridor', {
          bounds: [[FULL[0], FULL[2]], [FULL[1], FULL[3]]],
          pad: 30,
          pins: live
        }, areaMap(m, {
          pins,
          cls: 'corr'
        }), 'corr');
      }

      /* ══ Overview ══ */
      function renderOverview() {
        if (LV) return renderOverviewLive();
        const C = cityList(),
          sel = X.city ? C.find(c => c.c === X.city) : null;
        const side = sel ? <div className="mo-c"><div className="mo-ch"><b>{sel.c}</b><button className="lnk3" data-xcity="">All cities</button></div>{sel.l.map((m, __k) => <button key={__k} className="mo-r" data-xopen={m.id}><i style={css(`background:${CK[m.stage]}`)} /><span><b>{m.name}</b><span>{STGN[m.stage]}{m.oct ? ` · ${money(m.oct)} in Oct` : ''}</span></span></button>)}</div> : <><div className="mo-lh"><span className="lbl">City</span><span className="lbl">October</span><span className="lbl">Live</span></div>{C.map((c, __k) => <button key={__k} className={`mo-r city ${c.tx ? '' : 'zero'}`} data-xcity={c.c}><b>{c.c}</b><span className="mo-o">{c.oct ? money(c.oct) : '–'}</span><span className="mo-n"><b>{c.tx}</b>{" of "}{c.l.length}</span></button>)}</>;
        const map = <div className="cell s12"><div className="hd"><h2>Where the shops are</h2><div className="r"><span className="lbl">{MS.length}{" shops in "}{C.length}{" cities"}</span></div></div><div className="mo"><div className="mo-m">{corridor()}</div><div className="mo-s">{side}</div></div><div className="bk-ft"><span className="f-key"><i style={css("background:var(--fg)")} />{"Transacting "}<i style={css("background:var(--live)")} />{"Signing "}<i style={css("background:color-mix(in srgb,var(--fg) 45%,transparent)")} />{"Posters only "}<i style={css("background:color-mix(in srgb,var(--fg) 18%,transparent)")} />In the pipeline</span><span className="small quiet d-only">{X.city ? 'Click the city again to see them all' : 'Click a city to see its shops'}</span></div></div>;
        /* needs you: the list rule from Home */
        const icw = MSBY.icw,
          tri = MS.find(m => m.name === 'Tri-City Transmission'),
          triR = routeFor(tri);
        const NEED = [['underway', 'Sign Inland Cycle Works', 'Founding seat 4 of 5 · Kai', 'Due Mon', <><span className="who">{R.me === 'kai' ? 'You’re' : 'Kai is'}{" on it"}</span><button className="lnk" data-xopen="icw">Open →</button></>], ...(S.payoutDone || X.approvals.includes('rosas-pay') ? [] : [['live', 'Approve Rosa’s payout · $412.60', 'NET-14 · proposed by Dana Ruiz · goes tomorrow', 'Tomorrow', <><span className="who">Needs a second person</span><button className="lnk" data-xtab="payouts">Review →</button></>]]), ['absent', 'Tri-City Transmission is 4 days overdue', 'Talk terms · wants NET-14 · Marcus’s lead', '4d', triR ? <span className="who">{"On "}{firstName(triR.who)}{"’s "}{fmtWD(dayT(triR.d)).slice(0, 3)}{" route"}</span> : <><span className="who none">Not on a route</span><button className="lnk" data-xplan={tri.id}>Add to Marcus’s route →</button></>, /* the reference read 'none' in the markup */ !triR], ['absent', 'Orange St. Laundromat’s Point is offline', 'Unplugged since 08:40', '08:40', <span className="who">On Marcus’s route today · stop 4</span>], ['line', `${ENQ.filter(e => (X.enqSt[e.id] || e.st) === 'new').length} new shop enquiries`, 'From useclear.org/shops and poster pages', 'Today', <button className="lnk" data-xtab="pipeline" data-xjump="menq">Triage →</button>]];
        const need = <div className="cell s5"><div className="hd"><h2>Needs you</h2><div className="r"><span className="lbl">{NEED.length}{" things"}</span></div></div><div className="al">{NEED.map(([sv, t, m, age, own, none], __k) => <div key={__k} className="alr"><div className="al-m"><div className="al-t"><i className="sv" style={css(`background:${sevCol(sv)}`)} /><b>{t}</b><span className="age">{age}</span></div><span className="m">{m}</span></div><div className={`own ${none ? 'none' : ''}`}>{own}</div></div>)}</div><div className="bk-ft"><span>Money and terms need a second person</span><button data-xgo="home">All of it on Home →</button></div></div>;
        /* pipeline at a glance, with how many move from each stage to the next (last 90 days) */
        const CONV = [['62%', '9 days'], ['38%', '18 days'], ['91%', '4 days'], ['41%', '23 days']];
        const st = STG5.map(([k, t]) => [k, t, MS.filter(m => m.stage === k)]),
          mx = Math.max(...st.map(x => x[2].length));
        const pipe = <div className="cell s7"><div className="hd"><h2>From first visit to payments</h2><div className="r"><span className="lbl">{MS.length}{" shops · 90-day rates"}</span></div></div><div className="mp">{st.map(([k, t, a], i) => <Fragment key={i}>{i ? <div className="mp-c"><span /><span className="mp-ca"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1v8M2 6l3 3 3-3" /></svg><b>{CONV[i - 1][0]}</b>{" move on · usually in "}{CONV[i - 1][1]}</span></div> : ''}<button className="mp-r" data-xtab={['transacting', 'signed'].includes(k) ? 'partners' : 'pipeline'}><span className="mp-k"><i style={css(`background:${STGCOL[k]}`)} />{t}</span><span className="mp-b"><i style={css(`width:${a.length / mx * 100}%;background:${STGCOL[k]}`)} /></span><b>{a.length}</b><span className="mp-s">{k === 'prospect' ? 'Not visited yet' : k === 'talking' ? money(sumVal(a)).replace('.00', '') + ' a month' : k === 'signing' ? 'Founding seat 4 of 5' : k === 'signed' ? 'Posters and $10 only' : money(a.reduce((s, m) => s + m.oct, 0)) + ' in Oct'}</span></button></Fragment>)}</div><div className="bk-ft"><span>17 shops host a poster but don’t take card payments yet</span><button data-xtab="partners" data-xpf="signed">Pitch them →</button></div></div>;
        /* founding seats */
        const seats = [['Rosa’s Panadería', 'filled', 'Aug', 'rosas'], ['Mesa Laundry', 'filled', 'Sep', 'mesa'], ['Uptown Barber', 'filled', 'Today', 'uptown'], ['Inland Cycle Works', 'signing', 'Signing', 'icw'], ['', 'open', 'Open', '']];
        const fs = <div className="cell s5"><div className="hd"><h2>Founding seats</h2><div className="r"><span className="lbl">Capped at five</span></div></div><div className="fsx">{seats.map(([n, s, w, id], i) => <button key={i} className={`fsx-s ${s}`} {...attrs(id ? `data-xopen="${id}"` : 'disabled')}><span className="fsx-n">{i + 1}</span><b>{n || 'Open seat'}</b><span>{w}</span></button>)}</div><div className="led fsx-l"><div><span>Fee, for life</span><b>2.0%, not 2.5%</b></div><div><span>First 20 sales</span><b>No fee</b></div></div><div className="bk-ft"><span>3 of 5 filled · one left after Inland Cycle Works</span><span /></div></div>;
        /* who's clearing the volume */
        const top = TXO.slice().sort((a, b) => b.oct - a.oct),
          omx = top[0].oct;
        const vol = <div className="cell s7"><div className="hd"><h2>Cleared by shop</h2><div className="r"><span className="lbl">October so far</span></div></div><div className="mv">{top.slice(0, 7).map((m, __k) => <button key={__k} className="mv-r" data-xopen={m.id}><span>{m.name}</span><span className="mv-b"><i style={css(`width:${m.oct / omx * 100}%;background:${m.cap >= 300 ? 'var(--fg)' : 'var(--land)'}`)} /></span><b>{money(m.oct)}</b></button>)}<div className="mv-r rest"><span>{top.length - 7}{" more shops"}</span><span className="mv-b"><i style={css(`width:${top.slice(7).reduce((s, m) => s + m.oct, 0) / omx * 100}%;background:var(--line)`)} /></span><b>{money(top.slice(7).reduce((s, m) => s + m.oct, 0))}</b></div></div><div className="bk-ft"><span className="f-key"><i style={css("background:var(--fg)")} />{"Financing shops, cap $300+ "}<i style={css("background:var(--land)")} />Everyday shops</span><button data-xtab="partners">All partners →</button></div></div>;
        const caps = TXO.filter(m => m.hits > 0).sort((a, b) => b.hits - a.hits);
        const cp = <div className="cell s5"><div className="hd"><h2>Caps to review</h2><div className="r"><span className="lbl">Hit their cap this week</span></div></div><div className="mcl">{caps.map((m, __k) => {
              const r = capRaise(m);
              return <button key={__k} className="mcl-r" data-xopen={m.id}><span className="mcl-k"><b>{m.name}</b><span>{money(m.cap).replace('.00', '')}{" cap · "}{(m.lost / m.orig * 100).toFixed(1)}{"% loss on "}{m.orig}</span></span><span className="mcl-h">{[0, 1, 2].map((i, __k) => <i key={__k} className={i < m.hits ? 'on' : ''} />)}</span>{r === 'pending' ? <span className="fst tlv">Pending</span> : r === 'raise' ? <span className="fst ok">Raise</span> : <span className="fst warn2">Hold</span>}</button>;
            })}</div><div className="bk-ft"><span>Raise on results: hit the cap with no losses</span><span /></div></div>;
        html(document.getElementById('mv'), <><section className="band" style={css("margin-top:0")}><div className="bento">{map}</div></section><section className="band"><div className="bento">{pipe}{need}</div></section><section className="band"><div className="bento">{vol}{cp}</div></section><section className="band"><div className="bento">{swapClass(fs, 'cell s5', 'cell s12')}</div></section></>);
      }

      /* ══ Live (REAL): the merchant app's shops and the pipeline as they are ════════════════════ */
      const MO = () => LV.month;
      const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
      /** The next monthly run: last month's sales at each NET-30 shop less its fee, plus the $10s owed (nothing records those yet). */
      const runLines = () => TXO.filter(m => m.terms === 'NET-30' && (m.sept || m.owed)).map(m => ({
        m,
        ...payOf(m)
      }));
      const owedOnly = () => MS.filter(m => m.stage !== 'transacting' && m.owed);
      const runTotal = () => +(runLines().reduce((a, l) => a + l.total, 0) + owedOnly().reduce((a, m) => a + m.owed, 0)).toFixed(2);
      const owedAll = () => MS.reduce((a, m) => a + (m.owed || 0), 0);
      const fleetBad = () => Object.entries(FLEET).filter(([, f]) => {
        const v = Object.values(f).flat();
        return v.includes('off') || v.includes('low');
      });
      const cts = n => money(n).match(/\.\d+$/)[0];
      /** Partners' terms and fees as the shops have them; caps are on chain and not read yet. */
      function partnersSumLive() {
        const by = f => Object.entries(TXO.reduce((o, m) => (o[f(m)] = (o[f(m)] || 0) + 1, o), {})).sort((a, b) => b[1] - a[1]);
        const COL = ['var(--fg)', 'var(--land)', 'var(--line)', 'color-mix(in srgb,var(--fg) 40%,transparent)'];
        const terms = by(m => m.terms || 'No terms').map(([k, v], i) => [k, v, COL[i % 4]]),
          fees = by(m => m.fee ? m.fee.toFixed(1) + '%' : 'No fee').map(([k, v], i) => [k, v, COL[i % 4]]),
          // each shop's cap per sale, MerchantRegistry's
          capMix = by(m => m.cap == null ? 'No cap' : money(m.cap).replace('.00', '')).map(([k, v], i) => [k, v, COL[i % 4]]),
          capHits = TXO.reduce((a, m) => a + m.hits, 0);
        const mix = a => a.length ? <><div className="mb2">{a.map(([k, v, c], __k) => <i key={__k} style={css(`flex:${v};background:${c}`)} />)}</div><div className="mk2">{a.map(([k, v, c], __k) => <span key={__k}><i style={css(`background:${c}`)} />{k}{" "}<b>{v}</b></span>)}</div></> : <div className="mk2"><span>No shop takes cards yet</span></div>;
        return <><div className="cell s4"><div className="hd"><h2>Terms</h2><div className="r"><span className="lbl">{TXO.length}{" transacting"}</span></div></div><div className="mt"><div className="m-big">{terms[0] ? terms[0][1] : 0}{" "}<small>{terms[0] ? `of ${TXO.length} on ${terms[0][0]}` : 'transacting'}</small></div>{mix(terms)}</div><div className="bk-ft"><span>Each shop’s payout terms</span><span /></div></div><div className="cell s4"><div className="hd"><h2>Fees</h2><div className="r"><span className="lbl">Per sale</span></div></div><div className="mt"><div className="m-big">{fees[0] ? fees[0][0] : '–'}{" "}<small>{fees[0] ? 'the most common' : ''}</small></div>{mix(fees)}</div><div className="bk-ft"><span>Each shop’s tier rate, taken out of each payout</span><span /></div></div>{<div className="cell s4"><div className="hd"><h2>Caps</h2><div className="r"><span className="lbl">Per sale · MerchantRegistry</span></div></div><div className="mt"><div className="m-big">{capHits}{" "}<small>{capHits === 1 ? 'sale over a cap this week' : 'sales over a cap this week'}</small></div>{mix(capMix)}</div><div className="bk-ft"><span>A sale over its shop’s cap is refused</span><span /></div></div>}</>;
      }
      function renderMHdrLive() {
        const P = MS.filter(m => ['transacting', 'signing', 'signed'].includes(m.stage)),
          tx = TXO.length,
          all = P.length,
          A = Math.max(1, all),
          sg = MS.filter(m => m.stage === 'signing').length,
          sd = MS.filter(m => m.stage === 'signed').length;
        const oct = TXO.reduce((s, m) => s + m.oct, 0),
          sales = TXO.reduce((s, m) => s + m.octN, 0),
          topO = Math.max(0, ...TXO.map(m => m.oct));
        const talks = IN_TALKS(),
          open = MS.filter(m => ['prospect', 'talking', 'signing'].includes(m.stage)).length,
          od = MS.filter(m => m.due != null && m.due < 0 && ['prospect', 'talking', 'signing'].includes(m.stage));
        const lines = runLines(),
          run = runTotal(),
          fees = lines.reduce((a, l) => a + l.fee, 0),
          RF = Math.max(1, run + fees);
        const bad = fleetBad(),
          onRt = bad.map(([id]) => MSBY[id]).find(m => devFix(m));
        const S = {
          overview: !all ? 'No partner shops yet. They show here as they join in the merchant app.' : `${LV.newest ? `${LV.newest.name} joined ${fmtD(LV.newest.joined)}. ` : ''}${tx} of ${plural(all, 'partner', 'partners')} take card payments.`,
          pipeline: <>{plural(talks.length, 'shop is', 'shops are')}{" talking, worth "}{money(sumVal(talks)).replace('.00', '')}{" a month in financed work. "}{od.length ? <><a data-xopen={od[0].id}>{od.length}{" follow-up"}{od.length === 1 ? ' is' : 's are'}{" overdue"}</a>.</> : 'No follow-ups are overdue.'}</>,
          partners: !all ? 'No partner shops yet.' : `${tx} of ${plural(all, 'partner', 'partners')} take card payments.${sd ? sd === 1 ? ' One has signed but doesn’t take them yet.' : ` ${sd} have signed but don’t take them yet.` : ''}`,
          payouts: lines.length ? `The monthly run comes to ${money(run)} for ${plural(lines.length, 'NET-30 shop', 'NET-30 shops')}, from ${MO().last}’s sales. It goes once a second person approves it.` : `No NET-30 shop has ${MO().last} sales to pay out.`,
          devices: bad.length ? `${plural(bad.length, 'shop needs', 'shops need')} a device visit.${onRt ? ` ${onRt.name} is on ${staffFirst()}’s route today.` : ''}` : Object.keys(FLEET).length ? 'Every Point is online.' : 'No Points have checked in yet.'
        }[X.tab];
        html(document.getElementById('hdr'), <><span className="when"><span className="dot" />{`Merchants · ${fmtWD(TODAY)}`}</span><p className="brief">{S}</p><div className="strip"><div className="sc"><span className="lbl">Transacting</span><div className="sc-v">{tx}{" "}<small>{"of "}{all}{all === 1 ? ' partner' : ' partners'}</small></div><div className="mb"><i style={css(`width:${tx / A * 100}%`)} /><i style={css(`left:${tx / A * 100}%;width:${sg / A * 100}%;background:var(--live)`)} /><span className="hroom" style={css(`left:${(tx + sg) / A * 100}%;right:0`)} /></div><div className="sc-s">{sg}{" signing · "}{sd}{" not taking cards yet"}</div></div><div className="sc"><span className="lbl">In talks</span><div className="sc-v">{talks.length}{" "}<small>{money(sumVal(talks)).replace('.00', '')}/mo</small></div><div className="mb"><i style={css(`width:${talks.length / Math.max(1, open) * 100}%;background:color-mix(in srgb,var(--fg) 45%,transparent)`)} /></div><div className="sc-s">{plural(MS.filter(m => m.stage === 'prospect').length, 'prospect', 'prospects')}{" in the pipeline"}</div></div><div className="sc"><span className="lbl">{"Cleared · "}{MO().long}</span><div className="sc-v">{money(oct).replace(/\.\d+$/, '')}<small className="ct">{cts(oct)}</small></div><div className="mb"><i style={css(`width:${oct ? topO / oct * 100 : 0}%`)} /><i style={css(`left:${oct ? topO / oct * 100 : 0}%;width:${oct ? (oct - topO) / oct * 100 : 0}%;background:color-mix(in srgb,var(--fg) 40%,transparent)`)} /></div><div className="sc-s">{plural(sales, 'sale', 'sales')}{" · losses aren’t recorded yet"}</div></div><div className="sc"><span className="lbl">Next payout run</span><div className="sc-v">{money(run).replace(/\.\d+$/, '')}<small className="ct">{cts(run)}</small></div><div className="mb"><i style={css(`width:${fees / RF * 100}%;background:var(--absent)`)} /><i style={css(`left:${fees / RF * 100}%;width:${run / RF * 100}%`)} /></div><div className="sc-s">{money(owedAll())}{" in $10 redemptions owed"}</div></div></div></>);
      }
      function renderOverviewLive() {
        const C = cityList(),
          sel = X.city ? C.find(c => c.c === X.city) : null;
        const side = sel ? <div className="mo-c"><div className="mo-ch"><b>{sel.c}</b><button className="lnk3" data-xcity="">All cities</button></div>{sel.l.map((m, __k) => <button key={__k} className="mo-r" data-xopen={m.id}><i style={css(`background:${CK[m.stage]}`)} /><span><b>{m.name}</b><span>{STGN[m.stage]}{m.oct ? ` · ${money(m.oct)} in ${MO().short}` : ''}</span></span></button>)}</div> : <><div className="mo-lh"><span className="lbl">City</span><span className="lbl">{MO().long}</span><span className="lbl">Live</span></div>{C.length ? C.map((c, __k) => <button key={__k} className={`mo-r city ${c.tx ? '' : 'zero'}`} data-xcity={c.c}><b>{c.c}</b><span className="mo-o">{c.oct ? money(c.oct) : '–'}</span><span className="mo-n"><b>{c.tx}</b>{" of "}{c.l.length}</span></button>) : <p className="small quiet" style={css("margin:10px 0 0")}>No shops yet.</p>}</>;
        const map = <div className="cell s12"><div className="hd"><h2>Where the shops are</h2><div className="r"><span className="lbl">{MS.length}{" shops in "}{plural(C.length, 'city', 'cities')}</span></div></div><div className="mo"><div className="mo-m">{corridor()}</div><div className="mo-s">{side}</div></div><div className="bk-ft"><span className="f-key"><i style={css("background:var(--fg)")} />{"Transacting "}<i style={css("background:var(--live)")} />{"Signing "}<i style={css("background:color-mix(in srgb,var(--fg) 45%,transparent)")} />{"Signed "}<i style={css("background:color-mix(in srgb,var(--fg) 18%,transparent)")} />In the pipeline</span><span className="small quiet d-only">{X.city ? 'Click the city again to see them all' : 'Click a city to see its shops'}</span></div></div>;
        /* needs you: what the shops and the pipeline say, most pressing first */
        const NEED = [];
        MS.filter(m => m.stage === 'signing').forEach(m => NEED.push(['underway', `Sign ${m.name}`, `${m.next || 'Finish onboarding'} · ${m.owner === 'none' ? 'no owner yet' : m.owner === R.me ? 'you' : TEAM[m.owner].n}`, m.due != null ? dueTxtM(m) : '', <><span className="who">{m.owner === R.me ? 'You’re on it' : m.owner === 'none' ? 'Nobody’s on it' : `${firstName(m.owner)} is on it`}</span><button className="lnk" data-xopen={m.id}>Open →</button></>, m.owner === 'none']));
        MS.filter(m => m.due != null && m.due < 0 && ['prospect', 'talking'].includes(m.stage)).sort((a, b) => a.due - b.due).forEach(m => NEED.push(['absent', `${m.name} is ${plural(-m.due, 'day', 'days')} overdue`, `${m.next || 'No next step'} · ${m.owner === 'none' ? 'no owner yet' : m.owner === R.me ? 'your lead' : firstName(m.owner) + '’s lead'}`, `${-m.due}d`, <><span className="who none">Not on a route</span><button className="lnk" data-xopen={m.id}>Open →</button></>, true]));
        fleetBad().forEach(([id, f]) => {
          const m = MSBY[id],
            st = devFix(m);
          NEED.push(['absent', `${m.name}’s Point ${Object.values(f).flat().includes('off') ? 'is offline' : 'is low on battery'}`, f.note || '', f.seen, st ? <span className="who">{`On ${staffFirst()}’s route today · stop ${STOPS.indexOf(st) + 1}`}</span> : <span className="who none">Not on a route</span>, !st]);
        });
        const need = <div className="cell s5"><div className="hd"><h2>Needs you</h2><div className="r"><span className="lbl">{plural(NEED.length, 'thing', 'things')}</span></div></div><div className="al">{NEED.length ? NEED.slice(0, 6).map(([sv, t, m, age, own, none], __k) => <div key={__k} className="alr"><div className="al-m"><div className="al-t"><i className="sv" style={css(`background:${sevCol(sv)}`)} /><b>{t}</b><span className="age">{age}</span></div><span className="m">{m}</span></div><div className={`own ${none ? 'none' : ''}`}>{own}</div></div>) : <p className="small quiet" style={css("padding:18px 22px;margin:0")}>Nothing needs you here.</p>}</div><div className="bk-ft"><span>Money and terms need a second person</span><button data-xgo="home">All of it on Home →</button></div></div>;
        /* the pipeline at a glance: how many shops at each stage (how fast they move isn't recorded yet) */
        const st = STG5.map(([k, t]) => [k, t, MS.filter(m => m.stage === k)]),
          mx = Math.max(1, ...st.map(x => x[2].length)),
          sd = MS.filter(m => m.stage === 'signed').length;
        const subOf = (k, a) => k === 'prospect' ? `${a.filter(m => m.last == null).length} not visited yet` : k === 'talking' ? money(sumVal(a)).replace('.00', '') + ' a month' : k === 'signing' ? plural(a.length, 'agreement out', 'agreements out') : k === 'signed' ? 'Not taking cards yet' : money(a.reduce((s, m) => s + m.oct, 0)) + ' in ' + MO().short;
        const pipe = <div className="cell s7"><div className="hd"><h2>From first visit to payments</h2><div className="r"><span className="lbl">{plural(MS.length, 'shop', 'shops')}</span></div></div><div className="mp">{st.map(([k, t, a], i) => <button key={i} className="mp-r" data-xtab={['transacting', 'signed'].includes(k) ? 'partners' : 'pipeline'}><span className="mp-k"><i style={css(`background:${STGCOL[k]}`)} />{t}</span><span className="mp-b"><i style={css(`width:${a.length / mx * 100}%;background:${STGCOL[k]}`)} /></span><b>{a.length}</b><span className="mp-s">{subOf(k, a)}</span></button>)}</div><div className="bk-ft"><span>{sd ? `${plural(sd, 'signed shop doesn’t', 'signed shops don’t')} take card payments yet` : 'How fast shops move between stages isn’t recorded yet'}</span>{sd ? <button data-xtab="partners" data-xpf="signed">Pitch them →</button> : <span />}</div></div>;
        /* founding seats: the founding shops taking cards, then any signing */
        const fd = [...TXO.filter(m => m.founding).map(m => [m.name, 'filled', 'Taking cards', m.id]), ...MS.filter(m => m.stage === 'signing' && m.founding).map(m => [m.name, 'signing', 'Signing', m.id])].slice(0, LV.seats),
          seats = [...fd, ...Array.from({
            length: Math.max(0, LV.seats - fd.length)
          }, () => ['', 'open', 'Open', ''])],
          filled = fd.filter(s => s[1] === 'filled').length;
        const fs = <div className="cell s5"><div className="hd"><h2>Founding seats</h2><div className="r"><span className="lbl">{"Capped at "}{LV.seats}</span></div></div><div className="fsx">{seats.map(([n, s, w, id], i) => <button key={i} className={`fsx-s ${s}`} {...attrs(id ? `data-xopen="${id}"` : 'disabled')}><span className="fsx-n">{i + 1}</span><b>{n || 'Open seat'}</b><span>{w}</span></button>)}</div><div className="bk-ft"><span>{filled}{" of "}{LV.seats}{" filled"}</span><span /></div></div>;
        /* who's clearing the volume */
        const top = TXO.slice().sort((a, b) => b.oct - a.oct).filter(m => m.oct),
          omx = Math.max(1, top[0]?.oct || 0);
        const vol = <div className="cell s7"><div className="hd"><h2>Cleared by shop</h2><div className="r"><span className="lbl">{MO().long}{" so far"}</span></div></div><div className="mv">{top.length ? <>{top.slice(0, 7).map((m, __k) => <button key={__k} className="mv-r" data-xopen={m.id}><span>{m.name}</span><span className="mv-b"><i style={css(`width:${m.oct / omx * 100}%;background:var(--fg)`)} /></span><b>{money(m.oct)}</b></button>)}{top.length > 7 ? <div className="mv-r rest"><span>{top.length - 7}{" more shops"}</span><span className="mv-b"><i style={css(`width:${top.slice(7).reduce((s, m) => s + m.oct, 0) / omx * 100}%;background:var(--line)`)} /></span><b>{money(top.slice(7).reduce((s, m) => s + m.oct, 0))}</b></div> : ''}</> : <p className="small quiet" style={css("padding:16px 22px;margin:0")}>No shop has cleared a Clear sale this month.</p>}</div><div className="bk-ft"><span>Approved Clear charges, this calendar month</span><button data-xtab="partners">All partners →</button></div></div>;
        // the shops that had a sale refused over their cap this week (losses per shop aren't recorded, so no raise-or-hold call)
        const hit = TXO.filter(m => m.hits > 0).sort((a, b) => b.hits - a.hits),
          capped = TXO.filter(m => m.cap != null).length;
        const cp = <div className="cell s5"><div className="hd"><h2>Caps to review</h2><div className="r"><span className="lbl">Hit their cap this week</span></div></div>{hit.length ? <div className="mcl">{hit.map((m, __k) => <button key={__k} className="mcl-r" data-xopen={m.id}><span className="mcl-k"><b>{m.name}</b><span>{m.cap != null ? `${money(m.cap).replace('.00', '')} cap` : 'No cap'}{" · "}{plural(m.hits, 'sale', 'sales')}{" refused"}</span></span><span className="mcl-h">{[0, 1, 2].map((i, __k) => <i key={__k} className={i < m.hits ? 'on' : ''} />)}</span></button>)}</div> : <div className="bk-empty">{TXO.length ? 'No sale went over a shop’s cap this week.' : 'No shop is taking Clear yet.'}</div>}<div className="bk-ft"><span>{`${capped} of ${plural(TXO.length, 'shop', 'shops')} with a cap · MerchantRegistry`}</span><span /></div></div>;
        html(document.getElementById('mv'), <><section className="band" style={css("margin-top:0")}><div className="bento">{map}</div></section><section className="band"><div className="bento">{pipe}{need}</div></section><section className="band"><div className="bento">{vol}{cp}</div></section><section className="band"><div className="bento">{swapClass(fs, 'cell s5', 'cell s12')}</div></section></>);
      }

      /* ══ Pipeline ══ */
      const KCOL = [['prospect', 'Prospect', 'Not visited yet'], ['talking', 'Talking', 'Visits, demos, calls'], ['signing', 'Signing', 'Agreement out'], ['signed', 'Signed', 'Posters and $10 only']];
      const KMOVE = {
        prospect: 'Moved back to Prospect',
        talking: 'Moved to Talking',
        signing: 'Agreement sent · moved to Signing',
        signed: 'Agreement back · marked signed'
      };
      function kTile(m) {
        const rt = routeFor(m),
          od = m.due != null && m.due < 0,
          can = canEditM(m),
          sg = m.stage === 'signed';
        const due = m.due == null ? '' : <span className={`kt-due ${od ? 'late' : m.due <= 1 ? 'soon' : ''}`}>{od ? `${-m.due}d overdue` : dueTxtM(m)[0].toUpperCase() + dueTxtM(m).slice(1)}</span>;
        const where = rt ? <span className="kt-rt">{rt.who === R.me ? 'Your' : firstName(rt.who) + '’s'}{" "}{fmtWD(dayT(rt.d)).slice(0, 3)}{" route"}</span> : <span>{m.last == null ? 'Never visited' : m.last === 0 ? 'Visited today' : m.last + 'd since a visit'}</span>;
        return <button className={`kt ${od ? 'late' : ''} ${mine(m) ? 'me' : ''} ${can ? 'can' : ''} ${X.flash === m.id ? 'flash' : ''}`} data-xopen={m.id} {...attrs(can ? `data-kt="${m.id}"` : '')} aria-label={`${m.name}, ${STGN[m.stage]}${can ? ', drag to move' : ''}`}><span className="kt-t"><b>{m.name}</b>{sg && m.owed ? <span className="kt-v">{money(m.owed)}<small>{" owed"}</small></span> : m.founding ? <span className="kt-f">{LV ? 'Founding' : 'Founding 4/5'}</span> : ''}</span><span className="kt-m">{m.kind}{" · "}{m.city}{sg ? ` · ${m.posters} poster${m.posters === 1 ? '' : 's'}` : ''}</span>{m.val ? <span className="kt-bw"><span className="kt-bar"><i style={css(`width:${Math.min(100, m.val / 12000 * 100).toFixed(0)}%`)} /></span><span className="kt-v">{money(m.val).replace('.00', '')}<small>/mo</small></span></span> : ''}<span className="kt-n"><span>{m.next || 'No next step'}</span>{due}</span><span className="kt-f2"><span className={`av sm ${mine(m) ? '' : 'dim'}`}>{TEAM[m.owner].ini}</span>{where}{can ? <svg className="kt-g" viewBox="0 0 10 16" aria-hidden="true"><circle cx="2.5" cy="3" r="1.3" /><circle cx="7.5" cy="3" r="1.3" /><circle cx="2.5" cy="8" r="1.3" /><circle cx="7.5" cy="8" r="1.3" /><circle cx="2.5" cy="13" r="1.3" /><circle cx="7.5" cy="13" r="1.3" /></svg> : ''}</span></button>;
      }
      function renderPipeline() {
        const me = R.me;
        const q = X.bq.trim().toLowerCase(),
          hit = m => !q || m.name.toLowerCase().includes(q) || m.city.toLowerCase().includes(q) || m.kind.toLowerCase().includes(q);
        const ord = (x, y) => X.seq && X.seq[x.id] != null && X.seq[y.id] != null ? X.seq[x.id] - X.seq[y.id] : (x.due ?? 99) - (y.due ?? 99) || (y.val || 0) - (x.val || 0) || (y.posters || 0) - (x.posters || 0);
        const sub = (k, a) => k === 'prospect' || k === 'talking' ? `${money(sumVal(a)).replace('.00', '')} a month` : k === 'signing' ? a.some(m => m.founding) && !LV ? 'Founding seat 4 of 5' : `${a.length} agreement${a.length === 1 ? '' : 's'} out` : LV ? 'Not taking cards yet' : 'Posters and $10 only';
        const board = <div className="cell s12"><div className="hd"><h2>Pipeline</h2><div className="r"><label className="msearch sm"><svg className="i" viewBox="0 0 20 20"><circle cx="9" cy="9" r="5" /><path d="M13 13l4 4" /></svg><input id="xbq" placeholder="Find a shop" defaultValue={X.bq} /></label>{LV && RO() ? '' : <button className="btn p sm-b" data-xadd="">+ Prospect</button>}</div></div><div className="kb-tabs" id="kbtabs" role="tablist" aria-label="Stage">{KCOL.map(([k, t], __k) => <button key={__k} className={`kb-tab ${X.kst === k ? 'on' : ''}`} data-ktab={k} role="tab" aria-selected={X.kst === k}><b>{MS.filter(m => m.stage === k && hit(m)).length}</b><span>{t}</span></button>)}</div><div className="kb" id="kb">{KCOL.map(([k, t], __k) => {
              const all = MS.filter(m => m.stage === k && hit(m)).sort(ord),
                cap = k === 'signed' && !X.allSigned && !q ? 6 : 99,
                a = all.slice(0, cap);
              return <section key={__k} className={`kb-c ${X.kst === k ? 'on' : ''}`} data-kcol={k}><header className="kb-h"><span><b>{t}</b><span>{sub(k, all)}</span></span><b className="kb-k">{all.length}</b><span className="kb-hint">{all.length}{" shop"}{all.length === 1 ? '' : 's'}</span></header><div className="kb-b">{a.map((x, i) => <Fragment key={i}>{kTile(x, i)}</Fragment>)}{all.length > cap ? <button className="kb-more" data-xsigned="">{"Show "}{all.length - cap}{" more"}</button> : k === 'signed' && X.allSigned && !q ? <button className="kb-more" data-xsigned="">Show fewer</button> : ''}{all.length ? '' : <div className="kb-e">{q ? 'No matches' : 'Drop a shop here'}</div>}</div></section>;
            })}</div><div className="bk-ft"><span><span className="kb-fd">{LV ? 'Drag a shop to move it. Every move is logged.' : isAdmin() ? 'Drag a shop to move it. Every move is logged and can be undone.' : 'Drag your own leads to move them. Every move is logged.'}</span><span className="kb-fm">Hold a shop, then drop it on a stage above</span></span><button data-xtab="partners">Partners →</button></div></div>;
        /* shop enquiries */
        const es = e => X.enqSt[e.id] || e.st;
        const enq = <div className="cell s7" id="menq"><div className="hd"><h2>Shop enquiries</h2><div className="r"><span className="lbl">{ENQ.filter(e => es(e) === 'new').length}{" new"}</span></div></div><div className="me-l">{ENQ.map((e, __k) => {
              const s = es(e),
                shown = X.reveal && X.reveal.has(e.id);
              return <div key={__k} className={`me-r ${s}`}><div className="me-t"><i className="sv" style={css(`background:${s === 'new' ? 'var(--live)' : 'var(--line)'}`)} /><b className={shown ? '' : 'msk'}>{shown ? e.name : e.mask}</b><span className="age">{e.when}</span></div><span className="me-m">{e.kind}{" · "}{e.city}{" · "}{e.from}</span><p className="me-q">“{e.msg}”</p><div className="me-a">{s === 'new' ? <>{e.known ? <><span className="me-k">Already a partner · posters only</span><button className="lnk" data-xopen={e.known}>Open the shop →</button></> : <><button className="btn sm-b p" data-xenq={`add|${e.id}`}>Add to pipeline</button><button className="btn sm-b" data-xenq={`reply|${e.id}`}>Reply</button><button className="lnk3" data-xenq={`no|${e.id}`}>Not a fit</button></>}{!shown ? <button className="lnk3 me-show" data-xreveal={e.id}>Show name</button> : ''}</> : s === 'added' ? <span className="ok me-k">Added to the pipeline</span> : s === 'replied' ? <span className="me-k quiet">Replied</span> : <span className="me-k quiet">Not a fit{e.why ? ' · ' + e.why : ''}</span>}</div></div>;
            })}</div><div className="bk-ft"><span>From useclear.org/shops · names masked, showing one is logged</span><span /></div></div>;
        /* where leads come from, and who owns them */
        const open = MS.filter(m => ['prospect', 'talking', 'signing'].includes(m.stage)),
          srcs = Object.keys(SRC).map(k => [k, open.filter(m => m.source === k)]),
          smx = Math.max(...srcs.map(x => x[1].length), 1);
        const own = Object.entries(TEAM).filter(([, t]) => t.field).map(([k, t]) => [k, t, open.filter(m => m.owner === k)]);
        const src = <div className="cell s5"><div className="hd"><h2>Where leads come from</h2><div className="r"><span className="lbl">{open.length}{" open"}</span></div></div><div className="ms">{srcs.map(([k, a], __k) => <div key={__k} className="ms-r"><span>{SRC[k]}</span><span className="ms-b"><i style={css(`width:${a.length / smx * 100}%`)} /></span><b>{a.length}</b><span className="ms-s">{a.filter(m => m.stage === 'talking' || m.stage === 'signing').length}{" talking"}</span></div>)}</div><div className="ms ms2"><span className="lbl">Who owns them</span>{own.map(([k, t, a], __k) => <div key={__k} className="ms-r"><span className="ms-p"><span className="av sm">{t.ini}</span>{k === R.me ? 'You' : t.n}</span><span className="ms-b"><i style={css(`width:${a.length / Math.max(1, open.length) * 100}%;background:color-mix(in srgb,var(--fg) 55%,transparent)`)} /></span><b>{a.length}</b><span className="ms-s">{money(sumVal(a)).replace('.00', '')}/mo</span></div>)}</div><div className="bk-ft"><span>Field walk-ins become prospects straight from the phone</span><span /></div></div>;
        html(document.getElementById('mv'), <><section className="band" style={css("margin-top:0")}><div className="bento">{board}</div></section><section className="band"><div className="bento">{LV ? notReal('s7', 'Shop enquiries', 'Needs the site’s shop enquiries with their details: the kind of shop, what they asked, and whether they’ve been answered, added or turned down.', 'menq') : enq}{src}</div></section></>);
      }

      /* ══ Partners ══ */
      function renderPartners() {
        const P = MS.filter(m => ['transacting', 'signing', 'signed'].includes(m.stage));
        const terms = [['NET-30', TXO.filter(m => m.terms === 'NET-30').length, 'var(--fg)'], ['NET-14', TXO.filter(m => m.terms === 'NET-14').length, 'var(--land)']];
        const fees = [['2.5%', TXO.filter(m => m.fee === 2.5).length, 'var(--fg)'], ['2.0% founding', TXO.filter(m => m.fee === 2).length, 'var(--land)'], ['Free, first 20', TXO.filter(m => m.fee === 0).length, 'var(--line)']];
        const caps = [100, 120, 150, 300, 500].map(c => [c, TXO.filter(m => m.cap === c).length]),
          cmx = Math.max(...caps.map(x => x[1]));
        const mix = a => <><div className="mb2">{a.map(([k, v, c], __k) => <i key={__k} style={css(`flex:${v};background:${c}`)} />)}</div><div className="mk2">{a.map(([k, v, c], __k) => <span key={__k}><i style={css(`background:${c}`)} />{k}{" "}<b>{v}</b></span>)}</div></>;
        const sum = LV ? partnersSumLive() : <><div className="cell s4"><div className="hd"><h2>Terms</h2><div className="r"><span className="lbl">{TXO.length}{" transacting"}</span></div></div><div className="mt"><div className="m-big">{terms[0][1]}{" "}<small>{"of "}{TXO.length}{" on NET-30"}</small></div>{mix(terms)}</div><div className="bk-ft"><span>NET-14 needs 30-day customer terms</span><span /></div></div><div className="cell s4"><div className="hd"><h2>Fees</h2><div className="r"><span className="lbl">Per sale</span></div></div><div className="mt"><div className="m-big">{"2.5% "}<small>standard</small></div>{mix(fees)}</div><div className="bk-ft"><span>Taken out of each payout</span><span /></div></div><div className="cell s4"><div className="hd"><h2>Caps</h2><div className="r"><span className="lbl">Per sale</span></div></div><div className="mt"><div className="mcap">{caps.map(([c, n], __k) => <div key={__k}><span>{n}</span><i style={css(`height:${n / cmx * 100}%`)} /><s>${c}</s></div>)}</div></div><div className="bk-ft"><span>Raised after 15 clean sales</span><span /></div></div></>;
        const F2 = {
          all: ['All', P],
          transacting: ['Transacting', TXO],
          signed: [LV ? 'Not taking cards' : 'Posters only', P.filter(m => m.stage === 'signed' || m.stage === 'signing')],
          founding: ['Founding', P.filter(m => m.founding)]
        };
        const all = F2[X.pf][1].slice().sort((a, b) => (b.oct || 0) - (a.oct || 0) || a.name.localeCompare(b.name)),
          PGX = 10,
          pgs = Math.max(1, Math.ceil(all.length / PGX));
        X.ppage = Math.min(X.ppage || 0, pgs - 1);
        const rows = all.slice(X.ppage * PGX, (X.ppage + 1) * PGX);
        const omx = Math.max(...TXO.map(m => m.oct));
        const tbl = <div className="cell s12"><div className="hd"><h2>Every partner</h2><div className="r"><div className="seg sm" role="group" aria-label="Show">{Object.entries(F2).map(([k, [t, a]], __k) => <button key={__k} data-xpf={k} aria-pressed={X.pf === k}>{t}{" "}{a.length}</button>)}</div></div></div><div className="bt-wrap"><table className="bt xp"><colgroup><col style={css("width:24%")} /><col style={css("width:13%")} /><col style={css("width:9%")} /><col style={css("width:9%")} /><col style={css("width:12%")} /><col style={css("width:17%")} /><col style={css("width:8%")} /><col style={css("width:8%")} /></colgroup><thead><tr><th className="c-nm">Shop</th><th style={css("text-align:left")}>Status</th><th>Fee</th><th>Terms</th><th>Cap · hits</th><th style={css("text-align:left")}>{LV ? `Cleared · ${MO().short}` : 'Cleared · Oct'}</th><th>$10 owed</th><th>Visited</th></tr></thead><tbody>{rows.map((m, __k) => <tr key={__k} data-xopen={m.id}><td className="tn"><span className="xp-n"><b>{m.name}</b><span>{m.founding ? 'Founding · ' : ''}{m.kind}{" · "}{m.city}</span></span></td><td style={css("text-align:left")}><span className="stg"><i style={css(`width:9px;height:9px;display:block;background:${STGCOL[m.stage]}`)} />{m.stage === 'signed' && !LV ? 'Posters only' : STGN[m.stage]}</span></td><td>{m.stage === 'transacting' ? m.fee === 0 ? 'Free' : m.fee.toFixed(1) + '%' : <span className="quiet">–</span>}</td><td>{m.terms || <span className="quiet">–</span>}</td><td>{m.cap ? <span className="xp-c">${m.cap}<span className="mcl-h">{[0, 1, 2].map((i, __k) => <i key={__k} className={i < m.hits ? 'on' : ''} />)}</span></span> : <span className="quiet">–</span>}</td><td style={css("text-align:left")}>{m.oct ? <span className="xp-o"><span className="xp-ob"><i style={css(`width:${m.oct / omx * 100}%`)} /></span><b>{money(m.oct)}</b></span> : <span className="quiet">–</span>}</td><td>{m.owed ? money(m.owed) : <span className="quiet">–</span>}</td><td><span className={m.last != null && m.last >= 30 ? 'warn' : ''}>{m.last == null ? '–' : m.last === 0 ? 'Today' : m.last + 'd'}</span></td></tr>)}</tbody></table></div><div className="bk-ft"><span>{LV ? '' : <span className="d-only">{"Loss rate is on each shop’s own sales. "}</span>}Click a shop to open it.</span><span className="pg2"><span>{X.ppage * PGX + 1}–{Math.min(all.length, (X.ppage + 1) * PGX)}{" of "}{all.length}</span><button data-xppage="-1" {...attrs(X.ppage === 0 ? 'disabled' : '')} aria-label="Previous"><svg viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg></button><button data-xppage="1" {...attrs(X.ppage >= pgs - 1 ? 'disabled' : '')} aria-label="Next"><svg viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5" /></svg></button></span></div></div>;
        const up = P.filter(m => m.stage === 'signed').sort((a, b) => b.posters - a.posters || (a.last ?? 0) - (b.last ?? 0));
        const pitch = <div className="cell s12"><div className="hd"><h2>{LV ? 'Signed, not taking cards' : 'On posters, not payments'}</h2><div className="r"><span className="lbl">{up.length}{LV && up.length === 1 ? ' shop to pitch' : " shops to pitch"}</span></div></div><div className="xu">{up.slice(0, 9).map((m, __k) => {
              const rt = routeFor(m);
              return <div key={__k} className="xu-r"><button className="xu-k" data-xopen={m.id}><b>{m.name}</b><span>{m.city}{" · "}{m.posters}{" poster"}{m.posters === 1 ? '' : 's'}{" · "}{lastTxt(m.last).toLowerCase()}</span></button>{rt ? <span className="xu-on">{"On "}{firstName(rt.who)}{"’s "}{fmtWD(dayT(rt.d)).slice(0, 3)}{" route"}</span> : LV ? '' : <button className="btn sm-b" data-xplan={m.id}>Plan a visit</button>}</div>;
            })}</div><div className="bk-ft"><span>{LV ? 'They’ve signed with Clear. Card payments are the next step.' : 'They already like Clear enough to host a poster. Card payments are the next step.'}</span><button data-xpf="signed">{"All "}{up.length}{" →"}</button></div></div>;
        html(document.getElementById('mv'), <><section className="band" style={css("margin-top:0")}><div className="bento">{sum}</div></section><section className="band"><div className="bento">{tbl}</div></section><section className="band"><div className="bento">{pitch}</div></section></>);
      }

      /* ══ Payouts ══ */
      function renderPayouts() {
        if (LV) return renderPayoutsLive();
        const net30 = TXO.filter(m => m.terms === 'NET-30'),
          lines = net30.map(m => ({
            m,
            ...payOf(m)
          })),
          extra = [['icw', 'Inland Cycle Works', 60], ['tacos', 'Fontana Tacos', 40]];
        const run = lines.reduce((a, l) => a + l.total, 0) + 100,
          sales = lines.reduce((a, l) => a + l.sales, 0),
          fees = lines.reduce((a, l) => a + l.fee, 0),
          red = lines.reduce((a, l) => a + l.red, 0) + 100;
        const W = Math.max(sales, run),
          x = v => (v / W * 100).toFixed(2),
          prop = X.approvals.includes('run');
        const steps = [['Sales cleared', 0, sales, 'var(--fg)', money(sales)], ['Fees', sales - fees, sales, 'var(--absent)', '−' + money(fees)], ['$10 redemptions', sales - fees, sales - fees + red, 'var(--land)', '+' + money(red)], ['Payout', 0, run, 'var(--fg)', money(run)]];
        const wf = <div className="cell s7"><div className="hd"><h2>The next run</h2><div className="r"><span className="lbl">September · NET-30</span></div></div><div className="xw-top"><div className="m-big">{money(run)}</div><span>to 11 shops on Mon 2 Nov</span></div><div className="xw">{steps.map(([k, a, b, c, t], i) => <div key={i} className={`xw-r ${i === 3 ? 'tot' : ''}`}><span>{k}</span><span className="xw-t"><i style={css(`left:${x(a)}%;width:${x(b - a)}%;background:${c}`)} /></span><b>{t}</b></div>)}</div><div className="f-ft2"><span className="small quiet">{prop ? 'Proposed · waiting for a second person' : 'Payouts need two people: you propose, Dana approves'}</span>{prop ? <span className="fst tlv">Proposed</span> : <button className="btn p" data-xprop="run">Propose the run</button>}</div></div>;
        const col = +(sales * 0.842).toFixed(2);
        const cl = <div className="cell s5"><div className="hd"><h2>Collected before it goes out</h2><div className="r"><span className="lbl">For this run</span></div></div><div className="xc"><div className="xc-r"><i style={css("width:84.2%")} /></div><div className="m-big">{"84.2% "}<small>repaid by members</small></div></div><div className="led xc-l"><div><span>Collected</span><b>{money(col)}</b></div><div><span>Still due from members</span><b>{money(sales - col)}</b></div><div><span>Due by</span><b>30 Oct</b></div></div><div className="bk-ft"><span>If members are late, the pool covers the gap</span><button data-xgo="money">Money →</button></div></div>;
        const okR = S.payoutDone || X.approvals.includes('rosas-pay');
        const UP = [[1, 'Rosa’s Panadería', 'NET-14 · September', 412.60, 'rosas', okR ? 'Approved' : 'Needs a second person'], [12, 'Monthly run', 'NET-30 · 11 shops', run, null, prop ? 'Proposed' : 'Not proposed yet'], [14, 'Arrowhead Nails', 'NET-14', 732.00, 'nails', 'Scheduled'], [14, 'Cajon Phone Repair', 'NET-14', 2184.00, 'phone', 'Scheduled'], [28, 'NET-14 shops', 'Next NET-14 round', 1140.80, null, 'Estimated']];
        const umx = Math.max(...UP.map(u => u[3])),
          MON = d => new Date(dayT(d)).toLocaleDateString('en-US', {
            month: 'long',
            timeZone: 'UTC'
          });
        const rel = d => d === 1 ? 'tomorrow' : `in ${d} days`;
        const rows = UP.map(([d, n, s, v, id, st], i) => {
          const same = i && UP[i - 1][0] === d,
            newM = !i || MON(UP[i - 1][0]) !== MON(d);
          const mt = UP.filter(u => MON(u[0]) === MON(d)),
            band = newM ? <div className="xq-m"><span className="lbl">{MON(d)}</span><span className="xq-mt">{mt.length}{" payout"}{mt.length === 1 ? '' : 's'}{" · "}<b>{money(mt.reduce((a, u) => a + u[3], 0))}</b></span></div> : '';
          const grp = UP[i + 1] && UP[i + 1][0] === d;
          return <Fragment key={i}>{band}<div className={`xq-r ${same ? 'same' : ''} ${grp ? 'grp' : ''} ${d === 1 ? 'soon' : ''}`}><span className="xq-d leaf">{same ? <><i className="tie" aria-hidden="true" /><span className="sr">Same day</span></> : <><span>{fmtWD(dayT(d)).slice(0, 3)}</span><b>{new Date(dayT(d)).getUTCDate()}</b></>}</span><span className="xq-k">{id ? <button data-xopen={id}><b>{n}</b></button> : <b>{n}</b>}<span>{s}{" · "}{same ? 'same day' : rel(d)}</span></span><span className="xq-b"><i style={css(`width:${v / umx * 100}%`)} /></span><b className="xq-v">{money(v)}</b><span className={`xq-s ${st === 'Needs a second person' ? 'warn' : st === 'Proposed' ? 'tlv' : st === 'Approved' ? 'ok' : ''}`}>{st === 'Needs a second person' && isAdmin() && R.me !== 'dana' ? <span className="xq-a"><span>Proposed by Dana</span><button className="btn sm-b p" data-xapprove="rosas-pay">Approve</button></span> : st}</span></div></Fragment>;
        });
        const cal = <div className="cell s12"><div className="hd"><h2>When money goes out</h2><div className="r"><span className="lbl">Next 30 days</span></div></div><div className="xq">{rows}</div><div className="bk-ft"><span>NET-14 shops are paid every other Wednesday</span><span /></div></div>;
        const tbl = <div className="cell s12"><div className="hd"><h2>The monthly run, line by line</h2><div className="r"><span className="lbl">Mon 2 Nov</span></div></div><div className="bt-wrap"><table className="bt xl"><colgroup><col style={css("width:26%")} /><col style={css("width:14%")} /><col style={css("width:12%")} /><col style={css("width:14%")} /><col style={css("width:14%")} /><col style={css("width:20%")} /></colgroup><thead><tr><th className="c-nm">Shop</th><th>Sales cleared</th><th>Fee</th><th>$10 redemptions</th><th>Payout</th><th style={css("text-align:left")}>Share of run</th></tr></thead><tbody>{lines.sort((a, b) => b.total - a.total).map((l, __k) => <tr key={__k} data-xopen={l.m.id}><td className="tn"><b>{l.m.name}</b></td><td>{money(l.sales)}</td><td>{l.fee ? '−' + money(l.fee) : 'Free'}</td><td>{l.red ? money(l.red) : <span className="quiet">–</span>}</td><td><b>{money(l.total)}</b></td><td style={css("text-align:left")}><span className="xp-o"><span className="xp-ob"><i style={css(`width:${l.total / run * 100}%`)} /></span><span>{(l.total / run * 100).toFixed(1)}%</span></span></td></tr>)}{extra.map(([id, n, v], __k) => <tr key={__k} data-xopen={id}><td className="tn"><b>{n}</b><span>Posters only · redemptions</span></td><td><span className="quiet">–</span></td><td><span className="quiet">–</span></td><td>{money(v)}</td><td><b>{money(v)}</b></td><td style={css("text-align:left")}><span className="xp-o"><span className="xp-ob"><i style={css(`width:${v / run * 100}%`)} /></span><span>{(v / run * 100).toFixed(1)}%</span></span></td></tr>)}<tr className="tot"><td className="tn"><b>Run total</b></td><td><b>{money(sales)}</b></td><td><b>−{money(fees)}</b></td><td><b>{money(red)}</b></td><td><b>{money(run)}</b></td><td /></tr></tbody></table></div><div className="bk-ft"><span>Every account verified · proposed by one person, approved by another</span><span /></div></div>;
        html(document.getElementById('mv'), <><section className="band" style={css("margin-top:0")}><div className="bento">{wf}{cl}</div></section><section className="band"><div className="bento">{cal}</div></section><section className="band"><div className="bento">{tbl}</div></section></>);
      }

      /* ══ Devices ══ */
      function renderDevices() {
        if (LV) return renderDevicesLive();
        const rows = Object.entries(FLEET).map(([id, f]) => ({
          m: MSBY[id],
          f,
          bad: Object.values(f).flat().includes('off') ? 'off' : Object.values(f).flat().includes('low') ? 'low' : ''
        })).sort((a, b) => (b.bad ? 1 : 0) - (a.bad ? 1 : 0));
        const all = rows.flatMap(r => DTYPE.flatMap(([k]) => r.f[k] || [])),
          off = all.filter(x => x === 'off').length,
          low = all.filter(x => x === 'low').length;
        const fleet = <div className="cell s12"><div className="hd"><h2>Devices at shops</h2><div className="r"><span className="lbl">{all.length}{" devices · "}{off}{" offline · "}{low}{" battery low"}</span></div></div><div className="bt-wrap"><table className="bt xd"><colgroup><col style={css("width:22%")} /><col style={css("width:10%")} /><col style={css("width:16%")} /><col style={css("width:10%")} /><col style={css("width:10%")} /><col style={css("width:12%")} /><col style={css("width:20%")} /></colgroup><thead><tr><th className="c-nm">Shop</th>{DTYPE.map(([k, t], __k) => <th key={__k} style={css("text-align:left")}>{t}</th>)}<th>Checked in</th><th style={css("text-align:left")}>What’s next</th></tr></thead><tbody>{rows.map(({
                  m,
                  f,
                  bad
                }, __k) => {
                  const st = devFix(m),
                    di = st ? STOPS.indexOf(st) + 1 : 0;
                  return <tr key={__k} data-xopen={m.id} className={bad}><td className="tn"><b>{m.name}</b><span className={bad ? 'warn' : ''}>{bad ? f.note : m.city}</span><span className="xd-mq">{DTYPE.filter(([k]) => f[k]).map(([k, t], __k) => <span key={__k}>{t.replace('Clear ', '')}<span className="xd-q">{f[k].map((x, __k) => <i key={__k} className={x} />)}</span></span>)}{bad && st ? <span className="xd-on">{"Marcus · today, stop "}{di}</span> : ''}</span></td>{DTYPE.map(([k], __k) => <td key={__k} style={css("text-align:left")}>{f[k] ? <span className="xd-q">{f[k].map((s, __k) => <i key={__k} className={s} />)}</span> : <span className="quiet">–</span>}</td>)}<td>{f.seen}</td><td style={css("text-align:left")}>{bad ? st ? <span className="xd-on">{"Marcus · today, stop "}{di}</span> : <button className="lnk4" data-xplan={m.id}>Plan a visit</button> : <span className="quiet">All online</span>}</td></tr>;
                })}</tbody></table></div><div className="bk-ft"><span className="f-key"><i style={css("background:var(--fg)")} />{"Online "}<i style={css("background:var(--underway)")} />{"Battery low "}<i className="koff" />Offline</span><span className="small quiet">Points report in every 2 minutes</span></div></div>;
        const RF = [['Bought', 14, 'Awaiting repair'], ['Repairing', 6, 'Screens, ports'], ['Testing', 4, '48-hour soak'], ['Ready', 8, 'In stock'], ['Shipped', 21, 'At shops']],
          rmx = 53;
        const PRE = [['Mission Auto Care', 'Thu 29 Oct', 100, 2], ['Kingston Vet', 'Thu 29 Oct', 40, 1], ['Colton Cuts', 'Thu 29 Oct', 40, 1], ['Sun Valley HVAC', 'Mon 2 Nov', 150, 3], ['Mentone Coffee', 'Mon 2 Nov', 40, 1], ['Base Line Pho', 'Fri 6 Nov', 220, 6], ['Fontana Tacos', 'Fri 6 Nov', 160, 5]];
        const SHIP = [['Thu 29 Oct', 'ready'], ['Mon 2 Nov', 'ready'], ['Fri 6 Nov', 'line']].map(([d, st]) => [d, PRE.filter(p => p[1] === d).map(p => [p[0], p[3]]), st]);
        const ref = <div className="cell s7"><div className="hd"><h2>Refurb line</h2><div className="r"><span className="lbl">Used Samsung units</span></div></div><div className="xr"><div className="m-big">{"8 "}<small>ready to ship · 10 still in repair or testing</small></div><div className="xr-b">{RF.map(([k, n], i) => <i key={i} style={css(`flex:${n};background:${['color-mix(in srgb,var(--fg) 22%,transparent)', 'color-mix(in srgb,var(--fg) 35%,transparent)', 'color-mix(in srgb,var(--fg) 50%,transparent)', 'var(--fg)', 'var(--land)'][i]}`)} />)}</div><div className="xr-s">{RF.map(([k, n, s], __k) => <div key={__k}><span className="lbl">{k}</span><b>{n}</b><span>{s}</span></div>)}</div></div><div className="xs"><div className="xs-h lbl">Where they go</div>{SHIP.map(([d, who, st], __k) => {
              const n = who.reduce((a, [, u]) => a + u, 0);
              return <div key={__k} className={`xs-r ${st}`}><span className="leaf"><span>{d.split(' ')[0]}</span><b>{d.split(' ')[1]}</b><span>{d.split(' ')[2]}</span></span><span className="xs-u"><b>{n}</b>{" unit"}{n > 1 ? 's' : ''}</span><span className="xs-w">{who.map(([s, u], __k) => <Fragment key={__k}>{__k ? ' · ' : ''}{s}{" "}<span className="quiet">{u}</span></Fragment>)}</span><span className="xs-s">{st === 'ready' ? 'Ready' : 'On the line'}</span></div>;
            })}</div><div className="bk-ft"><span>A repaired unit costs $61.00, against $189.00 new</span><span /></div></div>;
        const pre = <div className="cell s5"><div className="hd"><h2>Pre-orders</h2><div className="r"><span className="lbl">Refundable until made</span></div></div><div className="xo-top"><div className="m-big">$750.00</div><span>in deposits for 19 devices</span></div><div className="xo">{PRE.map(([n, d, v, u], __k) => {
              const m = MS.find(x => x.name === n);
              return <button key={__k} className="xo-r" {...attrs(m ? `data-xopen="${m.id}"` : '')}><b>{n}</b><span>{u}{" · "}{d}</span><b>{money(v)}</b></button>;
            })}</div><div className="bk-ft"><span>Ready units go out oldest deposit first</span><span /></div></div>;
        html(document.getElementById('mv'), <><section className="band" style={css("margin-top:0")}><div className="bento">{fleet}</div></section><section className="band"><div className="bento">{ref}{pre}</div></section></>);
      }

      /* live: the next run worked out from last month's sales; the schedule, what members repaid and the run's approval aren't recorded yet */
      function renderPayoutsLive() {
        const lines = runLines(),
          extra = owedOnly(),
          run = runTotal(),
          sales = lines.reduce((a, l) => a + l.sales, 0),
          fees = lines.reduce((a, l) => a + l.fee, 0),
          red = lines.reduce((a, l) => a + l.red, 0) + extra.reduce((a, m) => a + m.owed, 0);
        const W = Math.max(1, sales, run),
          x = v => (v / W * 100).toFixed(2),
          prop = X.approvals.includes('run'),
          when = LV.schedule?.monthly ? fmtWD(LV.schedule.monthly) : null,
          shops = lines.length + extra.length,
          RN = Math.max(1, run);
        const steps = [['Sales cleared', 0, sales, 'var(--fg)', money(sales)], ['Fees', sales - fees, sales, 'var(--absent)', '−' + money(fees)], ['$10 redemptions', sales - fees, sales - fees + red, 'var(--land)', '+' + money(red)], ['Payout', 0, run, 'var(--fg)', money(run)]];
        const wf = <div className="cell s7"><div className="hd"><h2>The next run</h2><div className="r"><span className="lbl">{MO().last}{" · NET-30"}</span></div></div><div className="xw-top"><div className="m-big">{money(run)}</div><span>{`to ${plural(shops, 'shop', 'shops')}${when ? ' on ' + when : ''}`}</span></div><div className="xw">{steps.map(([k, a, b, c, t], i) => <div key={i} className={`xw-r ${i === 3 ? 'tot' : ''}`}><span>{k}</span><span className="xw-t"><i style={css(`left:${x(a)}%;width:${x(b - a)}%;background:${c}`)} /></span><b>{t}</b></div>)}</div><div className="f-ft2"><span className="small quiet">{prop ? 'Proposed · waiting for a second person' : 'Payouts need two people: you propose, someone else approves'}</span>{prop ? <span className="fst tlv">Proposed</span> : run && !RO() ? <button className="btn p" data-xprop="run">Propose the run</button> : <span />}</div></div>;
        // what members have paid on the run's sales: paid at the counter, or repaid so far on their plans (TermIssuer)
        const CO = LV.collected,
          got = lines.reduce((a, l) => {
            const c = CO?.[l.m.id];
            return c ? { sold: a.sold + c.now + c.plans, paid: a.paid + c.now + c.repaid } : a;
          }, { sold: 0, paid: 0 });
        const cl = !CO ? notReal('s5', 'Collected before it goes out', 'Needs what members have repaid on the sales in this run, and what’s still due from them.') : <div className="cell s5"><div className="hd"><h2>Collected before it goes out</h2><div className="r"><span className="lbl">For this run</span></div></div><div className="xc"><div className="xc-r"><i style={css(`width:${got.sold ? got.paid / got.sold * 100 : 0}%`)} /></div><div className="m-big">{got.sold ? `${(got.paid / got.sold * 100).toFixed(1)}% ` : '— '}<small>{got.sold ? 'paid by members' : `no sales in ${MO().last}`}</small></div></div><div className="led xc-l"><div><span>Collected</span><b>{money(got.paid)}</b></div><div><span>Still due from members</span><b>{money(Math.max(0, got.sold - got.paid))}</b></div>{when ? <div><span>Run on</span><b>{when}</b></div> : ''}</div><div className="bk-ft"><span>If members are late, the pool covers the gap</span><button data-xgo="money">Money →</button></div></div>;
        const cal = notReal('s12', 'When money goes out', 'Needs the payout schedule: when each NET-14 and NET-30 payout goes, and whether a second person has approved it.');
        const tbl = <div className="cell s12"><div className="hd"><h2>The monthly run, line by line</h2><div className="r"><span className="lbl">{when || `${MO().last}’s sales`}</span></div></div><div className="bt-wrap"><table className="bt xl"><colgroup><col style={css("width:26%")} /><col style={css("width:14%")} /><col style={css("width:12%")} /><col style={css("width:14%")} /><col style={css("width:14%")} /><col style={css("width:20%")} /></colgroup><thead><tr><th className="c-nm">Shop</th><th>Sales cleared</th><th>Fee</th><th>$10 redemptions</th><th>Payout</th><th style={css("text-align:left")}>Share of run</th></tr></thead><tbody>{lines.sort((a, b) => b.total - a.total).map((l, __k) => <tr key={__k} data-xopen={l.m.id}><td className="tn"><b>{l.m.name}</b></td><td>{money(l.sales)}</td><td>{l.fee ? '−' + money(l.fee) : 'Free'}</td><td>{l.red ? money(l.red) : <span className="quiet">–</span>}</td><td><b>{money(l.total)}</b></td><td style={css("text-align:left")}><span className="xp-o"><span className="xp-ob"><i style={css(`width:${l.total / RN * 100}%`)} /></span><span>{(l.total / RN * 100).toFixed(1)}%</span></span></td></tr>)}{extra.map((m, __k) => <tr key={__k} data-xopen={m.id}><td className="tn"><b>{m.name}</b><span>Not taking cards · redemptions</span></td><td><span className="quiet">–</span></td><td><span className="quiet">–</span></td><td>{money(m.owed)}</td><td><b>{money(m.owed)}</b></td><td style={css("text-align:left")}><span className="xp-o"><span className="xp-ob"><i style={css(`width:${m.owed / RN * 100}%`)} /></span><span>{(m.owed / RN * 100).toFixed(1)}%</span></span></td></tr>)}{shops ? '' : <tr><td colSpan="6" className="tn"><span className="quiet">{`No NET-30 shop has ${MO().last} sales to pay out.`}</span></td></tr>}<tr className="tot"><td className="tn"><b>Run total</b></td><td><b>{money(sales)}</b></td><td><b>−{money(fees)}</b></td><td><b>{money(red)}</b></td><td><b>{money(run)}</b></td><td /></tr></tbody></table></div><div className="bk-ft"><span>Proposed by one person, approved by another</span><span /></div></div>;
        html(document.getElementById('mv'), <><section className="band" style={css("margin-top:0")}><div className="bento">{wf}{cl}</div></section><section className="band"><div className="bento">{cal}</div></section><section className="band"><div className="bento">{tbl}</div></section></>);
      }
      /* live: the shops' Points as the merchant app hears them; the refurb line and pre-orders aren't recorded here yet */
      function renderDevicesLive() {
        const rows = Object.entries(FLEET).map(([id, f]) => ({
          m: MSBY[id],
          f,
          bad: Object.values(f).flat().includes('off') ? 'off' : Object.values(f).flat().includes('low') ? 'low' : ''
        })).sort((a, b) => (b.bad ? 1 : 0) - (a.bad ? 1 : 0));
        const all = rows.flatMap(r => DTYPE.flatMap(([k]) => r.f[k] || [])),
          off = all.filter(x => x === 'off').length,
          low = all.filter(x => x === 'low').length;
        const onRoute = st => <span className="xd-on">{`${staffFirst()} · today, stop ${STOPS.indexOf(st) + 1}`}</span>;
        const fleet = <div className="cell s12"><div className="hd"><h2>Devices at shops</h2><div className="r"><span className="lbl">{plural(all.length, 'device', 'devices')}{" · "}{off}{" offline · "}{low}{" battery low"}</span></div></div><div className="bt-wrap"><table className="bt xd"><colgroup><col style={css("width:22%")} /><col style={css("width:10%")} /><col style={css("width:16%")} /><col style={css("width:10%")} /><col style={css("width:10%")} /><col style={css("width:12%")} /><col style={css("width:20%")} /></colgroup><thead><tr><th className="c-nm">Shop</th>{DTYPE.map(([k, t], __k) => <th key={__k} style={css("text-align:left")}>{t}</th>)}<th>Checked in</th><th style={css("text-align:left")}>What’s next</th></tr></thead><tbody>{rows.length ? rows.map(({
                  m,
                  f,
                  bad
                }, __k) => {
                  const st = devFix(m);
                  return <tr key={__k} data-xopen={m.id} className={bad}><td className="tn"><b>{m.name}</b><span className={bad ? 'warn' : ''}>{bad ? f.note : m.city}</span><span className="xd-mq">{DTYPE.filter(([k]) => f[k]).map(([k, t], __k) => <span key={__k}>{t.replace('Clear ', '')}<span className="xd-q">{f[k].map((x, __k) => <i key={__k} className={x} />)}</span></span>)}{bad && st ? onRoute(st) : ''}</span></td>{DTYPE.map(([k], __k) => <td key={__k} style={css("text-align:left")}>{f[k] ? <span className="xd-q">{f[k].map((s, __k) => <i key={__k} className={s} />)}</span> : <span className="quiet">–</span>}</td>)}<td>{f.seen}</td><td style={css("text-align:left")}>{bad ? st ? onRoute(st) : <span className="quiet">Not on a route</span> : <span className="quiet">All online</span>}</td></tr>;
                }) : <tr><td colSpan="7" className="tn"><span className="quiet">No Points have checked in yet.</span></td></tr>}</tbody></table></div><div className="bk-ft"><span className="f-key"><i style={css("background:var(--fg)")} />{"Online "}<i style={css("background:var(--underway)")} />{"Battery low "}<i className="koff" />Offline</span><span className="small quiet">A Point is offline after ten minutes unheard. Readers, tablets and printers don’t report in yet.</span></div></div>;
        const ref = notReal('s7', 'Refurb line', 'Needs the refurb line’s units: bought, in repair, testing, ready and shipped, and which shop each goes to.');
        const pre = notReal('s5', 'Pre-orders', 'Needs the shops’ device pre-orders, with their deposits and when each ships.');
        html(document.getElementById('mv'), <><section className="band" style={css("margin-top:0")}><div className="bento">{fleet}</div></section><section className="band"><div className="bento">{ref}{pre}</div></section></>);
      }

      /* ══ The shop record (side panel) and adding a prospect ══ */
      function ensurePanel() {
        let pn = document.getElementById('mpanel');
        if (!pn) {
          const sc = document.createElement('div');
          sc.id = 'mscrim';
          sc.className = 'scrim';
          document.body.appendChild(sc);
          pn = document.createElement('aside');
          pn.id = 'mpanel';
          pn.className = 'panel mpanel xpanel';
          document.body.appendChild(pn);
        }
        return pn;
      }
      function renderPanel() {
        const pn = ensurePanel();
        if (!X.open && !R.panel && !X.add) {
          document.body.classList.remove('pn');
          return;
        }
        document.body.classList.add('pn');
        if (R.panel) return (VPANELS.includes(R.panel.k) ? visitPanel : planPanel)(pn);
        if (X.add) return addPanel(pn);
        if (LV) return shopPanelLive(pn, MSBY[X.open]);
        const m = MSBY[X.open],
          me = R.me,
          edit = canEditM(m),
          si = STG5.findIndex(s => s[0] === m.stage),
          rt = routeFor(m),
          ds = devFix(m);
        const visits = VLOG.filter(v => v.shop === m.name),
          notes = X.note[m.id] || (m.id === 'tri' ? [] : []);
        const spark = m.stage === 'transacting' ? series(14, Math.round(m.oct * 14 / 21), i => (i + hashN(m.name)) % 7 === 6 ? .25 : .55 + .5 * Math.abs(Math.sin((i + hashN(m.name)) / 1.7)), hashN(m.name)) : null,
          smx = spark ? Math.max(...spark, 1) : 1;
        const nextBlock = m.next ? <div className="fit"><b>{m.next}</b><span>{m.due != null ? m.due < 0 ? `${-m.due} days overdue` : m.due === 0 ? 'Due today' : 'Due ' + fmtWD(dayT(m.due)) : 'No date set'}{" · "}{rt ? `on ${rt.who === me ? 'your' : firstName(rt.who) + '’s'} ${fmtWD(dayT(rt.d))} route` : ds ? `on Marcus’s route today, stop ${STOPS.indexOf(ds) + 1}` : 'not on a route'}</span></div> : '';
        const money_ = m.stage === 'transacting' ? <><div><div className="w90-h"><span className="lbl">Cleared · last 14 days</span><b>{money(m.oct)}{" in Oct · "}{m.octN}{" sales"}</b></div><div className="fpr-sp">{spark.map((v, __k) => <i key={__k} style={css(`height:${v / smx * 100}%`)} />)}</div></div><div className="led"><div><span>Fee</span><b>{m.fee === 0 ? 'Free for the first 20 sales' : m.fee.toFixed(1) + '%' + (m.founding ? ' · founding, for life' : '')}</b></div><div><span>Terms</span><b>{m.terms}</b></div><div><span>Cap per sale</span><b>${m.cap}{" · hit "}{m.hits}{" time"}{m.hits === 1 ? '' : 's'}{" this week"}</b></div><div><span>Loss on their own sales</span><b className={m.lost ? 'warn' : ''}>{(m.lost / m.orig * 100).toFixed(1)}{"% · "}{m.lost}{" of "}{m.orig}</b></div><div><span>Next payout</span><b>{m.terms === 'NET-14' ? m.id === 'rosas' ? '$412.60 tomorrow' : 'Wed 4 Nov' : money(payOf(m).total) + ' · Mon 2 Nov'}</b></div><div><span>$10 owed to them</span><b>{m.owed ? money(m.owed) : 'Nothing'}</b></div></div></> : '';
        const dev = FLEET[m.id] ? <div><span className="lbl">Devices</span><div className="xdv">{DTYPE.filter(([k]) => FLEET[m.id][k]).map(([k, t], __k) => <span key={__k}><span className="xd-q">{FLEET[m.id][k].map((s, __k) => <i key={__k} className={s} />)}</span>{t}{FLEET[m.id][k].length > 1 ? ' × ' + FLEET[m.id][k].length : ''}</span>)}</div>{FLEET[m.id].note ? <span className="small warn">{FLEET[m.id].note}</span> : ''}</div> : '';
        const sel = m.stage === 'signed' ? <div className="led"><div><span>Posters up</span><b>{m.posters}</b></div><div><span>$10 owed to them</span><b>{m.owed ? money(m.owed) : 'Nothing'}</b></div><div><span>Takes cards</span><b className="warn">Not yet</b></div></div> : '';
        const pro = ['prospect', 'talking', 'signing'].includes(m.stage) ? <div className="led"><div><span>Could finance</span><b>{m.val ? money(m.val).replace('.00', '') + ' a month' : '–'}</b></div><div><span>Came from</span><b>{SRC[m.source] || '–'}</b></div><div><span>{m.founding ? 'Seat' : 'Kind'}</span><b>{m.founding ? 'Founding, 4 of 5' : m.kind}</b></div></div> : '';
        html(pn, <><div className="pn-hd"><span className="lbl">{m.stage === 'signed' ? 'Posters only' : STGN[m.stage]}</span>{m.founding ? <span className="fst tlv">Founding</span> : ''}<button className="x" data-xclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><div className="fpr-top"><span className="fshop">{ini(m.name)}</span><div><h3>{m.name}</h3><span className="small quiet">{m.kind}{" · "}{m.city}{" · "}{m.owner === me ? 'your shop' : firstName(m.owner) + '’s shop'}</span></div></div><div className="fpl x5">{STG5.map(([k, t], i) => <span key={i} className={i < si ? 'past' : i === si ? 'now' : ''}>{t}</span>)}</div>{nextBlock}{pro}{sel}{money_}{dev}<div><span className="lbl">Visits</span>{visits.length ? visits.slice(0, 6).map((v, __k) => <div key={__k} className="hs3"><b>{v.out}{v.to ? ' → ' + STGN[v.to] : ''}{" "}<span className="quiet" style={css("font-weight:400")}>{"· "}{v.what}</span></b><span>{vDay(v.d)}{" · "}{v.who === me ? 'you' : firstName(v.who)}</span></div>) : <p className="small quiet" style={css("margin:6px 0 0")}>{lastTxt(m.last)}.</p>}</div><div><span className="lbl">Notes</span>{(X.note[m.id] || []).length ? X.note[m.id].map((n, __k) => <div key={__k} className="nt3"><p>{n.t}</p><span>{n.by}{" · just now"}</span></div>) : <p className="small quiet" style={css("margin:6px 0 0")}>No notes yet.</p>}{edit ? <div className="nt3-in"><textarea id="xnote" rows="2" placeholder="Add a note for the team" /><button className="btn" style={css("height:32px")} data-xnote={m.id}>Add</button></div> : ''}</div></div><div className="pn-ft mft">{edit ? <>{rt || ds ? '' : <button className="btn" data-xplan={m.id}>Plan a visit</button>}<button className="btn p" data-xlog={m.id}>Log a visit</button><div className="more3"><button className="btn" data-xmore="">More ▾</button><div className="mm3" hidden>{['prospect', 'talking', 'signing'].includes(m.stage) ? STG5.filter(([k]) => k !== m.stage && k !== 'transacting').map(([k, t], __k) => <button key={__k} data-xstage={`${m.id}|${k}`}>{"Move to "}{t}</button>) : ''}{isAdmin() && m.stage === 'transacting' ? <><button data-xmprop={`Raise the cap to $${[100, 120, 150, 300, 500].find(c => c > m.cap) || m.cap}|${m.id}`}>{"Raise the cap "}<span>2nd approval</span></button><button data-xmprop={`Change terms to ${m.terms === 'NET-30' ? 'NET-14' : 'NET-30'}|${m.id}`}>{"Change terms "}<span>2nd approval</span></button><button className="dz" data-xmprop={`Pause payments|${m.id}`}>{"Pause payments "}<span>2nd approval</span></button></> : ''}{isAdmin() && ['prospect', 'talking'].includes(m.stage) ? <button data-xowner={m.id}>{"Give it to "}{m.owner === 'marcus' ? 'Dana' : 'Marcus'}</button> : ''}{['prospect', 'talking'].includes(m.stage) ? <button className="dz" data-xstage={`${m.id}|closed`}>{"Not a fit "}<span>Logged</span></button> : ''}</div></div></> : <>{['transacting', 'signed', 'signing', 'talking', 'prospect'].includes(m.stage) && !RO() && TEAM[R.me].field && !rt ? <button className="btn" data-xplan={m.id}>Plan a visit</button> : ''}<span className="small quiet" style={css("margin-left:auto")}>{RO() ? 'Read-only in this view' : firstName(m.owner) + '’s shop · read-only for you'}</span></>}</div></>);
      }
      /**
       * Live: a card to another stage, saved with a line in its log. Moving to Signing also records the agreement to
       * send (the API's send-agreement, for the outside system: nothing is sent from here yet).
       */
      const stageTo = (m, k) => {
        const sign = k === 'signing';
        return cardSave(m.card, {
          stage: k
        }, [{
          text: sign ? 'Moved to Signing · agreement to send' : KMOVE[k],
          type: 'stage'
        }], sign ? () => run('merchants', 'send-agreement', {
          id: m.card.id,
          party: m.name
        }, () => renderShell()) : null, sign ? `${m.name} moved to Signing · the agreement is recorded to send` : `${m.name} moved to ${STGN[k]} · logged`);
      };
      /** The next cap a shop could be raised to, on the steps the reference offers. */
      // the next step up; live caps run past the reference's $500 (dev's are $2,000)
      const nextCap = m => [100, 120, 150, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000].find(c => c > m.cap) || m.cap;
      /* live: the shop record from the merchant app and its pipeline card; nothing is made up for what isn't recorded */
      function shopPanelLive(pn, m) {
        if (!m) {
          X.open = null;
          document.body.classList.remove('pn');
          return;
        }
        const me = R.me,
          edit = canEditM(m),
          adm = !RO() && isAdmin() && m.stage === 'transacting',
          si = STG5.findIndex(s => s[0] === m.stage),
          ds = devFix(m),
          c = m.card;
        const visits = VLOG.filter(v => v.shop === m.name),
          notes = (c?.log || []).filter(l => l[3] !== 'visit');
        const nextBlock = m.next ? <div className="fit"><b>{m.next}</b><span>{m.due != null ? m.due < 0 ? `${-m.due} days overdue` : m.due === 0 ? 'Due today' : 'Due ' + fmtWD(dayT(m.due)) : 'No date set'}{" · "}{ds ? `on ${staffFirst()}’s route today, stop ${STOPS.indexOf(ds) + 1}` : 'not on a route'}</span></div> : '';
        const money_ = m.stage === 'transacting' ? <><div><div className="w90-h"><span className="lbl">{`Cleared · ${MO().long}`}</span><b>{money(m.oct)}{" · "}{plural(m.octN, 'sale', 'sales')}</b></div><span className="small quiet">{`${money(m.sept)} in ${MO().last}`}</span></div><div className="led"><div><span>Fee</span><b>{m.fee ? m.fee.toFixed(1) + '%' + (m.founding ? ' · founding' : '') : 'None'}</b></div><div><span>Terms</span><b>{m.terms || '–'}</b></div><div><span>Cap per sale</span><b>{m.cap ? '$' + m.cap : <span className="quiet">Not read yet</span>}</b></div><div><span>Plans opened</span><b>{m.orig}</b></div><div><span>Next payout</span><b>{m.terms === 'NET-30' ? money(payOf(m).total) + ' · the monthly run' : m.terms ? 'On ' + m.terms : '–'}</b></div><div><span>$10 owed to them</span><b>{m.owed ? money(m.owed) : 'Nothing'}</b></div><div><span>Hardware</span><b>{m.hw || '–'}</b></div></div></> : '';
        const dev = FLEET[m.id] ? <div><span className="lbl">Devices</span><div className="xdv">{DTYPE.filter(([k]) => FLEET[m.id][k]).map(([k, t], __k) => <span key={__k}><span className="xd-q">{FLEET[m.id][k].map((s, __k) => <i key={__k} className={s} />)}</span>{t}{FLEET[m.id][k].length > 1 ? ' × ' + FLEET[m.id][k].length : ''}</span>)}</div>{FLEET[m.id].note ? <span className="small warn">{FLEET[m.id].note}</span> : ''}</div> : '';
        const sel = m.stage === 'signed' ? <div className="led"><div><span>Posters up</span><b>{m.posters}</b></div><div><span>$10 owed to them</span><b>{m.owed ? money(m.owed) : 'Nothing'}</b></div><div><span>Takes cards</span><b className="warn">Not yet</b></div></div> : '';
        const pro = ['prospect', 'talking', 'signing'].includes(m.stage) ? <div className="led"><div><span>Could finance</span><b>{m.val ? money(m.val).replace('.00', '') + ' a month' : '–'}</b></div><div><span>Came from</span><b>{c?.source || '–'}</b></div><div><span>Kind</span><b>{m.kind}</b></div></div> : '';
        const items = [...(edit && ['prospect', 'talking', 'signing'].includes(m.stage) ? STG5.filter(([k]) => k !== m.stage && k !== 'transacting').map(([k, t], __k) => <button key={'s' + __k} data-xstage={`${m.id}|${k}`}>{"Move to "}{t}</button>) : []), ...(adm && m.cap ? [<button key="cap" data-xmprop={`cap|${m.id}`}>{`Raise the cap to $${nextCap(m)} `}<span>2nd approval</span></button>] : []), ...(adm ? [<button key="off" className="dz" data-xmprop={`off|${m.id}`}>{"Pause payments "}<span>Logged</span></button>] : []), ...(edit && ['prospect', 'talking'].includes(m.stage) ? [<button key="nf" className="dz" data-xstage={`${m.id}|closed`}>{"Not a fit "}<span>Logged</span></button>] : [])];
        const why = RO() ? 'Read-only in this view' : !c ? 'Not in the pipeline yet, so there’s no card to log to' : firstName(m.owner) + '’s shop · read-only for you';
        html(pn, <><div className="pn-hd"><span className="lbl">{STGN[m.stage] || 'Shop'}</span>{m.founding ? <span className="fst tlv">Founding</span> : ''}<button className="x" data-xclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><div className="fpr-top"><span className="fshop">{ini(m.name)}</span><div><h3>{m.name}</h3><span className="small quiet">{[m.kind, m.city, m.owner === me ? 'your shop' : m.owner === 'none' ? 'no owner yet' : firstName(m.owner) + '’s shop'].filter(Boolean).join(' · ')}</span></div></div><div className="fpl x5">{STG5.map(([k, t], i) => <span key={i} className={i < si ? 'past' : i === si ? 'now' : ''}>{t}</span>)}</div>{nextBlock}{pro}{sel}{money_}{dev}<div><span className="lbl">Visits</span>{visits.length ? visits.slice(0, 6).map((v, __k) => <div key={__k} className="hs3"><b>{v.out}{v.to ? ' → ' + STGN[v.to] : ''}{" "}<span className="quiet" style={css("font-weight:400")}>{"· "}{v.what}</span></b><span>{vDay(v.d)}{" · "}{v.who === me ? 'you' : firstName(v.who)}</span></div>) : <p className="small quiet" style={css("margin:6px 0 0")}>No visits logged yet.</p>}</div><div><span className="lbl">Notes</span>{c?.note ? <div className="nt3"><p>{c.note}</p><span>On the card</span></div> : ''}{notes.length ? notes.slice(0, 8).map((n, __k) => <div key={__k} className="nt3"><p>{n[1]}</p><span>{n[2] || 'Someone'}{" · "}{fmtD(n[0])}</span></div>) : c?.note ? '' : <p className="small quiet" style={css("margin:6px 0 0")}>No notes yet.</p>}{edit ? <div className="nt3-in"><textarea id="xnote" rows="2" placeholder="Add a note for the team" /><button className="btn" style={css("height:32px")} data-xnote={m.id}>Add</button></div> : ''}</div></div><div className="pn-ft mft">{edit ? <button className="btn p" data-xlog={m.id}>Log a visit</button> : <span className="small quiet" style={css("margin-left:auto")}>{why}</span>}{items.length ? <div className="more3"><button className="btn" data-xmore="">More ▾</button><div className="mm3" hidden>{items}</div></div> : ''}</div></>);
      }
      function addPanel(pn) {
        const A = X.add,
          who = isAdmin() ? A.owner : R.me;
        html(pn, <><div className="pn-hd"><span className="lbl">New prospect</span><button className="x" data-xclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><h3>Add a prospect</h3><label><span className="lbl">Shop name</span><input id="xan" className="vin" defaultValue={A.name || ''} placeholder="Rancho Cucamonga Auto" /></label><div className="xa2"><label><span className="lbl">Kind of shop</span><input id="xak" className="vin" defaultValue={A.kind || ''} placeholder="Auto repair" /></label><label><span className="lbl">City</span><select id="xac" className="vin" defaultValue={A.city}>{Object.keys(GEO).map((c, __k) => <option key={__k} {...picked(A.city === c)}>{c}</option>)}</select></label></div><div className="xa-f"><span className="lbl">Came from</span><div className="seg sm" role="group">{Object.entries(SRC).map(([k, t], __k) => <button key={__k} data-xasrc={k} aria-pressed={A.source === k}>{t.replace('Next to a poster shop', 'Poster shop')}</button>)}</div></div>{isAdmin() ? <div className="xa-f"><span className="lbl">Whose lead</span><div className="seg sm" role="group">{Object.entries(TEAM).filter(([, t]) => t.field).map(([k, t], __k) => <button key={__k} data-xaown={k} aria-pressed={who === k}>{k === R.me ? 'Me' : t.n}</button>)}</div></div> : <p className="small quiet" style={css("margin:0")}>It’ll be your lead.</p>}<div className="xa2"><label><span className="lbl">Next step</span><input id="xanx" className="vin" defaultValue="Walk in" /></label><label><span className="lbl">Could finance a month</span><input id="xav" className="vin" inputMode="numeric" placeholder="$5,000" /></label></div>{A.from ? <p className="small quiet" style={css("margin:0")}>From a shop enquiry. It’s marked added there.</p> : ''}</div><div className="pn-ft"><span className="small quiet" style={css("margin-right:auto")}>Lands in Field’s Needs a visit</span><button className="btn" data-xclose="">Cancel</button><button className="btn p" data-xasave="">Add the prospect</button></div></>);
      }

      /* ── render + events ── */
      function render() {
        document.querySelectorAll('.gtabs [data-xtab]').forEach(b => b.setAttribute('aria-current', b.dataset.xtab === X.tab ? 'page' : 'false'));
        renderHdr();
        renderMe();
        ({
          overview: renderOverview,
          pipeline: renderPipeline,
          partners: renderPartners,
          payouts: renderPayouts,
          devices: renderDevices
        })[X.tab]();
        renderPanel();
        fmMountAll();
        requestAnimationFrame(fmLayoutDrawn);
      }
      const closeX = () => {
        X.open = null;
        X.add = null;
        R.panel = null;
      };
      document.addEventListener('click', e => {
        if (PAGE !== 'merchants') return;
        if (e.target.id === 'mscrim') {
          closeX();
          return render();
        }
        const t = e.target.closest('button,a,tr[data-xopen],input,select,[data-xcity]');
        if (!t) {
          const mm = document.querySelector('.mm3');
          if (mm) mm.hidden = true;
          return;
        }
        const d = t.dataset;
        if (d.xtab) {
          X.tab = d.xtab;
          if (d.xpf) {
            X.pf = d.xpf;
            X.ppage = 0;
          }
          closeX();
          render();
          setHash();
          if (d.xjump) {
            const el = document.getElementById(d.xjump);
            el && el.scrollIntoView({
              behavior: 'smooth',
              block: 'start'
            });
          } else window.scrollTo({
            top: 0
          });
          return;
        }
        if (d.xpf) {
          X.pf = d.xpf;
          X.ppage = 0;
          return render();
        }
        if (d.xppage) {
          X.ppage = (X.ppage || 0) + +d.xppage;
          return render();
        }
        if (d.ktab) {
          if (X.kst === d.ktab) return;
          const order = KCOL.map(c => c[0]),
            dir = order.indexOf(d.ktab) > order.indexOf(X.kst) ? 1 : -1;
          X.kst = d.ktab;
          document.querySelectorAll('#kbtabs .kb-tab').forEach(b => {
            const on = b.dataset.ktab === X.kst;
            b.classList.toggle('on', on);
            b.setAttribute('aria-selected', on);
          });
          document.querySelectorAll('#kb .kb-c').forEach(c => c.classList.toggle('on', c.dataset.kcol === X.kst));
          const col = document.querySelector(`#kb .kb-c.on`);
          if (col && col.animate && !matchMedia('(prefers-reduced-motion:reduce)').matches) col.animate([{
            opacity: 0,
            transform: `translateX(${dir * 24}px)`
          }, {
            opacity: 1,
            transform: 'none'
          }], {
            duration: 220,
            easing: 'cubic-bezier(.2,.8,.2,1)'
          });
          return;
        }
        if (d.xsigned !== undefined) {
          X.allSigned = !X.allSigned;
          return render();
        }
        if (d.xapprove && LV) return;
        if (d.xapprove === 'rosas-pay' && S.waiting.some(w => w.id === 'payout')) return openItem('payout');
        if (d.xapprove) {
          X.approvals.push(d.xapprove);
          toast('Approved · Rosa’s $412.60 goes out tomorrow · logged in Records');
          return render();
        }
        if (d.xundo !== undefined) {
          const u = X.undo;
          X.undo = null;
          document.getElementById('toast')?.classList.remove('on');
          if (u) u();
          return;
        }
        if (d.xcity !== undefined) {
          X.city = d.xcity && X.city !== d.xcity ? d.xcity : null;
          return render();
        }
        if (d.xopen) {
          if (TOT()) return toast('Shop records stay closed in this view · co-op totals only');
          closeX();
          X.open = d.xopen;
          return render();
        }
        if (t.hasAttribute('data-xclose') || t.hasAttribute('data-fclose')) {
          e.stopImmediatePropagation();
          const back = R.panel && X.open;
          R.panel = null;
          X.add = null;
          if (!back) X.open = null;
          return render();
        }
        if (t.hasAttribute('data-xmore')) {
          const mm = t.parentElement.querySelector('.mm3');
          mm.hidden = !mm.hidden;
          return;
        }
        if (d.xplan && LV) return;
        if (d.xplan) {
          const m = MSBY[d.xplan];
          ensureLead(m);
          const r = leadToRoute(m.name, canEditM(m) ? null : R.me);
          toast(`${m.name} added to ${r.who === R.me ? 'your' : TEAM[r.who].n + '’s'} route tomorrow`, {
            label: 'Open in Field',
            fn: () => {
              R.sel = r.id;
              F._tab = 'plan';
              CC.go('field');
            }
          });
          return render();
        }
        if (d.xlog && LV && !MSBY[d.xlog]?.card) return;
        if (d.xlog) {
          const m = MSBY[d.xlog];
          ensureLead(m);
          R.panel = {
            k: 'log',
            shop: m.name,
            out: null
          };
          return render();
        }
        if (d.xnote && LV) {
          const v = ((document.getElementById('xnote') || {}).value || '').trim(),
            m = MSBY[d.xnote];
          if (!v || !m?.card) return;
          return cardSave(m.card, {}, [{
            text: v,
            type: 'note'
          }], null, 'Note added · logged');
        }
        if (d.xnote) {
          const v = (document.getElementById('xnote') || {}).value.trim();
          if (!v) return;
          (X.note[d.xnote] ||= []).push({
            by: TEAM[R.me].n,
            t: v
          });
          return render();
        }
        if (d.xstage && LV) {
          const [id, k] = d.xstage.split('|'),
            m = MSBY[id];
          if (!m?.card) return;
          X.open = null;
          if (k === 'closed') return run('merchants', 'card-remove', {
            id: m.card.id,
            reason: 'Not a fit'
          }, () => {
            toast(`${m.name} marked not a fit · logged`);
            renderShell();
          });
          return stageTo(m, k);
        }
        if (d.xstage) {
          const [id, k] = d.xstage.split('|'),
            m = MSBY[id];
          m.stage = k === 'closed' ? 'closed' : k;
          const l = LEADS.find(x => x.shop === m.name);
          if (l) l.stage = k;
          toast(k === 'closed' ? `${m.name} marked not a fit · logged` : `${m.name} moved to ${STGN[k]}`);
          if (k === 'closed') X.open = null;
          return render();
        }
        if (d.xowner && LV) return;
        if (d.xowner) {
          const m = MSBY[d.xowner];
          m.owner = m.owner === 'marcus' ? 'dana' : 'marcus';
          const l = LEADS.find(x => x.shop === m.name);
          if (l) l.owner = m.owner;
          toast(`${m.name} is now ${TEAM[m.owner].n}’s lead`);
          return render();
        }
        if (d.xmprop && LV) {
          // a cap needs a second person (it's prepared for the Ops Safe); pausing payments is recorded for the merchant app
          const [k, id] = d.xmprop.split('|'),
            m = MSBY[id];
          if (k === 'cap') return run('merchants', 'cap', {
            id,
            cap: nextCap(m)
          }, () => renderShell());
          if (k === 'off') return run('merchants', 'off', {
            id,
            reason: ''
          }, () => {
            toast(`Recorded · pausing ${m.name}’s payments isn’t sent to the merchant app yet`);
            renderShell();
          });
          return;
        }
        if (d.xmprop) {
          const [what, id] = d.xmprop.split('|');
          X.approvals.push(what + '|' + id);
          toast(<><b>{what}</b>{" proposed · it needs a second person in Needs you"}</>);
          return render();
        }
        if (d.xprop && LV) return run('merchants', 'run', {
          total: runTotal(),
          shops: runLines().length + owedOnly().length
        }, () => renderShell());
        if (d.xprop) {
          X.approvals.push(d.xprop);
          toast('Monthly run proposed · Dana approves it in Needs you');
          return render();
        }
        if ((d.xreveal || d.xenq) && LV) return;
        if (d.xreveal) {
          (X.reveal ||= new Set()).add(d.xreveal);
          toast('Shown · logged in Records');
          return render();
        }
        if (d.xenq) {
          const [a, id] = d.xenq.split('|'),
            en = ENQ.find(x => x.id === id);
          if (a === 'add') {
            X.add = {
              name: en.name,
              kind: en.kind,
              city: en.city,
              source: 'enquiry',
              owner: R.me === 'kai' ? 'marcus' : R.me,
              from: id
            };
            return render();
          }
          if (a === 'reply') {
            X.enqSt[id] = 'replied';
            toast('Reply drafted in your email · marked replied');
            return render();
          }
          if (a === 'no') {
            X.enqSt[id] = 'notfit';
            toast('Marked not a fit · logged');
            return render();
          }
        }
        if (t.hasAttribute('data-xadd')) {
          X.add = {
            source: 'walkin',
            owner: isAdmin() && !LV ? 'marcus' : R.me,
            city: 'Redlands'
          };
          return render();
        }
        if (d.xasrc) {
          X.add.source = d.xasrc;
          ['name', 'kind'].forEach((k, i) => X.add[k] = document.getElementById(['xan', 'xak'][i]).value);
          return renderPanel();
        }
        if (d.xaown) {
          X.add.owner = d.xaown;
          ['name', 'kind'].forEach((k, i) => X.add[k] = document.getElementById(['xan', 'xak'][i]).value);
          return renderPanel();
        }
        if (t.hasAttribute('data-xasave') && LV) {
          const A = X.add,
            name = document.getElementById('xan').value.trim();
          if (!name) {
            toast('Add the shop’s name');
            return;
          }
          const owner = isAdmin() ? A.owner : R.me,
            on = owner && owner !== 'none' ? TEAM[owner] : null;
          X.add = null;
          return cardSave({
            id: 'p' + Date.now().toString(36),
            name,
            kind: document.getElementById('xak').value.trim() || 'Shop',
            city: document.getElementById('xac').value,
            stage: 'prospect',
            owner: on ? on.n.split(' ')[0] : null,
            val: +document.getElementById('xav').value.replace(/\D/g, '') || null,
            next: document.getElementById('xanx').value.trim() || 'Walk in',
            due: null,
            source: SRC_OUT[A.source] || ''
          }, {}, [{
            text: 'Added to the board',
            type: 'edit'
          }], null, `${name} added · ${owner === R.me ? 'your' : (on ? on.n : 'nobody') + '’s'} lead`);
        }
        if (t.hasAttribute('data-xasave')) {
          const A = X.add,
            name = document.getElementById('xan').value.trim();
          if (!name) {
            toast('Add the shop’s name');
            return;
          }
          const m = {
            id: 'p-' + hashN(name + Date.now()),
            name,
            kind: document.getElementById('xak').value.trim() || 'Shop',
            city: document.getElementById('xac').value,
            stage: 'prospect',
            val: +document.getElementById('xav').value.replace(/\D/g, '') || 0,
            owner: isAdmin() ? A.owner : R.me,
            next: document.getElementById('xanx').value || 'Walk in',
            due: null,
            last: null,
            source: A.source,
            posters: 0
          };
          MS.push(m);
          MSBY[m.id] = m;
          ensureLead(m);
          if (A.from) X.enqSt[A.from] = 'added';
          X.add = null;
          X.open = m.id;
          toast(`${name} added · ${m.owner === R.me ? 'your' : TEAM[m.owner].n + '’s'} lead`);
          return render();
        }
        if (d.xgo || d.fgo) return goOut(t);
      });
      document.addEventListener('input', e => {
        if (PAGE !== 'merchants') return;
        if (e.target.id === 'xbq') {
          X.bq = e.target.value;
          renderPipeline();
          const i = document.getElementById('xbq');
          i.focus();
          i.setSelectionRange(i.value.length, i.value.length);
        }
      });
      document.addEventListener('keydown', e => {
        if (!LIVE() || PAGE !== 'merchants') return;
        if (e.key === 'Escape' && (X.open || X.add || R.panel)) {
          closeX();
          render();
        }
      });

      /* ══ Pipeline drag: the tile lifts into a ghost that follows the pointer, its slot travels through the columns and the tiles around it slide
         out of the way. Press and drag with a mouse; touch and hold on a phone. Reps can only pick up their own leads (only those carry data-kt). ══ */
      (() => {
        let D = null;
        const EASE = 'cubic-bezier(.2,.8,.2,1)';
        const tiles = () => [...document.querySelectorAll('#kb .kt')];
        const flip = fn => {
          const before = new Map(tiles().map(el => [el, el.getBoundingClientRect()]));
          fn();
          tiles().forEach(el => {
            if (D && el === D.el) return;
            const a = before.get(el);
            if (!a) return;
            const b = el.getBoundingClientRect(),
              dx = a.left - b.left,
              dy = a.top - b.top;
            if (dx || dy) el.animate([{
              transform: `translate(${dx}px,${dy}px)`
            }, {
              transform: 'none'
            }], {
              duration: 220,
              easing: EASE
            });
          });
        };
        function start() {
          const r = D.el.getBoundingClientRect();
          D.ox = D.x - r.left;
          D.oy = D.y - r.top;
          D.from = {
            col: D.el.closest('[data-kcol]').dataset.kcol,
            next: D.el.nextElementSibling
          };
          const g = D.el.cloneNode(true);
          g.classList.add('kt-ghost');
          g.removeAttribute('data-kt');
          g.removeAttribute('data-xopen');
          Object.assign(g.style, {
            width: r.width + 'px',
            height: r.height + 'px',
            left: r.left + 'px',
            top: r.top + 'px'
          });
          document.body.appendChild(g);
          D.g = g;
          D.el.classList.add('kt-ph');
          document.body.classList.add('kb-drag');
          D.on = true;
          g.animate([{
            transform: 'none'
          }, {
            transform: 'rotate(1.4deg) scale(1.03)'
          }], {
            duration: 160,
            easing: EASE,
            fill: 'forwards'
          });
          try {
            navigator.vibrate && navigator.vibrate(12);
          } catch (_) {}
          D.raf = requestAnimationFrame(tick);
        }
        function place() {
          D.g.style.translate = `${D.x - D.ox - parseFloat(D.g.style.left)}px ${D.y - D.oy - parseFloat(D.g.style.top)}px`;
          const hit = document.elementFromPoint(D.x, D.y),
            tab = hit && hit.closest('#kbtabs [data-ktab]'),
            col = !tab && hit && hit.closest('#kb [data-kcol]');
          document.querySelectorAll('#kbtabs .kb-tab.over').forEach(c => {
            if (c !== tab) c.classList.remove('over');
          });
          D.tab = tab ? tab.dataset.ktab : null;
          D.g.classList.toggle('mini', !!tab);
          if (tab) {
            tab.classList.add('over');
            return;
          }
          document.querySelectorAll('#kb .kb-c.over').forEach(c => {
            if (c !== col) c.classList.remove('over');
          });
          if (!col) return;
          col.classList.add('over');
          const body = col.querySelector('.kb-b'),
            list = [...body.querySelectorAll('.kt')].filter(el => el !== D.el);
          const before = list.find(el => {
            const b = el.getBoundingClientRect();
            return D.y < b.top + b.height / 2;
          }) || body.querySelector('.kb-more, .kb-e');
          if (D.el.parentNode === body && (before ? D.el.nextElementSibling === before : !D.el.nextElementSibling)) return;
          flip(() => {
            before ? body.insertBefore(D.el, before) : body.appendChild(D.el);
          });
          document.querySelectorAll('#kb .kb-b').forEach(b => b.classList.toggle('has', !!b.querySelector('.kt')));
        }
        function tick() {
          if (!D || !D.on) return;
          const kb = document.getElementById('kb'),
            br = kb.getBoundingClientRect(),
            edge = 48;
          if (D.x < br.left + edge) kb.scrollLeft -= 12;else if (D.x > br.right - edge) kb.scrollLeft += 12;
          const moved = Math.abs(D.y - D.sy) > 24;
          if (moved && D.y < 80) scrollBy(0, -10);else if (moved && D.y > innerHeight - 64) scrollBy(0, 10);
          place();
          D.raf = requestAnimationFrame(tick);
        }
        const stop = e => {
          e.stopPropagation();
          e.preventDefault();
        };
        function end(cancel) {
          if (!D) return;
          clearTimeout(D.t);
          const d = D;
          D = null;
          removeEventListener('pointermove', move);
          removeEventListener('pointerup', up);
          removeEventListener('pointercancel', cc);
          removeEventListener('keydown', esc);
          if (!d.on) return;
          cancelAnimationFrame(d.raf);
          document.addEventListener('click', stop, true);
          setTimeout(() => document.removeEventListener('click', stop, true), 0);
          document.body.classList.remove('kb-drag');
          document.querySelectorAll('#kb .kb-c.over, #kbtabs .kb-tab.over').forEach(c => c.classList.remove('over'));
          if (!cancel && d.tab) {
            const m = MSBY[d.el.dataset.kt],
              tabEl = document.querySelector(`#kbtabs [data-ktab="${d.tab}"]`);
            if (d.tab === m.stage) cancel = true;else {
              const tr = tabEl.getBoundingClientRect(),
                gr = d.g.getBoundingClientRect(),
                tx = tr.left + tr.width / 2 - (gr.left + gr.width / 2),
                ty = tr.top + tr.height / 2 - (gr.top + gr.height / 2);
              const cur = d.g.style.translate.split(' ').map(parseFloat);
              const an = d.g.animate([{
                transform: 'rotate(1.4deg) scale(1.03)',
                opacity: 1
              }, {
                transform: `translate(${tx}px,${ty}px) scale(.18)`,
                opacity: 0
              }], {
                duration: 260,
                easing: EASE,
                fill: 'forwards'
              });
              an.onfinish = () => {
                d.g.remove();
                const prev = {
                  stage: m.stage,
                  seq: X.seq ? {
                    ...X.seq
                  } : null
                };
                X.seq = {};
                document.querySelectorAll('#kb .kt').forEach((el, i) => {
                  X.seq[el.dataset.xopen] = i;
                });
                X.seq[m.id] = -1;
                moved(m, d.tab, prev);
                const t2 = document.querySelector(`#kbtabs [data-ktab="${d.tab}"]`);
                t2 && t2.animate([{
                  transform: 'scale(1.08)'
                }, {
                  transform: 'none'
                }], {
                  duration: 300,
                  easing: EASE
                });
              };
              return;
            }
          }
          if (cancel) {
            const body = document.querySelector(`#kb [data-kcol="${d.from.col}"] .kb-b`);
            flip(() => {
              d.from.next && d.from.next.parentNode === body ? body.insertBefore(d.el, d.from.next) : body.appendChild(d.el);
            });
          }
          const r = d.el.getBoundingClientRect(),
            gx = r.left - parseFloat(d.g.style.left),
            gy = r.top - parseFloat(d.g.style.top);
          const an = d.g.animate([{
            translate: d.g.style.translate,
            transform: 'rotate(1.4deg) scale(1.03)'
          }, {
            translate: `${gx}px ${gy}px`,
            transform: 'none'
          }], {
            duration: 200,
            easing: EASE,
            fill: 'forwards'
          });
          an.onfinish = () => {
            d.g.remove();
            d.el.classList.remove('kt-ph');
            if (cancel) return;
            const m = MSBY[d.el.dataset.kt],
              to = d.el.closest('[data-kcol]').dataset.kcol;
            if (!m) return;
            const prev = {
              stage: m.stage,
              seq: X.seq ? {
                ...X.seq
              } : null
            };
            X.seq = {};
            document.querySelectorAll('#kb .kt').forEach((el, i) => {
              X.seq[el.dataset.xopen] = i;
            });
            if (prev.stage === to) {
              render();
              return;
            }
            moved(m, to, prev);
          };
        }
        function moved(m, to, prev) {
          // live: the card's new stage is saved with a line in its log, and the board is built again from the server
          if (LV) return m.card ? stageTo(m, to) : render();
          m.stage = to;
          if (to === 'talking' && m.next === 'Walk in') m.next = 'Second visit';
          (X.note[m.id] ||= []).push({
            by: TEAM[R.me].n,
            t: KMOVE[to]
          });
          X.flash = m.id;
          X.undo = () => {
            m.stage = prev.stage;
            X.seq = prev.seq;
            X.note[m.id].pop();
            X.flash = m.id;
            render();
            setTimeout(() => {
              X.flash = null;
            }, 900);
          };
          render();
          setTimeout(() => {
            X.flash = null;
          }, 900);
          toast(`${m.name} · ${KMOVE[to].toLowerCase()} · logged`, {
            label: 'Undo',
            fn: () => {
              const u = X.undo;
              X.undo = null;
              if (u) u();
            }
          });
        }
        function move(e) {
          if (!D) return;
          D.x = e.clientX;
          D.y = e.clientY;
          if (!D.on) {
            const far = Math.hypot(D.x - D.sx, D.y - D.sy) > (D.touch ? 8 : 5);
            if (far) {
              if (D.touch) return end(true);
              start();
            }
            return;
          }
          e.preventDefault();
        }
        const up = () => end(false),
          cc = () => end(true),
          esc = e => {
            if (e.key === 'Escape') end(true);
          };
        document.addEventListener('touchmove', e => {
          if (D && D.on) e.preventDefault();
        }, {
          passive: false
        });
        document.addEventListener('pointerdown', e => {
          const el = e.target.closest('#kb .kt[data-kt]');
          if (!el || e.button > 0 || RO()) return;
          D = {
            el,
            sx: e.clientX,
            sy: e.clientY,
            x: e.clientX,
            y: e.clientY,
            touch: e.pointerType !== 'mouse',
            on: false
          };
          if (D.touch) D.t = setTimeout(() => {
            if (D && !D.on) start();
          }, 320);
          addEventListener('pointermove', move);
          addEventListener('pointerup', up);
          addEventListener('pointercancel', cc);
          addEventListener('keydown', esc);
        });
      })();
      let rsT;
      addEventListener('resize', () => {
        if (!LIVE() || PAGE !== 'merchants') return;
        requestAnimationFrame(fmLayoutDrawn);
        clearTimeout(rsT);
        rsT = setTimeout(() => {
          if (X.tab !== 'overview' || !X.asp) return;
          const sz = corrSize();
          if (Math.abs(sz.w / sz.h - X.asp) / X.asp > .04) render();
        }, 140);
      });
      return {
        render,
        tab: () => X.tab,
        setTab(t) {
          X.tab = t;
          closeX();
        },
        close() {
          closeX();
          X.add = null;
        },
        openShop(name) {
          const m = MS.find(x => x.name === name || x.id === name);
          if (m) {
            closeX();
            X.open = m.id;
          }
        }
      };
    })();

    /* one render for whichever page is showing; the shared Field modules call it */
    function render() {
      if (!LIVE()) return;
      W.classList.toggle('ro', RO());
      W.classList.toggle('tot', TOT());
      if (PAGE === 'merchants') XAPI.render();else renderField();
      if (TOT()) CC.scrub(W);
    }
    return {
      render,
      tab: r => r === 'field' ? F._tab : XAPI.tab(),
      setField(t) {
        F._tab = t;
        closeP();
      },
      setMerch(t) {
        XAPI.setTab(t);
      },
      openShop: n => XAPI.openShop(n),
      close() {
        closeP();
        XAPI.close();
      }
    };
  })(DOCP);
  const SHELL = {
    field: <><div className="hdr stack" id="hdr" /><nav className="gtabs" aria-label="Field views"><button data-ftab="today">Today</button><button data-ftab="plan">Plan</button><button data-ftab="visits">Visits</button><button data-ftab="posters">Posters</button><button data-ftab="placement">Placement</button></nav><div id="fv" /></>,
    merchants: <><div className="hdr stack" id="hdr" /><nav className="gtabs" aria-label="Merchants views"><button data-xtab="overview">Overview</button><button data-xtab="pipeline">Pipeline</button><button data-xtab="partners">Partners</button><button data-xtab="payouts">Payouts</button><button data-xtab="devices">Devices</button></nav><div id="mv" /></>
  };
  // p: a tab (old pane names work too), shop:<name> to open a shop record, enquiries to land on the shop enquiries
  function setTab(r, p) {
    if (!p) return;
    const i = String(p).indexOf(':'),
      k = i < 0 ? p : p.slice(0, i),
      x = i < 0 ? '' : p.slice(i + 1);
    if (r === 'field') {
      if (MAPF[k]) API.setField(MAPF[k]);
      return;
    }
    if (k === 'shop') {
      API.openShop(x);
      return;
    }
    if (MAPX[k]) {
      API.setMerch(MAPX[k]);
      if (k === 'enquiries') pend = 'menq';
    }
  }
  function mount(r) {
    // the slot is the shell's: the host goes inside it
    if (!into('fm-slot')) return;
    // live, the pages share data (Field's follow-ups are the pipeline's, Merchants' fixes are on the route): the one
    // shown loads the other's section too, once, and the shell draws again, which builds the page again with it
    const other = r === 'field' ? 'merchants' : 'field';
    if (LV && LIVE_APP && needsData(other) && !OTHER.has(other)) {
      OTHER.add(other);
      loadSection(other).then(
        () => {
          OTHER.delete(other);
          if (CC.route() === r) renderShell();
        },
        () => undefined,
      );
    }
    if (PAGE !== r || !SH.firstChild) {
      API.close();
      W.classList.remove('pn', 'kb-drag');
      SR.querySelectorAll('#fpanel,#fscrim,#mpanel,#mscrim').forEach(e => e.remove());
      PAGE = r;
      html(SH, SHELL[r]);
    }
    API.render();
    if (pend) {
      const id = pend;
      pend = null;
      requestAnimationFrame(() => {
        const el = SR.getElementById(id);
        if (!el) return;
        window.scrollTo({
          top: window.scrollY + el.getBoundingClientRect().top - barH() - 12,
          behavior: 'smooth'
        });
      });
    }
  }
  function unmount() {
    if (host.isConnected) return;
    if (W.classList.contains('pn') || W.classList.contains('kb-drag')) {
      API.close();
      W.classList.remove('pn', 'kb-drag');
    }
  }
  /* The app's shell still carries the old Field and Merchants pages' click handlers, and reads a click's real target
     (startup.tsx's evTarget), so a click here on a name they share (data-fscan, data-xgo, data-vkind …) would run the
     old page's flow too. The reference's shell never sees them (the click is retargeted to the host): nor does this one. */
  const SHARED = ['fadd', 'fclose', 'fcode', 'fdev', 'fout', 'fscan', 'fskip', 'vkind', 'xadd', 'xgo', 'xsigned'].map(k => `[data-${k}]`).join(',');
  SR.addEventListener('click', e => {
    const t = e.composedPath()[0];
    if (t && t.closest && t.closest(SHARED)) e.stopPropagation();
  });
  return {
    mount,
    unmount,
    setTab,
    // the tab on the page shown, kept when the module is built again
    tab: () => API.tab(PAGE),
    host
  };
}
registerPage(['field', 'merchants'], 'fm-slot', makeFieldMerchants, { live: true });
