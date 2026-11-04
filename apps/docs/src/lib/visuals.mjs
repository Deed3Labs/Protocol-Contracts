// The hand-drawn visuals from the design, as static HTML and inline SVG. client/docs.js makes them
// respond (select a node to trace it); without JavaScript they still read correctly.
//
// Labels follow the docs: the org chart and boards follow docs/governance/structure.md, the maps
// follow docs/protocol/deed-track/protocol-overview.md and the protocol guides. Addresses are read
// from deployments/ at build time, never typed here.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { esc } from './markdown.mjs';

const urlOf = (id) => `/${id}`;
const SUPERSEDED = /(Legacy|V\d+)$/; // as scripts/docs/contract-reference.mjs: on record, not documented

export const NETWORKS = [
  { dir: 'base-sepolia', key: 'sepolia', label: 'Base Sepolia', scan: 'https://sepolia.basescan.org/address/' },
  { dir: 'base', key: 'base', label: 'Base', scan: 'https://basescan.org/address/' },
];

/** { 'base-sepolia': { Name: address }, base: {...} } — current deployments only. */
export function readDeployments(root) {
  const out = {};
  for (const n of NETWORKS) {
    const dir = join(root, 'deployments', n.dir);
    out[n.dir] = {};
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.json')) continue;
      const name = f.slice(0, -5);
      if (SUPERSEDED.test(name)) continue;
      try {
        const { address } = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        if (address) out[n.dir][name] = address;
      } catch {
        /* not a deployment record */
      }
    }
  }
  return out;
}

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

// What each contract does, in a line. The map's own lines are the design's; the rest are taken from
// the role tables in docs/protocol/*.md.
export const JOBS = {
  RevolvingIssuer: 'The tiered revolving line',
  TermIssuer: 'Term plans, including the ELPA',
  OffersIssuer: 'The $10 offer to a new member',
  ClearCredit: 'The co-op credit ledger',
  ClearUSDUpgradeable: 'CLRUSD, the fully reserved token',
  ClearUSD: 'The original CLRUSD, not upgradeable',
  ESADepositVault: '1:1 backing for CLRUSD',
  PayoutPool: 'Turns merchant balances into money',
  LendingPool: 'Member money funding unsecured tiers',
  BondVault: 'Holds bond proceeds',
  AssurancePool: 'Reserve tokens against defaults',
  NetworkRegistry: 'Parent registry for issuers',
  MerchantRegistry: 'What each merchant was promised',
  CollateralRegistry: 'What each member has pledged',
  LimitCalculator: 'Turns pledges into a ceiling',
  ValidatorRegistry: 'Lists active validators and grants them their roles',
  TokenRegistry: 'Optional list of accepted payment tokens',
  Validator: 'Checks a deed or unit against its asset type and records the result',
  FundManager: "Takes the service fee at mint and holds the validator's share",
  DeedNFT: 'The T-Deed. One token for each asset',
  MetadataRenderer: "Builds each deed's metadata from its traits",
  Fractionalize: 'Holds a deed and issues ERC-20 shares against it',
  Subdivide: 'Splits a validated land or estate deed into ERC-1155 units',
  FractionTokenFactory: 'Clones a share token for each fraction',
  AccessManager: 'Admin, operator and member roles',
  AssuranceOracle: 'Prices accepted tokens and serves the target reserve ratio',
  BondValuer: "Tells CollateralRegistry what a member's pledged bonds are worth",
  BurnerBond: 'The bond collection: mints, redeems and rolls',
  BurnerBondDeposit: 'The one entry point for buying a bond',
  BurnerBondFactory: 'Opens a bond collection for each accepted token',
  CLRUSDTokenPool: 'Chainlink CCIP pool for CLRUSD',
  ClaimEscrow: 'Holds USDC for claim-by-link flows',
  Create2Deployer: 'Deterministic deployments',
  Liquidator: 'Seizes pledged collateral and settles the tier it backed',
  MembershipRegistry: 'The membership records AccessManager reads',
  SavingsIntentFactory: 'Single-use escrows for savings deposits and redemptions',
};

