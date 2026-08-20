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

  describe("RTD against unsecured exposure", function () {
    // The inherited formula divided reserves by every credit in circulation. Collateralized
    // credit cannot produce lost debt, so reserving against it over-reserves the book.

    it("needs no reserves when every credit outstanding is collateralized", async function () {
      // The plan's test: with only savings-backed credit live, the correct figure is exactly zero.
      const { assurancePool, admin, stableCredit } = ctx;
      await drawCredit(ctx, 1_000n * ONE_USDC);

      const MockCollateralSource = await ethers.getContractFactory("MockCollateralSource");
      const collateral = await MockCollateralSource.deploy();
      await collateral.setUnsecuredDebt(0);
      await assurancePool.connect(admin).setCollateralSource(await collateral.getAddress());

      // Credit is outstanding and the primary reserve is empty.
      expect(await stableCredit.totalSupply()).to.equal(1_000n * ONE_USDC);
      expect(await assurancePool.primaryBalance()).to.equal(0n);

      expect(await assurancePool.unsecuredDebt()).to.equal(0n);
      expect(await assurancePool.neededReserves()).to.equal(0n);
      expect(await assurancePool.hasValidRTD()).to.equal(true);
    });

    it("reserves against the unsecured share only", async function () {
      const { assurancePool, admin } = ctx;
      await drawCredit(ctx, 1_000n * ONE_USDC);

      // Unreserved and uncollateralized: 20% of the full 1,000.
      expect(await assurancePool.neededReserves()).to.equal(200n * ONE_USDC);

      const MockCollateralSource = await ethers.getContractFactory("MockCollateralSource");
      const collateral = await MockCollateralSource.deploy();
      await collateral.setUnsecuredDebt(250n * ONE_USDC);
      await assurancePool.connect(admin).setCollateralSource(await collateral.getAddress());

      // Three quarters collateralized: 20% of the remaining 250.
      expect(await assurancePool.neededReserves()).to.equal(50n * ONE_USDC);
    });

    it("treats all credit as unsecured while no collateral source is set", async function () {
      // Regression guard on the fallback: the inherited behaviour is the conservative direction
      // to be wrong in, and must survive until Phase 1 wires a real source.
      const { assurancePool, stableCredit } = ctx;
      await drawCredit(ctx, 1_000n * ONE_USDC);

      expect(await assurancePool.unsecuredDebt()).to.equal(await stableCredit.totalSupply());
      expect(await assurancePool.neededReserves()).to.equal(200n * ONE_USDC);
    });

    it("clamps a collateral source that over-reports unsecured debt", async function () {
      const { assurancePool, admin, stableCredit } = ctx;
      await drawCredit(ctx, 1_000n * ONE_USDC);

      const MockCollateralSource = await ethers.getContractFactory("MockCollateralSource");
      const collateral = await MockCollateralSource.deploy();
      await collateral.setUnsecuredDebt(10_000n * ONE_USDC);
      await assurancePool.connect(admin).setCollateralSource(await collateral.getAddress());

      expect(await assurancePool.unsecuredDebt()).to.equal(await stableCredit.totalSupply());
    });

    it("reports a valid RTD once the unsecured share is reserved against", async function () {
      const { assurancePool, admin } = ctx;
      await drawCredit(ctx, 1_000n * ONE_USDC);

      const MockCollateralSource = await ethers.getContractFactory("MockCollateralSource");
      const collateral = await MockCollateralSource.deploy();
      await collateral.setUnsecuredDebt(500n * ONE_USDC);
      await assurancePool.connect(admin).setCollateralSource(await collateral.getAddress());

      expect(await assurancePool.hasValidRTD()).to.equal(false);
      await fundPrimary(100n * ONE_USDC); // 20% of the 500 unsecured
      expect(await assurancePool.hasValidRTD()).to.equal(true);
      expect(await assurancePool.neededReserves()).to.equal(0n);
    });

    it("only lets an admin set the collateral source", async function () {
      const { assurancePool, operator } = ctx;
      await expect(
        assurancePool.connect(operator).setCollateralSource(ethers.ZeroAddress)
      ).to.be.revertedWith("AssurancePool: caller does not have admin access");
    });
  });
});
