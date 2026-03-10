import { saveDeployment } from "./helpers";

async function main() {
  const hre = require("hardhat");
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  console.log("Deploying MembershipRegistry with account:", deployer.address);
  console.log("Network:", network.name, "(chainId:", network.chainId, ")");

  const MembershipRegistry = await hre.ethers.getContractFactory("MembershipRegistry");
  const membershipRegistry = await hre.upgrades.deployProxy(
    MembershipRegistry,
    [deployer.address],
    {
      initializer: "initialize",
    }
  );

  await membershipRegistry.waitForDeployment();
  const proxyAddress = await membershipRegistry.getAddress();
  const implementationAddress = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("MembershipRegistry proxy deployed to:", proxyAddress);
  console.log("MembershipRegistry implementation:", implementationAddress);

  saveDeployment(
    network.name,
    "MembershipRegistry",
    proxyAddress,
    JSON.parse(membershipRegistry.interface.formatJson())
  );

  console.log("Saved deployment metadata for MembershipRegistry");
  console.log("Next step: configure AccessManager with this registry using 18_configure_AccessManagerMembershipRegistry.ts");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
