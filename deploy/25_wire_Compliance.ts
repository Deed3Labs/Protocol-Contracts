import * as fs from "fs";
import * as path from "path";
import { saveDeployment, getDeployment, requireMainnetConfirmation } from "./helpers";
import { Proposal, RETIRED_ROLE_CHECKS, VIA, pointCarryAtPayoutPool, printProposals, revokeRetiredRoles } from "./creditWiring";
import { retiredContracts } from "./retire_credit_stack";

/**
 * Compliance spec wiring (Phase 2). Run after 20_deploy_CreditCore (and 13/21 for the vault and
 * CLRUSD, and the Liquidator if it is deployed).
 *
 * - Deploys RateSchedule behind a UUPS proxy, owned by the deployer until the credit timelock
 *   handover (`credit_timelock_handover.ts`) moves it to the 7-day TimelockController.
 * - Creates the products in `deploy/config/rate-schedule.json` (every figure pending counsel), and
 *   names both issuers as the CFL aggregation sources (DECISIONS #7, on by default).
 * - Points the revolving issuer at it: the ceiling product, and one product per unsecured tier
 *   (set once: positions snapshot that product's accumulator).
 * - Points the term issuer at it. Until this runs, plans keep the rate the member signed and
 *   follow no state rules -- the legacy mode Phase 1 left.
 * - Sets the Clear Credit Agreement's terms from `deploy/config/credit-terms.json` (section 12) and
 *   names ESADepositVault as where ESA deposits are read for the Boost cap.
 * - Addendum 2 (Phase 2e): the Secured Minimum, the per-member card cap and Income Assurance's
 *   length (`setDueTerms`), the federal-benefit payers excluded from Automatic Clearing by default,
 *   the Combined Ceiling wired once both ways, and the fee cap. Clear Lending's fee recipient takes
 *   two people: this proposes `FEE_RECIPIENT` and says who must approve it.
 * - Grants STATE_ATTESTER_ROLE on NetworkRegistry to `STATE_ATTESTER_KEY` when set.
 * - Trusts the revolving issuer on the Liquidator (permissionless liquidation only seizes for
 *   trusted issuers), and names NetworkRegistry as the vault's state source. From then on every
 *   vault mint needs the receiver's state attestation while the pilot item is on (Phase 2d, L-E).
 *   The pilot measure itself is off chain (Phase 2d, decision 7): there is no cap to set.
 * - Names the AccessManager as CLRUSD's membership source, so CLRUSD is received only by member
 *   wallets (spec 12.15, Phase 2d decision 6), and the SavingsIntentFactory as its intent factory,
 *   whose redeem escrows may receive.
 * Both of the last two need the vault's or CLRUSD's admin. After `vault_timelock_handover.ts` they
 * are Clear Financial Safe proposals through the vault timelock, and the script says so.
 * - Phase 2g: adds the workout plan's 0% position to the revolving issuer (12.18), and, once CLRUSD
 *   and the vault answer the pause-clock views, deploys PauseClock (no owner, no setter) and names
 *   it, once each, on RevolvingIssuer and the Liquidator (10c).
 * - Phase 2f stage 2 (decisions 7, 10 and 20; C5): deploys PoolShareEnforcer (no owner, no role,
 *   no setter, not upgradeable), grants it the Yield Pool's ENFORCER_ROLE and records it as the
 *   pool's `enforcementDestination`, names it on the Liquidator (`setPoolShareEnforcer`) and, once,
 *   on CollateralRegistry (`setEnforcementSource`); makes the pool POOL_SHARE's valuer, so pool
 *   shares are valued by its `previewRedeem` (MB-05 §1.3); and revokes the Liquidator's old
 *   LIQUIDATOR_ROLE on the pool (the seizure grant, now inert). The Liquidator's Earn module is
 *   created by its own constructor, so its upgrade takes no constructor argument.
 *
 * - Decision 48 (b): revokes every ESADepositVault and ClaimEscrow role a retired contract
 *   (`*PreAudit`, `*Pre2f`, `*Legacy`) still holds; after the handovers, prints each revocation as a
 *   vault or credit timelock proposal.
 *
 * Idempotent: every step checks before it writes. It never deploys a contract other than
 * RateSchedule, PauseClock and PoolShareEnforcer, and never moves an admin power; the handover is a
 * separate, explicit step.
 *
 *   npx hardhat run deploy/25_wire_Compliance.ts --network base-sepolia
 */

const ONE_USD = 10n ** 6n;
const DAY = 24 * 60 * 60;
const MAX128 = (1n << 128n) - 1n;

