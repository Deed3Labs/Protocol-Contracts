/**
 * The ESA vault and CLRUSD timelock handover (Phase 2d: addendum 10g, owner's decisions 1 to 3).
 *
 * A fourth TimelockController, beside the Deed, credit and Assurance timelocks: minimum delay 7
 * days, a Clear Financial Co. Safe proposing and executing, no admin. It governs ESADepositVault
 * and CLRUSD (ClearUSDUpgradeable), which left the credit timelock (decision 1 overrides
 * DECISIONS #10 for these two). Clear Collective LLC, Clear Lending Co., ClearLabs and the Manager
 * hold no vault or CLRUSD role.
 *
 * What moves to the timelock:
 * - ESADepositVault: DEFAULT_ADMIN_ROLE (upgrades, every setting, the pilot off switch, every
 *   role grant).
 * - CLRUSD: UPGRADER_ROLE, the CCIP admin, and DEFAULT_ADMIN_ROLE. CLRUSD uses OpenZeppelin's
 *   AccessControlDefaultAdminRules, so its default admin cannot be granted: the deployer begins the
 *   transfer here, and the Safe accepts it through the timelock (`acceptanceCalls`) once the
 *   token's admin delay has passed. The deployer's admin ends at that acceptance.
 * - The CCIP token pool's ownership, when given: the pool can mint CLRUSD for a remote chain, so
 *   whoever configures it holds a minting power. Its ownership is two-step: the timelock accepts.
 *
 * What does not: the keys that hold operational roles. They are Clear Financial's, and are granted
 * here (`keys`) before the deployer renounces everything it holds:
 * - RELAYER_ROLE: a single hot key, because it only submits what a member signed (decision 2);
 * - PAUSER_ROLE, PILOT_ROLE (the CA mint pause), FRAUD_ROLE, SECURITY_ROLE: each action needs two
 *   distinct holders in contract, so grant at least two keys of each.
 * The contract-held roles (the vault's MINTER/BURNER_ROLE, the Liquidator's LIQUIDATOR_ROLE, the
 * pool's MINTER/BURNER_ROLE) stay where they are (decision 3). After the handover only the Safe,
 * through the 7-day delay, can grant or revoke any of them.
 *
 * Successor trustee (10g): `successorTrusteeCalls` builds the one timelock batch that moves the
 * proposer, executor and canceller roles from one Clear Financial Safe to another, and any
 * operational role from old keys to new ones. Nothing in it touches the reserve.
 *
 * This module only builds transactions from the signer it is given. It never reads a key.
 *
 *   CLEAR_FINANCIAL_SAFE=0x... VAULT_HANDOVER=1 \
 *     VAULT_RELAYERS=0x.. VAULT_PAUSERS=0xA,0xB PILOT_SIGNERS=0xA,0xB FRAUD_SIGNERS=0xA,0xB SECURITY_SIGNERS=0xA,0xB \
 *     npx hardhat run deploy/vault_timelock_handover.ts --network base-sepolia
 */

export const VAULT_TIMELOCK_DELAY = 7 * 24 * 60 * 60;
const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

export interface VaultContracts {
  vault?: any;
  clrusd?: any;
  /** The CCIP token pool (Chainlink `ConfirmedOwner`: transferOwnership, then acceptOwnership). */
  tokenPool?: any;
}

/** Clear Financial's operational keys, granted before the deployer renounces. */
export interface VaultKeys {
  relayers?: string[];
  pausers?: string[];
  pilot?: string[];
  fraud?: string[];
  security?: string[];
}

/** A call the Safe proposes to the timelock. */
export interface TimelockCall {
  target: string;
  value: bigint;
  data: string;
  what: string;
}

const VAULT_ROLES = ["DEFAULT_ADMIN_ROLE", "OPERATOR_ROLE", "RELAYER_ROLE", "PAUSER_ROLE", "PILOT_ROLE"];
const CLRUSD_ROLES = ["UPGRADER_ROLE", "MINTER_ROLE", "BURNER_ROLE", "LIQUIDATOR_ROLE", "FRAUD_ROLE", "SECURITY_ROLE"];

