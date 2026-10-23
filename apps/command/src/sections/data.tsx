// @ts-nocheck: generated from the prototype's templates (see docs/command-reference/DECISIONS.md). Typed when Phase 3 puts API rows behind it.
import { D, H } from './contracts';
import { rng, series } from './core';
import { daysTo, pid } from './growth';
import { mcomp, mkey, pips, vizScale, vizSpark, vizTrack } from './home';
import { T } from './merchants';
import { yApr, yApy, yBorrowBps } from './money';
import { H2 } from './records';
import { u4, unitCost } from './shop';

export const vars = {};
/* ── Icons: square, single weight ────────────────────────── */
export const P = {
  home: (
    <>
      <path d="M3 9.5 10 4l7 5.5V17H3z" />
      <path d="M8 17v-5h4v5" />
    </>
  ),
  waiting: (
    <>
      <path d="M3 4h14v12H3z" />
      <path d="M3 11h4l1 2h4l1-2h4" />
    </>
  ),
  growth: (
    <>
      <path d="M3 16h14" />
      <path d="M4 13l4-4 3 3 5-6" />
      <path d="M12 6h4v4" />
    </>
  ),
  field: (
    <>
      <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" />
      <path d="M7 10h6" />
    </>
  ),
  members: (
    <>
      <circle cx="8" cy="7" r="3" />
      <path d="M2.5 17c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M13 4.5a3 3 0 0 1 0 5.5M15 12.2c1.6.7 2.5 2.4 2.5 4.8" />
    </>
  ),
  merchants: (
    <>
      <path d="M3 8h14l-1-4H4z" />
      <path d="M4 8v9h12V8" />
      <path d="M8 17v-5h4v5" />
    </>
  ),
  shop: (
    <>
      <path d="M4.5 7h11l-.8 10H5.3z" />
      <path d="M7.5 9V5.5a2.5 2.5 0 0 1 5 0V9" />
    </>
  ),
  money: (
    <>
      <path d="M3 5h14v10H3z" />
      <path d="M3 9h14M6 12h3" />
    </>
  ),
  contracts: (
    <>
      <path d="M5 3h7l3 3v11H5z" />
      <path d="M12 3v3h3M8 10h4M8 13h4" />
    </>
  ),
  governance: (
    <>
      <path d="M3 7l7-4 7 4z" />
      <path d="M5 7v8M10 7v8M15 7v8M3 17h14" />
    </>
  ),
  records: (
    <>
      <path d="M3 4h14v4H3z" />
      <path d="M4 8v9h12V8M8 11h4" />
    </>
  ),
  team: (
    <>
      <path d="M4 9h12v8H4z" />
      <path d="M7 9V6a3 3 0 0 1 6 0v3" />
    </>
  ),
  more: <path d="M3 5h14M3 10h14M3 15h14" />,
  chev: <path d="M8 5l5 5-5 5" />,
  chevl: <path d="M12 5l-5 5 5 5" />,
  arr: <path d="M4 10h11M11 6l4 4-4 4" />,
  chevd: <path d="M5 8l5 5 5-5" />,
  battery: (
    <>
      <path d="M3 7h12v6H3zM15 9h2v2h-2" />
      <path d="M5 9v2M7 9v2" />
    </>
  ),
  alert: (
    <>
      <path d="M10 3l8 14H2z" />
      <path d="M10 8v4M10 14v1" />
    </>
  ),
  swap: <path d="M4 7h11l-3-3M16 13H5l3 3" />,
  eye: (
    <>
      <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" />
      <circle cx="10" cy="10" r="2.5" />
    </>
  ),
  lockc: (
    <>
      <path d="M5 9h10v8H5z" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
    </>
  ),
  down: <path d="M10 4v11M6 11l4 4 4-4" />,
  up: <path d="M10 16V5M6 9l4-4 4 4" />,
  chain: <path d="M8 6H5a4 4 0 0 0 0 8h3M12 6h3a4 4 0 0 1 0 8h-3M7 10h6" />,
  close: <path d="M5 5l10 10M15 5 5 15" />,
  check: <path d="M4 10.5l4 4 8-9" />,
  out: (
    <>
      <path d="M9 4H4v12h12v-5" />
      <path d="M12 4h4v4M16 4l-7 7" />
    </>
  ),
};
/* ── Sections ────────────────────────────────────────────── */
export const SECTIONS = [
  {
    group: null,
    items: [['home', 'Home']],
  },
  {
    group: 'Grow',
    items: [
      ['growth', 'Growth'],
      ['field', 'Field'],
      ['members', 'Members'],
      ['merchants', 'Merchants'],
      ['shop', 'Shop'],
    ],
  },
  {
    group: 'Hold',
    items: [['money', 'Money']],
  },
  {
    group: 'Rules',
    items: [
      ['contracts', 'Contracts'],
      ['governance', 'Governance'],
    ],
  },
  {
    group: 'Admin',
    items: [
      ['records', 'Records'],
      ['team', 'Permissions'],
    ],
  },
];
export const NAMES = Object.fromEntries(SECTIONS.flatMap((g) => g.items));
NAMES.waiting = 'Waiting';
NAMES.more = 'More';
export const PLANNED = {
  growth: {
    line: 'Posters, scans and the road to $10 spent.',
    panes: [
      ['Funnel', 'Scans to $10 spent, by shop and by poster design.'],
      ['Posters', 'Where each of about 100 posters hangs, and when to replace it.'],
      ['Site and forms', 'Visits, waitlist joins, shop enquiries, land offers, work with us.'],
    ],
  },
  field: {
    line: 'Built for your phone on the poster route.',
    panes: [
      ['Today’s route', 'Shops due a visit, in order.'],
      ['Scan a poster', 'Mark it checked, damaged, replaced or missing, with a photo.'],
    ],
  },
  members: {
    line: 'Personal details stay masked until you ask.',
    panes: [
      ['Waitlist and batches', 'Invite in small groups, oldest first.'],
      ['Accounts', 'Status, opened date and how they fund.'],
      ['Activation', 'Who is inside their 90-day window, and who is close.'],
    ],
  },
  merchants: {
    line: 'Every shop from first visit to monthly payout.',
    panes: [
      ['Pipeline', 'Prospect, signed, transacting.'],
      ['Partners', 'Founding seats, caps and loss rate on their own originations.'],
      ['Payouts and $10 owed', 'Monthly. NET-30 by default, NET-14 on short terms.'],
      ['Hardware', 'Which counter device each shop has, and its health.'],
    ],
  },
  money: {
    line: 'Read-only. Every figure shows when it last synced.',
    panes: [
      ['Pools and reserves', 'Credit, the assurance reserve and savings.'],
      ['Bond ladder', 'What matures when.'],
      ['Utilization', 'Credit drawn against what is available.'],
      ['Schedules', 'Payouts and repayments coming up.'],
    ],
  },
  contracts: {
    line: 'Agreements on paper and contracts on-chain.',
    panes: [
      ['Agreements', 'Merchant, operating, member and intercompany. Signature and renewal status.'],
      ['On-chain registry', 'Addresses, versions, roles, admins and pause state.'],
      ['Proposed changes', 'Drafted here, signed in the multisig. No keys in the app.'],
    ],
  },
  governance: {
    line: 'Who decides what, and when it is due.',
    panes: [
      ['Entity map', 'The co-op parent and its subsidiaries.'],
      ['Boards', 'Seats as fractions.'],
      ['Meetings and votes', 'Agendas, resolutions, minutes. Member votes and the delegate assembly.'],
      ['Reserved matters', 'Decisions that need a member or co-op sign-off.'],
      ['Related parties', 'Every related-party transaction, logged.'],
      ['Compliance calendar', 'Filings and deadlines across every entity.'],
    ],
  },
  shop: {
    line: 'Products, stock and orders for the shop on useclear.org.',
    panes: [
      ['Products', 'Add, update and archive, and put things on or off the shelf.'],
      ['Inventory', 'Stock by size and colour, and what’s on the way.'],
      ['Orders', 'Pack, ship, pick up and refund.'],
    ],
  },
  records: {
    line: 'Documents, and a log of every action taken here.',
    panes: [
      ['Documents', 'Signed copies, minutes and filings.'],
      ['Audit log', 'Who did what, when, from where.'],
    ],
  },
  team: {
    line: 'Who can see and do what.',
    panes: [
      ['People', 'Team members and staff.'],
      ['Roles', 'What each role can see, propose and approve.'],
      ['Two-person rule', 'Money and on-chain actions need a second person.'],
    ],
  },
};
export const RANGE = {
  today: {
    name: 'Today',
    visits: 1284,
    delta: '+12.4% on last Wednesday',
    axis: ['00:00', '11:00', 'Now'],
    spark: series(23, 1284, (i) => 0.15 + Math.exp(-((i - 12) ** 2) / 14) + 0.9 * Math.exp(-((i - 19) ** 2) / 6), 7),
    prev: series(23, 1142, (i) => 0.15 + Math.exp(-((i - 11) ** 2) / 16) + 0.7 * Math.exp(-((i - 19) ** 2) / 7), 5),
    prevName: 'Last Wed',
    forms: [48, 7, 3, 5],
    scans: 211,
    top: [
      ['Rosa’s Panadería', 38],
      ['Inland Cycle Works', 27],
      ['Mesa Laundry', 22],
    ],
    act: 2,
    page: ['/join', 412],
    src: [211, 486, 342, 245],
    cities: [402, 318, 227, 337],
    joinPrev: 3.1,
  },
  week: {
    name: '7 days',
    visits: 8906,
    delta: '+8.1% on the 7 days before',
    axis: ['Thu 15', 'Sun 18', 'Wed 21'],
    spark: series(7, 8906, (i) => 0.9 + 0.06 * i + (i === 3 ? 0.12 : 0), 11),
    prev: series(7, 8239, (i) => 0.95 + 0.03 * i, 13),
    prevName: '7 days before',
    forms: [318, 41, 16, 27],
    scans: 1377,
    top: [
      ['Rosa’s Panadería', 241],
      ['Inland Cycle Works', 176],
      ['Mesa Laundry', 150],
    ],
    act: 27,
    page: ['/join', 2871],
    src: [1377, 3204, 2510, 1815],
    cities: [2788, 2215, 1563, 2340],
    joinPrev: 3.2,
  },
  month: {
    name: '30 days',
    visits: 36410,
    delta: '+31.6% on the 30 days before',
    axis: ['22 Sep', '6 Oct', '21 Oct'],
    spark: series(30, 36410, (i) => 0.6 + 0.022 * i + 0.12 * Math.sin((i / 7) * Math.PI * 2), 23),
    prev: series(30, 27667, (i) => 0.7 + 0.008 * i + 0.1 * Math.sin((i / 7) * Math.PI * 2), 29),
    prevName: '30 days before',
    forms: [1302, 176, 63, 99],
    scans: 4812,
    top: [
      ['Rosa’s Panadería', 842],
      ['Inland Cycle Works', 611],
      ['Mesa Laundry', 530],
    ],
    act: 124,
    page: ['/join', 11904],
    src: [4812, 12988, 10420, 8190],
    cities: [11208, 9102, 6655, 9445],
    joinPrev: 2.9,
  },
};
export const FORMS = ['Waitlist', 'Shop enquiries', 'Land offers', 'Work with us'];
/* The main funnel starts at the website: posters, social and search all send people to a page first. */
export const FUNNEL = [
  ['Visits', 36410],
  ['Joined', 1302],
  ['Invited', 300],
  ['Opened', 188],
  ['Activated', 124],
  ['First spend', 109],
];
export const WAITING0 = [
  {
    id: 'payout',
    kind: 'Payout',
    tag: 'Due tomorrow',
    urgent: true,
    title: 'Rosa’s Panadería',
    fig: '$412.60',
    figSub: 'September · NET-14',
    meta: ['Dana Ruiz proposed'],
    cta: 'Review payout',
    mode: 'approve',
    ledger: [
      ['Shop', 'Rosa’s Panadería'],
      ['Period', 'September 2026'],
      ['Sales cleared', '$372.60'],
      ['$10 redemptions', '4 · $40.00'],
      ['Terms', 'NET-14'],
      ['Clears to', 'Business checking ····8831'],
      ['Total', '$412.60', true],
    ],
    rule: ['Dana Ruiz', 'Ops'],
    primary: 'Approve payout',
    steps: ['Checked the two-person rule', 'Recorded your approval', 'Scheduled the payout'],
    done: ['Payout approved.', 'Clears to Rosa’s Panadería ····8831 on Thu 22 Oct.'],
  },
  {
    id: 'invite',
    kind: 'Invite batch',
    tag: 'Two-person',
    title: 'Batch 13',
    fig: '25',
    figSub: 'people, oldest first',
    meta: ['Marcus Lee proposed'],
    cta: 'Review batch',
    mode: 'approve',
    ledger: [
      ['People', '25'],
      ['From posters', '19'],
      ['From the website', '6'],
      ['Joined between', '12 Sep – 20 Sep'],
      ['Activation window', '90 days, ends 19 Jan 2027', true],
    ],
    rule: ['Marcus Lee', 'Growth'],
    primary: 'Send 25 invites',
    steps: ['Checked the two-person rule', 'Recorded your approval', 'Sent 25 invites'],
    done: ['25 invites sent.', 'Their 90-day activation window starts today.'],
  },
  {
    id: 'agreement',
    kind: 'Agreement',
    tag: 'E-signature',
    title: 'Inland Cycle Works',
    fig: '4/5',
    figSub: 'founding seats, once signed',
    meta: ['They signed 20 Oct'],
    cta: 'Sign',
    mode: 'esign',
    ledger: [
      ['Shop', 'Inland Cycle Works'],
      ['Agreement', 'Merchant, founding partner'],
      ['Founding seat', '4/5'],
      ['Sent', '19 Oct'],
      ['Their signature', '20 Oct'],
      ['Yours', 'Not yet', true],
    ],
    primary: 'Open e-signature',
    steps: ['Opened the e-signature tool', 'Waiting for your signature there'],
    done: ['Sent to e-signature.', 'It shows as signed here when the tool reports back.'],
  },
  {
    id: 'chain',
    kind: 'On-chain',
    tag: '2/3 signed',
    title: 'Rosa’s cap',
    fig: '$150.00',
    figSub: 'per sale, up from $100.00',
    meta: ['Dana Ruiz proposed'],
    cta: 'Open in multisig',
    mode: 'multisig',
    ledger: [
      ['Contract', 'MerchantRegistry v1.0'],
      ['Address', '0x4172…f1f5 · Base Sepolia'],
      ['Change', 'Per-transaction cap'],
      ['From', '$100.00'],
      ['To', '$150.00'],
      ['Why', 'Hit the cap 3 times today'],
      ['Loss rate', '0.0% on 41 originations'],
      ['Signatures', '2/3 · you are the third', true],
    ],
    primary: 'Open in multisig',
    steps: ['Prepared the transaction', 'Opened it in the multisig', 'Waiting for your signature there'],
    done: ['Handed to the multisig.', 'It executes when the third signature lands.'],
  },
];
/* Alerts carry how bad, where, how old, and what is already being done about it. */
export const ALERTS0 = [
  {
    t: 'Plaid is 3 hours behind',
    sev: 'absent',
    area: 'Money',
    age: 'since 19:52',
    go: 'money',
    fix: 'resync',
  },
  {
    t: 'Poster P-044 is sun-faded',
    sev: 'underway',
    area: 'Growth',
    age: 'Mesa Laundry · 19 Oct',
    go: 'growth',
    fix: 'route',
  },
  {
    t: 'Rosa’s hit their cap 3 times',
    sev: 'underway',
    area: 'Merchants',
    age: 'today',
    go: 'merchants',
    fix: 'needs',
  },
];
export const DEADLINES = [
  // [title, entity, date, days from today, status]
  ['Wyoming annual report', 'ClearLabs Inc', '1 Nov', 11, 'ready'],
  ['Board minutes', 'Clear Co-op', '4 Nov', 14, 'draft'],
  ['Statement of Information', 'Clear Co-op', '15 Nov', 25, 'none'],
];
export const DL_STATUS = {
  ready: ['settled', 'Ready to file'],
  draft: ['underway', 'Drafting'],
  none: ['absent', 'Not started'],
};
/* ── State ───────────────────────────────────────────────── */
export const S = {
  route: 'home',
  range: 'today',
  preview: 'live',
  filter: 'all',
  waiting: WAITING0.slice(),
  live: null,
  updates: null,
  payoutDone: false,
};
/* ── Theme ───────────────────────────────────────────────── */
vars.themePref = 'light';
export const TH_IC = {
  light: (
    <>
      <circle cx="10" cy="10" r="3.4" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
    </>
  ),
  dark: <path d="M15.5 12.2A6.2 6.2 0 0 1 7.8 4.5a6.2 6.2 0 1 0 7.7 7.7z" />,
  auto: (
    <>
      <rect x="3" y="4" width="14" height="10" />
      <path d="M7.5 17h5M10 14v3" />
    </>
  ),
};
vars.saved = 'light';
vars.savedRail = 'full';
export const demo = 'Demo';
/* ── Now: one permanent panel for everything moving ─────── */
export const LIVE0 = [
  {
    id: 'b06',
    icon: 'members',
    title: 'Batch 12',
    fig: '14/25',
    sub: 'opened an account · 9 activated',
    pips: [25, 9, 5],
    key: [
      ['var(--fg)', '9 activated'],
      ['var(--land)', '5 opened'],
    ],
    foot: 'Members',
    go: 'members',
  },
  {
    id: 'route',
    icon: 'field',
    title: 'Poster route',
    fig: '3/8',
    sub: 'shops checked · Marcus Lee',
    pips: [8, 3, 0],
    key: [['var(--fg)', 'Marcus Lee, on route']],
    foot: 'Field',
    go: 'field',
  },
  {
    id: 'plaid',
    icon: 'money',
    title: 'Plaid re-sync',
    fig: '7/12',
    sub: 'bank links refreshed · since 22:41',
    pips: [12, 7, 0],
    key: [['var(--fg)', 'Started 22:41']],
    foot: 'Money',
    go: 'money',
  },
];
export const UPD0 = [
  {
    icon: 'merchants',
    title: 'Mesa Laundry cap',
    fig: '$120.00',
    sub: 'per sale',
    viz: () => vizScale(100, 120, 80, 140, '$100.00', '$120.00'),
    by: 'Marcus Lee',
    when: '2h ago',
    go: 'merchants',
  },
  {
    icon: 'merchants',
    title: 'Uptown Barber signed',
    fig: '12',
    sub: 'shops now transacting',
    viz: () => (
      <>
        {pips([12, 11, 1])}
        {mkey([['var(--land)', '1 new today']])}
      </>
    ),
    by: 'Merchant agreement',
    when: '4h ago',
    go: 'merchants',
  },
  {
    icon: 'members',
    title: 'Waitlist milestone',
    fig: '1,500',
    sub: 'people on the waitlist',
    viz: () => vizSpark([612, 688, 741, 803, 872, 934, 1011, 1090, 1188, 1279, 1402, 1500]),
    by: 'Passed at 16:12',
    when: '6h ago',
    go: 'members',
  },
  {
    icon: 'chain',
    title: 'RevolvingIssuer',
    fig: 'v1.3',
    sub: 'deployed to Base Sepolia',
    viz: () =>
      vizTrack([
        ['v1.1', 1],
        ['v1.2', 1],
        ['v1.3', 2],
      ]),
    by: 'Dana Ruiz',
    when: 'Yesterday',
    go: 'contracts',
  },
];
export const UPD_FROM = {
  payout: ['payout approved', 'merchants'],
  invite: ['invites sent', 'members'],
  agreement: ['sent to e-signature', 'contracts'],
  chain: ['sent to the multisig', 'contracts'],
};
export const W_ICON = {
  payout: 'money',
  invite: 'members',
  agreement: 'contracts',
  chain: 'chain',
};
export const W_VIZ = {
  payout: () =>
    mcomp([
      ['Sales', 372.6, 'var(--fg)', '$372.60'],
      ['$10 redemptions', 40, 'var(--land)', '$40.00'],
    ]),
  invite: () => (
    <>
      {pips([25, 19, 6])}
      {mkey([
        ['var(--fg)', '19 posters'],
        ['var(--land)', '6 website'],
      ])}
    </>
  ),
  agreement: () =>
    vizTrack(
      [
        ['ICW', 1],
        ['You', 0],
      ],
      true,
    ),
  chain: () =>
    vizTrack(
      [
        ['DR', 1],
        ['ML', 1],
        ['You', 0],
      ],
      true,
    ),
};
/* ── Now ─────────────────────────────────────────────────────
   Three jobs, three forms. Things that need you are rows you act on, in due order.
   Things that are moving are progress you watch. Things that changed are a timeline you skim. */
