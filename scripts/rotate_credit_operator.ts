import hre from "hardhat";
import { getDeployment } from "../deploy/helpers";

/*
 * Rotates the key that opens member credit lines.
 *
 * Nothing binds to the address. `openLine` checks `isOperator` at call time and stores nothing
 * about who called, so lines already opened are unaffected by revoking the key that opened them --
 * a member's period belongs to the member, not to whoever wrote it.
 *
 * Grant before revoke, deliberately. The reverse leaves a window where no key can open a line, and
 * onboarding during that window silently produces members with no cycle -- the exact condition
 * this whole path exists to prevent.
 *
 *   NEW_OPERATOR=0x… npx hardhat run scripts/rotate_credit_operator.ts --network base-sepolia
 *   NEW_OPERATOR=0x… OLD_OPERATOR=0x… npx hardhat run scripts/rotate_credit_operator.ts --network base-sepolia
 *
 * Run by an admin. Afterwards set CREDIT_OPERATOR_PRIVATE_KEY to the new key wherever the server
 * reads it, and fund the new address -- an operator with no gas is an operator that cannot act.
 */
const { ethers } = hre as typeof hre & {
  ethers: typeof import("hardhat").ethers;
};

async function main() {
  const network = (await ethers.provider.getNetwork()).name;
  const record = getDeployment(network, "AccessManager");
  if (!record) throw new Error(`No AccessManager on ${network}.`);

  const next = process.env.NEW_OPERATOR?.trim();
  if (!next || !ethers.isAddress(next)) throw new Error("Set NEW_OPERATOR to an address.");
  const previous = process.env.OLD_OPERATOR?.trim();

  const access = await ethers.getContractAt("AccessManager", record.address);

  if (!(await access.isOperator(next))) {
    await (await access.grantOperator(next)).wait();
    console.log("granted operator to", next);
  } else {
    console.log("already an operator:", next);
  }

  if (previous && ethers.isAddress(previous)) {
    if (previous.toLowerCase() === next.toLowerCase()) {
      throw new Error("OLD_OPERATOR and NEW_OPERATOR are the same address.");
    }
    if (await access.isOperator(previous)) {
      await (await access.revokeOperator(previous)).wait();
      console.log("revoked operator from", previous);
    }
    console.log("old still operator:", await access.isOperator(previous));
  } else {
    console.log("No OLD_OPERATOR given — nothing revoked. Pass it to complete the rotation.");
  }

  /*
   * Three role systems, not one.
   *
   * The issuer checks operators through AccessManager; CollateralRegistry and LimitCalculator are
   * plain AccessControl and check their own OPERATOR_ROLE. Granting only the first is what left an
   * operator that could open a credit line and not pledge collateral against it -- so deposits
   * landed and the savings tier stayed at zero, silently, because AccessControl's revert carries
   * no string and surfaces as "missing revert data" during gas estimation.
   *
   * Rotating the key has to move all three or it reintroduces exactly that.
   */
  for (const name of ["CollateralRegistry", "LimitCalculator"] as const) {
    const record = getDeployment(network, name);
    if (!record) {
      console.log(`${name}: not deployed on ${network}, skipping`);
      continue;
    }
    const contract = await ethers.getContractAt(name, record.address);
    const role = await contract.OPERATOR_ROLE();

    if (!(await contract.hasRole(role, next))) {
      await (await contract.grantRole(role, next)).wait();
      console.log(`${name}: granted OPERATOR_ROLE to`, next);
    } else {
      console.log(`${name}: already an operator`);
    }

    if (previous && ethers.isAddress(previous) && previous.toLowerCase() !== next.toLowerCase()) {
      if (await contract.hasRole(role, previous)) {
        await (await contract.revokeRole(role, previous)).wait();
        console.log(`${name}: revoked OPERATOR_ROLE from`, previous);
      }
    }
  }

  console.log("new is operator  :", await access.isOperator(next));
  console.log("new is admin     :", await access.isAdmin(next), "(should be false)");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
