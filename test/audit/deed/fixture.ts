import { ethers, upgrades } from "hardhat";
import { deployDeedNFT } from "../../helpers/deed";

/*
 * Deed-track audit fixture. Mirrors deploy/deploy_all.ts wiring (registry -> renderer ->
 * validator -> DeedNFT -> FundManager -> Subdivide) plus deploy/06 (factory + Fractionalize).
 * Additions needed to exercise the flows: real validation criteria, a registered operating
 * agreement, Fractionalize approved as a marketplace, Validator compatible with Subdivide.
 *
 * Trust agreement v5 (Phase 3): a Functional Contract registry with Subdivide and Fractionalize, a
 * MembershipRegistry, an adopted agreement version for Land and Estate, and a licensed trustee. Land and
 * Estate deeds are trust deeds, minted with mintTrustDeed.
 */
export const BASE_URI = "https://api.example.com/validator/";
export const AGREEMENT_BASE = "https://api.example.com/agreements/";
export const AGREEMENT_V5 = ethers.keccak256(ethers.toUtf8Bytes("trust-agreement-v5.0"));
export const AGREEMENT_V5_URI = "ipfs://trust-agreement-v5.0";
export const k = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(s));
export const coder = ethers.AbiCoder.defaultAbiCoder();
export const enc = (s: string) => coder.encode(["string"], [s]);
export const dec = (b: string) => coder.decode(["string"], b)[0] as string;
export const KIND_CUSTODY = 1;
export const KIND_COOP_AGENT = 2;

