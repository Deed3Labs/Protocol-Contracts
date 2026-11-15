import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { POOL_SHARE_LEGEND, poolAt, poolProxyOptions } from "../../deploy/poolModules";
import { RESOLUTION, deployEarnControls } from "../helpers/earnControls";
import {
  EARN_ROLE_MINIMUMS, EarnRoleConfig, earnRoleProblems, grantEarnRoles, loadEarnRoles, poolTierStep,
  revokeRetiredPoolRoles, wireEarnControlsToPool,
} from "../../deploy/earnWiring";
import { switchOffPayoutLegs, wireLiquidatorGrants } from "../../deploy/creditWiring";
import { CREDIT_STACK_RECORDS, retireCreditRecords } from "../../deploy/retire_credit_stack";
import { wireEarn } from "../../deploy/27_wire_Earn";
import { setUintByGetter } from "../helpers/storage";
import { adminBatches, upgradeCall, vaultAdmin, vaultProxyFor, vaultUpgradeCalls } from "../../scripts/vaultUpgrade";
import { outstandingPre2fBonds, pre2fCollections } from "../../scripts/unwind_legacy_bonds";
import { upgradeToYieldPool } from "../../scripts/upgrade_yield_pool";

/*
 * Decision 47 (a fresh Base Sepolia credit stack) and the deploy-script fixes around it, run on the
 * in-process Hardhat network. Nothing here touches a live network or uses a key.
 */
const ZERO = ethers.ZeroHash;
const quiet = () => undefined;
const DAY = 24 * 3600;

async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e: any) {
    return String(e?.message);
  }
  return "";
}

const random = () => ethers.Wallet.createRandom().address;

/** A role configuration with every list filled by distinct fresh addresses. */
function fullRoles(): EarnRoleConfig {
  const fill = (spec: Record<string, number>) =>
    Object.fromEntries(Object.entries(spec).map(([role, min]) => [role, Array.from({ length: Math.max(min, 1) }, random)]));
  return { LendingPool: fill(EARN_ROLE_MINIMUMS.LendingPool), EarnControls: fill(EARN_ROLE_MINIMUMS.EarnControls), revokeBorrowers: [] };
}

async function freshPool(admin: any) {
  const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
  const proxy = await upgrades.deployProxy(await ethers.getContractFactory("LendingPool", admin),
    [admin.address, await usdc.getAddress(), "Clear Lending Pool", "clrLP"], await poolProxyOptions(admin));
  return { usdc, pool: await poolAt(await proxy.getAddress(), admin) };
}

