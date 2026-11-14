import { expect } from "chai";
import { ethers, upgrades, network } from "hardhat";
import { deployDeedTrack, mintValidatedLand, mintValidatedVehicle, k, enc, dec, coder, Ctx, AGREEMENT_BASE, BASE_URI } from "./fixture";

/*
 * Deed-track audit regressions: metadata integrity and validator powers.
 * These were exploit PoCs that PASSED while each bug existed; each now asserts the attack FAILS.
 * Spec labels (D-01 ...) differ from the report's finding IDs; each title names the report ID.
 */
describe("AUDIT deed: metadata integrity", function () {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await deployDeedTrack(); });

  // Report D-1 (spec label D-01)
  // Since v5 a Land deed is a trust deed whose definition and agreement nobody edits (TrustV5 spec, item 3);
  // the Phase 1 legacy rules are exercised on a Vehicle deed.
  it("D-1: holder can no longer rewrite or delete the legal traits of a VALIDATED deed", async () => {
    const { deed, alice } = ctx;
    const id = await mintValidatedVehicle(ctx, alice);
    expect((await deed.getValidationStatus(id))[0]).to.equal(true);

    for (const [name, val] of [
      ["vin", "SOME-OTHER-VIN"],
      ["make", "Other"],
      ["definition", "Anything at all"],
      ["operatingAgreement", "ipfs://my-own-agreement"],
      ["configuration", "anything"],
    ]) {
      await expect(deed.connect(alice).setTrait(id, ethers.toUtf8Bytes(name), ethers.toUtf8Bytes(val), 1))
        .to.be.revertedWithCustomError(deed, "ValidatedTraitLocked");
    }
    await expect(deed.connect(alice).removeTrait(id, "vin"))
      .to.be.revertedWithCustomError(deed, "ValidatedTraitLocked");
    expect(dec(await deed.getTraitValue(id, k("vin")))).to.equal("1HGCM82633A004352");
    expect((await deed.getValidationStatus(id))[0]).to.equal(true);

    // Ordinary (non-required) traits remain the holder's
    await deed.connect(alice).setTrait(id, ethers.toUtf8Bytes("nickname"), ethers.toUtf8Bytes("home"), 1);

    // The holder's explicit path still exists, and it withdraws the validation
    await deed.connect(alice).updateMetadata(id, "", AGREEMENT_BASE, "Corrected definition", "");
    expect((await deed.getValidationStatus(id))[0]).to.equal(false);
    // Unvalidated: holder may edit again; the agreement only through updateMetadata (registered names only)
    await deed.connect(alice).setTrait(id, ethers.toUtf8Bytes("vin"), ethers.toUtf8Bytes("1HGCM82633A004353"), 1);
    await expect(deed.connect(alice).setTrait(id, ethers.toUtf8Bytes("operatingAgreement"), ethers.toUtf8Bytes("ipfs://my-own-agreement"), 1))
      .to.be.revertedWithCustomError(deed, "AgreementViaUpdateMetadata");
    await expect(deed.connect(alice).updateMetadata(id, "", "ipfs://my-own-agreement", "d", ""))
      .to.be.revertedWith("Invalid operating agreement");
  });

  // Report D-2 (spec label D-02)
  it("D-2: there is no global editor key; only signers of the deed's own validator edit it", async () => {
    const { deed, alice, deployer, renderer, mallory, operator2, registry } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    const VR = await deed.VALIDATOR_ROLE();
    expect(await deed.hasRole(VR, deployer.address)).to.equal(false);            // not granted in initialize()
    expect(await deed.hasRole(VR, await renderer.getAddress())).to.equal(false); // not granted by setMetadataRenderer

    // An EOA the admin grants DeedNFT VALIDATOR_ROLE gets no editing power
    await deed.connect(deployer).addValidator(mallory.address);
    await expect(deed.connect(mallory).updateMetadata(id, "", AGREEMENT_BASE, "admin rewrite", ""))
      .to.be.revertedWithCustomError(deed, "NotDeedEditor");
    await expect(deed.connect(mallory).setTrait(id, ethers.toUtf8Bytes("legalDescription"), ethers.toUtf8Bytes("X"), 1))
      .to.be.revertedWithCustomError(deed, "NotDeedEditor");

    // A signer of ANOTHER active validator cannot edit this deed
    const v2: any = await upgrades.deployProxy(await ethers.getContractFactory("Validator", operator2), ["https://o/", "https://o/oa/"], { kind: "uups" });
    await registry.registerValidator(await v2.getAddress(), "Second", "", [0]);
    await registry.updateValidatorStatus(await v2.getAddress(), true);
    expect(await v2.hasRole(VR, operator2.address)).to.equal(true);
    await expect(deed.connect(operator2).setTrait(id, ethers.toUtf8Bytes("assetType"), coder.encode(["uint8"], [1]), 0))
      .to.be.revertedWithCustomError(deed, "NotDeedEditor");

    // A signer of the deed's own validator can (TraitUpdated logs the edit)
    await expect(deed.connect(deployer).setTrait(id, ethers.toUtf8Bytes("legalDescription"), ethers.toUtf8Bytes("LOT 12 corrected"), 1))
      .to.emit(deed, "TraitUpdated");
    // ...until the validator revokes the signer
    await ctx.validator.revokeRole(VR, deployer.address);
    await expect(deed.connect(deployer).setTrait(id, ethers.toUtf8Bytes("legalDescription"), ethers.toUtf8Bytes("again"), 1))
      .to.be.revertedWithCustomError(deed, "NotDeedEditor");

    // The renderer has no write power over deeds at all (it keeps display fields in its own storage)
    const r = await renderer.getAddress();
    await network.provider.send("hardhat_impersonateAccount", [r]);
    await network.provider.send("hardhat_setBalance", [r, "0x56BC75E2D63100000"]);
    const rs = await ethers.getSigner(r);
    await expect(deed.connect(rs).setTrait(id, k("legalDescription"), enc("RENDERER REWRITE"), 0))
      .to.be.revertedWithCustomError(deed, "NotDeedEditor");
    await expect(deed.connect(rs).setTrait(id, k("customMetadata"), enc("{}"), 0))
      .to.be.revertedWithCustomError(deed, "NotDeedEditor");
    await network.provider.send("hardhat_stopImpersonatingAccount", [r]);

    expect(dec(await deed.getTraitValue(id, k("legalDescription")))).to.equal("LOT 12 corrected");
    expect((await deed.getValidationStatus(id))[0]).to.equal(true);
  });

  // Report D-7 (spec label D-03)
  it("D-7: another active validator cannot overwrite a deed's verdict or take its royalties; only the holder reassigns", async () => {
    const { deed, alice, operator2, registry } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    const v1 = await ctx.validator.getAddress();

    const V = await ethers.getContractFactory("Validator", operator2);
    const v2: any = await upgrades.deployProxy(V, ["https://other/", "https://other/oa/"], { kind: "uups" });
    await v2.setDeedNFT(await deed.getAddress());
    await v2.setAssetTypeSupport(0, true);
    await v2.setValidationCriteria(0, ["traitNobodyHas"], "", false, false);
    await registry.registerValidator(await v2.getAddress(), "Second Validator", "", [0]);
    await registry.updateValidatorStatus(await v2.getAddress(), true);

    await expect(v2.connect(operator2).validateDeed(id)).to.be.revertedWithCustomError(deed, "NotDeedValidator");
    const [isValidated, v] = await deed.getValidationStatus(id);
    expect(isValidated).to.equal(true);
    expect(v).to.equal(v1);
    expect((await deed.royaltyInfo(id, 10_000n))[0]).to.equal(v1);

    // Only the holder moves the deed to another validator, and that resets validation
    await expect(deed.connect(operator2).reassignValidator(id, await v2.getAddress())).to.be.revertedWith("Not deed owner");
    await deed.connect(alice).reassignValidator(id, await v2.getAddress());
    // Phase 4b (re-review M-F): on a trust deed the change waits out the delay, and v1 stays the
    // validator meanwhile; the holder completes it afterwards.
    expect(await deed.getValidationStatus(id)).to.deep.equal([true, v1]);
    await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine", []);
    await deed.connect(alice).completeValidatorReassignment(id);
    expect(await deed.getValidationStatus(id)).to.deep.equal([false, await v2.getAddress()]);
    // and now v1 is the outsider
    await expect(ctx.validator.validateDeed(id)).to.be.revertedWithCustomError(deed, "NotDeedValidator");
  });

  // Report D-14 (spec label D-04)
  it("D-14: validateDeed accepts only an exact registered agreement or <registered base><tokenId>, and a removed name stops validating", async () => {
    const { deed, alice, deployer, validator } = ctx;
    const id = await mintValidatedVehicle(ctx, alice); // legacy agreement path (Land deeds are trust deeds since v5)
    // The deed's validator signer writes candidate agreements (the holder is locked out on a validated deed).
    const evil = "https://evil.example/forged-trust.pdf?x=" + AGREEMENT_BASE;
    await deed.connect(deployer).setTrait(id, ethers.toUtf8Bytes("operatingAgreement"), ethers.toUtf8Bytes(evil), 1);
    await validator.validateDeed(id);
    expect((await deed.getValidationStatus(id))[0]).to.equal(false);
    expect(await validator.validateOperatingAgreement(evil)).to.equal(false);

    await deed.connect(deployer).setTrait(id, ethers.toUtf8Bytes("operatingAgreement"), ethers.toUtf8Bytes("ipfs://x/" + BASE_URI), 1);
    await validator.validateDeed(id);
    expect((await deed.getValidationStatus(id))[0]).to.equal(false);

    // <registered base><some other id> is rejected too
    await deed.connect(deployer).setTrait(id, ethers.toUtf8Bytes("operatingAgreement"), ethers.toUtf8Bytes(AGREEMENT_BASE + (id + 1n)), 1);
    await validator.validateDeed(id);
    expect((await deed.getValidationStatus(id))[0]).to.equal(false);

    await deed.connect(deployer).setTrait(id, ethers.toUtf8Bytes("operatingAgreement"), ethers.toUtf8Bytes(AGREEMENT_BASE + id), 1);
    await validator.validateDeed(id);
    expect((await deed.getValidationStatus(id))[0]).to.equal(true);

    // Removing the agreement's name de-registers it (the default agreement URI differs in this test)
    await validator.setDefaultOperatingAgreement("https://api.example.com/other-default/");
    await validator.removeOperatingAgreementName(AGREEMENT_BASE);
    await validator.validateDeed(id);
    expect((await deed.getValidationStatus(id))[0]).to.equal(false);
  });

  // Report D-6 (spec label D-05)
  it("D-6: trait names are JSON-escaped, so tokenURI cannot be spoofed as validated", async () => {
    const { deed, mallory, deployer } = ctx;
    await deed.connect(deployer).mintAsset(mallory.address, 1, "ipfs://fb", "junk", "", ethers.ZeroAddress, ethers.ZeroAddress, 0);
    const id = 1n;
    expect((await deed.getValidationStatus(id))[0]).to.equal(false);

    const payload = 'X","value":"x"}],"image":"ipfs://spoofed-validated","name":"123 Main St - Land (validated)",' +
      '"attributes":[{"trait_type":"Validation Status","value":"Valid"},{"trait_type":"Z';
    await deed.connect(mallory).setTrait(id, ethers.toUtf8Bytes(payload), ethers.toUtf8Bytes("z"), 1);
    // A name set by the admin (setTraitName) is escaped the same way
    await deed.connect(mallory).setTrait(id, ethers.toUtf8Bytes("nickname"), ethers.toUtf8Bytes("z"), 1);
    await deed.connect(deployer).setTraitName(k("nickname"), payload + "2");
    const uri: string = await deed.tokenURI(id);
    const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
    expect(json.image).to.not.equal("ipfs://spoofed-validated");
    expect(json.name).to.not.equal("123 Main St - Land (validated)");
    expect(json.attributes.find((a: any) => a.trait_type === "Validation Status").value).to.equal("Invalid");
    expect(json.attributes.some((a: any) => a.trait_type === payload)).to.equal(true);
    expect(json.attributes.some((a: any) => a.trait_type === payload + "2")).to.equal(true);
  });

  // Report D-11 (spec label D-06)
  it("D-11: only the deed's validator records legal info and documents; holder and renderer owner cannot erase them; changes are versioned", async () => {
    const { deed, renderer, alice, bob, deployer } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await renderer.connect(deployer).transferOwnership(bob.address); // renderer owner is a separate key here
    // validator (deployer is a signer of the deed's validator) records an encumbrance and the recorded deed document
    await expect(renderer.connect(deployer).setTokenLegalInfo(id, "CA, San Bernardino", "DOC-2026-0001", "2026-11-01",
      ["ipfs://grant-deed"], ["Deed of Trust in favour of Clear, Inst. 2026-0002"], ""))
      .to.emit(renderer, "LegalRecordUpdated");
    await expect(renderer.connect(deployer).manageTokenDocument(id, "deedOfTrust", "ipfs://dot", false))
      .to.emit(renderer, "DocumentRecordUpdated");
    expect(await renderer.legalRecordVersion(id)).to.equal(2n);

    for (const who of [alice, bob]) {
      await expect(renderer.connect(who).setTokenLegalInfo(id, "CA, San Bernardino", "DOC-2026-0001", "2026-11-01", [], [], "clean title"))
        .to.be.revertedWithCustomError(renderer, "Unauthorized");
      await expect(renderer.connect(who).manageTokenDocument(id, "deedOfTrust", "", true))
        .to.be.revertedWithCustomError(renderer, "Unauthorized");
    }

    const info = await renderer.getTokenLegalInfo(id);
    expect(info.restrictions.length).to.equal(1);
    expect(await renderer.getTokenDocument(id, "deedOfTrust")).to.equal("ipfs://dot");
  });

  // Report D-15 (spec label D-07)
  it("D-15: holder updateMetadata keeps the recorded validator: royaltyInfo and later edits keep working", async () => {
    const { deed, alice, deployer } = ctx;
    const id = await mintValidatedVehicle(ctx, alice); // updateMetadata is the legacy path; trust deeds refuse it
    const v1 = await ctx.validator.getAddress();
    await deed.connect(alice).updateMetadata(id, "", AGREEMENT_BASE, "new def", "");
    expect(await deed.getValidationStatus(id)).to.deep.equal([false, v1]);
    expect((await deed.royaltyInfo(id, 1000n))[0]).to.equal(v1);
    await deed.connect(alice).updateMetadata(id, "", AGREEMENT_BASE, "again", "");
    await deed.connect(deployer).updateMetadata(id, "", AGREEMENT_BASE, "validator fix", "");
    expect(dec(await deed.getTraitValue(id, k("definition")))).to.equal("validator fix");
    await ctx.validator.validateDeed(id);
    expect((await deed.getValidationStatus(id))[0]).to.equal(true);
  });

  // Report D-12 (spec label D-08)
  it("D-12: trait keys are per token: another holder's keys no longer raise this deed's burn cost", async () => {
    const { deed, alice, mallory, deployer } = ctx;
    const victim = await mintValidatedVehicle(ctx, alice);
    await deed.connect(deployer).mintAsset(mallory.address, 1, "", "m", "", ethers.ZeroAddress, ethers.ZeroAddress, 0);
    const mid = 2n;
    const before = await deed.connect(alice).burnAsset.estimateGas(victim);
    for (let i = 0; i < 150; i++) {
      await deed.connect(mallory).setTrait(mid, ethers.toUtf8Bytes("junk" + i), ethers.toUtf8Bytes("x"), 1);
    }
    const after = await deed.connect(alice).burnAsset.estimateGas(victim);
    console.log(`      burnAsset gas: ${before} -> ${after} after another holder added 150 keys`);
    expect(after).to.equal(before);
    // 6 base traits (no beneficiary since v5, item 5) + 4 vehicle traits; 6 + 150 junk keys
    expect((await deed.getTraitKeys(victim)).length).to.equal(10);
    expect((await deed.getTraitKeys(mid)).length).to.equal(156);
    // removing a key drops it from the token's set
    await deed.connect(mallory).removeTrait(mid, "junk0");
    expect((await deed.getTraitKeys(mid)).length).to.equal(155);
    // burning costs the same however many keys the token has (no key loop; IDs are never reused, D-8)
    await deed.connect(mallory).burnAsset(mid);
  });
});
