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

/**
 * The bond records retired outside this script: the pre-2f factory, collection, deposit contract and
 * valuer that deploy 22 keeps as `*Pre2f` (REPLACE_BOND_FACTORY=1), and the older `*Legacy` set.
 */
export const RETIRED_BOND_RECORDS = [
  "BurnerBondFactoryPre2f",
  "BurnerBondPre2f",
  "BurnerBondDepositPre2f",
  "BondValuerPre2f",
  "BurnerBondFactoryLegacy",
  "BurnerBondLegacy",
  "BurnerBondDepositLegacy",
  "BondValuerLegacy",
] as const;

/** The retired bond factories: each collection and deposit contract they made is retired too. */
export const RETIRED_FACTORY_RECORDS = ["BurnerBondFactoryPre2f", "BurnerBondFactoryLegacy"] as const;

/**
 * Decision 48 (b): before the retirement (Base Sepolia, before step D1 and deploy 22), the records
 * that are about to be retired, under their current names. `scripts/check_retired_credit.ts` checks
 * them with CHECK_BASELINE=1, to list what the later steps must disconnect.
 */
export const BASELINE_BOND_RECORDS = ["BurnerBondFactory", "BurnerBond", "BurnerBondDeposit", "BondValuer"] as const;

/** Live records a retired address must never equal: a retired record that does is skipped, never revoked from. */
export const LIVE_RECORDS = [
  ...CREDIT_STACK_RECORDS,
  "BurnerBondFactory", "BurnerBond", "BondValuer",
  "LendingPool", "BondVault", "EarnControls", "CollateralAgent", "HolderDirections", "EarnTimelock",
  "ESADepositVault", "ClearUSDUpgradeable", "ClaimEscrow", "MembershipRegistry",
] as const;

/** Base mainnet's chain id: the one chain where the retired contracts' leftovers would be real money. */
export const BASE_MAINNET_CHAIN_ID = 8453n;

/** The note on every leftover a testnet lets stand (decision 50). */
export const TEST_MONEY_NOTE = "test money, decision 50";

/**
 * Decision 50: on a testnet (Base Sepolia, Sepolia, the in-process Hardhat network, any chain but
 * Base mainnet) the retired contracts hold only test money, so their leftovers do not block the
 * rollout: the old PayoutPool's open loans, its legs while a loan is open, the BondVault's backstop
 * while `lentToPayoutPool` is not zero, and the retired contracts' balances. Nothing is swept or
 * repaid. On Base mainnet there is no retired credit stack, so a leftover there is a failure.
 */
export function isTestMoneyChain(chainId: bigint | number): boolean {
  return BigInt(chainId) !== BASE_MAINNET_CHAIN_ID;
}

/** Every retired record name: the `*PreAudit` credit stack and the `*Pre2f` and `*Legacy` bond records. */
export function retiredRecordNames(): string[] {
  return [...CREDIT_STACK_RECORDS.map((n) => `${n}${RETIRED_SUFFIX}`), ...RETIRED_BOND_RECORDS];
}

export interface RetiredContract {
  /** The record name, or "<factory record> collection <symbol>" for a factory's clone. */
  name: string;
  address: string;
  /** The record's ABI, when it is a record. */
  abi?: any[];
}

type Lookup = (name: string) => { address: string; abi?: any } | null | undefined;

/**
 * The retired contracts on record (decision 48): each retired record, and every collection and
 * deposit contract of each retired bond factory. A retired address that equals a live record's (see
 * `LIVE_RECORDS`) is left out and returned in `skipped`, so no script ever revokes from a live
 * contract. With `baseline`, the records about to be retired are taken under their current names
 * instead (Base Sepolia before the retirement), and nothing is skipped.
 */
export async function retiredContracts(lookup: Lookup, opts: { baseline?: boolean } = {}) {
  const { ethers } = require("hardhat");
  const names: string[] = opts.baseline
    ? [...CREDIT_STACK_RECORDS, ...BASELINE_BOND_RECORDS, "BurnerBondLegacy", "BurnerBondDepositLegacy", "BurnerBondFactoryLegacy", "BondValuerLegacy"]
    : retiredRecordNames();
  const factories: string[] = opts.baseline ? ["BurnerBondFactory", "BurnerBondFactoryLegacy"] : [...RETIRED_FACTORY_RECORDS];
  const live = new Map<string, string>();
  if (!opts.baseline) {
    for (const n of LIVE_RECORDS) {
      const r = lookup(n);
      if (r?.address) live.set(r.address.toLowerCase(), n);
    }
  }
  const out: RetiredContract[] = [];
  const skipped: { name: string; address: string; liveAs: string }[] = [];
  const seen = new Set<string>();
  const add = (name: string, address: string | undefined, abi?: any[]) => {
    if (!address || !ethers.isAddress(address) || address === ethers.ZeroAddress) return;
    const key = address.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const liveAs = live.get(key);
    if (liveAs) skipped.push({ name, address, liveAs });
    else out.push({ name, address: ethers.getAddress(address), abi });
  };
  for (const n of names) {
    const r = lookup(n);
    if (r) add(n, r.address, Array.isArray(r.abi) && r.abi.length ? r.abi : undefined);
  }
  for (const f of factories) {
    const r = lookup(f);
    if (!r) continue;
    // The record's ABI where it has the listing, else the compiled factory's (the same struct).
    const recorded = Array.isArray(r.abi) && r.abi.some((f: any) => f?.name === "getCollectionAtIndex");
    const abi = recorded ? r.abi : (await require("hardhat").artifacts.readArtifact("BurnerBondFactory")).abi;
    const factory = new ethers.Contract(r.address, abi, ethers.provider);
    const n = Number(await factory.getCollectionCount().catch(() => 0n));
    for (let i = 0; i < n; i++) {
      const info = await factory.getCollectionAtIndex(i).catch(() => null);
      if (!info) continue;
      add(`${f} collection ${info.tokenSymbol || i}`, info.collectionAddress);
      add(`${f} deposit contract ${info.tokenSymbol || i}`, info.depositContract);
    }
  }
  return { contracts: out, skipped };
}

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
