import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/*
 * UUPS upgrade of the AssuranceOracle, same proxy address.
 *
 *   BASE_SEPOLIA_RPC_URL=<rpc> npx hardhat run scripts/upgrade_assurance_oracle.ts --network base-sepolia
 */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

async function main() {
  const network = (await ethers.provider.getNetwork()).name;
  const existing = getDeployment(network, "AssuranceOracle");
  if (!existing) throw new Error(`No AssuranceOracle recorded for ${network}.`);

  console.log("Upgrading AssuranceOracle at", existing.address);
  const AssuranceOracle = await ethers.getContractFactory("AssuranceOracle");
  const upgraded = await upgrades.upgradeProxy(existing.address, AssuranceOracle, { kind: "uups" });
  await upgraded.waitForDeployment();

  const implementation = await upgrades.erc1967.getImplementationAddress(existing.address);
  console.log("New implementation:", implementation);

  saveDeployment(network, "AssuranceOracle", existing.address, JSON.parse(upgraded.interface.formatJson()));
  console.log("Deployment record refreshed.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
