import fs from "fs";
import path from "path";
import { getDeployment, liveNetworkOf, requireMainnetConfirmation } from "../deploy/helpers";
import { KNOWN_USDC, VaultCall, adminBatches, safeBatchFile, vaultAdmin, vaultProxyFor, vaultUpgradeCalls } from "./vaultUpgrade";

/*
 * Audit M-7 (prep) and the H-3 / M-5 roll-out for the ESADepositVault, on Base and Base Sepolia.
 *
 * THIS SCRIPT SENDS NOTHING. It never asks for a key. It reads chain state, checks the new
 * implementation's storage layout against the network manifest, and writes Safe Transaction Builder
 * batches for the vault's admin to review and execute. The owner runs it.
 *
 *   VAULT_IMPL=0x... RELAYER=0x... CLEAR_FINANCIAL_SAFE=0x... [USDC=0x...] [NEW_CLRUSD=0x...] \
 *     npx hardhat run scripts/migrate_vault_clrusd.ts --network base-sepolia
 *   (on Base, CONFIRM_MAINNET=1 as well)
 *
 * The vault is the `ESADepositVault` record (Base Sepolia 0x8364…413b, Base 0x0CfE…a1C1), never
 * `ESADepositVaultLegacy`. VAULT_IMPL comes from `scripts/upgrade_vault.ts`, which validates and
 * deploys the implementation and never touches the proxy.
 *
 * Who executes: since Phase 2d the vault is Clear Financial Co.'s, not the Ops Safe's. The script
 * checks on chain which applies, and writes the batches for it:
 * - the vault timelock holds the admin (after `deploy/vault_timelock_handover.ts`; its address is
 *   the `VaultTimelock` record): the Clear Financial Safe (CLEAR_FINANCIAL_SAFE, checked as the
 *   timelock's proposer and executor) schedules the calls (`*.schedule.json`) and executes them
 *   after 7 days (`*.execute.json`);
 * - the Clear Financial Safe holds the admin directly: one batch for it;
 * - otherwise an account named in VAULT_ADMIN (on Base Sepolia today, the deployer) holds it: the
 *   same calls, for that account to send. Nobody known holding it is an error, not a guess.
 *
 * Phases (each a separate batch, in this order):
 *
 *   1. upgrade   -- upgradeToAndCall(VAULT_IMPL, setAcceptedToken(USDC, true)); grant RELAYER_ROLE
 *                   to the relayer; revoke OPERATOR_ROLE from it if it holds it. The upgrade and the
 *                   accepted-token call MUST travel together: the new single-token rule (M-5) reads
 *                   a fresh storage slot that starts at zero, so an upgrade on its own stops all
 *                   deposits and redemptions until it is set. In the same window grant two
 *                   PAUSER_ROLE and two PILOT_ROLE keys. Upgrade while no pause is in force.
 *
 *   2. drain     -- not a transaction. The old CLRUSD cannot be upgraded, and `setClrusd` only
 *                   accepts a new token once the old supply is zero, so every holder must redeem
 *                   the old token first. The script prints the outstanding supply.
 *
 *   3. repoint   -- once supply is zero: grant the vault mint/burn on NEW_CLRUSD (deployed by
 *                   deploy/21_deploy_ClearUSDUpgradeable.ts), then setClrusd(NEW_CLRUSD). On Base
 *                   Sepolia the vault already backs ClearUSDUpgradeable, so there is nothing to do.
 */

function need(name: string): string {
  const { ethers } = require("hardhat");
  const value = process.env[name]?.trim();
  if (!value || !ethers.isAddress(value)) throw new Error(`Set ${name} to an address.`);
  return ethers.getAddress(value);
}

function optional(name: string): string | undefined {
  return process.env[name]?.trim() ? need(name) : undefined;
}

