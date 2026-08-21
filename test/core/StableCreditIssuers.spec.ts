import { expect } from "chai";
import { ethers } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const ONE_YEAR = 365 * 24 * 60 * 60;
const ONE_MONTH = 30 * 24 * 60 * 60;
const ONE_DAY = 24 * 60 * 60;

describe("StableCredit across issuers", function () {
  // One ledger, several issuers. The revolving line and term plans are separate rule sets that
  // both write here, so nothing may assume a member has exactly one issuer.

  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let second: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();

    const ScopedCreditIssuerHarness =
      await ethers.getContractFactory("ScopedCreditIssuerHarness");
    second = await ScopedCreditIssuerHarness.deploy();
    await second.initialize(await ctx.stableCredit.getAddress());

    await ctx.networkRegistry.registerIssuer(
      await second.getAddress(),
      await ctx.stableCredit.getAddress(),
      await ctx.assurancePool.getAddress(),
      await ctx.assuranceOracle.getAddress()
    );
    await ctx.access.grantOperator(await second.getAddress());
  });

  /// Opens a line with the base issuer.
  async function openFirst(limit: bigint, periodLength = ONE_YEAR) {
    await ctx.creditIssuer
      .connect(ctx.operator)
      .initializeCreditLine(ctx.member.address, limit, 0, periodLength, ONE_MONTH);
  }

  /// Opens a line with the second issuer.
  async function openSecond(limit: bigint, periodLength = ONE_YEAR) {
    await second
      .connect(ctx.operator)
      .initializeCreditLine(ctx.member.address, limit, 0, periodLength, ONE_MONTH);
  }

  describe("a ceiling composed of parts", function () {
    it("sums each issuer's allocation into one ceiling", async function () {
      const { stableCredit, member } = ctx;
      await openFirst(1_000n * ONE_USDC);
      await openSecond(500n * ONE_USDC);

      expect(await stableCredit.creditLimitOf(member.address)).to.equal(1_500n * ONE_USDC);
      expect(await stableCredit.totalCreditLimitOf(member.address)).to.equal(1_500n * ONE_USDC);
    });

    it("keeps each issuer's allocation separate", async function () {
      const { stableCredit, creditIssuer, member } = ctx;
      await openFirst(1_000n * ONE_USDC);
      await openSecond(500n * ONE_USDC);

      expect(
        await stableCredit.issuerCreditLimit(await creditIssuer.getAddress(), member.address)
      ).to.equal(1_000n * ONE_USDC);
      expect(
        await stableCredit.issuerCreditLimit(await second.getAddress(), member.address)
      ).to.equal(500n * ONE_USDC);
    });

    it("does not let one issuer overwrite another's allocation", async function () {
      // The member sees one ceiling, but no issuer owns the whole of it. An issuer setting its
      // own contribution must not be able to restate someone else's by setting the total.
      const { stableCredit, creditIssuer, member } = ctx;
      await openFirst(1_000n * ONE_USDC);
      await openSecond(500n * ONE_USDC);

      await second.setLimit(member.address, 200n * ONE_USDC);

      expect(
        await stableCredit.issuerCreditLimit(await second.getAddress(), member.address)
      ).to.equal(200n * ONE_USDC);
      expect(
        await stableCredit.issuerCreditLimit(await creditIssuer.getAddress(), member.address)
      ).to.equal(1_000n * ONE_USDC);
      expect(await stableCredit.creditLimitOf(member.address)).to.equal(1_200n * ONE_USDC);
    });

    it("lets a member draw against the combined ceiling", async function () {
      const { stableCredit, member, counterparty, access, operator } = ctx;
      await openFirst(1_000n * ONE_USDC);
      await openSecond(500n * ONE_USDC);
      await access.connect(operator).grantMember(counterparty.address);

      await stableCredit.connect(member).transfer(counterparty.address, 1_400n * ONE_USDC);
      expect(await stableCredit.creditBalanceOf(member.address)).to.equal(1_400n * ONE_USDC);

      await expect(
        stableCredit.connect(member).transfer(counterparty.address, 200n * ONE_USDC)
      ).to.be.revertedWith("MutualCredit: Insufficient credit");
    });

    it("refuses to cut a ceiling below what is drawn", async function () {
      const { stableCredit, member, counterparty, access, operator } = ctx;
      await openFirst(1_000n * ONE_USDC);
      await openSecond(500n * ONE_USDC);
      await access.connect(operator).grantMember(counterparty.address);
      await stableCredit.connect(member).transfer(counterparty.address, 1_200n * ONE_USDC);

      // Dropping the second issuer's 500 leaves 1,000 against 1,200 drawn.
      await expect(second.setLimit(member.address, 0n)).to.be.revertedWith(
        "StableCredit: invalid credit limit"
      );

      // Trimming it to 200 still leaves 1,200 covered exactly, so that is allowed.
      await second.setLimit(member.address, 200n * ONE_USDC);
      expect(await stableCredit.creditLimitOf(member.address)).to.equal(1_200n * ONE_USDC);
    });
  });

  describe("who may act as an issuer", function () {
    it("accepts any issuer registered against this ledger", async function () {
      const { stableCredit, member } = ctx;
      await openSecond(500n * ONE_USDC);
      expect(await stableCredit.creditLimitOf(member.address)).to.equal(500n * ONE_USDC);
    });

    it("refuses a caller that is not a registered issuer", async function () {
      const { stableCredit, member, outsider } = ctx;
      await expect(
        stableCredit.connect(outsider).createCreditLine(member.address, 100n * ONE_USDC, 0)
      ).to.be.revertedWithCustomError(stableCredit, "StableCreditNotAnIssuer");
      await expect(
        stableCredit.connect(outsider).writeOffCreditLine(member.address, 100n * ONE_USDC)
      ).to.be.revertedWithCustomError(stableCredit, "StableCreditNotAnIssuer");
    });

    it("refuses an issuer registered against a different ledger", async function () {
      const { stableCredit, networkRegistry, assurancePool, assuranceOracle, member } = ctx;
      const ScopedCreditIssuerHarness =
        await ethers.getContractFactory("ScopedCreditIssuerHarness");
      const foreign = await ScopedCreditIssuerHarness.deploy();
      await foreign.initialize(await stableCredit.getAddress());

      // Registered, but against somebody else's ledger.
      await networkRegistry.registerIssuer(
        await foreign.getAddress(),
        ethers.Wallet.createRandom().address,
        await assurancePool.getAddress(),
        await assuranceOracle.getAddress()
      );

      await expect(
        foreign.connect(ctx.operator).initializeCreditLine(
          member.address, 100n * ONE_USDC, 0, ONE_YEAR, ONE_MONTH
        )
      ).to.be.revertedWithCustomError(stableCredit, "StableCreditNotAnIssuer");
    });

    it("refuses an issuer that has no line with the member", async function () {
      const { stableCredit, networkRegistry, assurancePool, assuranceOracle, member } = ctx;
      const ScopedCreditIssuerHarness =
        await ethers.getContractFactory("ScopedCreditIssuerHarness");
      const stranger = await ScopedCreditIssuerHarness.deploy();
      await stranger.initialize(await stableCredit.getAddress());
      await networkRegistry.registerIssuer(
        await stranger.getAddress(),
        await stableCredit.getAddress(),
        await assurancePool.getAddress(),
        await assuranceOracle.getAddress()
      );

      await openFirst(1_000n * ONE_USDC);

      // Registered against this ledger, but with no relationship to this member.
      await expect(stranger.setLimit(member.address, 5_000n * ONE_USDC))
        .to.be.revertedWithCustomError(stableCredit, "StableCreditNoCreditLine");
    });
  });

  describe("every issuer gets a veto", function () {
    it("blocks a transfer when one issuer refuses, even if the other allows it", async function () {
      // A member in default on a term plan should not keep spending on their revolving line.
      const { stableCredit, creditIssuer, member, counterparty, access, operator } = ctx;
      await openFirst(1_000n * ONE_USDC, ONE_MONTH); // short period, expires first
      await openSecond(500n * ONE_USDC, ONE_YEAR); // still active throughout
      await access.connect(operator).grantMember(counterparty.address);

      await stableCredit.connect(member).transfer(counterparty.address, 800n * ONE_USDC);

      // Past the first issuer's period, into its grace: frozen there, fine at the second.
      await ethers.provider.send("evm_increaseTime", [ONE_MONTH + ONE_DAY]);
      await ethers.provider.send("evm_mine", []);
      expect(await creditIssuer.isFrozen(member.address)).to.equal(true);
      expect(await second.inActivePeriod(member.address)).to.equal(true);

      await expect(
        stableCredit.connect(member).transfer(counterparty.address, 100n * ONE_USDC)
      ).to.be.revertedWithCustomError(stableCredit, "StableCreditTransactionInvalid");
    });

    it("allows a transfer when every issuer allows it", async function () {
      const { stableCredit, member, counterparty, access, operator } = ctx;
      await openFirst(1_000n * ONE_USDC);
      await openSecond(500n * ONE_USDC);
      await access.connect(operator).grantMember(counterparty.address);

      await stableCredit.connect(member).transfer(counterparty.address, 100n * ONE_USDC);
      expect(await stableCredit.balanceOf(counterparty.address)).to.equal(100n * ONE_USDC);
    });
  });

  describe("a write-off is scoped to the issuer taking it", function () {
    it("leaves the other issuer's debt in place", async function () {
      const { stableCredit, member, counterparty, access, operator } = ctx;
      await openFirst(1_000n * ONE_USDC, ONE_YEAR);
      await openSecond(1_000n * ONE_USDC, ONE_MONTH);
      await access.connect(operator).grantMember(counterparty.address);
      await stableCredit.connect(member).transfer(counterparty.address, 1_500n * ONE_USDC);

      // The second issuer owns 500 of the 1,500 and keeps the member in the network.
      await second.setOwnShare(member.address, 500n * ONE_USDC);
      await second.setKeepsMembershipOnDefault(true);

      await ethers.provider.send("evm_increaseTime", [ONE_MONTH + ONE_MONTH + ONE_DAY]);
      await ethers.provider.send("evm_mine", []);
      expect(await second.inDefault(member.address)).to.equal(true);

      await second.syncCreditPeriod(member.address);

      // Only the second issuer's share moved to lost debt.
      expect(await stableCredit.creditBalanceOf(member.address)).to.equal(1_000n * ONE_USDC);
      expect(await stableCredit.lostDebt()).to.equal(500n * ONE_USDC);

      // And only its ceiling was withdrawn.
      expect(
        await stableCredit.issuerCreditLimit(await second.getAddress(), member.address)
      ).to.equal(0n);
      expect(await stableCredit.creditLimitOf(member.address)).to.equal(1_000n * ONE_USDC);
    });

    it("cannot write off more than is outstanding", async function () {
      const { stableCredit, member, counterparty, access, operator } = ctx;
      await openFirst(1_000n * ONE_USDC, ONE_YEAR);
      await openSecond(1_000n * ONE_USDC, ONE_MONTH);
      await access.connect(operator).grantMember(counterparty.address);
      await stableCredit.connect(member).transfer(counterparty.address, 300n * ONE_USDC);

      await second.setOwnShare(member.address, 10_000n * ONE_USDC); // over-claims wildly
      await second.setKeepsMembershipOnDefault(true);

      await ethers.provider.send("evm_increaseTime", [ONE_MONTH + ONE_MONTH + ONE_DAY]);
      await ethers.provider.send("evm_mine", []);
      await second.syncCreditPeriod(member.address);

      expect(await stableCredit.lostDebt()).to.equal(300n * ONE_USDC);
      expect(await stableCredit.creditBalanceOf(member.address)).to.equal(0n);
    });
  });

  describe("system moves are not member transactions", function () {
    it("settles a repayment from a frozen member", async function () {
      // The freeze exists because of the debt. Refusing the payment that clears it would be a
      // deadlock, and the member is not spending -- they are paying.
      const { stableCredit, creditIssuer, usdc, member, counterparty, access, operator, admin } =
        ctx;
      await openFirst(1_000n * ONE_USDC, ONE_MONTH);
      await access.connect(operator).grantMember(counterparty.address);
      await stableCredit.connect(member).transfer(counterparty.address, 500n * ONE_USDC);

      await ethers.provider.send("evm_increaseTime", [ONE_MONTH + ONE_DAY]);
      await ethers.provider.send("evm_mine", []);
      expect(await creditIssuer.isFrozen(member.address)).to.equal(true);

      await usdc.mint(admin.address, 500n * ONE_USDC);
      await usdc.approve(await stableCredit.getAddress(), 500n * ONE_USDC);
      await stableCredit.repayCreditBalance(member.address, 500n * ONE_USDC);

      expect(await stableCredit.creditBalanceOf(member.address)).to.equal(0n);
      expect(await creditIssuer.isFrozen(member.address)).to.equal(false);
    });
  });
});
