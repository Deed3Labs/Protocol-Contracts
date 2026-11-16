import { getDeployment, saveDeployment, liveNetworkOf } from "./helpers";
import { earnControlsProxyOptions, earnControlsAt } from "./earnModules";
import { deployEarnTimelock } from "./earn_timelock_handover";
import { clearContractsToRefuse, refuseClearContracts, pledgeModuleChange } from "./earnWiring";

/**
 * Phase 2f, stage 1: the Earn timelock, EarnControls and the CollateralAgent (decisions 1, 2, 18).
 *
 * - The Earn TimelockController (7 days, the Clear Lending Safe proposing and executing, no admin),
 *   unless one is recorded.
 * - EarnControls with its EarnControlsAdmin module, from `deploy/config/earn-controls.json`. The
 *   deployer is its admin only until `earn_timelock_handover.ts` runs, so it can wire the sources
 *   and grant the operational keys first.
 * - The CollateralAgent, with the Earn timelock as admin from the start (a later grant needs the
 *   Agent's co-signature), when AGENT_KEY, TREASURY_SIGNERS, COLLATERAL_ACCOUNT, AGENT_COST_ADDRESS
 *   and EXCESS_DESTINATION are all set. Its vault, bond book and pledge module are stage 2's; until
 *   then they are left unset (a later change needs the Agent's co-signature and 7 days).
 *
 * - Stage 3: the refused payers (Earn §1; IV-02 §2.4). Every recorded Clear contract that holds
 *   ESA capital, collateral, credit or Earn funds, and every bond collection, is refused as a payer
 *   or receiver of an Earn Product (`deploy/earnWiring.ts`, `REFUSED_RECORDS`). Set directly while
 *   the deployer is EarnControls' admin; afterwards printed as Earn timelock proposals.
 * - Stage 3: the Agent's pledge module (decision 19). Once the Liquidator and the Agent are both
 *   recorded and the Agent does not name the Liquidator yet, it prints the co-signed
 *   `setPledgeModule(Liquidator)` change: two treasury signers, the Agent Key, 7 days, then the
 *   Earn timelock. The Liquidator itself needs no setting: it takes distributions only from the
 *   Agent the bond collection names (deploy 23).
 *
 * Nothing here touches a deployed contract. Stage 2 points LendingPool at EarnControls
 * (`setEarnControls`) through the Earn timelock. Idempotent: anything recorded is reused.
 *
 * This script has never been run against a network.
 *
 *   CLEAR_LENDING_SAFE=0x... npx hardhat run deploy/26_deploy_EarnControls.ts --network base-sepolia
 */
