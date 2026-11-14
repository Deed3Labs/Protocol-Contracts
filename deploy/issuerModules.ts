// Uses the Hardhat runtime of whatever is calling (a test, a deploy or an upgrade script).

/*
 * TermIssuer and RevolvingIssuer take their delegatecall modules as constructor arguments: creating
 * them in the constructor put their creation code inside the main contract's, over EIP-3860's
 * 48 KiB limit. Every proxy deployment or upgrade of either needs the modules deployed first and
 * passed through `constructorArgs`. Spread this into the options:
 *
 *   upgrades.deployProxy(F, args, { ...(await issuerProxyOptions("TermIssuer")), kind: "uups" })
 */
export async function issuerProxyOptions(name: "TermIssuer" | "RevolvingIssuer") {
  const { ethers } = require("hardhat");
  const modules = name === "TermIssuer"
    ? ["TermIssuerExtension", "TermIssuerOrigination"]
    : ["RevolvingIssuerExtension", "RevolvingIssuerCycles", "RevolvingIssuerTerms"];
  const constructorArgs: string[] = [];
  for (const m of modules) {
    const c = await (await ethers.getContractFactory(m)).deploy();
    await c.waitForDeployment();
    constructorArgs.push(await c.getAddress());
  }
  return { kind: "uups" as const, constructorArgs };
}
