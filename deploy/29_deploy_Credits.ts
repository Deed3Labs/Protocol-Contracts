import { getDeployment, requireMainnetConfirmation, saveDeployment } from "./helpers";

/**
 * Clear Credits and the Housing Allowance: the points ledger, its issuer, and the on-chain record of each
 * member's equity toward a Clear home.
 *
 * Deploys, and records under deployments/<network>/:
 *   - CreditsAccessManager   an AccessManager of the Credits Ledger's own, so the credit ledger's admins
 *                            have no say over it (P0 spike finding, #950);
 *   - CreditsLedger          a second ClearCredit proxy, "Clear Credits" (CREDITS);
 *   - CreditsNetworkRegistry the ledger's issuer registry, with the Points Issuer as its only issuer;
 *   - CreditsMerchantRegistry an empty merchant registry whose admin and operator roles are renounced, so
 *                            nobody can ever register a merchant credits could be spent at (#950);
 *   - PointsIssuer           the issuer: mints, redeems, spends and reverses credits;
 *   - HousingAllowanceRecord the Housing Allowance, which the Points Issuer redeems into.
 *
 * and wires them: the ledger's registries, the Points Issuer as its only system recipient and an operator
 * of its AccessManager, the issuer's line cap, the issuer's Housing Allowance Record, and the roles below.
 * The ledger never gets a reserve token, a payout pool or a lender operating account.
 *
 * Roles (inputs):
 *   CREDITS_MINTER         the API relayer that mints vested credits (CREDITS_MINTER_ROLE)
 *   CREDITS_MEMBERS_KEY    the key that opens each member's Match Period (default CREDITS_MINTER)
 *   CREDITS_REVIEWER_1/2   two people who propose and approve reversals (CREDITS_REVIEW_ROLE)
 *   HOUSING_WRITER         Clear Properties' ops multisig (HOUSING_WRITER_ROLE)
 *   CREDITS_CAP            the most credits outstanding at once, in whole credits (default 10,000,000)
 *   RESERVE_TOKEN          USDC, which members pay toward a home in
 *
 * The deployer stays admin of everything here until `CREDITS_HANDOVER=1` hands it to CREDITS_TIMELOCK
 * (default the CreditTimelock): the AccessManager's admin role, the Points Issuer's ownership and the
 * record's admin role. The RedemptionAgent comes with the Deed v5 contracts (deploy 30), which also points
 * the record's deed contract at it.
 *
 * Idempotent: anything already recorded is reused.
 *
 *   npx hardhat run deploy/29_deploy_Credits.ts --network base-sepolia
 */

const ONE = 10n ** 6n;

export interface CreditsInputs {
  network?: string;
  usdc: string;
  minter: string;
  membersKey?: string;
  reviewers: [string, string];
  housingWriter: string;
  capCredits?: bigint;
  log?: (m: string) => void;
}