export const NEED = {
  payout: {
    order: 1,
    verb: 'Approve',
    meta: 'Payout · Dana proposed',
    fig: '$412.60',
  },
  chain: {
    order: 2,
    verb: 'Sign',
    meta: 'Cap raise from $100.00 · 2/3 signed',
    fig: '$150.00',
  },
  invite: {
    order: 3,
    verb: 'Approve',
    meta: 'Invite batch · Marcus proposed',
    fig: (
      <>
        25<small>people</small>
      </>
    ),
  },
  agreement: {
    order: 4,
    verb: 'Sign',
    meta: 'Merchant agreement · they signed',
    fig: (
      <>
        4/5<small>seat</small>
      </>
    ),
  },
};
export const FEED0 = [
  {
    what: (
      <>
        {'Mesa Laundry cap raised to '}
        <b>$120.00</b>
      </>
    ),
    by: 'Marcus Lee',
    when: '2h ago',
    go: 'merchants',
  },
  {
    what: (
      <>
        {'Uptown Barber signed. '}
        <b>12</b>
        {' shops now transacting'}
      </>
    ),
    by: 'Merchant agreement',
    when: '4h ago',
    go: 'merchants',
  },
  {
    what: (
      <>
        {'Waitlist passed '}
        <b>1,500</b>
      </>
    ),
    by: 'At 16:12',
    when: '6h ago',
    go: 'members',
  },
  {
    what: (
      <>
        {'RevolvingIssuer '}
        <b>v1.3</b>
        {' deployed to Base Sepolia'}
      </>
    ),
    by: 'Dana Ruiz',
    when: 'Yesterday',
    go: 'contracts',
  },
];
export const FEED_FROM = {
  payout: 'Approved Rosa’s payout',
  invite: 'Sent batch 13 invites',
  agreement: 'Sent the Inland Cycle Works agreement to e-signature',
  chain: 'Sent Rosa’s cap raise to the multisig',
};
vars.pageRaf = 0;
S.live = LIVE0.slice();
S.updates = FEED0.slice();

/* ── Waiting (phone tab) ─────────────────────────────────── */
/* ── Placeholder sections ────────────────────────────────── */
export const SPANS = {
  2: ['s-7', 's-5'],
  3: ['s-5', 's-4', 's-3'],
  4: ['s-7', 's-5', 's-5', 's-7'],
  6: ['s-5', 's-4', 's-3', 's-3', 's-4', 's-5'],
};
/* ══ Growth ══════════════════════════════════════════════════════════════
   Three panes: Funnel (by shop, by design), Posters (inventory, swaps), Site and forms.
   Every total here matches Home's 30-day poster funnel: 4,812 scans · 1,106 joined ·
   124 activated · 97 spent $10 · 102 posters. */
export const GS = {
  pane: 'overview',
  sort: 'scans',
  dir: -1,
  pf: 'all',
  pg: 0,
  poster: null,
  ft: 'all',
  reveal: false,
};
/* [id, name, posters, scans, joined, activated, spent, city] — last 30 days */
export const SHOPS = [
  ['rosas', 'Rosa’s Panadería', 4, 842, 219, 26, 22, 'Redlands'],
  ['icw', 'Inland Cycle Works', 3, 611, 128, 14, 11, 'Redlands'],
  ['mesa', 'Mesa Laundry', 3, 530, 127, 13, 10, 'San Bernardino'],
  ['uptown', 'Uptown Barber', 3, 402, 125, 16, 13, 'Redlands'],
  ['citrus', 'Citrus Bowl Café', 3, 366, 70, 7, 6, 'Riverside'],
  ['tire', 'Redlands Tire & Lube', 2, 301, 36, 3, 2, 'Redlands'],
  ['books', 'State St. Books', 3, 288, 81, 9, 7, 'Redlands'],
  ['mich', 'La Michoacana', 3, 254, 64, 7, 6, 'San Bernardino'],
  ['nails', 'Arrowhead Nails', 2, 221, 40, 4, 3, 'San Bernardino'],
  ['orange', 'Orange St. Laundromat', 2, 197, 39, 4, 3, 'Redlands'],
];
export const BOARDS = ['boards', 'Community boards', 6, 314, 47, 5, 3, '6 boards'];
export const OTHERS = ['others', '20 more shops', 68, 486, 130, 16, 11, 'Inland Empire'];
export const OTHER_SHOPS = [
  'Fontana Tacos',
  'Highland Hardware',
  'Yucaipa Feed & Seed',
  'Loma Linda Pharmacy',
  'Colton Cuts',
  'Rialto Donuts',
  'Bloomington Market',
  'Mentone Coffee',
  'Calimesa Cleaners',
  'Grand Terrace Deli',
  'Muscovy Tea',
  'Sixth St. Tailor',
  'Brookside Pet Wash',
  'Cajon Phone Repair',
  'Valley Shoe Repair',
  'Kendall Thrift',
  'Tippecanoe Tires',
  'Victoria Ave. Florist',
  'Base Line Pho',
  'Citrus Plaza Optical',
];
export const OTHER_CITY = [
  'Fontana',
  'Highland',
  'Yucaipa',
  'Loma Linda',
  'Colton',
  'Rialto',
  'Bloomington',
  'Mentone',
  'Calimesa',
  'Grand Terrace',
  'Redlands',
  'Riverside',
  'Redlands',
  'San Bernardino',
  'Redlands',
  'San Bernardino',
  'Redlands',
  'Riverside',
  'San Bernardino',
  'Riverside',
];
export const BOARD_SITES = ['Smiley Library', 'UR Commons', 'Sylvan Park', 'Ed Hales Park', 'Feldheym Library', 'Riverside Main Library'];
export const BOARD_CITY = ['Redlands', 'Redlands', 'Redlands', 'Redlands', 'San Bernardino', 'Riverside'];
export const DESIGNS = {
  A: {
    name: 'The neighbor',
    posters: 41,
    scans: 2011,
    joined: 501,
  },
  B: {
    name: '$10 on us',
    posters: 38,
    scans: 2104,
    joined: 465,
  },
  C: {
    name: 'The map',
    posters: 23,
    scans: 697,
    joined: 140,
  },
};
/* Dates: demo "today" is Wed 21 Oct 2026 */
export const TODAY = Date.UTC(2026, 9, 21);
export const DAY = 864e5;
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* Build the 102 posters once */
export const POSTERS = (() => {
  const r = rng(41);
  const list = [];
  const split = (total, n) => {
    const w = Array.from(
      {
        length: n,
      },
      () => 0.6 + r(),
    );
    const sw = w.reduce((a, b) => a + b, 0);
    const v = w.map((x) => Math.floor((x / sw) * total));
    let k = total - v.reduce((a, b) => a + b, 0);
    for (let i = 0; k > 0; i = (i + 1) % n, k--) v[i]++;
    return v;
  };
  SHOPS.forEach((s) =>
    split(s[3], s[2]).forEach((v) =>
      list.push({
        shop: s[1],
        shopId: s[0],
        city: s[7],
        scans: v,
      }),
    ),
  );
  const otherCounts = OTHER_SHOPS.map((_, i) => (i < 8 ? 4 : 3));
  const otherScans = split(OTHERS[3], 68);
  let k = 0;
  OTHER_SHOPS.forEach((n, i) => {
    for (let j = 0; j < otherCounts[i]; j++)
      list.push({
        shop: n,
        shopId: 'o' + i,
        city: OTHER_CITY[i],
        scans: otherScans[k++],
      });
  });
  split(BOARDS[3], 6).forEach((v, i) =>
    list.push({
      shop: BOARD_SITES[i],
      shopId: 'b' + i,
      city: BOARD_CITY[i],
      scans: v,
      board: true,
    }),
  );
  /* designs: 41 A, 38 B, 23 C */
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
  /* P-044 is at Mesa Laundry (Home's alert), so swap numbers with Mesa's third poster */
  const mesa = list.filter((p) => p.shopId === 'mesa')[2],
    p44 = list.find((p) => p.n === 44);
  [mesa.n, p44.n] = [44, mesa.n];
  const byN = (n) => list.find((p) => p.n === n);
  [
    [44, 'faded', -64],
    [71, 'faded', -40],
    [90, 'faded', -35],
    [63, 'missing', -30],
  ].forEach(([n, st, h]) => {
    const p = byN(n);
    p.status = st;
    p.hung = TODAY + h * DAY;
  });
  [
    [12, -57],
    [27, -56],
    [55, -55],
    [81, -54],
  ].forEach(([n, h]) => {
    const p = byN(n);
    p.status = 'due';
    p.hung = TODAY + h * DAY;
  });
  list.forEach((p) => {
    p.swap = p.hung + 60 * DAY;
    if (p.status === 'up' && daysTo(p.swap) < 8) ((p.hung += 10 * DAY), (p.swap += 10 * DAY));
  });
  byN(44).checked = TODAY - 2 * DAY;
  return list.sort((a, b) => a.n - b.n);
})();
export const ST = {
  up: ['settled', 'Up'],
  due: ['underway', 'Swap due'],
  faded: ['underway', 'Faded'],
  missing: ['absent', 'Missing'],
};
/* ── Overview pane: is growth working, where, and what to do next ─────── */
/* ── Overview pane ────────────────────────────────────────────────────────
   Read top to bottom: this week at a glance, the one trend that matters (joins vs invites),
   what to do about it, then where growth comes from. Charts draw their shapes in SVG and their
   words in HTML, so labels stay 11px at every width and never collide with lines. */
export const WEEKS = ['4 Aug', '11 Aug', '18 Aug', '25 Aug', '1 Sep', '8 Sep', '15 Sep', '22 Sep', '29 Sep', '6 Oct', '13 Oct', '20 Oct'];
export const W_JOIN = [20, 28, 40, 30, 75, 95, 130, 204, 270, 290, 300, 318];
/* sums to 1,800 */
export const W_INV = [0, 0, 0, 0, 0, 0, 25, 25, 50, 75, 75, 50];
/* 12 batches of 25 = 300, so 1,500 still wait */
export const W_ACT = [0, 0, 0, 0, 0, 0, 9, 16, 24, 33, 35, 27];
export const W_SRC = {
  /* weekly visits; the last two weeks match Home's 7-day figure and its +8.1% */
  Posters: [0, 0, 180, 390, 560, 720, 860, 990, 1100, 1210, 1250, 1377],
  Direct: [2100, 2150, 2230, 2310, 2400, 2520, 2640, 2760, 2880, 2900, 2960, 3204],
  Social: [900, 980, 1050, 1180, 1300, 1450, 1640, 1820, 2010, 2200, 2330, 2510],
  Search: [1200, 1230, 1260, 1300, 1360, 1420, 1500, 1560, 1630, 1700, 1699, 1815],
};
export const W_VIS = WEEKS.map((_, i) => Object.values(W_SRC).reduce((a, s) => a + s[i], 0));
export const W_WAIT = (() => {
  let c = 0;
  return W_JOIN.map((j, i) => (c += j - W_INV[i]));
})();
export const CITY_V = {
  Redlands: 11208,
  'San Bernardino': 9102,
  Riverside: 6655,
  Fontana: 1850,
  Rialto: 1210,
  Highland: 1120,
  'Loma Linda': 1040,
  Colton: 980,
  Yucaipa: 860,
  Bloomington: 600,
  'Grand Terrace': 520,
  Mentone: 410,
  Calimesa: 380,
};
export const SRC_COL = ['var(--fg)', 'var(--land)', 'var(--fg-50)', 'var(--line)'];
/* ── Acquisition pane: where visitors come from and which ones join ───── */
export const SRC30 = [
  /* name, visits, joined, activated — last 30 days; sums match Home */ ['Posters', 4812, 1106, 108],
  ['Direct', 12988, 98, 9],
  ['Social', 10420, 61, 4],
  ['Search', 8190, 37, 3],
];
export const REFS = [
  ['instagram.com', 4210],
  ['google.com', 7120],
  ['nextdoor.com', 2650],
  ['facebook.com', 2380],
  ['tiktok.com', 1830],
  ['bing.com', 1070],
];
export const LANDING = [
  ['/join', 11904, 1012],
  ['/', 9880, 121],
  ['/s/ (posters)', 4812, 0],
  ['/how', 4120, 74],
  ['/shops', 2310, 0],
  ['/contribute', 1204, 0],
  ['/housing', 1100, 58],
  ['/coop', 1080, 37],
];
export const HEAT = (() => {
  const r = rng(77);
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return days.map((d, di) => ({
    d,
    v: Array.from(
      {
        length: 24,
      },
      (_, h) => {
        const we = di > 4;
        const base = 0.05 + Math.exp(-((h - (we ? 12 : 12.5)) ** 2) / (we ? 10 : 4)) * (we ? 1.15 : 0.75) + Math.exp(-((h - 19) ** 2) / 5) * (we ? 0.7 : 1);
        return Math.max(0, base * (0.85 + 0.3 * r()) * (h < 6 ? 0.25 : 1));
      },
    ),
  }));
})();
/* ── Cohorts pane: what happens after we invite ───────────────────────── */
export const COHORTS = [
  /* invite week, invited, cumulative % activated by week since invite */ ['15 Sep', 25, [16, 28, 36, 44, 48]],
  ['22 Sep', 25, [20, 32, 40, 48, 52]],
  ['29 Sep', 50, [18, 30, 38, 42]],
  ['6 Oct', 75, [21, 33, 40]],
  ['13 Oct', 75, [19, 31]],
  ['20 Oct', 50, [12]],
];
/* Shops: traffic against conversion, so each shop's next step is obvious */
/* Each shop is a numbered square; the numbers match the shop table and the list beside the chart,
   so no label ever has to sit next to a point and collide. */
export const SHOP_NO = Object.fromEntries(SHOPS.map((s, i) => [s[0], i + 1]));
export const SC_COL = {
  swap: 'var(--underway)',
  add: 'var(--settled)',
  keep: 'var(--fg)',
  watch: 'var(--fg-50)',
};
/* ── Posters pane ─────────────────────────────────────────────────────── */
export const PER_PAGE = 12;
/* ── Site and forms pane ──────────────────────────────────────────────── */
export const INBOX = [
  {
    who: ['Marisol', 'Reyes'],
    mail: 'm.reyes@gmail.com',
    type: 'Waitlist',
    city: 'Redlands',
    src: 'P-003 · Rosa’s',
    when: '22:41',
    st: 'New',
  },
  {
    who: ['Dev', 'Patel'],
    mail: 'devpatel@outlook.com',
    type: 'Waitlist',
    city: 'San Bernardino',
    src: 'P-044 · Mesa Laundry',
    when: '22:17',
    st: 'New',
  },
  {
    who: ['Sixth St.', 'Tailor'],
    mail: 'hello@sixthsttailor.com',
    type: 'Shop enquiry',
    city: 'Redlands',
    src: '/shops',
    when: '21:58',
    st: 'New',
  },
  {
    who: ['Tanya', 'Brooks'],
    mail: 'tbrooks@yahoo.com',
    type: 'Waitlist',
    city: 'Riverside',
    src: 'Search',
    when: '21:30',
    st: 'New',
  },
  {
    who: ['Luis', 'Ortega'],
    mail: 'l.ortega@gmail.com',
    type: 'Land offer',
    city: 'Mentone',
    src: '/contribute',
    when: '20:12',
    st: 'Replied',
  },
  {
    who: ['Grace', 'Kim'],
    mail: 'gkim@icloud.com',
    type: 'Waitlist',
    city: 'Redlands',
    src: 'P-018 · Uptown Barber',
    when: '19:44',
    st: 'Invited',
  },
  {
    who: ['Jordan', 'Hale'],
    mail: 'jhale@proton.me',
    type: 'Work with us',
    city: 'Loma Linda',
    src: 'Direct',
    when: '18:05',
    st: 'New',
  },
  {
    who: ['Ana', 'Vega'],
    mail: 'ana.vega@gmail.com',
    type: 'Waitlist',
    city: 'Colton',
    src: 'P-061 · Colton Cuts',
    when: '17:20',
    st: 'Invited',
  },
];
/* ══ Members ════════════════════════════════════════════════════════════
   Ties to Home: 300 invited in 12 batches of 25 · 188 opened · 124 active · 64 opened, not funded ·
   112 not opened · 109 first spends · batch 12 at 14/25 opened with 9 active · batch 13 waiting. */
