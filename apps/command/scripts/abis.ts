/**
 * Writes the deployed contracts' functions and addresses into packages/command-types, for the API to
 * build Safe transactions with: `bun scripts/abis.ts`. Read from deployments/base-sepolia, which is
 * generated output; nothing here touches the Solidity source.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../../../deployments/base-sepolia/', import.meta.url);
const out = new URL('../../../packages/command-types/src/chain/base-sepolia.json', import.meta.url);
const contracts: Record<string, { address: string; functions: unknown[]; events: unknown[] }> = {};

/*
 * DeedNFT v5 serves its trust functions (`IDeedTrust`) from its fallback. Its deployment record is
 * saved with that ABI merged in; an older record is merged here from the compiled interface, so the
 * indexer and Safe builders see the trust functions and events on the DeedNFT address.
 */
type AbiEntry = { type: string; name?: string; inputs?: { type: string }[] };
const trustArtifact = new URL('../../../artifacts/contracts/core/interfaces/IDeedTrust.sol/IDeedTrust.json', import.meta.url);
const abiKey = (e: AbiEntry) => `${e.type}:${e.name ?? ''}(${(e.inputs ?? []).map((i) => i.type).join(',')})`;
function withDeedTrust(name: string, abi: AbiEntry[]): AbiEntry[] {
  if (name !== 'DeedNFT' || !existsSync(trustArtifact)) return abi;
  const seen = new Set(abi.map(abiKey));
  const trust = JSON.parse(readFileSync(trustArtifact, 'utf8')).abi as AbiEntry[];
  return [...abi, ...trust.filter((e) => !seen.has(abiKey(e)))];
}
/*
 * The joined ABIs (DEPLOY-RUNBOOK 4.2). A contract that serves part of its interface from modules
 * through its fallback is called at its own address with the module's functions: RevolvingIssuer's
 * `RevolvingIssuerWorkouts` (line closing, `cardAuthorizationOf`, `cflPrincipalOf`, `missedInRowOf`)
 * and its other modules, TermIssuer's, the Liquidator's enforcement module, the Yield Pool's ledger and
 * valuation modules and the bond collection's issue and pledge modules. A record saved without them
 * gets them here from the compiled modules, so Command's reads and Safe builders find them. A
 * module's own `extensionKind` is left out: it describes the module, not the contract.
 */
const MODULES: Record<string, string[]> = {
  RevolvingIssuer: ['RevolvingIssuerExtension', 'RevolvingIssuerCycles', 'RevolvingIssuerTerms', 'RevolvingIssuerWorkouts'],
  TermIssuer: ['TermIssuerExtension', 'TermIssuerOrigination'],
  Liquidator: ['LiquidatorEnforcement'],
  LendingPool: ['YieldPoolLedger', 'YieldPoolValuation'],
  BurnerBond: ['BurnerBondIssue', 'BurnerBondPledges'],
};
const moduleArtifact = (name: string) => new URL(`../../../artifacts/contracts/peripherals/${name}.sol/${name}.json`, import.meta.url);
function withModules(name: string, abi: AbiEntry[]): AbiEntry[] {
  const modules = MODULES[name];
  if (!modules) return abi;
  const seen = new Set(abi.map(abiKey));
  const out = [...abi];
  for (const m of modules) {
    if (!existsSync(moduleArtifact(m))) throw new Error(`${m} is not compiled: run \`npx hardhat compile\` first`);
    for (const e of JSON.parse(readFileSync(moduleArtifact(m), 'utf8')).abi as AbiEntry[]) {
      if (e.type !== 'function' && e.type !== 'event') continue;
      if (e.name === 'extensionKind' || seen.has(abiKey(e))) continue;
      seen.add(abiKey(e));
      out.push(e);
    }
  }
  return out;
}

for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const j = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  // some deployment files keep the ABI as a JSON string
  if (typeof j.abi === 'string') j.abi = JSON.parse(j.abi);
  if (!j.address || !Array.isArray(j.abi)) continue;
  j.abi = withModules(f.replace(/\.json$/, ''), withDeedTrust(f.replace(/\.json$/, ''), j.abi));
  contracts[f.replace(/\.json$/, '')] = {
    address: j.address,
    // functions only: what a Safe transaction can call and what a builder reads first
    functions: j.abi.filter((x: { type: string }) => x.type === 'function').map(({ name, inputs, outputs, stateMutability, type }: Record<string, unknown>) => ({ type, name, inputs, outputs, stateMutability })),
    // and events: what the indexer decodes (Phase 5)
    events: j.abi.filter((x: { type: string }) => x.type === 'event').map(({ name, inputs, anonymous, type }: Record<string, unknown>) => ({ type, name, inputs, anonymous })),
  };
}
writeFileSync(out, JSON.stringify({ chainId: 84532, contracts }) + '\n');
console.log(`${Object.keys(contracts).length} contracts written`);
