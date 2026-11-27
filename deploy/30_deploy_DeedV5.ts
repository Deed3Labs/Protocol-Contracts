import { getDeployment, requireMainnetConfirmation, saveDeployment } from "./helpers";

/**
 * Deed v5 on a network whose DeedNFT predates the trust extensions: the upgrade, the Functional Contract
 * registry, and the two agents that move co-op deeds.
 *
 *   1. DeedNFT upgrade. Deploys DeedNFTMintExtension, DeedTrustExtension and DeedRolesExtension, validates the
 *      new implementation against the network's manifest and, with DEED_V5=1, upgrades the proxy from
 *      DEFAULT_ADMIN_ROLE (the deployer on Base Sepolia today; after deed_admin_handover.ts it is the Deed
 *      timelock, and this prints the call to propose instead). DeedNFT.json takes the v5 ABI; a prepared,
 *      not yet executed, implementation is recorded as DeedNFTV5.json.
 *   2. Fresh v5 satellites (deployFreshDeedSatellites): the old Validator, ValidatorRegistry and the rest predate
 *      v5 and the upgrades manifest, so new proxies replace them and the deed is pointed at them. The old ones
 *      lose every power over the deed and stay for the legacy deeds that name them (records: <Name>Legacy).
 *   2b. FunctionalContractRegistry, recorded. The new Subdivide and Fractionalize are registered as custody.
 *   3. CoopTransferAgent: the only route by which a Coop-policy deed changes hands, with the program
 *      sponsor's first-refusal window. Registered as custody + Coop agent.
 *   4. RedemptionAgent: holds a home's deed while its member pays toward it and hands it over when the
 *      HousingAllowanceRecord (deploy 29) shows the price reached. Registered as custody + Coop agent, and
 *      named the record's deed contract.
 *   5. DeedNFT.setTrustRegistries(FunctionalContractRegistry, MembershipRegistry). Set once, ever.
 *
 * Without DEED_V5=1 it validates and prints what it would do, deploying nothing.
 *
 * Deeds minted before v5 have no trust record and stay legacy deeds; trust deeds are minted fresh.
 *
 *   npx hardhat run deploy/30_deploy_DeedV5.ts --network base-sepolia            # validate only
 *   DEED_V5=1 npx hardhat run deploy/30_deploy_DeedV5.ts --network base-sepolia  # deploy and upgrade
 */

export const KIND_CUSTODY = 1;
export const KIND_COOP_AGENT = 2;

export async function prepareDeedUpgrade(o: { proxy: string; network?: string; execute: boolean; log?: (m: string) => void }) {
  const { ethers, upgrades } = require("hardhat");
  const log = o.log ?? console.log;
  const [signer] = await ethers.getSigners();
  const DeedNFT = await ethers.getContractFactory("DeedNFT");
  const unsafeAllow = ["constructor", "delegatecall", "state-variable-immutable"];
  await upgrades.validateUpgrade(o.proxy, DeedNFT, {
    kind: "uups",
    constructorArgs: [ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress],
    unsafeAllow,
  });
  log(`DeedNFT ${o.proxy}: the v5 implementation validates as an upgrade of what the manifest records`);
  if (!o.execute) return { implementation: undefined as string | undefined };

  const deploy = async (name: string) => {
    const c = await (await ethers.getContractFactory(name)).deploy();
    await c.waitForDeployment();
    log(`+ ${name.padEnd(26)} ${await c.getAddress()}`);
    return c.getAddress();
  };
  const ext = [await deploy("DeedNFTMintExtension"), await deploy("DeedTrustExtension"), await deploy("DeedRolesExtension")];
  const isAdmin = await (await ethers.getContractAt("DeedNFT", o.proxy)).hasRole(ethers.ZeroHash, signer.address);
  let implementation: string;
  if (isAdmin) {
    const upgraded = await upgrades.upgradeProxy(o.proxy, DeedNFT, { kind: "uups", constructorArgs: ext, unsafeAllow });
    await upgraded.waitForDeployment();
    implementation = await upgrades.erc1967.getImplementationAddress(o.proxy);
    log(`+ DeedNFT upgraded: implementation ${implementation}`);
  } else {
    implementation = (await upgrades.prepareUpgrade(o.proxy, DeedNFT, { kind: "uups", constructorArgs: ext, unsafeAllow })) as string;
    log(`DeedNFT implementation ${implementation} prepared. ${signer.address} is not DeedNFT's admin: propose`);
    log(`  to ${o.proxy}  data ${DeedNFT.interface.encodeFunctionData("upgradeTo", [implementation])}`);
  }
  if (o.network) {
    // Upgraded: the proxy's record takes the v5 ABI (DeedNFT plus the functions its extensions serve).
    // Only prepared: the implementation is recorded on its own until the timelock executes the upgrade.
    const abi = [
      ...JSON.parse(DeedNFT.interface.formatJson()),
      ...JSON.parse((await ethers.getContractAt("IDeedTrust", o.proxy)).interface.formatJson()),
    ];
    if (isAdmin) saveDeployment(o.network, "DeedNFT", o.proxy, abi);
    else saveDeployment(o.network, "DeedNFTV5", implementation, abi);
  }
  return { implementation, extensions: ext, upgraded: isAdmin };
}

