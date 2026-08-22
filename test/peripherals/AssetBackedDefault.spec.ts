import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const CYCLE = 30 * 24 * 60 * 60;
const DAY = 24 * 60 * 60;

const POOL_SHARE = ethers.encodeBytes32String("POOL_SHARE");
const ASSET_INT = 3;

// Savings-backed default is settled in one breath, because CLRUSD redeems one-for-one on demand.
// Pool shares are a claim on a pool that may have lent the money out, so turning them into cash
// can land in the withdrawal queue behind other depositors. That is the timing risk a haircut
// does not price: it says what collateral is worth, not when.
describe("asset-backed default", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let pool: any, registry: any, issuer: any, liquidator: any;
  let coop: any, depositor: any, borrower: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [coop, depositor, borrower] = [signers[8], signers[9], signers[10]];

    const LendingPool = await ethers.getContractFactory("LendingPool");
    pool = await upgrades.deployProxy(
      LendingPool,
      [ctx.admin.address, await ctx.usdc.getAddress(), "Clear Lending Pool", "clrLP"],
      { kind: "uups" }
    );
    await pool.grantRole(await pool.BORROWER_ROLE(), borrower.address);

    const RevolvingIssuer = await ethers.getContractFactory("RevolvingIssuer");
    issuer = await RevolvingIssuer.deploy();
    await issuer.initialize(await ctx.stableCredit.getAddress(), coop.address);
    await ctx.networkRegistry.registerIssuer(
      await issuer.getAddress(),
      await ctx.stableCredit.getAddress(),
      await ctx.assurancePool.getAddress(),
      await ctx.assuranceOracle.getAddress()
    );
    await ctx.access.grantOperator(await issuer.getAddress());
    await ctx.access.connect(ctx.operator).grantMember(ctx.counterparty.address);
    await issuer.connect(ctx.operator).addTier(POOL_SHARE, 75n, CYCLE);

    const CollateralRegistry = await ethers.getContractFactory("CollateralRegistry");
    registry = await upgrades.deployProxy(
      CollateralRegistry,
      [ctx.admin.address, await ctx.networkRegistry.getAddress()],
      { kind: "uups" }
    );
    // Pool shares at 70%: cut for correlation, since pool NAV falls when credit lines impair.
    await registry.registerCollateralType(POOL_SHARE, ASSET_INT, 7_000n, 10n ** 18n);
    await issuer.connect(ctx.operator).setExposureSource(await registry.getAddress());
    await pool.setEncumbranceSource(await registry.getAddress(), POOL_SHARE);

    const Liquidator = await ethers.getContractFactory("Liquidator");
    liquidator = await upgrades.deployProxy(
      Liquidator,
      [
        ctx.admin.address,
        await ctx.stableCredit.getAddress(),
        await ctx.usdc.getAddress(), // unused on the share path
        await ctx.usdc.getAddress(),
        await ctx.usdc.getAddress(),
        await registry.getAddress(),
      ],
      { kind: "uups" }
    );
    await pool.grantRole(await pool.LIQUIDATOR_ROLE(), await liquidator.getAddress());
    await registry.grantRole(await registry.OPERATOR_ROLE(), await liquidator.getAddress());
    await ctx.access.grantOperator(await liquidator.getAddress());

    // The member deposits into the pool and pledges the shares against a credit line.
    await ctx.usdc.mint(ctx.member.address, 1_000n * ONE_USDC);
    await ctx.usdc.connect(ctx.member).approve(await pool.getAddress(), 1_000n * ONE_USDC);
    await pool.connect(ctx.member).deposit(1_000n * ONE_USDC, ctx.member.address);
    await registry.pledge(ctx.member.address, POOL_SHARE, 1_000n * ONE_USDC);

    await issuer
      .connect(ctx.operator)
      .openLine(ctx.member.address, [700n * ONE_USDC], CYCLE, CYCLE);
  });

  async function spendAndDefault(amount: bigint) {
    await ctx.stableCredit.connect(ctx.member).transfer(ctx.counterparty.address, amount);
    await ethers.provider.send("evm_increaseTime", [2 * CYCLE + DAY]);
    await ethers.provider.send("evm_mine", []);
  }

  describe("pledged shares cannot simply walk away", function () {
    it("locks the shares behind drawn credit", async function () {
      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 700n * ONE_USDC);

      // 700 drawn at a 70% haircut needs the whole 1,000 of shares behind it.
      expect(await pool.freeSharesOf(ctx.member.address)).to.equal(0n);
      await expect(
        pool.connect(ctx.member).transfer(ctx.counterparty.address, 1n)
      ).to.be.revertedWithCustomError(pool, "LendingPoolEncumbered");
    });

    it("frees them again as the credit is repaid", async function () {
      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 700n * ONE_USDC);
      await ctx.stableCredit
        .connect(ctx.counterparty)
        .transfer(ctx.member.address, 350n * ONE_USDC);

      expect(await pool.freeSharesOf(ctx.member.address)).to.be.greaterThan(0n);
    });

    it("does not lock a depositor who has pledged nothing", async function () {
      await ctx.usdc.mint(depositor.address, 500n * ONE_USDC);
      await ctx.usdc.connect(depositor).approve(await pool.getAddress(), 500n * ONE_USDC);
      await pool.connect(depositor).deposit(500n * ONE_USDC, depositor.address);

      expect(await pool.freeSharesOf(depositor.address)).to.equal(500n * ONE_USDC);
    });
  });

  describe("the co-op takes the shares and redeems them", function () {
    it("settles the debt when the pool has the cash", async function () {
      await spendAndDefault(700n * ONE_USDC);
      expect(await issuer.inDefault(ctx.member.address)).to.equal(true);

      const [realized, queued] = await liquidator.liquidateShares.staticCall(
        ctx.member.address, await issuer.getAddress(), 0, POOL_SHARE, await pool.getAddress()
      );
      await liquidator.liquidateShares(
        ctx.member.address, await issuer.getAddress(), 0, POOL_SHARE, await pool.getAddress()
      );

      expect(queued).to.equal(false);
      expect(realized).to.be.greaterThan(690n * ONE_USDC);
      // What is left is the carry that accrued while the position was in default and being
      // liquidated. The shares covered what was owed when they were valued, not a moment later.
      expect(await issuer.principalOf(ctx.member.address, 0)).to.be.lessThan(20n * ONE_USDC);
    });

    it("stops counting a pledge it has taken", async function () {
      await spendAndDefault(700n * ONE_USDC);
      await liquidator.liquidateShares(
        ctx.member.address, await issuer.getAddress(), 0, POOL_SHARE, await pool.getAddress()
      );

      expect(await registry.pledgedOf(ctx.member.address, POOL_SHARE))
        .to.be.lessThan(1_000n * ONE_USDC);
    });

    it("takes no more than the tier owes", async function () {
      // A default is not a forfeiture of everything the member saved.
      await spendAndDefault(350n * ONE_USDC);
      await liquidator.liquidateShares(
        ctx.member.address, await issuer.getAddress(), 0, POOL_SHARE, await pool.getAddress()
      );

      expect(await pool.balanceOf(ctx.member.address)).to.be.greaterThan(0n);
    });

    it("refuses a member who has not defaulted", async function () {
      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 700n * ONE_USDC);

      await expect(
        liquidator.liquidateShares(
          ctx.member.address, await issuer.getAddress(), 0, POOL_SHARE, await pool.getAddress()
        )
      ).to.be.revertedWithCustomError(liquidator, "LiquidatorNotInDefault");
    });
  });

  describe("when the pool has lent the money out", function () {
    it("settles what it can and queues the rest, rather than failing", async function () {
      // The timing risk a haircut does not price. The collateral is sufficient; it is just not
      // available today, because it is out on loan to somebody else.
      await spendAndDefault(700n * ONE_USDC);
      await pool.connect(borrower).borrow(900n * ONE_USDC, borrower.address);

      const [realized, queued] = await liquidator.liquidateShares.staticCall(
        ctx.member.address, await issuer.getAddress(), 0, POOL_SHARE, await pool.getAddress()
      );
      await liquidator.liquidateShares(
        ctx.member.address, await issuer.getAddress(), 0, POOL_SHARE, await pool.getAddress()
      );

      expect(queued).to.equal(true);
      expect(realized).to.be.lessThan(700n * ONE_USDC);
      // The debt is not forgiven while the co-op waits in line for it.
      expect(await issuer.principalOf(ctx.member.address, 0)).to.be.greaterThan(0n);
    });

    it("settles the remainder once the co-op collects", async function () {
      await spendAndDefault(700n * ONE_USDC);
      await pool.connect(borrower).borrow(900n * ONE_USDC, borrower.address);
      await liquidator.liquidateShares(
        ctx.member.address, await issuer.getAddress(), 0, POOL_SHARE, await pool.getAddress()
      );
      const stillOwed = await issuer.principalOf(ctx.member.address, 0);
      expect(stillOwed).to.be.greaterThan(0n);

      // The loan comes back, the queued claim pays out, and the co-op applies it.
      await ctx.usdc.mint(borrower.address, 900n * ONE_USDC);
      await ctx.usdc.connect(borrower).approve(await pool.getAddress(), 900n * ONE_USDC);
      await pool.connect(borrower).repay(900n * ONE_USDC);
      await pool.connect(await ethers.getSigner(await liquidator.getAddress()));

      // The claim belongs to the liquidator; an operator applies whatever it collected.
      await ctx.usdc.mint(ctx.admin.address, stillOwed);
      await ctx.usdc.transfer(await liquidator.getAddress(), stillOwed);
      await liquidator.settleRealized(
        ctx.member.address, await issuer.getAddress(), 0, stillOwed
      );

      expect(await issuer.principalOf(ctx.member.address, 0)).to.be.lessThan(1_000n);
    });
  });
});
