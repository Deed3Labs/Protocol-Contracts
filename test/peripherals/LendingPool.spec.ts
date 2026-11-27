import { expect } from "chai";
import { ethers } from "hardhat";
import { U, DAY, deployYieldPool, increase } from "../helpers/yieldPool";

/*
 * Phase 2f: LendingPool is the Yield Pool (decision 16). This file kept its original questions and
 * now answers them for the Yield Pool. Each changed test says why. The full acceptance tests are in
 * test/earn/YieldPool.spec.ts.
 */
describe("LendingPool", function () {
  let f: Awaited<ReturnType<typeof deployYieldPool>>;
  let pool: any, usdc: any;
  let alice: any, bob: any, outsider: any;

  beforeEach(async function () {
    f = await deployYieldPool();
    ({ pool, usdc, alice, bob, outsider } = f);
  });

  async function deposit(who: any, amount: bigint) {
    await pool.connect(who).deposit(amount, who.address);
  }

  describe("it is a real ERC-4626 vault", function () {
    it("takes deposits and hands back proportional shares", async function () {
      await deposit(alice, U(1_000));
      expect(await pool.totalAssets()).to.equal(U(1_000));
      expect(await pool.convertToAssets(await pool.balanceOf(alice.address))).to.equal(U(1_000));
    });

    it("counts deployed money as an asset, because it is one", async function () {
      // Changed (decision 17): money leaves only as a recorded Deployment to Clear Lending's
      // lending account, not as a borrower's draw. It is still an asset: the Deployed Balance.
      await deposit(alice, U(1_000));
      await f.deploy(U(600));
      expect(await pool.totalAssets()).to.be.closeTo(U(1_000), 10n);
      expect(await pool.availableCash()).to.equal(U(400));
      expect(await pool.totalBorrowed()).to.equal(U(600));
      expect(await pool.deployedBalance()).to.equal(U(600));
    });

    it("reports what would actually succeed, rather than what is owned", async function () {
      await deposit(alice, U(1_000));
      await f.deploy(U(900));
      expect(await pool.maxWithdraw(alice.address)).to.be.closeTo(U(100), 1n);
      await pool.connect(alice).withdraw(U(100) - 1n, alice.address, alice.address);
      expect(await pool.maxWithdraw(alice.address)).to.be.lessThan(2n);
    });

    it("raises the Share Value as Pool Interest accrues", async function () {
      // Changed (Earn §6): interest is no longer cash that arrives and streams in over a week
      // (X-18). Clear Lending owes Pool Interest per second on the Deployed Balance, and the
      // receivable is in Pool Assets as it accrues.
      await deposit(alice, U(1_000));
      await f.deploy(U(500));
      await increase(365 * DAY);
      expect(await pool.totalAssets()).to.be.greaterThan(U(1_015));
      expect(await pool.convertToAssets(await pool.balanceOf(alice.address))).to.be.greaterThan(U(1_015));
    });
  });

  describe("the rate rises with utilization", function () {
    // Changed (IV-02 Sch. 2): an annual Funding Rate with fixed bounds and notice rules replaces
    // the per-cycle curve the operator could reshape at will.
    it("is cheapest when nothing is deployed", async function () {
      await deposit(alice, U(1_000));
      expect(await pool.utilization()).to.equal(0n);
      expect(await pool.fundingRate()).to.equal(ethers.parseUnits("0.02", 18));
    });

    it("climbs gently below the kink and steeply above it", async function () {
      const at = (x: string) => pool.fundingRateAt(ethers.parseUnits(x, 18));
      const r40 = await at("0.4"), r80 = await at("0.8"), r95 = await at("0.95");
      expect(r80).to.be.greaterThan(r40);
      expect(r95).to.be.greaterThan(r80);
      expect(r95 - r80).to.be.greaterThan(r80 - r40);
    });

    it("only governance proposes a model, within the fixed bounds", async function () {
      const p = (x: string) => ethers.parseUnits(x, 18);
      await expect(pool.connect(outsider).proposeRateModel(p("0.02"), p("0.03"), p("0.8"), p("0.05"))).to.be.reverted;
      await expect(pool.proposeRateModel(p("0.02"), p("0.03"), p("0.5"), p("0.05")))
        .to.be.revertedWithCustomError(pool, "LendingPoolInvalidRateModel");
    });
  });

  describe("the withdrawal queue", function () {
    it("queues rather than failing when the cash is deployed", async function () {
      // Changed (Earn §7, C4): the request escrows its shares in a FIFO queue; nothing is fixed in
      // assets and there is no per-request claim.
      await deposit(alice, U(1_000));
      await f.deploy(U(900));
      const shares = await pool.balanceOf(alice.address);
      await pool.connect(alice).requestWithdrawal(shares, alice.address);
      expect(await pool.balanceOf(alice.address)).to.equal(0n);
      const [owner, receiver, queued] = await pool.queueRequest(0);
      expect(owner).to.equal(alice.address);
      expect(receiver).to.equal(alice.address);
      expect(queued).to.equal(shares);
    });

    it("keeps the queued depositor earning and bearing losses, priced at fill (C4, replaces X-7)", async function () {
      // Changed: X-7 stopped a queued depositor earning and capped the claim at its value when
      // queued. The spec has queued shares keep earning and bear losses, filled at Share Value.
      await deposit(alice, U(1_000));
      await deposit(bob, U(1_000));
      await f.deploy(U(1_500));
      await pool.connect(alice).requestWithdrawal(await pool.balanceOf(alice.address), alice.address);
      await f.lossCharge(U(500));
      // Half each: 750 for Alice's queued shares, 750 for Bob's.
      expect(await pool.convertToAssets(await pool.queuedShares())).to.be.closeTo(U(750), U(0.01));
      expect(await pool.convertToAssets(await pool.balanceOf(bob.address))).to.be.closeTo(U(750), U(0.01));
    });

    it("pays out, in order, once Clear Lending returns funds", async function () {
      // Changed: fills are pushed in order by anyone (`fillQueue`) instead of claimed by each owner.
      await deposit(alice, U(1_000));
      await f.deploy(U(900));
      await pool.connect(alice).requestWithdrawal(await pool.balanceOf(alice.address), alice.address);
      await pool.connect(f.lending).returnFunds(U(1_000));
      const before = await usdc.balanceOf(alice.address);
      await pool.connect(outsider).fillQueue(10);
      expect(await usdc.balanceOf(alice.address) - before).to.be.greaterThanOrEqual(U(1_000));
      expect(await pool.queuedShares()).to.equal(0n);
    });

    it("does not deploy cash the queue is waiting for", async function () {
      // Changed: with a request open no Deployment can go out at all (Earn §6).
      await deposit(alice, U(1_000));
      await f.deploy(U(900));
      await pool.connect(alice).requestWithdrawal(await pool.balanceOf(alice.address), alice.address);
      await pool.connect(f.lending).returnFunds(U(900));
      expect(await pool.availableCash()).to.equal(0n);
      await expect(pool.connect(f.d1).deploy(1n, ethers.ZeroHash)).to.be.revertedWithCustomError(pool, "LendingPoolQueueOpen");
    });

    it("lets only the owner cancel a request", async function () {
      // Changed: there is no claim to refuse; the owner's control is cancellation.
      await deposit(alice, U(1_000));
      await pool.connect(alice).requestWithdrawal(U(500), alice.address);
      await expect(pool.connect(outsider).cancelRequest(0, U(500)))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotRequestOwner");
      await pool.connect(alice).cancelRequest(0, U(500));
      await expect(pool.connect(alice).cancelRequest(0, 1n))
        .to.be.revertedWithCustomError(pool, "LendingPoolNothingQueued");
    });
  });

  describe("first loss sits here, ahead of the AssurancePool", function () {
    // Changed (Earn §6): a loss is a two-person Pool Loss Charge with evidence, not a single
    // LOSS_REPORTER_ROLE call (`absorbLoss` is gone).
    it("takes a loss charge out of the Share Value", async function () {
      await deposit(alice, U(1_000));
      await f.deploy(U(600));
      const before = await pool.convertToAssets(await pool.balanceOf(alice.address));
      await f.lossCharge(U(200));
      expect(await pool.deployedBalance()).to.equal(U(400));
      expect(await pool.totalAssets()).to.be.closeTo(U(800), U(0.01));
      expect(await pool.convertToAssets(await pool.balanceOf(alice.address))).to.be.lessThan(before);
    });

    it("pays Clear Lending only the part above the Deployed Balance and interest, never touching the AssurancePool", async function () {
      // Changed: the old pool reported an uncovered loss and kept the cash. The spec sends the part
      // of a charge above the Deployed Balance and accrued interest to Clear Lending (§6).
      await deposit(alice, U(1_000));
      await f.deploy(U(300));
      const lending = await usdc.balanceOf(f.lending.address);
      await f.lossCharge(U(500));
      expect(await pool.deployedBalance()).to.equal(0n);
      expect(await usdc.balanceOf(f.lending.address) - lending).to.be.closeTo(U(200), U(0.01));
    });

    it("only two valuation signers can post one", async function () {
      await expect(pool.connect(outsider).postLossCharge(1n, ethers.id("e")))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
    });
  });

  describe("borrowing", function () {
    // Changed (decision 17): only Clear Lending draws, as a two-person recorded Deployment.
    it("is off for every borrower", async function () {
      await deposit(alice, U(1_000));
      await expect(pool.connect(outsider).borrow(1n, outsider.address))
        .to.be.revertedWithCustomError(pool, "LendingPoolDirectBorrowOff");
    });

    it("cannot deploy more cash than the pool holds", async function () {
      await deposit(alice, U(1_000));
      await expect(f.deploy(U(1_001))).to.be.revertedWithCustomError(pool, "LendingPoolInsufficientCash");
    });
  });
});
