import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployCore, advance, ONE_USDC, DAY, CYCLE } from "../deep/deep-setup";
import { signedOpenPlan } from "../../helpers/plans";
import {
  deployDeedTrack, mintValidatedLand, mintValidatedVehicle, signTrust, signFreeze, addValidatorSigner, freeze, k, Ctx,
} from "../deed/fixture";

/*
 * Phase 4c: the owner's decisions on Phase 4b's open questions (`docs/audit/PHASE-4B-OPEN-DECISIONS.md`),
 * items 4, 5 and 9. One describe per item, each named for it.
 */

describe("PHASE 4c: the owner's decisions on Phase 4b's open questions", function () {
  describe("item 4: a freeze takes two distinct signers of the deed's validator", function () {
    let ctx: Ctx;
    beforeEach(async function () {
      ctx = await deployDeedTrack();
      // operator2 becomes the validator's second signer; the deployer is its first.
      await addValidatorSigner(ctx, ctx.operator2);
    });

    it("one signer cannot freeze: not alone, not with itself, a non-signer or the trustee as the second", async function () {
      const { trust, validator, alice, deployer, operator2, trustee, mallory } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      const ref = k("order");
      // No second signer.
      await expect(trust.connect(deployer).markVoid(id, 128, ref, "ipfs://order", ethers.ZeroAddress, "0x"))
        .to.be.revertedWithCustomError(trust, "FreezeNeedsSecondSigner").withArgs(ethers.ZeroAddress);
      // The caller as its own second signer.
      const self = await signFreeze(ctx, deployer, id, 128, ref, "ipfs://order");
      await expect(trust.connect(deployer).markVoid(id, 128, ref, "ipfs://order", deployer.address, self))
        .to.be.revertedWithCustomError(trust, "FreezeNeedsSecondSigner").withArgs(deployer.address);
      // Someone who is not a signer of the deed's validator.
      const outsider = await signFreeze(ctx, mallory, id, 128, ref, "ipfs://order");
      await expect(trust.connect(deployer).markVoid(id, 128, ref, "ipfs://order", mallory.address, outsider))
        .to.be.revertedWithCustomError(trust, "FreezeNeedsSecondSigner").withArgs(mallory.address);
      // The trustee, even when it is also a signer of the validator (Addendum 1: it never freezes).
      await validator.grantRole(await validator.VALIDATOR_ROLE(), trustee.address);
      const byTrustee = await signFreeze(ctx, trustee, id, 128, ref, "ipfs://order");
      await expect(trust.connect(deployer).markVoid(id, 128, ref, "ipfs://order", trustee.address, byTrustee))
        .to.be.revertedWithCustomError(trust, "FreezeNeedsSecondSigner").withArgs(trustee.address);
      await expect(trust.connect(trustee).markVoid(id, 128, ref, "ipfs://order", operator2.address,
        await signFreeze(ctx, operator2, id, 128, ref, "ipfs://order")))
        .to.be.revertedWithCustomError(trust, "FreezeNeedsValidator");
      // A signature that is not the named second signer's.
      const forged = await signFreeze(ctx, mallory, id, 128, ref, "ipfs://order");
      await expect(trust.connect(deployer).markVoid(id, 128, ref, "ipfs://order", operator2.address, forged))
        .to.be.revertedWithCustomError(trust, "ConsentMissing").withArgs(operator2.address);
      expect(await trust.statusOf(id)).to.equal(0);
    });

    it("the consent is bound to the reason code, the recording, the URI and the nonce, and used once", async function () {
      const { deed, trust, alice, bob, deployer, operator2 } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      const ref = k("order");
      const consent = await signFreeze(ctx, operator2, id, 128, ref, "ipfs://order");
      for (const [code, r, uri] of [[129, ref, "ipfs://order"], [128, k("other"), "ipfs://order"], [128, ref, "ipfs://other"]] as const) {
        await expect(trust.connect(deployer).markVoid(id, code, r, uri, operator2.address, consent))
          .to.be.revertedWithCustomError(trust, "ConsentMissing");
      }
      const nonce = (await trust.trustRecordOf(id)).nonce;
      await expect(trust.connect(deployer).markVoid(id, 128, ref, "ipfs://order", operator2.address, consent))
        .to.emit(trust, "DeedFreezeConfirmed").withArgs(id, operator2.address, deployer.address)
        .and.to.emit(trust, "DeedVoided").withArgs(id, 128, ref, "ipfs://order", false);
      expect((await trust.trustRecordOf(id)).nonce).to.equal(nonce + 1n);
      await expect(deed.connect(alice).transferFrom(alice.address, bob.address, id)).to.be.revertedWithCustomError(trust, "DeedFrozen");

      // Lifted (two parties, as before), the old consent cannot freeze it again: the nonce moved on.
      const restore = await signTrust(ctx, alice, "RestoreConsent", {
        tokenId: id, reasonHash: k("ipfs://vacated"), nonce: (await trust.trustRecordOf(id)).nonce });
      await trust.connect(deployer).restoreFromVoid(id, "ipfs://vacated", restore);
      await expect(trust.connect(deployer).markVoid(id, 128, ref, "ipfs://order", operator2.address, consent))
        .to.be.revertedWithCustomError(trust, "ConsentMissing");
      expect(await trust.statusOf(id)).to.equal(0);
    });

    it("the second signer may propose by a prior approval; the other confirms; either may be the proposer", async function () {
      const { trust, alice, deployer, operator2 } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      const ref = k("forfeiture");
      const digest = await trust.freezeConsentDigest(id, 200, ref, "ipfs://forfeiture");
      // The digest is the EIP-712 digest a signer would sign.
      const domain = { name: "DeedNFT Trust", version: "5", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await ctx.deed.getAddress() };
      const types = { FreezeConsent: [
        { name: "tokenId", type: "uint256" }, { name: "reasonCode", type: "uint8" },
        { name: "recordingRefHash", type: "bytes32" }, { name: "uriHash", type: "bytes32" }, { name: "nonce", type: "uint256" }] };
      expect(digest).to.equal(ethers.TypedDataEncoder.hash(domain, types,
        { tokenId: id, reasonCode: 200, recordingRefHash: ref, uriHash: k("ipfs://forfeiture"), nonce: (await trust.trustRecordOf(id)).nonce }));

      // Here the deployer proposes and operator2 confirms.
      await trust.connect(deployer).approveTrustAction(digest);
      // An approval by the confirmer itself does not count.
      await trust.connect(operator2).approveTrustAction(digest);
      await expect(trust.connect(deployer).markVoid(id, 200, ref, "ipfs://forfeiture", deployer.address, "0x"))
        .to.be.revertedWithCustomError(trust, "FreezeNeedsSecondSigner");
      await expect(trust.connect(operator2).markVoid(id, 200, ref, "ipfs://forfeiture", deployer.address, "0x"))
        .to.emit(trust, "DeedFreezeConfirmed").withArgs(id, deployer.address, operator2.address);
      expect(await trust.statusOf(id)).to.equal(2);
    });

    it("a proposer who stops being a signer of the deed's validator no longer counts", async function () {
      const { trust, validator, alice, deployer, operator2 } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      await trust.connect(operator2).approveTrustAction(await trust.freezeConsentDigest(id, 128, k("order"), ""));
      await validator.revokeRole(await validator.VALIDATOR_ROLE(), operator2.address);
      await expect(trust.connect(deployer).markVoid(id, 128, k("order"), "", operator2.address, "0x"))
        .to.be.revertedWithCustomError(trust, "FreezeNeedsSecondSigner").withArgs(operator2.address);
    });

    it("a void that does not freeze still takes one validator signer or the trustee, and ignores a second signer", async function () {
      const { deed, trust, alice, bob, deployer, trustee, mallory } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      await expect(trust.connect(deployer).markVoid(id, 127, k("sale"), "", mallory.address, "0xdead"))
        .to.emit(trust, "DeedVoided").withArgs(id, 127, k("sale"), "", true)
        .and.not.to.emit(trust, "DeedFreezeConfirmed");
      await deed.connect(alice).transferFrom(alice.address, bob.address, id);
      const id2 = await mintValidatedLand(ctx, alice);
      await trust.connect(trustee).markVoid(id2, 1, k("sale2"), "", ethers.ZeroAddress, "0x");
      expect(await trust.statusOf(id2)).to.equal(2);
    });

    it("the M-F protection holds: during the reassignment delay the old validator's two signers may still freeze", async function () {
      const { deed, trust, alice } = ctx;
      const V = await ethers.getContractFactory("Validator", ctx.mallory);
      const friendly: any = await upgrades.deployProxy(V, ["https://f/", "https://f/oa/"], { kind: "uups" });
      await friendly.setDeedNFT(await deed.getAddress());
      await friendly.setAssetTypeSupport(0, true);
      await ctx.registry.registerValidator(await friendly.getAddress(), "Friendly", "", [0]);
      await ctx.registry.updateValidatorStatus(await friendly.getAddress(), true);
      const id = await mintValidatedLand(ctx, alice);
      await deed.connect(alice).reassignValidator(id, await friendly.getAddress());
      await freeze(ctx, id);
      expect(await trust.statusOf(id)).to.equal(2);
    });
  });

  describe("item 5: a transfer cancels a pending validator change; the new holder decides", function () {
    let ctx: Ctx;
    let v2: any;
    beforeEach(async function () {
      ctx = await deployDeedTrack();
      const V = await ethers.getContractFactory("Validator", ctx.operator2);
      v2 = await upgrades.deployProxy(V, ["https://other/", "https://other/oa/"], { kind: "uups" });
      await v2.setDeedNFT(await ctx.deed.getAddress());
      await v2.setAssetTypeSupport(0, true);
      await v2.setAssetTypeSupport(1, true);
      await ctx.registry.registerValidator(await v2.getAddress(), "Other Validator", "", [0, 1]);
      await ctx.registry.updateValidatorStatus(await v2.getAddress(), true);
    });

    it("the previous holder's request lapses on transfer; the new holder cannot complete it but may make its own", async function () {
      const { deed, alice, bob } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      const v1 = await ctx.validator.getAddress();
      await deed.connect(alice).reassignValidator(id, await v2.getAddress());
      await expect(deed.connect(alice).transferFrom(alice.address, bob.address, id))
        .to.emit(deed, "ValidatorReassignmentCancelled").withArgs(id, await v2.getAddress());
      expect(await deed.pendingValidatorOf(id)).to.deep.equal([ethers.ZeroAddress, 0n]);
      await advance(7 * DAY);
      await expect(deed.connect(bob).completeValidatorReassignment(id)).to.be.revertedWithCustomError(deed, "NoReassignmentPending");
      await expect(deed.connect(alice).completeValidatorReassignment(id)).to.be.revertedWith("Not deed owner");
      expect((await deed.getValidationStatus(id))[1]).to.equal(v1);

      // The new holder decides, and waits out the delay like anyone else.
      await deed.connect(bob).reassignValidator(id, await v2.getAddress());
      await expect(deed.connect(bob).completeValidatorReassignment(id)).to.be.revertedWithCustomError(deed, "ReassignmentNotDue");
      await advance(7 * DAY);
      await deed.connect(bob).completeValidatorReassignment(id);
      expect((await deed.getValidationStatus(id))[1]).to.equal(await v2.getAddress());
    });

    it("a return to the sender and a deposit into a Functional Contract cancel it too; a burn clears it", async function () {
      const { deed, subdivide, alice, bob } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      await deed.connect(alice).transferFrom(alice.address, bob.address, id);
      await deed.connect(bob).reassignValidator(id, await v2.getAddress());
      // Back to where it came from (brief item 9(b)).
      await expect(deed.connect(bob).transferFrom(bob.address, alice.address, id)).to.emit(deed, "ValidatorReassignmentCancelled");
      // Into Subdivide, which takes custody.
      await deed.connect(alice).reassignValidator(id, await v2.getAddress());
      await deed.connect(alice).approve(await subdivide.getAddress(), id);
      await expect(subdivide.connect(alice).createSubdivision(id, "Tract", "", "TR", "ipfs://tr", 3, true))
        .to.emit(deed, "ValidatorReassignmentCancelled");
      expect((await deed.pendingValidatorOf(id))[0]).to.equal(ethers.ZeroAddress);

      const id2 = await mintValidatedLand(ctx, alice);
      await deed.connect(alice).reassignValidator(id2, await v2.getAddress());
      await expect(deed.connect(alice).burnAsset(id2)).to.emit(deed, "ValidatorReassignmentCancelled");
      expect((await deed.pendingValidatorOf(id2))[0]).to.equal(ethers.ZeroAddress);
    });

    it("a transfer with nothing pending emits nothing, and a legacy deed is unchanged", async function () {
      const { deed, alice, bob, carol } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      await expect(deed.connect(alice).transferFrom(alice.address, bob.address, id)).not.to.emit(deed, "ValidatorReassignmentCancelled");
      // Legacy: the change is immediate, so there is never anything pending to cancel.
      const vid = await mintValidatedVehicle(ctx, alice);
      await deed.connect(alice).reassignValidator(vid, await v2.getAddress());
      expect((await deed.getValidationStatus(vid))[1]).to.equal(await v2.getAddress());
      expect((await deed.pendingValidatorOf(vid))[0]).to.equal(ethers.ZeroAddress);
      await expect(deed.connect(alice).transferFrom(alice.address, carol.address, vid)).not.to.emit(deed, "ValidatorReassignmentCancelled");
      expect((await deed.getValidationStatus(vid))[1]).to.equal(await v2.getAddress());
    });
  });

  describe("item 9: a repayment beyond the 16th rate band is never left unattributed", function () {
    const INCOME_TIER = 2;
    const tenDollars = 10n * ONE_USDC;
    const payout = tenDollars - (tenDollars * 250n) / 10_000n; // the merchant's registered discount

    /**
     * 16 plans dearer than the Income tier (151 to 166 bps per 30 days), the Income tier at 150, and one
     * plan cheaper than it (100): 18 distinct effective rates across two issuers.
     */
    async function eighteenRates() {
      const core = await deployCore();
      const { ctx, revolving, term, merchant } = core;
      const m = ctx.member;
      await revolving.connect(ctx.operator).openLine(m.address, [0n, 0n, 1_000n * ONE_USDC, 0n], 365 * DAY, CYCLE);
      await ctx.stableCredit.connect(m).transfer(merchant.address, 100n * ONE_USDC);
      await term.connect(ctx.operator).setTermLimit(m.address, 1_000n * ONE_USDC);
      for (let i = 0; i < 16; i++) {
        await signedOpenPlan(term, ctx.operator, m.address, merchant.address, tenDollars, payout, 166 - i, CYCLE, 1, CYCLE);
      }
      await signedOpenPlan(term, ctx.operator, m.address, merchant.address, tenDollars, payout, 100, CYCLE, 1, CYCLE);
      const rates = new Set<bigint>();
      for (let i = 0; i < 17; i++) rates.add((await term.planAt(i)).ratePerCycle);
      rates.add(150n); // the Income tier (deep-setup TIERS)
      expect(rates.size).to.equal(18);
      return core;
    }

    /** What the issuers recorded as repaid in `tx`: revolving TierRepaid plus term PlanPaid. */
    async function attributed(core: any, tx: any) {
      const receipt = await tx.wait();
      let total = 0n;
      for (const log of receipt.logs) {
        for (const issuer of [core.revolving, core.term]) {
          if (log.address !== (await issuer.getAddress())) continue;
          const parsed = issuer.interface.parseLog(log);
          if (parsed?.name === "TierRepaid" || parsed?.name === "PlanPaid") total += parsed.args[parsed.name === "TierRepaid" ? 2 : 1];
        }
      }
      return total;
    }

    it("the 16 dearest bands are cleared, and the rest goes to the issuer holding the dearest remaining position", async function () {
      const core = await eighteenRates();
      const { ctx, revolving, term } = core;
      const m = ctx.member;
      let dearest = 0n;
      for (let i = 0; i < 16; i++) dearest += (await term.planAt(i)).principalOutstanding;
      const incomeBefore = await revolving.principalOf(m.address, INCOME_TIER);
      const cheapBefore = await term.planAt(16);
      // Enough for the 16 dearer plans (and the carry they accrue meanwhile), and $60 more.
      const amount = dearest + 60n * ONE_USDC;
      const tx = await ctx.stableCredit.connect(m).repayCreditBalance(m.address, amount);
      expect(await attributed(core, tx)).to.equal(amount);
      for (let i = 0; i < 16; i++) expect((await term.planAt(i)).closed).to.equal(true);
      // Past the 16th band: Income (150) is dearer than the last plan (100), so it takes the rest.
      const incomeAfter = await revolving.principalOf(m.address, INCOME_TIER);
      expect(incomeBefore - incomeAfter).to.be.closeTo(60n * ONE_USDC, 1_000n);
      expect((await term.planAt(16)).repaid).to.equal(cheapBefore.repaid);
    });

    it("paying everything off leaves no position behind the ledger's zero", async function () {
      const core = await eighteenRates();
      const { ctx, revolving, term } = core;
      const m = ctx.member;
      const owed = await ctx.stableCredit.creditBalanceOf(m.address);
      const tx = await ctx.stableCredit.connect(m).repayCreditBalance(m.address, owed);
      expect(await attributed(core, tx)).to.equal(owed);
      for (let i = 0; i < 16; i++) expect((await term.planAt(i)).closed).to.equal(true);
      expect(await revolving.principalOf(m.address, INCOME_TIER)).to.equal(0n);
      // The cheapest position is paid last. All that is left of it is the carry the repayment itself
      // materialised, which the ledger now shows too: what it says is owed is what the issuers hold.
      const cheap = (await term.planAt(16)).principalOutstanding;
      expect(cheap).to.be.lt(1_000n);
      expect(await ctx.stableCredit.creditBalanceOf(m.address)).to.equal(cheap);
    });
  });
});
