import { saveDeployment, getDeployment } from "./helpers";
import { deployBondFactory } from "./bondModules";
import { poolAt, poolProxyOptions } from "./poolModules";

/**
 * Phase E: the contracts that put something real behind the asset-backed tier, and pay merchants.
 *
 * Two groups that share a script because they share a dependency — both need the ledger and the
 * reserve token, and both are wired into the same CollateralRegistry.
 *
 *   Bonds     BurnerBondFactory (which deploys the collections), BondVault, BondValuer
 *   Capital   LendingPool, PayoutPool, MerchantRegistry, Liquidator
 *
 * Registering bonds and pool shares as collateral is what lights the asset-backed tier up: until a
 * kind is registered the calculator values it at nothing, so a member holding a bond has no more
 * credit than one holding none.
 *
 * The two kinds are registered separately and haircut differently, which is the point of the
 * distinction the build plan draws. A bond is an internal claim with known redemption terms; a
 * pool share is also internal but correlated — pool NAV falls exactly when credit lines impair, so
 * it takes a deeper cut for a reason that has nothing to do with volatility.
 *
 * Idempotent, like 20. Anything already recorded is reused.
 *
 *   npx hardhat run deploy/22_deploy_BondsAndPool.ts --network base-sepolia
 */
async function main() {
  const hre = require("hardhat");
  const { ethers, upgrades } = hre;
  const [deployer] = await ethers.getSigners();
  const network = (await ethers.provider.getNetwork()).name;
  const log = (m: string) => console.log(m);

  const need = (name: string) => {
    const record = getDeployment(network, name);
    if (!record) {
      throw new Error(`${name} is not deployed on ${network}. Run the credit core first (deploy/20).`);
    }
    return record.address;
  };

  const ledger = need("ClearCredit");
  const collateralRegistry = need("CollateralRegistry");
  // The bond factory gates collections on the TokenRegistry's whitelist. Nothing here takes the
  // co-op's AssurancePool: bond principal never enters it, and no payout or bond path calls it.
  const tokenRegistry = need("TokenRegistry");
  const clrusd = need("ClearUSDUpgradeable");
  const vault = need("ESADepositVault");
  const reserveToken = process.env.RESERVE_TOKEN ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const coopTreasury = process.env.COOP_TREASURY ?? deployer.address;

  if (!process.env.COOP_TREASURY) {
    log(`! COOP_TREASURY unset — using the deployer (${deployer.address}).`);
    log("  Redeemed merchant positions land here. Set it to the multisig anywhere real.\n");
  }

  async function ensure(name: string, args: unknown[], contractName = name, options: Record<string, unknown> = {}) {
    const existing = getDeployment(network, name);
    if (existing) {
      log(`= ${name} already at ${existing.address}`);
      return ethers.getContractAt(contractName, existing.address);
    }
    const factory = await ethers.getContractFactory(contractName);
    const instance = await upgrades.deployProxy(factory, args, {
      initializer: "initialize",
      kind: "uups",
      ...options,
    });
    await instance.waitForDeployment();
    const address = await instance.getAddress();
    saveDeployment(network, name, address, JSON.parse(instance.interface.formatJson()));
    log(`+ ${name} deployed to ${address}`);
    return instance;
  }

  // ---- merchant payouts ----
  //
  // Net-30 is the floor rather than the promise: a funded pool simply beats it. Thirty days is
  // what a merchant is told, so it is what the registry defaults to.
  const merchants = await ensure("MerchantRegistry", [deployer.address, 30 * 24 * 60 * 60]);
  const merchantsAddress = await merchants.getAddress();

  const payoutPool = await ensure("PayoutPool", [
    deployer.address,
    ledger,
    reserveToken,
    merchantsAddress,
    coopTreasury,
  ]);
  const payoutPoolAddress = await payoutPool.getAddress();

  // ---- capital ----
  // Phase 2f: the Yield Pool, with its YieldPoolValuation and YieldPoolLedger modules pinned at
  // construction.
  const lendingPool = await ensure("LendingPool", [
    deployer.address,
    reserveToken,
    "Clear Lending Pool",
    "clrLP",
  ], "LendingPool", await poolProxyOptions());
  const lendingPoolAddress = await lendingPool.getAddress();

  // ---- bonds ----
  //
  // A three-month redemption window: the vault holds face value for everything maturing inside it
  // and only the excess above that is deployable. The window is what makes the reserve a rule the
  // code enforces rather than a policy somebody remembers.
  const bondVault = await ensure("BondVault", [deployer.address, reserveToken, 90 * 24 * 60 * 60]);
  const bondVaultAddress = await bondVault.getAddress();

  let factoryAddress = getDeployment(network, "BurnerBondFactory")?.address;
  if (!factoryAddress) {
    // Phase 2e: with the BurnerBondPledges module its bond implementation pins.
    const factory = await deployBondFactory(tokenRegistry, process.env.BOND_BASE_URI ?? "ipfs://clear-bonds/");
    factoryAddress = await factory.getAddress();
    saveDeployment(network, "BurnerBondFactory", factoryAddress, JSON.parse(factory.interface.formatJson()));
    log(`+ BurnerBondFactory deployed to ${factoryAddress}`);
  } else {
    log(`= BurnerBondFactory already at ${factoryAddress}`);
  }

  // ---- liquidation ----
  const liquidator = await ensure("Liquidator", [
    deployer.address,
    ledger,
    clrusd,
    vault,
    reserveToken,
    collateralRegistry,
  ]);
  const liquidatorAddress = await liquidator.getAddress();

  log("\nWiring:");

  const registry = await ethers.getContractAt("CollateralRegistry", collateralRegistry);
  const operatorRole = await registry.OPERATOR_ROLE();
  if (!(await registry.hasRole(operatorRole, liquidatorAddress))) {
    await (await registry.grantRole(operatorRole, liquidatorAddress)).wait();
    log("  CollateralRegistry operator -> Liquidator");
  }

  // Pool shares as their own collateral kind. Seventy percent, and the cut is for CORRELATION
  // rather than volatility: the pool's value is backed by the same loan book the credit line is
  // drawn against, so it falls exactly when it is most needed. A volatility haircut would be
  // priced off how much the number moves; this one is priced off when it moves.
  const POOL_SHARE = ethers.encodeBytes32String("POOL_SHARE");
  const ASSET_INTERNAL_BACKING = 3;
  if (!(await registry.collateralTypes(POOL_SHARE)).registered) {
    await (await registry.registerCollateralType(POOL_SHARE, ASSET_INTERNAL_BACKING, 7_000n, 10n ** 18n)).wait();
    log("  collateral POOL_SHARE at 70%");
  }
  if ((await lendingPool.encumbranceSource()) !== collateralRegistry) {
    await (await lendingPool.setEncumbranceSource(collateralRegistry, POOL_SHARE)).wait();
    log("  LendingPool encumbrance -> CollateralRegistry");
  }

  // Repayments reach the merchants owed before anything goes to Lending Co. (section 13). Without
  // this the working capital for net-30 would leave the network as Lending Co.'s surplus.
  const credit = await ethers.getContractAt("ClearCredit", ledger);
  if ((await credit.payoutPool()) !== payoutPoolAddress) {
    await (await credit.setPayoutPool(payoutPoolAddress)).wait();
    log("  ledger -> PayoutPool");
  }
  // The ledger has to know who the merchants are: a draw or a plan may pay only an active one,
  // and a merchant's balance may go only to the payout pool (audit C-1, H-1, H-4).
  if ((await credit.merchantRegistry()) !== merchantsAddress) {
    await (await credit.setMerchantRegistry(merchantsAddress)).wait();
    log("  ledger -> MerchantRegistry");
  }

  // The treasury holds positions it paid for (drawForDueClaim) and redeems them like a merchant;
  // only named co-op addresses may (audit C-1, DECISIONS #3).
  const redeemer = await payoutPool.REDEEMER_ROLE();
  if (!(await payoutPool.hasRole(redeemer, coopTreasury))) {
    await (await payoutPool.grantRole(redeemer, coopTreasury)).wait();
    log("  PayoutPool REDEEMER_ROLE -> co-op treasury");
  }

  // Phase 2f, decision 17: only Clear Lending draws from the Yield Pool, as a recorded Deployment
  // to its registered lending account (two DEPLOYER_ROLE signers). The PayoutPool and the card
  // settler no longer borrow from it; the pool's `borrowableToday` is zero and `borrow` reverts.
  const lendingAccount = process.env.CLEAR_LENDING_ACCOUNT;
  if (lendingAccount && ethers.isAddress(lendingAccount)
      && (await lendingPool.deploymentAccount()) !== lendingAccount) {
    await (await lendingPool.setDeploymentAccount(lendingAccount)).wait();
    log(`  LendingPool deployment account -> ${lendingAccount}`);
  }

  // IV-02 §8.4, decision 27: the legend the Register carries, written once here; any later change
  // waits 7 days on chain after the Earn timelock proposes it. The pool's Deployments stay closed
  // until two VALUATION_ROLE signers post the Pool Tier principal ceiling (IV-02 §4.3).
  const pool = await poolAt(lendingPoolAddress);
  if ((await pool.legend()) === "") {
    await (await pool.setLegend(POOL_SHARE_LEGEND)).wait();
    log("  LendingPool legend set (IV-02 §8.4)");
  }

  log("\nBonds and pool deployed.");
  log("\nBond collections are created per token with factory.createCollection(); none exist yet.");
  log("A BondValuer is deployed per collection, since it reads one collection's present values.");
}

/** IV-02 §8.4's legend, as the Register and the vault's metadata carry it. */
const POOL_SHARE_LEGEND =
  "These Pool Shares have not been registered under the Securities Act of 1933 or any state securities law. " +
  "They may not be transferred except to Clear Lending Co. or by operation of law, as IV-02 permits.";

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
