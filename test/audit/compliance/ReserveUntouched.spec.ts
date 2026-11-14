import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network, drawCredit } from "../../helpers/phase0-fixture";
import { driveToDefault } from "../../helpers/default";
import { issuerProxyOptions } from "../../helpers/issuers";
import { deployAssurancePool, fund, balances, TAG, AssuranceSetup } from "../../helpers/assurance";

/*
 * Compliance addendum 12.11 (restated by section 13): no redemption, payout or force-settlement
 * path touches the AssurancePool, and bond principal never enters it.
 *
 * Each test funds both compartments of the co-op's AssurancePool, runs a path, and checks that the
 * pool's token balance and each compartment are exactly as they were. Phase 2b stopped
 * PayoutPool.drawForDueClaim and BondVault._cover asking the pool to lend, and BurnerBondDeposit
 * depositing bond principal into it. Phase 2c (section 13) rebuilt the pool around compartments and
 * removed every address the credit, payout and bond contracts held for it, so there is no longer
 * anything to "name as a lender": these tests now run with the pool simply existing beside them.
 */
const ONE_USDC = 10n ** 6n;
const DAY = 24 * 60 * 60;
const MONTH = 30 * DAY;
const NET_30 = 30 * DAY;
const SAVINGS = ethers.encodeBytes32String("SAVINGS");

async function now() {
  return (await ethers.provider.getBlock("latest"))!.timestamp;
}

