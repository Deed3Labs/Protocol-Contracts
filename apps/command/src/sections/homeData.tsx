// @ts-nocheck: demo data, as the other section data files are.

/*
 * Home's demo data (design/command-center-ui, the HOME module): the reference's figures, drawn in the
 * prototype and the preview. Live, Home draws from what the API sends instead (homeHub.tsx, liveModel);
 * none of this ever shows on dev.
 */

/** How each sample waiting item reads on Home's queue. */
export const HOME_QV = {
  payout: {
    t: 'Rosa’s Panadería payout',
    m: (
      <>
        {'September · Dana proposed · '}
        <em>due tomorrow</em>
      </>
    ),
    a: '$412.60',
    btn: 'Approve',
    ct: ['live', 'Due tomorrow'],
    by: 'Dana Ruiz',
    s: 'Send back',
    back: 'Rosa’s payout',
    go: 'merchants',
  },
  chain: {
    t: 'Raise Rosa’s cap to $150',
    m: 'MerchantRegistry · Dana signed · yours makes it 2 of 3',
    a: '$150.00',
    btn: 'Multisig',
    ct: ['live', '1 of 2 signed'],
    by: 'Marcus Lee',
    s: 'Not now',
    tool: 'the Safe multisig',
    go: 'build',
  },
  invite: {
    t: 'Batch 13 invites',
    m: 'Oldest on the waitlist first · Marcus proposed',
    a: '25',
    u: 'people',
    btn: 'Approve',
    ct: ['plain', 'Two-person'],
    by: 'Marcus Lee',
    s: 'Send back',
    back: 'batch 13',
    go: 'members',
    fp: 'b13',
  },
  agreement: {
    t: 'Inland Cycle Works agreement',
    m: 'Founding partner · they signed 20 Oct',
    a: '4/5',
    u: 'seats',
    btn: 'E-sign',
    ct: ['plain', 'E-signature'],
    by: 'Clear',
    s: 'Not now',
    tool: 'the e-signature tool',
    go: 'governance',
    fp: 'agreements',
  },
};

