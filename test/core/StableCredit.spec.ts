import { expect } from "chai";
import { ethers } from "hardhat";
import { deployPhase0Network, drawCredit } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const ONE_YEAR = 365 * 24 * 60 * 60;
const ONE_DAY = 24 * 60 * 60;

describe("StableCredit", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    await drawCredit(ctx, 1_000n * ONE_USDC);
  });

  /// Moves past the credit period's expiration but not past its grace, which is the window in
  /// which a member carrying a balance is frozen.
  async function enterGracePeriod() {
    await ethers.provider.send("evm_increaseTime", [ONE_YEAR + ONE_DAY]);
    await ethers.provider.send("evm_mine", []);
  }

  describe("origination", function () {
    it("mints on spend, so the debit and the credit net to zero", async function () {
      const { stableCredit, member, counterparty } = ctx;

      expect(await stableCredit.balanceOf(member.address)).to.equal(0n);
      expect(await stableCredit.creditBalanceOf(member.address)).to.equal(1_000n * ONE_USDC);
      expect(await stableCredit.balanceOf(counterparty.address)).to.equal(1_000n * ONE_USDC);
      expect(await stableCredit.totalSupply()).to.equal(1_000n * ONE_USDC);
    });
  });

  describe("rejected transactions", function () {
    // The credit issuer's verdict used to be discarded: `_transfer` returned early, so ERC20
    // `transfer` still answered true for a transfer that moved nothing. A frozen member's
    // rejected payment read as settled to every integrator.

    it("reverts when the sender is frozen", async function () {
      const { stableCredit, creditIssuer, member, counterparty } = ctx;
      await enterGracePeriod();
      expect(await creditIssuer.isFrozen(member.address)).to.equal(true);

      await expect(
        stableCredit.connect(member).transfer(counterparty.address, 1n * ONE_USDC)
      ).to.be.revertedWithCustomError(stableCredit, "StableCreditTransactionInvalid");
    });

    it("reverts when the recipient is frozen", async function () {
      const { stableCredit, creditIssuer, member, counterparty } = ctx;
      await enterGracePeriod();
      expect(await creditIssuer.isFrozen(member.address)).to.equal(true);

      await expect(
        stableCredit.connect(counterparty).transfer(member.address, 1n * ONE_USDC)
      ).to.be.revertedWithCustomError(stableCredit, "StableCreditTransactionInvalid");
    });

    it("does not answer true for a transfer that moved nothing", async function () {
      // The defect in its most direct form: the ERC20 return value.
      const { stableCredit, member, counterparty } = ctx;
      await enterGracePeriod();

      await expect(
        stableCredit.connect(member).transfer.staticCall(counterparty.address, 1n * ONE_USDC)
      ).to.be.revertedWithCustomError(stableCredit, "StableCreditTransactionInvalid");
    });

    it("leaves every balance untouched when a transaction is rejected", async function () {
      const { stableCredit, member, counterparty } = ctx;
      await enterGracePeriod();

      const memberBefore = await stableCredit.creditBalanceOf(member.address);
      const counterpartyBefore = await stableCredit.balanceOf(counterparty.address);
      const supplyBefore = await stableCredit.totalSupply();

      await expect(
        stableCredit.connect(member).transfer(counterparty.address, 1n * ONE_USDC)
      ).to.be.reverted;

      expect(await stableCredit.creditBalanceOf(member.address)).to.equal(memberBefore);
      expect(await stableCredit.balanceOf(counterparty.address)).to.equal(counterpartyBefore);
      expect(await stableCredit.totalSupply()).to.equal(supplyBefore);
    });
  });

  describe("accepted transactions", function () {
    it("still settles a compliant transfer", async function () {
      // Positive control: rejecting loudly is only correct if acceptance is unaffected.
      const { stableCredit, counterparty, member } = ctx;

      await stableCredit.connect(counterparty).transfer(member.address, 400n * ONE_USDC);

      // Repayment burns: the member's negative shrinks and supply falls with it.
      expect(await stableCredit.creditBalanceOf(member.address)).to.equal(600n * ONE_USDC);
      expect(await stableCredit.balanceOf(counterparty.address)).to.equal(600n * ONE_USDC);
      expect(await stableCredit.totalSupply()).to.equal(600n * ONE_USDC);
    });
  });
});
