import { getDeployment, saveDeployment } from "./helpers";

const DEFAULT_USDC_BY_CHAIN: Record<number, string> = {
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia
  11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Sepolia
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // Ethereum
};

async function main() {
  const hre = require("hardhat");
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  const admin = process.env.CLRUSD_ADMIN?.trim() || deployer.address;
  const deployedClearUsd = getDeployment(network.name, "ClearUSD")?.address;
  const clearUsdAddress = deployedClearUsd || process.env.CLRUSD_ADDRESS?.trim();

  if (!clearUsdAddress) {
    throw new Error(
      "Missing CLRUSD address. Set CLRUSD_ADDRESS or deploy ClearUSD first."
    );
  }

  console.log("Deployer:", deployer.address);
  console.log("Network:", network.name, `(${network.chainId})`);
  console.log("CLRUSD:", clearUsdAddress);
  console.log("Vault admin:", admin);

  const ESADepositVault = await hre.ethers.getContractFactory("ESADepositVault");
  const vault = await ESADepositVault.deploy(clearUsdAddress, admin);
  await vault.waitForDeployment();

  const vaultAddress = await vault.getAddress();
  console.log("ESADepositVault deployed at:", vaultAddress);

  const clearUsd = await hre.ethers.getContractAt("ClearUSD", clearUsdAddress);
  const minterRole = await clearUsd.MINTER_ROLE();
  const burnerRole = await clearUsd.BURNER_ROLE();

  if (!(await clearUsd.hasRole(minterRole, vaultAddress))) {
    console.log("Granting MINTER_ROLE to vault...");
    await (await clearUsd.grantRole(minterRole, vaultAddress)).wait();
  }
  if (!(await clearUsd.hasRole(burnerRole, vaultAddress))) {
    console.log("Granting BURNER_ROLE to vault...");
    await (await clearUsd.grantRole(burnerRole, vaultAddress)).wait();
  }

  const configuredDepositToken =
    process.env.ESA_VAULT_DEPOSIT_TOKEN?.trim() ||
    DEFAULT_USDC_BY_CHAIN[Number(network.chainId)] ||
    "";
  if (configuredDepositToken) {
    console.log("Allowlisting deposit token:", configuredDepositToken);
    await (await vault.setAcceptedToken(configuredDepositToken, true)).wait();
  } else {
    console.warn("No default deposit token known for this chain. Skipping allowlist.");
  }

  saveDeployment(
    network.name,
    "ESADepositVault",
    vaultAddress,
    JSON.parse(vault.interface.formatJson())
  );
  console.log(
    "Saved deployment: deployments/" + network.name + "/ESADepositVault.json"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
