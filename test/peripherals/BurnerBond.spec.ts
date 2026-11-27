import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";
import { deployBondFactory, deployBondStack, bondAt, BOND_LEGEND, U, DAY } from "../helpers/bonds";

/*
 * The BurnerBond collection (Phase 2f: the new collection).
 *
 * Changed in Phase 2f and why (decision 8, C7; R4; Earn §§1, 4, 4A):
 *  - "pricing", "the discount curve", "the factory's bounds": removed. A bond is priced by a quote at
 *    the Ladder's Issue Yield with compounding Accreted Value (Accretion), not the discount curve.
 *  - "buying a bond": by a quote the payer signs, straight into the vault (BurnerBondDeposit's
 *    makeDeposit path is retired for the new collection). Bounds are EarnControls' ($250 minimum,
 *    Ladder terms of 12-36 months, decision 41); test/earn/Bonds.spec.ts covers them.
 *  - "redeeming" and "batch redemption": Holder redemption is gone; `settle` is permissionless.
 *  - "auto-roll": replaced by roll by confirmation (Earn §4A), tested in test/earn/Bonds.spec.ts.
 *  - "pays whoever holds it, since the bond is transferable": a bond moves only within Earn §1's
 *    allowlist now.
 */
describe("BurnerBond", function () {
  // The chain's clock is shared by every spec in a run, and these tests travel years (12- to
  // 36-month terms, rolls). Each test runs in a snapshot that is reverted afterwards, so it leaves the
  // clock where it found it and later specs stay inside the BondVault's maturity buckets (to 2109).
  let clockSnapshot: string;
  beforeEach(async function () {
    clockSnapshot = await ethers.provider.send("evm_snapshot", []);
  });
  afterEach(async function () {
    await ethers.provider.send("evm_revert", [clockSnapshot]);
  });

  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let s: Awaited<ReturnType<typeof deployBondStack>>;
  let factory: any, bond: any, vault: any;
  let buyer: any, other: any, keeper: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [buyer, other, keeper] = [signers[8], signers[9], signers[10]];
    // USDT is whitelisted for the "own storage" test (the fixture registers USDC).
    await ctx.tokenRegistry.registerToken(await ctx.usdt.getAddress(), 31337, await ctx.usdt.getAddress(), 0);
    s = await deployBondStack(ctx.admin, ctx.usdc, ctx.tokenRegistry, { rungs: [[365, 475], [730, 500]] });
    ({ factory, bond, vault } = s);
  });

  async function advance(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  describe("the collection", function () {
    it("is created against a whitelisted token and carries the IV-01 §4.12 legend", async function () {
      expect(await bond.collectionName()).to.equal("USD Coin BurnerBonds");
      expect(await bond.collectionSymbol()).to.equal("USDC-BB");
      expect(await bond.underlyingToken()).to.equal(await ctx.usdc.getAddress());
      expect(await bond.legendHash()).to.equal(ethers.id(BOND_LEGEND));
      expect(await bond.contractURI()).to.contain(await bond.legendURI());
      expect(await bond.cent()).to.equal(10_000n);
    });

    it("refuses a token the registry does not whitelist", async function () {
      const stranger = await (await ethers.getContractFactory("MockERC20")).deploy("Stranger", "STR", 18);
      await expect(factory.createCollection(await stranger.getAddress(), "STR", "Stranger", "ipfs://bonds"))
        .to.be.revertedWith("Token not whitelisted");
    });

    it("pays only into a vault holding its own token", async function () {
      const weth: any = await upgrades.deployProxy(await ethers.getContractFactory("BondVault"),
        [ctx.admin.address, await ctx.weth.getAddress(), 0], { kind: "uups" });
      await expect(bond.setSources(await weth.getAddress(), ethers.ZeroAddress, ethers.ZeroHash, await s.controls.getAddress(), ethers.ZeroAddress))
        .to.be.revertedWithCustomError(bond, "BurnerBondInvalidAddress");
    });

    it("can start its ids above another collection's, and shares the vault without colliding", async function () {
      await s.buy(buyer, U(1_000), 365); // bond 1 in this collection
      const nextFactory = await deployBondFactory(await ctx.tokenRegistry.getAddress(), "ipfs://bonds");
      await nextFactory.createCollection(await ctx.usdc.getAddress(), "USDC", "USD Coin", "ipfs://bonds");
      const next = await bondAt((await nextFactory.getCollectionInfo(await ctx.usdc.getAddress())).collectionAddress, ctx.admin);
      await next.setSources(await vault.getAddress(), ethers.ZeroAddress, ethers.ZeroHash, await s.controls.getAddress(), ethers.ZeroAddress);
      await vault.grantRole(await vault.BOND_ROLE(), await next.getAddress());
      await s.controls.grantRoleByResolution(await s.controls.BOND_ROLE(), await next.getAddress(), ethers.id("resolution"));
      await next.setFirstBondId(1001n);
      expect(await next.totalBondsMinted()).to.equal(0n);
      expect((await vault.obligations(1n)).faceValue).to.equal(U(1_000));
      await expect(bond.setFirstBondId(5000n)).to.be.revertedWithCustomError(bond, "BurnerBondAlreadyIssued");
    });

    it("refuses a second collection for the same token", async function () {
      await expect(factory.createCollection(await ctx.usdc.getAddress(), "USDC", "USD Coin", "ipfs://bonds"))
        .to.be.revertedWith("Collection already exists");
    });

    it("hands ownership to the factory owner, not the factory", async function () {
      expect(await bond.owner()).to.equal(ctx.admin.address);
    });

    it("a deactivated collection stops selling, sells again once reactivated, and still settles", async function () {
      const { id } = await s.buy(buyer, U(1_000), 365);
      await factory.deactivateCollection(await ctx.usdc.getAddress());
      await expect(s.buy(buyer, U(1_000), 365)).to.be.revertedWithCustomError(bond, "BurnerBondWindDown");
      await advance(365 * DAY);
      await ctx.usdc.mint(await vault.getAddress(), U(100));
      await bond.connect(keeper).settle(id);
      await factory.reactivateCollection(await ctx.usdc.getAddress());
      await s.buy(buyer, U(1_000), 365);
    });
  });

  describe("buying a bond (Earn §1)", function () {
    it("takes the Purchase Price into the vault, never the AssurancePool, and books the Maturity Amount at once", async function () {
      const before = await ctx.usdc.balanceOf(buyer.address);
      const { id, price } = await s.buy(buyer, U(1_000), 365);
      expect(await bond.balanceOf(buyer.address, id)).to.equal(1n);
      expect(await vault.held()).to.equal(price);
      expect((await ctx.usdc.balanceOf(buyer.address)) - before).to.equal(0n); // the helper funded exactly the price
      expect(await vault.totalFaceOutstanding()).to.equal(U(1_000));
      expect(price).to.equal(await bond.quotePrice(U(1_000), 365, 475));
      expect(price).to.be.lessThan(U(1_000));
    });

    it("records what was bought: Maturity Amount, Issue Yield, term, issue and maturity dates, cost and exemption tag", async function () {
      const { id, price } = await s.buy(buyer, U(2_500), 730);
      const b = await bond.getBondInfo(id);
      expect(b.faceValue).to.equal(U(2_500));
      expect(b.yieldBps).to.equal(500n);
      expect(b.termDays).to.equal(730n);
      expect(b.maturityDate - b.issuedAt).to.equal(730n * BigInt(DAY));
      expect(b.purchasePrice).to.equal(price);
      expect(b.costBasis).to.equal(price);
      expect(b.exemptionCode).to.equal(ethers.encodeBytes32String("506C"));
      expect(await bond.holderOf(id)).to.equal(buyer.address);
      expect((await vault.bondTerms(id)).yieldBps).to.equal(500n);
    });

    it("counts what it has issued and reports maturity honestly", async function () {
      const { id } = await s.buy(buyer, U(1_000), 365);
      await s.buy(buyer, U(1_000), 365);
      expect(await bond.totalBondsMinted()).to.equal(2n);
      expect(await bond.isBondMature(id)).to.equal(false);
      await advance(365 * DAY);
      expect(await bond.isBondMature(id)).to.equal(true);
    });
  });

  describe("value (R4: compounding at the Issue Yield)", function () {
    it("is about its Purchase Price at issue, accretes as the term runs, and is its Maturity Amount at maturity", async function () {
      const { id, price } = await s.buy(buyer, U(1_000), 365);
      const atIssue = await bond.accretedValue(id);
      expect(atIssue - price).to.be.lessThan(10_000n); // the price is floored to the cent
      await advance(180 * DAY);
      const half = await bond.accretedValue(id);
      expect(half).to.be.greaterThan(atIssue);
      expect(await bond.presentValueOf(id)).to.equal(half);
      await advance(186 * DAY);
      expect(await bond.accretedValue(id)).to.equal(U(1_000));
    });
  });

  describe("settlement (Earn §4)", function () {
    it("refuses before maturity, and pays the Holder at maturity whoever calls", async function () {
      const { id } = await s.buy(buyer, U(1_000), 365);
      await expect(bond.connect(keeper).settle(id)).to.be.revertedWithCustomError(bond, "BurnerBondNotSettleable");
      await advance(365 * DAY);
      await ctx.usdc.mint(await vault.getAddress(), U(100));
      const before = await ctx.usdc.balanceOf(buyer.address);
      await bond.connect(keeper).settle(id);
      expect((await ctx.usdc.balanceOf(buyer.address)) - before).to.equal(U(1_000));
      await expect(bond.connect(keeper).settle(id)).to.be.revertedWithCustomError(bond, "BurnerBondUnknown");
    });
  });

  describe("collections are clones", function () {
    it("keeps the factory deployable", async function () {
      const code = await ethers.provider.getCode(await factory.getAddress());
      expect((code.length - 2) / 2).to.be.lessThan(24_576);
    });

    it("gives each collection its own storage", async function () {
      await factory.createCollection(await ctx.usdt.getAddress(), "USDT", "Tether USD", "ipfs://bonds");
      const other_ = await bondAt((await factory.getCollectionInfo(await ctx.usdt.getAddress())).collectionAddress);
      await s.buy(buyer, U(1_000), 365);
      expect(await bond.totalBondsMinted()).to.equal(1n);
      expect(await other_.totalBondsMinted()).to.equal(0n);
      expect(await other_.underlyingToken()).to.equal(await ctx.usdt.getAddress());
    });

    it("costs a fraction of a deployment to open one", async function () {
      const receipt = await (await factory.createCollection(await ctx.usdt.getAddress(), "USDT", "Tether USD", "ipfs://bonds")).wait();
      expect(receipt!.gasUsed).to.be.lessThan(1_500_000n);
    });

    it("leaves the implementation itself uninitialisable, and the factory takes only a Phase 2f implementation", async function () {
      const implementation = await ethers.getContractAt("BurnerBond", await factory.bondImplementation());
      await expect(implementation.initialize(other.address, await ctx.usdc.getAddress(), "", "", "", "", other.address, ethers.ZeroHash, ""))
        .to.be.revertedWith("Initializable: contract is already initialized");
      const Factory = await ethers.getContractFactory("BurnerBondFactory");
      await expect(Factory.deploy(await ctx.tokenRegistry.getAddress(), "ipfs://x", await vault.getAddress(), ethers.ZeroHash, "")).to.be.reverted;
    });
  });

  describe("wiring", function () {
    it("only lets the owner name its sources, and refuses a zero vault or controls", async function () {
      await expect(bond.connect(other).setSources(await vault.getAddress(), ethers.ZeroAddress, ethers.ZeroHash, await s.controls.getAddress(), ethers.ZeroAddress)).to.be.reverted;
      await expect(bond.setSources(ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroHash, await s.controls.getAddress(), ethers.ZeroAddress))
        .to.be.revertedWithCustomError(bond, "BurnerBondInvalidAddress");
    });
  });
});
