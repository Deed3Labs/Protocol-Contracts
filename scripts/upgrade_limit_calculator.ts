import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/* UUPS upgrade of the LimitCalculator, same proxy address. */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

async function main() {
  const network = (await ethers.provider.getNetwork()).name;
  const existing = getDeployment(network, "LimitCalculator");
  if (!existing) throw new Error(`No LimitCalculator recorded for ${network}.`);

  console.log("Upgrading LimitCalculator at", existing.address);
  const LimitCalculator = await ethers.getContractFactory("LimitCalculator");
  const upgraded = await upgrades.upgradeProxy(existing.address, LimitCalculator, { kind: "uups" });
  await upgraded.waitForDeployment();
  console.log("New implementation:", await upgrades.erc1967.getImplementationAddress(existing.address));
  saveDeployment(network, "LimitCalculator", existing.address, JSON.parse(upgraded.interface.formatJson()));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
