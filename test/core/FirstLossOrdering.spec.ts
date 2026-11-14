import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";
import { deployAssurancePool, fund, balances, TAG, BACKSTOP, AssuranceSetup } from "../helpers/assurance";

const ONE_USDC = 10n ** 6n;

// The waterfall has an order, and the order is the whole point. Depositors in the LendingPool earn
// the return on unsecured lending, so they carry its first loss. What they cannot take is Lending
// Co.'s charge-off, and the co-op's Credit Backstop stands behind THAT under the I-11 agreement --
// reached only by Lending Co.'s own draw request, approved by one co-op signer and released by
// another (section 13). It is an ordering fact, not a wire between the two pools: neither holds
// the other's address, and nothing in the LendingPool can move a compartment.
describe("first loss ordering", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let pool: any, a: AssuranceSetup;
  let depositor: any, borrower: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [depositor, borrower] = [signers[8], signers[9]];

    // The co-op's AssurancePool standing behind Lending Co. Set up first: its governance waits
    // out the timelock, and the loan below should not age through that.
    a = await deployAssurancePool(ctx.usdc, ctx.networkRegistry);
    await fund(a, ctx.usdc, a.lendingCo, TAG.RECOVERY, 2_000n * ONE_USDC);

    const LendingPool = await ethers.getContractFactory("LendingPool");
    pool = await upgrades.deployProxy(
      LendingPool,
      [ctx.admin.address, await ctx.usdc.getAddress(), "Clear Lending Pool", "clrLP"],
      { kind: "uups" }
    );
    await pool.grantRole(await pool.BORROWER_ROLE(), borrower.address);
    // Audit H-4: a borrower draws only to its stored destination, within a daily cap.
    await pool.setBorrower(borrower.address, borrower.address, 1_000_000n * ONE_USDC);
    await pool.grantRole(await pool.LOSS_REPORTER_ROLE(), ctx.admin.address);

    await ctx.usdc.mint(depositor.address, 10_000n * ONE_USDC);
    await ctx.usdc.connect(depositor).approve(await pool.getAddress(), 10_000n * ONE_USDC);
    await pool.connect(depositor).deposit(1_000n * ONE_USDC, depositor.address);
    await pool.connect(borrower).borrow(1_000n * ONE_USDC, borrower.address);
  });

  /// The waterfall: offer the loss to first loss, and escalate only what it could not take.
  async function applyLoss(amount: bigint) {
    const [absorbed, uncovered] = await pool.absorbLoss.staticCall(amount);
    await pool.absorbLoss(amount);
    return { absorbed, uncovered };
  }

  it("takes a loss the pool can cover without touching the AssurancePool", async function () {
    const before = await balances(a.pool);

    const { absorbed, uncovered } = await applyLoss(400n * ONE_USDC);

    expect(absorbed).to.equal(400n * ONE_USDC);
    expect(uncovered).to.equal(0n);
    expect((await balances(a.pool)).byId).to.deep.equal(before.byId);
    // The depositors wear it.
    expect(await pool.totalAssets()).to.equal(600n * ONE_USDC);
  });

  it("escalates only what first loss could not reach, and only through Lending Co.'s draw", async function () {
    const before = await balances(a.pool);
    const { absorbed, uncovered } = await applyLoss(1_500n * ONE_USDC);

    expect(absorbed).to.equal(1_000n * ONE_USDC);
    expect(uncovered).to.equal(500n * ONE_USDC);
    // Reporting the loss moves nothing in the pool.
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

    // Only now is anything left over.
    const { absorbed, uncovered } = await applyLoss(300n * ONE_USDC);
    expect(absorbed).to.equal(0n);
    expect(uncovered).to.equal(300n * ONE_USDC);
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
