import { saveDeployment, getDeployment } from "./helpers";

/**
 * The credit core: the ledger, the registries, and the two issuers that sit on it.
 *
 * The recipe is `test/helpers/phase0-fixture.ts`, deliberately. That fixture already encodes the
 * ordering, the roles each contract needs in its own name, and the cross-registration that makes
 * the ledger accept more than one issuer -- and 597 tests exercise it every run. Rewriting the
 * same wiring here from the contracts would mean maintaining two descriptions of one system, and
 * the deployment would be the one nobody checks.
 *
 * Everything is deployed behind a UUPS proxy. The ledger holds one signed balance per member and
 * an issuer holds their credit lines and carry checkpoints; nothing recreates either, so a bug in
 * them could otherwise only be answered by moving every account to a replacement by hand.
 * Upgrade authority sits with the admin that already governs each contract, which is not a new
 * trust surface -- it is the power that address already has, written down.
 *
 * Idempotent: anything already recorded in `deployments/<network>/` is reused rather than
 * redeployed, so a failed run can simply be run again. Re-running the wiring is harmless -- every
 * call is a set, not an append.
 *
 * AssurancePool and AssuranceOracle are Phase C. If they are already deployed, the issuers are
 * registered against them here; if not, this stops short of that and says so, rather than
 * registering against a zero address the way `08_deploy_AssurancePool.ts` used to.
 *
 *   npx hardhat run deploy/20_deploy_CreditCore.ts --network base-sepolia
 */

const LEDGER_NAME = "Clear Credit";
const LEDGER_SYMBOL = "CLRC";

export interface CreditCore {
  ledger: any;
  networkRegistry: any;
  revolving: any;
  term: any;
  collateral: any;
  limits: any;
}

/**
 * Deploys and wires the credit core, returning the contracts.
 *
 * Exported so it can be run against a fresh chain in a test rather than only by hand against a
 * real one. A deployment script that has never been executed is a plan, not a script, and the
 * wiring here is the part most worth proving: a missing role or an unregistered issuer produces a
 * system that deploys cleanly and then refuses the first draw.
 */
