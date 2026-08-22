import { saveDeployment, getDeployment } from "./helpers";

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
  const assurancePool = need("AssurancePool");
  const assuranceOracle = need("AssuranceOracle");
  const clrusd = need("ClearUSDUpgradeable");
  const vault = need("ESADepositVault");
  const reserveToken = process.env.RESERVE_TOKEN ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const coopTreasury = process.env.COOP_TREASURY ?? deployer.address;

  if (!process.env.COOP_TREASURY) {
    log(`! COOP_TREASURY unset — using the deployer (${deployer.address}).`);
    log("  Redeemed merchant positions land here. Set it to the multisig anywhere real.\n");
  }

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
  const lendingPool = await ensure("LendingPool", [
    deployer.address,
    reserveToken,
    "Clear Lending Pool",
    "clrLP",
  ]);
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
    const BurnerBondFactory = await ethers.getContractFactory("BurnerBondFactory");
    const factory = await BurnerBondFactory.deploy(
      assurancePool,
      assuranceOracle,
      process.env.BOND_BASE_URI ?? "ipfs://clear-bonds/"
    );
    await factory.waitForDeployment();
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

  // Repayments reach the merchants owed before they reach loss absorption. Without this the
  // working capital for net-30 accumulates in the one fund forbidden from spending it.
  const credit = await ethers.getContractAt("ClearCredit", ledger);
  if ((await credit.payoutPool()) !== payoutPoolAddress) {
    await (await credit.setPayoutPool(payoutPoolAddress)).wait();
    log("  ledger -> PayoutPool");
  }

  log("\nBonds and pool deployed.");
  log("\nBond collections are created per token with factory.createCollection(); none exist yet.");
  log("A BondValuer is deployed per collection, since it reads one collection's present values.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
