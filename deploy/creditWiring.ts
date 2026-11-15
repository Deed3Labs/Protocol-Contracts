// Uses the Hardhat runtime of whatever is calling (a test or a deploy script). Never run against a
// network as part of this change.

/*
 * Credit wiring that the numbered deploy scripts share (decision 47: a fresh credit stack on Base
 * Sepolia, as on mainnet). Each function makes a call directly while the sender holds the power it
 * needs (the deployer, before the handovers), and otherwise returns it as a proposal for whoever
 * holds that power since the handover, which the caller prints. Nothing here grants a power that
 * the runbook does not already name, and nothing moves an admin role.
 */

const ZERO_ROLE = "0x" + "00".repeat(32);

/** A call the sender cannot make itself: who proposes it, and what it is. */
export interface Proposal {
  via: string;
  target: string;
  data: string;
  what: string;
}

export const VIA = {
  credit: "the credit timelock (Ops Safe)",
  vault: "the vault timelock (Clear Financial Co. Safe)",
  earn: "the Earn timelock (Clear Lending Co. Safe)",
};

export function printProposals(proposals: Proposal[], log: (m: string) => void = console.log) {
  for (const p of proposals) log(`  ! ${p.via}: ${p.what}\n      to ${p.target}\n      data ${p.data}`);
}

async function callOrPropose(
  contract: any,
  fn: string,
  args: unknown[],
  canSend: boolean,
  via: string,
  what: string,
  proposals: Proposal[],
  log: (m: string) => void
) {
  if (canSend) {
    await (await contract[fn](...args)).wait();
    log(`  ${what}`);
  } else {
    proposals.push({ via, target: await contract.getAddress(), data: contract.interface.encodeFunctionData(fn, args), what });
  }
}

export interface LiquidatorGrantContracts {
  /** The AccessManager the ledger checks operators against. */
  access: any;
  /** ClearUSDUpgradeable, whose savings the Liquidator seizes past the lock. */
  clrusd?: any;
  /** The Liquidator's proxy address. */
  liquidator: string;
  /** The CollateralRegistry: CLRUSD asks it what a holder has locked. */
  collateralRegistry?: string;
  /** Liquidators retired with the old credit stack (`LiquidatorPreAudit`): their CLRUSD role is revoked. */
  retiredLiquidators?: string[];
}

/**
 * The grants a Liquidator needs on a fresh chain, which no numbered script made before
 * (DEPLOY-RUNBOOK §5.2 item 12; `scripts/upgrade_liquidator_savings.ts` made them on the old
 * Base Sepolia Liquidator):
 *
 * - AccessManager operator: the Liquidator writes to the ledger in its own name. The AccessManager's
 *   admin grants it (the deployer, then the credit timelock).
 * - CLRUSD `LIQUIDATOR_ROLE`: `seize` past the redemption lock. CLRUSD's admin grants it (the
 *   deployer, then the vault timelock, after 7 days; Phase 2d decision 3).
 * - A retired Liquidator loses its CLRUSD `LIQUIDATOR_ROLE` (a revocation only narrows).
 * - CLRUSD's encumbrance source is the CollateralRegistry: the token asks it what each holder has
 *   locked. Unset, nothing is locked. A fresh CollateralRegistry has to be named again.
 */
