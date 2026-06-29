import hre from "hardhat";

/*
 * UUPS upgrade of the ESADepositVault (same proxy address) to the version with the autopay
 * recurring-deposit mandate (executeMandateDeposit / cancelMandate). Run testnet first:
 *   npx hardhat run scripts/upgrade_vault.ts --network base-sepolia
 *   npx hardhat run scripts/upgrade_vault.ts --network base
 */
const { ethers, upgrades, network } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

const PROXY: Record<string, string> = {
  "base-sepolia": "0x7bA87Eb0DC8ADF4a6CbE9f90d05A782De0F740cD",
  base: "0x0CfE6aFB053474cE4Ff744a1fe864C82c173a1C1",
};

async function main() {
  const proxy = PROXY[network.name];
  if (!proxy) throw new Error(`No vault proxy configured for network ${network.name}`);
  const Vault = await ethers.getContractFactory("ESADepositVault");
  console.log(`Upgrading ESADepositVault proxy ${proxy} on ${network.name}…`);
  const v = await upgrades.upgradeProxy(proxy, Vault, { redeployImplementation: "onchange" });
  await v.waitForDeployment();
  const impl = await upgrades.erc1967.getImplementationAddress(proxy);
  console.log(`✅ Upgraded. Proxy ${await v.getAddress()} → impl ${impl}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
