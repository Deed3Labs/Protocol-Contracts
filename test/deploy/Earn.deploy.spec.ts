import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { poolProxyOptions } from "../../deploy/poolModules";
import {
  EARN_TIMELOCK_DELAY, assertNoEarnAdmin, creditToEarnCalls, deployEarnTimelock, handOverEarn,
} from "../../deploy/earn_timelock_handover";
import { RESOLUTION, deployEarnControls } from "../helpers/earnControls";

const ZERO = ethers.ZeroHash;

async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e: any) {
    return String(e?.message);
  }
  return "";
}

/*
 * Phase 2f, decision 2: the separate 7-day Earn timelock, on a fresh chain. Nothing here touches a
 * live network.
 */
describe("Earn timelock handover (decision 2)", function () {
  let deployer: any, safe: any, key: any, t1: any, t2: any;
  let usdc: any, pool: any, controls: any, timelock: any, t: string;

  async function deployAgent(admin: string) {
    return upgrades.deployProxy(
      await ethers.getContractFactory("CollateralAgent"),
      [admin, key.address, [t1.address, t2.address], 6, {
        vault: ethers.ZeroAddress, bondBook: ethers.ZeroAddress, pledgeModule: ethers.ZeroAddress, payeeSource: ethers.ZeroAddress,
        collateralAccount: t1.address, costAddress: key.address, excessDestination: safe.address,
      }],
      { kind: "uups" }
    ) as Promise<any>;
  }

  async function viaTimelock(target: any, data: string, salt: string) {
    const to = await target.getAddress();
    await timelock.connect(safe).schedule(to, 0, data, ZERO, ethers.id(salt), EARN_TIMELOCK_DELAY);
    await expect(timelock.connect(safe).execute(to, 0, data, ZERO, ethers.id(salt)))
      .to.be.revertedWith("TimelockController: operation is not ready");
    await ethers.provider.send("evm_increaseTime", [EARN_TIMELOCK_DELAY]);
    await ethers.provider.send("evm_mine", []);
    await timelock.connect(safe).execute(to, 0, data, ZERO, ethers.id(salt));
  }

  beforeEach(async function () {
    [deployer, safe, key, t1, t2] = await ethers.getSigners();
    usdc = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
    pool = await upgrades.deployProxy(
      await ethers.getContractFactory("LendingPool", deployer),
      [deployer.address, await usdc.getAddress(), "Clear Lending Pool", "clrLP"],
      await poolProxyOptions(deployer)
    );
    await pool.grantRole(await pool.DEPLOYER_ROLE(), deployer.address);
    controls = await deployEarnControls(deployer);
    await controls.grantRoleByResolution(await controls.ATTESTER_ROLE(), deployer.address, RESOLUTION);
    timelock = await deployEarnTimelock(safe.address);
    t = await timelock.getAddress();
  });

  it("refuses an Earn timelock shorter than 7 days, and gives the timelock no admin", async function () {
    let error: any;
    try { await deployEarnTimelock(safe.address, EARN_TIMELOCK_DELAY - 1); } catch (e) { error = e; }
    expect(String(error?.message)).to.contain("at least 7 days");
    expect(await timelock.hasRole(await timelock.TIMELOCK_ADMIN_ROLE(), deployer.address)).to.equal(false);
    expect(await timelock.getMinDelay()).to.equal(BigInt(EARN_TIMELOCK_DELAY));
  });

  it("moves the Yield Pool, EarnControls and CollateralAgent admin to it and leaves the deployer nothing", async function () {
    const agent = await deployAgent(t);
    const c = { lendingPool: pool, earnControls: controls, collateralAgent: agent };
    expect(await failure(handOverEarn(c, deployer, t, ZERO))).to.contain("resolution hash");
    await handOverEarn(c, deployer, t, RESOLUTION);
    await assertNoEarnAdmin(c, deployer.address, t);
    for (const ct of [pool, controls, agent]) {
      expect(await ct.hasRole(ZERO, t)).to.equal(true);
      expect(await ct.hasRole(ZERO, deployer.address)).to.equal(false);
    }
    expect(await pool.hasRole(await pool.OPERATOR_ROLE(), deployer.address)).to.equal(false);
    expect(await pool.hasRole(await pool.DEPLOYER_ROLE(), deployer.address)).to.equal(false);
    expect(await controls.hasRole(await controls.ATTESTER_ROLE(), deployer.address)).to.equal(false);

    // A pool setting and a controls setting now take a proposal and 7 days.
    await expect(pool.setHolderCapBps(5_000)).to.be.reverted;
    await viaTimelock(pool, pool.interface.encodeFunctionData("setHolderCapBps", [5_000]), "pool cap");
    expect(await pool.holderCapBps()).to.equal(5_000n);
    await expect(controls.setHolderCapBps(2_000)).to.be.reverted;
    await viaTimelock(controls, controls.interface.encodeFunctionData("setHolderCapBps", [2_000]), "controls cap");
    expect(await controls.holderCapBps()).to.equal(2_000n);
  });

  it("refuses to hand over a CollateralAgent whose admin is not the Earn timelock", async function () {
    const agent = await deployAgent(deployer.address);
    expect(await failure(handOverEarn({ collateralAgent: agent }, deployer, t, RESOLUTION))).to.contain("not the Earn timelock");
  });

  it("passes LendingPool's admin from the credit timelock to the Earn timelock in one credit-timelock batch", async function () {
    const credit: any = await deployEarnTimelock(safe.address);
    const ct = await credit.getAddress();
    await pool.grantRole(ZERO, ct);
    await pool.renounceRole(ZERO, deployer.address);
    const b = await creditToEarnCalls(pool, t, ct);
    const salt = ethers.id("lending pool to earn");
    await credit.connect(safe).scheduleBatch(b.targets, b.values, b.payloads, ZERO, salt, EARN_TIMELOCK_DELAY);
    await ethers.provider.send("evm_increaseTime", [EARN_TIMELOCK_DELAY]);
    await ethers.provider.send("evm_mine", []);
    await credit.connect(safe).executeBatch(b.targets, b.values, b.payloads, ZERO, salt);
    expect(await pool.hasRole(ZERO, t)).to.equal(true);
    expect(await pool.hasRole(ZERO, ct)).to.equal(false);
  });

  it("LendingPool is no longer part of the credit handover", async function () {
    const src = require("fs").readFileSync(require("path").join(__dirname, "../../deploy/credit_timelock_handover.ts"), "utf8");
    expect(src).to.not.match(/at\("LendingPool"\)|"lendingPool"/);
  });
});
