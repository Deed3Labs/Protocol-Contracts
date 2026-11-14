import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import {
  deployDeedTrack, mintTrust, mintValidatedLand, mintVehicle, trustParams, deedIdFor, signTrust,
  k, enc, dec, coder, Ctx, AGREEMENT_V5, AGREEMENT_V5_URI, KIND_CUSTODY,
} from "./fixture";

/*
 * Trust agreement v5 (specs/deed-trust-v5-brief.md, -addendum-1.md, -addendum-2.md; DECISIONS Addendum 1).
 * One test (or more) per requirement; each title names the brief item or addendum it covers.
 */
const V51 = k("trust-agreement-v5.1");
const RIDER = k("rider-lock-transfer-policy");
const PROGRAM = (ctx: Ctx, over: Record<string, any> = {}) => ({
  programId: k("program-1"),
  sponsor: ctx.sponsor.address,
  titleAdministrator: ctx.trustee.address,
  paramsHash: k("program-1-params"),
  rofrPeriodDays: 0,
  completionWindowDays: 0,
  versionConsentRequired: true,
  ...over,
});

describe("AUDIT deed: trust agreement v5", function () {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await deployDeedTrack(); });

  // ---------------------------------------------------------------- item 1
  describe("item 1: burning keeps the record", () => {
    it("burn leaves the traits readable, marks the deed Retired for good, and emits the hashes", async () => {
      const { deed, trust, alice } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      await expect(deed.connect(alice).burnAsset(id))
        .to.emit(trust, "DeedRetired")
        .withArgs(id, alice.address, ethers.keccak256(enc("Parcel 0123-456-78")), ethers.keccak256(enc(AGREEMENT_V5_URI)),
          ethers.keccak256(enc("")), AGREEMENT_V5, ethers.keccak256("0x"));
      expect(await trust.isRetired(id)).to.equal(true);
      expect(await trust.statusOf(id)).to.equal(1);
      expect(dec(await deed.getTraitValue(id, k("definition")))).to.equal("Parcel 0123-456-78");
      expect(coder.decode(["uint8"], await deed.getTraitValue(id, k("status")))[0]).to.equal(1n);
      expect((await deed.getTraitKeys(id)).length).to.be.greaterThan(10);
      // legacy deeds are retired the same way
      const vid = await mintVehicle(ctx, alice);
      await deed.connect(alice).burnAsset(vid);
      expect(await trust.isRetired(vid)).to.equal(true);
    });
  });

  // ---------------------------------------------------------------- item 2
  describe("item 2: Deed IDs are never reused; reserveId", () => {
    it("the ID commits to the agreement, riders and identity, and a reservation binds the reserver", async () => {
      const { trust, alice, bob, validator } = ctx;
      await validator.adoptAgreementVersion(0, RIDER, "ipfs://rider", "Rider");
      const p = trustParams(ctx, alice);
      const id = await deedIdFor(ctx, p);
      expect(await deedIdFor(ctx, { ...p, agreementHash: V51 })).to.not.equal(id);
      expect(await deedIdFor(ctx, { ...p, riderHashes: [RIDER] })).to.not.equal(id);
      expect(await deedIdFor(ctx, { ...p, owner: bob.address })).to.not.equal(id);
      expect(id >= 2n ** 127n && id < 2n ** 128n).to.equal(true);

      // The grantor reserves, then the minter mints that exact ID to the grantor
      await expect(trust.connect(alice).reserveId(p.assetType, k(p.definition), p.parcelRef, p.salt, p.agreementHash, []))
        .to.emit(trust, "DeedIdReserved");
      const r = await trust.reservationOf(id);
      expect(r.reserver).to.equal(alice.address);
      expect(r.agreementHash).to.equal(AGREEMENT_V5);
      await expect(trust.connect(alice).reserveId(p.assetType, k(p.definition), p.parcelRef, p.salt, p.agreementHash, []))
        .to.be.revertedWithCustomError(trust, "DeedIdUnavailable");
      // the same inputs reserved by bob give bob's own ID, never alice's
      await trust.connect(bob).reserveId(p.assetType, k(p.definition), p.parcelRef, p.salt, p.agreementHash, []);
      expect((await trust.reservationOf(id)).reserver).to.equal(alice.address);

      expect(await mintTrust(ctx, alice)).to.equal(id);
      // minted (and later burned) IDs can never be reserved or minted again
      await expect(trust.connect(alice).reserveId(p.assetType, k(p.definition), p.parcelRef, p.salt, p.agreementHash, []))
        .to.be.revertedWithCustomError(trust, "DeedIdUnavailable");
      await ctx.deed.connect(alice).burnAsset(id);
      await expect(mintTrust(ctx, alice)).to.be.revertedWithCustomError(trust, "DeedIdUnavailable");
    });

    it("mintParamsHash is stored as a trait and emitted at mint", async () => {
      const { deed, trust, alice, trustee } = ctx;
      const p = trustParams(ctx, alice, { salt: 9n });
      const id = await deedIdFor(ctx, p);
      const sig = await signTrust(ctx, trustee, "TrusteeAcceptance", { tokenId: id, trustee: trustee.address, nonce: 0 });
      const rc = await (await trust.mintTrustDeed(p, sig)).wait();
      const ev = rc.logs.map((l: any) => { try { return trust.interface.parseLog(l); } catch { return null; } })
        .find((e: any) => e?.name === "TrustDeedMinted");
      expect(coder.decode(["bytes32"], await deed.getTraitValue(id, k("mintParamsHash")))[0]).to.equal(ev.args.mintParamsHash);
      expect(ev.args.agreementHash).to.equal(AGREEMENT_V5);
    });

    it("the agreement covers Land and Estate only (DECISIONS A1 #4)", async () => {
      const { deed, trust, validator, alice } = ctx;
      await expect(mintTrust(ctx, alice, { assetType: 1 })).to.be.revertedWithCustomError(trust, "AssetTypeOutsideAgreement");
      await expect(trust.reserveId(3, ethers.ZeroHash, ethers.ZeroHash, 1, AGREEMENT_V5, []))
        .to.be.revertedWithCustomError(trust, "AssetTypeOutsideAgreement");
      await expect(validator.adoptAgreementVersion(1, V51, "ipfs://v51", "v5.1"))
        .to.be.revertedWithCustomError(validator, "AgreementOutsideAssetScope");
      // every Land/Estate deed is a trust deed: the legacy mint refuses them
      for (const t of [0, 2]) {
        await expect(deed.mintAsset(alice.address, t, "", "d", "", ethers.ZeroAddress, ethers.ZeroAddress, 0))
          .to.be.revertedWithCustomError(trust, "TrustDeedRequired");
      }
      // an Estate trust deed mints fine
      const id = await mintTrust(ctx, alice, { assetType: 2 });
      expect(await trust.isTrustDeed(id)).to.equal(true);
    });
  });

  // ---------------------------------------------------------------- item 3
  describe("item 3: who can edit metadata", () => {
    it("nobody, the validator included, rewrites a trust deed's definition, agreement or asset type through the edit paths", async () => {
      const { deed, trust, alice, deployer } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      for (const who of [alice, deployer]) {
        for (const key of ["definition", "operatingAgreement", "assetType"]) {
          await expect(deed.connect(who).setTrait(id, ethers.toUtf8Bytes(key), ethers.toUtf8Bytes("x"), 1))
            .to.be.revertedWithCustomError(trust, "DefinitionLocked");
        }
        await expect(deed.connect(who).removeTrait(id, "definition")).to.be.revertedWithCustomError(trust, "DefinitionLocked");
        await expect(deed.connect(who).updateMetadata(id, "", AGREEMENT_V5_URI, "rewrite", ""))
          .to.be.revertedWithCustomError(trust, "UseTrustPaths");
      }
      // reserved trust traits are refused on every deed, trust or legacy
      const vid = await mintVehicle(ctx, alice);
      for (const key of ["trustee", "protector", "agreementHash", "riderHashes", "transferPolicy", "status", "standbyTrustee", "trusteeSuspended", "programSponsor"]) {
        await expect(deed.connect(deployer).setTrait(id, ethers.toUtf8Bytes(key), coder.encode(["address"], [deployer.address]), 0))
          .to.be.revertedWith("Reserved trait");
        await expect(deed.connect(alice).setTrait(vid, ethers.toUtf8Bytes(key), coder.encode(["address"], [alice.address]), 0))
          .to.be.revertedWith("Reserved trait");
      }
      // only the deed's own validator gets validator powers (Phase 1, D-2), e.g. on an ordinary trait
      await deed.connect(deployer).setTrait(id, ethers.toUtf8Bytes("zoning"), ethers.toUtf8Bytes("R1"), 1);
    });

    it("a definition correction needs the trustee's proposal and the protector's countersignature (DECISIONS A1 #3)", async () => {
      const { deed, trust, alice, trustee, mallory, deployer } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      const fixed = "Parcel 0123-456-78, corrected bearing";
      const reason = "ipfs://survey-2026";
      // the protector (holder: record is zero) alone cannot correct; neither can the validator or an outsider
      for (const who of [alice, deployer, mallory]) {
        await expect(trust.connect(who).correctDefinition(id, fixed, reason, "0x")).to.be.revertedWithCustomError(trust, "NotTrustParty");
      }
      // the trustee without the protector's consent cannot either
      await expect(trust.connect(trustee).correctDefinition(id, fixed, reason, "0x"))
        .to.be.revertedWithCustomError(trust, "ConsentMissing").withArgs(alice.address);
      const nonce = (await trust.trustRecordOf(id)).nonce;
      const sig = await signTrust(ctx, alice, "CorrectionConsent", { tokenId: id, definitionHash: k(fixed), reasonHash: k(reason), nonce });
      await expect(trust.connect(trustee).correctDefinition(id, fixed, reason, sig))
        .to.emit(trust, "MetadataCorrected")
        .withArgs(id, k("definition"), ethers.keccak256(enc("Parcel 0123-456-78")), ethers.keccak256(enc(fixed)), reason);
      expect(dec(await deed.getTraitValue(id, k("definition")))).to.equal(fixed);
      expect((await deed.getValidationStatus(id))[0]).to.equal(false); // the validator re-validates
      // the signature cannot be replayed (nonce moved)
      await expect(trust.connect(trustee).correctDefinition(id, fixed, reason, sig)).to.be.revertedWithCustomError(trust, "ConsentMissing");
      // the second-call form of consent: the protector approves the digest, then the trustee calls
      const again = "Parcel 0123-456-78 (second correction)";
      await trust.connect(alice).approveTrustAction(await trust.correctionConsentDigest(id, again, reason));
      await trust.connect(trustee).correctDefinition(id, again, reason, "0x");
      expect(dec(await deed.getTraitValue(id, k("definition")))).to.equal(again);
    });

    it("a program sponsor, as protector, can never change the definition alone", async () => {
      const { trust, alice, sponsor } = ctx;
      const id = await mintTrust(ctx, alice, { program: PROGRAM(ctx), trustee: ethers.ZeroAddress });
      expect(await trust.protectorOf(id)).to.equal(sponsor.address);
      await expect(trust.connect(sponsor).correctDefinition(id, "sponsor rewrite", "ipfs://r", "0x"))
        .to.be.revertedWithCustomError(trust, "NotTrustParty");
    });
  });

  // ---------------------------------------------------------------- item 4
  describe("item 4: the agreement is pinned by hash and the holder elects the version", () => {
    it("traits hold agreementHash and riderHashes; only adopted versions; only the holder elects", async () => {
      const { deed, trust, validator, alice, bob, trustee, deployer } = ctx;
      await expect(mintTrust(ctx, alice, { agreementHash: V51 })).to.be.revertedWithCustomError(trust, "AgreementNotAdopted").withArgs(V51);
      await expect(mintTrust(ctx, alice, { riderHashes: [RIDER] })).to.be.revertedWithCustomError(trust, "AgreementNotAdopted").withArgs(RIDER);
      const id = await mintValidatedLand(ctx, alice);
      expect(coder.decode(["bytes32"], await deed.getTraitValue(id, k("agreementHash")))[0]).to.equal(AGREEMENT_V5);
      expect(coder.decode(["bytes32[]"], await deed.getTraitValue(id, k("riderHashes")))[0]).to.deep.equal([]);
      expect(dec(await deed.getTraitValue(id, k("operatingAgreement")))).to.equal(AGREEMENT_V5_URI);

      await expect(trust.connect(alice).electAgreementVersion(id, V51, [], "0x")).to.be.revertedWithCustomError(trust, "AgreementNotAdopted");
      await validator.adoptAgreementVersion(0, V51, "ipfs://trust-agreement-v5.1", "Trust Agreement v5.1");
      await validator.adoptAgreementVersion(0, RIDER, "ipfs://rider", "Rider");
      // not the holder: admin, validator, trustee, anyone else
      for (const who of [deployer, trustee, bob]) {
        await expect(trust.connect(who).electAgreementVersion(id, V51, [RIDER], "0x")).to.be.revertedWithCustomError(trust, "NotHolder");
      }
      await expect(trust.connect(alice).electAgreementVersion(id, V51, [RIDER], "0x"))
        .to.emit(trust, "AgreementVersionElected").withArgs(id, AGREEMENT_V5, V51, ethers.solidityPackedKeccak256(["bytes32"], [RIDER]));
      expect(coder.decode(["bytes32"], await deed.getTraitValue(id, k("agreementHash")))[0]).to.equal(V51);
      expect(coder.decode(["bytes32[]"], await deed.getTraitValue(id, k("riderHashes")))[0]).to.deep.equal([RIDER]);
      expect(dec(await deed.getTraitValue(id, k("operatingAgreement")))).to.equal("ipfs://trust-agreement-v5.1");
      // a revoked adoption stops new elections but never touches the deed already on it
      await validator.revokeAgreementVersion(0, AGREEMENT_V5);
      await expect(trust.connect(alice).electAgreementVersion(id, AGREEMENT_V5, [], "0x")).to.be.revertedWithCustomError(trust, "AgreementNotAdopted");
      expect((await trust.trustRecordOf(id)).agreementHash).to.equal(V51);
      // the adopted URI validates as the deed's operating agreement
      await validator.validateDeed(id);
      expect((await deed.getValidationStatus(id))[0]).to.equal(true);
    });

    it("with a protector recorded and versionConsentRequired, the protector must also consent", async () => {
      const { trust, validator, alice, sponsor } = ctx;
      await validator.adoptAgreementVersion(0, V51, "ipfs://trust-agreement-v5.1", "Trust Agreement v5.1");
      const id = await mintTrust(ctx, alice, { program: PROGRAM(ctx), trustee: ethers.ZeroAddress });
      await expect(trust.connect(alice).electAgreementVersion(id, V51, [], "0x"))
        .to.be.revertedWithCustomError(trust, "ConsentMissing").withArgs(sponsor.address);
      // the sponsor alone cannot elect
      await expect(trust.connect(sponsor).electAgreementVersion(id, V51, [], "0x")).to.be.revertedWithCustomError(trust, "NotHolder");
      const nonce = (await trust.trustRecordOf(id)).nonce;
      const sig = await signTrust(ctx, sponsor, "AgreementConsent", { tokenId: id, agreementHash: V51, ridersHash: ethers.keccak256("0x"), nonce });
      await trust.connect(alice).electAgreementVersion(id, V51, [], sig);
      expect((await trust.trustRecordOf(id)).agreementHash).to.equal(V51);

      // a program can waive consent: then the holder's election suffices
      const id2 = await mintTrust(ctx, alice, { salt: 2n, program: PROGRAM(ctx, { versionConsentRequired: false }), trustee: ethers.ZeroAddress });
      await trust.connect(alice).electAgreementVersion(id2, V51, [], "0x");
      // with no protector recorded (holder is protector) the holder's election suffices
      const id3 = await mintTrust(ctx, alice, { salt: 3n });
      expect((await trust.trustRecordOf(id3)).versionConsentRequired).to.equal(true);
      await trust.connect(alice).electAgreementVersion(id3, V51, [], "0x");
    });
  });

  // ---------------------------------------------------------------- item 8 / Addendum 1
  describe("Addendum 1: every deed has a trustee; protector", () => {
    it("mint requires an eligible trustee that accepted and is not the owner", async () => {
      const { trust, registry, validator, alice, bob, mallory, trustee, deployer } = ctx;
      // not eligible: no license, not a validator signer
      await expect(mintTrust(ctx, alice, { trustee: mallory.address }, mallory)).to.be.revertedWithCustomError(trust, "TrusteeNotEligible");
      // a validator contract itself is never eligible (funds are paid to it)
      expect(await registry.isEligibleTrustee(await validator.getAddress())).to.equal(false);
      await expect(registry.setLicensedTrustee(await validator.getAddress(), true, ethers.ZeroHash))
        .to.be.revertedWithCustomError(registry, "ValidatorCannotBeTrustee");
      // the owner cannot be its own trustee
      await registry.setLicensedTrustee(alice.address, true, ethers.ZeroHash);
      await expect(mintTrust(ctx, alice, { trustee: alice.address }, alice)).to.be.revertedWithCustomError(trust, "RoleConflict");
      // no acceptance: reverts
      const p = trustParams(ctx, bob);
      await expect(trust.mintTrustDeed(p, "0x")).to.be.revertedWithCustomError(trust, "ConsentMissing").withArgs(trustee.address);
      // a signature by someone else is not acceptance
      const id = await deedIdFor(ctx, p);
      const bad = await signTrust(ctx, mallory, "TrusteeAcceptance", { tokenId: id, trustee: trustee.address, nonce: 0 });
      await expect(trust.mintTrustDeed(p, bad)).to.be.revertedWithCustomError(trust, "ConsentMissing");
      // acceptance by a second call (approveTrustAction) works
      await trust.connect(trustee).approveTrustAction(await trust.trusteeAcceptanceDigest(id, trustee.address));
      await trust.mintTrustDeed(p, "0x");
      expect((await trust.trustRecordOf(id)).trustee).to.equal(trustee.address);
      // a signer of an active validator is eligible (DECISIONS A1 #1)
      expect(await registry.isEligibleTrustee(deployer.address)).to.equal(true);
      const id2 = await mintTrust(ctx, bob, { trustee: deployer.address, salt: 5n }, deployer);
      expect(coder.decode(["address"], await ctx.deed.getTraitValue(id2, k("trustee")))[0]).to.equal(deployer.address);
    });

    it("setTrustee: only the protector (the holder while it is zero); the new trustee is eligible, not the holder, and accepts", async () => {
      const { deed, trust, alice, bob, trustee, standby, deployer, mallory } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      expect(await trust.protectorOf(id)).to.equal(alice.address);
      for (const who of [deployer, trustee, bob]) {
        await expect(trust.connect(who).setTrustee(id, standby.address, "0x")).to.be.revertedWithCustomError(trust, "NotProtector");
      }
      await expect(trust.connect(alice).setTrustee(id, mallory.address, "0x")).to.be.revertedWithCustomError(trust, "TrusteeNotEligible");
      await expect(trust.connect(alice).setTrustee(id, standby.address, "0x")).to.be.revertedWithCustomError(trust, "ConsentMissing");
      let nonce = (await trust.trustRecordOf(id)).nonce;
      const sig = await signTrust(ctx, standby, "TrusteeAcceptance", { tokenId: id, trustee: standby.address, nonce });
      await expect(trust.connect(alice).setTrustee(id, standby.address, sig))
        .to.emit(trust, "TrusteeChanged").withArgs(id, trustee.address, standby.address);
      // the protector role passes with the token while the record is zero
      await deed.connect(alice).transferFrom(alice.address, bob.address, id);
      expect(await trust.protectorOf(id)).to.equal(bob.address);
      await expect(trust.connect(alice).setTrustee(id, trustee.address, "0x")).to.be.revertedWithCustomError(trust, "NotProtector");
      nonce = (await trust.trustRecordOf(id)).nonce;
      await trust.connect(bob).setTrustee(id, trustee.address,
        await signTrust(ctx, trustee, "TrusteeAcceptance", { tokenId: id, trustee: trustee.address, nonce }));
      // the holder can never be named trustee
      await ctx.registry.setLicensedTrustee(bob.address, true, ethers.ZeroHash);
      await expect(trust.connect(bob).setTrustee(id, bob.address, "0x")).to.be.revertedWithCustomError(trust, "RoleConflict");
    });

    it("setProtector: the protector names its successor; never the trustee; admin has no path", async () => {
      const { trust, alice, bob, carol, trustee, deployer } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      await expect(trust.connect(deployer).setProtector(id, deployer.address)).to.be.revertedWithCustomError(trust, "NotProtector");
      await expect(trust.connect(alice).setProtector(id, trustee.address)).to.be.revertedWithCustomError(trust, "RoleConflict");
      await expect(trust.connect(alice).setProtector(id, carol.address)).to.emit(trust, "ProtectorChanged").withArgs(id, alice.address, carol.address);
      await expect(trust.connect(alice).setTrustee(id, trustee.address, "0x")).to.be.revertedWithCustomError(trust, "NotProtector");
      await trust.connect(carol).setProtector(id, bob.address);
      expect(await trust.protectorOf(id)).to.equal(bob.address);
      // zero hands the role back to whoever holds the token
      await trust.connect(bob).setProtector(id, ethers.ZeroAddress);
      expect(await trust.protectorOf(id)).to.equal(alice.address);
    });

    it("program: protector is the sponsor and the trustee defaults to the title administrator", async () => {
      const { deed, trust, alice, sponsor, trustee, carol } = ctx;
      const id = await mintTrust(ctx, alice, { program: PROGRAM(ctx), trustee: ethers.ZeroAddress });
      const r = await trust.trustRecordOf(id);
      expect(r.protector).to.equal(sponsor.address);
      expect(r.trustee).to.equal(trustee.address);
      expect(r.programSponsor).to.equal(sponsor.address);
      expect(r.rofrPeriodDays).to.equal(30n);
      expect(r.completionWindowDays).to.equal(90n);
      const pp = coder.decode(["bytes32", "uint16", "uint16", "bool"], await deed.getTraitValue(id, k("programParams")));
      expect(pp[0]).to.equal(k("program-1-params"));
      await expect(mintTrust(ctx, alice, { salt: 2n, program: PROGRAM(ctx), trustee: ethers.ZeroAddress, protector: carol.address }))
        .to.be.revertedWithCustomError(trust, "ProtectorNotSponsor");
      // the sponsor can never also be the trustee
      await ctx.registry.setLicensedTrustee(ctx.sponsor.address, true, ethers.ZeroHash);
      await expect(mintTrust(ctx, alice, { salt: 3n, program: PROGRAM(ctx, { titleAdministrator: ctx.sponsor.address }), trustee: ethers.ZeroAddress }))
        .to.be.revertedWithCustomError(trust, "RoleConflict");
      // Coop needs a program (the sponsor holds the right of first refusal)
      await expect(mintTrust(ctx, alice, { salt: 4n, transferPolicy: 2 })).to.be.revertedWithCustomError(trust, "ProgramRequired");
      await expect(mintTrust(ctx, alice, { salt: 5n, transferPolicy: 3 })).to.be.revertedWithCustomError(trust, "InvalidTransferPolicy");
    });

    it("neither trustee nor protector can transfer, burn or freeze the token", async () => {
      const { deed, trust, alice, trustee, sponsor, bob } = ctx;
      const id = await mintTrust(ctx, alice, { program: PROGRAM(ctx), trustee: ethers.ZeroAddress });
      for (const who of [trustee, sponsor]) {
        await expect(deed.connect(who).transferFrom(alice.address, who.address, id)).to.be.reverted;
        await expect(deed.connect(who).burnAsset(id)).to.be.revertedWith("Not deed owner");
      }
      await expect(trust.connect(trustee).markVoid(id, 128, ethers.ZeroHash, "")).to.be.revertedWithCustomError(trust, "FreezeNeedsValidator");
      await expect(trust.connect(sponsor).markVoid(id, 1, ethers.ZeroHash, "")).to.be.revertedWithCustomError(trust, "NotTrustParty");
      await deed.connect(alice).transferFrom(alice.address, bob.address, id);
      expect(await deed.ownerOf(id)).to.equal(bob.address);
    });

    it("a transfer to the current trustee reverts; into a Functional Contract that is the trustee it suspends the trustee", async () => {
      const { deed, trust, registry, fcRegistry, alice, trustee } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      await expect(deed.connect(alice).transferFrom(alice.address, trustee.address, id)).to.be.revertedWithCustomError(trust, "TransferToTrustee");

      const fc: any = await (await ethers.getContractFactory("MockDeedCustody")).deploy();
      const fcAddr = await fc.getAddress();
      await registry.setLicensedTrustee(fcAddr, true, ethers.ZeroHash);
      await fcRegistry.register(fcAddr, KIND_CUSTODY);
      await fc.approveTrust(await deed.getAddress(), await trust.trusteeAcceptanceDigest(id, fcAddr));
      await trust.connect(alice).setTrustee(id, fcAddr, "0x");
      await expect(deed.connect(alice)["safeTransferFrom(address,address,uint256)"](alice.address, fcAddr, id))
        .to.emit(trust, "TrusteeSuspended").withArgs(id, fcAddr);
      expect((await trust.trustRecordOf(id)).trusteeSuspended).to.equal(true);
      expect(await trust.beneficialOwnerOf(id)).to.equal(alice.address);
    });
  });

  // ---------------------------------------------------------------- Addendum 2
  describe("Addendum 2: trustee licensing", () => {
    it("licensed trustees that are not validators are eligible; only the registry owner lists them; listing gives no token power", async () => {
      const { registry, trust, deed, alice, mallory, carol } = ctx;
      await expect(registry.connect(mallory).setLicensedTrustee(mallory.address, true, ethers.ZeroHash)).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(registry.setLicensedTrustee(carol.address, true, k("WY trust company charter 123")))
        .to.emit(registry, "LicensedTrusteeUpdated").withArgs(carol.address, true, k("WY trust company charter 123"));
      expect(await registry.isEligibleTrustee(carol.address)).to.equal(true);
      const id = await mintTrust(ctx, alice, { trustee: carol.address }, carol);
      await expect(deed.connect(carol).setTrait(id, ethers.toUtf8Bytes("zoning"), ethers.toUtf8Bytes("x"), 1))
        .to.be.revertedWithCustomError(deed, "NotDeedEditor");
      await registry.setLicensedTrustee(carol.address, false, ethers.ZeroHash);
      expect(await registry.isEligibleTrustee(carol.address)).to.equal(false);
      expect((await trust.trustRecordOf(id)).trustee).to.equal(carol.address); // delisting changes no deed by itself
    });

    it("setStandbyTrustee: protector only, eligible, pre-accepted, not the holder, trustee or protector", async () => {
      const { trust, alice, standby, trustee, mallory, deployer } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      await expect(trust.connect(deployer).setStandbyTrustee(id, standby.address, "0x")).to.be.revertedWithCustomError(trust, "NotProtector");
      await expect(trust.connect(trustee).setStandbyTrustee(id, standby.address, "0x")).to.be.revertedWithCustomError(trust, "NotProtector");
      await expect(trust.connect(alice).setStandbyTrustee(id, mallory.address, "0x")).to.be.revertedWithCustomError(trust, "TrusteeNotEligible");
      await expect(trust.connect(alice).setStandbyTrustee(id, trustee.address, "0x")).to.be.revertedWithCustomError(trust, "RoleConflict");
      await expect(trust.connect(alice).setStandbyTrustee(id, standby.address, "0x")).to.be.revertedWithCustomError(trust, "ConsentMissing");
      const nonce = (await trust.trustRecordOf(id)).nonce;
      const sig = await signTrust(ctx, standby, "StandbyAcceptance", { tokenId: id, standby: standby.address, nonce });
      await expect(trust.connect(alice).setStandbyTrustee(id, standby.address, sig))
        .to.emit(trust, "StandbyTrusteeChanged").withArgs(id, ethers.ZeroAddress, standby.address);
      expect(coder.decode(["address"], await ctx.deed.getTraitValue(id, k("standbyTrustee")))[0]).to.equal(standby.address);
      // the protector can clear it without acceptance
      await trust.connect(alice).setStandbyTrustee(id, ethers.ZeroAddress, "0x");
      expect((await trust.trustRecordOf(id)).standbyTrustee).to.equal(ethers.ZeroAddress);
    });

    it("applyLicensingDetermination posts a notice and promotes the standby", async () => {
      // Phase 4b (re-review M-G): the standby's own call promotes it only with the protector's consent
      // (here the holder, as the protector record is zero). Without it, see Decisions.spec M-G.
      const { trust, alice, standby, trustee, mallory } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      const nonce = (await trust.trustRecordOf(id)).nonce;
      await trust.connect(alice).setStandbyTrustee(id, standby.address,
        await signTrust(ctx, standby, "StandbyAcceptance", { tokenId: id, standby: standby.address, nonce }));
      await expect(trust.connect(mallory).applyLicensingDetermination(id, k("doc"), "ipfs://det", "0x")).to.be.revertedWithCustomError(trust, "NotTrustParty");
      const consent = await signTrust(ctx, alice, "LicensingConsent", {
        tokenId: id, standby: standby.address, docHash: k("doc"), nonce: (await trust.trustRecordOf(id)).nonce,
      });
      await expect(trust.connect(standby).applyLicensingDetermination(id, k("doc"), "ipfs://det", consent))
        .to.emit(trust, "NoticePosted").withArgs(id, standby.address, k("doc"), "ipfs://det", trustee.address, alice.address)
        .and.to.emit(trust, "StandbyPromoted").withArgs(id, trustee.address, standby.address);
      const r = await trust.trustRecordOf(id);
      expect(r.trustee).to.equal(standby.address);
      expect(r.standbyTrustee).to.equal(ethers.ZeroAddress);
      expect(r.trusteeSuspended).to.equal(false);
    });

    it("without a standby the trustee is suspended and loses its powers until the protector names one", async () => {
      const { deed, trust, alice, trustee, standby } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      await expect(trust.connect(trustee).applyLicensingDetermination(id, k("doc"), "ipfs://det", "0x"))
        .to.emit(trust, "TrusteeSuspended").withArgs(id, trustee.address);
      expect(coder.decode(["bool"], await deed.getTraitValue(id, k("trusteeSuspended")))[0]).to.equal(true);
      await expect(trust.connect(trustee).markVoid(id, 1, ethers.ZeroHash, "")).to.be.revertedWithCustomError(trust, "NotTrustParty");
      await expect(trust.connect(trustee).correctDefinition(id, "x", "", "0x")).to.be.revertedWithCustomError(trust, "NotTrustParty");
      const nonce = (await trust.trustRecordOf(id)).nonce;
      await trust.connect(alice).setTrustee(id, standby.address,
        await signTrust(ctx, standby, "TrusteeAcceptance", { tokenId: id, trustee: standby.address, nonce }));
      expect((await trust.trustRecordOf(id)).trusteeSuspended).to.equal(false);
    });

    it("program parameters carry no trustee-fee field, and no deed payment reaches a trustee", async () => {
      const { deed, trust, alice, trustee, validator } = ctx;
      const programAbi = trust.interface.getFunction("mintTrustDeed")!.inputs[0].components!.find((c: any) => c.name === "program")!;
      expect(programAbi.components!.map((c: any) => c.name.toLowerCase()).some((n: string) => n.includes("fee"))).to.equal(false);
      const id = await mintValidatedLand(ctx, alice);
      const [receiver] = await deed.royaltyInfo(id, 10_000n);
      expect(receiver).to.equal(await validator.getAddress());
      expect(receiver).to.not.equal(trustee.address);
    });
  });

  // ---------------------------------------------------------------- item 10
  describe("item 10: status and notices", () => {
    it("postNotice is open to anyone and names the trustee and protector of the moment", async () => {
      const { deed, trust, alice, mallory, trustee } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      await expect(trust.connect(mallory).postNotice(id, k("lost-key-claim"), "ipfs://claim"))
        .to.emit(trust, "NoticePosted").withArgs(id, mallory.address, k("lost-key-claim"), "ipfs://claim", trustee.address, alice.address);
      await deed.connect(alice).burnAsset(id);
      await expect(trust.postNotice(id, k("court-order"), "ipfs://order")).to.emit(trust, "NoticePosted");
      await expect(trust.postNotice(12345, k("x"), "")).to.be.revertedWithCustomError(trust, "UnknownDeed");
    });

    it("markVoid: validator or trustee; transferable by default; freezing codes only by the validator; burn always works", async () => {
      const { deed, trust, alice, bob, trustee, deployer, mallory } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      await expect(trust.connect(mallory).markVoid(id, 1, k("rec"), "ipfs://tax-sale")).to.be.revertedWithCustomError(trust, "NotTrustParty");
      await expect(trust.connect(trustee).markVoid(id, 1, k("rec"), "ipfs://tax-sale"))
        .to.emit(trust, "DeedVoided").withArgs(id, 1, k("rec"), "ipfs://tax-sale", true);
      expect(await trust.statusOf(id)).to.equal(2);
      await expect(trust.connect(trustee).markVoid(id, 1, k("rec"), "")).to.be.revertedWithCustomError(trust, "NotActive");
      // the right to wind-up proceeds travels with the void token
      await deed.connect(alice).transferFrom(alice.address, bob.address, id);

      const id2 = await mintValidatedLand(ctx, alice);
      await expect(trust.connect(deployer).markVoid(id2, 128, k("rec2"), "ipfs://order"))
        .to.emit(trust, "DeedVoided").withArgs(id2, 128, k("rec2"), "ipfs://order", false);
      await expect(deed.connect(alice).transferFrom(alice.address, bob.address, id2)).to.be.revertedWithCustomError(trust, "DeedFrozen");
      await deed.connect(alice).burnAsset(id2);
      expect(await trust.statusOf(id2)).to.equal(1);
    });
  });

  // ---------------------------------------------------------------- plumbing
  describe("plumbing", () => {
    it("the transfer hook cannot be called from outside, and the extensions are pinned", async () => {
      const { deed } = ctx;
      const hook = new ethers.Interface(["function transferHook(address,address,uint256)"]);
      await expect(ctx.alice.sendTransaction({ to: await deed.getAddress(), data: hook.encodeFunctionData("transferHook", [ctx.alice.address, ctx.bob.address, 1]) }))
        .to.be.revertedWithCustomError(deed, "HookOnly");
      // swapped extensions are refused at construction
      const mint = await (await ethers.getContractFactory("DeedNFTMintExtension")).deploy();
      const tr = await (await ethers.getContractFactory("DeedTrustExtension")).deploy();
      await expect((await ethers.getContractFactory("DeedNFT")).deploy(await tr.getAddress(), await mint.getAddress()))
        .to.be.revertedWithCustomError(deed, "ExtensionMismatch");
      // the trust registries are set once
      await expect(ctx.trust.setTrustRegistries(ctx.alice.address, ethers.ZeroAddress)).to.be.revertedWithCustomError(ctx.trust, "RegistryAlreadySet");
      await expect(ctx.trust.connect(ctx.alice).setTrustRegistries(ctx.alice.address, ethers.ZeroAddress)).to.be.reverted;
    });
  });
});