// Arrowheads, as in the design: right, left, down, up.
const R = (x, y) => ` M${x - 8} ${y - 5} L${x} ${y} L${x - 8} ${y + 5}`;
const L = (x, y) => ` M${x + 8} ${y - 5} L${x} ${y} L${x + 8} ${y + 5}`;
const D = (x, y) => ` M${x - 5} ${y - 8} L${x} ${y} L${x + 5} ${y - 8}`;
const U = (x, y) => ` M${x - 5} ${y + 8} L${x} ${y} L${x + 5} ${y + 8}`;

// name: [contract (for page and address), x, y] on a 1000 x 400 grid.
const CREDIT = {
  nodes: {
    RevolvingIssuer: ['RevolvingIssuer', 300, 250],
    TermIssuer: ['TermIssuer', 300, 50],
    OffersIssuer: ['OffersIssuer', 300, 150],
    ClearCredit: ['ClearCredit', 500, 150],
    ClearUSD: ['ClearUSDUpgradeable', 500, 350],
    ESADepositVault: ['ESADepositVault', 300, 350],
    PayoutPool: ['PayoutPool', 700, 150],
    LendingPool: ['LendingPool', 900, 50],
    BondVault: ['BondVault', 900, 150],
    AssurancePool: ['AssurancePool', 900, 250],
    NetworkRegistry: ['NetworkRegistry', 100, 50],
    MerchantRegistry: ['MerchantRegistry', 700, 50],
    CollateralRegistry: ['CollateralRegistry', 100, 150],
    LimitCalculator: ['LimitCalculator', 100, 250],
  },
  edges: [
    ['NetworkRegistry', 'TermIssuer', 'read', 'M180 50 H220' + R(220, 50)],
    ['NetworkRegistry', 'OffersIssuer', 'read', 'M180 50 H200 V150 H220' + R(220, 150)],
    ['CollateralRegistry', 'LimitCalculator', 'read', 'M100 172 V228' + D(100, 228)],
    ['LimitCalculator', 'RevolvingIssuer', 'read', 'M180 250 H220' + R(220, 250)],
    ['ESADepositVault', 'ClearUSD', 'write', 'M380 350 H420' + R(420, 350)],
    ['TermIssuer', 'ClearCredit', 'write', 'M380 50 H400 V150 H420' + R(420, 150)],
    ['OffersIssuer', 'ClearCredit', 'write', 'M380 150 H420' + R(420, 150)],
    ['RevolvingIssuer', 'ClearCredit', 'write', 'M380 250 H400 V150 H420' + R(420, 150)],
    ['ClearCredit', 'PayoutPool', 'write', 'M580 150 H620' + R(620, 150)],
    ['MerchantRegistry', 'PayoutPool', 'read', 'M700 72 V128' + D(700, 128)],
    ['LendingPool', 'PayoutPool', 'write', 'M820 50 H800 V150 H780' + L(780, 150)],
    ['BondVault', 'PayoutPool', 'write', 'M820 150 H780' + L(780, 150)],
    ['AssurancePool', 'PayoutPool', 'write', 'M820 250 H800 V150 H780' + L(780, 150)],
  ],
  heads: ['Rules', 'Issue', 'Ledger', 'Cash out', 'Lenders'],
  layers: [['Rules', ['NetworkRegistry', 'CollateralRegistry', 'LimitCalculator', 'MerchantRegistry']], ['Issue', ['TermIssuer', 'OffersIssuer', 'RevolvingIssuer']], ['Ledger and money', ['ClearCredit', 'ClearUSD', 'ESADepositVault']], ['Cash out', ['PayoutPool']], ['Lenders', ['LendingPool', 'BondVault', 'AssurancePool']]],
  sel: 'PayoutPool',
};