async function send(txp: Promise<any>) {
  await (await txp).wait();
}

async function roleHash(ct: any, name: string): Promise<string> {
  return name === "DEFAULT_ADMIN_ROLE" ? ZERO : ct[name]();
}

/** Deploys the vault TimelockController with `safe` proposing and executing, and no admin. */
export async function deployVaultTimelock(safe: string, delay = VAULT_TIMELOCK_DELAY) {
  const { ethers } = require("hardhat");
  if (delay < VAULT_TIMELOCK_DELAY) throw new Error("The vault timelock delay must be at least 7 days.");
  const F = await ethers.getContractFactory("TimelockController");
  const timelock = await F.deploy(delay, [safe], [safe], ethers.ZeroAddress);
  await timelock.waitForDeployment();
  return timelock;
}

/** Throws unless `safe` is a contract reporting a threshold of at least two (two-person control). */
export async function assertTwoPersonSafe(safe: string) {
  const { ethers } = require("hardhat");
  if ((await ethers.provider.getCode(safe)) === "0x") throw new Error(`${safe} is not a Safe: it has no code.`);
  const s = await ethers.getContractAt(["function getThreshold() view returns (uint256)", "function getOwners() view returns (address[])"], safe);
  const threshold = Number(await s.getThreshold());
  const owners: string[] = await s.getOwners();
  if (threshold < 2) throw new Error(`The Clear Financial Safe must need two signers; ${safe} needs ${threshold}.`);
  return { threshold, owners };
}

/**
 * Moves every vault and CLRUSD power to the timelock, grants the operational keys, and renounces
 * every role the deployer holds. Returns the calls the Safe still has to make through the timelock
 * (the CLRUSD admin and pool ownership acceptances).
 */
export async function handOverVault(
  c: VaultContracts,
  deployerSigner: any,
  timelock: string,
  keys: VaultKeys = {},
  log: (m: string) => void = () => {}
): Promise<TimelockCall[]> {
  const me = await deployerSigner.getAddress();
  const grants = async (ct: any, name: string, role: string, holders: string[] = []) => {
    const hash = await roleHash(ct, role);
    for (const h of holders) if (!(await ct.hasRole(hash, h))) await send(ct.grantRole(hash, h));
    if (holders.length > 0) log(`${name}: ${role} -> ${holders.join(", ")}`);
    if (holders.length === 1 && role !== "RELAYER_ROLE") log(`! ${name}: ${role} has one key; its actions need two.`);
  };

  if (c.vault) {
    const v = c.vault;
    await grants(v, "vault", "RELAYER_ROLE", keys.relayers);
    await grants(v, "vault", "PAUSER_ROLE", keys.pausers);
    await grants(v, "vault", "PILOT_ROLE", keys.pilot);
    if (!(await v.hasRole(ZERO, timelock))) await send(v.grantRole(ZERO, timelock));
    // Every other role first; DEFAULT_ADMIN_ROLE last, or nothing could finish.
    for (const r of [...VAULT_ROLES.slice(1), "DEFAULT_ADMIN_ROLE"]) {
      const hash = await roleHash(v, r);
      if (await v.hasRole(hash, me)) await send(v.renounceRole(hash, me));
    }
    log("vault: admin -> timelock; the deployer holds no vault role");
  }

  const pending: TimelockCall[] = [];
  if (c.clrusd) {
    const t = c.clrusd;
    await grants(t, "clrusd", "FRAUD_ROLE", keys.fraud);
    await grants(t, "clrusd", "SECURITY_ROLE", keys.security);
    const upgrader = await t.UPGRADER_ROLE();
    if (!(await t.hasRole(upgrader, timelock))) await send(t.grantRole(upgrader, timelock));
    if ((await t.getCCIPAdmin()) === me) await send(t.setCCIPAdmin(timelock));
    for (const r of CLRUSD_ROLES) {
      const hash = await t[r]();
      if (await t.hasRole(hash, me)) await send(t.renounceRole(hash, me));
    }
    if ((await t.defaultAdmin()) === me) {
      const [pendingAdmin] = await t.pendingDefaultAdmin();
      if (pendingAdmin !== timelock) await send(t.beginDefaultAdminTransfer(timelock));
    }
    if ((await t.defaultAdmin()) !== timelock) {
      pending.push({
        target: await t.getAddress(),
        value: 0n,
        data: t.interface.encodeFunctionData("acceptDefaultAdminTransfer", []),
        what: "CLRUSD: the timelock accepts DEFAULT_ADMIN_ROLE (after the token's admin delay)",
      });
    }
    log("clrusd: UPGRADER_ROLE and CCIP admin -> timelock; DEFAULT_ADMIN_ROLE transfer begun");
  }

  if (c.tokenPool) {
    const p = c.tokenPool;
    if ((await p.owner()) === me) {
      await send(p.transferOwnership(timelock));
      log("token pool: ownership transfer to the timelock begun");
    }
    if ((await p.owner()) !== timelock) {
      pending.push({
        target: await p.getAddress(),
        value: 0n,
        data: p.interface.encodeFunctionData("acceptOwnership", []),
        what: "token pool: the timelock accepts ownership",
      });
    }
  }

  await assertNoVaultAdmin(c, me, { timelock, pendingClrusdAdmin: true, pendingPoolOwner: true });
  return pending;
}

