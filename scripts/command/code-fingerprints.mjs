// What each deployed contract's code is on this branch, for Command's Build page to compare with the
// chain: `npx hardhat compile && node scripts/command/code-fingerprints.mjs` (`--check` fails instead
// of writing when the file is stale, as CI runs it).
//
// A fingerprint is the sha256 of the runtime bytecode with what differs between two deployments of the
// same source masked: the immutables (OpenZeppelin's UUPS keeps its own address in one) zeroed, and the
// trailing CBOR metadata (a hash of the sources, comments included) cut off. The API masks the code it
// reads from the chain the same way, so a match means the chain runs exactly what this branch compiles.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const DEPLOYED = join(ROOT, 'deployments/base-sepolia');
const ARTIFACTS = join(ROOT, 'artifacts/contracts');
const OUT = join(ROOT, 'packages/command-types/src/chain/code.json');

/** Every compiled artifact by contract name, a name compiled twice kept out (it can't be told apart). */
function artifacts(dir, found = new Map()) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) artifacts(p, found);
    else if (e.name.endsWith('.json') && !e.name.endsWith('.dbg.json')) {
      const name = e.name.slice(0, -'.json'.length);
      found.set(name, found.has(name) ? null : p);
    }
  }
  return found;
}

export function fingerprint(hex, immutables) {
  let b = Buffer.from(String(hex).replace(/^0x/, ''), 'hex');
  for (const [start, length] of immutables) b.fill(0, start, start + length);
  if (b.length >= 2) {
    const meta = b.readUInt16BE(b.length - 2);
    if (meta + 2 <= b.length) b = b.subarray(0, b.length - 2 - meta);
  }
  return createHash('sha256').update(b).digest('hex');
}

if (!existsSync(ARTIFACTS)) {
  console.error('No artifacts: run `npx hardhat compile` first');
  process.exit(1);
}
const byName = artifacts(ARTIFACTS);
const contracts = {};
for (const f of readdirSync(DEPLOYED)
  .filter((f) => f.endsWith('.json'))
  .sort()) {
  const name = f.slice(0, -'.json'.length);
  const path = byName.get(name);
  if (!path) continue;
  const art = JSON.parse(readFileSync(path, 'utf8'));
  if (!art.deployedBytecode || art.deployedBytecode === '0x') continue;
  const dbg = JSON.parse(readFileSync(path.replace(/\.json$/, '.dbg.json'), 'utf8'));
  const info = JSON.parse(readFileSync(join(dirname(path), dbg.buildInfo), 'utf8'));
  const refs = info.output.contracts[art.sourceName][art.contractName].evm.deployedBytecode.immutableReferences ?? {};
  const immutables = Object.values(refs)
    .flat()
    .map((r) => [r.start, r.length])
    .sort((a, b) => a[0] - b[0]);
  contracts[name] = { source: art.sourceName, sha256: fingerprint(art.deployedBytecode, immutables), immutables };
}
const text = JSON.stringify({ chainId: 84532, contracts }, null, 1) + '\n';
if (process.argv.includes('--check')) {
  if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== text) {
    console.error('packages/command-types/src/chain/code.json is stale: run `npx hardhat compile && node scripts/command/code-fingerprints.mjs` and commit it');
    process.exit(1);
  }
  console.log(`code.json is current (${Object.keys(contracts).length} contracts)`);
} else {
  writeFileSync(OUT, text);
  console.log(`${Object.keys(contracts).length} contracts written`);
}
