/**
 * Merges the `IDeedTrust` ABI into the member app's DeedNFT ABIs (apps/member/src/contracts/<chain>/DeedNFT.json).
 *
 * DeedNFT v5 serves its trust functions (mintTrustDeed, trustRecordOf, beneficialOwnerOf, protectorOf,
 * statusOf, postNotice, ...) from its fallback, so the app needs that ABI on the DeedNFT address. The
 * deploy scripts save DeedNFT's ABI merged with it (deploy/03, deploy_all); this brings the app's copies
 * in line. Entries already present (same type, name and input types) are kept.
 *
 *   npx hardhat compile && npx ts-node scripts/merge-deed-trust-abi.ts   (or bun)
 *
 * Reads only the compiled interface and the app's JSON; touches no network and no key.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type AbiEntry = { type: string; name?: string; inputs?: { type: string }[] };

const root = join(__dirname, "..");
const artifact = join(root, "artifacts/contracts/core/interfaces/IDeedTrust.sol/IDeedTrust.json");
const appContracts = join(root, "apps/member/src/contracts");

const abiKey = (e: AbiEntry) => `${e.type}:${e.name ?? ""}(${(e.inputs ?? []).map(i => i.type).join(",")})`;

if (!existsSync(artifact)) throw new Error("Compile first: npx hardhat compile (IDeedTrust artifact missing)");
const trust = JSON.parse(readFileSync(artifact, "utf8")).abi as AbiEntry[];

for (const chain of readdirSync(appContracts)) {
  const file = join(appContracts, chain, "DeedNFT.json");
  if (!existsSync(file)) continue;
  const json = JSON.parse(readFileSync(file, "utf8"));
  const asString = typeof json.abi === "string";
  const abi = (asString ? JSON.parse(json.abi) : json.abi) as AbiEntry[];
  const seen = new Set(abi.map(abiKey));
  const added = trust.filter(e => !seen.has(abiKey(e)));
  if (!added.length) {
    console.log(`${chain}: already has IDeedTrust`);
    continue;
  }
  const merged = [...abi, ...added];
  json.abi = asString ? JSON.stringify(merged) : merged;
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  console.log(`${chain}: added ${added.length} IDeedTrust entries`);
}
