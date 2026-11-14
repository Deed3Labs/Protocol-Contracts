import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";
import { deployBondFactory } from "../helpers/bonds";

const ONE_USDC = 10n ** 6n;
const DAY = 24 * 60 * 60;
const MONTH = 30 * DAY;

// Coverage written before the factory is converted to clones, deliberately: it is asserted
// against the behaviour, not the deployment mechanism, so the same tests should pass unchanged
// once BurnerBond becomes initializer-based and the factory stops carrying a copy of it.
describe("BurnerBond", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let factory: any, deposit: any, bond: any, vault: any;
  let buyer: any, other: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [buyer, other] = [signers[8], signers[9]];

    factory = await deployBondFactory(
      await ctx.tokenRegistry.getAddress(),
      "ipfs://bonds"
    );

    deposit = await ethers.getContractAt("BurnerBondDeposit", await factory.getUnifiedDepositContract());
    // The factory reads the TokenRegistry's whitelist (section 13 retired the AssuranceOracle,
    // which whitelisted USDT by default). USDC is registered by the fixture; USDT is here.
    await ctx.tokenRegistry.registerToken(await ctx.usdt.getAddress(), 31337, await ctx.usdt.getAddress(), 0);

    await factory.createCollection(await ctx.usdc.getAddress(), "USDC", "USD Coin", "ipfs://bonds");
    const info = await factory.getCollectionInfo(await ctx.usdc.getAddress());
    bond = await ethers.getContractAt("BurnerBond", info.collectionAddress);

    const BondVault = await ethers.getContractFactory("BondVault");
    vault = await upgrades.deployProxy(
      BondVault,
      [ctx.admin.address, await ctx.usdc.getAddress(), 3 * MONTH],
      { kind: "uups" }
    );
    await vault.grantRole(await vault.BOND_ROLE(), await deposit.getAddress());
    await vault.grantRole(await vault.BOND_ROLE(), await bond.getAddress());
    await deposit.setBondVault(await vault.getAddress());
    await bond.setBondVault(await vault.getAddress());

    await ctx.usdc.mint(buyer.address, 1_000_000n * ONE_USDC);
    await ctx.usdc.connect(buyer).approve(await deposit.getAddress(), 1_000_000n * ONE_USDC);
  });

  async function now() {
    return BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  }

  /// Buys a bond at the maximum discount the curve allows for that maturity.
  async function buyBond(face: bigint, maturity: bigint) {
    const discount = await bond.calculateDiscount(maturity);
    return deposit
      .connect(buyer)
      .makeDeposit(await ctx.usdc.getAddress(), face, maturity, discount);
  }

  async function costOf(face: bigint, maturity: bigint) {
    return deposit.calculateRequiredDeposit(await ctx.usdc.getAddress(), face, maturity);
  }

  async function advance(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  describe("the collection", function () {
    it("is created against a whitelisted token", async function () {
      expect(await bond.collectionName()).to.equal("USD Coin BurnerBonds");
      expect(await bond.collectionSymbol()).to.equal("USDC-BB");
      expect(await bond.underlyingToken()).to.equal(await ctx.usdc.getAddress());
    });

    it("refuses a token the oracle does not whitelist", async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const stranger = await MockERC20.deploy("Stranger", "STR", 18);
      await expect(
        factory.createCollection(await stranger.getAddress(), "STR", "Stranger", "ipfs://bonds")
      ).to.be.revertedWith("Token not whitelisted");
    });

    it("sells only in the token its vault holds and pays out", async function () {
      // The vault holds USDC, and proceeds in anything else would sit there uncounted, so this is
      // refused before any collection is looked up.
      await expect(
        deposit
          .connect(buyer)
          .makeDeposit(await ctx.weth.getAddress(), 1_000n * ONE_USDC, (await now()) + BigInt(12 * MONTH), 0n)
      ).to.be.revertedWith("Not the vault's reserve token");
    });

    it("can start its ids above another collection's, and shares the vault without colliding", async function () {
      // A collection that replaces another shares its vault, which keys bonds by id alone.
      const maturity = (await now()) + BigInt(12 * MONTH);
      await buyBond(1_000n * ONE_USDC, maturity); // bond 1 in this collection

      const nextFactory = await deployBondFactory(
        await ctx.tokenRegistry.getAddress(), "ipfs://bonds"
      );
      await nextFactory.createCollection(await ctx.usdc.getAddress(), "USDC", "USD Coin", "ipfs://bonds");
      const next = await ethers.getContractAt(
        "BurnerBond", (await nextFactory.getCollectionInfo(await ctx.usdc.getAddress())).collectionAddress
      );
      const nextDeposit = await ethers.getContractAt("BurnerBondDeposit", await nextFactory.getUnifiedDepositContract());
      await next.setBondVault(await vault.getAddress());
      await nextDeposit.setBondVault(await vault.getAddress());
      await vault.grantRole(await vault.BOND_ROLE(), await next.getAddress());
      await vault.grantRole(await vault.BOND_ROLE(), await nextDeposit.getAddress());
      await next.setFirstBondId(1001n);
      await ctx.usdc.connect(buyer).approve(await nextDeposit.getAddress(), 1_000_000n * ONE_USDC);

      await nextDeposit
        .connect(buyer)
        .makeDeposit(await ctx.usdc.getAddress(), 1_000n * ONE_USDC, maturity, await next.calculateDiscount(maturity));
      expect(await next.balanceOf(buyer.address, 1001n)).to.equal(1n);
      expect((await vault.obligations(1n)).faceValue).to.equal(1_000n * ONE_USDC);
      expect((await vault.obligations(1001n)).faceValue).to.equal(1_000n * ONE_USDC);

      await expect(next.setFirstBondId(5000n)).to.be.revertedWith("Bonds already issued");
    });

    it("refuses a second collection for the same token", async function () {
      await expect(
        factory.createCollection(await ctx.usdc.getAddress(), "USDC", "USD Coin", "ipfs://bonds")
      ).to.be.revertedWith("Collection already exists");
    });

    it("hands ownership to the factory owner, not the factory", async function () {
      expect(await bond.owner()).to.equal(ctx.admin.address);
    });
  });

  describe("pricing", function () {
    it("discounts further out maturities more", async function () {
      const soon = (await now()) + BigInt(2 * MONTH);
      const later = (await now()) + BigInt(12 * MONTH);
      expect(await bond.calculateDiscount(later))
        .to.be.greaterThan(await bond.calculateDiscount(soon));
    });

    it("prices a bond below its face value", async function () {
      const maturity = (await now()) + BigInt(12 * MONTH);
      const cost = await costOf(1_000n * ONE_USDC, maturity);
      expect(cost).to.be.lessThan(1_000n * ONE_USDC);
      expect(cost).to.be.greaterThan(0n);
    });

    it("never discounts past the configured ceiling", async function () {
      const maturity = (await now()) + BigInt(24 * MONTH);
      const discount = await bond.calculateDiscount(maturity);
      expect(discount).to.be.lessThanOrEqual(await factory.getMaxDiscount());
    });
  });

  /*
   * The curve's parameter is stored on a 10,000 scale and its maths runs in 1e18. Before the two
   * met, a BONDING curve priced every term at the minimum and a LOGARITHMIC one reverted.
   */
  describe("the discount curve", function () {
    /** A maturity halfway to the factory's longest term. */
    async function halfway() {
      return (await now()) + (await factory.getMaxMaturity()) / 2n;
    }

    it("prices a BONDING curve above the linear one halfway out", async function () {
      const linear = await bond.calculateDiscount(await halfway());
      await bond.setDiscountCurve(1, 20_000n); // steepness 2.0: 1 - (1 - t)^2
      const bonding = await bond.calculateDiscount(await halfway());

      const max = await factory.getMaxDiscount();
      expect(bonding).to.be.greaterThan(linear);
      // Three quarters of the range at t = 0.5, to within the second it took to ask.
      expect(bonding).to.be.closeTo((max * 3n) / 4n, 2n);
    });

    it("prices a LOGARITHMIC curve with diminishing returns, not as a straight line", async function () {
      const linear = await bond.calculateDiscount(await halfway());
      await bond.setDiscountCurve(2, 20_000n); // base 2.0: log2(1 + t)
      const discount = await bond.calculateDiscount(await halfway());

      const max = await factory.getMaxDiscount();
      expect(discount).to.be.greaterThan(linear);
      // log2(1.5) = 0.58496...
      expect(discount).to.be.closeTo((max * 58496n) / 100000n, 2n);
    });

    it("takes a fractional steepness as given, not rounded down", async function () {
      await bond.setDiscountCurve(1, 25_000n); // 1 - (1 - t)^2.5
      const discount = await bond.calculateDiscount(await halfway());

      const max = await factory.getMaxDiscount();
      // 1 - 0.5^2.5 = 0.82322...
      expect(discount).to.be.closeTo((max * 82322n) / 100000n, 2n);
    });

    it("reaches the full range at the longest term, whatever the shape", async function () {
      const max = await factory.getMaxDiscount();
      const longest = (await now()) + (await factory.getMaxMaturity()) + 10n;
      for (const [type, param] of [[1, 37_500n], [2, 100_000n], [2, 15_000n]] as const) {
        await bond.setDiscountCurve(type, param);
        expect(await bond.calculateDiscount(longest)).to.be.closeTo(max, 1n);
      }
    });

    it("takes only the shape; its bounds stay the factory's", async function () {
      await expect(bond.setDiscountCurve(1, 20_000n))
        .to.emit(bond, "DiscountCurveUpdated")
        .withArgs(1, await factory.getMaxDiscount(), await factory.getMaxMaturity(), 20_000n);
      const [curveType, maxDiscount, maxMaturity, parameter] = await bond.getDiscountCurve();
      expect([curveType, maxDiscount, maxMaturity, parameter]).to.deep.equal([
        1n, await factory.getMaxDiscount(), await factory.getMaxMaturity(), 20_000n,
      ]);
    });
  });

  describe("the factory's bounds", function () {
    it("are set on the factory, and every collection reads them", async function () {
      await factory.updateGlobalParameters(3_000n, 100n, 20n * 365n * BigInt(DAY));
      const [maxDiscount, maxMaturity] = await bond.getDiscountParameters();
      expect(maxDiscount).to.equal(3_000n);
      expect(maxMaturity).to.equal(20n * 365n * BigInt(DAY));
    });

    it("have no setters on the collection or the deposit contract to fail through", async function () {
      for (const name of ["updateDiscountParameters", "setMinDiscount", "updateFaceValueLimits", "updateMinMaturity"]) {
        expect(bond.interface.getFunction(name)).to.equal(null);
      }
      for (const name of ["updateDepositParameters", "setMinDiscount", "updateFaceValueLimits", "updateMinMaturity"]) {
        expect(deposit.interface.getFunction(name)).to.equal(null);
      }
    });
  });

  describe("a deactivated collection", function () {
    it("stops selling, and sells again once reactivated", async function () {
      const maturity = (await now()) + BigInt(12 * MONTH);
      await factory.deactivateCollection(await ctx.usdc.getAddress());
      await expect(buyBond(1_000n * ONE_USDC, maturity)).to.be.revertedWith("Collection inactive");

      await factory.reactivateCollection(await ctx.usdc.getAddress());
      await buyBond(1_000n * ONE_USDC, maturity);
      expect(await bond.balanceOf(buyer.address, 1)).to.equal(1n);
    });

    it("still redeems the bonds it already sold", async function () {
      const maturity = (await now()) + BigInt(2 * MONTH);
      await buyBond(1_000n * ONE_USDC, maturity);
      await factory.deactivateCollection(await ctx.usdc.getAddress());

      await advance(3 * MONTH);
      await ctx.usdc.mint(await vault.getAddress(), 1_000n * ONE_USDC);
      await bond.connect(buyer).setAutoRollOptOut(1, true);
      await bond.connect(buyer).redeemBond(1);
      expect(await bond.balanceOf(buyer.address, 1)).to.equal(0n);
    });
  });

  describe("buying a bond", function () {
    it("takes the purchase price and mints a bond to the buyer", async function () {
      const maturity = (await now()) + BigInt(6 * MONTH);
      const cost = await costOf(1_000n * ONE_USDC, maturity);
      const before = await ctx.usdc.balanceOf(buyer.address);

      await buyBond(1_000n * ONE_USDC, maturity);

      expect(before - (await ctx.usdc.balanceOf(buyer.address))).to.equal(cost);
      expect(await bond.balanceOf(buyer.address, 1)).to.equal(1n);
    });

    it("sends the proceeds to the vault rather than the AssurancePool", async function () {
      // The seniority fix, seen from the buying side: principal never enters loss absorption.
      // Since section 13 the bond contracts hold no AssurancePool address at all.
      const maturity = (await now()) + BigInt(6 * MONTH);
      const cost = await costOf(1_000n * ONE_USDC, maturity);

      await buyBond(1_000n * ONE_USDC, maturity);

      expect(await vault.held()).to.equal(cost);
      expect(await ctx.usdc.balanceOf(await deposit.getAddress())).to.equal(0n);
      expect(await ctx.usdc.balanceOf(await bond.getAddress())).to.equal(0n);
    });

    it("books the face value as owed the moment it takes the money", async function () {
      const maturity = (await now()) + BigInt(6 * MONTH);
      await buyBond(1_000n * ONE_USDC, maturity);

      expect(await vault.totalFaceOutstanding()).to.equal(1_000n * ONE_USDC);
    });

    it("refuses a face value outside the configured bounds", async function () {
      const maturity = (await now()) + BigInt(6 * MONTH);
      const tooSmall = (await factory.getMinFaceValue()) - 1n;
      await expect(
        buyBond(tooSmall, maturity)
      ).to.be.reverted;
    });

    it("refuses a maturity in the past", async function () {
      const past = (await now()) - 1n;
      await expect(
        buyBond(1_000n * ONE_USDC, past)
      ).to.be.reverted;
    });

    it("refuses a maturity further out than the ceiling", async function () {
      const tooFar = (await now()) + (await factory.getMaxMaturity()) + BigInt(DAY);
      await expect(
        buyBond(1_000n * ONE_USDC, tooFar)
      ).to.be.reverted;
    });
  });

  describe("redeeming", function () {
    async function buy(face: bigint, monthsOut: number) {
      const maturity = (await now()) + BigInt(monthsOut * MONTH);
      await buyBond(face, maturity);
      return maturity;
    }

    it("refuses before maturity", async function () {
      await buy(1_000n * ONE_USDC, 6);
      await expect(bond.connect(buyer).redeemBond(1)).to.be.revertedWith("Bond not yet mature");
    });

    it("pays face value at maturity", async function () {
      await buy(1_000n * ONE_USDC, 6);
      // The vault grows into its obligation; here it is topped up to stand in for that.
      await ctx.usdc.mint(await vault.getAddress(), 1_000n * ONE_USDC);
      await advance(7 * MONTH);

      const before = await ctx.usdc.balanceOf(buyer.address);
      await bond.connect(buyer).redeemBond(1);

      expect((await ctx.usdc.balanceOf(buyer.address)) - before).to.equal(1_000n * ONE_USDC);
      expect(await bond.balanceOf(buyer.address, 1)).to.equal(0n);
    });

    it("refuses a second redemption of the same bond", async function () {
      await buy(1_000n * ONE_USDC, 6);
      await ctx.usdc.mint(await vault.getAddress(), 1_000n * ONE_USDC);
      await advance(7 * MONTH);
      await bond.connect(buyer).redeemBond(1);

      await expect(bond.connect(buyer).redeemBond(1)).to.be.reverted;
    });

    it("refuses redemption by someone who does not hold it", async function () {
      await buy(1_000n * ONE_USDC, 6);
      await ctx.usdc.mint(await vault.getAddress(), 1_000n * ONE_USDC);
      await advance(7 * MONTH);

      await expect(bond.connect(other).redeemBond(1)).to.be.revertedWith("Not bond holder");
    });

    it("pays whoever holds it, since the bond is transferable", async function () {
      await buy(1_000n * ONE_USDC, 6);
      await ctx.usdc.mint(await vault.getAddress(), 1_000n * ONE_USDC);
      await bond.connect(buyer).safeTransferFrom(buyer.address, other.address, 1, 1, "0x");
      await advance(7 * MONTH);

      await bond.connect(other).redeemBond(1);
      expect(await ctx.usdc.balanceOf(other.address)).to.equal(1_000n * ONE_USDC);
    });

    it("refuses when the vault cannot cover it, rather than paying partially", async function () {
      await buy(1_000n * ONE_USDC, 6);
      await advance(7 * MONTH);
      // The vault holds only the discounted proceeds, not the full face.
      await expect(bond.connect(buyer).redeemBond(1))
        .to.be.revertedWithCustomError(vault, "BondVaultInsufficientFunds");
    });
  });

  describe("bond state", function () {
    it("records what was bought", async function () {
      const maturity = (await now()) + BigInt(6 * MONTH);
      await buyBond(1_000n * ONE_USDC, maturity);

      const info = await bond.getBondInfo(1);
      expect(info.faceValue).to.equal(1_000n * ONE_USDC);
      expect(info.maturityDate).to.equal(maturity);
      expect(info.isRedeemed).to.equal(false);
      expect(info.creator).to.equal(buyer.address);
    });

    it("reports maturity honestly", async function () {
      const maturity = (await now()) + BigInt(6 * MONTH);
      await buyBond(1_000n * ONE_USDC, maturity);

      expect(await bond.isBondMature(1)).to.equal(false);
      await advance(7 * MONTH);
      expect(await bond.isBondMature(1)).to.equal(true);
    });

    it("counts what it has issued", async function () {
      const maturity = (await now()) + BigInt(6 * MONTH);
      for (let i = 0; i < 3; i++) {
        await buyBond(1_000n * ONE_USDC, maturity);
      }
      expect(await bond.totalBondsMinted()).to.equal(3n);
    });
  });

  describe("wiring", function () {
    it("cannot redeem before the vault is set", async function () {
      // A collection created but never pointed at a vault would take money in and have no way to
      // pay it back out.
      await factory.createCollection(
        await ctx.usdt.getAddress(), "USDT", "Tether USD", "ipfs://bonds"
      );
      const info = await factory.getCollectionInfo(await ctx.usdt.getAddress());
      const fresh = await ethers.getContractAt("BurnerBond", info.collectionAddress);

      expect(await fresh.bondVault()).to.equal(ethers.ZeroAddress);
    });

    it("only lets the owner point it at a vault", async function () {
      await expect(bond.connect(other).setBondVault(await vault.getAddress())).to.be.reverted;
    });

    it("refuses a zero vault", async function () {
      await expect(bond.setBondVault(ethers.ZeroAddress))
        .to.be.revertedWith("Invalid BondVault address");
    });
  });

  describe("collections are clones", function () {
    it("keeps the factory deployable, which carrying a copy of this did not", async function () {
      const code = await ethers.provider.getCode(await factory.getAddress());
      expect((code.length - 2) / 2).to.be.lessThan(24_576);
    });

    it("gives each collection its own storage", async function () {
      await factory.createCollection(
        await ctx.usdt.getAddress(), "USDT", "Tether USD", "ipfs://bonds"
      );
      const info = await factory.getCollectionInfo(await ctx.usdt.getAddress());
      const other = await ethers.getContractAt("BurnerBond", info.collectionAddress);

      const maturity = (await now()) + BigInt(6 * MONTH);
      await buyBond(1_000n * ONE_USDC, maturity);

      expect(await bond.totalBondsMinted()).to.equal(1n);
      expect(await other.totalBondsMinted()).to.equal(0n);
      expect(await other.underlyingToken()).to.equal(await ctx.usdt.getAddress());
    });

    it("costs a fraction of a deployment to open one", async function () {
      const tx = await factory.createCollection(
        await ctx.usdt.getAddress(), "USDT", "Tether USD", "ipfs://bonds"
      );
      const receipt = await tx.wait();
      // A full BurnerBond deployment is millions of gas; a clone plus its initializer is not.
      expect(receipt!.gasUsed).to.be.lessThan(1_500_000n);
    });

    it("leaves the implementation itself uninitialisable", async function () {
      // A clone's implementation is never meant to be used directly, and one left open is an
      // implementation anybody can take ownership of.
      const implementation = await ethers.getContractAt(
        "BurnerBond", await factory.bondImplementation()
      );
      await expect(
        implementation.initialize(
          buyer.address, buyer.address, buyer.address, "", "", "", "",
          buyer.address, buyer.address
        )
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("batch redemption", function () {
    it("pays for every bond it burns", async function () {
      // It burned them and paid nothing: the payout was replaced when redemption moved to the
      // vault, and its twin twenty lines away was not.
      const maturity = (await now()) + BigInt(6 * MONTH);
      await buyBond(1_000n * ONE_USDC, maturity);
      await buyBond(500n * ONE_USDC, maturity);
      await ctx.usdc.mint(await vault.getAddress(), 1_500n * ONE_USDC);
      await advance(7 * MONTH);

      const before = await ctx.usdc.balanceOf(buyer.address);
      await bond.connect(buyer).batchRedeemBonds([1, 2]);

      expect((await ctx.usdc.balanceOf(buyer.address)) - before).to.equal(1_500n * ONE_USDC);
      expect(await bond.balanceOf(buyer.address, 1)).to.equal(0n);
      expect(await bond.balanceOf(buyer.address, 2)).to.equal(0n);
    });

    it("refuses the whole batch if one bond is not redeemable", async function () {
      const maturity = (await now()) + BigInt(6 * MONTH);
      const far = (await now()) + BigInt(18 * MONTH);
      await buyBond(1_000n * ONE_USDC, maturity);
      await buyBond(500n * ONE_USDC, far);
      await ctx.usdc.mint(await vault.getAddress(), 1_500n * ONE_USDC);
      await advance(7 * MONTH);

      await expect(bond.connect(buyer).batchRedeemBonds([1, 2]))
        .to.be.revertedWith("Bond not yet mature");
      expect(await bond.balanceOf(buyer.address, 1)).to.equal(1n);
    });

    it("refuses an empty batch", async function () {
      await expect(bond.connect(buyer).batchRedeemBonds([]))
        .to.be.revertedWith("No bonds to redeem");
    });
  });
});

describe("BurnerBond as collateral", function () {
  // A bond pledged against a credit line has to be reachable when the member defaults. It is one
  // token with an id rather than a balance, and it pays at maturity rather than on demand. Since
  // Phase 2e (founder answer G) nobody takes it: it is paid under its own pledge payment term,
  // `payPledged`, at what it is worth today. The full path is in
  // test/audit/compliance/PledgedBonds.spec.ts; this suite covers the bond on its own.
  let ctx: any, factory: any, deposit: any, bond: any, vault: any, signals: any;
  let buyer: any, coop: any, liquidator: any, other: any;

  const ONE = 10n ** 6n;
  const M = 30 * 24 * 60 * 60;

  beforeEach(async function () {
    const { deployPhase0Network } = await import("../helpers/phase0-fixture");
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [buyer, coop, liquidator, other] = [signers[8], signers[9], signers[10], signers[11]];

    factory = await deployBondFactory(
      await ctx.tokenRegistry.getAddress(), "ipfs://b"
    );
    deposit = await ethers.getContractAt(
      "BurnerBondDeposit", await factory.getUnifiedDepositContract()
    );
    await factory.createCollection(await ctx.usdc.getAddress(), "USDC", "USD Coin", "ipfs://b");
    const info = await factory.getCollectionInfo(await ctx.usdc.getAddress());
    bond = await ethers.getContractAt("BurnerBond", info.collectionAddress);

    const BondVault = await ethers.getContractFactory("BondVault");
    vault = await upgrades.deployProxy(
      BondVault, [ctx.admin.address, await ctx.usdc.getAddress(), 3 * M], { kind: "uups" }
    );
    await vault.grantRole(await vault.BOND_ROLE(), await deposit.getAddress());
    await vault.grantRole(await vault.BOND_ROLE(), await bond.getAddress());
    await deposit.setBondVault(await vault.getAddress());
    await bond.setBondVault(await vault.getAddress());
    await bond.setLiquidator(liquidator.address);

    await ctx.usdc.mint(buyer.address, 100_000n * ONE);
    await ctx.usdc.connect(buyer).approve(await deposit.getAddress(), 100_000n * ONE);

    const maturity = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + BigInt(12 * M);
    const discount = await bond.calculateDiscount(maturity);
    await deposit
      .connect(buyer)
      .makeDeposit(await ctx.usdc.getAddress(), 1_000n * ONE, maturity, discount);

    signals = await (await ethers.getContractFactory("MockCollateralSignals")).deploy();
    await bond.setEncumbranceSource(await signals.getAddress(), ethers.id("BOND"));
  });

  it("is worth its purchase price at the start and its face at maturity", async function () {
    const info = await bond.getBondInfo(1);
    const pv = await bond.presentValueOf(1);
    expect(pv).to.be.greaterThanOrEqual(info.purchasePrice);
    expect(pv).to.be.lessThan(1_000n * ONE);

    await ethers.provider.send("evm_increaseTime", [13 * M]);
    await ethers.provider.send("evm_mine", []);
    expect(await bond.presentValueOf(1)).to.equal(1_000n * ONE);
  });

  it("accretes toward face as the term runs", async function () {
    const early = await bond.presentValueOf(1);
    await ethers.provider.send("evm_increaseTime", [6 * M]);
    await ethers.provider.send("evm_mine", []);
    const later = await bond.presentValueOf(1);

    expect(later).to.be.greaterThan(early);
    expect(later).to.be.lessThan(1_000n * ONE);
  });

  it("answers its Accreted Value, which is its present value", async function () {
    await ethers.provider.send("evm_increaseTime", [6 * M]);
    await ethers.provider.send("evm_mine", []);
    expect(await bond.accretedValue(1)).to.equal(await bond.presentValueOf(1));
  });

  it("the seize-and-redeem path is gone: no seizeBond, redeemEarly, default source or settlement gate", async function () {
    for (const fn of ["seizeBond", "redeemEarly", "setDefaultSource", "setSettlementGate", "defaultSource", "settlementGate"]) {
      expect(bond.interface.getFunction(fn), fn).to.equal(null);
    }
    // Not reachable by selector either: the collection has no fallback.
    const legacy = new ethers.Interface([
      "function seizeBond(uint256,address,address)",
      "function redeemEarly(uint256)",
    ]);
    await expect(liquidator.sendTransaction({
      to: await bond.getAddress(), data: legacy.encodeFunctionData("seizeBond", [1, buyer.address, liquidator.address]),
    })).to.be.reverted;
    await expect(liquidator.sendTransaction({
      to: await bond.getAddress(), data: legacy.encodeFunctionData("redeemEarly", [1]),
    })).to.be.reverted;
    expect(await bond.balanceOf(buyer.address, 1)).to.equal(1n);
  });

  it("nobody, the named liquidator included, can move a pledged bond", async function () {
    await signals.setItemPledged(buyer.address, 1, true);
    await expect(bond.connect(buyer).safeTransferFrom(buyer.address, coop.address, 1, 1, "0x"))
      .to.be.revertedWithCustomError(bond, "BurnerBondPledged").withArgs(1);
    await bond.connect(buyer).setApprovalForAll(liquidator.address, true);
    await expect(bond.connect(liquidator).safeTransferFrom(buyer.address, liquidator.address, 1, 1, "0x"))
      .to.be.revertedWithCustomError(bond, "BurnerBondPledged").withArgs(1);
  });

  it("payPledged pays nothing on an unpledged bond, or without a pledge module that asks for it", async function () {
    // Unpledged: reverts whoever calls.
    for (const caller of [buyer, coop, liquidator, other]) {
      await expect(bond.connect(caller).payPledged(1))
        .to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable").withArgs(1);
    }
    // Pledged, but the named liquidator is an account, not a pledge module: it cannot answer.
    await signals.setItemPledged(buyer.address, 1, true);
    await expect(bond.connect(liquidator).payPledged(1)).to.be.reverted;
    // A bond that does not exist.
    await expect(bond.payPledged(99))
      .to.be.revertedWithCustomError(bond, "BurnerBondNotPledgePayable").withArgs(99);
    expect(await bond.balanceOf(buyer.address, 1)).to.equal(1n);
  });

  it("settle pays an unpledged bond that opted out of rolling to its holder, whoever calls", async function () {
    await ctx.usdc.mint(await vault.getAddress(), 1_000n * ONE);
    await expect(bond.connect(other).settle(1))
      .to.be.revertedWithCustomError(bond, "BurnerBondNotSettleable").withArgs(1); // not mature
    await ethers.provider.send("evm_increaseTime", [13 * M]);
    await ethers.provider.send("evm_mine", []);
    await expect(bond.connect(other).settle(1))
      .to.be.revertedWithCustomError(bond, "BurnerBondNotSettleable").withArgs(1); // rolls
    await bond.connect(buyer).setAutoRollOptOut(1, true);
    const before = await ctx.usdc.balanceOf(buyer.address);
    await expect(bond.connect(other).settle(1)).to.emit(bond, "BondRedeemed").withArgs(1, buyer.address, 1_000n * ONE);
    expect(await ctx.usdc.balanceOf(buyer.address)).to.equal(before + 1_000n * ONE);
    expect(await ctx.usdc.balanceOf(other.address)).to.equal(0n);
    expect(await bond.balanceOf(buyer.address, 1)).to.equal(0n);
  });
});

describe("auto-roll", function () {
  // A pledged bond that simply matures leaves the member's limit contracting hard the day it
  // does, and if they have already spent the proceeds there is nothing to replace it with.
  let ctx: any, factory: any, deposit: any, bond: any, vault: any;
  let buyer: any, liquidator: any;

  const ONE = 10n ** 6n;
  const M = 30 * 24 * 60 * 60;

  beforeEach(async function () {
    const { deployPhase0Network } = await import("../helpers/phase0-fixture");
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [buyer, liquidator] = [signers[8], signers[10]];

    factory = await deployBondFactory(
      await ctx.tokenRegistry.getAddress(), "ipfs://b"
    );
    deposit = await ethers.getContractAt(
      "BurnerBondDeposit", await factory.getUnifiedDepositContract()
    );
    await factory.createCollection(await ctx.usdc.getAddress(), "USDC", "USD Coin", "ipfs://b");
    const info = await factory.getCollectionInfo(await ctx.usdc.getAddress());
    bond = await ethers.getContractAt("BurnerBond", info.collectionAddress);

    const BondVault = await ethers.getContractFactory("BondVault");
    vault = await upgrades.deployProxy(
      BondVault, [ctx.admin.address, await ctx.usdc.getAddress(), 3 * M], { kind: "uups" }
    );
    await vault.grantRole(await vault.BOND_ROLE(), await deposit.getAddress());
    await vault.grantRole(await vault.BOND_ROLE(), await bond.getAddress());
    await deposit.setBondVault(await vault.getAddress());
    await bond.setBondVault(await vault.getAddress());
    await bond.setLiquidator(liquidator.address);

    await ctx.usdc.mint(buyer.address, 100_000n * ONE);
    await ctx.usdc.connect(buyer).approve(await deposit.getAddress(), 100_000n * ONE);
    const maturity = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + BigInt(6 * M);
    await deposit.connect(buyer).makeDeposit(
      await ctx.usdc.getAddress(), 1_000n * ONE, maturity, await bond.calculateDiscount(maturity)
    );
  });

  async function mature() {
    await ethers.provider.send("evm_increaseTime", [7 * M]);
    await ethers.provider.send("evm_mine", []);
  }

  it("rolls by default, so a pledged position does not lapse", async function () {
    expect(await bond.willAutoRoll(1)).to.equal(true);
    await mature();

    await bond.connect(buyer).rollBond(1);
    expect(await bond.balanceOf(buyer.address, 1)).to.equal(0n);
    expect(await bond.balanceOf(buyer.address, 2)).to.equal(1n);
  });

  it("buys more face value with the matured value, without moving cash", async function () {
    const held = await vault.held();
    await mature();
    await bond.connect(buyer).rollBond(1);

    const replacement = await bond.getBondInfo(2);
    expect(replacement.purchasePrice).to.equal(1_000n * ONE);
    expect(replacement.faceValue).to.be.greaterThan(1_000n * ONE);
    // The vault keeps what it had: rolling is not a payout.
    expect(await vault.held()).to.equal(held);
  });

  it("moves the obligation rather than clearing it", async function () {
    await mature();
    await bond.connect(buyer).rollBond(1);

    const replacement = await bond.getBondInfo(2);
    expect(await vault.totalFaceOutstanding()).to.equal(replacement.faceValue);
  });

  it("lets a holder ask for the cash instead", async function () {
    await bond.connect(buyer).setAutoRollOptOut(1, true);
    expect(await bond.willAutoRoll(1)).to.equal(false);
    await mature();

    await expect(bond.connect(buyer).rollBond(1))
      .to.be.revertedWith("Bond opted out of rolling");

    await ctx.usdc.mint(await vault.getAddress(), 1_000n * ONE);
    await bond.connect(buyer).redeemBond(1);
    expect(await ctx.usdc.balanceOf(buyer.address)).to.be.greaterThan(0n);
  });

  it("refuses to roll before maturity", async function () {
    await expect(bond.connect(buyer).rollBond(1)).to.be.revertedWith("Bond not yet mature");
  });

  it("rolls a pledged bond for its holder, and for nobody else", async function () {
    // Phase 2e: the co-op no longer holds seized bonds, so there is no co-op exemption to keep.
    const signals = await (await ethers.getContractFactory("MockCollateralSignals")).deploy();
    await bond.setEncumbranceSource(await signals.getAddress(), ethers.id("BOND"));
    await signals.setItemPledged(buyer.address, 1, true);
    await mature();

    await expect(bond.connect(liquidator).rollBond(1)).to.be.revertedWith("Not bond holder");
    await bond.connect(buyer).rollBond(1);
    expect(await bond.balanceOf(buyer.address, 2)).to.equal(1n);
  });
});
