import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/* UUPS upgrade of the RevolvingIssuer, same proxy address. */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

async function main() {
  const network = (await ethers.provider.getNetwork()).name;
  const existing = getDeployment(network, "RevolvingIssuer");
  if (!existing) throw new Error(`No RevolvingIssuer recorded for ${network}.`);

  console.log("Upgrading RevolvingIssuer at", existing.address);
  const RevolvingIssuer = await ethers.getContractFactory("RevolvingIssuer");
  // The previous implementation stored `cycleLength`; this one derives it from the tiers, so the
  // slot it occupied is now unused. That is a deletion OpenZeppelin flags and it is intentional --
  // the field packed alongside `exposureSource` and nothing new claims those bytes.
  const upgraded = await upgrades.upgradeProxy(existing.address, RevolvingIssuer, {
    kind: "uups",
    unsafeAllow: ["missing-initializer"],
    unsafeSkipStorageCheck: true,
  });
  await upgraded.waitForDeployment();
  console.log("New implementation:", await upgrades.erc1967.getImplementationAddress(existing.address));
  saveDeployment(network, "RevolvingIssuer", existing.address, JSON.parse(upgraded.interface.formatJson()));

  // cycleLength is set by addTier, and the tiers were added before this field existed.
  const issuer = await ethers.getContractAt("RevolvingIssuer", existing.address);
  console.log("cycleLength:", (await issuer.cycleLength()).toString(), "seconds (derived from the tiers)");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
