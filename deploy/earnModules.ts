// Uses the Hardhat runtime of whatever is calling (a test, a deploy or an upgrade script).

/*
 * Phase 2f: EarnControls pins its EarnControlsAdmin delegatecall module, passed to its constructor,
 * like the pool's and the issuers' modules (`poolModules.ts`, `issuerModules.ts`). Every proxy
 * deployment or upgrade of EarnControls needs the module deployed first and passed through
 * `constructorArgs`:
 *
 *   upgrades.deployProxy(EarnControls, [settings], await earnControlsProxyOptions())
 *   upgrades.upgradeProxy(controls, EarnControls, await earnControlsProxyOptions())
 *
 * The module's functions are served by EarnControls' fallback, so a client needs both ABIs:
 * `earnControlsAt(address)` joins them.
 */
export async function deployEarnControlsAdmin(signer?: any): Promise<string> {
  const { ethers } = require("hardhat");
  const module = await (await ethers.getContractFactory("EarnControlsAdmin", signer)).deploy();
  await module.waitForDeployment();
  return module.getAddress();
}

/** The `upgrades` options for an EarnControls proxy: UUPS, with its module as constructor argument. */
export async function earnControlsProxyOptions(signer?: any) {
  return { kind: "uups" as const, constructorArgs: [await deployEarnControlsAdmin(signer)] };
}

/** One ABI for an EarnControls proxy: its own functions and its module's. */
export async function earnControlsAbi(): Promise<any[]> {
  const { artifacts } = require("hardhat");
  const seen = new Set<string>();
  const abi: any[] = [];
  for (const name of ["EarnControls", "EarnControlsAdmin"]) {
    for (const item of (await artifacts.readArtifact(name)).abi) {
      const key = `${item.type}:${item.name ?? ""}:${(item.inputs ?? []).map((i: any) => i.type).join(",")}`;
      if (item.type === "fallback" || item.type === "constructor" || seen.has(key)) continue;
      seen.add(key);
      abi.push(item);
    }
  }
  return abi;
}

/** EarnControls at `address` with the joined ABI, connected to `signer` if given. */
export async function earnControlsAt(address: string, signer?: any) {
  const { ethers } = require("hardhat");
  return new ethers.Contract(address, await earnControlsAbi(), signer ?? (await ethers.getSigners())[0]) as any;
}