export const MS = {
  pane: 'overview',
  mf: 'all',
  pg: 0,
  member: null,
  reveal: false,
  size: 25,
  order: 'oldest',
};
export const BATCH_DATE = [15, 22, 29, 29, 6, 6, 6, 13, 13, 13, 20, 20].map((d, i) => (i < 4 ? Date.UTC(2026, 8, d) : Date.UTC(2026, 9, d)));
export const B_ACT = [12, 13, 12, 11, 11, 10, 10, 10, 9, 9, 8, 9];
export const B_OPEN = [3, 3, 4, 4, 5, 5, 6, 6, 6, 6, 11, 5];
export const FIRST = [
  'Marisol',
  'Dev',
  'Tanya',
  'Luis',
  'Grace',
  'Jordan',
  'Ana',
  'Kevin',
  'Rosa',
  'Andre',
  'Leah',
  'Omar',
  'Priya',
  'Daniel',
  'Mei',
  'Carlos',
  'Brianna',
  'Hector',
  'Jasmine',
  'Tyrell',
  'Sofia',
  'Nate',
  'Imani',
  'Victor',
  'Elena',
  'Marcus',
  'Aaliyah',
  'Ben',
  'Lupe',
  'Sam',
];
export const LAST = [
  'Reyes',
  'Patel',
  'Brooks',
  'Ortega',
  'Kim',
  'Hale',
  'Vega',
  'Nguyen',
  'Diaz',
  'Johnson',
  'Ramos',
  'Haddad',
  'Shah',
  'Lopez',
  'Chen',
  'Medina',
  'Foster',
  'Garcia',
  'Ward',
  'Moore',
  'Castillo',
  'Price',
  'Okafor',
  'Silva',
  'Ruiz',
  'Bell',
  'Cruz',
  'Tran',
  'Flores',
  'Young',
];
export const MCITY = [
  ['Redlands', 0.32],
  ['San Bernardino', 0.26],
  ['Riverside', 0.18],
  ['Fontana', 0.06],
  ['Rialto', 0.04],
  ['Highland', 0.04],
  ['Loma Linda', 0.04],
  ['Colton', 0.03],
  ['Yucaipa', 0.03],
];
export const SPEND_SHOPS = [
  'Rosa’s Panadería',
  'Inland Cycle Works',
  'Mesa Laundry',
  'Uptown Barber',
  'Citrus Bowl Café',
  'State St. Books',
  'La Michoacana',
  'Arrowhead Nails',
];
export const MEMBERS = (() => {
  const r = rng(909),
    out = [];
  let id = 1;
  const pickCity = () => {
    let x = r(),
      a = 0;
    for (const [c, w] of MCITY) {
      a += w;
      if (x < a) return c;
    }
    return 'Redlands';
  };
  const fund = [...Array(71).fill('Bank'), ...Array(38).fill('$5'), ...Array(15).fill('Deposit')];
  for (let i = fund.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [fund[i], fund[j]] = [fund[j], fund[i]];
  }
  let fi = 0,
    spent = 0;
  for (let b = 0; b < 12; b++) {
    for (let k = 0; k < 25; k++) {
      const st = k < B_ACT[b] ? 'active' : k < B_ACT[b] + B_OPEN[b] ? 'opened' : 'invited';
      const inv = BATCH_DATE[b],
        joined = inv - (12 + Math.floor(r() * 30)) * DAY;
      const m = {
        id,
        no: 'M-' + String(id).padStart(4, '0'),
        first: FIRST[Math.floor(r() * 30)],
        last: LAST[Math.floor(r() * 30)],
        batch: b + 1,
        invited: inv,
        joined,
        city: pickCity(),
        src: r() < 0.85 ? 'Poster' : 'Website',
        status: st,
      };
      m.poster = m.src === 'Poster' ? pid(1 + Math.floor(r() * 102)) : null;
      if (st !== 'invited') m.opened = inv + Math.floor(r() * 4) * DAY;
      if (st === 'active') {
        m.fund = fund[fi++];
        m.activeAt = m.opened + Math.floor(r() * 5) * DAY;
        if (spent < 109) {
          m.spend = SPEND_SHOPS[Math.floor(r() * SPEND_SHOPS.length)];
          m.spentAt = Math.min(TODAY, m.activeAt + Math.floor(r() * 6) * DAY);
          spent++;
        }
      }
      m.last_ = Math.min(TODAY, (m.spentAt || m.activeAt || m.opened || inv) + Math.floor(r() * 5) * DAY);
      m.left = 90 - Math.round((TODAY - inv) / DAY);
      m.quiet = st === 'invited' && (TODAY - inv) / DAY >= 21;
      out.push(m);
      id++;
    }
  }
  return out;
})();
export const M_ST = {
  active: ['settled', 'Active'],
  opened: ['underway', 'Opened'],
  invited: ['plain', 'Invited'],
};
/* ── Overview ─────────────────────────────────────────────────────────── */
export const UK = {
  spent: ['Spent', 'var(--fg)', 'First spend in'],
  active: ['Active', 'color-mix(in srgb,var(--fg) 45%,transparent)', 'No spend yet'],
  opened: ['Opened', 'var(--land)', 'Not funded'],
  invited: ['Invited', '', 'Not opened'],
  quiet: ['Quiet', '', '3+ weeks'],
};
/* one square per person up to UC_CAP squares; past that each square stands for a round number of people, so the grid keeps its rows as batches grow */
export const UC_CAP = 360;
export const UC_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
/* ══ Merchants ═══════════════════════════════════════════════════════════
   Ties to Home and Growth: 30 poster shops are partners · 12 transacting (Uptown Barber joined today) ·
   founding seats 3 filled, Inland Cycle Works signing as 4/5 · $430.00 in $10 redemptions owed across 11 shops ·
   Rosa's payout $412.60 on NET-14 due tomorrow · Rosa's cap $100 to $150 waiting in the multisig · Mesa's cap raised to $120. */
export const XS = {
  pane: 'overview',
  pf: 'all',
  merchant: null,
  allSigned: false,
  txsort: 'busy',
};
/* id, name, kind, city, founding, fee %, terms, cap, cap hits (7d), originations, lost, Oct cleared, Oct txns, Sept cleared, hardware */
export const TX = [
  ['rosas', 'Rosa’s Panadería', 'Bakery', 'Redlands', 1, 2.0, 'NET-14', 100, 3, 41, 0, 1284.4, 23, 372.6, 'Point · Tap'],
  ['uptown', 'Uptown Barber', 'Barber', 'Redlands', 1, 0, 'NET-30', 100, 0, 7, 0, 412.0, 7, 0, 'Point'],
  ['mesa', 'Mesa Laundry', 'Laundromat', 'San Bernardino', 1, 2.0, 'NET-30', 120, 1, 36, 0, 968.1, 29, 640.2, 'Point'],
  ['tire', 'Redlands Tire & Lube', 'Auto and tires', 'Redlands', 0, 2.5, 'NET-30', 500, 2, 22, 1, 7940.0, 19, 5210.0, 'Tap · Counter'],
  ['citrus', 'Citrus Bowl Café', 'Café', 'Riverside', 0, 2.5, 'NET-30', 100, 0, 31, 1, 702.5, 27, 588.4, 'Point · 6 tables'],
  ['books', 'State St. Books', 'Books', 'Redlands', 0, 2.5, 'NET-30', 150, 0, 19, 0, 611.8, 16, 402.9, 'Point'],
  ['mich', 'La Michoacana', 'Ice cream', 'San Bernardino', 0, 2.5, 'NET-30', 100, 1, 44, 0, 498.2, 38, 455.1, 'Point'],
  ['nails', 'Arrowhead Nails', 'Nail salon', 'San Bernardino', 0, 2.5, 'NET-14', 150, 0, 14, 0, 1036.0, 14, 720.0, 'Point'],
  ['hdw', 'Highland Hardware', 'Hardware', 'Highland', 0, 2.5, 'NET-30', 300, 1, 17, 0, 2310.4, 17, 1488.6, 'Tap · Counter'],
  ['phone', 'Cajon Phone Repair', 'Phone repair', 'San Bernardino', 0, 2.5, 'NET-14', 300, 2, 21, 1, 3120.0, 21, 2240.0, 'Tap'],
  ['pet', 'Brookside Pet Wash', 'Pet care', 'Redlands', 0, 2.5, 'NET-30', 150, 0, 12, 0, 540.0, 12, 310.0, 'Point'],
  ['orange', 'Orange St. Laundromat', 'Laundromat', 'Redlands', 0, 2.5, 'NET-30', 100, 0, 15, 0, 402.3, 15, 286.8, 'Point'],
];
export const SIGNED = [
  ['icw', 'Inland Cycle Works', 'Bikes and repair', 'Redlands', 'signing'],
  ['shoe', 'Valley Shoe Repair', 'Shoe repair', 'Redlands'],
  ['tacos', 'Fontana Tacos', 'Restaurant', 'Fontana'],
  ['feed', 'Yucaipa Feed & Seed', 'Farm supply', 'Yucaipa'],
  ['pharm', 'Loma Linda Pharmacy', 'Pharmacy', 'Loma Linda'],
  ['cuts', 'Colton Cuts', 'Barber', 'Colton'],
  ['donut', 'Rialto Donuts', 'Bakery', 'Rialto'],
  ['bmkt', 'Bloomington Market', 'Grocery', 'Bloomington'],
  ['mcof', 'Mentone Coffee', 'Café', 'Mentone'],
  ['clean', 'Calimesa Cleaners', 'Dry cleaning', 'Calimesa'],
  ['deli', 'Grand Terrace Deli', 'Deli', 'Grand Terrace'],
  ['tea', 'Muscovy Tea', 'Tea', 'Redlands'],
  ['tailor', 'Sixth St. Tailor', 'Tailor', 'Redlands'],
  ['thrift', 'Kendall Thrift', 'Thrift', 'San Bernardino'],
  ['tires2', 'Tippecanoe Tires', 'Auto and tires', 'San Bernardino'],
  ['flor', 'Victoria Ave. Florist', 'Florist', 'Riverside'],
  ['pho', 'Base Line Pho', 'Restaurant', 'San Bernardino'],
  ['opt', 'Citrus Plaza Optical', 'Optical', 'Redlands'],
];
export const PROSPECTS = [
  /* name, kind, city, est financed/mo, owner, next step, stage */
  ['Mission Auto Care', 'Auto repair', 'Redlands', 9000, 'Marcus', 'Demo Thu 22 Oct', 'talking'],
  ['Orange Show Tires', 'Tires', 'San Bernardino', 7500, 'Marcus', 'Send numbers', 'talking'],
  ['Cypress Dental', 'Dental', 'Redlands', 6000, 'Kai', 'Owner call Mon', 'talking'],
  ['Sun Valley HVAC', 'HVAC', 'Highland', 12000, 'Marcus', 'Ride-along Fri', 'talking'],
  ['Barton Rd. Appliance', 'Appliances', 'Grand Terrace', 5500, 'Dana', 'Second visit', 'talking'],
  ['Tri-City Transmission', 'Auto repair', 'San Bernardino', 8000, 'Marcus', 'Wants net-14', 'talking'],
  ['Kingston Vet', 'Veterinary', 'Redlands', 4500, 'Kai', 'Intro email', 'talking'],
  ['Redlands Smog & Brake', 'Auto repair', 'Redlands', 5000, 'Marcus', 'Walk in', 'prospect'],
  ['IE Mattress Outlet', 'Mattresses', 'Colton', 6500, 'Dana', 'Walk in', 'prospect'],
  ['Lugonia Auto Glass', 'Auto glass', 'Redlands', 4000, 'Marcus', 'Walk in', 'prospect'],
  ['Sunset Muffler', 'Auto repair', 'Rialto', 3500, 'Marcus', 'Walk in', 'prospect'],
  ['University Optometry', 'Optical', 'Redlands', 3000, 'Dana', 'Walk in', 'prospect'],
  ['Fontana Furniture', 'Furniture', 'Fontana', 7000, 'Dana', 'Walk in', 'prospect'],
  ['Yucaipa Pet Clinic', 'Veterinary', 'Yucaipa', 4000, 'Kai', 'Walk in', 'prospect'],
];
export const OWED = {
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
  tacos: 40,
};
export const TXO = TX.map(T);
export const CAPS = [100, 120, 150, 300, 500];
/* ── Overview ─────────────────────────────────────────────────────────── */
/* real places for the live map: lng, lat, and which side the label sits so neighbours never collide */
export const CITY_LL = {
  Fontana: [-117.435, 34.092, 'w'],
  Rialto: [-117.37, 34.106, 'n'],
  Bloomington: [-117.396, 34.07, 's'],
  Colton: [-117.314, 34.074, 'sw'],
  'San Bernardino': [-117.29, 34.108, 'n'],
  Highland: [-117.209, 34.128, 'ne'],
  'Grand Terrace': [-117.313, 34.034, 'sw'],
  'Loma Linda': [-117.261, 34.048, 'se'],
  Redlands: [-117.183, 34.056, 'se'],
  Mentone: [-117.135, 34.07, 'ne'],
  Yucaipa: [-117.043, 34.034, 'e'],
  Calimesa: [-117.061, 33.982, 'se'],
  Riverside: [-117.376, 33.981, 'w'],
};
export const CM_ST = {
  t1: ['Transacting', 'var(--fg)'],
  sg: ['Signing', 'var(--live)'],
  si: ['Signed', 'var(--fg-70)'],
  pr: ['Talking', 'var(--fg-50)'],
};
vars.CM_DATA = [];
vars.CMAP = null;
export const CK = {
  t1: 'ck-tx',
  sg: 'ck-sg',
  si: 'ck-si',
  pr: 'ck-pr',
};
/* ── placeholder basemap, drawn in the same projection as the live map so nothing moves when tiles arrive ── */
export const CM_K = Math.cos((34.05 * Math.PI) / 180);
export const CM_GEO = {
  hills: [
    [-117.7, 34.4],
    [-117.7, 34.19],
    [-117.55, 34.185],
    [-117.45, 34.178],
    [-117.36, 34.172],
    [-117.3, 34.168],
    [-117.25, 34.155],
    [-117.2, 34.142],
    [-117.14, 34.128],
    [-117.07, 34.118],
    [-116.98, 34.105],
    [-116.85, 34.1],
    [-116.85, 34.4],
  ],
  badl: [
    [-117.3, 33.985],
    [-117.27, 34.012],
    [-117.22, 34.026],
    [-117.15, 34.02],
    [-117.095, 34.004],
    [-117.075, 33.975],
    [-117.09, 33.93],
    [-117.2, 33.9],
    [-117.29, 33.93],
  ],
  jurupa: [
    [-117.52, 34.032],
    [-117.46, 34.046],
    [-117.42, 34.04],
    [-117.41, 34.02],
    [-117.45, 34.004],
    [-117.52, 34.008],
  ],
  river: [
    [-116.98, 34.115],
    [-117.09, 34.098],
    [-117.15, 34.088],
    [-117.21, 34.08],
    [-117.26, 34.072],
    [-117.3, 34.058],
    [-117.33, 34.035],
    [-117.36, 34.008],
    [-117.4, 33.988],
    [-117.44, 33.964],
    [-117.52, 33.93],
    [-117.6, 33.9],
  ],
  fwy: {
    '10': [
      [-117.7, 34.071],
      [-117.47, 34.07],
      [-117.4, 34.068],
      [-117.33, 34.066],
      [-117.29, 34.064],
      [-117.25, 34.062],
      [-117.2, 34.059],
      [-117.15, 34.05],
      [-117.1, 34.038],
      [-117.06, 34.01],
      [-117.04, 33.975],
      [-117.0, 33.93],
      [-116.9, 33.9],
    ],
    '215': [
      [-117.22, 33.84],
      [-117.3, 33.94],
      [-117.33, 33.975],
      [-117.325, 34.02],
      [-117.31, 34.05],
      [-117.305, 34.075],
      [-117.295, 34.11],
      [-117.31, 34.15],
      [-117.38, 34.24],
    ],
    '210': [
      [-117.7, 34.132],
      [-117.47, 34.131],
      [-117.38, 34.13],
      [-117.3, 34.131],
      [-117.24, 34.128],
      [-117.2, 34.118],
      [-117.185, 34.09],
      [-117.18, 34.062],
    ],
    '60': [
      [-117.7, 34.02],
      [-117.47, 34.005],
      [-117.4, 33.99],
      [-117.345, 33.978],
      [-117.33, 33.975],
      [-117.3, 33.94],
      [-117.22, 33.937],
      [-116.95, 33.93],
    ],
    '15': [
      [-117.55, 33.8],
      [-117.53, 33.98],
      [-117.52, 34.07],
      [-117.48, 34.2],
    ],
  },
  shields: [
    ['10', -117.375, 34.067],
    ['215', -117.326, 34.0],
    ['210', -117.42, 34.1305],
    ['60', -117.455, 33.999],
    ['10', -117.08, 34.026],
  ],
};
/* the live map: MapLibre (the open-source Mapbox GL) on free OpenFreeMap tiles. One instance, moved into each render. */
export const ML_STYLE = 'https://tiles.openfreemap.org/styles/positron';
/* ── Pipeline board: one list of shops, each with a stage. Drag a card between columns (press and drag with a mouse, touch and hold on a phone). ── */
export const KST = [
  ['prospect', 'Prospect'],
  ['talking', 'Talking'],
  ['signing', 'Signing'],
  ['signed', 'Signed'],
];
/* ── Board card panel ─────────────────────────────────────────────────────
   Built around what people do with a shop in the pipeline: see where it stands, do the next step, log what happened,
   move it on. Edits save as you go (a new prospect saves when you add it). Owners come from Permissions, so the list
   grows with the team; due dates and activity make "who's on it and what's late" readable at a glance. */
