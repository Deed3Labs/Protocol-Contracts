import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const DAY = 24 * 60 * 60;
const CYCLE = 30 * DAY;
const YEAR = 365 * DAY;

const BOND = ethers.encodeBytes32String("BOND");
const ASSET_INT = 3;

// A bond pledged as collateral has to behave like collateral in two ways that a flat per-kind
// price and an unguarded transfer hook do not give it: it must not be able to walk away while
// credit is drawn on it, and it must be valued at what it is worth today rather than at whatever
// figure an operator last typed in. Bonds accrete, so the second one moves every block.
describe("bonds as collateral", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let factory: any, deposit: any, bond: any, vault: any, registry: any, issuer: any, valuer: any;
  let coop: any, other: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [coop, other] = [signers[8], signers[9]];

    const BurnerBondFactory = await ethers.getContractFactory("BurnerBondFactory");
    factory = await BurnerBondFactory.deploy(
      await ctx.assurancePool.getAddress(),
      await ctx.assuranceOracle.getAddress(),
      "ipfs://bonds"
    );
    deposit = await ethers.getContractAt(
      "BurnerBondDeposit", await factory.getUnifiedDepositContract()
    );
    await factory.createCollection(await ctx.usdc.getAddress(), "USDC", "USD Coin", "ipfs://bonds");
    const info = await factory.getCollectionInfo(await ctx.usdc.getAddress());
    bond = await ethers.getContractAt("BurnerBond", info.collectionAddress);

    const BondVault = await ethers.getContractFactory("BondVault");
    vault = await upgrades.deployProxy(
      BondVault,
      [ctx.admin.address, await ctx.usdc.getAddress(), 3 * CYCLE],
      { kind: "uups" }
    );
    await vault.grantRole(await vault.BOND_ROLE(), await deposit.getAddress());
    await vault.grantRole(await vault.BOND_ROLE(), await bond.getAddress());
    await deposit.setBondVault(await vault.getAddress());
    await bond.setBondVault(await vault.getAddress());

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
    await issuer.connect(ctx.operator).addTier(BOND, 75n, CYCLE);

    const LimitCalculator = await ethers.getContractFactory("LimitCalculator");
    const CollateralRegistry = await ethers.getContractFactory("CollateralRegistry");
    registry = await upgrades.deployProxy(
      CollateralRegistry,
      [ctx.admin.address, await ctx.networkRegistry.getAddress()],
      { kind: "uups" }
    );
    // The unit price is deliberately left at zero: with a valuer attached nothing should read it,
    // so a wrong answer from the flat path shows up as a zero rather than as a plausible number.
    await registry.registerCollateralType(BOND, ASSET_INT, 9_000n, 0n);

    const BondValuer = await ethers.getContractFactory("BondValuer");
    valuer = await BondValuer.deploy(await bond.getAddress());
    await registry.setCollateralValuer(BOND, await valuer.getAddress());

    await issuer.connect(ctx.operator).setExposureSource(await registry.getAddress());
    await bond.setEncumbranceSource(await registry.getAddress(), BOND);

    await ctx.usdc.mint(ctx.member.address, 1_000_000n * ONE_USDC);
    await ctx.usdc
      .connect(ctx.member)
      .approve(await deposit.getAddress(), 1_000_000n * ONE_USDC);
  });

  async function now() {
    return BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  }

  async function advance(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  /// Buys a bond of `face` maturing in `term` seconds, and returns its id.
  async function buyBond(face: bigint, term: number) {
    const maturity = (await now()) + BigInt(term) + 60n;
    const discount = await bond.calculateDiscount(maturity);
    await deposit
      .connect(ctx.member)
      .makeDeposit(await ctx.usdc.getAddress(), face, maturity, discount);
    const ids = await bond.getBondIdsByCreator(ctx.member.address);
    return ids[ids.length - 1];
  }

  describe("a pledged bond cannot walk away", function () {
    let bondId: bigint;

    beforeEach(async function () {
      bondId = await buyBond(1_000n * ONE_USDC, YEAR);
      await registry.pledgeItem(ctx.member.address, BOND, bondId);
      await issuer
        .connect(ctx.operator)
        .openLine(ctx.member.address, [500n * ONE_USDC], CYCLE, CYCLE);
    });

    it("moves freely while nothing is drawn against it", async function () {
      await bond
        .connect(ctx.member)
        .safeTransferFrom(ctx.member.address, other.address, bondId, 1, "0x");
      expect(await bond.balanceOf(other.address, bondId)).to.equal(1n);
    });

    it("refuses to move once credit is drawn on it", async function () {
      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 500n * ONE_USDC);

      expect(await registry.isItemEncumbered(ctx.member.address, BOND, bondId)).to.equal(true);
      await expect(
        bond
          .connect(ctx.member)
          .safeTransferFrom(ctx.member.address, other.address, bondId, 1, "0x")
      ).to.be.revertedWith("Bond is pledged as collateral");
    });

    it("moves again once the credit is repaid", async function () {
      // A line opened for somebody with nothing pledged, purely to fund the carry: repaying the
      // principal alone leaves a few units of carry outstanding, and any debt at all keeps the
      // collateral spoken for.
      await issuer
        .connect(ctx.operator)
        .openLine(other.address, [10n * ONE_USDC], CYCLE, CYCLE);
      await ctx.stableCredit.connect(other).transfer(ctx.member.address, ONE_USDC);

      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 500n * ONE_USDC);
      await ctx.stableCredit
        .connect(ctx.counterparty)
        .transfer(ctx.member.address, 500n * ONE_USDC);
      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(
          ctx.counterparty.address,
          await ctx.stableCredit.balanceOf(ctx.member.address)
        );

      expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address)).to.equal(0n);
      expect(await registry.isItemEncumbered(ctx.member.address, BOND, bondId)).to.equal(false);
      await bond
        .connect(ctx.member)
        .safeTransferFrom(ctx.member.address, other.address, bondId, 1, "0x");
      expect(await bond.balanceOf(other.address, bondId)).to.equal(1n);
    });

    it("still lets the co-op take it", async function () {
      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 500n * ONE_USDC);

      // The lock is there to stop the member emptying the collateral, not to stop the co-op
      // collecting it. A lock that also binds the liquidator secures nothing.
      await bond.setLiquidator(coop.address);
      await bond.connect(coop).seizeBond(bondId, ctx.member.address, coop.address);
      expect(await bond.balanceOf(coop.address, bondId)).to.equal(1n);
    });

    it("leaves an unpledged bond alone", async function () {
      const free = await buyBond(100n * ONE_USDC, YEAR);
      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 500n * ONE_USDC);

      await bond
        .connect(ctx.member)
        .safeTransferFrom(ctx.member.address, other.address, free, 1, "0x");
      expect(await bond.balanceOf(other.address, free)).to.equal(1n);
    });
  });

  describe("the limit accretes with the bond", function () {
    it("values a fresh pledge near what was paid, not at face", async function () {
      const bondId = await buyBond(1_000n * ONE_USDC, YEAR);
      const paid = (await bond.getBondInfo(bondId)).purchasePrice;
      await registry.pledgeItem(ctx.member.address, BOND, bondId);

      const value = await registry.collateralValueOf(ctx.member.address, BOND);
      expect(value).to.equal(paid);
      expect(value).to.be.lessThan(1_000n * ONE_USDC);
    });

    it("grows on its own as maturity approaches", async function () {
      const bondId = await buyBond(1_000n * ONE_USDC, YEAR);
      await registry.pledgeItem(ctx.member.address, BOND, bondId);

      const atIssue = await registry.collateralValueOf(ctx.member.address, BOND);
      await advance(YEAR / 2);
      const halfway = await registry.collateralValueOf(ctx.member.address, BOND);
      await advance(YEAR / 2 - DAY);
      const nearly = await registry.collateralValueOf(ctx.member.address, BOND);

      // Nobody revalued anything. The bond is simply closer to paying out.
      expect(halfway).to.be.greaterThan(atIssue);
      expect(nearly).to.be.greaterThan(halfway);
      expect(nearly).to.be.lessThanOrEqual(1_000n * ONE_USDC);
    });

    it("reaches face at maturity and stops there", async function () {
      const bondId = await buyBond(1_000n * ONE_USDC, YEAR);
      await registry.pledgeItem(ctx.member.address, BOND, bondId);

      await advance(YEAR + DAY);
      expect(await registry.collateralValueOf(ctx.member.address, BOND)).to.equal(
        1_000n * ONE_USDC
      );
      await advance(YEAR);
      expect(await registry.collateralValueOf(ctx.member.address, BOND)).to.equal(
        1_000n * ONE_USDC
      );
    });

    it("prices each bond on its own term rather than a standard one", async function () {
      // The old code reconstructed the issue date by subtracting the roll term from maturity,
      // which reads a six-month bond as though it had already been accreting for six months.
      const short = await buyBond(1_000n * ONE_USDC, YEAR / 2);
      const paid = (await bond.getBondInfo(short)).purchasePrice;

      expect(await bond.presentValueOf(short)).to.equal(paid);
    });

    it("counts a bond the member no longer holds as worth nothing", async function () {
      const bondId = await buyBond(1_000n * ONE_USDC, YEAR);
      await registry.pledgeItem(ctx.member.address, BOND, bondId);
      // Nothing drawn, so the bond is free to leave -- but the registry still lists the pledge.
      await bond
        .connect(ctx.member)
        .safeTransferFrom(ctx.member.address, other.address, bondId, 1, "0x");

      expect(await registry.collateralValueOf(ctx.member.address, BOND)).to.equal(0n);
    });

    it("sums a member's pledged bonds", async function () {
      const a = await buyBond(1_000n * ONE_USDC, YEAR);
      const b = await buyBond(500n * ONE_USDC, YEAR);
      await registry.pledgeItem(ctx.member.address, BOND, a);
      await registry.pledgeItem(ctx.member.address, BOND, b);

      const expected =
        (await bond.presentValueOf(a)) + (await bond.presentValueOf(b));
      expect(await registry.collateralValueOf(ctx.member.address, BOND)).to.equal(expected);
    });
  });

  // Phase 4's claim is that a pledged bond makes the asset-backed tier light up without anybody
  // attesting to anything. The registry values it, the calculator haircuts it, and the issuer
  // takes the figure -- so the member's line moves because their collateral did.
  describe("the asset-backed tier lights up", function () {
    let limits: any;

    beforeEach(async function () {
      const LimitCalculator = await ethers.getContractFactory("LimitCalculator");
      limits = await upgrades.deployProxy(
        LimitCalculator,
        [
          ctx.admin.address,
          await registry.getAddress(),
          await issuer.getAddress(),
        ],
        { kind: "uups" }
      );
      await issuer.connect(ctx.operator).setLimitCalculator(await limits.getAddress());
      await ctx.access.grantOperator(await limits.getAddress());
    });

    it("gives a member with no collateral and no attestation nothing", async function () {
      expect(await limits.capacityOf(ctx.member.address, BOND)).to.equal(0n);
    });

    it("opens a line the moment a bond is pledged, with nobody attesting", async function () {
      const bondId = await buyBond(1_000n * ONE_USDC, YEAR);
      await registry.pledgeItem(ctx.member.address, BOND, bondId);

      // 90% of what the bond is worth today, not of its face.
      const value = await bond.presentValueOf(bondId);
      expect(await limits.capacityOf(ctx.member.address, BOND)).to.equal(
        (value * 9_000n) / 10_000n
      );
    });

    it("widens that line on its own as the bond accretes", async function () {
      const bondId = await buyBond(1_000n * ONE_USDC, YEAR);
      await registry.pledgeItem(ctx.member.address, BOND, bondId);

      const atIssue = await limits.capacityOf(ctx.member.address, BOND);
      await advance(YEAR / 2);
      const halfway = await limits.capacityOf(ctx.member.address, BOND);

      expect(halfway).to.be.greaterThan(atIssue);
    });

    it("pushes the figure onto the issuer for anyone who asks", async function () {
      const bondId = await buyBond(1_000n * ONE_USDC, YEAR);
      await registry.pledgeItem(ctx.member.address, BOND, bondId);
      await limits.connect(other).pushCapacities(ctx.member.address);

      const value = await bond.presentValueOf(bondId);
      expect(await issuer.capacityOf(ctx.member.address, BOND)).to.equal(
        (value * 9_000n) / 10_000n
      );
    });
  });
});
