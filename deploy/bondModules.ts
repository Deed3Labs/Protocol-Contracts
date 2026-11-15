// Uses the Hardhat runtime of whatever is calling (a test, a deploy or an upgrade script).

/*
 * Phase 2f: a BurnerBond implementation pins BurnerBondPledges (settlement and rolls, payPledged,
 * buyback, redeemUnderWindDown), which pins BurnerBondIssue (purchase by quote, roll notices and
 * confirmations, the wind-down flag, burnPaid). Both are delegatecall modules reached through the
 * collection's fallback. The factory takes the prebuilt implementation (its creation code is no
 * longer inside the factory's), plus the IV-01 §4.12 legend:
 *
 *   const factory = await deployBondFactory(tokenRegistry, baseURI);
 *
 * A client needs the joined ABI of the three: `bondAt(address)`.
 */

/** The IV-01 §4.12 legend every collection's metadata carries (Earn §1). */
export const BOND_LEGEND =
  "This BurnerBond has not been registered under the Securities Act of 1933 or any state securities law. " +
  "It may not be transferred except to Clear Lending Co. or by operation of law, as the BurnerBond Terms (IV-01) provide.";
export const BOND_LEGEND_URI = process.env.BOND_LEGEND_URI ?? "ipfs://clear-bonds/legend/iv-01-4.12";

/** Deploys BurnerBondIssue, then BurnerBondPledges pinning it; returns the latter's address. */
export async function deployBondPledges(signer?: any): Promise<string> {
  const { ethers } = require("hardhat");
  const issue = await (await ethers.getContractFactory("BurnerBondIssue", signer)).deploy();
  await issue.waitForDeployment();
  const pledges = await (await ethers.getContractFactory("BurnerBondPledges", signer)).deploy(await issue.getAddress());
  await pledges.waitForDeployment();
  return pledges.getAddress();
}

/** Deploys a BurnerBond implementation with its two modules. */
export async function deployBondImplementation(signer?: any): Promise<string> {
  const { ethers } = require("hardhat");
  const impl = await (await ethers.getContractFactory("BurnerBond", signer)).deploy(await deployBondPledges(signer));
  await impl.waitForDeployment();
  return impl.getAddress();
}

/** Deploys BurnerBondFactory with a prebuilt bond implementation and the legend. */
export async function deployBondFactory(tokenRegistry: string, baseURI: string, signer?: any) {
  const { ethers } = require("hardhat");
  const Factory = await ethers.getContractFactory("BurnerBondFactory", signer);
  const factory = await Factory.deploy(
    tokenRegistry, baseURI, await deployBondImplementation(signer), ethers.id(BOND_LEGEND), BOND_LEGEND_URI
  );
  await factory.waitForDeployment();
  return factory;
}

/** One ABI for a collection: BurnerBond's and both modules'. */
export async function bondAbi(): Promise<any[]> {
  const { artifacts } = require("hardhat");
  const seen = new Set<string>();
  const abi: any[] = [];
  for (const name of ["BurnerBond", "BurnerBondPledges", "BurnerBondIssue"]) {
    for (const item of (await artifacts.readArtifact(name)).abi) {
      const key = `${item.type}:${item.name ?? ""}:${(item.inputs ?? []).map((i: any) => i.type).join(",")}`;
      if (item.type === "fallback" || item.type === "constructor" || seen.has(key)) continue;
      seen.add(key);
      abi.push(item);
    }
  }
  return abi;
}

/** A collection at `address` with the joined ABI, connected to `signer` if given. */
export async function bondAt(address: string, signer?: any) {
  const { ethers } = require("hardhat");
  return new ethers.Contract(address, await bondAbi(), signer ?? (await ethers.getSigners())[0]) as any;
}
