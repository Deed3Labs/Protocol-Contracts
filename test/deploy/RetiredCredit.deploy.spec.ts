import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { poolAt, poolProxyOptions } from "../../deploy/poolModules";
import { deployEarnControls } from "../helpers/earnControls";
import { EARN_TIMELOCK_DELAY, deployEarnTimelock, isRetiredBondOwnable } from "../../deploy/earn_timelock_handover";
import { payoutBackstopChange, revokeRetiredVaultRoles } from "../../deploy/earnWiring";
import { RETIRED_ROLE_CHECKS, VIA, revokeRetiredRoles, roleHash } from "../../deploy/creditWiring";
import { BASE_MAINNET_CHAIN_ID, isTestMoneyChain, retiredContracts, retiredRecordNames } from "../../deploy/retire_credit_stack";
import { checkRetiredCredit, leftoverStatus } from "../../scripts/check_retired_credit";
import { setUintByGetter } from "../helpers/storage";

/*
 * Decision 48: the BondVault's link to the retired PayoutPool, and the retired credit and bond
 * contracts disconnected from everything kept. Decision 50: on a testnet their leftovers (open loans,
 * legs, the backstop, balances) are test money and do not block; on Base mainnet they would. On the
 * in-process Hardhat network only: nothing here touches a live network or uses a key.
 */
const quiet = () => undefined;
const random = () => ethers.Wallet.createRandom().address;
const abiOf = (c: any) => JSON.parse(c.interface.formatJson());

