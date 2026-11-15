// Uses the Hardhat runtime of whatever is calling (a test, a deploy or an upgrade script).

/*
 * Phase 2f: LendingPool (the Yield Pool) pins its YieldPoolValuation delegatecall module, passed to
 * its constructor, like the issuer modules (`issuerModules.ts`). The valuation module in turn pins
 * the YieldPoolLedger module (Pool Interest, Suspension, the rate model, recoveries, the legend),
 * which LendingPool reads from it. Every proxy deployment or upgrade of LendingPool needs both
 * modules deployed first, the valuation module passed through `constructorArgs`:
 *
 *   upgrades.deployProxy(LendingPool, args, await poolProxyOptions())
 *   upgrades.upgradeProxy(pool, LendingPool, { ...(await poolProxyOptions()), call: ... })
 *
 * The ledger functions added in the IV-02 conformance pass are served by LendingPool's fallback,
 * so a client needs both ABIs: `poolAt(address)` joins them.
 */
export async function deployPoolValuation(signer?: any): Promise<string> {
  const { ethers } = require("hardhat");
  const ledger = await (await ethers.getContractFactory("YieldPoolLedger", signer)).deploy();
  await ledger.waitForDeployment();
  const module = await (await ethers.getContractFactory("YieldPoolValuation", signer)).deploy(await ledger.getAddress());
  await module.waitForDeployment();
  return module.getAddress();
}

/** The `upgrades` options for a LendingPool proxy: UUPS, with its module as constructor argument. */
export async function poolProxyOptions(signer?: any) {
  return { kind: "uups" as const, constructorArgs: [await deployPoolValuation(signer)] };
}

/** One ABI for a LendingPool proxy: its own functions and its ledger module's. */
export async function poolAbi(): Promise<any[]> {
  const { artifacts } = require("hardhat");
  const seen = new Set<string>();
  const abi: any[] = [];
  for (const name of ["LendingPool", "YieldPoolLedger"]) {
    for (const item of (await artifacts.readArtifact(name)).abi) {
      const key = `${item.type}:${item.name ?? ""}:${(item.inputs ?? []).map((i: any) => i.type).join(",")}`;
      // The ledger's own module tag is not the pool's.
      if (item.type === "fallback" || item.type === "constructor" || item.name === "extensionKind" || seen.has(key)) continue;
      seen.add(key);
      abi.push(item);
    }
  }
  return abi;
}

/** LendingPool at `address` with the joined ABI, connected to `signer` if given. */
export async function poolAt(address: string, signer?: any) {
  const { ethers } = require("hardhat");
  return new ethers.Contract(address, await poolAbi(), signer ?? (await ethers.getSigners())[0]) as any;
}

/** IV-02 §8.4's legend, as the Register and the vault's metadata carry it (decision 27). Written once
 * by deploy 22 on a fresh pool, or by `scripts/upgrade_yield_pool.ts` after the in-place upgrade. */
export const POOL_SHARE_LEGEND =
  "These Pool Shares have not been registered under the Securities Act of 1933 or any state securities law. " +
  "They may not be transferred except to Clear Lending Co. or by operation of law, as IV-02 permits.";
