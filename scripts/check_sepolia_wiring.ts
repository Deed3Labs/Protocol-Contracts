import { getDeployment } from "../deploy/helpers";

/*
 * DEPLOY-RUNBOOK.md §4.1, as a script: the view calls that confirm the wiring the Base Sepolia steps
 * leave. Read-only: it sends nothing and needs no key. It reads the connected network's records and
 * prints PASS / FAIL per line, exiting 1 on any FAIL.
 *
 *   npx hardhat run scripts/check_sepolia_wiring.ts --network base-sepolia
 *
 * Optional, to check who holds what: DEPLOYER (holds no admin power afterwards), RELAYER (the vault's
 * RELAYER_ROLE), CLEAR_LENDING_ACCOUNT, COOP_TREASURY, OPS_SAFE, CLEAR_FINANCIAL_SAFE, CLEAR_LENDING_SAFE
 * and BOARD_SAFE (each timelock's proposer and executor). `scripts/check_retired_credit.ts` checks the
 * retired contracts; this checks the new wiring.
 */

type Status = "PASS" | "FAIL";

export async function checkSepoliaWiring(options: { network?: string; log?: (m: string) => void } = {}) {
  const { ethers } = require("hardhat");
  const { poolAt } = require("../deploy/poolModules");
  const { earnControlsAt } = require("../deploy/earnModules");
  const { bondAt } = require("../deploy/bondModules");
  const network = options.network ?? (await ethers.provider.getNetwork()).name;
  const log = options.log ?? console.log;
  const rec = (n: string) => getDeployment(network, n)?.address as string | undefined;
  const results: { status: Status; what: string }[] = [];
  const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const ZERO = ethers.ZeroHash;
  const env = (n: string) => (process.env[n]?.trim() && ethers.isAddress(process.env[n]!.trim()) ? ethers.getAddress(process.env[n]!.trim()) : undefined);

  async function check(what: string, f: () => Promise<boolean>) {
    let ok = false;
    try { ok = await f(); } catch { ok = false; }
    results.push({ status: ok ? "PASS" : "FAIL", what });
  }
  const at = async (name: string, contract = name) => (rec(name) ? ethers.getContractAt(contract, rec(name)!) : undefined);
  const role = (n: string) => (n === "DEFAULT_ADMIN_ROLE" ? ZERO : ethers.id(n));

  const vault = await at("ESADepositVault");
  const clrusd = await at("ClearUSDUpgradeable");
  const escrow = await at("ClaimEscrow");
  const access = await at("AccessManager");
  const revolving = await at("RevolvingIssuer");
  const term = await at("TermIssuer");
  const liquidator = await at("Liquidator");
  const registry = await at("CollateralRegistry");
  const bondVault = await at("BondVault");
  const agent = await at("CollateralAgent");
  const payout = await at("PayoutPool");
  const pool = rec("LendingPool") ? await poolAt(rec("LendingPool")!, ethers.provider) : undefined;
  const controls = rec("EarnControls") ? await earnControlsAt(rec("EarnControls")!, ethers.provider) : undefined;
  const bond = rec("BurnerBond") ? await bondAt(rec("BurnerBond")!, ethers.provider) : undefined;
  const deployer = env("DEPLOYER");

  if (vault) {
    await check("ESADepositVault.acceptedToken() is USDC", async () => same(await vault.acceptedToken(), process.env.RESERVE_TOKEN ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e"));
    await check("ESADepositVault.stateSource() is NetworkRegistry", async () => same(await vault.stateSource(), rec("NetworkRegistry")));
    await check("ESADepositVault.pauseClock() answers", async () => (await vault.pauseClock(), true));
    if (env("RELAYER")) {
      await check("ESADepositVault: the relayer holds RELAYER_ROLE, not OPERATOR_ROLE", async () =>
        (await vault.hasRole(role("RELAYER_ROLE"), env("RELAYER"))) && !(await vault.hasRole(role("OPERATOR_ROLE"), env("RELAYER"))));
    }
    if (rec("VaultTimelock")) await check("ESADepositVault: the vault timelock holds DEFAULT_ADMIN_ROLE", async () => vault.hasRole(ZERO, rec("VaultTimelock")));
  }
  if (clrusd) {
    await check("CLRUSD.membershipSource() is the AccessManager", async () => same(await clrusd.membershipSource(), rec("AccessManager")));
    await check("CLRUSD.encumbranceSource() is the CollateralRegistry", async () => same(await clrusd.encumbranceSource(), rec("CollateralRegistry")));
    await check("CLRUSD.intentFactory() is the SavingsIntentFactory", async () => same(await clrusd.intentFactory(), rec("SavingsIntentFactory")));
    await check("CLRUSD: the vault holds MINTER_ROLE and BURNER_ROLE", async () => (await clrusd.hasRole(await clrusd.MINTER_ROLE(), rec("ESADepositVault"))) && (await clrusd.hasRole(await clrusd.BURNER_ROLE(), rec("ESADepositVault"))));
    await check("CLRUSD: the Liquidator holds LIQUIDATOR_ROLE", async () => clrusd.hasRole(await clrusd.LIQUIDATOR_ROLE(), rec("Liquidator")));
    if (rec("LiquidatorPreAudit")) await check("CLRUSD: LiquidatorPreAudit holds no LIQUIDATOR_ROLE", async () => !(await clrusd.hasRole(await clrusd.LIQUIDATOR_ROLE(), rec("LiquidatorPreAudit"))));
    await check("CLRUSD.pauseClock(address(0)) answers", async () => (await clrusd["pauseClock(address)"](ethers.ZeroAddress), true));
    if (rec("VaultTimelock")) await check("CLRUSD.defaultAdmin() is the vault timelock", async () => same(await clrusd.defaultAdmin(), rec("VaultTimelock")));
  }
  if (escrow && rec("CreditTimelock")) await check("ClaimEscrow: the credit timelock holds DEFAULT_ADMIN_ROLE", async () => escrow.hasRole(ZERO, rec("CreditTimelock")));
  if (access) {
    for (const n of ["ClearCredit", "RevolvingIssuer", "TermIssuer", "LimitCalculator", "Liquidator"]) {
      if (rec(n)) await check(`AccessManager.isOperator(${n})`, async () => access.isOperator(rec(n)));
    }
  }
  if (revolving) {
    await check("RevolvingIssuer.rateSchedule() is RateSchedule, ceilingProduct() set", async () => same(await revolving.rateSchedule(), rec("RateSchedule")) && (await revolving.ceilingProduct()) !== ZERO);
    await check("RevolvingIssuer.dueTermsOf().termIssuer is TermIssuer", async () => same((await revolving.dueTermsOf()).termIssuer, rec("TermIssuer")));
    await check("RevolvingIssuer.depositSource() is the vault", async () => same(await revolving.depositSource(), rec("ESADepositVault")));
    await check("RevolvingIssuer has a WORKOUT tier", async () => {
      const n = Number(await revolving.tierCount());
      for (let i = 0; i < n; i++) if ((await revolving.tierAt(i))[0] === ethers.encodeBytes32String("WORKOUT")) return true;
      return false;
    });
    await check("RevolvingIssuer pauseClock() is PauseClock", async () => same(await (await ethers.getContractAt("RevolvingIssuerWorkouts", rec("RevolvingIssuer"))).pauseClock(), rec("PauseClock")));
  }
  if (term) {
    await check("TermIssuer.rateSchedule() is RateSchedule, combinedProduct() set", async () => same(await term.rateSchedule(), rec("RateSchedule")) && (await term.combinedProduct()) !== ZERO);
    await check("TermIssuer.holdSource() is the Liquidator", async () => same(await term.holdSource(), rec("Liquidator")));
    await check("TermIssuer.feeRecipient() is named", async () => (await term.feeRecipient()) !== ethers.ZeroAddress);
  }
  if (liquidator) {
    await check("Liquidator trusts both issuers", async () => (await liquidator.trustedSavingsIssuer(rec("RevolvingIssuer"))) && (await liquidator.trustedSavingsIssuer(rec("TermIssuer"))));
    await check("Liquidator.earnPool() is LendingPool, earnBonds() the new collection", async () => same(await liquidator.earnPool(), rec("LendingPool")) && same(await liquidator.earnBonds(), rec("BurnerBond")));
    await check("Liquidator.poolShareEnforcer() is PoolShareEnforcer", async () => same(await liquidator.poolShareEnforcer(), rec("PoolShareEnforcer")));
    await check("Liquidator.pauseClock() is PauseClock", async () => same(await liquidator.pauseClock(), rec("PauseClock")));
  }
  if (registry) {
    const POOL_SHARE = ethers.encodeBytes32String("POOL_SHARE");
    const BOND = ethers.encodeBytes32String("BOND");
    await check("CollateralRegistry.enforcementSource() is PoolShareEnforcer", async () => same(await registry.enforcementSource(), rec("PoolShareEnforcer")));
    await check("CollateralRegistry: POOL_SHARE valued by LendingPool", async () => same((await registry.collateralTypes(POOL_SHARE)).valuer, rec("LendingPool")));
    await check("CollateralRegistry: BOND valued by the new BondValuer", async () => same((await registry.collateralTypes(BOND)).valuer, rec("BondValuer")));
    await check("CollateralRegistry: ITEM_ROLLER_ROLE for the collection", async () => registry.hasRole(await registry.ITEM_ROLLER_ROLE(), rec("BurnerBond")));
    await check("CollateralRegistry: OPERATOR_ROLE for the Liquidator", async () => registry.hasRole(await registry.OPERATOR_ROLE(), rec("Liquidator")));
  }
  if (pool) {
    await check("LendingPool.earnControls() is EarnControls", async () => same(await pool.earnControls(), rec("EarnControls")));
    if (env("CLEAR_LENDING_ACCOUNT")) await check("LendingPool.deploymentAccount() is Clear Lending's account", async () => same(await pool.deploymentAccount(), env("CLEAR_LENDING_ACCOUNT")));
    await check("LendingPool: enforcementDestination() and ENFORCER_ROLE are PoolShareEnforcer's", async () => same(await pool.enforcementDestination(), rec("PoolShareEnforcer")) && (await pool.hasRole(await pool.ENFORCER_ROLE(), rec("PoolShareEnforcer"))));
    await check("LendingPool: the Liquidator has no LIQUIDATOR_ROLE", async () => !(await pool.hasRole(await pool.LIQUIDATOR_ROLE(), rec("Liquidator"))));
    await check("LendingPool.legend() is written", async () => (await pool.legend()).length > 0);
    await check("LendingPool.poolTierPrincipal() posted", async () => (await pool.poolTierPrincipal())[1] !== 0n);
    await check("LendingPool.encumbranceSource() is CollateralRegistry", async () => same(await pool.encumbranceSource(), rec("CollateralRegistry")));
  }
  if (controls) {
    await check("EarnControls.yieldPool() is LendingPool", async () => same(await controls.yieldPool(), rec("LendingPool")));
    await check("EarnControls.reserveStatus() is BondVault", async () => same(await controls.reserveStatus(), rec("BondVault")));
    await check("EarnControls.bondBooks() includes BondVault", async () => (await controls.bondBooks()).some((b: string) => same(b, rec("BondVault"))));
    for (const n of ["ESADepositVault", "ClearUSDUpgradeable", "ClaimEscrow", "LendingPool", "BondVault", "BurnerBond", "PayoutPool", "Liquidator", "CollateralRegistry", "PoolShareEnforcer", "CollateralAgent", "HolderDirections", "AssurancePoolV2"]) {
      if (rec(n)) await check(`EarnControls.refused(${n})`, async () => controls.refused(rec(n)));
    }
  }
  if (bondVault) {
    await check("BondVault.agent() is the CollateralAgent", async () => same(await bondVault.agent(), rec("CollateralAgent")));
    await check("BondVault: the collection holds BOND_ROLE", async () => bondVault.hasRole(await bondVault.BOND_ROLE(), rec("BurnerBond")));
    await check("BondVault.encumbranceSource() is CollateralRegistry", async () => same(await bondVault.encumbranceSource(), rec("CollateralRegistry")));
    await check("BondVault.payoutPool() is cleared", async () => (await bondVault.payoutPool()) === ethers.ZeroAddress);
  }
  if (bond) {
    await check("BurnerBond: bondVault(), controls(), agent() set", async () => same(await bond.bondVault(), rec("BondVault")) && same(await bond.controls(), rec("EarnControls")) && same(await bond.agent(), rec("CollateralAgent")));
    await check("BurnerBond.liquidator() is the Liquidator", async () => same(await bond.liquidator(), rec("Liquidator")));
  }
  if (agent) {
    await check("CollateralAgent: vault() and bondBook() are BondVault", async () => same(await agent.vault(), rec("BondVault")) && same(await agent.bondBook(), rec("BondVault")));
    await check("CollateralAgent.pledgeModule() is the Liquidator", async () => same(await agent.pledgeModule(), rec("Liquidator")));
    await check("CollateralAgent.holderDirections() is HolderDirections", async () => same(await agent.holderDirections(), rec("HolderDirections")));
  }
  if (payout) {
    await check("PayoutPool: bondVault() and yieldPool() off", async () => (await payout.bondVault()) === ethers.ZeroAddress && (await payout.yieldPool()) === ethers.ZeroAddress);
    if (env("COOP_TREASURY")) await check("PayoutPool: REDEEMER_ROLE for the co-op treasury", async () => payout.hasRole(await payout.REDEEMER_ROLE(), env("COOP_TREASURY")));
  }
  // The timelocks: 7 days at least, no admin for the deployer, the right Safe proposing and executing.
  const timelocks: [string, string, string[]][] = [
    ["CreditTimelock", "OPS_SAFE", []],
    ["VaultTimelock", "CLEAR_FINANCIAL_SAFE", ["ESADepositVault"]],
    ["EarnTimelock", "CLEAR_LENDING_SAFE", ["LendingPool", "EarnControls", "BondVault", "CollateralAgent"]],
    ["AssuranceTimelock", "BOARD_SAFE", []],
  ];
  for (const [name, safeVar, governs] of timelocks) {
    if (!rec(name)) continue;
    const tl = await ethers.getContractAt("TimelockController", rec(name)!);
    await check(`${name}.getMinDelay() is at least 7 days`, async () => (await tl.getMinDelay()) >= 7n * 24n * 3600n);
    if (deployer) await check(`${name}: the deployer holds no admin`, async () => !(await tl.hasRole(await tl.DEFAULT_ADMIN_ROLE(), deployer)));
    if (env(safeVar)) await check(`${name}: ${safeVar} proposes and executes`, async () => (await tl.hasRole(await tl.PROPOSER_ROLE(), env(safeVar))) && (await tl.hasRole(await tl.EXECUTOR_ROLE(), env(safeVar))));
    for (const g of governs) if (rec(g)) await check(`${name} holds ${g}'s DEFAULT_ADMIN_ROLE`, async () => (await ethers.getContractAt(["function hasRole(bytes32,address) view returns (bool)"], rec(g)!)).hasRole(ZERO, rec(name)));
  }
  if (deployer) {
    for (const n of ["ESADepositVault", "ClearUSDUpgradeable", "ClaimEscrow", "LendingPool", "EarnControls", "BondVault", "CollateralAgent", "NetworkRegistry", "CollateralRegistry", "LimitCalculator", "Liquidator", "MerchantRegistry", "PayoutPool", "AccessManager", "MembershipRegistry"]) {
      if (rec(n)) await check(`the deployer holds no DEFAULT_ADMIN_ROLE on ${n}`, async () => !(await (await ethers.getContractAt(["function hasRole(bytes32,address) view returns (bool)"], rec(n)!)).hasRole(ZERO, deployer)));
    }
    for (const n of ["RevolvingIssuer", "TermIssuer", "RateSchedule", "BurnerBond", "BurnerBondFactory"]) {
      if (rec(n)) await check(`the deployer does not own ${n}`, async () => !same(await (await ethers.getContractAt(["function owner() view returns (address)"], rec(n)!)).owner(), deployer));
    }
  }

  log(`Wiring check on ${network} (DEPLOY-RUNBOOK §4.1). Sends nothing.\n`);
  for (const r of results) log(`${r.status}  ${r.what}`);
  const failures = results.filter((r) => r.status === "FAIL");
  log(`\n${results.length - failures.length} PASS, ${failures.length} FAIL.`);
  return { results, failures };
}

if (require.main === module) {
  checkSepoliaWiring()
    .then(({ failures }) => process.exit(failures.length > 0 ? 1 : 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