export async function wireLiquidatorGrants(c: LiquidatorGrantContracts, sender: any, log: (m: string) => void = console.log) {
  const { ethers } = require("hardhat");
  const me = await sender.getAddress();
  const proposals: Proposal[] = [];
  const liquidator = ethers.getAddress(c.liquidator);

  if (!(await c.access.isOperator(liquidator))) {
    await callOrPropose(c.access.connect(sender), "grantOperator", [liquidator], await c.access.isAdmin(me), VIA.credit,
      `AccessManager operator -> Liquidator ${liquidator}`, proposals, log);
  }

  if (c.clrusd) {
    const token = c.clrusd.connect(sender);
    const clrusdAdmin: boolean = await token.hasRole(ZERO_ROLE, me);
    const LIQUIDATOR = await token.LIQUIDATOR_ROLE();
    if (!(await token.hasRole(LIQUIDATOR, liquidator))) {
      await callOrPropose(token, "grantRole", [LIQUIDATOR, liquidator], clrusdAdmin, VIA.vault,
        `CLRUSD LIQUIDATOR_ROLE -> Liquidator ${liquidator}`, proposals, log);
    }
    for (const old of c.retiredLiquidators ?? []) {
      if (old && ethers.getAddress(old) !== liquidator && (await token.hasRole(LIQUIDATOR, old))) {
        await callOrPropose(token, "revokeRole", [LIQUIDATOR, old], clrusdAdmin, VIA.vault,
          `CLRUSD LIQUIDATOR_ROLE revoked from the retired Liquidator ${old}`, proposals, log);
      }
    }
    if (c.collateralRegistry && ethers.getAddress(await token.encumbranceSource()) !== ethers.getAddress(c.collateralRegistry)) {
      await callOrPropose(token, "setEncumbranceSource", [c.collateralRegistry], clrusdAdmin, VIA.vault,
        `CLRUSD encumbrance source -> CollateralRegistry ${c.collateralRegistry}`, proposals, log);
    }
  }
  return proposals;
}

/**
 * Decisions 3 (C1) and 17: the PayoutPool no longer borrows from the BondVault or the Yield Pool.
 * Each leg is switched off by configuration (`setBondVault(0)`, `setYieldPool(0)`) once that pool
 * owes the lender nothing; the PayoutPool's code is unchanged. `pools` is every PayoutPool on
 * record, the fresh one and a retired `PayoutPoolPreAudit` alike (a fresh one starts with both legs
 * off). A leg still owed is left on and reported: switching it off first would strand the repayment.
 *
 * Give each pool the ABI it was deployed with (its record's): the pre-audit PayoutPool on Base
 * Sepolia has no `setYieldPool`, only `setLenders(yieldPool, reserve)`, which is called with its
 * reserve unchanged.
 */
export async function switchOffPayoutLegs(pools: { name: string; contract: any }[], sender: any, log: (m: string) => void = console.log) {
  const { ethers } = require("hardhat");
  const me = await sender.getAddress();
  const proposals: Proposal[] = [];
  const owed: string[] = [];
  for (const { name, contract } of pools) {
    const pool = contract.connect(sender);
    const admin: boolean = await pool.hasRole(ZERO_ROLE, me);
    const has = (fn: string) => pool.interface.getFunction(fn) !== null;
    for (const leg of [
      { lender: "yieldPool", borrowed: "borrowedFromYield", setter: "setYieldPool", label: "yield-pool leg (decision 17)" },
      { lender: "bondVault", borrowed: "borrowedFromVault", setter: "setBondVault", label: "bond-vault leg (C1, decision 3)" },
    ]) {
      if (!has(leg.lender) || (await pool[leg.lender]()) === ethers.ZeroAddress) continue;
      const still: bigint = await pool[leg.borrowed]();
      if (still !== 0n) {
        owed.push(`${name} still owes ${still} on its ${leg.label}: switch it off once repaid`);
        continue;
      }
      if (leg.setter === "setYieldPool" && !has("setYieldPool") && has("setLenders")) {
        await callOrPropose(pool, "setLenders", [ethers.ZeroAddress, await pool.reserve()], admin, VIA.credit,
          `${name} ${leg.label} -> off (setLenders, its reserve unchanged)`, proposals, log);
        continue;
      }
      await callOrPropose(pool, leg.setter, [ethers.ZeroAddress], admin, VIA.credit, `${name} ${leg.label} -> off`, proposals, log);
    }
  }
  for (const o of owed) log(`  ! ${o}`);
  return { proposals, owed };
}
