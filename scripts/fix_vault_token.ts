import { getDeployment } from "../deploy/helpers";

/*
 * Ensures the ESADepositVault on the current network accepts the canonical USDC for that chain,
 * and (optionally) removes a wrongly-allowlisted token passed via REMOVE_TOKEN. Usage:
 *   REMOVE_TOKEN=0x... npx hardhat run scripts/fix_vault_token.ts --network base
 */
const USDC_BY_CHAIN: Record<number, string> = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base mainnet
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // Ethereum mainnet
  11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Ethereum Sepolia
};

async function main() {
  const hre = require("hardhat");
  const network = await hre.ethers.provider.getNetwork();
  const vaultAddr = getDeployment(network.name, "ESADepositVault")?.address;
  if (!vaultAddr) throw new Error(`No ESADepositVault deployment on ${network.name}`);

  const vault = await hre.ethers.getContractAt("ESADepositVault", vaultAddr);
  console.log("Vault:", vaultAddr, "on", network.name, `(${network.chainId})`);

  const correct = USDC_BY_CHAIN[Number(network.chainId)];
  if (correct) {
    if (await vault.isAcceptedToken(correct)) {
      console.log("✓ correct USDC already allowlisted:", correct);
    } else {
      await (await vault.setAcceptedToken(correct, true)).wait();
      console.log("✓ allowlisted correct USDC:", correct);
    }
  } else {
    console.warn("Unknown chain — no canonical USDC configured.");
  }

  const remove = process.env.REMOVE_TOKEN?.trim();
  if (remove && hre.ethers.isAddress(remove) && remove.toLowerCase() !== (correct || "").toLowerCase()) {
    if (await vault.isAcceptedToken(remove)) {
      await (await vault.setAcceptedToken(remove, false)).wait();
      console.log("✓ removed wrong token:", remove);
    } else {
      console.log("token to remove was not allowlisted:", remove);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