export async function deployDeedTrack() {
  const s = await ethers.getSigners();
  const [deployer, alice, bob, carol, mallory, operator2, trustee, standby, sponsor] = s;

  const registry: any = await upgrades.deployProxy(await ethers.getContractFactory("ValidatorRegistry"), [], { kind: "uups" });
  const renderer: any = await upgrades.deployProxy(await ethers.getContractFactory("MetadataRenderer"), [], { kind: "uups" });
  const validator: any = await upgrades.deployProxy(await ethers.getContractFactory("Validator"), [BASE_URI, AGREEMENT_BASE], { kind: "uups" });
  const deed: any = await deployDeedNFT([await validator.getAddress(), await registry.getAddress()]);
  const trust: any = await ethers.getContractAt("IDeedTrust", await deed.getAddress());
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
  // v5: the agreement version is adopted per asset type, Land (0) and Estate (2) only.
  await validator.adoptAgreementVersion(0, AGREEMENT_V5, AGREEMENT_V5_URI, "Trust Agreement v5.0");
  await validator.adoptAgreementVersion(2, AGREEMENT_V5, AGREEMENT_V5_URI, "Trust Agreement v5.0");
  // A licensed trust company as trustee: eligible without validator powers.
  await registry.setLicensedTrustee(trustee.address, true, ethers.ZeroHash);
  await registry.setLicensedTrustee(standby.address, true, ethers.ZeroHash);

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

  // v5: Functional Contract registry (deployer stands in for the timelock and the Foundation multisig) and the
  // MembershipRegistry for the Verified policy.
  const fcRegistry: any = await (await ethers.getContractFactory("FunctionalContractRegistry")).deploy(deployer.address, deployer.address);
  await fcRegistry.register(await subdivide.getAddress(), KIND_CUSTODY);
  await fcRegistry.register(await fractionalize.getAddress(), KIND_CUSTODY);
  const membership: any = await upgrades.deployProxy(await ethers.getContractFactory("MembershipRegistry"), [deployer.address], { kind: "transparent" });
  await trust.setTrustRegistries(await fcRegistry.getAddress(), await membership.getAddress());

  return {
    deployer, alice, bob, carol, mallory, operator2, trustee, standby, sponsor,
    registry, renderer, validator, deed, trust, fundManager, subdivide, factory, fractionalize, fcRegistry, membership,
  };
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

export const NO_PROGRAM = {
  programId: ethers.ZeroHash,
  sponsor: ethers.ZeroAddress,
  titleAdministrator: ethers.ZeroAddress,
  paramsHash: ethers.ZeroHash,
  rofrPeriodDays: 0,
  completionWindowDays: 0,
  versionConsentRequired: false,
};

/** Default trust mint parameters; override any field. */
export function trustParams(ctx: Ctx, owner: any, over: Record<string, any> = {}) {
  return {
    owner: owner.address ?? owner,
    assetType: 0,
    definition: "Parcel 0123-456-78",
    parcelRef: k("San Bernardino|0123-456-78"),
    salt: 1n,
    agreementHash: AGREEMENT_V5,
    riderHashes: [] as string[],
    configuration: "",
    uri: "ipfs://fallback",
    validator: ethers.ZeroAddress,
    token: ethers.ZeroAddress,
    trustee: ctx.trustee.address,
    protector: ethers.ZeroAddress,
    transferPolicy: 0,
    program: NO_PROGRAM,
    ...over,
  };
}

export async function deedIdFor(ctx: Ctx, p: any): Promise<bigint> {
  const [id] = await ctx.trust.computeDeedId(
    p.assetType, k(p.definition), p.parcelRef, p.owner, p.salt, p.agreementHash, p.riderHashes
  );
  return id;
}

/** EIP-712 consent signature for the DeedNFT trust domain. */
export async function signTrust(ctx: Ctx, signer: any, primaryType: string, value: Record<string, any>) {
  const types: Record<string, any> = {
    TrusteeAcceptance: [
      { name: "tokenId", type: "uint256" }, { name: "trustee", type: "address" }, { name: "nonce", type: "uint256" },
    ],
    StandbyAcceptance: [
      { name: "tokenId", type: "uint256" }, { name: "standby", type: "address" }, { name: "nonce", type: "uint256" },
    ],
    AgreementConsent: [
      { name: "tokenId", type: "uint256" }, { name: "agreementHash", type: "bytes32" },
      { name: "ridersHash", type: "bytes32" }, { name: "nonce", type: "uint256" },
    ],
    CorrectionConsent: [
      { name: "tokenId", type: "uint256" }, { name: "definitionHash", type: "bytes32" },
      { name: "reasonHash", type: "bytes32" }, { name: "nonce", type: "uint256" },
    ],
    // Phase 4b (re-review M-F, M-G).
    RestoreConsent: [
      { name: "tokenId", type: "uint256" }, { name: "reasonHash", type: "bytes32" }, { name: "nonce", type: "uint256" },
    ],
    LicensingConsent: [
      { name: "tokenId", type: "uint256" }, { name: "standby", type: "address" },
      { name: "docHash", type: "bytes32" }, { name: "nonce", type: "uint256" },
    ],
    // Phase 4c (item 4): the second validator signer's consent to a freeze.
    FreezeConsent: [
      { name: "tokenId", type: "uint256" }, { name: "reasonCode", type: "uint8" },
      { name: "recordingRefHash", type: "bytes32" }, { name: "uriHash", type: "bytes32" }, { name: "nonce", type: "uint256" },
    ],
  };
  const domain = {
    name: "DeedNFT Trust",
    version: "5",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await ctx.deed.getAddress(),
  };
  return signer.signTypedData(domain, { [primaryType]: types[primaryType] }, value);
}

/** Phase 4c (item 4): makes `who` a second signer of the default validator, so a freeze has its two. */
export async function addValidatorSigner(ctx: Ctx, who: any) {
  await ctx.validator.grantRole(await ctx.validator.VALIDATOR_ROLE(), who.address);
}

/** Phase 4c (item 4): `cosigner`'s FreezeConsent signature for a freezing markVoid at the deed's current nonce. */
export async function signFreeze(ctx: Ctx, cosigner: any, tokenId: bigint, reasonCode: number, recordingRefHash: string, uri: string) {
  const nonce = (await ctx.trust.trustRecordOf(tokenId)).nonce;
  return signTrust(ctx, cosigner, "FreezeConsent", { tokenId, reasonCode, recordingRefHash, uriHash: k(uri), nonce });
}

/**
 * Phase 4c (item 4): a freezing void by two validator signers. `cosigner` (default operator2, made a signer
 * here) proposes by signing, `caller` (default the deployer) confirms.
 */
export async function freeze(ctx: Ctx, tokenId: bigint, reasonCode = 128, recordingRefHash = k("order"), uri = "ipfs://order", caller?: any, cosigner?: any) {
  const by = caller ?? ctx.deployer;
  const co = cosigner ?? ctx.operator2;
  await addValidatorSigner(ctx, co);
  const sig = await signFreeze(ctx, co, tokenId, reasonCode, recordingRefHash, uri);
  return ctx.trust.connect(by).markVoid(tokenId, reasonCode, recordingRefHash, uri, co.address, sig);
}

/** Mint a trust deed (Land by default) with the trustee's signed acceptance. Returns its ID. */
export async function mintTrust(ctx: Ctx, owner: any, over: Record<string, any> = {}, trusteeSigner?: any): Promise<bigint> {
  const p = trustParams(ctx, owner, over);
  const id = await deedIdFor(ctx, p);
  const resolvedTrustee = p.trustee !== ethers.ZeroAddress ? p.trustee : p.program.titleAdministrator;
  const signer = trusteeSigner ?? (await ethers.getSigner(resolvedTrustee));
  const sig = await signTrust(ctx, signer, "TrusteeAcceptance", { tokenId: id, trustee: resolvedTrustee, nonce: 0 });
  await ctx.trust.mintTrustDeed(p, sig);
  return id;
}

/** Mint a Land trust deed to `owner`, set the required traits as the owner, validate it. */
let autoSalt = 1000n;
export async function mintValidatedLand(ctx: Ctx, owner: any, salt = 0n, definition = "Parcel 0123-456-78", over: Record<string, any> = {}): Promise<bigint> {
  const id = await mintTrust(ctx, owner, { salt: salt === 0n ? ++autoSalt : salt, definition, ...over });
  for (const [name, val] of Object.entries(LAND_TRAITS)) {
    await ctx.deed.connect(owner).setTrait(id, ethers.toUtf8Bytes(name), ethers.toUtf8Bytes(val), 1);
  }
  await ctx.validator.validateDeed(id);
  return id;
}

/** Mint a legacy (non-trust) Vehicle deed via mintAsset. */
export async function mintVehicle(ctx: Ctx, owner: any, salt = 0n, definition = "VIN 1HGCM82633A004352"): Promise<bigint> {
  const tx = await ctx.deed.mintAsset(owner.address, 1, "ipfs://fallback", definition, "", ethers.ZeroAddress, ethers.ZeroAddress, salt);
  const rc = await tx.wait();
  const ev = rc.logs.map((l: any) => { try { return ctx.deed.interface.parseLog(l); } catch { return null; } })
    .find((e: any) => e && e.name === "DeedNFTMinted");
  return ev.args.tokenId;
}

export const VEHICLE_TRAITS: Record<string, string> = { make: "Honda", model: "Accord", year: "2003", vin: "1HGCM82633A004352" };

/**
 * Mint a legacy Vehicle deed, set its required traits as the owner, validate it. Since v5 every Land and Estate
 * deed is a trust deed with a locked definition and agreement, so the Phase 1 legacy-metadata rules (D-1, D-14,
 * D-15, ...) are exercised on Vehicle deeds, which keep them unchanged.
 */
export async function mintValidatedVehicle(ctx: Ctx, owner: any, salt = 0n, definition = "VIN 1HGCM82633A004352"): Promise<bigint> {
  const id = await mintVehicle(ctx, owner, salt, definition);
  for (const [name, val] of Object.entries(VEHICLE_TRAITS)) {
    await ctx.deed.connect(owner).setTrait(id, ethers.toUtf8Bytes(name), ethers.toUtf8Bytes(val), 1);
  }
  await ctx.validator.validateDeed(id);
  return id;
}
