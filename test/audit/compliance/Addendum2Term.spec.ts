import { expect } from "chai";
import { ethers } from "hardhat";
import { deployCore, advance } from "../deep/deep-setup";
import { signedOpenPlan, FEE_REASON } from "../../helpers/plans";
import { CA, P, CA_BANDS, ONE_USDC, CYCLE, params, deployRateSchedule } from "./rates";

/*
 * Addendum 2, the term side: the Combined Ceiling (12.3, acceptance 43) and the origination fee
 * leg (12.16, acceptance 47 and 48), with the spec's figures.
 *
 * Units for 43. The spec's figures are monthly: a plan's is its list rate per 30-day cycle (decision
 * C: $20.00 on $1,000 at 2%), the revolving tiers' is their monthly carry, and the ceiling is the
 * graduated schedule a month on the combined principal. A plan the ceiling trims accrues what it is
 * allowed a month per second at monthly x 12 / 365, like every cap, so over a 30-day cycle it is
 * 360/365 of its figure; a plan it leaves alone accrues its figure per 30 days.
 */
const usd = (n: number | bigint) => BigInt(n) * ONE_USDC;
const PARTNER = P("PARTNER"), CASH = P("CASH"), REVOLVING = P("REVOLVING"), INCOME = P("INCOME"), BOOST = P("BOOST");
const INCOME_TIER = 2, BOOST_TIER = 3;

