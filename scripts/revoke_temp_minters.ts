import { ethers } from "hardhat";
import { getDeployment } from "../deploy/helpers";

function parseAddresses(raw: string | undefined): string[] {
  const fallback =
    "0x095EE2463C54C0076a65FB86b5Bea5E6115fe862,0xf9611e582B311b3758Df5c46F22Bcc9F704F20D5";
  const source = (raw?.trim() || fallback).split(",");
  const unique: string[] = [];
  for (const value of source) {
    const addr = value.trim();
    if (!addr) continue;
    if (!unique.some((x) => x.toLowerCase() === addr.toLowerCase())) {
      unique.push(addr);
    }
  }
  return unique;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  const deedAddress =
    process.env.DEEDNFT_ADDRESS?.trim() ||
    getDeployment(network.name, "DeedNFT")?.address ||
    "";
  if (!deedAddress) throw new Error("Missing DeedNFT deployment/address.");

  const targets = parseAddresses(process.env.TEMP_MINTER_WALLETS);
  if (targets.length === 0) {
    console.log("No target wallets provided; nothing to revoke.");
    return;
  }

  const deed = await ethers.getContractAt("DeedNFT", deedAddress);
  const minterRole = await deed.MINTER_ROLE();

  console.log("Deployer:", deployer.address);
  console.log("Network:", network.name, `(${network.chainId})`);
  console.log("DeedNFT:", deedAddress);
  console.log("Target wallets:", targets);

  for (const wallet of targets) {
    const hasRole = await deed.hasRole(minterRole, wallet);
    if (!hasRole) {
      console.log(`Skip ${wallet} (no MINTER_ROLE)`);
      continue;
    }
    const tx = await deed.revokeRole(minterRole, wallet);
    await tx.wait();
    console.log(`Revoked MINTER_ROLE from ${wallet}: ${tx.hash}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

