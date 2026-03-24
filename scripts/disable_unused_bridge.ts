import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  const bridgeAddress =
    process.env.CLRUSD_UNUSED_BRIDGE_ADDRESS?.trim() ||
    "0x0c909DdD9Ee1C8c55245238e0a13B1D2aB294B6b";

  const bridge = await ethers.getContractAt("CLRUSDBridge", bridgeAddress);

  console.log("Deployer:", deployer.address);
  console.log("Network:", network.name, `(${network.chainId})`);
  console.log("Unused bridge:", bridgeAddress);

  const paused = await bridge.paused();
  if (paused) {
    console.log("Bridge is already paused.");
    return;
  }

  const tx = await bridge.pause();
  await tx.wait();
  console.log("Paused unused bridge:", tx.hash);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

