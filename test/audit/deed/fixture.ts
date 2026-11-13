import { ethers, upgrades } from "hardhat";

/*
 * Deed-track audit fixture. Mirrors deploy/deploy_all.ts wiring (registry -> renderer ->
 * validator -> DeedNFT -> FundManager -> Subdivide) plus deploy/06 (factory + Fractionalize).
 * Additions needed to exercise the flows: real validation criteria, a registered operating
 * agreement, Fractionalize approved as a marketplace, Validator compatible with Subdivide.
 */
export const BASE_URI = "https://api.example.com/validator/";
export const AGREEMENT_BASE = "https://api.example.com/agreements/";
export const k = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(s));
export const coder = ethers.AbiCoder.defaultAbiCoder();
export const enc = (s: string) => coder.encode(["string"], [s]);
export const dec = (b: string) => coder.decode(["string"], b)[0] as string;

export async function deployDeedTrack() {
  const s = await ethers.getSigners();
  const [deployer, alice, bob, carol, mallory, operator2] = s;

  const registry: any = await upgrades.deployProxy(await ethers.getContractFactory("ValidatorRegistry"), [], { kind: "uups" });
  const renderer: any = await upgrades.deployProxy(await ethers.getContractFactory("MetadataRenderer"), [], { kind: "uups" });
  const validator: any = await upgrades.deployProxy(await ethers.getContractFactory("Validator"), [BASE_URI, AGREEMENT_BASE], { kind: "uups" });
  const deed: any = await upgrades.deployProxy(
    await ethers.getContractFactory("DeedNFT"),
    [await validator.getAddress(), await registry.getAddress()],
    { kind: "uups" }
  );
  await registry.setDeedNFT(await deed.getAddress());
  await validator.setDeedNFT(await deed.getAddress());
  await renderer.setDeedNFT(await deed.getAddress());
  await deed.setMetadataRenderer(await renderer.getAddress());

  const fundManager: any = await upgrades.deployProxy(
    await ethers.getContractFactory("FundManager"),
    [await registry.getAddress(), 500, deployer.address],
    { kind: "uups" }
  );
  await registry.setFundManager(await fundManager.getAddress());

  await registry.registerValidator(await validator.getAddress(), "Default Validator", "d", [0, 1, 2, 3]);
  await registry.updateValidatorStatus(await validator.getAddress(), true);
  for (const t of [0, 1, 2, 3]) await validator.setupValidationCriteria(t);
  await validator.registerOperatingAgreement(AGREEMENT_BASE, "Trust Agreement v5");

  const subdivide: any = await upgrades.deployProxy(
    await ethers.getContractFactory("Subdivide"),
    [await deed.getAddress(), await registry.getAddress()],
    { kind: "uups" }
  );
  await subdivide.grantRole(await subdivide.VALIDATOR_ROLE(), await validator.getAddress());
  await validator.addCompatibleDeedNFT(await subdivide.getAddress());

  const factory: any = await upgrades.deployProxy(
    await ethers.getContractFactory("FractionTokenFactory"), [deployer.address], { kind: "uups" });
  const fractionalize: any = await upgrades.deployProxy(
    await ethers.getContractFactory("Fractionalize"),
    [await deed.getAddress(), await subdivide.getAddress(), await factory.getAddress()],
    { kind: "uups" }
  );
  await factory.updateFractionalizeContract(await fractionalize.getAddress());
  // Without this, createFraction reverts "!mkt" (royalty enforcement is on by default).
  await deed.setApprovedMarketplace(await fractionalize.getAddress(), true);
  // After the D-9 fix Subdivide takes custody of the parent deed, so it is a custody contract on DeedNFT
  // too; and after the D-17 fix Subdivide enforces its own marketplace list, so Fractionalize must be on it
  // to pull a unit (D-21).
  await deed.setApprovedMarketplace(await subdivide.getAddress(), true);
  await subdivide.setApprovedMarketplace(await fractionalize.getAddress(), true);

  return { deployer, alice, bob, carol, mallory, operator2, registry, renderer, validator, deed, fundManager, subdivide, factory, fractionalize };
}

export type Ctx = Awaited<ReturnType<typeof deployDeedTrack>>;

/** Subdivide a deed: the holder approves Subdivide, which takes custody of the parent (D-9 fix). */
export async function subdivideDeed(ctx: Ctx, owner: any, id: bigint, units = 5, burnable = true) {
  await ctx.deed.connect(owner).approve(await ctx.subdivide.getAddress(), id);
  await ctx.subdivide.connect(owner).createSubdivision(id, "Tract", "", "TR", "ipfs://tr", units, burnable);
}

export const LAND_TRAITS: Record<string, string> = {
  country: "US",
  state: "CA",
  county: "San Bernardino",
  parcelNumber: "0123-456-78",
  legalDescription: "LOT 12, BLOCK 3, TRACT 4567, AS PER MAP RECORDED IN BOOK 60 PAGE 12",
};

/** Mint a Land deed to `owner` (sequential id), set the required traits as the owner, validate it. */
export async function mintValidatedLand(ctx: Ctx, owner: any, salt = 0n, definition = "Parcel 0123-456-78"): Promise<bigint> {
  const tx = await ctx.deed.mintAsset(owner.address, 0, "ipfs://fallback", definition, "", ethers.ZeroAddress, ethers.ZeroAddress, salt);
  const rc = await tx.wait();
  const ev = rc.logs.map((l: any) => { try { return ctx.deed.interface.parseLog(l); } catch { return null; } })
    .find((e: any) => e && e.name === "DeedNFTMinted");
  const id: bigint = ev.args.tokenId;
  for (const [name, val] of Object.entries(LAND_TRAITS)) {
    await ctx.deed.connect(owner).setTrait(id, ethers.toUtf8Bytes(name), ethers.toUtf8Bytes(val), 1);
  }
  await ctx.validator.validateDeed(id);
  return id;
}