export const LOGT = {
  note: ['Note', 'N'],
  call: ['Call', 'C'],
  visit: ['Visit', 'V'],
  demo: ['Demo', 'D'],
  stage: ['Stage', '→'],
  edit: ['Change', '·'],
};
export const NEXT_ACT = {
  prospect: ['Move to Talking', 'talking', 'Moved to Talking'],
  talking: ['Send the agreement', 'signing', 'Agreement sent · moved to Signing'],
  signing: ['Mark signed', 'signed', 'Agreement back · marked signed'],
};
vars.KE = null;
/* ══ Field ══════════════════════════════════════════════════════════════
   Built for a phone on the poster route. Ties to Home ("Poster route 3/8 · Marcus Lee"),
   Growth (P-044 faded at Mesa Laundry, swaps due) and Merchants (Orange St. Point unplugged since 08:40,
   Citrus Bowl table 4 battery low). */
export const FS = {
  stop: null,
  scan: null,
  outcome: null,
  who: 'marcus',
};
export const STOPS = [
  {
    id: 'uptown',
    name: 'Uptown Barber',
    city: 'Redlands',
    where: 'E Citrus Ave',
    eta: '09:05',
    tasks: [
      {
        kind: 'poster',
        n: 12,
        t: 'Swap P-012',
        done: '09:12',
        out: 'Replaced',
        photo: 1,
      },
    ],
  },
  {
    id: 'shoe',
    name: 'Valley Shoe Repair',
    city: 'Redlands',
    where: 'State St',
    eta: '09:30',
    tasks: [
      {
        kind: 'poster',
        n: 81,
        t: 'Swap P-081',
        done: '09:41',
        out: 'Replaced',
        photo: 1,
      },
    ],
  },
  {
    id: 'pet',
    name: 'Brookside Pet Wash',
    city: 'Redlands',
    where: 'Brookside Ave',
    eta: '10:00',
    tasks: [
      {
        kind: 'poster',
        shop: 'Brookside Pet Wash',
        t: 'Check the poster',
        done: '10:08',
        out: 'Checked',
      },
    ],
  },
  {
    id: 'orange',
    name: 'Orange St. Laundromat',
    city: 'Redlands',
    where: 'N Orange St',
    eta: '10:30',
    tasks: [
      {
        kind: 'poster',
        n: 27,
        t: 'Swap P-027',
      },
      {
        kind: 'device',
        t: 'Plug in the counter Clear Point',
        note: 'Offline since 08:40',
      },
    ],
  },
  {
    id: 'mesa',
    name: 'Mesa Laundry',
    city: 'San Bernardino',
    where: 'W Highland Ave',
    eta: '11:15',
    tasks: [
      {
        kind: 'poster',
        n: 44,
        t: 'Replace P-044',
        note: 'Sun-faded, 4 days late',
      },
    ],
  },
  {
    id: 'bmkt',
    name: 'Bloomington Market',
    city: 'Bloomington',
    where: 'Valley Blvd',
    eta: '11:50',
    tasks: [
      {
        kind: 'poster',
        n: 55,
        t: 'Swap P-055',
      },
    ],
  },
  {
    id: 'citrus',
    name: 'Citrus Bowl Café',
    city: 'Riverside',
    where: 'Main St',
    eta: '12:40',
    tasks: [
      {
        kind: 'device',
        t: 'Swap the battery on table 4',
        note: 'Battery low since 19:12',
      },
    ],
  },
  {
    id: 'tailor',
    name: 'Sixth St. Tailor',
    city: 'Riverside',
    where: 'Sixth St',
    eta: '13:20',
    tasks: [
      {
        kind: 'poster',
        n: 71,
        t: 'Replace P-071',
        note: 'Faded',
      },
    ],
  },
];
export const LATER = [
  /* shop, city, note, state, poster, what's wrong, what to do, when, detour, last visit */
  [
    'Calimesa Cleaners',
    'Calimesa',
    'P-063 is missing. Needs a new poster and a word with the owner.',
    'missing',
    'P-063',
    'Gone from the window',
    'Bring design A and talk to the owner',
    'Overdue',
    '+22 min',
    '12 Sep',
  ],
  [
    'Victoria Ave. Florist',
    'Riverside',
    'P-090 is faded. Swap due in 25 days.',
    'faded',
    'P-090',
    'Faded in the sun',
    'Swap early or wait for 15 Nov',
    'Due 15 Nov',
    '+14 min',
    '2 Sep',
  ],
];
export const OUT = {
  Checked: ['settled', 'check', 'Up and fine', 'Up and fine'],
  Damaged: ['underway', 'alert', 'Torn, faded or wet', 'Needs a swap'],
  Replaced: ['settled', 'swap', 'New poster up', 'New poster up'],
  Missing: ['absent', 'close', 'Gone from the window', 'Not in the window'],
};
export const SHOP_INFO = {
  uptown: ['8 pm', 'Andre', '12 Sep'],
  shoe: ['6 pm', 'Luis', '2 Sep'],
  pet: ['7 pm', 'Kim', '29 Sep'],
  orange: ['10 pm', 'Ms. Tran', '26 Aug'],
  mesa: ['11 pm', 'Dana', '19 Oct'],
  bmkt: ['9 pm', 'Hector', '24 Aug'],
  citrus: ['3 pm', 'Sofia', '14 Oct'],
  tailor: ['6 pm', 'Mr. Ruiz', '30 Aug'],
};
/* ══ Money ══════════════════════════════════════════════════════════════
   Read-only. Each tab answers one question. Two checks stay apart on purpose: RTD is the gate
   (AssurancePool over unsecured credit); claims-in-order is a reporting view and is never summed.
   Ties: $12,839.25 owed to shops by 4 Nov, $1,482.36 due from members, payout pool $10,240.00,
   so the pool runs $1,116.89 short on 4 Nov. PayoutPool.drawForDueClaim then borrows the gap: the yield pool's free cash first,
   then AssurancePool excess (never its primary reserve). Repaid from member repayments, principal then carry. */
export const NS = {
  pane: 'overview',
  sf: 'all',
  acct: null,
};
export const M = {
  savings: 38940.2,
  cash: 21480.75,
  payout: 10240.0,
  assurance: 1420.0,
  coop: 476.2,
  credit: 14212.4,
  savingsBacked: 8640.0,
  unsecured: 5572.4,
  limits: 41600.0,
  lost: 612.0,
  owed14: 12839.25,
  dueMembers: 1482.36,
  bonds: 25000.0,
  floor: 0.2,
};
/* the yield pool (LendingPool on Base Sepolia, ERC-4626). It funds the unsecured tiers and takes their first loss,
   before the AssurancePool. Rates follow the contract's curve: per cycle, base 25 bps, +75 to the 80% kink, +900 past it.
   Depositors are paid through the share price: nothing is distributed, it's realised when they withdraw. */
export const Y = {
  assets: 9000.0,
  principal: 8962.1,
  lent: M.unsecured,
  depositors: 18,
  pledged: 1200.0,
  queued: 0,
  opened: '15 Oct',
  cycleDays: 30,
  curve: {
    base: 25,
    s1: 75,
    s2: 900,
    kink: 0.8,
  },
};
Y.cash = Y.assets - Y.lent;
Y.util = Y.lent / Y.assets;
Y.earned = Y.assets - Y.principal;
Y.price = Y.assets / Y.principal;
/* compounded each cycle */
Y.borrowBps = yBorrowBps(Y.util);
Y.supplyBps = Y.borrowBps * Y.util;
Y.apy = yApy(Y.supplyBps);
Y.apr = yApr(Y.borrowBps);
M.rtd = M.assurance / M.unsecured;
M.room = M.assurance / M.floor - M.unsecured; /* unsecured credit that can still issue */
/* unsecured credit that can still issue */
M.short = Math.max(0, M.owed14 - M.payout - M.dueMembers);
/* the 4 Nov payout gap, borrowed from the pool's free cash when the claim comes due */
Y.toPayout = Math.min(M.short, Y.cash);
Y.utilAfter = (Y.lent + Y.toPayout) / Y.assets;
Y.apyAfter = yApy(yBorrowBps(Y.utilAfter) * Y.utilAfter);
export const YLD = Y;
/* nOverview shadows Y with its chart scale */
export const NW = WEEKS.slice(5);
/* 8 Sep → 20 Oct, launch onward */
export const AP_BAL = [0, 400, 520, 690, 860, 1110, M.assurance];
export const UNSEC = [0, 900, 2050, 3450, 4400, 5100, M.unsecured];
export const AP_REQ = UNSEC.map((v) => v * M.floor);
export const RTD_W = AP_BAL.map((v, i) => (UNSEC[i] ? v / UNSEC[i] : null));
export const COOP_W = [22.4, 39.4, 78.4, 109.2, 126.8, 100.0];
/* added each week, 15 Sep → 20 Oct */
/* the next 30 days, day 0 = 21 Oct */
export const FLOWS = [
  [1, 'out', 412.6, 'Rosa’s Panadería', 'NET-14 payout'],
  [3, 'in', 592.94, 'Member repayments', 'Autopay batch'],
  [9, 'in', 889.42, 'Member repayments', 'Autopay batch'],
  [12, 'out', 9510.65, 'Monthly run', '11 shops · NET-30'],
  [14, 'out', 2916.0, 'NET-14 payouts', 'Arrowhead Nails, Cajon Phone'],
  [16, 'in', 2310.2, 'Member repayments', 'Autopay batch'],
  [28, 'out', 1140.8, 'NET-14 payouts', 'Estimate'],
];
export const BONDS = [
  /* id, face, issued, matures, term in months, internal rate, holder */ ['BB-0001', 2500, '14 Aug', '14 Dec', 4, 6.0, 'Member'],
  ['BB-0002', 5000, '21 Aug', '21 Jan', 5, 6.5, 'Founding lender'],
  ['BB-0003', 2500, '2 Sep', '2 Mar', 6, 7.0, 'Member'],
  ['BB-0004', 2500, '9 Sep', '9 Mar', 6, 7.0, 'Member'],
  ['BB-0005', 7500, '1 Oct', '1 Jun', 8, 7.5, 'Founding lender'],
  ['BB-0006', 5000, '15 Oct', '15 Sep', 11, 8.0, 'Member'],
];
/* every account we hold, in the order the bar draws them: whose money it is decides the bracket */
export const ACCTS = [
  /* id, name, what it's for, owner group, source, balance, 7 weeks, colour */
  [
    'sav',
    'Member savings',
    'CLRUSD, backed 1:1 by USDC at Bridge',
    'members',
    'bridge',
    M.savings,
    [0, 2100, 6400, 13900, 22800, 31200, M.savings],
    'var(--fg)',
  ],
  [
    'yld',
    'Yield pool',
    'Members’ deposits · cash not lent out yet',
    'members',
    'protocol',
    Y.cash,
    [0, 0, 0, 0, 0, 2180, Y.cash],
    'color-mix(in srgb,var(--live) 60%,transparent)',
  ],
  [
    'pay',
    'Payout pool',
    'Pays shops for financed sales, oldest first',
    'set',
    'protocol',
    M.payout,
    [0, 1200, 3900, 5200, 7800, 9600, M.payout],
    'var(--fg-50)',
  ],
  ['ap', 'AssurancePool', 'Covers unsecured losses after the yield pool', 'set', 'protocol', M.assurance, AP_BAL, 'var(--underway)'],
  [
    'ops',
    'Operating cash',
    'Business checking · the co-op’s own money',
    'coop',
    'plaid',
    M.cash,
    [16800, 17900, 18600, 19800, 20400, 21100, M.cash],
    'var(--land)',
  ],
  [
    'coop',
    'Co-op balance',
    'Discounts on member purchases, held for a vote',
    'coop',
    'protocol',
    M.coop,
    [0, 22.4, 61.8, 140.2, 249.4, 376.2, M.coop],
    'color-mix(in srgb,var(--land) 45%,transparent)',
  ],
];
export const GROUPS = {
  members: ['Members’ money', 'Owed back to members on request'],
  set: ['Set aside', 'Only for shops and losses'],
  coop: ['The co-op’s', 'Ours to run on'],
};
/* ── Yield pool: members lending to unsecured credit (LendingPool, ERC-4626) ── */
export const YD = ['15 Oct', '16 Oct', '17 Oct', '18 Oct', '19 Oct', '20 Oct', '21 Oct', '22 Oct'];
export const Y_ASSETS = [8062.1, 8062.1, 8062.1, 7818.8, 7818.8, 8968.8, 9000.0, Y.assets];
export const Y_LENT = [5210.0, 5262.4, 5301.1, 5355.8, 5410.2, 5488.0, 5540.6, Y.lent];
/* 18 depositors, by what their shares are worth now; earned split pro rata, so the rows reconcile to the pool */
export const Y_DEP = [
  ['4f', 1500, '15 Oct', 600],
  ['a2', 1000, '15 Oct', 400],
  ['c9', 1000, '15 Oct', 0],
  ['17', 750, '15 Oct', 0],
  ['e0', 600, '15 Oct', 200],
  ['5b', 500, '15 Oct', 0],
  ['9d', 500, '15 Oct', 0],
  ['b3', 500, '20 Oct', 0],
  ['61', 400, '15 Oct', 0],
  ['2e', 350, '15 Oct', 0],
  ['d8', 300, '15 Oct', 0],
  ['7a', 300, '15 Oct', 0],
  ['f4', 250, '15 Oct', 0],
  ['0c', 250, '20 Oct', 0],
  ['8b', 200, '15 Oct', 0],
  ['3f', 200, '15 Oct', 0],
  ['c1', 200, '20 Oct', 0],
  ['6e', 200, '20 Oct', 0],
];
/* ══ Contracts ══════════════════════════════════════════════════════════
   Agreements on paper, contracts on-chain, and the changes moving between them. Nothing here holds a key:
   changes are drafted here and signed in the Ops Safe (2 of 3); agreements are signed in the e-signature tool.
   Ties: Inland Cycle Works out for signature (Home, Needs you); Rosa's cap raise signed and in the wait (Merchants);
   RevolvingIssuer v1.3 live 21 Oct (Home, Dana Ruiz); PayoutPool top-up of $1,116.89 due 30 Oct (Money). */
