// The ESADepositVault upgrade batch, shared by scripts/migrate_vault_clrusd.ts and
// scripts/upgrade_vault.ts. Uses the Hardhat runtime of whatever is calling. Reads only.
import * as fs from "fs";
import * as path from "path";

/** USDC, the one token the vault accepts (audit M-5), by network. USDC=0x… overrides it. */
export const KNOWN_USDC: Record<string, string> = {
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

export const VAULT_TIMELOCK_DELAY = 7 * 24 * 60 * 60;

export interface VaultCall {
  to: string;
  value: string;
  data: string;
  what: string;
}

/**
 * The vault the batches act on: the `ESADepositVault` record, never `ESADepositVaultLegacy`. On
 * Base Sepolia that is 0x8364…413b (the vault members use; the legacy one at 0x7bA8…40cD still holds
 * the USDC behind the old CLRUSD and is not upgraded), on Base 0x0CfE…a1C1.
 */
export function vaultProxyFor(network: string, dir = "deployments"): string {
  const file = path.join(dir, network, "ESADepositVault.json");
  if (!fs.existsSync(file)) throw new Error(`No ESADepositVault recorded for ${network} (${file}).`);
  return JSON.parse(fs.readFileSync(file, "utf8")).address;
}

/**
 * The upgrade, as one call: `upgradeToAndCall(impl, setAcceptedToken(usdc, true))`. The accepted
 * token lives in a slot the upgrade adds, which starts at zero: an upgrade on its own would stop
 * every deposit and redemption until it is set, so the two never travel apart.
 */
export function upgradeCall(vaultInterface: any, impl: string, usdc: string): string {
  const setAccepted = vaultInterface.encodeFunctionData("setAcceptedToken", [usdc, true]);
  return vaultInterface.encodeFunctionData("upgradeToAndCall", [impl, setAccepted]);
}

/**
 * The line `scripts/upgrade_vault.ts` prints once the implementation is deployed: the call's
 * calldata, or, when no USDC is known for the network, the call in words (encoding a placeholder
 * used to throw after the implementation had already been deployed).
 */
export function upgradeCallLine(vaultInterface: any, proxy: string, impl: string, usdc?: string): string {
  return usdc
    ? `The upgrade is one call to ${proxy}: ${upgradeCall(vaultInterface, impl, usdc)}`
    : `The upgrade is one call to ${proxy}: upgradeToAndCall(${impl}, setAcceptedToken(<USDC>, true)). Set USDC to print its calldata.`;
}

/**
 * Phase 1 of the vault roll-out (H-3, M-5): the upgrade with its accepted token, then the relayer's
 * role split (`RELAYER_ROLE` granted, the legacy `OPERATOR_ROLE` revoked where the relayer holds it).
 */
export async function vaultUpgradeCalls(o: { vault: any; impl: string; usdc: string; relayer?: string }): Promise<VaultCall[]> {
  const { ethers } = require("hardhat");
  const to = await o.vault.getAddress();
  const iface = o.vault.interface;
  const calls: VaultCall[] = [
    { to, value: "0", data: upgradeCall(iface, o.impl, o.usdc), what: `upgradeToAndCall(${o.impl}, setAcceptedToken(${o.usdc}, true))` },
  ];
  if (o.relayer) {
    calls.push({ to, value: "0", data: iface.encodeFunctionData("grantRole", [ethers.id("RELAYER_ROLE"), o.relayer]), what: `grantRole(RELAYER_ROLE, ${o.relayer})` });
    const OPERATOR = ethers.id("OPERATOR_ROLE");
    if (await o.vault.hasRole(OPERATOR, o.relayer)) {
      calls.push({ to, value: "0", data: iface.encodeFunctionData("revokeRole", [OPERATOR, o.relayer]), what: `revokeRole(OPERATOR_ROLE, ${o.relayer})` });
    }
  }
  return calls;
}

export type VaultAdmin =
  | { kind: "timelock"; timelock: string; safe: string }
  | { kind: "safe"; safe: string }
  | { kind: "account"; account: string };

/**
 * Who holds the vault's DEFAULT_ADMIN_ROLE, and so who executes the batch. Since Phase 2d the vault
 * is Clear Financial Co.'s: after `deploy/vault_timelock_handover.ts` the vault timelock holds the
 * admin and the Clear Financial Safe proposes and executes through it; before, the Safe may hold it
 * directly, or (Base Sepolia today) the deployer still does. Neither address is in the deployment
 * records except the `VaultTimelock` record the handover writes, so the Safe comes from
 * CLEAR_FINANCIAL_SAFE, the same variable the handover reads, and is checked on chain.
 */
export async function vaultAdmin(vault: any, c: { timelock?: string; safe?: string; accounts?: string[] }): Promise<VaultAdmin> {
  const { ethers } = require("hardhat");
  const ADMIN = ethers.ZeroHash;
  if (c.timelock && (await vault.hasRole(ADMIN, c.timelock))) {
    if (!c.safe) throw new Error("The vault timelock holds the vault's admin: set CLEAR_FINANCIAL_SAFE to the Clear Financial Co. Safe that proposes to it (owner to confirm).");
    const tl = await ethers.getContractAt("TimelockController", c.timelock);
    if (!(await tl.hasRole(await tl.PROPOSER_ROLE(), c.safe)) || !(await tl.hasRole(await tl.EXECUTOR_ROLE(), c.safe))) {
      throw new Error(`CLEAR_FINANCIAL_SAFE ${c.safe} is not a proposer and executor on the vault timelock ${c.timelock}.`);
    }
    return { kind: "timelock", timelock: c.timelock, safe: c.safe };
  }
  if (c.safe && (await vault.hasRole(ADMIN, c.safe))) return { kind: "safe", safe: c.safe };
  for (const a of c.accounts ?? []) if (a && (await vault.hasRole(ADMIN, a))) return { kind: "account", account: a };
  throw new Error(
    "None of the addresses this script knows holds the vault's DEFAULT_ADMIN_ROLE (the VaultTimelock record, CLEAR_FINANCIAL_SAFE, VAULT_ADMIN). " +
      "Find the holder in the vault's RoleGranted events and set CLEAR_FINANCIAL_SAFE or VAULT_ADMIN (owner to confirm)."
  );
}

/**
 * The batches the admin executes, as Safe Transaction Builder transactions. Through the vault
 * timelock that is two Safe batches: `scheduleBatch` now and `executeBatch` after 7 days.
 */
export async function adminBatches(admin: VaultAdmin, calls: VaultCall[], label: string) {
  const { ethers } = require("hardhat");
  if (admin.kind !== "timelock") return [{ suffix: "", from: admin.kind === "safe" ? admin.safe : admin.account, transactions: calls }];
  const tl = await ethers.getContractAt("TimelockController", admin.timelock);
  const delay = await tl.getMinDelay();
  const targets = calls.map((c) => c.to);
  const values = calls.map(() => 0n);
  const payloads = calls.map((c) => c.data);
  const salt = ethers.id(`${label}:${payloads.join("")}`);
  const schedule = tl.interface.encodeFunctionData("scheduleBatch", [targets, values, payloads, ethers.ZeroHash, salt, delay]);
  const execute = tl.interface.encodeFunctionData("executeBatch", [targets, values, payloads, ethers.ZeroHash, salt]);
  return [
    { suffix: ".schedule", from: admin.safe, transactions: [{ to: admin.timelock, value: "0", data: schedule, what: `vault timelock scheduleBatch (${calls.length} calls, ${delay} s)` }] },
    { suffix: ".execute", from: admin.safe, transactions: [{ to: admin.timelock, value: "0", data: execute, what: `vault timelock executeBatch, after ${delay} s` }] },
  ];
}

/** A Safe Transaction Builder file. */
export function safeBatchFile(chainId: bigint, name: string, transactions: VaultCall[]) {
  return {
    version: "1.0",
    chainId: chainId.toString(),
    createdAt: Date.now(),
    meta: { name, description: "Generated by scripts/migrate_vault_clrusd.ts (audit M-7 / H-3 / M-5). Review every call before executing." },
    transactions: transactions.map(({ to, value, data }) => ({ to, value, data })),
  };
}