// FractionToken is not deployed on its own (each fraction gets a clone), so it has no address and
// its page is the fractionalization guide.
const DEED = {
  nodes: {
    ValidatorRegistry: ['ValidatorRegistry', 100, 50],
    TokenRegistry: ['TokenRegistry', 100, 150],
    Validator: ['Validator', 300, 150],
    FundManager: ['FundManager', 500, 50],
    DeedNFT: ['DeedNFT', 500, 150],
    MetadataRenderer: ['MetadataRenderer', 500, 250],
    Fractionalize: ['Fractionalize', 700, 150],
    Subdivide: ['Subdivide', 700, 250],
    FractionTokenFactory: ['FractionTokenFactory', 900, 50],
    FractionToken: [null, 900, 150, 'protocol/deed-track/fractionalization', 'The ERC-20 share token. Each fraction gets its own clone'],
  },
  edges: [
    ['ValidatorRegistry', 'FundManager', 'write', 'M180 50 H420' + R(420, 50)],
    ['ValidatorRegistry', 'DeedNFT', 'write', 'M180 50 H400 V150 H420' + R(420, 150)],
    ['TokenRegistry', 'Validator', 'read', 'M180 150 H220' + R(220, 150)],
    ['TokenRegistry', 'FundManager', 'read', 'M100 128 V100 H440 V72' + U(440, 72)],
    ['Validator', 'DeedNFT', 'write', 'M380 150 H420' + R(420, 150)],
    ['Validator', 'Subdivide', 'write', 'M300 172 V350 H700 V272' + U(700, 272)],
    ['DeedNFT', 'FundManager', 'write', 'M500 128 V72' + U(500, 72)],
    ['DeedNFT', 'MetadataRenderer', 'write', 'M500 172 V228' + D(500, 228)],
    ['DeedNFT', 'Fractionalize', 'write', 'M580 150 H620' + R(620, 150)],
    ['DeedNFT', 'Subdivide', 'read', 'M580 150 H600 V250 H620' + R(620, 250)],
    ['Fractionalize', 'FractionTokenFactory', 'write', 'M780 150 H800 V50 H820' + R(820, 50)],
    ['Fractionalize', 'FractionToken', 'write', 'M780 150 H820' + R(820, 150)],
    ['FractionTokenFactory', 'FractionToken', 'write', 'M900 72 V128' + D(900, 128)],
  ],
  heads: ['Rules', 'Check', 'Deed', 'Split or lock', 'Shares'],
  layers: [['Rules', ['ValidatorRegistry', 'TokenRegistry']], ['Check', ['Validator']], ['Deed', ['DeedNFT', 'FundManager', 'MetadataRenderer']], ['Split or lock', ['Fractionalize', 'Subdivide']], ['Shares', ['FractionTokenFactory', 'FractionToken']]],
  sel: 'DeedNFT',
  wrap: { ValidatorRegistry: 'Validator​Registry', MetadataRenderer: 'Metadata​Renderer', FractionTokenFactory: 'FractionToken​Factory' },
};

const legend = (items) => `<div class="cd-legend">${items.map(([k, t]) => `<span><i${k ? ` data-k="${k}"` : ''}></i>${t}</span>`).join('')}</div>`;

/** One drawn contract graph with its caption, legend and the small-screen list. */
function graph(def, kind, deployments) {
  const sepolia = deployments['base-sepolia'] || {};
  const info = (name) => {
    const [contract, , , page, job] = def.nodes[name];
    const addr = contract ? sepolia[contract] || '' : '';
    return {
      name,
      href: urlOf(page || `protocol/contracts/${contract}`),
      job: job || JOBS[contract] || '',
      addr,
      short: short(addr),
      scan: addr ? NETWORKS[0].scan + addr : '',
    };
  };
  const sel = def.sel;
  const linked = new Set([sel]);
  def.edges.forEach(([a, b]) => (a === sel || b === sel) && (linked.add(a), linked.add(b)));
  const edges = def.edges
    .map(([a, b, k, d]) => `<path class="cd-edge" data-a="${a}" data-b="${b}" data-k="${k}" data-s="${a === sel || b === sel ? 'on' : ''}" d="${d}"></path>`)
    .join('');
  const nodes = Object.keys(def.nodes)
    .map((n) => {
      const i = info(n);
      const [, x, y] = def.nodes[n];
      const label = (def.wrap && def.wrap[n]) || n;
      return `<button class="cd-gn" type="button" data-n="${n}" data-s="${n === sel ? 'on' : ''}" aria-pressed="${n === sel}" data-job="${esc(i.job)}" data-href="${i.href}" data-scan="${i.scan}" data-short="${i.short}" style="left:${x / 10}%;top:${y / 4}%">${label}</button>`;
    })
    .join('');
  const s = info(sel);
  const scanBtn = `<a class="cd-btn" data-variant="ghost" data-size="s" data-role="scan" href="${s.scan}"${s.scan ? '' : ' hidden'}>${s.short}</a>`;
  const cap = `<figcaption class="cd-graph-f" aria-live="polite"><div><b data-role="name">${s.name}</b><p data-role="job">${esc(s.job)}</p></div><div class="cd-graph-a">${scanBtn}<a class="cd-btn" data-variant="ghost" data-size="s" data-role="open" href="${s.href}">Open page</a></div></figcaption>`;
  const heads = def.heads.map((h) => `<span class="cd-th">${h}</span>`).join('');
  const layers = def.layers
    .map(([name, ns]) => `<div class="cd-layer"><span class="cd-th">${name}</span><div class="cd-nodes">${ns.map((n) => `<a class="cd-node" href="${info(n).href}">${n}</a>`).join('')}</div></div>`)
    .join('');
  return (
    `<figure class="cd-graph" data-graph${kind === 'deed' ? ' data-map="deed"' : ''}><div class="cd-graph-h">${heads}</div>` +
    `<div class="cd-graph-c"><svg viewBox="0 0 1000 400" aria-hidden="true">${edges}</svg>${nodes}</div>${cap}</figure>` +
    legend([['', 'Writes or pays'], ['read', 'Reads from']]) +
    `<div class="cd-map">${layers}</div>`
  );
}

