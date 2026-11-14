import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployCore, advance } from "../deep/deep-setup";
import { deployPhase0Network } from "../../helpers/phase0-fixture";
import { issuerProxyOptions } from "../../helpers/issuers";
import { signedOpenPlan } from "../../helpers/plans";
import { pledgeSigned, signPledge, signPledgeItem } from "../../helpers/pledge";
import { CA, NY, P, CA_BANDS, ONE_USDC, CYCLE, DAY, params, deployRateSchedule } from "../compliance/rates";
import { deployDeedTrack, mintValidatedLand, mintValidatedVehicle, signTrust, k, Ctx } from "../deed/fixture";

/*
 * Phase 4b: the owner's decisions on the Phase 4 re-review (`docs/audit/REREVIEW-DECISIONS.md`).
 * One regression test (or more) per item, each named for it. L-C is documentation only; its test
 * confirms the card caps are governed parameters.
 */

const SAVINGS = ethers.encodeBytes32String("SAVINGS");
const INCOME = ethers.encodeBytes32String("INCOME");
const POOL_SHARE = ethers.encodeBytes32String("POOL_SHARE");
const SAVINGS_BACKED = 1, UNSECURED = 0;
const GRACE = 5 * DAY;

/** The savings-backed line as Liquidator.spec wires it: CLRUSD, the vault, the registry and the Liquidator. */
async function savingsStack() {
  const ctx = await deployPhase0Network();
  const s = await ethers.getSigners();
  const [coop, settler, float, stranger] = [s[8], s[9], s[10], s[11]];
  const ClearUSD = await ethers.getContractFactory("ClearUSDUpgradeable");
  const clrusd: any = await upgrades.deployProxy(ClearUSD,
    ["Clear USD", "CLRUSD", 6, 0, 0, ctx.admin.address, ctx.admin.address],
    { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
  const vault: any = await upgrades.deployProxy(await ethers.getContractFactory("ESADepositVault"),
    [await clrusd.getAddress(), ctx.admin.address], { kind: "uups" });
  await clrusd.grantRole(await clrusd.MINTER_ROLE(), await vault.getAddress());
  await clrusd.grantRole(await clrusd.BURNER_ROLE(), await vault.getAddress());
  await vault.setAcceptedToken(await ctx.usdc.getAddress(), true);

  const issuer: any = await upgrades.deployProxy(await ethers.getContractFactory("RevolvingIssuer"),
    [await ctx.stableCredit.getAddress(), coop.address], { ...(await issuerProxyOptions("RevolvingIssuer")), kind: "uups" });
  await ctx.networkRegistry.registerIssuer(await issuer.getAddress(), await ctx.stableCredit.getAddress());
  await ctx.access.grantOperator(await issuer.getAddress());
  await ctx.access.connect(ctx.operator).grantMember(ctx.counterparty.address);
  await issuer.connect(ctx.operator).addTier(SAVINGS, 0n, CYCLE);
  await issuer.connect(ctx.operator).addTier(INCOME, 150n, CYCLE);

  const registry: any = await upgrades.deployProxy(await ethers.getContractFactory("CollateralRegistry"),
    [ctx.admin.address, await ctx.networkRegistry.getAddress()], { kind: "uups" });
  await registry.registerCollateralType(SAVINGS, SAVINGS_BACKED, 10_000n, 10n ** 18n);
  await registry.registerCollateralType(INCOME, UNSECURED, 0n, 0n);
  await registry.setClrusdKind(SAVINGS);
  await registry.setClrusdToken(await clrusd.getAddress());
  await clrusd.setEncumbranceSource(await registry.getAddress());
  await issuer.connect(ctx.operator).setExposureSource(await registry.getAddress());

  const liquidator: any = await upgrades.deployProxy(await ethers.getContractFactory("Liquidator"), [
    ctx.admin.address, await ctx.stableCredit.getAddress(), await clrusd.getAddress(), await vault.getAddress(),
    await ctx.usdc.getAddress(), await registry.getAddress()], { kind: "uups" });
  await clrusd.grantRole(await clrusd.LIQUIDATOR_ROLE(), await liquidator.getAddress());
  await registry.grantRole(await registry.OPERATOR_ROLE(), await liquidator.getAddress());
  await ctx.access.grantOperator(await liquidator.getAddress());
  await liquidator.setTrustedSavingsIssuer(await issuer.getAddress(), true);

  const m = ctx.member;
  const save = async (amount: bigint) => {
    await ctx.usdc.mint(m.address, amount);
    await ctx.usdc.connect(m).approve(await vault.getAddress(), amount);
    await vault.connect(m).deposit(await ctx.usdc.getAddress(), amount, m.address);
    await pledgeSigned(registry, m, SAVINGS, amount);
  };
  const openLine = (savingsCap: bigint, incomeCap: bigint) =>
    issuer.connect(ctx.operator).openLine(m.address, [savingsCap, incomeCap], CYCLE, CYCLE);
  const spend = (amount: bigint) => ctx.stableCredit.connect(m).transfer(ctx.counterparty.address, amount);
  return { ctx, clrusd, vault, issuer, registry, liquidator, coop, settler, float, stranger, save, openLine, spend };
}

/** Drives the member's line into a recorded default (section 12.5 cure path, then expiry). */
async function defaultLine(issuer: any, operator: any, member: string) {
  await issuer.connect(operator).setCreditTerms(
    { unsecuredLineCap: 0, cureWindow: DAY, boostCleanCycles: 0, boostDepositCycles: 0, autoClearOffGlobal: false }, 0, 0);
  for (let i = 0; i < 6 && !(await issuer.hasDefaultedOnCurrentLine(member)); i++) {
    await advance(2 * CYCLE + DAY + 1);
    await issuer.syncCreditPeriod(member);
  }
  expect(await issuer.hasDefaultedOnCurrentLine(member)).to.equal(true);
}

/** Term plans and the revolving line priced from one RateSchedule, CFL aggregation on (DECISIONS #7). */
async function pricedCredit(opts: { ceilingThreshold?: bigint } = {}) {
  const core = await deployCore();
  const { ctx, term, revolving, member2 } = core;
  const rates = await deployRateSchedule(ctx.admin.address);
  // Partner credit with no large-loan regime, so its graduated cap on the member's aggregate binds.
  await rates.setProduct(CA, P("PARTNER"), params({ listMonthlyBps: 200, largeLoanThreshold: 0n }), CA_BANDS);
  await rates.setProduct(CA, P("CASH"), params({ listMonthlyBps: 250, annualCapBps: 2_000 }), CA_BANDS);
  await rates.setProduct(CA, INCOME, params({ listMonthlyBps: 150 }), CA_BANDS);
  await rates.setProduct(CA, P("BOOST"), params({ listMonthlyBps: 300 }), CA_BANDS);
  // The member-level ceiling on CA's graduated table, with no large-loan regime, so it binds.
  await rates.setProduct(CA, P("REVOLVING"), params({ largeLoanThreshold: opts.ceilingThreshold ?? 0n }), CA_BANDS);
  await term.connect(ctx.admin).setRateSchedule(await rates.getAddress());
  await revolving.connect(ctx.operator).setPricing(await rates.getAddress(), P("REVOLVING"));
  await revolving.connect(ctx.operator).setTierProduct(2, INCOME);
  await revolving.connect(ctx.operator).setTierProduct(3, P("BOOST"));
  await rates.setCflSources([await revolving.getAddress(), await term.getAddress()]);
  await ctx.networkRegistry.grantRole(await ctx.networkRegistry.STATE_ATTESTER_ROLE(), ctx.admin.address);
  for (const m of [ctx.member, member2]) {
    await ctx.networkRegistry.attestStateCode(m.address, CA);
    await term.connect(ctx.operator).setTermLimit(m.address, 20_000n * ONE_USDC);
  }
  return { ...core, rates };
}

async function openPriced(core: any, member: any, purchase: bigint, installments: number, product: string) {
  const { term, merchant, ctx, rates } = core;
  const payout = purchase - (purchase * 250n) / 10_000n; // the merchant's registered discount
  let rate = await rates.effectiveMonthlyBps(CA, product, purchase);
  const p = await rates.paramsOf(CA, product);
  if (p.largeLoanThreshold !== 0n && purchase >= p.largeLoanThreshold) {
    const perCycle = (p.annualCapBps * 30n) / 365n;
    if (rate > perCycle) rate = perCycle;
  }
  return signedOpenPlan(term, ctx.operator, member.address, merchant.address, purchase, payout, rate, CYCLE, installments, CYCLE, product);
}

const RATE_SCALE = 10n ** 18n;

describe("PHASE 4b: the owner's decisions on the re-review", function () {
  describe("M-C: liquidation reaches only the current default episode", function () {
    it("a member who defaulted, settled and was given a new line cannot be liquidated by a stranger while current", async function () {
      const st = await savingsStack();
      const { ctx, issuer, liquidator, stranger, save, openLine, spend } = st;
      const m = ctx.member.address;
      await save(1_000n * ONE_USDC);
      await openLine(1_000n * ONE_USDC, 0n);
      await spend(1_000n * ONE_USDC);
      await defaultLine(issuer, ctx.operator, m);
      // The first default: liquidation is open to anyone, as compliance 10b has it.
      await liquidator.connect(stranger).liquidate(m, await issuer.getAddress(), 0, SAVINGS);
      expect(await issuer.hasDefaulted(m)).to.equal(true);

      // Re-onboarded: a new line (which restores membership), new savings drawn.
      await openLine(500n * ONE_USDC, 0n);
      expect(await issuer.lineOpenedAtOf(m)).to.be.gt(await issuer.defaultedAt(m));
      await save(500n * ONE_USDC);
      await spend(400n * ONE_USDC);
      expect(await issuer.hasDefaulted(m)).to.equal(true); // the record is kept
      expect(await issuer.hasDefaultedOnCurrentLine(m)).to.equal(false);
      await expect(liquidator.connect(stranger).liquidate(m, await issuer.getAddress(), 0, SAVINGS))
        .to.be.revertedWithCustomError(liquidator, "LiquidatorNotInDefault");
      expect(await issuer.principalOf(m, 0)).to.equal(400n * ONE_USDC);
    });

    it("a default of the new line is liquidatable again", async function () {
      const st = await savingsStack();
      const { ctx, issuer, liquidator, stranger, save, openLine, spend, clrusd } = st;
      const m = ctx.member.address;
      await save(1_000n * ONE_USDC);
      await openLine(1_000n * ONE_USDC, 0n);
      await spend(1_000n * ONE_USDC);
      await defaultLine(issuer, ctx.operator, m);
      await liquidator.connect(stranger).liquidate(m, await issuer.getAddress(), 0, SAVINGS);
      await openLine(500n * ONE_USDC, 0n);
      await save(500n * ONE_USDC);
      await spend(400n * ONE_USDC);
      await defaultLine(issuer, ctx.operator, m);
      await liquidator.connect(stranger).liquidate(m, await issuer.getAddress(), 0, SAVINGS);
      expect(await issuer.principalOf(m, 0)).to.equal(0n);
      expect(await clrusd.balanceOf(m)).to.equal(100n * ONE_USDC);
    });
  });

  describe("M-E: registering an issuer is the admin's, not the operator's", function () {
    it("the NetworkRegistry operator can neither register nor deregister an issuer; the admin can", async function () {
      const ctx = await deployPhase0Network();
      const reg = ctx.networkRegistry;
      const rogue = ethers.Wallet.createRandom().address;
      await reg.grantRole(await reg.OPERATOR_ROLE(), ctx.operator.address);
      await expect(reg.connect(ctx.operator).registerIssuer(rogue, await ctx.stableCredit.getAddress()))
        .to.be.reverted;
      await reg.connect(ctx.admin).registerIssuer(rogue, await ctx.stableCredit.getAddress());
      await expect(reg.connect(ctx.operator).deregisterIssuer(rogue)).to.be.reverted;
      await reg.connect(ctx.admin).deregisterIssuer(rogue);
      expect(await reg.isIssuer(rogue)).to.equal(false);
    });
  });

  describe("M-F: a validator change waits out a delay, and a Void can be lifted by two parties", function () {
    let ctx: Ctx;
    let v2: any;
    beforeEach(async function () {
      ctx = await deployDeedTrack();
      const V = await ethers.getContractFactory("Validator", ctx.operator2);
      v2 = await upgrades.deployProxy(V, ["https://other/", "https://other/oa/"], { kind: "uups" });
      await v2.setDeedNFT(await ctx.deed.getAddress());
      await v2.setAssetTypeSupport(0, true);
      await ctx.registry.registerValidator(await v2.getAddress(), "Friendly Validator", "", [0]);
      await ctx.registry.updateValidatorStatus(await v2.getAddress(), true);
    });

    it("the holder cannot dodge a freeze by reassigning: the old validator may still void during the delay", async function () {
      const { deed, trust, alice, bob, deployer } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      const v1 = await ctx.validator.getAddress();
      await expect(deed.connect(alice).reassignValidator(id, await v2.getAddress()))
        .to.emit(deed, "ValidatorReassignmentRequested");
      // Still v1's deed: v1 freezes it.
      expect((await deed.getValidationStatus(id))[1]).to.equal(v1);
      await trust.connect(deployer).markVoid(id, 128, k("order"), "ipfs://order");
      await advance(7 * DAY);
      // Neither completing nor a fresh request moves a Void deed.
      await expect(deed.connect(alice).completeValidatorReassignment(id)).to.be.revertedWithCustomError(trust, "NotActive");
      await expect(deed.connect(alice).reassignValidator(id, await v2.getAddress())).to.be.revertedWithCustomError(trust, "NotActive");
      await expect(deed.connect(alice).transferFrom(alice.address, bob.address, id)).to.be.revertedWithCustomError(trust, "DeedFrozen");
      // Burning a frozen deed stays allowed (its record is kept).
      await deed.connect(alice).burnAsset(id);
      expect(await trust.statusOf(id)).to.equal(1);
    });

    it("the reassignment completes only after the governed delay, by the holder", async function () {
      const { deed, alice, mallory, deployer } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      await deed.connect(alice).reassignValidator(id, await v2.getAddress());
      const [pending, at] = await deed.pendingValidatorOf(id);
      expect(pending).to.equal(await v2.getAddress());
      await expect(deed.connect(alice).completeValidatorReassignment(id)).to.be.revertedWithCustomError(deed, "ReassignmentNotDue");
      await advance(7 * DAY);
      await expect(deed.connect(mallory).completeValidatorReassignment(id)).to.be.revertedWith("Not deed owner");
      await expect(deed.connect(alice).completeValidatorReassignment(id))
        .to.emit(deed, "ValidatorReassigned").withArgs(id, await v2.getAddress());
      expect(await deed.getValidationStatus(id)).to.deep.equal([false, await v2.getAddress()]);
      expect(at).to.be.gt(0n);
      // The delay is governed, within 1 to 30 days, by the admin only.
      await expect(deed.connect(alice).setValidatorReassignDelay(2 * DAY)).to.be.reverted;
      await expect(deed.connect(deployer).setValidatorReassignDelay(DAY - 1)).to.be.revertedWithCustomError(deed, "ReassignDelayOutOfRange");
      await expect(deed.connect(deployer).setValidatorReassignDelay(31 * DAY)).to.be.revertedWithCustomError(deed, "ReassignDelayOutOfRange");
      await deed.connect(deployer).setValidatorReassignDelay(2 * DAY);
      expect(await deed.validatorReassignDelay()).to.equal(BigInt(2 * DAY));
    });

    it("a legacy (non-trust) deed still changes validator at once", async function () {
      const { deed, alice } = ctx;
      const id = await mintValidatedVehicle(ctx, alice);
      await v2.setAssetTypeSupport(1, true);
      await deed.connect(alice).reassignValidator(id, await v2.getAddress());
      expect((await deed.getValidationStatus(id))[1]).to.equal(await v2.getAddress());
    });

    it("un-void takes the validator and the protector: neither alone, and never the trustee", async function () {
      const { deed, trust, alice, bob, deployer, trustee, mallory } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      await trust.connect(deployer).markVoid(id, 128, k("order"), "ipfs://order");
      await expect(trust.connect(deployer).restoreFromVoid(id, "ipfs://vacated", "0x"))
        .to.be.revertedWithCustomError(trust, "ConsentMissing");
      await expect(trust.connect(trustee).restoreFromVoid(id, "ipfs://vacated", "0x"))
        .to.be.revertedWithCustomError(trust, "FreezeNeedsValidator");
      await expect(trust.connect(alice).restoreFromVoid(id, "ipfs://vacated", "0x"))
        .to.be.revertedWithCustomError(trust, "FreezeNeedsValidator");
      // A consent signed by someone other than the protector (here the holder) does not count.
      const nonce = (await trust.trustRecordOf(id)).nonce;
      const forged = await signTrust(ctx, mallory, "RestoreConsent", { tokenId: id, reasonHash: k("ipfs://vacated"), nonce });
      await expect(trust.connect(deployer).restoreFromVoid(id, "ipfs://vacated", forged))
        .to.be.revertedWithCustomError(trust, "ConsentMissing");
      const consent = await signTrust(ctx, alice, "RestoreConsent", { tokenId: id, reasonHash: k("ipfs://vacated"), nonce });
      await expect(trust.connect(deployer).restoreFromVoid(id, "ipfs://vacated", consent))
        .to.emit(trust, "DeedRestored").withArgs(id, deployer.address, "ipfs://vacated");
      expect(await trust.statusOf(id)).to.equal(0);
      await deed.connect(alice).transferFrom(alice.address, bob.address, id);
      // The consent was used up (the nonce moved on).
      await expect(trust.connect(deployer).restoreFromVoid(id, "ipfs://vacated", consent))
        .to.be.revertedWithCustomError(trust, "NotVoid");
    });

    it("the protector may also consent by a prior approval", async function () {
      const { trust, alice, deployer } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      await trust.connect(deployer).markVoid(id, 1, k("sale"), "");
      await trust.connect(alice).approveTrustAction(await trust.restoreConsentDigest(id, "ipfs://redeemed"));
      await trust.connect(deployer).restoreFromVoid(id, "ipfs://redeemed", "0x");
      expect(await trust.statusOf(id)).to.equal(0);
    });
  });

  describe("M-G: the standby is promoted on its own determination only with the protector's consent", function () {
    let ctx: Ctx;
    beforeEach(async function () {
      ctx = await deployDeedTrack();
    });

    async function withStandby(protector?: any) {
      const { trust, alice, standby } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      if (protector) await trust.connect(alice).setProtector(id, protector.address);
      const nonce = (await trust.trustRecordOf(id)).nonce;
      await trust.connect(protector ?? alice).setStandbyTrustee(id, standby.address,
        await signTrust(ctx, standby, "StandbyAcceptance", { tokenId: id, standby: standby.address, nonce }));
      return id;
    }

    it("without consent the standby's call posts the determination and changes nothing else", async function () {
      const { trust, standby, trustee, alice } = ctx;
      const id = await withStandby();
      const tx = trust.connect(standby).applyLicensingDetermination(id, k("doc"), "ipfs://det", "0x");
      await expect(tx).to.emit(trust, "NoticePosted").withArgs(id, standby.address, k("doc"), "ipfs://det", trustee.address, alice.address);
      await expect(tx).not.to.emit(trust, "StandbyPromoted");
      await expect(tx).not.to.emit(trust, "TrusteeSuspended");
      const r = await trust.trustRecordOf(id);
      expect(r.trustee).to.equal(trustee.address);
      expect(r.standbyTrustee).to.equal(standby.address);
      expect(r.trusteeSuspended).to.equal(false);
    });

    it("with the recorded protector's consent the standby is promoted; the holder's consent is then not enough", async function () {
      const { trust, standby, trustee, alice, sponsor } = ctx;
      const id = await withStandby(sponsor);
      const nonce = (await trust.trustRecordOf(id)).nonce;
      const byHolder = await signTrust(ctx, alice, "LicensingConsent", { tokenId: id, standby: standby.address, docHash: k("doc"), nonce });
      await expect(trust.connect(standby).applyLicensingDetermination(id, k("doc"), "", byHolder))
        .to.be.revertedWithCustomError(trust, "ConsentMissing");
      // Consent is to this determination: a signature over another document does not carry over.
      const otherDoc = await signTrust(ctx, sponsor, "LicensingConsent", { tokenId: id, standby: standby.address, docHash: k("other"), nonce });
      await expect(trust.connect(standby).applyLicensingDetermination(id, k("doc"), "", otherDoc))
        .to.be.revertedWithCustomError(trust, "ConsentMissing");
      const consent = await signTrust(ctx, sponsor, "LicensingConsent", { tokenId: id, standby: standby.address, docHash: k("doc"), nonce });
      await expect(trust.connect(standby).applyLicensingDetermination(id, k("doc"), "", consent))
        .to.emit(trust, "StandbyPromoted").withArgs(id, trustee.address, standby.address);
      expect((await trust.trustRecordOf(id)).trustee).to.equal(standby.address);
    });

    it("the protector's and the trustee's own calls are unchanged", async function () {
      const { trust, standby, trustee } = ctx;
      const id = await withStandby();
      await expect(trust.connect(trustee).applyLicensingDetermination(id, k("doc"), "", "0x"))
        .to.emit(trust, "StandbyPromoted").withArgs(id, trustee.address, standby.address);
      const id2 = await withStandby();
      await expect(trust.connect(ctx.alice).applyLicensingDetermination(id2, k("doc"), "", "0x"))
        .to.emit(trust, "StandbyPromoted");
    });
  });

  describe("L-B: a Savings draw refreshes the CLRUSD lock, and fails closed", function () {
    it("a plain transfer that draws on Savings records the new lock at once", async function () {
      const { ctx, issuer, clrusd, save, openLine, spend } = await savingsStack();
      await issuer.connect(ctx.admin).setClrusdToken(await clrusd.getAddress());
      await save(1_000n * ONE_USDC);
      await openLine(1_000n * ONE_USDC, 0n);
      expect(await clrusd.lastKnownLockOf(ctx.member.address)).to.equal(0n);
      await spend(600n * ONE_USDC);
      expect(await clrusd.lastKnownLockOf(ctx.member.address)).to.equal(600n * ONE_USDC);
    });

    it("a card settlement that draws on Savings records the new lock", async function () {
      const { ctx, issuer, clrusd, save, openLine, settler, float } = await savingsStack();
      await issuer.connect(ctx.admin).setClrusdToken(await clrusd.getAddress());
      await issuer.connect(ctx.operator).setCardSettler(settler.address, true);
      await issuer.connect(ctx.operator).setCardSettlementAccount(float.address);
      await save(1_000n * ONE_USDC);
      await openLine(1_000n * ONE_USDC, 0n);
      await issuer.connect(ctx.member).setSavingsDrawAllowance(300n * ONE_USDC);
      await issuer.connect(settler).authorizeCardSpend(ethers.id("c1"), ctx.member.address, 250n * ONE_USDC);
      await issuer.connect(settler).settleCardSpend(ethers.id("c1"), ctx.member.address, 250n * ONE_USDC);
      expect(await clrusd.lastKnownLockOf(ctx.member.address)).to.equal(250n * ONE_USDC);
    });

    it("if the lock cannot be read the draw reverts, rather than leave the record stale", async function () {
      const { ctx, issuer, save, openLine, spend } = await savingsStack();
      // A CLRUSD whose encumbrance source is down.
      const source: any = await (await ethers.getContractFactory("MockCollateralSignals")).deploy();
      const other: any = await upgrades.deployProxy(await ethers.getContractFactory("ClearUSDUpgradeable"),
        ["Clear USD", "CLRUSD", 6, 0, 0, ctx.admin.address, ctx.admin.address],
        { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
      await other.setEncumbranceSource(await source.getAddress());
      await issuer.connect(ctx.admin).setClrusdToken(await other.getAddress());
      await save(1_000n * ONE_USDC);
      await openLine(1_000n * ONE_USDC, 0n);
      await source.setBroken(true);
      await expect(spend(100n * ONE_USDC)).to.be.reverted;
      await source.setBroken(false);
      await source.setLock(ctx.member.address, 7n);
      await spend(100n * ONE_USDC);
      expect(await other.lastKnownLockOf(ctx.member.address)).to.equal(7n);
    });

    it("the CLRUSD token is the owner's to set, once", async function () {
      const { ctx, issuer, clrusd } = await savingsStack();
      await expect(issuer.connect(ctx.operator).setClrusdToken(await clrusd.getAddress())).to.be.reverted;
      await expect(issuer.connect(ctx.admin).setClrusdToken(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(issuer, "RevolvingIssuerClrusdSet");
      await issuer.connect(ctx.admin).setClrusdToken(await clrusd.getAddress());
      expect(await issuer.clrusdTokenOf()).to.equal(await clrusd.getAddress());
      await expect(issuer.connect(ctx.admin).setClrusdToken(ctx.admin.address))
        .to.be.revertedWithCustomError(issuer, "RevolvingIssuerClrusdSet");
    });
  });

  describe("L-C: the card caps are governed parameters (documentation item)", function () {
    it("only the credit settings role sets the per-purchase and daily caps, and settlement honours them", async function () {
      const { ctx, issuer, save, openLine, settler, float, stranger } = await savingsStack();
      await issuer.connect(ctx.operator).setCardSettler(settler.address, true);
      await issuer.connect(ctx.operator).setCardSettlementAccount(float.address);
      await expect(issuer.connect(stranger).setCardCaps(1n, 1n)).to.be.reverted;
      await expect(issuer.connect(settler).setCardCaps(1n, 1n)).to.be.reverted;
      await issuer.connect(ctx.operator).setCardCaps(50n * ONE_USDC, 60n * ONE_USDC);
      await save(1_000n * ONE_USDC);
      await openLine(500n * ONE_USDC, 0n);
      await issuer.connect(ctx.member).setSavingsDrawAllowance(ethers.MaxUint256);
      await expect(issuer.connect(settler).authorizeCardSpend(ethers.id("big"), ctx.member.address, 51n * ONE_USDC))
        .to.be.revertedWithCustomError(issuer, "RevolvingIssuerCardTxCap");
      for (const ref of ["a", "b"]) {
        await issuer.connect(settler).authorizeCardSpend(ethers.id(ref), ctx.member.address, 40n * ONE_USDC);
      }
      await issuer.connect(settler).settleCardSpend(ethers.id("a"), ctx.member.address, 40n * ONE_USDC);
      await expect(issuer.connect(settler).settleCardSpend(ethers.id("b"), ctx.member.address, 40n * ONE_USDC))
        .to.be.revertedWithCustomError(issuer, "CreditIssuerDailyCapExceeded");
    });
  });

  describe("L-F: the Clear Cash large-loan term is judged on the member's open Clear Cash principal", function () {
    it("two $2,400 plans cannot both run under 365 days; the second needs the 13-cycle term", async function () {
      const core = await pricedCredit();
      const { term, ctx, member2 } = core;
      await openPriced(core, ctx.member, 2_400n * ONE_USDC, 6, P("CASH"));
      await expect(openPriced(core, ctx.member, 2_400n * ONE_USDC, 6, P("CASH")))
        .to.be.revertedWithCustomError(term, "TermIssuerTermTooShort");
      await expect(openPriced(core, ctx.member, 2_400n * ONE_USDC, 13, P("CASH"))).to.emit(term, "PlanOpened");
      // Another product's principal does not count, and another member is judged on their own.
      await openPriced(core, member2, 2_400n * ONE_USDC, 6, P("CASH"));
      await openPriced(core, ctx.member, 2_400n * ONE_USDC, 6, P("PARTNER"));
    });

    it("a re-split is judged with the member's other open Clear Cash, not its own principal twice", async function () {
      const core = await pricedCredit();
      const { term, ctx } = core;
      await openPriced(core, ctx.member, 1_000n * ONE_USDC, 12, P("CASH"));
      await openPriced(core, ctx.member, 1_200n * ONE_USDC, 12, P("CASH"));
      // $2,200 open: the member may still shorten their own plan.
      await term.connect(ctx.member).setSplit(0, 6);
      await expect(openPriced(core, ctx.member, 400n * ONE_USDC, 12, P("CASH")))
        .to.be.revertedWithCustomError(term, "TermIssuerTermTooShort");
      await openPriced(core, ctx.member, 400n * ONE_USDC, 13, P("CASH"));
      // $2,600 open: shortening any of them is now a large loan's term, too short.
      await expect(term.connect(ctx.member).setSplit(1, 6)).to.be.revertedWithCustomError(term, "TermIssuerTermTooShort");
    });

    it("with CFL aggregation off (DECISIONS #7), the rule is judged per plan, like the cap", async function () {
      const core = await pricedCredit();
      const { term, ctx, rates } = core;
      await rates.setCflAggregation(false);
      await openPriced(core, ctx.member, 2_400n * ONE_USDC, 6, P("CASH"));
      await expect(openPriced(core, ctx.member, 2_400n * ONE_USDC, 6, P("CASH"))).to.emit(term, "PlanOpened");
    });
  });

  describe("L-G: most-expensive-first by the effective rate after caps, across both issuers", function () {
    it("a capped Boost tier is cheaper than Income, so Income is repaid first", async function () {
      const core = await pricedCredit();
      const { ctx, revolving, merchant } = core;
      const m = ctx.member.address;
      await revolving.connect(ctx.operator).openLine(m, [0n, 0n, 1_000n * ONE_USDC, 2_000n * ONE_USDC], 365 * DAY, CYCLE);
      await ctx.stableCredit.connect(ctx.member).transfer(merchant.address, 3_000n * ONE_USDC);
      // On $3,000 the ceiling allows 146.25 bps; at list (150 on $1,000 and 300 on $2,000) the excess
      // is trimmed from Boost first, leaving it at 144.375 bps against Income's 150.
      const [rate, has] = await revolving.nextRepaymentRate(m);
      expect(has).to.equal(true);
      expect(rate).to.equal(150n * RATE_SCALE);
      const boostBefore = await revolving.principalOnlyOf(m, 3);
      await ctx.stableCredit.connect(ctx.member).repayCreditBalance(m, 100n * ONE_USDC);
      expect(await revolving.principalOnlyOf(m, 3)).to.equal(boostBefore);
      expect(await revolving.principalOnlyOf(m, 2)).to.be.lt(1_000n * ONE_USDC);
    });

    it("across issuers: a term plan whose cap has come down is repaid after the dearer revolving tier", async function () {
      const core = await pricedCredit();
      const { ctx, revolving, term, merchant } = core;
      const m = ctx.member.address;
      await revolving.connect(ctx.operator).openLine(m, [0n, 0n, 1_000n * ONE_USDC, 2_000n * ONE_USDC], 365 * DAY, CYCLE);
      await ctx.stableCredit.connect(ctx.member).transfer(merchant.address, 3_000n * ONE_USDC);
      // A $500 partner plan, signed at 200 bps (its own cap on $500 is 222.5). On the member's
      // $3,500 aggregate it costs 139.64 bps per 30 days now: less than Income's 150, though its
      // configured rate (200) is higher. Boost, trimmed, is the cheapest.
      await openPriced(core, ctx.member, 500n * ONE_USDC, 12, P("PARTNER"));
      expect((await term.planAt(0)).ratePerCycle).to.equal(200n);
      const planBefore = (await term.planAt(0)).principalOutstanding;
      const boostBefore = await revolving.principalOnlyOf(m, 3);
      // Enough to clear Income and reach the next band.
      await ctx.stableCredit.connect(ctx.member).repayCreditBalance(m, 1_050n * ONE_USDC);
      expect(await revolving.principalOf(m, 2)).to.equal(0n);
      expect((await term.planAt(0)).principalOutstanding).to.be.lt(planBefore);
      expect(await revolving.principalOnlyOf(m, 3)).to.equal(boostBefore);
    });
  });

  describe("L-I: a pledge needs the member's signature", function () {
    async function registryStack() {
      const ctx = await deployPhase0Network();
      const registry: any = await upgrades.deployProxy(await ethers.getContractFactory("CollateralRegistry"),
        [ctx.admin.address, await ctx.networkRegistry.getAddress()], { kind: "uups" });
      await registry.registerCollateralType(SAVINGS, SAVINGS_BACKED, 10_000n, 10n ** 18n);
      await registry.registerCollateralType(POOL_SHARE, SAVINGS_BACKED, 9_500n, 10n ** 18n);
      await registry.grantRole(await registry.OPERATOR_ROLE(), ctx.operator.address);
      return { ctx, registry: registry.connect(ctx.operator) };
    }

    it("the operator cannot pledge a member's assets on its own", async function () {
      const { ctx, registry } = await registryStack();
      const m = ctx.member.address;
      // No signature, or the operator's own, or another member's.
      const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 3600n;
      await expect(registry.pledge(m, POOL_SHARE, 1_000n, deadline, "0x")).to.be.reverted;
      const byOperator = await signPledge(registry, ctx.operator, POOL_SHARE, 1_000n);
      await expect(registry.pledge(m, POOL_SHARE, 1_000n, byOperator.deadline, byOperator.signature))
        .to.be.revertedWithCustomError(registry, "CollateralRegistryBadSignature");
      // The member's signature over a different amount does not authorize this one.
      const smaller = await signPledge(registry, ctx.member, POOL_SHARE, 10n);
      await expect(registry.pledge(m, POOL_SHARE, 1_000n, smaller.deadline, smaller.signature))
        .to.be.revertedWithCustomError(registry, "CollateralRegistryBadSignature");
      expect(await registry.pledgedOf(m, POOL_SHARE)).to.equal(0n);
    });

    it("the member's signature, submitted by the operator, pledges once; it cannot be replayed or used late", async function () {
      const { ctx, registry } = await registryStack();
      const m = ctx.member.address;
      const signed = await signPledge(registry, ctx.member, POOL_SHARE, 1_000n);
      await expect(registry.pledge(m, POOL_SHARE, 1_000n, signed.deadline, signed.signature))
        .to.emit(registry, "Pledged").withArgs(m, POOL_SHARE, 1_000n);
      expect(await registry.pledgeNonces(m)).to.equal(1n);
      await expect(registry.pledge(m, POOL_SHARE, 1_000n, signed.deadline, signed.signature))
        .to.be.revertedWithCustomError(registry, "CollateralRegistryBadSignature");
      const late = await signPledge(registry, ctx.member, POOL_SHARE, 5n);
      await advance(3601);
      await expect(registry.pledge(m, POOL_SHARE, 5n, late.deadline, late.signature))
        .to.be.revertedWithCustomError(registry, "CollateralRegistrySignatureExpired");
      // Not an operator: the member's signature is not enough on its own either.
      const direct = await signPledge(registry, ctx.member, POOL_SHARE, 5n);
      await expect(registry.connect(ctx.outsider).pledge(m, POOL_SHARE, 5n, direct.deadline, direct.signature)).to.be.reverted;
    });

    it("an item pledge is signed the same way", async function () {
      const { ctx, registry } = await registryStack();
      const m = ctx.member.address;
      const BOND = ethers.encodeBytes32String("BOND");
      await registry.connect(ctx.admin).registerCollateralType(BOND, SAVINGS_BACKED, 9_000n, 10n ** 18n);
      const bad = await signPledgeItem(registry, ctx.member, BOND, 8n);
      await expect(registry.pledgeItem(m, BOND, 7n, bad.deadline, bad.signature))
        .to.be.revertedWithCustomError(registry, "CollateralRegistryBadSignature");
      const ok = await signPledgeItem(registry, ctx.member, BOND, 7n);
      await expect(registry.pledgeItem(m, BOND, 7n, ok.deadline, ok.signature))
        .to.emit(registry, "ItemPledged").withArgs(m, BOND, 7n);
    });
  });

  describe("O-1: a priced tier keeps the member's last state's product until the new state's launches", function () {
    async function revolvingStack() {
      const ctx = await deployPhase0Network();
      const coop = (await ethers.getSigners())[8];
      const revolving: any = await upgrades.deployProxy(await ethers.getContractFactory("RevolvingIssuer"),
        [await ctx.stableCredit.getAddress(), coop.address], { ...(await issuerProxyOptions("RevolvingIssuer")), kind: "uups" });
      await ctx.networkRegistry.registerIssuer(await revolving.getAddress(), await ctx.stableCredit.getAddress());
      await ctx.access.grantOperator(await revolving.getAddress());
      // The tier's own (local) rate is 300; CA prices it at 100.
      await revolving.connect(ctx.operator).addTier(ethers.encodeBytes32String("SAVINGS"), 0n, CYCLE);
      await revolving.connect(ctx.operator).addTier(INCOME, 300n, CYCLE);
      const rates = await deployRateSchedule(ctx.admin.address);
      await rates.setProduct(CA, INCOME, params({ listMonthlyBps: 100 }), CA_BANDS);
      await rates.setProduct(CA, P("REVOLVING"), params({ largeLoanThreshold: 0n }), CA_BANDS);
      await revolving.connect(ctx.operator).setPricing(await rates.getAddress(), P("REVOLVING"));
      await revolving.connect(ctx.operator).setTierProduct(1, INCOME);
      await ctx.networkRegistry.grantRole(await ctx.networkRegistry.STATE_ATTESTER_ROLE(), ctx.admin.address);
      await ctx.networkRegistry.attestStateCode(ctx.member.address, CA);
      await ctx.usdc.mint(ctx.member.address, 10_000n * ONE_USDC);
      await ctx.usdc.connect(ctx.member).approve(await ctx.stableCredit.getAddress(), ethers.MaxUint256);
      return { ctx, revolving, rates };
    }

    async function carryOver(revolving: any, member: string, seconds: number) {
      await revolving.materialiseCarry(member);
      const before = await revolving.carryOf(member, 1);
      await advance(seconds);
      await revolving.materialiseCarry(member);
      return (await revolving.carryOf(member, 1)) - before;
    }

    it("re-attested to a state with no product yet, the member stays on CA's price, never the tier's own rate", async function () {
      const { ctx, revolving, rates } = await revolvingStack();
      const m = ctx.member.address;
      await revolving.connect(ctx.operator).openLine(m, [0n, 1_000n * ONE_USDC], 365 * DAY, CYCLE);
      await ctx.stableCredit.connect(ctx.member).transfer(ctx.counterparty.address, 1_000n * ONE_USDC);
      const inCa = await carryOver(revolving, m, CYCLE);
      await ctx.networkRegistry.attestStateCode(m, NY);
      const movedBeforeLaunch = await carryOver(revolving, m, CYCLE);
      // 100 bps a month on $1,000 for 30 days is about $9.86; the local 300 would be about $29.59.
      expect(movedBeforeLaunch).to.be.closeTo(inCa, 20_000n);
      expect(movedBeforeLaunch).to.be.lt(10_000_000n);

      // NY launches its products: from the next touch the member is priced in NY.
      await rates.setProduct(NY, INCOME, params({ listMonthlyBps: 120 }), CA_BANDS);
      await rates.setProduct(NY, P("REVOLVING"), params({ largeLoanThreshold: 0n }), CA_BANDS);
      await revolving.materialiseCarry(m);
      const inNy = await carryOver(revolving, m, CYCLE);
      expect(inNy).to.be.gt(movedBeforeLaunch);
      expect(inNy).to.be.closeTo((inCa * 120n) / 100n, 30_000n);
    });
  });
});
