import * as fs from "fs";
import * as path from "path";

/**
 * Decision 47: the Base Sepolia credit stack is deployed fresh, not upgraded in place.
 *
 * The pre-audit credit contracts on Base Sepolia hold lines and plans with zero accrual snapshots,
 * so their first touch after an upgrade would charge decades of carry (PHASE-1-REPORT §5 item 8;
 * REREVIEW §6 and BLIND-REVIEW I-1). A fresh deployment avoids that and makes Base Sepolia a
 * rehearsal of mainnet, where credit is fresh anyway.
 *
 * The numbered deploy scripts reuse whatever is recorded in `deployments/<network>/`. This script
 * moves each credit-stack record aside, as `<Name>PreAudit`, so the next runs of deploy 16, 20, 22
 * and 24 deploy those contracts fresh. It touches only the local record files: it sends nothing and
 * needs no key or network. The retired contracts stay on chain, unchanged; the `*PreAudit` records
 * keep their addresses and ABIs, so later steps can still read them (the PayoutPool's legacy loans,
 * the old Liquidator's grants to revoke) and EarnControls refuses them as Earn payers
 * (`deploy/earnWiring.ts`).
 *
 * Not retired (upgraded in place or kept): ESADepositVault, ClaimEscrow, ClearUSDUpgradeable,
 * LendingPool (the Yield Pool) and BondVault, which are re-pointed at the fresh stack where their
 * setters allow; MembershipRegistry, TokenRegistry, CLRUSDTokenPool and Create2Deployer. The
 * contracts that point at the stack are all new in this deployment anyway: RateSchedule, PauseClock,
 * PoolShareEnforcer, the AssurancePool (deploy 08), the bond factory, collection and valuer
 * (deploy 22 with REPLACE_BOND_FACTORY=1, deploy 23), EarnControls, the CollateralAgent and
 * HolderDirections.
 *
 * Idempotent. A record already retired is not retired twice: if both `<Name>` and `<Name>PreAudit`
 * exist, `<Name>` is the fresh contract and is kept.
 *
 *   npx hardhat run deploy/retire_credit_stack.ts --network base-sepolia                          # report
 *   RETIRE_CREDIT_STACK=1 npx hardhat run deploy/retire_credit_stack.ts --network base-sepolia    # move the records
 */

/** The credit stack of decision 47, in deploy order: the core, the issuers and their periphery. */
export const CREDIT_STACK_RECORDS = [
  "AccessManager", // deploy 16 (deploy 18 links it to the MembershipRegistry)
  "ClearCredit", // deploy 20
  "NetworkRegistry",
  "RevolvingIssuer", // with its four modules (deploy/issuerModules.ts)
  "TermIssuer", // with its two modules
  "CollateralRegistry",
  "LimitCalculator",
  "MerchantRegistry", // deploy 22
  "PayoutPool",
  "Liquidator", // with LiquidatorEnforcement, created by its constructor
  "OffersIssuer", // deploy 24
] as const;

export const RETIRED_SUFFIX = "PreAudit";

export interface RetireStep {
  name: string;
  address: string;
  retiredAs: string;
  /** "retire": moved aside now (or on apply); "kept": already retired, the record is the fresh one; "retired": retired, not yet redeployed. */
  status: "retire" | "kept" | "retired";
}

/** The retirement plan for the records in `dir`, applied when `apply` is set. */
export function retireCreditRecords(dir: string, apply = false, log: (m: string) => void = console.log): RetireStep[] {
  const file = (name: string) => path.join(dir, `${name}.json`);
  const read = (name: string) => (fs.existsSync(file(name)) ? JSON.parse(fs.readFileSync(file(name), "utf8")) : undefined);
  const steps: RetireStep[] = [];
  for (const name of CREDIT_STACK_RECORDS) {
    const retiredAs = `${name}${RETIRED_SUFFIX}`;
    const current = read(name);
    const retired = read(retiredAs);
    if (current && retired) {
      steps.push({ name, address: current.address, retiredAs, status: "kept" });
      log(`= ${name} ${current.address} is the fresh one (the old one is ${retiredAs} ${retired.address})`);
    } else if (retired) {
      steps.push({ name, address: retired.address, retiredAs, status: "retired" });
      log(`= ${name} retired as ${retiredAs} ${retired.address}; not yet redeployed`);
    } else if (current) {
      steps.push({ name, address: current.address, retiredAs, status: "retire" });
      if (apply) {
        fs.writeFileSync(file(retiredAs), JSON.stringify(current, null, 2));
        fs.rmSync(file(name));
        log(`- ${name} ${current.address} -> ${retiredAs}`);
      } else {
        log(`  would retire ${name} ${current.address} as ${retiredAs}`);
      }
    }
  }
  return steps;
}

async function main() {
  const { ethers } = require("hardhat");
  const network = (await ethers.provider.getNetwork()).name;
  if (network === "base" && process.env.CONFIRM_MAINNET !== "1") {
    throw new Error("Base mainnet has no credit stack to retire (credit is deployed fresh there). Set CONFIRM_MAINNET=1 only if you mean it.");
  }
  const apply = process.env.RETIRE_CREDIT_STACK === "1";
  const steps = retireCreditRecords(path.join("deployments", network), apply);
  if (!apply && steps.some((s) => s.status === "retire")) {
    console.log("\nNothing was moved. RETIRE_CREDIT_STACK=1 moves these records aside; deploy 16, 18, 20, 22 and 24 then deploy fresh.");
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
