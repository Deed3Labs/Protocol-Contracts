import { getDeployment } from "../deploy/helpers";

/*
 * Grants the relayer the on-chain roles it needs for gasless submission:
 *   - ESADepositVault.OPERATOR_ROLE (depositWithAuthorization / redeemWithAuthorization)
 *   - ClaimEscrow.SETTLER_ROLE     (createTransferWithAuthorization / claim releases)
 * Reads the deployed proxy addresses for the current network. Usage:
 *   RELAYER_ADDRESS=0x... npx hardhat run scripts/grant_relayer_roles.ts --network base-sepolia
 */
async function main() {
  const hre = require("hardhat");
  const [signer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  const relayer = process.env.RELAYER_ADDRESS?.trim();
  if (!relayer || !hre.ethers.isAddress(relayer)) {
    throw new Error("Set RELAYER_ADDRESS to the relayer wallet address.");
  }

  console.log("Signer:", signer.address);
  console.log("Network:", network.name, `(${network.chainId})`);
  console.log("Relayer:", relayer);

  const vaultAddr = getDeployment(network.name, "ESADepositVault")?.address;
  if (vaultAddr) {
    const vault = await hre.ethers.getContractAt("ESADepositVault", vaultAddr);
    const role = await vault.OPERATOR_ROLE();
    if (await vault.hasRole(role, relayer)) {
      console.log("✓ relayer already has OPERATOR_ROLE on vault", vaultAddr);
    } else {
      await (await vault.grantRole(role, relayer)).wait();
      console.log("✓ granted OPERATOR_ROLE on vault", vaultAddr);
    }
  } else {
    console.warn("No ESADepositVault deployment on this network — skipped.");
  }

  const escrowAddr = getDeployment(network.name, "ClaimEscrow")?.address;
  if (escrowAddr) {
    const escrow = await hre.ethers.getContractAt("ClaimEscrow", escrowAddr);
    const role = await escrow.SETTLER_ROLE();
    if (await escrow.hasRole(role, relayer)) {
      console.log("✓ relayer already has SETTLER_ROLE on escrow", escrowAddr);
    } else {
      await (await escrow.grantRole(role, relayer)).wait();
      console.log("✓ granted SETTLER_ROLE on escrow", escrowAddr);
    }
  } else {
    console.warn("No ClaimEscrow deployment on this network — skipped.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