export async function deployCredits(o: CreditsInputs) {
  const { ethers, upgrades } = require("hardhat");
  const log = o.log ?? console.log;
  const [deployer] = await ethers.getSigners();
  for (const [what, a] of [
    ["CREDITS_MINTER", o.minter],
    ["CREDITS_REVIEWER_1", o.reviewers[0]],
    ["CREDITS_REVIEWER_2", o.reviewers[1]],
    ["HOUSING_WRITER", o.housingWriter],
  ] as const) {
    if (!ethers.isAddress(a)) throw new Error(`${what} ${a || "(empty)"} is not an address.`);
  }
  if (o.reviewers[0].toLowerCase() === o.reviewers[1].toLowerCase()) throw new Error("CREDITS_REVIEWER_1 and _2 must be different people.");
  if (!ethers.isAddress(o.usdc) || (await ethers.provider.getCode(o.usdc)) === "0x") throw new Error(`RESERVE_TOKEN ${o.usdc} is not a contract.`);

  const record = (name: string) => (o.network ? getDeployment(o.network, name) : null);
  const save = async (name: string, c: any) => {
    if (o.network) saveDeployment(o.network, name, await c.getAddress(), JSON.parse(c.interface.formatJson()));
  };
  async function proxy(name: string, factory: string, args: unknown[]) {
    const r = record(name);
    if (r) {
      log(`= ${name.padEnd(24)} ${r.address}`);
      return ethers.getContractAt(factory, r.address);
    }
    const c = await upgrades.deployProxy(await ethers.getContractFactory(factory), args, { kind: "uups" });
    await c.waitForDeployment();
    await save(name, c);
    log(`+ ${name.padEnd(24)} ${await c.getAddress()}`);
    return c;
  }

  // The ledger's own AccessManager.
  let access: any;
  const ra = record("CreditsAccessManager");
  if (ra) {
    access = await ethers.getContractAt("AccessManager", ra.address);
    log(`= ${"CreditsAccessManager".padEnd(24)} ${ra.address}`);
  } else {
    access = await (await ethers.getContractFactory("AccessManager")).deploy();
    await access.waitForDeployment();
    await (await access.initialize(deployer.address)).wait();
    await save("CreditsAccessManager", access);
    log(`+ ${"CreditsAccessManager".padEnd(24)} ${await access.getAddress()}`);
  }

  const ledger = await proxy("CreditsLedger", "ClearCredit", ["Clear Credits", "CREDITS", await access.getAddress()]);
  const registry = await proxy("CreditsNetworkRegistry", "NetworkRegistry", [deployer.address]);
  const merchants = await proxy("CreditsMerchantRegistry", "MerchantRegistry", [deployer.address, 30]);
  const points = await proxy("PointsIssuer", "PointsIssuer", [await ledger.getAddress()]);
  const housing = await proxy("HousingAllowanceRecord", "HousingAllowanceRecord", [deployer.address, o.usdc, await points.getAddress()]);

  const A = (c: any) => c.getAddress();
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const step = async (what: string, done: boolean, send: () => Promise<any>) => {
    if (done) return log(`  = ${what}`);
    await (await send()).wait();
    log(`  + ${what}`);
  };

  // Wiring.
  await step("ledger is an operator of its AccessManager", await access.isOperator(await A(ledger)), () => access.grantOperator(A(ledger)));
  await step("Points Issuer is an operator of the AccessManager", await access.isOperator(await A(points)), () => access.grantOperator(A(points)));
  await step("ledger reads its network registry", same(await ledger.networkRegistry(), await A(registry)), () => ledger.setNetworkRegistry(A(registry)));
  await step("ledger applies its transfer policy (merchant registry set)", same(await ledger.merchantRegistry(), await A(merchants)), () => ledger.setMerchantRegistry(A(merchants)));
  await step("Points Issuer is the ledger's only issuer", await registry.isIssuerOf(await A(points), await A(ledger)), () => registry.registerIssuer(A(points), A(ledger)));
  await step("Points Issuer is the ledger's only system recipient", await ledger.isSystemRecipient(await A(points)), () => ledger.setSystemRecipient(A(points), true));
  const cap = (o.capCredits ?? 10_000_000n) * ONE;
  await step(`Points Issuer's line cap ${cap / ONE} credits`, (await points.cap()) === cap, () => points.setCap(cap));
  await step("Points Issuer redeems into the Housing Allowance Record", same(await points.housingRecord(), await A(housing)), () => points.setHousingRecord(A(housing)));

  // The merchant registry stays empty for good.
  for (const [what, role] of [["operator", await merchants.OPERATOR_ROLE()], ["admin", await merchants.DEFAULT_ADMIN_ROLE()]] as const) {
    await step(`merchant registry ${what} role renounced`, !(await merchants.hasRole(role, deployer.address)), () => merchants.renounceRole(role, deployer.address));
  }

  // Roles.
  const grant = async (what: string, role: string, who: string) =>
    step(`${what} -> ${who}`, await access.hasRole(role, who), () => access.grantRole(role, who));
  await grant("CREDITS_MINTER_ROLE", await points.CREDITS_MINTER_ROLE(), o.minter);
  await grant("CREDITS_MEMBERS_ROLE", await points.MEMBERS_ROLE(), o.membersKey || o.minter);
  await grant("CREDITS_REVIEW_ROLE", await points.CREDITS_REVIEW_ROLE(), o.reviewers[0]);
  await grant("CREDITS_REVIEW_ROLE", await points.CREDITS_REVIEW_ROLE(), o.reviewers[1]);
  const writer = await housing.HOUSING_WRITER_ROLE();
  await step(`HOUSING_WRITER_ROLE -> ${o.housingWriter}`, await housing.hasRole(writer, o.housingWriter), () => housing.grantRole(writer, o.housingWriter));

  return { access, ledger, registry, merchants, points, housing };
}

