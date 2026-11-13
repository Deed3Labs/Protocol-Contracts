/**
 * Credit and savings timelock handover (compliance spec 10e, DECISIONS #10).
 *
 * Deploys the credit TimelockController (minimum delay 7 days; the Ops Safe proposes and executes;
 * no admin, so the delay itself can only change through a delayed proposal) and moves every
 * upgrade and admin power over the credit and savings contracts to it. The deployer keeps nothing
 * of those: `assertNoCreditAdmin` checks that, and the handover throws if it fails.
 *
 * What moves:
 * - Ownable (`owner()` authorizes upgrades): RevolvingIssuer, TermIssuer, RateSchedule, and the
 *   AssurancePool/AssuranceOracle if given.
 * - DEFAULT_ADMIN_ROLE (authorizes upgrades and settings): NetworkRegistry, CollateralRegistry,
 *   LimitCalculator, Liquidator, MerchantRegistry, ESADepositVault, ClaimEscrow, and the
 *   AccessManager, whose admin is the ledger's admin and passes every credit role.
 * - CLRUSD: DEFAULT_ADMIN_ROLE and UPGRADER_ROLE.
 *
 * What does not: operational roles (CREDIT_LINES/LIMITS, OPERATOR, FRAUD_ROLE, SECURITY_ROLE,
 * STATE_ATTESTER_ROLE, minters). Those are granted to their keys before this runs; once the
 * AccessManager admin is the timelock, granting a new one is itself a 7-day proposal.
 *
 * Every member-facing exit stays open during a pending upgrade: CLRUSD transfers and vault
 * redemptions are not gated by the timelock (Dfal.spec acceptance 17).
 *
 * This module only builds transactions from the signer it is given. It never reads a key.
 *
 *   OPS_SAFE=0x... CREDIT_HANDOVER=1 npx hardhat run deploy/credit_timelock_handover.ts --network base-sepolia
 */

export const CREDIT_TIMELOCK_DELAY = 7 * 24 * 60 * 60;
const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

export interface CreditContracts {
  revolving?: any;
  term?: any;
  rateSchedule?: any;
  assurancePool?: any;
  assuranceOracle?: any;
  networkRegistry?: any;
  collateral?: any;
  limits?: any;
  liquidator?: any;
  merchantRegistry?: any;
  vault?: any;
  claimEscrow?: any;
  access?: any;
  clrusd?: any;
}

const OWNABLE: (keyof CreditContracts)[] = ["revolving", "term", "rateSchedule", "assurancePool", "assuranceOracle"];
const ADMIN_ONLY: (keyof CreditContracts)[] = [
  "networkRegistry", "collateral", "limits", "liquidator", "merchantRegistry", "vault", "claimEscrow", "access",
];

async function send(txp: Promise<any>) {
  await (await txp).wait();
}

/** Deploys the credit TimelockController with `proposer` proposing and executing, and no admin. */
export async function deployCreditTimelock(proposer: string, delay = CREDIT_TIMELOCK_DELAY) {
  const { ethers } = require("hardhat");
  if (delay < CREDIT_TIMELOCK_DELAY) throw new Error("The credit timelock delay must be at least 7 days.");
  const F = await ethers.getContractFactory("TimelockController");
  const timelock = await F.deploy(delay, [proposer], [proposer], ethers.ZeroAddress);
  await timelock.waitForDeployment();
  return timelock;
}

export async function handOverCredit(c: CreditContracts, deployerSigner: any, timelock: string, log: (m: string) => void = () => {}) {
  const me = await deployerSigner.getAddress();

  for (const name of OWNABLE) {
    const ct = c[name];
    if (ct && (await ct.owner()) === me) {
      await send(ct.transferOwnership(timelock));
      log(`${name}: owner -> timelock`);
    }
  }

  const move = async (name: string, ct: any, roles: string[]) => {
    for (const r of roles) if (!(await ct.hasRole(r, timelock))) await send(ct.grantRole(r, timelock));
    // DEFAULT_ADMIN_ROLE last: renouncing it first would leave nothing able to finish.
    const ordered = [...roles].sort((a, b) => (a === ZERO ? 1 : 0) - (b === ZERO ? 1 : 0));
    for (const r of ordered) if (await ct.hasRole(r, me)) await send(ct.renounceRole(r, me));
    log(`${name}: admin -> timelock`);
  };
  for (const name of ADMIN_ONLY) if (c[name]) await move(name, c[name], [ZERO]);
  if (c.clrusd) await move("clrusd", c.clrusd, [await c.clrusd.UPGRADER_ROLE(), ZERO]);

  await assertNoCreditAdmin(c, me);
}

/** Throws if `account` still holds an upgrade or admin power on a credit or savings contract. */
export async function assertNoCreditAdmin(c: CreditContracts, account: string) {
  const left: string[] = [];
  for (const name of OWNABLE) if (c[name] && (await c[name].owner()) === account) left.push(`${name}.owner`);
  for (const name of ADMIN_ONLY) if (c[name] && (await c[name].hasRole(ZERO, account))) left.push(`${name}.DEFAULT_ADMIN_ROLE`);
  if (c.clrusd) {
    if (await c.clrusd.hasRole(ZERO, account)) left.push("clrusd.DEFAULT_ADMIN_ROLE");
    if (await c.clrusd.hasRole(await c.clrusd.UPGRADER_ROLE(), account)) left.push("clrusd.UPGRADER_ROLE");
  }
  if (left.length > 0) throw new Error(`Deployer still holds credit admin powers: ${left.join(", ")}`);
}

async function main() {
  const { ethers } = require("hardhat");
  const { getDeployment, saveDeployment } = require("./helpers");
  if (process.env.CREDIT_HANDOVER !== "1") {
    throw new Error("Set CREDIT_HANDOVER=1 to confirm: this moves every credit admin power to a 7-day timelock.");
  }
  const safe = process.env.OPS_SAFE;
  if (!safe || !ethers.isAddress(safe)) throw new Error("OPS_SAFE must be the Ops Safe address.");
  const [deployer] = await ethers.getSigners();
  const network = (await ethers.provider.getNetwork()).name;

  let timelockAddress = getDeployment(network, "CreditTimelock")?.address;
  if (!timelockAddress) {
    const t = await deployCreditTimelock(safe);
    timelockAddress = await t.getAddress();
    saveDeployment(network, "CreditTimelock", timelockAddress, JSON.parse(t.interface.formatJson()));
    console.log(`+ CreditTimelock deployed to ${timelockAddress}`);
  }

  const at = async (contract: string, record: string = contract) => {
    const r = getDeployment(network, record);
    return r ? ethers.getContractAt(contract, r.address) : undefined;
  };
  const c: CreditContracts = {
    revolving: await at("RevolvingIssuer"),
    term: await at("TermIssuer"),
    rateSchedule: await at("RateSchedule"),
    assurancePool: await at("AssurancePool"),
    assuranceOracle: await at("AssuranceOracle"),
    networkRegistry: await at("NetworkRegistry"),
    collateral: await at("CollateralRegistry"),
    limits: await at("LimitCalculator"),
    liquidator: await at("Liquidator"),
    merchantRegistry: await at("MerchantRegistry"),
    vault: await at("ESADepositVault"),
    claimEscrow: await at("ClaimEscrow"),
    access: await at("AccessManager"),
    clrusd: await at("ClearUSDUpgradeable"),
  };
  await handOverCredit(c, deployer, timelockAddress!, console.log);
  console.log("\nCredit handover done. The deployer holds no credit admin power.");
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
