// @ts-nocheck: ported from the redesign's SHOP2 module (design/command-center-ui) with scripts/port/module.cjs; its data is its own.
import { Fragment } from 'react';
import { api } from '../live/api';
import { LIVE as LIVE_APP, REAL } from '../live/env';
import { reloadSection } from '../live/sections';
import { attrs, css, hasHtml, html } from '../runtime/dom';
import { addPhotos, openCatFlow } from './catalog';
import { CC } from './cc';
import { openCostFlow } from './costing';
import { LOG, S, SS } from './data';
import { registerPage, shadowHost } from './pageHost';
import { openSFlow, prOf } from './shop';
import { render as renderShell, toast } from './shell';
import { shopLive } from './shopLive';

/*
 * Shop (design/command-center-ui, the SHOP2 module): what's for sale, what each product costs to make (built
 * from materials or given one cost), the materials library with its suppliers and reorder points, finished stock
 * and batches, and orders with their per-order costs and pickups, in five tabs. It lives in its own shadow root
 * (pageHost.tsx) with the g, fm, n, bx, vx and sx sheets adopted. The reference's module body runs against a
 * stand-in `document` (DOCP) that points into the shadow root, as it does there. Links out go through CC.go.
 *
 * Live (REAL), its datasets are shopLive()'s (`LV`: the module uses L for its own lists): the catalog with Command's
 * costs, the inputs library, suppliers, buys on order, batches and the Stripe orders. The page's own actions go
 * through the API (POST /actions/shop/<kind>), and every flow the old Shop page had (catalog.tsx's store edits
 * and photos, costing.tsx's recipe overrides, counts and write-offs, shop.tsx's shelf, order and pre-order
 * flows) opens from the new panels, live only: the prototype preview draws the reference as it is.
 */

