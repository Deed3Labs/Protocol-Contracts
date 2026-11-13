import { expect } from "chai";
import { ethers, upgrades, artifacts } from "hardhat";
import { deployDeedTrack, mintValidatedLand, subdivideDeed, k, dec, coder, Ctx } from "./fixture";

/*
 * Deed-track audit regressions: token ids, burn, transfer policy, pause, fees, factory.
 * These were exploit PoCs that PASSED while each bug existed; each now asserts the attack FAILS.
 * Spec labels (D-09 ...) differ from the report's finding IDs; each title names the report ID.
 */
describe("AUDIT deed: lifecycle, ids, transfers", function () {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await deployDeedTrack(); });

  // Report D-8 (spec label D-09)
  it("D-8: a burned id can never be minted again; salted ids live outside the sequential range; a subdivided parent cannot be burned", async () => {
    const { deed, renderer, alice, carol, deployer } = ctx;
    const salt = 777n;
    const def = "Parcel 0123-456-78";
    const id = await deed.generateUniqueTokenId(alice.address, 0, def, salt);
    expect(id >= 2n ** 127n && id < 2n ** 128n).to.equal(true);   // not 9 digits, not sequential, fits Subdivide packing
    await mintValidatedLand(ctx, alice, salt, def);
    expect(await deed.wasEverMinted(id)).to.equal(true);
    await renderer.connect(deployer).setTokenLegalInfo(id, "CA", "DOC-OLD", "2020-01-01", ["ipfs://old-grant-deed"], [], "");

    // While subdivided, the parent sits in Subdivide and cannot be burned
    await subdivideDeed(ctx, alice, id, 10, true);
    await ctx.subdivide.connect(alice).mintUnit(id, 0, carol.address);
    await expect(deed.connect(alice).burnAsset(id)).to.be.revertedWith("Not deed owner");
    await ctx.subdivide.connect(carol).burnUnit(id, 0);
    await ctx.subdivide.connect(alice).deactivateSubdivision(id);

    await deed.connect(alice).burnAsset(id);
    // Same id cannot be minted again, by the same inputs or any other route
    await expect(deed.mintAsset(alice.address, 0, "", def, "", ethers.ZeroAddress, ethers.ZeroAddress, salt))
      .to.be.revertedWith("Token ID already exists");
    expect(await deed.wasEverMinted(id)).to.equal(true);

    // Sequential minting keeps working and never lands on a salted id
    const rc = await (await deed.mintAsset(alice.address, 0, "", "seq", "", ethers.ZeroAddress, ethers.ZeroAddress, 0)).wait();
    const ev = rc.logs.map((l: any) => { try { return deed.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "DeedNFTMinted");
    expect(ev.args.tokenId < 2n ** 127n).to.equal(true);
  });

  // Report D-17 (spec label D-10)
  it("D-17: pause no longer blocks the owner's burn, and does block metadata writes; transfers stay open by policy", async () => {
    const { deed, alice, bob, deployer } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    const id2 = await mintValidatedLand(ctx, alice, 0n, "Second parcel");
    await deed.connect(deployer).pause();
    await expect(deed.connect(alice).setTrait(id, ethers.toUtf8Bytes("nickname"), ethers.toUtf8Bytes("x"), 1))
      .to.be.revertedWith("Pausable: paused");
    await expect(deed.connect(alice).removeTrait(id, "country")).to.be.revertedWith("Pausable: paused");
    await expect(ctx.validator.validateDeed(id)).to.be.revertedWith("Pausable: paused");
    // Policy: holders keep custody rights while paused (transfer and burn)
    await deed.connect(alice).transferFrom(alice.address, bob.address, id);
    expect(await deed.ownerOf(id)).to.equal(bob.address);
    await deed.connect(alice).burnAsset(id2);
    await expect(deed.ownerOf(id2)).to.be.reverted;
  });

  // Report D-19 (spec label D-11)
  it("D-19: a deed moving into a custody contract keeps its depositor as beneficiary", async () => {
    const { deed, fractionalize, alice, bob } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    expect(coder.decode(["address"], await deed.getTraitValue(id, k("beneficiary")))[0]).to.equal(alice.address);
    await deed.connect(alice).approve(await fractionalize.getAddress(), id);
    await fractionalize.connect(alice).createFraction({
      assetType: 0, originalTokenId: id, name: "F", description: "", symbol: "F", collectionUri: "",
      totalShares: 100, burnable: true, approvalPercentage: 51,
    });
    expect(await deed.ownerOf(id)).to.equal(await fractionalize.getAddress());
    expect(coder.decode(["address"], await deed.getTraitValue(id, k("beneficiary")))[0]).to.equal(alice.address);
    // leaving custody to a new holder updates it
    await fractionalize.connect(alice).unlockAsset({ fractionId: 1, to: bob.address, checkApprovals: false });
    expect(coder.decode(["address"], await deed.getTraitValue(id, k("beneficiary")))[0]).to.equal(bob.address);
  });

  // Report D-18 (spec label D-12)
  it("D-18: ICreatorToken is no longer advertised, and an owner can clear a token approval", async () => {
    const { deed, alice, bob, carol, deployer } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    const art = await artifacts.readArtifact("ICreatorToken");
    const iface = new ethers.Interface(art.abi);
    let ifaceId = 0n;
    iface.forEachFunction((f) => { ifaceId ^= BigInt(f.selector); });
    expect(await deed.supportsInterface(ethers.toBeHex(ifaceId, 4))).to.equal(false);

    await deed.connect(deployer).setApprovedMarketplace(carol.address, true);
    await deed.connect(alice).approve(carol.address, id);
    await deed.connect(alice).approve(ethers.ZeroAddress, id);
    expect(await deed.getApproved(id)).to.equal(ethers.ZeroAddress);
    // non-marketplace approvals still refused under enforcement
    await expect(deed.connect(alice).approve(bob.address, id)).to.be.revertedWith("!mkt");
  });

  // Report D-16 (spec label D-13)
  it("D-16: mint fees are bounded by the minter: a raised fee reverts instead of draining the allowance", async () => {
    const { deed, validator, fundManager, deployer, alice } = ctx;
    const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD", "USD", 6);
    await deed.setFundManager(await fundManager.getAddress());
    await fundManager.addCompatibleDeedNFT(await deed.getAddress());
    await fundManager.setFeeReceiver(ctx.bob.address);
    await validator.setFundManager(await fundManager.getAddress());
    await validator.addWhitelistedToken(await usdc.getAddress());
    await validator.setServiceFee(await usdc.getAddress(), 100n * 10n ** 6n);
    await usdc.mint(deployer.address, 1_000_000n * 10n ** 6n);
    await usdc.approve(await fundManager.getAddress(), ethers.MaxUint256);   // minter's standing approval

    await validator.setServiceFee(await usdc.getAddress(), 900_000n * 10n ** 6n); // fee manager raises the fee
    const bal0 = await usdc.balanceOf(deployer.address);
    await expect(deed.mintAssetWithMaxFee(alice.address, 0, "", "def", "", ethers.ZeroAddress, await usdc.getAddress(), 0, 100n * 10n ** 6n))
      .to.be.revertedWithCustomError(deed, "FeeAboveMax").withArgs(900_000n * 10n ** 6n, 100n * 10n ** 6n);
    // the unbounded entry point no longer pays any fee
    await expect(deed.mintAsset(alice.address, 0, "", "def", "", ethers.ZeroAddress, await usdc.getAddress(), 0))
      .to.be.revertedWithCustomError(deed, "FeeAboveMax");
    expect(await usdc.balanceOf(deployer.address)).to.equal(bal0);
    // at the agreed fee it works
    await validator.setServiceFee(await usdc.getAddress(), 100n * 10n ** 6n);
    await deed.mintAssetWithMaxFee(alice.address, 0, "", "def", "", ethers.ZeroAddress, await usdc.getAddress(), 0, 100n * 10n ** 6n);
    expect(bal0 - (await usdc.balanceOf(deployer.address))).to.equal(100n * 10n ** 6n);
  });

  // Report D-22 (spec label D-14)
  it("D-22: ValidatorFactory.createValidator deploys a working proxy and hands every role to the caller", async () => {
    const { registry, fundManager, operator2 } = ctx;
    const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD", "USD", 6);
    const VF = await ethers.getContractFactory("ValidatorFactory");
    const vf: any = await upgrades.deployProxy(VF, [await registry.getAddress(), await fundManager.getAddress(), [await usdc.getAddress()]], { kind: "uups" });
    const impl = await (await ethers.getContractFactory("Validator")).deploy();
    await expect(vf.createValidator("v", "d", [0], 1, 1, "ipfs://b/", "ipfs://oa/")).to.be.revertedWith("Validator implementation not set");
    await vf.setValidatorImplementation(await impl.getAddress());

    const tx = await vf.connect(operator2).createValidator("v", "d", [0], 1, 7n, "ipfs://b/", "ipfs://oa/");
    const rc = await tx.wait();
    const ev = rc.logs.map((l: any) => { try { return vf.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "ValidatorCreatedFor");
    const v: any = await ethers.getContractAt("Validator", ev.args.validator);
    const vfAddr = await vf.getAddress();
    expect(await v.owner()).to.equal(operator2.address);
    for (const role of [await v.DEFAULT_ADMIN_ROLE(), await v.VALIDATOR_ROLE(), await v.METADATA_ROLE(), await v.CRITERIA_MANAGER_ROLE(), await v.FEE_MANAGER_ROLE()]) {
      expect(await v.hasRole(role, operator2.address)).to.equal(true);
      expect(await v.hasRole(role, vfAddr)).to.equal(false);
    }
    expect(await v.getRoyaltyReceiver()).to.equal(operator2.address);
    expect(await v.getServiceFee(await usdc.getAddress())).to.equal(7n);
    expect(await v.royaltyFeePercentage()).to.equal(100n);
    // registration and activation stay with the registry owner
    expect(await registry.isValidatorRegistered(ev.args.validator)).to.equal(false);
    // the creator can operate and upgrade it
    await v.connect(operator2).setBaseUri("ipfs://b2/");
  });

  // Report D-20 (spec label D-15)
  it("D-20: MetadataRenderer and FundManager implementations cannot be initialized by anyone", async () => {
    const { mallory, registry } = ctx;
    const r: any = await (await ethers.getContractFactory("MetadataRenderer")).deploy();
    await expect(r.connect(mallory).initialize()).to.be.revertedWith("Initializable: contract is already initialized");
    const f: any = await (await ethers.getContractFactory("FundManager")).deploy();
    await expect(f.connect(mallory).initialize(await registry.getAddress(), 500, mallory.address))
      .to.be.revertedWith("Initializable: contract is already initialized");
  });
});
