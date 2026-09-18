import hre from "hardhat";
import { getDeployment } from "../deploy/helpers";

/*
 * Let the card-funding wallet borrow from the LendingPool, so credit on pool-funded tiers is funded
 * by the pool on chain. Idempotent: does nothing if the role is already held.
 *
 *   CARD_SETTLER_ADDRESS=0x... npx hardhat run scripts/grant_pool_borrower.ts --network base-sepolia
 */
const { ethers } = hre;

async function main() {
  const network = (await ethers.provider.getNetwork()).name;
  const pool = getDeployment(network, "LendingPool");
  if (!pool) throw new Error(`No LendingPool recorded for ${network}.`);
  const borrower = (process.env.CARD_SETTLER_ADDRESS || "").trim();
  if (!ethers.isAddress(borrower)) throw new Error("Set CARD_SETTLER_ADDRESS.");

  const lending = await ethers.getContractAt("LendingPool", pool.address);
  const role = await lending.BORROWER_ROLE();
  if (await lending.hasRole(role, borrower)) {
    console.log("Already a borrower:", borrower);
  } else {
    const tx = await lending.grantRole(role, borrower);
    await tx.wait();
    console.log("Granted BORROWER_ROLE to", borrower, tx.hash);
  }
  console.log("Pool cash available to lend:", ethers.formatUnits(await lending.availableCash(), 6), "USDC");
  console.log("Pool total borrowed:", ethers.formatUnits(await lending.totalBorrowed(), 6), "USDC");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
