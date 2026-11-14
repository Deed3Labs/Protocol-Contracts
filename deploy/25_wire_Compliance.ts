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
 *   trusted issuers), and names NetworkRegistry as the vault's state source. From then on every
 *   vault mint needs the receiver's state attestation while the pilot item is on (Phase 2d, L-E).
 *   The pilot measure itself is off chain (Phase 2d, decision 7): there is no cap to set.
 * - Names the AccessManager as CLRUSD's membership source, so CLRUSD is received only by member
 *   wallets (spec 12.15, Phase 2d decision 6), and the SavingsIntentFactory as its intent factory,
 *   whose redeem escrows may receive.
 * Both of the last two need the vault's or CLRUSD's admin. After `vault_timelock_handover.ts` they
 * are Clear Financial Safe proposals through the vault timelock, and the script says so.
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
