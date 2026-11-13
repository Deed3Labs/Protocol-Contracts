import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployDeedTrack, mintValidatedLand, k, coder, Ctx, AGREEMENT_BASE } from "./fixture";
import { handOverDeedAdmin, assertNoDeployerPowers } from "../../../deploy/deed_admin_handover";

/*
 * Deed-track regressions for findings that had no exploit PoC: D-13 (admin handover, in code terms),
 * D-22 (deploy wiring) and the D-23 smaller items.
 */
describe("AUDIT deed: deployment handover and smaller items", function () {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await deployDeedTrack(); });

  const contractsOf = (c: Ctx) => ({
    validatorRegistry: c.registry, metadataRenderer: c.renderer, validator: c.validator, deedNFT: c.deed,
    fundManager: c.fundManager, subdivide: c.subdivide, fractionalize: c.fractionalize, fractionTokenFactory: c.factory,
  });

  // Report D-13
  it("D-13: the deploy handover leaves the deployer EOA with no Deed-track role or ownership", async () => {
    const { deployer, operator2, carol } = ctx;
    const admin = operator2.address; // stands in for the Deed timelock / Foundation Safe
    let threw = "";
    try { await assertNoDeployerPowers(contractsOf(ctx), deployer.address); } catch (e: any) { threw = e.message; }
    expect(threw).to.contain("Deployer still holds");

    await handOverDeedAdmin(contractsOf(ctx), deployer, { admin, minter: carol.address });
    await assertNoDeployerPowers(contractsOf(ctx), deployer.address);

    const { deed, registry, validator, subdivide } = ctx;
    expect(await deed.hasRole(ethers.ZeroHash, admin)).to.equal(true);
    expect(await deed.hasRole(await deed.MINTER_ROLE(), carol.address)).to.equal(true);
    expect(await registry.owner()).to.equal(admin);
    expect(await validator.owner()).to.equal(admin);
    expect(await subdivide.hasRole(ethers.ZeroHash, admin)).to.equal(true);
    // the deployer can no longer upgrade, pause or mint
    await expect(deed.connect(deployer).pause()).to.be.reverted;
    await expect(deed.connect(deployer).mintAsset(carol.address, 0, "", "d", "", ethers.ZeroAddress, ethers.ZeroAddress, 0)).to.be.reverted;
    await expect(deed.connect(deployer).upgradeTo(await validator.getAddress())).to.be.reverted;
  });

  // Report D-22 (deploy wiring, as deploy_all now does it): custody contracts approved, criteria real
  it("D-22: with deploy_all's wiring a deed is validated only once its required traits are set", async () => {
    const { deed, validator, alice, deployer } = ctx;
    await deed.connect(deployer).mintAsset(alice.address, 0, "", "Parcel", "", ethers.ZeroAddress, ethers.ZeroAddress, 0);
    await validator.validateDeed(1n);
    expect((await deed.getValidationStatus(1n))[0]).to.equal(false);
    expect(await deed.isApprovedMarketplace(await ctx.subdivide.getAddress())).to.equal(true);
    expect(await deed.isApprovedMarketplace(await ctx.fractionalize.getAddress())).to.equal(true);
  });

  // Report D-23
  it("D-23: FundManager caps the initial commission at 10% and refuses fee-on-transfer tokens", async () => {
    const { registry, fundManager, deed, validator, deployer, alice } = ctx;
    const FM = await ethers.getContractFactory("FundManager");
    await expect(upgrades.deployProxy(FM, [await registry.getAddress(), 1001, deployer.address], { kind: "uups" }))
      .to.be.revertedWith("FundManager: Commission percentage exceeds 10%");

    const fot: any = await (await ethers.getContractFactory("MockFeeOnTransferERC20")).deploy();
    await deed.setFundManager(await fundManager.getAddress());
    await fundManager.addCompatibleDeedNFT(await deed.getAddress());
    await validator.setFundManager(await fundManager.getAddress());
    await validator.addWhitelistedToken(await fot.getAddress());
    await validator.setServiceFee(await fot.getAddress(), 1000n);
    await fot.mint(deployer.address, 10_000n);
    await fot.approve(await fundManager.getAddress(), ethers.MaxUint256);
    await fundManager.setMaxFee(await fot.getAddress(), 1000n);
    await expect(deed.mintAsset(alice.address, 0, "", "d", "", ethers.ZeroAddress, await fot.getAddress(), 0))
      .to.be.revertedWith("FundManager: Fee-on-transfer token");
  });

  it("D-23: renderer display fields stay in the renderer (no double-encoded trait); a gallery trait no longer breaks tokenURI", async () => {
    const { deed, renderer, alice, deployer } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await renderer.connect(alice).setTokenCustomMetadata(id, '{"a":1}');
    await renderer.connect(deployer).setTokenGallery(id, ["ipfs://g1"]);
    expect(await deed.getTraitValue(id, k("customMetadata"))).to.equal("0x");
    expect(await renderer.getTokenGallery(id)).to.deep.equal(["ipfs://g1"]);
    // a holder-set `gallery` trait (a string[]) used to make tokenURI's attribute decoding revert
    await deed.connect(alice).setTrait(id, ethers.toUtf8Bytes("gallery"), coder.encode(["string[]"], [["ipfs://g2"]]), 0);
    const json = JSON.parse(Buffer.from((await deed.tokenURI(id)).split(",")[1], "base64").toString());
    expect(json.attributes.find((a: any) => a.trait_type === "Validation Status").value).to.equal("Valid");
  });

  it("D-23: removing a validator prunes it from the per-asset-type list", async () => {
    const { registry, operator2 } = ctx;
    await registry.registerValidator(operator2.address, "Temp", "", [0, 2]);
    expect(await registry.assetTypeValidators(0, 1)).to.equal(operator2.address);
    await registry.removeValidator(operator2.address);
    await expect(registry.assetTypeValidators(0, 1)).to.be.reverted; // only the original validator is left
    await expect(registry.assetTypeValidators(2, 1)).to.be.reverted;
  });

  it("D-23: a failed re-validation withdraws an earlier verdict", async () => {
    const { deed, alice, validator, deployer } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await deed.connect(deployer).setTrait(id, ethers.toUtf8Bytes("operatingAgreement"), ethers.toUtf8Bytes(AGREEMENT_BASE + "x"), 1);
    await expect(validator.validateDeed(id)).to.emit(validator, "ValidationError");
    expect((await deed.getValidationStatus(id))[0]).to.equal(false);
  });
});
