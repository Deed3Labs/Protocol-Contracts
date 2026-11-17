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
 * source. Those are governed calls -- two signers approve, the board schedules, 7 days pass, the
 * board executes -- and `governedCalls` builds them; scripts/signing_plan.ts turns them into steps.
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

/**
 * The pool's SourceTag enum (IAssurancePool.SourceTag), in declaration order: `setPayer` takes a bit
 * mask with bit `1 << tag` for each tag a payer may deposit under, and refuses a mask above 0xF.
 */
export const SOURCE_TAG = { CREDIT_ENHANCEMENT_FEE: 0, RECOVERY: 1, INTERCHANGE: 2, BOARD_ALLOCATION: 3 } as const;
export const sourceTagMask = (...tags: number[]) => tags.reduce((m, t) => m | (1 << t), 0);
/** Owner decision (Nov 16, 2026): Clear Lending's fees wallet pays the credit enhancement fee, recoveries and interchange. */
// docs/protocol/reserve.md "Money in": Lending Co. pays the credit enhancement fee and recoveries; the co-op
// treasury pays interchange (its 25% policy, IV-01 §8.3) and board allocations.
export const CL_FEES_MASK = sourceTagMask(SOURCE_TAG.CREDIT_ENHANCEMENT_FEE, SOURCE_TAG.RECOVERY);
/** Owner decision (Nov 16, 2026): the co-op treasury (the Clear Treasury Safe) pays board allocations. */
export const BOARD_ALLOCATION_MASK = sourceTagMask(SOURCE_TAG.INTERCHANGE, SOURCE_TAG.BOARD_ALLOCATION);

/** What the governed setup names. Every address is required; none falls back to another. */
export interface AssuranceSetup {
  /** ASSURANCE_CL_FEES_PAYER: pays in under CL_FEES_MASK. */
  clFeesPayer: string;
  /** COOP_TREASURY: pays in under BOARD_ALLOCATION_MASK. */
  coopTreasury: string;
  /** ASSURANCE_DRAW_ADDRESS: Lending Co.'s Registered Draw Address (requestDraw only). */
  draw: string;
  /** ASSURANCE_LOSS_RESERVE: where a released draw is paid. */
  lossReserve: string;
  /** ASSURANCE_DISBURSEMENT: where a released Assurance grant is paid. */
  disbursement: string;
  /** ASSURANCE_EXPOSURE_SOURCES, or the current CollateralRegistry record. */
  exposureSources: string[];
}

/** The env variable behind each address of the setup. */
export const ASSURANCE_SETUP_ENV: Record<Exclude<keyof AssuranceSetup, "exposureSources">, string> = {
  clFeesPayer: "ASSURANCE_CL_FEES_PAYER",
  coopTreasury: "COOP_TREASURY",
  draw: "ASSURANCE_DRAW_ADDRESS",
  lossReserve: "ASSURANCE_LOSS_RESERVE",
  disbursement: "ASSURANCE_DISBURSEMENT",
};

/**
 * Reads the setup from `env`. Throws, naming every variable, if any is empty or not an address:
 * nothing falls back to another address. `defaultExposure` is used when ASSURANCE_EXPOSURE_SOURCES
 * is unset (the plan passes the current CollateralRegistry record).
 */