/**
 * Hands the deployer's powers to the timelock: the AccessManager's admin role (which is also the ledger's
 * and registry's admin), the Points Issuer's ownership, and the record's admin role. The deployer keeps
 * nothing afterwards.
 */
export async function handOverCredits(c: Awaited<ReturnType<typeof deployCredits>>, timelock: string, log: (m: string) => void = console.log) {
  const { ethers } = require("hardhat");
  const [deployer] = await ethers.getSigners();
  if (!ethers.isAddress(timelock) || (await ethers.provider.getCode(timelock)) === "0x") throw new Error(`CREDITS_TIMELOCK ${timelock} is not a contract.`);
  const ADMIN = ethers.ZeroHash;
  const tx = async (what: string, send: () => Promise<any>) => {
    await (await send()).wait();
    log(`  + ${what}`);
  };
  if (!(await c.access.hasRole(ADMIN, timelock))) await tx("AccessManager admin -> timelock", () => c.access.grantRole(ADMIN, timelock));
  if (!(await c.housing.hasRole(ADMIN, timelock))) await tx("HousingAllowanceRecord admin -> timelock", () => c.housing.grantRole(ADMIN, timelock));
  if ((await c.points.owner()).toLowerCase() !== timelock.toLowerCase()) await tx("PointsIssuer owner -> timelock", () => c.points.transferOwnership(timelock));
  const registryAdmin = await c.registry.DEFAULT_ADMIN_ROLE().catch(() => ADMIN);
  if (c.registry.hasRole && !(await c.registry.hasRole(registryAdmin, timelock).catch(() => true))) {
    await tx("CreditsNetworkRegistry admin -> timelock", () => c.registry.grantRole(registryAdmin, timelock));
  }
  // The deployer gives up its own last.
  if (await c.housing.hasRole(ADMIN, deployer.address)) await tx("deployer renounces the record's admin", () => c.housing.renounceRole(ADMIN, deployer.address));
  if (c.registry.hasRole && (await c.registry.hasRole(registryAdmin, deployer.address).catch(() => false))) {
    await tx("deployer renounces the registry's admin", () => c.registry.renounceRole(registryAdmin, deployer.address));
  }
  if (await c.access.hasRole(ADMIN, deployer.address)) await tx("deployer renounces the AccessManager's admin", () => c.access.renounceRole(ADMIN, deployer.address));
}

async function main() {
  const { ethers } = require("hardhat");
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;
  requireMainnetConfirmation(network, "deploy/29_deploy_Credits.ts");
  const env = (k: string) => process.env[k]?.trim() ?? "";
  console.log(`network                  ${network} (${net.chainId})`);
  const c = await deployCredits({
    network,
    usdc: env("RESERVE_TOKEN"),
    minter: env("CREDITS_MINTER"),
    membersKey: env("CREDITS_MEMBERS_KEY") || undefined,
    reviewers: [env("CREDITS_REVIEWER_1"), env("CREDITS_REVIEWER_2")],
    housingWriter: env("HOUSING_WRITER"),
    capCredits: env("CREDITS_CAP") ? BigInt(env("CREDITS_CAP")) : undefined,
  });
  if (env("CREDITS_HANDOVER") === "1") {
    const timelock = env("CREDITS_TIMELOCK") || getDeployment(network, "CreditTimelock")?.address || "";
    console.log(`\nhanding over to ${timelock}`);
    await handOverCredits(c, timelock);
  } else {
    console.log("\nThe deployer is still admin. CREDITS_HANDOVER=1 hands it to CREDITS_TIMELOCK (default the CreditTimelock).");
  }
  console.log(`\nleft to do:
  - deploy 30 (Deed v5): the RedemptionAgent, then HousingAllowanceRecord.setDeedContract(agent)
  - the API: CREDITS_LEDGER_${net.chainId}=${await c.ledger.getAddress()}, POINTS_ISSUER_${net.chainId}=${await c.points.getAddress()},
    HOUSING_ALLOWANCE_RECORD_${net.chainId}=${await c.housing.getAddress()}`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
