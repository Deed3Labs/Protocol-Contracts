import { ethers } from "hardhat";
import { getContract, getNetwork, saveDeployment } from "./utils";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Resetting proxy with account:", deployer.address);

  const network = await getNetwork();
  console.log("Network:", network);

  // Get the proxy contract
  const proxy = await getContract("TransparentUpgradeableProxy");
  console.log("Proxy address:", proxy.address);

  // Get the implementation contract
  const implementation = await getContract("DeedNFT");
  console.log("Implementation address:", implementation.address);

  // Get the proxy admin
  const proxyAdmin = await ethers.provider.getStorage(proxy.address, "0");
  console.log("Current proxy admin:", proxyAdmin);

  // Upgrade the proxy to the new implementation
  console.log("Upgrading proxy...");
  const tx = await proxy.upgradeTo(implementation.address);
  await tx.wait();
  console.log("Proxy upgraded successfully");

  // Save the new deployment
  saveDeployment(network, "TransparentUpgradeableProxy", proxy.address, proxy.interface.format());
  console.log("Deployment saved");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 