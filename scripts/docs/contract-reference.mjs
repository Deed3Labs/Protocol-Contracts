// The contract reference in docs/protocol/contracts/: one page per deployed contract, generated so it
// can't drift from what is deployed.
//
//   node scripts/docs/contract-reference.mjs           write the pages
//   node scripts/docs/contract-reference.mjs --check   fail if a page is missing, stale or extra (CI)
//
// Addresses, functions, events and errors come from the ABIs recorded in deployments/<network>/ --
// what is deployed, not what the source says today. Who may call a function comes from the source:
// the access modifiers on its declaration (onlyRole, onlyOwner, onlyOperator…), found in the
// contract or a parent in this repo. A caller check written inside a function's body is flagged, not
// described. No dependencies, so CI can run it without an install.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'docs/protocol/contracts');
const CHECK = process.argv.includes('--check');

const NETWORKS = [
  { dir: 'base-sepolia', label: 'Base Sepolia', chainId: 84532, explorer: 'https://sepolia.basescan.org/address/' },
  { dir: 'base', label: 'Base', chainId: 8453, explorer: 'https://basescan.org/address/' },
  { dir: 'sepolia', label: 'Ethereum Sepolia', chainId: 11155111, explorer: 'https://sepolia.etherscan.io/address/' },
];

// The guide that explains each contract, where there is one.
const GUIDES = {
  ClearUSD: 'savings.md', ClearUSDUpgradeable: 'savings.md', ESADepositVault: 'savings.md', SavingsIntentFactory: 'savings.md',
  ClaimEscrow: 'savings.md', CLRUSDTokenPool: 'savings.md',
  ClearCredit: 'credit.md', RevolvingIssuer: 'credit.md', TermIssuer: 'credit.md', OffersIssuer: 'credit.md',
  CollateralRegistry: 'credit.md', LimitCalculator: 'credit.md', Liquidator: 'credit.md', AccessManager: 'credit.md',
  MembershipRegistry: 'credit.md', NetworkRegistry: 'credit.md',
  PayoutPool: 'settlement.md', MerchantRegistry: 'settlement.md', LendingPool: 'settlement.md',
  AssurancePool: 'reserve.md', AssuranceOracle: 'reserve.md', TokenRegistry: 'token-registry.md',
  BondVault: 'bonds.md', BurnerBond: 'bonds.md', BurnerBondDeposit: 'bonds.md', BurnerBondFactory: 'bonds.md', BondValuer: 'bonds.md',
  DeedNFT: 'deed-track/smart-contracts.md', Validator: 'deed-track/validation-system.md', ValidatorRegistry: 'deed-track/validation-system.md',
  FundManager: 'deed-track/smart-contracts.md', MetadataRenderer: 'deed-track/metadata-renderer.md',
  Subdivide: 'deed-track/subdivision.md', Fractionalize: 'deed-track/fractionalization.md', FractionTokenFactory: 'deed-track/fractionalization.md',
};

// Inherited functions whose source isn't in this repo, and who may call them.
const LIBRARY_ACCESS = {
  grantRole: "The role's admin role (`DEFAULT_ADMIN_ROLE` unless set otherwise)",
  revokeRole: "The role's admin role (`DEFAULT_ADMIN_ROLE` unless set otherwise)",
  renounceRole: 'Only the account renouncing its own role',
  transferOwnership: 'The owner', renounceOwnership: 'The owner', acceptOwnership: 'The pending owner',
  upgradeTo: 'Whoever `_authorizeUpgrade` allows — see the source', upgradeToAndCall: 'Whoever `_authorizeUpgrade` allows — see the source',
  beginDefaultAdminTransfer: 'The default admin', acceptDefaultAdminTransfer: 'The pending default admin',
  cancelDefaultAdminTransfer: 'The default admin', changeDefaultAdminDelay: 'The default admin', rollbackDefaultAdminDelay: 'The default admin',
  transfer: 'The token holder', transferFrom: 'The holder, or an approved spender', approve: 'The token holder',
  increaseAllowance: 'The token holder', decreaseAllowance: 'The token holder', permit: 'Anyone, with the holder\'s signature',
  safeTransferFrom: 'The holder, or an approved operator', safeBatchTransferFrom: 'The holder, or an approved operator',
  setApprovalForAll: 'The holder', burn: 'The holder, or an approved spender', burnFrom: 'An approved spender',
  deposit: 'Anyone', mint: 'Anyone (ERC-4626) unless the contract restricts it', withdraw: 'The share owner, or an approved spender',
  redeem: 'The share owner, or an approved spender', multicall: 'Anyone; each call is checked on its own',
};

