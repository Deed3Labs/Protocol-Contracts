import { expect } from "chai";
import { ethers } from "hardhat";
import { deployPhase0Network, drawCredit } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;

describe("AssurancePool", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
  });

  /// Puts `amount` of reserve token into the excess reserve, which is the only withdrawable tier.
  async function fundExcess(amount: bigint) {
    const { usdc, assurancePool, admin } = ctx;
    await usdc.mint(admin.address, amount);
    await usdc.approve(await assurancePool.getAddress(), amount);
    await assurancePool.depositIntoExcessReserve(amount);
  }

  async function fundBuffer(amount: bigint) {
    const { usdc, assurancePool, admin } = ctx;
    await usdc.mint(admin.address, amount);
    await usdc.approve(await assurancePool.getAddress(), amount);
    await assurancePool.depositIntoBufferReserve(amount);
  }

  async function fundPrimary(amount: bigint) {
    const { usdc, assurancePool, admin } = ctx;
    await usdc.mint(admin.address, amount);
    await usdc.approve(await assurancePool.getAddress(), amount);
    await assurancePool.depositIntoPrimaryReserve(amount);
  }

  describe("withdrawal access control", function () {
    // The inherited contract left both withdrawal entry points public with only a reentrancy
    // guard, so any address could take the excess reserve. Nobody withdraws directly now: every
    // claim routes through an instrument that was explicitly wired in.

    it("reverts withdraw for an address that is not an approved instrument", async function () {
      const { assurancePool, outsider } = ctx;
      await fundExcess(100n * ONE_USDC);

      await expect(assurancePool.connect(outsider).withdraw(100n * ONE_USDC))
        .to.be.revertedWithCustomError(assurancePool, "AssurancePoolUnauthorizedWithdrawal")
        .withArgs(outsider.address);
    });

    it("reverts withdrawToken for an address that is not an approved instrument", async function () {
      const { assurancePool, outsider, usdc } = ctx;
      await fundExcess(100n * ONE_USDC);

      await expect(
        assurancePool.connect(outsider).withdrawToken(await usdc.getAddress(), 100n * ONE_USDC)
      )
        .to.be.revertedWithCustomError(assurancePool, "AssurancePoolUnauthorizedWithdrawal")
        .withArgs(outsider.address);
    });

    it("does not let an operator withdraw", async function () {
      // Operator access configures the pool. That is not the same authority as taking reserve
      // out of it, and collapsing the two rebuilds the original bug one rung up.
      const { assurancePool, operator } = ctx;
      await fundExcess(100n * ONE_USDC);

      await expect(
        assurancePool.connect(operator).withdraw(100n * ONE_USDC)
      ).to.be.revertedWithCustomError(assurancePool, "AssurancePoolUnauthorizedWithdrawal");
    });

    it("does not let an admin withdraw", async function () {
      const { assurancePool, admin } = ctx;
      await fundExcess(100n * ONE_USDC);

      await expect(
        assurancePool.connect(admin).withdraw(100n * ONE_USDC)
      ).to.be.revertedWithCustomError(assurancePool, "AssurancePoolUnauthorizedWithdrawal");
    });

    it("has no withdrawal path at all on a fresh deployment", async function () {
      const { assurancePool, admin, operator, outsider, instrument } = ctx;
      for (const signer of [admin, operator, outsider, instrument]) {
        expect(await assurancePool.withdrawalCallers(signer.address)).to.equal(false);
      }
    });

    it("lets an approved instrument withdraw, and stops it once revoked", async function () {
      const { assurancePool, admin, instrument, usdc } = ctx;
      await fundExcess(100n * ONE_USDC);

      await assurancePool.connect(admin).setWithdrawalCaller(instrument.address, true);
      await assurancePool.connect(instrument).withdraw(40n * ONE_USDC);

      expect(await usdc.balanceOf(instrument.address)).to.equal(40n * ONE_USDC);
      expect(await assurancePool.excessBalance()).to.equal(60n * ONE_USDC);

      await assurancePool.connect(admin).setWithdrawalCaller(instrument.address, false);
      await expect(
        assurancePool.connect(instrument).withdraw(10n * ONE_USDC)
      ).to.be.revertedWithCustomError(assurancePool, "AssurancePoolUnauthorizedWithdrawal");
    });

    it("only lets an admin manage the allowlist", async function () {
      const { assurancePool, operator, outsider, instrument } = ctx;

      await expect(
        assurancePool.connect(operator).setWithdrawalCaller(instrument.address, true)
      ).to.be.revertedWith("AssurancePool: caller does not have admin access");
      await expect(
        assurancePool.connect(outsider).setWithdrawalCaller(outsider.address, true)
      ).to.be.revertedWith("AssurancePool: caller does not have admin access");
    });

    it("rejects the zero address as an instrument", async function () {
      const { assurancePool, admin } = ctx;
      await expect(
        assurancePool.connect(admin).setWithdrawalCaller(ethers.ZeroAddress, true)
      ).to.be.revertedWithCustomError(assurancePool, "AssurancePoolInvalidAddress");
    });

    it("survives a sustained drain attempt with reserves untouched", async function () {
      // Adversarial: the original defect was that this loop emptied the pool.
      const { assurancePool, outsider, usdc } = ctx;
      await fundPrimary(500n * ONE_USDC);
      await fundExcess(300n * ONE_USDC);

      const poolBefore = await usdc.balanceOf(await assurancePool.getAddress());

      for (const amount of [1n, ONE_USDC, 300n * ONE_USDC, 800n * ONE_USDC]) {
        await expect(
          assurancePool.connect(outsider).withdraw(amount)
        ).to.be.revertedWithCustomError(assurancePool, "AssurancePoolUnauthorizedWithdrawal");
        await expect(
          assurancePool.connect(outsider).withdrawToken(await usdc.getAddress(), amount)
        ).to.be.revertedWithCustomError(assurancePool, "AssurancePoolUnauthorizedWithdrawal");
      }

      expect(await usdc.balanceOf(await assurancePool.getAddress())).to.equal(poolBefore);
      expect(await assurancePool.primaryBalance()).to.equal(500n * ONE_USDC);
      expect(await assurancePool.excessBalance()).to.equal(300n * ONE_USDC);
      expect(await usdc.balanceOf(outsider.address)).to.equal(0n);
    });
  });

  describe("loss absorption", function () {
    // The withdrawable tier is the excess reserve and only the excess reserve. Primary and buffer
    // exist to make losses survivable; the multi-token payout path pays out of raw balances rather
    // than a per-tier ledger, so the contract asserts on every withdrawal that neither moved.

    it("leaves primary and buffer untouched when paying out in the reserve token", async function () {
      const { assurancePool, admin, instrument, usdc } = ctx;
      await fundPrimary(100n * ONE_USDC);
      await fundBuffer(25n * ONE_USDC);
      await fundExcess(50n * ONE_USDC);

      await assurancePool.connect(admin).setWithdrawalCaller(instrument.address, true);
      await assurancePool.connect(instrument).withdraw(50n * ONE_USDC);

      expect(await assurancePool.primaryBalance()).to.equal(100n * ONE_USDC);
      expect(await assurancePool.bufferBalance()).to.equal(25n * ONE_USDC);
      expect(await assurancePool.excessBalance()).to.equal(0n);
      expect(await usdc.balanceOf(instrument.address)).to.equal(50n * ONE_USDC);
    });

    it("leaves primary and buffer untouched when the payout is served in another token", async function () {
      // The excess is funded in DAI, and the claim is made in USDC. The payout path falls through
      // to the equivalent-value sweep, which pays out of raw balances that primary also sits in.
      const { assurancePool, admin, instrument, usdc, dai } = ctx;
      await fundPrimary(100n * ONE_USDC);

      const daiAmount = 60n * 10n ** 18n;
      await dai.mint(admin.address, daiAmount);
      await dai.approve(await assurancePool.getAddress(), daiAmount);
      await assurancePool.depositTokenIntoExcess(await dai.getAddress(), daiAmount);
      expect(await assurancePool.excessBalance()).to.equal(60n * ONE_USDC);

      await assurancePool.connect(admin).setWithdrawalCaller(instrument.address, true);
      await assurancePool.connect(instrument).withdrawToken(await usdc.getAddress(), 60n * ONE_USDC);

      expect(await assurancePool.primaryBalance()).to.equal(100n * ONE_USDC);
      expect(await assurancePool.bufferBalance()).to.equal(0n);
      expect(await assurancePool.excessBalance()).to.equal(0n);

      // Value out matches value claimed: the pool still holds 100 USDC of backing for primary,
      // now composed of 40 USDC and 60 DAI.
      expect(await assurancePool.heldReserveValue()).to.equal(100n * ONE_USDC);
    });

    it("cannot withdraw more than the accounted excess", async function () {
      const { assurancePool, admin, instrument, usdc } = ctx;
      await fundPrimary(100n * ONE_USDC);
      await fundExcess(10n * ONE_USDC);
      await assurancePool.connect(admin).setWithdrawalCaller(instrument.address, true);

      await expect(
        assurancePool.connect(instrument).withdraw(11n * ONE_USDC)
      ).to.be.revertedWith("AssurancePool: Insufficient excess reserve");
      await expect(
        assurancePool.connect(instrument).withdrawToken(await usdc.getAddress(), 11n * ONE_USDC)
      ).to.be.revertedWith("AssurancePool: Insufficient excess reserve");

      expect(await assurancePool.primaryBalance()).to.equal(100n * ONE_USDC);
    });

    it("reports held value against the accounted total, for drift monitoring", async function () {
      // Held value is a view, not an enforcement hook: it is priced through the oracle and moves
      // with valuation drift, which belongs to monitoring that alerts rather than corrects.
      const { assurancePool } = ctx;
      await fundPrimary(100n * ONE_USDC);
      await fundBuffer(25n * ONE_USDC);
      await fundExcess(50n * ONE_USDC);

      expect(await assurancePool.heldReserveValue()).to.equal(175n * ONE_USDC);
      expect(await assurancePool.reserveBalance()).to.equal(125n * ONE_USDC);
    });
  });

  describe("RTD against pool exposure", function () {
    // RTD answers one question: if every member defaulted tomorrow, what would this pool pay?
    // The inherited formula divided by every credit in circulation, which over-reserves against
    // collateral already inside the network. Reserving against unsecured credit alone is wrong in
    // the other direction: asset-backed collateral has to be sold at an uncertain price.

    let SAVINGS: string, ASSET: string, INCOME: string;

    async function attachExposureSource() {
      const MockExposureSource = await ethers.getContractFactory("MockExposureSource");
      const source = await MockExposureSource.deploy();
      await ctx.assurancePool.connect(ctx.admin).setExposureSource(await source.getAddress());

      const ExposureMathHarness = await ethers.getContractFactory("ExposureMathHarness");
      const math = await ExposureMathHarness.deploy();
      [SAVINGS, ASSET, INCOME] = await Promise.all([math.SAVINGS(), math.ASSET(), math.INCOME()]);
      return source;
    }

    it("needs no reserves when all credit is savings-backed", async function () {
      // The plan's test: with only savings-backed credit live the correct figure is exactly zero.
      const { assurancePool, stableCredit } = ctx;
      await drawCredit(ctx, 1_000n * ONE_USDC);

      const source = await attachExposureSource();
      await source.addPosition(SAVINGS, 1_000n * ONE_USDC, 1_000n * ONE_USDC, 10_000n);

      // Credit is outstanding and the primary reserve is empty.
      expect(await stableCredit.totalSupply()).to.equal(1_000n * ONE_USDC);
      expect(await assurancePool.primaryBalance()).to.equal(0n);

      expect(await assurancePool.poolExposure()).to.equal(0n);
      expect(await assurancePool.neededReserves()).to.equal(0n);
      expect(await assurancePool.hasValidRTD()).to.equal(true);
    });

    it("counts an under-collateralized asset-backed position at exactly its shortfall", async function () {
      // The plan's second test: collateral below debt / haircut contributes the gap and no more.
      const { assurancePool } = ctx;
      await drawCredit(ctx, 2_000n * ONE_USDC);

      const source = await attachExposureSource();
      await source.addPosition(ASSET, 2_000n * ONE_USDC, 2_600n * ONE_USDC, 7000n);

      // 2,600 x 0.70 = 1,820 realizable, so the pool covers 180.
      expect(await assurancePool.poolExposure()).to.equal(180n * ONE_USDC);
      expect(await assurancePool.neededReserves()).to.equal(36n * ONE_USDC); // 20% of 180
    });

    it("stops counting an asset-backed position once its collateral clears the debt", async function () {
      const { assurancePool } = ctx;
      await drawCredit(ctx, 2_000n * ONE_USDC);

      const source = await attachExposureSource();
      await source.addPosition(ASSET, 2_000n * ONE_USDC, 3_000n * ONE_USDC, 7000n);

      expect(await assurancePool.poolExposure()).to.equal(0n);
      expect(await assurancePool.neededReserves()).to.equal(0n);
    });

    it("counts an unsecured position in full", async function () {
      const { assurancePool } = ctx;
      await drawCredit(ctx, 1_200n * ONE_USDC);

      const source = await attachExposureSource();
      await source.addPosition(INCOME, 1_200n * ONE_USDC, 0n, 0n);

      expect(await assurancePool.poolExposure()).to.equal(1_200n * ONE_USDC);
      expect(await assurancePool.neededReserves()).to.equal(240n * ONE_USDC); // 20% of 1,200
    });

    it("reserves against a mixed book at neither extreme", async function () {
      // The worked example, scaled to the credit actually outstanding here. Reserving against
      // total debt or against unsecured debt alone both give a different, wrong answer.
      const { assurancePool } = ctx;
      await drawCredit(ctx, 7_140n * ONE_USDC);

      const source = await attachExposureSource();
      await source.addPosition(SAVINGS, 3_000n * ONE_USDC, 3_000n * ONE_USDC, 10_000n);
      await source.addPosition(INCOME, 1_200n * ONE_USDC, 0n, 0n);
      await source.addPosition(ASSET, 2_000n * ONE_USDC, 2_600n * ONE_USDC, 7000n);
      await source.addPosition(INCOME, 940n * ONE_USDC, 0n, 0n);

      expect(await assurancePool.poolExposure()).to.equal(2_320n * ONE_USDC);
      expect(await assurancePool.neededReserves()).to.equal(464n * ONE_USDC); // 20% of 2,320

      // Not 20% of the full 7,140, and not 20% of the 2,140 that is unsecured.
      expect(await assurancePool.neededReserves()).to.not.equal(1_428n * ONE_USDC);
      expect(await assurancePool.neededReserves()).to.not.equal(428n * ONE_USDC);
    });

    it("treats all credit as unsecured while no exposure source is set", async function () {
      // Regression guard on the fallback: over-reserving is the conservative direction to be
      // wrong in, and must survive until Phase 1 wires a real source.
      const { assurancePool, stableCredit } = ctx;
      await drawCredit(ctx, 1_000n * ONE_USDC);

      expect(await assurancePool.poolExposure()).to.equal(await stableCredit.totalSupply());
      expect(await assurancePool.neededReserves()).to.equal(200n * ONE_USDC);
    });

    it("clamps an exposure source that over-reports", async function () {
      // The pool cannot pay out more than the credit that exists.
      const { assurancePool, stableCredit } = ctx;
      await drawCredit(ctx, 1_000n * ONE_USDC);

      const source = await attachExposureSource();
      await source.addPosition(INCOME, 10_000n * ONE_USDC, 0n, 0n);

      expect(await assurancePool.poolExposure()).to.equal(await stableCredit.totalSupply());
    });

    it("reports a valid RTD once the exposure is reserved against", async function () {
      const { assurancePool } = ctx;
      await drawCredit(ctx, 1_000n * ONE_USDC);

      const source = await attachExposureSource();
      await source.addPosition(INCOME, 500n * ONE_USDC, 0n, 0n);

      expect(await assurancePool.hasValidRTD()).to.equal(false);
      await fundPrimary(100n * ONE_USDC); // 20% of the 500 exposed
      expect(await assurancePool.hasValidRTD()).to.equal(true);
      expect(await assurancePool.neededReserves()).to.equal(0n);
    });

    it("draws its numerator from this pool alone", async function () {
      // RTD reads the AssurancePool and nothing else. Value sitting in the pool that the primary
      // reserve does not account for -- another instrument's money, an unallocated transfer --
      // must not raise the ratio.
      const { assurancePool, usdc, admin } = ctx;
      await drawCredit(ctx, 1_000n * ONE_USDC);
      await fundPrimary(100n * ONE_USDC);

      const before = await assurancePool.RTD();
      await usdc.mint(await assurancePool.getAddress(), 5_000n * ONE_USDC);

      expect(await assurancePool.RTD()).to.equal(before);
      expect(await assurancePool.primaryBalance()).to.equal(100n * ONE_USDC);
    });

    it("only lets an admin set the exposure source", async function () {
      const { assurancePool, operator } = ctx;
      await expect(
        assurancePool.connect(operator).setExposureSource(ethers.ZeroAddress)
      ).to.be.revertedWith("AssurancePool: caller does not have admin access");
    });
  });
});
