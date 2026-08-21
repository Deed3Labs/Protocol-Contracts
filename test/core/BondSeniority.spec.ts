import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const MONTH = 30 * 24 * 60 * 60;

// Bondholders lent money and are creditors. Their principal used to sit in the AssurancePool's
// excess reserve while redemptions were drawn from the same pool, so it absorbed other people's
// defaults and redemption competed with the losses it was funding. The fix is not a rule about
// where to send money; it is that the money is somewhere else.
describe("bond seniority", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let vault: any;
  let bondContract: any, safe: any, holder: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [bondContract, safe, holder] = [signers[8], signers[9], signers[10]];

    const BondVault = await ethers.getContractFactory("BondVault");
    vault = await upgrades.deployProxy(
      BondVault,
      [ctx.admin.address, await ctx.usdc.getAddress(), 3 * MONTH],
      { kind: "uups" }
    );
    await vault.grantRole(await vault.BOND_ROLE(), bondContract.address);
    await vault.grantRole(await vault.TREASURY_ROLE(), safe.address);

    // A bond sold for 950, owing 1,000 in two months.
    await ctx.usdc.mint(await vault.getAddress(), 950n * ONE_USDC);
    const latest = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    await vault
      .connect(bondContract)
      .recordPurchase(1, 950n * ONE_USDC, 1_000n * ONE_USDC, latest + BigInt(2 * MONTH));
  });

  it("keeps bond proceeds out of the AssurancePool entirely", async function () {
    // The seniority invariant: the AssurancePool balance contains no bond principal.
    expect(await ctx.assurancePool.reserveBalance()).to.equal(0n);
    expect(await ctx.assurancePool.excessBalance()).to.equal(0n);
    expect(await ctx.assurancePool.heldReserveValue()).to.equal(0n);
    expect(await vault.held()).to.equal(950n * ONE_USDC);
  });

  it("redeems at maturity even when the AssurancePool is empty", async function () {
    // The §6 test. A bond failing to pay because the credit book had a bad quarter is the one
    // thing a zero-coupon bond is not supposed to do.
    await ctx.usdc.mint(await vault.getAddress(), 50n * ONE_USDC); // the vault grew into its face
    await ethers.provider.send("evm_increaseTime", [3 * MONTH]);
    await ethers.provider.send("evm_mine", []);

    expect(await ctx.assurancePool.reserveBalance()).to.equal(0n);

    await vault.connect(bondContract).settle(1, holder.address);
    expect(await ctx.usdc.balanceOf(holder.address)).to.equal(1_000n * ONE_USDC);
  });

  it("redeems even while the credit book is taking losses", async function () {
    await ctx.usdc.mint(await vault.getAddress(), 50n * ONE_USDC);

    // Losses land on the reserve. Nothing about them reaches the bondholder.
    await ctx.usdc.mint(ctx.admin.address, 500n * ONE_USDC);
    await ctx.usdc.approve(await ctx.assurancePool.getAddress(), 500n * ONE_USDC);
    await ctx.assurancePool.depositIntoPrimaryReserve(500n * ONE_USDC);
    const heldBefore = await vault.held();

    await vault.connect(bondContract).settle(1, holder.address);

    expect(await ctx.usdc.balanceOf(holder.address)).to.equal(1_000n * ONE_USDC);
    expect(await vault.held()).to.equal(heldBefore - 1_000n * ONE_USDC);
    // And the reserve is exactly where it was; the bond never touched it.
    expect(await ctx.assurancePool.reserveBalance()).to.equal(500n * ONE_USDC);
  });

  it("does not let the Safe spend what the bond is owed", async function () {
    // With a maturity inside the window the whole face value is held back, so there is nothing
    // deployable at all.
    expect(await vault.requiredReserve()).to.equal(1_000n * ONE_USDC);
    expect(await vault.deployableExcess()).to.equal(0n);
    await expect(vault.connect(safe).withdrawDeployable(1n, safe.address))
      .to.be.revertedWithCustomError(vault, "BondVaultWouldBreachReserve");
  });

  it("leaves the AssurancePool with no way to reach bond money", async function () {
    // The two are not wired together in either direction: no path from the reserve into the
    // vault, and the vault is not a withdrawal caller on the pool.
    expect(await ctx.assurancePool.withdrawalCallers(await vault.getAddress())).to.equal(false);
    expect(await ctx.assurancePool.withdrawalCallers(bondContract.address)).to.equal(false);
  });
});
