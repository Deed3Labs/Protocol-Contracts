/**
 * The co-op's Assurance contracts (compliance section 13; PHASE-2B-PROGRESS.md section 13
 * decisions 5 and 6).
 *
 * A third TimelockController, beside the Deed and credit timelocks (DECISIONS #10): minimum delay
 * 7 days, the co-op board Safe proposing and executing, no admin. It is the AssurancePool's
 * governance from the moment the pool exists: the pool is initialized with it, so the deployer
 * never holds a pool power and there is nothing to hand over afterwards. Every governed call also
 * needs two of the pool's signers to approve its exact calldata (`approveAction`), and the monthly
 * floor inputs, draws, grants, transfers and pauses take two signers in the pool itself.
 *
 * What this does:
 * - deploys the Assurance timelock (refusing a delay under 7 days);
 * - deploys the AssurancePool behind a UUPS proxy, governed by it, with the co-op's signers;
 * - lists the money-path contracts in NetworkRegistry (section 13c), so the pool refuses a deposit
 *   from any of them. Issuers count already, by being registered. This step needs NetworkRegistry's
 *   DEFAULT_ADMIN_ROLE, so it runs before the credit timelock handover, or as a credit timelock
 *   proposal after it (`moneyPathCalls` gives the calldata).
 *
 * What it does not: name payers, Lending Co.'s addresses, the disbursement address or the exposure
 * source. Those are governed calls -- two signers approve, the board schedules, 7 days pass -- and
 * `governedCalls` prints the calldata for the board Safe to propose.
 *
 * Nothing in credit, savings, payouts or bonds is pointed at the pool: none of them holds its
 * address. This module only builds transactions from the signer it is given; it never reads a key.
 *
 *   BOARD_SAFE=0x... ASSURANCE_SIGNERS=0xA,0xB,0xC ASSURANCE_DEPLOY=1 \
 *     npx hardhat run deploy/assurance_timelock_handover.ts --network base-sepolia
 */

export const ASSURANCE_TIMELOCK_DELAY = 7 * 24 * 60 * 60;

/** The money-path contracts by deployment record, and the kind each is listed under. */
export const MONEY_PATHS: [string, string][] = [
  ["ClearUSDUpgradeable", "CLRUSD"],
  ["ESADepositVault", "ESA_VAULT"],
  ["CollateralRegistry", "PLEDGE"],
  ["Liquidator", "LIQUIDATOR"],
  ["LendingPool", "LENDING_POOL"],
  ["BondVault", "BOND_VAULT"],
  ["PayoutPool", "PAYOUT_POOL"],
  ["ClearCredit", "LEDGER"],
  ["ClaimEscrow", "CLAIM_ESCROW"],
];

/** Deploys the Assurance TimelockController with `boardSafe` proposing and executing, no admin. */
export async function deployAssuranceTimelock(boardSafe: string, delay = ASSURANCE_TIMELOCK_DELAY) {
  const { ethers } = require("hardhat");
  if (delay < ASSURANCE_TIMELOCK_DELAY) throw new Error("The Assurance timelock delay must be at least 7 days.");
  const F = await ethers.getContractFactory("TimelockController");
  const timelock = await F.deploy(delay, [boardSafe], [boardSafe], ethers.ZeroAddress);
  await timelock.waitForDeployment();
  return timelock;
}

/** Deploys the AssurancePool, governed by `timelock` from its first block. */
export async function deployAssurancePool(usdc: string, timelock: string, networkRegistry: string, signers: string[]) {
  const { ethers, upgrades } = require("hardhat");
  const F = await ethers.getContractFactory("AssurancePool");
  const pool = await upgrades.deployProxy(F, [usdc, timelock, networkRegistry, signers], { kind: "uups" });
  await pool.waitForDeployment();
  return pool;
}

/** Lists each money-path contract that is deployed and not yet listed. Needs the registry's admin. */
export async function listMoneyPaths(registry: any, addresses: Record<string, string | undefined>, log: (m: string) => void = () => {}) {
  const { ethers } = require("hardhat");
  for (const [name, kind] of MONEY_PATHS) {
    const address = addresses[name];
    if (!address) continue;
    if ((await registry.moneyPathKindOf(address)) !== ethers.ZeroHash) continue;
    await (await registry.listMoneyPath(address, ethers.encodeBytes32String(kind))).wait();
    log(`  ${name} listed as ${kind}`);
  }
}

