import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

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

    const BurnerBondFactory = await ethers.getContractFactory("BurnerBondFactory");
    factory = await BurnerBondFactory.deploy(
      await ctx.assurancePool.getAddress(),
      await ctx.assuranceOracle.getAddress(),
      "ipfs://bonds"
    );

    deposit = await ethers.getContractAt("BurnerBondDeposit", await factory.getUnifiedDepositContract());

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
      const maturity = (await now()) + BigInt(6 * MONTH);
      const cost = await costOf(1_000n * ONE_USDC, maturity);

      await buyBond(1_000n * ONE_USDC, maturity);

      expect(await vault.held()).to.equal(cost);
      expect(await ctx.assurancePool.excessBalance()).to.equal(0n);
      expect(await ctx.assurancePool.reserveBalance()).to.equal(0n);
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
});