// CLRUSD's token base is Chainlink's BurnMintERC20 (UUPS for ClearUSDUpgradeable), which lives in
// node_modules. CI's docs job has no install, so its rules are pinned here, read from
// @chainlink/contracts' BurnMintERC20.sol and BurnMintERC20UUPS.sol. Keyed by signature.
const CHAINLINK_TOKEN = {
  'burn(uint256)': '`onlyRole(BURNER_ROLE)`',
  'burn(address,uint256)': '`onlyRole(BURNER_ROLE)` (through `burnFrom`)',
  'burnFrom(address,uint256)': '`onlyRole(BURNER_ROLE)`',
  'mint(address,uint256)': '`onlyRole(MINTER_ROLE)`',
  'grantMintAndBurnRoles(address)': '`DEFAULT_ADMIN_ROLE` (it calls `grantRole`)',
  'setCCIPAdmin(address)': '`onlyRole(DEFAULT_ADMIN_ROLE)`',
  'initialize(string,string,uint8,uint256,uint256,address,address)': 'Once, when the proxy is initialised',
  'upgradeToAndCall(address,bytes)': '`onlyRole(UPGRADER_ROLE)` (via `_authorizeUpgrade`)',
};
const CHAINLINK_TOKEN_CONTRACTS = new Set(['ClearUSD', 'ClearUSDUpgradeable']);

// ---- Solidity source index --------------------------------------------------------------------

const solFiles = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'mocks') walk(p); } else if (f.endsWith('.sol')) solFiles.push(p);
  }
})(join(ROOT, 'contracts'));

const contracts = new Map(); // name -> { file, text, parents }
for (const file of solFiles) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/^\s*(?:abstract\s+)?contract\s+(\w+)(?:\s+is\s+([^{]+))?\s*\{/gm)) {
    const parents = (m[2] ?? '').split(',').map((s) => s.trim().split(/[\s(]/)[0]).filter(Boolean);
    contracts.set(m[1], { file, text, parents });
  }
}

function sourceFor(name) {
  for (const candidate of [name, name.replace(/(Legacy|V\d+)$/, '')]) if (contracts.has(candidate)) return candidate;
  return null;
}

/** The contract and its in-repo parents, nearest first. */
function lineage(name) {
  const seen = []; const queue = [name];
  while (queue.length) {
    const n = queue.shift();
    if (!contracts.has(n) || seen.includes(n)) continue;
    seen.push(n); queue.push(...contracts.get(n).parents);
  }
  return seen;
}

function splitParams(list) {
  let depth = 0, cur = '', out = [];
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const NOT_ACCESS = new Set(['external', 'public', 'internal', 'private', 'view', 'pure', 'payable', 'virtual', 'override', 'returns', 'nonpayable']);

/** Who may call a function, read from its declaration. */
function accessFor(contractName, fn) {
  if (CHAINLINK_TOKEN_CONTRACTS.has(contractName)) {
    const key = `${fn.name}(${(fn.inputs ?? []).map((p) => p.type).join(',')})`;
    if (CHAINLINK_TOKEN[key]) return { who: CHAINLINK_TOKEN[key], also: [] };
  }
  if (!contractName) return { who: LIBRARY_ACCESS[fn.name] ?? 'Source not in this repository', also: [] };
  if (fn.name === 'upgradeTo' || fn.name === 'upgradeToAndCall') {
    const auth = accessFor(contractName, { name: '_authorizeUpgrade', inputs: [{}] });
    if (auth.who && !/^Anyone|library|not in|Not in/.test(auth.who)) return { who: `${auth.who} (via \`_authorizeUpgrade\`)`, also: [] };
  }
  for (const n of lineage(contractName)) {
    const { text } = contracts.get(n);
    const re = new RegExp(`function\\s+${fn.name}\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(text))) {
      // the parameter list, balanced
      let i = m.index + m[0].length, depth = 1, params = '';
      for (; i < text.length && depth; i++) { const c = text[i]; if (c === '(') depth++; if (c === ')') depth--; if (depth) params += c; }
      if (splitParams(params).length !== fn.inputs.length) continue;
      const end = text.slice(i).search(/[{;]/);
      const header = text.slice(i, i + end).replace(/returns\s*\([^)]*\)/g, '').replace(/override\s*\([^)]*\)/g, '');
      const mods = [...header.matchAll(/([A-Za-z_]\w*)(\s*\([^)]*\))?/g)]
        .map((x) => (x[1] + (x[2] ?? '').replace(/\s+/g, '')))
        .filter((x) => !NOT_ACCESS.has(x.split('(')[0]));
      const access = mods.filter((x) => /^only|^initializer|^reinitializer/.test(x));
      const also = mods.filter((x) => !access.includes(x));
      if (access.length) {
        const who = access.map((a) => (/^initializer|^reinitializer/.test(a) ? 'Once, when the proxy is initialised' : `\`${a}\``)).join(', ');
        return { who, also };
      }
      const body = text.slice(i + end, i + end + 1500).split('\n').slice(0, 25).join('\n');
      const caller = '(?:msg\\.sender|_msgSender\\(\\))';
      if (new RegExp(`(?:${caller}\\s*[!=]=|[!=]=\\s*${caller}|onlyRole|hasRole\\()`).test(body)) {
        return { who: 'Restricted in its body — see the source', also };
      }
      if (new RegExp(caller).test(body)) return { who: "Anyone; acts on the caller's own account", also };
      return { who: 'Anyone', also };
    }
  }
  if (LIBRARY_ACCESS[fn.name]) return { who: LIBRARY_ACCESS[fn.name], also: [] };
  return { who: 'Not in the current source — see the deployed code', also: [] };
}

