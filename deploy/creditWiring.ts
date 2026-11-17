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
 * A role's hash from its name: `DEFAULT_ADMIN_ROLE` is zero, a `*_ROLE` name is its keccak256 (the
 * OpenZeppelin convention every contract here follows), and anything else (the AccessManager's
 * "OPERATOR", "MEMBER") is the name itself as a bytes32 string.
 */
export function roleHash(name: string): string {
  const { ethers } = require("hardhat");
  if (name === "DEFAULT_ADMIN_ROLE") return ZERO_ROLE;
  return name.endsWith("_ROLE") ? ethers.id(name) : ethers.encodeBytes32String(name);
}

/**
 * Decision 48 (b): revokes every role in `roles` that a retired contract (`*PreAudit`, `*Pre2f`,
 * `*Legacy`; `retiredContracts` in `deploy/retire_credit_stack.ts`) still holds on a contract we keep.
 * A revocation only narrows, and nothing is granted. While the sender holds the role's admin it
 * revokes; otherwise it returns the call for `via` to propose. `DEFAULT_ADMIN_ROLE` on a token with
 * default-admin rules (ClearUSDUpgradeable) cannot be revoked this way: it is reported, not proposed.
 * `scripts/check_retired_credit.ts` checks the same roles.
 */
export async function revokeRetiredRoles(
  contract: any,
  label: string,
  roles: readonly string[],
  retired: { name: string; address: string }[],
  sender: any,
  via: string,
  log: (m: string) => void = console.log
) {
  const { ethers } = require("hardhat");
  const me = await sender.getAddress();
  const ct = contract.connect(sender);
  const proposals: Proposal[] = [];
  const defaultAdminRules = ct.interface.getFunction("defaultAdmin") !== null;
  for (const role of roles) {
    const hash = roleHash(role);
    for (const r of retired) {
      const who = ethers.getAddress(r.address);
      if (!(await ct.hasRole(hash, who))) continue;
      if (hash === ZERO_ROLE && defaultAdminRules) {
        log(`  ! ${label} DEFAULT_ADMIN_ROLE is held by the retired ${r.name} ${who}: it moves only by beginDefaultAdminTransfer. Owner to act.`);
        continue;
      }
      const canSend: boolean = await ct.hasRole(await ct.getRoleAdmin(hash), me);
      await callOrPropose(ct, "revokeRole", [hash, who], canSend, via, `${label} ${role} revoked from the retired ${r.name} ${who}`, proposals, log);
    }
  }
  return proposals;
}

/** The roles decision 48 (b) revokes from retired contracts, and `scripts/check_retired_credit.ts` checks, per kept contract. */
export const RETIRED_ROLE_CHECKS = {
  LendingPool: [
    "DEFAULT_ADMIN_ROLE", "OPERATOR_ROLE", "BORROWER_ROLE", "LOSS_REPORTER_ROLE", "LIQUIDATOR_ROLE", "VALUATION_ROLE",
    "DEPLOYER_ROLE", "SUSPENSION_ROLE", "CCO_ROLE", "TREASURER_ROLE", "ENFORCER_ROLE",
  ],
  ClearUSDUpgradeable: [
    "DEFAULT_ADMIN_ROLE", "LIQUIDATOR_ROLE", "MINTER_ROLE", "BURNER_ROLE", "UPGRADER_ROLE", "FRAUD_ROLE", "SECURITY_ROLE", "LISTING_ROLE",
  ],
  ESADepositVault: ["DEFAULT_ADMIN_ROLE", "OPERATOR_ROLE", "RELAYER_ROLE", "PAUSER_ROLE", "PILOT_ROLE"],
  BondVault: ["DEFAULT_ADMIN_ROLE", "OPERATOR_ROLE", "BOND_ROLE", "TREASURY_ROLE"],
  ClaimEscrow: ["DEFAULT_ADMIN_ROLE", "SETTLER_ROLE"],
  EarnControls: [
    "DEFAULT_ADMIN_ROLE", "ATTESTER_ROLE", "PAUSE_ROLE", "SUCCESSOR_ROLE", "ELIGIBILITY_ROLE", "BOND_ROLE", "LADDER_ROLE",
    "FUNDING_ROLE", "WIND_DOWN_ROLE", "ROLL_NOTICE_ROLE", "EXCLUDED_HOLDER_ROLE",
  ],
  // The fresh AccessManager (the ledger's): its operators and credit roles.
  AccessManager: ["DEFAULT_ADMIN_ROLE", "OPERATOR", "CREDIT_LINES_ROLE", "CREDIT_LIMITS_ROLE", "CREDIT_SETTINGS_ROLE", "CREDIT_ATTESTER_ROLE"],
} as const;

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

/**
 * Carry at the payout pool (docs/protocol/settlement.md, "Carry, by who bore the float";
 * `scripts/configure-carry-recipients.mjs` makes the same change). Each issuer's `carryTreasury`
 * becomes the fresh `PayoutPool` record, as it was on the pre-audit Base Sepolia stack. Deploy 20
 * runs before deploy 22 makes the PayoutPool, so the issuers start at CARRY_TREASURY; and TermIssuer
 * refuses a fee recipient equal to its carry treasury, which on a testnet where one Safe plays every
 * role made deploy 25 revert at `proposeFeeRecipient` (found by the fork rehearsal). Since Phase 2e
 * an unset fee recipient no longer falls back to carry, so carry can move first.
 *
 * Skipped when no fresh PayoutPool is recorded, or the record is the retired one. A CREDIT_SETTINGS_ROLE
 * setting (the AccessManager's admin passes it): sent while the sender may, otherwise returned.
 */
export async function pointCarryAtPayoutPool(
  network: string,
  issuers: { name: string; contract: any }[],
  sender: any,
  log: (m: string) => void = console.log
) {
  const { ethers } = require("hardhat");
  const { getDeployment } = require("./helpers");
  const pool: string | undefined = getDeployment(network, "PayoutPool")?.address;
  const retired: string | undefined = getDeployment(network, "PayoutPoolPreAudit")?.address;
  const proposals: Proposal[] = [];
  if (!pool || (retired && ethers.getAddress(pool) === ethers.getAddress(retired))) {
    log("! No fresh PayoutPool recorded: carry stays at the issuers' carry treasury (run deploy 22, then this again).");
    return proposals;
  }
  for (const { name, contract } of issuers) {
    const issuer = contract.connect(sender);
    if (ethers.getAddress(await issuer.carryTreasury()) === ethers.getAddress(pool)) continue;
    const canSend: boolean = await issuer.setCarryTreasury.staticCall(pool).then(() => true, () => false);
    await callOrPropose(issuer, "setCarryTreasury", [pool], canSend, VIA.credit, `${name} carry treasury -> PayoutPool ${pool}`, proposals, log);
  }
  return proposals;
}
