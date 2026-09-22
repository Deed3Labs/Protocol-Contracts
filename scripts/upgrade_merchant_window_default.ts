import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/*
 * UUPS upgrade of MerchantRegistry, same proxy, so a blank payout window means the default.
 *
 * `payoutWindowOf` fell back to `defaultPayoutWindow` only for addresses that were NOT registered.
 * A registered merchant whose window was left at zero was therefore owed on the spot: both
 * merchants on Base Sepolia are in that state, and `PayoutPool.drawForDueClaim` would have
 * borrowed against the yield pool the moment either of them redeemed.
 *
 * Nothing but a view changes, and no storage moves, so this heals the rows already written
 * instead of needing `updateTerms` run over every merchant.
 *
 *   npx hardhat run scripts/upgrade_merchant_window_default.ts --network base-sepolia
 *
 * Add WINDOW_UPGRADE_DRY_RUN=1 to validate and report without sending. Run by the registry's
 * DEFAULT_ADMIN_ROLE.
 */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

const DRY_RUN = process.env.WINDOW_UPGRADE_DRY_RUN === "1";
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function main() {
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;
  const [signer] = await ethers.getSigners();

  const record = getDeployment(network, "MerchantRegistry");
  if (!record) throw new Error(`No MerchantRegistry recorded for ${network}.`);

  const registry = await ethers.getContractAt("MerchantRegistry", record.address);
  console.log(`network           ${network} (${net.chainId})`);
  console.log(`signer            ${signer.address}`);
  console.log(`MerchantRegistry  ${record.address}`);
  console.log(`default window    ${await registry.defaultPayoutWindow()} seconds`);

  const admin: boolean = await registry.hasRole(ethers.ZeroHash, signer.address);
  console.log(`admin on registry ${admin}`);

  const MerchantRegistry = await ethers.getContractFactory("MerchantRegistry");
  await upgrades.validateUpgrade(record.address, MerchantRegistry, { kind: "uups" });
  console.log("validates as upgrade-safe against what is deployed");

  // Who this actually changes, named before anything is sent.
  const count = Number(await registry.merchantCount());
  console.log("\nmerchants and the window they are owed on:");
  const merchants: string[] = [];
  for (let i = 0; i < count; i++) {
    const who: string = await registry.merchantAt(i);
    merchants.push(who);
    const terms = await registry.termsOf(who);
    const effective = await registry.payoutWindowOf(who);
    console.log(
      `  ${who}  agreed ${terms.payoutWindow}s, owed on ${effective}s` +
        (terms.payoutWindow === 0n ? "  -> becomes the default" : ""),
    );
  }

  if (!admin) throw new Error(`${signer.address} does not hold DEFAULT_ADMIN_ROLE on the registry.`);
  if (DRY_RUN) {
    console.log("\nWINDOW_UPGRADE_DRY_RUN=1: validated, nothing sent.");
    return;
  }

  const was = await implementationOf(record.address);
  console.log("\nupgrading…");
  const upgraded = await upgrades.upgradeProxy(record.address, MerchantRegistry, { kind: "uups" });
  await upgraded.waitForDeployment();
  saveDeployment(network, "MerchantRegistry", record.address, JSON.parse(upgraded.interface.formatJson()));

  // The node can still serve the pre-upgrade state for a moment, and a stale read reported as a
  // failure is the kind that gets believed. Wait for the slot to move, then check the behaviour.
  let implementation = was;
  for (let i = 0; i < 20 && implementation === was; i++) {
    implementation = await implementationOf(record.address);
    if (implementation === was) await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`implementation    ${implementation}${implementation === was ? "  (unchanged)" : ""}`);

  const fallback = await registry.defaultPayoutWindow();
  for (const who of merchants) {
    const effective = await registry.payoutWindowOf(who);
    console.log(`  ${who} owed on ${effective}s`);
    const terms = await registry.termsOf(who);
    if (terms.payoutWindow === 0n && effective !== fallback) {
      throw new Error(`${who} still has no window after the upgrade.`);
    }
  }
}

async function implementationOf(proxy: string): Promise<string> {
  const raw = await ethers.provider.getStorage(proxy, IMPL_SLOT);
  return ethers.getAddress("0x" + raw.slice(26));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
