import { getDeployment } from "../../deploy/helpers";

async function main() {
  const hre = require("hardhat");
  const [signer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  const clearUsdAddress =
    getDeployment(network.name, "ClearUSD")?.address ||
    process.env.CLRUSD_ADDRESS?.trim();
  const vaultAddress =
    getDeployment(network.name, "ESADepositVault")?.address ||
    process.env.ESA_VAULT_ADDRESS?.trim();
  const depositToken = process.env.ESA_VAULT_DEPOSIT_TOKEN?.trim();

  if (!clearUsdAddress) throw new Error("Missing CLRUSD address.");
  if (!vaultAddress) throw new Error("Missing ESA vault address.");

  console.log("Signer:", signer.address);
  console.log("Network:", network.name, `(${network.chainId})`);
  console.log("CLRUSD:", clearUsdAddress);
  console.log("ESA vault:", vaultAddress);
  if (depositToken) console.log("Deposit token:", depositToken);

  const clearUsd = await hre.ethers.getContractAt("ClearUSD", clearUsdAddress);
  const vault = await hre.ethers.getContractAt("ESADepositVault", vaultAddress);

  const minterRole = await clearUsd.MINTER_ROLE();
  const burnerRole = await clearUsd.BURNER_ROLE();

  const hasMinter = await clearUsd.hasRole(minterRole, vaultAddress);
  const hasBurner = await clearUsd.hasRole(burnerRole, vaultAddress);

  console.log("Vault has MINTER_ROLE:", hasMinter);
  console.log("Vault has BURNER_ROLE:", hasBurner);

  if (!hasMinter) {
    console.log("Granting MINTER_ROLE to vault...");
    await (await clearUsd.grantRole(minterRole, vaultAddress)).wait();
  }

  if (!hasBurner) {
    console.log("Granting BURNER_ROLE to vault...");
    await (await clearUsd.grantRole(burnerRole, vaultAddress)).wait();
  }

  if (depositToken) {
    const accepted = await vault.isAcceptedToken(depositToken);
    console.log("Vault accepts deposit token:", accepted);
    if (!accepted) {
      console.log("Allowlisting deposit token...");
      await (await vault.setAcceptedToken(depositToken, true)).wait();
    }
  }

  console.log("Repair complete.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
