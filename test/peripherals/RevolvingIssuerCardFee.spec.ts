import { expect } from "chai";
import hre, { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { getStorageLayout, getStorageUpgradeReport, getVersion, withValidationDefaults } from "@openzeppelin/upgrades-core";
import { readValidations } from "@openzeppelin/hardhat-upgrades/dist/utils/validations";
import { deployPhase0Network } from "../helpers/phase0-fixture";
import { issuerProxyOptions } from "../helpers/issuers";
import { deployCreditTimelock } from "../../deploy/credit_timelock_handover";

/*
 * The card credit fee (decision 55, docs/audit/specs/card-credit-fee.md): `settleCardSpendWithFee` draws the
 * purchase and the fee through the tiers together and mints the fee as the purchase's third leg, to the card
 * settlement account; `maxCardCreditFee` bounds it (zero, the default, refuses every fee); `returnCardCreditFee`
 * credits part of it back and a full refund the rest, once. Then the upgrade from the implementation live on
 * Base Sepolia (its bytecode in test/fixtures), as the CreditTimelock runs it: one upgradeToAndCall that also sets
 * the fee's bound (the fee is on by default, owner, Nov 18, 2026). The layout is append-only and a settlement made
 * before it reads the same after it.
 */
const ONE_USDC = 10n ** 6n;
const FEE = 300_000n; // 30 cents
const CEILING = 5_000_000n; // $5.00
const CYCLE = 30 * 24 * 60 * 60;
const TIERS = [
  { name: "SAVINGS", rate: 0n },
  { name: "ASSET_INTERNAL", rate: 65n },
  { name: "INCOME", rate: 150n },
  { name: "BOOST", rate: 300n },
];
const usd = (dollars: number) => BigInt(Math.round(dollars * 100)) * 10_000n;

describe("RevolvingIssuer: the card credit fee (decision 55)", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let issuer: any;
  let wk: any;
  let settler: any;
  let float: any;
  const REF = ethers.id("lithic-tx-fee-1");

  async function setup(deployIssuer: () => Promise<any>) {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    const coop = signers[8];
    settler = signers[9];
    float = signers[10];
    issuer = await deployIssuer.call(null);
    await ctx.networkRegistry.registerIssuer(await issuer.getAddress(), await ctx.stableCredit.getAddress());
    await ctx.access.grantOperator(await issuer.getAddress());
    for (const tier of TIERS) {
      await issuer.connect(ctx.operator).addTier(ethers.encodeBytes32String(tier.name), tier.rate, CYCLE);
    }
    await ctx.access.connect(ctx.operator).grantMember(ctx.counterparty.address);
    await ctx.access.connect(ctx.operator).grantMember(coop.address);
    await issuer.connect(ctx.operator).setCardSettler(settler.address, true);
    await issuer.connect(ctx.operator).setCardSettlementAccount(float.address);
    await issuer.connect(ctx.member).setSavingsDrawAllowance(ethers.MaxUint256);
    wk = await ethers.getContractAt("RevolvingIssuerWorkouts", await issuer.getAddress());
    return coop;
  }

  async function freshIssuer() {
    const coop = (await ethers.getSigners())[8];
    return upgrades.deployProxy(await ethers.getContractFactory("RevolvingIssuer"),
      [await ctx.stableCredit.getAddress(), coop.address], { ...(await issuerProxyOptions("RevolvingIssuer")), kind: "uups" });
  }

  const openLine = (capacities: bigint[]) => issuer.connect(ctx.operator).openLine(ctx.member.address, capacities, 0);
  const balance = () => ctx.stableCredit.creditBalanceOf(ctx.member.address);
  const held = () => ctx.stableCredit.balanceOf(float.address);
  async function settleWithFee(ref: string, amount: bigint, fee: bigint) {
    await issuer.connect(settler).authorizeCardSpend(ref, ctx.member.address, amount + fee);
    return issuer.connect(settler).settleCardSpendWithFee(ref, ctx.member.address, amount, fee);
  }
  /** The tiers and the ledger agree after every step, as every other draw guarantees. */
  async function reconciles() {
    expect(await issuer.totalPrincipalOf(ctx.member.address)).to.equal(await balance());
  }

  describe("on a fresh implementation", function () {
    beforeEach(async function () {
      await setup(freshIssuer);
    });

    it("is off until a credit settings signer sets the bound: zero refuses every fee", async function () {
      await openLine([0n, 500n, 0n, 0n].map((n) => n * ONE_USDC));
      expect(await wk.maxCardCreditFee()).to.equal(0n);
      await issuer.connect(settler).authorizeCardSpend(REF, ctx.member.address, usd(175.3));
      await expect(issuer.connect(settler).settleCardSpendWithFee(REF, ctx.member.address, usd(175), FEE))
        .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardFeeAboveMax").withArgs(FEE, 0n);
      await expect(issuer.connect(settler).settleCardSpendWithFee(REF, ctx.member.address, usd(175), 0n))
        .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardFeeZero");
      expect(await balance()).to.equal(0n);
    });

    it("only the credit settings role sets the bound, and never above $5.00", async function () {
      await expect(issuer.connect(settler).setMaxCardCreditFee(FEE)).to.be.revertedWithCustomError(issuer, "CreditIssuerMissingRole");
      await expect(issuer.connect(ctx.member).setMaxCardCreditFee(FEE)).to.be.revertedWithCustomError(issuer, "CreditIssuerMissingRole");
      await expect(issuer.connect(ctx.operator).setMaxCardCreditFee(FEE)).to.emit(issuer, "MaxCardCreditFeeUpdated").withArgs(FEE);
      expect(await wk.maxCardCreditFee()).to.equal(FEE);
      await expect(issuer.connect(ctx.operator).setMaxCardCreditFee(CEILING + 1n))
        .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardFeeAboveCeiling").withArgs(CEILING + 1n, CEILING);
      await issuer.connect(ctx.operator).setMaxCardCreditFee(CEILING);
      expect(await wk.maxCardCreditFee()).to.equal(CEILING);
      // Zero is the off switch, at any time.
      await issuer.connect(ctx.operator).setMaxCardCreditFee(0n);
      expect(await wk.maxCardCreditFee()).to.equal(0n);
    });

    describe("with the bound at 30 cents", function () {
      beforeEach(async function () {
        await issuer.connect(ctx.operator).setMaxCardCreditFee(FEE);
      });

      it("refuses a fee above the bound, and anyone but the card settler", async function () {
        await openLine([0n, 500n, 0n, 0n].map((n) => n * ONE_USDC));
        await issuer.connect(settler).authorizeCardSpend(REF, ctx.member.address, usd(176));
        await expect(issuer.connect(settler).settleCardSpendWithFee(REF, ctx.member.address, usd(175), FEE + 1n))
          .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardFeeAboveMax").withArgs(FEE + 1n, FEE);
        await expect(issuer.connect(ctx.member).settleCardSpendWithFee(REF, ctx.member.address, usd(175), FEE))
          .to.be.revertedWithCustomError(issuer, "RevolvingIssuerNotCardSettler");
        await expect(issuer.connect(ctx.operator).settleCardSpendWithFee(REF, ctx.member.address, usd(175), FEE))
          .to.be.revertedWithCustomError(issuer, "RevolvingIssuerNotCardSettler");
      });

      it("draws the purchase and the fee through the tiers cheapest first, and mints the fee as the third leg", async function () {
        await openLine([100n, 500n, 0n, 0n].map((n) => n * ONE_USDC));
        const tx = await settleWithFee(REF, usd(175), FEE);
        await expect(tx).to.emit(issuer, "CardSpendSettled").withArgs(REF, ctx.member.address, usd(175));
        await expect(tx).to.emit(issuer, "CardCreditFeeCharged").withArgs(REF, ctx.member.address, FEE);
        await expect(tx).to.emit(ctx.stableCredit, "PurchaseOriginated")
          .withArgs(ctx.member.address, float.address, usd(175.3), usd(175), FEE);
        // Cheapest first: Savings full, the rest of the purchase and the fee on the asset-backed tier.
        expect(await issuer.drawnOf(ctx.member.address, 0)).to.equal(usd(100));
        expect(await issuer.drawnOf(ctx.member.address, 1)).to.equal(usd(75.3));
        expect(await balance()).to.equal(usd(175.3));
        // Both legs to the card settlement account: no new recipient.
        expect(await held()).to.equal(usd(175.3));
        await reconciles();
        // The settlement record is the purchase alone; the fee is its own record.
        const [member, amount] = await issuer.cardSettlementOf(REF);
        expect([member, amount]).to.deep.equal([ctx.member.address, usd(175)]);
        expect(await wk.cardCreditFeeOf(REF)).to.deep.equal([FEE, 0n]);
        // The fee carries like the purchase: it is principal on the tier it was drawn on.
        await ethers.provider.send("evm_increaseTime", [CYCLE]);
        await ethers.provider.send("evm_mine", []);
        expect(await issuer.carryOf(ctx.member.address, 1)).to.be.greaterThan(0n);
      });

      it("draws Savings only as far as the member's allowance, the fee included (12.7)", async function () {
        await openLine([500n, 500n, 0n, 0n].map((n) => n * ONE_USDC));
        await issuer.connect(ctx.member).setSavingsDrawAllowance(usd(100));
        await settleWithFee(REF, usd(175), FEE);
        expect(await issuer.drawnOf(ctx.member.address, 0)).to.equal(usd(100));
        expect(await issuer.drawnOf(ctx.member.address, 1)).to.equal(usd(75.3));
        expect(await issuer.capacityOf(ctx.member.address, 0)).to.equal(usd(500));
        await reconciles();
      });

      it("holds the purchase and the fee together to the authorization, the caps and the line", async function () {
        await openLine([0n, 500n, 0n, 0n].map((n) => n * ONE_USDC));
        // An authorization for the purchase alone does not cover the fee.
        await issuer.connect(settler).authorizeCardSpend(REF, ctx.member.address, usd(175));
        await expect(issuer.connect(settler).settleCardSpendWithFee(REF, ctx.member.address, usd(175), FEE))
          .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardExceedsAuthorization").withArgs(REF, usd(175.3), usd(175));
        // For another member it is not this member's.
        await expect(issuer.connect(settler).settleCardSpendWithFee(REF, ctx.counterparty.address, usd(174), FEE))
          .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardNotAuthorized");

        // The per-purchase cap counts the fee.
        const REF2 = ethers.id("lithic-tx-fee-2");
        await issuer.connect(settler).authorizeCardSpend(REF2, ctx.member.address, usd(175.3));
        await issuer.connect(ctx.operator).setCardCaps(usd(175), 0n);
        await expect(issuer.connect(settler).settleCardSpendWithFee(REF2, ctx.member.address, usd(175), FEE))
          .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardTxCap").withArgs(usd(175.3), usd(175));
        // So does the per-day cap.
        await issuer.connect(ctx.operator).setCardCaps(0n, usd(175));
        await expect(issuer.connect(settler).settleCardSpendWithFee(REF2, ctx.member.address, usd(175), FEE))
          .to.be.revertedWithCustomError(issuer, "CreditIssuerDailyCapExceeded");
        await issuer.connect(ctx.operator).setCardCaps(0n, 0n);
        await issuer.connect(settler).settleCardSpendWithFee(REF2, ctx.member.address, usd(175), FEE);
        expect(await balance()).to.equal(usd(175.3));

        // A line that holds the purchase but not the fee is refused at authorization, all or nothing.
        const REF3 = ethers.id("lithic-tx-fee-3");
        const room = 500n * ONE_USDC - usd(175.3);
        await expect(issuer.connect(settler).authorizeCardSpend(REF3, ctx.member.address, room + FEE))
          .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardHeadroom");
      });

      it("settles a ref once, with or without a fee", async function () {
        await openLine([500n, 0n, 0n, 0n].map((n) => n * ONE_USDC));
        await settleWithFee(REF, usd(175), FEE);
        await expect(issuer.connect(settler).settleCardSpendWithFee(REF, ctx.member.address, usd(175), FEE))
          .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardAlreadySettled");
        await expect(issuer.connect(settler).settleCardSpend(REF, ctx.member.address, usd(175)))
          .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardAlreadySettled");
        await issuer.connect(settler).reverseCardSpend(REF, usd(175));
        await expect(issuer.connect(settler).settleCardSpendWithFee(REF, ctx.member.address, usd(175), FEE))
          .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardAlreadySettled");
        expect(await wk.cardCreditFeeOf(REF)).to.deep.equal([FEE, FEE]);
      });

      it("keeps the fee on a partial refund, and gives it back once with the refund that brings the purchase to zero", async function () {
        await openLine([100n, 500n, 0n, 0n].map((n) => n * ONE_USDC));
        await settleWithFee(REF, usd(175), FEE);

        const partial = await issuer.connect(settler).reverseCardSpend(REF, usd(50));
        await expect(partial).to.not.emit(issuer, "CardCreditFeeReturned");
        expect(await wk.cardCreditFeeOf(REF)).to.deep.equal([FEE, 0n]);
        expect(await balance()).to.equal(usd(125.3));
        expect(await held()).to.equal(usd(125.3));
        // Dearest first: the asset-backed tier gives back before Savings.
        expect(await issuer.drawnOf(ctx.member.address, 1)).to.equal(usd(25.3));
        await reconciles();

        const last = await issuer.connect(settler).reverseCardSpend(REF, usd(125));
        await expect(last).to.emit(issuer, "CardCreditFeeReturned").withArgs(REF, ctx.member.address, FEE);
        await expect(last).to.emit(issuer, "CardSpendReversed").withArgs(REF, ctx.member.address, usd(125));
        await expect(last).to.emit(ctx.stableCredit, "PurchaseReversed").withArgs(ctx.member.address, float.address, FEE, 0n, FEE);
        expect(await wk.cardCreditFeeOf(REF)).to.deep.equal([FEE, FEE]);
        expect(await balance()).to.equal(0n);
        expect(await held()).to.equal(0n);
        expect(await issuer.totalPrincipalOf(ctx.member.address)).to.equal(0n);
        expect((await issuer.cardSettlementOf(REF))[1]).to.equal(0n);
        // Nothing is left to give back, the fee least of all.
        await expect(issuer.connect(settler).reverseCardSpend(REF, 1n))
          .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardReversalExceedsSettlement");
        await expect(issuer.connect(settler).returnCardCreditFee(REF, 1n))
          .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardFeeReturnExceedsLeft").withArgs(REF, 1n, 0n);
      });

      it("credits part of the fee back, refuses more than is left, and a full refund then returns only the rest", async function () {
        // On Savings (0%), so no carry accrues between the blocks and every figure is exact.
        await openLine([500n, 0n, 0n, 0n].map((n) => n * ONE_USDC));
        await settleWithFee(REF, usd(175), FEE);

        await expect(issuer.connect(ctx.member).returnCardCreditFee(REF, 100_000n))
          .to.be.revertedWithCustomError(issuer, "RevolvingIssuerNotCardSettler");
        await expect(issuer.connect(settler).returnCardCreditFee(REF, 0n))
          .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardAmountZero");
        await expect(issuer.connect(settler).returnCardCreditFee(ethers.id("never"), 1n))
          .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardNotSettled");

        await expect(issuer.connect(settler).returnCardCreditFee(REF, 100_000n))
          .to.emit(issuer, "CardCreditFeeReturned").withArgs(REF, ctx.member.address, 100_000n);
        expect(await wk.cardCreditFeeOf(REF)).to.deep.equal([FEE, 100_000n]);
        expect(await balance()).to.equal(usd(175.2));
        expect(await held()).to.equal(usd(175.2));
        await reconciles();
        await expect(issuer.connect(settler).returnCardCreditFee(REF, 200_001n))
          .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardFeeReturnExceedsLeft").withArgs(REF, 200_001n, 200_000n);

        // A partial refund leaves what is left of the fee; the full one returns just that.
        await expect(issuer.connect(settler).reverseCardSpend(REF, usd(75))).to.not.emit(issuer, "CardCreditFeeReturned");
        await expect(issuer.connect(settler).reverseCardSpend(REF, usd(100)))
          .to.emit(issuer, "CardCreditFeeReturned").withArgs(REF, ctx.member.address, 200_000n);
        expect(await wk.cardCreditFeeOf(REF)).to.deep.equal([FEE, FEE]);
        expect(await balance()).to.equal(0n);
        expect(await held()).to.equal(0n);
      });

      it("a purchase with no fee has nothing to credit back", async function () {
        await openLine([0n, 500n, 0n, 0n].map((n) => n * ONE_USDC));
        await issuer.connect(settler).authorizeCardSpend(REF, ctx.member.address, usd(175));
        await issuer.connect(settler).settleCardSpend(REF, ctx.member.address, usd(175));
        await expect(issuer.connect(settler).returnCardCreditFee(REF, 1n))
          .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardFeeReturnExceedsLeft").withArgs(REF, 1n, 0n);
      });

      it("switching the fee off does not hold up crediting back a fee already charged", async function () {
        await openLine([0n, 500n, 0n, 0n].map((n) => n * ONE_USDC));
        await settleWithFee(REF, usd(175), FEE);
        await issuer.connect(ctx.operator).setMaxCardCreditFee(0n);
        await issuer.connect(settler).returnCardCreditFee(REF, 50_000n);
        await expect(issuer.connect(settler).reverseCardSpend(REF, usd(175)))
          .to.emit(issuer, "CardCreditFeeReturned").withArgs(REF, ctx.member.address, 250_000n);
        expect(await balance()).to.equal(0n);
        // And no new fee is charged while it is off.
        const REF2 = ethers.id("lithic-tx-fee-2");
        await issuer.connect(settler).authorizeCardSpend(REF2, ctx.member.address, usd(10.3));
        await expect(issuer.connect(settler).settleCardSpendWithFee(REF2, ctx.member.address, usd(10), FEE))
          .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardFeeAboveMax").withArgs(FEE, 0n);
      });

      it("a fiat repayment clears a purchase that carried a fee, the fee included, against the float's claim", async function () {
        await openLine([100n, 500n, 0n, 0n].map((n) => n * ONE_USDC));
        await settleWithFee(REF, usd(175), FEE);
        const PAY = ethers.id("card-repay:member:1");
        // The float holds the purchase's claim and the fee's, so the float check covers the whole balance.
        await expect(issuer.connect(settler).repayCardSpend(PAY, ctx.member.address, usd(175.31)))
          .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardRepaymentExceedsDrawn");
        await issuer.connect(settler).repayCardSpend(PAY, ctx.member.address, usd(175.3));
        expect(await balance()).to.equal(0n);
        expect(await held()).to.equal(0n);
        expect(await issuer.totalPrincipalOf(ctx.member.address)).to.equal(0n);
        expect(await issuer.cardRepaymentOf(PAY)).to.equal(usd(175.3));
        // The fee record stands: it was paid, not credited back.
        expect(await wk.cardCreditFeeOf(REF)).to.deep.equal([FEE, 0n]);
      });

      it("leaves plain settleCardSpend as it was: no fee, no fee record, no fee on its refund", async function () {
        await openLine([100n, 500n, 0n, 0n].map((n) => n * ONE_USDC));
        await issuer.connect(settler).authorizeCardSpend(REF, ctx.member.address, usd(175));
        const tx = await issuer.connect(settler).settleCardSpend(REF, ctx.member.address, usd(175));
        await expect(tx).to.emit(issuer, "CardSpendSettled").withArgs(REF, ctx.member.address, usd(175));
        await expect(tx).to.not.emit(issuer, "CardCreditFeeCharged");
        await expect(tx).to.emit(ctx.stableCredit, "PurchaseOriginated").withArgs(ctx.member.address, float.address, usd(175), usd(175), 0n);
        expect(await balance()).to.equal(usd(175));
        expect(await held()).to.equal(usd(175));
        expect(await wk.cardCreditFeeOf(REF)).to.deep.equal([0n, 0n]);
        await expect(issuer.connect(settler).reverseCardSpend(REF, usd(175))).to.not.emit(issuer, "CardCreditFeeReturned");
        expect(await balance()).to.equal(0n);
      });
    });
  });

  describe("the upgrade from the implementation live on Base Sepolia", function () {
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "revolving-issuer.base-sepolia.json"), "utf8"));

    it("keeps the storage layout append-only against the live implementation the manifest records", async function () {
      const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", ".openzeppelin", "base-sepolia.json"), "utf8"));
      const validations = await readValidations(hre);
      const updated = getStorageLayout(validations, getVersion((await hre.artifacts.readArtifact("RevolvingIssuer")).bytecode));
      const live = manifest.impls[Object.keys(manifest.impls).find((k) => manifest.impls[k].address === fixture.contracts.RevolvingIssuer.address)!];
      expect(live, "the live implementation is in the manifest").to.not.equal(undefined);
      const report = getStorageUpgradeReport(live.layout, updated, withValidationDefaults({}));
      expect(report.ok, report.explain()).to.equal(true);
      // The new namespace, beside Phase 2g's; nothing in the plain layout moved.
      expect(Object.keys(updated.namespaces ?? {})).to.include.members([
        "erc7201:clear.storage.RevolvingIssuer.Phase2g", "erc7201:clear.storage.RevolvingIssuer.CardFee",
      ]);
      expect(updated.storage.map((s: any) => [s.label, s.slot])).to.deep.equal(live.layout.storage.map((s: any) => [s.label, s.slot]));
      // The plugin's own checks of the new implementation (constructor, delegatecall, immutables).
      await upgrades.validateImplementation(await ethers.getContractFactory("RevolvingIssuer"), { kind: "uups", constructorArgs: Array(4).fill(ethers.ZeroAddress) });
    });

    it("upgrades through the CreditTimelock with the fee switched on in the same call, and reads an earlier settlement the same", async function () {
      // The live implementation and its modules, at their own addresses (their immutables name each other).
      for (const c of Object.values<any>(fixture.contracts)) await ethers.provider.send("hardhat_setCode", [c.address, c.code]);
      await setup(async () => {
        const init = (await ethers.getContractFactory("RevolvingIssuer")).interface.encodeFunctionData("initialize", [await ctx.stableCredit.getAddress(), (await ethers.getSigners())[8].address]);
        const proxy = await (await ethers.getContractFactory("ERC1967Proxy")).deploy(fixture.contracts.RevolvingIssuer.address, init);
        return ethers.getContractAt("RevolvingIssuer", await proxy.getAddress());
      });
      expect(await issuer.extension()).to.equal(fixture.contracts.RevolvingIssuerExtension.address);
      // Today's implementation has no fee: the selectors fall through to its workouts module, which refuses them.
      await expect(wk.maxCardCreditFee()).to.be.reverted;

      await openLine([100n, 500n, 0n, 0n].map((n) => n * ONE_USDC));
      await issuer.connect(settler).authorizeCardSpend(REF, ctx.member.address, usd(175));
      await issuer.connect(settler).settleCardSpend(REF, ctx.member.address, usd(175));
      await issuer.connect(settler).reverseCardSpend(REF, usd(25));
      await issuer.connect(ctx.operator).setCardCaps(usd(1000), usd(5000));
      const before = {
        settlement: await issuer.cardSettlementOf(REF),
        principal: [await issuer.principalOnlyOf(ctx.member.address, 0), await issuer.principalOnlyOf(ctx.member.address, 1)],
        capacity: await issuer.totalCapacityOf(ctx.member.address),
        cardTxCap: await issuer.cardTxCap(),
        account: await issuer.cardSettlementAccount(),
      };

      // The CreditTimelock as on Base Sepolia after the credit handover: RevolvingIssuer's owner, and the AccessManager's
      // admin (which is what gives it CREDIT_SETTINGS_ROLE through hasCreditRole). The Safe proposes and executes.
      const safe = (await ethers.getSigners())[12];
      const timelock = await deployCreditTimelock(safe.address);
      const tl = await timelock.getAddress();
      await issuer.connect(ctx.admin).transferOwnership(tl);
      const opts = await issuerProxyOptions("RevolvingIssuer");
      const impl = await (await ethers.getContractFactory("RevolvingIssuer")).deploy(...opts.constructorArgs);
      const data = issuer.interface.encodeFunctionData("upgradeToAndCall",
        [await impl.getAddress(), issuer.interface.encodeFunctionData("setMaxCardCreditFee", [FEE])]);
      const proxy = await issuer.getAddress();
      const salt = ethers.id("card fee upgrade");
      const DELAY = 7 * 24 * 3600;
      const run = async () => {
        await timelock.connect(safe).schedule(proxy, 0, data, ethers.ZeroHash, salt, DELAY);
        await ethers.provider.send("evm_increaseTime", [DELAY + 1]);
        await ethers.provider.send("evm_mine", []);
        return timelock.connect(safe).execute(proxy, 0, data, ethers.ZeroHash, salt);
      };
      // Without the credit role, setMaxCardCreditFee reverts and takes the whole upgrade with it.
      await expect(run()).to.be.reverted;
      expect(await upgrades.erc1967.getImplementationAddress(proxy)).to.equal(fixture.contracts.RevolvingIssuer.address);
      await ctx.access.connect(ctx.admin).grantRole(ethers.ZeroHash, tl);
      await expect(timelock.connect(safe).execute(proxy, 0, data, ethers.ZeroHash, salt))
        .to.emit(issuer, "MaxCardCreditFeeUpdated").withArgs(FEE);
      expect(await upgrades.erc1967.getImplementationAddress(proxy)).to.equal(await impl.getAddress());

      expect(await issuer.cardSettlementOf(REF)).to.deep.equal(before.settlement);
      // Principal alone: carry runs on through the 7 days.
      expect([await issuer.principalOnlyOf(ctx.member.address, 0), await issuer.principalOnlyOf(ctx.member.address, 1)]).to.deep.equal(before.principal);
      expect(await issuer.totalCapacityOf(ctx.member.address)).to.equal(before.capacity);
      expect(await issuer.cardTxCap()).to.equal(before.cardTxCap);
      expect(await issuer.cardSettlementAccount()).to.equal(before.account);
      // The fee is on from the upgrade; nothing is recorded for the purchase settled before it.
      expect(await wk.maxCardCreditFee()).to.equal(FEE);
      expect(await wk.cardCreditFeeOf(REF)).to.deep.equal([0n, 0n]);

      // The old purchase refunds as before, with no fee to give back (the week's carry stays owed).
      await expect(issuer.connect(settler).reverseCardSpend(REF, usd(150))).to.not.emit(issuer, "CardCreditFeeReturned");
      expect((await issuer.cardSettlementOf(REF))[1]).to.equal(0n);
      expect(await issuer.principalOnlyOf(ctx.member.address, 1)).to.equal(0n);
      await reconciles();

      // And a new purchase carries the fee: on Savings (0%), so the figures are exact.
      const owed = await balance();
      const onSavings = await issuer.principalOnlyOf(ctx.member.address, 0);
      const REF2 = ethers.id("lithic-tx-after-upgrade");
      await settleWithFee(REF2, usd(40), FEE);
      expect(await balance()).to.equal(owed + usd(40.3));
      expect(await issuer.principalOnlyOf(ctx.member.address, 0)).to.equal(onSavings + usd(40.3));
      expect(await wk.cardCreditFeeOf(REF2)).to.deep.equal([FEE, 0n]);
      await reconciles();
    });
  });
});