export async function deployDeedV5Agents(o: {
  deed: string;
  membershipRegistry: string;
  housingRecord: string;
  subdivide?: string;
  fractionalize?: string;
  network?: string;
  log?: (m: string) => void;
}) {
  const { ethers } = require("hardhat");
  const log = o.log ?? console.log;
  const [deployer] = await ethers.getSigners();
  const record = (name: string) => (o.network ? getDeployment(o.network, name) : null);
  const save = async (name: string, c: any) => {
    if (o.network) saveDeployment(o.network, name, await c.getAddress(), JSON.parse(c.interface.formatJson()));
  };
  async function plain(name: string, args: unknown[]) {
    const r = record(name);
    if (r) {
      log(`= ${name.padEnd(26)} ${r.address}`);
      return ethers.getContractAt(name, r.address);
    }
    const c = await (await ethers.getContractFactory(name)).deploy(...args);
    await c.waitForDeployment();
    await save(name, c);
    log(`+ ${name.padEnd(26)} ${await c.getAddress()}`);
    return c;
  }

  const fc = await plain("FunctionalContractRegistry", [deployer.address, deployer.address]);
  const coop = await plain("CoopTransferAgent", [o.deed]);
  const redemption = await plain("RedemptionAgent", [o.deed, o.housingRecord]);

  const register = async (what: string, addr: string | undefined, kinds: number) => {
    if (!addr) return;
    const [k, active] = await fc.kindOf(addr);
    if (active && Number(k) === kinds) return log(`  = ${what} registered (${kinds})`);
    await (await fc.register(addr, kinds)).wait();
    log(`  + ${what} registered (${kinds})`);
  };
  await register("Subdivide", o.subdivide, KIND_CUSTODY);
  await register("Fractionalize", o.fractionalize, KIND_CUSTODY);
  await register("CoopTransferAgent", await coop.getAddress(), KIND_CUSTODY | KIND_COOP_AGENT);
  await register("RedemptionAgent", await redemption.getAddress(), KIND_CUSTODY | KIND_COOP_AGENT);

  // Set once, ever: the deed reads the registry for custody and Coop agents, and the membership registry
  // for the Verified policy.
  const trust = await ethers.getContractAt("DeedTrustExtension", o.deed);
  await (await trust.setTrustRegistries(await fc.getAddress(), o.membershipRegistry)).wait();
  log("  + DeedNFT.setTrustRegistries(FunctionalContractRegistry, MembershipRegistry)");

  // Only the RedemptionAgent may mark a home redeemed.
  const housing = await ethers.getContractAt("HousingAllowanceRecord", o.housingRecord);
  const agentAddr = await redemption.getAddress();
  if ((await housing.deedContract()).toLowerCase() === agentAddr.toLowerCase()) {
    log("  = HousingAllowanceRecord's deed contract is the RedemptionAgent");
  } else if (await housing.hasRole(ethers.ZeroHash, deployer.address)) {
    await (await housing.setDeedContract(agentAddr)).wait();
    log("  + HousingAllowanceRecord.setDeedContract(RedemptionAgent)");
  } else {
    log(`  ! the record's admin is the timelock: propose setDeedContract(${agentAddr}) on ${o.housingRecord}`);
  }
  return { fc, coop, redemption };
}

const DEED_IMAGES = {
  land: "ipfs://bafkreihdwdcbvm3ph3hg4bxplmyqhybmuwgiaroxnqmup76ixlqy4pf6gi",
  vehicle: "ipfs://bafkreig42cjzl6gn4w7q4sltmildfyh3m3wojrjp4egoqvfnxqcrmv5z3i",
  equipment: "ipfs://bafkreifo4ugpkguglxwalzrznhvip5gqvgzqyqcqvz2lecwubsu7t4qhyq",
  invalidated: "ipfs://bafkreiabag3ztnhe5pg7js4bj6sxuvkz3sdf34utvoyk7q7bhngrgxqxym",
};