// ---- Rendering --------------------------------------------------------------------------------

const type = (p) => (p.type === 'tuple' || p.type === 'tuple[]' ? `(${(p.components ?? []).map(type).join(',')})${p.type.endsWith('[]') ? '[]' : ''}` : p.type);
const param = (p) => `${type(p)}${p.name ? ' ' + p.name : ''}${p.indexed ? ' indexed' : ''}`;
const sig = (x) => `${x.name}(${(x.inputs ?? []).map(param).join(', ')})`;
const esc = (s) => s.replace(/\|/g, '\\|');

function loadDeployments() {
  const byName = new Map();
  for (const net of NETWORKS) {
    const dir = join(ROOT, 'deployments', net.dir);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const record = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const abi = typeof record.abi === 'string' ? JSON.parse(record.abi) : record.abi;
      if (!record.address || !Array.isArray(abi)) continue;
      const name = f.replace(/\.json$/, '');
      if (!byName.has(name)) byName.set(name, { name, abi, networks: [] });
      byName.get(name).networks.push({ ...net, address: record.address });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function page(c) {
  const source = sourceFor(c.name);
  const sourcePath = source ? relative(OUT, contracts.get(source).file) : null;
  const guide = GUIDES[c.name.replace(/(Legacy|V\d+)$/, '')];
  const superseded = /(Legacy|V\d+)$/.test(c.name);
  const fns = c.abi.filter((x) => x.type === 'function').sort((a, b) => sig(a).localeCompare(sig(b)));
  const reads = fns.filter((f) => f.stateMutability === 'view' || f.stateMutability === 'pure' || f.constant);
  const writes = fns.filter((f) => !reads.includes(f));
  const events = c.abi.filter((x) => x.type === 'event').sort((a, b) => a.name.localeCompare(b.name));
  const errors = c.abi.filter((x) => x.type === 'error').sort((a, b) => a.name.localeCompare(b.name));
  const upgradeable = fns.some((f) => f.name === 'upgradeTo' || f.name === 'upgradeToAndCall');

  const L = [];
  L.push(`# ${c.name}`, '');
  L.push('> Generated by [`scripts/docs/contract-reference.mjs`](../../../scripts/docs/contract-reference.mjs) from the ABI in');
  L.push('> `deployments/`. Do not edit by hand: run the script, and CI checks the page is current.', '');
  if (superseded) L.push(`**Superseded.** Kept on record; the current contract is [${c.name.replace(/(Legacy|V\d+)$/, '')}](./${c.name.replace(/(Legacy|V\d+)$/, '')}.md). Who can call is read from today's source, which may differ from the code deployed here.`, '');
  const meta = [];
  meta.push(sourcePath ? `Source: [\`${relative(ROOT, contracts.get(source).file)}\`](${sourcePath})` : 'Source: not in this repository');
  if (guide) meta.push(`Guide: [${guide.replace(/\.md$/, '').replace(/^deed-track\//, '')}](../${guide})`);
  if (upgradeable) meta.push('Upgradeable (UUPS proxy)');
  L.push(meta.join(' · '), '');
  L.push('| Network | Chain id | Address |', '|---|---|---|');
  for (const n of c.networks) L.push(`| ${n.label} | ${n.chainId} | [\`${n.address}\`](${n.explorer}${n.address}) |`);
  L.push('');

  L.push('## Functions that change state', '');
  if (!writes.length) L.push('None.', '');
  else {
    L.push('| Function | Who can call | Also |', '|---|---|---|');
    for (const f of writes) {
      const { who, also } = accessFor(source, f);
      const extra = [f.stateMutability === 'payable' ? 'payable' : '', ...also.map((a) => `\`${a}\``)].filter(Boolean).join(', ');
      L.push(`| \`${esc(sig(f))}\` | ${esc(who)} | ${esc(extra)} |`);
    }
    L.push('');
  }
  L.push('## Read functions', '');
  if (!reads.length) L.push('None.', '');
  else {
    L.push('Anyone can call these; they change nothing.', '', '| Function | Returns |', '|---|---|');
    for (const f of reads) L.push(`| \`${esc(sig(f))}\` | ${esc((f.outputs ?? []).map(param).join(', ') || '—')} |`);
    L.push('');
  }
  L.push('## Events', '');
  if (!events.length) L.push('None.', '');
  else { L.push('| Event |', '|---|'); for (const e of events) L.push(`| \`${esc(sig(e))}\` |`); L.push(''); }
  L.push('## Errors', '');
  if (!errors.length) L.push('No custom errors; failures revert with a reason string.', '');
  else { L.push('| Error |', '|---|'); for (const e of errors) L.push(`| \`${esc(sig(e))}\` |`); L.push(''); }
  return L.join('\n').replace(/\n+$/, '\n');
}

function index(all) {
  const L = [];
  L.push('# Contract reference', '');
  L.push('One page per deployed contract: its address on each network, every function and who may call it,');
  L.push('its events and its errors. Generated by [`scripts/docs/contract-reference.mjs`](../../../scripts/docs/contract-reference.mjs)');
  L.push('from the ABIs recorded in [`deployments/`](../../../deployments/) — what is deployed, not what the source says today —');
  L.push('and checked in CI, so a page can\'t fall behind a deployment. For how the contracts work together, read the');
  L.push('[protocol pages](../README.md).', '');
  L.push('**Who can call** is read from each function\'s access modifiers in the source. Where a function checks its');
  L.push('caller in its body instead, the page says so and the source has the rule. Who holds each role is chain');
  L.push('state, not code: see [Governance](../../governance/README.md).', '');
  L.push('| Contract | Networks | Guide |', '|---|---|---|');
  for (const c of all) {
    const guide = GUIDES[c.name.replace(/(Legacy|V\d+)$/, '')];
    const label = /(Legacy|V\d+)$/.test(c.name) ? ' (superseded)' : '';
    L.push(`| [${c.name}](./${c.name}.md)${label} | ${c.networks.map((n) => n.label).join(', ')} | ${guide ? `[${guide.replace(/\.md$/, '').replace(/^deed-track\//, '')}](../${guide})` : '—'} |`);
  }
  return L.join('\n') + '\n';
}

// ---- Write or check ---------------------------------------------------------------------------

const all = loadDeployments();
const want = new Map([['README.md', index(all)], ...all.map((c) => [`${c.name}.md`, page(c)])]);

if (CHECK) {
  const problems = [];
  const have = existsSync(OUT) ? readdirSync(OUT).filter((f) => f.endsWith('.md')) : [];
  for (const [f, text] of want) {
    const p = join(OUT, f);
    if (!existsSync(p)) problems.push(`missing ${f}`);
    else if (readFileSync(p, 'utf8') !== text) problems.push(`stale ${f}`);
  }
  for (const f of have) if (!want.has(f)) problems.push(`extra ${f}`);
  if (problems.length) {
    console.error(`docs/protocol/contracts is out of date (${problems.length}):\n  ${problems.join('\n  ')}\nRun: node scripts/docs/contract-reference.mjs`);
    process.exit(1);
  }
  console.log(`docs/protocol/contracts is current (${all.length} contracts).`);
} else {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const [f, text] of want) writeFileSync(join(OUT, f), text);
  console.log(`${all.length} contract pages written to docs/protocol/contracts.`);
}
