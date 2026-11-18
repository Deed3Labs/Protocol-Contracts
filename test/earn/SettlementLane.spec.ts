import { expect } from "chai";
import { ethers } from "hardhat";
import { DAY, EVIDENCE, LOSS_EVENT, U, deployYieldPool, increase, latest, postTierCap, setNext } from "../helpers/yieldPool";
import { prng } from "../audit/deep/fuzz-engine";

/*
 * The Settlement Funding lane (decision 54; IV-02 §4.3A, L-01 §8.4A, C-01 §6.14): the Yield Pool
 * pays for members' credit swipes before the bank's settlement cut-off, through one registered
 * funder (the funding desk's wallet) acting alone within limits two DEPLOYER_ROLE signers set once.
 *
 * Earn acceptance test 27 is not written down in docs/audit/specs/earn-contract-requirements.md
 * yet; these tests are written from the owner's rules for the lane:
 * - only the registered funder may use it, and only to the registered deployment account;
 * - its cap per period, set by two DEPLOYER_ROLE signers, holds;
 * - it may deploy above the posted Pool Tier principal by the Settlement Headroom, while the
 *   two-person `deploy` keeps the principal alone;
 * - every other `deploy` condition applies (no open queue request, no Suspension, no pending loss
 *   charge, Utilization at most 90% afterwards, before Final Maturity);
 * - one DEPLOYER_ROLE or CCO_ROLE holder stops it at once; restarting it takes two;
 * - it is a recorded Deployment, brought back by `returnFunds`.
 */

const WEEK = 7 * DAY;
const PRINCIPAL = U(20_000);
const CAP = U(5_000);
const HEADROOM = U(1_000);
const ref = (n: number | string) => ethers.id(`settlement ${n}`);