export const CS = {
  pane: 'overview',
  af: 'all',
  ag: null,
  ct: null,
};
export const NOW = TODAY + 14 * 3600e3;
/* 21 Oct, 14:00 */
export const YEAR = 365 * DAY;
export const AST = {
  signed: ['plain', 'Signed'],
  renew: ['underway', 'Renewal due'],
  out: ['live', 'Waiting on you'],
  sent: ['underway', 'Out for signature'],
  draft: ['plain', 'Draft'],
};
export const AGR_T = {
  company: 'Company',
  provider: 'Providers',
  member: 'Members',
  merchant: 'Merchant partners',
};
export const AGR = [
  {
    id: 'coop-oa',
    name: 'Cooperative operating agreement',
    party: 'Clear Co-op',
    type: 'company',
    st: 'signed',
    a: D(6, 12),
    b: null,
    ver: 'v1.0',
    note: 'Adopted by the founding members. Changes need a member vote.',
  },
  {
    id: 'psa',
    name: 'Program services agreement',
    party: 'Clear Financial Co.',
    type: 'company',
    st: 'renew',
    a: D(1, 1),
    b: D(1, 1, 2027),
    ver: 'v1.0',
    note: 'Clear Financial Co. runs the card and money programs for the co-op.',
  },
  {
    id: 'pma',
    name: 'Protocol maintenance',
    party: 'ClearLabs Inc.',
    type: 'company',
    st: 'renew',
    a: D(12, 15, 2025),
    b: D(12, 15),
    ver: 'v1.0',
    note: 'ClearLabs maintains the protocol for the Foundation, which can hire other maintainers too.',
  },
  {
    id: 'ics',
    name: 'Intercompany services',
    party: 'Clear Capital Holdings',
    type: 'company',
    st: 'draft',
    a: null,
    b: null,
    ver: 'v0.3',
    note: 'Pricing for services between the co-op and Holdings, at arm’s length.',
  },
  {
    id: 'lithic',
    name: 'Card program agreement',
    party: 'Lithic',
    type: 'provider',
    st: 'signed',
    a: D(3, 2),
    b: D(3, 1, 2027),
    ver: 'v2.0',
    note: 'Cards and authorizations.',
  },
  {
    id: 'bridge',
    name: 'Stablecoin services',
    party: 'Bridge',
    type: 'provider',
    st: 'signed',
    a: D(7, 18),
    b: D(7, 18, 2027),
    ver: 'v1.0',
    note: 'USDC on and off ramps. Holds the reserve behind member savings.',
  },
  {
    id: 'plaid',
    name: 'Bank data',
    party: 'Plaid',
    type: 'provider',
    st: 'renew',
    a: D(11, 12, 2025),
    b: D(11, 12),
    ver: 'v1.0',
    note: 'Bank links for members and the business account.',
  },
  {
    id: 'esign',
    name: 'E-signature',
    party: 'E-signature tool',
    type: 'provider',
    st: 'signed',
    a: D(8, 1),
    b: null,
    roll: 1,
    ver: '—',
    note: 'Month to month. Signed copies come back here.',
  },
  {
    id: 'print',
    name: 'Poster printing',
    party: 'Inland Print Co.',
    type: 'provider',
    st: 'renew',
    a: D(11, 30, 2025),
    b: D(11, 30),
    ver: 'v1.0',
    note: 'Window posters, printed in batches of 25.',
  },
  {
    id: 'mem21',
    name: 'Member agreement',
    party: 'Every member',
    type: 'member',
    st: 'signed',
    a: D(8, 14),
    b: null,
    ver: 'v2.1',
    note: 'Accepted by 188 members when they opened an account.',
  },
  {
    id: 'mem22',
    name: 'Member agreement',
    party: 'Every member',
    type: 'member',
    st: 'draft',
    a: null,
    b: null,
    ver: 'v2.2',
    note: 'Adds the term-plan terms. Members accept it in the app once it’s final.',
  },
];
export const TXD = [D(8, 3), D(8, 6), D(8, 10), D(8, 14), D(8, 21), D(8, 28), D(9, 2), D(9, 9), D(9, 16), D(9, 23), D(9, 30), D(10, 20)];
export const CTR = [
  /* id, name, version, layer, status, address, what it does, x, y, band (c credit · d deeds) — addresses from deployments/base-sepolia on the dev branch */
  ['am', 'AccessManager', 'v1.0', 0, 'live', '0x19aB…f207', 'Role-based access for the protocol. Admin is the Ops Safe.', 10, 13, 'c'],
  ['ms', 'MembershipRegistry', 'v1.0', 0, 'live', '0xE700…4dE8', 'Member entitlements on-chain, no personal data.', 10, 21, 'c'],
  ['nr', 'NetworkRegistry', 'v1.0', 0, 'live', '0x0a9F…3D7f', 'The parent registry every issuer is registered against.', 10, 37, 'c'],
  ['cr', 'CollateralRegistry', 'v1.0', 0, 'live', '0x62fB…52Cf', 'What each member has pledged, and what the AssurancePool would pay.', 10, 29, 'c'],
  ['mr', 'MerchantRegistry', 'v1.0', 0, 'live', '0x4172…f1f5', 'What each shop was promised: payout schedule, cap, fee, status.', 10, 45, 'c'],
  ['tr', 'TokenRegistry', 'v1.0', 0, 'live', '0x4B13…6a86', 'Which tokens count, with fallback prices.', 10, 53, 'c'],
  ['lc', 'LimitCalculator', 'v1.0', 1, 'live', '0xbA98…c0a7', 'Turns pledges and attestations into a member’s ceiling.', 30, 21, 'c'],
  ['ri', 'RevolvingIssuer', 'v1.3', 1, 'live', '0x7f15…6070', 'The tiered revolving line: savings-backed, asset-backed, income and Boost.', 30, 29, 'c'],
  ['ti', 'TermIssuer', 'v1.0', 1, 'live', '0xe467…3721', 'Term plans: partner credit, Clear Cash and the ELPA.', 30, 53, 'c'],
  ['lq', 'Liquidator', 'v1.0', 1, 'live', '0x8E2E…9593', 'Turns a defaulted member’s pledged savings into repayment of their own debt.', 30, 69, 'c'],
  ['cc', 'ClearCredit', 'v1.1', 2, 'live', '0x1d9f…928C', 'The co-op’s credit ledger, the deployable StableCredit. Only issuers mint.', 50, 39, 'c'],
  ['cu', 'ClearUSD', 'v1.1', 2, 'live', '0x2a11…D6D1', 'CLRUSD, upgradeable. Settles savings and bridges by CCIP.', 50, 69, 'c'],
  ['ao', 'AssuranceOracle', 'v1.0', 3, 'live', '0x2E52…Fe38', 'Prices reserve tokens.', 70, 13, 'c'],
  ['ap', 'AssurancePool', 'v1.2', 3, 'live', '0xf5E4…5840', 'Absorbs losses on unsecured credit. RTD reads it and nothing else.', 70, 21, 'c'],
  ['lp', 'LendingPool', 'v1.0', 3, 'live', '0x5840…ce23', 'Member money funding the unsecured tiers. Takes first loss. Not funded yet.', 70, 29, 'c'],
  ['cp', 'CreditPool', '—', 3, 'later', '—', 'In the repo, not deployed. Members deposit credit for others to draw.', 70, 37, 'c'],
  ['pp', 'PayoutPool', 'v0.9', 3, 'live', '0xe9d1…7D66', 'Pays shops on the schedule they were promised, oldest claim first.', 70, 45, 'c'],
  ['esa', 'ESADepositVault', 'v1.1', 3, 'live', '0x8364…413b', 'Member savings, CLRUSD backed 1:1 by USDC.', 70, 69, 'c'],
  ['ce', 'ClaimEscrow', 'v1.0', 3, 'live', '0x24DA…c37D', 'Holds USDC sent by link until it’s claimed or refunded.', 70, 53, 'c'],
  ['si', 'SavingsIntent', 'v1.0', 3, 'live', '0xee28…C8Bc', 'One-transfer escrows that turn a deposit into savings.', 70, 61, 'c'],
  ['bb', 'BurnerBond', 'v1.0', 4, 'live', '0x4d96…c148', 'Zero-coupon bonds, one token each, with their factory and deposit. 6 issued.', 90, 21, 'c'],
  ['bv', 'BondVault', 'v1.0', 4, 'live', '0x9f31…A855', 'Where bond proceeds live, behind a redemption reserve. Not funded yet.', 90, 29, 'c'],
  ['bvl', 'BondValuer', 'v1.0', 1, 'live', '0x64d5…0d2C', 'What a member’s pledged bonds are worth today, for CollateralRegistry.', 30, 61, 'c'],
  ['vr', 'ValidatorRegistry', 'v1.0', 0, 'live', '0x979E…bc91', 'Which validators may approve deeds, and for what.', 10, 84, 'd'],
  ['va', 'Validator', 'v1.0', 1, 'live', '0x18C5…79b9', 'Checks a deed’s title and papers before it’s minted. Made by the ValidatorFactory.', 30, 84, 'd'],
  ['mx', 'MetadataRenderer', 'v1.0', 1, 'live', '0x849e…70E5', 'Renders a deed’s features, condition and legal details.', 30, 93, 'd'],
  ['dn', 'DeedNFT', 'v1.1', 2, 'live', '0x1a4e…21E6', 'One token per property deed, with its traits and validation.', 50, 84, 'd'],
  ['sd', 'Subdivide', 'v1.0', 2, 'live', '0x3c94…923F', 'Splits a deed into units, like lots or rooms.', 50, 93, 'd'],
  ['fz', 'Fractionalize', 'v1.0', 3, 'live', '0xeC46…9823', 'Locks a deed or its units and issues shares against it.', 70, 84, 'd'],
  ['ft', 'FractionToken', 'v1.0', 4, 'live', '0x3E51…28dc', 'Shares in one property, made by the FractionTokenFactory.', 90, 84, 'd'],
  ['fm', 'FundManager', 'v1.0', 4, 'live', '0x73ea…401e', 'Money around deeds: commissions and payouts.', 90, 93, 'd'],
];
export const LAYERS = ['Access', 'Issuance', 'Tokens', 'Pools and escrow', 'Capital'];
export const REL = [
  /* from, to, kind (reads · money · mint), verb, label on the map (blank = drawn, unlabelled · null = panel only), label side for vertical lines */
  ['ms', 'am', 'reads', 'checks members', ''],
  ['am', 'cc', 'reads', 'sets roles', null],
  ['nr', 'cr', 'reads', 'lists issuers', ''],
  ['nr', 'cc', 'reads', 'registers issuers', null],
  ['cr', 'lc', 'reads', 'pledges', ''],
  ['bvl', 'cr', 'reads', 'values bonds', ''],
  ['lc', 'ri', 'reads', 'limits', ''],
  ['lp', 'ri', 'money', 'funds unsecured credit', 'funds unsecured'],
  ['ri', 'cc', 'mint', 'mints credit', 'mints'],
  ['ti', 'cc', 'mint', 'mints credit', ''],
  ['cc', 'ap', 'money', 'claims on losses', ''],
  ['ao', 'ap', 'reads', 'prices reserves', ''],
  ['tr', 'ao', 'reads', 'token list', null],
  ['lp', 'ap', 'money', 'takes first loss', ''],
  ['cc', 'pp', 'money', 'pays merchant balances', ''],
  ['mr', 'pp', 'reads', 'payout terms', 'terms', 50],
  ['cc', 'cp', 'reads', 'credit deposits', ''],
  ['esa', 'cu', 'mint', 'mints against USDC', 'mints'],
  ['si', 'esa', 'money', 'deposits', ''],
  ['lq', 'cu', 'money', 'seizes pledged CLRUSD', 'seizes'],
  ['lq', 'esa', 'reads', 'redeems', null],
  ['lq', 'cc', 'reads', 'repays debt', null],
  ['bb', 'bv', 'money', 'bond proceeds', ''],
  ['vr', 'va', 'reads', 'lists validators', 'lists'],
  ['va', 'dn', 'reads', 'validates', 'checks'],
  ['mx', 'dn', 'reads', 'renders', ''],
  ['dn', 'sd', 'mint', 'splits into units', ''],
  ['dn', 'fz', 'money', 'locks deeds', 'locks'],
  ['sd', 'fz', 'money', 'locks units', ''],
  ['fz', 'ft', 'mint', 'issues shares', 'issues'],
  ['fm', 'dn', 'reads', 'commissions', null],
];
export const EDGES = REL.filter((r) => r[4] !== null);
export const RK = {
  reads: 'Reads from',
  money: 'Moves money',
  mint: 'Mints tokens',
};
export const RELEASES = {
  /* versions by contract, for the release lanes and panes */
  cc: [
    ['v1.0', D(8, 2)],
    ['v1.1', D(9, 2)],
  ],
  ri: [
    ['v1.0', D(8, 2)],
    ['v1.1', D(9, 2)],
    ['v1.2', D(9, 30)],
    ['v1.3', D(10, 21)],
  ],
  ti: [['v1.0', D(10, 8)]],
  lq: [['v1.0', D(10, 8)]],
  lp: [['v1.0', D(10, 14)]],
  bv: [['v1.0', D(10, 14)]],
  bvl: [['v1.0', D(10, 14)]],
  ap: [
    ['v1.0', D(8, 2)],
    ['v1.1', D(9, 2)],
    ['v1.2', D(9, 29)],
  ],
  ao: [['v1.0', D(9, 2)]],
  bb: [['v1.0', D(8, 14)]],
  esa: [
    ['v1.0', D(8, 2)],
    ['v1.1', D(9, 9)],
  ],
  nr: [['v1.0', D(9, 9)]],
  mr: [['v1.0', D(9, 9)]],
  cr: [['v1.0', D(9, 16)]],
  lc: [['v1.0', D(9, 16)]],
  pp: [
    ['v0.8', D(9, 22)],
    ['v0.9', D(10, 6)],
  ],
  am: [['v1.0', D(8, 2)]],
  ms: [['v1.0', D(9, 24)]],
  tr: [['v1.0', D(9, 2)]],
  cu: [['v1.0', D(9, 2)]],
  ce: [['v1.0', D(10, 1)]],
  si: [['v1.0', D(10, 8)]],
  vr: [['v1.0', D(8, 20)]],
  va: [['v1.0', D(8, 20)]],
  mx: [['v1.0', D(8, 20)]],
  dn: [
    ['v1.0', D(8, 20)],
    ['v1.1', D(9, 30)],
  ],
  sd: [['v1.0', D(9, 10)]],
  fz: [['v1.0', D(9, 10)]],
  ft: [['v1.0', D(9, 10)]],
  fm: [['v1.0', D(8, 20)]],
};
export const PENDING = {
  ap: ['v1.3', D(10, 22, 2026, 14)],
};
export const CH = [
  {
    id: 'ch2',
    t: 'AssurancePool v1.3',
    c: 'AssurancePool',
    by: 'Dana Ruiz',
    mine: 1,
    stage: 2,
    state: 'Waiting on you · 1 of 2',
    d: 'Gates every withdrawal behind a role, so only bonds, credit and lending can claim. Closes the open withdraw.',
    ev: [
      ['seg', 'done', H(10, 12, 10), H(10, 20, 9)],
      ['seg', 'open', H(10, 20, 9), NOW],
      ['seg', 'proj', NOW, H(10, 22, 14)],
      ['draft', H(10, 12, 10)],
      ['check', H(10, 18, 11)],
      ['sign', H(10, 20, 9), 'DR'],
      ['sign', NOW, 'K', 1],
      ['live', H(10, 22, 14), 1],
    ],
  },
  {
    id: 'ch1',
    t: 'Raise Rosa’s cap to $150.00',
    c: 'MerchantRegistry',
    by: 'Marcus Lee',
    stage: 3,
    state: 'Live tomorrow, 12:00',
    d: 'Signed by Marcus Lee and you. In the 24-hour wait.',
    ev: [
      ['seg', 'done', H(10, 19, 11), H(10, 21, 12)],
      ['seg', 'wait', H(10, 21, 12), H(10, 22, 12)],
      ['draft', H(10, 19, 11)],
      ['check', H(10, 19, 16)],
      ['sign', H(10, 20, 18), 'ML'],
      ['sign', H(10, 21, 12), 'K'],
      ['live', H(10, 22, 12), 1],
    ],
  },
  {
    id: 'ch3',
    t: 'PayoutPool top-up',
    c: 'PayoutPool',
    by: 'You',
    stage: 0,
    state: '$1,116.89 · needs a second person',
    d: 'Optional. Otherwise the yield pool lends it on 4 Nov; from operating cash, the co-op earns the interest. Due 30 Oct.',
    ev: [
      ['seg', 'open', H(10, 21, 13), NOW],
      ['seg', 'proj', NOW, H(10, 30, 12)],
      ['draft', H(10, 21, 13)],
      ['due', H(10, 30, 12), 'Due 30 Oct'],
    ],
  },
  {
    id: 'ch5',
    t: 'Register D&T Co. as a validator',
    c: 'ValidatorRegistry',
    by: 'Kai',
    stage: 0,
    state: 'Waits on formation',
    d: 'The Deed & Title Co. reviews title before a deed is minted. Goes to signing once the company is formed.',
    ev: [
      ['seg', 'block', H(10, 16, 10), NOW],
      ['draft', H(10, 16, 10)],
    ],
  },
  {
    id: 'ch4',
    t: 'Add Inland Cycle Works',
    c: 'MerchantRegistry',
    by: 'Marcus Lee',
    stage: 0,
    state: 'Waits on the agreement',
    d: 'NET-30, 2.5% fee, $100.00 cap. Goes to signing once the agreement is signed.',
    ev: [
      ['seg', 'block', H(10, 20, 16), NOW],
      ['draft', H(10, 20, 16)],
    ],
  },
];
export const CH_DONE = [
  {
    id: 'h1',
    t: 'RevolvingIssuer v1.3',
    c: 'RevolvingIssuer',
    by: 'Dana Ruiz',
    state: 'Live 21 Oct',
    ev: [
      ['seg', 'done', H(10, 13, 10), H(10, 20, 10)],
      ['seg', 'wait', H(10, 20, 10), H(10, 21, 10)],
      ['draft', H(10, 13, 10)],
      ['check', H(10, 16, 12)],
      ['sign', H(10, 19, 15), 'DR'],
      ['sign', H(10, 20, 10), 'K'],
      ['live', H(10, 21, 10)],
    ],
  },
  {
    id: 'h2',
    t: 'Add Uptown Barber',
    c: 'MerchantRegistry',
    by: 'Marcus Lee',
    state: 'Live 20 Oct',
    ev: [
      ['seg', 'done', H(10, 18, 9), H(10, 19, 12)],
      ['seg', 'wait', H(10, 19, 12), H(10, 20, 12)],
      ['draft', H(10, 18, 9)],
      ['sign', H(10, 19, 9), 'ML'],
      ['sign', H(10, 19, 12), 'DR'],
      ['live', H(10, 20, 12)],
    ],
  },
  {
    id: 'h3',
    t: 'Issue BB-0006',
    c: 'BurnerBond',
    by: 'You',
    state: 'Live 15 Oct',
    ev: [
      ['seg', 'done', H(10, 14, 9), H(10, 14, 18)],
      ['seg', 'wait', H(10, 14, 18), H(10, 15, 18)],
      ['draft', H(10, 14, 9)],
      ['sign', H(10, 14, 15), 'K'],
      ['sign', H(10, 14, 18), 'DR'],
      ['live', H(10, 15, 18)],
    ],
  },
  {
    id: 'h4',
    t: 'Pause partner credit',
    c: 'TermIssuer',
    by: 'RTD under the floor',
    state: 'Automatic 6 Oct',
    ev: [['auto', H(10, 6, 8)]],
  },
  {
    id: 'h5',
    t: 'PayoutPool v0.9',
    c: 'PayoutPool',
    by: 'Dana Ruiz',
    state: 'Live 6 Oct',
    ev: [
      ['seg', 'done', H(9, 29, 10), H(10, 5, 10)],
      ['seg', 'wait', H(10, 5, 10), H(10, 6, 10)],
      ['draft', H(9, 29, 10)],
      ['check', H(10, 2, 10)],
      ['sign', H(10, 4, 10), 'DR'],
      ['sign', H(10, 5, 10), 'K'],
      ['live', H(10, 6, 10)],
    ],
  },
  {
    id: 'h6',
    t: 'AssurancePool v1.2',
    c: 'AssurancePool',
    by: 'Dana Ruiz',
    state: 'Live 29 Sep',
    ev: [
      ['seg', 'done', H(9, 20, 10), H(9, 28, 10)],
      ['seg', 'wait', H(9, 28, 10), H(9, 29, 10)],
      ['draft', H(9, 20, 10)],
      ['check', H(9, 25, 10)],
      ['sign', H(9, 27, 10), 'DR'],
      ['sign', H(9, 28, 10), 'BS'],
      ['live', H(9, 29, 10)],
    ],
  },
];
export const SIGN_W = {
  /* signatures per week, 1 Sep → 20 Oct */ K: [2, 3, 1, 1, 2, 2, 1, 3],
  DR: [3, 4, 2, 1, 1, 2, 1, 3],
  BS: [0, 1, 0, 1, 0, 0, 0, 0],
};
export const SIGNERS = [
  ['K', 'Kai', 'You', 3.1],
  ['DR', 'Dana Ruiz', 'ClearLabs', 5.4],
  ['BS', 'Board signer', 'Co-op board', 31.0],
];
/* ══ Governance ═════════════════════════════════════════════════════════
   Who decides what, and when it is due. The co-op is the parent; Holdings carries a governance class
   (co-op) and a financial class (investors); the Foundation sits outside the tree and contracts ClearLabs.
   Ties: Home deadlines (ClearLabs annual report 1 Nov, ready; Co-op board minutes 4 Nov, drafting;
   Statement of Information 15 Nov, not started); Contracts (member agreement v2.2 draft, intercompany
   services draft, protocol maintenance). */
