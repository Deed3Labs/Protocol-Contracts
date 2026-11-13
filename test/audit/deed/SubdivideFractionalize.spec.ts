import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployDeedTrack, mintValidatedLand, k, coder, Ctx } from "./fixture";

/*
 * Deed-track audit PoCs: Subdivide and Fractionalize custody.
 * Every test PASSES while the issue exists.
 */
const unit = (deedId: bigint, u: bigint) => (deedId << 128n) | u;
const one = ethers.zeroPadValue("0x01", 32);

describe("AUDIT deed: subdivision and fractionalization", function () {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await deployDeedTrack(); });

  it("S-01 collection admin self-validates a unit and points its royalty receiver at its own contract", async () => {
    const { subdivide, alice, mallory } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await subdivide.connect(alice).createSubdivision(id, "Tract", "", "TR", "ipfs://tr", 5, true);
    await subdivide.connect(alice).mintUnit(id, 0, alice.address);
    expect(await subdivide.isUnitValidated(id, 0)).to.equal(false);

    // No validator involved:
    await subdivide.connect(alice).setUnitTraitFlexible(id, 0, ethers.toUtf8Bytes("isValidated"), one, 3);
    expect(await subdivide.isUnitValidated(id, 0)).to.equal(true);

    // Royalty receiver: any contract answering getRoyaltyFeePercentage, e.g. an unregistered Validator the admin owns
    const V = await ethers.getContractFactory("Validator", alice);
    const own: any = await upgrades.deployProxy(V, ["x", "y"], { kind: "uups" });
    await subdivide.connect(alice).setUnitTrait(id, 0, k("validator"), coder.encode(["address"], [await own.getAddress()]));
    const [recv] = await subdivide.royaltyInfo(unit(id, 0n), 10_000n);
    expect(recv).to.equal(await own.getAddress());
    expect(await ctx.registry.isValidatorRegistered(await own.getAddress())).to.equal(false);
    const [, v] = await subdivide.getUnitValidationStatus(id, 0);
    expect(v).to.equal(await own.getAddress());     // "validated by" an unregistered contract
    // reserved-looking traits are all writable: beneficiary and parentDeed too
    await subdivide.connect(alice).setUnitTrait(id, 0, k("beneficiary"), coder.encode(["address"], [mallory.address]));
    await subdivide.connect(alice).setUnitTrait(id, 0, k("parentDeed"), coder.encode(["uint256"], [424242n]));
  });

  it("S-02 creator keeps collection-admin powers over the units after selling the parent deed", async () => {
    const { deed, subdivide, alice, bob, carol } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await subdivide.connect(alice).createSubdivision(id, "Tract", "", "TR", "ipfs://tr", 5, true);
    await subdivide.connect(alice).mintUnit(id, 0, carol.address);
    await deed.connect(alice).transferFrom(alice.address, bob.address, id);   // deed sold to Bob

    await subdivide.connect(alice).setUnitMetadata(id, 0, "ipfs://alice-rewrote-unit-0");
    await subdivide.connect(alice).setBurnable(id, false);                         // Bob can now never deactivate
    await subdivide.connect(alice).setUnitTraitFlexible(id, 0, ethers.toUtf8Bytes("legalDescription"), ethers.toUtf8Bytes("Unit 0 is the whole lot"), 1);
    await expect(subdivide.connect(bob).setBurnable(id, true)).to.be.revertedWith("Not collection admin");
    expect(await subdivide.uri(unit(id, 0n))).to.equal("ipfs://alice-rewrote-unit-0");
  });

  it("S-03 units minted while the parent stays transferable and burnable; burned parent orphans live units", async () => {
    const { deed, subdivide, alice, bob, carol } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await subdivide.connect(alice).createSubdivision(id, "Tract", "", "TR", "ipfs://tr", 5, false);
    await subdivide.connect(alice).batchMintUnits(id, [0n, 1n, 2n], [carol.address, carol.address, carol.address]);
    // parent still freely transferable (no lock / no custody)
    await deed.connect(alice).transferFrom(alice.address, bob.address, id);
    // new owner mints more units of the same land without re-validation
    await subdivide.connect(bob).mintUnit(id, 3, bob.address);
    // and can burn the parent while 4 units are outstanding
    await deed.connect(bob).burnAsset(id);
    await expect(deed.ownerOf(id)).to.be.reverted;
    expect(await subdivide.subdivisionExists(id)).to.equal(true);
    expect(await subdivide.ownerOf(unit(id, 0n))).to.equal(carol.address);
    await expect(subdivide.connect(bob).deactivateSubdivision(id)).to.be.reverted;   // ownerOf(id) reverts
  });

  it("S-04 Subdivide stores a marketplace allow-list but any operator can be approved and move units; pause does not stop transfers", async () => {
    const { subdivide, alice, carol, mallory, deployer } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await subdivide.connect(alice).createSubdivision(id, "Tract", "", "TR", "ipfs://tr", 5, true);
    await subdivide.connect(alice).mintUnit(id, 0, carol.address);
    expect(await subdivide.isRoyaltyEnforced()).to.equal(true);
    expect(await subdivide.isApprovedMarketplace(mallory.address)).to.equal(false);
    await subdivide.connect(deployer).pause();
    await subdivide.connect(carol).setApprovalForAll(mallory.address, true);
    await subdivide.connect(mallory).safeTransferFrom(carol.address, mallory.address, unit(id, 0n), 1, "0x");
    expect(await subdivide.ownerOf(unit(id, 0n))).to.equal(mallory.address);
  });

  it("F-01 non-burnable fraction: once any share is minted the deed can never be unlocked", async () => {
    const { deed, fractionalize, alice } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await deed.connect(alice).approve(await fractionalize.getAddress(), id);
    await fractionalize.connect(alice).createFraction({
      assetType: 0, originalTokenId: id, name: "F", description: "", symbol: "F", collectionUri: "",
      totalShares: 100, burnable: false, approvalPercentage: 51,
    });
    await fractionalize.connect(alice).mintShares(1, 100, alice.address);   // alice holds 100% of shares
    await expect(fractionalize.connect(alice).unlockAsset({ fractionId: 1, to: alice.address, checkApprovals: false }))
      .to.be.revertedWith("Burning not allowed");
    await expect(fractionalize.connect(alice).unlockAsset({ fractionId: 1, to: alice.address, checkApprovals: true }))
      .to.be.revertedWith("Transfer not approved");
    expect(await deed.ownerOf(id)).to.equal(await fractionalize.getAddress());
  });

  it("F-02 burnable fraction: any holder burning 1 share via FractionToken.burn locks the deed forever", async () => {
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
    await token.connect(mallory).burn(1);                                   // bypasses activeShares accounting
    expect(await token.totalSupply()).to.equal(99n);
    expect((await fractionalize.getFractionBasicInfo(1)).activeShares).to.equal(100n);
    await expect(fractionalize.connect(alice).unlockAsset({ fractionId: 1, to: alice.address, checkApprovals: false }))
      .to.be.revertedWith("Must own all shares");
    // all minting capacity is used, so the gap can never be closed
    await expect(fractionalize.connect(alice).mintShares(1, 1, alice.address)).to.be.revertedWith("Exceeds total shares");
    expect(await deed.ownerOf(id)).to.equal(await fractionalize.getAddress());
  });

  it("F-03 subdivision units cannot be fractionalized (no onERC1155Received)", async () => {
    const { subdivide, fractionalize, alice } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await subdivide.connect(alice).createSubdivision(id, "Tract", "", "TR", "ipfs://tr", 5, true);
    await subdivide.connect(alice).mintUnit(id, 0, alice.address);
    await subdivide.connect(alice).setApprovalForAll(await fractionalize.getAddress(), true);
    await expect(fractionalize.connect(alice).createFraction({
      assetType: 1, originalTokenId: unit(id, 0n), name: "U", description: "", symbol: "U", collectionUri: "",
      totalShares: 10, burnable: true, approvalPercentage: 51,
    })).to.be.revertedWith("ERC1155: transfer to non-ERC1155Receiver implementer");
  });
});
