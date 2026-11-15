// Uses the Hardhat runtime of whatever is calling (a test or a deploy script). Never run against a
// network as part of this change.

/*
 * Phase 2f stage 3: two pieces of Earn wiring that `deploy/26_deploy_EarnControls.ts` runs.
 *
 * 1. The refused payers (Earn §1; IV-02 §2.4: "The Vault rejects payment from any Clear contract
 *    holding ESA capital, collateral, credit or Earn funds"). `EarnControls.refused` is checked for
 *    the payer and the receiver of every Yield Pool subscription (`checkSubscription`) and every bond
 *    purchase (`checkPurchase`), so no Clear contract can pay for, or be issued, an Earn Product.
 *    The list is every Clear contract the requirements and the earlier reports name (see
 *    `REFUSED_RECORDS`), plus every bond collection the factories have made.
 *
 * 2. The Collateral Agent's pledge module (decision 19; `IAgentPledgeModule`). The Liquidator
 *    answers `enforcementPermitted`, `defaultedAmountOf` and `applyDistribution` (in its
 *    LiquidatorEnforcement module), so the Agent's `pledgeModule` is the Liquidator's proxy.
 *    `CollateralAgent.setPledgeModule` is a co-signed change (IV-10 Exhibit A, Part 2 item 6): two
 *    treasury signers propose and confirm it, the Agent Key co-signs it, 7 days pass, and the Agent's
 *    admin (the Earn timelock) makes the call. No key here can do any of that, so the script prints
 *    the steps. The Liquidator needs nothing set about the Agent: it accepts `applyDistribution`
 *    only from the Agent the bond collection names (`BurnerBond.agent()`), which deploy 23 sets.
 */

/** The deployment records of Clear contracts refused as Earn payers or receivers, and why. */
export const REFUSED_RECORDS: { name: string; why: string }[] = [
  // ESA capital (IV-02 §2.4; MB-02)
  { name: "ESADepositVault", why: "ESA capital" },
  { name: "ESADepositVaultLegacy", why: "ESA capital" },
  { name: "ClearUSD", why: "CLRUSD (ESA capital)" },
  { name: "ClearUSDUpgradeable", why: "CLRUSD (ESA capital)" },
  { name: "CLRUSDTokenPool", why: "CLRUSD bridge pool (ESA capital)" },
  { name: "SavingsIntentFactory", why: "savings deposits in flight (ESA capital)" },
  { name: "ClaimEscrow", why: "ESA claims" },
  // Collateral and its enforcement (MB-05; IV-10)
  { name: "CollateralRegistry", why: "collateral" },
  { name: "Liquidator", why: "collateral enforcement (the pledge module)" },
  { name: "PoolShareEnforcer", why: "collateral enforcement" },
  { name: "CollateralAgent", why: "collateral (IV-10)" },
  { name: "HolderDirections", why: "Earn (Required-Holder Directions)" },
  // Credit
  { name: "ClearCredit", why: "credit (the ledger)" },
  { name: "RevolvingIssuer", why: "credit" },
  { name: "TermIssuer", why: "credit" },
  { name: "OffersIssuer", why: "credit" },
  { name: "PayoutPool", why: "credit (merchant payouts)" },
  // Earn funds
  { name: "LendingPool", why: "Earn funds (the Yield Pool)" },
  { name: "BondVault", why: "Earn funds" },
  { name: "BurnerBond", why: "Earn funds (a bond collection)" },
  { name: "BurnerBondLegacy", why: "Earn funds (a pre-2f bond collection)" },
  { name: "BurnerBondDeposit", why: "Earn funds (the pre-2f deposit path)" },
  { name: "BurnerBondDepositLegacy", why: "Earn funds (the pre-2f deposit path)" },
  { name: "BurnerBondPre2f", why: "Earn funds (a pre-2f bond collection, kept by deploy 22)" },
  { name: "BurnerBondDepositPre2f", why: "Earn funds (the pre-2f deposit path)" },
  // The Assurance compartments
  { name: "AssurancePool", why: "the Assurance compartments" },
  { name: "AssurancePoolV2", why: "the Assurance compartments" },
];