export const VS = {
  pane: 'overview',
  cal: 'all',
  ent: null,
  mo: 0,
};
export const ENT = [
  /* id, name, kind, status, role, x, y */
  ['coop', 'Clear Co-op', 'Wyoming LLC · co-op', 'formed', 'The parent. One member, one vote. Taxed as a corporation.', 40, 11],
  ['fin', 'Clear Financial Co.', 'Wyoming LLC', 'formed', 'Runs the card and money programs. Holds member funds for their benefit.', 10, 41],
  ['dt', 'The Deed & Title Co.', 'Wyoming LLC', 'forming', 'Keeps title records and will review deeds as a validator. Does not hold escrow.', 30, 41],
  ['hold', 'Clear Capital Holdings', 'Wyoming C-corp', 'formed', 'Holds the economics of both funds. The co-op holds its governance class.', 50, 41],
  ['labs', 'ClearLabs Inc.', 'Wyoming C-corp', 'formed', 'Research and development. Maintains the protocol for the Foundation.', 70, 41],
  ['mgr', 'Manager LLC', 'Wyoming LLC', 'forming', 'Manages both funds. Owned by Holdings.', 50, 63],
  ['prop', 'Clear Properties Co.', 'Wyoming LLC · partnership', 'planned', 'Takes property contributions for OP units.', 34, 92],
  ['lend', 'Clear Lending Co.', 'Wyoming LLC', 'planned', 'The credit book, bond series and pool shares.', 66, 92],
  ['fdn', 'Clear Foundation', 'Wyoming foundation', 'forming', 'Holds the protocol. Ownerless, outside the tree.', 91, 11],
];
export const EST = {
  formed: ['var(--fg)', 'Formed'],
  forming: ['var(--underway)', 'Forming'],
  planned: ['var(--line)', 'Planned'],
};
export const OWN = {
  fin: '100%',
  dt: '100%',
  hold: '100%',
  labs: 'Majority',
  mgr: '100%',
};
export const UNDER = {
  mgr: 'Holdings 100%',
  prop: 'Holdings majority',
  lend: 'Holdings 100%',
};
export const ENTF = {
  /* facts for the panel */
  coop: {
    formed: '12 Jun 2026',
    tax: 'Corporation, by election',
    ein: '••-•••4821',
    officers: 'Kai, president',
    agr: ['coop-oa', 'psa', 'mem21', 'ics'],
  },
  fin: {
    formed: 'Before the co-op',
    tax: 'Disregarded',
    ein: '••-•••1907',
    officers: 'Kai, manager',
    agr: ['psa', 'lithic', 'bridge', 'plaid'],
  },
  dt: {
    tax: 'Disregarded',
    steps: [
      ['Name reserved', 1],
      ['Operating agreement', 1],
      ['Articles filed', 0],
      ['EIN', 0],
      ['Bank account', 0],
    ],
    agr: [],
  },
  hold: {
    formed: '20 Jul 2026',
    tax: 'C-corp',
    ein: '••-•••6630',
    officers: 'Kai, president',
    agr: ['ics'],
  },
  labs: {
    formed: '5 Aug 2026',
    tax: 'C-corp',
    ein: '••-•••3315',
    officers: 'Kai, CEO · Dana Ruiz, protocol lead',
    agr: ['pma'],
  },
  mgr: {
    tax: 'Disregarded',
    steps: [
      ['Name reserved', 1],
      ['Articles filed', 1],
      ['Operating agreement', 0],
      ['EIN', 0],
      ['Bank account', 0],
    ],
    agr: [],
  },
  prop: {
    tax: 'Partnership',
    steps: [
      ['Name reserved', 0],
      ['Articles filed', 0],
      ['Operating agreement', 0],
      ['EIN', 0],
      ['First contribution', 0],
    ],
    agr: [],
  },
  lend: {
    tax: 'Disregarded',
    steps: [
      ['Name reserved', 0],
      ['Articles filed', 0],
      ['Operating agreement', 0],
      ['EIN', 0],
      ['Bank account', 0],
    ],
    agr: [],
  },
  fdn: {
    tax: 'Not taxed as a business',
    steps: [
      ['Charter drafted', 1],
      ['Founder’s letter', 0],
      ['Filed with the state', 0],
      ['First council', 0],
    ],
    agr: ['pma'],
  },
};
export const PARENT = {
  coop: null,
  fin: 'coop',
  dt: 'coop',
  hold: 'coop',
  labs: 'coop',
  mgr: 'hold',
  prop: 'mgr',
  lend: 'hold',
  fdn: null,
};
export const FILINGS = [
  /* id, entity, title, due, status, owner */ ['f1', 'labs', 'Annual report', D(11, 1), 'ready', 'Kai'],
  ['f2', 'coop', 'Board minutes', D(11, 4), 'draft', 'Kai'],
  ['f3', 'coop', 'Statement of Information', D(11, 15), 'none', 'Accountant'],
  ['f4', 'dt', 'Formation filing', D(11, 30), 'draft', 'Accountant'],
  ['f5', 'fdn', 'Foundation charter', D(12, 15), 'draft', 'Counsel'],
  ['f6', 'fin', 'Program review', D(12, 31), 'none', 'Dana Ruiz'],
  ['f7', 'coop', 'Annual member meeting', D(1, 15, 2027), 'none', 'Kai'],
  ['f15', 'coop', 'Sales tax return · Q4', D(1, 31, 2027), 'later', 'Accountant'],
  ['f8', 'fin', 'Annual report', D(3, 1, 2027), 'later', 'Accountant'],
  ['f9', 'fin', 'Program review', D(3, 31, 2027), 'later', 'Dana Ruiz'],
  ['f10', 'coop', 'Federal return', D(4, 15, 2027), 'later', 'Accountant'],
  ['f11', 'hold', 'Federal return', D(4, 15, 2027), 'later', 'Accountant'],
  ['f12', 'labs', 'Federal return', D(4, 15, 2027), 'later', 'Accountant'],
  ['f13', 'coop', 'Annual report', D(6, 1, 2027), 'later', 'Accountant'],
  ['f14', 'fin', 'Program review', D(6, 30, 2027), 'later', 'Dana Ruiz'],
  ['f15', 'hold', 'Annual report', D(7, 1, 2027), 'later', 'Accountant'],
];
export const FST = {
  ready: ['settled', 'Ready to file', 'var(--fg)'],
  draft: ['underway', 'Drafting', 'var(--underway)'],
  none: ['absent', 'Not started', 'var(--absent)'],
  later: ['plain', 'Later', 'var(--line)'],
  done: ['settled', 'Filed', 'var(--fg)'],
};
export const FSHORT = {
  f1: 'Report',
  f2: 'Minutes',
  f3: 'Statement',
  f4: 'Formation',
  f5: 'Charter',
  f6: 'Program review',
  f7: 'Member meeting',
};
export const GBOARDS = [
  /* name, seats: [class, holder or null] */
  [
    'Co-op board',
    'coop',
    [
      ['m', 'Kai', D(6, 12), D(1, 15, 2028)],
      ['m', 'Member M•••', D(8, 20), D(1, 15, 2028)],
      ['m', 'Member M•••', D(8, 20), D(1, 15, 2027)],
      ['m', null, D(1, 15, 2027), 0, 'Elect 15 Jan'],
      ['m', null, D(1, 15, 2027), 0, 'Elect 15 Jan'],
    ],
    'Member-elected. Three seats are on the ballot at the annual meeting.',
  ],
  [
    'Holdings board',
    'hold',
    [
      ['c', null, 0, 0, 'Elected directly'],
      ['r', 'Kai', D(7, 20), D(7, 20, 2028)],
      ['r', null, 0, 0, 'Co-op appoints'],
      ['i', null, 0, 0, 'After the financial class sells'],
      ['i', null, 0, 0, 'After the financial class sells'],
      ['n', null, 0, 0, 'Picked jointly'],
      ['f', null, 0, 0, 'Open to anyone'],
    ],
    'Investor seats stay empty until the financial class is sold. Chair elected directly.',
  ],
  [
    'ClearLabs board',
    'labs',
    [
      ['r', 'Kai', D(8, 5), D(8, 5, 2028)],
      ['r', 'Dana Ruiz', D(8, 5), D(8, 5, 2028)],
      ['t', null, 0, 0, 'When a protocol lead joins'],
    ],
    'One seat for the team once a protocol lead joins.',
  ],
];
export const SEATC = {
  c: ['var(--live)', 'Chair'],
  m: ['var(--fg)', 'Member-elected'],
  r: ['var(--land)', 'Co-op reserved'],
  i: ['var(--fg-50)', 'Investor'],
  n: ['var(--underway)', 'Neutral'],
  f: ['var(--line)', 'Free seat'],
  t: ['var(--fg-50)', 'Team'],
};
export const AGENDA = [
  /* item, minutes, owner, kind */ ['Approve the 7 Oct minutes', 5, 'Kai', 'vote'],
  ['Member vote on agreement v2.2', 10, 'Kai', 'report'],
  ['Q3 money review', 15, 'Dana Ruiz', 'report'],
  ['Intercompany pricing policy', 15, 'Kai', 'vote'],
  ['Renew Plaid and poster printing', 10, 'Kai', 'vote'],
  ['Open seats and the annual meeting', 5, 'Kai', 'discuss'],
];
export const AK = {
  vote: ['var(--fg)', 'Vote'],
  report: ['var(--land)', 'Report'],
  discuss: ['var(--line)', 'Discuss'],
};
export const RESOS = [
  /* date, body, title, votes per seat: y | n | r (recused) | a (absent) */ [D(10, 7), 'Co-op board', 'Member fee schedule', ['y', 'y', 'y']],
  [D(10, 7), 'ClearLabs board', 'Protocol maintenance terms', ['r', 'y']],
  [D(9, 16), 'Holdings board', 'Adopt the bylaws', ['y']],
  [D(9, 2), 'Co-op board', 'Issue ClearLabs shares to the co-op', ['r', 'y', 'y']],
  [D(8, 5), 'Co-op board', 'Elect officers', ['y', 'y', 'a']],
  [D(8, 5), 'ClearLabs board', 'Appoint Dana Ruiz protocol lead', ['y', 'r']],
];
export const PEOPLE = [
  ['Kai', ['coop', 'hold', 'labs'], 'Recuses on deals between the co-op and ClearLabs'],
  ['Dana Ruiz', ['labs'], 'Recused on her own appointment'],
  ['Member M•••', ['coop'], ''],
  ['Member M•••', ['coop'], ''],
];
export const VOTE = {
  t: 'Adopt member agreement v2.2',
  open: D(10, 15),
  close: D(10, 29),
  elig: 188,
  quorum: 0.25,
  days: [9, 21, 30, 38, 47, 55, 61],
  yes: 52,
  no: 6,
  abs: 3,
};
export const PASTV = [
  ['Operating agreement', 'Jun', 100],
  ['Board election', 'Aug', 58.0],
  ['Fee schedule', 'Sep', 41.2],
  ['Member agreement v2.2', 'Now', 32.4],
];
export const MEETS = [
  /* body, events: [kind, date, label] kind: held | minutes | due | next | span | later */
  [
    'Members',
    [
      ['held', D(6, 12), 'Founding vote'],
      ['held', D(8, 20), 'Board election'],
      ['held', D(9, 24), 'Fee schedule'],
      ['span', D(10, 15), D(10, 29), 'v2.2 vote'],
      ['next', D(1, 15, 2027), 'Annual meeting'],
    ],
  ],
  [
    'Co-op board',
    [
      ['held', D(7, 8)],
      ['held', D(8, 5)],
      ['held', D(9, 2)],
      ['held', D(10, 7)],
      ['due', D(11, 4), 'Minutes due'],
      ['next', D(11, 4), '4 Nov'],
      ['next', D(12, 2)],
    ],
  ],
  [
    'Holdings board',
    [
      ['held', D(7, 20), 'Founding resolutions'],
      ['held', D(9, 16)],
      ['next', D(12, 1), 'Intercompany pricing'],
    ],
  ],
  [
    'ClearLabs board',
    [
      ['held', D(8, 5)],
      ['held', D(10, 7)],
      ['next', D(1, 6, 2027)],
    ],
  ],
  ['Delegate assembly', [['later', D(11, 1), D(1, 31, 2027), 'From 1,000 members']]],
];
export const RPX = ['coop', 'fin', 'dt', 'hold', 'labs', 'fdn'];
export const RPN = {
  coop: 'Co-op',
  fin: 'Financial',
  dt: 'D&T Co.',
  hold: 'Holdings',
  labs: 'ClearLabs',
  fdn: 'Foundation',
};
export const RPA = {
  coop: 'Co-op',
  fin: 'Fin.',
  dt: 'D&T',
  hold: 'Hold.',
  labs: 'Labs',
  fdn: 'Fdn.',
};
export const RP = [
  /* payer, payee, what, dates, amount each, open */ ['coop', 'fin', 'Program services', [D(7, 31), D(8, 31), D(9, 30), D(10, 15)], 1200],
  ['fdn', 'labs', 'Protocol maintenance', [D(8, 15), D(9, 15), D(10, 15)], 2500],
  ['coop', 'labs', 'Shares issued', [D(8, 15)], 0],
  ['coop', 'hold', 'Intercompany services', [], 0, D(12, 1)],
];
export const MATTERS = [
  /* decision, [members, co-op board, holdings board, co-op seats, foundation, ops safe]: 2 decides, 1 must approve, 0 told, -1 none */
  ['Change the operating agreement', [2, 0, -1, -1, -1, -1]],
  ['Elect the co-op board', [2, 0, -1, -1, -1, -1]],
  ['Related-party deal', [0, 2, 1, -1, -1, -1], 'Intercompany pricing goes to the board 1 Dec'],
  ['New share class at Holdings', [0, 0, 2, 1, -1, -1]],
  ['Sell or pledge a property', [0, 1, 2, 1, -1, -1]],
  ['Replace the fund manager', [0, 1, 2, 1, -1, -1]],
  ['Change the protocol maintainer', [-1, 0, -1, -1, 2, -1]],
  ['Move money or change a contract', [-1, 0, -1, -1, -1, 2]],
];
export const BODIES = ['Members', 'Co-op board', 'Holdings board', 'Co-op seats', 'Foundation', 'Ops Safe'];
/* a month at a glance: filings, meetings and votes on one ruled sheet */
export const MBODY = {
  Members: 'coop',
  'Co-op board': 'coop',
  'Holdings board': 'hold',
  'ClearLabs board': 'labs',
};
/* ══ Records ════════════════════════════════════════════════════════════
   Documents, and a log of every action taken in this app. Ties: Contracts (agreements, Inland Cycle Works
   waiting, RevolvingIssuer v1.3, Rosa's cap raise, PayoutPool top-up), Governance (7 Oct minutes draft,
   Statement of Information, formation papers), Field (P-012 replaced 09:12), Merchants (Orange St. Point
   offline 08:40), Home (Plaid re-sync since 22:41). Nothing here can be edited after it's logged. */
