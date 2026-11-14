// Uses the Hardhat runtime of whatever is calling (a test, a deploy or an upgrade script).

/*
 * Phase 2f: LendingPool (the Yield Pool) pins its YieldPoolValuation delegatecall module, passed to
 * its constructor, like the issuer modules (`issuerModules.ts`). Every proxy deployment or upgrade
 * of LendingPool needs the module deployed first and passed through `constructorArgs`:
 *
 *   upgrades.deployProxy(LendingPool, args, await poolProxyOptions())
 *   upgrades.upgradeProxy(pool, LendingPool, { ...(await poolProxyOptions()), call: ... })
 */
export async function deployPoolValuation(signer?: any): Promise<string> {
  const { ethers } = require("hardhat");
  const module = await (await ethers.getContractFactory("YieldPoolValuation", signer)).deploy();
  await module.waitForDeployment();
  return module.getAddress();
}

/** The `upgrades` options for a LendingPool proxy: UUPS, with its module as constructor argument. */
export async function poolProxyOptions(signer?: any) {
  return { kind: "uups" as const, constructorArgs: [await deployPoolValuation(signer)] };
}