export async function deployCreditCore(options: { quiet?: boolean } = {}): Promise<CreditCore> {
  const hre = require("hardhat");
  const { ethers, upgrades } = hre;
  const [deployer] = await ethers.getSigners();
  const network = (await ethers.provider.getNetwork()).name;
  const log = options.quiet ? () => {} : console.log;

  log(`Deploying the credit core to ${network} as ${deployer.address}\n`);

  // The co-op's own address, which is where carry lands and where a seized position falls back
  // to. The deployer stands in on a testnet; on mainnet this must be the multisig.
  const carryTreasury = process.env.CARRY_TREASURY ?? deployer.address;
  if (!process.env.CARRY_TREASURY) {
    log(`! CARRY_TREASURY unset — using the deployer (${deployer.address}).`);
    log("  Set it to the co-op multisig before deploying anywhere real.\n");
  }

  /** Deploys behind a proxy, or returns what is already recorded for this network. */
  async function ensure(name: string, args: unknown[], contractName = name) {
    const existing = getDeployment(network, name);
    if (existing) {
      log(`= ${name} already at ${existing.address}`);
      return ethers.getContractAt(contractName, existing.address);
    }
    const factory = await ethers.getContractFactory(contractName);
    const instance = await upgrades.deployProxy(factory, args, {
      initializer: "initialize",
      kind: "uups",
    });
    await instance.waitForDeployment();
    const address = await instance.getAddress();
    saveDeployment(network, name, address, JSON.parse(instance.interface.formatJson()));
    log(`+ ${name} deployed to ${address}`);
    return instance;
  }

  const accessRecord = getDeployment(network, "AccessManager");
  if (!accessRecord) {
    throw new Error(
      "No AccessManager on this network. Run deploy/16_deploy_AccessManager.ts first — the " +
        "ledger grants membership through it and cannot be initialized without one."
    );
  }
  const access = await ethers.getContractAt("AccessManager", accessRecord.address);
  log(`= AccessManager at ${accessRecord.address}`);

  // ---- the ledger and the registry that lets it hold more than one issuer ----
  const ledger = await ensure("ClearCredit", [LEDGER_NAME, LEDGER_SYMBOL, accessRecord.address]);
  const ledgerAddress = await ledger.getAddress();

  const networkRegistry = await ensure("NetworkRegistry", [deployer.address]);
  const networkRegistryAddress = await networkRegistry.getAddress();

  // ---- the issuers ----
  const revolving = await ensure("RevolvingIssuer", [ledgerAddress, carryTreasury]);
  const term = await ensure("TermIssuer", [ledgerAddress, carryTreasury]);
  const revolvingAddress = await revolving.getAddress();
  const termAddress = await term.getAddress();

  // ---- collateral and the ceiling it produces ----
  const collateral = await ensure("CollateralRegistry", [deployer.address, networkRegistryAddress]);
  const collateralAddress = await collateral.getAddress();

  // The calculator points at one issuer: it revalues the revolving tiers. Term plans carry their
  // own income-based limit and do not take a ceiling from collateral.
  const limits = await ensure("LimitCalculator", [
    deployer.address,
    collateralAddress,
    revolvingAddress,
  ]);
  const limitsAddress = await limits.getAddress();

  log("\nWiring:");

  // The ledger grants membership when a credit line opens and each issuer acts on the
  // AccessManager in its own name, so all three need operator access.
  for (const [label, address] of [
    ["ClearCredit", ledgerAddress],
    ["RevolvingIssuer", revolvingAddress],
    ["TermIssuer", termAddress],
    ["LimitCalculator", limitsAddress],
  ] as const) {
    if (!(await access.isOperator(address))) {
      await (await access.grantOperator(address)).wait();
      log(`  operator granted to ${label}`);
    }
  }

  if ((await ledger.networkRegistry()) !== networkRegistryAddress) {
    await (await ledger.setNetworkRegistry(networkRegistryAddress)).wait();
    log("  ledger -> NetworkRegistry");
  }

  // The calculator writes tier capacities onto the issuer and refreshes the registry's view of a
  // member, so it needs to be an operator of both, not merely known to them.
  const operatorRole = await collateral.OPERATOR_ROLE();
  if (!(await collateral.hasRole(operatorRole, limitsAddress))) {
    await (await collateral.grantRole(operatorRole, limitsAddress)).wait();
    log("  CollateralRegistry operator -> LimitCalculator");
  }

  // Only the revolving issuer reads collateral: it is the one whose tiers are backed by pledges.
  // Term plans sit under an income-based limit and pledge nothing, so there is nothing to point
  // at -- TermIssuer has no exposure source to set.
  if ((await revolving.exposureSource()) !== collateralAddress) {
    await (await revolving.setExposureSource(collateralAddress)).wait();
    log("  RevolvingIssuer -> CollateralRegistry");
  }

  // ---- the tiers, and the collateral kinds they draw against ----
  //
  // A deployed issuer with no tiers is a credit line with no ceiling anywhere in it: capacityOf
  // has nothing to return and no member can draw a cent. The rates are the build plan's (§Phase 1
  // valuation rules) and they ascend, which is not decoration -- cheapest-first draw order falls
  // out of the ordering rather than being enforced separately, so getting it wrong here would put
  // a member on Boost before their own savings.
  const TIERS: [string, bigint][] = [
    ["SAVINGS", 0n],          // their own money, backing itself
    ["ASSET_INTERNAL", 65n],  // bonds and pool shares: locked money that still lends
    ["INCOME", 150n],         // nothing behind it but the next deposit
    ["BOOST", 300n],          // opt-in, and priced like it
  ];
  const CYCLE = 30 * 24 * 60 * 60;

  const existingTiers = Number(await revolving.tierCount());
  if (existingTiers === 0) {
    for (const [kind, rate] of TIERS) {
      await (await revolving.addTier(ethers.encodeBytes32String(kind), rate, CYCLE)).wait();
      log(`  tier ${kind} at ${rate} bps/cycle`);
    }
  } else {
    log(`= ${existingTiers} tier(s) already configured`);
  }

  // Haircuts are the plan's, and deliberately conservative: start high, lower with evidence.
  // Savings at 100% because seizure is at par and burns the debt outright; the internal-asset
  // kind at 95% because a bond is a claim on the co-op with known redemption terms rather than
  // something that must be sold. Income and Boost register with no collateral at all -- they are
  // unsecured, and their capacity comes from an attestation rather than a pledge.
  const SAVINGS_BACKED = 1, ASSET_INTERNAL = 3, UNSECURED = 0;
  const PRICE = 10n ** 18n;
  const COLLATERAL: [string, number, bigint, bigint][] = [
    ["SAVINGS", SAVINGS_BACKED, 10_000n, PRICE],
    ["ASSET_INTERNAL", ASSET_INTERNAL, 9_500n, PRICE],
    ["INCOME", UNSECURED, 0n, 0n],
    ["BOOST", UNSECURED, 0n, 0n],
  ];
  for (const [kind, backing, haircut, price] of COLLATERAL) {
    const key = ethers.encodeBytes32String(kind);
    const registered = (await collateral.collateralTypes(key)).registered;
    if (!registered) {
      await (await collateral.registerCollateralType(key, backing, haircut, price)).wait();
      log(`  collateral ${kind} at ${Number(haircut) / 100}%`);
    }
  }

  // Name the kind held as CLRUSD in members' own accounts.
  //
  // Without this the whole encumbrance round-trip is open and looks closed. CLRUSD asks the
  // registry what a holder has locked, `encumberedOf` reads `clrusdKind`, and an unset kind
  // returns zero -- so a member carrying savings-backed credit could move the very CLRUSD backing
  // it into a bond or the pool and have it counted twice. Every piece was deployed and wired; the
  // one field that makes them mean anything was not set.
  const savingsKey = ethers.encodeBytes32String("SAVINGS");
  if ((await collateral.clrusdKind()) !== savingsKey) {
    await (await collateral.setClrusdKind(savingsKey)).wait();
    log("  clrusdKind -> SAVINGS");
  }

  // ---- Phase C's half, done here only if it already exists ----
  const pool = getDeployment(network, "AssurancePool");
  const oracle = getDeployment(network, "AssuranceOracle");

  if (pool && oracle) {
    const assurancePool = await ethers.getContractAt("AssurancePool", pool.address);
    // The pool's exposure source is the RTD denominator: what it would actually pay if every
    // member defaulted. Without it the pool reserves against all credit, savings-backed included.
    if ((await assurancePool.exposureSource()) !== collateralAddress) {
      await (await assurancePool.setExposureSource(collateralAddress)).wait();
      log("  AssurancePool -> CollateralRegistry");
    }
    if ((await ledger.assurancePool()) !== pool.address) {
      await (await ledger.setAssurancePool(pool.address)).wait();
      log("  ledger -> AssurancePool");
    }
    for (const [label, issuerAddress] of [
      ["RevolvingIssuer", revolvingAddress],
      ["TermIssuer", termAddress],
    ] as const) {
      if (!(await networkRegistry.isIssuer(issuerAddress))) {
        await (
          await networkRegistry.registerIssuer(
            issuerAddress,
            ledgerAddress,
            pool.address,
            oracle.address
          )
        ).wait();
        log(`  registered ${label} against the ledger`);
      }
    }
  } else {
    log(
      "\n! No AssurancePool/AssuranceOracle on this network yet, so the issuers are NOT registered."
    );
    log("  A member cannot draw until they are. Deploy those (Phase C), then re-run this.");
  }

  log("\nCredit core deployed.");

  return { ledger, networkRegistry, revolving, term, collateral, limits };
}

async function main() {
  await deployCreditCore();
}

// Only when run directly. Importing this file -- which the deployment test does, so the wiring
// is proved against a fresh chain every suite -- must not kick off a deployment as a side effect.
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