export const RS = {
  pane: 'overview',
  df: 'all',
  lf: 'all',
  doc: null,
};
export const DT = {
  agreement: ['Agreements', 'var(--fg)'],
  minutes: ['Minutes', 'var(--land)'],
  filing: ['Filings', 'var(--fg-50)'],
  policy: ['Policies', 'var(--underway)'],
  bond: ['Bonds', 'var(--line)'],
  report: ['Payout reports', 'color-mix(in srgb,var(--fg) 35%,transparent)'],
};
export const DONE1 = {
  agreement: 'Agreement',
  minutes: 'Minutes',
  filing: 'Filing',
  policy: 'Policy',
  bond: 'Bond paper',
  report: 'Payout report',
};
export const DSTAT = {
  signed: ['plain', 'Signed'],
  filed: ['settled', 'Filed'],
  draft: ['underway', 'Draft'],
  waiting: ['live', 'Waiting on you'],
  final: ['plain', 'Final'],
};
export const DOCS = [
  /* id, title, type, entity, date, status, version, by, pages */
  ['d1', 'Merchant partner agreement · Inland Cycle Works', 'agreement', 'coop', D(10, 20), 'waiting', 'v1.1', 'Inland Cycle Works', 6],
  ['d2', 'Minutes · Co-op board, 7 Oct', 'minutes', 'coop', D(10, 8), 'draft', 'v0.2', 'Kai', 4],
  ['d19', 'Shop returns and refunds · policy', 'policy', 'coop', D(9, 28), 'final', 'v1.0', 'Kai', 2],
  ['d3', 'RevolvingIssuer v1.3 · audit notes', 'policy', 'labs', D(10, 19), 'final', 'v1.0', 'Dana Ruiz', 9],
  ['d4', 'Merchant partner agreement · Uptown Barber', 'agreement', 'coop', D(10, 20), 'signed', 'v1.1', 'Uptown Barber · Kai', 6],
  ['d5', 'Bond certificate · BB-0006', 'bond', 'hold', D(10, 15), 'signed', 'v1.0', 'Kai · Dana Ruiz', 2],
  ['d6', 'Payout report · September', 'report', 'fin', D(10, 2), 'final', 'v1.0', 'System', 3],
  ['d7', 'Minutes · ClearLabs board, 7 Oct', 'minutes', 'labs', D(10, 8), 'signed', 'v1.0', 'Kai', 3],
  ['d8', 'Annual report · ClearLabs Inc.', 'filing', 'labs', D(10, 16), 'draft', 'v1.0', 'Kai', 2],
  ['d9', 'Intercompany pricing policy', 'policy', 'hold', D(10, 12), 'draft', 'v0.3', 'Kai', 5],
  ['d10', 'Program services agreement', 'agreement', 'fin', D(1, 1), 'signed', 'v1.0', 'Kai', 14],
  ['d11', 'Minutes · Holdings board, 16 Sep', 'minutes', 'hold', D(9, 17), 'signed', 'v1.0', 'Kai', 5],
  ['d12', 'Holdings bylaws', 'policy', 'hold', D(9, 16), 'final', 'v1.0', 'Holdings board', 22],
  ['d13', 'Cooperative operating agreement', 'agreement', 'coop', D(6, 12), 'signed', 'v1.0', 'Founding members', 31],
  ['d14', 'Articles of organization · Manager LLC', 'filing', 'mgr', D(10, 9), 'filed', 'v1.0', 'Accountant', 3],
  ['d15', 'Two-person rule', 'policy', 'coop', D(8, 1), 'final', 'v1.2', 'Co-op board', 4],
];
export const DCOUNT = {
  agreement: 41,
  minutes: 12,
  filing: 7,
  policy: 9,
  bond: 6,
  report: 14,
};
export const DSTATE_N = {
  agreement: [40, 0, 1],
  minutes: [11, 1, 0],
  filing: [5, 2, 0],
  policy: [7, 2, 0],
  bond: [6, 0, 0],
  report: [14, 0, 0],
};
export const COVER_K = ['Formation papers', 'Operating rules', 'EIN letter', 'Board minutes', 'Annual report', 'Bank resolution'];
export const COVER = {
  /* f on file · d draft · m missing · n not needed yet */
  coop: ['f', 'f', 'f', 'd', 'n', 'f'],
  fin: ['f', 'f', 'f', 'n', 'f', 'f'],
  dt: ['d', 'f', 'm', 'n', 'n', 'm'],
  hold: ['f', 'f', 'f', 'f', 'n', 'f'],
  labs: ['f', 'f', 'f', 'f', 'd', 'f'],
  mgr: ['f', 'd', 'm', 'n', 'n', 'm'],
  fdn: ['d', 'n', 'n', 'n', 'n', 'n'],
};
export const CV = {
  f: ['var(--fg)', 'On file'],
  d: ['var(--underway)', 'Draft'],
  m: ['var(--absent)', 'Missing'],
  n: ['var(--hair)', 'Not needed yet'],
};
/* the audit log */
export const AREAS = {
  chain: ['On-chain', 'var(--fg)'],
  money: ['Money', 'var(--underway)'],
  members: ['Members', 'var(--land)'],
  field: ['Shops and field', 'var(--fg-50)'],
  shop: ['Shop', 'var(--settled)'],
  gov: ['Governance', 'gov'],
  system: ['System', 'var(--line)'],
  alert: ['Alert', 'var(--absent)'],
};
export const WHO = [
  ['K', 'Kai'],
  ['DR', 'Dana Ruiz'],
  ['ML', 'Marcus Lee'],
  ['SY', 'System'],
];
export const LOG = [
  /* id, time, who, area, action, detail, from, result, approver */
  [
    'a1',
    H2(10, 21, 14, 2),
    'K',
    'chain',
    'Signed “Raise Rosa’s cap to $150.00”',
    'Second of two signatures. Goes live 22 Oct, 12:00.',
    'Mac · Redlands',
    'approved',
    'Marcus Lee proposed',
  ],
  [
    'a2',
    H2(10, 21, 13, 10),
    'K',
    'money',
    'Drafted the PayoutPool top-up',
    '$1,116.89 from operating cash, due 30 Oct.',
    'Mac · Redlands',
    'waiting',
    'Needs a second person',
  ],
  [
    's1',
    H2(10, 21, 11, 20),
    'K',
    'shop',
    'Proposed a refund on order #1079',
    '$98.00 · Hoodie, wrong size. Needs a second person.',
    'Mac · Redlands',
    'waiting',
    'Needs a second person',
  ],
  ['a3', H2(10, 21, 10, 0), 'SY', 'chain', 'RevolvingIssuer v1.3 went live', 'After the 24-hour wait. Signed by Dana Ruiz and Kai.', 'Ops Safe', 'done', ''],
  ['a4', H2(10, 21, 9, 12), 'ML', 'field', 'Replaced poster P-012 at Uptown Barber', 'Photo attached. Next swap 20 Dec.', 'iPhone · Redlands', 'done', ''],
  ['a5', H2(10, 21, 8, 40), 'SY', 'alert', 'Orange St. Point went offline', 'Counter device stopped reporting.', 'Device', 'alert', ''],
  ['a6', H2(10, 20, 22, 41), 'SY', 'system', 'Plaid re-sync started', '7 of 12 bank links refreshed so far.', 'Plaid', 'running', ''],
  ['a7', H2(10, 20, 18, 0), 'ML', 'chain', 'Signed “Raise Rosa’s cap to $150.00”', 'First of two signatures.', 'iPhone · San Bernardino', 'signed', ''],
  ['a8', H2(10, 20, 16, 0), 'ML', 'field', 'Drafted “Add Inland Cycle Works”', 'Waits on the merchant agreement.', 'iPhone · Redlands', 'waiting', ''],
  ['s2', H2(10, 20, 11, 0), 'K', 'shop', 'Put Graphic Tee · Two Ten Overpass on the shelf', 'Photos, price and stock checked.', 'Mac · Redlands', 'done', ''],
  ['a9', H2(10, 20, 10, 0), 'K', 'chain', 'Signed RevolvingIssuer v1.3', 'Second of two signatures.', 'Mac · Redlands', 'approved', 'Dana Ruiz proposed'],
  ['a10', H2(10, 20, 9, 0), 'DR', 'chain', 'Signed AssurancePool v1.3', 'First of two. Waiting on you.', 'Laptop · Riverside', 'signed', ''],
  [
    'a11',
    H2(10, 19, 12, 0),
    'DR',
    'field',
    'Approved “Add Uptown Barber”',
    'Second signature on Marcus Lee’s change.',
    'Laptop · Riverside',
    'approved',
    'Marcus Lee proposed',
  ],
  ['a12', H2(10, 19, 9, 30), 'ML', 'system', 'Signed in from a new device', 'iPhone. Confirmed by Kai at 09:41.', 'iPhone · Redlands', 'confirmed', ''],
  ['a13', H2(10, 18, 15, 0), 'K', 'gov', 'Sent the Inland Cycle Works agreement', 'Out for signature in the e-signature tool.', 'Mac · Redlands', 'done', ''],
  [
    'a14',
    H2(10, 18, 11, 0),
    'DR',
    'members',
    'Approved invite batch 12',
    '25 people, oldest first. Kai proposed.',
    'Laptop · Riverside',
    'approved',
    'Kai proposed',
  ],
  ['a15', H2(10, 15, 9, 0), 'K', 'gov', 'Opened the member vote on v2.2', '188 members can vote until 29 Oct.', 'Mac · Redlands', 'done', ''],
  [
    'a16',
    H2(10, 14, 18, 0),
    'DR',
    'money',
    'Approved issuing BB-0006',
    '$5,000.00 face value. Kai proposed.',
    'Laptop · Riverside',
    'approved',
    'Kai proposed',
  ],
];
export const RESULT = {
  approved: ['settled', 'Approved'],
  waiting: ['underway', 'Waiting'],
  done: ['plain', 'Done'],
  alert: ['absent', 'Alert'],
  running: ['underway', 'Running'],
  signed: ['plain', 'Signed'],
  confirmed: ['plain', 'Confirmed'],
};
/* filler: everyday actions, so the week reads true to life */
export const WEEK = (() => {
  const r = rng(2026),
    out = [],
    prof = {
      K: [
        ['chain', 2],
        ['money', 2],
        ['members', 2],
        ['gov', 2],
        ['field', 1],
        ['shop', 1],
      ],
      DR: [
        ['chain', 4],
        ['money', 3],
        ['members', 1],
      ],
      ML: [
        ['field', 6],
        ['members', 1],
      ],
      SY: [
        ['system', 3],
        ['money', 1],
        ['chain', 1],
        ['shop', 2],
      ],
    };
  for (let d = 0; d < 7; d++)
    WHO.forEach(([w]) => {
      const dw = new Date(H2(10, 15 + d, 0)).getUTCDay(),
        we = dw === 0 || dw === 6;
      const n = w === 'SY' ? (we ? 3 : 5) : w === 'ML' ? (we ? 3 : 7) : we ? 1 : 5;
      for (let i = 0; i < n; i++) {
        const pool = prof[w].flatMap(([a, k]) => Array(k).fill(a));
        out.push([H2(10, 15 + d, 8 + Math.floor(r() * 12), Math.floor(r() * 60)), w, pool[Math.floor(r() * pool.length)]]);
      }
    });
  return out;
})();
export const APPR = {
  /* proposer → approver, last 30 days */ K: {
    DR: 6,
    BS: 1,
  },
  DR: {
    K: 5,
    BS: 1,
  },
  ML: {
    K: 3,
    DR: 4,
  },
};
export const SIGNIN = [
  ['K', 'Kai', 'Mac · Redlands', [3, 2, 4, 3, 1, 2, 3], 'Today 07:58', ''],
  ['DR', 'Dana Ruiz', 'Laptop · Riverside', [2, 2, 3, 2, 0, 0, 2], 'Today 08:30', ''],
  ['ML', 'Marcus Lee', 'iPhone · Redlands', [2, 3, 2, 3, 2, 1, 2], 'Today 08:47', 'New device 19 Oct · confirmed'],
];
/* ══ Team ═══════════════════════════════════════════════════════════════
   Who can see and do what. Ties: Records (sign-ins, the two-person grid, the log), Contracts (the Ops Safe,
   2 of 3: Kai, Dana Ruiz, the board signer), Money (PayoutPool top-up waiting on a second person). */
export const TS = {
  pane: 'overview',
  person: null,
};
export const SECS = [
  ['home', 'Home'],
  ['growth', 'Growth'],
  ['field', 'Field'],
  ['members', 'Members'],
  ['merchants', 'Merchants'],
  ['shop', 'Shop'],
  ['money', 'Money'],
  ['contracts', 'Contracts'],
  ['governance', 'Gov.'],
  ['records', 'Records'],
  ['team', 'Access'],
];
export const LV = ['None', 'Totals', 'See', 'Propose', 'Approve'];
/* groups: permissions are set per group, never per person. Everyone with a Clear account is in Members;
   a team member's group adds to that. Levels: 0 none · 1 totals (co-op numbers, no personal details) · 2 see · 3 propose · 4 approve */
export const ROLES = {
  members: ['Members', 'Everyone with a Clear account', [0, 1, 0, 0, 1, 1, 1, 2, 2, 2, 0], 1],
  admin: ['Admin', 'Runs the co-op day to day', [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]],
  protocol: ['Protocol', 'Contracts and the money they hold', [2, 2, 0, 4, 2, 1, 4, 4, 2, 2, 0]],
  field: ['Field', 'Shops, posters and the route', [2, 3, 4, 2, 3, 3, 1, 2, 2, 2, 0]],
  board: ['Board', 'Signs for the co-op board', [2, 1, 0, 0, 1, 1, 2, 4, 4, 2, 0]],
  outside: ['Outside', 'Read-only, for an accountant or counsel', [0, 1, 0, 0, 1, 2, 2, 2, 2, 2, 0]],
  investors: ['Investors', 'Data room for investors, lenders and property contributors', [0, 1, 0, 0, 1, 1, 2, 2, 2, 2, 0]],
};
vars.TEAMG = Object.keys(ROLES).filter((k) => !ROLES[k][3]);
export const PEOPLE_T = [
  {
    id: 'K',
    email: 'kai@useclear.org',
    n: 'Kai',
    role: 'admin',
    title: 'Founder',
    since: D(6, 12),
    last: 'Active now',
    dev: ['Mac · Redlands', 'iPhone · Redlands'],
    passkey: 1,
    signer: 1,
  },
  {
    id: 'DR',
    email: 'dana@useclear.org',
    n: 'Dana Ruiz',
    role: 'protocol',
    title: 'Protocol lead · ClearLabs',
    since: D(8, 5),
    last: 'Today 08:30',
    dev: ['Laptop · Riverside'],
    passkey: 1,
    signer: 1,
  },
  {
    id: 'ML',
    email: 'marcus@useclear.org',
    n: 'Marcus Lee',
    role: 'field',
    title: 'Partnerships and field',
    since: D(8, 18),
    last: 'On the route now',
    dev: ['iPhone · Redlands', 'Old iPhone · signed out'],
    passkey: 1,
    signer: 0,
  },
  {
    id: 'BS',
    email: 'board@useclear.org',
    n: 'Board signer',
    role: 'board',
    title: 'Co-op board',
    since: D(9, 1),
    last: '3 days ago',
    dev: ['Laptop · Redlands'],
    passkey: 1,
    signer: 1,
  },
  {
    id: 'AC',
    email: 'books@ledgerline.co',
    n: 'Outside accountant',
    role: 'outside',
    title: 'Money and Records, read-only',
    since: D(10, 2),
    last: 'Yesterday',
    dev: ['Laptop · Ontario'],
    passkey: 0,
    signer: 0,
  },
  {
    id: 'LP',
    email: 'lena@harborcap.com',
    n: 'Lena Park',
    role: 'investors',
    title: 'Harbor Capital · data room until 21 Nov',
    since: D(10, 14),
    last: 'Yesterday',
    dev: ['Laptop · Irvine'],
    passkey: 0,
    signer: 0,
    terms: 0,
  },
];
export const INVITES = [['PS', 'Priya Shah', 'field', 'Sent 19 Oct · expires 26 Oct']];
export const CAN = [
  /* capability, who can do it */ ['Second sign on a money move', ['K', 'DR']],
  ['Sign in the Ops Safe', ['K', 'DR', 'BS']],
  ['Approve an invite batch', ['K', 'DR']],
  ['Approve the payout run', ['K', 'DR']],
  ['Deploy a contract', ['DR']],
  ['Approve a shop refund', ['K', 'DR']],
  ['Sign agreements for the co-op', ['K']],
  ['File for an entity', ['K']],
  ['Add or turn off a person', ['K']],
];
export const RULES2 = [
  /* rule, covers, can approve, last 30 days, median hours to a second person */ ['Money moves', 'Top-ups, payout runs, bond issues', ['K', 'DR'], 6, 4.2],
  ['On-chain changes', 'Upgrades, caps and shop terms · 2 of 3 in the Ops Safe', ['K', 'DR', 'BS'], 9, 7.8],
  ['Invite batches', 'Each batch of 25, oldest first', ['K', 'DR'], 3, 2.1],
  ['Member data exports', 'Any list with names or emails', ['K', 'DR'], 2, 0.5],
  ['Shop refunds', 'Any refund over $50.00', ['K', 'DR'], 0, 0],
];
export const WAIT2 = [
  ['PayoutPool top-up · $1,116.89', 'Proposed by Kai · Money', 'Dana Ruiz', '20 h', 'money', 20, 4.2],
  ['AssurancePool v1.3', 'Proposed by Dana Ruiz · On-chain', 'Kai', '30 h', 'chain', 30, 7.8],
  ['Refund · order #1079 · $98.00', 'Proposed by Kai · Shop', 'Dana Ruiz', '3 h', 'shop', 3, 1.6],
];
/* ══ Shop ═══════════════════════════════════════════════════════════════
   The co-op shop on useclear.org/shop. Quality goods, priced so the margin covers the line and funds marketing.
   Ties: Team (Shop column, refunds over $50.00 need a second person, the #1079 refund waiting on Dana Ruiz),
   Records (shop log entries, the returns policy), Governance (the quarterly sales tax return), Merchants
   (pickups at partner shops, hardware pre-orders need a merchant account), Contracts (Inland Cycle Works). */