/** The governed calls that finish the setup, as calldata for the board Safe and the signers. */
export function governedCalls(pool: any, s: {
  lendingCoOperating: string; lendingCoDraw: string; lendingCoLossReserve: string;
  coopTreasury: string; disbursement: string; exposureSource?: string;
}) {
  const { ethers } = require("hardhat");
  const calls: [string, any[]][] = [
    // Lending Co.'s operating address pays credit-enhancement fees and recoveries; the co-op
    // treasury pays interchange and board allocations (13c).
    ["setPayer", [s.lendingCoOperating, (1 << 0) | (1 << 1)]],
    ["setPayer", [s.coopTreasury, (1 << 2) | (1 << 3)]],
    ["setLendingCoAddresses", [s.lendingCoDraw, s.lendingCoLossReserve]],
    ["setAssuranceDisbursementAddress", [s.disbursement]],
  ];
  if (s.exposureSource) calls.push(["setExposureSources", [[s.exposureSource]]]);
  return calls.map(([fn, args]) => {
    const data = pool.interface.encodeFunctionData(fn, args);
    return { fn, args, data, action: ethers.keccak256(data) };
  });
}

/** Throws if `account` holds any power over the pool, or its governance is under 7 days. */
export async function assertNoAssuranceAdmin(pool: any, account: string) {
  const { ethers } = require("hardhat");
  const left: string[] = [];
  if ((await pool.governance()) === account) left.push("governance");
  if (await pool.isSigner(account)) left.push("signer");
  if ((await pool.drawAddress()) === account) left.push("drawAddress");
  const timelock = await ethers.getContractAt("TimelockController", await pool.governance());
  if ((await timelock.getMinDelay()) < BigInt(ASSURANCE_TIMELOCK_DELAY)) left.push("governance delay under 7 days");
  const admin = await timelock.DEFAULT_ADMIN_ROLE();
  if (await timelock.hasRole(admin, account)) left.push("timelock admin");
  if (left.length > 0) throw new Error(`Deployer still holds Assurance powers: ${left.join(", ")}`);
}

export async function runAssuranceDeploy() {
  const { ethers } = require("hardhat");
  const { getDeployment, saveDeployment } = require("./helpers");
  if (process.env.ASSURANCE_DEPLOY !== "1") {
    throw new Error("Set ASSURANCE_DEPLOY=1 to confirm: this deploys the co-op's AssurancePool under a 7-day timelock.");
  }
  const board = process.env.BOARD_SAFE;
  if (!board || !ethers.isAddress(board)) throw new Error("BOARD_SAFE must be the co-op board Safe.");
  const signers = (process.env.ASSURANCE_SIGNERS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (signers.length < 2 || !signers.every((x) => ethers.isAddress(x))) {
    throw new Error("ASSURANCE_SIGNERS must list at least two co-op signer addresses, comma-separated.");
  }
  const [deployer] = await ethers.getSigners();
  const network = (await ethers.provider.getNetwork()).name;
  const usdc = process.env.RESERVE_TOKEN ?? ({ "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" } as Record<string, string>)[network];
  if (!usdc) throw new Error("RESERVE_TOKEN must be USDC on this network.");
  const registryRecord = getDeployment(network, "NetworkRegistry");
  if (!registryRecord) throw new Error("NetworkRegistry is not deployed: run deploy/20 first.");

  let timelockAddress = getDeployment(network, "AssuranceTimelock")?.address;
  if (!timelockAddress) {
    const t = await deployAssuranceTimelock(board);
    timelockAddress = await t.getAddress();
    saveDeployment(network, "AssuranceTimelock", timelockAddress, JSON.parse(t.interface.formatJson()));
    console.log(`+ AssuranceTimelock deployed to ${timelockAddress}`);
  }
  // A record of the retired Phase 1 pool is not reused: the new pool is a new contract.
  let poolRecord = getDeployment(network, "AssurancePoolV2");
  let pool;
  if (poolRecord) {
    pool = await ethers.getContractAt("AssurancePool", poolRecord.address);
  } else {
    pool = await deployAssurancePool(usdc, timelockAddress!, registryRecord.address, signers);
    poolRecord = { address: await pool.getAddress(), abi: null };
    saveDeployment(network, "AssurancePoolV2", poolRecord.address, JSON.parse(pool.interface.formatJson()));
    console.log(`+ AssurancePool deployed to ${poolRecord.address}`);
  }

  const registry = await ethers.getContractAt("NetworkRegistry", registryRecord.address);
  const addresses: Record<string, string | undefined> = {};
  for (const [name] of MONEY_PATHS) addresses[name] = getDeployment(network, name)?.address;
  if (await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), deployer.address)) {
    await listMoneyPaths(registry, addresses, console.log);
  } else {
    console.log("! The deployer is not NetworkRegistry's admin: propose these through the credit timelock:");
    for (const [name, kind] of MONEY_PATHS) {
      if (addresses[name]) console.log(`  listMoneyPath(${addresses[name]}, "${kind}")`);
    }
  }
  await assertNoAssuranceAdmin(pool, deployer.address);
  console.log("\nAssurancePool deployed and governed by the Assurance timelock. Next, for the board Safe and two signers:");
  console.log("  setPayer (Lending Co. operating: fees, recoveries), setPayer (co-op treasury: interchange, board),");
  console.log("  setLendingCoAddresses, setAssuranceDisbursementAddress, setExposureSources (CollateralRegistry).");
}

if (require.main === module) {
  runAssuranceDeploy()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