export const deedMap = (deployments) => graph(DEED, 'deed', deployments);

// ── The contract map page ──

/** Rows for the address table: the map's contracts first, in map order, then the rest by name. */
function addressRows(deployments, net) {
  const have = deployments[net.dir] || {};
  const order = [...Object.values(CREDIT.nodes).map((n) => n[0]), ...Object.values(DEED.nodes).map((n) => n[0])].filter(Boolean);
  const names = Object.keys(have);
  const sorted = [...order.filter((n) => names.includes(n)), ...names.filter((n) => !order.includes(n)).sort((a, b) => a.localeCompare(b))];
  return sorted.map((name) => ({ name, job: JOBS[name] || '', addr: have[name] }));
}

export function contractMap(deployments, contractIds) {
  const tables = NETWORKS.map((net, i) => {
    const rows = addressRows(deployments, net)
      .map((r) => {
        const page = contractIds.has(`protocol/contracts/${r.name}`);
        const name = page ? `<a class="cd-ct-name" href="/protocol/contracts/${r.name}">${r.name}</a>` : `<span class="cd-ct-name">${r.name}</span>`;
        return `<div class="cd-tr">${name}<span class="cd-v">${esc(r.job)}</span><a class="cd-addr cd-right" href="${net.scan}${r.addr}" title="${r.addr}">${short(r.addr)}</a></div>`;
      })
      .join('');
    return `<div class="cd-table" data-kind="ct" data-net="${net.key}"${i ? ' hidden' : ''}><div class="cd-tr cd-trh"><span class="cd-th">Contract</span><span class="cd-th">What it does</span><span class="cd-th cd-right">Address</span></div>${rows}</div>`;
  }).join('');
  const seg = NETWORKS.map((n, i) => `<button type="button" data-net="${n.key}" data-on="${i === 0}" aria-pressed="${i === 0}">${n.label} · ${Object.keys(deployments[n.dir] || {}).length}</button>`).join('');
  return {
    title: 'Contract map',
    lede: 'The main contracts, how they connect, and where each one lives. Select one to trace it. Every address is in <a class="cd-inl" href="https://github.com/Deed3Labs/Protocol-Contracts/tree/dev/deployments">deployments</a>.',
    actions: `<div class="cd-actions"><div class="cd-seg" role="group" aria-label="Network" data-seg>${seg}</div><a class="cd-btn" data-variant="ghost" href="https://github.com/Deed3Labs/Protocol-Contracts/tree/dev/contracts">Source</a></div>`,
    body:
      `<h2 id="credit-and-money-contracts">Credit and money contracts</h2>${graph(CREDIT, 'credit', deployments)}` +
      `<h2 id="deed-track-contracts">Deed track contracts</h2><p>The Deed track stands on its own. No contract outside it reads <code>DeedNFT</code>. The only piece it shares with the rest of the protocol is the optional <code>TokenRegistry</code> lookup.</p>${graph(DEED, 'deed', deployments)}` +
      `<h2 id="deployed-addresses">Deployed addresses</h2>${tables}`,
    text: 'Contract map. The main contracts, how they connect, and where each one lives. Credit and money contracts. Deed track contracts. Deployed addresses. ' + Object.keys(JOBS).join(' '),
  };
}

