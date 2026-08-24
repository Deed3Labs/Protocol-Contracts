import hre from "hardhat";
import { getDeployment } from "../deploy/helpers";

/*
 * Pledges a member's savings so their credit line reflects it, and backfills anyone who deposited
 * before the server started doing this.
 *
 * Depositing mints CLRUSD; the registry reads `pledgedOf`, not a balance. So savings deposited
 * before that link existed are real, spendable, and backing nothing -- the savings tier reads zero
 * with money sitting in it.
 *
 * Pledging costs the member nothing. Encumbrance is computed from what is drawn, not from what is
 * pledged, so savings pledged against an untouched line stay entirely withdrawable.
 *
 *   WALLET=0x… npx hardhat run scripts/sync_savings_collateral.ts --network base-sepolia
 *   WALLETS=0x…,0x… npx hardhat run scripts/sync_savings_collateral.ts --network base-sepolia
 *
 * Idempotent: it reads the current pledge and moves it to the balance, so re-running changes
 * nothing. Run by an operator.
 */
const { ethers } = hre as typeof hre & { ethers: typeof import("hardhat").ethers };

async function main() {
  const network = (await ethers.provider.getNetwork()).name;
  const registryRecord = getDeployment(network, "CollateralRegistry");
  const calculatorRecord = getDeployment(network, "LimitCalculator");
  const clrusdRecord = getDeployment(network, "ClearUSDUpgradeable");
  if (!registryRecord) throw new Error(`No CollateralRegistry on ${network}.`);
  if (!clrusdRecord) throw new Error(`No CLRUSD on ${network}.`);

  const raw = (process.env.WALLETS || process.env.WALLET || "").trim();
  if (!raw) throw new Error("Set WALLET=0x… or WALLETS=0x…,0x…");
  const wallets = raw.split(",").map((w) => w.trim()).filter(Boolean);

  const registry = await ethers.getContractAt("CollateralRegistry", registryRecord.address);
  const token = await ethers.getContractAt("ClearUSDUpgradeable", clrusdRecord.address);
  const SAVINGS = ethers.encodeBytes32String("SAVINGS");

  for (const wallet of wallets) {
    if (!ethers.isAddress(wallet)) throw new Error(`Not an address: ${wallet}`);
    const member = ethers.getAddress(wallet);

    const balance: bigint = await token.balanceOf(member);
    const pledged: bigint = await registry.pledgedOf(member, SAVINGS);
    console.log(`\n${member}`);
    console.log("  CLRUSD held ", ethers.formatUnits(balance, 6));
    console.log("  pledged     ", ethers.formatUnits(pledged, 6));

    if (balance > pledged) {
      await (await registry.pledge(member, SAVINGS, balance - pledged)).wait();
      console.log("  pledged +   ", ethers.formatUnits(balance - pledged, 6));
    } else if (balance < pledged) {
      // Only what is free. The rest is holding up drawn credit, and the registry refuses to
      // release it -- correctly.
      const free: bigint = await registry.freeCollateralOf(member, SAVINGS);
      const wanted = pledged - balance;
      const amount = wanted < free ? wanted : free;
      if (amount > 0n) {
        await (await registry.release(member, SAVINGS, amount)).wait();
        console.log("  released -  ", ethers.formatUnits(amount, 6));
      }
    } else {
      console.log("  already in sync");
    }

    if (calculatorRecord) {
      const calculator = await ethers.getContractAt("LimitCalculator", calculatorRecord.address);
      await (await calculator.pushCapacities(member)).wait();
      const capacity = await calculator.capacityOf(member, SAVINGS);
      console.log("  savings line", ethers.formatUnits(capacity, 6));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
