import { ethers, upgrades } from "hardhat";
import { poolAt, poolProxyOptions } from "../../deploy/poolModules";

/** USDC units (6 decimals). */
export const U = (n: number | string) => ethers.parseUnits(String(n), 6);
export const WAD = 10n ** 18n;
export const BPS = 10_000n;
export const DAY = 24 * 3600;
export const HOUR = 3600;
export const EVIDENCE = ethers.id("evidence");
export const LOSS_EVENT = 1;
export const LEGAL_ORDER = 2;
export const USDC_OR_NETWORK = 3;
export const VALUATION_PENDING = 4;

export async function increase(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

export async function latest(): Promise<number> {
  return (await ethers.provider.getBlock("latest"))!.timestamp;
}

export async function setNext(ts: number) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
}

/** A Pool Tier principal ceiling high enough not to bind, for suites that do not test it (IV-02 §4.3). */
export const NO_TIER_CAP = 10n ** 30n;

/**
 * Posts the Pool Tier principal ceiling (IV-02 §4.3) by two VALUATION_ROLE signers. Deployments
 * fail closed until it is posted.
 */
export async function postTierCap(pool: any, a: any, b: any, value: bigint = NO_TIER_CAP) {
  const evidence = ethers.id(`pool tiers ${value}`);
  await pool.connect(a).postPoolTierPrincipal(value, evidence);
  return pool.connect(b).postPoolTierPrincipal(value, evidence);
}

/**
 * Just the pool, for suites that bring their own token and signers: mock Earn controls (everyone
 * eligible), `lending` as Clear Lending's lending account and `deployers` as the two DEPLOYER_ROLE
 * signers. The Pool Tier ceiling is posted out of the way (the deployers hold VALUATION_ROLE
 * just long enough to post it). `deploy(amount)` makes a two-person Deployment. The pool
 * has the joined ABI (`poolAt`).
 */
export async function deployBarePool(admin: any, usdc: any, lending: any, deployers: [any, any]) {
  const controls: any = await (await ethers.getContractFactory("MockEarnControls")).deploy();
  const proxy: any = await upgrades.deployProxy(
    await ethers.getContractFactory("LendingPool", admin),
    [admin.address, await usdc.getAddress(), "Clear Lending Pool", "clrLP"],
    await poolProxyOptions(admin)
  );
  const pool: any = await poolAt(await proxy.getAddress(), admin);
  await pool.connect(admin).setEarnControls(await controls.getAddress());
  await pool.connect(admin).setDeploymentAccount(lending.address);
  for (const d of deployers) await pool.connect(admin).grantRole(await pool.DEPLOYER_ROLE(), d.address);
  const valuation = await pool.VALUATION_ROLE();
  for (const d of deployers) await pool.connect(admin).grantRole(valuation, d.address);
  await postTierCap(pool, deployers[0], deployers[1]);
  for (const d of deployers) await pool.connect(admin).revokeRole(valuation, d.address);
  let ref = 0;
  async function deploy(amount: bigint) {
    const r = ethers.toBeHex(++ref, 32);
    await pool.connect(deployers[0]).deploy(amount, r);
    return pool.connect(deployers[1]).deploy(amount, r);
  }
  return { pool, controls, deploy };
}

/**
 * A Yield Pool with mock Earn controls, Clear Lending's lending account registered, the two-person
 * roles handed out, and the Pool Tier ceiling posted out of the way (each test that checks it
 * posts its own). The pool has the joined ABI (`poolAt`).
 */
export async function deployYieldPool(opts: { usdc?: any } = {}) {
  const signers = await ethers.getSigners();
  const [admin, alice, bob, carol, v1, v2, d1, d2, s1, s2, cco, enforcer, lending, destination, outsider, alice2] = signers;

  const usdc: any = opts.usdc ?? await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
  const controls: any = await (await ethers.getContractFactory("MockEarnControls")).deploy();
  const proxy: any = await upgrades.deployProxy(
    await ethers.getContractFactory("LendingPool"),
    [admin.address, await usdc.getAddress(), "Clear Lending Pool", "clrLP"],
    await poolProxyOptions()
  );
  const poolAddress = await proxy.getAddress();
  const pool: any = await poolAt(poolAddress, admin);
  await pool.setEarnControls(await controls.getAddress());
  await pool.setDeploymentAccount(lending.address);
  await pool.setEnforcementDestination(destination.address);
  for (const s of [v1, v2]) await pool.grantRole(await pool.VALUATION_ROLE(), s.address);
  for (const s of [d1, d2]) await pool.grantRole(await pool.DEPLOYER_ROLE(), s.address);
  for (const s of [s1, s2]) await pool.grantRole(await pool.SUSPENSION_ROLE(), s.address);
  await pool.grantRole(await pool.CCO_ROLE(), cco.address);
  await pool.grantRole(await pool.ENFORCER_ROLE(), enforcer.address);
  await postTierCap(pool, v1, v2);

  for (const who of [alice, bob, carol, lending, outsider, alice2]) {
    await usdc.mint(who.address, U(1_000_000));
    await usdc.connect(who).approve(poolAddress, ethers.MaxUint256);
  }

  /** Both signers make the same two-person call; returns the second (applying) call. */
  async function two(a: any, b: any, fn: string, ...args: unknown[]) {
    await pool.connect(a)[fn](...args);
    return pool.connect(b)[fn](...args);
  }

  let ref = 0;
  /** A Deployment by two DEPLOYER_ROLE signers. */
  async function deploy(amount: bigint) {
    return two(d1, d2, "deploy", amount, ethers.toBeHex(++ref, 32));
  }

  /** Posts a Pool Loss Allowance by two VALUATION_ROLE signers. */
  async function allowance(value: bigint, evidence = ethers.id(`allowance-${++ref}`)) {
    return two(v1, v2, "postAllowance", value, evidence);
  }

  /** Posts a Pool Loss Charge by two VALUATION_ROLE signers. */
  async function lossCharge(value: bigint, evidence = ethers.id(`loss-${++ref}`)) {
    return two(v1, v2, "postLossCharge", value, evidence);
  }

  /**
   * An allowance giving about `bps` at the current Pool Assets. The Holdback Percentage is kept at
   * full precision, so with interest accruing between blocks it is within a hair of `bps`; tests
   * read `holdbackRate()` for exact figures.
   */
  async function allowanceForBps(bps: bigint) {
    await increase(1);
    const assets: bigint = await pool.totalAssets();
    return allowance((assets * bps) / BPS);
  }

  return {
    admin, alice, bob, carol, v1, v2, d1, d2, s1, s2, cco, enforcer, lending, destination, outsider, alice2,
    usdc, controls, pool, poolAddress, two, deploy, allowance, lossCharge, allowanceForBps,
  };
}