// ── Governance: the org chart, the two boards, the reserved-matter vote (docs/governance/structure.md) ──

// id, name, note, owned by, what it does, x, y, w, h (on a 1000 x 376 grid), level, kind
const ORG = [
  ['coop', 'The co-op', 'members, one member one vote', 'Its members', 'One member, one vote. It owns everything in the tree except the foundation.', 262, 8, 260, 68, 0, 'root'],
  ['prog', 'Program entity', 'accounts, cards, payments', 'The co-op', 'Accounts, cards and payments. Member money sits here, on the money side.', 8, 142, 180, 76, 1, ''],
  ['dtc', 'Deed & Title Co', 'records, administration', 'The co-op', 'Records and administration for deeds and title.', 204, 142, 180, 76, 1, ''],
  ['hold', 'Clear Capital Holdings', 'where outside investors sit', 'The co-op', 'A separate company with its own board, and the only place outside investors sit.', 400, 142, 180, 76, 1, ''],
  ['lend', 'Clear Lending', 'funds the credit book', 'Clear Capital Holdings', 'Funds the credit book. The money side, and it never touches the land.', 286, 292, 172, 76, 2, ''],
  ['prop', 'Clear Properties', 'contributed property', 'Clear Capital Holdings', 'Holds contributed property. The housing side, and it never backs a credit loss.', 522, 292, 172, 76, 2, ''],
  ['labs', 'ClearLabs', 'builds the protocol', 'The co-op', 'Builds the protocol, and is paid by the foundation to maintain it.', 596, 142, 180, 76, 1, ''],
  ['found', 'Protocol foundation', 'ownerless, holds the source', 'Nobody', "Holds the protocol's source, and contracts ClearLabs to maintain it.", 792, 142, 180, 76, 0, 'found'],
];
const ORG_EDGES = [
  ['prog', 'e', 'M392 76 V112 H98 V142'], ['dtc', 'e', 'M392 76 V112 H294 V142'], ['hold', 'e', 'M392 76 V112 H490 V142'], ['labs', 'e', 'M392 76 V112 H686 V142'],
  ['lend', 'e', 'M490 218 V262 H372 V292'], ['prop', 'e', 'M490 218 V262 H608 V292'], ['found', 'k', 'M882 218 V242 H686 V218'],
];
const ORG_SEL = 'hold';
const orgChain = (id) => (id === 'lend' || id === 'prop' ? [id, 'hold'] : [id]);
const orgEdgeOn = (e, sel) => (e === 'found' ? sel === 'found' || sel === 'labs' : orgChain(sel).includes(e));

export function orgChart() {
  const data = (o) => `data-o="${o[0]}" data-by="${esc(o[3])}" data-what="${esc(o[4])}" data-on="${o[0] === ORG_SEL}" aria-pressed="${o[0] === ORG_SEL}" data-k="${o[10]}"`;
  const edges = ORG_EDGES.map(([e, k, d]) => `<path class="cd-oe" data-e="${e}" data-k="${k}" data-on="${orgEdgeOn(e, ORG_SEL)}" d="${d}"></path>`).join('');
  const nodes = ORG.map((o) => `<button class="cd-on" type="button" ${data(o)} style="left:${o[5] / 10}%;top:${(o[6] / 3.76).toFixed(3)}%;width:${o[7] / 10}%;height:${(o[8] / 3.76).toFixed(3)}%"><b>${esc(o[1])}</b><small>${o[2]}</small></button>`).join('');
  const list = ORG.map((o) => `<button class="cd-ol" type="button" ${data(o)} data-lv="${o[9]}"><b>${esc(o[1])}</b><small>${o[2]}</small></button>`).join('');
  const s = ORG.find((o) => o[0] === ORG_SEL);
  return (
    `<figure class="cd-orgf" data-org><div class="cd-org"><svg viewBox="0 0 1000 376" aria-hidden="true">${edges}<text class="cd-ocl" x="784" y="262" text-anchor="middle">contracts ClearLabs to maintain it</text></svg>${nodes}</div>` +
    `<div class="cd-org-m">${list}</div>` +
    `<figcaption class="cd-org-d" aria-live="polite"><div><span>Selected</span><b data-role="name">${esc(s[1])}</b></div><div><span>Owned by</span><b data-role="by">${esc(s[3])}</b></div><p data-role="what">${esc(s[4])}</p></figcaption></figure>` +
    legend([['', 'Owns'], ['read', 'Contract'], ['box', 'Ownerless']])
  );
}