async function main() {
  const { ethers, upgrades, network } = require("hardhat");
  requireMainnetConfirmation(network.name, "scripts/migrate_vault_clrusd.ts (it writes the live vault's upgrade batch)");
  const proxy = vaultProxyFor(network.name);
  const impl = need("VAULT_IMPL");
  const relayer = need("RELAYER");
  const usdc = optional("USDC") ?? KNOWN_USDC[liveNetworkOf(network.name)];
  if (!usdc) throw new Error(`Set USDC: no known USDC for ${network.name}.`);
  const newClrusd = optional("NEW_CLRUSD");
  const { chainId } = await ethers.provider.getNetwork();
  console.log(`ESADepositVault ${proxy} on ${network.name} (the ESADepositVault record)`);

  // Layout check against the manifest (no transaction; throws on an unsafe layout).
  const Vault = await ethers.getContractFactory("ESADepositVault");
  await upgrades.validateUpgrade(proxy, Vault, { kind: "uups" });
  console.log("✓ storage layout validated against the network manifest");
  if ((await ethers.provider.getCode(impl)) === "0x") throw new Error(`VAULT_IMPL ${impl} has no code: deploy it with scripts/upgrade_vault.ts first.`);

  const vault = Vault.attach(proxy) as any;
  const admin = await vaultAdmin(vault, {
    timelock: process.env.VAULT_TIMELOCK?.trim() || getDeployment(network.name, "VaultTimelock")?.address,
    safe: optional("CLEAR_FINANCIAL_SAFE"),
    accounts: [optional("VAULT_ADMIN")].filter(Boolean) as string[],
  });
  console.log(admin.kind === "timelock"
    ? `The vault timelock ${admin.timelock} holds the admin: the Clear Financial Safe ${admin.safe} schedules, then executes after the delay.`
    : admin.kind === "safe" ? `The Clear Financial Safe ${admin.safe} holds the admin: it executes the batch.`
      : `${admin.account} holds the admin directly: it sends the calls below, in order.`);
  const paused = await vault.paused().catch(() => false);
  if (paused) console.log("! The vault is paused: upgrade only once no pause is in force (P2g part B §4.1 item 4).");

  // ── Phase 1: upgrade + single accepted token + role split ──
  const phase1 = await vaultUpgradeCalls({ vault, impl, usdc, relayer });

  // ── Phase 2: how much old CLRUSD is still out ──
  const oldClrusd = await vault.clrusd();
  const old = await ethers.getContractAt("IERC20MetadataUpgradeable", oldClrusd);
  const outstanding: bigint = await old.totalSupply();
  console.log(`CLRUSD the vault backs today ${oldClrusd}: ${ethers.formatUnits(outstanding, await old.decimals())} outstanding`);

  // ── Phase 3: re-point, only once drained ──
  const phase3: VaultCall[] = [];
  if (newClrusd) {
    const token = await ethers.getContractAt("ClearUSDUpgradeable", newClrusd);
    phase3.push({ to: newClrusd, value: "0", data: token.interface.encodeFunctionData("grantMintAndBurnRoles", [proxy]), what: "CLRUSD grantMintAndBurnRoles(vault)" });
    phase3.push({ to: proxy, value: "0", data: vault.interface.encodeFunctionData("setClrusd", [newClrusd]), what: `setClrusd(${newClrusd})` });
    if (outstanding !== 0n) console.log("! setClrusd will revert (ESADepositVaultTokenStillOutstanding) until the old supply is zero.");
  }

  const out = path.join("deployments", network.name, "safe-batches");
  fs.mkdirSync(out, { recursive: true });
  const write = async (file: string, name: string, calls: VaultCall[]) => {
    for (const b of await adminBatches(admin, calls, file)) {
      const target = path.join(out, `${file}${b.suffix}.json`);
      fs.writeFileSync(target, JSON.stringify(safeBatchFile(chainId, name, b.transactions), null, 2));
      console.log(`\n${target} (from ${b.from}):`);
      for (const t of b.transactions) console.log(`  to ${t.to}  # ${t.what}\n     data ${t.data}`);
    }
  };
  await write("vault-1-upgrade", "Vault upgrade (H-3, M-5)", phase1);
  if (phase3.length) await write("vault-3-repoint", "Vault re-point to ClearUSDUpgradeable (M-7)", phase3);
  console.log(`\nWrote the batches to ${out}. Review, then execute as above. Nothing was sent.`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
