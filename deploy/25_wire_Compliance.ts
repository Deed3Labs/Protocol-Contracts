import * as fs from "fs";
import * as path from "path";
import { saveDeployment, getDeployment } from "./helpers";

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
 * - Grants STATE_ATTESTER_ROLE on NetworkRegistry to `STATE_ATTESTER_KEY` when set.
 * - Trusts the revolving issuer on the Liquidator (permissionless liquidation only seizes for
 *   trusted issuers), and names NetworkRegistry as the vault's state source.
 * - Sets the vault's CA pilot cap only when `PILOT_CAP_USD` is given; it is off otherwise.
 *
 * Idempotent: every step checks before it writes. It never deploys a contract other than
 * RateSchedule and never moves an admin power; the handover is a separate, explicit step.
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
  pilotCapUsd?: bigint;
  pilotAlertUsd?: bigint;
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
    const bond = await ethers.getContractAt("BurnerBond", bondRecord.address);
    // The default gate is the issuer's computed default; the Liquidator is only the narrow
    // settlement gate for missed-cycle excess and matured shortfalls (owner decision).
    if ((await bond.owner()) === deployer.address) {
      if ((await bond.defaultSource()) !== (await revolving.getAddress())) {
        await (await bond.setDefaultSource(await revolving.getAddress())).wait();
        log("  BurnerBond default source -> RevolvingIssuer");
      }
      if ((await bond.settlementGate()) !== liquidatorRecord.address) {
        await (await bond.setSettlementGate(liquidatorRecord.address)).wait();
        log("  BurnerBond settlement gate -> Liquidator");
      }
    } else {
      log("! BurnerBond is owned elsewhere: its owner sets setDefaultSource(RevolvingIssuer) and setSettlementGate(Liquidator).");
    }
  }

  // ---- vault: state source, and the CA pilot cap only when asked for ----
  const vaultRecord = getDeployment(network, "ESADepositVault");
  if (vaultRecord) {
    const vault = await ethers.getContractAt("ESADepositVault", vaultRecord.address);
    const registryAddress = await networkRegistry.getAddress();
    // The source is private storage on a live contract; setting it again is harmless.
    await (await vault.setStateSource(registryAddress)).wait();
    log("  ESADepositVault state source -> NetworkRegistry");
    const capUsd = options.pilotCapUsd ?? (process.env.PILOT_CAP_USD ? BigInt(process.env.PILOT_CAP_USD) : undefined);
    if (capUsd !== undefined) {
      const alertUsd = options.pilotAlertUsd ??
        (process.env.PILOT_ALERT_USD ? BigInt(process.env.PILOT_ALERT_USD) : (capUsd * 8n) / 10n);
      await (await vault.setPilotCap(capUsd * ONE_USD, alertUsd * ONE_USD, true)).wait();
      log(`  CA pilot cap ${capUsd} USD, alert at ${alertUsd} USD`);
    } else {
      log("! PILOT_CAP_USD unset: the CA pilot cap is off.");
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
