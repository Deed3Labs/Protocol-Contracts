import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { buildSigningPlan, writeSigningPlan, PlanStep, SigningPlan } from "../../scripts/signing_plan";
import { checkSepoliaWiring } from "../../scripts/check_sepolia_wiring";
import { deployEarnTimelock } from "../../deploy/earn_timelock_handover";
import { deployVaultTimelock } from "../../deploy/vault_timelock_handover";
import { deployCreditCore } from "../../deploy/20_deploy_CreditCore";
import { poolAt, poolProxyOptions } from "../../deploy/poolModules";
import { deployAssuranceTimelock, deployAssurancePool, CL_FEES_MASK, BOARD_ALLOCATION_MASK } from "../../deploy/assurance_timelock_handover";
import { checkRolloutInputs, checkPayoutTopUpSetup } from "../../scripts/check_rollout_inputs";
import { prepareSettlementLaneUpgrade } from "../../scripts/upgrade_settlement_lane";
import { deploySettlementForwarder } from "../../deploy/28_deploy_SettlementForwarder";
import { checkSettlementForwarderSetup } from "../../scripts/check_rollout_inputs";
import {
  ALLOWANCE_MODULE_ABI, ERC20_ABI, PAYOUT_POOL_TOPUP_ABI, SAFE_MODULE_ABI, CANONICAL_ALLOWANCE_MODULE, topUpCalls, assertTopUpCall,
} from "../../apps/api/src/services/payoutFunding/topUp";

/*
 * scripts/signing_plan.ts on the in-process Hardhat network: a small stack in the shape the Base
 * Sepolia rollout leaves before its co-signer steps (docs/audit/SEPOLIA-REHEARSAL.md), the plan
 * built from it, and every ready step sent by its signer with exactly the plan's {to, data}, round
 * after round, until nothing is left. Nothing here touches a live network or uses a key.
 */
const DAY = 24 * 3600;
const ASSURANCE_KEYS = ["payer-clfees", "payer-treasury", "lendingco", "disbursement", "exposure"];
const DIR = path.join("deployments", "hardhat");
const random = () => ethers.Wallet.createRandom().address;

async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e: any) {
    return String(e?.message);
  }
  return "";
}

