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

  console.log("\nCheck the operator has gas — a role without ETH is still an operator that cannot act.");
  const balance = await ethers.provider.getBalance(member);
  console.log("operator balance:", ethers.formatEther(balance), "ETH");
  if (balance < ethers.parseEther("0.002")) {
    console.log("  ^ low. Two writes per deposit (pledge + pushCapacities) will exhaust this.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