describe("ADDENDUM 2: Combined Ceiling and the origination fee leg (acceptance 43, 47, 48)", function () {
  let core: Awaited<ReturnType<typeof deployCore>>;
  let rates: any;

  beforeEach(async function () {
    core = await deployCore();
    const { ctx, term, revolving, member2, member3 } = core;
    rates = await deployRateSchedule(ctx.admin.address);
    await rates.setProduct(CA, PARTNER, params({ listMonthlyBps: 200 }), CA_BANDS);
    await rates.setProduct(CA, CASH, params({ listMonthlyBps: 250, annualCapBps: 3_650 }), CA_BANDS);
    await rates.setProduct(CA, INCOME, params({ listMonthlyBps: 150 }), CA_BANDS);
    await rates.setProduct(CA, BOOST, params({ listMonthlyBps: 250 }), CA_BANDS);
    await rates.setProduct(CA, REVOLVING, params({ listMonthlyBps: 0 }), CA_BANDS);
    await term.connect(ctx.admin).setRateSchedule(await rates.getAddress());
    await revolving.connect(ctx.operator).setPricing(await rates.getAddress(), REVOLVING);
    await revolving.connect(ctx.operator).setTierProduct(INCOME_TIER, INCOME);
    await revolving.connect(ctx.operator).setTierProduct(BOOST_TIER, BOOST);
    await rates.setCflSources([await revolving.getAddress(), await term.getAddress()]);
    // 12.3: the ceiling is wired once, both ways, and stays on.
    await term.connect(ctx.operator).setCombinedCeiling(await revolving.getAddress(), REVOLVING);
    await revolving.connect(ctx.operator).setTermIssuer(await term.getAddress());
    await ctx.networkRegistry.grantRole(await ctx.networkRegistry.STATE_ATTESTER_ROLE(), ctx.admin.address);
    for (const m of [ctx.member, member2, member3]) {
      await ctx.networkRegistry.attestStateCode(m.address, CA);
      await term.connect(ctx.operator).setTermLimit(m.address, usd(10_000));
    }
  });

  /** The fee the chain charges: the merchant's 250 bps, capped at $50 up to $2,500 and $75 above. */
  function feeOn(purchase: bigint) {
    const fee = (purchase * 250n) / 10_000n;
    const cap = purchase <= usd(2_500) ? usd(50) : usd(75);
    return fee < cap ? fee : cap;
  }
  async function open(member: any, purchase: bigint, installments: number, product = PARTNER) {
    const { term, merchant, ctx } = core;
    const rate = installments === 1 ? 0n : await rates.effectiveMonthlyBps(CA, product, purchase);
    return signedOpenPlan(term, ctx.operator, member.address, merchant.address, purchase, purchase - feeOn(purchase), rate, CYCLE, installments, CYCLE, product);
  }
  async function figures(member: any) {
    const [ids, monthly] = await core.term.combinedPlanCarryOf(member.address);
    return { ids: [...ids].map(Number), monthly: [...monthly] as bigint[] };
  }

  describe("43. Combined Ceiling", function () {
    it("two $1,000 plans at 2%, no revolving balance: monthly carry limited to $33.875 -- the newer plan $13.875, the older $20.00", async function () {
      const { ctx, term } = core;
      await open(ctx.member, usd(1_000), 4);
      await open(ctx.member, usd(1_000), 4);
      const f = await figures(ctx.member);
      expect(f.ids).to.deep.equal([0, 1]);
      expect(f.monthly[0]).to.be.closeTo(usd(20), 2n); // the older plan, untouched
      expect(f.monthly[1]).to.be.closeTo(13_875_000n, 2n); // the newer, trimmed
      expect(f.monthly[0] + f.monthly[1]).to.be.closeTo(33_875_000n, 2n); // graduated on $2,000
      // Over a 30-day cycle: the older plan its list carry, the newer its allowance per second.
      await advance(CYCLE);
      await term.materialiseMember(ctx.member.address);
      expect(await term.carryOutstandingOf(0)).to.be.closeTo(usd(20), 2_000n);
      expect(await term.carryOutstandingOf(1)).to.be.closeTo((13_875_000n * 360n) / 365n, 2_000n);
      // No 30 days exceed the monthly cap, and no day exceeds a thirtieth of it.
      expect((await term.carryOutstandingOf(0)) + (await term.carryOutstandingOf(1))).to.be.lte(33_875_000n);
    });

    it("income-backed $1,000 at 1.5% and a $940 plan at 2%: total $33.275, with $0.525 trimmed from the plan", async function () {
      const { ctx, revolving, merchant, member2 } = core;
      await revolving.connect(ctx.operator).openLine(member2.address, [0n, 0n, usd(1_000), 0n], 0);
      await ctx.stableCredit.connect(member2).transfer(merchant.address, usd(1_000));
      await open(member2, usd(940), 4);
      const [, , revPrincipal, revMonthly] = await revolving.combinedInputsOf(member2.address);
      expect(revPrincipal).to.equal(usd(1_000));
      expect(revMonthly / 10n ** 22n).to.equal(usd(15)); // 1.5% a month, untrimmed
      const f = await figures(member2);
      expect(f.monthly[0]).to.be.closeTo(18_275_000n, 2n); // $18.80 less $0.525
      expect(usd(15) + f.monthly[0]).to.be.closeTo(33_275_000n, 2n); // graduated on $1,940
      // The revolving tier keeps its carry: it is trimmed only after every plan.
      await advance(CYCLE);
      await revolving.materialiseCarry(member2.address);
      expect(await revolving.carryOf(member2.address, INCOME_TIER)).to.be.closeTo((usd(15) * 360n) / 365n, 2_000n);
    });

    it("a $3,000 Clear Cash plan is not counted, and no function can disable the ceiling", async function () {
      const { ctx, term, revolving } = core;
      await open(ctx.member, usd(1_000), 4);
      await open(ctx.member, usd(1_000), 4);
      await open(ctx.member, usd(3_000), 13, CASH);
      const f = await figures(ctx.member);
      expect(f.monthly[0]).to.be.closeTo(usd(20), 2n);
      expect(f.monthly[1]).to.be.closeTo(13_875_000n, 2n); // unchanged by the Clear Cash plan
      expect(f.monthly[2]).to.be.closeTo(usd(75), 2n); // its own 2.5% per 30 days, under its annual cap

      await expect(term.connect(ctx.operator).setCombinedCeiling(ethers.ZeroAddress, REVOLVING))
        .to.be.revertedWithCustomError(term, "TermIssuerCombinedSet");
      await expect(term.connect(ctx.admin).setCombinedCeiling(await revolving.getAddress(), P("OTHER")))
        .to.be.revertedWithCustomError(term, "TermIssuerCombinedSet");
      await expect(revolving.connect(ctx.operator).setTermIssuer(ctx.operator.address))
        .to.be.revertedWithCustomError(revolving, "RevolvingIssuerTermIssuerSet");
      // DECISIONS #7's switch is gone.
      expect(rates.interface.getFunction("setCflAggregation")).to.equal(null);
      for (const c of [rates, term, revolving]) {
        const names = c.interface.fragments.filter((x: any) => x.type === "function").map((x: any) => x.name);
        expect(names.filter((n: string) => /aggregation|disable|ceilingOff/i.test(n))).to.deep.equal([]);
      }
    });
  });

  describe("47-48. The origination fee leg (12.16)", function () {
    async function balances(...who: string[]) {
      return Promise.all(who.map((a) => core.ctx.stableCredit.balanceOf(a)));
    }

    it("47. $1,000 at 250 bps: member -1,000, merchant +975, feeRecipient +25; $2,400 is capped at $50; $3,000 at $75; the legs sum to zero and no other address receives a fee", async function () {
      const { ctx, term, merchant, coop, member2, member3, feeRecipient } = core;
      expect(await term.feeRecipient()).to.equal(feeRecipient);
      for (const [who, purchase, split, payout, fee] of [
        [ctx.member, usd(1_000), 4, usd(975), usd(25)],
        [member2, usd(2_400), 4, usd(2_350), usd(50)],
        [member3, usd(3_000), 13, usd(2_925), usd(75)],
      ] as const) {
        const supply = await ctx.stableCredit.totalSupply();
        const [m0, f0, c0] = await balances(merchant.address, feeRecipient, coop.address);
        const owed = await ctx.stableCredit.creditBalanceOf(who.address);
        await expect(open(who, purchase, split)).to.emit(ctx.stableCredit, "PurchaseOriginated")
          .withArgs(who.address, merchant.address, purchase, payout, fee);
        const [m1, f1, c1] = await balances(merchant.address, feeRecipient, coop.address);
        expect((await ctx.stableCredit.creditBalanceOf(who.address)) - owed).to.equal(purchase); // member -amount
        expect(m1 - m0).to.equal(payout);
        expect(f1 - f0).to.equal(fee);
        expect(c1 - c0).to.equal(0n); // the co-op receives nothing in the mint
        expect((await ctx.stableCredit.totalSupply()) - supply).to.equal(purchase); // -amount + payout + fee = 0
      }
    });

    it("48. a full refund of the $1,000 charge reverses $25 from feeRecipient, a 40% refund $10; a same-signer change reverts; a two-person change emits its event and applies only to later charges", async function () {
      const { ctx, term, merchant, member2, feeRecipient } = core;
      await open(ctx.member, usd(1_000), 4); // plan 0
      await open(member2, usd(1_000), 4); // plan 1
      let [f0] = await balances(feeRecipient);
      await term.connect(ctx.operator).closePlanForRefund(0, usd(1_000), merchant.address, 0);
      let [f1] = await balances(feeRecipient);
      expect(f0 - f1).to.equal(usd(25));
      await term.connect(ctx.operator).closePlanForRefund(1, usd(400), merchant.address, 0);
      [f0] = await balances(feeRecipient);
      expect(f1 - f0).to.equal(usd(10));

      // The change: never by one signer, never to the co-op, never by someone without the role.
      const lending = (await ethers.getSigners())[15];
      const reason = ethers.encodeBytes32String("MULTISIG_ROTATION");
      await expect(term.connect(ctx.outsider).proposeFeeRecipient(lending.address, reason))
        .to.be.revertedWithCustomError(term, "CreditIssuerMissingRole");
      await expect(term.connect(ctx.operator).proposeFeeRecipient(await term.carryTreasury(), reason))
        .to.be.revertedWithCustomError(term, "TermIssuerFeeRecipientNotAllowed");
      await term.connect(ctx.operator).proposeFeeRecipient(lending.address, reason);
      await expect(term.connect(ctx.operator).approveFeeRecipient(lending.address, reason))
        .to.be.revertedWithCustomError(term, "TermIssuerSameSigner");
      await expect(term.connect(ctx.admin).approveFeeRecipient(lending.address, FEE_REASON))
        .to.be.revertedWithCustomError(term, "TermIssuerNoProposal");
      await expect(term.connect(ctx.admin).approveFeeRecipient(lending.address, reason))
        .to.emit(term, "FeeRecipientChanged")
        .withArgs(feeRecipient, lending.address, reason, ctx.operator.address, ctx.admin.address);
      expect(await term.feeRecipient()).to.equal(lending.address);

      // Later charges pay the new recipient; the earlier charge still reverses from the old one.
      const [l0] = await balances(lending.address);
      await open(core.member3, usd(1_000), 4); // plan 2
      expect((await balances(lending.address))[0] - l0).to.equal(usd(25));
      [f0] = await balances(feeRecipient);
      await term.connect(ctx.operator).closePlanForRefund(1, usd(600), merchant.address, 0);
      [f1] = await balances(feeRecipient);
      expect(f0 - f1).to.equal(usd(15)); // the rest of plan 1's fee, from where it went
      expect((await balances(lending.address))[0] - l0).to.equal(usd(25));
      expect((await term.pricingOf(1)).feeTo).to.equal(feeRecipient);
      expect((await term.pricingOf(2)).feeTo).to.equal(lending.address);
    });
  });
});