describe("the signing plan (scripts/signing_plan.ts)", function () {
  this.timeout(600_000);
  const saved = process.env.CARRY_TREASURY;
  let env: Record<string, string>;
  let valuationSigners: string[];
  let safe: any;
  let s: Record<string, any>;
  let bondVault: any, agent: any, earnTimelock: any, liquidator: any, term: any, pool: any, clrusd: any, vault: any, vaultTimelock: any;
  let holderDirections: any, revolving: any;
  let lendingSafe: any, assurancePool: any, assuranceTimelock: any, collateralRegistry: any;
  let usdcToken: any;
  const PT_STEPS = ["TU-funder", "TU-safe-module", "TU-safe-delegate", "TU-safe-allowance"];
  // Settlement Funding (decision 54): the pool upgrade on the Earn timelock, the deployment signers' DEPLOYER_ROLE
  // grants, the lane's two-person settings, then CL Operating's batch for the SettlementForwarder.
  const SL_FORWARDER = ["SL-cl-operating-delegate", "SL-cl-operating-allowance", "SL-cl-operating-offramp", "SL-cl-operating-desk"];
  const SL_GRANTS = ["SL-deployer-1-schedule", "SLx-deployer-1-execute", "SL-deployer-2-schedule", "SLx-deployer-2-execute"];
  const SL_STEPS = ["SL-upgrade-schedule", "SLx-upgrade-execute", ...SL_GRANTS, "SL-funder-1", "SL-funder-2", "SL-headroom-1", "SL-headroom-2", ...SL_FORWARDER];
  // What the walk leaves of SL: the upgrade's day 7, the pairs (no funder input yet) and CL Operating's batch.
  const SL_LEFT = SL_STEPS.filter((id) => id !== "SL-upgrade-schedule" && !SL_GRANTS.includes(id));
  // The pool's two DEPLOYER_ROLE signers (deploy 27 grants them; here the SL test does).
  const deploymentSigners = [random(), random()];
  let laneImpl: string;
  // The Assurance Pool's signers (Accounts 3 and 4 on Base Sepolia) and the addresses its setup names.
  const a3 = random(), a4 = random();
  const clFees = random(), disbursement = random(), clOperating = random(), clLossReserve = random();
  const retiredPayout = random();

  const record = (name: string, address: string) => fs.writeFileSync(path.join(DIR, `${name}.json`), JSON.stringify({ address, abi: [] }));
  const plan = () => buildSigningPlan({ network: "hardhat", env, valuationSigners, deploymentSigners });
  const step = (p: SigningPlan, id: string) => {
    const found = p.steps.find((x) => x.id === id);
    if (!found) throw new Error(`no step ${id}: ${p.steps.map((x) => x.id).join(", ")}`);
    return found;
  };

  /** Sends a plan step exactly as the page would: from its signer, to its `to`, with its data. */
  async function send(st: PlanStep) {
    await ethers.provider.send("hardhat_impersonateAccount", [st.signer]);
    await ethers.provider.send("hardhat_setBalance", [st.signer, "0x" + ethers.parseEther("10").toString(16)]);
    const signer = await ethers.getSigner(st.signer);
    const rc = await (await signer.sendTransaction({ to: st.to, data: st.data!, value: 0 })).wait();
    expect(rc!.status).to.equal(1);
    expect(rc!.to).to.equal(st.to);
  }

  /** The MockSafe stands in for the Safe's own addOwnerWithThreshold: owners and threshold written in place. */
  async function safeAddsOwner(owner: string, threshold: number) {
    const at = await safe.getAddress();
    const owners: string[] = await safe.getOwners();
    const base = BigInt(ethers.keccak256(ethers.zeroPadValue("0x00", 32)));
    await ethers.provider.send("hardhat_setStorageAt", [at, "0x0", ethers.zeroPadValue(ethers.toBeHex(owners.length + 1), 32)]);
    await ethers.provider.send("hardhat_setStorageAt", [at, ethers.toBeHex(base + BigInt(owners.length)), ethers.zeroPadValue(owner, 32)]);
    await ethers.provider.send("hardhat_setStorageAt", [at, "0x1", ethers.zeroPadValue(ethers.toBeHex(threshold), 32)]);
  }

  before(async function () {
    const all = await ethers.getSigners();
    const [deployer, o1, o2, o3, newOwner, t1, t2, key, cs1, cs2, ca1, ca2, h1, h2, v1, v2, relayer, opKey, feeTo, treasury] = all;
    s = { deployer, o1, o2, o3, newOwner, t1, t2, key, cs1, cs2, ca1, ca2, h1, h2, v1, v2, relayer, opKey, feeTo, treasury };
    fs.rmSync(DIR, { recursive: true, force: true });
    fs.mkdirSync(path.join(DIR, "safe-batches"), { recursive: true });

    // The Safe: one owner signs today (threshold 1 of 3), as on Base Sepolia.
    safe = await (await ethers.getContractFactory("MockSafe")).deploy([o1.address, o2.address, o3.address], 1);
    const safeAddress = await safe.getAddress();

    // D1, D2, D3: a fresh AccessManager and credit core; the old ones retired.
    const access = await upgrades.deployProxy(await ethers.getContractFactory("AccessManager"), [deployer.address]);
    record("AccessManager", await access.getAddress());
    for (const n of ["AccessManager", "TermIssuer", "RevolvingIssuer", "Liquidator", "PayoutPool", "CollateralRegistry"]) record(`${n}PreAudit`, random());
    record("PayoutPoolPreAudit", retiredPayout);
    process.env.CARRY_TREASURY = treasury.address;
    const core = await deployCreditCore({ quiet: true });
    term = core.term;
    revolving = core.revolving;
    collateralRegistry = core.collateral;
    // Deploy 25 proposes the fee recipient (the deployer holds the AccessManager's admin).
    await term.proposeFeeRecipient(feeTo.address, ethers.encodeBytes32String("INITIAL"));

    // The Clear Lending Safe: its own Safe, two of two (owner decision, Nov 16, 2026).
    lendingSafe = await (await ethers.getContractFactory("MockSafe")).deploy([deployer.address, newOwner.address], 2);
    // E1: the Earn timelock (the Clear Lending Safe proposing and executing) and the CollateralAgent under it.
    earnTimelock = await deployEarnTimelock(await lendingSafe.getAddress());
    record("EarnTimelock", await earnTimelock.getAddress());
    const usdc = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
    usdcToken = usdc;
    agent = await upgrades.deployProxy(await ethers.getContractFactory("CollateralAgent"),
      [await earnTimelock.getAddress(), key.address, [t1.address, t2.address], 6, {
        vault: ethers.ZeroAddress, bondBook: ethers.ZeroAddress, pledgeModule: ethers.ZeroAddress, payeeSource: ethers.ZeroAddress,
        collateralAccount: safeAddress, costAddress: safeAddress, excessDestination: safeAddress,
      }], { kind: "uups" });
    record("CollateralAgent", await agent.getAddress());

    // E3, E6: the BondVault, its backstop still naming the retired PayoutPool, the Agent named.
    bondVault = await upgrades.deployProxy(await ethers.getContractFactory("BondVault"), [deployer.address, await usdc.getAddress(), 0], { kind: "uups" });
    await bondVault.setBackstops(treasury.address, retiredPayout);
    // Deploy 23 gives the Earn timelock the vault's admin before it names the Agent (afterwards a grant is co-signed).
    await bondVault.grantRole(ethers.ZeroHash, await earnTimelock.getAddress());
    await bondVault.setEarnSources(await agent.getAddress(), random());
    record("BondVault", await bondVault.getAddress());
    holderDirections = await (await ethers.getContractFactory("HolderDirections")).deploy(await bondVault.getAddress(), await agent.getAddress(), random());
    record("HolderDirections", await holderDirections.getAddress());

    // E4: the fresh Liquidator.
    liquidator = await upgrades.deployProxy(await ethers.getContractFactory("Liquidator"),
      [deployer.address, random(), random(), random(), await usdc.getAddress(), random()], { kind: "uups" });
    record("Liquidator", await liquidator.getAddress());

    // E2, E7: the Yield Pool with its two VALUATION_ROLE signers.
    pool = await poolAt(await (await upgrades.deployProxy(await ethers.getContractFactory("LendingPool", deployer),
      [deployer.address, await usdc.getAddress(), "Clear Lending Pool", "clrLP"], await poolProxyOptions(deployer))).getAddress(), deployer);
    for (const v of [v1, v2]) await pool.grantRole(await pool.VALUATION_ROLE(), v.address);
    record("LendingPool", await pool.getAddress());
    valuationSigners = [v1.address, v2.address];
    // I4: the Earn timelock holds the pool's admin (the deployer keeps it here, to grant the SL test's roles).
    await pool.grantRole(ethers.ZeroHash, await earnTimelock.getAddress());
    // Decision 54: scripts/upgrade_settlement_lane.ts validates and deploys the lane's implementation and records it.
    laneImpl = (await prepareSettlementLaneUpgrade({ proxy: await pool.getAddress(), prepare: true, network: "hardhat", log: () => undefined })).implementation!;

    // C1: the savings vault and the batch C1c writes for its admin (the deployer).
    clrusd = await upgrades.deployProxy(await ethers.getContractFactory("ClearUSDUpgradeable"),
      ["Clear USD", "CLRUSD", 6, 0, 0, deployer.address, deployer.address],
      { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
    record("ClearUSDUpgradeable", await clrusd.getAddress());
    vault = await upgrades.deployProxy(await ethers.getContractFactory("ESADepositVault"), [await clrusd.getAddress(), deployer.address], { kind: "uups" });
    record("ESADepositVault", await vault.getAddress());
    await vault.grantRole(ethers.id("OPERATOR_ROLE"), relayer.address);
    const v = await vault.getAddress();
    fs.writeFileSync(path.join(DIR, "safe-batches", "vault-1-upgrade.json"), JSON.stringify({
      version: "1.0", chainId: "31337", createdAt: 0, meta: { name: "Vault upgrade", description: "test" },
      transactions: [
        { to: v, value: "0", data: vault.interface.encodeFunctionData("grantRole", [ethers.id("RELAYER_ROLE"), relayer.address]) },
        { to: v, value: "0", data: vault.interface.encodeFunctionData("revokeRole", [ethers.id("OPERATOR_ROLE"), relayer.address]) },
      ],
    }));

    // I3: the vault timelock, and CLRUSD's admin transfer to it begun by the vault handover.
    vaultTimelock = await deployVaultTimelock(safeAddress);
    record("VaultTimelock", await vaultTimelock.getAddress());
    await clrusd.beginDefaultAdminTransfer(await vaultTimelock.getAddress());

    // H1: the Assurance timelock (the Clear Treasury Safe as board) and the pool it governs.
    assuranceTimelock = await deployAssuranceTimelock(safeAddress);
    assurancePool = await deployAssurancePool(await usdc.getAddress(), await assuranceTimelock.getAddress(), await core.networkRegistry.getAddress(), [a3, a4]);
    record("AssuranceTimelock", await assuranceTimelock.getAddress());
    record("AssurancePoolV2", await assurancePool.getAddress());

    env = {
      DEPLOYER: deployer.address,
      VAULT_ADMIN: deployer.address,
      CLEAR_LENDING_SAFE: await lendingSafe.getAddress(),
      CLEAR_FINANCIAL_SAFE: safeAddress,
      BOARD_SAFE: safeAddress,
      COOP_TREASURY: safeAddress,
      CLEAR_LENDING_ACCOUNT: clOperating,
      ASSURANCE_SIGNERS: `${a3},${a4}`,
      ASSURANCE_CL_FEES_PAYER: clFees,
      ASSURANCE_DISBURSEMENT: disbursement,
      ASSURANCE_DRAW_ADDRESS: clOperating,
      ASSURANCE_LOSS_RESERVE: clLossReserve,
      ASSURANCE_COVERAGE_CAP: "10000000000",
      ASSURANCE_TIMING_SHORTFALL: "0",
      ASSURANCE_ATTESTED_BOOK: "0",
      ASSURANCE_FLOOR_EVIDENCE: ethers.id("Assurance Pool floor inputs (test)"),
      SAFE_NEW_OWNER: newOwner.address,
      SAFE_THRESHOLD: "2",
      TREASURY_SIGNERS: `${t1.address},${t2.address}`,
      AGENT_KEY: key.address,
      CREDIT_SETTINGS_SIGNERS: `${cs1.address},${cs2.address}`,
      CREDIT_ATTESTER_SIGNERS: `${ca1.address},${ca2.address}`,
      HOLD_SIGNERS: `${h1.address},${h2.address}`,
      FEE_RECIPIENT: feeTo.address,
      CARD_SETTLEMENT_ACCOUNT: clOperating,
      RELAYER: relayer.address,
      POOL_TIER_PRINCIPAL: "100000000000",
      POOL_TIER_EVIDENCE: ethers.id("Pool Tier valuation (test)"),
    };
  });

  after(function () {
    fs.rmSync(DIR, { recursive: true, force: true });
    if (saved === undefined) delete process.env.CARRY_TREASURY; else process.env.CARRY_TREASURY = saved;
  });

  it("lists every co-signer step, with what is ready now and why the rest waits", async function () {
    const p = await plan();
    expect(p.chainId).to.equal(31337);
    expect(p.stepsSha256).to.equal(createHash("sha256").update(JSON.stringify(p.steps)).digest("hex"));
    expect(p.steps.map((x) => x.id)).to.deep.equal([
      "C1d-1", "C1d-2",
      "D4-settings-1", "D4-settings-2", "D4-attester-1", "D4-attester-2", "D4-operator",
      ...["vault", "bondbook", "holderdirections", "pledgemodule", "backstop"].flatMap((k) => [`E8-${k}-propose`, `E8-${k}-confirm`, `E8-${k}-approve`]),
      "E8-hold-1", "E8-hold-2", "E8-earn-schedule", "E8x-earn-execute",
      "F2-fee-approve", "RT-fee-propose", "RT-fee-approve", "RT-card-account", "G1-tier-1", "G1-tier-2", "safe-owner", "I3-vault-schedule", "I3x-vault-execute",
      ...ASSURANCE_KEYS.flatMap((k) => [`AS-${k}-approve-1`, `AS-${k}-approve-2`]), "AS-assurance-schedule", "ASx-assurance-execute",
      "AS-floor-1", "AS-floor-2",
      ...PT_STEPS,
      ...SL_STEPS,
    ]);
    const ready = p.steps.filter((x) => x.status === "ready").map((x) => x.id);
    expect(ready).to.deep.equal([
      "C1d-1", "D4-settings-1", "D4-settings-2", "D4-attester-1", "D4-attester-2",
      "E8-vault-propose", "E8-bondbook-propose", "E8-holderdirections-propose", "E8-pledgemodule-propose", "E8-backstop-propose",
      "E8-hold-1", "E8-hold-2", "G1-tier-1", "G1-tier-2", "I3-vault-schedule",
      ...ASSURANCE_KEYS.map((k) => `AS-${k}-approve-1`), "AS-floor-1",
      // The deployment signers' DEPLOYER_ROLE grants (Earn timelock proposals) wait for nothing.
      "SL-deployer-1-schedule", "SL-deployer-2-schedule",
    ]);
    expect(step(p, "AS-floor-2").reason).to.contain("AS-floor-1");
    // Payout top-ups (decision 51) with no top-up inputs: their steps wait, and nothing is refused.
    expect(step(p, "TU-funder").reason).to.contain("Waiting for input: PAYOUT_TOPUP_WALLET");
    expect(step(p, "TU-safe-allowance").reason).to.contain("PAYOUT_TOPUP_WALLET");
    expect(step(p, "TU-safe-module").reason).to.contain("has no code");
    for (const id of PT_STEPS) expect(step(p, id).to, id).to.equal(ethers.ZeroAddress);
    expect(step(p, "C1d-2").reason).to.contain("C1d-1");
    expect(step(p, "D4-operator").reason).to.contain("CREDIT_OPERATOR_ADDRESS");
    expect(step(p, "D4-operator").data).to.equal(null);
    expect(step(p, "E8-vault-confirm").reason).to.contain("proposed");
    expect(step(p, "E8-vault-confirm").data).to.equal(null);
    expect(step(p, "F2-fee-approve").reason).to.contain("D4-settings-2");
    // RT: no fee recipient is set yet, so F2 names it and RT has nothing to change; the card account waits for its grant.
    expect(step(p, "RT-fee-propose").reason).to.contain("F2 names the first one");
    expect(step(p, "RT-fee-approve").reason).to.contain("F2 names the first one");
    expect(step(p, "RT-card-account").reason).to.contain("D4-settings-1");
    expect(step(p, "RT-card-account").args[0].value).to.equal(clOperating);
    expect(step(p, "E8-earn-schedule").reason).to.contain("E8-vault-confirm");
    expect(step(p, "E8-earn-schedule").kind).to.equal("safe");
    // The MockSafe has no addOwnerWithThreshold: the dry run catches what would revert.
    expect(step(p, "safe-owner").status).to.equal("waiting");
    expect(step(p, "safe-owner").reason).to.contain("dry run");
    expect(step(p, "safe-owner").data).to.equal(
      new ethers.Interface(["function addOwnerWithThreshold(address,uint256)"]).encodeFunctionData("addOwnerWithThreshold", [s.newOwner.address, 2]));
    expect(step(p, "safe-owner").to).to.equal(await safe.getAddress());

    // Signers come from the inputs, labelled by their slot.
    expect(step(p, "E8-vault-propose").signer).to.equal(s.t1.address);
    expect(step(p, "E8-vault-propose").signerLabel).to.equal("treasury signer 1");
    expect(step(p, "D4-settings-2").args[0].note).to.equal("CREDIT_SETTINGS_ROLE");
    expect(step(p, "G1-tier-1").title).to.contain("$100,000.00");
    expect(step(p, "E8-backstop-propose").stage).to.equal("E9");
    // The Earn timelock's batches are the Clear Lending Safe's; the vault's and Assurance's the Clear Treasury Safe's.
    expect(step(p, "E8-earn-schedule").signer).to.equal(await lendingSafe.getAddress());
    expect(step(p, "E8-earn-schedule").signerLabel).to.contain("Clear Lending Safe");
    expect(step(p, "I3-vault-schedule").signer).to.equal(await safe.getAddress());
    expect(step(p, "AS-assurance-schedule").signer).to.equal(await safe.getAddress());
    expect(step(p, "ASx-assurance-execute").signer).to.equal(await safe.getAddress());
    expect(step(p, "AS-assurance-schedule").kind).to.equal("safe");
    expect(step(p, "AS-assurance-schedule").to).to.equal(await assuranceTimelock.getAddress());
    // Account 3 first, then Account 4, on the exact calldata the timelock will send.
    const payer = step(p, "AS-payer-clfees-approve-1");
    expect(payer.signer).to.equal(ethers.getAddress(a3));
    expect(payer.to).to.equal(await assurancePool.getAddress());
    expect(payer.args[0].value).to.equal(ethers.keccak256(assurancePool.interface.encodeFunctionData("setPayer", [clFees, 3])));
    expect(step(p, "AS-payer-clfees-approve-2").signer).to.equal(ethers.getAddress(a4));
    expect(step(p, "AS-payer-clfees-approve-2").reason).to.contain("AS-payer-clfees-approve-1");
    expect(step(p, "AS-payer-treasury-approve-1").args[0].value).to.equal(ethers.keccak256(assurancePool.interface.encodeFunctionData("setPayer", [await safe.getAddress(), 12])));
    expect(step(p, "AS-exposure-approve-1").args[0].value).to.equal(ethers.keccak256(assurancePool.interface.encodeFunctionData("setExposureSources", [[await collateralRegistry.getAddress()]])));
    expect(step(p, "AS-assurance-schedule").reason).to.contain("AS-payer-clfees-approve-1");
    // Settlement Funding (decision 54): the pool upgrade is a new Earn timelock proposal, scheduled only after E8x has run.
    expect(step(p, "SL-upgrade-schedule").reason).to.equal("Waits for E8x-earn-execute first.");
    expect(step(p, "SL-upgrade-schedule").dependsOn).to.deep.equal(["E8x-earn-execute"]);
    expect(step(p, "SL-upgrade-schedule").signer).to.equal(await lendingSafe.getAddress());
    expect(step(p, "SL-upgrade-schedule").to).to.equal(await earnTimelock.getAddress());
    expect(step(p, "SL-upgrade-schedule").args[2].value).to.equal(pool.interface.encodeFunctionData("upgradeTo", [laneImpl]));
    expect(step(p, "SLx-upgrade-execute").dependsOn).to.include("E8x-earn-execute");
    expect(step(p, "SL-funder-1").reason).to.contain("Waiting for input: SETTLEMENT_FUNDER");
    expect(step(p, "SL-funder-1").data).to.equal(null);
    expect(step(p, "SL-cl-operating-delegate").reason).to.contain("deploy 28");
    for (const id of SL_FORWARDER.slice(1)) expect(step(p, id).reason, id).to.contain("Waiting for input: SETTLEMENT_");
    for (const x of p.steps) expect(x.chainId).to.equal(31337);
  });

  it("sends each ready step from its signer, round after round, until every step is done", async function () {
    const sent: string[] = [];
    let p = await plan();
    const firstWrite = writeSigningPlan(p, DIR);
    expect(fs.existsSync(firstWrite.planFile)).to.equal(true);
    // A real plan for the page's browser check (tools/signing-page/page.check.cjs PLAN=<file>).
    if (process.env.SIGNING_PLAN_SAMPLE) fs.copyFileSync(firstWrite.planFile, process.env.SIGNING_PLAN_SAMPLE);
    // The vault acceptance is ready to schedule: its Transaction Builder batch is written.
    expect(firstWrite.batches.map((b) => path.basename(b))).to.deep.equal(["signing-I3-vault-schedule.json", "signing-SL-deployer-1-schedule.json", "signing-SL-deployer-2-schedule.json"]);
    const batch = JSON.parse(fs.readFileSync(firstWrite.batches[0], "utf8"));
    expect(batch.chainId).to.equal("31337");
    expect(batch.transactions).to.deep.equal([{ to: step(p, "I3-vault-schedule").to, value: "0", data: step(p, "I3-vault-schedule").data }]);
    const written: SigningPlan = JSON.parse(fs.readFileSync(firstWrite.planFile, "utf8"));
    expect(written.stepsSha256).to.equal(createHash("sha256").update(JSON.stringify(written.steps)).digest("hex"));

    let advanced = false;
    let ownerAdded = false;
    for (let round = 0; round < 12; round++) {
      const ready = p.steps.filter((x) => x.status === "ready");
      if (!ready.length) {
        if (!ownerAdded) {
          // The Safe app runs addOwnerWithThreshold; the MockSafe cannot, so its state is written.
          await safeAddsOwner(s.newOwner.address, 2);
          ownerAdded = true;
        } else if (!advanced) {
          // Both 7-day waits are still running; then they pass.
          expect(step(p, "E8x-earn-execute").status).to.equal("waiting");
          expect(step(p, "E8x-earn-execute").reason).to.contain("the Earn timelock's 7 days end at");
          expect(step(p, "E8x-earn-execute").reason).to.contain("the Collateral Agent's 7 days");
          expect(step(p, "I3x-vault-execute").reason).to.contain("the vault timelock's 7 days end at");
          expect(step(p, "ASx-assurance-execute").reason).to.contain("the Assurance timelock's 7 days end at");
          await ethers.provider.send("evm_increaseTime", [7 * DAY + 60]);
          await ethers.provider.send("evm_mine", []);
          advanced = true;
        } else break;
      }
      for (const st of ready) {
        await send(st);
        sent.push(st.id);
      }
      const before = p;
      p = await plan();
      // Whatever was sent is now done, and nothing done went back.
      for (const id of ready.map((x) => x.id)) expect(step(p, id).status, id).to.equal("done");
      for (const x of before.steps.filter((y) => y.status === "done")) expect(step(p, x.id).status, x.id).to.equal("done");
    }

    expect(sent).to.include.members(["C1d-1", "C1d-2", "E8-vault-confirm", "E8-vault-approve", "F2-fee-approve", "E8-earn-schedule", "E8x-earn-execute", "I3x-vault-execute"]);
    // Dependents became ready only after what they wait for: confirms after proposals, F2 after its grant.
    expect(sent.indexOf("E8-vault-confirm")).to.be.greaterThan(sent.indexOf("E8-vault-propose"));
    expect(sent.indexOf("F2-fee-approve")).to.be.greaterThan(sent.indexOf("D4-settings-2"));
    expect(sent.indexOf("RT-card-account")).to.be.greaterThan(sent.indexOf("D4-settings-1"));
    expect(sent).to.not.include("RT-fee-propose"); // F2 set FEE_RECIPIENT itself
    expect(sent.indexOf("E8-earn-schedule")).to.be.greaterThan(sent.indexOf("E8-backstop-approve"));
    expect(sent.indexOf("AS-payer-clfees-approve-2")).to.be.greaterThan(sent.indexOf("AS-payer-clfees-approve-1"));
    expect(sent.indexOf("AS-assurance-schedule")).to.be.greaterThan(sent.indexOf("AS-exposure-approve-2"));
    expect(sent.indexOf("ASx-assurance-execute")).to.be.greaterThan(sent.indexOf("AS-assurance-schedule"));
    // The lane's upgrade was scheduled only after the E8 batch ran; its own 7 days are still running.
    expect(sent.indexOf("SL-upgrade-schedule")).to.be.greaterThan(sent.indexOf("E8x-earn-execute"));
    expect(step(p, "SLx-upgrade-execute").reason).to.contain("the Earn timelock's 7 days end at");
    expect(p.steps.filter((x) => x.status !== "done").map((x) => x.id)).to.deep.equal(["D4-operator", ...PT_STEPS, ...SL_LEFT]);
    // The deployment signers' grants ran through the Earn timelock, without waiting for E8x.
    for (const id of SL_GRANTS) expect(sent, id).to.include(id);
    expect(sent.indexOf("SLx-deployer-1-execute")).to.be.greaterThan(sent.indexOf("SL-deployer-1-schedule"));
    for (const d of deploymentSigners) expect(await pool.hasRole(ethers.id("DEPLOYER_ROLE"), d), d).to.equal(true);
    expect(step(p, "SL-deployer-1-schedule").reason).to.equal("Deployment signer 1 holds the pool's DEPLOYER_ROLE.");

    // The chain shows each change made.
    expect(await agent.vault()).to.equal(await bondVault.getAddress());
    expect(await agent.bondBook()).to.equal(await bondVault.getAddress());
    expect(await agent.holderDirections()).to.equal(await holderDirections.getAddress());
    expect(await agent.pledgeModule()).to.equal(await liquidator.getAddress());
    expect(await bondVault.payoutPool()).to.equal(ethers.ZeroAddress);
    expect(await bondVault.treasury()).to.equal(s.treasury.address);
    expect(await term.feeRecipient()).to.equal(s.feeTo.address);
    expect(await revolving.cardSettlementAccount()).to.equal(clOperating);
    expect((await pool.poolTierPrincipal())[0]).to.equal(100000000000n);
    expect(await clrusd.defaultAdmin()).to.equal(await vaultTimelock.getAddress());
    expect(await vault.hasRole(ethers.id("RELAYER_ROLE"), s.relayer.address)).to.equal(true);
    expect(await vault.hasRole(ethers.id("OPERATOR_ROLE"), s.relayer.address)).to.equal(false);
    expect(await liquidator.hasRole(await liquidator.HOLD_ROLE(), s.h2.address)).to.equal(true);
    // The month's floor inputs: two signers, no timelock; the coverage cap is what draws are held to.
    expect(await assurancePool.coverageCap()).to.equal(10000000000n);
    expect(await assurancePool.floorEvidenceHash()).to.equal(ethers.id("Assurance Pool floor inputs (test)"));
    // The Assurance Pool, configured through its own governance.
    expect(await assurancePool.payerTags(clFees)).to.equal(BigInt(CL_FEES_MASK));
    expect(CL_FEES_MASK).to.equal(0b0011); // CREDIT_ENHANCEMENT_FEE | RECOVERY (Lending Co.)
    expect(await assurancePool.payerTags(await safe.getAddress())).to.equal(BigInt(BOARD_ALLOCATION_MASK));
    expect(BOARD_ALLOCATION_MASK).to.equal(0b1100); // INTERCHANGE | BOARD_ALLOCATION (the co-op treasury)
    expect(await assurancePool.drawAddress()).to.equal(ethers.getAddress(clOperating));
    expect(await assurancePool.lossReserveAddress()).to.equal(ethers.getAddress(clLossReserve));
    expect(await assurancePool.assuranceDisbursementAddress()).to.equal(ethers.getAddress(disbursement));
    expect(await assurancePool.exposureSourceList()).to.deep.equal([await collateralRegistry.getAddress()]);
    // The approvals were spent by the calls they approved.
    for (const fn of [["setPayer", [clFees, 7]], ["setLendingCoAddresses", [clOperating, clLossReserve]]] as [string, any[]][]) {
      expect(await assurancePool.approvedAction(ethers.keccak256(assurancePool.interface.encodeFunctionData(fn[0], fn[1])))).to.equal(false);
    }

    // scripts/check_sepolia_wiring.ts reads the same: every Assurance line passes; an empty input is a FAIL.
    const keys = ["ASSURANCE_SIGNERS", "ASSURANCE_CL_FEES_PAYER", "COOP_TREASURY", "ASSURANCE_DRAW_ADDRESS", "ASSURANCE_LOSS_RESERVE", "ASSURANCE_DISBURSEMENT"];
    const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      for (const k of keys) process.env[k] = env[k];
      const wiring = await checkSepoliaWiring({ network: "hardhat", log: () => undefined });
      const lines = wiring.results.filter((r) => r.what.startsWith("AssurancePool"));
      expect(lines.length).to.equal(9);
      expect(lines.filter((r) => r.status !== "PASS")).to.deep.equal([]);
      process.env.ASSURANCE_DISBURSEMENT = "";
      const empty = await checkSepoliaWiring({ network: "hardhat", log: () => undefined });
      expect(empty.failures.map((r) => r.what)).to.include("ASSURANCE_DISBURSEMENT is empty (owner to fill): the Assurance Pool's setup cannot be checked");
    } finally {
      for (const k of keys) if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k];
    }

    // The credit operator, once the owner gives its address.
    env.CREDIT_OPERATOR_ADDRESS = s.opKey.address;
    p = await plan();
    expect(step(p, "D4-operator").status).to.equal("ready");
    await send(step(p, "D4-operator"));
    p = await plan();
    // Everything but the payout top-ups and the settlement lane, which wait for their inputs (the last tests walk them).
    expect(p.steps.filter((x) => x.status !== "done").map((x) => x.id)).to.deep.equal([...PT_STEPS, ...SL_LEFT]);
    // Nothing left for a Safe to sign: no batch is written.
    expect(writeSigningPlan(p, DIR).batches).to.deep.equal([]);
    expect(fs.readdirSync(path.join(DIR, "safe-batches")).filter((f) => f.startsWith("signing-"))).to.deep.equal([]);
  });

  it("refuses Assurance inputs that are empty, or that the pool would refuse", async function () {
    const refused = (over: Record<string, string>) => failure(buildSigningPlan({ network: "hardhat", env: { ...env, ...over }, valuationSigners, deploymentSigners }));
    // Empty: no silent fallback to another address.
    expect(await refused({ ASSURANCE_CL_FEES_PAYER: "" })).to.contain("Refusing: ASSURANCE_CL_FEES_PAYER is empty");
    expect(await refused({ ASSURANCE_DISBURSEMENT: "", ASSURANCE_LOSS_RESERVE: "" })).to.contain("ASSURANCE_LOSS_RESERVE, ASSURANCE_DISBURSEMENT are empty");
    expect(await refused({ ASSURANCE_SIGNERS: a3 })).to.contain("ASSURANCE_SIGNERS must list");
    // setPayer: a payer may be neither a signer nor the draw address.
    expect(await refused({ ASSURANCE_CL_FEES_PAYER: a3 })).to.match(/ASSURANCE_CL_FEES_PAYER 0x[0-9a-fA-F]{40} is one of the pool's signers/);
    expect(await refused({ ASSURANCE_CL_FEES_PAYER: clOperating })).to.contain("a payer may not be the draw address");
    expect(await refused({ COOP_TREASURY: clOperating })).to.contain("COOP_TREASURY");
    // setLendingCoAddresses: neither the draw address nor the loss reserve may be a signer.
    expect(await refused({ ASSURANCE_DRAW_ADDRESS: a4 })).to.contain("ASSURANCE_DRAW_ADDRESS");
    expect(await refused({ ASSURANCE_LOSS_RESERVE: a4 })).to.contain("ASSURANCE_LOSS_RESERVE");
    // The owner's rule: five different addresses. And a payer on a money path (NetworkRegistry).
    expect(await refused({ ASSURANCE_LOSS_RESERVE: clOperating })).to.contain("must all differ");
    expect(await refused({ ASSURANCE_CL_FEES_PAYER: await term.getAddress() })).to.contain("AssurancePoolMoneyPath");
    // A signer list that is not the pool's.
    expect(await refused({ ASSURANCE_SIGNERS: `${a3},${random()}` })).to.contain("not one of the AssurancePool's signers");
    expect(await refused({ ASSURANCE_EXPOSURE_SOURCES: random() })).to.contain("has no code");
  });

  it("RT: moves an already-set fee recipient to Clear Lending by two different signers", async function () {
    // F2 named feeTo; FEE_RECIPIENT now names CL Operating, as on Base Sepolia (the Clear Treasury Safe was carried over).
    const moved = { ...env, FEE_RECIPIENT: clOperating };
    const at = () => buildSigningPlan({ network: "hardhat", env: moved, valuationSigners, deploymentSigners });
    let p = await at();
    expect(step(p, "F2-fee-approve").status).to.equal("done");
    expect(step(p, "RT-fee-propose").status).to.equal("ready");
    expect(step(p, "RT-fee-propose").signer).to.equal(s.cs1.address);
    expect(step(p, "RT-fee-propose").args[0].value).to.equal(clOperating);
    expect(step(p, "RT-fee-approve").status).to.equal("waiting");
    await send(step(p, "RT-fee-propose"));
    p = await at();
    expect(step(p, "RT-fee-propose").status).to.equal("done");
    expect(step(p, "RT-fee-approve").status).to.equal("ready");
    expect(step(p, "RT-fee-approve").signer).to.equal(s.cs2.address); // not the proposer
    expect(await term.feeRecipient()).to.equal(s.feeTo.address); // nothing moves until the second signer approves
    await send(step(p, "RT-fee-approve"));
    expect(await term.feeRecipient()).to.equal(clOperating);
    p = await at();
    for (const id of ["F2-fee-approve", "RT-fee-propose", "RT-fee-approve", "RT-card-account"]) expect(step(p, id).status, id).to.equal("done");
    // Put feeTo back for the tests that follow.
    await term.connect(s.cs1).proposeFeeRecipient(s.feeTo.address, ethers.encodeBytes32String("RESET"));
    await term.connect(s.cs2).approveFeeRecipient(s.feeTo.address, ethers.encodeBytes32String("RESET"));
  });

  it("follows the inputs: a new signer in a slot becomes the step's signer", async function () {
    const other = random();
    const p = await buildSigningPlan({ network: "hardhat", env: { ...env, HOLD_SIGNERS: `${s.h1.address},${other}` }, valuationSigners, deploymentSigners });
    expect(step(p, "E8-hold-2").signer).to.equal(s.deployer.address);
    expect(step(p, "E8-hold-2").args[1].value).to.equal(other);
    expect(step(p, "E8-hold-2").status).to.equal("ready");
  });

  it("refuses a record with no code, and a network that is not the chain it names", async function () {
    const real = JSON.parse(fs.readFileSync(path.join(DIR, "CollateralAgent.json"), "utf8"));
    record("CollateralAgent", random());
    try {
      expect(await failure(plan())).to.match(/Refusing: the CollateralAgent record 0x[0-9a-fA-F]{40} has no code/);
    } finally {
      fs.writeFileSync(path.join(DIR, "CollateralAgent.json"), JSON.stringify(real));
    }
    expect(await failure(buildSigningPlan({ network: "base-sepolia", recordsDir: DIR, env, valuationSigners, deploymentSigners })))
      .to.contain("Refusing: base-sepolia must be chain 84532, and this node answers as chain 31337");
    expect(await failure(buildSigningPlan({ network: "base-sepolia-fork", recordsDir: DIR, env, valuationSigners, deploymentSigners }))).to.contain("must be chain 84532");
  });

  /*
   * Payout top-ups (decision 51) on the real code: Safe's AllowanceModule v0.1.1 and a Safe v1.5.0 (singleton and
   * proxy), their runtime bytecode read from Base Sepolia (test/deploy/fixtures), not a mock. CL Operating is a real
   * Safe proxy, set up with the Clear Lending Safe as its only owner, as on Base Sepolia.
   */
  it("payout top-ups: waits on empty inputs, then the setup and one top-up run on the real AllowanceModule and Safe", async function () {
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "safe-allowance-module.base-sepolia.json"), "utf8")).contracts;
    const setCode = (at: string, code: string) => ethers.provider.send("hardhat_setCode", [at, code]);
    await setCode(CANONICAL_ALLOWANCE_MODULE, fx.AllowanceModule.code);
    const singleton = fx.SafeSingleton.address;
    await setCode(singleton, fx.SafeSingleton.code);
    const clOp = ethers.Wallet.createRandom().address;
    await setCode(clOp, fx.SafeProxy.code);
    await ethers.provider.send("hardhat_setStorageAt", [clOp, "0x0", ethers.zeroPadValue(singleton, 32)]);
    const owner = await lendingSafe.getAddress();
    const safe = new ethers.Contract(clOp, [...SAFE_MODULE_ABI, "function setup(address[],uint256,address,bytes,address,address,uint256,address)"], s.deployer);
    await (await safe.setup([owner], 1, ethers.ZeroAddress, "0x", ethers.ZeroAddress, ethers.ZeroAddress, 0, ethers.ZeroAddress)).wait();
    expect(await safe.VERSION()).to.equal("1.5.0");
    expect(await safe.getOwners()).to.deep.equal([owner]);
    const module = new ethers.Contract(CANONICAL_ALLOWANCE_MODULE, ALLOWANCE_MODULE_ABI, ethers.provider);
    expect([await module.NAME(), await module.VERSION()]).to.deep.equal(["Allowance Module", "0.1.1"]);

    // Deploy 22's fresh PayoutPool, the deployer its admin.
    const payoutPool = await upgrades.deployProxy(await ethers.getContractFactory("PayoutPool"),
      [s.deployer.address, random(), await usdcToken.getAddress(), random(), s.treasury.address], { initializer: "initialize", kind: "uups" });
    record("PayoutPool", await payoutPool.getAddress());
    const wallet = ethers.Wallet.createRandom().address;
    const base = { ...env, CLEAR_LENDING_ACCOUNT: clOp };

    // No top-up inputs yet: the steps wait, the plan is not refused, and CL Operating may already enable the module.
    let p = await buildSigningPlan({ network: "hardhat", env: base, valuationSigners, deploymentSigners });
    expect(step(p, "TU-funder").reason).to.contain("Waiting for input: PAYOUT_TOPUP_WALLET");
    expect(step(p, "TU-safe-delegate").status).to.equal("waiting");
    expect(step(p, "TU-safe-allowance").reason).to.contain("PAYOUT_TOPUP_WALLET");
    expect(step(p, "TU-safe-module").status).to.equal("ready");
    // And the preflight only warns.
    const pre = await checkPayoutTopUpSetup(base, ethers.provider, { payoutPool: await payoutPool.getAddress() });
    expect(pre.map((r) => r.status)).to.deep.equal(["WARN"]);

    const inputs = {
      ...base, PAYOUT_TOPUP_WALLET: wallet, PAYOUT_TOPUP_CAP_USDC: "5000", PAYOUT_TOPUP_RESET_MINUTES: "10080",
      PAYOUT_TOPUP_RESET_BASE_MINUTES: String(Math.floor((await ethers.provider.getBlock("latest"))!.timestamp / 60) - 60),
    };
    p = await buildSigningPlan({ network: "hardhat", env: inputs, valuationSigners, deploymentSigners });
    expect(PT_STEPS.map((id) => step(p, id).status)).to.deep.equal(["ready", "ready", "ready", "waiting"]);
    expect(step(p, "TU-safe-allowance").reason).to.equal("Waits for TU-safe-delegate first.");
    expect(step(p, "TU-funder").stage).to.equal("Payout top-ups");
    expect(step(p, "TU-funder").title).to.contain("before I2");
    expect(step(p, "TU-funder").signer).to.equal(s.deployer.address);
    expect(step(p, "TU-funder").data).to.equal(payoutPool.interface.encodeFunctionData("grantRole", [ethers.id("FUNDER_ROLE"), wallet]));
    for (const id of ["TU-safe-module", "TU-safe-delegate", "TU-safe-allowance"]) {
      expect(step(p, id).kind).to.equal("safe");
      expect(step(p, id).signer).to.equal(clOp);
    }
    expect(step(p, "TU-safe-module").to).to.equal(clOp);
    expect(step(p, "TU-safe-allowance").data).to.equal(module.interface.encodeFunctionData("setAllowance",
      [wallet, await usdcToken.getAddress(), 5000n * 10n ** 6n, 10080, Number(inputs.PAYOUT_TOPUP_RESET_BASE_MINUTES)]));
    expect(step(p, "TU-safe-allowance").title).to.contain("$5,000.00 of USDC every 7 days");

    // The one batch CL Operating's owner signs: all three calls, in order.
    const w = writeSigningPlan(p, DIR);
    const combined = w.batches.find((b) => b.endsWith("signing-TU-cl-operating-setup.json"))!;
    const batch = JSON.parse(fs.readFileSync(combined, "utf8"));
    expect(batch.transactions.map((t: any) => t.to)).to.deep.equal([clOp, CANONICAL_ALLOWANCE_MODULE, CANONICAL_ALLOWANCE_MODULE]);
    expect(batch.transactions.map((t: any) => t.data)).to.deep.equal(["TU-safe-module", "TU-safe-delegate", "TU-safe-allowance"].map((id) => step(p, id).data));
    expect(p.notes.join("\n")).to.contain("signing-TU-cl-operating-setup.json");

    // The credit handover (I2) before the grant: the deployer no longer can, and the step says how it goes now.
    const creditTimelock = ethers.Wallet.createRandom().address;
    await (await payoutPool.grantRole(ethers.ZeroHash, creditTimelock)).wait();
    await (await payoutPool.renounceRole(ethers.ZeroHash, s.deployer.address)).wait();
    p = await buildSigningPlan({ network: "hardhat", env: inputs, valuationSigners, deploymentSigners });
    expect(step(p, "TU-funder").reason).to.contain("credit handover, I2");
    // Undo it for the rest of this test (the timelock gives the admin back).
    await ethers.provider.send("hardhat_impersonateAccount", [creditTimelock]);
    await ethers.provider.send("hardhat_setBalance", [creditTimelock, "0x" + ethers.parseEther("1").toString(16)]);
    await (await payoutPool.connect(await ethers.getSigner(creditTimelock)).grantRole(ethers.ZeroHash, s.deployer.address)).wait();
    p = await buildSigningPlan({ network: "hardhat", env: inputs, valuationSigners, deploymentSigners });

    // The deployer grants FUNDER_ROLE; CL Operating sends the batch's calls in order (as its Safe transaction would).
    await send(step(p, "TU-funder"));
    for (const t of batch.transactions) await send({ ...step(p, "TU-safe-module"), to: t.to, data: t.data });
    p = await buildSigningPlan({ network: "hardhat", env: inputs, valuationSigners, deploymentSigners });
    for (const id of PT_STEPS) expect(step(p, id).status, id).to.equal("done");
    expect(step(p, "TU-safe-allowance").reason).to.contain("$5,000.00 every 7 days");
    // Everything but the settlement lane (the next test).
    expect(p.steps.filter((x) => x.status !== "done").map((x) => x.id)).to.deep.equal(SL_LEFT);
    expect(writeSigningPlan(p, DIR).batches).to.deep.equal([]);

    // The preflight: every line passes; a wallet with another PayoutPool role fails.
    const ok = await checkPayoutTopUpSetup(inputs, ethers.provider, { payoutPool: await payoutPool.getAddress() });
    expect(ok.filter((r) => r.status !== "PASS")).to.deep.equal([]);
    expect(ok.length).to.be.greaterThan(4);
    const all = await checkRolloutInputs(inputs, ethers.provider, { payoutPool: await payoutPool.getAddress() });
    expect(all.map((r) => r.what)).to.include.members(ok.map((r) => r.what));

    // A top-up, exactly as the job sends it: the delegate pulls with an empty signature, approves, funds.
    const usdc = new ethers.Contract(await usdcToken.getAddress(), ERC20_ABI, ethers.provider);
    await (await usdcToken.mint(clOp, 20_000n * 10n ** 6n)).wait();
    const addresses = { payoutPool: await payoutPool.getAddress(), safe: clOp, module: CANONICAL_ALLOWANCE_MODULE, usdc: await usdc.getAddress(), wallet };
    const ifaces: Record<string, ethers.Interface> = { executeAllowanceTransfer: module.interface, approve: usdc.interface, fund: new ethers.Interface(PAYOUT_POOL_TOPUP_ABI) };
    await ethers.provider.send("hardhat_impersonateAccount", [wallet]);
    await ethers.provider.send("hardhat_setBalance", [wallet, "0x" + ethers.parseEther("1").toString(16)]);
    const bot = await ethers.getSigner(wallet);
    const amount = 1_300n * 10n ** 6n;
    const nonceBefore = Number((await module.getTokenAllowance(clOp, wallet, addresses.usdc))[4]);
    for (const c of topUpCalls(addresses, amount)) {
      const tx = { to: c.to, data: ifaces[c.fn].encodeFunctionData(c.fn, c.args) };
      assertTopUpCall(addresses, tx, amount);
      await ethers.provider.call({ from: wallet, ...tx }); // the job's dry run
      const rc = await (await bot.sendTransaction(tx)).wait();
      expect(rc!.status).to.equal(1);
    }
    expect(await usdc.balanceOf(clOp)).to.equal(20_000n * 10n ** 6n - amount);
    expect(await usdc.balanceOf(wallet)).to.equal(0n);
    expect(await usdc.allowance(wallet, addresses.payoutPool)).to.equal(0n);
    expect(await payoutPool.held()).to.equal(amount);
    expect(await payoutPool.capitalOf(wallet)).to.equal(amount);
    const al = await module.getTokenAllowance(clOp, wallet, addresses.usdc);
    expect([al[0], al[1], al[2], Number(al[4])]).to.deep.equal([5000n * 10n ** 6n, amount, 10080n, nonceBefore + 1]);

    // The cap holds: past what is left this period the module refuses, whoever asks.
    const over = ifaces.executeAllowanceTransfer.encodeFunctionData("executeAllowanceTransfer", [clOp, addresses.usdc, wallet, 5000n * 10n ** 6n - amount + 1n, ethers.ZeroAddress, 0, wallet, "0x"]);
    expect(await failure(bot.sendTransaction({ to: CANONICAL_ALLOWANCE_MODULE, data: over }))).to.contain("newSpent <= allowance.amount");
    // Only the delegate itself: another account sending the same call with an empty signature is refused.
    const left = ifaces.executeAllowanceTransfer.encodeFunctionData("executeAllowanceTransfer", [clOp, addresses.usdc, wallet, 1n, ethers.ZeroAddress, 0, wallet, "0x"]);
    expect(await failure(s.o1.sendTransaction({ to: CANONICAL_ALLOWANCE_MODULE, data: left }))).to.contain("expectedDelegate == signer");
    // The period resets: a week on, the whole cap is there again.
    await ethers.provider.send("evm_increaseTime", [7 * DAY + 60]);
    await ethers.provider.send("evm_mine", []);
    expect((await module.getTokenAllowance(clOp, wallet, addresses.usdc))[1]).to.equal(0n);

    // A wallet holding any other PayoutPool role fails the preflight.
    await (await payoutPool.grantRole(ethers.id("OPERATOR_ROLE"), wallet)).wait();
    const bad = await checkPayoutTopUpSetup(inputs, ethers.provider, { payoutPool: await payoutPool.getAddress() });
    expect(bad.filter((r) => r.status === "FAIL").map((r) => r.what).join("\n")).to.contain("OPERATOR_ROLE");
    await (await payoutPool.revokeRole(ethers.id("OPERATOR_ROLE"), wallet)).wait();
  });
  /*
   * Settlement Funding (decision 54): the pool upgrade scheduled after E8x (the walk above), its 7 days, then the
   * lane's two-person settings from the rollout inputs; a stop by one signer makes SL-funder a restart by two.
   */
  it("settlement funding: runs the pool upgrade, then the funder and headroom pairs, and a stop makes SL-funder a restart", async function () {
    const [d1, d2] = deploymentSigners;
    const funder = random();
    const lane = { ...env, SETTLEMENT_CAP_USDC: "5000", SETTLEMENT_PERIOD_DAYS: "7", SETTLEMENT_HEADROOM_USDC: "1000" };
    const planWith = (e: Record<string, string>) => buildSigningPlan({ network: "hardhat", env: e, valuationSigners, deploymentSigners });

    let p = await planWith(lane);
    expect(step(p, "SL-upgrade-schedule").status).to.equal("done");
    expect(step(p, "SL-headroom-1").reason).to.contain("SLx-upgrade-execute");
    // The payout test above already moved the clock a week on: the timelock's 7 days may be over.
    if (step(p, "SLx-upgrade-execute").status !== "ready") {
      await ethers.provider.send("evm_increaseTime", [7 * DAY + 60]);
      await ethers.provider.send("evm_mine", []);
      p = await planWith(lane);
    }
    expect(step(p, "SLx-upgrade-execute").status).to.equal("ready");
    await send(step(p, "SLx-upgrade-execute"));
    expect(await upgrades.erc1967.getImplementationAddress(await pool.getAddress())).to.equal(laneImpl);

    // No funder yet: SL-funder waits for its input. The walk's timelock grants gave both signers DEPLOYER_ROLE.
    p = await planWith(lane);
    expect(step(p, "SLx-upgrade-execute").status).to.equal("done");
    expect(step(p, "SL-funder-1").reason).to.contain("Waiting for input: SETTLEMENT_FUNDER");
    for (const id of SL_GRANTS) expect(step(p, id).status, id).to.equal("done");
    expect(step(p, "SL-headroom-2").dependsOn).to.deep.equal(["SLx-upgrade-execute", "SLx-deployer-2-execute"]);
    // A listed signer without the role: its grant is a new proposal, and its half of each pair waits for it.
    const newcomer = random();
    const other = await buildSigningPlan({ network: "hardhat", env: lane, valuationSigners, deploymentSigners: [d1, newcomer] });
    expect(step(other, "SL-deployer-1-schedule").status).to.equal("done");
    expect(step(other, "SL-deployer-2-schedule").status).to.equal("ready");
    expect(step(other, "SL-deployer-2-schedule").args[2].value).to.equal(pool.interface.encodeFunctionData("grantRole", [ethers.id("DEPLOYER_ROLE"), newcomer]));
    expect(step(other, "SLx-deployer-2-execute").reason).to.contain("Waits for SL-deployer-2-schedule");
    expect(step(other, "SL-headroom-2").reason).to.contain("SL-deployer-2-schedule, then SLx-deployer-2-execute");
    expect(other.notes.join("\n")).to.contain(`Deployment signer 2 ${newcomer}`);

    const inputs = { ...lane, SETTLEMENT_FUNDER: funder };
    p = await planWith(inputs);
    expect(["SL-funder-1", "SL-funder-2", "SL-headroom-1", "SL-headroom-2"].map((id) => step(p, id).status)).to.deep.equal(["ready", "ready", "ready", "ready"]);
    expect(step(p, "SL-funder-1").signer).to.equal(d1);
    expect(step(p, "SL-funder-2").signer).to.equal(d2);
    expect(step(p, "SL-funder-1").data).to.equal(pool.interface.encodeFunctionData("setSettlementFunder", [funder, 5000n * 10n ** 6n, 7 * DAY]));
    expect(step(p, "SL-headroom-1").data).to.equal(pool.interface.encodeFunctionData("setSettlementHeadroom", [1000n * 10n ** 6n]));
    expect(step(p, "SL-funder-1").title).to.contain("$5,000.00 per 7 days");
    await send(step(p, "SL-funder-1"));
    await send(step(p, "SL-headroom-2"));
    p = await planWith(inputs);
    // The first signature is recorded on chain; the step is done and the pair's other half is what is left.
    expect(step(p, "SL-funder-1").status).to.equal("done");
    expect(step(p, "SL-funder-1").reason).to.contain("waits for the other deployment signer");
    expect(step(p, "SL-headroom-2").status).to.equal("done");
    expect(step(p, "SL-funder-2").status).to.equal("ready");
    expect(step(p, "SL-headroom-1").status).to.equal("ready");
    await send(step(p, "SL-funder-2"));
    await send(step(p, "SL-headroom-1"));
    p = await planWith(inputs);
    for (const id of ["SL-funder-1", "SL-funder-2", "SL-headroom-1", "SL-headroom-2"]) expect(step(p, id).status, id).to.equal("done");
    expect(step(p, "SL-funder-1").reason).to.contain("may deploy up to $5,000.00 every 7 days");
    const l = await pool.settlementLane();
    expect([l.funder, l.capPerPeriod, l.periodSeconds, l.stopped, l.headroom]).to.deep.equal([funder, 5000n * 10n ** 6n, BigInt(7 * DAY), false, 1000n * 10n ** 6n]);

    // One deployer stops the lane: SL-funder is a restart, which takes both signers again.
    await ethers.provider.send("hardhat_impersonateAccount", [d1]);
    await (await pool.connect(await ethers.getSigner(d1)).stopSettlementFunder()).wait();
    p = await planWith(inputs);
    expect(step(p, "SL-funder-1").status).to.equal("ready");
    expect(step(p, "SL-funder-2").status).to.equal("ready");
    expect(p.notes.join("\n")).to.contain("Settlement Funding lane is STOPPED");
    await send(step(p, "SL-funder-2"));
    await send(step(p, "SL-funder-1"));
    expect((await pool.settlementLane()).stopped).to.equal(false);
    p = await planWith(inputs);
    expect(p.steps.filter((x) => x.id.startsWith("SL") && x.status !== "done").map((x) => x.id)).to.deep.equal(SL_FORWARDER);
  });
  /*
   * Settlement Funding (decision 54): deploy 28's SettlementForwarder on the real AllowanceModule and a real Safe v1.5.0
   * as CL Operating (the fixtures the payout test loaded), CL Operating's four calls as one batch, the preflight, and a
   * forward by the desk wallet.
   */
  it("settlement funding: the forwarder's CL Operating batch, the preflight, and a forward to the off-ramp", async function () {
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "safe-allowance-module.base-sepolia.json"), "utf8")).contracts;
    const clOp = ethers.Wallet.createRandom().address;
    await ethers.provider.send("hardhat_setCode", [clOp, fx.SafeProxy.code]);
    await ethers.provider.send("hardhat_setStorageAt", [clOp, "0x0", ethers.zeroPadValue(fx.SafeSingleton.address, 32)]);
    const safeOp = new ethers.Contract(clOp, [...SAFE_MODULE_ABI, "function setup(address[],uint256,address,bytes,address,address,uint256,address)"], s.deployer);
    await (await safeOp.setup([await lendingSafe.getAddress()], 1, ethers.ZeroAddress, "0x", ethers.ZeroAddress, ethers.ZeroAddress, 0, ethers.ZeroAddress)).wait();
    const module = new ethers.Contract(CANONICAL_ALLOWANCE_MODULE, ALLOWANCE_MODULE_ABI, ethers.provider);
    const usdc = await usdcToken.getAddress();
    const funder = ethers.Wallet.createRandom().address;
    const offRamp = ethers.Wallet.createRandom().address;
    const inputs = {
      ...env, CLEAR_LENDING_ACCOUNT: clOp, RESERVE_TOKEN: usdc, SETTLEMENT_FUNDER: funder, SETTLEMENT_CAP_USDC: "5000", SETTLEMENT_PERIOD_DAYS: "7",
      SETTLEMENT_HEADROOM_USDC: "1000", SETTLEMENT_OFFRAMP_ADDRESS: offRamp,
    };
    const planWith = (e: Record<string, string>) => buildSigningPlan({ network: "hardhat", env: e, valuationSigners, deploymentSigners });

    // Deploy 28: the deployer sets nothing on it.
    const forwarder = await deploySettlementForwarder({ safe: clOp, allowanceModule: CANONICAL_ALLOWANCE_MODULE, token: usdc, network: "hardhat", log: () => undefined });
    const f = await forwarder.getAddress();
    expect([await forwarder.offRamp(), await forwarder.desk()]).to.deep.equal([ethers.ZeroAddress, ethers.ZeroAddress]);
    // Run again, it reuses the record.
    expect(await (await deploySettlementForwarder({ safe: clOp, allowanceModule: CANONICAL_ALLOWANCE_MODULE, token: usdc, network: "hardhat", log: () => undefined })).getAddress()).to.equal(f);

    // The module is not enabled on this CL Operating yet: the batch waits for the top-ups' enableModule.
    let p = await planWith(inputs);
    for (const id of SL_FORWARDER) expect(step(p, id).reason, id).to.contain("TU-safe-module");
    let pre = await checkSettlementForwarderSetup(inputs, ethers.provider, { settlementForwarder: f });
    expect(pre.filter((r) => r.status === "FAIL")).to.deep.equal([]);
    await send({ ...step(p, "SL-cl-operating-delegate"), to: clOp, data: safeOp.interface.encodeFunctionData("enableModule", [CANONICAL_ALLOWANCE_MODULE]) });

    p = await planWith(inputs);
    expect(SL_FORWARDER.map((id) => step(p, id).status)).to.deep.equal(["ready", "waiting", "ready", "ready"]);
    expect(step(p, "SL-cl-operating-allowance").reason).to.equal("Waits for SL-cl-operating-delegate first.");
    for (const id of SL_FORWARDER) expect(step(p, id).signer, id).to.equal(clOp);
    expect(step(p, "SL-cl-operating-delegate").data).to.equal(module.interface.encodeFunctionData("addDelegate", [f]));
    expect(step(p, "SL-cl-operating-allowance").data).to.equal(module.interface.encodeFunctionData("setAllowance", [f, usdc, 5000n * 10n ** 6n, 7 * 1440, 0]));
    expect(step(p, "SL-cl-operating-offramp").data).to.equal(forwarder.interface.encodeFunctionData("setOffRamp", [offRamp]));
    expect(step(p, "SL-cl-operating-desk").data).to.equal(forwarder.interface.encodeFunctionData("setDesk", [funder]));
    const w = writeSigningPlan(p, DIR);
    const file = w.batches.find((b) => b.endsWith("signing-SL-cl-operating.json"))!;
    const batch = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(batch.transactions.map((t: any) => t.to)).to.deep.equal([CANONICAL_ALLOWANCE_MODULE, CANONICAL_ALLOWANCE_MODULE, f, f]);
    expect(batch.transactions.map((t: any) => t.data)).to.deep.equal(SL_FORWARDER.map((id) => step(p, id).data));
    // Before the batch, the preflight warns; nothing is wrong yet.
    pre = await checkSettlementForwarderSetup(inputs, ethers.provider, { settlementForwarder: f });
    expect(pre.filter((r) => r.status === "FAIL")).to.deep.equal([]);
    expect(pre.filter((r) => r.status === "WARN").map((r) => r.what).join("\n")).to.contain("SL-cl-operating-delegate");

    // CL Operating sends the batch's calls in order, as its Safe transaction would.
    for (const t of batch.transactions) await send({ ...step(p, "SL-cl-operating-delegate"), to: t.to, data: t.data });
    p = await planWith(inputs);
    for (const id of SL_FORWARDER) expect(step(p, id).status, id).to.equal("done");
    expect(step(p, "SL-cl-operating-allowance").reason).to.contain("$5,000.00 every 7 days");
    const ok = await checkSettlementForwarderSetup(inputs, ethers.provider, { settlementForwarder: f });
    expect(ok.filter((r) => r.status !== "PASS")).to.deep.equal([]);
    expect(ok.length).to.be.greaterThan(8);

    // A forward by the desk wallet: CL Operating's USDC goes to the off-ramp only.
    await (await usdcToken.mint(clOp, 2_000n * 10n ** 6n)).wait();
    await ethers.provider.send("hardhat_impersonateAccount", [funder]);
    await ethers.provider.send("hardhat_setBalance", [funder, "0x" + ethers.parseEther("1").toString(16)]);
    await (await forwarder.connect(await ethers.getSigner(funder)).forward(1_500n * 10n ** 6n)).wait();
    expect(await usdcToken.balanceOf(offRamp)).to.equal(1_500n * 10n ** 6n);

    // An allowance above the lane's cap, a wrong off-ramp or desk: the preflight fails them.
    const bad = await checkSettlementForwarderSetup({ ...inputs, SETTLEMENT_CAP_USDC: "4000", SETTLEMENT_OFFRAMP_ADDRESS: random(), SETTLEMENT_FUNDER: s.deployer.address }, ethers.provider, { settlementForwarder: f });
    const fails = bad.filter((r) => r.status === "FAIL").map((r) => r.what).join("\n");
    expect(fails).to.contain("above the lane's cap");
    expect(fails).to.contain("SETTLEMENT_OFFRAMP_ADDRESS says");
    expect(fails).to.contain("no other job's wallet");
  });
});