/** The calls the Safe schedules through the timelock to finish the handover. */
export function acceptanceCalls(pending: TimelockCall[]) {
  return {
    targets: pending.map((p) => p.target),
    values: pending.map((p) => p.value),
    payloads: pending.map((p) => p.data),
  };
}

/**
 * Throws if `account` holds any vault or CLRUSD role or ownership. With `pendingClrusdAdmin`, the
 * deployer may still be CLRUSD's default admin as long as its transfer to `timelock` is pending;
 * with `pendingPoolOwner`, the pool's ownership may still be awaiting the timelock's acceptance.
 */
export async function assertNoVaultAdmin(
  c: VaultContracts,
  account: string,
  opts: { timelock?: string; pendingClrusdAdmin?: boolean; pendingPoolOwner?: boolean } = {}
) {
  const left: string[] = [];
  if (c.vault) {
    for (const r of VAULT_ROLES) if (await c.vault.hasRole(await roleHash(c.vault, r), account)) left.push(`vault.${r}`);
  }
  if (c.clrusd) {
    for (const r of CLRUSD_ROLES) if (await c.clrusd.hasRole(await c.clrusd[r](), account)) left.push(`clrusd.${r}`);
    if ((await c.clrusd.getCCIPAdmin()) === account) left.push("clrusd.ccipAdmin");
    if ((await c.clrusd.defaultAdmin()) === account) {
      const [pendingAdmin] = await c.clrusd.pendingDefaultAdmin();
      if (!opts.pendingClrusdAdmin || pendingAdmin !== opts.timelock) left.push("clrusd.DEFAULT_ADMIN_ROLE");
    }
  }
  if (c.tokenPool && (await c.tokenPool.owner()) === account && !opts.pendingPoolOwner) left.push("tokenPool.owner");
  if (opts.timelock) {
    const { ethers } = require("hardhat");
    const tl = await ethers.getContractAt("TimelockController", opts.timelock);
    if ((await tl.getMinDelay()) < BigInt(VAULT_TIMELOCK_DELAY)) left.push("timelock delay under 7 days");
    if (await tl.hasRole(await tl.TIMELOCK_ADMIN_ROLE(), account)) left.push("timelock admin");
  }
  if (left.length > 0) throw new Error(`Still holds vault or CLRUSD powers: ${left.join(", ")}`);
}

/**
 * Successor trustee (10g): one timelock batch, proposed by the outgoing Safe, that hands the
 * timelock to `newSafe` and moves the operational roles listed in `moves`. It calls only
 * `grantRole` and `revokeRole`; the reserve does not move.
 */
