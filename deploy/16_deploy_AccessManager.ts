import { getDeployment, requireMainnetConfirmation, saveDeployment } from "./helpers";

/**
 * The AccessManager (transparent proxy), the deployer as its admin until the credit timelock
 * handover. Idempotent like deploy 20: a recorded AccessManager is reused, never overwritten.
 * Decision 47 (a fresh Base Sepolia credit stack): `deploy/retire_credit_stack.ts` moves the old
 * record aside first, so this deploys a fresh one; then deploy 18 links it to the
 * MembershipRegistry.
 *
 *   npx hardhat run deploy/16_deploy_AccessManager.ts --network base-sepolia
 */
async function main() {
  const hre = require("hardhat");
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  requireMainnetConfirmation(network.name, "deploy/16_deploy_AccessManager.ts");
  const existing = getDeployment(network.name, "AccessManager");
  if (existing) {
    console.log(`= AccessManager already at ${existing.address} (deploy/retire_credit_stack.ts retires it for a fresh credit stack)`);
    return;
  }

  console.log("Deploying AccessManager with account:", deployer.address);
  console.log("Network:", network.name, "(chainId:", network.chainId, ")");

  const AccessManager = await hre.ethers.getContractFactory("AccessManager");
  const accessManager = await hre.upgrades.deployProxy(
    AccessManager,
    [deployer.address],
    {
      initializer: "initialize",
    }
  );

  await accessManager.waitForDeployment();
  const proxyAddress = await accessManager.getAddress();
  const implementationAddress = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("AccessManager proxy deployed to:", proxyAddress);
  console.log("AccessManager implementation:", implementationAddress);

  saveDeployment(
    network.name,
    "AccessManager",
    proxyAddress,
    JSON.parse(accessManager.interface.formatJson())
  );

  console.log("Saved deployment metadata for AccessManager");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
