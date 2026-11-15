import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { DAY, HOUR, U, deployYieldPool, increase, latest } from "../helpers/yieldPool";

/*
 * Phase 2f, stage 1: the Collateral Agent, IV-10 Exhibit A (decisions 18 and 19), with Earn
 * acceptance tests 8 to 10 (the Agent's halves). Stage 2's BondVault, bonds and pledge module are
 * mocks (`MockAgentSide.sol`) that call the Agent the way the report says stage 2 must.
 */
const NOTICE = ethers.id("enforcement notice");
const DIRECTION = ethers.id("required holders direction");
const PAYMENT_DEFAULT = 1;
const AGENT_KEY = 1;
const COLLATERAL_ACCOUNT = 2;

describe("CollateralAgent (IV-10 Exhibit A; decisions 18, 19)", function () {
  let admin: any, key: any, newKey: any, t1: any, t2: any, alice: any, bob: any, carol: any;
  let collateral: any, costs: any, excess: any, outsider: any;
  let usdc: any, vault: any, book: any, pledge: any, agent: any;
  let maturedAt: number;

  async function deploy(fund = U(100_000)) {
    [admin, key, newKey, t1, t2, alice, bob, carol, collateral, costs, excess, outsider] = await ethers.getSigners();
    usdc = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
    vault = await (await ethers.getContractFactory("MockAgentVault")).deploy(await usdc.getAddress());
    book = await (await ethers.getContractFactory("MockAgentBondBook")).deploy();
    pledge = await (await ethers.getContractFactory("MockAgentPledgeModule")).deploy();
    agent = await upgrades.deployProxy(
      await ethers.getContractFactory("CollateralAgent"),
      [admin.address, key.address, [t1.address, t2.address], 6, {
        vault: await vault.getAddress(),
        bondBook: await book.getAddress(),
        pledgeModule: await pledge.getAddress(),
        payeeSource: await pledge.getAddress(),
        collateralAccount: collateral.address,
        costAddress: costs.address,
        excessDestination: excess.address,
      }],
      { kind: "uups" }
    );
    for (const c of [vault, book, pledge]) await c.setAgent(await agent.getAddress());
    await usdc.mint(await vault.getAddress(), fund);
    maturedAt = (await latest()) - DAY;
    // Test 8's bonds: owed $30,000 and $10,000 (both matured, so owed their Maturity Amount).
    await book.add(1, alice.address, U(30_000), 500, maturedAt);
    await book.add(2, bob.address, U(10_000), 500, maturedAt);
  }

  beforeEach(async function () {
    await deploy();
  });

  /** propose (t1), confirm (t2), co-sign (Agent Key), then 7 days: the change process. */
  async function cosigned(target: string, data: string) {
    const callHash = ethers.keccak256(data);
    await agent.connect(t1).proposeChange(target, callHash, ethers.id("description"));
    const id = await agent.openChangeFor(target, callHash);
    await agent.connect(t2).confirmChange(id);
    await agent.connect(key).approveChange(id);
    await increase(7 * DAY);
    return id;
  }

  async function enforceAndSnapshot() {
    await agent.connect(key).enforce(PAYMENT_DEFAULT, NOTICE);
    await agent.snapshotBonds(10);
  }

  describe("Part 2 items 1-2: the Enforcement Notice", function () {
    it("only the Agent Key records it, at once, and only the Agent Key withdraws it", async function () {
      await expect(agent.connect(t1).enforce(PAYMENT_DEFAULT, NOTICE)).to.be.revertedWithCustomError(agent, "CollateralAgentNotAgent");
      await expect(agent.connect(key).enforce(PAYMENT_DEFAULT, ethers.ZeroHash)).to.be.revertedWithCustomError(agent, "CollateralAgentInvalidValue");
      await expect(agent.connect(key).enforce(PAYMENT_DEFAULT, NOTICE))
        .to.emit(agent, "EnforcementNoticeRecorded").withArgs(1, PAYMENT_DEFAULT, NOTICE, U(100_000));
      expect(await agent.enforcementInForce()).to.equal(true);
      await expect(agent.connect(key).enforce(PAYMENT_DEFAULT, NOTICE)).to.be.revertedWithCustomError(agent, "CollateralAgentInForce");
      await expect(agent.connect(t1).releaseEnforcement(DIRECTION)).to.be.revertedWithCustomError(agent, "CollateralAgentNotAgent");
      await expect(agent.connect(key).releaseEnforcement(DIRECTION)).to.emit(agent, "EnforcementReleased").withArgs(1, DIRECTION);
      expect(await agent.enforcementInForce()).to.equal(false);
    });

    it("stops excess withdrawals, settlements and rolls (even confirmed ones) in the same block (decision 19)", async function () {
      await book.connect(alice).confirmRoll(1);
      await book.roll(1);
      const id = await agent.connect(t1).proposeExcessWithdrawal.staticCall(U(1_000));
      await agent.connect(t1).proposeExcessWithdrawal(U(1_000));
      await agent.connect(key).enforce(PAYMENT_DEFAULT, NOTICE);
      await expect(book.roll(1)).to.be.revertedWithCustomError(book, "InForce");
      await expect(vault.settle(alice.address, U(1))).to.be.revertedWithCustomError(vault, "InForce");
      await expect(agent.connect(t2).executeExcessWithdrawal(id)).to.be.revertedWithCustomError(agent, "CollateralAgentInForce");
    });

    it("while no Enforcement Notice is in effect, no other Agent action stops a settlement (test 10; Part 3.6)", async function () {
      const statement = ethers.id("s");
      await expect(agent.connect(key).postCostStatement(statement, U(1))).to.be.revertedWithCustomError(agent, "CollateralAgentNotInForce");
      await expect(agent.connect(key).postDistribution(U(1), 1)).to.be.revertedWithCustomError(agent, "CollateralAgentNotInForce");
      await expect(agent.connect(key).toCollateralAccount(U(1))).to.be.revertedWithCustomError(agent, "CollateralAgentNotInForce");
      await agent.connect(key).rotateAgentKey(newKey.address);
      await vault.settle(alice.address, U(30_000));
      expect(await usdc.balanceOf(alice.address)).to.equal(U(30_000));
    });
  });

  describe("Part 2 item 3: distribution rounds (test 8)", function () {
    it("$10,000 across bonds owed $30,000 and $10,000 pays $7,500 and $2,500; the Agent sets only the total", async function () {
      await agent.connect(key).enforce(PAYMENT_DEFAULT, NOTICE);
      await expect(agent.connect(key).postDistribution(U(10_000), 1)).to.be.revertedWithCustomError(agent, "CollateralAgentSnapshotIncomplete");
      await expect(agent.snapshotBonds(1)).to.emit(agent, "SnapshotTaken").withArgs(1, 1, U(30_000), false);
      await expect(agent.claimDistribution(1)).to.be.revertedWithCustomError(agent, "CollateralAgentSnapshotIncomplete");
      await expect(agent.snapshotBonds(5)).to.emit(agent, "SnapshotTaken").withArgs(1, 2, U(40_000), true);
      await expect(agent.connect(t1).postDistribution(U(10_000), 1)).to.be.revertedWithCustomError(agent, "CollateralAgentNotAgent");
      await expect(agent.connect(key).postDistribution(U(10_000), 1)).to.emit(agent, "DistributionPosted");
      await expect(agent.connect(key).postDistribution(U(1), 1)).to.be.revertedWithCustomError(agent, "CollateralAgentRoundExists");
      // The only distribution entry point takes a total and a round id: nothing per bond.
      const frag = agent.interface.getFunction("postDistribution");
      expect(frag.inputs.map((i: any) => i.name)).to.deep.equal(["amount", "roundId"]);

      expect(await agent.claimable(1)).to.equal(U(7_500));
      expect(await agent.claimable(2)).to.equal(U(2_500));
      await expect(agent.connect(outsider).claimDistribution(1))
        .to.emit(agent, "DistributionPaid").withArgs(1, alice.address, alice.address, 0, U(7_500));
      await agent.connect(outsider).claimDistribution(2);
      expect(await usdc.balanceOf(alice.address)).to.equal(U(7_500));
      expect(await usdc.balanceOf(bob.address)).to.equal(U(2_500));
      await expect(agent.claimDistribution(1)).to.be.revertedWithCustomError(agent, "CollateralAgentNothingOwed");
      expect(await agent.unclaimedDistributions()).to.equal(0n);
    });

    it("never distributes more than is due; a bond paid in full is burned", async function () {
      await enforceAndSnapshot();
      await agent.connect(key).postDistribution(U(10_000), 1);
      await expect(agent.connect(key).postDistribution(U(30_001), 2)).to.be.revertedWithCustomError(agent, "CollateralAgentOverDistributed");
      await agent.connect(key).postDistribution(U(30_000), 2);
      await expect(agent.claimDistribution(1)).to.emit(agent, "BondPaidInFull").withArgs(1, U(30_000));
      expect((await book.bonds(1)).burned).to.equal(true);
      expect(await usdc.balanceOf(alice.address)).to.equal(U(30_000));
    });

    it("values an unmatured bond at its Accreted Value at the enforcement time", async function () {
      const maturity = (await latest()) + 365 * DAY + 100;
      await book.add(3, carol.address, U(10_500), 500, maturity);
      await agent.connect(key).enforce(PAYMENT_DEFAULT, NOTICE);
      const at = (await agent.period(1)).enforcedAt;
      await agent.snapshotBonds(10);
      const acc = await (await ethers.getContractFactory("AccretionHarness")).deploy();
      const expected = await acc.accretedValue(U(10_500), 500, maturity, at);
      expect((await agent.dueOf(1, 3)).due).to.equal(expected);
      expect(expected).to.be.lessThan(U(10_000)); // 366 days at 5%: under $10,000
    });

    it("needs the USDC on hand, keeps posted rounds claimable after release, and the vault keeps them out of excess", async function () {
      await deploy(U(5_000));
      await enforceAndSnapshot();
      await expect(agent.connect(key).postDistribution(U(5_001), 1)).to.be.revertedWithCustomError(agent, "CollateralAgentInsufficient");
      await agent.connect(key).postDistribution(U(4_000), 1);
      await expect(agent.connect(key).toCollateralAccount(U(1_001))).to.be.revertedWithCustomError(agent, "CollateralAgentInsufficient");
      await agent.connect(key).releaseEnforcement(DIRECTION);
      expect(await vault.deployableExcess()).to.equal(U(1_000));
      await agent.claimDistribution(2);
      expect(await usdc.balanceOf(bob.address)).to.equal(U(1_000));
    });
  });

  describe("decision 19: a pledged bond's share goes to its Defaulted Amount first", function () {
    it("only while MB-05 §6.1 permits enforcement against it; the ratable share is unchanged", async function () {
      await pledge.setDefaulted(alice.address, U(1_000));
      await enforceAndSnapshot();
      await agent.connect(key).postDistribution(U(10_000), 1);
      expect(await agent.routeDistribution(1, alice.address, U(7_500))).to.deep.equal([0n, U(7_500)]);
      await pledge.setPermitted(alice.address, 1, true);
      expect(await agent.routeDistribution(1, alice.address, U(7_500))).to.deep.equal([U(1_000), U(6_500)]);
      expect(await agent.claimable(1)).to.equal(U(7_500));
      await expect(agent.claimDistribution(1)).to.emit(agent, "DistributionPaid").withArgs(1, alice.address, alice.address, U(1_000), U(6_500));
      expect(await pledge.applied(alice.address)).to.equal(U(1_000));
      expect(await usdc.balanceOf(await pledge.getAddress())).to.equal(U(1_000));
      expect(await usdc.balanceOf(alice.address)).to.equal(U(6_500));
      // With the Defaulted Amount paid, the next round goes wholly to the Holder.
      await agent.connect(key).postDistribution(U(4_000), 2);
      await expect(agent.claimDistribution(1)).to.emit(agent, "DistributionPaid").withArgs(1, alice.address, alice.address, 0, U(3_000));
    });

    it("pays a Successor registered for payment instead of the Holder's account (IV-10 §7.6)", async function () {
      await pledge.setPayee(bob.address, carol.address);
      await enforceAndSnapshot();
      await agent.connect(key).postDistribution(U(4_000), 1);
      await agent.claimDistribution(2);
      expect(await usdc.balanceOf(carol.address)).to.equal(U(1_000));
    });
  });

  describe("Part 2 items 4-5: the Collateral Deposit Account and costs (test 9)", function () {
    it("moves USDC only to the registered Collateral Deposit Account, only in an Enforcement Period", async function () {
      await agent.connect(key).enforce(PAYMENT_DEFAULT, NOTICE);
      await expect(agent.connect(key).toCollateralAccount(U(1_000)))
        .to.emit(agent, "CollateralAccountTransfer").withArgs(1, collateral.address, U(1_000));
      expect(await usdc.balanceOf(collateral.address)).to.equal(U(1_000));
      const frag = agent.interface.getFunction("toCollateralAccount");
      expect(frag.inputs.length).to.equal(1); // no destination argument
    });

    it("withdraws costs only 7 days after the statement, within it and within the cap, to the cost address", async function () {
      const s = ethers.id("statement 1");
      await expect(agent.connect(key).withdrawCosts(U(1), s)).to.be.revertedWithCustomError(agent, "CollateralAgentNotInForce");
      await agent.connect(key).enforce(PAYMENT_DEFAULT, NOTICE);
      expect(await agent.costCap()).to.equal(U(50_000)); // greater of $50,000 and 2% of $100,000
      await agent.connect(key).postCostStatement(s, U(60_000));
      await expect(agent.connect(key).withdrawCosts(U(1_000), s)).to.be.revertedWithCustomError(agent, "CollateralAgentStatement");
      await increase(7 * DAY);
      await expect(agent.connect(key).withdrawCosts(U(50_001), s)).to.be.revertedWithCustomError(agent, "CollateralAgentCostCap");
      await expect(agent.connect(key).withdrawCosts(U(10_000), s))
        .to.emit(agent, "CostsWithdrawn").withArgs(1, s, costs.address, U(10_000), U(50_000));
      expect(await usdc.balanceOf(costs.address)).to.equal(U(10_000));
      // A Required-Holder approval raises the cap 7 days after it is recorded.
      await agent.connect(key).recordCostApproval(DIRECTION, U(5_000));
      expect(await agent.costCap()).to.equal(U(50_000));
      await increase(7 * DAY);
      expect(await agent.costCap()).to.equal(U(55_000));
      await agent.connect(key).withdrawCosts(U(45_000), s);
      await expect(agent.connect(key).withdrawCosts(U(1), s)).to.be.revertedWithCustomError(agent, "CollateralAgentCostCap");
    });

    it("takes 2% of the Collateral at the start when that is above $50,000", async function () {
      await deploy(U(5_000_000));
      await agent.connect(key).enforce(PAYMENT_DEFAULT, NOTICE);
      expect(await agent.costCap()).to.equal(U(100_000));
    });
  });

  describe("Part 3: what the Agent Key cannot do (test 9)", function () {
    it("cannot pay anyone directly, burn a bond, withdraw excess, propose or make a change, grant a role or upgrade", async function () {
      await expect(vault.connect(key).agentTransfer(key.address, 1n)).to.be.revertedWithCustomError(vault, "NotAgent");
      await expect(book.connect(key).burnPaid(1)).to.be.revertedWithCustomError(book, "NotAgent");
      await expect(agent.connect(key).proposeExcessWithdrawal(1n)).to.be.reverted;
      await expect(agent.connect(key).executeExcessWithdrawal(1n)).to.be.reverted;
      await expect(agent.connect(key).proposeChange(await vault.getAddress(), ethers.id("x"), ethers.ZeroHash)).to.be.reverted;
      await expect(agent.connect(key).confirmChange(ethers.id("x"))).to.be.reverted;
      await expect(agent.connect(key).setCostAddress(key.address)).to.be.reverted;
      await expect(agent.connect(key).grantRole(await agent.TREASURY_ROLE(), key.address)).to.be.reverted;
      await expect(agent.connect(key).proposeReplacement(AGENT_KEY, key.address, ethers.id("i"))).to.be.reverted;
      const impl = await upgrades.prepareUpgrade(await agent.getAddress(), await ethers.getContractFactory("CollateralAgent"), { kind: "uups" });
      await expect(agent.connect(key).upgradeTo(impl)).to.be.reverted;
      // The Agent Key holds no role in this contract.
      for (const r of [ethers.ZeroHash, await agent.TREASURY_ROLE()]) expect(await agent.hasRole(r, key.address)).to.equal(false);
    });

    it("has no power over the pledge module, roll confirmations or the Loss Holdback", async function () {
      // Roll confirmations are the Holder's alone.
      await expect(book.connect(key).confirmRoll(1)).to.be.revertedWithCustomError(book, "NotHolder");
      // The real pledge module (CollateralRegistry): neither the key nor this contract holds a role.
      const registry: any = await upgrades.deployProxy(await ethers.getContractFactory("CollateralRegistry"), [admin.address, admin.address], { kind: "uups" });
      const KIND = ethers.encodeBytes32String("BOND");
      await expect(registry.connect(key).pledgeItem(alice.address, KIND, 1, ethers.id("mi"), 0, "0x")).to.be.reverted;
      await expect(registry.connect(key).releaseItem(alice.address, KIND, 1)).to.be.reverted;
      await expect(registry.connect(key).rollItem(alice.address, KIND, 1, 2)).to.be.reverted;
      await expect(registry.connect(key).setCollateralTerms(KIND, 9_500, U(1))).to.be.reverted;
      // The real Yield Pool and its Loss Holdback.
      // (The pool fixture's alice is this suite's Agent Key, so bob is the Holder here.)
      const f = await deployYieldPool();
      await f.pool.connect(f.bob).deposit(U(10_000), f.bob.address);
      await f.allowance(U(150));
      await f.pool.connect(f.bob).redeem(U(1_000), f.bob.address, f.bob.address);
      for (const [fn, args] of [
        ["postAllowance", [0n, ethers.id("e")]],
        ["postLossCharge", [U(1), ethers.id("e")]],
        ["setHoldbackMaxAge", [DAY]],
        ["enforcementRedeem", [f.bob.address, 1n]],
        ["suspend", [1, ethers.id("e"), ethers.ZeroHash]],
      ] as [string, unknown[]][]) {
        await expect(f.pool.connect(key)[fn](...args), fn).to.be.reverted;
      }
      // The permissionless holdback processing pays only the Holder, whoever sends it.
      await f.allowance(0n);
      const before = await f.usdc.balanceOf(key.address);
      const held = await f.usdc.balanceOf(f.bob.address);
      await f.pool.connect(key).releaseHoldbacks(10);
      expect(await f.usdc.balanceOf(key.address)).to.equal(before);
      expect(await f.usdc.balanceOf(f.bob.address)).to.be.greaterThan(held);
      for (const r of [ethers.ZeroHash, await registry.OPERATOR_ROLE(), await registry.ITEM_ROLLER_ROLE()]) {
        expect(await registry.hasRole(r, key.address)).to.equal(false);
        expect(await registry.hasRole(r, await agent.getAddress())).to.equal(false);
      }
    });

    it("its whole surface is Part 2's seven powers and the records that go with them", async function () {
      const agentOnly = new Set([
        "enforce", "releaseEnforcement", "postDistribution", "toCollateralAccount", "postCostStatement",
        "recordCostApproval", "withdrawCosts", "approveChange", "rotateAgentKey", "recordHolderBlock",
      ]);
      const permissionless = new Set(["snapshotBonds", "claimDistribution", "syncAgentKey", "executeReplacement", "consumeChange"]);
      const treasury = new Set([
        "proposeExcessWithdrawal", "executeExcessWithdrawal", "proposeChange", "confirmChange", "cancelChange",
        "proposeReplacement", "approveReplacement", "cancelReplacement",
      ]);
      const governed = new Set([
        "setVault", "setBondBook", "setPledgeModule", "setPayeeSource", "setCostAddress", "setExcessDestination",
        "grantRole", "revokeRole", "renounceRole", "upgradeTo", "upgradeToAndCall", "initialize",
      ]);
      const writes = agent.interface.fragments
        .filter((x: any) => x.type === "function" && !["view", "pure"].includes(x.stateMutability))
        .map((x: any) => x.name);
      for (const name of writes) {
        expect(agentOnly.has(name) || permissionless.has(name) || treasury.has(name) || governed.has(name), name).to.equal(true);
      }
    });
  });

  describe("Part 2 item 6 and IV-10 §4.5: every change needs two treasury signers, the Agent's co-signature and 7 days", function () {
    it("gates the BondVault's governed calls", async function () {
      const data = vault.interface.encodeFunctionData("setRequiredReserve", [U(750)]);
      const target = await vault.getAddress();
      await expect(vault.setRequiredReserve(U(750))).to.be.revertedWithCustomError(agent, "CollateralAgentChangeNotReady");
      await agent.connect(t1).proposeChange(target, ethers.keccak256(data), ethers.id("d"));
      const id = await agent.openChangeFor(target, ethers.keccak256(data));
      await expect(agent.connect(t1).confirmChange(id)).to.be.revertedWithCustomError(agent, "CollateralAgentSameSigner");
      await agent.connect(t2).confirmChange(id);
      await increase(7 * DAY);
      await expect(vault.setRequiredReserve(U(750))).to.be.revertedWithCustomError(agent, "CollateralAgentChangeNotReady");
      await expect(agent.connect(key).approveChange(id)).to.emit(agent, "ChangeApproved").withArgs(id, key.address);
      await expect(vault.setRequiredReserve(U(750))).to.emit(agent, "ChangeExecuted");
      expect(await vault.requiredReserve()).to.equal(U(750));
      await expect(vault.setRequiredReserve(U(750))).to.be.revertedWithCustomError(agent, "CollateralAgentChangeNotReady");
    });

    it("refuses a co-signed change before 7 days, and only the exact call", async function () {
      const data = vault.interface.encodeFunctionData("setRequiredReserve", [U(750)]);
      const target = await vault.getAddress();
      await agent.connect(t1).proposeChange(target, ethers.keccak256(data), ethers.id("d"));
      const id = await agent.openChangeFor(target, ethers.keccak256(data));
      await agent.connect(t2).confirmChange(id);
      await agent.connect(key).approveChange(id);
      await increase(7 * DAY - 10);
      await expect(vault.setRequiredReserve(U(750))).to.be.revertedWithCustomError(agent, "CollateralAgentChangeNotReady");
      await increase(10);
      await expect(vault.setRequiredReserve(U(751))).to.be.revertedWithCustomError(agent, "CollateralAgentChangeNotReady");
      await vault.setRequiredReserve(U(750));
    });

    it("gates its own settings, roles and upgrades, which also need the admin (the Earn timelock)", async function () {
      const data = agent.interface.encodeFunctionData("setCostAddress", [outsider.address]);
      await expect(agent.setCostAddress(outsider.address)).to.be.revertedWithCustomError(agent, "CollateralAgentChangeNotReady");
      await cosigned(await agent.getAddress(), data);
      await expect(agent.connect(t1).setCostAddress(outsider.address)).to.be.reverted;
      await agent.setCostAddress(outsider.address);
      expect(await agent.costAddress()).to.equal(outsider.address);

      const role = await agent.TREASURY_ROLE();
      await expect(agent.grantRole(role, outsider.address)).to.be.revertedWithCustomError(agent, "CollateralAgentChangeNotReady");
      await cosigned(await agent.getAddress(), agent.interface.encodeFunctionData("grantRole", [role, outsider.address]));
      await agent.grantRole(role, outsider.address);
      expect(await agent.hasRole(role, outsider.address)).to.equal(true);

      const impl = await upgrades.prepareUpgrade(await agent.getAddress(), await ethers.getContractFactory("CollateralAgent"), { kind: "uups" });
      await expect(agent.upgradeTo(impl)).to.be.revertedWithCustomError(agent, "CollateralAgentChangeNotReady");
      await cosigned(await agent.getAddress(), agent.interface.encodeFunctionData("upgradeTo", [impl]));
      await agent.upgradeTo(impl);
    });

    it("a treasury signer may withdraw a change not yet made", async function () {
      const data = vault.interface.encodeFunctionData("setRequiredReserve", [1n]);
      const target = await vault.getAddress();
      await agent.connect(t1).proposeChange(target, ethers.keccak256(data), ethers.id("d"));
      const id = await agent.openChangeFor(target, ethers.keccak256(data));
      await expect(agent.connect(t2).cancelChange(id)).to.emit(agent, "ChangeCancelled");
      await expect(agent.connect(key).approveChange(id)).to.be.revertedWithCustomError(agent, "CollateralAgentChange");
    });
  });

  describe("Part 2 item 7 and Part 4: the Agent Key", function () {
    it("rotates by the current key, effective after 48 hours; rotating to itself cancels", async function () {
      await expect(agent.connect(key).rotateAgentKey(newKey.address)).to.emit(agent, "AgentKeyRotationStarted");
      await increase(48 * HOUR - 10);
      expect(await agent.agentKey()).to.equal(key.address);
      await agent.connect(key).rotateAgentKey(key.address);
      await increase(20);
      expect(await agent.agentKey()).to.equal(key.address);
      await agent.connect(key).rotateAgentKey(newKey.address);
      await increase(48 * HOUR);
      expect(await agent.agentKey()).to.equal(newKey.address);
      await expect(agent.connect(key).enforce(PAYMENT_DEFAULT, NOTICE)).to.be.revertedWithCustomError(agent, "CollateralAgentNotAgent");
      await agent.connect(newKey).enforce(PAYMENT_DEFAULT, NOTICE);
    });

    it("replaces a lost key on the Agent's instruction, two treasury signers and 7 days, unless the Required Holders block it", async function () {
      await agent.connect(key).enforce(PAYMENT_DEFAULT, NOTICE);
      await agent.connect(t1).proposeReplacement(AGENT_KEY, newKey.address, ethers.id("instruction"));
      await expect(agent.connect(t1).approveReplacement(1)).to.be.revertedWithCustomError(agent, "CollateralAgentSameSigner");
      await expect(agent.executeReplacement(1)).to.be.revertedWithCustomError(agent, "CollateralAgentReplacement");
      await agent.connect(t2).approveReplacement(1);
      await increase(7 * DAY - 10);
      await expect(agent.executeReplacement(1)).to.be.revertedWithCustomError(agent, "CollateralAgentReplacement");
      // A Required-Holder Direction, recorded by the Agent (here through the proposed key in its custody), blocks it.
      await expect(agent.connect(outsider).recordHolderBlock(1, DIRECTION)).to.be.revertedWithCustomError(agent, "CollateralAgentNotAgent");
      await expect(agent.connect(newKey).recordHolderBlock(1, DIRECTION)).to.emit(agent, "ReplacementBlocked");
      await increase(10);
      await expect(agent.executeReplacement(1)).to.be.revertedWithCustomError(agent, "CollateralAgentReplacement");

      await agent.connect(t2).proposeReplacement(AGENT_KEY, newKey.address, ethers.id("instruction 2"));
      await agent.connect(t1).approveReplacement(2);
      await increase(7 * DAY);
      await expect(agent.connect(outsider).executeReplacement(2)).to.emit(agent, "ReplacementExecuted").withArgs(2, AGENT_KEY, key.address, newKey.address);
      expect(await agent.agentKey()).to.equal(newKey.address);
      // An Enforcement Notice in effect stays in effect.
      expect(await agent.enforcementInForce()).to.equal(true);
    });

    it("changes the Collateral Deposit Account only by the same procedure", async function () {
      await agent.connect(t1).proposeReplacement(COLLATERAL_ACCOUNT, outsider.address, ethers.id("instruction"));
      await agent.connect(t2).approveReplacement(1);
      await expect(agent.connect(newKey).recordHolderBlock(1, DIRECTION)).to.be.revertedWithCustomError(agent, "CollateralAgentNotAgent");
      await increase(7 * DAY);
      await agent.executeReplacement(1);
      expect(await agent.collateralAccount()).to.equal(outsider.address);
    });
  });

  describe("Part 5: Clear Lending's treasury role", function () {
    it("withdraws deployable excess only to its registered multisig, proposed and executed by different signers", async function () {
      // The mock's reserve is zero: everything held is excess.
      const id = await agent.connect(t1).proposeExcessWithdrawal.staticCall(U(1_000));
      await agent.connect(t1).proposeExcessWithdrawal(U(1_000));
      await expect(agent.connect(t1).executeExcessWithdrawal(id)).to.be.revertedWithCustomError(agent, "CollateralAgentSameSigner");
      await expect(agent.connect(t2).executeExcessWithdrawal(id))
        .to.emit(agent, "ExcessWithdrawn").withArgs(id, excess.address, U(1_000), t1.address, t2.address);
      expect(await usdc.balanceOf(excess.address)).to.equal(U(1_000));
      await expect(agent.connect(t2).executeExcessWithdrawal(id)).to.be.revertedWithCustomError(agent, "CollateralAgentExcess");
      const big = await agent.connect(t1).proposeExcessWithdrawal.staticCall(U(100_000));
      await agent.connect(t1).proposeExcessWithdrawal(U(100_000));
      await expect(agent.connect(t2).executeExcessWithdrawal(big)).to.be.revertedWithCustomError(agent, "CollateralAgentInsufficient");
      expect(agent.interface.getFunction("executeExcessWithdrawal").inputs.length).to.equal(1); // no destination argument
    });
  });

  it("refuses to start without two treasury signers, or with the Agent Key among them", async function () {
    const F = await ethers.getContractFactory("CollateralAgent");
    const cfg = {
      vault: await vault.getAddress(), bondBook: await book.getAddress(), pledgeModule: ethers.ZeroAddress, payeeSource: ethers.ZeroAddress,
      collateralAccount: collateral.address, costAddress: costs.address, excessDestination: excess.address,
    };
    await expect(upgrades.deployProxy(F, [admin.address, key.address, [t1.address], 6, cfg], { kind: "uups" })).to.be.reverted;
    await expect(upgrades.deployProxy(F, [admin.address, key.address, [t1.address, key.address], 6, cfg], { kind: "uups" })).to.be.reverted;
  });
});
