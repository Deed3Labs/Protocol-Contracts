import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network, drawCredit } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const DAY = 24 * 60 * 60;
const NET_30 = 30 * DAY;

// When a member clears their balance, value lands with the co-op -- and that value is what pays
// the merchant holding the positive side of the purchase that created it. It used to go straight
// into the AssurancePool's buffer reserve, which is the one fund forbidden from funding a payout,
// so the working capital for net-30 piled up exactly where it could not be spent.
describe("repayment routing", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let registry: any, pool: any;
  let merchant: any, coop: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    coop = (await ethers.getSigners())[8];
    merchant = ctx.counterparty;

    const MerchantRegistry = await ethers.getContractFactory("MerchantRegistry");
    registry = await upgrades.deployProxy(MerchantRegistry, [ctx.admin.address, NET_30], {
      kind: "uups",
    });

    const PayoutPool = await ethers.getContractFactory("PayoutPool");
    pool = await upgrades.deployProxy(
      PayoutPool,
      [
        ctx.admin.address,
        await ctx.stableCredit.getAddress(),
        await ctx.usdc.getAddress(),
        await registry.getAddress(),
        coop.address,
      ],
      { kind: "uups" }
    );

    await ctx.access.connect(ctx.operator).grantMember(coop.address);
    await pool.connect(ctx.admin).grantRole(await pool.FUNDER_ROLE(), ctx.admin.address);
    await registry.registerMerchant(merchant.address, NET_30, 50_000n * ONE_USDC, 200n);
    await ctx.stableCredit.connect(merchant).approve(await pool.getAddress(), ethers.MaxUint256);

    await drawCredit(ctx, 1_000n * ONE_USDC);
  });

  async function repay(amount: bigint) {
    await ctx.usdc.mint(ctx.admin.address, amount);
    await ctx.usdc.approve(await ctx.stableCredit.getAddress(), amount);
    await ctx.stableCredit.repayCreditBalance(ctx.member.address, amount);
  }

  it("sends everything to the reserve when there is no payout pool", async function () {
    // The inherited behaviour, and the only option before there was anywhere else to send it.
    await repay(1_000n * ONE_USDC);
    expect(await ctx.assurancePool.bufferBalance()).to.equal(1_000n * ONE_USDC);
  });

  describe("with a payout pool", function () {
    beforeEach(async function () {
      await ctx.stableCredit.connect(ctx.admin).setPayoutPool(await pool.getAddress());
    });

    it("pays the merchant who is waiting before topping up the reserve", async function () {
      // The merchant redeemed and is queued; the member then repays. That repayment is the money
      // the merchant is owed.
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      expect(await pool.shortfall()).to.equal(1_000n * ONE_USDC);

      await repay(1_000n * ONE_USDC);

      expect(await pool.shortfall()).to.equal(0n);
      expect(await pool.held()).to.equal(1_000n * ONE_USDC);
      expect(await ctx.assurancePool.bufferBalance()).to.equal(0n);
    });

    it("lets the queued merchant actually collect", async function () {
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      await repay(1_000n * ONE_USDC);

      await pool.payNext();
      expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(1_000n * ONE_USDC);
    });

    it("funds the merchant's payable before anyone has queued for it", async function () {
      // The old rule reserved against the QUEUE, so unless a merchant happened to redeem before a
      // member repaid, the money went past the pool into loss absorption -- where it cannot fund a
      // payout. A merchant's positive balance is already what they are owed.
      expect(await ctx.stableCredit.balanceOf(merchant.address)).to.equal(1_000n * ONE_USDC);

      await repay(1_000n * ONE_USDC);

      expect(await pool.held()).to.equal(1_000n * ONE_USDC);
      expect(await ctx.assurancePool.bufferBalance()).to.equal(0n);
    });

    it("stops at what is actually owed; the rest still goes to the reserve", async function () {
      // Payables before provisions, not instead of them. With 400 of capital already sitting
      // there, only 600 of the payable is unfunded and the remaining 400 carries on to the buffer.
      await ctx.usdc.mint(ctx.admin.address, 400n * ONE_USDC);
      await ctx.usdc.approve(await pool.getAddress(), 400n * ONE_USDC);
      await pool.connect(ctx.admin).fund(400n * ONE_USDC);

      await repay(1_000n * ONE_USDC);

      expect(await pool.held()).to.equal(1_000n * ONE_USDC);
      expect(await ctx.assurancePool.bufferBalance()).to.equal(400n * ONE_USDC);
    });

    it("covers what it can when the repayment is smaller than the queue", async function () {
      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      await repay(300n * ONE_USDC);

      expect(await pool.held()).to.equal(300n * ONE_USDC);
      expect(await pool.shortfall()).to.equal(700n * ONE_USDC);
      expect(await ctx.assurancePool.bufferBalance()).to.equal(0n);
    });

    // Who ends up holding the position when a claim is paid, which is decided by whose money paid
    // it rather than guessed at redemption.
    describe("the position follows the cash", function () {
      it("burns the claim when a member's own repayment pays it", async function () {
        await repay(1_000n * ONE_USDC);
        // The money is already here, so redeeming pays on the spot.
        await pool.connect(merchant).redeem(1_000n * ONE_USDC);

        // The member's obligation went when they paid; the claim goes when the cash leaves. Supply
        // and obligations back in step, and nobody holding a claim on nobody.
        expect(await ctx.stableCredit.totalSupply()).to.equal(0n);
        expect(await ctx.stableCredit.balanceOf(coop.address)).to.equal(0n);
        expect(await ctx.usdc.balanceOf(merchant.address)).to.equal(1_000n * ONE_USDC);
      });

      it("hands the position to whoever advanced the cash", async function () {
        // Net 30: the merchant is paid before the member repays, so capital went out and the
        // member still owes it. The funder holds the position, as the LendingPool does on the
        // unsecured tiers it funds.
        const funder = (await ethers.getSigners())[9];
        await ctx.access.connect(ctx.operator).grantMember(funder.address);
        await pool.connect(ctx.admin).grantRole(await pool.FUNDER_ROLE(), funder.address);

        await ctx.usdc.mint(funder.address, 1_000n * ONE_USDC);
        await ctx.usdc.connect(funder).approve(await pool.getAddress(), 1_000n * ONE_USDC);
        await pool.connect(funder).fund(1_000n * ONE_USDC);

        await pool.connect(merchant).redeem(1_000n * ONE_USDC);

        // The position lands with whoever's cash paid for it, without anybody naming them first.
        expect(await ctx.stableCredit.balanceOf(funder.address)).to.equal(1_000n * ONE_USDC);
        expect(await ctx.stableCredit.totalSupply()).to.equal(1_000n * ONE_USDC);
        expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address)).to.equal(1_000n * ONE_USDC);
      });

      it("settles what the member paid for and sells the rest", async function () {
        await repay(400n * ONE_USDC);
        await ctx.usdc.mint(ctx.admin.address, 600n * ONE_USDC);
        await ctx.usdc.approve(await pool.getAddress(), 600n * ONE_USDC);
        await pool.connect(ctx.admin).fund(600n * ONE_USDC);

        // Funded beats queued, so this pays on the spot rather than queueing.
        await pool.connect(merchant).redeem(1_000n * ONE_USDC);

        // 400 settled and burned, 600 bought by the funder whose capital paid for it.
        expect(await ctx.stableCredit.totalSupply()).to.equal(600n * ONE_USDC);
        expect(await ctx.stableCredit.balanceOf(ctx.admin.address)).to.equal(600n * ONE_USDC);
      });

      it("gives back capital that never bought anything", async function () {
        // A treasury holding a reserve here can take back what it has not spent.
        await ctx.usdc.mint(ctx.admin.address, 500n * ONE_USDC);
        await ctx.usdc.approve(await pool.getAddress(), 500n * ONE_USDC);
        await pool.connect(ctx.admin).fund(500n * ONE_USDC);
        expect(await pool.idleCapitalOf(ctx.admin.address)).to.equal(500n * ONE_USDC);

        await pool.connect(ctx.admin).withdrawCapital(500n * ONE_USDC, ctx.admin.address);
        expect(await pool.held()).to.equal(0n);
      });

      it("will not give back what a member repaid, nor what a queue is waiting on", async function () {
        await repay(1_000n * ONE_USDC);
        // Members' money is not the funder's to take, however much cash is sitting here.
        expect(await pool.idleCapitalOf(ctx.admin.address)).to.equal(0n);

        await ctx.usdc.mint(ctx.admin.address, 200n * ONE_USDC);
        await ctx.usdc.approve(await pool.getAddress(), 200n * ONE_USDC);
        await pool.connect(ctx.admin).fund(200n * ONE_USDC);
        await pool.connect(merchant).redeem(1_000n * ONE_USDC);
        // Paid on the spot from the member's own money; 200 of capital is still idle.
        expect(await pool.idleCapitalOf(ctx.admin.address)).to.equal(200n * ONE_USDC);
      });

      it("keeps capital that has already bought a position", async function () {
        // Spent capital is recovered by redeeming the position as the member repays, not by
        // withdrawing cash that is no longer there.
        await ctx.usdc.mint(ctx.admin.address, 1_000n * ONE_USDC);
        await ctx.usdc.approve(await pool.getAddress(), 1_000n * ONE_USDC);
        await pool.connect(ctx.admin).fund(1_000n * ONE_USDC);
        await pool.connect(merchant).redeem(1_000n * ONE_USDC);

        expect(await pool.idleCapitalOf(ctx.admin.address)).to.equal(0n);
        expect(await ctx.stableCredit.balanceOf(ctx.admin.address)).to.equal(1_000n * ONE_USDC);
      });

      it("splits carry by what each funder is carrying", async function () {
        // Carry reaches the pool because the issuers name it as their recipient. It belongs to
        // whoever bore the float it was charged for: half the float, half the carry.
        const other = (await ethers.getSigners())[9];
        await ctx.access.connect(ctx.operator).grantMember(other.address);
        await pool.connect(ctx.admin).grantRole(await pool.FUNDER_ROLE(), other.address);

        for (const who of [ctx.admin, other]) {
          await ctx.usdc.mint(who.address, 500n * ONE_USDC);
          await ctx.usdc.connect(who).approve(await pool.getAddress(), 500n * ONE_USDC);
          await pool.connect(who).fund(500n * ONE_USDC);
        }
        await pool.connect(merchant).redeem(1_000n * ONE_USDC);
        expect(await pool.advancedOf(ctx.admin.address)).to.equal(500n * ONE_USDC);
        expect(await pool.advancedOf(other.address)).to.equal(500n * ONE_USDC);

        // Carry arriving, as an issuer naming the pool would deliver it.
        await ctx.creditIssuer.accrueCarryTo(
          ctx.member.address, await pool.getAddress(), 20n * ONE_USDC
        );
        expect(await pool.distributableCarry()).to.equal(20n * ONE_USDC);

        // Between them they bear the whole 1,000 float, so they take the whole 20 of carry.
        await pool.distributeCarry();
        expect(await ctx.stableCredit.balanceOf(ctx.admin.address)).to.equal(510n * ONE_USDC);
        expect(await ctx.stableCredit.balanceOf(other.address)).to.equal(510n * ONE_USDC);
      });

      it("pays a funder for the part of the float they bear, not for all of it", async function () {
        // 600 of a 1,000 float funded, so three fifths of the carry -- and the co-op keeps the
        // rest, because it bore the rest. Dividing among funders alone would hand them the lot.
        await repay(400n * ONE_USDC);
        await ctx.usdc.mint(ctx.admin.address, 200n * ONE_USDC);
        await ctx.usdc.approve(await pool.getAddress(), 200n * ONE_USDC);
        await pool.connect(ctx.admin).fund(200n * ONE_USDC);

        // The merchant takes 600 and leaves 400 on the shelf: 400 of it settled by the member's
        // own money, 200 bought by the funder.
        await pool.connect(merchant).redeem(600n * ONE_USDC);
        expect(await pool.advancedOf(ctx.admin.address)).to.equal(200n * ONE_USDC);
        // 600 outstanding: 400 the merchant is still owed, 200 the funder now carries.
        expect(await ctx.stableCredit.totalSupply()).to.equal(600n * ONE_USDC);

        await ctx.creditIssuer.accrueCarryTo(
          ctx.member.address, await pool.getAddress(), 90n * ONE_USDC
        );
        const before = await ctx.stableCredit.balanceOf(ctx.admin.address);

        await pool.distributeCarry();

        // A third of the float, so a third of the carry. The co-op keeps the other two thirds.
        expect((await ctx.stableCredit.balanceOf(ctx.admin.address)) - before).to.equal(30n * ONE_USDC);
        expect(await ctx.stableCredit.balanceOf(coop.address)).to.equal(60n * ONE_USDC);
      });

      it("gives carry to the co-op when nobody else bore the float", async function () {
        // Which is every case until somebody funds a payout, and is what happens today.
        await repay(1_000n * ONE_USDC);
        await pool.connect(merchant).redeem(1_000n * ONE_USDC);

        await ctx.creditIssuer.accrueCarryTo(
          ctx.member.address, await pool.getAddress(), 7n * ONE_USDC
        );
        await pool.distributeCarry();

        expect(await ctx.stableCredit.balanceOf(coop.address)).to.equal(7n * ONE_USDC);
      });

      it("never hands out a position in transit as if it were carry", async function () {
        await ctx.usdc.mint(ctx.admin.address, 1_000n * ONE_USDC);
        await ctx.usdc.approve(await pool.getAddress(), 1_000n * ONE_USDC);
        await pool.connect(ctx.admin).fund(1_000n * ONE_USDC);
        await pool.connect(merchant).redeem(1_000n * ONE_USDC);

        // Everything it holds is a position it has just handed on, so there is no carry to split.
        expect(await pool.distributableCarry()).to.equal(0n);
      });

      it("lets nobody else call a claim settled", async function () {
        await expect(
          ctx.stableCredit.connect(ctx.outsider).settleClaim(merchant.address, 1n)
        ).to.be.revertedWithCustomError(ctx.stableCredit, "StableCreditUnauthorizedSettler");
      });
    });

    it("keeps the reserve out of it entirely", async function () {
      // The routing decides where new money lands. It never moves money that has already landed,
      // so the reserve cannot be drained to pay a merchant by this or any other path.
      await ctx.usdc.mint(ctx.admin.address, 2_000n * ONE_USDC);
      await ctx.usdc.approve(await ctx.assurancePool.getAddress(), 2_000n * ONE_USDC);
      await ctx.assurancePool.depositIntoPrimaryReserve(2_000n * ONE_USDC);

      await pool.connect(merchant).redeem(1_000n * ONE_USDC);
      expect(await pool.shortfall()).to.equal(1_000n * ONE_USDC);
      expect(await ctx.assurancePool.reserveBalance()).to.equal(2_000n * ONE_USDC);
    });

    // The co-op's 2.5% was never the merchant's money, so it does not queue for it -- but it also
    // cannot take cash a queued merchant is waiting on.
    describe("the co-op's fee", function () {
      beforeEach(async function () {
        await ctx.stableCredit.connect(coop).approve(await pool.getAddress(), ethers.MaxUint256);
      });

      async function coopHolds(amount: bigint) {
        // Stands in for the discount leg: the co-op holding a claim of its own.
        await ctx.stableCredit.connect(merchant).transfer(coop.address, amount);
      }

      it("is paid without queueing, out of cash nobody is waiting on", async function () {
        await coopHolds(25n * ONE_USDC);
        await repay(1_000n * ONE_USDC);

        await pool.connect(ctx.admin).withdrawCoopIncome(25n * ONE_USDC);

        expect(await ctx.usdc.balanceOf(coop.address)).to.equal(25n * ONE_USDC);
        // Settled, not sold: the fee comes out of members' own repayments.
        expect(await ctx.stableCredit.balanceOf(coop.address)).to.equal(0n);
      });

      it("never comes out of cash a queued merchant is waiting on", async function () {
        await coopHolds(25n * ONE_USDC);
        await repay(100n * ONE_USDC);
        await pool.connect(merchant).redeem(975n * ONE_USDC);
        expect(await pool.unencumbered()).to.equal(0n);

        await expect(
          pool.connect(ctx.admin).withdrawCoopIncome(25n * ONE_USDC)
        ).to.be.revertedWithCustomError(pool, "PayoutPoolNothingToRedeem");
      });

      it("can be paid somewhere other than the address that holds it", async function () {
        // The multisig holds the claim; the money can land in an account that does something else.
        const account = (await ethers.getSigners())[10];
        await pool.connect(ctx.admin).setCoopIncomeRecipient(account.address);
        await coopHolds(25n * ONE_USDC);
        await repay(1_000n * ONE_USDC);

        await pool.connect(ctx.admin).withdrawCoopIncome(25n * ONE_USDC);

        expect(await ctx.usdc.balanceOf(account.address)).to.equal(25n * ONE_USDC);
        expect(await ctx.usdc.balanceOf(coop.address)).to.equal(0n);
        // The claim still comes off the holder's balance, wherever the cash went.
        expect(await ctx.stableCredit.balanceOf(coop.address)).to.equal(0n);
      });

      it("cannot be faked by donating cash", async function () {
        // What arrives as a member repayment decides whether claims burn. A gift of capital is
        // `fund`, which buys the position; donating would burn claims nobody had paid off.
        await ctx.usdc.mint(ctx.outsider.address, 10n * ONE_USDC);
        await ctx.usdc.connect(ctx.outsider).approve(await pool.getAddress(), 10n * ONE_USDC);
        await expect(
          pool.connect(ctx.outsider).receiveRepayment(10n * ONE_USDC)
        ).to.be.revertedWithCustomError(pool, "PayoutPoolInvalidAddress");
      });

      it("is an operator's call, not anyone's", async function () {
        await expect(pool.connect(ctx.outsider).withdrawCoopIncome(1n)).to.be.reverted;
        await expect(pool.connect(ctx.outsider).setCoopIncomeRecipient(ctx.outsider.address)).to.be.reverted;
        await expect(pool.connect(ctx.outsider).withdrawCapital(1n, ctx.outsider.address)).to.be.reverted;
      });
    });

    it("only lets an admin move where repayments go", async function () {
      await expect(
        ctx.stableCredit.connect(ctx.outsider).setPayoutPool(ethers.ZeroAddress)
      ).to.be.revertedWith("StableCredit: Unauthorized caller");
    });
  });
});
