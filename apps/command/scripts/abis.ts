/**
 * Writes the deployed contracts' functions and addresses into packages/command-types, for the API to
 * build Safe transactions with: `bun scripts/abis.ts`. Read from deployments/base-sepolia, which is
 * generated output; nothing here touches the Solidity source.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../../../deployments/base-sepolia/', import.meta.url);
const out = new URL('../../../packages/command-types/src/chain/base-sepolia.json', import.meta.url);
const contracts: Record<string, { address: string; functions: unknown[]; events: unknown[] }> = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const j = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  // some deployment files keep the ABI as a JSON string
  if (typeof j.abi === 'string') j.abi = JSON.parse(j.abi);
  if (!j.address || !Array.isArray(j.abi)) continue;
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
