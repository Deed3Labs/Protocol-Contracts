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
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const j = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  // some deployment files keep the ABI as a JSON string
  if (typeof j.abi === 'string') j.abi = JSON.parse(j.abi);
  if (!j.address || !Array.isArray(j.abi)) continue;
  j.abi = withDeedTrust(f.replace(/\.json$/, ''), j.abi);
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
