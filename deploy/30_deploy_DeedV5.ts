import { getDeployment, requireMainnetConfirmation, saveDeployment } from "./helpers";

/**
 * Deed v5 on a network whose DeedNFT predates the trust extensions: the upgrade, the Functional Contract
 * registry, and the two agents that move co-op deeds.
 *
 *   1. DeedNFT upgrade. Deploys DeedNFTMintExtension, DeedTrustExtension and DeedRolesExtension, validates the
 *      new implementation against the network's manifest and, with DEED_V5=1, upgrades the proxy from
 *      DEFAULT_ADMIN_ROLE (the deployer on Base Sepolia today; after deed_admin_handover.ts it is the Deed
 *      timelock, and this prints the call to propose instead). Recorded as DeedNFTV5.json.
 *   2. FunctionalContractRegistry, recorded. Subdivide and Fractionalize are registered as custody.
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
    saveDeployment(o.network, "DeedNFTV5", implementation, JSON.parse(DeedNFT.interface.formatJson()));
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
  const up = await prepareDeedUpgrade({ proxy: deed, network, execute });
  if (!execute) {
    console.log(`\nValidated only: nothing deployed. DEED_V5=1 would deploy the three extensions and upgrade DeedNFT,
then deploy FunctionalContractRegistry, CoopTransferAgent and RedemptionAgent, register them (and Subdivide,
Fractionalize), set DeedNFT's trust registries once, and name the RedemptionAgent the record's deed contract.`);
    return;
  }
  if (!up.upgraded) {
    console.log("\nDeedNFT is not upgraded yet (propose the call above); run this again once it is.");
    return;
  }
  await deployDeedV5Agents({
    deed,
    membershipRegistry: need("MembershipRegistry"),
    housingRecord: need("HousingAllowanceRecord"),
    subdivide: getDeployment(network, "Subdivide")?.address,
    fractionalize: getDeployment(network, "Fractionalize")?.address,
    network,
  });
  console.log("\nleft to do: deed_admin_handover.ts (DeedNFT and the registry to the Deed timelock), when Kai chooses.");
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
