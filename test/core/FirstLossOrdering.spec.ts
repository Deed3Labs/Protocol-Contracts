import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;

// The waterfall has an order, and the order is the whole point. Depositors in the LendingPool earn
// the return on unsecured lending, so they carry its first loss; the AssurancePool is what stands
// behind them once they are exhausted. It is an ordering fact rather than a reserve arrangement,
// which is why the AssurancePool never registers the pool as a reserve source.
describe("first loss ordering", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let pool: any;
  let depositor: any, borrower: any, instrument: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [depositor, borrower] = [signers[8], signers[9]];
    instrument = ctx.instrument;

    const LendingPool = await ethers.getContractFactory("LendingPool");
    pool = await upgrades.deployProxy(
      LendingPool,
      [ctx.admin.address, await ctx.usdc.getAddress(), "Clear Lending Pool", "clrLP"],
      { kind: "uups" }
    );
    await pool.grantRole(await pool.BORROWER_ROLE(), borrower.address);
    await pool.grantRole(await pool.LOSS_REPORTER_ROLE(), ctx.admin.address);

    await ctx.usdc.mint(depositor.address, 10_000n * ONE_USDC);
    await ctx.usdc.connect(depositor).approve(await pool.getAddress(), 10_000n * ONE_USDC);
    await pool.connect(depositor).deposit(1_000n * ONE_USDC, depositor.address);
    await pool.connect(borrower).borrow(1_000n * ONE_USDC, borrower.address);

    // The AssurancePool standing behind it.
    await ctx.usdc.mint(ctx.admin.address, 5_000n * ONE_USDC);
    await ctx.usdc.approve(await ctx.assurancePool.getAddress(), 5_000n * ONE_USDC);
    await ctx.assurancePool.depositIntoPrimaryReserve(2_000n * ONE_USDC);
  });

  /// The waterfall: offer the loss to first loss, and escalate only what it could not take.
  async function applyLoss(amount: bigint) {
    const [absorbed, uncovered] = await pool.absorbLoss.staticCall(amount);
    await pool.absorbLoss(amount);
    return { absorbed, uncovered };
  }

  it("takes a loss the pool can cover without touching the AssurancePool", async function () {
    const reserveBefore = await ctx.assurancePool.reserveBalance();

    const { absorbed, uncovered } = await applyLoss(400n * ONE_USDC);

    expect(absorbed).to.equal(400n * ONE_USDC);
    expect(uncovered).to.equal(0n);
    expect(await ctx.assurancePool.reserveBalance()).to.equal(reserveBefore);
    // The depositors wear it.
    expect(await pool.totalAssets()).to.equal(600n * ONE_USDC);
  });

  it("escalates only what first loss could not reach", async function () {
    const { absorbed, uncovered } = await applyLoss(1_500n * ONE_USDC);

    expect(absorbed).to.equal(1_000n * ONE_USDC);
    expect(uncovered).to.equal(500n * ONE_USDC);
    // The AssurancePool is asked for the remainder, and only the remainder.
    expect(uncovered).to.be.lessThan(1_500n * ONE_USDC);
  });

  it("exhausts the pool before the reserve moves at all", async function () {
    const reserveBefore = await ctx.assurancePool.reserveBalance();

    await applyLoss(1_000n * ONE_USDC);
    expect(await pool.totalBorrowed()).to.equal(0n);
    expect(await ctx.assurancePool.reserveBalance()).to.equal(reserveBefore);

    // Only now does anything reach the next layer.
    const { absorbed, uncovered } = await applyLoss(300n * ONE_USDC);
    expect(absorbed).to.equal(0n);
    expect(uncovered).to.equal(300n * ONE_USDC);
  });

  it("keeps the two pools apart: neither is a reserve source for the other", async function () {
    // RTD reads the AssurancePool and nothing else. A healthy LendingPool must not make the
    // reserve look deeper than it is, or the reserve would be counting money that is already
    // committed to absorbing a different loss.
    await ctx.usdc.mint(await pool.getAddress(), 5_000n * ONE_USDC);

    const held = await ctx.assurancePool.heldReserveValue();
    expect(await ctx.assurancePool.reserveBalance()).to.equal(2_000n * ONE_USDC);
    expect(held).to.equal(2_000n * ONE_USDC);
  });

  it("does not let the AssurancePool refill the pool either", async function () {
    // The AssurancePool's withdrawal path is gated to instruments, and the LendingPool draw is
    // one of them -- but only once somebody wires it in, and never by default.
    expect(await ctx.assurancePool.withdrawalCallers(await pool.getAddress())).to.equal(false);
    await expect(
      ctx.assurancePool.connect(ctx.admin).withdraw(1n * ONE_USDC)
    ).to.be.revertedWithCustomError(ctx.assurancePool, "AssurancePoolUnauthorizedWithdrawal");
  });
});
