import { ethers, upgrades } from "hardhat";

/*
 * The co-op's AssurancePool (compliance section 13), deployed on its own: nothing in the credit
 * network holds its address. Governance is a 7-day TimelockController with the board Safe
 * proposing; every governed call also needs two signers' approval of its exact calldata.
 */

export const DAY = 24 * 60 * 60;
export const ASSURANCE_DELAY = 7 * DAY;
export const BACKSTOP = ethers.encodeBytes32String("CREDIT_BACKSTOP");
export const ASSURANCE = ethers.encodeBytes32String("MEMBER_ASSURANCE");
export const TAG = { CREDIT_ENHANCEMENT_FEE: 0, RECOVERY: 1, INTERCHANGE: 2, BOARD_ALLOCATION: 3 };
export const MASK = {
  lendingCo: (1 << TAG.CREDIT_ENHANCEMENT_FEE) | (1 << TAG.RECOVERY),
  treasury: (1 << TAG.INTERCHANGE) | (1 << TAG.BOARD_ALLOCATION),
};

export async function advance(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

export interface AssuranceSetup {
  pool: any;
  timelock: any;
  board: any;
  signerA: any;
  signerB: any;
  signerC: any;
  /** Lending Co.'s operating address: pays fees and recoveries. */
  lendingCo: any;
  /** Lending Co.'s Registered Draw Address. */
  drawer: any;
  /** Lending Co.'s loss-reserve address. */
  lossReserve: any;
  /** The co-op treasury: pays interchange and board allocations. */
  treasury: any;
  /** The co-op's Assurance disbursement address. */
  disbursement: any;
  /** Runs a governed call: two signers approve its calldata, the board schedules, 7 days pass. */
  governed: (fn: string, args: any[]) => Promise<any>;
}

let salt = 0;

/** A funded key of its own, so no pool role is ever one of a test's members or operators. */
async function role(name: string) {
  const wallet = new ethers.Wallet(ethers.id(`assurance:${name}`), ethers.provider);
  await ethers.provider.send("hardhat_setBalance", [wallet.address, "0x56BC75E2D63100000"]);
  return wallet;
}

/**
 * Deploys the timelock and the pool, then (unless `bare`) names the payers, Lending Co.'s
 * addresses and the disbursement address through governance.
 *
 * Every pool role is a key of its own, never one of the hardhat signers a test uses as a member,
 * merchant or operator. Lending Co.'s operating address is signer 18, the Phase 0 fixture's
 * `lenderOperating`, so the ledger's repayment remainder and the pool's fee payer are one address.
 */
export async function deployAssurancePool(
  usdc: any,
  networkRegistry: any,
  opts: { bare?: boolean; exposureSources?: string[] } = {}
): Promise<AssuranceSetup> {
  const lendingCo = (await ethers.getSigners())[18];
  const [board, signerA, signerB, signerC, drawer, lossReserve, treasury, disbursement] = await Promise.all(
    ["board", "signerA", "signerB", "signerC", "drawer", "lossReserve", "treasury", "disbursement"].map(role)
  );

  const Timelock = await ethers.getContractFactory("TimelockController");
  const timelock: any = await Timelock.deploy(ASSURANCE_DELAY, [board.address], [board.address], ethers.ZeroAddress);
  const Pool = await ethers.getContractFactory("AssurancePool");
  const pool: any = await upgrades.deployProxy(
    Pool,
    [await usdc.getAddress(), await timelock.getAddress(), await networkRegistry.getAddress(), [signerA.address, signerB.address, signerC.address]],
    { kind: "uups" }
  );

  const governed = async (fn: string, args: any[]) => {
    const data = pool.interface.encodeFunctionData(fn, args);
    const action = ethers.keccak256(data);
    await pool.connect(signerA).approveAction(action);
    await pool.connect(signerB).approveAction(action);
    const id = ethers.zeroPadValue(ethers.toBeHex(++salt), 32);
    const target = await pool.getAddress();
    await timelock.connect(board).schedule(target, 0, data, ethers.ZeroHash, id, ASSURANCE_DELAY);
    await advance(ASSURANCE_DELAY);
    return timelock.connect(board).execute(target, 0, data, ethers.ZeroHash, id);
  };

  const setup: AssuranceSetup = {
    pool, timelock, board, signerA, signerB, signerC, lendingCo, drawer, lossReserve, treasury, disbursement, governed,
  };
  if (opts.bare) return setup;

  await governed("setPayer", [lendingCo.address, MASK.lendingCo]);
  await governed("setPayer", [treasury.address, MASK.treasury]);
  await governed("setLendingCoAddresses", [drawer.address, lossReserve.address]);
  await governed("setAssuranceDisbursementAddress", [disbursement.address]);
  if (opts.exposureSources) await governed("setExposureSources", [opts.exposureSources]);
  return setup;
}

/** Sets the month's floor inputs with two signers. */
export async function setFloorInputs(a: AssuranceSetup, shortfall: bigint, cap: bigint, attested: bigint, evidence = ethers.id("evidence")) {
  await a.pool.connect(a.signerA).setFloorInputs(shortfall, cap, attested, evidence);
  return a.pool.connect(a.signerB).setFloorInputs(shortfall, cap, attested, evidence);
}

/** Mints `amount` to `payer` and deposits it under `tag`. */
export async function fund(a: AssuranceSetup, usdc: any, payer: any, tag: number, amount: bigint) {
  await usdc.mint(payer.address, amount);
  await usdc.connect(payer).approve(await a.pool.getAddress(), amount);
  return a.pool.connect(payer).deposit(tag, amount);
}

/** Every compartment's balance, and their sum. */
export async function balances(pool: any) {
  const ids: string[] = await pool.compartments();
  const out: Record<string, bigint> = {};
  let sum = 0n;
  for (const id of ids) {
    const b: bigint = await pool.balanceOf(id);
    out[id] = b;
    sum += b;
  }
  return { byId: out, sum };
}
