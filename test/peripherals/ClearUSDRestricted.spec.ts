import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const CYCLE = 30 * 24 * 60 * 60;
const ONE_YEAR = 365 * 24 * 60 * 60;
const SAVINGS = ethers.encodeBytes32String("SAVINGS");
const SAVINGS_BACKED = 1;

// The credit line's rule is `withdrawable CLRUSD = ESA balance - savings-backed drawn`, and when
// that reaches zero, redemption locks. A registry can record the lock; only the asset can enforce
// it, because the member holds the asset.
describe("ClearUSDRestricted", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let clrusd: any, registry: any, revolving: any;
  let coop: any, other: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [coop, other] = [signers[8], signers[9]];

    const ClearUSDRestricted = await ethers.getContractFactory("ClearUSDRestricted");
    clrusd = await ClearUSDRestricted.deploy(ctx.admin.address, 0, 0);
    await clrusd.grantIssuerRoles(ctx.admin.address);

    const RevolvingIssuer = await ethers.getContractFactory("RevolvingIssuer");
    revolving = await RevolvingIssuer.deploy();
    await revolving.initialize(await ctx.stableCredit.getAddress(), coop.address);
    await ctx.networkRegistry.registerIssuer(
      await revolving.getAddress(),
      await ctx.stableCredit.getAddress(),
      await ctx.assurancePool.getAddress(),
      await ctx.assuranceOracle.getAddress()
    );
    await ctx.access.grantOperator(await revolving.getAddress());
    await ctx.access.connect(ctx.operator).grantMember(ctx.counterparty.address);
    await revolving.connect(ctx.operator).addTier(SAVINGS, 0n, CYCLE);

    const CollateralRegistry = await ethers.getContractFactory("CollateralRegistry");
    registry = await upgrades.deployProxy(
      CollateralRegistry,
      [ctx.admin.address, await ctx.networkRegistry.getAddress()],
      { kind: "uups" }
    );
    await registry.registerCollateralType(SAVINGS, SAVINGS_BACKED, 10_000n, 10n ** 18n);
    await registry.setClrusdKind(SAVINGS);
    await clrusd.setEncumbranceSource(await registry.getAddress());

    // The member saves 1,000, holds the CLRUSD themselves, and pledges it.
    await clrusd.mint(ctx.member.address, 1_000n * ONE_USDC);
    await registry.pledge(ctx.member.address, SAVINGS, 1_000n * ONE_USDC);
    await revolving
      .connect(ctx.operator)
      .openLine(ctx.member.address, [1_000n * ONE_USDC], ONE_YEAR, CYCLE);
  });

  async function spend(amount: bigint) {
    await ctx.stableCredit.connect(ctx.member).transfer(ctx.counterparty.address, amount);
  }

  it("lets a member move CLRUSD they have not drawn against", async function () {
    expect(await clrusd.freeBalanceOf(ctx.member.address)).to.equal(1_000n * ONE_USDC);
    await clrusd.connect(ctx.member).transfer(other.address, 400n * ONE_USDC);
    expect(await clrusd.balanceOf(other.address)).to.equal(400n * ONE_USDC);
  });

  it("locks the CLRUSD behind what has been drawn", async function () {
    await spend(600n * ONE_USDC);

    expect(await clrusd.freeBalanceOf(ctx.member.address)).to.equal(400n * ONE_USDC);
    await clrusd.connect(ctx.member).transfer(other.address, 400n * ONE_USDC);
    await expect(clrusd.connect(ctx.member).transfer(other.address, 1n))
      .to.be.revertedWithCustomError(clrusd, "ClearUSDEncumbered");
  });

  it("locks redemption once nothing is withdrawable", async function () {
    // There is no pay-back date and no pay button. The lock is the enforcement.
    await spend(1_000n * ONE_USDC);

    expect(await clrusd.freeBalanceOf(ctx.member.address)).to.equal(0n);
    await expect(clrusd.connect(ctx.member).transfer(other.address, 1n))
      .to.be.revertedWithCustomError(clrusd, "ClearUSDEncumbered");
  });

  it("closes the redemption path as well as the transfer path", async function () {
    // Redeeming to USDC burns. A lock that only covered transfers would be a lock in name.
    await spend(1_000n * ONE_USDC);

    // The vault burns on redemption, with the member's approval; the lock still refuses.
    await clrusd.connect(ctx.member).approve(ctx.admin.address, 1_000n * ONE_USDC);
    await expect(clrusd["burn(address,uint256)"](ctx.member.address, 1n))
      .to.be.revertedWithCustomError(clrusd, "ClearUSDEncumbered");
  });

  it("frees the lock as the credit is repaid", async function () {
    await spend(1_000n * ONE_USDC);
    expect(await clrusd.freeBalanceOf(ctx.member.address)).to.equal(0n);

    await ctx.stableCredit
      .connect(ctx.counterparty)
      .transfer(ctx.member.address, 600n * ONE_USDC);

    expect(await clrusd.freeBalanceOf(ctx.member.address)).to.equal(600n * ONE_USDC);
    await clrusd.connect(ctx.member).transfer(other.address, 600n * ONE_USDC);
  });

  it("does not lock anyone who has drawn nothing", async function () {
    await clrusd.mint(other.address, 500n * ONE_USDC);
    expect(await clrusd.freeBalanceOf(other.address)).to.equal(500n * ONE_USDC);
    await clrusd.connect(other).transfer(ctx.member.address, 500n * ONE_USDC);
  });

  it("is unrestricted until a source is wired to it", async function () {
    const ClearUSDRestricted = await ethers.getContractFactory("ClearUSDRestricted");
    const fresh = await ClearUSDRestricted.deploy(ctx.admin.address, 0, 0);
    await fresh.grantIssuerRoles(ctx.admin.address);
    await fresh.mint(ctx.member.address, 100n * ONE_USDC);

    expect(await fresh.freeBalanceOf(ctx.member.address)).to.equal(100n * ONE_USDC);
    await fresh.connect(ctx.member).transfer(other.address, 100n * ONE_USDC);
  });

  it("does not freeze every holder when the source breaks", async function () {
    // A token that cannot be unwedged is worse than one whose lock an admin has to be seen
    // lifting. An unreadable source locks nothing.
    const Reverting = await ethers.getContractFactory("RevertingEncumbranceSource");
    const broken = await Reverting.deploy();
    await clrusd.setEncumbranceSource(await broken.getAddress());

    await spend(1_000n * ONE_USDC);
    expect(await clrusd.freeBalanceOf(ctx.member.address)).to.equal(1_000n * ONE_USDC);
    await clrusd.connect(ctx.member).transfer(other.address, 1_000n * ONE_USDC);
  });

  it("only lets an admin change the source", async function () {
    await expect(clrusd.connect(other).setEncumbranceSource(other.address)).to.be.reverted;
  });
});
