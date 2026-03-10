import { saveDeployment } from "./helpers";

async function main() {
  const hre = require("hardhat");
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

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
