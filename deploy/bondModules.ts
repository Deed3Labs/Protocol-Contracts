// Uses the Hardhat runtime of whatever is calling (a test, a deploy or an upgrade script).

/*
 * Phase 2e: every BurnerBond implementation pins a BurnerBondPledges module (the pledged-bond terms,
 * `payPledged` and the pledged maturity split in `settle`), passed to its constructor. The factory
 * creates the implementation, so the factory takes the module's address as its third constructor
 * argument. Deploy the module first:
 *
 *   const factory = await Factory.deploy(tokenRegistry, baseURI, await deployBondPledges());
 */
export async function deployBondPledges(signer?: any): Promise<string> {
  const { ethers } = require("hardhat");
  const pledges = await (await ethers.getContractFactory("BurnerBondPledges", signer)).deploy();
  await pledges.waitForDeployment();
  return pledges.getAddress();
}

/** Deploys BurnerBondFactory with its BurnerBondPledges module. */
export async function deployBondFactory(tokenRegistry: string, baseURI: string, signer?: any) {
  const { ethers } = require("hardhat");
  const Factory = await ethers.getContractFactory("BurnerBondFactory", signer);
  const factory = await Factory.deploy(tokenRegistry, baseURI, await deployBondPledges(signer));
  await factory.waitForDeployment();
  return factory;
}
