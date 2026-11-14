import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../../helpers/phase0-fixture";

/*
 * Compliance addendum 12.10: the PayoutPool pays by deadline first, then by claim age among claims
 * due at the same moment. A claim's deadline is when it was queued plus the merchant's payout
 * window. Strict claim age could make a net-14 merchant miss their deadline behind older net-30
 * claims that still had weeks to run.
 */
const ONE_USDC = 10n ** 6n;
const DAY = 24 * 60 * 60;
const NET_30 = 30 * DAY;
const NET_14 = 14 * DAY;

describe("COMPLIANCE addendum 12.10: PayoutPool deadline order (acceptance 27)", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let registry: any, pool: any, yieldLender: any;
  let net30: any, net14: any, coop: any, funder: any;

  async function now() {
    return BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  }

  /** Gives `merchant` a positive balance of `amount`, from a member's spending. */
  async function sale(merchant: any, amount: bigint) {
    const buyer = ethers.Wallet.createRandom().connect(ethers.provider);
    await ethers.provider.send("hardhat_setBalance", [buyer.address, "0xde0b6b3a7640000"]);
    await ctx.creditIssuer.connect(ctx.operator).initializeCreditLine(buyer.address, amount, 0, 365 * DAY, NET_30);
    await ctx.stableCredit.connect(buyer).transfer(merchant.address, amount);
  }

  async function fund(amount: bigint) {
    await ctx.usdc.mint(funder.address, amount);
    await ctx.usdc.connect(funder).approve(await pool.getAddress(), amount);
    await pool.connect(funder).fund(amount);
  }

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [coop, net14, funder] = [signers[8], signers[9], signers[10]];
    net30 = ctx.counterparty;

    registry = await upgrades.deployProxy(await ethers.getContractFactory("MerchantRegistry"), [ctx.admin.address, NET_30], { kind: "uups" });
    pool = await upgrades.deployProxy(await ethers.getContractFactory("PayoutPool"), [
      ctx.admin.address, await ctx.stableCredit.getAddress(), await ctx.usdc.getAddress(), await registry.getAddress(), coop.address,
    ], { kind: "uups" });
    await pool.grantRole(await pool.FUNDER_ROLE(), funder.address);
    await ctx.stableCredit.connect(ctx.admin).setMerchantRegistry(await registry.getAddress());
    await ctx.stableCredit.connect(ctx.admin).setPayoutPool(await pool.getAddress());
    for (const m of [net30, net14]) {
      await ctx.access.connect(ctx.operator).grantMember(m.address);
      await ctx.stableCredit.connect(m).approve(await pool.getAddress(), ethers.MaxUint256);
    }
    await registry.registerMerchant(net30.address, NET_30, 50_000n * ONE_USDC, 200n);
    await registry.registerMerchant(net14.address, NET_14, 50_000n * ONE_USDC, 200n);

    const LendingPool = await ethers.getContractFactory("LendingPool");
    yieldLender = await upgrades.deployProxy(LendingPool, [ctx.admin.address, await ctx.usdc.getAddress(), "Clear Yield", "cYLD"], { kind: "uups" });
    await yieldLender.grantRole(await yieldLender.BORROWER_ROLE(), await pool.getAddress());
    await yieldLender.setBorrower(await pool.getAddress(), await pool.getAddress(), ethers.MaxUint256);
    await pool.setYieldPool(await yieldLender.getAddress());

    // Two older net-30 claims are queued first, then a newer net-14 claim.
    await sale(net30, 2_000n * ONE_USDC);
    await sale(net14, 500n * ONE_USDC);
    await pool.connect(net30).redeem(1_000n * ONE_USDC);
    await pool.connect(net30).redeem(1_000n * ONE_USDC);
    await pool.connect(net14).redeem(500n * ONE_USDC);
  });

  it("acceptance 27: a net-14 claim is paid by its deadline even with older net-30 claims queued", async function () {
    const [, , claimedAt, dueBy] = await pool.claimAt(2);
    expect(dueBy - claimedAt).to.equal(BigInt(NET_14));
    const [, , , olderDue] = await pool.claimAt(0);
    expect(olderDue).to.be.greaterThan(dueBy);
    // The net-14 claim is next, though it is the newest.
    expect(await pool.nextUnpaid()).to.equal(2n);

    // At its deadline, the pool draws for it. Under strict claim age the head would have been the
    // older net-30 claim, not due for two more weeks, and this would have reverted ClaimNotDue.
    await ctx.usdc.mint(ctx.admin.address, 500n * ONE_USDC);
    await ctx.usdc.approve(await yieldLender.getAddress(), 500n * ONE_USDC);
    await yieldLender.deposit(500n * ONE_USDC, ctx.admin.address);
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(dueBy)]);
    await pool.drawForDueClaim();

    expect(await ctx.usdc.balanceOf(net14.address)).to.equal(500n * ONE_USDC);
    const [, , , , paid] = await pool.claimAt(2);
    expect(paid).to.equal(true);
    expect(await now()).to.be.lte(dueBy);
    // The net-30 claims are still queued, oldest first.
    expect(await pool.nextUnpaid()).to.equal(0n);
    expect(await ctx.usdc.balanceOf(net30.address)).to.equal(0n);
    expect(await pool.queuedTotal()).to.equal(2_000n * ONE_USDC);
  });

  it("acceptance 27: money that arrives before the deadline goes to the net-14 claim first", async function () {
    await fund(500n * ONE_USDC);
    await pool.payQueue(10);
    expect(await ctx.usdc.balanceOf(net14.address)).to.equal(500n * ONE_USDC);
    expect(await ctx.usdc.balanceOf(net30.address)).to.equal(0n);

    // Then the net-30 claims, oldest first.
    await fund(1_000n * ONE_USDC);
    await pool.payNext();
    const [, , , , firstPaid] = await pool.claimAt(0);
    const [, , , , secondPaid] = await pool.claimAt(1);
    expect(firstPaid).to.equal(true);
    expect(secondPaid).to.equal(false);
  });

  it("a fresh claim is paid on the spot only when nothing is due before it", async function () {
    // Funded, but the net-14 claim already queued is due before a new net-30 claim: the money is
    // the queue's first, so the new claim waits.
    await fund(500n * ONE_USDC);
    await sale(net30, 100n * ONE_USDC);
    const [paidNow] = await pool.connect(net30).redeem.staticCall(100n * ONE_USDC);
    expect(paidNow).to.equal(false);
    await pool.payNext();
    expect(await ctx.usdc.balanceOf(net14.address)).to.equal(500n * ONE_USDC);
  });

  it("tells the operator what is due within a horizon, and how much is missing", async function () {
    const [, , , dueBy14] = await pool.claimAt(2);
    // Two days before the net-14 deadline: only that claim is due inside two days.
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(dueBy14) - 2 * DAY]);
    await ethers.provider.send("evm_mine", []);
    let [ids, amount, short] = await pool.dueWithin(2 * DAY, 10);
    expect(ids).to.deep.equal([2n]);
    expect(amount).to.equal(500n * ONE_USDC);
    expect(short).to.equal(500n * ONE_USDC);

    await fund(300n * ONE_USDC);
    [, , short] = await pool.dueWithin(2 * DAY, 10);
    expect(short).to.equal(200n * ONE_USDC);

    // A horizon past every deadline lists everything; the cap on the list is respected.
    [ids, amount] = await pool.dueWithin(60 * DAY, 10);
    expect(ids.length).to.equal(3);
    expect(amount).to.equal(2_500n * ONE_USDC);
    [ids] = await pool.dueWithin(60 * DAY, 2);
    expect(ids.length).to.equal(2);
  });

  it("keeps every existing view working", async function () {
    expect(await pool.claimCount()).to.equal(3n);
    expect(await pool.claimsOwnedBy(net30.address)).to.deep.equal([0n, 1n]);
    expect(await pool.claimsOwnedBy(net14.address)).to.deep.equal([2n]);
    expect(await pool.queuedTotal()).to.equal(2_500n * ONE_USDC);
    expect(await pool.redeemableOf(net30.address)).to.equal(0n);
    expect([...(await pool.queuedWindowsList())].map(Number).sort()).to.deep.equal([NET_14, NET_30]);
    expect(await pool.canPayNext()).to.equal(false);

    await fund(2_500n * ONE_USDC);
    await pool.payQueue(10);
    expect(await pool.queuedTotal()).to.equal(0n);
    expect(await pool.nextUnpaid()).to.equal(await pool.claimCount());
    expect(await pool.queuedWindowsList()).to.deep.equal([]);
    await expect(pool.payNext()).to.be.revertedWithCustomError(pool, "PayoutPoolNothingToRedeem");
  });

  it("pays claims queued before an upgrade in their old order, beside new claims in deadline order", async function () {
    // Put the pool in the state an upgrade from the strict-FIFO version leaves: three claims in
    // `claims`, the old cursor at 0, and nothing in the per-window queues.
    const bi: any = await (await import("hardhat")).artifacts.getBuildInfo("contracts/peripherals/PayoutPool.sol:PayoutPool");
    const slots: Record<string, bigint> = {};
    for (const s of bi.output.contracts["contracts/peripherals/PayoutPool.sol"].PayoutPool.storageLayout.storage) {
      slots[s.label] = BigInt(s.slot);
    }
    const at = await pool.getAddress();
    const write = (slot: bigint, value: bigint) =>
      ethers.provider.send("hardhat_setStorageAt", [at, ethers.toQuantity(slot), ethers.zeroPadValue(ethers.toBeHex(value), 32)]);
    const headSlot = (window: number) =>
      BigInt(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [window, slots.windowHead])));
    await write(slots.legacyEnd, 0n);
    await write(slots.queuedWindows, 0n);
    await write(headSlot(NET_30), 2n);
    await write(headSlot(NET_14), 1n);
    // Every existing claim is now legacy, paid in claim-age order.
    expect(await pool.nextUnpaid()).to.equal(0n);
    expect(await pool.queuedWindowsList()).to.deep.equal([]);

    // A claim queued after the upgrade is ordered by deadline, ahead of the legacy head.
    await sale(net14, 100n * ONE_USDC);
    await pool.connect(net14).redeem(100n * ONE_USDC);
    expect(await pool.nextUnpaid()).to.equal(3n);

    await fund(2_600n * ONE_USDC);
    // One at a time, to see the order: the new net-14 claim, then the legacy claims 0, 1, 2.
    const order: bigint[] = [];
    for (let i = 0; i < 4; i++) {
      order.push(await pool.nextUnpaid());
      await pool.payNext();
    }
    expect(order).to.deep.equal([3n, 0n, 1n, 2n]);
    expect(await pool.queuedTotal()).to.equal(0n);
    expect(await pool.nextUnpaid()).to.equal(4n);
  });

  it("bounds the windows queued at once, so picking the next claim stays cheap", async function () {
    const max = Number(await pool.MAX_QUEUED_WINDOWS());
    // Two windows are queued already; fill the rest with merchants on distinct windows.
    const merchants: any[] = [];
    for (let i = 0; i < max - 1; i++) {
      const m = ethers.Wallet.createRandom().connect(ethers.provider);
      await ethers.provider.send("hardhat_setBalance", [m.address, "0xde0b6b3a7640000"]);
      await ctx.access.connect(ctx.operator).grantMember(m.address);
      await registry.registerMerchant(m.address, (i + 1) * DAY + 1, 50_000n * ONE_USDC, 200n); // none equal to net-14 or net-30
      await sale(m, 10n * ONE_USDC);
      await ctx.stableCredit.connect(m).approve(await pool.getAddress(), ethers.MaxUint256);
      merchants.push(m);
    }
    for (let i = 0; i < max - 2; i++) await pool.connect(merchants[i]).redeem(10n * ONE_USDC);
    expect((await pool.queuedWindowsList()).length).to.equal(max);
    await expect(pool.connect(merchants[max - 2]).redeem(10n * ONE_USDC))
      .to.be.revertedWithCustomError(pool, "PayoutPoolTooManyWindows");

    // A full set of windows still picks in one bounded pass, earliest deadline first: net-1.
    expect(await pool.nextUnpaid()).to.equal(3n);
    await fund(10n * ONE_USDC);
    // About 500k in all, paying the claim and placing the position included.
    expect(await pool.payNext.estimateGas()).to.be.lessThan(600_000n);
    await pool.payNext();
    expect(await ctx.usdc.balanceOf(merchants[0].address)).to.equal(10n * ONE_USDC);
  });
});