async function main() {
  const hre = require("hardhat");
  const { ethers, upgrades } = hre;
  const [deployer] = await ethers.getSigners();
  const network = (await ethers.provider.getNetwork()).name;
  const base = require("./config/earn-controls.json");
  // A network's own overrides (testnet values; Base mainnet has none), by the live network a fork rehearses.
  const cfg = { ...base, ...(base.networks?.[liveNetworkOf(network)] ?? {}) };
  const units = (dollars: number) => BigInt(dollars) * 10n ** BigInt(cfg.decimals);

  const safe = process.env.CLEAR_LENDING_SAFE;
  if (!safe || !ethers.isAddress(safe)) throw new Error("CLEAR_LENDING_SAFE must be the Clear Lending Co. Safe address.");

  let timelock = getDeployment(network, "EarnTimelock")?.address;
  if (!timelock) {
    const t = await deployEarnTimelock(safe);
    timelock = await t.getAddress();
    saveDeployment(network, "EarnTimelock", timelock, JSON.parse(t.interface.formatJson()));
    console.log(`+ EarnTimelock deployed to ${timelock}`);
  }

  if (!getDeployment(network, "EarnControls")) {
    const membership = getDeployment(network, "MembershipRegistry")?.address ?? ethers.ZeroAddress;
    const F = await ethers.getContractFactory("EarnControls");
    const controls = await upgrades.deployProxy(
      F,
      [{
        admin: deployer.address,
        decimals: cfg.decimals,
        membership,
        fundingLimit: units(cfg.fundingLimitDollars),
        fundingResolution: cfg.fundingResolution,
        fiscalYear: cfg.fiscalYear,
        offeringCap: units(cfg.offeringCapDollars),
        poolCapacity: units(cfg.poolCapacityDollars),
        holderCapFloor: units(cfg.holderCapFloorDollars),
      }],
      await earnControlsProxyOptions()
    );
    await controls.waitForDeployment();
    const address = await controls.getAddress();
    const abi = [...JSON.parse(F.interface.formatJson()), ...JSON.parse((await ethers.getContractFactory("EarnControlsAdmin")).interface.formatJson())];
    saveDeployment(network, "EarnControls", address, abi);
    console.log(`+ EarnControls deployed to ${address} (admin: the deployer until earn_timelock_handover.ts)`);
  }

  const env = (name: string) => process.env[name]?.trim() ?? "";
  const signers = env("TREASURY_SIGNERS").split(",").map((s) => s.trim()).filter(Boolean);
  const ready = [env("AGENT_KEY"), env("COLLATERAL_ACCOUNT"), env("AGENT_COST_ADDRESS"), env("EXCESS_DESTINATION")].every((a) => ethers.isAddress(a));
  if (getDeployment(network, "CollateralAgent")) {
    console.log("= CollateralAgent already recorded");
  } else if (!ready || signers.length < 2) {
    console.log("! CollateralAgent not deployed: set AGENT_KEY, TREASURY_SIGNERS (two or more), COLLATERAL_ACCOUNT, AGENT_COST_ADDRESS and EXCESS_DESTINATION.");
  } else {
    const F = await ethers.getContractFactory("CollateralAgent");
    const agent = await upgrades.deployProxy(
      F,
      [timelock, env("AGENT_KEY"), signers, cfg.decimals, {
        vault: ethers.ZeroAddress,
        bondBook: ethers.ZeroAddress,
        pledgeModule: ethers.ZeroAddress,
        payeeSource: getDeployment(network, "EarnControls")!.address,
        collateralAccount: env("COLLATERAL_ACCOUNT"),
        costAddress: env("AGENT_COST_ADDRESS"),
        excessDestination: env("EXCESS_DESTINATION"),
      }],
      { kind: "uups" }
    );
    await agent.waitForDeployment();
    saveDeployment(network, "CollateralAgent", await agent.getAddress(), JSON.parse(F.interface.formatJson()));
    console.log(`+ CollateralAgent deployed to ${await agent.getAddress()} (admin: the Earn timelock)`);
  }

  // Stage 3: the refused payers (Earn §1; IV-02 §2.4).
  const controlsRecord = getDeployment(network, "EarnControls");
  if (controlsRecord) {
    const controls = await earnControlsAt(controlsRecord.address, deployer);
    const entries = await clearContractsToRefuse((name: string) => getDeployment(network, name)?.address);
    console.log(`Refused payers: ${entries.length} Clear contracts recorded on ${network}`);
    await refuseClearContracts(controls, entries, deployer);
  }

  // Stage 3: the Agent's pledge module (decision 19), a co-signed change.
  const agentRecord = getDeployment(network, "CollateralAgent");
  const liquidatorRecord = getDeployment(network, "Liquidator");
  if (agentRecord && liquidatorRecord) {
    const agent = await ethers.getContractAt("CollateralAgent", agentRecord.address);
    if ((await agent.pledgeModule()).toLowerCase() !== liquidatorRecord.address.toLowerCase()) {
      const change = await pledgeModuleChange(agent, liquidatorRecord.address);
      console.log("! CollateralAgent.setPledgeModule(Liquidator) is a co-signed change:");
      for (const step of change.steps) console.log(`    ${step}`);
    } else {
      console.log("= CollateralAgent pledge module is the Liquidator");
    }
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