/**
 * Fresh v5 satellites around an upgraded DeedNFT: ValidatorRegistry, MetadataRenderer, Validator, FundManager,
 * Subdivide, FractionTokenFactory and Fractionalize, wired to the deed and the deed to them. The old satellites
 * predate v5 (no agreement versions, no trustee eligibility) and are left in place for the legacy deeds that name
 * them, but lose every power over the deed: the old validator's VALIDATOR_ROLE and the old Subdivide's and
 * Fractionalize's marketplace approvals are withdrawn. Their records are kept as <Name>Legacy.
 *
 * Needs DEFAULT_ADMIN_ROLE on the deed. Adopting the trust agreement version is a separate step
 * (scripts/adopt_trust_agreement.ts) once its content hash and URI are fixed.
 */
export async function deployFreshDeedSatellites(o: {
  deed: string;
  validatorBaseUri: string;
  agreementUri: string;
  oldValidator?: string;
  oldSubdivide?: string;
  oldFractionalize?: string;
  network?: string;
  log?: (m: string) => void;
}) {
  const { ethers, upgrades } = require("hardhat");
  const log = o.log ?? console.log;
  const [deployer] = await ethers.getSigners();
  const deed = await ethers.getContractAt("DeedNFT", o.deed);
  if (!(await deed.hasRole(ethers.ZeroHash, deployer.address))) throw new Error(`${deployer.address} is not DeedNFT's admin`);

  const keepLegacy = (name: string) => {
    if (!o.network) return;
    const old = getDeployment(o.network, name);
    if (old && !getDeployment(o.network, `${name}Legacy`)) saveDeployment(o.network, `${name}Legacy`, old.address, old.abi);
  };
  const proxy = async (name: string, args: unknown[]) => {
    const c = await upgrades.deployProxy(await ethers.getContractFactory(name), args, { initializer: "initialize", kind: "uups" });
    await c.waitForDeployment();
    if (o.network) {
      keepLegacy(name);
      saveDeployment(o.network, name, await c.getAddress(), JSON.parse(c.interface.formatJson()));
    }
    log(`+ ${name.padEnd(26)} ${await c.getAddress()}`);
    return c;
  };
  const send = async (label: string, txp: Promise<any>) => {
    await (await txp).wait();
    log(`  + ${label}`);
  };

  const registry = await proxy("ValidatorRegistry", []);
  const renderer = await proxy("MetadataRenderer", []);
  const validator = await proxy("Validator", [o.validatorBaseUri, o.agreementUri]);
  const R = await registry.getAddress();
  const V = await validator.getAddress();

  await send("registry -> DeedNFT", registry.setDeedNFT(o.deed));
  await send("validator -> DeedNFT", validator.setDeedNFT(o.deed));
  await send("renderer -> DeedNFT", renderer.setDeedNFT(o.deed));
  await send("DeedNFT -> registry", deed.setValidatorRegistry(R));
  await send("DeedNFT -> renderer", deed.setMetadataRenderer(await renderer.getAddress()));
  await send("image Land", renderer.setAssetTypeImageURI(0, DEED_IMAGES.land));
  await send("image Vehicle", renderer.setAssetTypeImageURI(1, DEED_IMAGES.vehicle));
  await send("image Estate", renderer.setAssetTypeImageURI(2, DEED_IMAGES.land));
  await send("image Equipment", renderer.setAssetTypeImageURI(3, DEED_IMAGES.equipment));
  await send("image invalidated", renderer.setInvalidatedImageURI(DEED_IMAGES.invalidated));

  const fundManager = await proxy("FundManager", [R, 500, deployer.address]);
  const FM = await fundManager.getAddress();
  await send("registry -> FundManager", registry.setFundManager(FM));
  await send("FundManager accepts DeedNFT", fundManager.addCompatibleDeedNFT(o.deed));
  await send("validator -> FundManager", validator.setFundManager(FM));
  // A FundManager on the deed makes every mint charge a fee; only move the deed to the new one if it had one.
  if ((await deed.fundManager()) !== ethers.ZeroAddress) await send("DeedNFT -> FundManager", deed.setFundManager(FM));

  for (const t of [0, 1, 2, 3]) await send(`criteria for asset type ${t}`, validator.setupValidationCriteria(t));
  await send("register default agreement", validator.registerOperatingAgreement(o.agreementUri, "Deed Trust Agreement"));
  // Activation grants the validator DeedNFT's VALIDATOR_ROLE through the registry.
  await send("register validator", registry.registerValidator(V, "Default Validator", "Default deed validator", [0, 1, 2, 3]));
  await send("activate validator", registry.updateValidatorStatus(V, true));
  await send("DeedNFT default validator", deed.setDefaultValidator(V));

  const subdivide = await proxy("Subdivide", [o.deed, R]);
  const S = await subdivide.getAddress();
  await send("Subdivide VALIDATOR_ROLE -> validator", subdivide.grantRole(await subdivide.VALIDATOR_ROLE(), V));
  await send("validator accepts Subdivide units", validator.addCompatibleDeedNFT(S));
  await send("DeedNFT approves Subdivide (custody)", deed.setApprovedMarketplace(S, true));
  const factory = await proxy("FractionTokenFactory", [deployer.address]);
  const fractionalize = await proxy("Fractionalize", [o.deed, S, await factory.getAddress()]);
  const F = await fractionalize.getAddress();
  await send("factory -> Fractionalize", factory.updateFractionalizeContract(F));
  await send("DeedNFT approves Fractionalize (custody)", deed.setApprovedMarketplace(F, true));
  await send("Subdivide approves Fractionalize (custody)", subdivide.setApprovedMarketplace(F, true));

  // The old satellites keep no power over the deed.
  const VALIDATOR_ROLE = await deed.VALIDATOR_ROLE();
  if (o.oldValidator && (await deed.hasRole(VALIDATOR_ROLE, o.oldValidator))) {
    await send("old validator loses VALIDATOR_ROLE", deed.removeValidator(o.oldValidator));
  }
  for (const [what, a] of [["old Subdivide", o.oldSubdivide], ["old Fractionalize", o.oldFractionalize]] as const) {
    if (a && (await deed.isApprovedMarketplace(a))) await send(`${what} loses marketplace approval`, deed.setApprovedMarketplace(a, false));
  }
  return { registry, renderer, validator, fundManager, subdivide, factory, fractionalize };
}

