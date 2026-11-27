import hre from "hardhat";
import { getDeployment } from "../deploy/helpers";

/*
 * Confirms a replacement vault is configured the same as the one it replaces.
 *
 *   LEGACY=ESADepositVaultLegacy npx hardhat run scripts/verify_vault_parity.ts --network base-sepolia
 *
 * Roles are read from RoleGranted/RoleRevoked events because the vault uses plain AccessControl
 * with no enumerable extension, so there is nothing to iterate. A replacement that merely holds
 * the right token but not the right operators is a vault that accepts deposits and cannot serve a
 * gasless one -- which looks fine until somebody tries.
 */
const { ethers } = hre;

async function roleHolders(vault: any) {
  const held = new Map<string, Set<string>>();
  for (const e of await vault.queryFilter(vault.filters.RoleGranted(), 0, "latest")) {
    const [role, account] = (e as any).args;
    if (!held.has(role)) held.set(role, new Set());
    held.get(role)!.add(account.toLowerCase());
  }
  for (const e of await vault.queryFilter(vault.filters.RoleRevoked(), 0, "latest")) {
    const [role, account] = (e as any).args;
    held.get(role)?.delete(account.toLowerCase());
  }
  return held;
}

async function main() {
  const network = (await ethers.provider.getNetwork()).name;
  const legacyName = process.env.LEGACY ?? "ESADepositVaultLegacy";
  const legacyRecord = getDeployment(network, legacyName);
  const currentRecord = getDeployment(network, "ESADepositVault");
  if (!legacyRecord || !currentRecord) throw new Error("Need both vault deployments recorded.");

  const legacy = await ethers.getContractAt("ESADepositVault", legacyRecord.address);
  const current = await ethers.getContractAt("ESADepositVault", currentRecord.address);

  const names: Record<string, string> = {
    [await current.DEFAULT_ADMIN_ROLE()]: "DEFAULT_ADMIN",
    [await current.OPERATOR_ROLE()]: "OPERATOR",
    [await current.PAUSER_ROLE()]: "PAUSER",
  };

  const before = await roleHolders(legacy);
  const after = await roleHolders(current);

  let gaps = 0;
  for (const [role, accounts] of before) {
    for (const account of accounts) {
      if (!after.get(role)?.has(account)) {
        console.log(`MISSING  ${names[role] ?? role} -> ${account}`);
        gaps++;
      }
    }
  }

  // Tokens the retired vault accepted must be accepted here too, or a deposit that used to work
  // now reverts.
  for (const e of await legacy.queryFilter(legacy.filters.AcceptedTokenUpdated?.() ?? "*", 0, "latest").catch(() => [])) {
    const token = (e as any).args?.[0];
    if (!token) continue;
    if ((await legacy.isAcceptedToken(token)) && !(await current.isAcceptedToken(token))) {
      console.log(`MISSING  accepted token -> ${token}`);
      gaps++;
    }
  }

  console.log(gaps === 0 ? "\nParity: the replacement matches what it replaces." : `\n${gaps} gap(s).`);
  if (gaps > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
