// The OpenZeppelin storage report for any upgradeable contract against every implementation of it
// recorded in an OpenZeppelin network manifest: an upgrade must be append-only. The pool and the
// BondVault have their own scripts (`storage_report_lending_pool.ts`, `storage_report_bond_vault.ts`);
// this one covers the rest, by name.
//
//   npx hardhat compile && STORAGE_CONTRACTS=Liquidator,CollateralRegistry npx hardhat run scripts/storage_report.ts
//   STORAGE_MANIFEST=base STORAGE_CONTRACTS=ESADepositVault,ClaimEscrow npx hardhat run scripts/storage_report.ts
//
// An implementation is matched by the contract name its recorded layout declares fields under (a
// split contract such as the Liquidator is matched by its old name; its fields now live in a base).
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
  const network = process.env.STORAGE_MANIFEST ?? "base-sepolia";
  const names = (process.env.STORAGE_CONTRACTS ?? "Liquidator,CollateralRegistry").split(",").map((s) => s.trim()).filter(Boolean);
  const manifest = JSON.parse(readFileSync(join(root, `.openzeppelin/${network}.json`), "utf8"));
  const validations = await readValidations(hre);

  let failed = false;
  for (const name of names) {
    const artifact = await artifacts.readArtifact(name);
    const updated = getStorageLayout(validations, getVersion(artifact.bytecode));
    let seen = 0;
    for (const [key, impl] of Object.entries<any>(manifest.impls)) {
      if (!impl.layout.storage.some((s: any) => s.contract === name)) continue;
      seen++;
      const report = getStorageUpgradeReport(impl.layout, updated, withValidationDefaults({}));
      console.log(`${name} ${impl.address} (${key.slice(0, 10)}…): ${report.ok ? "compatible" : "INCOMPATIBLE"}`);
      if (!report.ok) {
        failed = true;
        console.log(report.explain());
      }
    }
    if (seen === 0) console.log(`${name}: no implementation recorded in .openzeppelin/${network}.json`);
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