async function main() {
  const { ethers } = require("hardhat");
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;
  requireMainnetConfirmation(network, "deploy/30_deploy_DeedV5.ts");
  const need = (name: string) => {
    const r = getDeployment(network, name);
    if (!r) throw new Error(`No ${name} recorded for ${network}.`);
    return r.address;
  };
  const execute = process.env.DEED_V5 === "1";
  const deed = need("DeedNFT");
  // Read the old satellites before the upgrade, and before their records move to <Name>Legacy.
  const oldValidator = need("Validator");
  const oldV = await ethers.getContractAt("Validator", oldValidator);
  const validatorBaseUri = process.env.DEED_VALIDATOR_URI || (await oldV.baseUri());
  const agreementUri = process.env.DEED_AGREEMENT_URI || (await oldV.defaultOperatingAgreementUri());
  console.log(`validator URI ${validatorBaseUri}, default agreement URI ${agreementUri}`);
  const up = await prepareDeedUpgrade({ proxy: deed, network, execute });
  if (!execute) {
    console.log(`\nValidated only: nothing deployed. DEED_V5=1 would deploy the three extensions and upgrade DeedNFT,
deploy fresh v5 satellites (ValidatorRegistry, MetadataRenderer, Validator, FundManager, Subdivide,
FractionTokenFactory, Fractionalize) and point the deed at them, withdraw the old ones' powers over the deed,
then deploy FunctionalContractRegistry, CoopTransferAgent and RedemptionAgent, register them with the new
Subdivide and Fractionalize, set DeedNFT's trust registries once, and name the RedemptionAgent the record's
deed contract.`);
    return;
  }
  if (!up.upgraded) {
    console.log("\nDeedNFT is not upgraded yet (propose the call above); run this again once it is.");
    return;
  }
  const sat = await deployFreshDeedSatellites({
    deed,
    validatorBaseUri,
    agreementUri,
    oldValidator,
    oldSubdivide: getDeployment(network, "Subdivide")?.address,
    oldFractionalize: getDeployment(network, "Fractionalize")?.address,
    network,
  });
  await deployDeedV5Agents({
    deed,
    membershipRegistry: need("MembershipRegistry"),
    housingRecord: need("HousingAllowanceRecord"),
    subdivide: await sat.subdivide.getAddress(),
    fractionalize: await sat.fractionalize.getAddress(),
    network,
  });
  console.log(`\nleft to do: adopt the trust agreement version for Land and Estate (scripts/adopt_trust_agreement.ts),
then deed_admin_handover.ts (the Deed track to the Deed timelock), when Kai chooses.`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