export interface ComplianceOptions {
  quiet?: boolean;
  configPath?: string;
  stateAttester?: string;
}

export function loadRateTable(configPath = path.join(__dirname, "config", "rate-schedule.json")) {
  const { ethers } = require("hardhat");
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const d = raw.defaults;
  const bands = d.bands.map(([upper, bps]: [number | null, number]) => ({
    upperBound: upper === null ? MAX128 : BigInt(upper) * ONE_USD,
    monthlyBps: bps,
  }));
  return raw.products.map((p: any) => ({
    state: ethers.encodeBytes32String(p.state),
    product: ethers.encodeBytes32String(p.product),
    role: p.role as string,
    tier: p.tier ? ethers.encodeBytes32String(p.tier) : undefined,
    params: {
      enabled: true,
      listMonthlyBps: p.listMonthlyBps,
      flatMonthlyBps: p.flatMonthlyBps ?? d.flatMonthlyBps,
      largeLoanThreshold: BigInt(p.largeLoanThresholdUsd ?? d.largeLoanThresholdUsd) * ONE_USD,
      annualCapBps: p.annualCapBps ?? d.annualCapBps,
      minTermSeconds: (p.minTermDays ?? d.minTermDays) * DAY,
      freeInFull: p.freeInFull ?? false,
      freeBelowAmount: BigInt(p.freeBelowAmountUsd ?? 0) * ONE_USD,
      freeSplitMax: p.freeSplitMax ?? 0,
    },
    bands,
  }));
}

