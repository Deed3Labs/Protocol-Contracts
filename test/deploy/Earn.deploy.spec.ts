import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { poolProxyOptions } from "../../deploy/poolModules";
import {
  EARN_TIMELOCK_DELAY, assertNoEarnAdmin, creditToEarnCalls, deployEarnTimelock, handOverEarn,
} from "../../deploy/earn_timelock_handover";
import { RESOLUTION, deployEarnControls } from "../helpers/earnControls";
import { REFUSED_RECORDS, clearContractsToRefuse, refuseClearContracts, pledgeModuleChange } from "../../deploy/earnWiring";

const ZERO = ethers.ZeroHash;

async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e: any) {
    return String(e?.message);
  }
  return "";
}

/*
 * Phase 2f, decision 2: the separate 7-day Earn timelock, on a fresh chain. Nothing here touches a
 * live network.
 */
describe("Earn timelock handover (decision 2)", function () {
  let deployer: any, safe: any, key: any, t1: any, t2: any;
  let usdc: any, pool: any, controls: any, timelock: any, t: string;

  async function deployAgent(admin: string) {
    return upgrades.deployProxy(
      await ethers.getContractFactory("CollateralAgent"),
      [admin, key.address, [t1.address, t2.address], 6, {
        vault: ethers.ZeroAddress, bondBook: ethers.ZeroAddress, pledgeModule: ethers.ZeroAddress, payeeSource: ethers.ZeroAddress,
        collateralAccount: t1.address, costAddress: key.address, excessDestination: safe.address,
      }],
      { kind: "uups" }
    ) as Promise<any>;
  }

  async function viaTimelock(target: any, data: string, salt: string) {
    const to = await target.getAddress();
    await timelock.connect(safe).schedule(to, 0, data, ZERO, ethers.id(salt), EARN_TIMELOCK_DELAY);
    await expect(timelock.connect(safe).execute(to, 0, data, ZERO, ethers.id(salt)))
      .to.be.revertedWith("TimelockController: operation is not ready");
    await ethers.provider.send("evm_increaseTime", [EARN_TIMELOCK_DELAY]);
    await ethers.provider.send("evm_mine", []);
    await timelock.connect(safe).execute(to, 0, data, ZERO, ethers.id(salt));
  }

  beforeEach(async function () {
    [deployer, safe, key, t1, t2] = await ethers.getSigners();
    usdc = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
    pool = await upgrades.deployProxy(
      await ethers.getContractFactory("LendingPool", deployer),
      [deployer.address, await usdc.getAddress(), "Clear Lending Pool", "clrLP"],
      await poolProxyOptions(deployer)
    );
    await pool.grantRole(await pool.DEPLOYER_ROLE(), deployer.address);
    controls = await deployEarnControls(deployer);
    await controls.grantRoleByResolution(await controls.ATTESTER_ROLE(), deployer.address, RESOLUTION);
    timelock = await deployEarnTimelock(safe.address);
    t = await timelock.getAddress();
  });

  it("refuses an Earn timelock shorter than 7 days, and gives the timelock no admin", async function () {
    let error: any;
    try { await deployEarnTimelock(safe.address, EARN_TIMELOCK_DELAY - 1); } catch (e) { error = e; }
    expect(String(error?.message)).to.contain("at least 7 days");
    expect(await timelock.hasRole(await timelock.TIMELOCK_ADMIN_ROLE(), deployer.address)).to.equal(false);
    expect(await timelock.getMinDelay()).to.equal(BigInt(EARN_TIMELOCK_DELAY));
  });

  it("moves the Yield Pool, EarnControls and CollateralAgent admin to it and leaves the deployer nothing", async function () {
    const agent = await deployAgent(t);
    const c = { lendingPool: pool, earnControls: controls, collateralAgent: agent };
    expect(await failure(handOverEarn(c, deployer, t, ZERO))).to.contain("resolution hash");
    await handOverEarn(c, deployer, t, RESOLUTION);
    await assertNoEarnAdmin(c, deployer.address, t);
    for (const ct of [pool, controls, agent]) {
      expect(await ct.hasRole(ZERO, t)).to.equal(true);
      expect(await ct.hasRole(ZERO, deployer.address)).to.equal(false);
    }
    expect(await pool.hasRole(await pool.OPERATOR_ROLE(), deployer.address)).to.equal(false);
    expect(await pool.hasRole(await pool.DEPLOYER_ROLE(), deployer.address)).to.equal(false);
    expect(await controls.hasRole(await controls.ATTESTER_ROLE(), deployer.address)).to.equal(false);

    // A pool setting and a controls setting now take a proposal and 7 days.
    // Conformance pass: the pool's own holder cap is gone (EarnControls has it); the Maximum
    // Holdback Age stands in as the pool setting.
    await expect(pool.setHoldbackMaxAge(100 * 86400)).to.be.reverted;
    await viaTimelock(pool, pool.interface.encodeFunctionData("setHoldbackMaxAge", [100 * 86400]), "pool age");
    expect(await pool.holdbackMaxAge()).to.equal(BigInt(100 * 86400));
    await expect(controls.setHolderCapBps(2_000)).to.be.reverted;
    await viaTimelock(controls, controls.interface.encodeFunctionData("setHolderCapBps", [2_000]), "controls cap");
    expect(await controls.holderCapBps()).to.equal(2_000n);
  });

  it("refuses to hand over a CollateralAgent whose admin is not the Earn timelock", async function () {
    const agent = await deployAgent(deployer.address);
    expect(await failure(handOverEarn({ collateralAgent: agent }, deployer, t, RESOLUTION))).to.contain("not the Earn timelock");
  });

  it("passes LendingPool's admin from the credit timelock to the Earn timelock in one credit-timelock batch", async function () {
    const credit: any = await deployEarnTimelock(safe.address);
    const ct = await credit.getAddress();
    await pool.grantRole(ZERO, ct);
    await pool.renounceRole(ZERO, deployer.address);
    const b = await creditToEarnCalls(pool, t, ct);
    const salt = ethers.id("lending pool to earn");
    await credit.connect(safe).scheduleBatch(b.targets, b.values, b.payloads, ZERO, salt, EARN_TIMELOCK_DELAY);
    await ethers.provider.send("evm_increaseTime", [EARN_TIMELOCK_DELAY]);
    await ethers.provider.send("evm_mine", []);
    await credit.connect(safe).executeBatch(b.targets, b.values, b.payloads, ZERO, salt);
    expect(await pool.hasRole(ZERO, t)).to.equal(true);
    expect(await pool.hasRole(ZERO, ct)).to.equal(false);
  });

  it("LendingPool is no longer part of the credit handover", async function () {
    const src = require("fs").readFileSync(require("path").join(__dirname, "../../deploy/credit_timelock_handover.ts"), "utf8");
    expect(src).to.not.match(/at\("LendingPool"\)|"lendingPool"/);
  });

  // Phase 2f stage 2, decision 2: the BondVault and the bond collections move from the credit
  // handover to the Earn timelock (deploy config only; never run against a network).
  it("moves the BondVault and a bond collection to the Earn timelock; the credit handover no longer lists the vault", async function () {
    const { deployPhase0Network } = require("../helpers/phase0-fixture");
    const { deployBondStack } = require("../helpers/bonds");
    const ctx = await deployPhase0Network();
    const s = await deployBondStack(ctx.admin, ctx.usdc, ctx.tokenRegistry);
    const admin = ctx.admin;
    await handOverEarn({ bondVault: s.vault, bondCollections: [s.bond] }, admin, t, RESOLUTION);
    expect(await s.vault.hasRole(ZERO, t)).to.equal(true);
    expect(await s.vault.hasRole(ZERO, admin.address)).to.equal(false);
    expect(await s.bond.owner()).to.equal(t);
    await assertNoEarnAdmin({ bondVault: s.vault, bondCollections: [s.bond] }, admin.address, t);

    // Once the Agent is named on a vault, the grant is a co-signed change: the script stops.
    const other = await deployBondStack(ctx.admin, ctx.usdc, ctx.tokenRegistry);
    const agent = await deployAgent(t);
    await other.vault.setEarnSources(await agent.getAddress(), await other.controls.getAddress());
    expect(await failure(handOverEarn({ bondVault: other.vault }, admin, t, RESOLUTION))).to.match(/co-signature/);

    const src = require("fs").readFileSync(require("path").join(__dirname, "../../deploy/credit_timelock_handover.ts"), "utf8");
    expect(src).to.not.match(/at\("BondVault"\)|"bondVault"/);
  });

  // Phase 2f stage 3: Earn §1 and IV-02 §2.4. No Clear contract holding ESA capital, collateral,
  // credit or Earn funds may pay for, or be issued, an Earn Product. Deploy 26 refuses them all.
  it("refuses every Clear contract the requirements name, and every bond collection, as an Earn payer or receiver", async function () {
    const { deployPhase0Network } = require("../helpers/phase0-fixture");
    const { deployBondStack } = require("../helpers/bonds");
    const ctx = await deployPhase0Network();
    const s = await deployBondStack(ctx.admin, ctx.usdc, ctx.tokenRegistry);
    const names = REFUSED_RECORDS.map((r) => r.name);
    for (const required of [
      // the bonds report (§5 item 5) and this stage's list
      "BondVault", "BurnerBond", "HolderDirections", "CollateralAgent", "LendingPool", "Liquidator", "PoolShareEnforcer",
      // the Earn controls report: the registry, the PayoutPool, ClaimEscrow, the ESA vault, CLRUSD,
      // the Assurance compartments and the issuers
      "CollateralRegistry", "PayoutPool", "ClaimEscrow", "ESADepositVault", "ClearUSD", "ClearUSDUpgradeable",
      "AssurancePool", "RevolvingIssuer", "TermIssuer", "OffersIssuer",
    ]) expect(names).to.include(required);

    // Every record resolved, plus every collection of the factory (here the new one).
    const book: Record<string, string> = {};
    for (const n of names) book[n] = ethers.Wallet.createRandom().address;
    book.BondVault = await s.vault.getAddress();
    book.BurnerBond = ethers.ZeroAddress; // not recorded: the factory still finds the collection
    book.BurnerBondFactory = await s.factory.getAddress();
    const entries = await clearContractsToRefuse((n) => book[n]);
    const refusedAddresses = entries.map((e) => e.address.toLowerCase());
    expect(refusedAddresses).to.include((await s.bond.getAddress()).toLowerCase());
    expect(refusedAddresses).to.include(book.BondVault.toLowerCase());
    expect(new Set(refusedAddresses).size).to.equal(refusedAddresses.length);
    // Every name but BurnerBond, plus the one collection and the factory's deposit contract if any.
    const info = await s.factory.getCollectionInfo(await ctx.usdc.getAddress());
    expect(entries.length).to.equal(names.length + (info.depositContract === ethers.ZeroAddress ? 0 : 1));

    const controls = s.controls;
    const quiet = () => undefined;
    expect(await refuseClearContracts(controls, entries, ctx.admin, quiet)).to.deep.equal([]);
    for (const e of entries) expect(await controls.refused(e.address)).to.equal(true);
    // Idempotent: a second run sends nothing.
    const sent = await ethers.provider.getTransactionCount(ctx.admin.address);
    await refuseClearContracts(controls, entries, ctx.admin, quiet);
    expect(await ethers.provider.getTransactionCount(ctx.admin.address)).to.equal(sent);

    // A refused contract cannot receive a bond: the purchase reverts at EarnControls.
    const { q, sig } = await s.quote(ctx.member, 1_000_000_000n, 365, { holder: book.BondVault });
    await expect(s.bond.connect(ctx.member).purchase(q, sig, "0x")).to.be.revertedWithCustomError(controls, "EarnControlsRefused")
      .withArgs(book.BondVault);

    // Once the deployer is not the admin (after the handover), it only returns the proposals.
    const fresh = await deployEarnControls(deployer);
    const proposals = await refuseClearContracts(fresh, entries.slice(0, 2), safe, quiet);
    expect(proposals.map((p: any) => p.data)).to.deep.equal(
      entries.slice(0, 2).map((e) => fresh.interface.encodeFunctionData("setRefused", [e.address, true])));
    expect(await fresh.refused(entries[0].address)).to.equal(false);
  });

  // Phase 2f stage 3, decision 19: the Liquidator is the Agent's pledge module (IAgentPledgeModule),
  // named by a co-signed change the Earn timelock makes.
  it("names the Liquidator as the Agent's pledge module only by a co-signed change, through the Earn timelock", async function () {
    const agent = await deployAgent(t);
    const module = ethers.Wallet.createRandom().address;
    const change = await pledgeModuleChange(agent, module);
    expect(change.target).to.equal(await agent.getAddress());
    expect(change.callHash).to.equal(ethers.keccak256(change.data));
    expect(agent.interface.parseTransaction({ data: change.data })!.name).to.equal("setPledgeModule");

    // The timelock alone cannot make it: the Agent has not co-signed.
    const salt1 = ethers.id("pledge module, unsigned");
    await timelock.connect(safe).schedule(change.target, 0, change.data, ZERO, salt1, EARN_TIMELOCK_DELAY);
    await ethers.provider.send("evm_increaseTime", [EARN_TIMELOCK_DELAY]);
    await ethers.provider.send("evm_mine", []);
    expect(await failure(timelock.connect(safe).execute(change.target, 0, change.data, ZERO, salt1))).to.match(/CollateralAgentChangeNotReady|reverted/);
    expect(await agent.pledgeModule()).to.equal(ethers.ZeroAddress);

    // Two treasury signers, the Agent Key, 7 days, then the timelock.
    await agent.connect(t1).proposeChange(change.target, change.callHash, change.descriptionHash);
    const id = await agent.openChangeFor(change.target, change.callHash);
    await agent.connect(t2).confirmChange(id);
    await agent.connect(key).approveChange(id);
    await viaTimelock(agent, change.data, "pledge module");
    expect(await agent.pledgeModule()).to.equal(module);
  });
});