describe("decision 48: the retired credit stack, disconnected", function () {
  describe("(a) the BondVault's payout-pool backstop", function () {
    it("is skipped on a testnet and refused on Base mainnet while a loan is open, then printed as the co-signed setBackstops(treasury, 0) that keeps the treasury", async function () {
      const [admin, t1, t2, key, safe, oldPayout, treasury] = await ethers.getSigners();
      const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
      const vault: any = await upgrades.deployProxy(await ethers.getContractFactory("BondVault"),
        [admin.address, await usdc.getAddress(), 0], { kind: "uups" });
      const target = await vault.getAddress();
      await vault.setBackstops(treasury.address, oldPayout.address);

      // A loan from before Phase 2f: `lendToPayoutPool` is gone, so the test writes the slot after `payoutPool`.
      let slot = -1;
      const want = ethers.zeroPadValue(oldPayout.address, 32).toLowerCase();
      for (let i = 0; i < 400 && slot < 0; i++) {
        if ((await ethers.provider.getStorage(target, i)).toLowerCase() === want) slot = i + 1;
      }
      expect(slot).to.be.greaterThan(0);
      await ethers.provider.send("hardhat_setStorageAt", [target, ethers.toQuantity(slot), ethers.zeroPadValue(ethers.toBeHex(5_000_000n), 32)]);
      expect(await vault.lentToPayoutPool()).to.equal(5_000_000n);

      // The Earn timelock takes the vault's admin and the Agent is named: every change is co-signed.
      const timelock: any = await deployEarnTimelock(safe.address);
      const t = await timelock.getAddress();
      const agent: any = await upgrades.deployProxy(await ethers.getContractFactory("CollateralAgent"),
        [t, key.address, [t1.address, t2.address], 6, {
          vault: ethers.ZeroAddress, bondBook: ethers.ZeroAddress, pledgeModule: ethers.ZeroAddress, payeeSource: ethers.ZeroAddress,
          collateralAccount: t1.address, costAddress: key.address, excessDestination: safe.address,
        }], { kind: "uups" });
      await vault.grantRole(ethers.ZeroHash, t);
      await vault.setEarnSources(await agent.getAddress(), random());

      // Decision 50: on a testnet (the in-process network is one) the step is skipped, the backstop left.
      const sent = await ethers.provider.getTransactionCount(admin.address);
      const skipped = await payoutBackstopChange(vault, quiet);
      expect(skipped.status).to.equal("skipped");
      expect(skipped.message).to.contain("left in place, test money, decision 50; BondVault lends nothing and the old pool can only repay into it");
      expect(skipped.message).to.contain("5000000");
      expect(skipped.proposals).to.deep.equal([]);
      expect((await payoutBackstopChange(vault, quiet, 84532)).status).to.equal("skipped"); // Base Sepolia

      // On Base mainnet: refused, with a clear message, while the loan is open; nothing proposed.
      const refused = await payoutBackstopChange(vault, quiet, BASE_MAINNET_CHAIN_ID);
      expect(refused.status).to.equal("refused");
      expect(refused.message).to.contain("repayFromPayoutPool");
      expect(refused.message).to.contain("5000000");
      expect(refused.proposals).to.deep.equal([]);
      expect(await ethers.provider.getTransactionCount(admin.address)).to.equal(sent); // never sends

      // The old PayoutPool repays through repayFromPayoutPool.
      await usdc.mint(oldPayout.address, 5_000_000n);
      await usdc.connect(oldPayout).approve(target, 5_000_000n);
      await vault.connect(oldPayout).repayFromPayoutPool(5_000_000n);
      expect(await vault.lentToPayoutPool()).to.equal(0n);

      const sentBefore = await ethers.provider.getTransactionCount(admin.address);
      const change = await payoutBackstopChange(vault, quiet);
      expect(change.status).to.equal("change");
      expect(await ethers.provider.getTransactionCount(admin.address)).to.equal(sentBefore); // still never sends
      expect(change.proposals).to.have.length(1);
      expect(change.proposals[0].via).to.equal(VIA.earn);
      const call = vault.interface.parseTransaction({ data: change.proposals[0].data })!;
      expect([call.name, call.args[0], call.args[1]]).to.deep.equal(["setBackstops", treasury.address, ethers.ZeroAddress]);
      const co = change.coSigned!;
      expect(co.target).to.equal(target);
      expect(co.callHash).to.equal(ethers.keccak256(change.proposals[0].data));
      expect(co.steps).to.have.length(4);

      // The timelock alone cannot make it: the Agent has not co-signed.
      const execute = async (salt: string) => {
        await timelock.connect(safe).schedule(target, 0, co.data, ethers.ZeroHash, ethers.id(salt), EARN_TIMELOCK_DELAY);
        await ethers.provider.send("evm_increaseTime", [EARN_TIMELOCK_DELAY]);
        await ethers.provider.send("evm_mine", []);
        return timelock.connect(safe).execute(target, 0, co.data, ethers.ZeroHash, ethers.id(salt));
      };
      await expect(execute("unsigned")).to.be.reverted;
      expect(await vault.payoutPool()).to.equal(oldPayout.address);

      // Two treasury signers, the Agent Key, 7 days, then the Earn timelock.
      await agent.connect(t1).proposeChange(co.target, co.callHash, co.descriptionHash);
      const id = await agent.openChangeFor(co.target, co.callHash);
      await agent.connect(t2).confirmChange(id);
      await agent.connect(key).approveChange(id);
      await execute("co-signed");
      expect(await vault.payoutPool()).to.equal(ethers.ZeroAddress);
      expect(await vault.treasury()).to.equal(treasury.address); // unchanged

      // Nothing more to do.
      expect((await payoutBackstopChange(vault, quiet)).status).to.equal("none");
    });

    it("before the Agent is named, gives the call for the vault's admin with no co-signature, and still sends nothing", async function () {
      const [admin, oldPayout, treasury] = await ethers.getSigners();
      const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
      const vault: any = await upgrades.deployProxy(await ethers.getContractFactory("BondVault"),
        [admin.address, await usdc.getAddress(), 0], { kind: "uups" });
      await vault.setBackstops(treasury.address, oldPayout.address);
      const r = await payoutBackstopChange(vault, quiet);
      expect(r.status).to.equal("change");
      expect(r.coSigned).to.equal(undefined);
      expect(await vault.payoutPool()).to.equal(oldPayout.address);
      await admin.sendTransaction({ to: r.proposals[0].target, data: r.proposals[0].data });
      expect(await vault.payoutPool()).to.equal(ethers.ZeroAddress);
      expect(await vault.treasury()).to.equal(treasury.address);
    });
  });

  describe("(b) the retired contracts' roles", function () {
    it("revokes a retired collection's BondVault role before the Agent is named, and only prints co-signed changes after", async function () {
      const [admin, other] = await ethers.getSigners();
      const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
      const vault: any = await upgrades.deployProxy(await ethers.getContractFactory("BondVault"),
        [admin.address, await usdc.getAddress(), 0], { kind: "uups" });
      const BOND = await vault.BOND_ROLE();
      const [old1, old2] = [random(), random()];
      await vault.grantRole(BOND, old1);
      await vault.grantRole(BOND, old2);

      const before = await revokeRetiredVaultRoles(vault, [{ name: "BurnerBondPre2f", address: old1 }], admin, quiet);
      expect(before.proposals).to.deep.equal([]);
      expect(await vault.hasRole(BOND, old1)).to.equal(false);

      await vault.setEarnSources(random(), random()); // the Agent is named
      const sent = await ethers.provider.getTransactionCount(admin.address);
      const after = await revokeRetiredVaultRoles(vault, [{ name: "BurnerBondLegacy", address: old2 }], admin, quiet);
      expect(await ethers.provider.getTransactionCount(admin.address)).to.equal(sent);
      expect(after.coSigned).to.have.length(1);
      const call = vault.interface.parseTransaction({ data: after.coSigned[0].data })!;
      expect([call.name, call.args[0], call.args[1]]).to.deep.equal(["revokeRole", BOND, ethers.getAddress(old2)]);
      expect(await vault.hasRole(BOND, old2)).to.equal(true);

      // Not the admin: proposals only, from any contract the sweep covers.
      const pool = (await freshKept(admin)).pool;
      await pool.grantRole(roleHash("LOSS_REPORTER_ROLE"), old1);
      const p = await revokeRetiredRoles(pool, "LendingPool", RETIRED_ROLE_CHECKS.LendingPool, [{ name: "LiquidatorPreAudit", address: old1 }], other, VIA.earn, quiet);
      expect(p.map((x) => pool.interface.parseTransaction({ data: x.data })!.name)).to.deep.equal(["revokeRole"]);
      expect(await pool.hasRole(roleHash("LOSS_REPORTER_ROLE"), old1)).to.equal(true);
      await revokeRetiredRoles(pool, "LendingPool", RETIRED_ROLE_CHECKS.LendingPool, [{ name: "LiquidatorPreAudit", address: old1 }], admin, VIA.earn, quiet);
      expect(await pool.hasRole(roleHash("LOSS_REPORTER_ROLE"), old1)).to.equal(false);
    });

    it("lists every retired record and factory clone, never a live one, and hands the retired collections and deposit contracts over", async function () {
      const live = random();
      const book: Record<string, string> = { BurnerBond: live, BurnerBondPre2f: live, LiquidatorPreAudit: random(), BurnerBondLegacy: random() };
      const { contracts, skipped } = await retiredContracts((n) => (book[n] ? { address: book[n] } : null));
      expect(contracts.map((c) => c.name).sort()).to.deep.equal(["BurnerBondLegacy", "LiquidatorPreAudit"]);
      expect(skipped).to.deep.equal([{ name: "BurnerBondPre2f", address: live, liveAs: "BurnerBond" }]);
      expect(retiredRecordNames()).to.include.members(["PayoutPoolPreAudit", "BurnerBondDepositPre2f", "BondValuerLegacy"]);
      for (const n of ["BurnerBondPre2f", "BurnerBondDepositLegacy", "BurnerBondFactoryPre2f collection USDC", "BurnerBondFactoryPre2f deposit contract USDC"]) {
        expect(isRetiredBondOwnable(n), n).to.equal(true);
      }
      for (const n of ["BurnerBondFactoryPre2f", "BondValuerPre2f", "PayoutPoolPreAudit"]) expect(isRetiredBondOwnable(n), n).to.equal(false);
    });
  });

  describe("(b) scripts/check_retired_credit.ts", function () {
    const network = "hardhat-retired-check";
    const dir = path.join("deployments", network);
    const record = (name: string, c: any, address?: string) =>
      fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ address: address ?? c.target, abi: c ? abiOf(c) : [] }));

    beforeEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    /** Every kept contract but the vault, fresh and wired to nothing retired, plus the retired set. */
    async function fixture() {
      const [admin] = await ethers.getSigners();
      const k = await freshKept(admin);
      const oldPayout: any = await upgrades.deployProxy(await ethers.getContractFactory("PayoutPool"),
        [admin.address, random(), await k.usdc.getAddress(), random(), admin.address], { kind: "uups" });
      const retired = { LiquidatorPreAudit: random(), CollateralRegistryPreAudit: random(), BurnerBondPre2f: random(), NetworkRegistryPreAudit: random() };
      record("LendingPool", k.pool);
      record("ClearUSDUpgradeable", k.clrusd);
      record("BondVault", k.vault);
      record("ClaimEscrow", k.escrow);
      record("EarnControls", k.controls);
      record("AccessManager", k.access);
      record("PayoutPoolPreAudit", oldPayout);
      for (const [name, address] of Object.entries(retired)) record(name, null, address);
      // Deploy 26 refuses every retired contract on the refused list (NetworkRegistry holds no funds).
      for (const a of [retired.LiquidatorPreAudit, retired.CollateralRegistryPreAudit, retired.BurnerBondPre2f, await oldPayout.getAddress()]) {
        await k.controls.setRefused(a, true);
      }
      return { ...k, oldPayout, retired };
    }

    it("passes when every retired contract is disconnected", async function () {
      const f = await fixture();
      const lines: string[] = [];
      const r = await checkRetiredCredit({ network, reserveToken: await f.usdc.getAddress(), log: (m) => lines.push(m) });
      expect(r.failures, lines.join("\n")).to.deep.equal([]);
      const text = lines.join("\n");
      expect(text).to.contain("0 FAIL");
      expect(text).to.match(/PASS\s+LiquidatorPreAudit: no role on LendingPool, ClearUSDUpgradeable, BondVault, ClaimEscrow, EarnControls, AccessManager/);
      expect(text).to.match(/PASS\s+PayoutPoolPreAudit\.borrowedFromVault\(\): 0/);
      expect(text).to.match(/PASS\s+PayoutPoolPreAudit\.yieldPool\(\): off/);
      expect(text).to.match(/INFO\s+NetworkRegistryPreAudit: not on the refused list/);
      expect(text).to.match(/WARN\s+ESADepositVault: not recorded/);
    });

    it("fails on a lingering role and a lingering source, naming each", async function () {
      const f = await fixture();
      await f.pool.grantRole(roleHash("LIQUIDATOR_ROLE"), f.retired.LiquidatorPreAudit);
      await f.clrusd.setEncumbranceSource(f.retired.CollateralRegistryPreAudit);
      const lines: string[] = [];
      const r = await checkRetiredCredit({ network, reserveToken: await f.usdc.getAddress(), log: (m) => lines.push(m) });
      const failed = r.failures.map((x) => `${x.subject}: ${x.what}`);
      expect(failed, lines.join("\n")).to.have.length(2);
      expect(failed[0]).to.equal(`LiquidatorPreAudit: holds LendingPool LIQUIDATOR_ROLE (${f.retired.LiquidatorPreAudit})`);
      expect(failed[1]).to.equal(`ClearUSDUpgradeable.encumbranceSource(): names the retired CollateralRegistryPreAudit ${f.retired.CollateralRegistryPreAudit}`);
      expect(lines.join("\n")).to.contain("2 FAIL");

      // An open leg on the old PayoutPool, a missing refusal and a balance are reported too.
      await f.oldPayout.setYieldPool(await f.pool.getAddress());
      await f.controls.setRefused(f.retired.BurnerBondPre2f, false);
      await f.usdc.mint(f.retired.LiquidatorPreAudit, 1_500_000n);
      const again = await checkRetiredCredit({ network, reserveToken: await f.usdc.getAddress(), log: quiet });
      const more = again.failures.map((x) => `${x.subject}: ${x.what}`);
      expect(more).to.have.length(4);
      expect(more.some((m) => m.startsWith("PayoutPoolPreAudit.yieldPool(): still"))).to.equal(true);
      expect(more.some((m) => m.startsWith("BurnerBondPre2f: not refused by EarnControls"))).to.equal(true);
      expect(again.warnings.map((w) => w.what)).to.include("holds 1.5 USDC (test money, decision 50)");
    });

    it("decision 50: on a testnet the old pool's loans, legs, the backstop and balances are WARN and pass; a role still FAILs; on Base mainnet they FAIL", async function () {
      const f = await fixture();
      const [, , treasury] = await ethers.getSigners();
      const payout = await f.oldPayout.getAddress();
      const reserveToken = await f.usdc.getAddress();
      // The pre-2f loans: the vault's backstop names the old pool and both legs are owed.
      await f.vault.setBackstops(treasury.address, payout);
      await setUintByGetter(f.vault, "lentToPayoutPool", 5_000_000n);
      await f.oldPayout.setBondVault(await f.vault.getAddress());
      await f.oldPayout.setYieldPool(await f.pool.getAddress());
      await setUintByGetter(f.oldPayout, "borrowedFromVault", 5_000_000n);
      await setUintByGetter(f.oldPayout, "borrowedFromYield", 7_000_000n);
      expect([await f.oldPayout.borrowedFromVault(), await f.oldPayout.borrowedFromYield(), await f.vault.lentToPayoutPool()])
        .to.deep.equal([5_000_000n, 7_000_000n, 5_000_000n]);
      // Leftover test money in retired contracts.
      await f.usdc.mint(payout, 2_000_000n);
      await f.usdc.mint(f.retired.LiquidatorPreAudit, 250_000n);

      const leftovers = [
        "PayoutPoolPreAudit.borrowedFromVault()", "PayoutPoolPreAudit.borrowedFromYield()",
        "PayoutPoolPreAudit.yieldPool()", "PayoutPoolPreAudit.bondVault()",
        "BondVault.payoutPool()", "BondVault.lentToPayoutPool()",
        "PayoutPoolPreAudit", "LiquidatorPreAudit",
      ];
      const lines: string[] = [];
      const testnet = await checkRetiredCredit({ network, reserveToken, log: (m) => lines.push(m) });
      expect(testnet.failures, lines.join("\n")).to.deep.equal([]); // exits 0
      const noted = testnet.warnings.filter((w) => w.what.includes("(test money, decision 50)"));
      expect(noted.map((w) => w.subject)).to.have.members(leftovers);
      expect(lines.join("\n")).to.contain("0 FAIL");
      expect(lines.join("\n")).to.match(/WARN\s+PayoutPoolPreAudit\.borrowedFromYield\(\): 7000000 still owed to the Yield Pool/);
      expect(lines.join("\n")).to.match(/WARN\s+PayoutPoolPreAudit: holds 2\.0 USDC \(test money, decision 50\)/);
      // The same on Base Sepolia's chain id.
      expect((await checkRetiredCredit({ network, reserveToken, chainId: 84532, log: quiet })).failures).to.deep.equal([]);

      // A lingering role is still a FAIL on a testnet.
      await f.pool.grantRole(roleHash("LIQUIDATOR_ROLE"), f.retired.LiquidatorPreAudit);
      const role = await checkRetiredCredit({ network, reserveToken, log: quiet });
      expect(role.failures.map((x) => `${x.subject}: ${x.what}`))
        .to.deep.equal([`LiquidatorPreAudit: holds LendingPool LIQUIDATOR_ROLE (${f.retired.LiquidatorPreAudit})`]);
      // So is a leg left on once its loan is repaid (deploys 22 and 27 switch it off).
      await setUintByGetter(f.oldPayout, "borrowedFromYield", 0n);
      const leg = await checkRetiredCredit({ network, reserveToken, log: quiet });
      expect(leg.failures.map((x) => x.subject)).to.have.members(["LiquidatorPreAudit", "PayoutPoolPreAudit.yieldPool()"]);
      await setUintByGetter(f.oldPayout, "borrowedFromYield", 7_000_000n);
      await f.pool.revokeRole(roleHash("LIQUIDATOR_ROLE"), f.retired.LiquidatorPreAudit);

      // Base mainnet: the same leftovers are failures.
      const mainnet = await checkRetiredCredit({ network, reserveToken, chainId: BASE_MAINNET_CHAIN_ID, log: quiet });
      expect(mainnet.failures.map((x) => x.subject)).to.have.members(leftovers);
      expect(mainnet.failures.some((x) => x.what.includes("test money"))).to.equal(false);
      expect(mainnet.failures.find((x) => x.subject === "BondVault.lentToPayoutPool()")!.what).to.contain("repayFromPayoutPool");

      // The classification itself.
      expect(leftoverStatus(8453)).to.equal("FAIL");
      for (const id of [84532, 11155111, 31337]) expect(leftoverStatus(id), String(id)).to.equal("WARN");
      expect(isTestMoneyChain(BASE_MAINNET_CHAIN_ID)).to.equal(false);
    });

    it("has nothing to check where nothing is retired", async function () {
      const r = await checkRetiredCredit({ network, log: quiet });
      expect(r.failures).to.deep.equal([]);
      expect(r.findings.map((x) => x.what)).to.deep.equal(["nothing retired on record: nothing to check"]);
    });
  });
});