export async function successorTrusteeCalls(
  timelock: any,
  oldSafe: string,
  newSafe: string,
  moves: { contract: any; role: string; from: string; to: string }[] = []
) {
  const t = await timelock.getAddress();
  const calls: TimelockCall[] = [];
  for (const r of ["PROPOSER_ROLE", "EXECUTOR_ROLE", "CANCELLER_ROLE"]) {
    const hash = await timelock[r]();
    calls.push({ target: t, value: 0n, data: timelock.interface.encodeFunctionData("grantRole", [hash, newSafe]), what: `timelock: ${r} -> new Safe` });
  }
  for (const m of moves) {
    const target = await m.contract.getAddress();
    const hash = await roleHash(m.contract, m.role);
    calls.push({ target, value: 0n, data: m.contract.interface.encodeFunctionData("grantRole", [hash, m.to]), what: `${m.role} -> ${m.to}` });
    calls.push({ target, value: 0n, data: m.contract.interface.encodeFunctionData("revokeRole", [hash, m.from]), what: `${m.role} off ${m.from}` });
  }
  // The outgoing Safe's own roles go last, so the batch runs to the end under its execution.
  for (const r of ["PROPOSER_ROLE", "CANCELLER_ROLE", "EXECUTOR_ROLE"]) {
    const hash = await timelock[r]();
    calls.push({ target: t, value: 0n, data: timelock.interface.encodeFunctionData("revokeRole", [hash, oldSafe]), what: `timelock: ${r} off the old Safe` });
  }
  return calls;
}

const list = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

async function main() {
  const { ethers } = require("hardhat");
  const { getDeployment, saveDeployment } = require("./helpers");
  if (process.env.VAULT_HANDOVER !== "1") {
    throw new Error("Set VAULT_HANDOVER=1 to confirm: this moves every vault and CLRUSD power to a 7-day timelock.");
  }
  const safe = process.env.CLEAR_FINANCIAL_SAFE;
  if (!safe || !ethers.isAddress(safe)) throw new Error("CLEAR_FINANCIAL_SAFE must be the Clear Financial Co. Safe address.");
  const { threshold, owners } = await assertTwoPersonSafe(safe);
  console.log(`Clear Financial Safe ${safe}: ${threshold} of ${owners.length}`);
  const [deployer] = await ethers.getSigners();
  const network = (await ethers.provider.getNetwork()).name;

  let timelockAddress = getDeployment(network, "VaultTimelock")?.address;
  if (!timelockAddress) {
    const t = await deployVaultTimelock(safe);
    timelockAddress = await t.getAddress();
    saveDeployment(network, "VaultTimelock", timelockAddress, JSON.parse(t.interface.formatJson()));
    console.log(`+ VaultTimelock deployed to ${timelockAddress}`);
  }
  const at = async (contract: string, record: string = contract) => {
    const r = getDeployment(network, record);
    return r ? ethers.getContractAt(contract, r.address) : undefined;
  };
  const poolRecord = getDeployment(network, "CLRUSDTokenPool");
  const c: VaultContracts = {
    vault: await at("ESADepositVault"),
    clrusd: await at("ClearUSDUpgradeable"),
    tokenPool: poolRecord
      ? await ethers.getContractAt(["function owner() view returns (address)", "function transferOwnership(address)", "function acceptOwnership()"], poolRecord.address)
      : undefined,
  };
  const keys: VaultKeys = {
    relayers: list(process.env.VAULT_RELAYERS),
    pausers: list(process.env.VAULT_PAUSERS),
    pilot: list(process.env.PILOT_SIGNERS),
    fraud: list(process.env.FRAUD_SIGNERS),
    security: list(process.env.SECURITY_SIGNERS),
  };
  const pending = await handOverVault(c, deployer, timelockAddress!, keys, console.log);
  console.log("\nThe deployer holds no vault or CLRUSD role. For the Clear Financial Safe to schedule (scheduleBatch, 7 days):");
  for (const p of pending) console.log(`  ${p.target}  ${p.data}   # ${p.what}`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
