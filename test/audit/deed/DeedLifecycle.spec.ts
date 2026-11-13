import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployDeedTrack, mintValidatedLand, k, dec, coder, Ctx } from "./fixture";

/*
 * Deed-track audit PoCs: token ids, burn, transfer policy, pause, fees, factory.
 * Every test PASSES while the issue exists.
 */
describe("AUDIT deed: lifecycle, ids, transfers", function () {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await deployDeedTrack(); });

  it("D-09 a burned salted id is re-minted; it inherits the old renderer legal record and the old live subdivision", async () => {
    const { deed, renderer, subdivide, alice, carol, deployer } = ctx;
    const salt = 777n;
    const def = "Parcel 0123-456-78";
    const id = await deed.generateUniqueTokenId(alice.address, 0, def, salt);
    expect(id).to.be.lessThan(1_000_000_000n);
    await mintValidatedLand(ctx, alice, salt, def);

    await renderer.connect(deployer).setTokenLegalInfo(id, "CA", "DOC-OLD", "2020-01-01", ["ipfs://old-grant-deed"], [], "");
    await subdivide.connect(alice).createSubdivision(id, "Old tract", "", "OLD", "ipfs://old", 10, true);
    await subdivide.connect(alice).mintUnit(id, 0, carol.address);

    // Burn: emits only DeedNFTBurned(tokenId) (plus ERC721 Transfer), deletes DeedNFT traits
    const rc = await (await deed.connect(alice).burnAsset(id)).wait();
    const names = rc.logs.map((l: any) => { try { return deed.interface.parseLog(l)?.name; } catch { return null; } }).filter(Boolean);
    expect(names).to.deep.equal(["Transfer", "DeedNFTBurned"]);

    // Same id minted again (same inputs, or any input colliding mod 1e9)
    await deed.mintAsset(alice.address, 0, "", def, "", ethers.ZeroAddress, ethers.ZeroAddress, salt);
    expect(await deed.ownerOf(id)).to.equal(alice.address);
    expect((await deed.getValidationStatus(id))[0]).to.equal(false);

    const info = await renderer.getTokenLegalInfo(id);
    expect(info.registrationNumber).to.equal("DOC-OLD");               // stale record on the new deed
    expect(await subdivide.subdivisionExists(id)).to.equal(true);       // old subdivision still live
    expect(await subdivide.ownerOf((id << 128n) | 0n)).to.equal(carol.address);
    // the new deed's owner can keep minting units of the OLD subdivision without re-validation
    await subdivide.connect(alice).mintUnit(id, 1, alice.address);
    expect(await subdivide.ownerOf((id << 128n) | 1n)).to.equal(alice.address);
  });

  it("D-10 burnAsset is whenNotPaused; transfers and setTrait are not", async () => {
    const { deed, alice, bob, deployer } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await deed.connect(deployer).pause();
    await expect(deed.connect(alice).burnAsset(id)).to.be.revertedWith("Pausable: paused");
    await deed.connect(alice).setTrait(id, ethers.toUtf8Bytes("legalDescription"), ethers.toUtf8Bytes("edited while paused"), 1);
    await deed.connect(alice).transferFrom(alice.address, bob.address, id);
    expect(await deed.ownerOf(id)).to.equal(bob.address);
  });

  it("D-11 transfer overwrites `beneficiary` with whatever receives the deed (custody contract, escrow)", async () => {
    const { deed, fractionalize, alice } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    expect(coder.decode(["address"], await deed.getTraitValue(id, k("beneficiary")))[0]).to.equal(alice.address);
    await deed.connect(alice).approve(await fractionalize.getAddress(), id);
    await fractionalize.connect(alice).createFraction({
      assetType: 0, originalTokenId: id, name: "F", description: "", symbol: "F", collectionUri: "",
      totalShares: 100, burnable: true, approvalPercentage: 51,
    });
    expect(coder.decode(["address"], await deed.getTraitValue(id, k("beneficiary")))[0]).to.equal(await fractionalize.getAddress());
  });

  it("D-12 stored ERC721-C transfer validator is never consulted; only the !mkt list gates transfers", async () => {
    const { deed, alice, bob, carol, deployer } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    // Point the transfer validator at an address with no code: any real call to it would revert.
    await deed.connect(deployer).setTransferValidator("0x000000000000000000000000000000000000dEaD");
    await deed.connect(alice).transferFrom(alice.address, bob.address, id);        // owner-sent: allowed
    expect(await deed.ownerOf(id)).to.equal(bob.address);

    // Non-marketplace operator cannot be approved and cannot move the deed...
    await expect(deed.connect(bob).approve(carol.address, id)).to.be.revertedWith("!mkt");
    // ...and the owner cannot even clear a single-token approval with approve(address(0))
    await expect(deed.connect(bob).approve(ethers.ZeroAddress, id)).to.be.revertedWith("!mkt");
    // an approved marketplace becomes an ordinary operator once the owner approves it
    await deed.connect(deployer).setApprovedMarketplace(carol.address, true);
    await deed.connect(bob).approve(carol.address, id);
    await deed.connect(carol).transferFrom(bob.address, carol.address, id);
    expect(await deed.ownerOf(id)).to.equal(carol.address);
  });

  it("D-13 validator FEE_MANAGER can raise the mint fee between approval and mint; mintAsset has no max-fee bound", async () => {
    const { deed, validator, fundManager, deployer, alice } = ctx;
    const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD", "USD", 6);
    await deed.setFundManager(await fundManager.getAddress());
    await fundManager.addCompatibleDeedNFT(await deed.getAddress());
    await fundManager.setFeeReceiver(ctx.bob.address); // keep the minter's balance delta clean
    await validator.setFundManager(await fundManager.getAddress());
    await validator.addWhitelistedToken(await usdc.getAddress());
    await validator.setServiceFee(await usdc.getAddress(), 100n * 10n ** 6n);
    await usdc.mint(deployer.address, 1_000_000n * 10n ** 6n);
    await usdc.approve(await fundManager.getAddress(), ethers.MaxUint256);   // minter's standing approval

    await validator.setServiceFee(await usdc.getAddress(), 900_000n * 10n ** 6n); // fee manager changes fee
    const bal0 = await usdc.balanceOf(deployer.address);
    await deed.mintAsset(alice.address, 0, "", "def", "", ethers.ZeroAddress, await usdc.getAddress(), 0);
    expect(bal0 - (await usdc.balanceOf(deployer.address))).to.equal(900_000n * 10n ** 6n);
  });

  it("D-14 ValidatorFactory.createValidator always reverts (Validator disables initializers)", async () => {
    const { registry, fundManager, deployer } = ctx;
    const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD", "USD", 6);
    const VF = await ethers.getContractFactory("ValidatorFactory");
    const vf: any = await upgrades.deployProxy(VF, [await registry.getAddress(), await fundManager.getAddress(), [await usdc.getAddress()]], { kind: "uups" });
    await registry.transferOwnership(await vf.getAddress());
    await expect(vf.createValidator("v", "d", [0], 1, 1, "ipfs://b/", "ipfs://oa/"))
      .to.be.revertedWith("Initializable: contract is already initialized");
  });

  it("D-15 MetadataRenderer and FundManager implementations can be initialized by anyone (no _disableInitializers)", async () => {
    const { mallory, registry } = ctx;
    const r: any = await (await ethers.getContractFactory("MetadataRenderer")).deploy();
    await r.connect(mallory).initialize();
    expect(await r.owner()).to.equal(mallory.address);
    const f: any = await (await ethers.getContractFactory("FundManager")).deploy();
    await f.connect(mallory).initialize(await registry.getAddress(), 10000, mallory.address);
    expect(await f.hasRole(ethers.ZeroHash, mallory.address)).to.equal(true);
    // OZ 4.9 onlyProxy stops upgradeTo on the bare implementation, which keeps this Low
    await expect(r.connect(mallory).upgradeTo(mallory.address)).to.be.revertedWith("Function must be called through delegatecall");
  });
});
