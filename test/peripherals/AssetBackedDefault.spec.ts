import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";
import { driveToDefault } from "../helpers/default";
import { issuerProxyOptions } from "../helpers/issuers";
import { pledgeSigned } from "../helpers/pledge";
import { deployBarePool } from "../helpers/yieldPool";
import { deployEnforcer } from "../helpers/enforcement";

const ONE_USDC = 10n ** 6n;
const CYCLE = 30 * 24 * 60 * 60;
const DAY = 24 * 60 * 60;

const POOL_SHARE = ethers.encodeBytes32String("POOL_SHARE");
const ASSET_INT = 3;

// Savings-backed default is settled in one breath, because CLRUSD redeems one-for-one on demand.
// Pool shares are a claim on a pool that may have lent the money out, so turning them into cash
// can land in the withdrawal queue behind other depositors. That is the timing risk a haircut
// does not price: it says what collateral is worth, not when.
//
// Phase 2f stage 2 (decisions 7, 10 and 22, C5): pledged shares are never seized. PoolShareEnforcer
// asks the pool to redeem only the shares the Defaulted Amount needs, in the member's name through
// the queue, and the Liquidator applies the proceeds when the queue fills.
describe("asset-backed default", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let pool: any, registry: any, issuer: any, liquidator: any, enforcer: any;
  let coop: any, depositor: any, lending: any;
  let deploy: (amount: bigint) => Promise<any>;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [coop, depositor, lending] = [signers[8], signers[9], signers[10]];

    // Phase 2f: the pool is the Yield Pool. Money leaves it only as a two-person Deployment to
    // Clear Lending's lending account (decision 17), not a borrower's draw.
    ({ pool, deploy } = await deployBarePool(ctx.admin, ctx.usdc, lending, [signers[11], signers[12]]));

    const RevolvingIssuer = await ethers.getContractFactory("RevolvingIssuer");
    issuer = await upgrades.deployProxy(
      RevolvingIssuer, [await ctx.stableCredit.getAddress(), coop.address], { ...(await issuerProxyOptions("RevolvingIssuer")),  kind: "uups" }
    );
    await ctx.networkRegistry.registerIssuer(
      await issuer.getAddress(),
      await ctx.stableCredit.getAddress()
    );
    await ctx.access.grantOperator(await issuer.getAddress());
    await ctx.access.connect(ctx.operator).grantMember(ctx.counterparty.address);
    await issuer.connect(ctx.operator).addTier(POOL_SHARE, 75n, CYCLE);
    // An unsecured tier: since Addendum 2 only an unpaid Rebalance Amount is a miss, so a default
    // needs some unsecured debt beside the pledged position.
    await issuer.connect(ctx.operator).addTier(ethers.encodeBytes32String("INCOME"), 150n, CYCLE);

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
    // C5: no LIQUIDATOR_ROLE on the pool; the enforcer holds ENFORCER_ROLE and is the destination.
    await registry.grantRole(await registry.OPERATOR_ROLE(), await liquidator.getAddress());
    await ctx.access.grantOperator(await liquidator.getAddress());
    await liquidator.setTrustedSavingsIssuer(await issuer.getAddress(), true);
    await liquidator.setEarnSources(await pool.getAddress(), ethers.ZeroAddress);
    enforcer = await deployEnforcer(ctx.admin, pool, liquidator, registry, POOL_SHARE);

    // The member deposits into the pool and pledges the shares against a credit line.
    await ctx.usdc.mint(ctx.member.address, 1_000n * ONE_USDC);
    await ctx.usdc.connect(ctx.member).approve(await pool.getAddress(), 1_000n * ONE_USDC);
    await pool.connect(ctx.member).deposit(1_000n * ONE_USDC, ctx.member.address);
    await pledgeSigned(registry, ctx.member.address, POOL_SHARE, 1_000n * ONE_USDC);

    await issuer
      .connect(ctx.operator)
      .openLine(ctx.member.address, [700n * ONE_USDC], 0);
  });

  async function spendAndDefault(amount: bigint) {
    // `amount` on the pool-share tier and $10 unsecured, which is what goes unpaid.
    await issuer.connect(ctx.operator).setTierCapacity(ctx.member.address, 0, amount);
    await issuer.connect(ctx.operator).setTierCapacity(ctx.member.address, 1, 50n * ONE_USDC);
    await ctx.stableCredit.connect(ctx.member).transfer(ctx.counterparty.address, amount + 10n * ONE_USDC);
    // Section 12.5: two missed rebalances, each judged, then the cure window.
    await driveToDefault(issuer, ctx.member.address, ctx.operator);
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

    it("refuses to burn them on the way out, however the member asks", async function () {
      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 700n * ONE_USDC);

      // Withdrawing and redeeming burn shares, and a transfer check never sees a burn.
      await expect(
        pool.connect(ctx.member).withdraw(10n * ONE_USDC, ctx.member.address, ctx.member.address)
      ).to.be.revertedWithCustomError(pool, "LendingPoolEncumbered");
      await expect(
        pool.connect(ctx.member).redeem(10n * ONE_USDC, ctx.member.address, ctx.member.address)
      ).to.be.revertedWithCustomError(pool, "LendingPoolEncumbered");
      await expect(
        pool.connect(ctx.member).requestWithdrawal(10n * ONE_USDC, ctx.member.address)
      ).to.be.revertedWithCustomError(pool, "LendingPoolEncumbered");
    });

    it("lets the free part go once credit is repaid", async function () {
      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 700n * ONE_USDC);
      await ctx.stableCredit
        .connect(ctx.counterparty)
        .transfer(ctx.member.address, 350n * ONE_USDC);

      const free = await pool.freeSharesOf(ctx.member.address);
      expect(free).to.be.greaterThan(0n);
      await pool.connect(ctx.member).redeem(free, ctx.member.address, ctx.member.address);
      expect(await pool.balanceOf(ctx.member.address)).to.equal(1_000n * ONE_USDC - free);
    });

    it("does not lock a depositor who has pledged nothing", async function () {
      await ctx.usdc.mint(depositor.address, 500n * ONE_USDC);
      await ctx.usdc.connect(depositor).approve(await pool.getAddress(), 500n * ONE_USDC);
      await pool.connect(depositor).deposit(500n * ONE_USDC, depositor.address);

      expect(await pool.freeSharesOf(depositor.address)).to.equal(500n * ONE_USDC);
    });
  });

  // Phase 2f, decision 22 replaces "take the shares for what the tier owes": a default makes only
  // its Defaulted Amount due (the unpaid Rebalance Amount and any past-due Secured Minimum), and
  // only the shares that amount needs are redeemed, through the queue (C5).
  describe("the pledge module redeems only what the Defaulted Amount needs", function () {
    it("settles the Defaulted Amount when the pool has the cash, and the rest of the shares stay the member's", async function () {
      const m = ctx.member.address;
      await spendAndDefault(700n * ONE_USDC);
      expect(await issuer.inDefault(m)).to.equal(true);
      const [due] = await liquidator.earnDefaultedOf(m);
      expect(due).to.be.greaterThan(10n * ONE_USDC); // the $10 Rebalance Amount and its carry, and the past-due carry
      expect(due).to.be.lessThan(60n * ONE_USDC);
      const owedBefore = (await issuer.principalOf(m, 0)) + (await issuer.principalOf(m, 1));

      await enforcer.enforce(m);
      const queued = await pool.enforcementQueuedOf(m);
      expect(queued).to.be.closeTo(due, 2n); // shares at about $1 each, sized by previewWithdraw
      // In the member's name in the queue: nobody holds them but the pool's escrow.
      expect(await pool.balanceOf(await enforcer.getAddress())).to.equal(0n);
      expect(await pool.balanceOf(await liquidator.getAddress())).to.equal(0n);

      await pool.fillQueue(10);
      // All of it pays the Defaulted Amount (the settlement first brings carry on the line up to date,
      // so the balances fall by a little less than it); nothing is left over for the member.
      const paid = await pool.enforcementFilledOf(m);
      await expect(enforcer.settle(m)).to.emit(liquidator, "PoolProceedsApplied").withArgs(m, queued, paid[1], paid[1], 0n);
      expect(paid[1]).to.be.closeTo(due, 2n);
      expect((await issuer.principalOf(m, 0)) + (await issuer.principalOf(m, 1))).to.be.lessThan(owedBefore);
      // Everything else the member pledged is still theirs, and still pledged behind what is owed.
      expect(await pool.balanceOf(m)).to.equal(1_000n * ONE_USDC - queued);
      expect(await issuer.principalOf(m, 0)).to.be.greaterThan(650n * ONE_USDC);
      expect((await liquidator.earnDefaultedOf(m))[0]).to.be.lessThanOrEqual(2n);
    });

    it("stops counting the shares the queue redeemed", async function () {
      const m = ctx.member.address;
      await spendAndDefault(700n * ONE_USDC);
      await enforcer.enforce(m);
      const queued = await pool.enforcementQueuedOf(m);
      await pool.fillQueue(10);
      await expect(enforcer.settle(m)).to.emit(registry, "EnforcementRedeemed").withArgs(m, POOL_SHARE, queued);
      expect(await registry.pledgedOf(m, POOL_SHARE)).to.equal(1_000n * ONE_USDC - queued);
    });

    it("takes no more than the Defaulted Amount", async function () {
      // A default is not a forfeiture of everything the member saved.
      const m = ctx.member.address;
      await spendAndDefault(350n * ONE_USDC);
      await enforcer.enforce(m);
      await expect(enforcer.enforce(m)).to.be.revertedWithCustomError(enforcer, "PoolShareEnforcerNothingNeeded");
      expect(await pool.balanceOf(m)).to.be.greaterThan(900n * ONE_USDC);
    });

    it("refuses a member who has not defaulted", async function () {
      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 700n * ONE_USDC);

      await expect(enforcer.enforce(ctx.member.address))
        .to.be.revertedWithCustomError(enforcer, "PoolShareEnforcerNothingNeeded");
      expect(pool.interface.getFunction("seizeShares")).to.equal(null);
      expect(liquidator.interface.getFunction("liquidateShares")).to.equal(null);
    });
  });

  describe("when the pool has lent the money out", function () {
    it("waits in the queue rather than failing, and the debt is not forgiven meanwhile", async function () {
      // The timing risk a haircut does not price. The collateral is sufficient; it is just not
      // available today, because it is out on loan to somebody else.
      const m = ctx.member.address;
      await spendAndDefault(700n * ONE_USDC);
      await deploy(900n * ONE_USDC);
      const owedBefore = (await issuer.principalOf(m, 0)) + (await issuer.principalOf(m, 1));

      await enforcer.enforce(m);
      await pool.fillQueue(10);
      // Vault Cash is $100 and the Defaulted Amount under $60: this one fills. Deploy the rest
      // before it can, and it waits.
      expect(await pool.enforcementQueuedOf(m)).to.equal(0n);
      await enforcer.settle(m);
      expect((await issuer.principalOf(m, 0)) + (await issuer.principalOf(m, 1))).to.be.lessThan(owedBefore);
    });

    it("settles once Clear Lending returns the funds and the queue fills", async function () {
      const m = ctx.member.address;
      await spendAndDefault(700n * ONE_USDC);
      // Everyone else's redemption comes first: a depositor queues ahead of the enforcement.
      await ctx.usdc.mint(depositor.address, 500n * ONE_USDC);
      await ctx.usdc.connect(depositor).approve(await pool.getAddress(), 500n * ONE_USDC);
      await pool.connect(depositor).deposit(500n * ONE_USDC, depositor.address);
      await deploy(1_350n * ONE_USDC);
      await pool.connect(depositor).requestWithdrawal(500n * ONE_USDC, depositor.address);
      const owedBefore = (await issuer.principalOf(m, 0)) + (await issuer.principalOf(m, 1));

      await enforcer.enforce(m);
      const queued = await pool.enforcementQueuedOf(m);
      await pool.fillQueue(10);
      // Nothing filled for the member yet: there is nothing to settle and nothing is forgiven.
      await expect(enforcer.settle(m)).to.be.revertedWithCustomError(enforcer, "PoolShareEnforcerNothingToSettle");
      expect((await issuer.principalOf(m, 0)) + (await issuer.principalOf(m, 1))).to.equal(owedBefore);

      // Clear Lending returns the funds, the queue fills in order, and the proceeds are applied.
      await ctx.usdc.mint(lending.address, 1_350n * ONE_USDC);
      await ctx.usdc.connect(lending).approve(await pool.getAddress(), 1_350n * ONE_USDC);
      await pool.connect(lending).returnFunds(1_350n * ONE_USDC);
      await pool.fillQueue(10);
      expect(await pool.enforcementQueuedOf(m)).to.equal(0n);
      const paid = await pool.enforcementFilledOf(m);
      expect(paid[0]).to.equal(queued);
      await expect(enforcer.settle(m)).to.emit(liquidator, "PoolProceedsApplied").withArgs(m, queued, paid[1], paid[1], 0n);
      expect((await issuer.principalOf(m, 0)) + (await issuer.principalOf(m, 1))).to.be.lessThan(owedBefore);
      expect(await ctx.usdc.balanceOf(await enforcer.getAddress())).to.equal(0n);
      expect(await ctx.usdc.balanceOf(await liquidator.getAddress())).to.equal(0n);
    });
  });
});
