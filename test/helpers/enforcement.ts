import { ethers } from "hardhat";

/**
 * Phase 2f stage 2 (decisions 7 and 10, C5): the pledge module's pool-share side. Deploys
 * `PoolShareEnforcer` and wires it as `deploy/25_wire_Compliance.ts` does: the pool's
 * `ENFORCER_ROLE` and `enforcementDestination`, the Liquidator's `poolShareEnforcer`, and the
 * registry's enforcement source (decisions 10 and 20). Pool shares are valued by the pool's own `previewRedeem`
 * (MB-05 §1.3; the pool is the POOL_SHARE kind's valuer).
 */
export async function deployEnforcer(admin: any, pool: any, liquidator: any, registry: any, poolKind: string) {
  const enforcer: any = await (await ethers.getContractFactory("PoolShareEnforcer", admin)).deploy(
    await pool.getAddress(), await liquidator.getAddress(), await registry.getAddress()
  );
  const address = await enforcer.getAddress();
  await pool.connect(admin).grantRole(await pool.ENFORCER_ROLE(), address);
  await pool.connect(admin).setEnforcementDestination(address);
  await liquidator.connect(admin).setPoolShareEnforcer(address);
  await registry.connect(admin).setEnforcementSource(address);
  await registry.connect(admin).setCollateralValuer(poolKind, await pool.getAddress());
  return enforcer;
}

/** Fills the pool's queue, then hands the holder's proceeds to the Liquidator through the enforcer. */
export async function fillAndSettle(pool: any, enforcer: any, holder: string, caller?: any) {
  await pool.fillQueue(50);
  return (caller ? enforcer.connect(caller) : enforcer).settle(holder);
}

/** The member's EIP-712 signature over their enforcement order (decision 20). */
export async function signEnforcementOrder(registry: any, member: any, kind: string, itemIds: bigint[], deadline?: bigint) {
  const block = await ethers.provider.getBlock("latest");
  const dl = deadline ?? BigInt(block!.timestamp) + 3600n;
  const nonce = await registry.pledgeNonces(member.address);
  const domain = {
    name: "Clear CollateralRegistry",
    version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await registry.getAddress(),
  };
  const types = {
    EnforcementOrder: [
      { name: "member", type: "address" },
      { name: "kind", type: "bytes32" },
      { name: "itemIds", type: "uint256[]" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const signature = await member.signTypedData(domain, types, { member: member.address, kind, itemIds, nonce, deadline: dl });
  return { deadline: dl, signature };
}
