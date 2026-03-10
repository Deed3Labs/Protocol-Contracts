import { getDeployment } from "./helpers";

async function main() {
  const hre = require("hardhat");
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  const accessManagerAddress =
    process.env.ACCESS_MANAGER_ADDRESS?.trim() ||
    getDeployment(network.name, "AccessManager")?.address;
  const membershipRegistryAddress =
    process.env.MEMBERSHIP_REGISTRY_ADDRESS?.trim() ||
    getDeployment(network.name, "MembershipRegistry")?.address;

  if (!accessManagerAddress || !membershipRegistryAddress) {
    throw new Error(
      "Missing AccessManager or MembershipRegistry address. Set ACCESS_MANAGER_ADDRESS and MEMBERSHIP_REGISTRY_ADDRESS or deploy/save both first."
    );
  }

  console.log("Configuring AccessManager membership registry");
  console.log("Deployer:", deployer.address);
  console.log("Network:", network.name, "(chainId:", network.chainId, ")");
  console.log("AccessManager:", accessManagerAddress);
  console.log("MembershipRegistry:", membershipRegistryAddress);

  const accessManager = await hre.ethers.getContractAt("AccessManager", accessManagerAddress);
  const currentRegistry = await accessManager.membershipRegistry();

  if (currentRegistry.toLowerCase() === membershipRegistryAddress.toLowerCase()) {
    console.log("AccessManager is already configured with this MembershipRegistry");
    return;
  }

  const tx = await accessManager.setMembershipRegistry(membershipRegistryAddress);
  await tx.wait();

  const resolvedRegistry = await accessManager.membershipRegistry();
  console.log("Membership registry set on AccessManager:", resolvedRegistry);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
