import hre from "hardhat";
import { getDeployment } from "../deploy/helpers";

/*
 * Grants the credit operator the roles it needs to pledge collateral.
 *
 * `RevolvingIssuer` checks operators through `AccessManager`; `CollateralRegistry` and
 * `LimitCalculator` are plain AccessControl and check their own `OPERATOR_ROLE`. Those are three
 * separate grants, and the operator only ever got the first -- so `openLine` worked and `pledge`
 * reverted on the access check, which surfaces as "missing revert data" during gas estimation
 * because AccessControl's custom error carries no string the provider returns.
 *
 * The symptom was a savings deposit that never moved the credit line: the server's sync ran on
 * every deposit, tried to pledge, and was refused. Manual backfills succeeded because they run as
 * the deployer, which holds the admin role -- so the fix looked like it worked and then never
 * worked again.
 *
 *   OPERATOR=0x… npx hardhat run scripts/grant_collateral_operator.ts --network base-sepolia
 *
 * Run by an admin. Idempotent.
 */
const { ethers } = hre as typeof hre & { ethers: typeof import("hardhat").ethers };

const TARGETS = ["CollateralRegistry", "LimitCalculator"] as const;

async function main() {
  const network = (await ethers.provider.getNetwork()).name;
  const operator = process.env.OPERATOR?.trim();
  if (!operator || !ethers.isAddress(operator)) throw new Error("Set OPERATOR to an address.");
  const member = ethers.getAddress(operator);

  for (const name of TARGETS) {
    const record = getDeployment(network, name);
    if (!record) {
      console.log(`${name}: not deployed on ${network}, skipping`);
      continue;
    }
    const contract = await ethers.getContractAt(name, record.address);
    const role = await contract.OPERATOR_ROLE();

    if (await contract.hasRole(role, member)) {
      console.log(`${name}: already an operator`);
      continue;
    }
    await (await contract.grantRole(role, member)).wait();
    console.log(`${name}: granted OPERATOR_ROLE to ${member}`);
  }

  /*
   * Gas, measured rather than guessed at.
   *
   * An earlier version of this warned below a flat 0.002 ETH, which is a mainnet-shaped number and
   * badly wrong on an L2 -- it reported a healthy operator as nearly empty and sent a real
   * investigation chasing a non-problem. A pledge is ~85k gas, and two writes per deposit, so the
   * only honest way to state a runway is to price it at the chain's current fee.
   */
  const balance = await ethers.provider.getBalance(member);
  const fee = await ethers.provider.getFeeData();
  const gasPrice = fee.gasPrice ?? fee.maxFeePerGas ?? 0n;
  const perDeposit = gasPrice * 85_000n * 2n;

  console.log("\noperator balance:", ethers.formatEther(balance), "ETH");
  if (perDeposit > 0n) {
    console.log("cost per deposit:", ethers.formatEther(perDeposit), "ETH  (pledge + pushCapacities)");
    console.log("runway          :", (balance / perDeposit).toString(), "deposits");
    if (balance / perDeposit < 50n) {
      console.log("  ^ low — top up. A role without gas is still an operator that cannot act.");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