/** The bond factories whose every collection is refused. */
export const BOND_FACTORY_RECORDS = ["BurnerBondFactory", "BurnerBondFactoryPre2f", "BurnerBondFactoryLegacy"];

export interface RefusedEntry {
  name: string;
  address: string;
  why: string;
}

/**
 * The Clear contracts to refuse on `network`: each recorded `REFUSED_RECORDS` address, and every
 * collection of each recorded bond factory. `lookup` returns a record's address (the deploy scripts
 * pass `getDeployment`), so a test can supply its own.
 */
export async function clearContractsToRefuse(lookup: (name: string) => string | undefined): Promise<RefusedEntry[]> {
  const { ethers } = require("hardhat");
  const out: RefusedEntry[] = [];
  const seen = new Set<string>();
  const add = (name: string, address: string | undefined, why: string) => {
    if (!address || address === ethers.ZeroAddress || seen.has(address.toLowerCase())) return;
    seen.add(address.toLowerCase());
    out.push({ name, address, why });
  };
  for (const r of REFUSED_RECORDS) add(r.name, lookup(r.name), r.why);
  for (const f of BOND_FACTORY_RECORDS) {
    const address = lookup(f);
    if (!address) continue;
    const factory = await ethers.getContractAt("BurnerBondFactory", address);
    const n = Number(await factory.getCollectionCount());
    for (let i = 0; i < n; i++) {
      const info = await factory.getCollectionAtIndex(i);
      add(`${f} collection ${info.tokenSymbol || i}`, info.collectionAddress, "Earn funds (a bond collection)");
      add(`${f} deposit contract ${info.tokenSymbol || i}`, info.depositContract, "Earn funds (the pre-2f deposit path)");
    }
  }
  return out;
}

/**
 * Refuses each entry on EarnControls that is not refused yet. While `sender` holds the controls'
 * admin role (before `earn_timelock_handover.ts`) it calls `setRefused`; afterwards it returns the
 * calls for the Earn timelock to propose. Never un-refuses anything.
 */
export async function refuseClearContracts(controls: any, entries: RefusedEntry[], sender: any, log = console.log) {
  const admin = await controls.hasRole("0x" + "00".repeat(32), sender.address);
  const proposals: { target: string; data: string; name: string }[] = [];
  for (const e of entries) {
    if (await controls.refused(e.address)) continue;
    if (admin) {
      await (await controls.connect(sender).setRefused(e.address, true)).wait();
      log(`  EarnControls refused: ${e.name} ${e.address} (${e.why})`);
    } else {
      const data = controls.interface.encodeFunctionData("setRefused", [e.address, true]);
      proposals.push({ target: await controls.getAddress(), data, name: e.name });
      log(`  ! Earn timelock: setRefused(${e.address}, true) for ${e.name} (${e.why}); calldata ${data}`);
    }
  }
  return proposals;
}

/**
 * The co-signed change that names `module` as the Agent's pledge module: the call the Agent's admin
 * makes, its hash (what the treasury signers propose) and the steps, in order.
 */
export async function pledgeModuleChange(agent: any, module: string) {
  const { ethers } = require("hardhat");
  const target = await agent.getAddress();
  const data: string = agent.interface.encodeFunctionData("setPledgeModule", [module]);
  const callHash: string = ethers.keccak256(data);
  const descriptionHash: string = ethers.id(`CollateralAgent.setPledgeModule(${module}): the Liquidator answers IAgentPledgeModule (decision 19)`);
  return {
    target,
    data,
    callHash,
    descriptionHash,
    steps: [
      `treasury signer 1: CollateralAgent.proposeChange(${target}, ${callHash}, ${descriptionHash})`,
      "treasury signer 2 (a different one): CollateralAgent.confirmChange(<changeId from ChangeProposed or openChangeFor>)",
      "Agent Key: CollateralAgent.approveChange(<changeId>)",
      `after 7 days from the confirmation, the Earn timelock (its admin) calls ${target} with ${data}`,
    ],
  };
}