/** The header's vitals, the heads-up and the section pulse, as the reference draws them. */
export const HOME_DEMO = {
  when: 'Wed 21 Oct · 16:04 · Testnet',
  /** the first day the timeline shows (7 days back) and today's index in it */
  start: Date.UTC(2026, 9, 14),
  today: '2026-10-21',
  feeds: [
    ['Bridge', 1],
    ['Protocol', 1],
    ['Plaid', 0],
    ['Analytics', 1],
  ],
  feedBad: 'Plaid is 3 hours behind',
  freeToSpend: 20669.17,
  operating: 21480.75,
  credit: 1527.6,
  creditUsed: 78.5,
  stuck: 64,
  heads: [
    { sv: 'absent', t: 'Plaid is 3 hours behind', age: '3h', m: 'Money · operating cash balance is stale', go: 'money', own: ['resync', 'Dana Ruiz is re-syncing', 58, '7/12'] },
    { sv: 'underway', t: 'Rosa’s hit their cap 3 times', age: 'Today', m: 'Merchants · sales declined at the counter', go: 'merchants', own: ['cap'] },
    { sv: 'underway', t: 'Poster P-044 is sun-faded', age: '2d', m: 'Field · Mesa Laundry · scans down 40%', go: 'field', own: ['route', 'Marcus Lee · stop 5 today'] },
  ],
  growth: { f: '1,302', s: 'joined in 30 days · 109 made a first spend', key: 'Biggest drop is visit → join, 3.6%' },
  members: { f: '124', s: 'of 300 invited · 1,500 on the waitlist', stuck: 64, active: [13, 13, 12, 11, 11, 10, 10, 10, 9, 9, 8, 8], opened: [6, 6, 6, 5, 5, 6, 6, 5, 5, 5, 5, 4] },
  merchants: { live: 12, of: 30, signing: 6, s: 'partner shops transacting · 13 cities' },
  money: {
    held: 75984.75,
    s: 'held across 6 accounts · +$10,418.55 this week',
    groups: [
      ['Members’', '$42.4k', 55.8],
      ['Co-op’s', '$22.0k', 28.9],
      ['Set aside', '$11.7k', 15.3, 1],
    ],
    parts: [
      [51.2, 'var(--fg)'],
      [4.5, 'color-mix(in srgb,var(--live) 62%,transparent)'],
      [28.3, 'var(--land)'],
      [0.6, 'color-mix(in srgb,var(--fg) 30%,transparent)'],
      [13.5, 'color-mix(in srgb,var(--fg) 58%,transparent)'],
      [1.9, 'var(--underway)'],
    ],
    key: 'Biggest mover: member savings, +$7,740.20 this week',
  },
  build: {
    f: '30',
    of: '31',
    s: 'live on Base Sepolia · 2 changes in flight',
    groups: [
      ['Access', ['', '', '', '', 'c', '']],
      ['Issue', ['', '', '', '', '']],
      ['Tokens', ['', '']],
      ['Pools', ['', '', '', '', 'x', 'f', 'w', '']],
      ['Capital', ['f', '']],
      ['Deeds', ['', '', '', '', '', '', '', 'c']],
    ],
  },
  governance: { f: '4', of: '9', s: 'entities formed · 6 of 15 board seats filled', due: '3 due' },
  /** date, time, what, detail, lane, go, pane */
  past: [
    ['2026-10-21', '14:00', 'Mesa Laundry cap → $120', 'Marcus Lee', 'Merchants', 'merchants'],
    ['2026-10-21', '12:00', 'Uptown Barber signed', '12 shops now transacting', 'Merchants', 'merchants'],
    ['2026-10-21', '10:00', 'Waitlist passed 1,500', 'At 16:12 yesterday it was 1,482', 'Growth', 'members', 'waitlist'],
    ['2026-10-20', '17:30', 'Batch 12 invites sent', '25 people · Marcus Lee', 'Members', 'members', 'batches'],
    ['2026-10-20', '11:05', 'RevolvingIssuer v1.3 deployed', 'Base Sepolia · Dana Ruiz', 'Build', 'build'],
    ['2026-10-19', '', 'Board minutes draft shared', 'for 4 Nov · Ana Ortiz', 'Governance', 'governance'],
    ['2026-10-17', '', 'Founding seat 4 offered', 'Inland Cycle Works', 'Merchants', 'merchants'],
    ['2026-10-16', '', 'Riverside poster run done', '6 posters up · Marcus Lee', 'Growth', 'field', 'posters'],
    ['2026-10-15', '', 'Yield pool opened', '$8,062.10 from 14 members', 'Money', 'money', 'pools:yield'],
  ],
  /** date, short, long, sub, status, lane, tiny, the link's data attribute */
  due: [
    ['2026-10-29', 'Closes', 'Member vote closes', '85.2% yes · 61 of 188 voted', 'm', 'Governance', '', ['vpane', 'votes']],
    ['2026-11-01', 'Annual report', 'Wyoming annual report', 'ClearLabs Inc', 'ok', 'Governance', 'Report', ['vpane', 'calendar']],
    ['2026-11-02', 'Payouts clear', 'Payouts clear', '$9,510.65 to 11 shops', 'm', 'Money', '', ['xpane', 'payouts']],
    ['2026-11-04', 'Board meeting', 'Board meeting', 'Co-op board · 18:00', 'un', 'Governance', '', ['vpane', 'votes']],
    ['2026-11-15', 'Statement', 'Statement of Information', 'Clear Co-op', 'bad', 'Governance', '', ['vpane', 'calendar']],
  ],
  /** from, to (null runs past the window), label, value, lane, key, tone */
  rails: [
    ['2026-10-20', null, 'Batch 12 activation', '14/25 opened', 'Members', 'r1', ''],
    ['2026-10-21', '2026-10-21', 'Poster route', '3/8 shops', 'Growth', 'r2', ''],
    ['2026-10-21', '2026-10-21', 'Plaid re-sync', '7/12', 'Money', 'r3', ''],
    ['2026-10-19', '2026-10-21', 'AssurancePool v1.3', 'Waiting on you', 'Contracts', 'q0', 'live'],
    ['2026-10-15', '2026-10-29', 'Member vote', '85.2% yes', 'Governance', 'd0', ''],
  ],
  railTo: ' · to 19 Jan',
  /** key, title, value, [segments, done, also], note, the link's data attribute */
  runs: [
    ['r1', 'Batch 12 invites', '14/25 opened', [25, 9, 5], '9 activated · sent yesterday', ['mpane', 'batches']],
    ['r2', 'Poster route', '3/8 shops', [8, 3, 0], 'Marcus Lee · Redlands loop', ['go', 'field']],
    ['r3', 'Plaid re-sync', '7/12 links', [12, 7, 0], 'Dana Ruiz · since 22:41', ['go', 'money']],
  ],
};