export async function wireCompliance(options: ComplianceOptions = {}) {
  const hre = require("hardhat");
  const { ethers, upgrades } = hre;
  const [deployer] = await ethers.getSigners();
  const network = (await ethers.provider.getNetwork()).name;
  requireMainnetConfirmation(network, "deploy/25_wire_Compliance.ts");
  const log = options.quiet ? () => {} : console.log;

  const need = (name: string) => {
    const r = getDeployment(network, name);
    if (!r) throw new Error(`No ${name} on ${network}: run 20_deploy_CreditCore.ts first.`);
    return r.address as string;
  };
  const revolving = await ethers.getContractAt("RevolvingIssuer", need("RevolvingIssuer"));
  const term = await ethers.getContractAt("TermIssuer", need("TermIssuer"));
  const networkRegistry = await ethers.getContractAt("NetworkRegistry", need("NetworkRegistry"));

  // ---- RateSchedule ----
  let rates: any;
  const existing = getDeployment(network, "RateSchedule");
  if (existing) {
    rates = await ethers.getContractAt("RateSchedule", existing.address);
    log(`= RateSchedule already at ${existing.address}`);
  } else {
    const F = await ethers.getContractFactory("RateSchedule");
    rates = await upgrades.deployProxy(F, [deployer.address], { initializer: "initialize", kind: "uups" });
    await rates.waitForDeployment();
    saveDeployment(network, "RateSchedule", await rates.getAddress(), JSON.parse(rates.interface.formatJson()));
    log(`+ RateSchedule deployed to ${await rates.getAddress()}`);
  }
  const ratesAddress = await rates.getAddress();
  const ownsRates = (await rates.owner()) === deployer.address;

  const table = loadRateTable(options.configPath);
  for (const p of table) {
    if (await rates.hasProduct(p.state, p.product)) continue;
    if (!ownsRates) {
      log(`! ${ethers.decodeBytes32String(p.product)} missing, and RateSchedule is owned by the timelock: propose it there.`);
      continue;
    }
    await (await rates.setProduct(p.state, p.product, p.params, p.bands)).wait();
    log(`  product ${ethers.decodeBytes32String(p.state)}/${ethers.decodeBytes32String(p.product)} at ${p.params.listMonthlyBps} bps/month`);
  }

  // ---- CFL aggregation (DECISIONS #7): term plans and unsecured revolving are one loan ----
  const sources = [await revolving.getAddress(), await term.getAddress()];
  const current: string[] = [...(await rates.cflSourcesOf())];
  if (current.length !== sources.length || current.some((a, i) => a !== sources[i])) {
    if (ownsRates) {
      await (await rates.setCflSources(sources)).wait();
      log("  CFL aggregation sources -> RevolvingIssuer, TermIssuer (aggregation on by default)");
    } else {
      log("! CFL aggregation sources differ, and RateSchedule is owned by the timelock: propose it there.");
    }
  }

  // ---- revolving: ceiling product and unsecured tier products ----
  const ceiling = table.find((p: any) => p.role === "revolving-ceiling");
  if (ceiling && ((await revolving.rateSchedule()) !== ratesAddress || (await revolving.ceilingProduct()) !== ceiling.product)) {
    // Each is set once (Phase 4, M-B): positions hold snapshots of the schedule they were priced on.
    const heldRates = await revolving.rateSchedule();
    const heldCeiling = await revolving.ceilingProduct();
    if ((heldRates !== ethers.ZeroAddress && heldRates !== ratesAddress) || (heldCeiling !== ethers.ZeroHash && heldCeiling !== ceiling.product)) {
      log("! RevolvingIssuer already prices from another RateSchedule or ceiling product; it is set once. Upgrade the schedule in place.");
    } else {
      await (await revolving.setPricing(ratesAddress, ceiling.product)).wait();
      log("  RevolvingIssuer -> RateSchedule");
    }
  }
  const tierCount = Number(await revolving.tierCount());
  for (const p of table.filter((x: any) => x.role === "revolving-tier")) {
    for (let id = 0; id < tierCount; id++) {
      const [kind] = await revolving.tierAt(id);
      if (kind !== p.tier) continue;
      if ((await revolving.tierProduct(id)) === ethers.ZeroHash) {
        await (await revolving.setTierProduct(id, p.product)).wait();
        log(`  tier ${ethers.decodeBytes32String(kind)} priced as ${ethers.decodeBytes32String(p.product)}`);
      }
    }
  }

  // ---- the Clear Credit Agreement's terms (section 12) ----
  const terms = JSON.parse(fs.readFileSync(path.join(__dirname, "config", "credit-terms.json"), "utf8"));
  const wanted = {
    unsecuredLineCap: BigInt(terms.unsecuredLineCapUsd) * ONE_USD,
    cureWindow: BigInt(terms.cureWindowDays * DAY),
    boostCleanCycles: BigInt(terms.boostCleanCycles),
    boostDepositCycles: BigInt(terms.boostDepositCycles),
    autoClearOffGlobal: !terms.autoClearEnabledGlobal,
  };
  const held = await revolving.creditTerms();
  const same = held.unsecuredLineCap === wanted.unsecuredLineCap && held.cureWindow === wanted.cureWindow
    && held.boostCleanCycles === wanted.boostCleanCycles && held.boostDepositCycles === wanted.boostDepositCycles
    && held.autoClearOffGlobal === wanted.autoClearOffGlobal
    && (await revolving.boostBaseCap()) === BigInt(terms.boostBaseCapUsd) * ONE_USD
    && (await revolving.boostEarnedCap()) === BigInt(terms.boostEarnedCapUsd) * ONE_USD;
  if (!same) {
    await (await revolving.setCreditTerms(wanted, BigInt(terms.boostBaseCapUsd) * ONE_USD, BigInt(terms.boostEarnedCapUsd) * ONE_USD)).wait();
    log(`  credit terms: unsecured cap ${terms.unsecuredLineCapUsd} USD, Boost ${terms.boostBaseCapUsd}/${terms.boostEarnedCapUsd} USD, cure ${terms.cureWindowDays} days`);
  }
  const vaultForDeposits = getDeployment(network, "ESADepositVault");
  if (vaultForDeposits && (await revolving.depositSource()) !== vaultForDeposits.address) {
    await (await revolving.setDepositSource(vaultForDeposits.address)).wait();
    log("  RevolvingIssuer deposit source -> ESADepositVault");
  }

  // ---- The card settler and the mandate source (CREDIT_SETTINGS_ROLE settings) ----
  // Decision 47: a fresh RevolvingIssuer has no card settler and a fresh TermIssuer no mandate
  // source; the pre-audit upgrade scripts that set them on the old Base Sepolia issuers are retired.
  const cardSettler = (process.env.CARD_SETTLER_ADDRESS ?? "").trim();
  if (ethers.isAddress(cardSettler)) {
    if (!(await revolving.isCardSettler(cardSettler))) {
      await (await revolving.setCardSettler(cardSettler, true)).wait();
      log(`  RevolvingIssuer card settler -> ${cardSettler}`);
    }
    // The claim a settled purchase mints belongs to the float that paid the merchant: the issuer's
    // carry treasury unless CARD_SETTLEMENT_ACCOUNT names another.
    const settlementAccount = (process.env.CARD_SETTLEMENT_ACCOUNT ?? "").trim() || (await revolving.carryTreasury());
    if ((await revolving.cardSettlementAccount()).toLowerCase() !== settlementAccount.toLowerCase()) {
      // After the handover the deployer no longer holds CREDIT_SETTINGS_ROLE: the signing plan's RT-card-account
      // makes the change instead (a credit settings signer), so a re-run says so rather than reverting.
      const ledger = await ethers.getContractAt(["function access() view returns (address)"], await revolving.stableCredit());
      const access = await ethers.getContractAt(["function hasCreditRole(bytes32,address) view returns (bool)"], await ledger.access());
      if (await access.hasCreditRole(ethers.id("CREDIT_SETTINGS_ROLE"), deployer.address)) {
        await (await revolving.setCardSettlementAccount(settlementAccount)).wait();
        log(`  RevolvingIssuer card settlement account -> ${settlementAccount}`);
      } else {
        log(`! RevolvingIssuer's card settlement account is ${await revolving.cardSettlementAccount()}, not ${settlementAccount}: a credit settings signer changes it (signing plan, RT-card-account).`);
      }
    }
  } else {
    log("! CARD_SETTLER_ADDRESS unset: RevolvingIssuer has no card settler, so card spend cannot settle on chain.");
  }
  if ((await term.mandateSource()).toLowerCase() !== (await revolving.getAddress()).toLowerCase()) {
    await (await term.setMandateSource(await revolving.getAddress())).wait();
    log("  TermIssuer mandate source -> RevolvingIssuer");
  }

  // ---- Addendum 2 (Phase 2e): dues, the per-member card cap, federal-benefit exclusions ----
  const due = await revolving.dueTermsOf();
  const wantDue = {
    bps: Number(terms.securedMinimumBps ?? 100),
    floor: BigInt(terms.securedMinimumFloorUsd ?? 1) * ONE_USD,
    card: BigInt(terms.cardMemberDailyCapUsd ?? 0) * ONE_USD,
    pause: Number(terms.incomePauseMaxCycles ?? 3),
  };
  const bpsHeld = Number(due.raisedFrom) !== 0 ? Number(due.raisedBps) : Number(due.securedMinimumBps);
  if (bpsHeld !== wantDue.bps || due.securedMinimumFloor !== wantDue.floor
    || due.cardMemberDailyCap !== wantDue.card || Number(due.incomePauseMaxCycles) !== wantDue.pause) {
    await (await revolving.setDueTerms(wantDue.bps, wantDue.floor, wantDue.card, wantDue.pause)).wait();
    log(`  due terms: Secured Minimum ${wantDue.bps} bps (at least ${terms.securedMinimumFloorUsd ?? 1} USD), card ${terms.cardMemberDailyCapUsd ?? 0} USD/member/day, Income Assurance ${wantDue.pause} cycles`);
  }
  for (const payer of (terms.defaultExcludedPayers ?? []) as string[]) {
    const id = ethers.id(payer);
    if (!(await revolving.defaultExcludedPayer(id))) {
      await (await revolving.addDefaultExcludedPayer(id)).wait();
      log(`  excluded from Automatic Clearing by default: ${payer}`);
    }
  }

  // ---- 12.3: the Combined Ceiling, wired once, both ways (it can never be switched off) ----
  if (ceiling) {
    if ((await term.combinedProduct()) === ethers.ZeroHash) {
      await (await term.setCombinedCeiling(await revolving.getAddress(), ceiling.product)).wait();
      log("  TermIssuer Combined Ceiling -> RevolvingIssuer, graduated schedule of the ceiling product");
    }
    if ((await revolving.dueTermsOf()).termIssuer === ethers.ZeroAddress) {
      await (await revolving.setTermIssuer(await term.getAddress())).wait();
      log("  RevolvingIssuer Combined Ceiling -> TermIssuer");
    }
  }

  // ---- 12.16: the fee cap, and Clear Lending's fee recipient (two people) ----
  const fees = await term.feeTermsOf();
  const wantFees = [terms.maxFeeSmallUsd ?? 50, terms.maxFeeLargeUsd ?? 75, terms.feeCapLargeFromUsd ?? 2500].map((n: number) => BigInt(n) * ONE_USD);
  if (fees.maxFeeSmall !== wantFees[0] || fees.maxFeeLarge !== wantFees[1] || fees.largeFrom !== wantFees[2]) {
    await (await term.setFeeTerms(wantFees[0], wantFees[1], wantFees[2])).wait();
    log(`  fee cap: ${terms.maxFeeSmallUsd ?? 50} USD up to ${terms.feeCapLargeFromUsd ?? 2500} USD, ${terms.maxFeeLargeUsd ?? 75} USD above`);
  }
  // ---- carry at the payout pool (docs/protocol/settlement.md, "Carry, by who bore the float") ----
  const carryProposals = await pointCarryAtPayoutPool(network, [
    { name: "RevolvingIssuer", contract: revolving },
    { name: "TermIssuer", contract: term },
  ], deployer, log);
  if (carryProposals.length > 0) {
    log("! The deployer cannot set the carry treasury (CREDIT_SETTINGS_ROLE). Propose:");
    printProposals(carryProposals, log);
  }

  const feeTo = process.env.FEE_RECIPIENT;
  const carryTo: string = await term.carryTreasury();
  if ((await term.feeRecipient()) === ethers.ZeroAddress && feeTo && ethers.isAddress(feeTo) && carryTo.toLowerCase() === feeTo.toLowerCase()) {
    // TermIssuer refuses a fee recipient that is its carry treasury (the co-op's): say so, do not revert half way.
    log(`! FEE_RECIPIENT ${feeTo} is TermIssuer's carry treasury, which it refuses as the fee recipient. Point carry at the PayoutPool first (deploy 22 records it), or name another recipient.`);
  } else if ((await term.feeRecipient()) === ethers.ZeroAddress) {
    if (feeTo && ethers.isAddress(feeTo)) {
      const reason = ethers.encodeBytes32String("INITIAL");
      const pending = await term.feeRecipientProposalOf();
      if (pending.recipient !== ethers.getAddress(feeTo)) {
        await (await term.proposeFeeRecipient(feeTo, reason)).wait();
      }
      log(`! Fee recipient ${feeTo} proposed: a second CREDIT_SETTINGS_ROLE holder approves it with approveFeeRecipient(${feeTo}, "INITIAL"). Plans with a fee cannot open until then.`);
    } else {
      log("! FEE_RECIPIENT unset: no plan with a fee can open until Clear Lending's fee recipient is named by two people.");
    }
  }

  // ---- term ----
  const heldTermRates = await term.rateSchedule();
  if (heldTermRates !== ratesAddress && heldTermRates !== ethers.ZeroAddress) {
    log("! TermIssuer already prices from another RateSchedule; it is set once. Upgrade the schedule in place.");
  } else if (heldTermRates !== ratesAddress) {
    await (await term.setRateSchedule(ratesAddress)).wait();
    log("  TermIssuer -> RateSchedule");
  }

  // ---- state attestation ----
  const attester = options.stateAttester ?? process.env.STATE_ATTESTER_KEY;
  const ATTESTER = await networkRegistry.STATE_ATTESTER_ROLE();
  if (attester && ethers.isAddress(attester)) {
    if (!(await networkRegistry.hasRole(ATTESTER, attester))) {
      await (await networkRegistry.grantRole(ATTESTER, attester)).wait();
      log(`  STATE_ATTESTER_ROLE -> ${attester}`);
    }
  } else {
    log("! STATE_ATTESTER_KEY unset: no member can open credit until a state code is attested for them.");
  }

  // ---- liquidator: trust the issuer whose savings-backed tier it seizes for ----
  const liquidatorRecord = getDeployment(network, "Liquidator");
  if (liquidatorRecord) {
    const liquidator = await ethers.getContractAt("Liquidator", liquidatorRecord.address);
    if (!(await liquidator.trustedSavingsIssuer(await revolving.getAddress()))) {
      await (await liquidator.setTrustedSavingsIssuer(await revolving.getAddress(), true)).wait();
      log("  Liquidator trusts RevolvingIssuer");
    }
    // 12.14: a secured term plan's default respects the Liquidation Hold, read here (set once).
    if ((await term.holdSource()) === ethers.ZeroAddress) {
      await (await term.setHoldSource(liquidatorRecord.address)).wait();
      log("  TermIssuer reads the Liquidation Hold from the Liquidator");
    }
    // 12.14: a recorded secured-plan default lets a pledged bond's payPledged pay those plans. A
    // trusted term issuer (no tiers) is refused by every tier path (CLRUSD, Savings, pool shares).
    if (!(await liquidator.trustedSavingsIssuer(await term.getAddress()))) {
      await (await liquidator.setTrustedSavingsIssuer(await term.getAddress(), true)).wait();
      log("  Liquidator trusts TermIssuer (12.14: pledged bonds pay defaulted secured plans only)");
    }
  } else {
    log("! No Liquidator: TermIssuer has no hold source, so no secured term plan can default (12.14 fails closed).");
  }

  // ---- section 12.5 / 12.8: the Liquidator's Earn sources and the bond collection's gates ----
  const poolRecord = getDeployment(network, "LendingPool");
  const bondRecord = getDeployment(network, "BurnerBond");
  if (liquidatorRecord && poolRecord && bondRecord) {
    const liquidator = await ethers.getContractAt("Liquidator", liquidatorRecord.address);
    if ((await liquidator.earnPool()) !== poolRecord.address || (await liquidator.earnBonds()) !== bondRecord.address) {
      await (await liquidator.setEarnSources(poolRecord.address, bondRecord.address)).wait();
      log("  Liquidator Earn sources -> LendingPool, BurnerBond");
    }
    // Phase 2e (founder answer G): the collection no longer has a default source or a settlement
    // gate, and the Liquidator takes no bond. The collection's `liquidator` is the pledge module's
    // enforcement side for `payPledged` and the pledged maturity split; naming it once bonds exist
    // waits seven days (audit M-6), so it is proposed here and applied by the owner later.
    const bond = await ethers.getContractAt("BurnerBond", bondRecord.address);
    if ((await bond.owner()) === deployer.address) {
      if ((await bond.liquidator()) !== liquidatorRecord.address
          && (await bond.pendingLiquidator()) !== liquidatorRecord.address) {
        await (await bond.setLiquidator(liquidatorRecord.address)).wait();
        log("  BurnerBond pledge module -> Liquidator (proposed; executeLiquidatorChange after 7 days if bonds exist)");
      }
    } else {
      log("! BurnerBond is owned elsewhere: its owner calls setLiquidator(Liquidator), then executeLiquidatorChange after the delay.");
    }

    // ---- Phase 2f stage 2 (C5, decisions 7, 10 and 20): pool shares are redeemed, never seized ----
    const pool = await ethers.getContractAt("LendingPool", poolRecord.address);
    const registry = await ethers.getContractAt("CollateralRegistry", await liquidator.collateralRegistry());
    let enforcerAddress = getDeployment(network, "PoolShareEnforcer")?.address;
    if (!enforcerAddress) {
      const Enforcer = await ethers.getContractFactory("PoolShareEnforcer");
      const enforcer = await Enforcer.deploy(poolRecord.address, liquidatorRecord.address, await registry.getAddress());
      await enforcer.waitForDeployment();
      enforcerAddress = await enforcer.getAddress();
      saveDeployment(network, "PoolShareEnforcer", enforcerAddress, JSON.parse(enforcer.interface.formatJson()));
      log(`+ PoolShareEnforcer deployed to ${enforcerAddress}`);
    }
    const ADMIN = ethers.ZeroHash;
    const poolAdmin = await pool.hasRole(ADMIN, deployer.address);
    const ENFORCER = await pool.ENFORCER_ROLE();
    const LIQUIDATOR = await pool.LIQUIDATOR_ROLE();
    const poolSteps: string[] = [];
    if (!(await pool.hasRole(ENFORCER, enforcerAddress))) poolSteps.push(`grantRole(ENFORCER_ROLE, ${enforcerAddress})`);
    if ((await pool.enforcementDestination()) !== enforcerAddress) poolSteps.push(`setEnforcementDestination(${enforcerAddress})`);
    if (await pool.hasRole(LIQUIDATOR, liquidatorRecord.address)) poolSteps.push(`revokeRole(LIQUIDATOR_ROLE, ${liquidatorRecord.address})`);
    if (poolSteps.length > 0 && poolAdmin) {
      if (!(await pool.hasRole(ENFORCER, enforcerAddress))) await (await pool.grantRole(ENFORCER, enforcerAddress)).wait();
      if ((await pool.enforcementDestination()) !== enforcerAddress) await (await pool.setEnforcementDestination(enforcerAddress)).wait();
      if (await pool.hasRole(LIQUIDATOR, liquidatorRecord.address)) await (await pool.revokeRole(LIQUIDATOR, liquidatorRecord.address)).wait();
      log("  LendingPool: ENFORCER_ROLE and enforcementDestination -> PoolShareEnforcer; the Liquidator's LIQUIDATOR_ROLE revoked");
    } else if (poolSteps.length > 0) {
      log(`! The pool's admin (the Earn timelock) proposes on LendingPool: ${poolSteps.join("; ")}.`);
    }
    if ((await liquidator.poolShareEnforcer()) !== enforcerAddress) {
      if (await liquidator.hasRole(ADMIN, deployer.address)) {
        await (await liquidator.setPoolShareEnforcer(enforcerAddress)).wait();
        log("  Liquidator pool-share proceeds -> PoolShareEnforcer");
      } else {
        log(`! The Liquidator's admin proposes setPoolShareEnforcer(${enforcerAddress}).`);
      }
    }
    const POOL_SHARE = ethers.encodeBytes32String("POOL_SHARE");
    const registryAdmin = await registry.hasRole(ADMIN, deployer.address);
    if ((await registry.enforcementSource()) === ethers.ZeroAddress) {
      if (registryAdmin) {
        await (await registry.setEnforcementSource(enforcerAddress)).wait();
        log("  CollateralRegistry enforcement source -> PoolShareEnforcer (set once)");
      } else {
        log(`! The registry's admin proposes setEnforcementSource(${enforcerAddress}) (set once).`);
      }
    }
    if ((await registry.collateralTypes(POOL_SHARE)).valuer !== poolRecord.address) {
      if (await registry.hasRole(await registry.OPERATOR_ROLE(), deployer.address)) {
        await (await registry.setCollateralValuer(POOL_SHARE, poolRecord.address)).wait();
        log("  POOL_SHARE valued by LendingPool.previewRedeem (MB-05 §1.3)");
      } else {
        log(`! The registry's operator calls setCollateralValuer(POOL_SHARE, ${poolRecord.address}).`);
      }
    }
  }

  // ---- vault: state source (the pilot measure is off chain; Phase 2d, decision 7) ----
  const vaultRecord = getDeployment(network, "ESADepositVault");
  if (vaultRecord) {
    const vault = await ethers.getContractAt("ESADepositVault", vaultRecord.address);
    const registryAddress = await networkRegistry.getAddress();
    if ((await vault.stateSource()) === registryAddress) {
      log("  ESADepositVault state source is NetworkRegistry");
    } else if (await vault.hasRole(ethers.ZeroHash, deployer.address)) {
      await (await vault.setStateSource(registryAddress)).wait();
      log("  ESADepositVault state source -> NetworkRegistry");
    } else {
      log(`! The vault is governed by the vault timelock: propose setStateSource(${registryAddress}) there.`);
    }
  }

  // ---- decision 48 (b): no retired credit or bond contract keeps a role on the vault or ClaimEscrow ----
  {
    const { contracts: retired } = await retiredContracts((n) => getDeployment(network, n));
    const retiredProposals: Proposal[] = [];
    if (vaultRecord && retired.length > 0) {
      const vault = await ethers.getContractAt("ESADepositVault", vaultRecord.address);
      retiredProposals.push(...(await revokeRetiredRoles(vault, "ESADepositVault", RETIRED_ROLE_CHECKS.ESADepositVault, retired, deployer, VIA.vault, log)));
    }
    const escrowRecord = getDeployment(network, "ClaimEscrow");
    if (escrowRecord && retired.length > 0) {
      const escrow = await ethers.getContractAt("ClaimEscrow", escrowRecord.address);
      retiredProposals.push(...(await revokeRetiredRoles(escrow, "ClaimEscrow", RETIRED_ROLE_CHECKS.ClaimEscrow, retired, deployer, VIA.credit, log)));
    }
    if (retiredProposals.length > 0) {
      log("! The deployer no longer holds these powers. Propose:");
      printProposals(retiredProposals, log);
    }
  }

  // ---- Phase 2g, 12.18: the workout plan's 0% position (one tier, outside the draw order) ----
  const WORKOUT = ethers.encodeBytes32String("WORKOUT");
  let hasWorkoutTier = false;
  const tiersNow = Number(await revolving.tierCount());
  for (let id = 0; id < tiersNow; id++) {
    if ((await revolving.tierAt(id))[0] === WORKOUT) hasWorkoutTier = true;
  }
  if (!hasWorkoutTier && tiersNow > 0) {
    await (await revolving.addTier(WORKOUT, 0, await revolving.cycleLength())).wait();
    log("  RevolvingIssuer workout-plan position (12.18) added at 0%");
  }

  // ---- Phase 2g, 10c: the member's pause clock, read by RevolvingIssuer and the Liquidator ----
  // PauseClock has no owner, role or setter: it reads CLRUSD's and the vault's own clocks. It is
  // named only once both answer the views (both upgraded past Phase 2g): an issuer that reads a
  // clock that cannot answer would stop judging cycles.
  const pauseClrusd = getDeployment(network, "ClearUSDUpgradeable");
  const pauseVault = getDeployment(network, "ESADepositVault");
  if (pauseClrusd && pauseVault) {
    const views = await ethers.getContractAt(
      ["function pauseClock(address) view returns (uint256)", "function pauseClock() view returns (uint256)"],
      pauseClrusd.address);
    const vaultViews = await ethers.getContractAt(["function pauseClock() view returns (uint256)"], pauseVault.address);
    const ready = await views["pauseClock(address)"](ethers.ZeroAddress).then(() => true, () => false)
      && await vaultViews.pauseClock().then(() => true, () => false);
    if (!ready) {
      log("! CLRUSD or the vault predates Phase 2g (no pause clock): upgrade both, then run this again to name the pause clock.");
    } else {
      let clockAddress = getDeployment(network, "PauseClock")?.address;
      if (!clockAddress) {
        const clock = await (await ethers.getContractFactory("PauseClock")).deploy(pauseClrusd.address, pauseVault.address);
        await clock.waitForDeployment();
        clockAddress = await clock.getAddress();
        saveDeployment(network, "PauseClock", clockAddress, JSON.parse(clock.interface.formatJson()));
        log(`+ PauseClock deployed to ${clockAddress}`);
      }
      const workouts = await ethers.getContractAt("RevolvingIssuerWorkouts", await revolving.getAddress());
      if ((await workouts.pauseClock()) === ethers.ZeroAddress) {
        await (await workouts.setPauseClock(clockAddress)).wait();
        log("  RevolvingIssuer pause clock -> PauseClock (set once)");
      }
      if (liquidatorRecord) {
        const liquidator = await ethers.getContractAt("Liquidator", liquidatorRecord.address);
        if ((await liquidator.pauseClock()) === ethers.ZeroAddress) {
          if (await liquidator.hasRole(await liquidator.DEFAULT_ADMIN_ROLE(), deployer.address)) {
            await (await liquidator.setPauseClock(clockAddress)).wait();
            log("  Liquidator pause clock -> PauseClock (set once; TermIssuer reads it through its hold source)");
          } else {
            log(`! The Liquidator's admin names the pause clock: propose setPauseClock(${clockAddress}) there.`);
          }
        }
      }
    }
  }

  // ---- CLRUSD: members only (spec 12.15) ----
  const clrusdRecord = getDeployment(network, "ClearUSDUpgradeable");
  const accessRecord = getDeployment(network, "AccessManager");
  if (clrusdRecord && accessRecord) {
    const clrusd = await ethers.getContractAt("ClearUSDUpgradeable", clrusdRecord.address);
    if ((await clrusd.membershipSource()) === ethers.getAddress(accessRecord.address)) {
      log("  CLRUSD membership source is the AccessManager");
    } else if ((await clrusd.defaultAdmin()) === deployer.address) {
      await (await clrusd.setMembershipSource(accessRecord.address)).wait();
      log("  CLRUSD membership source -> AccessManager (transfers to members only)");
    } else {
      log(`! CLRUSD is governed by the vault timelock: propose setMembershipSource(${accessRecord.address}) there.`);
    }
    // Redeem intents fund an escrow address before it exists, so the factory that records them is
    // registered on CLRUSD (Phase 2d). Only a factory built with that record qualifies.
    const factoryRecord = getDeployment(network, "SavingsIntentFactory");
    if (factoryRecord) {
      const factory = ethers.getAddress(factoryRecord.address);
      const f = await ethers.getContractAt(["function isIntentEscrow(address) view returns (bool)"], factory);
      const recordsEscrows = await f.isIntentEscrow(ethers.ZeroAddress).then(() => true, () => false);
      if (!recordsEscrows) {
        log("! SavingsIntentFactory predates Phase 2d (no isIntentEscrow): redeploy it (deploy/19) before redeem intents can receive CLRUSD.");
      } else if ((await clrusd.intentFactory()) === factory) {
        log("  CLRUSD intent factory is SavingsIntentFactory");
      } else if ((await clrusd.defaultAdmin()) === deployer.address) {
        await (await clrusd.setIntentFactory(factory)).wait();
        log("  CLRUSD intent factory -> SavingsIntentFactory (redeem escrows may receive)");
      } else {
        log(`! CLRUSD is governed by the vault timelock: propose setIntentFactory(${factory}) there.`);
      }
    }
  }

  log("\nCompliance wiring done.");
  return { rates };
}

if (require.main === module) {
  wireCompliance()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