export function assuranceSetupFromEnv(env: Record<string, string | undefined>, defaultExposure?: string[]): AssuranceSetup {
  const { getAddress, isAddress } = require("ethers");
  const bad = Object.values(ASSURANCE_SETUP_ENV).filter((k) => !env[k]?.trim() || !isAddress(env[k]!.trim()));
  if (bad.length) {
    throw new Error(`Refusing: ${bad.join(", ")} ${bad.length === 1 ? "is" : "are"} empty or not an address. The owner fills ${bad.length === 1 ? "it" : "them"} in deploy/config/base-sepolia.rollout.env (owner to fill, Nov 16, 2026); nothing falls back to another address.`);
  }
  const pick = (k: keyof typeof ASSURANCE_SETUP_ENV) => getAddress(env[ASSURANCE_SETUP_ENV[k]]!.trim());
  const listed = (env.ASSURANCE_EXPOSURE_SOURCES ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (listed.some((x) => !isAddress(x))) throw new Error(`Refusing: ASSURANCE_EXPOSURE_SOURCES must be addresses, comma-separated: ${env.ASSURANCE_EXPOSURE_SOURCES}.`);
  return {
    clFeesPayer: pick("clFeesPayer"),
    coopTreasury: pick("coopTreasury"),
    draw: pick("draw"),
    lossReserve: pick("lossReserve"),
    disbursement: pick("disbursement"),
    exposureSources: (listed.length ? listed : defaultExposure ?? []).map((x) => getAddress(x)),
  };
}

/**
 * Every reason the governed setup would revert, or breaks the owner's rule that the five addresses
 * are different from each other. Pure: the caller passes what the chain says.
 *   setPayer: payer not zero, mask <= 0xF, not a signer, not the draw address (the one set when it
 *     runs: today's and the new one), not a money path (NetworkRegistry.isMoneyPath).
 *   setLendingCoAddresses: neither zero nor a signer; the draw address is no payer (today's payers
 *     that the batch does not change, and the two the batch names).
 *   setAssuranceDisbursementAddress: not zero. setExposureSources: at most 4, none zero (an empty
 *     list is not a problem here: the plan waits for the fresh CollateralRegistry record).
 */
export function assuranceSetupProblems(
  s: AssuranceSetup,
  signers: string[],
  chain: { drawAddress?: string; payerTagsOf?: Record<string, bigint>; moneyPath?: Record<string, boolean>; maxExposureSources?: number } = {},
): string[] {
  const out: string[] = [];
  const lc = (a?: string) => (a ?? "").toLowerCase();
  const ZERO = "0x" + "00".repeat(20);
  const isSigner = (a: string) => signers.some((x) => lc(x) === lc(a));
  const names: [string, string][] = [
    [ASSURANCE_SETUP_ENV.clFeesPayer, s.clFeesPayer], [ASSURANCE_SETUP_ENV.coopTreasury, s.coopTreasury],
    [ASSURANCE_SETUP_ENV.draw, s.draw], [ASSURANCE_SETUP_ENV.lossReserve, s.lossReserve], [ASSURANCE_SETUP_ENV.disbursement, s.disbursement],
  ];
  for (const [k, a] of names) if (lc(a) === ZERO) out.push(`${k} is the zero address (the pool refuses it).`);
  for (const [k, a] of names) {
    if (k === ASSURANCE_SETUP_ENV.disbursement) continue; // the pool does not check the disbursement address against the signers
    if (isSigner(a)) out.push(`${k} ${a} is one of the pool's signers: the pool refuses it (AssurancePoolRoleConflict).`);
  }
  if (isSigner(s.disbursement)) out.push(`${ASSURANCE_SETUP_ENV.disbursement} ${s.disbursement} is one of the pool's signers: a signer must not receive the grants it releases.`);
  for (const [k, a] of [[ASSURANCE_SETUP_ENV.clFeesPayer, s.clFeesPayer], [ASSURANCE_SETUP_ENV.coopTreasury, s.coopTreasury]]) {
    if (lc(a) === lc(s.draw)) out.push(`${k} ${a} is also ${ASSURANCE_SETUP_ENV.draw}: a payer may not be the draw address (AssurancePoolRoleConflict).`);
    else if (chain.drawAddress && lc(chain.drawAddress) !== lc(ZERO) && lc(a) === lc(chain.drawAddress)) out.push(`${k} ${a} is the pool's current draw address: setPayer would revert (AssurancePoolRoleConflict).`);
    if (chain.moneyPath?.[lc(a)]) out.push(`${k} ${a} is a money-path contract in NetworkRegistry: setPayer would revert (AssurancePoolMoneyPath).`);
  }
  const drawTags = chain.payerTagsOf?.[lc(s.draw)] ?? 0n;
  if (drawTags !== 0n && lc(s.draw) !== lc(s.clFeesPayer) && lc(s.draw) !== lc(s.coopTreasury)) {
    out.push(`${ASSURANCE_SETUP_ENV.draw} ${s.draw} is already a payer (mask ${drawTags}): setLendingCoAddresses would revert (AssurancePoolRoleConflict).`);
  }
  const seen = new Map<string, string>();
  for (const [k, a] of names) {
    if (seen.has(lc(a))) out.push(`${k} and ${seen.get(lc(a))} are the same address ${a}: the five Assurance addresses must all differ (owner's rule).`);
    else seen.set(lc(a), k);
  }
  if (s.exposureSources.length > (chain.maxExposureSources ?? 4)) out.push(`ASSURANCE_EXPOSURE_SOURCES lists ${s.exposureSources.length}; the pool takes at most ${chain.maxExposureSources ?? 4}.`);
  for (const e of s.exposureSources) if (lc(e) === ZERO) out.push("An exposure source is the zero address (the pool refuses it).");
  return out;
}

/**
 * The governed calls that finish the setup, in this order: setPayer (Clear Lending's fees wallet:
 * credit enhancement fee, recovery, interchange), setPayer (the co-op treasury: board allocation),
 * setLendingCoAddresses, setAssuranceDisbursementAddress, setExposureSources. `action` is what each
 * signer passes to `approveAction`: keccak256 of the exact calldata the timelock will send.
 */
export function governedCalls(pool: any, s: AssuranceSetup) {
  const { keccak256 } = require("ethers");
  const calls: [string, string, any[]][] = [
    ["payer-clfees", "setPayer", [s.clFeesPayer, CL_FEES_MASK]],
    ["payer-treasury", "setPayer", [s.coopTreasury, BOARD_ALLOCATION_MASK]],
    ["lendingco", "setLendingCoAddresses", [s.draw, s.lossReserve]],
    ["disbursement", "setAssuranceDisbursementAddress", [s.disbursement]],
  ];
  if (s.exposureSources.length) calls.push(["exposure", "setExposureSources", [s.exposureSources]]);
  return calls.map(([key, fn, args]) => {
    const data: string = pool.interface.encodeFunctionData(fn, args);
    return { key, fn, args, data, action: keccak256(data) as string };
  });
}

/** The key `_pair` records a signer's half of an `approveAction` under: keccak256(abi.encode("governance", action)). */
export function approvalKey(action: string): string {
  const { AbiCoder, keccak256 } = require("ethers");
  return keccak256(AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], ["governance", action]));
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
  const { getDeployment, saveDeployment, liveNetworkOf } = require("./helpers");
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
  const usdc = process.env.RESERVE_TOKEN ?? ({ "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" } as Record<string, string>)[liveNetworkOf(network)];
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
  console.log("\nAssurancePool deployed and governed by the Assurance timelock. Next, for two signers and the board Safe");
  console.log("(scripts/signing_plan.ts writes each step): setPayer (Clear Lending's fees wallet: fee, recovery, interchange),");
  console.log("  setPayer (co-op treasury: board allocation), setLendingCoAddresses, setAssuranceDisbursementAddress,");
  console.log("  setExposureSources (CollateralRegistry).");
}

if (require.main === module) {
  runAssuranceDeploy()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
