import { ethers } from "hardhat";
import { getDeployment } from "../deploy/helpers";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  const clearUsdAddress =
    process.env.CLRUSD_ADDRESS?.trim() ||
    getDeployment(network.name, "ClearUSD")?.address ||
    "";
  if (!clearUsdAddress) throw new Error("Missing CLRUSD deployment/address.");

  const recipient = (process.env.CLRUSD_MINT_RECIPIENT || deployer.address).trim();
  const units = (process.env.CLRUSD_MINT_AMOUNT || "1").trim();
  const amount = ethers.parseUnits(units, 6);

  const clearUsd = await ethers.getContractAt("ClearUSD", clearUsdAddress);
  const adminRole = await clearUsd.DEFAULT_ADMIN_ROLE();
  const minterRole = await clearUsd.MINTER_ROLE();

  const isAdmin = await clearUsd.hasRole(adminRole, deployer.address);
  if (!isAdmin) {
    throw new Error("Deployer is not CLRUSD DEFAULT_ADMIN_ROLE.");
  }

  if (!(await clearUsd.hasRole(minterRole, deployer.address))) {
    const grantTx = await clearUsd.grantIssuerRoles(deployer.address);
    await grantTx.wait();
    console.log("Granted deployer issuer roles:", grantTx.hash);
  }

  const before = await clearUsd.balanceOf(recipient);
  const tx = await clearUsd.mint(recipient, amount);
  await tx.wait();
  const after = await clearUsd.balanceOf(recipient);

  console.log("Network:", network.name, `(${network.chainId})`);
  console.log("CLRUSD:", clearUsdAddress);
  console.log("Recipient:", recipient);
  console.log("Amount minted (raw):", amount.toString());
  console.log("Mint tx:", tx.hash);
  console.log("Balance before:", before.toString());
  console.log("Balance after :", after.toString());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

