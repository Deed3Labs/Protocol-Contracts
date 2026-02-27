import { getDeployment } from "../../deploy/helpers";

async function main() {
  const hre = require("hardhat");
  const network = await hre.ethers.provider.getNetwork();

  const clearUsdAddress =
    getDeployment(network.name, "ClearUSD")?.address ||
    process.env.CLRUSD_ADDRESS?.trim();
  const vaultAddress =
    getDeployment(network.name, "ESADepositVault")?.address ||
    process.env.ESA_VAULT_ADDRESS?.trim();
  const tokenAddress = process.env.ESA_VAULT_DEPOSIT_TOKEN?.trim() || "";
  const poolAddress = process.env.CLRUSD_TOKEN_POOL_ADDRESS?.trim() || "";
  const registryAddress =
    process.env.TOKEN_REGISTRY_ADDRESS?.trim() ||
    getDeployment(network.name, "TokenRegistry")?.address;

  if (!clearUsdAddress) throw new Error("ClearUSD deployment not found.");
  if (!vaultAddress) throw new Error("ESADepositVault deployment not found.");

  console.log("Network:", network.name, `(${network.chainId})`);
  console.log("CLRUSD:", clearUsdAddress);
  console.log("ESA Vault:", vaultAddress);

  const clearUsd = await hre.ethers.getContractAt("ClearUSD", clearUsdAddress);
  const vault = await hre.ethers.getContractAt("ESADepositVault", vaultAddress);

  const minterRole = await clearUsd.MINTER_ROLE();
  const burnerRole = await clearUsd.BURNER_ROLE();

  console.log(
    "Vault has MINTER_ROLE:",
    await clearUsd.hasRole(minterRole, vaultAddress)
  );
  console.log(
    "Vault has BURNER_ROLE:",
    await clearUsd.hasRole(burnerRole, vaultAddress)
  );

  if (poolAddress) {
    console.log(
      "Token pool has MINTER_ROLE:",
      await clearUsd.hasRole(minterRole, poolAddress)
    );
    console.log(
      "Token pool has BURNER_ROLE:",
      await clearUsd.hasRole(burnerRole, poolAddress)
    );
  }

  if (tokenAddress) {
    console.log(
      `Vault accepts ${tokenAddress}:`,
      await vault.isAcceptedToken(tokenAddress)
    );
  }

  if (registryAddress) {
    const registry = await hre.ethers.getContractAt("TokenRegistry", registryAddress);
    const info = await registry.getTokenInfo(clearUsdAddress);
    console.log("Registry whitelisted:", info.whitelisted);
    console.log("Registry stablecoin:", info.stablecoin);
    console.log("Registry symbol:", info.symbol);
    console.log("Registry name:", info.name);
    console.log("Registry decimals:", info.decimals);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
