import { expect } from "chai";
import { ethers } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";
import { deployYieldPool } from "../helpers/yieldPool";
import { deployAssurancePool, fund, balances, TAG, BACKSTOP, AssuranceSetup } from "../helpers/assurance";

const ONE_USDC = 10n ** 6n;

// The waterfall has an order, and the order is the whole point. Depositors in the LendingPool earn
// the return on unsecured lending, so they carry its first loss. What they cannot take is Lending
// Co.'s charge-off, and the co-op's Credit Backstop stands behind THAT under the I-11 agreement --
// reached only by Lending Co.'s own draw request, approved by one co-op signer and released by
// another (section 13). It is an ordering fact, not a wire between the two pools: neither holds
// the other's address, and nothing in the LendingPool can move a compartment.
//
// Phase 2f: the LendingPool is the Yield Pool. A loss reaches it only as a two-person Pool Loss
// Charge (Earn §6), never above its Pool Assets and holdbacks, so there is no "uncovered" figure
// for the pool to report: what it cannot take is Lending Co.'s own charge-off, as before.
describe("first loss ordering", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let pool: any, a: AssuranceSetup, y: Awaited<ReturnType<typeof deployYieldPool>>;
  let depositor: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();

    // The co-op's AssurancePool standing behind Lending Co. Set up first: its governance waits
    // out the timelock, and the loan below should not age through that.
    a = await deployAssurancePool(ctx.usdc, ctx.networkRegistry);
    await fund(a, ctx.usdc, a.lendingCo, TAG.RECOVERY, 2_000n * ONE_USDC);

    // Changed (decision 17): the money goes out as a two-person Deployment to Clear Lending, not
    // a borrower's draw, and a loss is a two-person Pool Loss Charge, not `absorbLoss`.
    y = await deployYieldPool({ usdc: ctx.usdc });
    pool = y.pool;
    depositor = y.alice;
    await pool.connect(depositor).deposit(1_000n * ONE_USDC, depositor.address);
    // At most 90% can be deployed (Earn §6, FIXED).
    await y.deploy(900n * ONE_USDC);
  });

  /// The waterfall's first step: a Pool Loss Charge, which the pool takes up to its Pool Assets.
  async function applyLoss(amount: bigint) {
    await y.lossCharge(amount);
  }

  it("takes a loss the pool can cover without touching the AssurancePool", async function () {
    const before = await balances(a.pool);

    await applyLoss(400n * ONE_USDC);

    expect(await pool.deployedBalance()).to.equal(500n * ONE_USDC);
    expect((await balances(a.pool)).byId).to.deep.equal(before.byId);
    // The depositors wear it.
    expect(await pool.totalAssets()).to.be.closeTo(600n * ONE_USDC, ONE_USDC / 100n);
  });

  it("escalates only what first loss could not reach, and only through Lending Co.'s draw", async function () {
    const before = await balances(a.pool);
    // Changed: the pool cannot be charged more than it has; the charge is refused, not split.
    await pool.connect(y.v1).postLossCharge(1_500n * ONE_USDC, ethers.id("loss"));
    await expect(pool.connect(y.v2).postLossCharge(1_500n * ONE_USDC, ethers.id("loss")))
      .to.be.revertedWithCustomError(pool, "LendingPoolInvalidAmount");
    await applyLoss(1_000n * ONE_USDC);
    expect(await pool.deployedBalance()).to.equal(0n);
    const uncovered = 500n * ONE_USDC;
    // Charging the pool moves nothing in the AssurancePool.
    expect((await balances(a.pool)).byId).to.deep.equal(before.byId);

    // The remainder is Lending Co.'s charge-off: it asks, one signer approves, another releases.
    await a.pool.connect(a.signerA).setFloorInputs(0n, 10_000n * ONE_USDC, 0n, ethers.id("m1"));
    await a.pool.connect(a.signerB).setFloorInputs(0n, 10_000n * ONE_USDC, 0n, ethers.id("m1"));
    await a.pool.connect(a.drawer).requestDraw(1, uncovered, ethers.id("charge-off"));
    await a.pool.connect(a.signerA).approveDraw(0, uncovered);
    await a.pool.connect(a.signerB).releaseDraw(0);
    expect(await ctx.usdc.balanceOf(a.lossReserve.address)).to.equal(500n * ONE_USDC);
    expect(await a.pool.balanceOf(BACKSTOP)).to.equal(1_500n * ONE_USDC);
  });

  it("exhausts the pool before anything reaches the next layer", async function () {
    const before = await balances(a.pool);

    await applyLoss(1_000n * ONE_USDC);
    expect(await pool.totalBorrowed()).to.equal(0n);
    expect((await balances(a.pool)).byId).to.deep.equal(before.byId);

    // Only interest is left; a charge beyond what the pool holds is refused, and is Lending Co.'s.
    const left: bigint = await pool.totalAssets();
    await pool.connect(y.v1).postLossCharge(left + 300n * ONE_USDC, ethers.id("loss-2"));
    await expect(pool.connect(y.v2).postLossCharge(left + 300n * ONE_USDC, ethers.id("loss-2")))
      .to.be.revertedWithCustomError(pool, "LendingPoolInvalidAmount");
  });

  it("keeps the two pools apart: neither counts the other's money", async function () {
    // A healthy LendingPool must not make the backstop look deeper than it is, or it would be
    // counting money already committed to absorbing a different loss.
    await ctx.usdc.mint(await pool.getAddress(), 5_000n * ONE_USDC);

    expect(await a.pool.backstopBalance()).to.equal(2_000n * ONE_USDC);
    expect((await balances(a.pool)).sum).to.equal(2_000n * ONE_USDC);
  });

  it("does not let the AssurancePool refill the pool either, nor the pool pay into it", async function () {
    // Was: the reserve's withdrawal path is gated to instruments the admin names. The new pool has
    // no withdrawal path at all, and refuses a deposit from a money-path contract.
    expect(a.pool.interface.getFunction("withdraw", [1n])).to.equal(null);
    await ctx.networkRegistry.listMoneyPath(await pool.getAddress(), ethers.encodeBytes32String("LENDING_POOL"));
    expect(await ctx.networkRegistry.isMoneyPath(await pool.getAddress())).to.equal(true);
  });
});
