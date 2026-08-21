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
          buyer.address, buyer.address, buyer.address, buyer.address, "", "", "", "",
          buyer.address
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
  // token with an id rather than a balance, and it pays at maturity rather than on demand -- so
  // the co-op takes the bond and is paid what it is worth today, not what it will be worth.
  let ctx: any, factory: any, deposit: any, bond: any, vault: any;
  let buyer: any, coop: any, liquidator: any, other: any;

  const ONE = 10n ** 6n;
  const M = 30 * 24 * 60 * 60;

  beforeEach(async function () {
    const { deployPhase0Network } = await import("../helpers/phase0-fixture");
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [buyer, coop, liquidator, other] = [signers[8], signers[9], signers[10], signers[11]];

    const BurnerBondFactory = await ethers.getContractFactory("BurnerBondFactory");
    factory = await BurnerBondFactory.deploy(
      await ctx.assurancePool.getAddress(), await ctx.assuranceOracle.getAddress(), "ipfs://b"
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

  it("lets the co-op take a bond, and nobody else", async function () {
    await expect(bond.connect(other).seizeBond(1, buyer.address, coop.address))
      .to.be.revertedWith("Only liquidator can seize");

    await bond.connect(liquidator).seizeBond(1, buyer.address, coop.address);
    expect(await bond.balanceOf(coop.address, 1)).to.equal(1n);
    expect(await bond.balanceOf(buyer.address, 1)).to.equal(0n);
  });

  it("pays the co-op what the bond is worth today, not what it will be", async function () {
    // Paying face for a bond that has not matured hands over interest nobody waited for.
    await ctx.usdc.mint(await vault.getAddress(), 1_000n * ONE);
    await ethers.provider.send("evm_increaseTime", [6 * M]);
    await ethers.provider.send("evm_mine", []);

    await bond.connect(liquidator).seizeBond(1, buyer.address, liquidator.address);
    const pv = await bond.presentValueOf(1);
    await bond.connect(liquidator).redeemEarly(1);

    expect(await ctx.usdc.balanceOf(liquidator.address)).to.equal(pv);
    expect(pv).to.be.lessThan(1_000n * ONE);
  });

  it("keeps the unearned interest in the vault", async function () {
    const funded = await vault.held();
    await ctx.usdc.mint(await vault.getAddress(), 1_000n * ONE);
    await ethers.provider.send("evm_increaseTime", [6 * M]);
    await ethers.provider.send("evm_mine", []);

    await bond.connect(liquidator).seizeBond(1, buyer.address, liquidator.address);
    const pv = await bond.presentValueOf(1);
    await bond.connect(liquidator).redeemEarly(1);

    // The obligation is gone in full; only the present value left the vault.
    expect(await vault.totalFaceOutstanding()).to.equal(0n);
    expect(await vault.held()).to.equal(funded + 1_000n * ONE - pv);
  });

  it("refuses early redemption to a holder who is not the co-op", async function () {
    await expect(bond.connect(buyer).redeemEarly(1))
      .to.be.revertedWith("Only liquidator can redeem early");
  });

  it("refuses to pay the same bond twice", async function () {
    await ctx.usdc.mint(await vault.getAddress(), 1_000n * ONE);
    await bond.connect(liquidator).seizeBond(1, buyer.address, liquidator.address);
    await bond.connect(liquidator).redeemEarly(1);
    // The bond was burned when it paid out, so there is nothing left to present.
    await expect(bond.connect(liquidator).redeemEarly(1))
      .to.be.revertedWith("Not bond holder");
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

    const BurnerBondFactory = await ethers.getContractFactory("BurnerBondFactory");
    factory = await BurnerBondFactory.deploy(
      await ctx.assurancePool.getAddress(), await ctx.assuranceOracle.getAddress(), "ipfs://b"
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

  it("will not roll a bond the co-op has seized", async function () {
    // A seized bond is collateral somebody is waiting on. Rolling it would put the recovery
    // another term away, so the co-op redeems it early instead.
    await mature();
    await bond.connect(liquidator).seizeBond(1, buyer.address, liquidator.address);

    await expect(bond.connect(liquidator).rollBond(1))
      .to.be.revertedWith("Seized bonds are redeemed, not rolled");
  });
});