describe("Settlement Funding lane (decision 54; IV-02 §4.3A)", function () {
  let f: Awaited<ReturnType<typeof deployYieldPool>>;
  let pool: any, usdc: any, funder: any;

  /** The lane, as the pool reports it. */
  async function lane() {
    const l = await pool.settlementLane();
    return {
      funder: l.funder as string, cap: l.capPerPeriod as bigint, period: l.periodSeconds as bigint, start: l.periodStart as bigint,
      used: l.usedInPeriod as bigint, stopped: l.stopped as boolean, epoch: l.epoch as bigint, headroom: l.headroom as bigint,
    };
  }

  async function setFunder(who = funder.address, cap = CAP, period = WEEK) {
    return f.two(f.d1, f.d2, "setSettlementFunder", who, cap, period);
  }

  beforeEach(async function () {
    f = await deployYieldPool();
    pool = f.pool;
    usdc = f.usdc;
    funder = (await ethers.getSigners())[16];
    await pool.connect(f.alice).deposit(U(100_000), f.alice.address);
    await postTierCap(pool, f.v1, f.v2, PRINCIPAL);
  });

  describe("happy path", function () {
    it("the registered funder deploys alone to the registered account, recorded like a Deployment and returned by returnFunds", async function () {
      await setFunder();
      await f.two(f.d1, f.d2, "setSettlementHeadroom", HEADROOM);
      const before: bigint = await usdc.balanceOf(f.lending.address);
      const tx = pool.connect(funder).deploySettlement(U(1_200), ref(1));
      await expect(tx).to.emit(pool, "Deployed").withArgs(0n, f.lending.address, U(1_200), funder.address, funder.address);
      await expect(tx).to.emit(pool, "SettlementDeployed").withArgs(0n, U(1_200), ref(1), U(1_200));
      expect(await usdc.balanceOf(f.lending.address) - before).to.equal(U(1_200));
      expect(await usdc.balanceOf(funder.address)).to.equal(0n);
      expect(await pool.deployedBalance()).to.equal(U(1_200));
      expect(await pool.deploymentCount()).to.equal(1n);
      expect(await pool.totalDeployed()).to.equal(U(1_200));
      expect((await lane()).used).to.equal(U(1_200));

      // A second one in the same period counts toward the same cap, and shares the deployment ids.
      await expect(pool.connect(funder).deploySettlement(U(300), ref(2)))
        .to.emit(pool, "SettlementDeployed").withArgs(1n, U(300), ref(2), U(1_500));
      await f.deploy(U(100));
      expect(await pool.deploymentCount()).to.equal(3n);

      // Unused Settlement Funding comes back as a Return: interest first, then the Deployed Balance.
      await increase(DAY);
      await pool.connect(f.lending).returnFunds(U(1_600) + U(1));
      expect(await pool.deployedBalance()).to.be.lessThan(U(1_600));
      expect(await pool.accruedInterest()).to.equal(0n);
      // Returning does not give the period's cap back: it counts what was deployed.
      expect((await lane()).used).to.equal(U(1_500));
    });

    it("emits the setting events with both signers, and reports the lane", async function () {
      await expect(pool.connect(f.d1).setSettlementFunder(funder.address, CAP, WEEK)).to.emit(pool, "ActionProposed");
      expect((await lane()).funder).to.equal(ethers.ZeroAddress);
      await expect(pool.connect(f.d2).setSettlementFunder(funder.address, CAP, WEEK))
        .to.emit(pool, "SettlementFunderSet").withArgs(funder.address, CAP, WEEK, f.d1.address, f.d2.address);
      const t = await latest();
      await pool.connect(f.d2).setSettlementHeadroom(HEADROOM);
      await expect(pool.connect(f.d1).setSettlementHeadroom(HEADROOM))
        .to.emit(pool, "SettlementHeadroomSet").withArgs(HEADROOM, f.d2.address, f.d1.address);
      expect(await lane()).to.deep.equal({
        funder: funder.address, cap: CAP, period: BigInt(WEEK), start: BigInt(t), used: 0n, stopped: false, epoch: 0n, headroom: HEADROOM,
      });
      await expect(pool.connect(f.cco).stopSettlementFunder())
        .to.emit(pool, "SettlementFunderStopped").withArgs(funder.address, f.cco.address);
      expect((await lane()).stopped).to.equal(true);
      expect((await lane()).epoch).to.equal(1n);
    });
  });

  describe("who may use it, and where the money goes", function () {
    it("refuses everyone but the registered funder, before and after one is registered", async function () {
      for (const who of [funder, f.d1, f.outsider]) {
        await expect(pool.connect(who).deploySettlement(U(1), ref(1)))
          .to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized").withArgs(who.address);
      }
      await setFunder();
      for (const who of [f.admin, f.d1, f.d2, f.cco, f.v1, f.lending, f.outsider]) {
        await expect(pool.connect(who).deploySettlement(U(1), ref(1)))
          .to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized").withArgs(who.address);
      }
      // A new funder replaces the old one.
      await setFunder(f.outsider.address);
      await expect(pool.connect(funder).deploySettlement(U(1), ref(1))).to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
      await pool.connect(f.outsider).deploySettlement(U(1), ref(1));
    });

    it("has no destination to choose: it pays the registered deployment account, which only governance changes", async function () {
      const fn = pool.interface.getFunction("deploySettlement");
      expect(fn.inputs.map((i: any) => i.type)).to.deep.equal(["uint256", "bytes32"]);
      await setFunder();
      await expect(pool.connect(funder).setDeploymentAccount(funder.address)).to.be.reverted;
      await pool.connect(funder).deploySettlement(U(10), ref(1));
      expect(await usdc.balanceOf(funder.address)).to.equal(0n);
      // Governance (the Earn timelock) moves the account; the lane follows it.
      await pool.connect(f.admin).setDeploymentAccount(f.destination.address);
      const before: bigint = await usdc.balanceOf(f.destination.address);
      await pool.connect(funder).deploySettlement(U(10), ref(2));
      expect(await usdc.balanceOf(f.destination.address) - before).to.equal(U(10));
      expect(await usdc.balanceOf(funder.address)).to.equal(0n);
    });

    it("refuses an empty amount or reference", async function () {
      await setFunder();
      await expect(pool.connect(funder).deploySettlement(0, ref(1))).to.be.revertedWithCustomError(pool, "LendingPoolInvalidAmount");
      await expect(pool.connect(funder).deploySettlement(U(1), ethers.ZeroHash)).to.be.revertedWithCustomError(pool, "LendingPoolInvalidAmount");
    });

    it("only two DEPLOYER_ROLE signers set the funder and the headroom, with sane values", async function () {
      for (const who of [f.cco, f.v1, f.outsider, funder, f.admin]) {
        await expect(pool.connect(who).setSettlementFunder(funder.address, CAP, WEEK)).to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
        await expect(pool.connect(who).setSettlementHeadroom(HEADROOM)).to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
      }
      await pool.connect(f.d1).setSettlementFunder(funder.address, CAP, WEEK);
      await expect(pool.connect(f.d1).setSettlementFunder(funder.address, CAP, WEEK)).to.be.revertedWithCustomError(pool, "LendingPoolSameSigner");
      await pool.connect(f.d1).setSettlementHeadroom(HEADROOM);
      await expect(pool.connect(f.d1).setSettlementHeadroom(HEADROOM)).to.be.revertedWithCustomError(pool, "LendingPoolSameSigner");
      // A different value is a different proposal: nothing is applied.
      await pool.connect(f.d2).setSettlementFunder(funder.address, CAP + 1n, WEEK);
      await pool.connect(f.d2).setSettlementHeadroom(HEADROOM + 1n);
      expect(await lane()).to.include({ funder: ethers.ZeroAddress, headroom: 0n });
      await expect(pool.connect(f.d1).setSettlementFunder(ethers.ZeroAddress, CAP, WEEK)).to.be.revertedWithCustomError(pool, "LendingPoolInvalidAddress");
      await expect(pool.connect(f.d1).setSettlementFunder(funder.address, 0, WEEK)).to.be.revertedWithCustomError(pool, "LendingPoolInvalidAmount");
      await expect(pool.connect(f.d1).setSettlementFunder(funder.address, CAP, 0)).to.be.revertedWithCustomError(pool, "LendingPoolInvalidAmount");
    });
  });

  describe("the cap per period", function () {
    beforeEach(async function () {
      await setFunder();
    });

    it("holds within a period, and renews at each period boundary counted from when it was set", async function () {
      const { start } = await lane();
      await pool.connect(funder).deploySettlement(U(3_000), ref(1));
      await expect(pool.connect(funder).deploySettlement(U(2_000) + 1n, ref(2)))
        .to.be.revertedWithCustomError(pool, "LendingPoolSettlementCap").withArgs(U(3_000), CAP, U(2_000) + 1n);
      await pool.connect(funder).deploySettlement(U(2_000), ref(3));
      await expect(pool.connect(funder).deploySettlement(1n, ref(4))).to.be.revertedWithCustomError(pool, "LendingPoolSettlementCap");

      // Its last second is still the same period.
      await setNext(Number(start) + WEEK - 1);
      await expect(pool.connect(funder).deploySettlement(1n, ref(5))).to.be.revertedWithCustomError(pool, "LendingPoolSettlementCap");
      await setNext(Number(start) + WEEK);
      await ethers.provider.send("evm_mine", []);
      expect(await lane()).to.include({ start: start + BigInt(WEEK), used: 0n });
      await expect(pool.connect(funder).deploySettlement(CAP, ref(6))).to.emit(pool, "SettlementDeployed").withArgs(2n, CAP, ref(6), CAP);
      await expect(pool.connect(funder).deploySettlement(1n, ref(7))).to.be.revertedWithCustomError(pool, "LendingPoolSettlementCap");

      // Periods skipped while idle: the next one starts on the boundary, not at the call.
      await setNext(Number(start) + 3 * WEEK + 5 * DAY);
      await pool.connect(funder).deploySettlement(U(100), ref(8));
      expect(await lane()).to.include({ start: start + BigInt(3 * WEEK), used: U(100) });
    });

    it("a refused Deployment uses none of the cap", async function () {
      await pool.connect(f.alice).requestWithdrawal(U(1), f.alice.address);
      await expect(pool.connect(funder).deploySettlement(U(1_000), ref(1))).to.be.revertedWithCustomError(pool, "LendingPoolQueueOpen");
      expect((await lane()).used).to.equal(0n);
    });

    it("setting the lane again never adds to the period running; a lower cap may already be used up", async function () {
      await pool.connect(funder).deploySettlement(U(4_000), ref(1));
      const { start } = await lane();
      await setFunder(funder.address, U(6_000), WEEK);
      expect(await lane()).to.include({ start, used: U(4_000), cap: U(6_000) });
      await expect(pool.connect(funder).deploySettlement(U(2_000) + 1n, ref(2))).to.be.revertedWithCustomError(pool, "LendingPoolSettlementCap");
      await setFunder(funder.address, U(3_000), WEEK);
      await expect(pool.connect(funder).deploySettlement(1n, ref(3)))
        .to.be.revertedWithCustomError(pool, "LendingPoolSettlementCap").withArgs(U(4_000), U(3_000), 1n);
      // A new funder in the same period inherits the period's use too.
      await setFunder(f.outsider.address, U(5_000), WEEK);
      await expect(pool.connect(f.outsider).deploySettlement(U(1_000) + 1n, ref(4))).to.be.revertedWithCustomError(pool, "LendingPoolSettlementCap");
      await pool.connect(f.outsider).deploySettlement(U(1_000), ref(5));
      // Once the period is over, a setting starts a new one from then.
      await increase(WEEK);
      await setFunder(f.outsider.address, U(5_000), 2 * WEEK);
      const now = BigInt(await latest());
      expect(await lane()).to.include({ start: now, used: 0n, period: BigInt(2 * WEEK) });
    });
  });

  describe("the Settlement Headroom and the posted Pool Tier principal", function () {
    beforeEach(async function () {
      await setFunder(funder.address, U(50_000), WEEK);
    });

    it("lets the lane, and only the lane, go above the principal by the headroom", async function () {
      // Two-person deploy: the principal alone.
      await expect(f.deploy(PRINCIPAL + 1n)).to.be.revertedWithCustomError(pool, "LendingPoolTierCap").withArgs(PRINCIPAL + 1n, PRINCIPAL);
      await f.deploy(U(19_000));
      // No headroom yet: the lane is held to the principal too.
      await expect(pool.connect(funder).deploySettlement(U(1_000) + 1n, ref(1)))
        .to.be.revertedWithCustomError(pool, "LendingPoolTierCap").withArgs(PRINCIPAL + 1n, PRINCIPAL);
      await f.two(f.d1, f.d2, "setSettlementHeadroom", HEADROOM);
      await expect(pool.connect(funder).deploySettlement(U(2_000) + 1n, ref(2)))
        .to.be.revertedWithCustomError(pool, "LendingPoolTierCap").withArgs(PRINCIPAL + HEADROOM + 1n, PRINCIPAL + HEADROOM);
      await pool.connect(funder).deploySettlement(U(2_000), ref(3));
      expect(await pool.deployedBalance()).to.equal(PRINCIPAL + HEADROOM);
      // Above the principal, two people can deploy nothing more; the headroom is not theirs.
      await expect(f.deploy(1n)).to.be.revertedWithCustomError(pool, "LendingPoolTierCap").withArgs(PRINCIPAL + HEADROOM + 1n, PRINCIPAL);
      // A Return below the principal opens both again.
      await pool.connect(f.lending).returnFunds(U(2_500));
      await f.deploy(U(100));
    });

    it("is the latest posted principal plus the headroom: a principal of 0 leaves the lane only the headroom", async function () {
      await f.two(f.d1, f.d2, "setSettlementHeadroom", HEADROOM);
      await postTierCap(pool, f.v1, f.v2, 0n);
      await expect(f.deploy(1n)).to.be.revertedWithCustomError(pool, "LendingPoolTierCap").withArgs(1n, 0n);
      await expect(pool.connect(funder).deploySettlement(HEADROOM + 1n, ref(1)))
        .to.be.revertedWithCustomError(pool, "LendingPoolTierCap").withArgs(HEADROOM + 1n, HEADROOM);
      await pool.connect(funder).deploySettlement(HEADROOM, ref(2));
    });
  });

  describe("every other deploy condition", function () {
    beforeEach(async function () {
      await setFunder(funder.address, U(1_000_000), WEEK);
      await postTierCap(pool, f.v1, f.v2, U(1_000_000));
    });

    it("refuses while a queue request is open", async function () {
      await pool.connect(f.alice).requestWithdrawal(U(1), f.alice.address);
      await expect(pool.connect(funder).deploySettlement(U(100), ref(1))).to.be.revertedWithCustomError(pool, "LendingPoolQueueOpen");
    });

    it("refuses during a Suspension, and works once it is lifted", async function () {
      await f.two(f.s1, f.cco, "suspend", LOSS_EVENT, EVIDENCE, ethers.ZeroHash);
      await expect(pool.connect(funder).deploySettlement(U(100), ref(1))).to.be.revertedWithCustomError(pool, "LendingPoolSuspended");
      await increase(72 * 3600);
      await pool.connect(funder).deploySettlement(U(100), ref(2));
    });

    it("refuses while a loss charge is pending", async function () {
      await f.deploy(U(10_000));
      await f.allowanceForBps(150n);
      await pool.connect(f.alice).redeem(U(1_000), f.alice.address, f.alice.address); // records a holdback
      await f.lossCharge(U(100));
      expect((await pool.pendingLossCharge()).pending).to.equal(true);
      await expect(pool.connect(funder).deploySettlement(U(100), ref(1))).to.be.revertedWithCustomError(pool, "LendingPoolChargePending");
      await pool.applyHoldbacks(10);
      await pool.connect(funder).deploySettlement(U(100), ref(2));
    });

    it("refuses above 90% Utilization afterwards, and more than Vault Cash", async function () {
      await expect(pool.connect(funder).deploySettlement(U(90_000) + 1n, ref(1))).to.be.revertedWithCustomError(pool, "LendingPoolUtilizationCap");
      await pool.connect(funder).deploySettlement(U(90_000), ref(2));
      expect(await pool.utilization()).to.equal(ethers.parseUnits("0.9", 18));
      await expect(pool.connect(funder).deploySettlement(1n, ref(3))).to.be.revertedWithCustomError(pool, "LendingPoolUtilizationCap");
      await expect(pool.connect(funder).deploySettlement(U(10_000) + 1n, ref(4))).to.be.revertedWithCustomError(pool, "LendingPoolInsufficientCash");
    });

    it("refuses from Final Maturity", async function () {
      await setNext(Number(await pool.finalMaturity()));
      await expect(pool.connect(funder).deploySettlement(U(100), ref(1))).to.be.revertedWithCustomError(pool, "LendingPoolFinalMaturity");
    });

    it("refuses with no registered deployment account", async function () {
      const slot = await findDeploymentAccountSlot(pool, f.lending.address);
      await ethers.provider.send("hardhat_setStorageAt", [f.poolAddress, ethers.toQuantity(slot), ethers.ZeroHash]);
      expect(await pool.deploymentAccount()).to.equal(ethers.ZeroAddress);
      await expect(pool.connect(funder).deploySettlement(U(100), ref(1))).to.be.revertedWithCustomError(pool, "LendingPoolInvalidAddress");
    });
  });

  describe("the immediate stop", function () {
    beforeEach(async function () {
      await setFunder();
    });

    it("one DEPLOYER_ROLE or CCO_ROLE holder stops it; nobody else can", async function () {
      for (const who of [funder, f.v1, f.s1, f.outsider, f.admin, f.lending]) {
        await expect(pool.connect(who).stopSettlementFunder()).to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized").withArgs(who.address);
      }
      await expect(pool.connect(f.d2).stopSettlementFunder()).to.emit(pool, "SettlementFunderStopped").withArgs(funder.address, f.d2.address);
      await expect(pool.connect(funder).deploySettlement(U(1), ref(1))).to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
      // Stopping a stopped lane is harmless, and the CCO can too.
      await expect(pool.connect(f.cco).stopSettlementFunder()).to.emit(pool, "SettlementFunderStopped").withArgs(funder.address, f.cco.address);
      expect(await lane()).to.include({ stopped: true, epoch: 2n, funder: funder.address });
    });

    it("restarting takes two DEPLOYER_ROLE signers, both after the stop", async function () {
      await pool.connect(funder).deploySettlement(U(1_000), ref(1));
      // A proposal made before the stop ...
      await pool.connect(f.d1).setSettlementFunder(funder.address, CAP, WEEK);
      await pool.connect(f.cco).stopSettlementFunder();
      // ... is not a signature after it: the second signer's call only proposes again.
      await expect(pool.connect(f.d2).setSettlementFunder(funder.address, CAP, WEEK)).to.emit(pool, "ActionProposed").and.not.to.emit(pool, "SettlementFunderSet");
      await expect(pool.connect(funder).deploySettlement(U(1), ref(2))).to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
      // The CCO cannot restart it.
      await expect(pool.connect(f.cco).setSettlementFunder(funder.address, CAP, WEEK)).to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
      await expect(pool.connect(f.d1).setSettlementFunder(funder.address, CAP, WEEK))
        .to.emit(pool, "SettlementFunderSet").withArgs(funder.address, CAP, WEEK, f.d2.address, f.d1.address);
      expect((await lane()).stopped).to.equal(false);
      // The period running kept what was used before the stop.
      expect((await lane()).used).to.equal(U(1_000));
      await pool.connect(funder).deploySettlement(U(4_000), ref(3));
      await expect(pool.connect(funder).deploySettlement(1n, ref(4))).to.be.revertedWithCustomError(pool, "LendingPoolSettlementCap");
    });

    it("leaves two-person Deployments and Returns alone", async function () {
      await pool.connect(f.d1).stopSettlementFunder();
      await f.deploy(U(500));
      await pool.connect(f.lending).returnFunds(U(500));
    });
  });

  /*
   * Fuzz: the cap per period against a model, over random amounts, random waits (within a period,
   * across one, across several) and the lane re-set mid-period with a new cap or period. The model
   * says which calls must succeed; every one the model refuses must revert with the cap error, and
   * the lane's view must match the model after every step. Fixed seeds, so a failure reproduces.
   */
  describe("fuzz: cap and period", function () {
    for (const seed of [54, 2027, 777]) {
      it(`matches the model (seed ${seed})`, async function () {
        this.timeout(300_000);
        const rnd = prng(seed);
        await postTierCap(pool, f.v1, f.v2, U(10_000_000));
        await pool.connect(f.bob).deposit(U(900_000), f.bob.address);
        let cap = U(1_000 + Math.floor(rnd() * 9_000));
        let period = (1 + Math.floor(rnd() * 13)) * DAY + Math.floor(rnd() * 3600);
        await setFunder(funder.address, cap, period);
        // The model holds what the pool stores: the period last used and its use.
        let start = BigInt(await latest());
        let used = 0n;
        const project = (now: bigint) => (now >= start + BigInt(period)
          ? { start: start + ((now - start) / BigInt(period)) * BigInt(period), used: 0n }
          : { start, used });
        let n = 0, sent = 0, refused = 0;
        for (let step = 0; step < 40; step++) {
          const r = rnd();
          if (r < 0.25) {
            // Wait: within the period, about one, or several.
            const w = rnd();
            const secs = w < 0.5 ? Math.floor(rnd() * period * 0.5) : w < 0.85 ? period + Math.floor(rnd() * 60) - 30 : Math.floor(rnd() * 4 * period);
            await increase(Math.max(1, secs));
          } else if (r < 0.32) {
            // Two deployers set the lane again, possibly with a new cap or period.
            const newCap = rnd() < 0.5 ? cap : U(500 + Math.floor(rnd() * 9_500));
            const newPeriod = rnd() < 0.5 ? period : (1 + Math.floor(rnd() * 13)) * DAY;
            await pool.connect(f.d1).setSettlementFunder(funder.address, newCap, newPeriod);
            await pool.connect(f.d2).setSettlementFunder(funder.address, newCap, newPeriod);
            const now = BigInt(await latest());
            if (now >= start + BigInt(period)) {
              start = now;
              used = 0n;
            }
            cap = newCap;
            period = newPeriod;
          } else {
            // A Deployment of a random size, often right at what is left.
            const at = BigInt(await latest()) + 1n;
            const p = project(at);
            const left = cap > p.used ? cap - p.used : 0n;
            const nudge = BigInt(Math.floor(rnd() * 3) - 1);
            const amount = rnd() < 0.35 ? left + nudge : BigInt(Math.floor(rnd() * Number(cap) * 0.6)) + 1n;
            if (amount <= 0n) continue;
            await setNext(Number(at));
            const call = pool.connect(funder).deploySettlement(amount, ref(`${seed}-${n++}`));
            if (p.used <= cap && amount <= cap - p.used) {
              await expect(call).to.emit(pool, "SettlementDeployed").withArgs(anyId, amount, anyRef, p.used + amount);
              start = p.start;
              used = p.used + amount;
              sent++;
            } else {
              await expect(call).to.be.revertedWithCustomError(pool, "LendingPoolSettlementCap").withArgs(p.used, cap, amount);
              // Mine the block the refused call was timed for, so the clock is where the model put it.
              await ethers.provider.send("evm_mine", []);
              refused++;
            }
          }
          const l = await lane();
          const m = project(BigInt(await latest()));
          expect({ start: l.start, used: l.used, cap: l.cap, period: l.period }, `seed ${seed} step ${step}`)
            .to.deep.equal({ start: m.start, used: m.used, cap, period: BigInt(period) });
        }
        // Both sides of the cap were exercised.
        expect(sent, "accepted").to.be.greaterThan(3);
        expect(refused, "refused").to.be.greaterThan(0);
      });
    }
  });
});

const anyId = (v: unknown) => typeof v === "bigint";
const anyRef = (v: unknown) => typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v);

/** The storage slot holding the registered deployment account (read by value, so it never drifts). */
async function findDeploymentAccountSlot(pool: any, account: string): Promise<string> {
  const at = await pool.getAddress();
  const want = ethers.zeroPadValue(account.toLowerCase(), 32);
  for (let i = 360; i < 420; i++) {
    const slot = ethers.toBeHex(i, 32);
    if ((await ethers.provider.getStorage(at, slot)).toLowerCase() === want.toLowerCase()) return slot;
  }
  throw new Error("deployment account slot not found");
}