export const SS = {
  pane: 'overview',
  prod: null,
  order: null,
  pf: 'all',
  of: 'open',
  why: 'stock',
  line: 'logo',
};
export const SW = WEEKS.slice(4);
/* the shop opened 1 Sep: eight weeks */
export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
export const LINES = {
  logo: ['Logo Tees', 'var(--fg)'],
  graphic: ['Graphic Tees', 'var(--land)'],
  layers: ['Layers', 'var(--fg-50)'],
  patch: ['Patches', 'var(--underway)'],
  hw: ['Hardware pre-orders', 'var(--line)'],
};
export const SHELF = {
  on: ['settled', 'On shelf'],
  off: ['underway', 'Off shelf'],
  draft: ['plain', 'Draft'],
  arch: ['plain', 'Archived'],
};
export const PR = [
  /* cost per unit: blank or base, making, label, packing */
  {
    id: 'lts',
    n: 'Logo Tee',
    v: 'Short sleeve',
    line: 'logo',
    g: 'tee',
    price: 46,
    c: [9.8, 4.6, 1.2, 1.1],
    st: 'on',
    cols: ['Black', 'White'],
    wk: [6, 9, 8, 7, 8, 9, 7, 7],
    lead: 3,
    slug: 'logo-tee',
  },
  {
    id: 'ltl',
    n: 'Logo Tee',
    v: 'Long sleeve',
    line: 'logo',
    g: 'ls',
    price: 54,
    c: [11.9, 4.6, 1.2, 1.1],
    st: 'on',
    cols: ['Black', 'White'],
    wk: [0, 0, 3, 4, 3, 4, 3, 4],
    lead: 3,
    slug: 'logo-tee-long',
  },
  {
    id: 'tn',
    n: 'Turtleneck',
    v: 'Rib knit',
    line: 'layers',
    g: 'turtle',
    price: 72,
    c: [16.4, 5.2, 1.2, 1.3],
    st: 'on',
    cols: ['Black'],
    wk: [2, 3, 2, 3, 2, 2, 3, 2],
    lead: 3,
    slug: 'turtleneck',
  },
  {
    id: 'hd',
    n: 'Hoodie',
    v: 'Heavy fleece',
    line: 'layers',
    g: 'hood',
    price: 98,
    c: [26.8, 6.4, 1.2, 1.6],
    st: 'off',
    cols: ['Black'],
    wk: [3, 4, 3, 4, 4, 2, 0, 0],
    lead: 5,
    slug: 'hoodie',
    why: 'Sold out 9 Oct · 120 arrive 30 Oct',
  },
  {
    id: 'gcm',
    n: 'Graphic Tee',
    v: 'Carousel Mall',
    line: 'graphic',
    g: 'gtee',
    price: 44,
    c: [8.6, 5.8, 1.2, 1.1],
    st: 'on',
    cols: ['Black', 'Cobalt', 'White'],
    wk: [0, 0, 0, 0, 4, 5, 4, 4],
    lead: 3,
    slug: 'carousel-mall',
  },
  {
    id: 'gtt',
    n: 'Graphic Tee',
    v: 'Two Ten Overpass',
    line: 'graphic',
    g: 'gtee',
    price: 44,
    c: [8.6, 5.8, 1.2, 1.1],
    st: 'on',
    cols: ['Black', 'Cobalt', 'White'],
    wk: [0, 0, 0, 0, 4, 3, 0, 2],
    lead: 3,
    slug: 'two-ten-overpass',
  },
  {
    id: 'gdv',
    n: 'Graphic Tee',
    v: 'Devore',
    line: 'graphic',
    g: 'gtee',
    price: 44,
    c: [8.6, 5.8, 1.2, 1.1],
    st: 'draft',
    cols: ['Black', 'Cobalt', 'White'],
    wk: [0, 0, 0, 0, 0, 0, 0, 0],
    lead: 3,
    slug: 'devore',
    why: 'Sample arrives 28 Oct',
  },
  {
    id: 'psq',
    n: 'Clear patch',
    v: 'Square',
    line: 'patch',
    g: 'psq',
    price: 9,
    c: [1.6, 0, 0, 0.35],
    st: 'on',
    cols: ['One size'],
    wk: [0, 4, 5, 6, 5, 6, 5, 6],
    lead: 2,
    slug: 'patch-square',
  },
  {
    id: 'pci',
    n: 'Clear patch',
    v: 'Circle',
    line: 'patch',
    g: 'pci',
    price: 9,
    c: [1.6, 0, 0, 0.35],
    st: 'on',
    cols: ['One size'],
    wk: [0, 3, 4, 5, 4, 5, 5, 5],
    lead: 2,
    slug: 'patch-circle',
  },
  {
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
    slug: 'clear-point',
  },
  {
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
    slug: 'clear-counter-8',
  },
  {
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
    slug: 'clear-counter-10',
    why: 'Waiting on the enclosure',
  },
  {
    id: 'ft',
    n: 'Founding Tee',
    v: 'First run',
    line: 'logo',
    g: 'tee',
    price: 40,
    c: [8.9, 4.2, 1.0, 1.0],
    st: 'arch',
    cols: ['Black'],
    wk: [0, 0, 0, 0, 0, 0, 0, 0],
    lead: 3,
    slug: 'founding-tee',
    why: 'Sold out, replaced by the Logo Tee',
  },
];
export const STK = {
  /* on hand by colour, XS → XXL; patches are one size */
  lts: {
    Black: [4, 11, 18, 16, 9, 3],
    White: [2, 6, 9, 3, 5, 1],
  },
  ltl: {
    Black: [3, 8, 12, 10, 6, 2],
    White: [1, 4, 6, 5, 3, 0],
  },
  tn: {
    Black: [0, 1, 2, 1, 1, 0],
  },
  hd: {
    Black: [0, 0, 0, 0, 0, 0],
  },
  gcm: {
    Black: [2, 5, 7, 6, 4, 1],
    Cobalt: [1, 4, 5, 4, 2, 0],
    White: [2, 4, 6, 5, 3, 1],
  },
  gtt: {
    Black: [1, 3, 4, 4, 2, 1],
    Cobalt: [2, 6, 9, 8, 4, 2],
    White: [0, 2, 3, 2, 1, 0],
  },
  gdv: {
    Black: [0, 0, 0, 0, 0, 0],
    Cobalt: [0, 0, 0, 0, 0, 0],
    White: [0, 0, 0, 0, 0, 0],
  },
  psq: {
    'One size': [64],
  },
  pci: {
    'One size': [58],
  },
  ft: {
    Black: [0, 0, 0, 0, 0, 0],
  },
};
export const goods = PR.filter((p) => !p.dep);
export const ORD_W = [9, 13, 13, 15, 18, 20, 17, 19];
export const REV_W = SW.map((_, i) => goods.reduce((a, p) => a + p.wk[i] * p.price, 0));
export const COST_W = SW.map((_, i) => goods.reduce((a, p) => a + p.wk[i] * unitCost(p), 0));
export const SHIP_NET = 1.4;
export const LINE_COSTS = [
  ['Samples and proofs', 185],
  ['Photos for new products', 240],
  ['Shop software', 39],
  ['Label rolls', 36],
];
export const SHOP = (() => {
  const rev = REV_W.slice(-4).reduce((a, b) => a + b, 0),
    prev = REV_W.slice(0, 4).reduce((a, b) => a + b, 0),
    ord = ORD_W.slice(-4).reduce((a, b) => a + b, 0);
  const cost = COST_W.slice(-4).reduce((a, b) => a + b, 0),
    shipped = 60,
    ship = shipped * SHIP_NET,
    fees = rev * 0.029 + ord * 0.3;
  const gross = rev - cost - ship - fees,
    line = LINE_COSTS.reduce((a, b) => a + b[1], 0);
  return {
    rev,
    prev,
    ord,
    cost,
    ship,
    fees,
    gross,
    line,
    left: gross - line,
    tax: rev * 0.0775 * 0.92,
    items: goods.reduce((a, p) => a + u4(p), 0),
    shipped,
    picked: ord - shipped,
  };
})();
export const GP_W = SW.map((_, i) => REV_W[i] - COST_W[i] - ORD_W[i] * 0.81 * SHIP_NET - (REV_W[i] * 0.029 + ORD_W[i] * 0.3));
export const SIZE_MIX = [
  ['XS', 4],
  ['S', 16],
  ['M', 27],
  ['L', 23],
  ['XL', 12],
  ['XXL', 4],
];
export const SHELF_EV = {
  /* periods on the shelf, for the history lanes: state, from, to */
  lts: [['on', D(9, 1), NOW]],
  ltl: [['on', D(9, 15), NOW]],
  tn: [['on', D(9, 1), NOW]],
  hd: [
    ['on', D(9, 1), D(10, 9)],
    ['off', D(10, 9), NOW],
    ['proj', NOW, D(10, 30)],
  ],
  gcm: [
    ['draft', D(9, 15), D(9, 29)],
    ['on', D(9, 29), NOW],
  ],
  gtt: [
    ['draft', D(9, 15), D(9, 29)],
    ['on', D(9, 29), D(10, 12)],
    ['off', D(10, 12), D(10, 20)],
    ['on', D(10, 20), NOW],
  ],
  gdv: [['draft', D(10, 12), NOW]],
  psq: [['on', D(9, 8), NOW]],
  pci: [['on', D(9, 8), NOW]],
  cpt: [['on', D(10, 6), NOW]],
  c8: [['on', D(10, 6), NOW]],
  c10: [['draft', D(10, 6), NOW]],
  ft: [['on', D(8, 24), D(8, 31)]],
};
export const SHIST = {
  /* product history for the panel: date, what, who */
  lts: [
    [D(10, 14), 'Restocked White · 24 units', 'Kai'],
    [D(9, 1), 'Put on the shelf', 'Kai'],
  ],
  ltl: [[D(9, 15), 'Put on the shelf', 'Kai']],
  tn: [[D(9, 1), 'Put on the shelf', 'Kai']],
  hd: [
    [D(10, 2), 'Ordered a restock · 120 units', 'Kai · approved by Dana Ruiz'],
    [D(10, 9), 'Taken off the shelf · sold out', 'System'],
    [D(9, 1), 'Put on the shelf', 'Kai'],
  ],
  gcm: [
    [D(9, 29), 'Put on the shelf', 'Kai'],
    [D(9, 15), 'Added as a draft', 'Kai'],
  ],
  gtt: [
    [D(10, 20), 'Back on the shelf · cobalt restocked', 'Kai'],
    [D(10, 12), 'Taken off the shelf · cobalt sold out', 'Kai'],
    [D(9, 29), 'Put on the shelf', 'Kai'],
  ],
  gdv: [[D(10, 12), 'Added as a draft · sample ordered', 'Kai']],
  psq: [[D(9, 8), 'Put on the shelf', 'Kai']],
  pci: [[D(9, 8), 'Put on the shelf', 'Kai']],
  cpt: [[D(10, 6), 'Opened for pre-orders', 'Kai']],
  c8: [[D(10, 6), 'Opened for pre-orders', 'Kai']],
  c10: [[D(10, 6), 'Added as a draft', 'Kai']],
  ft: [
    [D(8, 31), 'Archived · sold out', 'Kai'],
    [D(8, 24), 'Put on the shelf', 'Kai'],
  ],
};
export const PARTNERS = [
  ['Uptown Barber', 7],
  ['Mesa Laundry', 4],
  ['Redlands Tire & Lube', 3],
];
export const SHIP_DAYS = [
  ['Same day', 5],
  ['1 day', 29],
  ['2 days', 21],
  ['3 days', 4],
  ['4+', 1],
];
export const OST = {
  paid: ['live', 'To pack'],
  packed: ['plain', 'Packed'],
  shipped: ['plain', 'On the way'],
  ready: ['underway', 'Ready for pickup'],
  done: ['settled', 'Delivered'],
  picked: ['settled', 'Picked up'],
  refund: ['underway', 'Refund waiting'],
};
export const PAY = {
  clear: 'Clear',
  card: 'Card',
  wallet: 'Apple or Google Pay',
};
export const ORDERS = [
  /* id, time, who, member, items [product, colour, size, qty], paid with, how, partner, state, city */
  [
    '1094',
    H2(10, 21, 12, 40),
    'Ana R.',
    1,
    [
      ['lts', 'Black', 'M', 1],
      ['pci', 'One size', '', 1],
    ],
    'clear',
    'ship',
    '',
    'paid',
    'Redlands',
  ],
  ['1093', H2(10, 21, 10, 5), 'Jordan P.', 0, [['gcm', 'Cobalt', 'L', 1]], 'card', 'ship', '', 'paid', 'Riverside'],
  ['1092', H2(10, 20, 19, 22), 'Mia T.', 1, [['ltl', 'White', 'S', 1]], 'clear', 'pickup', 'Uptown Barber', 'paid', 'Redlands'],
  ['1091', H2(10, 20, 16, 10), 'Chris D.', 0, [['tn', 'Black', 'M', 1]], 'wallet', 'ship', '', 'paid', 'Pasadena'],
  [
    '1090',
    H2(10, 20, 9, 30),
    'Leo M.',
    1,
    [
      ['psq', 'One size', '', 2],
      ['pci', 'One size', '', 1],
    ],
    'clear',
    'ship',
    '',
    'paid',
    'Colton',
  ],
  ['1089', H2(10, 19, 18, 0), 'Sam K.', 1, [['lts', 'White', 'L', 2]], 'clear', 'ship', '', 'packed', 'San Bernardino'],
  ['1088', H2(10, 19, 13, 15), 'Nina V.', 0, [['gtt', 'Black', 'M', 1]], 'card', 'pickup', 'Mesa Laundry', 'ready', 'Redlands'],
  [
    '1087',
    H2(10, 19, 11, 0),
    'Omar H.',
    1,
    [
      ['ltl', 'Black', 'L', 1],
      ['psq', 'One size', '', 1],
    ],
    'clear',
    'ship',
    '',
    'packed',
    'Highland',
  ],
  ['1086', H2(10, 18, 15, 30), 'Tess W.', 1, [['lts', 'Black', 'S', 1]], 'clear', 'pickup', 'Redlands Tire & Lube', 'ready', 'Redlands'],
  ['1085', H2(10, 18, 9, 45), 'Ben A.', 0, [['tn', 'Black', 'L', 1]], 'card', 'ship', '', 'shipped', 'Los Angeles'],
  ['1084', H2(10, 17, 17, 20), 'Kim L.', 1, [['gcm', 'White', 'M', 1]], 'clear', 'ship', '', 'shipped', 'Fontana'],
  ['1083', H2(10, 17, 12, 0), 'Ray C.', 0, [['lts', 'Black', 'XL', 1]], 'wallet', 'ship', '', 'shipped', 'Yucaipa'],
  ['1082', H2(10, 16, 20, 10), 'Ivy N.', 1, [['pci', 'One size', '', 3]], 'clear', 'ship', '', 'shipped', 'Loma Linda'],
  ['1081', H2(10, 16, 14, 0), 'Dev S.', 1, [['ltl', 'Black', 'M', 1]], 'clear', 'ship', '', 'shipped', 'Redlands'],
  ['1080', H2(10, 15, 11, 40), 'Lia F.', 0, [['gcm', 'Black', 'S', 1]], 'card', 'ship', '', 'shipped', 'Rialto'],
  ['1079', H2(10, 9, 10, 15), 'Theo B.', 1, [['hd', 'Black', 'M', 1]], 'clear', 'ship', '', 'refund', 'Redlands'],
  [
    '1078',
    H2(10, 14, 16, 0),
    'Gia P.',
    1,
    [
      ['lts', 'White', 'M', 1],
      ['psq', 'One size', '', 1],
    ],
    'clear',
    'pickup',
    'Uptown Barber',
    'picked',
    'Redlands',
  ],
  ['1077', H2(10, 14, 10, 20), 'Max O.', 0, [['gtt', 'Cobalt', 'L', 1]], 'card', 'ship', '', 'done', 'Ontario'],
  ['1076', H2(10, 13, 18, 30), 'Eli J.', 1, [['tn', 'Black', 'S', 1]], 'clear', 'ship', '', 'done', 'Redlands'],
];
export const PRE = [
  /* id, shop, product, option, units, state, date */ ['p1', 'Mesa Laundry', 'cpt', 'Counter', 1, 'held', D(10, 6)],
  ['p2', 'Uptown Barber', 'cpt', 'Table', 2, 'held', D(10, 8)],
  ['p3', 'Redlands Tire & Lube', 'c8', '', 1, 'held', D(10, 9)],
  ['p4', 'Sixth St. Tacos', 'cpt', 'Table', 3, 'signup', D(10, 14)],
  ['p5', 'Inland Cycle Works', 'cpt', 'Counter', 1, 'agreement', D(10, 18)],
  ['p6', 'Mesa Laundry', 'c8', '', 1, 'held', D(10, 19)],
];
export const PRE_ST = {
  held: ['settled', 'Deposit held'],
  signup: ['underway', 'Needs sign-up'],
  agreement: ['live', 'Needs agreement'],
};
export const INCOMING = [
  /* what, units, segments [kind, from, to], tag */
  [
    'Hoodie restock',
    '120 units · Black',
    [
      ['done', D(10, 2), D(10, 16)],
      ['make', D(10, 16), D(10, 26)],
      ['ship', D(10, 26), D(10, 30)],
    ],
    '30 Oct',
    'hd',
  ],
  [
    'Devore sample',
    '1 of each colour',
    [
      ['done', D(10, 12), D(10, 19)],
      ['ship', D(10, 19), D(10, 28)],
    ],
    '28 Oct',
    'gdv',
  ],
  ['Turtleneck reorder', 'Suggested · 36 units', [['plan', NOW, D(11, 11)]], '11 Nov', 'tn'],
  ['Clear Point · first build', 'Pre-orders with a deposit', [['plan', D(11, 2), D(12, 4)]], 'Dec', 'cpt'],
];
/* ── glyphs: plain line drawings, one per kind of product ─────────────── */
export const GLY = {
  tee: (
    <>
      <path d="M14 7 6.5 11l3 6 3.5-1.6V33h14V15.4l3.5 1.6 3-6L26 7c-1.2 2-3.4 3-6 3s-4.8-1-6-3Z" />
      <path d="M15.6 7.6c1.1 1.5 2.6 2.2 4.4 2.2s3.3-.7 4.4-2.2" />
    </>
  ),
  gtee: (
    <>
      <path d="M14 7 6.5 11l3 6 3.5-1.6V33h14V15.4l3.5 1.6 3-6L26 7c-1.2 2-3.4 3-6 3s-4.8-1-6-3Z" />
      <rect x="16" y="15" width="8" height="7" />
    </>
  ),
  ls: (
    <>
      <path d="M14 7 8.5 9.5 5 30l3.6.8L13 16.5V33h14V16.5l4.4 14.3L35 30 31.5 9.5 26 7c-1.2 2-3.4 3-6 3s-4.8-1-6-3Z" />
      <path d="M15.6 7.6c1.1 1.5 2.6 2.2 4.4 2.2s3.3-.7 4.4-2.2" />
    </>
  ),
  turtle: (
    <>
      <path d="M15.5 8 8.5 10 5 30l3.6.8L13 16.5V33h14V16.5l4.4 14.3L35 30 31.5 10l-7-2" />
      <path d="M16 3.5h8V8c-1.1 1-2.5 1.6-4 1.6S17.1 9 16 8Z" />
    </>
  ),
  hood: (
    <>
      <path d="M14.5 7.5 8.5 10 5 30l3.6.8L13 16.5V33h14V16.5l4.4 14.3L35 30 31.5 10l-6-2.5" />
      <path d="M14.5 9.5C14 5 16.6 2.5 20 2.5s6 2.5 5.5 7c-1.4 1.3-3.4 2-5.5 2s-4.1-.7-5.5-2Z" />
      <path d="M15.5 25h9l1 5h-11Z" />
    </>
  ),
  psq: (
    <>
      <rect x="8.5" y="8.5" width="23" height="23" />
      <rect x="12" y="12" width="16" height="16" strokeDasharray="2 2.2" />
      <circle cx="20" cy="20" r="3.2" />
    </>
  ),
  pci: (
    <>
      <circle cx="20" cy="20" r="12" />
      <circle cx="20" cy="20" r="8.6" strokeDasharray="2 2.2" />
      <circle cx="20" cy="20" r="3.2" />
    </>
  ),
  point: (
    <>
      <rect x="6.5" y="9" width="27" height="17" />
      <path d="M10.5 13.5h9M10.5 17h13M10.5 20.5h6" />
      <rect x="25.5" y="17.5" width="4.5" height="4.5" />
      <path d="M15 31h10M20 26v5" />
    </>
  ),
  tab: (
    <>
      <rect x="9" y="6.5" width="22" height="27" rx="1.5" />
      <path d="M18 30.2h4" />
      <path d="M12.5 10.5h15v16h-15Z" strokeDasharray="2 2.2" />
    </>
  ),
};
/* ── views: what a group sees. S.view is set when a member signs in, or when an admin previews a group ── */
export const VSEC = ['home', 'growth', 'field', 'members', 'merchants', 'shop', 'money', 'contracts', 'governance', 'records', 'team'];
/* in a read-only view, anything that would change something is stopped before it runs; opening and reading still work */
export const V_OK =
  /^data-(go|\w*pane|close\w*|cm\w*|merchant|member|person|product|poster|doc|rentry|scrim|pf\w*|rail\w*|viewexit|sgn|agr|ctr|nacct|copy|sort\w*|x?sort|mo|cal\w*|theme\w*)$/;
/* Totals: co-op numbers only. Person-level tabs are hidden, member names and emails are blanked, member records don't open.
   The live API does this on the server; this is the same rule shown in the prototype. */
export const V_PERSONAL_TABS = ['Forms', 'Orders', 'Accounts'];
vars.V_NAMES = null;
/* ── Modal flows ─────────────────────────────────────────── */
vars.lastFocus = null;
/* ── Sign in: passkey first, a code by email as the fallback (Privy in the live app). Staff on the team list only. ── */
export const SG = {
  step: 'start',
  email: '',
  keep: true,
  t: null,
  left: 0,
  who: null,
  view: null,
};
export const KEY = (
  <svg className="i" viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="7" cy="10" r="3.5" />
    <path d="M10.5 10H17M14.5 10v3M17 10v2.5" />
  </svg>
);