async function advance(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

type Ctx = Awaited<ReturnType<typeof deployPhase0Network>> & { assurance: AssuranceSetup };

/** The co-op's AssurancePool, with money in both compartments. */
async function fillReserve(ctx: Awaited<ReturnType<typeof deployPhase0Network>>): Promise<Ctx> {
  const assurance = await deployAssurancePool(ctx.usdc, ctx.networkRegistry);
  await fund(assurance, ctx.usdc, assurance.treasury, TAG.INTERCHANGE, 600n * ONE_USDC);
  await fund(assurance, ctx.usdc, assurance.lendingCo, TAG.RECOVERY, 300n * ONE_USDC);
  return { ...ctx, assurance };
}

/** Everything the AssurancePool holds, to compare before and after a path runs. */
async function holdings(ctx: Ctx) {
  const pool = ctx.assurance.pool;
  const b = await balances(pool);
  return [await ctx.usdc.balanceOf(await pool.getAddress()), ...Object.values(b.byId), b.sum];
}

describe("COMPLIANCE addendum 12.11: the AssurancePool is untouched by redemption, payout and liquidation", function () {
  describe("bond principal never reaches the AssurancePool", function () {
    async function bondSetup() {
      const ctx = await fillReserve(await deployPhase0Network());
      const signers = await ethers.getSigners();
      const [buyer, safe] = [signers[8], signers[9]];
      const factory: any = await (await ethers.getContractFactory("BurnerBondFactory")).deploy(
        await ctx.tokenRegistry.getAddress(), "ipfs://b"
      );
      const deposit: any = await ethers.getContractAt("BurnerBondDeposit", await factory.getUnifiedDepositContract());
      await factory.createCollection(await ctx.usdc.getAddress(), "USDC", "USD Coin", "ipfs://b");
      const bond: any = await ethers.getContractAt("BurnerBond", (await factory.getCollectionInfo(await ctx.usdc.getAddress())).collectionAddress);
      const vault: any = await upgrades.deployProxy(await ethers.getContractFactory("BondVault"), [ctx.admin.address, await ctx.usdc.getAddress(), 3 * MONTH], { kind: "uups" });
      await vault.grantRole(await vault.BOND_ROLE(), await deposit.getAddress());
      await vault.grantRole(await vault.BOND_ROLE(), await bond.getAddress());
      await deposit.setBondVault(await vault.getAddress());
      await bond.setBondVault(await vault.getAddress());
      await vault.setBackstops(safe.address, ethers.ZeroAddress);
      await ctx.usdc.mint(buyer.address, 100_000n * ONE_USDC);
      await ctx.usdc.connect(buyer).approve(await deposit.getAddress(), ethers.MaxUint256);
      return { ctx, deposit, bond, vault, buyer, safe };
    }

    it("puts every deposit's principal in the bond vault and none in the AssurancePool", async function () {
      const { ctx, deposit, bond, vault, buyer } = await bondSetup();
      const before = await holdings(ctx);
      const maturity = BigInt(await now()) + BigInt(12 * MONTH);
      const paid0 = await ctx.usdc.balanceOf(buyer.address);
      await deposit.connect(buyer).makeDeposit(await ctx.usdc.getAddress(), 1_000n * ONE_USDC, maturity, await bond.calculateDiscount(maturity));
      const principal = paid0 - (await ctx.usdc.balanceOf(buyer.address));

      expect(principal).to.be.greaterThan(0n);
      expect(await vault.held()).to.equal(principal);
      expect(await holdings(ctx)).to.deep.equal(before);
      // The old path into the AssurancePool's excess (processDeposit) now routes to the vault, and
      // has nothing to process anyway: every deposit is processed in the call that makes it.
      await expect(deposit.processDeposit(1)).to.be.revertedWith("Deposit already processed");
    });

    it("redeems a matured bond from the vault and the treasury, never the AssurancePool", async function () {
      const { ctx, deposit, bond, vault, buyer, safe } = await bondSetup();
      const maturity = BigInt(await now()) + BigInt(2 * MONTH);
      await deposit.connect(buyer).makeDeposit(await ctx.usdc.getAddress(), 1_000n * ONE_USDC, maturity, await bond.calculateDiscount(maturity));
      const bondId = await bond.bondIdsByCreator(buyer.address, 0);
      const before = await holdings(ctx);
      await advance(2 * MONTH + 1);

      // The vault holds the discounted principal, not the face. With no treasury allowance the
      // redemption waits; the AssurancePool's excess and buffer are not asked.
      await expect(bond.connect(buyer).redeemBond(bondId)).to.be.reverted;
      expect(await holdings(ctx)).to.deep.equal(before);

      await ctx.usdc.mint(safe.address, 1_000n * ONE_USDC);
      await ctx.usdc.connect(safe).approve(await vault.getAddress(), 1_000n * ONE_USDC);
      await bond.connect(buyer).redeemBond(bondId);
      expect(await holdings(ctx)).to.deep.equal(before);
    });
  });

  describe("payout and liquidation paths", function () {
    it("merchant redemption, queued payment, a due-claim draw and repayment routing", async function () {
      const ctx = await fillReserve(await deployPhase0Network());
      const signers = await ethers.getSigners();
      const [coop, funder] = [signers[8], signers[10]];
      const registry: any = await upgrades.deployProxy(await ethers.getContractFactory("MerchantRegistry"), [ctx.admin.address, NET_30], { kind: "uups" });
      const pool: any = await upgrades.deployProxy(await ethers.getContractFactory("PayoutPool"), [
        ctx.admin.address, await ctx.stableCredit.getAddress(), await ctx.usdc.getAddress(), await registry.getAddress(), coop.address,
      ], { kind: "uups" });
      await pool.grantRole(await pool.FUNDER_ROLE(), funder.address);
      await registry.registerMerchant(ctx.counterparty.address, NET_30, 50_000n * ONE_USDC, 200n);
      await ctx.stableCredit.connect(ctx.admin).setPayoutPool(await pool.getAddress());
      await drawCredit(ctx, 1_000n * ONE_USDC);
      await ctx.stableCredit.connect(ctx.counterparty).approve(await pool.getAddress(), ethers.MaxUint256);
      const before = await holdings(ctx);

      // Queued, then past due with nothing in the pool: the draw refuses rather than borrow.
      await pool.connect(ctx.counterparty).redeem(400n * ONE_USDC);
      await advance(NET_30 + DAY);
      await expect(pool.drawForDueClaim()).to.be.revertedWithCustomError(pool, "PayoutPoolInsufficientFunds");
      expect(await holdings(ctx)).to.deep.equal(before);

      // The member repays: it reaches the payout pool, which pays the claim.
      await ctx.usdc.mint(ctx.member.address, 400n * ONE_USDC);
      await ctx.usdc.connect(ctx.member).approve(await ctx.stableCredit.getAddress(), ethers.MaxUint256);
      await ctx.stableCredit.connect(ctx.member).repayCreditBalance(ctx.member.address, 400n * ONE_USDC);
      await pool.payNext();
      expect(await ctx.usdc.balanceOf(ctx.counterparty.address)).to.equal(400n * ONE_USDC);
      expect(await holdings(ctx)).to.deep.equal(before);

      // Funded beats queued: paid on the spot, out of capital.
      await ctx.usdc.mint(funder.address, 600n * ONE_USDC);
      await ctx.usdc.connect(funder).approve(await pool.getAddress(), ethers.MaxUint256);
      await pool.connect(funder).fund(600n * ONE_USDC);
      await pool.connect(ctx.counterparty).redeem(600n * ONE_USDC);
      expect(await ctx.usdc.balanceOf(ctx.counterparty.address)).to.equal(1_000n * ONE_USDC);
      expect(await holdings(ctx)).to.deep.equal(before);
    });

    it("permissionless liquidation of pledged savings, and a member's CLRUSD redemption", async function () {
      const ctx = await fillReserve(await deployPhase0Network());
      const [, , , , , , , , coop, , , stranger] = await ethers.getSigners();
      const ClearUSD = await ethers.getContractFactory("ClearUSDUpgradeable");
      const clrusd: any = await upgrades.deployProxy(ClearUSD,
        ["Clear USD", "CLRUSD", 6, 0, 0, ctx.admin.address, ctx.admin.address],
        { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
      const vault: any = await upgrades.deployProxy(await ethers.getContractFactory("ESADepositVault"), [await clrusd.getAddress(), ctx.admin.address], { kind: "uups" });
      await clrusd.grantRole(await clrusd.MINTER_ROLE(), await vault.getAddress());
      await clrusd.grantRole(await clrusd.BURNER_ROLE(), await vault.getAddress());
      await vault.setAcceptedToken(await ctx.usdc.getAddress(), true);

      const issuer: any = await upgrades.deployProxy(await ethers.getContractFactory("RevolvingIssuer"), [await ctx.stableCredit.getAddress(), coop.address], { ...(await issuerProxyOptions("RevolvingIssuer")),  kind: "uups" });
      await ctx.networkRegistry.registerIssuer(await issuer.getAddress(), await ctx.stableCredit.getAddress());
      await ctx.access.grantOperator(await issuer.getAddress());
      await issuer.connect(ctx.operator).addTier(SAVINGS, 0n, 30 * DAY);
      const registry: any = await upgrades.deployProxy(await ethers.getContractFactory("CollateralRegistry"), [ctx.admin.address, await ctx.networkRegistry.getAddress()], { kind: "uups" });
      await registry.registerCollateralType(SAVINGS, 1, 10_000n, 10n ** 18n);
      await registry.setClrusdKind(SAVINGS);
      await registry.setClrusdToken(await clrusd.getAddress());
      await clrusd.setEncumbranceSource(await registry.getAddress());
      await issuer.connect(ctx.operator).setExposureSource(await registry.getAddress());
      const liquidator: any = await upgrades.deployProxy(await ethers.getContractFactory("Liquidator"), [ctx.admin.address, await ctx.stableCredit.getAddress(),
        await clrusd.getAddress(), await vault.getAddress(), await ctx.usdc.getAddress(), await registry.getAddress()], { kind: "uups" });
      await clrusd.grantRole(await clrusd.LIQUIDATOR_ROLE(), await liquidator.getAddress());
      await registry.grantRole(await registry.OPERATOR_ROLE(), await liquidator.getAddress());
      await ctx.access.grantOperator(await liquidator.getAddress());
      await liquidator.setTrustedSavingsIssuer(await issuer.getAddress(), true);

      // Repayments, liquidation proceeds among them, go to the payout pool first, up to what it is
      // owed, and the rest to Lending Co.'s operating address. Section 13 (decision 2) closed the
      // one path that could deposit into the AssurancePool (`depositRepayment`).
      const merchants: any = await upgrades.deployProxy(await ethers.getContractFactory("MerchantRegistry"), [ctx.admin.address, NET_30], { kind: "uups" });
      const pool: any = await upgrades.deployProxy(await ethers.getContractFactory("PayoutPool"), [
        ctx.admin.address, await ctx.stableCredit.getAddress(), await ctx.usdc.getAddress(), await merchants.getAddress(), coop.address,
      ], { kind: "uups" });
      await ctx.stableCredit.connect(ctx.admin).setPayoutPool(await pool.getAddress());

      // Save 1,000, pledge it, draw 400 against it on a one-cycle period, and default.
      await ctx.usdc.mint(ctx.member.address, 1_000n * ONE_USDC);
      await ctx.usdc.connect(ctx.member).approve(await vault.getAddress(), ethers.MaxUint256);
      await vault.connect(ctx.member).deposit(await ctx.usdc.getAddress(), 1_000n * ONE_USDC, ctx.member.address);
      await registry.pledge(ctx.member.address, SAVINGS, 1_000n * ONE_USDC);
      await issuer.connect(ctx.operator).openLine(ctx.member.address, [1_000n * ONE_USDC], 30 * DAY, 30 * DAY);
      await ctx.stableCredit.connect(ctx.member).transfer(ctx.counterparty.address, 400n * ONE_USDC);
      // Section 12.5: two missed rebalances in a row, each judged, then the cure window.
      await driveToDefault(issuer, ctx.member.address, ctx.operator);

      const before = await holdings(ctx);
      await liquidator.connect(stranger).liquidate(ctx.member.address, await issuer.getAddress(), 0, SAVINGS);
      expect(await clrusd.balanceOf(ctx.member.address)).to.equal(600n * ONE_USDC);
      expect(await holdings(ctx)).to.deep.equal(before);

      // The member redeems the rest of their CLRUSD for USDC.
      await clrusd.connect(ctx.member).approve(await vault.getAddress(), ethers.MaxUint256);
      await vault.connect(ctx.member).redeem(await ctx.usdc.getAddress(), 600n * ONE_USDC, ctx.member.address);
      expect(await holdings(ctx)).to.deep.equal(before);
    });
  });
});
