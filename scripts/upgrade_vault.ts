import { requireMainnetConfirmation } from "../deploy/helpers";
import { KNOWN_USDC, upgradeCall, vaultProxyFor } from "./vaultUpgrade";

/*
 * The ESADepositVault's new implementation. THIS SCRIPT NEVER UPGRADES THE PROXY.
 *
 * It used to `upgradeProxy` the vault on its own, without `setAcceptedToken`, which the contract's
 * note says stops every deposit and redemption (the accepted token lives in a slot the upgrade
 * adds, which starts at zero), and it pointed Base Sepolia at the legacy vault. The upgrade is now
 * one call only, `upgradeToAndCall(impl, setAcceptedToken(USDC, true))`, and only
 * `scripts/migrate_vault_clrusd.ts` builds it, as a batch for whoever holds the vault's admin (the
 * Clear Financial Co. Safe, through the vault timelock after the handover). A single path to the
 * live vault's upgrade is the safer one.
 *
 * What this does: validates the implementation against the network's manifest and, with
 * PREPARE_VAULT_IMPL=1, deploys it with `upgrades.prepareUpgrade` (a new contract; the proxy is not
 * touched). It then prints the call and the command that builds the batch.
 *
 *   npx hardhat run scripts/upgrade_vault.ts --network base-sepolia                          # validate
 *   PREPARE_VAULT_IMPL=1 npx hardhat run scripts/upgrade_vault.ts --network base-sepolia     # deploy the implementation
 *   (on Base, CONFIRM_MAINNET=1 as well)
 */
async function main() {
  const { ethers, upgrades, network } = require("hardhat");
  requireMainnetConfirmation(network.name, "scripts/upgrade_vault.ts");
  const proxy = vaultProxyFor(network.name);
  const Vault = await ethers.getContractFactory("ESADepositVault");
  await upgrades.validateUpgrade(proxy, Vault, { kind: "uups" });
  console.log(`ESADepositVault ${proxy} on ${network.name}: the new implementation validates against the manifest.`);
  if (process.env.PREPARE_VAULT_IMPL !== "1") {
    console.log("\nNothing deployed. PREPARE_VAULT_IMPL=1 deploys the implementation; the proxy is never upgraded here.");
    return;
  }
  const impl = (await upgrades.prepareUpgrade(proxy, Vault, { kind: "uups" })) as string;
  const usdc = process.env.USDC?.trim() || KNOWN_USDC[network.name] || "<USDC>";
  console.log(`\nImplementation ${impl}. The proxy was not upgraded.`);
  console.log(`The upgrade is one call to ${proxy}: ${upgradeCall(Vault.interface, impl, usdc)}`);
  console.log(`Build the batch for the vault's admin (it checks who that is):\n` +
    `  VAULT_IMPL=${impl} RELAYER=0x… CLEAR_FINANCIAL_SAFE=0x… npx hardhat run scripts/migrate_vault_clrusd.ts --network ${network.name}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