/** The kept contracts, fresh: the Yield Pool, CLRUSD, BondVault, ClaimEscrow, EarnControls and the AccessManager. */
async function freshKept(admin: any) {
  const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
  const poolProxy = await upgrades.deployProxy(await ethers.getContractFactory("LendingPool", admin),
    [admin.address, await usdc.getAddress(), "Clear Lending Pool", "clrLP"], await poolProxyOptions(admin));
  const pool = await poolAt(await poolProxy.getAddress(), admin);
  const clrusd: any = await upgrades.deployProxy(await ethers.getContractFactory("ClearUSDUpgradeable"),
    ["Clear USD", "CLRUSD", 6, 0, 0, admin.address, admin.address],
    { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
  const vault: any = await upgrades.deployProxy(await ethers.getContractFactory("BondVault"),
    [admin.address, await usdc.getAddress(), 0], { kind: "uups" });
  const escrow: any = await upgrades.deployProxy(await ethers.getContractFactory("ClaimEscrow"),
    [await usdc.getAddress(), admin.address, admin.address], { kind: "uups" });
  const access: any = await upgrades.deployProxy(await ethers.getContractFactory("AccessManager"), [admin.address]);
  const controls = await deployEarnControls(admin);
  return { usdc, pool, clrusd, vault, escrow, access, controls };
}
