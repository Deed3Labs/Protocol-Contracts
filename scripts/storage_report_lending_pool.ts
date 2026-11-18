// The OpenZeppelin storage report for the Yield Pool (LendingPool) against every LendingPool
// implementation recorded in `.openzeppelin/base-sepolia.json`: the upgrade must be append-only.
//
//   npx hardhat compile && npx hardhat run scripts/storage_report_lending_pool.ts
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
  const artifact = await artifacts.readArtifact("LendingPool");
  const updated = getStorageLayout(validations, getVersion(artifact.bytecode));

  let failed = false;
  for (const [key, impl] of Object.entries<any>(manifest.impls)) {
    // The pool's fields are LendingPool's before Phase 2f and LendingPoolBase's since.
    const isPool = impl.layout.storage.some((s: any) => s.label === "totalBorrowed" && /^LendingPool(Base)?$/.test(s.contract));
    if (!isPool) continue;
    const report = getStorageUpgradeReport(impl.layout, updated, withValidationDefaults({}));
    console.log(`${impl.address} (${key.slice(0, 10)}…): ${report.ok ? "compatible" : "INCOMPATIBLE"}`);
    if (!report.ok) {
      failed = true;
      console.log(report.explain());
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
