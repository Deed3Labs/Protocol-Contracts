// The OpenZeppelin storage report for the BondVault (Phase 2f stage 2) against every BondVault
// implementation recorded in `.openzeppelin/base-sepolia.json`: the upgrade must be append-only.
//
//   npx hardhat compile && npx hardhat run scripts/storage_report_bond_vault.ts
//
// Read-only: it touches no network and needs no key.
import hre, { artifacts } from "hardhat";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getStorageLayout, getStorageUpgradeReport, getVersion, withValidationDefaults,
} from "@openzeppelin/upgrades-core";
import { readValidations } from "@openzeppelin/hardhat-upgrades/dist/utils/validations";

async function main() {
  const root = join(__dirname, "..");
  const manifest = JSON.parse(readFileSync(join(root, ".openzeppelin/base-sepolia.json"), "utf8"));
  const validations = await readValidations(hre);
  const updated = getStorageLayout(validations, getVersion((await artifacts.readArtifact("BondVault")).bytecode));

  let failed = false;
  let seen = 0;
  for (const [key, impl] of Object.entries<any>(manifest.impls)) {
    if (!impl.layout.storage.some((s: any) => s.contract === "BondVault")) continue;
    seen++;
    const report = getStorageUpgradeReport(impl.layout, updated, withValidationDefaults({}));
    console.log(`${impl.address} (${key.slice(0, 10)}…): ${report.ok ? "compatible" : "INCOMPATIBLE"}`);
    if (!report.ok) {
      failed = true;
      console.log(report.explain());
    }
  }
  // The source before this stage (contracts/mocks/BondVaultPre2f.sol) too.
  const pre = getStorageLayout(validations, getVersion((await artifacts.readArtifact("BondVaultPre2f")).bytecode));
  const fromPre = getStorageUpgradeReport(pre, updated, withValidationDefaults({}));
  console.log(`BondVaultPre2f (the pre-stage-2 source): ${fromPre.ok ? "compatible" : "INCOMPATIBLE"}`);
  if (!fromPre.ok) {
    failed = true;
    console.log(fromPre.explain());
  }
  console.log(`${seen} Base Sepolia implementation(s) checked.`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
