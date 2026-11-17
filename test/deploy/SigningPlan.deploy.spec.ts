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
  let holderDirections: any;
  let lendingSafe: any, assurancePool: any, assuranceTimelock: any, collateralRegistry: any;
  let usdcToken: any;
  const PT_STEPS = ["PT-funder", "PT-safe-module", "PT-safe-delegate", "PT-safe-allowance"];
  // The Assurance Pool's signers (Accounts 3 and 4 on Base Sepolia) and the addresses its setup names.
  const a3 = random(), a4 = random();
  const clFees = random(), disbursement = random(), clOperating = random(), clLossReserve = random();
  const retiredPayout = random();

  const record = (name: string, address: string) => fs.writeFileSync(path.join(DIR, `${name}.json`), JSON.stringify({ address, abi: [] }));
  const plan = () => buildSigningPlan({ network: "hardhat", env, valuationSigners });
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
    for (const n of ["AccessManager", "TermIssuer", "Liquidator", "PayoutPool", "CollateralRegistry"]) record(`${n}PreAudit`, random());
    record("PayoutPoolPreAudit", retiredPayout);
    process.env.CARRY_TREASURY = treasury.address;
    const core = await deployCreditCore({ quiet: true });
    term = core.term;
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
      "F2-fee-approve", "G1-tier-1", "G1-tier-2", "safe-owner", "I3-vault-schedule", "I3x-vault-execute",
      ...ASSURANCE_KEYS.flatMap((k) => [`AS-${k}-approve-1`, `AS-${k}-approve-2`]), "AS-assurance-schedule", "ASx-assurance-execute",
      "AS-floor-1", "AS-floor-2",
      ...PT_STEPS,
    ]);
    const ready = p.steps.filter((x) => x.status === "ready").map((x) => x.id);
    expect(ready).to.deep.equal([
      "C1d-1", "D4-settings-1", "D4-settings-2", "D4-attester-1", "D4-attester-2",
      "E8-vault-propose", "E8-bondbook-propose", "E8-holderdirections-propose", "E8-pledgemodule-propose", "E8-backstop-propose",
      "E8-hold-1", "E8-hold-2", "G1-tier-1", "G1-tier-2", "I3-vault-schedule",
      ...ASSURANCE_KEYS.map((k) => `AS-${k}-approve-1`), "AS-floor-1",
    ]);
    expect(step(p, "AS-floor-2").reason).to.contain("AS-floor-1");
    // Payout top-ups (decision 51) with no top-up inputs: their steps wait, and nothing is refused.
    expect(step(p, "PT-funder").reason).to.contain("Waiting for input: PAYOUT_TOPUP_WALLET");
    expect(step(p, "PT-safe-allowance").reason).to.contain("PAYOUT_TOPUP_WALLET");
    expect(step(p, "PT-safe-module").reason).to.contain("has no code");
    for (const id of PT_STEPS) expect(step(p, id).to, id).to.equal(ethers.ZeroAddress);
    expect(step(p, "C1d-2").reason).to.contain("C1d-1");
    expect(step(p, "D4-operator").reason).to.contain("CREDIT_OPERATOR_ADDRESS");
    expect(step(p, "D4-operator").data).to.equal(null);
    expect(step(p, "E8-vault-confirm").reason).to.contain("proposed");
    expect(step(p, "E8-vault-confirm").data).to.equal(null);
    expect(step(p, "F2-fee-approve").reason).to.contain("D4-settings-2");
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
    expect(firstWrite.batches.map((b) => path.basename(b))).to.deep.equal(["signing-I3-vault-schedule.json"]);
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
    expect(sent.indexOf("E8-earn-schedule")).to.be.greaterThan(sent.indexOf("E8-backstop-approve"));
    expect(sent.indexOf("AS-payer-clfees-approve-2")).to.be.greaterThan(sent.indexOf("AS-payer-clfees-approve-1"));
    expect(sent.indexOf("AS-assurance-schedule")).to.be.greaterThan(sent.indexOf("AS-exposure-approve-2"));
    expect(sent.indexOf("ASx-assurance-execute")).to.be.greaterThan(sent.indexOf("AS-assurance-schedule"));
    expect(p.steps.filter((x) => x.status !== "done").map((x) => x.id)).to.deep.equal(["D4-operator", ...PT_STEPS]);

    // The chain shows each change made.
    expect(await agent.vault()).to.equal(await bondVault.getAddress());
    expect(await agent.bondBook()).to.equal(await bondVault.getAddress());
    expect(await agent.holderDirections()).to.equal(await holderDirections.getAddress());
    expect(await agent.pledgeModule()).to.equal(await liquidator.getAddress());
    expect(await bondVault.payoutPool()).to.equal(ethers.ZeroAddress);
    expect(await bondVault.treasury()).to.equal(s.treasury.address);
    expect(await term.feeRecipient()).to.equal(s.feeTo.address);
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
    // Everything but the payout top-ups, which wait for their inputs (the last test walks them).
    expect(p.steps.filter((x) => x.status !== "done").map((x) => x.id)).to.deep.equal(PT_STEPS);
    // Nothing left for a Safe to sign: no batch is written.
    expect(writeSigningPlan(p, DIR).batches).to.deep.equal([]);
    expect(fs.readdirSync(path.join(DIR, "safe-batches")).filter((f) => f.startsWith("signing-"))).to.deep.equal([]);
  });

  it("refuses Assurance inputs that are empty, or that the pool would refuse", async function () {
    const refused = (over: Record<string, string>) => failure(buildSigningPlan({ network: "hardhat", env: { ...env, ...over }, valuationSigners }));
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

  it("follows the inputs: a new signer in a slot becomes the step's signer", async function () {
    const other = random();
    const p = await buildSigningPlan({ network: "hardhat", env: { ...env, HOLD_SIGNERS: `${s.h1.address},${other}` }, valuationSigners });
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
    expect(await failure(buildSigningPlan({ network: "base-sepolia", recordsDir: DIR, env, valuationSigners })))
      .to.contain("Refusing: base-sepolia must be chain 84532, and this node answers as chain 31337");
    expect(await failure(buildSigningPlan({ network: "base-sepolia-fork", recordsDir: DIR, env, valuationSigners }))).to.contain("must be chain 84532");
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
    let p = await buildSigningPlan({ network: "hardhat", env: base, valuationSigners });
    expect(step(p, "PT-funder").reason).to.contain("Waiting for input: PAYOUT_TOPUP_WALLET");
    expect(step(p, "PT-safe-delegate").status).to.equal("waiting");
    expect(step(p, "PT-safe-allowance").reason).to.contain("PAYOUT_TOPUP_WALLET");
    expect(step(p, "PT-safe-module").status).to.equal("ready");
    // And the preflight only warns.
    const pre = await checkPayoutTopUpSetup(base, ethers.provider, { payoutPool: await payoutPool.getAddress() });
    expect(pre.map((r) => r.status)).to.deep.equal(["WARN"]);

    const inputs = {
      ...base, PAYOUT_TOPUP_WALLET: wallet, PAYOUT_TOPUP_CAP_USDC: "5000", PAYOUT_TOPUP_RESET_MINUTES: "10080",
      PAYOUT_TOPUP_RESET_BASE_MINUTES: String(Math.floor((await ethers.provider.getBlock("latest"))!.timestamp / 60) - 60),
    };
    p = await buildSigningPlan({ network: "hardhat", env: inputs, valuationSigners });
    expect(PT_STEPS.map((id) => step(p, id).status)).to.deep.equal(["ready", "ready", "ready", "waiting"]);
    expect(step(p, "PT-safe-allowance").reason).to.equal("Waits for PT-safe-delegate first.");
    expect(step(p, "PT-funder").stage).to.equal("Payout top-ups (day 0, before I2)");
    expect(step(p, "PT-funder").signer).to.equal(s.deployer.address);
    expect(step(p, "PT-funder").data).to.equal(payoutPool.interface.encodeFunctionData("grantRole", [ethers.id("FUNDER_ROLE"), wallet]));
    for (const id of ["PT-safe-module", "PT-safe-delegate", "PT-safe-allowance"]) {
      expect(step(p, id).kind).to.equal("safe");
      expect(step(p, id).signer).to.equal(clOp);
    }
    expect(step(p, "PT-safe-module").to).to.equal(clOp);
    expect(step(p, "PT-safe-allowance").data).to.equal(module.interface.encodeFunctionData("setAllowance",
      [wallet, await usdcToken.getAddress(), 5000n * 10n ** 6n, 10080, Number(inputs.PAYOUT_TOPUP_RESET_BASE_MINUTES)]));
    expect(step(p, "PT-safe-allowance").title).to.contain("$5,000.00 of USDC every 7 days");

    // The one batch CL Operating's owner signs: all three calls, in order.
    const w = writeSigningPlan(p, DIR);
    const combined = w.batches.find((b) => b.endsWith("signing-PT-cl-operating-setup.json"))!;
    const batch = JSON.parse(fs.readFileSync(combined, "utf8"));
    expect(batch.transactions.map((t: any) => t.to)).to.deep.equal([clOp, CANONICAL_ALLOWANCE_MODULE, CANONICAL_ALLOWANCE_MODULE]);
    expect(batch.transactions.map((t: any) => t.data)).to.deep.equal(["PT-safe-module", "PT-safe-delegate", "PT-safe-allowance"].map((id) => step(p, id).data));
    expect(p.notes.join("\n")).to.contain("signing-PT-cl-operating-setup.json");

    // The credit handover (I2) before the grant: the deployer no longer can, and the step says how it goes now.
    const creditTimelock = ethers.Wallet.createRandom().address;
    await (await payoutPool.grantRole(ethers.ZeroHash, creditTimelock)).wait();
    await (await payoutPool.renounceRole(ethers.ZeroHash, s.deployer.address)).wait();
    p = await buildSigningPlan({ network: "hardhat", env: inputs, valuationSigners });
    expect(step(p, "PT-funder").reason).to.contain("credit handover, I2");
    // Undo it for the rest of this test (the timelock gives the admin back).
    await ethers.provider.send("hardhat_impersonateAccount", [creditTimelock]);
    await ethers.provider.send("hardhat_setBalance", [creditTimelock, "0x" + ethers.parseEther("1").toString(16)]);
    await (await payoutPool.connect(await ethers.getSigner(creditTimelock)).grantRole(ethers.ZeroHash, s.deployer.address)).wait();
    p = await buildSigningPlan({ network: "hardhat", env: inputs, valuationSigners });

    // The deployer grants FUNDER_ROLE; CL Operating sends the batch's calls in order (as its Safe transaction would).
    await send(step(p, "PT-funder"));
    for (const t of batch.transactions) await send({ ...step(p, "PT-safe-module"), to: t.to, data: t.data });
    p = await buildSigningPlan({ network: "hardhat", env: inputs, valuationSigners });
    for (const id of PT_STEPS) expect(step(p, id).status, id).to.equal("done");
    expect(step(p, "PT-safe-allowance").reason).to.contain("$5,000.00 every 7 days");
    expect(p.steps.every((x) => x.status === "done")).to.equal(true);
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
});