describe("decision 47: the fresh credit stack and its deploy wiring", function () {
  describe("retiring the old credit records", function () {
    it("moves every credit-stack record aside as *PreAudit, keeps everything else, and does it once", function () {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retire-"));
      const write = (name: string, address: string) => fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ address, abi: [] }));
      for (const name of CREDIT_STACK_RECORDS) write(name, random());
      for (const kept of ["ESADepositVault", "ClaimEscrow", "ClearUSDUpgradeable", "LendingPool", "BondVault", "MembershipRegistry"]) write(kept, random());
      const ledger = JSON.parse(fs.readFileSync(path.join(dir, "ClearCredit.json"), "utf8")).address;

      const plan = retireCreditRecords(dir, false, quiet);
      expect(plan.map((s) => s.status)).to.deep.equal(CREDIT_STACK_RECORDS.map(() => "retire"));
      expect(fs.existsSync(path.join(dir, "ClearCredit.json"))).to.equal(true); // a report moves nothing

      retireCreditRecords(dir, true, quiet);
      for (const name of CREDIT_STACK_RECORDS) {
        expect(fs.existsSync(path.join(dir, `${name}.json`))).to.equal(false);
        expect(fs.existsSync(path.join(dir, `${name}PreAudit.json`))).to.equal(true);
      }
      expect(JSON.parse(fs.readFileSync(path.join(dir, "ClearCreditPreAudit.json"), "utf8")).address).to.equal(ledger);
      for (const kept of ["ESADepositVault", "ClaimEscrow", "ClearUSDUpgradeable", "LendingPool", "BondVault", "MembershipRegistry"]) {
        expect(fs.existsSync(path.join(dir, `${kept}.json`))).to.equal(true);
      }

      // The fresh deploy writes ClearCredit again: a second run keeps it.
      write("ClearCredit", random());
      const again = retireCreditRecords(dir, true, quiet);
      expect(again.find((s) => s.name === "ClearCredit")!.status).to.equal("kept");
      expect(again.find((s) => s.name === "TermIssuer")!.status).to.equal("retired");
      expect(JSON.parse(fs.readFileSync(path.join(dir, "ClearCreditPreAudit.json"), "utf8")).address).to.equal(ledger);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("the Liquidator's grants on a fresh chain", function () {
    async function setup() {
      const [deployer, other] = await ethers.getSigners();
      const access: any = await upgrades.deployProxy(await ethers.getContractFactory("AccessManager"), [deployer.address]);
      const clrusd: any = await upgrades.deployProxy(await ethers.getContractFactory("ClearUSDUpgradeable"),
        ["Clear USD", "CLRUSD", 6, 0, 0, deployer.address, deployer.address],
        { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
      return { deployer, other, access, clrusd, liquidator: random(), registry: random(), retired: random() };
    }

    it("makes the Liquidator an AccessManager operator, grants it CLRUSD's LIQUIDATOR_ROLE, names the registry, and revokes the retired one", async function () {
      const c = await setup();
      const LIQ = await c.clrusd.LIQUIDATOR_ROLE();
      await c.clrusd.grantRole(LIQ, c.retired);
      expect(await c.access.isOperator(c.liquidator)).to.equal(false);

      const proposals = await wireLiquidatorGrants({
        access: c.access, clrusd: c.clrusd, liquidator: c.liquidator, collateralRegistry: c.registry, retiredLiquidators: [c.retired],
      }, c.deployer, quiet);
      expect(proposals).to.deep.equal([]);
      expect(await c.access.isOperator(c.liquidator)).to.equal(true);
      expect(await c.clrusd.hasRole(LIQ, c.liquidator)).to.equal(true);
      expect(await c.clrusd.hasRole(LIQ, c.retired)).to.equal(false);
      expect(await c.clrusd.encumbranceSource()).to.equal(c.registry);

      // Idempotent: nothing more to send.
      const sent = await ethers.provider.getTransactionCount(c.deployer.address);
      await wireLiquidatorGrants({ access: c.access, clrusd: c.clrusd, liquidator: c.liquidator, collateralRegistry: c.registry }, c.deployer, quiet);
      expect(await ethers.provider.getTransactionCount(c.deployer.address)).to.equal(sent);
    });

    it("after the handovers, sends nothing and returns each grant as a timelock proposal", async function () {
      const c = await setup();
      const proposals = await wireLiquidatorGrants({
        access: c.access, clrusd: c.clrusd, liquidator: c.liquidator, collateralRegistry: c.registry,
      }, c.other, quiet);
      expect(proposals.map((p) => p.via)).to.deep.equal([
        "the credit timelock (Ops Safe)", "the vault timelock (Clear Financial Co. Safe)", "the vault timelock (Clear Financial Co. Safe)",
      ]);
      expect(c.access.interface.parseTransaction({ data: proposals[0].data })!.name).to.equal("grantOperator");
      const grant = c.clrusd.interface.parseTransaction({ data: proposals[1].data })!;
      expect([grant.name, grant.args[0], grant.args[1]]).to.deep.equal(["grantRole", await c.clrusd.LIQUIDATOR_ROLE(), ethers.getAddress(c.liquidator)]);
      expect(c.clrusd.interface.parseTransaction({ data: proposals[2].data })!.name).to.equal("setEncumbranceSource");
      expect(await c.access.isOperator(c.liquidator)).to.equal(false);

      // The proposals are the calls the admin makes.
      for (const p of proposals) await c.deployer.sendTransaction({ to: p.target, data: p.data });
      expect(await c.access.isOperator(c.liquidator)).to.equal(true);
      expect(await c.clrusd.hasRole(await c.clrusd.LIQUIDATOR_ROLE(), c.liquidator)).to.equal(true);
    });
  });

  describe("PayoutPool legs (decision 17, C1)", function () {
    it("switches the yield-pool and bond-vault legs off with setYieldPool(0) and setBondVault(0)", async function () {
      const [admin, other] = await ethers.getSigners();
      const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
      const payout: any = await upgrades.deployProxy(await ethers.getContractFactory("PayoutPool"),
        [admin.address, random(), await usdc.getAddress(), random(), admin.address], { kind: "uups" });
      await payout.setYieldPool(random());
      await payout.setBondVault(random());

      // Not the admin: the two calls are proposals, and nothing changes.
      const { proposals } = await switchOffPayoutLegs([{ name: "PayoutPoolPreAudit", contract: payout }], other, quiet);
      expect(proposals.map((p) => payout.interface.parseTransaction({ data: p.data })!.name)).to.deep.equal(["setYieldPool", "setBondVault"]);
      expect(proposals.every((p) => payout.interface.parseTransaction({ data: p.data })!.args[0] === ethers.ZeroAddress)).to.equal(true);
      expect(await payout.yieldPool()).to.not.equal(ethers.ZeroAddress);

      const done = await switchOffPayoutLegs([{ name: "PayoutPoolPreAudit", contract: payout }], admin, quiet);
      expect(done.proposals).to.deep.equal([]);
      expect(await payout.yieldPool()).to.equal(ethers.ZeroAddress);
      expect(await payout.bondVault()).to.equal(ethers.ZeroAddress);
    });

    it("leaves a leg on while the pool still owes on it", async function () {
      const [admin] = await ethers.getSigners();
      const calls: string[] = [];
      const owing: any = {
        connect: () => owing,
        interface: new ethers.Interface(["function setYieldPool(address)", "function yieldPool() view returns (address)", "function bondVault() view returns (address)"]),
        hasRole: async () => true,
        yieldPool: async () => random(),
        borrowedFromYield: async () => 5n,
        bondVault: async () => ethers.ZeroAddress,
        setYieldPool: async () => { calls.push("setYieldPool"); return { wait: async () => undefined }; },
      };
      const r = await switchOffPayoutLegs([{ name: "PayoutPoolPreAudit", contract: owing }], admin, quiet);
      expect(calls).to.deep.equal([]);
      expect(r.owed).to.have.length(1);
      expect(r.owed[0]).to.contain("still owes 5");
    });

    // The Base Sepolia PayoutPool predates setYieldPool: its record's ABI has setLenders(yieldPool, reserve).
    it("switches the pre-audit PayoutPool's yield leg off with setLenders(0, its reserve)", async function () {
      const [admin] = await ethers.getSigners();
      const record = JSON.parse(fs.readFileSync("deployments/base-sepolia/PayoutPool.json", "utf8"));
      const reserve = random();
      const calls: unknown[][] = [];
      const old: any = {
        connect: () => old,
        interface: new ethers.Interface(record.abi),
        hasRole: async () => true,
        yieldPool: async () => random(),
        borrowedFromYield: async () => 0n,
        bondVault: async () => ethers.ZeroAddress,
        reserve: async () => reserve,
        setLenders: async (...args: unknown[]) => { calls.push(args); return { wait: async () => undefined }; },
      };
      expect(old.interface.getFunction("setYieldPool")).to.equal(null);
      await switchOffPayoutLegs([{ name: "PayoutPoolPreAudit", contract: old }], admin, quiet);
      expect(calls).to.deep.equal([[ethers.ZeroAddress, reserve]]);
    });
  });

  describe("EarnControls and the Yield Pool", function () {
    it("names each on the other, keeps EarnControls' other sources, and proposes once the deployer is not the admin", async function () {
      const [admin, other] = await ethers.getSigners();
      const { pool } = await freshPool(admin);
      const membership = random();
      const controls = await deployEarnControls(admin, { membership });
      expect(await pool.earnControls()).to.equal(ethers.ZeroAddress);
      expect(await controls.yieldPool()).to.equal(ethers.ZeroAddress);

      const proposals = await wireEarnControlsToPool(controls, pool, other, quiet);
      expect(proposals.map((p) => p.what)).to.have.length(2);
      expect(pool.interface.parseTransaction({ data: proposals[0].data })!.name).to.equal("setEarnControls");
      const setSources = controls.interface.parseTransaction({ data: proposals[1].data })!;
      expect(setSources.name).to.equal("setSources");
      expect(setSources.args[0]).to.equal(membership);
      expect(setSources.args[1]).to.equal(await pool.getAddress());

      expect(await wireEarnControlsToPool(controls, pool, admin, quiet)).to.deep.equal([]);
      expect(await pool.earnControls()).to.equal(await controls.getAddress());
      expect(await controls.yieldPool()).to.equal(await pool.getAddress());
      expect(await controls.membership()).to.equal(membership);
      // Idempotent.
      const sent = await ethers.provider.getTransactionCount(admin.address);
      await wireEarnControlsToPool(controls, pool, admin, quiet);
      expect(await ethers.provider.getTransactionCount(admin.address)).to.equal(sent);
    });
  });

  describe("the Earn role grants", function () {
    it("refuse, granting nothing, while any holder list is unset: the shipped config is all owner-to-fill", async function () {
      const [admin] = await ethers.getSigners();
      const { pool } = await freshPool(admin);
      const controls = await deployEarnControls(admin);
      const shipped = loadEarnRoles("base-sepolia");
      const problems = earnRoleProblems(shipped);
      for (const role of [...Object.keys(EARN_ROLE_MINIMUMS.LendingPool), ...Object.keys(EARN_ROLE_MINIMUMS.EarnControls)]) {
        expect(problems.some((p) => p.startsWith("owner to fill") && p.includes(`.${role} `))).to.equal(true, role);
      }
      const sent = await ethers.provider.getTransactionCount(admin.address);
      const message = await failure(grantEarnRoles({ pool, controls }, shipped, RESOLUTION, admin, quiet));
      expect(message).to.contain("nothing was granted");
      expect(message).to.contain("owner to fill: deploy/config/earn-roles.json EarnControls.PAUSE_ROLE (at least 2 addresses");
      expect(await ethers.provider.getTransactionCount(admin.address)).to.equal(sent);
      expect(await failure(Promise.resolve().then(() => loadEarnRoles("hardhat")))).to.contain("Owner to fill: deploy/config/earn-roles.json has no entry for hardhat");
    });

    it("refuse a short list, a Deployment signer who is also a valuation signer, and a missing resolution", async function () {
      const [admin] = await ethers.getSigners();
      const { pool } = await freshPool(admin);
      const controls = await deployEarnControls(admin);
      const short = fullRoles();
      short.EarnControls.PAUSE_ROLE = [random()];
      expect(await failure(grantEarnRoles({ pool, controls }, short, RESOLUTION, admin, quiet))).to.contain("EarnControls.PAUSE_ROLE: needs at least 2 different addresses, has 1");
      const doubled = fullRoles();
      doubled.LendingPool.VALUATION_ROLE = [doubled.LendingPool.DEPLOYER_ROLE![0], random()];
      expect(await failure(grantEarnRoles({ pool, controls }, doubled, RESOLUTION, admin, quiet))).to.contain("would hold both VALUATION_ROLE and DEPLOYER_ROLE");
      expect(await failure(grantEarnRoles({ pool, controls }, fullRoles(), "", admin, quiet))).to.contain("Set EARN_RESOLUTION");
      expect(await failure(grantEarnRoles({ pool, controls }, fullRoles(), ZERO, admin, quiet))).to.contain("Set EARN_RESOLUTION");
    });

    it("grants every configured role, EarnControls' by resolution, and proposes them after the handover", async function () {
      const [admin, other] = await ethers.getSigners();
      const { pool } = await freshPool(admin);
      const controls = await deployEarnControls(admin);
      const cfg = fullRoles();

      const proposals = await grantEarnRoles({ pool, controls }, cfg, RESOLUTION, other, quiet);
      const holders = (s: Record<string, string[] | null | undefined>) => Object.values(s).reduce((n, l) => n + (l?.length ?? 0), 0);
      expect(proposals).to.have.length(holders(cfg.LendingPool) + holders(cfg.EarnControls));
      expect(proposals.every((p) => p.via.startsWith("the Earn timelock"))).to.equal(true);

      expect(await grantEarnRoles({ pool, controls }, cfg, RESOLUTION, admin, quiet)).to.deep.equal([]);
      for (const [role, list] of Object.entries(cfg.LendingPool)) {
        for (const who of list!) expect(await pool.hasRole(ethers.id(role), who)).to.equal(true, `pool ${role}`);
      }
      for (const [role, list] of Object.entries(cfg.EarnControls)) {
        for (const who of list!) expect(await controls.hasRole(ethers.id(role), who)).to.equal(true, `controls ${role}`);
      }
      const events = await controls.queryFilter(controls.filters.RoleGrantedByResolution());
      expect(events.length).to.equal(holders(cfg.EarnControls));
      expect(events.every((e: any) => e.args.resolutionHash === RESOLUTION)).to.equal(true);
    });

    it("revokes BORROWER_ROLE and the retired Liquidator's LIQUIDATOR_ROLE on the pool", async function () {
      const [admin] = await ethers.getSigners();
      const { pool } = await freshPool(admin);
      const borrower = random();
      const oldLiquidator = random();
      await pool.grantRole(ethers.id("BORROWER_ROLE"), borrower);
      await pool.grantRole(ethers.id("LIQUIDATOR_ROLE"), oldLiquidator);
      expect(await revokeRetiredPoolRoles(pool, { borrowers: [borrower, random()], liquidators: [oldLiquidator] }, admin, quiet)).to.deep.equal([]);
      expect(await pool.hasRole(ethers.id("BORROWER_ROLE"), borrower)).to.equal(false);
      expect(await pool.hasRole(ethers.id("LIQUIDATOR_ROLE"), oldLiquidator)).to.equal(false);
    });

    it("deploy 27 runs end to end from the records and the config, and reports the Pool Tier step", async function () {
      const [admin] = await ethers.getSigners();
      const network = "hardhat-fresh-credit";
      const dir = path.join("deployments", network);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const rolesFile = path.join(dir, "earn-roles.json");
      try {
        const { pool, usdc } = await freshPool(admin);
        const controls = await deployEarnControls(admin);
        const payout: any = await upgrades.deployProxy(await ethers.getContractFactory("PayoutPool"),
          [admin.address, random(), await usdc.getAddress(), random(), admin.address], { kind: "uups" });
        await payout.setYieldPool(await pool.getAddress());
        await pool.grantRole(ethers.id("BORROWER_ROLE"), await payout.getAddress());
        const record = (name: string, address: string) => fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ address, abi: [] }));
        record("LendingPool", await pool.getAddress());
        record("EarnControls", await controls.getAddress());
        record("PayoutPoolPreAudit", await payout.getAddress());
        // Decision 50: the BondVault's backstop still names the old pool, which still owes it.
        const vault: any = await upgrades.deployProxy(await ethers.getContractFactory("BondVault"),
          [admin.address, await usdc.getAddress(), 0], { kind: "uups" });
        await vault.setBackstops(admin.address, await payout.getAddress());
        await setUintByGetter(vault, "lentToPayoutPool", 5_000_000n);
        record("BondVault", await vault.getAddress());
        const cfg = fullRoles();
        fs.writeFileSync(rolesFile, JSON.stringify({ networks: { [network]: cfg } }));

        const evidence = ethers.id("pool tier evidence");
        const r = await wireEarn({ quiet: true, network, rolesFile, resolution: RESOLUTION, poolTierPrincipal: 1_000_000n, poolTierEvidence: evidence });
        expect(r.proposals).to.deep.equal([]);
        expect(await pool.earnControls()).to.equal(await controls.getAddress());
        expect(await controls.yieldPool()).to.equal(await pool.getAddress());
        expect(await payout.yieldPool()).to.equal(ethers.ZeroAddress); // setYieldPool(0)
        expect(await pool.hasRole(ethers.id("BORROWER_ROLE"), await payout.getAddress())).to.equal(false);
        expect(await pool.hasRole(ethers.id("VALUATION_ROLE"), cfg.LendingPool.VALUATION_ROLE![1])).to.equal(true);
        expect(await controls.hasRole(ethers.id("LADDER_ROLE"), cfg.EarnControls.LADDER_ROLE![0])).to.equal(true);
        // No Deployment before two valuation signers post the ceiling: the step is reported with its call.
        expect(r.tier.posted).to.equal(false);
        expect(pool.interface.parseTransaction({ data: r.tier.data! })!.args).to.deep.equal([1_000_000n, evidence]);
        // The backstop step is skipped on a testnet with the loan open, and the run goes on.
        expect(r.backstop!.status).to.equal("skipped");
        expect(r.backstop!.message).to.contain("left in place, test money, decision 50");
        expect(await vault.payoutPool()).to.equal(await payout.getAddress());
        // On Base mainnet it is refused instead, and the run still finishes.
        const mainnet = await wireEarn({ quiet: true, network, rolesFile, resolution: RESOLUTION, chainId: 8453n });
        expect(mainnet.backstop!.status).to.equal("refused");
        expect(mainnet.proposals).to.deep.equal([]);

        // With an unset list it stops before anything else is granted.
        const unset = fullRoles();
        unset.EarnControls.ATTESTER_ROLE = null;
        fs.writeFileSync(rolesFile, JSON.stringify({ networks: { [network]: unset } }));
        expect(await failure(wireEarn({ quiet: true, network, rolesFile, resolution: RESOLUTION }))).to.contain("owner to fill");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("the Pool Tier principal", function () {
    it("reports it unposted until two different VALUATION_ROLE signers post it", async function () {
      const [admin, v1, v2] = await ethers.getSigners();
      const { pool } = await freshPool(admin);
      await pool.grantRole(ethers.id("VALUATION_ROLE"), v1.address);
      await pool.grantRole(ethers.id("VALUATION_ROLE"), v2.address);
      const evidence = ethers.id("evidence");
      const step = await poolTierStep(pool, 5_000_000n, evidence);
      expect(step.posted).to.equal(false);
      expect((await poolTierStep(pool)).line).to.contain("Set POOL_TIER_PRINCIPAL");
      await v1.sendTransaction({ to: await pool.getAddress(), data: step.data! });
      expect((await poolTierStep(pool)).posted).to.equal(false);
      await v2.sendTransaction({ to: await pool.getAddress(), data: step.data! });
      expect((await poolTierStep(pool)).posted).to.equal(true);
    });
  });

  describe("the Yield Pool upgrade script", function () {
    it("validates first, then upgrades the Base Sepolia pool with initializeYieldPool in one call and writes the legend", async function () {
      const [admin, alice, lending] = await ethers.getSigners();
      const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
      const legacy: any = await upgrades.deployProxy(await ethers.getContractFactory("LendingPoolLegacy"),
        [admin.address, await usdc.getAddress(), "Clear Lending Pool", "clrLP"], { kind: "uups" });
      const proxy = await legacy.getAddress();
      await usdc.mint(alice.address, 10n ** 9n);
      await usdc.connect(alice).approve(proxy, ethers.MaxUint256);
      await legacy.connect(alice).deposit(10n ** 9n, alice.address);
      const controls = await deployEarnControls(admin);
      const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
      const base = { proxy, controls: await controls.getAddress(), deploymentAccount: lending.address, log: quiet };

      // A pool with shares must name its Initial Closing.
      expect(await failure(upgradeToYieldPool({ ...base, initialClosing: 0n }))).to.contain("INITIAL_CLOSING");
      // A dry run validates and sends nothing.
      const sent = await ethers.provider.getTransactionCount(admin.address);
      await upgradeToYieldPool({ ...base, initialClosing: now - 10n, dryRun: true });
      expect(await ethers.provider.getTransactionCount(admin.address)).to.equal(sent);

      const r = await upgradeToYieldPool({ ...base, initialClosing: now - 10n });
      expect(r.upgraded).to.equal(true);
      const pool = await poolAt(proxy, admin);
      expect(await pool.earnControls()).to.equal(await controls.getAddress());
      expect(await pool.deploymentAccount()).to.equal(lending.address);
      expect(await pool.initialClosing()).to.equal(now - 10n);
      expect(await pool.legend()).to.equal(POOL_SHARE_LEGEND);
      expect(await pool.balanceOf(alice.address)).to.be.greaterThan(0n);

      // initializeYieldPool runs once: a second run upgrades nothing.
      const again = await upgradeToYieldPool({ ...base, initialClosing: now - 10n });
      expect(again.upgraded).to.equal(false);
    });

    it("refuses an implementation whose layout does not extend the recorded one, before sending anything", async function () {
      const [admin] = await ethers.getSigners();
      // A proxy of another contract altogether stands in for a layout the pool cannot extend.
      const other: any = await upgrades.deployProxy(await ethers.getContractFactory("BondVaultPre2f"),
        [admin.address, random(), 90 * DAY], { kind: "uups" });
      const sent = await ethers.provider.getTransactionCount(admin.address);
      expect(await failure(upgradeToYieldPool({ proxy: await other.getAddress(), controls: random(), deploymentAccount: random(), initialClosing: 0n, log: quiet })))
        .to.match(/upgrade safe|[Ss]torage|layout/);
      expect(await ethers.provider.getTransactionCount(admin.address)).to.equal(sent);
    });
  });

  describe("the ESADepositVault upgrade batch", function () {
    async function setup() {
      const [deployer, o1, o2, o3, relayer] = await ethers.getSigners();
      const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
      const clrusd: any = await upgrades.deployProxy(await ethers.getContractFactory("ClearUSDUpgradeable"),
        ["Clear USD", "CLRUSD", 6, 0, 0, deployer.address, deployer.address],
        { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
      const vault: any = await upgrades.deployProxy(await ethers.getContractFactory("ESADepositVault"), [await clrusd.getAddress(), deployer.address], { kind: "uups" });
      await vault.grantRole(ethers.id("OPERATOR_ROLE"), relayer.address);
      const impl = (await upgrades.prepareUpgrade(await vault.getAddress(), await ethers.getContractFactory("ESADepositVault"), { kind: "uups" })) as string;
      const safe: any = await (await ethers.getContractFactory("MockSafe")).deploy([o1.address, o2.address, o3.address], 2);
      return { deployer, o1, o2, relayer, usdc, vault, impl, safe };
    }

    it("points Base Sepolia at the current vault record, not the legacy one", function () {
      const vault = vaultProxyFor("base-sepolia");
      expect(vault).to.equal("0x836401Ed3e2bF7CAb5e2721188E74B834511413b");
      const legacy = JSON.parse(fs.readFileSync("deployments/base-sepolia/ESADepositVaultLegacy.json", "utf8")).address;
      expect(vault).to.not.equal(legacy);
      expect(vaultProxyFor("base")).to.equal("0x0CfE6aFB053474cE4Ff744a1fe864C82c173a1C1");
    });

    it("encodes the upgrade as one upgradeToAndCall with setAcceptedToken(USDC, true), and splits the relayer's role", async function () {
      const c = await setup();
      const usdc = await c.usdc.getAddress();
      const calls = await vaultUpgradeCalls({ vault: c.vault, impl: c.impl, usdc, relayer: c.relayer.address });
      expect(calls).to.have.length(3);
      const up = c.vault.interface.parseTransaction({ data: calls[0].data })!;
      expect(up.name).to.equal("upgradeToAndCall");
      expect(up.args[0]).to.equal(c.impl);
      const inner = c.vault.interface.parseTransaction({ data: up.args[1] })!;
      expect([inner.name, inner.args[0], inner.args[1]]).to.deep.equal(["setAcceptedToken", usdc, true]);
      expect(calls[0].data).to.equal(upgradeCall(c.vault.interface, c.impl, usdc));
      expect(calls.slice(1).map((x) => c.vault.interface.parseTransaction({ data: x.data })!.name)).to.deep.equal(["grantRole", "revokeRole"]);

      // An account holding the admin sends them as they are; the vault then accepts USDC.
      const admin = await vaultAdmin(c.vault, { accounts: [c.deployer.address] });
      expect(admin.kind).to.equal("account");
      const batches = await adminBatches(admin, calls, "vault-1-upgrade");
      expect(batches).to.have.length(1);
      expect(await c.vault.acceptedToken()).to.equal(ethers.ZeroAddress);
      for (const t of batches[0].transactions) await c.deployer.sendTransaction({ to: t.to, data: t.data });
      expect(await c.vault.acceptedToken()).to.equal(usdc);
      expect(await c.vault.hasRole(ethers.id("RELAYER_ROLE"), c.relayer.address)).to.equal(true);
      expect(await c.vault.hasRole(ethers.id("OPERATOR_ROLE"), c.relayer.address)).to.equal(false);
    });

    it("addresses the Clear Financial Safe, or the vault timelock once it holds the admin, and checks which applies", async function () {
      const c = await setup();
      const safe = await c.safe.getAddress();
      const usdc = await c.usdc.getAddress();
      // Nobody known holds the admin: an error, not a guess.
      expect(await failure(vaultAdmin(c.vault, { safe }))).to.contain("owner to confirm");

      const { deployVaultTimelock } = require("../../deploy/vault_timelock_handover");
      const timelock: any = await deployVaultTimelock(safe);
      const t = await timelock.getAddress();
      await c.vault.grantRole(ZERO, t);
      await c.vault.renounceRole(ZERO, c.deployer.address);
      expect(await failure(vaultAdmin(c.vault, { timelock: t }))).to.contain("set CLEAR_FINANCIAL_SAFE");
      expect(await failure(vaultAdmin(c.vault, { timelock: t, safe: c.o1.address }))).to.contain("is not a proposer and executor");
      const admin = await vaultAdmin(c.vault, { timelock: t, safe });
      expect(admin.kind).to.equal("timelock");

      const calls = await vaultUpgradeCalls({ vault: c.vault, impl: c.impl, usdc });
      const [schedule, execute] = await adminBatches(admin, calls, "vault-1-upgrade");
      expect(schedule.suffix).to.equal(".schedule");
      expect(schedule.transactions[0].to).to.equal(t);
      const scheduled = timelock.interface.parseTransaction({ data: schedule.transactions[0].data })!;
      expect(scheduled.name).to.equal("scheduleBatch");
      expect(scheduled.args[2]).to.deep.equal([calls[0].data]);

      // The Safe's two owners schedule; after 7 days they execute; the vault accepts USDC.
      for (const o of [c.o1, c.o2]) await c.safe.connect(o).confirmAndExecute(t, schedule.transactions[0].data);
      await ethers.provider.send("evm_increaseTime", [7 * DAY]);
      await ethers.provider.send("evm_mine", []);
      for (const o of [c.o1, c.o2]) await c.safe.connect(o).confirmAndExecute(t, execute.transactions[0].data);
      expect(await c.vault.acceptedToken()).to.equal(usdc);
    });
  });

  describe("the pre-2f bond unwind, report mode", function () {
    it("lists every pre-2f collection on record and its outstanding bonds, and sends nothing", async function () {
      const [admin, bondRole, holder, buyer] = await ethers.getSigners();
      const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
      const vault: any = await upgrades.deployProxy(await ethers.getContractFactory("BondVaultPre2f"),
        [admin.address, await usdc.getAddress(), 90 * DAY], { kind: "uups" });
      await vault.grantRole(await vault.BOND_ROLE(), bondRole.address);
      const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
      const U = (n: bigint) => n * 10n ** 6n;
      await usdc.mint(await vault.getAddress(), U(1_500n));
      // Bond 1 is the legacy collection's, 5001 and 5002 the current pre-2f one's (ids above FIRST_BOND_ID).
      for (const [id, price, face] of [[1n, 900n, 1_000n], [5001n, 950n, 1_000n], [5002n, 480n, 500n]]) {
        await vault.connect(bondRole).recordPurchase(id, U(price), U(face), now + BigInt(365 * DAY));
      }

      // The pre-2f collections are clones of an implementation this repo no longer has: stand-ins
      // answering the old collection's views. A Phase 2f collection answers controls() and is skipped.
      const fake = (ids: Record<string, { creator: string; face: bigint; pv: bigint; held: boolean }>, address: string) => ({
        bondVault: async () => vault.getAddress(),
        getBondInfo: async (id: bigint) => {
          const b = ids[String(id)];
          return { faceValue: b?.face ?? 0n, maturityDate: now + BigInt(365 * DAY), isRedeemed: false, creator: b?.creator ?? ethers.ZeroAddress };
        },
        presentValueOf: async (id: bigint) => ids[String(id)].pv,
        balanceOf: async (_who: string, id: bigint) => (ids[String(id)].held ? 1n : 0n),
        controls: async () => { throw new Error("no controls() on a pre-2f collection"); },
        address,
      });
      const legacyAddress = random();
      const currentAddress = random();
      const newAddress = random();
      const fakes: Record<string, any> = {
        [legacyAddress.toLowerCase()]: fake({ "1": { creator: holder.address, face: U(1_000n), pv: U(920n), held: true } }, legacyAddress),
        [currentAddress.toLowerCase()]: fake({
          "5001": { creator: buyer.address, face: U(1_000n), pv: U(960n), held: false },
          "5002": { creator: buyer.address, face: U(500n), pv: U(490n), held: true },
        }, currentAddress),
        [newAddress.toLowerCase()]: { controls: async () => random() },
      };
      const at = (address: string, abi: string[]) =>
        fakes[address.toLowerCase()] ?? new ethers.Contract(address, abi, ethers.provider);

      const records: Record<string, string> = { BurnerBondLegacy: legacyAddress, BurnerBondPre2f: currentAddress, BurnerBond: newAddress };
      const collections = await pre2fCollections((name) => records[name], at);
      expect(collections.map((c) => c.name)).to.deep.equal(["BurnerBondLegacy", "BurnerBondPre2f"]);

      const sent = await ethers.provider.getTransactionCount(admin.address);
      const report = await outstandingPre2fBonds(collections, at);
      expect(await ethers.provider.getTransactionCount(admin.address)).to.equal(sent);
      // Each collection reports only its own ids from the shared vault.
      expect(report.bonds.map((b) => [b.collectionName, b.id, b.creatorHolds])).to.deep.equal([
        ["BurnerBondLegacy", 1n, true],
        ["BurnerBondPre2f", 5001n, false],
        ["BurnerBondPre2f", 5002n, true],
      ]);
      const v = report.vaults.get((await vault.getAddress()).toLowerCase())!;
      expect(v.count).to.equal(3);
      expect(v.presentValue).to.equal(U(2_370n));
      expect(v.faceValue).to.equal(U(2_500n));
      expect(v.held).to.equal(await vault.held());
    });
  });
});