// The co-op board's size is not settled (structure.md), so its tiles are illustrative: a chair, seats
// elected by members, and one third delegated from the regional councils. The Holdings board is the
// seven seats the doc fixes by kind.
const SEATS_COOP = [['Member', 'Chair', ''], ['Member', 'Elected', ''], ['Member', 'Elected', ''], ['Member', 'Elected', ''], ['Council', 'Delegated', ''], ['Council', 'Delegated', '']];
const SEATS_HOLD = [['Chair', 'Elected', 'chair'], ['Co-op', 'Reserved', ''], ['Co-op', 'Reserved', ''], ['Neutral', 'Joint', 'neu'], ['Open', 'Free', 'open'], ['Investor', 'Financial', 'inv'], ['Investor', 'Financial', 'inv']];
const PERSON = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5" r="2.8"></circle><path d="M2.5 15c0-3.2 2.4-5 5.5-5s5.5 1.8 5.5 5"></path></svg>';
const tiles = (seats) => `<div class="cd-tiles">${seats.map(([role, tag, kind]) => `<span class="cd-tile${kind ? ` ${kind}` : ''}">${PERSON}<b>${role}<small>${tag}</small></b></span>`).join('')}</div>`;

export function boards() {
  return (
    `<div class="cd-boards">` +
    `<div class="cd-board"><div class="cd-board-h"><b>The co-op board</b><span>Elected by members</span></div><p class="cd-board-l">Member-only.</p>${tiles(SEATS_COOP)}</div>` +
    `<div class="cd-board"><div class="cd-board-h"><b>The Holdings board</b><span>Clear Capital Holdings</span></div><p class="cd-board-l">Its own company. Its own board.</p>${tiles(SEATS_HOLD)}</div>` +
    `<div class="cd-boards-f"><span>Neither board can quietly become the other.</span><span class="cd-th">Co-op seat count illustrative</span></div></div>`
  );
}

const VOTES = '<span class="cd-s7" aria-hidden="true"><i class="y"></i><i class="n"></i><i class="y"></i><i class="y"></i><i class="n"></i><i class="n"></i><i class="y"></i></span>';
export function vote() {
  return (
    `<div class="cd-pair" role="group" aria-label="A motion to sell the land, four votes to three, written two ways">` +
    `<div class="cd-pc"><div class="cd-board-h"><b>Written as a policy</b><span>Set by a board</span></div><p class="cd-q" data-struck>“We never sell the land.”</p><div class="cd-vote"><span>Motion to sell</span>${VOTES}<span class="cd-out" data-k="pass">Passes, 4 to 3</span></div><p class="cd-pt">A board reverses it in an afternoon.</p></div>` +
    `<div class="cd-pc"><div class="cd-board-h"><b>Written as a reserved matter</b><span>Set in the structure</span></div><p class="cd-q">“We never sell the land.”</p><div class="cd-vote"><span>Motion to sell</span>${VOTES}<span class="cd-out" data-k="held">Blocked</span></div><p class="cd-pt">It cannot pass without the co-op.</p></div>` +
    `</div>`
  );
}

/**
 * Where the visuals go: after a heading, past the paragraphs that open its section.
 * page id -> [[heading id, render]]
 */
export function placements(deployments) {
  return {
    'governance/structure': [['the-entities', orgChart], ['the-holdings-board', boards], ['the-five-reserved-matters', vote]],
    'protocol/deed-track/protocol-overview': [['how-the-contracts-connect', () => deedMap(deployments)]],
  };
}
