import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import {
  deployVaultTimelock, handOverVault, acceptanceCalls, assertNoVaultAdmin, assertTwoPersonSafe, successorTrusteeCalls,
  VAULT_TIMELOCK_DELAY,
} from "../../deploy/vault_timelock_handover";

/**
 * Phase 2d, decision 1: the fourth timelock (7 days, a Clear Financial Safe proposing) governs
 * ESADepositVault and CLRUSD. Run on a fresh chain with a 2-of-3 stand-in Safe: the handover, the
 * Safe's acceptance through the timelock, governed role grants and upgrades, and a successor
 * trustee taking over without the reserve moving.
 */
const ONE_USDC = 10n ** 6n;

async function advance(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

describe("vault timelock handover (Phase 2d)", function () {
  async function setup() {
    const [deployer, o1, o2, o3, n1, n2, relayer, pA, pB, member, stranger, newRelayer] = await ethers.getSigners();
    const Safe = await ethers.getContractFactory("MockSafe");
    const safe: any = await Safe.deploy([o1.address, o2.address, o3.address], 2);
    const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
    const clrusd: any = await upgrades.deployProxy(await ethers.getContractFactory("ClearUSDUpgradeable"),
      ["Clear USD", "CLRUSD", 6, 0, 0, deployer.address, deployer.address],
      { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
    const vault: any = await upgrades.deployProxy(await ethers.getContractFactory("ESADepositVault"), [await clrusd.getAddress(), deployer.address], { kind: "uups" });
    await clrusd.grantMintAndBurnRoles(await vault.getAddress());
    await vault.setAcceptedToken(await usdc.getAddress(), true);
    await usdc.mint(member.address, 1_000n * ONE_USDC);
    await usdc.connect(member).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(member).deposit(await usdc.getAddress(), 1_000n * ONE_USDC, member.address);
    const timelock: any = await deployVaultTimelock(await safe.getAddress());
    return { deployer, o1, o2, o3, n1, n2, relayer, pA, pB, member, stranger, newRelayer, safe, usdc, clrusd, vault, timelock };
  }

  /** Two of the Safe's owners schedule a batch, and after 7 days two execute it. */
  async function throughTimelock(safe: any, owners: any[], timelock: any, calls: { targets: string[]; values: bigint[]; payloads: string[] }, salt: string) {
    const t = await timelock.getAddress();
    const schedule = timelock.interface.encodeFunctionData("scheduleBatch", [calls.targets, calls.values, calls.payloads, ethers.ZeroHash, salt, VAULT_TIMELOCK_DELAY]);
    for (const o of owners) await safe.connect(o).confirmAndExecute(t, schedule);
    await advance(VAULT_TIMELOCK_DELAY);
    const execute = timelock.interface.encodeFunctionData("executeBatch", [calls.targets, calls.values, calls.payloads, ethers.ZeroHash, salt]);
    for (const o of owners) await safe.connect(o).confirmAndExecute(t, execute);
  }

  it("refuses a delay under 7 days, and a Safe that one person can run", async function () {
    const { o1, o2, safe } = await setup();
    await expect(deployVaultTimelock(await safe.getAddress(), VAULT_TIMELOCK_DELAY - 1)).to.be.rejectedWith("at least 7 days");
    await expect(assertTwoPersonSafe(o1.address)).to.be.rejectedWith("no code");
    const one: any = await (await ethers.getContractFactory("MockSafe")).deploy([o1.address, o2.address], 1);
    await expect(assertTwoPersonSafe(await one.getAddress())).to.be.rejectedWith("must need two signers");
    expect((await assertTwoPersonSafe(await safe.getAddress())).threshold).to.equal(2);
  });

  it("moves every vault and CLRUSD power to the timelock, leaves the deployer nothing, and needs two Safe owners and 7 days for any change", async function () {
    const { deployer, o1, o2, relayer, pA, pB, member, stranger, safe, usdc, clrusd, vault, timelock } = await setup();
    const t = await timelock.getAddress();
    const c = { vault, clrusd };
    const pending = await handOverVault(c, deployer, t, { relayers: [relayer.address], pausers: [pA.address, pB.address], pilot: [pA.address, pB.address], fraud: [pA.address, pB.address], security: [pA.address, pB.address] });
    expect(pending.map((p) => p.what)).to.deep.equal(["CLRUSD: the timelock accepts DEFAULT_ADMIN_ROLE (after the token's admin delay)"]);
    // Until the Safe accepts, CLRUSD's default admin is still the deployer, pending to the timelock.
    await expect(assertNoVaultAdmin(c, deployer.address)).to.be.rejectedWith("clrusd.DEFAULT_ADMIN_ROLE");

    // One owner alone schedules nothing.
    const calls = acceptanceCalls(pending);
    const schedule = timelock.interface.encodeFunctionData("scheduleBatch", [calls.targets, calls.values, calls.payloads, ethers.ZeroHash, ethers.id("accept"), VAULT_TIMELOCK_DELAY]);
    await safe.connect(o1).confirmAndExecute(t, schedule);
    expect(await timelock.isOperation(await timelock.hashOperationBatch(calls.targets, calls.values, calls.payloads, ethers.ZeroHash, ethers.id("accept")))).to.equal(false);
    await safe.connect(o2).confirmAndExecute(t, schedule);
    await advance(VAULT_TIMELOCK_DELAY);
    const execute = timelock.interface.encodeFunctionData("executeBatch", [calls.targets, calls.values, calls.payloads, ethers.ZeroHash, ethers.id("accept")]);
    await safe.connect(o1).confirmAndExecute(t, execute);
    await safe.connect(o2).confirmAndExecute(t, execute);

    await assertNoVaultAdmin(c, deployer.address, { timelock: t });
    expect(await clrusd.defaultAdmin()).to.equal(t);
    expect(await clrusd.getCCIPAdmin()).to.equal(t);
    expect(await clrusd.hasRole(await clrusd.UPGRADER_ROLE(), t)).to.equal(true);
    expect(await vault.hasRole(ethers.ZeroHash, t)).to.equal(true);
    expect(await vault.hasRole(await vault.RELAYER_ROLE(), relayer.address)).to.equal(true);

    // Decision 3: nobody but the Safe, through the delay, grants a mint or liquidator role.
    for (const who of [deployer, relayer, pA, stranger]) {
      await expect(clrusd.connect(who).grantRole(await clrusd.MINTER_ROLE(), stranger.address)).to.be.reverted;
      await expect(clrusd.connect(who).grantRole(await clrusd.LIQUIDATOR_ROLE(), stranger.address)).to.be.reverted;
      await expect(vault.connect(who).setAcceptedToken(stranger.address, true)).to.be.reverted;
      await expect(vault.connect(who).setPilotOff(true)).to.be.reverted;
    }
    const liquidator = ethers.Wallet.createRandom().address;
    await throughTimelock(safe, [o1, o2], timelock, {
      targets: [await clrusd.getAddress()], values: [0n],
      payloads: [clrusd.interface.encodeFunctionData("grantRole", [await clrusd.LIQUIDATOR_ROLE(), liquidator])],
    }, ethers.id("liquidator"));
    expect(await clrusd.hasRole(await clrusd.LIQUIDATOR_ROLE(), liquidator)).to.equal(true);

    // An upgrade: refused directly; through the timelock it waits 7 days, and the member redeems meanwhile.
    const impl = await (await (await ethers.getContractFactory("ESADepositVault")).deploy()).getAddress();
    await expect(vault.connect(deployer).upgradeTo(impl)).to.be.reverted;
    const up = { targets: [await vault.getAddress()], values: [0n], payloads: [vault.interface.encodeFunctionData("upgradeTo", [impl])] };
    const sched = timelock.interface.encodeFunctionData("scheduleBatch", [up.targets, up.values, up.payloads, ethers.ZeroHash, ethers.id("up"), VAULT_TIMELOCK_DELAY]);
    await safe.connect(o1).confirmAndExecute(t, sched);
    await safe.connect(o2).confirmAndExecute(t, sched);
    await clrusd.connect(member).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(member).redeem(await usdc.getAddress(), 100n * ONE_USDC, member.address);
    await advance(VAULT_TIMELOCK_DELAY);
    const exec = timelock.interface.encodeFunctionData("executeBatch", [up.targets, up.values, up.payloads, ethers.ZeroHash, ethers.id("up")]);
    await safe.connect(o1).confirmAndExecute(t, exec);
    await safe.connect(o2).confirmAndExecute(t, exec);
    expect(await upgrades.erc1967.getImplementationAddress(await vault.getAddress())).to.equal(impl);
  });

  it("begins the token pool's two-step ownership transfer and leaves its acceptance to the timelock", async function () {
    const { deployer, clrusd, vault, timelock } = await setup();
    const t = await timelock.getAddress();
    // The CCIP pool (Chainlink ConfirmedOwner) is not built in this repo: a stand-in with its shape.
    let owner = deployer.address;
    let proposed = "";
    const pool: any = {
      owner: async () => owner,
      transferOwnership: async (to: string) => { proposed = to; return { wait: async () => undefined }; },
      getAddress: async () => "0x000000000000000000000000000000000000c0de",
      interface: new ethers.Interface(["function acceptOwnership()"]),
    };
    const pending = await handOverVault({ vault, clrusd, tokenPool: pool }, deployer, t);
    expect(proposed).to.equal(t);
    expect(pending.find((p) => p.what.startsWith("token pool"))!.data).to.equal(pool.interface.encodeFunctionData("acceptOwnership", []));
    // Once the timelock has accepted, nothing is left to do.
    owner = t;
    await assertNoVaultAdmin({ tokenPool: pool }, deployer.address);
  });

  it("lets a successor trustee take over in one timelock batch without the reserve moving", async function () {
    const { deployer, o1, o2, n1, n2, relayer, newRelayer, member, safe, usdc, clrusd, vault, timelock } = await setup();
    const t = await timelock.getAddress();
    await handOverVault({ vault }, deployer, t, { relayers: [relayer.address] });
    const successor: any = await (await ethers.getContractFactory("MockSafe")).deploy([n1.address, n2.address], 2);
    const reserve = await usdc.balanceOf(await vault.getAddress());
    const supply = await clrusd.totalSupply();

    const calls = await successorTrusteeCalls(timelock, await safe.getAddress(), await successor.getAddress(),
      [{ contract: vault, role: "RELAYER_ROLE", from: relayer.address, to: newRelayer.address }]);
    // Only role grants and revocations: nothing in the batch can move a token.
    for (const c of calls) expect(["grantRole", "revokeRole"]).to.include(c.data.slice(0, 10) === timelock.interface.getFunction("grantRole")!.selector ? "grantRole" : c.data.slice(0, 10) === timelock.interface.getFunction("revokeRole")!.selector ? "revokeRole" : c.data);
    await throughTimelock(safe, [o1, o2], timelock, {
      targets: calls.map((c) => c.target), values: calls.map((c) => c.value), payloads: calls.map((c) => c.data),
    }, ethers.id("successor"));

    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(reserve);
    expect(await clrusd.totalSupply()).to.equal(supply);
    expect(await timelock.hasRole(await timelock.PROPOSER_ROLE(), await safe.getAddress())).to.equal(false);
    expect(await timelock.hasRole(await timelock.PROPOSER_ROLE(), await successor.getAddress())).to.equal(true);
    expect(await vault.hasRole(await vault.RELAYER_ROLE(), relayer.address)).to.equal(false);
    expect(await vault.hasRole(await vault.RELAYER_ROLE(), newRelayer.address)).to.equal(true);
    // The old Safe can no longer propose; the new one can.
    const data = vault.interface.encodeFunctionData("setPilotOff", [true]);
    const schedule = timelock.interface.encodeFunctionData("schedule", [await vault.getAddress(), 0, data, ethers.ZeroHash, ethers.id("off"), VAULT_TIMELOCK_DELAY]);
    await safe.connect(o1).confirmAndExecute(t, schedule);
    await expect(safe.connect(o2).confirmAndExecute(t, schedule)).to.be.reverted;
    await successor.connect(n1).confirmAndExecute(t, schedule);
    await successor.connect(n2).confirmAndExecute(t, schedule);
    // The member's money was never in question.
    await clrusd.connect(member).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(member).redeem(await usdc.getAddress(), 1_000n * ONE_USDC, member.address);
    expect(await usdc.balanceOf(member.address)).to.equal(1_000n * ONE_USDC);
  });

  it("is no longer part of the credit handover", async function () {
    const src = require("fs").readFileSync(require("path").join(__dirname, "../../deploy/credit_timelock_handover.ts"), "utf8");
    expect(src).to.not.match(/at\("ESADepositVault"\)|at\("ClearUSDUpgradeable"\)/);
  });
});