/** The page's skeleton: the reference template's markup, drawn once into the shadow root. */
function skeleton() {
  return <div className="gw" id="sw"><div className="hdr stack" id="hdr" /><nav className="gtabs" aria-label="Shop views"><button data-stab="overview">Overview</button><button data-stab="products">Products</button><button data-stab="materials">Materials</button><button data-stab="inventory">Inventory</button><button data-stab="orders">Orders</button></nav><div id="sv" /></div>;
}
function makeShop() {
  const { host, R: SR, W, into } = shadowHost('shop', skeleton());
  const LV = REAL ? shopLive() : null;
  const LIVE = () => host.isConnected && CC.route() === 'shop';
  const RO = () => CC.viewing() && CC.level('shop') < 3;
  const TOT = () => CC.viewing() && CC.level('shop') === 1;
  const meKey = () => {
    // live, you are you: what you may do is your level on Shop (RO), the API checks it again
    if (LV) return LV.ME;
    const v = S.view;
    if (!v) return 'kai';
    return {
      K: 'kai',
      DR: 'dana',
      ML: 'marcus'
    }[v.person] || {
      admin: 'kai',
      field: 'marcus'
    }[v.g] || 'viewer';
  };
  const ROOT_EV = new Set(['click', 'input', 'change']);
  const DOCP = {
    getElementById: id => SR.getElementById(id),
    querySelector: q => SR.querySelector(q) || (q === '.modal' ? document.querySelector(q) : null),
    querySelectorAll: q => SR.querySelectorAll(q),
    createElement: t => document.createElement(t),
    get body() {
      return W;
    },
    get documentElement() {
      return document.documentElement;
    },
    addEventListener: (t, f, o) => (ROOT_EV.has(t) ? SR : document).addEventListener(t, f, o)
  };
  function goOut(path) {
    const i = path.indexOf('/'),
      r = i < 0 ? path : path.slice(0, i),
      sub = i < 0 ? undefined : path.slice(i + 1);
    if (sub && sub.includes(':')) {
      CC.go(r);
      return CC.go(r, sub);
    } /* a record: land on the page first, then open it */
    return CC.go(r, sub);
  }
  let API = null;
  function setHash() {
    if (!LIVE()) return;
    const t = API.tab();
    try {
      history.replaceState(null, '', '#shop' + (t === 'overview' ? '' : '/' + t));
    } catch (e) {}
  }
  API = (document => {
    /* ══ Shop data — products built from materials, the materials library, suppliers, batches and orders ═════════════
       Demo "today" is Wed 21 Oct 2026, 14:00. The shop opened 1 Sep. Costs use the average of what's on hand; the last price
       paid shows beside it. Materials kept on hand are used up when a batch is made; made-to-order costs are charged per piece. */
    const DAY = 864e5,
      TODAY = LV ? LV.TODAY : Date.UTC(2026, 9, 21),
      NOW = LV ? LV.NOW : TODAY + 14 * 3600e3;
    const D = (m, d, y = 2026) => Date.UTC(y, m - 1, d);
    const H = (m, d, h, mi = 0) => Date.UTC(2026, m - 1, d, h, mi);
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fmtD = t => `${new Date(t).getUTCDate()} ${MON[new Date(t).getUTCMonth()]}`;
    const WD = t => new Date(t).toLocaleDateString('en-US', {
      weekday: 'short',
      timeZone: 'UTC'
    });
    const hm = t => new Date(t).toISOString().slice(11, 16);
    const leaf = t => <span className="leaf"><span>{WD(t)}</span><b>{new Date(t).getUTCDate()}</b><span>{MON[new Date(t).getUTCMonth()]}</span></span>;
    const ago = t => {
      const m = Math.round((NOW - t) / 6e4);
      if (m < 60) return `${Math.max(1, m)} min ago`;
      const h = Math.round(m / 60);
      if (h < 24) return `${h} h ago`;
      const d = Math.round(h / 24);
      return d === 1 ? 'yesterday' : `${d} days ago`;
    };
    const money = n => (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    const money0 = n => '$' + Math.round(n).toLocaleString('en-US');
    const pct = (a, b, d = 0) => (b ? a / b * 100 : 0).toFixed(d) + '%';
    const int = n => Math.round(n).toLocaleString('en-US');
    const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
    const WEEKS = LV ? LV.WEEKS : ['1 Sep', '8 Sep', '15 Sep', '22 Sep', '29 Sep', '6 Oct', '13 Oct', '20 Oct'];
    const TARGET = LV ? LV.TARGET : 0.60; /* the shop-wide margin the co-op aims for */
    const PPL = LV ? LV.PPL : {
      kai: {
        n: 'Kai',
        ini: 'K',
        staff: true
      },
      dana: {
        n: 'Dana Ruiz',
        ini: 'DR',
        staff: true
      },
      marcus: {
        n: 'Marcus Lee',
        ini: 'ML',
        staff: true
      },
      viewer: {
        n: 'Viewer',
        ini: 'VW'
      }
    };

    /* who sells us what */
    const SUPPLIERS = LV ? LV.SUPPLIERS : [{
      id: 'wcb',
      n: 'Westcoast Blanks',
      city: 'Los Angeles',
      what: 'Tees, long sleeves and turtlenecks',
      lead: 7,
      terms: 'Net 15',
      min: '24 per colour',
      breaks: [[24, 0], [72, .04], [144, .08]],
      last: D(10, 14)
    }, {
      id: 'hws',
      n: 'Heavyweight Supply',
      city: 'Commerce',
      what: 'Fleece hoodies',
      lead: 14,
      terms: 'Paid upfront',
      min: '60',
      breaks: [[60, 0], [120, .05]],
      last: D(10, 2)
    }, {
      id: 'isp',
      n: 'Inland Screen Print',
      city: 'San Bernardino',
      what: 'Screen and photo printing, per piece',
      lead: 5,
      terms: 'Net 7',
      min: '12 per run',
      breaks: [[12, 0], [48, .06], [96, .10]],
      last: D(10, 14)
    }, {
      id: 'sth',
      n: 'Stitch House',
      city: 'Riverside',
      what: 'Embroidery, per piece',
      lead: 6,
      terms: 'Net 7',
      min: '12 per run',
      breaks: [[12, 0], [36, .05]],
      last: D(9, 24)
    }, {
      id: 'pwc',
      n: 'Patchworks Co.',
      city: 'Online',
      what: 'Woven patches',
      lead: 21,
      terms: 'Paid upfront',
      min: '200',
      breaks: [[200, 0], [500, .12]],
      last: D(8, 28)
    }, {
      id: 'rlc',
      n: 'Redlands Label Co.',
      city: 'Redlands',
      what: 'Neck labels and hem tags',
      lead: 10,
      terms: 'Net 15',
      min: '500',
      breaks: [[500, 0], [1000, .10]],
      last: D(8, 22)
    }, {
      id: 'pac',
      n: 'Pacific Packaging',
      city: 'Ontario',
      what: 'Mailers, bags, tissue and labels',
      lead: 4,
      terms: 'Card',
      min: 'None',
      breaks: [[100, 0], [500, .07]],
      last: D(10, 9)
    }];
    const SUP = LV ? LV.SUP : Object.fromEntries(SUPPLIERS.map(s => [s.id, s]));

    /* the materials library. kind: stock (kept on hand) · mto (made to order, charged per piece) · order (once per order).
       avg: average cost of what's on hand · last: last price paid · var: extra cost for some sizes or colours
       buys: [date, units, paid] · hand: on hand · min: reorder point · unit: what one is */
    const INPUTS = LV ? LV.INPUTS : [{
      id: 'blk-ss',
      n: 'Blank tee · short sleeve',
      kind: 'stock',
      unit: 'tee',
      sup: 'wcb',
      avg: 10.18,
      last: 10.40,
      hand: 46,
      var: {
        XXL: 1.20,
        Cobalt: 0.40
      },
      buys: [[D(8, 20), 144, 1411.20], [D(10, 14), 72, 748.80]],
      note: 'Heavyweight 6.5 oz, long body. Westcoast raised the price 40¢ on 14 Oct.'
    }, {
      id: 'blk-ls',
      n: 'Blank tee · long sleeve',
      kind: 'stock',
      unit: 'tee',
      sup: 'wcb',
      avg: 11.90,
      last: 11.90,
      hand: 30,
      var: {
        XXL: 1.40
      },
      buys: [[D(9, 8), 72, 856.80]]
    }, {
      id: 'blk-tn',
      n: 'Turtleneck blank · rib knit',
      kind: 'stock',
      unit: 'piece',
      sup: 'wcb',
      avg: 16.40,
      last: 16.40,
      hand: 3,
      var: {
        XXL: 1.60
      },
      buys: [[D(8, 25), 24, 393.60], [D(9, 30), 12, 196.80]]
    }, {
      id: 'blk-hd',
      n: 'Hoodie blank · heavy fleece',
      kind: 'stock',
      unit: 'piece',
      sup: 'hws',
      avg: 26.80,
      last: 25.46,
      hand: 0,
      var: {
        XXL: 2.00
      },
      buys: [[D(8, 18), 24, 643.20]],
      incoming: [120, D(10, 30), 3055.20],
      note: '120 on the way at $25.46, the 120-piece price. The average drops when they land.'
    }, {
      id: 'prt-1',
      n: 'Screen print · one colour',
      kind: 'mto',
      unit: 'print',
      sup: 'isp',
      avg: 4.60,
      last: 4.60,
      note: 'Chest logo. A $35.00 screen fee per new design, already paid for the logo.'
    }, {
      id: 'prt-dtg',
      n: 'Photo print · full colour',
      kind: 'mto',
      unit: 'print',
      sup: 'isp',
      avg: 5.80,
      last: 5.80,
      var: {
        XXL: 0.60
      }
    }, {
      id: 'prt-hd',
      n: 'Puff print · chest and back',
      kind: 'mto',
      unit: 'print',
      sup: 'isp',
      avg: 6.40,
      last: 6.40
    }, {
      id: 'emb',
      n: 'Embroidered logo',
      kind: 'mto',
      unit: 'piece',
      sup: 'sth',
      avg: 5.20,
      last: 5.20
    }, {
      id: 'lbl-n',
      n: 'Woven neck label',
      kind: 'stock',
      unit: 'label',
      sup: 'rlc',
      avg: 0.85,
      last: 0.85,
      hand: 612,
      buys: [[D(8, 22), 1000, 850.00]]
    }, {
      id: 'lbl-h',
      n: 'Hem tag',
      kind: 'stock',
      unit: 'tag',
      sup: 'rlc',
      avg: 0.35,
      last: 0.35,
      hand: 540,
      buys: [[D(8, 22), 1000, 350.00]]
    }, {
      id: 'bag',
      n: 'Fold bag · clear',
      kind: 'stock',
      unit: 'bag',
      sup: 'pac',
      avg: 0.30,
      last: 0.28,
      hand: 260,
      buys: [[D(8, 30), 300, 90.00], [D(10, 9), 200, 56.00]]
    }, {
      id: 'pt-sq',
      n: 'Woven patch · square',
      kind: 'stock',
      unit: 'patch',
      sup: 'pwc',
      avg: 1.60,
      last: 1.60,
      hand: 136,
      buys: [[D(8, 28), 200, 320.00]]
    }, {
      id: 'pt-ci',
      n: 'Woven patch · circle',
      kind: 'stock',
      unit: 'patch',
      sup: 'pwc',
      avg: 1.60,
      last: 1.60,
      hand: 142,
      buys: [[D(8, 28), 200, 320.00]]
    }, {
      id: 'card',
      n: 'Backer card',
      kind: 'stock',
      unit: 'card',
      sup: 'pac',
      avg: 0.20,
      last: 0.20,
      hand: 150,
      buys: [[D(8, 30), 400, 80.00]]
    }, {
      id: 'mail',
      n: 'Poly mailer · 10 × 13',
      kind: 'order',
      stock: 1,
      unit: 'mailer',
      sup: 'pac',
      avg: 0.42,
      last: 0.42,
      hand: 140,
      buys: [[D(8, 30), 300, 126.00]]
    }, {
      id: 'tis',
      n: 'Tissue and sticker',
      kind: 'order',
      stock: 1,
      unit: 'set',
      sup: 'pac',
      avg: 0.18,
      last: 0.18,
      hand: 180,
      buys: [[D(8, 30), 300, 54.00]]
    }, {
      id: 'thl',
      n: 'Thermal label · 4 × 6',
      kind: 'order',
      stock: 1,
      unit: 'label',
      sup: 'pac',
      avg: 0.04,
      last: 0.04,
      hand: 410,
      buys: [[D(8, 30), 500, 20.00]]
    }];
    const INP = LV ? LV.INP : Object.fromEntries(INPUTS.map(i => [i.id, i]));
    const KIND = {
      stock: ['Kept on hand', 'Bought ahead and counted. Used up when a batch is made.'],
      mto: ['Made to order', 'Charged per piece when it’s made. Nothing on hand.'],
      order: ['Once per order', 'Packing for the whole order, not each item.']
    };
    const MIN_WEEKS = LV ? LV.MIN_WEEKS : 1; /* reorder when stock lasts less than the supplier's lead time plus this */

    /* products. cost: 'recipe' (built from materials: [input, amount]) or 'flat' (one cost per product; est = an estimate) */
    const LINES = {
      logo: ['Logo Tees', 'var(--fg)'],
      graphic: ['Graphic Tees', 'var(--land)'],
      layers: ['Layers', 'color-mix(in srgb,var(--fg) 55%,transparent)'],
      patch: ['Patches', 'var(--underway)'],
      hw: ['Hardware pre-orders', 'var(--line)']
    };
    const SHELF = {
      on: ['On the shelf', 'var(--settled)'],
      off: ['Off the shelf', 'var(--underway)'],
      draft: ['Draft', 'var(--line)'],
      arch: ['Archived', 'var(--line)']
    };
    const PR = LV ? LV.PR : [{
      id: 'lts',
      n: 'Logo Tee',
      v: 'Short sleeve',
      line: 'logo',
      g: 'tee',
      price: 46,
      st: 'on',
      cols: ['Black', 'White'],
      wk: [6, 9, 8, 7, 8, 9, 7, 7],
      recipe: [['blk-ss', 1], ['prt-1', 1], ['lbl-n', 1], ['lbl-h', 1], ['bag', 1]]
    }, {
      id: 'ltl',
      n: 'Logo Tee',
      v: 'Long sleeve',
      line: 'logo',
      g: 'ls',
      price: 54,
      st: 'on',
      cols: ['Black', 'White'],
      wk: [0, 0, 3, 4, 3, 4, 3, 4],
      recipe: [['blk-ls', 1], ['prt-1', 1], ['lbl-n', 1], ['lbl-h', 1], ['bag', 1]]
    }, {
      id: 'tn',
      n: 'Turtleneck',
      v: 'Rib knit',
      line: 'layers',
      g: 'turtle',
      price: 72,
      st: 'on',
      cols: ['Black'],
      wk: [2, 3, 2, 3, 2, 2, 3, 2],
      recipe: [['blk-tn', 1], ['emb', 1], ['lbl-n', 1], ['lbl-h', 1], ['bag', 1]]
    }, {
      id: 'hd',
      n: 'Hoodie',
      v: 'Heavy fleece',
      line: 'layers',
      g: 'hood',
      price: 98,
      st: 'off',
      cols: ['Black'],
      wk: [3, 4, 3, 4, 4, 2, 0, 0],
      why: 'Sold out 9 Oct · 120 arrive 30 Oct',
      recipe: [['blk-hd', 1], ['prt-hd', 1], ['lbl-n', 1], ['lbl-h', 1], ['bag', 1]]
    }, {
      id: 'gcm',
      n: 'Graphic Tee',
      v: 'Carousel Mall',
      line: 'graphic',
      g: 'gtee',
      price: 44,
      st: 'on',
      cols: ['Black', 'Cobalt', 'White'],
      wk: [0, 0, 0, 0, 4, 5, 4, 4],
      recipe: [['blk-ss', 1], ['prt-dtg', 1], ['lbl-n', 1], ['lbl-h', 1], ['bag', 1]]
    }, {
      id: 'gtt',
      n: 'Graphic Tee',
      v: 'Two Ten Overpass',
      line: 'graphic',
      g: 'gtee',
      price: 44,
      st: 'on',
      cols: ['Black', 'Cobalt', 'White'],
      wk: [0, 0, 0, 0, 4, 3, 0, 2],
      recipe: [['blk-ss', 1], ['prt-dtg', 1], ['lbl-n', 1], ['lbl-h', 1], ['bag', 1]]
    }, {
      id: 'gdv',
      n: 'Graphic Tee',
      v: 'Devore',
      line: 'graphic',
      g: 'gtee',
      price: 44,
      st: 'draft',
      cols: ['Black', 'Cobalt', 'White'],
      wk: [0, 0, 0, 0, 0, 0, 0, 0],
      why: 'Sample arrives 28 Oct',
      flat: 18.20,
      est: 1,
      note: 'Quoted by Inland Screen Print before the sample. Build it from materials once it’s priced.'
    }, {
      id: 'psq',
      n: 'Clear patch',
      v: 'Square',
      line: 'patch',
      g: 'psq',
      price: 9,
      st: 'on',
      cols: ['One size'],
      wk: [0, 4, 5, 6, 5, 6, 5, 6],
      recipe: [['pt-sq', 1], ['card', 1], ['bag', 1]]
    }, {
      id: 'pci',
      n: 'Clear patch',
      v: 'Circle',
      line: 'patch',
      g: 'pci',
      price: 9,
      st: 'on',
      cols: ['One size'],
      wk: [0, 3, 4, 5, 4, 5, 5, 5],
      recipe: [['pt-ci', 1], ['card', 1], ['bag', 1]]
    }, {
      id: 'cpt',
      n: 'Clear Point',
      v: 'Counter or table',
      line: 'hw',
      g: 'point',
      price: 60,
      dep: 1,
      st: 'on',
      cols: ['Counter', 'Table'],
      wk: [0, 0, 0, 0, 0, 3, 0, 0],
      flat: 52,
      est: 1,
      note: 'Deposit. Costed when the first build is quoted in November.'
    }, {
      id: 'c8',
      n: 'Clear Counter',
      v: '8-inch',
      line: 'hw',
      g: 'tab',
      price: 140,
      dep: 1,
      st: 'on',
      cols: ['8-inch'],
      wk: [0, 0, 0, 0, 0, 1, 1, 0],
      flat: 118,
      est: 1,
      note: 'Deposit. Refurbished tablet, case and mount.'
    }, {
      id: 'c10',
      n: 'Clear Counter',
      v: '10-inch',
      line: 'hw',
      g: 'tab',
      price: 180,
      dep: 1,
      st: 'draft',
      cols: ['10-inch'],
      wk: [0, 0, 0, 0, 0, 0, 0, 0],
      flat: 150,
      est: 1,
      why: 'Waiting on the enclosure'
    }];
    const PRO = LV ? LV.PRO : Object.fromEntries(PR.map(p => [p.id, p]));
    const STK = LV ? LV.STK : {
      /* finished goods on hand, by colour, XS → XXL */
      lts: {
        Black: [4, 11, 18, 16, 9, 3],
        White: [2, 6, 9, 3, 5, 1]
      },
      ltl: {
        Black: [3, 8, 12, 10, 6, 2],
        White: [1, 4, 6, 5, 3, 0]
      },
      tn: {
        Black: [0, 1, 2, 1, 1, 0]
      },
      hd: {
        Black: [0, 0, 0, 0, 0, 0]
      },
      gcm: {
        Black: [2, 5, 7, 6, 4, 1],
        Cobalt: [1, 4, 5, 4, 2, 0],
        White: [2, 4, 6, 5, 3, 1]
      },
      gtt: {
        Black: [1, 3, 4, 4, 2, 1],
        Cobalt: [2, 6, 9, 8, 4, 2],
        White: [0, 2, 3, 2, 1, 0]
      },
      gdv: {
        Black: [0, 0, 0, 0, 0, 0],
        Cobalt: [0, 0, 0, 0, 0, 0],
        White: [0, 0, 0, 0, 0, 0]
      },
      psq: {
        'One size': [64]
      },
      pci: {
        'One size': [58]
      }
    };

    /* batches: made from materials, cost locked at the time */
    const BATCHES = LV ? LV.BATCHES : [/* id, product, colour, units, date, cost per unit, state */
    ['B-016', 'lts', 'White', 24, D(10, 14), 16.38, 'done'], ['B-015', 'gtt', 'Cobalt', 36, D(10, 19), 17.10, 'done'], ['B-014', 'gcm', 'Black', 36, D(9, 29), 16.90, 'done'], ['B-013', 'psq', '', 100, D(9, 8), 2.10, 'done'], ['B-012', 'hd', 'Black', 120, D(10, 30), 33.36, 'planned'], ['B-017', 'tn', 'Black', 12, D(10, 28), 23.10, 'short']];

    /* orders and the costs that come once per order */
    const SHIP = LV ? LV.SHIP : {
      charged: 6.00,
      label: 7.40
    }; /* flat $6 shipping charged; the label costs more */
    const FEE = LV ? LV.FEE : {
      pct: 0.029,
      fixed: 0.30
    };
    const ORDERS = LV ? LV.ORDERS : [/* id, time, who, member, items [product, colour, size, qty], paid with, how, state */
    ['1094', H(10, 21, 12, 40), 'Ana R.', 1, [['lts', 'Black', 'M', 1], ['pci', 'One size', '', 1]], 'clear', 'ship', 'paid'], ['1093', H(10, 21, 10, 5), 'Jordan P.', 0, [['gcm', 'Cobalt', 'L', 1]], 'card', 'ship', 'paid'], ['1092', H(10, 20, 19, 22), 'Mia T.', 1, [['ltl', 'White', 'S', 1]], 'clear', 'pickup', 'paid'], ['1091', H(10, 20, 16, 10), 'Chris D.', 0, [['tn', 'Black', 'M', 1]], 'wallet', 'ship', 'paid'], ['1090', H(10, 20, 9, 30), 'Leo M.', 1, [['psq', 'One size', '', 2], ['pci', 'One size', '', 1]], 'clear', 'ship', 'paid'], ['1089', H(10, 19, 18, 0), 'Sam K.', 1, [['lts', 'White', 'L', 2]], 'clear', 'ship', 'packed'], ['1088', H(10, 19, 13, 15), 'Nina V.', 0, [['gtt', 'Black', 'M', 1]], 'card', 'pickup', 'ready'], ['1087', H(10, 19, 11, 0), 'Omar H.', 1, [['ltl', 'Black', 'L', 1], ['psq', 'One size', '', 1]], 'clear', 'ship', 'packed'], ['1086', H(10, 18, 15, 30), 'Tess W.', 1, [['lts', 'Black', 'S', 1]], 'clear', 'pickup', 'ready'], ['1085', H(10, 18, 9, 45), 'Ben A.', 0, [['tn', 'Black', 'L', 1]], 'card', 'ship', 'shipped'], ['1084', H(10, 17, 17, 20), 'Kim L.', 1, [['gcm', 'White', 'M', 1]], 'clear', 'ship', 'shipped'], ['1083', H(10, 17, 12, 0), 'Ray C.', 0, [['lts', 'Black', 'XXL', 1]], 'wallet', 'ship', 'shipped'], ['1082', H(10, 16, 20, 10), 'Ivy N.', 1, [['pci', 'One size', '', 3]], 'clear', 'ship', 'shipped'], ['1081', H(10, 16, 14, 0), 'Dev S.', 1, [['ltl', 'Black', 'M', 1]], 'clear', 'ship', 'shipped'], ['1080', H(10, 15, 11, 40), 'Lia F.', 0, [['gcm', 'Black', 'S', 1]], 'card', 'ship', 'done'], ['1079', H(10, 9, 10, 15), 'Theo B.', 1, [['hd', 'Black', 'M', 1]], 'clear', 'ship', 'refund']];
    const OST = {
      paid: ['To pack', 'var(--live)'],
      packed: ['Packed', 'var(--fg)'],
      shipped: ['On the way', 'var(--fg-50)'],
      ready: ['Ready for pickup', 'var(--underway)'],
      done: ['Delivered', 'var(--settled)'],
      refund: ['Refund waiting', 'var(--absent)']
    };
    // live, a pickup that's been collected keeps its own step
    if (LV) OST.picked = ['Picked up', 'var(--settled)'];
    const PAY = {
      clear: 'Clear',
      card: 'Card',
      wallet: 'Apple or Google Pay'
    };
    /* pickup points: partner shops that hold orders; held 14 days, then we message the member */
    const POINTS = LV ? LV.POINTS : {
      mesa: {
        n: 'Mesa Laundry',
        city: 'San Bernardino',
        wk4: 8
      },
      tire: {
        n: 'Redlands Tire & Lube',
        city: 'Redlands',
        wk4: 6
      }
    };
    const PICKUP_AT = LV ? LV.PICKUP_AT : {
        '1092': 'mesa',
        '1088': 'mesa',
        '1086': 'tire'
      },
      HOLD_DAYS = LV ? LV.HOLD_DAYS : 14;
    const LINE_COSTS = LV ? LV.LINE_COSTS : [['Samples and proofs', 185], ['Photos for new products', 240], ['Shop software', 39], ['Label printer rolls', 36]];

    /* cost changes, for the record */
    const CHANGES = LV ? LV.CHANGES : [/* date, material, from, to, why */
    [D(10, 14), 'blk-ss', 9.80, 10.40, 'Westcoast raised the short-sleeve price'], [D(10, 9), 'bag', 0.30, 0.28, 'Bought 200 at the 500 price'], [D(10, 2), 'blk-hd', 26.80, 25.46, 'Ordered 120, the volume price'], [D(9, 8), 'prt-dtg', 6.20, 5.80, 'Moved photo prints to Inland']];

    /* line drawings, one per kind of product */
    const GLY = {
      tee: <><path d="M14 7 6.5 11l3 6 3.5-1.6V33h14V15.4l3.5 1.6 3-6L26 7c-1.2 2-3.4 3-6 3s-4.8-1-6-3Z" /><path d="M15.6 7.6c1.1 1.5 2.6 2.2 4.4 2.2s3.3-.7 4.4-2.2" /></>,
      gtee: <><path d="M14 7 6.5 11l3 6 3.5-1.6V33h14V15.4l3.5 1.6 3-6L26 7c-1.2 2-3.4 3-6 3s-4.8-1-6-3Z" /><rect x="16" y="15" width="8" height="7" /></>,
      ls: <><path d="M14 7 8.5 9.5 5 30l3.6.8L13 16.5V33h14V16.5l4.4 14.3L35 30 31.5 9.5 26 7c-1.2 2-3.4 3-6 3s-4.8-1-6-3Z" /><path d="M15.6 7.6c1.1 1.5 2.6 2.2 4.4 2.2s3.3-.7 4.4-2.2" /></>,
      turtle: <><path d="M15.5 8 8.5 10 5 30l3.6.8L13 16.5V33h14V16.5l4.4 14.3L35 30 31.5 10l-7-2" /><path d="M16 3.5h8V8c-1.1 1-2.5 1.6-4 1.6S17.1 9 16 8Z" /></>,
      hood: <><path d="M14.5 7.5 8.5 10 5 30l3.6.8L13 16.5V33h14V16.5l4.4 14.3L35 30 31.5 10l-6-2.5" /><path d="M14.5 9.5C14 5 16.6 2.5 20 2.5s6 2.5 5.5 7c-1.4 1.3-3.4 2-5.5 2s-4.1-.7-5.5-2Z" /><path d="M15.5 25h9l1 5h-11Z" /></>,
      psq: <><rect x="8.5" y="8.5" width="23" height="23" /><rect x="12" y="12" width="16" height="16" strokeDasharray="2 2.2" /><circle cx="20" cy="20" r="3.2" /></>,
      pci: <><circle cx="20" cy="20" r="12" /><circle cx="20" cy="20" r="8.6" strokeDasharray="2 2.2" /><circle cx="20" cy="20" r="3.2" /></>,
      point: <><rect x="6.5" y="9" width="27" height="17" /><path d="M10.5 13.5h9M10.5 17h13M10.5 20.5h6" /><rect x="25.5" y="17.5" width="4.5" height="4.5" /><path d="M15 31h10M20 26v5" /></>,
      tab: <><rect x="9" y="6.5" width="22" height="27" rx="1.5" /><path d="M18 30.2h4" /><path d="M12.5 10.5h15v16h-15Z" strokeDasharray="2 2.2" /></>
    };

    /* ══ Shop — what's for sale, what it costs to make, and what's left ═════════════════════════════════════════════════
       Overview · Products (each built from materials, or one cost) · Materials (the saved library, suppliers, reorder points)
       · Inventory (finished stock, batches, what's on the way) · Orders. */
    const SP = {
      tab: 'overview',
      pf: 'all',
      mf: 'all',
      of: 'open',
      panel: null,
      me: LV ? LV.ME : 'kai',
      draft: null,
      buy: null,
      // the shelf's rows showing: two, then one more at a time
      rows: 2
    };
    const ICO = {
      chev: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>,
      back: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>,
      x: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
    };
    const cell = (cls, title, right, body, foot) => <div className={`cell ${cls}`}><div className="hd"><h2>{title}</h2><div className="r">{right}</div></div>{body}<div className="bk-ft">{foot}</div></div>;
    const lbl = t => <span className="lbl">{t}</span>;
    const rest = () => <div className="sx-rest" aria-hidden="true" />; /* leftover space under a short list: the hatch, nothing to show */
    const band = (cells, first) => <section className="band" {...attrs(first ? ' style="margin-top:0"' : '')}><div className="bento">{cells}</div></section>;
    const pager = (p, n, per, key) => {
      const pages = Math.max(1, Math.ceil(n / per));
      return <span className="pg2"><span>{n ? p * per + 1 : 0}–{Math.min(n, (p + 1) * per)}{" of "}{n}</span><button {...{ [`data-${key}`]: '-1' }} disabled={p === 0} aria-label="Previous">{ICO.back}</button><button {...{ [`data-${key}`]: '1' }} disabled={p >= pages - 1} aria-label="Next">{ICO.chev}</button></span>;
    };
    const seg = (key, opts, v, aria) => <div className="seg sm" role="group" aria-label={aria}>{opts.map(([k, t]) => <button key={k} {...{ [`data-${key}`]: k }} aria-pressed={v === k}>{t}</button>)}</div>;
    const glyph = (p, cls = '') => <span className={`sx-g ${cls}`} aria-hidden="true"><svg viewBox="0 0 40 40">{GLY[p.g]}</svg></span>;
    const STAFF = () => !RO() && !!PPL[SP.me] && PPL[SP.me].staff;
    const shortN = p => p.line === 'graphic' ? p.v : p.line === 'patch' ? 'Patch · ' + p.v : p.line === 'logo' ? 'Logo Tee · ' + p.v.split(' ')[0] : p.line === 'hw' && p.n === 'Clear Counter' ? 'Counter · ' + p.v : p.n;
    const pts = v => Math.abs(v) < .05 ? 'under 0.1 pts' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} pts`;
    const fx = (n, d = 2) => (Math.round(n * 100) / 100).toFixed(d);
    const oneSize = p => !!p.one || p.cols[0] === 'One size';
    /* a product's name and variant; live, one may have no variant */
    const nv = p => p.v ? `${p.n} · ${p.v}` : p.n;
    /* the reorder buffer (Settings' buffer, live), in words */
    const bufT = () => !LV || MIN_WEEKS === 1 ? 'a week' : MIN_WEEKS ? `${MIN_WEEKS} weeks` : 'Settings’ buffer';
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    /* the colours a batch can be made in: live, the ones it keeps stock for */
    const colsOf = p => LV && STK[p.id] ? Object.keys(STK[p.id]) : p.cols;
    /* live helpers: a supplier's lead time, a pickup's point, a share that has nothing to be a share of */
    const leadT = s => s.lead == null ? 'No lead time' : `${s.lead} days`;
    const share = (a, b) => b ? `${(a / b * 100).toFixed(0)}%` : '—';

    /* ── costing ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
    const inCost = (id, size, col) => {
      const i = INP[id],
        v = i.var || {};
      return i.avg + (v[size] || 0) + (v[col] || 0);
    };
    const recipeCost = (rec, size, col) => rec.reduce((a, [id, q]) => a + q * inCost(id, size, col), 0);
    const costOf = (p, size = 'M', col) => {
      // live, the API's cost for the colour and size (its overrides and extras), when it has one
      if (LV) {
        const c = LV.costAt(p, p.one ? '' : size, col || p.cols[0]);
        if (c != null) return c;
      }
      return p.recipe ? recipeCost(p.recipe, size, col || p.cols[0]) : p.flat;
    };
    const marginOf = (p, size, col) => p.price ? (p.price - costOf(p, size, col)) / p.price : 0;
    const mTxt = p => p.dep ? 'Deposit' : p.nc ? 'Not costed' : `${(marginOf(p) * 100).toFixed(0)}%${p.est ? ' est.' : ''}`;
    const under = p => !p.dep && !p.nc && marginOf(p) < TARGET;
    const priceFor = (cost, m) => cost / (1 - m);
    const u4 = p => p.wk.slice(-4).reduce((a, b) => a + b, 0);
    const goods = PR.filter(p => !p.dep);
    const onHand = id => STK[id] ? Object.values(STK[id]).flat().reduce((a, b) => a + b, 0) : null;
    const coverW = p => {
      const h = onHand(p.id),
        r = u4(p) / 4;
      return r ? h / r : null;
    };
    const usedIn = id => PR.filter(p => p.recipe && p.recipe.some(r => r[0] === id));
    const ORD_W = LV ? LV.ORD_W : [9, 13, 13, 15, 18, 20, 17, 19];
    const perOrderSupplies = () => LV ? LV.PER?.ship?.supplies ?? 0 : INPUTS.filter(i => i.kind === 'order').reduce((a, i) => a + i.avg, 0);
    const pickupSupplies = () => LV ? LV.PER?.pickup?.supplies ?? 0 : INP.tis.avg; /* pickups skip the mailer and the label */
    /* live, how fast a material goes and when to reorder are the API's (REORDER: its runs and packed orders, the
       supplier's lead time plus Settings' buffer) */
    const useWk = i => LV ? LV.REORDER[i.id]?.perWeek ?? 0 : i.kind === 'order' ? ORD_W.slice(-4).reduce((a, b) => a + b, 0) / 4 : usedIn(i.id).reduce((a, p) => a + u4(p) / 4 * p.recipe.find(r => r[0] === i.id)[1], 0);
    const lastsW = i => {
      if (LV) return LV.REORDER[i.id]?.lastsWeeks ?? null;
      const u = useWk(i);
      return u ? i.hand / u : null;
    };
    const needW = i => LV ? LV.REORDER[i.id]?.needWeeks ?? MIN_WEEKS : SUP[i.sup].lead / 7 + MIN_WEEKS;
    const isLow = i => LV ? !!LV.REORDER[i.id]?.due : i.kind !== 'mto' && lastsW(i) !== null && lastsW(i) < SUP[i.sup].lead / 7 + MIN_WEEKS && !i.incoming;
    const KC = {
      stock: 'var(--fg)',
      mto: 'color-mix(in srgb,var(--fg) 50%,transparent)',
      order: 'var(--line)'
    };
    const partsOf = p => {
      const o = {
        base: 0,
        make: 0,
        trim: 0
      };
      // live, the blank is the dearest material kept on hand
      const b0 = LV ? (p.recipe || []).filter(([id]) => INP[id].kind === 'stock').sort((a, b) => b[1] * INP[b[0]].avg - a[1] * INP[a[0]].avg)[0]?.[0] : null;
      (p.recipe || []).forEach(([id, q]) => {
        const i = INP[id],
          c = q * inCost(id, 'M', p.cols[0]);
        if (i.kind === 'mto') o.make += c;else if (LV ? id === b0 : /^blk|^pt-/.test(id)) o.base += c;else o.trim += c;
      });
      return o;
    };

    /* the last four weeks */
    const SHOPN = (() => {
      if (LV) {
        const rev = goods.reduce((a, p) => a + u4(p) * p.price, 0),
          prev = goods.reduce((a, p) => a + p.wk.slice(0, 4).reduce((x, y) => x + y, 0) * p.price, 0);
        const mat = goods.reduce((a, p) => a + u4(p) * costOf(p), 0);
        const recent = ORDERS.filter(o => o[1] >= NOW - 28 * DAY && o[7] !== 'refund');
        const ord = recent.length,
          shipped = recent.filter(o => o[6] === 'ship').length,
          picked = ord - shipped;
        let pack = 0,
          fees = 0,
          ship = 0,
          labels = 0;
        for (const o of recent) {
          const oc = LV.ORDER_COSTS[o[0]],
            t = o[4].reduce((a, [pid,,, q]) => a + (PRO[pid]?.price || 0) * q, 0);
          pack += oc ? oc.suppliesCost : o[6] === 'ship' ? perOrderSupplies() : pickupSupplies();
          fees += oc ? oc.fee : o[5] === 'clear' ? 0 : t * FEE.pct + FEE.fixed;
          if (oc && oc.gap != null) {
            ship += oc.gap;
            labels++;
          }
        }
        const gross = rev - mat - pack - fees - ship;
        return {
          rev,
          prev,
          mat,
          ord,
          shipped,
          picked,
          pack,
          fees,
          ship,
          labels,
          gross,
          line: 0,
          left: gross,
          items: goods.reduce((a, p) => a + u4(p), 0)
        };
      }
      const rev = goods.reduce((a, p) => a + u4(p) * p.price, 0),
        prev = goods.reduce((a, p) => a + p.wk.slice(0, 4).reduce((x, y) => x + y, 0) * p.price, 0);
      const mat = goods.reduce((a, p) => a + u4(p) * costOf(p), 0),
        ord = ORD_W.slice(-4).reduce((a, b) => a + b, 0),
        shipped = 60,
        picked = ord - shipped;
      const pack = shipped * perOrderSupplies() + picked * pickupSupplies(),
        fees = rev * FEE.pct + ord * FEE.fixed,
        ship = shipped * (SHIP.label - SHIP.charged);
      const gross = rev - mat - pack - fees - ship,
        line = LINE_COSTS.reduce((a, b) => a + b[1], 0);
      return {
        rev,
        prev,
        mat,
        ord,
        shipped,
        picked,
        pack,
        fees,
        ship,
        gross,
        line,
        left: gross - line,
        items: goods.reduce((a, p) => a + u4(p), 0)
      };
    })();
    const REV_W = WEEKS.map((_, i) => goods.reduce((a, p) => a + p.wk[i] * p.price, 0));

    /* ── header ── */
    function renderHdr() {
      if (LV) return renderHdrLive();
      const S = SHOPN,
        low = INPUTS.filter(isLow),
        pack = ORDERS.filter(o => o[7] === 'paid'),
        pm = (S.rev - S.mat) / S.rev,
        rmx = Math.max(...REV_W);
      const tn = INP['blk-tn'];
      const B = {
        overview: <>{money(S.left)}{" is left for marketing after every cost. "}<a data-sopen="m:blk-tn">Turtleneck blanks</a>{" run out before Westcoast can deliver more."}</>,
        products: <>{"Everything on the shelf clears the "}{TARGET * 100}{"% margin at a medium. "}<a data-sopen="p:gcm">Graphic Tees</a>{" in XXL don’t, since the blank and the print both cost more."}</>,
        materials: `${low.length} ${low.length === 1 ? 'material is' : 'materials are'} running low. Hoodie blanks land 30 Oct at the 120-piece price, so the average drops to ${money(INP['blk-hd'].incoming[2] / INP['blk-hd'].incoming[0])}.`,
        inventory: <>{int(goods.reduce((a, p) => a + (onHand(p.id) || 0), 0))}{" finished items on hand. The turtleneck batch is "}<a data-sopen="b:B-017">waiting on blanks</a>.</>,
        orders: `${pack.length} orders to pack. A shipped order costs ${money(perOrderSupplies())} in packing and ${money(SHIP.label - SHIP.charged)} more to ship than we charge. Pickups skip both.`
      }[SP.tab];
      const segs = (arr, col, n) => arr.map((x, i) => <i key={i} style={css(`left:${i / Math.max(n || 0, arr.length) * 100}%;width:calc(${100 / Math.max(n || 0, arr.length)}% - 2px);background:${col(x)}`)} />);
      const stockIns = INPUTS.filter(i => i.kind !== 'mto');
      html(document.getElementById('hdr'), <><span className="when"><span className="dot" />Shop · useclear.org/shop · Demo data</span><p className="brief">{B}</p><div className="strip"><div className="sc" data-stab="overview"><span className="lbl">Sales · 4 weeks</span><div className="sc-v">{money0(S.rev)}{" "}<small>+{((S.rev / S.prev - 1) * 100).toFixed(0)}%</small></div><div className="mb">{segs(REV_W, v => `color-mix(in srgb,var(--fg) ${Math.round(25 + v / rmx * 65)}%,transparent)`)}</div><div className="sc-s">{S.ord}{" orders · "}{S.items}{" items"}</div></div><div className="sc" data-stab="products"><span className="lbl">Product margin</span><div className="sc-v">{(pm * 100).toFixed(1)}{"% "}<small>{"target "}{TARGET * 100}%</small></div><div className="mb"><i style={css(`width:${pm * 100}%;background:var(--settled)`)} /><s className="nflr" style={css(`left:${TARGET * 100}%`)} /></div><div className="sc-s">{pct(S.gross, S.rev, 1)}{" after packing, fees and shipping"}</div></div><div className="sc" data-stab="orders"><span className="lbl">To pack</span><div className="sc-v">{pack.length}{" "}<small>orders</small></div><div className="mb">{segs(pack, o => (NOW - o[1]) / DAY > 1 ? 'var(--underway)' : 'var(--live)', 8)}</div><div className="sc-s">{"Oldest "}{ago(Math.min(...pack.map(o => o[1])))}</div></div><div className="sc" data-stab="materials"><span className="lbl">Materials</span><div className="sc-v">{low.length}{" "}<small>running low</small></div><div className="mb">{segs(stockIns, i => isLow(i) ? 'var(--underway)' : i.incoming ? 'var(--live)' : 'var(--fg)')}</div><div className="sc-s">{low.map(i => i.n.split(' · ')[0]).join(', ') || 'Everything’s covered'}</div></div></div></>);
    }

    /* live: the brief worked out from the rows, and the strip with nothing to divide by when there's nothing yet */
    function renderHdrLive() {
      const S = SHOPN,
        low = INPUTS.filter(isLow),
        pack = ORDERS.filter(o => o[7] === 'paid'),
        pm = S.rev ? (S.rev - S.mat) / S.rev : 0,
        rmx = Math.max(0, ...REV_W);
      const onShelf = PR.filter(p => p.st === 'on' && !p.dep),
        underT = onShelf.filter(p => !p.nc && marginOf(p) < TARGET).sort((a, b) => marginOf(a) - marginOf(b)),
        nc = PR.filter(p => p.st !== 'arch' && !p.dep && p.nc);
      const next = LV.ON_ORDER.filter(o => INP[o.input] && o.due != null).sort((a, b) => a.due - b.due)[0];
      const short = BATCHES.find(b => b[6] === 'short'),
        planned = BATCHES.filter(b => b[6] === 'planned');
      const tp = Math.round(TARGET * 100),
        items = goods.reduce((a, p) => a + (onHand(p.id) || 0), 0);
      const B = {
        overview: S.rev ? <>{money(S.left)}{" is left after materials, packing, card fees and shipping in the last 4 weeks; the shop’s own running costs aren’t recorded yet. "}{low.length ? <><a data-sopen={`m:${low[0].id}`}>{low[0].n}</a>{low.length > 1 ? ` and ${low.length - 1} more run` : ' runs'}{" out before more can arrive."}</> : 'No material runs out before more can arrive.'}</> : `No sales in the last 4 weeks. ${PR.length ? `${onShelf.length} ${onShelf.length === 1 ? 'product is' : 'products are'} on the shelf.` : 'No products yet.'}`,
        products: !onShelf.length ? `Nothing is on the shelf yet.${nc.length ? ` ${nc.length} ${nc.length === 1 ? 'product isn’t' : 'products aren’t'} costed yet.` : ''}` : <>{underT.length ? <><a data-sopen={`p:${underT[0].id}`}>{shortN(underT[0])}</a>{` is under the ${tp}% margin at a medium${underT.length > 1 ? `, and ${underT.length - 1} more` : ''}.`}</> : `Everything on the shelf clears the ${tp}% margin at a medium.`}{nc.length ? ` ${nc.length} ${nc.length === 1 ? 'product isn’t' : 'products aren’t'} costed yet.` : ''}</>,
        materials: !INPUTS.length ? 'No materials in the library yet.' : `${low.length} ${low.length === 1 ? 'material is' : 'materials are'} running low. ${next ? `${INP[next.input].n} lands ${fmtD(next.due)}.` : LV.ON_ORDER.length ? `${LV.ON_ORDER.length} on order.` : 'Nothing is on order.'}`,
        inventory: <>{int(items)}{" finished items on hand. "}{short ? <>{"The "}<a data-sopen={`b:${short[0]}`}>{shortN(PRO[short[1]])}{" batch"}</a>{" is short of materials."}</> : planned.length ? `${planned.length} ${planned.length === 1 ? 'batch is' : 'batches are'} planned.` : 'No batch is planned.'}</>,
        orders: `${pack.length} ${pack.length === 1 ? 'order' : 'orders'} to pack. A shipped order costs ${money(perOrderSupplies())} in packing${SHIP.label != null ? ` and ${money(SHIP.label - SHIP.charged)} more to ship than we charge` : ', and no label’s cost is recorded yet'}. Pickups skip both.`
      }[SP.tab];
      const segs = (arr, col, n) => arr.map((x, i) => <i key={i} style={css(`left:${i / Math.max(n || 0, arr.length) * 100}%;width:calc(${100 / Math.max(n || 0, arr.length)}% - 2px);background:${col(x)}`)} />);
      const stockIns = INPUTS.filter(i => i.kind !== 'mto');
      const ch = S.prev ? (S.rev / S.prev - 1) * 100 : null;
      html(document.getElementById('hdr'), <><span className="when"><span className="dot" />{`Shop · useclear.org/shop · ${WD(NOW)} ${fmtD(NOW)}`}</span><p className="brief">{B}</p><div className="strip"><div className="sc" data-stab="overview"><span className="lbl">Sales · 4 weeks</span><div className="sc-v">{money0(S.rev)}{" "}<small>{ch == null ? '' : `${ch < 0 ? '−' : '+'}${Math.abs(ch).toFixed(0)}%`}</small></div><div className="mb">{segs(REV_W, v => `color-mix(in srgb,var(--fg) ${Math.round(25 + (rmx ? v / rmx : 0) * 65)}%,transparent)`)}</div><div className="sc-s">{S.ord}{" orders · "}{S.items}{" items"}</div></div><div className="sc" data-stab="products"><span className="lbl">Product margin</span><div className="sc-v">{S.rev ? `${(pm * 100).toFixed(1)}% ` : '— '}<small>{"target "}{tp}%</small></div><div className="mb"><i style={css(`width:${pm * 100}%;background:var(--settled)`)} /><s className="nflr" style={css(`left:${TARGET * 100}%`)} /></div><div className="sc-s">{S.rev ? `${pct(S.gross, S.rev, 1)} after packing, fees and shipping` : 'No sales in the last 4 weeks'}</div></div><div className="sc" data-stab="orders"><span className="lbl">To pack</span><div className="sc-v">{pack.length}{" "}<small>orders</small></div><div className="mb">{segs(pack, o => (NOW - o[1]) / DAY > 1 ? 'var(--underway)' : 'var(--live)', 8)}</div><div className="sc-s">{pack.length ? `Oldest ${ago(Math.min(...pack.map(o => o[1])))}` : 'Nothing waiting'}</div></div><div className="sc" data-stab="materials"><span className="lbl">Materials</span><div className="sc-v">{low.length}{" "}<small>running low</small></div><div className="mb">{segs(stockIns, i => isLow(i) ? 'var(--underway)' : i.incoming ? 'var(--live)' : 'var(--fg)')}</div><div className="sc-s">{!stockIns.length ? 'None kept on hand yet' : low.map(i => i.n.split(' · ')[0]).join(', ') || 'Everything’s covered'}</div></div></div></>);
    }

    /* ══ Overview ══════════════════════════════════════════════════════════════════════════════════════════════════ */
    function shelfCell() {
      const list = PR.filter(p => p.st !== 'arch');
      return cell('s12', 'What’s for sale', <span className="lbl">{PR.filter(p => p.st === 'on').length}{" on the shelf · "}{PR.filter(p => p.st !== 'on').length}{" not"}</span>, <>{LV && !list.length ? <div className="gv-e"><span>No products yet · add one from Products</span></div> : <div className="sx-shf">{list.map((p, __k) => {
          const h = onHand(p.id),
            w = coverW(p),
            m = marginOf(p),
            out = h === 0 && p.st !== 'draft' && !p.dep,
            low = !p.dep && p.st === 'on' && w !== null && w < 3;
          return <button key={__k} className={`sx-t ${p.st}`} data-sopen={`p:${p.id}`}>{glyph(p)}<span className="sx-tk"><b>{shortN(p)}</b><span>{money(p.price).replace('.00', '')}{p.dep ? ' deposit' : ''}{" "}{p.dep ? '' : <>{" · "}<span className={`${m < TARGET ? 'bad' : ''} ${p.est ? 'est' : ''}`}>{mTxt(p)}</span></>}</span></span><span className="sx-tu"><b>{u4(p)}</b><span>{p.dep ? 'pre-ordered' : 'sold'}</span></span><span className="sx-tm"><i className={`${out ? 'out' : low ? 'low' : ''} ${p.dep || p.st === 'draft' ? 'na' : ''}`} style={css(`width:${p.dep || p.st === 'draft' ? 100 : Math.min(100, (w || 0) / 12 * 100)}%`)} /></span><span className={`sx-ts ${out ? 'out' : low ? 'low' : ''}`}>{p.dep ? 'Pre-order' : p.st === 'draft' ? 'Not stocked' : out ? 'Out' : `${h} on hand`}</span>{p.st !== 'on' ? <span className="sx-chip">{SHELF[p.st][0]}</span> : ''}</button>;
        })}</div>}{LV && !list.length ? '' : <button className="sx-more" data-sxmore="" hidden />}</>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />Weeks of stock, full at 12</span><span><i style={css("background:var(--underway)")} />Under 3 weeks</span><span><i className="hx" />Not stocked</span></span><span>Sold is the last 4 weeks</span></>);
    }
    function dollarCell() {
      const S = SHOPN,
        steps = [['Sales', S.rev, 'tot'], ['Materials', -S.mat, 'neg'], ['Packing', -S.pack, 'neg'], ['Payment fees', -S.fees, 'neg'], ['Shipping gap', -S.ship, 'neg'], ['Gross profit', S.gross, 'sub'], ['Running the line', -S.line, 'neg'], ['For marketing', S.left, 'keep']];
      let run = 0;
      const rows = steps.map(([k, v, c], __k) => {
        let a, b;
        if (c === 'neg') {
          b = run;
          a = run + v;
          run = a;
        } else {
          a = 0;
          b = v;
          run = v;
        }
        return <div key={__k} className={`sx-wf-r ${c}`}><span>{k}</span><span className="sx-wf-b"><i style={css(`left:${a / S.rev * 100}%;width:${(b - a) / S.rev * 100}%`)} /></span>{LV && k === 'Running the line' ? <b>Not real yet</b> : <b>{c === 'neg' ? '−' : ''}{money(Math.abs(v))}</b>}</div>;
      });
      return cell('s7', 'Where each dollar goes', <span className="lbl">Last 4 weeks</span>, LV && !S.rev ? <div className="gv-e"><span>No sales in the last 4 weeks</span></div> : <div className="sx-wf">{rows}</div>, <><span>{LV ? 'Running the line needs the shop’s own costs: samples, photos, software' : 'Materials use the average cost of what was on hand'}</span><button data-stab="materials">Materials →</button></>);
    }
    function sellsCell() {
      const top = goods.filter(u4).map(p => [p, u4(p) * p.price]).sort((a, b) => b[1] - a[1]),
        tm = top.length ? top[0][1] : 1;
      return cell('s5', 'What sells', <span className="lbl">Sales · 4 weeks</span>, LV && !top.length ? <div className="gv-e"><span>Nothing sold in the last 4 weeks</span></div> : <div className="sx-hb">{top.map(([p, v], __k) => <button key={__k} className="sx-hb-r" data-sopen={`p:${p.id}`}><span>{shortN(p)}</span><span className="sx-hb-b"><i style={css(`width:${v / tm * 100}%;background:${LINES[p.line][1]}`)} /></span><b>{money0(v)}</b><em>{p.nc ? '—' : `${(marginOf(p) * 100).toFixed(0)}%`}</em></button>)}</div>, <><span className="f-key">{['logo', 'graphic', 'layers', 'patch'].map((l, __k) => <span key={__k}><i style={css(`background:${LINES[l][1]}`)} />{LINES[l][0]}</span>)}</span><span /></>);
    }
    function ladderCell() {
      const list = PR.filter(p => p.st !== 'arch' && !p.dep && (p.recipe || p.flat)),
        mx = Math.max(...list.map(p => p.price));
      const PART = [['base', 'Blank or patch', 'var(--fg)'], ['make', 'Printing and embroidery', 'color-mix(in srgb,var(--fg) 50%,transparent)'], ['trim', 'Labels and bags', 'var(--line)']];
      return cell('s12', 'What each product costs to make', <span className="lbl">At a medium · average costs</span>, LV && !list.length ? <div className="gv-e"><span>No product is costed yet</span></div> : <div className="sx-ld">{list.map((p, __k) => {
          const c = costOf(p),
            o = partsOf(p);
          return <button key={__k} className="sx-ld-r" data-sopen={`p:${p.id}`}><span className="sx-ld-k"><b>{shortN(p)}</b><span>{p.recipe ? `${p.recipe.length} materials` : p.est ? 'One cost · estimate' : 'One cost'}</span></span><span className="sx-ld-b"><span className="sx-ld-t" style={css(`width:${p.price / mx * 100}%`)}>{p.recipe ? PART.map(([k,, col], __k) => o[k] ? <i key={__k} style={css(`flex:${o[k]};background:${col}`)} /> : '') : <i className="hx" style={css(`flex:${c}`)} />}<i className="m" style={css(`flex:${p.price - c}`)} /><s style={css(`left:${(1 - TARGET) * 100}%`)} /></span></span><span className="sx-ld-n"><b>{money(c)}</b><em>{"of "}{money(p.price).replace('.00', '')}</em></span><b className={`sx-ld-p ${marginOf(p) < TARGET ? 'bad' : ''}`}>{(marginOf(p) * 100).toFixed(0)}%</b></button>;
        })}</div>, <><span className="f-key">{PART.map(([, t, c], __k) => <span key={__k}><i style={css(`background:${c}`)} />{t}</span>)}<span><i className="hx" />Estimate</span><span><i className="sx-tick" />{"Cost at the "}{TARGET * 100}% target</span></span><span /></>);
    }
    function renderOverview() {
      html(document.getElementById('sv'), <>{band(shelfCell(), 1)}{band(<>{dollarCell()}{sellsCell()}</>)}{band(ladderCell())}</>);
      fitShelf();
    }
    /* the shelf shows its first two rows, however many tiles a row holds at this width (6, 4 or 2), and a
       row more at a time, as the Pipeline's and Build's boards do */
    function fitShelf() {
      const g = document.querySelector('.sx-shf'),
        b = document.querySelector('[data-sxmore]');
      if (!g || !b) return;
      const tiles = [...g.children],
        cols = Math.max(1, getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length),
        shown = cols * SP.rows,
        rest = tiles.length - shown;
      tiles.forEach((t, i) => (t.hidden = i >= shown));
      b.hidden = rest <= 0 && SP.rows <= 2;
      if (rest > 0) {
        b.textContent = `Show ${Math.min(cols, rest)} more · ${rest} not shown`;
        delete b.dataset.less;
      } else {
        b.textContent = 'Show fewer';
        b.dataset.less = '';
      }
    }
    addEventListener('resize', () => {
      if (SP.tab === 'overview') fitShelf();
    });

    /* ══ Products ══════════════════════════════════════════════════════════════════════════════════════════════════ */
    function renderProducts() {
      const F = [['all', 'All'], ['on', 'On the shelf'], ['off', 'Off'], ['draft', 'Drafts']],
        L = PR.filter(p => SP.pf === 'all' || p.st === SP.pf);
      const list = cell('s12', 'Every product', seg('spf', F, SP.pf, 'Which products'), <div className="sx-pl"><div className="sx-pr hd2"><span>{lbl('Product')}</span>{lbl('Price')}{lbl('Cost to make')}{lbl('Margin')}{lbl('Sold')}{lbl('Status')}<span /></div>{L.length ? Object.keys(LINES).map((l, __k) => {
          const A = L.filter(p => p.line === l);
          return A.length ? <Fragment key={l}><div className="gv-g">{lbl(`${LINES[l][0]} · ${A.length}`)}</div>{A.map((p, __k) => {
              const c = costOf(p),
                m = marginOf(p),
                xxl = p.recipe && !oneSize(p) ? marginOf(p, 'XXL', p.cols[p.cols.length - 1]) : null;
              return <button key={__k} className={`sx-pr st-${p.st}`} data-sopen={`p:${p.id}`}><span className="sx-pk">{glyph(p, 'sm')}<span><b>{nv(p)}</b><span>{p.recipe ? `Built from ${p.recipe.length} materials` : p.nc ? 'Not costed yet' : p.est ? 'One cost per product · estimate' : 'One cost per product'}</span></span></span><b className="num">{money(p.price)}</b><span className={`sx-pc ${p.est || p.nc ? 'est' : ''}`}>{p.nc ? '—' : money(c)}{xxl !== null && Math.abs(costOf(p, 'XXL', p.cols[p.cols.length - 1]) - c) > .01 ? <em>{"to "}{money(costOf(p, 'XXL', p.cols[p.cols.length - 1]))}</em> : ''}</span>{p.nc && !p.dep ? <span className="sx-pm dep"><em>Give it materials or one cost</em></span> : p.dep ? <span className="sx-pm dep"><em>{p.nc ? 'Deposit · not costed yet' : <>{"Deposit · estimated cost "}{money(c)}</>}</em></span> : <span className="sx-pm"><span className="sx-mb"><i className={`${p.est ? 'hx' : ''} ${m < TARGET ? 'bad' : ''}`} style={css(`width:${Math.max(0, m) * 100}%`)} /><s style={css(`left:${TARGET * 100}%`)} /></span><b className={m < TARGET ? 'bad' : ''}>{(m * 100).toFixed(0)}%</b></span>}<span className="num">{u4(p)}</span><span className="gt-st" style={css(`--c:${SHELF[p.st][1]}`)}>{SHELF[p.st][0]}</span><span className="gv-go">{ICO.chev}</span></button>;
            })}</Fragment> : '';
        }) : <div className="gv-e"><span>Nothing here</span></div>}</div>, <><span>Margins at a medium · sold in the last 4 weeks</span><button data-sadd="">Add a product</button></>);
      const C = CHANGES.map(([t, id, a, b, why], __k) => {
        const ps = usedIn(id),
          i = INP[id];
        const dm = ps.length ? ps.map(p => {
          const was = (p.price - (costOf(p) - (b - a) * p.recipe.find(r => r[0] === id)[1])) / p.price;
          return (marginOf(p) - was) * 100;
        }) : [0];
        return <button key={__k} className="gt-cr sx-cr" data-sopen={`m:${id}`}>{leaf(t)}<span className="gt-ck"><b>{i.n}</b><span>{why}{" · "}{money(a)}{" → "}{money(b)}</span></span><span className={`sx-cd ${b > a ? 'up' : 'dn'}`}><b>{b > a ? '+' : '−'}{money(Math.abs(b - a))}</b><em>{ps.length}{" product"}{ps.length === 1 ? '' : 's'}{" · "}{pts(Math.min(...dm))}</em></span></button>;
      });
      const changes = cell('s7', 'Cost changes', <span className="lbl">Last 8 weeks</span>, <div className="gt-cl">{LV && !C.length ? <div className="gv-e"><span>No price changes in 8 weeks</span></div> : ''}{C}{rest()}</div>, <><span>A new price blends into the average as stock is used</span><span /></>);
      const under = PR.filter(p => p.recipe && p.st !== 'arch').flatMap(p => p.cols.filter((c, ix) => ix === 0 || INPUTS.some(i => (i.var || {})[c] && p.recipe.some(r => r[0] === i.id))).map(col => {
        const sz = (oneSize(p) ? ['M'] : SIZES).map(s => [s, marginOf(p, s, col)]),
          bad = sz.filter(x => x[1] < TARGET);
        return bad.length ? [p, col, bad, Math.min(...bad.map(x => x[1]))] : null;
      })).filter(Boolean).sort((a, b) => a[3] - b[3]);
      const rng = b => b.length === SIZES.length ? 'every size' : b.length === 1 ? b[0][0] : `${b[0][0]}–${b[b.length - 1][0]}`;
      const target = cell('s5', 'Under the target', <span className="lbl">{TARGET * 100}% margin</span>, under.length ? <div className="sx-ul">{under.map(([p, col, bad, m], __k) => {
          const worst = bad.find(x => x[1] === m)[0],
            c = costOf(p, worst, col);
          return <button key={__k} className="sx-ur" data-sopen={`p:${p.id}`}><span className="gt-ck"><b>{shortN(p)}{" · "}{col}</b><span>{bad.length === 1 ? `Only ${worst} · it costs ${money(c)}` : `${rng(bad)[0].toUpperCase() + rng(bad).slice(1)} · ${worst} costs ${money(c)}`}</span></span><span className="sx-ud"><b className="bad">{(m * 100).toFixed(1)}%</b><em>{money(Math.ceil(priceFor(c, TARGET)))}{" hits "}{TARGET * 100}%</em></span></button>;
        })}{rest()}</div> : <div className="gv-e"><span>{"Every size clears "}{TARGET * 100}%</span></div>, <><span>One price for every size, so XXL earns less</span><span /></>);
      html(document.getElementById('sv'), <>{band(list, 1)}{band(<>{changes}{target}</>)}</>);
    }

    /* ══ Materials ═════════════════════════════════════════════════════════════════════════════════════════════════ */
    function coverBar(i) {
      if (i.kind === 'mto') return <span className="sx-na">Nothing kept · charged per piece</span>;
      const w = lastsW(i),
        need = needW(i),
        mx = 16,
        low = isLow(i);
      return <span className="sx-cv"><span className="sx-cv-b"><i className={low ? 'low' : ''} style={css(`width:${w === null ? 0 : Math.min(100, w / mx * 100)}%`)} />{i.incoming && useWk(i) ? <i className="inc" style={css(`left:${Math.min(100, (w || 0) / mx * 100)}%;width:${Math.min(100 - (w || 0) / mx * 100, i.incoming[0] / useWk(i) / mx * 100)}%`)} /> : ''}<s style={css(`left:${need / mx * 100}%`)} /></span><em className={low ? 'bad' : ''}>{i.incoming && !i.hand ? `None on hand · ${i.incoming[0]} arrive ${fmtD(i.incoming[1])}` : w === null ? 'Not used yet' : `${int(i.hand)} on hand · ${w >= mx ? '16+' : w.toFixed(1)} weeks`}</em></span>;
    }
    function renderMaterials() {
      const F = [['all', 'All'], ['stock', 'Kept on hand'], ['mto', 'Made to order'], ['order', 'Per order']],
        L = INPUTS.filter(i => SP.mf === 'all' || i.kind === SP.mf);
      const list = cell('s12', 'Every material', seg('smf', F, SP.mf, 'Which materials'), <div className="sx-ml"><div className="sx-mr hd2"><span>{lbl('Material')}</span>{lbl('Cost each')}{lbl('On hand · lasts')}{lbl('Used in')}<span /></div>{Object.keys(KIND).map((k, __k) => {
          const A = L.filter(i => i.kind === k);
          return A.length ? <Fragment key={__k}><div className="gv-g">{lbl(`${KIND[k][0]} · ${A.length}`)}<em>{KIND[k][1]}</em></div>{A.map((i, __k) => {
              const ps = usedIn(i.id),
                d = i.last - i.avg;
              return <button key={__k} className={`sx-mr ${isLow(i) ? 'low' : ''}`} data-sopen={`m:${i.id}`}><span className="gt-ck"><b>{i.n}</b><span>{SUP[i.sup].n}{i.var ? ` · ${Object.keys(i.var).join(', ')} cost more` : ''}</span></span><span className="sx-mc"><b>{money(i.avg)}</b><em className={Math.abs(d) > .005 ? d > 0 ? 'up' : 'dn' : ''}>{Math.abs(d) > .005 ? `last paid ${money(i.last)}` : `per ${i.unit}`}</em></span>{coverBar(i)}<span className="sx-mu">{i.kind === 'order' ? <em>Every order</em> : ps.length ? <><span className="sx-dots">{ps.map((p, __k) => <i key={__k} style={css(`background:${LINES[p.line][1]}`)} title={shortN(p)} />)}</span><em>{ps.length}{" product"}{ps.length > 1 ? 's' : ''}</em></> : <em>Nothing yet</em>}</span><span className="gv-go">{ICO.chev}</span></button>;
            })}</Fragment> : '';
        })}{LV && !L.length ? <div className="gv-e"><span>{INPUTS.length ? 'Nothing here' : 'No materials yet · add one below'}</span></div> : ''}{LV && SP.mf === 'all' && LV.ARCHIVED.length ? <><div className="gv-g">{lbl(`Archived · ${LV.ARCHIVED.length}`)}<em>Out of the library; recipes that use one still cost it</em></div>{LV.ARCHIVED.map(i => <button key={i.id} className="sx-mr" data-sopen={`m:${i.id}`}><span className="gt-ck"><b>{i.n}</b><span>{SUP[i.sup].n}</span></span><span className="sx-mc"><b>{money(i.avg)}</b><em>{`per ${i.unit}`}</em></span><span className="sx-na">Archived</span><span className="sx-mu"><em>{usedIn(i.id).length ? `${usedIn(i.id).length} product${usedIn(i.id).length > 1 ? 's' : ''}` : 'Nothing yet'}</em></span><span className="gv-go">{ICO.chev}</span></button>)}</> : ''}</div>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />Weeks it lasts at the last 4 weeks’ pace</span><span><i style={css("background:var(--underway)")} />Runs out before more can arrive</span><span><i className="hx" />On the way</span><span><i className="sx-tick" />{`Lead time plus ${bufT()}`}</span></span><button data-snewm="">Add a material</button></>);
      const low = INPUTS.filter(i => i.kind !== 'mto').filter(i => isLow(i) || i.incoming || lastsW(i) !== null && lastsW(i) < 6).sort((a, b) => (lastsW(a) ?? 99) - (lastsW(b) ?? 99));
      const reorder = cell('s5', 'Reorder', <span className="lbl">{`Lead time plus ${bufT()}`}</span>, <div className="sx-ro">{low.map((i, __k) => {
          const s = SUP[i.sup],
            w = lastsW(i),
            q = LV ? LV.REORDER[i.id]?.suggest?.quantity ?? 0 : Math.max(s.breaks[0][0], Math.ceil(useWk(i) * 8));
          return <button key={__k} className={`sx-ro-r ${isLow(i) ? 'low' : ''}`} data-sopen={`m:${i.id}`}><span className="gt-ck"><b>{i.n}</b><span>{i.incoming ? `${i.incoming[0]} on the way · ${fmtD(i.incoming[1])}` : `${i.hand} left · ${s.n}${s.lead == null ? '' : ` takes ${s.lead} days`}`}</span></span><span className="sx-ro-a">{i.incoming ? <span className="gt-st" style={css("--c:var(--live)")}>Ordered</span> : isLow(i) ? <><b className="bad">{"Order "}{q}</b><em>{money(LV ? LV.REORDER[i.id]?.suggest?.total ?? 0 : q * i.last)}</em></> : <><b>{w == null ? '—' : w.toFixed(1)}{" wk"}</b><em>Fine for now</em></>}</span></button>;
        })}{rest()}</div>, <><span>{BUYCAP() == null ? 'Buys over Settings’ limit need a second person' : <>{"Buys over "}{money(BUYCAP())}{LV ? ' need a second person, in Needs you' : " need a second person, in Money"}</>}</span><span /></>);
      const sup = cell('s7', 'Suppliers', <span className="lbl">{LV ? plural(SUPPLIERS.length, 'supplier', 'suppliers') : <>{SUPPLIERS.length}{" suppliers"}</>}</span>, <div className="sx-sl">{LV && !SUPPLIERS.length ? <div className="gv-e"><span>No suppliers yet</span></div> : ''}{SUPPLIERS.map((s, __k) => {
          const ms = INPUTS.filter(i => i.sup === s.id);
          return <button key={__k} className="sx-sr" data-sopen={`s:${s.id}`}><span className="gt-ck"><b>{s.n}</b><span>{s.what}{" · "}{s.city}</span></span><span className="sx-sm"><b>{leadT(s)}</b><em>{s.terms}</em></span><span className="sx-sm"><b>{ms.length}</b><em>material{ms.length > 1 ? 's' : ''}</em></span><span className="sx-sm"><b>{s.breaks.length > 1 ? `−${Math.round(s.breaks[s.breaks.length - 1][1] * 100)}%` : '—'}</b><em>{s.breaks.length > 1 ? `at ${s.breaks[s.breaks.length - 1][0]}+` : 'no breaks'}</em></span></button>;
        })}{rest()}</div>, <><span>Price breaks apply per order with that supplier</span>{LV && STAFF() ? <button data-sopen="se:">Add a supplier</button> : <span />}</>);
      html(document.getElementById('sv'), <>{band(list, 1)}{band(<>{sup}{reorder}</>)}</>);
    }

    /* ══ Inventory ═════════════════════════════════════════════════════════════════════════════════════════════════ */
    /* live: products with one count per colour, as the reference's patches row */
    const mk0 = LV ? goods.find(p => p.st !== 'arch' && STK[p.id])?.id : null;
    function oneRows(sized) {
      const ps = goods.filter(p => p.st !== 'arch' && p.one && STK[p.id]);
      if (!ps.length) return sized ? '' : <div className="gv-e"><span>No finished stock yet</span></div>;
      return ps.map(p => <button key={p.id} className="sx-sg-r pt" data-sopen={`p:${p.id}`}><span className="sx-sg-k"><b>{shortN(p)}</b></span><span className="sx-sg-col">{Object.keys(STK[p.id]).join(' · ') || 'One size'}</span><span className="sx-sg-pt">{Object.entries(STK[p.id]).map(([c, v]) => `${v[0] ?? 0}${c ? ' ' + c : ''}`).join(' · ')}</span><b className="num">{onHand(p.id)}</b></button>);
    }
    function renderInventory() {
      const rows = goods.filter(p => p.st !== 'arch' && (LV ? !p.one : p.line !== 'patch') && STK[p.id]).flatMap(p => Object.entries(STK[p.id]).map(([col, v], k) => ({
        p,
        col,
        v,
        first: k === 0
      })));
      const cellv = (n, i, on) => <span className={`sx-sg-c ${!on ? 'q' : n === 0 ? 'z' : n <= 2 && i > 0 && i < 5 ? 'lo' : ''}`} style={css(`--a:${Math.min(1, n / 18)}`)}><b>{on || n ? n : '–'}</b></span>;
      const grid = cell('s12', 'Finished stock', <span className="lbl">{int(goods.reduce((a, p) => a + (onHand(p.id) || 0), 0))}{" items · by size"}</span>, <div className="sx-sg"><div className="sx-sg-r hd2"><span>{lbl('Product')}</span>{lbl('Colour')}{SIZES.map(s => lbl(s))}{lbl('Total')}</div>{rows.map(({
          p,
          col,
          v,
          first
        }, __k) => <button key={__k} className={`sx-sg-r ${first ? 'first' : ''}`} data-sopen={`p:${p.id}`}><span className="sx-sg-k">{first ? <b>{shortN(p)}</b> : ''}</span><span className="sx-sg-col"><i className={`sx-sw ${col.toLowerCase()}`} />{col}</span>{v.map((n, i) => cellv(n, i, p.st === 'on'))}<b className="num">{v.reduce((a, b) => a + b, 0)}</b></button>)}{LV ? oneRows(rows.length) : <div className="sx-sg-r pt"><span className="sx-sg-k"><b>Patches</b></span><span className="sx-sg-col">Square · circle</span><span className="sx-sg-pt">{onHand('psq')}{" square · "}{onHand('pci')}{" circle, carded and bagged"}</span><b className="num">{onHand('psq') + onHand('pci')}</b></div>}</div>, <><span className="f-key"><span><i style={css("background:color-mix(in srgb,var(--fg) 60%,transparent)")} />Fewer to more</span><span><i style={css("background:var(--underway)")} />Two or fewer, S to XL</span><span><i className="sx-z" />Out</span><span><i className="hx" />Not on the shelf</span></span><span /></>);
      const BS = {
        done: ['Made', 'var(--fg)'],
        planned: ['Planned', 'var(--live)'],
        short: ['Short of materials', 'var(--underway)']
      };
      const batches = cell('s7', 'Batches', <span className="lbl">Materials in, finished stock out</span>, <div className="sx-bl">{BATCHES.slice().sort((a, b) => ({
          short: 0,
          planned: 1,
          done: 2
        })[a[6]] - {
          short: 0,
          planned: 1,
          done: 2
        }[b[6]] || b[4] - a[4]).map((b, __k) => {
          const p = PRO[b[1]];
          return <button key={__k} className={`sx-br ${b[6]}`} data-sopen={`b:${b[0]}`}>{leaf(b[4])}<span className="gt-ck"><b>{b[3]}{" × "}{shortN(p)}{b[2] ? ' · ' + b[2] : ''}</b><span>{b[0]}{" · "}{money(b[5])}{" each · "}{money(b[3] * b[5])}</span></span><span className="gt-st" style={css(`--c:${BS[b[6]][1]}`)}>{BS[b[6]][0]}</span></button>;
        })}{LV && !BATCHES.length ? <div className="gv-e"><span>No batches yet</span></div> : ''}{rest()}</div>, <><span>Each batch keeps the cost it was made at</span>{LV ? mk0 && STAFF() ? <button data-smake={mk0}>Make a batch</button> : <span /> : <button data-smake="lts">Make a batch</button>}</>);
      const inc = LV ? LV.COMING : [[INP['blk-hd'].incoming[1], '120 hoodie blanks', 'Heavyweight Supply · ' + money(INP['blk-hd'].incoming[2]), 'm:blk-hd'], [D(10, 28), 'Devore sample', 'Inland Screen Print · 1 of each colour', 'p:gdv'], [D(11, 2), 'Clear Point quote', 'First build, for the pre-orders', 'p:cpt']];
      const coming = cell('s5', 'On the way', <span className="lbl">{LV ? plural(inc.length, 'thing', 'things') : <>{inc.length}{" things"}</>}</span>, <div className="gt-cl">{inc.map(([t, a, b, o], __k) => <button key={__k} className="gt-cr" data-sopen={o}>{t == null ? <span className="leaf"><span /><b>—</b><span /></span> : leaf(t)}<span className="gt-ck"><b>{a}</b><span>{b}</span></span><span className="gt-st" style={css("--c:var(--live)")}>{t == null ? 'No date' : t < NOW ? 'Due' : <>{Math.ceil((t - NOW) / DAY)}{" days"}</>}</span></button>)}{LV && !inc.length ? <div className="gv-e"><span>Nothing on order</span></div> : ''}{rest()}</div>, <><span>Materials count as on hand once they’re checked in</span><span /></>);
      html(document.getElementById('sv'), <>{band(grid, 1)}{band(<>{batches}{coming}</>)}</>);
    }

    /* ══ Orders ════════════════════════════════════════════════════════════════════════════════════════════════════ */
    const cust = o => TOT() ? o[3] ? 'A member' : 'A customer' : o[2] || (o[3] ? 'A member' : 'A customer');
    const ptName = o => POINTS[PICKUP_AT[o[0]]]?.n || (LV ? o[8]?.pickup || 'No pickup point yet' : POINTS[PICKUP_AT[o[0]] || 'mesa'].n);
    // the reference reads Settings' shopbuy limit (ADMIN2.setting('shopbuy'), $250); Settings isn't ported yet
    const BUYCAP = () => LV ? LV.BUYCAP : 250;
    const ordItems = o => o[4].reduce((a, x) => a + x[3], 0);
    const ordTotal = o => o[4].reduce((a, [pid,,, q]) => a + PRO[pid].price * q, 0);
    // live, each line at the cost recorded when it sold (Phase 10d), else today's
    const ordCost = o => o[4].reduce((a, [pid, col, sz, q, rc]) => a + (LV && rc != null ? rc : costOf(PRO[pid], sz || 'M', col)) * q, 0);
    function renderOrders() {
      const F = [['open', 'Open'], ['paid', 'To pack'], ['all', 'All']],
        open = o => !['done'].includes(o[7]);
      const L = ORDERS.filter(o => SP.of === 'all' || (SP.of === 'open' ? open(o) : o[7] === SP.of));
      const list = cell('s12', 'Orders', seg('sof', F, SP.of, 'Which orders'), <div className="sx-ol">{L.length ? Object.keys(OST).map((st, __k) => {
          const A = L.filter(o => o[7] === st).sort((a, b) => a[1] - b[1]);
          return A.length ? <Fragment key={__k}><div className="gv-g">{lbl(`${OST[st][0]} · ${A.length}`)}</div>{A.map((o, __k) => {
              const t = ordTotal(o),
                c = ordCost(o);
              return <button key={__k} className="sx-or" data-sopen={`o:${o[0]}`}><span className="mono sx-oi">#{o[0]}</span><span className="gt-ck"><b>{o[4].map(([pid, col, sz, q]) => `${q > 1 ? q + ' × ' : ''}${shortN(PRO[pid])}${sz ? ' · ' + sz : ''}`).join(', ')}</b><span>{cust(o)}{o[3] ? ' · member' : ''}{" · "}{PAY[o[5]] || o[5]}{" · "}{o[1] ? ago(o[1]) : 'at Totals'}</span></span><span className="sx-of"><b>{o[6] === 'ship' ? 'Shipping' : 'Pickup'}</b><em>{o[6] === 'ship' ? o[7] === 'paid' ? SHIP.label == null ? 'Label not bought' : `${money(SHIP.label)} label` : o[7] === 'refund' ? LV ? 'Refunded' : 'Return label sent' : LV ? (LV.ORDER_COSTS[o[0]]?.label != null ? `${money(LV.ORDER_COSTS[o[0]].label)} label` : 'Shipped') : 'USPS Ground' : ptName(o)}</em></span><span className="sx-om"><b>{money(t)}</b><em>{share(t - c, t)}{" margin"}</em></span></button>;
            })}</Fragment> : '';
        }) : <div className="gv-e"><span>No orders here</span></div>}</div>, <><span>Oldest first in each step</span>{LV && (!STAFF() || !ORDERS.some(o => o[7] === 'paid' && o[6] === 'ship')) ? <span /> : <button data-spack="">{"Print labels for the "}{ORDERS.filter(o => o[7] === 'paid').length}</button>}</>);
      /* an average order, shipped vs picked up: one ruler per kind, each cost a span of it */
      const S = SHOPN,
        avgT = S.rev / S.ord,
        items = S.mat / S.ord,
        fee = avgT * FEE.pct + FEE.fixed;
      const kinds = [['ship', `Shipped · ${S.shipped}`, perOrderSupplies(), LV ? S.labels ? S.ship / S.labels : 0 : SHIP.label - SHIP.charged], ['pickup', `Picked up · ${S.picked}`, pickupSupplies(), 0]].map(([k, t, sup, gap]) => ({
        k,
        t,
        parts: [items, sup, fee, gap],
        kept: avgT - items - sup - fee - gap
      }));
      const PARTS = [['Materials in the items', 'var(--fg)'], ['Mailer, tissue and label', 'color-mix(in srgb,var(--fg) 55%,transparent)'], ['Payment fees', 'color-mix(in srgb,var(--fg) 30%,transparent)'], ['Shipping gap', 'var(--underway)']];
      const SUBS = LV ? [`${S.ord ? (S.items / S.ord).toFixed(1) : 0} items at average cost`, `${money(perOrderSupplies())} shipped · ${money(pickupSupplies())} picked up`, `${(FEE.pct * 100).toFixed(1)}% + ${money(FEE.fixed)} on cards`, S.labels ? `${plural(S.labels, 'label', 'labels')} recorded · ${money(SHIP.charged)} charged` : `No label cost recorded · ${money(SHIP.charged)} charged`] : [`${(S.items / S.ord).toFixed(1)} items at average cost`, `${INPUTS.filter(i => i.kind === 'order').map(i => money(i.avg)).join(' + ')} · pickups take tissue only`, `${(FEE.pct * 100).toFixed(1)}% + ${money(FEE.fixed)}`, `${money(SHIP.label)} label · ${money(SHIP.charged)} charged`];
      const dash = v => v ? `−${money(v)}` : <span className="q">—</span>;
      const per = LV && !S.ord ? cell('s7', 'An average order', <span className="lbl">Last 4 weeks</span>, <div className="gv-e"><span>No orders in the last 4 weeks</span></div>, <><span>Per-order costs come once, however many items</span><span /></>) : cell('s7', 'An average order', <span className="lbl">{money(avgT)}{" · last 4 weeks"}</span>, <div className="sx-ao"><div className="sx-ao-v">{kinds.map((x, __k) => <div key={__k} className="sx-ao-r"><span>{x.t}</span><span className="sx-ao-b">{x.parts.map((v, ix) => v > 0.005 ? <i key={ix} style={css(`flex:${v};background:${PARTS[ix][1]}`)} /> : '')}<i className="kp" style={css(`flex:${x.kept}`)} /></span><b>{money(x.kept)}<em>{(x.kept / avgT * 100).toFixed(0)}% kept</em></b></div>)}</div><div className="sx-at"><div className="hd2"><span />{lbl('Shipped')}{lbl('Picked up')}</div><div className="tot"><span><i /><b>Sale, before tax</b></span><b>{money(avgT)}</b><b>{money(avgT)}</b></div>{PARTS.map(([t, c], ix) => <div key={ix}><span><i style={css(`background:${c}`)} /><b>{t}</b><em>{SUBS[ix]}</em></span><b>{dash(kinds[0].parts[ix])}</b><b>{dash(kinds[1].parts[ix])}</b></div>)}<div className="keep"><span><i /><b>Kept per order</b></span><b>{money(kinds[0].kept)}</b><b>{money(kinds[1].kept)}</b></div></div></div>, <><span>Per-order costs come once, however many items</span><button data-stab="materials">Materials →</button></>);
      /* waiting for pickup: how long each has been held against the 14 days, then where pickups happen */
      const pick = ORDERS.filter(o => o[6] === 'pickup' && o[7] === 'ready').sort((a, b) => a[1] - b[1]),
        pmx = Math.max(...Object.values(POINTS).map(x => x.wk4));
      const saved = S.picked * (perOrderSupplies() - pickupSupplies() + (LV ? S.labels ? S.ship / S.labels : 0 : SHIP.label - SHIP.charged));
      const pk = cell('s5', 'Waiting for pickup', <span className="lbl">{"Held "}{HOLD_DAYS}{" days"}</span>, <div className="gt-cl sx-wl">{pick.map((o, __k) => {
          const dd = Math.round((NOW - (LV ? LV.PICKUP[o[0]]?.readyAt ?? o[1] : o[1])) / DAY);
          return <button key={o[0]} className="gt-cr sx-wr" data-sopen={`o:${o[0]}`}>{leaf(o[1])}<span className="gt-ck"><b>#{o[0]}{" · "}{cust(o)}</b><span>{ptName(o)}{" · "}{o[4].map(([pid,, sz, q]) => `${q > 1 ? q + ' × ' : ''}${shortN(PRO[pid])}${sz ? ' · ' + sz : ''}`).join(', ')}</span></span><span className="sx-hold"><b>{dd}{" of "}{HOLD_DAYS}{" days"}</b><span className="sx-hold-b"><i style={css(`width:${Math.min(100, dd / Math.max(1, HOLD_DAYS) * 100)}%`)} /></span></span></button>;
        })}<div className="gv-g">{lbl('Pickup points · 4 weeks')}</div>{LV && !Object.keys(POINTS).length ? <div className="gv-e"><span>No pickup points yet</span></div> : ''}{Object.entries(POINTS).map(([k, x], __k) => <button key={__k} className="sx-pp" {...(LV ? STAFF() ? { 'data-sopen': `pt:${k}` } : {} : { 'data-sgo': `merchants/shop:${k}` })}><span className="gt-ck"><b>{x.n}</b><span>{LV ? [x.city, x.active === false ? 'not holding orders' : 'partner shop'].filter(Boolean).join(' · ') : <>{x.city}{" · partner shop"}</>}</span></span><span className="sx-pp-b"><i style={css(`width:${x.wk4 / pmx * 100}%`)} /></span><b>{x.wk4}</b></button>)}{rest()}</div>, <><span>{"Pickups saved "}{money(saved)}{" in mailers, labels and shipping"}</span>{LV && STAFF() ? <button data-sopen="pt:">Add a pickup point</button> : <span />}</>);
      html(document.getElementById('sv'), <>{band(list, 1)}{band(<>{per}{pk}</>)}</>);
    }

    /* ══ Panels ════════════════════════════════════════════════════════════════════════════════════════════════════ */
    function ensurePanel() {
      let pn = document.getElementById('spanel');
      if (!pn) {
        const sc = document.createElement('div');
        sc.id = 'sscrim';
        sc.className = 'scrim';
        document.body.appendChild(sc);
        pn = document.createElement('aside');
        pn.id = 'spanel';
        pn.className = 'panel spanel';
        document.body.appendChild(pn);
      }
      return pn;
    }
    function renderPanel() {
      const pn = ensurePanel(),
        P = SP.panel;
      if (!P) {
        document.body.classList.remove('pn');
        return;
      }
      document.body.classList.add('pn');
      const [k, id] = P.split(':');
      html(pn, k === 'p' ? prodPanel(PRO[id]) : k === 'm' ? matPanel(INP[id]) : k === 's' ? supPanel(SUP[id]) : k === 'b' ? batchPanel(id) : k === 'mk' ? makePanel(id) : k === 'o' ? ordPanel(id) : LV && k === 'se' ? supEdit(id) : LV && k === 'pt' ? pointPanel(id) : '');
      if (k === 'p') refreshProd();
      if (k === 'm') refreshBuy();
      if (k === 'mk') refreshMake();
    }
    const phd = k => <div className="pn-hd"><span className="lbl">{k}</span><button className="x" data-sclose="" aria-label="Close">{ICO.x}</button></div>;
    const numIn = (id, v, more = '', step = '0.01') => <input className="vin sx-in" id={id} inputMode="decimal" defaultValue={v} {...attrs(more)} />;

    /* product: build the cost from materials or give one cost; price and margin work both ways */
    function prodPanel(p) {
      if (!SP.draft || SP.draft.id !== p.id) SP.draft = {
        id: p.id,
        mode: p.recipe ? 'recipe' : 'flat',
        recipe: (p.recipe || []).map(r => [...r]),
        flat: p.flat ?? (p.recipe ? recipeCost(p.recipe, 'M', p.cols[0]) : 0),
        est: !!p.est,
        price: p.price
      };
      const d = SP.draft,
        ro = !STAFF() ? 'disabled' : '';
      const opts = Object.keys(KIND).filter(k => k !== 'order').map((k, __k) => <optgroup key={__k} label={KIND[k][0]}>{INPUTS.filter(i => i.kind === k && !d.recipe.some(r => r[0] === i.id)).map((i, __k) => <option key={__k} value={i.id}>{i.n}{" · "}{money(i.avg)}</option>)}</optgroup>);
      const recipe = <div className="sx-rc">{d.recipe.map(([id, q], ix) => {
          const i = INP[id];
          return <div key={ix} className="sx-rc-r"><span className="gt-ck"><b>{i.n}</b><span><span className={`sx-kd ${i.kind}`}>{KIND[i.kind][0]}</span>{" "}{money(i.avg)}{" per "}{i.unit}{i.var ? ` · ${Object.entries(i.var).map(([k, v]) => `${k} +${money(v)}`).join(', ')}` : ''}</span></span><label className="sx-f">{lbl('Amount')}{numIn('sam' + ix, q, `data-sam="${ix}" ${ro}`)}</label><span className="sx-x">×</span><label className="sx-f">{lbl('Cost')}{numIn('slc' + ix, fx(q * i.avg), `data-slc="${ix}" ${ro}`)}</label><button className="sx-rm" data-srm={ix} aria-label={`Remove ${i.n}`} {...attrs(ro)}>{ICO.x}</button></div>;
        })}<div className="sx-rc-add"><select id="saddsel" className="vin" {...attrs(ro)}><option value="">Add a material from the library…</option>{opts}</select><button className="btn sm-b" data-saddm="" {...attrs(ro)}>Add</button><button className="btn sm-b" data-snewm="" {...attrs(ro)}>New material</button></div></div>;
      const flat = <div className="sx-fl"><label className="sx-f wide">{lbl('Cost per product')}{numIn('sflat', fx(d.flat), `data-sflat ${ro}`)}</label><label className="sx-chk"><input type="checkbox" id="sest" {...attrs(d.est ? 'checked' : '')} {...attrs(ro)} />{" It’s an estimate"}</label><p className="bpn-n">{p.note || 'Use one cost when the product is bought finished or quoted as a whole. Switch to materials to see what goes into it.'}</p></div>;
      return <>{phd(`${LINES[p.line][0]} · ${SHELF[p.st][0]}`)}<><div className="pn-b"><div className="sx-ph">{glyph(p, 'lg')}<div><p className="bpn-t">{nv(p)}</p><p className="bpn-s">{p.cols.join(', ')}{" · "}{u4(p)}{" "}{p.dep ? 'pre-ordered' : 'sold'}{" in 4 weeks"}{p.why ? ' · ' + p.why : ''}</p></div></div><div><div className="sx-sh">{lbl('What it costs to make')}{seg('smode', [['recipe', 'From materials'], ['flat', 'One cost']], d.mode, 'How it’s costed')}</div>{d.mode === 'recipe' ? recipe : flat}</div><div className="sx-pmw"><label className="sx-f">{lbl('Price')}{numIn('sprice', fx(d.price), `data-sprice ${ro}`)}</label><span className="sx-x">↔</span><label className="sx-f">{lbl('Margin %')}{numIn('smarg', '', `data-smarg ${ro}`)}</label><div className="sx-pmo" id="spsum" /></div><div id="spsize" />{LV ? prodLive(p, d) : ''}<p className="bpn-n">Average costs of what’s on hand. Batches already made keep the cost they were made at.</p></div><div className="pn-ft">{STAFF() ? <><button className="btn" data-smake={p.id} {...attrs(p.dep || LV && !STK[p.id] ? 'disabled' : '')}>Make a batch</button><button className="btn p" data-ssave={p.id}>Save</button></> : <span className="small quiet" style={css("margin-right:auto")}>Read-only</span>}</div></></>;
    }
    /* ── live: what the old Shop page did from a product, in the redesign's panel ── */
    const qn = n => Number(n).toLocaleString('en-US', {
      maximumFractionDigits: 3
    });
    const ledRow = (k, v, key) => <div key={key ?? k}><span>{k}</span><b>{v}</b></div>;
    const acts = (...b) => <div className="sx-rc-add" style={css("flex-wrap:wrap")}>{b.filter(Boolean).map((x, k) => <Fragment key={k}>{x}</Fragment>)}</div>;
    const zbtn = (z, t, p) => <button className={`btn sm-b${p ? ' p' : ''}`} {...z}>{t}</button>;
    const PRE_T = {
      held: 'Deposit held',
      signup: 'Needs sign-up',
      agreement: 'Needs agreement'
    };
    /** Live, one cost's own figure for a colour or size (`flat-override`): set once the product has its one cost saved. */
    function flatX(p, fl, ed) {
      const ov = fl?.overrides ?? [],
        saved = p.src === 'flat' && !!fl;
      const cols = Object.keys(STK[p.id] || {}).filter(Boolean),
        sized = !p.one,
        can = cols.length > 1 || sized;
      if (!ov.length && !(ed && can)) return '';
      if (!saved) return <div>{lbl('One cost, by colour or size')}<p className="bpn-n" style={css('margin-top:8px')}>Save the one cost first, then a colour or size can have its own.</p></div>;
      const vname = o => [o.option, o.size].filter(Boolean).join(' · ');
      return <div>{lbl(`One cost, by colour or size · ${ov.length}`)}<div className="led">{ov.length ? ov.map((o, k) => <div key={k}><span>{vname(o)}</span><b>{money(o.cost)}{ed ? <>{" "}<button className="lnk3" data-za="flat-override" data-zbody={JSON.stringify({
              product: p.id,
              option: o.option || '',
              size: o.size || '',
              remove: true
            })} data-zsaid={`${vname(o)} costs ${money(fl.cost)} again, as the rest`}>Take off</button></> : ''}</b></div>) : ledRow(`Every colour and size costs ${money(fl.cost)}`, '')}</div>{ed && can ? acts(cols.length > 1 ? <select className="vin" id="sfocol" style={css('flex:1;min-width:110px;margin-top:0')} defaultValue=""><option value="">Any colour</option>{cols.map(c => <option key={c} value={c}>{c}</option>)}</select> : '', sized ? <select className="vin" id="sfosize" style={css('flex:1;min-width:90px;margin-top:0')} defaultValue=""><option value="">Any size</option>{SIZES.map(z => <option key={z} value={z}>{z}</option>)}</select> : '', <label className="sx-f sm" style={css('width:84px')}><input className="vin sx-in" id="sfocost" inputMode="decimal" placeholder="0.00" style={css('margin-top:0')} aria-label="Its cost" /></label>, <button className="btn sm-b" data-sfoadd={p.id}>Add</button>) : ''}</div>;
    }
    function prodLive(p, d) {
      const c = LV.CATALOG[p.id],
        ed = STAFF() && p.st !== 'arch',
        r = LV.RECIPES[p.id],
        fl = LV.FLAT[p.id];
      const zs = k => ({
          'data-zs': k,
          'data-zid': p.id
        }),
        zc = (k, more = {}) => ({
          'data-zc': k,
          'data-zid': p.id,
          ...more
        }),
        zk = (k, more = {}) => ({
          'data-zk': k,
          'data-zid': p.id,
          ...more
        });
      const ch = LV.COST_HIST[p.id] || [],
        hist = (LV.SHIST[p.id] || []).slice(0, 6),
        pre = LV.PRE.filter(x => x[2] === p.id);
      const ovs = r?.overrides || [];
      const stock = STK[p.id] && !p.dep ? <div>{lbl('Stock')}<div className="led">{Object.entries(STK[p.id]).map(([col, v]) => ledRow(col || 'One size', p.one ? `${v[0] ?? 0} on hand` : SIZES.map((sz, ix) => `${sz} ${v[ix] ?? 0}`).join(' · '), col))}</div>{ed ? acts(zbtn(zs('restock'), 'Restock')) : ''}</div> : '';
      const preorders = p.dep ? <div>{lbl(`Pre-orders · ${pre.length}`)}<div className="led">{pre.length ? pre.map(x => <div key={x[0]}><span>{STAFF() ? <button className="lnk3" data-zs="preorder" data-zid={x[0]}>{x[1] || 'A shop'}</button> : x[1] || 'A shop'}{` · ${x[4]} × ${x[3] || p.v || p.n}`}</span><b>{PRE_T[x[5]] || x[5]}{x[6] ? ` · ${fmtD(x[6])}` : ''}</b></div>) : ledRow('None yet', '')}</div></div> : '';
      const lines = r?.lines || [];
      const linesX = ed && d.mode === 'recipe' && lines.length ? <div>{lbl('Each line in full')}<div className="led">{lines.map(l => <div key={l.input}><span><button className="lnk3" {...zc('line', {
              'data-zcid': l.input
            })}>{INP[l.input]?.n ?? l.input}</button>{l.note ? ` · ${l.note}` : ''}</span><b>{l.amount == null ? 'No amount' : `${qn(l.amount)} ${INP[l.input]?.unit ?? ''}`}{l.entered === 'cost' ? ' · entered as a cost' : ''}{" · "}{money(l.cost ?? 0)}</b></div>)}</div>{acts(zbtn(zc('line'), 'A line with a note…'))}</div> : '';
      const recipeX = d.mode === 'recipe' && p.recipe ? <div>{lbl(`For a colour or size · ${ovs.length}`)}<div className="led">{ovs.length ? ovs.map((o, k) => <div key={k}><span>{ed ? <button className="lnk3" {...zc('override', {
                'data-zcid': o.input,
                'data-zopt': o.option,
                'data-zsize': o.size
              })}>{INP[o.input]?.n ?? o.input}</button> : INP[o.input]?.n ?? o.input}{` · ${[o.option, o.size].filter(Boolean).join(' ')}`}</span><b>{o.amount == null ? 'No amount' : `${qn(o.amount)} ${INP[o.input]?.unit ?? ''}`}{" · "}{money(o.cost ?? 0)}</b></div>) : ledRow('Every colour and size uses the recipe', '')}</div>{ed ? acts(zbtn(zc('override'), 'For a colour or size'), zbtn(zc('copy'), 'Copy to other products')) : ''}</div> : d.mode === 'flat' ? flatX(p, fl, ed) : '';
      const atSale = ch.length ? <div>{lbl('Cost at sale')}<div className="led">{ledRow('Now', money(costOf(p)))}{ch.slice(0, 8).map(w => ledRow(fmtD(w.week), `${w.low === w.high ? money(w.low) : `${money(w.low)}–${money(w.high)}`} · ${w.units} sold${w.later ? ' · costed later' : ''}`, w.week))}</div></div> : '';
      const shows = p.st === 'on' ? p.dep ? 'Pre-order' : c?.ships && c?.sellPastStock ? `Pre-order · ships ${c.ships}` : 'In stock' : p.st === 'off' ? 'Back soon' : p.st === 'draft' ? 'Hidden' : 'Removed';
      const shelf = <div>{lbl('On the shelf')}<div className="led">{ledRow('Page', `useclear.org/shop/${p.slug || ''}`)}{ledRow('Shows as', shows)}{p.why ? ledRow('Why', p.why) : ''}</div>{STAFF() ? acts(p.st === 'arch' ? zbtn(zs('restore'), 'Restore as a draft') : p.st === 'on' ? zbtn(zs('shelf-off'), 'Take off the shelf') : zbtn(zs('shelf-on'), 'Put on the shelf'), p.st !== 'arch' ? zbtn(zs('archive'), 'Archive') : '', p.st !== 'arch' && !c ? zbtn(zs('edit'), 'Edit the name and price') : '') : ''}</div>;
      let store = '';
      if (c) {
        const hw = c.section === 'for-shops',
          imgs = c.images || [],
          cols = c.colours || [];
        store = <div>{lbl('On the store')}<div className="led">{ledRow('Name', c.title)}{ledRow('Under the name', c.tagline || '—')}{ledRow('Price', hw ? `${money(c.price)} · reserved with a deposit` : money(c.price))}{ledRow('Shelves', [c.category, ...(c.alsoIn || [])].filter(Boolean).join(' · ') || '—')}{ledRow(hw ? 'Reserved for' : 'Ships', c.ships || '—')}{ledRow('Packed weight', c.weightOz ? `${c.weightOz} oz` : '—')}{ledRow('When it runs out', c.sellPastStock ? 'Keeps selling, made to order' : 'Shows sold out')}</div>{lbl(`Photos · ${imgs.length}`)}<div className="led">{imgs.length ? imgs.map((im, k) => <div key={im.src}><span style={css("display:flex;align-items:center;gap:10px;min-width:0")}><img src={im.src} alt="" width={40} height={40} style={css("width:40px;height:40px;object-fit:cover;flex:none;box-shadow:inset 0 0 0 1px var(--line)")} />{im.alt || 'No description'}{k === 0 ? ' · first' : ''}</span><b>{ed ? <>{k > 0 ? <button className="lnk3" data-za="photo-move" data-zbody={JSON.stringify({
                id: p.id,
                src: im.src,
                to: 0
              })} data-zsaid="It’s the first photo now">First</button> : ''}{" "}<button className="lnk3" {...zk('photo', {
                'data-zsrc': im.src
              })}>Describe</button>{" "}<button className="lnk3" data-za="photo-remove" data-zbody={JSON.stringify({
                id: p.id,
                src: im.src
              })} data-zsaid="Taken off the store">Take off</button></> : ''}</b></div>) : ledRow('None yet: the shop draws it until there are', '')}</div>{cols.length ? <>{lbl(`Colours · ${cols.length}`)}<div className="led">{cols.map(col => <div key={col.id}><span><i className="sx-sw" style={css(`background:${col.swatch}`)} />{" "}{col.label}</span><b>{ed && cols.length > 1 ? <button className="lnk3" {...zk('colour-remove', {
                'data-zcol': col.id
              })}>Take off</button> : col.swatch}</b></div>)}</div></> : ''}{lbl(c.variantLabel || 'Options')}<div className="led">{(c.variants || []).map(v => <div key={v.id}><span>{ed ? <button className="lnk3" {...zk('variant', {
                'data-zvar': v.id
              })}>{v.label}</button> : v.label}</span><b>{v.deposit != null ? `${money(v.deposit)} now · ${money(v.price ?? c.price)}` : money(v.price ?? c.price)}{" · "}{v.soldOut ? 'Sold out' : v.onHand == null ? '—' : `${v.onHand} on hand`}</b></div>)}</div>{ed ? acts(zbtn(zk('details'), 'Edit on the store'), <label className="btn sm-b" style={css("cursor:pointer")}>{"Add photos"}<input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden data-zphotos={p.id} /></label>, cols.length ? zbtn(zk('colour'), 'Add a colour') : zbtn(zk('option'), 'Add an option'), <button className="btn sm-b" data-zsell={p.id}>{c.sellPastStock ? 'Stop at what’s on hand' : 'Keep selling at 0'}</button>) : ''}</div>;
      }
      const history = hist.length ? <div>{lbl('History')}<div className="led">{hist.map(([t, w, who], k) => ledRow(fmtD(t), `${w}${who ? ' · ' + who : ''}`, k))}</div></div> : '';
      return <>{linesX}{recipeX}{atSale}{stock}{preorders}{shelf}{store}{history}</>;
    }
    /* live: a material's buys on order, its stock ledger, its supplier and the library's flows */
    const REASON = {
      purchase: 'Bought',
      run: 'Used in a batch',
      order: 'Packed an order',
      adjust: 'Counted',
      waste: 'Written off'
    };
    function matLive(i) {
      const r = i.raw,
        ed = STAFF(),
        oo = LV.onOrder[i.id]?.rows ?? [],
        moves = (r.moves ?? []).slice(0, 8);
      const zc = k => ({
        'data-zc': k,
        'data-zcid': i.id
      });
      // what it costs more in a size or a colour (`input-extra`): not for once-per-order supplies, which no recipe uses
      const ex = r.extras ?? [],
        cols = [...new Set(PR.flatMap(p => p.cols).filter(c => c && c !== 'One size'))];
      const extras = i.kind === 'order' ? '' : <div>{lbl(`Costs more in · ${ex.length}`)}<div className="led">{ex.length ? ex.map(x => <div key={x.size || x.option}><span>{x.size || x.option}</span><b>{`+${money(x.extra)}`}{ed && !i.archived ? <>{" "}<button className="lnk3" data-za="input-extra" data-zbody={JSON.stringify({
              input: i.id,
              size: x.size || '',
              option: x.option || '',
              remove: true
            })} data-zsaid={`${i.n} costs the same in ${x.size || x.option} now`}>Take off</button></> : ''}</b></div>) : ledRow('The same in every size and colour', '')}</div>{ed && !i.archived ? acts(<select className="vin" id="sxfor" style={css('flex:1;min-width:120px;margin-top:0')} defaultValue=""><option value="">A size or colour…</option><optgroup label="Size">{SIZES.filter(z => !ex.some(x => x.size === z)).map(z => <option key={z} value={`s:${z}`}>{z}</option>)}</optgroup>{cols.length ? <optgroup label="Colour">{cols.filter(c => !ex.some(x => x.option === c)).map(c => <option key={c} value={`o:${c}`}>{c}</option>)}</optgroup> : ''}</select>, <label className="sx-f sm" style={css('width:84px')}><input className="vin sx-in" id="sxamt" inputMode="decimal" placeholder="+0.00" style={css('margin-top:0')} aria-label="What it adds" /></label>, <button className="btn sm-b" data-sxadd={i.id}>Add</button>) : ''}</div>;
      return <>{oo.length ? <div>{lbl(`On order · ${oo.length}`)}<div className="led">{oo.map(o => <div key={o.id}><span>{fmtD(o.orderedAt)}{` · ${qn(o.quantity)} ${i.unit} · ${o.supplierName || 'No supplier'}`}</span><b>{money(o.total)}{o.due ? ` · due ${fmtD(o.due)}` : ''}</b></div>)}</div>{ed ? oo.map(o => <Fragment key={o.id}>{acts(<button className="btn sm-b p" data-za="receive" data-zbody={JSON.stringify({
              id: o.id
            })} data-zsaid="Received · on hand and the average updated">{oo.length > 1 ? `Received · ordered ${fmtD(o.orderedAt)}` : 'Mark it received'}</button>, <button className="btn sm-b" data-za="order-cancel" data-zbody={JSON.stringify({
              id: o.id
            })} data-zsaid="Cancelled">{oo.length > 1 ? 'Cancel that one' : 'Cancel the order'}</button>)}</Fragment>) : ''}</div> : ''}{r.stocked ? <div>{lbl('Stock ledger')}<div className="led">{moves.length ? moves.map((m, k) => ledRow(fmtD(m.at), `${REASON[m.reason] ?? m.reason} · ${m.quantity > 0 ? '+' : '−'}${qn(Math.abs(m.quantity))} ${i.unit}`, k)) : ledRow('No moves yet', '')}</div>{ed && !i.archived ? acts(zbtn(zc('count'), 'Count stock'), zbtn(zc('waste'), 'Write off')) : ''}</div> : ''}{extras}{ed ? <div>{lbl('In the library')}<div className="led"><div><span>Supplier</span><b>{SUPPLIERS.length ? <select className="vin" data-zsup={i.id} defaultValue={i.sup}><option value="">None</option>{SUPPLIERS.map(x => <option key={x.id} value={x.id}>{x.n}</option>)}</select> : 'No suppliers yet'}</b></div>{!i.archived ? <div><span>Kind</span><b><select className="vin" data-zkind={i.id} defaultValue={i.kind}>{Object.keys(KIND).map(k => <option key={k} value={k} disabled={k === 'stock' && r.kind !== 'material'}>{KIND[k][0]}</option>)}</select></b></div> : ''}{!i.archived && i.kind === 'order' ? <><div><span>Counted on hand</span><b><label className="sx-chk"><input type="checkbox" data-zkst={i.id} defaultChecked={!!r.stocked} /></label></b></div><div><span>Pickups use one too</span><b><label className="sx-chk"><input type="checkbox" data-zkpk={i.id} defaultChecked={!!r.onPickup} /></label></b></div></> : ''}</div>{acts(zbtn(zc('input'), 'Edit'), !i.archived && i.kind !== 'mto' ? zbtn(zc('purchase'), 'A buy with its date and note…') : '', !i.archived ? zbtn(zc('apply'), 'Add to products…') : '', zbtn(zc('archive'), i.archived ? 'Restore' : 'Archive'))}</div> : ''}</>;
    }
    function draftCost(size = 'M', col) {
      const d = SP.draft,
        p = PRO[d.id];
      return d.mode === 'recipe' ? recipeCost(d.recipe, size, col || p.cols[0]) : d.flat;
    }
    function refreshProd(skip) {
      const d = SP.draft,
        p = PRO[d.id],
        pn = document.getElementById('spanel');
      if (!pn) return;
      const c = draftCost(),
        m = d.price ? (d.price - c) / d.price : 0;
      if (LV && p.nc && d.mode === 'flat' && !d.flat) {
        html(pn.querySelector('#spsum'), <span><b>—</b><em>Not costed yet · type its cost, or build it from materials</em></span>);
        html(pn.querySelector('#spsize'), '');
        return;
      }
      const mi = pn.querySelector('#smarg');
      if (mi && skip !== 'smarg') mi.value = (m * 100).toFixed(1);
      const pi = pn.querySelector('#sprice');
      if (pi && skip !== 'sprice') pi.value = fx(d.price);
      html(pn.querySelector('#spsum'), <><span><b className={d.est && d.mode === 'flat' ? 'est' : ''}>{money(c)}</b><em>cost at a medium{d.est && d.mode === 'flat' ? ' · estimate' : ''}</em></span><span><b>{money(d.price - c)}</b><em>kept per item</em></span><span><b className={m < TARGET ? 'bad' : 'ok'}>{(m * 100).toFixed(1)}%</b><em>{m < TARGET ? `${money(priceFor(c, TARGET))} hits ${TARGET * 100}%` : `clears ${TARGET * 100}%`}</em></span>{STAFF() && m < TARGET ? <button className="lnk3" data-starget="">{"Use "}{money(Math.ceil(priceFor(c, TARGET)))}</button> : ''}</>);
      const cols = oneSize(p) || d.mode === 'flat' ? null : [...new Set([p.cols[0], ...p.cols.filter(cl => d.recipe.some(([id]) => (INP[id].var || {})[cl]))])];
      html(pn.querySelector('#spsize'), cols ? <div className="sx-sz">{lbl('By size')}{cols.map((cl, __k) => <div key={__k} className="sx-sz-r"><span className="sx-sz-c"><i className={`sx-sw ${cl.toLowerCase()}`} />{cl}</span>{SIZES.map((s, __k) => {
            const cs = draftCost(s, cl),
              ms = (d.price - cs) / d.price;
            return <span key={__k} className={`sx-sz-v ${ms < TARGET ? 'bad' : ''}`}><em>{s}</em><b>{(ms * 100).toFixed(0)}%</b><i>{money(cs)}</i></span>;
          })}</div>)}</div> : '');
    }

    /* material: what it costs, recording a buy (paid and units, or a cost each), and where it's used */
    function matPanel(i) {
      const s = SUP[i.sup],
        ps = usedIn(i.id),
        ro = !STAFF() ? 'disabled' : '';
      if (!SP.buy || SP.buy.id !== i.id) SP.buy = {
        id: i.id,
        units: '',
        paid: '',
        per: fx(i.last)
      };
      const rows = [['Kind', KIND[i.kind][0]], ['Supplier', <><button className="lnk3" data-sopen={`s:${s.id}`}>{s.n}</button>{" · "}{leadT(s)}</>], ['Average cost', `${money(i.avg)} per ${i.unit}`], ['Last paid', money(i.last)], ...(i.var && !LV ? [['Costs more', Object.entries(i.var).map(([k, v]) => `${k} +${money(v)}`).join(' · ')]] : []), ...(i.kind !== 'mto' ? [['On hand', `${int(i.hand)} · uses ${useWk(i).toFixed(1)} a week`], ['Lasts', lastsW(i) === null ? '—' : `${lastsW(i).toFixed(1)} weeks · reorder under ${needW(i).toFixed(1)}`]] : [])];
      const others = PR.filter(p => p.recipe && !p.recipe.some(r => r[0] === i.id) && p.st !== 'arch');
      return <>{phd(`Material · ${KIND[i.kind][0]}`)}<><div className="pn-b"><div><p className="bpn-t">{i.n}</p><p className="bpn-s">{i.note || s.what}</p></div><div className="led">{rows.map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div><div>{lbl(i.kind === 'mto' ? 'New price' : 'Record a buy')}<div className="sx-buy">{i.kind === 'mto' ? '' : <><label className="sx-f">{lbl('Paid')}{numIn('bpaid', SP.buy.paid, `data-bpaid ${ro} placeholder="0.00"`)}</label><span className="sx-x">÷</span><label className="sx-f">{lbl('Units')}{numIn('bunits', SP.buy.units, `data-bunits ${ro} placeholder="0"`)}</label><span className="sx-x">=</span></>}<label className="sx-f">{lbl('Each')}{numIn('bper', SP.buy.per, `data-bper ${ro}`)}</label></div><div id="sbprev" /></div><div>{lbl(`Used in · ${ps.length}`)}<div className="led sx-ui">{ps.length ? ps.map((p, __k) => {
                  const q = p.recipe.find(r => r[0] === i.id)[1];
                  return <div key={__k}><span><button className="lnk3" data-sopen={`p:${p.id}`}>{shortN(p)}</button></span><b>{q}{" × "}{money(i.avg)}{" = "}{money(q * i.avg)}{" · "}{share(q * i.avg, costOf(p))}{" of its cost"}</b></div>;
                }) : <div><span>Not in any product yet</span><b /></div>}</div>{STAFF() && i.kind !== 'order' && others.length && !i.archived ? <div className="sx-rc-add"><select id="sapplyp" className="vin">{others.map((p, __k) => <option key={__k} value={p.id}>{nv(p)}</option>)}</select><label className="sx-f sm">{numIn('sapplyq', 1, '')}</label><button className="btn sm-b" data-sapply={i.id}>Add to it</button></div> : ''}</div>{i.buys ? <div>{lbl('Buys')}<div className="led">{i.buys.slice().reverse().map(([t, u, v], __k) => <div key={__k}><span>{fmtD(t)}{" · "}{int(u)}{" "}{i.unit}s</span><b>{money(v)}{" · "}{money(v / u)}{" each"}</b></div>)}{i.incoming && !LV ? <div><span>{fmtD(i.incoming[1])}{" · "}{i.incoming[0]}{" on the way"}</span><b>{money(i.incoming[2])}{" · "}{money(i.incoming[2] / i.incoming[0])}{" each"}</b></div> : ''}</div></div> : ''}{LV ? matLive(i) : ''}</div><div className="pn-ft">{STAFF() && !i.archived ? <>{i.kind !== 'mto' ? <button className="btn" data-sorder={i.id}>Order more</button> : ''}<button className="btn p" data-sbuy={i.id}>{i.kind === 'mto' ? 'Save the price' : 'Record the buy'}</button></> : LV && STAFF() ? <button className="btn" data-sclose="">Close</button> : <span className="small quiet" style={css("margin-right:auto")}>Read-only</span>}</div></></>;
    }
    function refreshBuy(skip) {
      const b = SP.buy,
        i = INP[b.id],
        pn = document.getElementById('spanel');
      if (!pn) return;
      const units = parseFloat(b.units) || 0,
        per = parseFloat(b.per) || 0,
        paid = parseFloat(b.paid) || 0;
      if (skip === 'bpaid' || skip === 'bunits') {
        if (units && paid) {
          b.per = fx(paid / units);
          const e = pn.querySelector('#bper');
          if (e) e.value = b.per;
        }
      }
      if (skip === 'bper' && units) {
        b.paid = fx(units * per);
        const e = pn.querySelector('#bpaid');
        if (e) e.value = b.paid;
      }
      const p2 = parseFloat(b.per) || 0,
        u2 = parseFloat(b.units) || 0;
      const na = i.kind === 'mto' ? p2 : u2 ? (i.avg * i.hand + u2 * p2) / (i.hand + u2) : i.avg;
      const ps = usedIn(i.id);
      html(pn.querySelector('#sbprev'), <div className="sx-bp"><span><b>{money(na)}</b><em>{i.kind === 'mto' ? 'new price' : u2 ? `new average · was ${money(i.avg)}` : 'enter units to see the new average'}</em></span>{ps.length ? <div className="led">{ps.map((p, __k) => {
            const q = p.recipe.find(r => r[0] === i.id)[1],
              was = marginOf(p),
              now = (p.price - (costOf(p) + q * (na - i.avg))) / p.price;
            return <div key={__k}><span>{shortN(p)}</span><b className={now < TARGET ? 'bad' : ''}>{(was * 100).toFixed(1)}{"% → "}{(now * 100).toFixed(1)}%</b></div>;
          })}</div> : ''}</div>);
    }
    function supPanel(s) {
      const ms = INPUTS.filter(i => i.sup === s.id);
      return <>{phd('Supplier')}<><div className="pn-b"><div><p className="bpn-t">{s.n}</p><p className="bpn-s">{s.what}{" · "}{s.city}</p></div><div className="led">{[['Lead time', leadT(s)], ['Terms', s.terms], ['Minimum', s.min], ['Last order', s.last ? fmtD(s.last) : '—']].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div><div>{lbl('Price breaks')}<div className="sx-brk">{LV && !s.breaks.length ? <span><b>None</b><em>List price</em></span> : ''}{s.breaks.map(([q, d], __k) => <span key={__k}><b>{q}+</b><em>{d ? `−${Math.round(d * 100)}%` : 'List price'}</em></span>)}</div></div><div>{lbl(`What we buy · ${ms.length}`)}<div className="led">{ms.map((i, __k) => <div key={__k}><span><button className="lnk3" data-sopen={`m:${i.id}`}>{i.n}</button></span><b>{money(i.avg)}{" per "}{i.unit}</b></div>)}</div></div></div><div className="pn-ft"><button className="btn" data-sclose="">Close</button>{LV && STAFF() && !s.none ? <button className="btn p" data-sopen={`se:${s.id}`}>Edit</button> : ''}</div></></>;
    }
    /* ── live: a supplier added or edited (`supplier`), with its price breaks (`supplier-breaks`) ── */
    const grid = (cols, kids) => <div style={css(`display:grid;grid-template-columns:${cols};gap:10px;align-items:end`)}>{kids}</div>;
    const txtIn = (label, key, v, more = {}) => <label className="sx-f wide">{lbl(label)}<input className="vin sx-in" defaultValue={v ?? ''} autoComplete="off" {...key} {...more} /></label>;
    function supEdit(id) {
      const s = id ? SUP[id] : null,
        raw = s?.raw;
      if (!SP.se || SP.se.id !== id) SP.se = {
        id,
        name: raw?.name ?? '',
        city: raw?.city ?? '',
        sells: raw?.sells ?? '',
        lead: raw?.leadDays ?? '',
        terms: raw?.terms ?? '',
        minimum: raw?.minimum ?? '',
        note: raw?.note ?? '',
        breaks: (s?.breaks ?? []).map(([q, d]) => [String(q), String(Math.round(d * 10000) / 100)])
      };
      const e = SP.se,
        f = (label, k, more) => txtIn(label, { 'data-sef': k }, e[k], more);
      return <>{phd(id ? 'Supplier · edit' : 'Supplier · new')}<><div className="pn-b"><div><p className="bpn-t">{id ? s.n : 'Add a supplier'}</p><p className="bpn-s">{id ? 'Its details and price breaks. Every material it sells uses them.' : 'Who sells us materials. Its lead time sets when to reorder; its price breaks what a bigger order costs.'}</p></div>{grid('minmax(0,1fr) minmax(0,1fr)', <>{f('Name', 'name')}{f('City', 'city')}</>)}{f('What they sell', 'sells')}{grid('minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)', <>{f('Lead time · days', 'lead', { inputMode: 'numeric' })}{f('Terms', 'terms')}{f('Minimum', 'minimum')}</>)}{f('Note', 'note')}<div>{lbl('Price breaks')}<div className="sx-rc">{e.breaks.length ? e.breaks.map(([q, d], ix) => <div key={ix} className="sx-rc-r" style={css('grid-template-columns:minmax(0,1fr) minmax(0,1fr) 28px')}><label className="sx-f">{lbl('From · units')}<input className="vin sx-in" inputMode="decimal" defaultValue={q} data-sbq={ix} /></label><label className="sx-f">{lbl('Off · %')}<input className="vin sx-in" inputMode="decimal" defaultValue={d} data-sbd={ix} /></label><button className="sx-rm" data-sbrm={ix} aria-label="Take this break off">{ICO.x}</button></div>) : <div className="sx-rc-r" style={css('grid-template-columns:minmax(0,1fr)')}><span className="bpn-n">None: list price at any quantity.</span></div>}<div className="sx-rc-add"><button className="btn sm-b" data-sbadd="">Add a break</button></div></div></div><p className="bpn-n">A break takes its percentage off a whole order of that many or more.</p></div><div className="pn-ft"><button className="btn" {...(id ? { 'data-sopen': `s:${id}` } : { 'data-sclose': '' })}>Cancel</button><button className="btn p" data-sesave="">{id ? 'Save' : 'Add the supplier'}</button></div></></>;
    }
    /** What's typed in the supplier's panel, kept as it's typed so adding a break doesn't lose it. */
    function seRead() {
      const pn = document.getElementById('spanel');
      if (!pn || !SP.se) return;
      pn.querySelectorAll('[data-sef]').forEach(x => SP.se[x.dataset.sef] = x.value);
      pn.querySelectorAll('[data-sbq]').forEach(x => SP.se.breaks[+x.dataset.sbq][0] = x.value);
      pn.querySelectorAll('[data-sbd]').forEach(x => SP.se.breaks[+x.dataset.sbd][1] = x.value);
    }
    /* ── live: a pickup point added or edited (`pickup-point`) ── */
    function pointPanel(id) {
      const x = id ? POINTS[id] : null;
      if (!SP.pt || SP.pt.id !== id) SP.pt = {
        id,
        name: x?.n ?? '',
        city: x?.city ?? '',
        active: x ? x.active !== false : true
      };
      const e = SP.pt;
      return <>{phd(id ? 'Pickup point · edit' : 'Pickup point · new')}<><div className="pn-b"><div><p className="bpn-t">{id ? x.n : 'Add a pickup point'}</p><p className="bpn-s">{`A partner shop that holds orders for ${HOLD_DAYS ? plural(HOLD_DAYS, 'day', 'days') : 'Settings’ hold'} until they’re picked up.`}</p></div>{grid('minmax(0,1fr) minmax(0,1fr)', <>{txtIn('Name', { 'data-ptf': 'name' }, e.name)}{txtIn('City', { 'data-ptf': 'city' }, e.city)}</>)}<label className="sx-chk"><input type="checkbox" data-ptf="active" defaultChecked={e.active} />{" Holding orders now"}</label>{x ? <div className="led">{ledRow('Holding now', plural(x.held ?? 0, 'order', 'orders'))}{ledRow('Last 4 weeks', plural(x.wk4 ?? 0, 'order', 'orders'))}</div> : ''}<p className="bpn-n">{id ? 'A new name shows on every order held there. One that isn’t holding orders keeps the ones it has.' : 'It shows as a choice for each order picked up.'}</p></div><div className="pn-ft"><button className="btn" data-sclose="">Cancel</button><button className="btn p" data-sptsave="">{id ? 'Save' : 'Add the point'}</button></div></></>;
    }
    function batchPanel(id) {
      if (LV) return batchPanelLive(id);
      const b = BATCHES.find(x => x[0] === id),
        p = PRO[b[1]];
      const need = (p.recipe || []).map(([iid, q]) => {
        const i = INP[iid];
        return [i, q * b[3]];
      });
      return <>{phd(`Batch ${b[0]}`)}<><div className="pn-b"><div><p className="bpn-t">{b[3]}{" × "}{nv(p)}{b[2] ? ' · ' + b[2] : ''}</p><p className={`bpn-s ${b[6] === 'short' ? 'warn' : ''}`}>{{
                  done: `Made ${fmtD(b[4])}`,
                  planned: `Planned for ${fmtD(b[4])}`,
                  short: `Planned for ${fmtD(b[4])} · short of materials`
                }[b[6]]}</p></div><div className="led">{need.map(([i, n], __k) => <div key={__k}><span>{i.n}</span><b className={b[6] === 'short' && i.kind === 'stock' && i.hand < n ? 'bad' : ''}>{int(n)}{" "}{i.unit}s{b[6] !== 'done' && i.kind === 'stock' ? ` · ${int(i.hand)} on hand` : i.kind === 'mto' ? ' · charged per piece' : ''}</b></div>)}</div><div className="sx-bp"><span><b>{money(b[5])}</b><em>each</em></span><span><b>{money(b[5] * b[3])}</b><em>the batch</em></span></div>{b[6] === 'short' ? <p className="bpn-w"><b>{INP['blk-tn'].hand}{" turtleneck blanks on hand, "}{b[3]}{" needed."}</b>{" Westcoast takes "}{SUP.wcb.lead}{" days. Ordering 24 hits their minimum."}</p> : ''}</div><div className="pn-ft">{b[6] === 'short' && STAFF() ? <><button className="btn" data-sclose="">Not now</button><button className="btn p" data-sorder="blk-tn">Order 24 blanks</button></> : <button className="btn" data-sclose="">Close</button>}</div></></>;
    }
    /* live: the batch's sizes and what it needs, made (batch-done) or dropped (batch-cancel) */
    function batchPanelLive(id) {
      const b = BATCHES.find(x => x[0] === id),
        p = PRO[b[1]],
        raw = b[7],
        planned = b[6] !== 'done';
      const needs = raw.needs ?? [],
        short = needs.filter(n => n.onHand < n.quantity - 1e-9);
      const body = JSON.stringify({
        batch: b[0]
      });
      return <>{phd(`Batch ${b[0]}`)}<><div className="pn-b"><div><p className="bpn-t">{b[3]}{" × "}{p.n}{p.v ? ' · ' + p.v : ''}{b[2] ? ' · ' + b[2] : ''}</p><p className={`bpn-s ${b[6] === 'short' ? 'warn' : ''}`}>{{
                done: `Made ${fmtD(b[4])}${raw.who ? ' · ' + raw.who : ''}`,
                planned: `Planned for ${fmtD(b[4])}`,
                short: `Planned for ${fmtD(b[4])} · short of materials`
              }[b[6]]}</p></div><div>{lbl('By size')}<div className="led">{(raw.sizes || []).map((x, k) => ledRow(x.size || 'One size', `${x.units}${x.unitCost != null ? ` · ${money(x.unitCost)} each` : ''}`, k))}</div></div>{planned ? <div>{lbl('Materials kept on hand it needs')}<div className="led">{needs.length ? needs.map(n => <div key={n.input}><span>{INP[n.input]?.n ?? n.input}</span><b className={n.onHand < n.quantity - 1e-9 ? 'bad' : ''}>{qn(n.quantity)}{" "}{INP[n.input]?.unit ?? ''}{" · "}{qn(n.onHand)}{" on hand"}</b></div>) : ledRow('None: nothing kept on hand is used', '')}</div></div> : ''}<div className="sx-bp"><span><b>{raw.unitCost == null ? '—' : money(raw.unitCost)}</b><em>{planned ? 'each · estimate' : 'each'}</em></span><span><b>{raw.total == null ? '—' : money(raw.total)}</b><em>the batch</em></span></div>{short.length ? <p className="bpn-w"><b>{"Short of "}{short.map(n => `${qn(n.quantity - n.onHand)} ${(INP[n.input]?.n ?? n.input).toLowerCase()}`).join(', ')}.</b>{" Order more first, or make fewer."}</p> : ''}{raw.madeShort ? <p className="bpn-w"><b>Made while a material ran short.</b>{" The count was off: count it again."}</p> : ''}{raw.note ? <p className="bpn-n">{raw.note}</p> : ''}</div><div className="pn-ft">{planned && STAFF() ? <><button className="btn" data-za="batch-cancel" data-zbody={body} data-zsaid={`Dropped batch ${b[0]}`}>Drop it</button>{short.length ? <><button className="btn" data-za="batch-done" data-zbody={JSON.stringify({
                batch: b[0],
                allowShort: true
              })} data-zsaid={`Made batch ${b[0]} though it was short · count the stock again`}>Made anyway</button><button className="btn p" data-sorder={short[0].input}>Order more</button></> : <button className="btn p" data-za="batch-done" data-zbody={body} data-zsaid={`Made batch ${b[0]} · materials used, stock added`}>Mark it made</button>}</> : <button className="btn" data-sclose="">Close</button>}</div></></>;
    }
    /* make a batch: pick the product, colour and how many of each size; materials are checked against what's on hand */
    function makePanel(pid) {
      const p = PRO[pid];
      if (!SP.mk || SP.mk.pid !== pid) SP.mk = {
        pid,
        col: colsOf(p)[0],
        q: LV ? oneSize(p) ? [0] : SIZES.map(() => 0) : oneSize(p) ? [48] : [2, 6, 12, 12, 8, 2]
      };
      const k = SP.mk,
        sizes = oneSize(p) ? ['Each'] : SIZES;
      return <>{phd('Make a batch')}<><div className="pn-b"><div><p className="bpn-t">Make a batch</p><p className="bpn-s">Uses up the materials kept on hand, charges made-to-order costs per piece, and adds finished stock.</p></div><div className="sx-mk"><label className="sx-f wide">{lbl('Product')}<select id="mkp" className="vin" defaultValue={pid}>{goods.filter(p => (LV ? !!STK[p.id] : p.recipe) && p.st !== 'arch').map((x, __k) => <option key={__k} value={x.id}>{nv(x)}</option>)}</select></label><label className="sx-f">{lbl('Colour')}<select id="mkc" className="vin" defaultValue={k.col}>{colsOf(p).map((c, __k) => <option key={__k}>{c}</option>)}</select></label></div><div className="sx-mkq">{sizes.map((s, ix) => <label key={ix} className="sx-f">{lbl(s)}{numIn('mkq' + ix, k.q[ix], `data-mkq="${ix}"`)}</label>)}</div><div id="mkneed" /></div><div className="pn-ft"><button className="btn" data-sclose="">Cancel</button><button className="btn p" id="mkgo" data-smakego="">Make it</button></div></></>;
    }
    function refreshMake() {
      const k = SP.mk,
        p = PRO[k.pid],
        pn = document.getElementById('spanel');
      if (!pn) return;
      const sizes = oneSize(p) ? ['M'] : SIZES,
        n = k.q.reduce((a, b) => a + (+b || 0), 0);
      const lines = (p.recipe || []).map(([id, q]) => {
        const i = INP[id],
          need = q * n,
          cost = sizes.reduce((a, s, ix) => a + q * (+k.q[ix] || 0) * inCost(id, s, k.col), 0);
        return [i, need, cost];
      });
      const short = lines.filter(([i, need]) => i.kind === 'stock' && i.hand < need),
        tot = lines.reduce((a, l) => a + l[2], 0);
      html(pn.querySelector('#mkneed'), <><div>{lbl(`Materials for ${n}`)}<div className="led">{lines.map(([i, need, cost], __k) => <div key={__k}><span>{i.n}</span><b className={i.kind === 'stock' && i.hand < need ? 'bad' : ''}>{int(need)}{i.kind === 'stock' ? ` of ${int(i.hand)} on hand` : ' · made to order'}{" · "}{money(cost)}</b></div>)}</div></div><div className="sx-bp"><span><b>{money(n ? tot / n : 0)}</b><em>each</em></span><span><b>{money(tot)}</b><em>the batch</em></span><span><b>{money(lines.filter(l => l[0].kind === 'mto').reduce((a, l) => a + l[2], 0))}</b><em>billed by the printer</em></span></div>{short.length ? <p className="bpn-w"><b>{"Short of "}{short.map(([i, need]) => `${int(need - i.hand)} ${i.n.toLowerCase()}`).join(', ')}.</b>{" Order more first, or make fewer."}</p> : ''}</>);
      const go = pn.querySelector('#mkgo');
      if (go) go.disabled = !!short.length || !n;
    }
    function ordPanel(id) {
      if (LV) return ordPanelLive(id);
      const o = ORDERS.find(x => x[0] === id),
        t = ordTotal(o),
        c = ordCost(o),
        sup = o[6] === 'ship' ? perOrderSupplies() : pickupSupplies(),
        fee = t * FEE.pct + FEE.fixed,
        ship = o[6] === 'ship' ? SHIP.label - SHIP.charged : 0;
      return <>{phd(`Order #${o[0]}`)}<><div className="pn-b"><div><p className="bpn-t">{cust(o)}</p><p className="bpn-s">{o[3] ? 'Member · ' : ''}{PAY[o[5]]}{" · "}{o[6] === 'ship' ? 'Shipping' : `Pickup at ${POINTS[PICKUP_AT[o[0]] || 'mesa'].n}`}{" · "}{OST[o[7]][0]}</p></div><div className="led">{o[4].map(([pid, col, sz, q], __k) => {
                const p = PRO[pid];
                return <div key={__k}><span>{q}{" × "}{nv(p)}{col !== 'One size' ? ' · ' + col : ''}{sz ? ' · ' + sz : ''}</span><b>{money(p.price * q)}</b></div>;
              })}</div><div>{lbl('What it cost')}<div className="led">{[['Materials', c], [o[6] === 'ship' ? 'Mailer, tissue and label' : 'Tissue and sticker', sup], ['Payment fee', fee], ...(o[6] === 'ship' ? [['Shipping gap', ship]] : [])].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{money(v)}</b></div>)}<div className="tot"><span>Kept</span><b>{money(t - c - sup - fee - ship)}{" · "}{((t - c - sup - fee - ship) / t * 100).toFixed(0)}%</b></div></div></div>{o[7] === 'refund' ? <p className="bpn-w"><b>{"The "}{money(t)}{" refund is waiting on Dana Ruiz."}</b>{" Refunds over $50.00 need a second person. It goes back the way they paid, "}{PAY[o[5]]}.</p> : ''}</div><div className="pn-ft">{o[7] === 'paid' && STAFF() ? <><button className="btn" data-sclose="">Close</button><button className="btn p" data-spacked={o[0]}>Mark packed</button></> : <button className="btn" data-sclose="">Close</button>}</div></></>;
    }

    /* live: what the order cost once (recorded, else at today's costs), its address on asking, and the old page's flows */
    const ADDR = new Map();
    function ordPanelLive(id) {
      const o = ORDERS.find(x => x[0] === id),
        t = ordTotal(o),
        c = ordCost(o),
        oc = LV.ORDER_COSTS[o[0]],
        ship = o[6] === 'ship',
        st = o[7],
        ext = o[8] || {};
      const sup = oc ? oc.suppliesCost : ship ? perOrderSupplies() : pickupSupplies(),
        fee = oc ? oc.fee : o[5] === 'clear' ? 0 : t * FEE.pct + FEE.fixed,
        gap = ship ? oc?.gap ?? null : 0,
        kept = t - c - sup - fee - (gap || 0);
      const bare = o[4].filter(x => x[4] == null).length,
        ret = LV.RET[o[0]],
        pk = LV.PICKUP[o[0]],
        addr = ADDR.get(o[0]);
      const Z = (kind, label, pr) => <button className={`btn${pr ? ' p' : ''}`} data-zs={kind} data-zid={o[0]}>{label}</button>;
      const foot = !STAFF() ? <span className="small quiet" style={css("margin-right:auto")}>Read-only</span> : st === 'paid' ? <>{ship ? Z('labels', 'Print the label') : ''}<button className="btn p" data-spacked={o[0]}>Mark packed</button></> : st === 'packed' ? ship ? Z('ship', 'Mark shipped', 1) : Z('ready', 'Ready for pickup', 1) : st === 'ready' ? <>{Z('remind', 'Remind them')}{Z('picked', 'Mark picked up', 1)}</> : st === 'refund' ? ret && !ret.refundedAt ? Z('refundwait', 'See the refund', 1) : <button className="btn" data-sclose="">Close</button> : Z('refund', 'Refund');
      return <>{phd(`Order #${o[0]}`)}<><div className="pn-b"><div><p className="bpn-t">{cust(o)}</p><p className="bpn-s">{o[3] ? 'Member · ' : ''}{PAY[o[5]] || o[5] || 'Paid'}{" · "}{ship ? 'Shipping' : `Pickup at ${ptName(o)}`}{" · "}{OST[st][0]}{o[1] ? ` · ${fmtD(o[1])}, ${hm(o[1])}` : ''}</p></div><div className="led">{o[4].map(([pid, col, sz, q], k) => {
              const pp = PRO[pid];
              return <div key={k}><span>{q}{" × "}{pp.n}{pp.v ? ' · ' + pp.v : ''}{col && !pp.one ? ' · ' + col : ''}{sz ? ' · ' + sz : ''}</span><b>{money(pp.price * q)}</b></div>;
            })}</div><div>{lbl('What it cost')}<div className="led">{[['Materials', `${money(c)}${bare ? ` · ${bare === 1 ? 'a line' : `${bare} lines`} at today’s cost` : ''}`], [ship ? 'Mailer, tissue and label' : 'Packing', `${money(sup)}${oc ? '' : ' · at today’s costs'}`], ['Payment fee', `${money(fee)}${oc ? '' : ' · worked out'}`], ...(ship ? [['Shipping gap', gap == null ? 'The label’s cost isn’t recorded' : money(gap)]] : [])].map(([k, v]) => ledRow(k, v))}<div className="tot"><span>Kept</span><b>{money(kept)}{" · "}{share(kept, t)}</b></div></div>{ship && STAFF() ? acts(<span className="small quiet" style={css('margin-right:auto')}>{oc?.label != null ? 'The label’s cost, as recorded' : 'What the label cost'}</span>, <label className="sx-f sm" style={css('width:84px')}><input className="vin sx-in" id="slabel" inputMode="decimal" placeholder="0.00" defaultValue={oc?.label != null ? fx(oc.label) : ''} style={css('margin-top:0')} aria-label="What the label cost" /></label>, <button className="btn sm-b" data-zlabel={o[0]}>{oc?.label != null ? 'Change it' : 'Record it'}</button>) : ''}</div>{ship && !TOT() ? <div>{lbl('Ship to')}<div className="led">{ledRow('Address', addr ?? (ext.city ? `${ext.city} · the rest shows when you ask` : 'Shows when you ask'))}</div>{STAFF() && !addr && ['paid', 'packed'].includes(st) ? acts(<button className="btn sm-b" data-zaddr={o[0]}>Show the address</button>, <span className="small quiet">Read from Stripe for this order, and logged as a reveal: to pack it</span>) : ''}</div> : ''}{!ship ? <div>{lbl('Pickup')}<div className="led">{STAFF() && ['paid', 'packed', 'ready'].includes(st) && Object.values(POINTS).some(x => x.active !== false) ? <div><span>At</span><b><select className="vin" data-zpick={o[0]} defaultValue={PICKUP_AT[o[0]] || ''} aria-label="Where it’s held">{PICKUP_AT[o[0]] ? '' : <option value="">{o[8]?.pickup || 'Pick a point…'}</option>}{Object.entries(POINTS).filter(([k, x]) => x.active !== false || k === PICKUP_AT[o[0]]).map(([k, x]) => <option key={k} value={k}>{x.n}{x.city ? ` · ${x.city}` : ''}</option>)}</select></b></div> : ledRow('At', ptName(o))}{pk?.holdUntil ? ledRow('Held until', `${fmtD(pk.holdUntil)}${pk.overdue ? ' · past the hold' : ''}`) : ''}</div></div> : ''}{st === 'refund' && ret ? <p className="bpn-w"><b>{ret.refundedAt ? `${money(ret.amount ?? t)} refund recorded ${fmtD(ret.refundedAt)}.` : `The ${money(ret.amount ?? t)} refund is waiting on ${ret.second || 'a second person'}.`}</b>{` ${ret.reason}.`}{LV.REFUNDCAP != null ? ` Refunds over ${money(LV.REFUNDCAP)} need a second person.` : ''}</p> : ''}</div><div className="pn-ft">{foot}</div></></>;
    }
    /** Live, shows a shipping address for packing: read from Stripe for this order only, never kept, logged as a reveal. */
    function showAddr(id) {
      if (!LIVE_APP) return toast('The address is read from Stripe in the live app');
      api('GET', `/shop/orders/${id}/address`).then(a => {
        ADDR.set(id, [a.name, ...(a.lines || [])].filter(Boolean).join(' · ') || 'No address on the order');
        renderPanel();
        toast('Shown to pack it · logged in Records’ reveals');
      }, e => toast(e.message));
    }
    /** Live, runs the actions one after another, loads Shop again and draws the page from what the server holds. */
    function send(calls, said, after) {
      if (!LIVE_APP) return toast('Nothing is saved in the preview');
      (async () => {
        const rs = [];
        try {
          for (const [k, b] of calls) rs.push(await api('POST', `/actions/shop/${k}`, typeof b === 'function' ? b(rs) : b));
        } finally {
          await reloadSection('shop').catch(() => undefined);
        }
        return rs;
      })().then(rs => {
        const waiting = rs.some(r => r?.proposal);
        if (waiting) import('../live/account').then(m => m.loadWaiting()).catch(() => undefined);
        toast(waiting ? 'Sent for a second person · it changes once someone else approves it in Needs you' : rs.some(r => r?.queued) ? `${said} · recorded for the outside system, nothing is sent yet` : said);
        after?.(rs);
        renderShell();
      }, e => {
        toast(e.message);
        renderShell();
      });
    }
    const toFlow = () => {
      SP.reopen = SP.panel;
      closeS();
      render();
    };
    /** Live, the old Shop page's flows from the new panels: shop.tsx's (zs), costing.tsx's (zc), catalog.tsx's (zk), and straight actions (za). */
    function liveClick(t, d) {
      if (d.zs === undefined && d.zc === undefined && d.zk === undefined && d.za === undefined && d.zaddr === undefined && d.zsell === undefined) return false;
      if (!STAFF()) {
        toast('Read-only');
        return true;
      }
      // a flow's modal opens over the page: the panel steps aside, and comes back when the page is built again after it
      if (d.zs !== undefined || d.zc !== undefined || d.zk !== undefined) toFlow();
      if (d.zs !== undefined) {
        // the flows read the old page's state: the product they're for, and why it's coming off the shelf
        if (PRO[d.zid]) SS.prod = d.zid;
        if (d.zs === 'shelf-off') SS.why = 'stock';
        if (d.zs === 'edit' && LV.CATALOG[d.zid]) openCatFlow('details', d.zid);else openSFlow(d.zs, d.zid);
      } else if (d.zc !== undefined) openCostFlow(d.zc, d.zid || '', d.zcid || '', {
        copt: d.zopt,
        csize: d.zsize
      });else if (d.zk !== undefined) openCatFlow(d.zk, d.zid || '', {
        kvar: d.zvar,
        kcol: d.zcol,
        ksrc: d.zsrc
      });else if (d.za !== undefined) send([[d.za, JSON.parse(d.zbody || '{}')]], d.zsaid || 'Saved');else if (d.zaddr !== undefined) showAddr(d.zaddr);else if (d.zsell !== undefined) {
        const c = LV.CATALOG[d.zsell],
          op = prOf(d.zsell);
        send([['product-edit', {
          id: d.zsell,
          name: op.n,
          variant: op.v || '',
          price: c.price,
          cost: null,
          sellPastStock: !c.sellPastStock
        }]], c.sellPastStock ? 'Each colour and size shows sold out when none are on hand' : 'It keeps selling at 0, made to order');
      }
      return true;
    }
    /** Live, a product's costs and price saved: its recipe line by line, or one cost; a new price waits for a second person while it's on the shelf. */
    function saveLive(p, dr) {
      const calls = [],
        orig = p.recipe || [];
      if (dr.mode === 'recipe') {
        if (!dr.recipe.length) return toast('Add a material first, or give it one cost');
        if (p.src === 'flat') calls.push(['flat-cost', {
          product: p.id,
          cost: null
        }]);
        for (const [iid] of orig) if (!dr.recipe.some(r => r[0] === iid)) calls.push(['recipe-line', {
          product: p.id,
          input: iid,
          remove: true
        }]);
        for (const [iid, q] of dr.recipe) {
          const was = orig.find(r => r[0] === iid);
          if (!was || Math.abs(was[1] - q) > 1e-9 || p.src === 'flat') calls.push(['recipe-line', {
            product: p.id,
            input: iid,
            amount: q
          }]);
        }
      } else if (p.src !== 'flat' || Math.abs((p.flat ?? 0) - dr.flat) > 0.005 || !!p.est !== !!dr.est) calls.push(['flat-cost', {
        product: p.id,
        cost: Math.round(dr.flat * 100) / 100,
        estimate: !!dr.est
      }]);
      if (!p.dep && Math.abs(dr.price - p.price) > 0.005) {
        const op = prOf(p.id);
        calls.push(['product-edit', {
          id: p.id,
          name: op?.n ?? p.n,
          variant: op?.v ?? p.v,
          price: Math.round(dr.price * 100) / 100,
          cost: null
        }]);
      }
      if (!calls.length) return toast('Nothing changed');
      send(calls, `Saved · ${shortN(p)}`);
    }

    /** Live, the controls the reference has no drawing for, in its panels: suppliers and their breaks, a material's extras, one cost by colour or size, pickup points, a label's cost. */
    function liveForm(t, d) {
      const keys = ['sbadd', 'sbrm', 'sesave', 'sptsave', 'sxadd', 'sfoadd', 'zlabel'];
      if (!keys.some(k => d[k] !== undefined)) return false;
      if (!STAFF()) {
        toast('Read-only');
        return true;
      }
      const pn = document.getElementById('spanel'),
        val = id => (pn?.querySelector('#' + id)?.value ?? '').trim(),
        amt = v => v === '' ? NaN : Number(String(v).replace(/[^0-9.]/g, ''));
      if (d.sbadd !== undefined || d.sbrm !== undefined) {
        seRead();
        if (d.sbadd !== undefined) SP.se.breaks.push(['', '']);else SP.se.breaks.splice(+d.sbrm, 1);
        renderPanel();
        return true;
      }
      if (d.sesave !== undefined) {
        seRead();
        const e = SP.se,
          name = String(e.name).trim(),
          lt = String(e.lead).trim(),
          lead = lt === '' ? null : Number(lt);
        if (!name) return toast('Give the supplier a name'), true;
        if (lead != null && !(Number.isInteger(lead) && lead >= 0 && lead <= 365)) return toast('The lead time is a whole number of days'), true;
        const breaks = [];
        for (const [q, o] of e.breaks) {
          if (String(q).trim() === '' && String(o).trim() === '') continue;
          const n = amt(q),
            off = amt(o);
          if (!(n > 0)) return toast('Each break starts from a number of units'), true;
          if (!(off >= 0 && off < 100)) return toast('Each break takes 0 to 99% off'), true;
          breaks.push({
            quantity: n,
            discount: Math.round(off * 100) / 10000
          });
        }
        if (new Set(breaks.map(b => b.quantity)).size !== breaks.length) return toast('One break a quantity'), true;
        const was = JSON.stringify((e.id ? SUP[e.id].breaks : []).map(([q, x]) => [q, x])),
          now = JSON.stringify(breaks.map(b => [b.quantity, b.discount]));
        const calls = [['supplier', {
          ...(e.id ? {
            id: e.id
          } : {}),
          name,
          city: String(e.city).trim(),
          sells: String(e.sells).trim(),
          leadDays: lead,
          terms: String(e.terms).trim(),
          minimum: String(e.minimum).trim(),
          note: String(e.note).trim()
        }]];
        if (was !== now) calls.push(['supplier-breaks', rs => ({
          supplier: rs[0].result.id,
          breaks
        })]);
        send(calls, e.id ? `Saved · ${name}` : `Added ${name} to the suppliers`, rs => {
          SP.se = null;
          SP.panel = 's:' + (rs[0]?.result?.id ?? e.id);
        });
        return true;
      }
      if (d.sptsave !== undefined) {
        const e = SP.pt,
          f = k => pn?.querySelector(`[data-ptf="${k}"]`),
          name = (f('name')?.value ?? '').trim();
        if (!name) return toast('Give the pickup point a name'), true;
        send([['pickup-point', {
          ...(e.id ? {
            id: e.id
          } : {}),
          name,
          city: (f('city')?.value ?? '').trim(),
          active: !!f('active')?.checked
        }]], e.id ? `Saved · ${name}` : `Added ${name} as a pickup point`, () => closeS());
        return true;
      }
      if (d.sxadd !== undefined) {
        const i = INP[d.sxadd],
          fr = val('sxfor'),
          x = amt(val('sxamt'));
        if (!fr) return toast('Pick a size or a colour'), true;
        if (!(x > 0)) return toast('Type what it adds, in dollars'), true;
        const size = fr.startsWith('s:') ? fr.slice(2) : '',
          option = fr.startsWith('o:') ? fr.slice(2) : '';
        send([['input-extra', {
          input: i.id,
          size,
          option,
          extra: x
        }]], `${i.n} costs ${money(x)} more in ${size || option}`);
        return true;
      }
      if (d.sfoadd !== undefined) {
        const p = PRO[d.sfoadd],
          option = val('sfocol'),
          size = val('sfosize'),
          c = amt(val('sfocost'));
        if (!option && !size) return toast('Pick a colour or a size'), true;
        if (!(c >= 0)) return toast('Type its cost'), true;
        send([['flat-override', {
          product: p.id,
          option,
          size,
          cost: c
        }]], `${[option, size].filter(Boolean).join(' · ')} costs ${money(c)}`);
        return true;
      }
      if (d.zlabel !== undefined) {
        const c = amt(val('slabel'));
        if (!(c >= 0)) return toast('Type what the label cost'), true;
        send([['order-label', {
          order: d.zlabel,
          cost: c
        }]], `#${d.zlabel} · label ${money(c)} · its shipping gap is worked out`);
        return true;
      }
      return false;
    }

    /* ══ render + events ═══════════════════════════════════════════════════════════════════════════════════════════ */
    function render() {
      document.querySelectorAll('.gtabs [data-stab]').forEach(b => b.setAttribute('aria-current', b.dataset.stab === SP.tab ? 'page' : 'false'));
      if (!LIVE()) return;
      sync();
      W.classList.toggle('ro', !STAFF());
      W.classList.toggle('tot', TOT());
      renderHdr();
      ({
        overview: renderOverview,
        products: renderProducts,
        materials: renderMaterials,
        inventory: renderInventory,
        orders: renderOrders
      })[SP.tab]();
      renderPanel();
      if (TOT()) CC.scrub(W);
      setHash();
    }
    function sync() {
      const k = meKey();
      if (k !== SP.me) {
        SP.me = k;
        SP.panel = null;
        SP.draft = null;
        SP.buy = null;
        SP.mk = null;
      }
    }
    const second = () => SP.me === 'dana' ? 'Kai' : 'Dana Ruiz';
    const logIt = (what, detail, res) => {
      // live, the API logs each action itself
      if (LV) return;
      try {
        LOG.unshift(['x' + Date.now(), Date.UTC(2026, 9, 21, 14, 30), PPL[SP.me].ini, 'shop', what, detail, 'Mac · Redlands', res, res === 'waiting' ? 'Needs a second person' : '']);
      } catch (e) {}
    };
    const closeS = () => {
      SP.panel = null;
      SP.draft = null;
      SP.buy = null;
      SP.mk = null;
      SP.se = null;
      SP.pt = null;
    };
    document.addEventListener('click', e => {
      if (e.target.id === 'sscrim') {
        SP.reopen = null;
        closeS();
        return render();
      }
      const t = e.target.closest('button,a,[data-stab],[data-sopen]');
      if (!t) return;
      if (t.hasAttribute('data-sxmore')) {
        SP.rows = t.hasAttribute('data-less') ? 2 : SP.rows + 1;
        return fitShelf();
      }
      const d = t.dataset;
      if (LV && liveClick(t, d)) return;
      if (LV && liveForm(t, d)) return;
      if (d.stab) {
        SP.reopen = null;
        SP.tab = d.stab;
        closeS();
        render();
        window.scrollTo({
          top: 0
        });
        return;
      }
      if (d.sopen) {
        SP.reopen = null;
        if (SP.panel !== d.sopen) {
          SP.draft = null;
          SP.buy = null;
          SP.se = null;
          SP.pt = null;
        }
        SP.panel = d.sopen;
        return render();
      }
      if (d.sclose !== undefined) {
        SP.reopen = null;
        closeS();
        return render();
      }
      if (d.spf) {
        SP.pf = d.spf;
        return render();
      }
      if (d.smf) {
        SP.mf = d.smf;
        return render();
      }
      if (d.sof) {
        SP.of = d.sof;
        return render();
      }
      if (d.smode) {
        const dr = SP.draft;
        if (d.smode === 'flat' && dr.mode === 'recipe') dr.flat = draftCost();
        dr.mode = d.smode;
        return renderPanel();
      }
      if (d.srm) {
        SP.draft.recipe.splice(+d.srm, 1);
        return renderPanel();
      }
      if (d.saddm !== undefined) {
        const v = document.getElementById('saddsel').value;
        if (!v) return toast('Pick a material first');
        SP.draft.recipe.push([v, 1]);
        return renderPanel();
      }
      if (d.snewm !== undefined && LV) return STAFF() ? (toFlow(), openCostFlow('input')) : toast('Read-only');
      if (d.snewm !== undefined) return toast('Opens a new material: name, kind, supplier, unit and cost. It’s saved to the library for every product');
      if (d.starget !== undefined) {
        SP.draft.price = Math.ceil(priceFor(draftCost(), TARGET));
        return refreshProd();
      }
      if (d.ssave && LV) return saveLive(PRO[d.ssave], SP.draft);
      if (d.ssave) {
        const p = PRO[d.ssave],
          dr = SP.draft;
        logIt(`Saved the costs for ${shortN(p)}`, `${dr.mode === 'recipe' ? dr.recipe.length + ' materials' : 'One cost' + (dr.est ? ' · estimate' : '')} · ${money(dr.mode === 'recipe' ? recipeCost(dr.recipe, 'M', p.cols[0]) : dr.flat)} at a medium${p.price !== dr.price ? ` · price ${money(p.price)} → ${money(dr.price)}` : ''}`, 'done');
        if (dr.mode === 'recipe') {
          p.recipe = dr.recipe.map(r => [...r]);
          delete p.flat;
          delete p.est;
        } else {
          p.flat = dr.flat;
          p.est = dr.est;
          delete p.recipe;
        }
        const changed = p.price !== dr.price;
        p.price = dr.price;
        closeS();
        render();
        return toast(`Saved · ${shortN(p)} costs ${money(costOf(p))}${changed ? ` · new price ${money(p.price)} shows in the shop` : ''} · logged in Records`);
      }
      if (d.sapply && LV) {
        const i = INP[d.sapply],
          pid = document.getElementById('sapplyp').value,
          q = parseFloat(document.getElementById('sapplyq').value) || 1;
        return send([['input-apply', {
          input: i.id,
          products: [pid],
          amount: q
        }]], `Added ${i.n.toLowerCase()} to ${shortN(PRO[pid])}`);
      }
      if (d.sapply) {
        const i = INP[d.sapply],
          pid = document.getElementById('sapplyp').value,
          q = parseFloat(document.getElementById('sapplyq').value) || 1,
          p = PRO[pid];
        p.recipe.push([i.id, q]);
        logIt(`Added ${i.n.toLowerCase()} to ${shortN(p)}`, `${q} × ${money(i.avg)}`, 'done');
        renderPanel();
        render();
        return toast(`Added to ${shortN(p)} · it now costs ${money(costOf(p))}`);
      }
      if (d.sbuy && LV) {
        const i = INP[d.sbuy],
          b = SP.buy,
          per = parseFloat(b.per) || 0,
          u = parseFloat(b.units) || 0,
          paid = parseFloat(b.paid) || 0;
        if (i.kind === 'mto') {
          if (!per) return toast('Type the price each');
          const r = i.raw;
          return send([['input', {
            id: r.id,
            name: r.name,
            kind: r.kind,
            unit: r.unit,
            stocked: !!r.stocked,
            unitCost: per,
            lowMark: r.stocked ? r.lowMark ?? null : null,
            note: r.note || ''
          }]], `${i.n} is now ${money(per)} · every product using it updates`);
        }
        if (!u || !per) return toast('Enter what you paid and how many, or a cost each');
        const total = Math.round((paid || u * per) * 100) / 100;
        return send([['purchase', {
          input: i.id,
          quantity: u,
          total
        }]], `Recorded · ${qn(u)} ${i.unit} at ${money(total / u)} each`);
      }
      if (d.sbuy) {
        const i = INP[d.sbuy],
          b = SP.buy,
          per = parseFloat(b.per) || 0,
          u = parseFloat(b.units) || 0;
        if (i.kind === 'mto') {
          logIt(`Changed the price of ${i.n.toLowerCase()}`, `${money(i.avg)} → ${money(per)} per ${i.unit}`, 'done');
          CHANGES.unshift([NOW, i.id, i.avg, per, 'Updated by hand']);
          i.avg = per;
          i.last = per;
          closeS();
          render();
          return toast(`${i.n} is now ${money(per)} · every product using it updates`);
        }
        if (!u || !per) return toast('Enter what you paid and how many, or a cost each');
        logIt(`Recorded a buy · ${int(u)} ${i.unit}s of ${i.n.toLowerCase()}`, `${money(u * per)} to ${SUP[i.sup].n} · ${money(per)} each`, u * per > BUYCAP() ? 'waiting' : 'done');
        const was = i.avg;
        i.avg = (i.avg * i.hand + u * per) / (i.hand + u);
        i.hand += u;
        i.last = per;
        (i.buys ||= []).push([NOW, u, u * per]);
        if (Math.abs(per - was) > .005) CHANGES.unshift([NOW, i.id, was, per, 'Recorded a buy']);
        closeS();
        render();
        return toast(`Recorded · ${u} ${i.unit}s at ${money(per)} · average now ${money(i.avg)}${u * per > BUYCAP() ? ` · the payment waits on ${second()} in Money` : ''}`);
      }
      if (d.sorder && LV) {
        const i = INP[d.sorder],
          s = SUP[i.sup],
          r = LV.REORDER[i.id],
          g = r?.suggest;
        const v = window.prompt(`How many ${i.unit} of ${i.n} to order${s.none ? '' : ` from ${s.n}`}? Over ${BUYCAP() == null ? 'Settings’ limit' : money(BUYCAP())} it waits for a second person.`, String(g?.quantity ?? Math.max(1, Math.ceil(s.breaks[0]?.[0] ?? 1))));
        if (v == null) return;
        const q = parseFloat(v);
        if (!(q > 0)) return toast('Type how many');
        const unit = g?.unitCost ?? i.last,
          off = s.breaks.reduce((a, [n, x]) => q + 1e-9 >= n ? x : a, 0),
          total = Math.round(q * unit * (1 - off) * 100) / 100;
        return send([['order-in', {
          input: i.id,
          quantity: q,
          total
        }]], `Ordered ${qn(q)} ${i.unit} of ${i.n.toLowerCase()} · ${money(total)}${s.lead != null ? ` · lands in about ${s.lead} days` : ''}`);
      }
      if (d.sorder) {
        const i = INP[d.sorder],
          s = SUP[i.sup],
          q = Math.max(s.breaks[0][0], 24);
        logIt(`Ordered ${q} ${i.unit}s of ${i.n.toLowerCase()}`, `${s.n} · ${money(q * i.last)}`, q * i.last > BUYCAP() ? 'waiting' : 'done');
        return toast(`Order ${q} from ${s.n} · ${money(q * i.last)} · ${q * i.last > BUYCAP() ? `waits on ${second()} in Money` : 'goes out now'} · lands in about ${s.lead} days`);
      }
      if (d.smake) {
        SP.mk = null;
        SP.panel = 'mk:' + d.smake;
        return render();
      }
      if (d.smakego !== undefined && LV) {
        const k = SP.mk,
          p = PRO[k.pid],
          sizes = oneSize(p) ? [''] : SIZES;
        const units = sizes.map((size, ix) => ({
          size,
          n: Math.round(+k.q[ix] || 0)
        })).filter(u => u.n > 0);
        if (!units.length) return toast('Say how many to make');
        const n = units.reduce((a, u) => a + u.n, 0);
        return send([['batch-plan', {
          product: p.id,
          option: k.col,
          units
        }], ['batch-done', rs => ({
          batch: rs[0].result.batch
        })]], `Made ${n} × ${shortN(p)} · materials used, stock added`, () => {
          closeS();
          SP.tab = 'inventory';
        });
      }
      if (d.smakego !== undefined) {
        const k = SP.mk,
          p = PRO[k.pid],
          n = k.q.reduce((a, b) => a + (+b || 0), 0);
        p.recipe.forEach(([id, q]) => {
          const i = INP[id];
          if (i.kind === 'stock') i.hand -= q * n;
        });
        if (STK[p.id]) {
          STK[p.id][k.col] ||= SIZES.map(() => 0);
          k.q.forEach((v, ix) => {
            STK[p.id][k.col][ix] += +v || 0;
          });
        }
        BATCHES.unshift(['B-0' + (18 + BATCHES.length - 6), p.id, k.col === 'One size' ? '' : k.col, n, NOW, costOf(p, 'M', k.col), 'done']);
        logIt(`Made ${n} × ${shortN(p)}${k.col !== 'One size' ? ' · ' + k.col : ''}`, `Materials used · ${money(costOf(p, 'M', k.col))} each`, 'done');
        closeS();
        SP.tab = 'inventory';
        render();
        return toast(`Made ${n} × ${shortN(p)} · materials used, stock added · logged in Records`);
      }
      if (d.spacked && LV) return send([['pack', {
        order: d.spacked
      }]], `#${d.spacked} packed`);
      if (d.spacked) {
        ORDERS.find(o => o[0] === d.spacked)[7] = 'packed';
        logIt(`Packed order #${d.spacked}`, 'The label prints next', 'done');
        closeS();
        render();
        return toast(`#${d.spacked} packed · the label prints next`);
      }
      if (d.spack !== undefined && LV) return toFlow(), openSFlow('labels');
      if (d.spack !== undefined) return toast('Sends the labels to the thermal printer');
      if (d.sgo) {
        closeS();
        return goOut(d.sgo);
      }
      if (d.sadd !== undefined && LV) return STAFF() ? (toFlow(), openCatFlow('add')) : toast('Read-only');
      if (d.sadd !== undefined) return toast('Starts a draft product: name, line, colours and sizes, then its materials and price');
    });
    document.addEventListener('input', e => {
      const t = e.target,
        d = t.dataset;
      if (!SP.panel) return;
      const v = parseFloat(t.value),
        dr = SP.draft;
      if (d.sam !== undefined) {
        const r = dr.recipe[+d.sam];
        r[1] = isNaN(v) ? 0 : v;
        const o = document.getElementById('slc' + d.sam);
        if (o) o.value = fx(r[1] * INP[r[0]].avg);
        return refreshProd();
      }
      if (d.slc !== undefined) {
        const r = dr.recipe[+d.slc],
          a = INP[r[0]].avg;
        r[1] = isNaN(v) ? 0 : Math.round(v / a * 1000) / 1000;
        const o = document.getElementById('sam' + d.slc);
        if (o) o.value = r[1];
        return refreshProd();
      }
      if (d.sflat !== undefined) {
        dr.flat = isNaN(v) ? 0 : v;
        return refreshProd();
      }
      if (d.sprice !== undefined) {
        dr.price = isNaN(v) ? 0 : v;
        return refreshProd('sprice');
      }
      if (d.smarg !== undefined) {
        if (!isNaN(v) && v < 100) dr.price = Math.round(priceFor(draftCost(), v / 100) * 100) / 100;
        return refreshProd('smarg');
      }
      if (d.bpaid !== undefined) {
        SP.buy.paid = t.value;
        return refreshBuy('bpaid');
      }
      if (d.bunits !== undefined) {
        SP.buy.units = t.value;
        return refreshBuy('bunits');
      }
      if (d.bper !== undefined) {
        SP.buy.per = t.value;
        return refreshBuy('bper');
      }
      if (d.mkq !== undefined) {
        SP.mk.q[+d.mkq] = t.value;
        return refreshMake();
      }
    });
    document.addEventListener('change', e => {
      const t = e.target;
      // live: photos added to a product on the store, and a material's supplier
      if (LV && t.dataset.zphotos !== undefined) return void addPhotos(prOf(t.dataset.zphotos) || {
        id: t.dataset.zphotos
      }, t);
      if (LV && (t.dataset.zkind !== undefined || t.dataset.zkst !== undefined || t.dataset.zkpk !== undefined)) {
        const i = INP[t.dataset.zkind ?? t.dataset.zkst ?? t.dataset.zkpk];
        if (!i || !STAFF()) return;
        const b = t.dataset.zkind !== undefined ? {
          input: i.id,
          kind: t.value
        } : t.dataset.zkst !== undefined ? {
          input: i.id,
          kind: 'order',
          stocked: t.checked
        } : {
          input: i.id,
          kind: 'order',
          onPickup: t.checked
        };
        return send([['input-kind', b]], t.dataset.zkind !== undefined ? `${i.n} is ${KIND[t.value][0].toLowerCase()} now` : t.dataset.zkst !== undefined ? t.checked ? `${i.n} is counted on hand` : `${i.n} isn’t counted on hand` : t.checked ? `Pickups use ${i.n.toLowerCase()} too` : `Only shipped orders use ${i.n.toLowerCase()}`);
      }
      if (LV && t.dataset.zpick !== undefined) {
        if (!t.value || !STAFF()) return;
        return send([['order-pickup', {
          order: t.dataset.zpick,
          point: t.value
        }]], `#${t.dataset.zpick} · held at ${POINTS[t.value]?.n ?? 'the point'}`);
      }
      if (LV && t.dataset.zsup !== undefined) return send([['input-supplier', {
        input: t.dataset.zsup,
        supplier: t.value || null
      }]], 'Supplier set');
      if (!SP.panel) return;
      if (t.id === 'sest') {
        SP.draft.est = t.checked;
        return refreshProd();
      }
      if (t.id === 'mkp') {
        SP.mk = null;
        SP.panel = 'mk:' + t.value;
        return renderPanel();
      }
      if (t.id === 'mkc') {
        SP.mk.col = t.value;
        return refreshMake();
      }
    });
    document.addEventListener('keydown', e => {
      if (!LIVE()) return;
      if (e.key === 'Escape' && SP.panel && !document.querySelector('.modal')) {
        closeS();
        render();
      }
    });
    const TABS = ['overview', 'products', 'materials', 'inventory', 'orders'];
    return {
      render,
      // live, the open panel rides along, so a change made from it (the page is built again) keeps it open
      tab: () => {
        const pn = LV && (SP.panel || SP.reopen);
        return SP.tab + (pn && /^[pmsbo]:/.test(pn) ? ',' + pn : '');
      },
      setTab(t) {
        if (TABS.includes(t)) SP.tab = t;
        closeS();
      },
      close() {
        closeS();
      },
      open(k, id) {
        if (k === 'p' && !PRO[id]) return;
        if (k === 'o' && !ORDERS.some(o => o[0] === id)) return;
        if (LV && (k === 'm' && !INP[id] || k === 's' && !SUP[id] || k === 'b' && !BATCHES.some(b => b[0] === id))) return;
        SP.panel = k + ':' + id;
      }
    };
  })(DOCP);
  function mount() {
    // the slot is the shell's: the host goes inside it
    if (!into('sx-slot')) return;
    API.render();
  }
  function unmount() {
    if (host.isConnected) return;
    API.close();
    W.classList.remove('pn');
  }
  /*
   * p: a tab (`costs` is Materials, as the old page's links have it), or a panel to open on its tab: `p:lts` (a
   * product), `m:blk-tn` (a material), `s:wcb` (a supplier), `b:B-017` (a batch), `o:1094` (an order). The
   * reference's SHOP2.open('p', id) / open('o', id, 'orders') are CC.go('shop', 'p:…' / 'o:…') here.
   */
  const OLD = { costs: 'materials' };
  const PANES = { p: 'products', m: 'materials', s: 'materials', b: 'inventory', o: 'orders' };
  function setTab(p) {
    if (!p) return;
    // a tab and its open panel, as tab() gives them when the page is built again
    const c = String(p).indexOf(',');
    if (c > 0) {
      API.setTab(String(p).slice(0, c));
      const q = String(p).slice(c + 1),
        j = q.indexOf(':');
      if (j > 0) API.open(q.slice(0, j), q.slice(j + 1));
      return;
    }
    const i = String(p).indexOf(':'),
      k = i < 0 ? String(p) : String(p).slice(0, i),
      x = i < 0 ? '' : String(p).slice(i + 1);
    if (PANES[k] && x) {
      API.setTab(PANES[k]);
      API.open(k, x);
    } else API.setTab(OLD[k] || k);
  }
  return {
    mount,
    unmount,
    setTab: (_r, sub) => setTab(sub),
    tab: () => API.tab(),
    host
  };
}
registerPage(['shop'], 'sx-slot', makeShop, {
  live: true
});
