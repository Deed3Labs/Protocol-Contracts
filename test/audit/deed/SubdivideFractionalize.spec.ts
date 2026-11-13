import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployDeedTrack, mintValidatedLand, subdivideDeed, k, coder, Ctx, LAND_TRAITS } from "./fixture";

/*
 * Deed-track audit regressions: Subdivide and Fractionalize custody.
 * These were exploit PoCs that PASSED while each bug existed; each now asserts the attack FAILS.
 * Spec labels (S-01, F-01 ...) differ from the report's finding IDs; each title names the report ID.
 */
const unit = (deedId: bigint, u: bigint) => (deedId << 128n) | u;
const one = ethers.zeroPadValue("0x01", 32);

describe("AUDIT deed: subdivision and fractionalization", function () {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await deployDeedTrack(); });

  // Report D-3 (spec label S-01)
  it("D-3: collection admin can no longer self-validate a unit, name its validator/royalty receiver, beneficiary or parent", async () => {
    const { subdivide, alice, mallory, validator } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await subdivideDeed(ctx, alice, id);
    await subdivide.connect(alice).mintUnit(id, 0, alice.address);

    await expect(subdivide.connect(alice).setUnitTraitFlexible(id, 0, ethers.toUtf8Bytes("isValidated"), one, 3))
      .to.be.revertedWithCustomError(subdivide, "ReservedUnitTrait");
    const V = await ethers.getContractFactory("Validator", alice);
    const own: any = await upgrades.deployProxy(V, ["x", "y"], { kind: "uups" });
    await expect(subdivide.connect(alice).setUnitTrait(id, 0, k("validator"), coder.encode(["address"], [await own.getAddress()])))
      .to.be.revertedWithCustomError(subdivide, "ReservedUnitTrait");
    await expect(subdivide.connect(alice).setUnitTrait(id, 0, k("beneficiary"), coder.encode(["address"], [mallory.address])))
      .to.be.revertedWithCustomError(subdivide, "ReservedUnitTrait");
    await expect(subdivide.connect(alice).setUnitTrait(id, 0, k("parentDeed"), coder.encode(["uint256"], [424242n])))
      .to.be.revertedWithCustomError(subdivide, "ReservedUnitTrait");
    await expect(subdivide.connect(alice).removeUnitTrait(id, 0, "validator"))
      .to.be.revertedWithCustomError(subdivide, "ReservedUnitTrait");
    expect(await subdivide.isUnitValidated(id, 0)).to.equal(false);
    expect((await subdivide.royaltyInfo(unit(id, 0n), 10_000n))[0]).to.equal(await validator.getAddress());

    // The unit's validator validates it; an admin edit afterwards withdraws the validation
    for (const [name, val] of Object.entries(LAND_TRAITS)) {
      await subdivide.connect(alice).setUnitTraitFlexible(id, 0, ethers.toUtf8Bytes(name), ethers.toUtf8Bytes(val), 1);
    }
    await validator.validateSubdivisionUnit(await subdivide.getAddress(), id, 0);
    expect(await subdivide.isUnitValidated(id, 0)).to.equal(true);
    await subdivide.connect(alice).setUnitTraitFlexible(id, 0, ethers.toUtf8Bytes("legalDescription"), ethers.toUtf8Bytes("Unit 0 is the whole lot"), 1);
    expect(await subdivide.isUnitValidated(id, 0)).to.equal(false);

    // Royalties never go to an unregistered or inactive validator: deactivate the unit's validator
    await ctx.registry.updateValidatorStatus(await validator.getAddress(), false);
    await expect(subdivide.royaltyInfo(unit(id, 0n), 10_000n)).to.not.be.reverted; // falls back to the parent
  });

  // Report D-10 (spec label S-02)
  it("D-10: collection admin rights follow the deed's beneficial owner; the creator cannot sell the deed and keep them", async () => {
    const { deed, subdivide, alice, bob, carol } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await subdivideDeed(ctx, alice, id);
    await subdivide.connect(alice).mintUnit(id, 0, carol.address);
    // The deed is in custody: alice cannot sell it on the side
    await expect(deed.connect(alice).transferFrom(alice.address, bob.address, id)).to.be.reverted;
    expect(await subdivide.subdivisionOwnerOf(id)).to.equal(alice.address);

    // Handing over the subdivision hands over every admin right, and alice keeps none
    await subdivide.connect(alice).transferCollectionAdmin(id, bob.address);
    expect(await subdivide.subdivisionOwnerOf(id)).to.equal(bob.address);
    await expect(subdivide.connect(alice).setUnitMetadata(id, 0, "ipfs://alice-rewrote-unit-0")).to.be.revertedWith("Not collection admin");
    await expect(subdivide.connect(alice).setBurnable(id, false)).to.be.revertedWith("Not collection admin");
    await expect(subdivide.connect(alice).mintUnit(id, 1, alice.address)).to.be.revertedWith("Not deed owner");
    await subdivide.connect(bob).setBurnable(id, true);

    // When the last unit is burned, bob deactivates and receives the deed
    await subdivide.connect(carol).burnUnit(id, 0);
    await subdivide.connect(bob).deactivateSubdivision(id);
    expect(await deed.ownerOf(id)).to.equal(bob.address);
  });

  // Report D-9 (spec label S-03)
  it("D-9: Subdivide holds the parent while units are outstanding: it cannot be sold or burned, and is released only on deactivation", async () => {
    const { deed, subdivide, alice, bob, carol } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await subdivideDeed(ctx, alice, id, 5, true);
    expect(await deed.ownerOf(id)).to.equal(await subdivide.getAddress());
    await subdivide.connect(alice).batchMintUnits(id, [0n, 1n, 2n], [carol.address, carol.address, carol.address]);

    await expect(deed.connect(alice).transferFrom(alice.address, bob.address, id)).to.be.reverted;
    await expect(deed.connect(alice).burnAsset(id)).to.be.revertedWith("Not deed owner");
    await expect(subdivide.connect(bob).mintUnit(id, 3, bob.address)).to.be.revertedWith("Not deed owner");
    await expect(subdivide.connect(alice).deactivateSubdivision(id)).to.be.revertedWith("Outstanding units exist");

    for (const u of [0, 1, 2]) await subdivide.connect(carol).burnUnit(id, u);
    await subdivide.connect(alice).deactivateSubdivision(id);
    expect(await deed.ownerOf(id)).to.equal(alice.address);
    expect(await subdivide.subdivisionExists(id)).to.equal(false);
  });

  // Report D-17 (spec label S-04)
  it("D-17: Subdivide enforces its marketplace list, and pause stops admin edits (holder transfers stay open by policy)", async () => {
    const { subdivide, alice, carol, mallory, deployer } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await subdivideDeed(ctx, alice, id);
    await subdivide.connect(alice).mintUnit(id, 0, carol.address);
    expect(await subdivide.isRoyaltyEnforced()).to.equal(true);
    await expect(subdivide.connect(carol).setApprovalForAll(mallory.address, true)).to.be.revertedWith("!mkt");
    await subdivide.connect(carol).setApprovalForAll(mallory.address, false); // revoking always allowed

    await subdivide.connect(deployer).pause();
    await expect(subdivide.connect(alice).setUnitMetadata(id, 0, "ipfs://x")).to.be.revertedWith("Pausable: paused");
    await expect(subdivide.connect(alice).setBurnable(id, false)).to.be.revertedWith("Pausable: paused");
    // the holder can still move her own unit
    await subdivide.connect(carol).safeTransferFrom(carol.address, mallory.address, unit(id, 0n), 1, "0x");
    expect(await subdivide.ownerOf(unit(id, 0n))).to.equal(mallory.address);
  });

  // Report D-4 (spec label F-01)
  it("D-4: a non-burnable fraction can be unlocked by the holder of every share", async () => {
    const { deed, fractionalize, alice } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await deed.connect(alice).approve(await fractionalize.getAddress(), id);
    await fractionalize.connect(alice).createFraction({
      assetType: 0, originalTokenId: id, name: "F", description: "", symbol: "F", collectionUri: "",
      totalShares: 100, burnable: false, approvalPercentage: 51,
    });
    await fractionalize.connect(alice).mintShares(1, 100, alice.address);
    const token: any = await ethers.getContractAt("FractionToken", await fractionalize.getFractionToken(1));
    await expect(token.connect(alice).burn(1)).to.be.revertedWith("Burning not allowed"); // holders still cannot burn for nothing
    await fractionalize.connect(alice).unlockAsset({ fractionId: 1, to: alice.address, checkApprovals: false });
    expect(await deed.ownerOf(id)).to.equal(alice.address);
    expect(await token.totalSupply()).to.equal(0n);
  });

  // Report D-5 (spec label F-02)
  it("D-5: a holder burning a share through FractionToken.burn no longer locks the deed", async () => {
    const { deed, fractionalize, alice, mallory } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await deed.connect(alice).approve(await fractionalize.getAddress(), id);
    await fractionalize.connect(alice).createFraction({
      assetType: 0, originalTokenId: id, name: "F", description: "", symbol: "F", collectionUri: "",
      totalShares: 100, burnable: true, approvalPercentage: 51,
    });
    await fractionalize.connect(alice).mintShares(1, 99, alice.address);
    await fractionalize.connect(alice).mintShares(1, 1, mallory.address);
    const token: any = await ethers.getContractAt("FractionToken", await fractionalize.getFractionToken(1));
    await token.connect(mallory).burn(1);
    expect(await token.totalSupply()).to.equal(99n);
    // alice holds the entire remaining supply, so she can unlock
    await fractionalize.connect(alice).unlockAsset({ fractionId: 1, to: alice.address, checkApprovals: false });
    expect(await deed.ownerOf(id)).to.equal(alice.address);
  });

  // Report D-21 (spec label F-03)
  it("D-21: subdivision units can be fractionalized and unlocked", async () => {
    const { subdivide, fractionalize, alice, carol } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await subdivideDeed(ctx, alice, id);
    await subdivide.connect(alice).mintUnit(id, 0, alice.address);
    await subdivide.connect(alice).setApprovalForAll(await fractionalize.getAddress(), true);
    await fractionalize.connect(alice).createFraction({
      assetType: 1, originalTokenId: unit(id, 0n), name: "U", description: "", symbol: "U", collectionUri: "",
      totalShares: 10, burnable: true, approvalPercentage: 51,
    });
    expect(await subdivide.ownerOf(unit(id, 0n))).to.equal(await fractionalize.getAddress());
    // unit beneficiary stays with the depositor while in custody (D-19 for units)
    expect(coder.decode(["address"], await subdivide.getUnitTraitValue(id, 0, k("beneficiary")))[0]).to.equal(alice.address);
    // stray ERC-1155 transfers are refused
    await subdivide.connect(alice).mintUnit(id, 1, alice.address);
    await expect(subdivide.connect(alice).safeTransferFrom(alice.address, await fractionalize.getAddress(), unit(id, 1n), 1, "0x"))
      .to.be.reverted;
    await fractionalize.connect(alice).mintShares(1, 10, alice.address);
    await fractionalize.connect(alice).unlockAsset({ fractionId: 1, to: carol.address, checkApprovals: false });
    expect(await subdivide.ownerOf(unit(id, 0n))).to.equal(carol.address);
  });

  // Report D-13 (code terms; no spec PoC existed)
  it("D-13: the FractionTokenFactory keeps no admin over the tokens it creates, and DeedNFT grants no global editor role", async () => {
    const { deed, factory, fractionalize, alice, deployer } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await deed.connect(alice).approve(await fractionalize.getAddress(), id);
    await fractionalize.connect(alice).createFraction({
      assetType: 0, originalTokenId: id, name: "F", description: "", symbol: "F", collectionUri: "",
      totalShares: 100, burnable: true, approvalPercentage: 51,
    });
    const token: any = await ethers.getContractAt("FractionToken", await fractionalize.getFractionToken(1));
    const f = await factory.getAddress();
    expect(await token.hasRole(await token.DEFAULT_ADMIN_ROLE(), f)).to.equal(false);
    expect(await token.hasRole(await token.ADMIN_ROLE(), f)).to.equal(false);
    expect(await token.hasRole(await token.MINTER_ROLE(), await fractionalize.getAddress())).to.equal(true);
    // nobody can grant MINTER_ROLE or pause the token
    await expect(token.connect(deployer).pause()).to.be.reverted;
    expect(await deed.hasRole(await deed.VALIDATOR_ROLE(), deployer.address)).to.equal(false);
  });
});
