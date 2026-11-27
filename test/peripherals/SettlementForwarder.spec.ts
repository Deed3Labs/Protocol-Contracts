import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { ALLOWANCE_MODULE_ABI, SAFE_MODULE_ABI, CANONICAL_ALLOWANCE_MODULE } from "../../apps/api/src/services/payoutFunding/topUp";

/*
 * SettlementForwarder (decision 54) on the real code: Safe's AllowanceModule v0.1.1 and a Safe v1.5.0
 * (singleton and proxy), their runtime bytecode read from Base Sepolia (test/deploy/fixtures), not a
 * mock. CL Operating is a real Safe proxy whose owner signs real Safe transactions; the forwarder is
 * its spending-limit delegate, a contract calling the module with an empty signature.
 */
const DAY = 24 * 3600;
const U = (n: number) => ethers.parseUnits(String(n), 6);
const SAFE_EXEC_ABI = [
  ...SAFE_MODULE_ABI,
  "function setup(address[],uint256,address,bytes,address,address,uint256,address)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
  "event ExecutionFailure(bytes32 txHash, uint256 payment)",
];
const MODULE_ABI = [
  ...ALLOWANCE_MODULE_ABI,
  "function removeDelegate(address delegate, bool removeAllowances)",
];

describe("SettlementForwarder (decision 54): CL Operating's AllowanceModule delegate", function () {
  let owner: any, desk: any, stranger: any, offRamp: string;
  let clOp: string, safe: any, module: any, usdc: any, forwarder: any;

  /** A Safe transaction from CL Operating, signed by its one owner (an approved-hash signature: v = 1). */
  async function fromSafe(to: string, data: string) {
    const sig = ethers.concat([ethers.zeroPadValue(owner.address, 32), ethers.ZeroHash, "0x01"]);
    const rc = await (await safe.connect(owner).execTransaction(to, 0, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, sig)).wait();
    const failed = rc.logs.some((l: any) => { try { return safe.interface.parseLog(l)?.name === "ExecutionFailure"; } catch { return false; } });
    if (failed) throw new Error("the Safe transaction failed");
    return rc;
  }

  beforeEach(async function () {
    [owner, desk, stranger] = await ethers.getSigners();
    offRamp = ethers.Wallet.createRandom().address;
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deploy", "fixtures", "safe-allowance-module.base-sepolia.json"), "utf8")).contracts;
    const setCode = (at: string, code: string) => ethers.provider.send("hardhat_setCode", [at, code]);
    await setCode(CANONICAL_ALLOWANCE_MODULE, fx.AllowanceModule.code);
    await setCode(fx.SafeSingleton.address, fx.SafeSingleton.code);
    clOp = ethers.Wallet.createRandom().address;
    await setCode(clOp, fx.SafeProxy.code);
    await ethers.provider.send("hardhat_setStorageAt", [clOp, "0x0", ethers.zeroPadValue(fx.SafeSingleton.address, 32)]);
    safe = new ethers.Contract(clOp, SAFE_EXEC_ABI, owner);
    await (await safe.setup([owner.address], 1, ethers.ZeroAddress, "0x", ethers.ZeroAddress, ethers.ZeroAddress, 0, ethers.ZeroAddress)).wait();
    expect(await safe.VERSION()).to.equal("1.5.0");
    module = new ethers.Contract(CANONICAL_ALLOWANCE_MODULE, MODULE_ABI, owner);
    expect([await module.NAME(), await module.VERSION()]).to.deep.equal(["Allowance Module", "0.1.1"]);
    usdc = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
    await usdc.mint(clOp, U(20_000));

    forwarder = await (await ethers.getContractFactory("SettlementForwarder", stranger)).deploy(clOp, CANONICAL_ALLOWANCE_MODULE, await usdc.getAddress());
    const f = await forwarder.getAddress();
    // CL Operating's batch (signing plan SL): the module, the delegate and its allowance, the off-ramp, the desk.
    await fromSafe(clOp, safe.interface.encodeFunctionData("enableModule", [CANONICAL_ALLOWANCE_MODULE]));
    await fromSafe(CANONICAL_ALLOWANCE_MODULE, module.interface.encodeFunctionData("addDelegate", [f]));
    await fromSafe(CANONICAL_ALLOWANCE_MODULE, module.interface.encodeFunctionData("setAllowance", [f, await usdc.getAddress(), U(5_000), 7 * 1440, 0]));
    await fromSafe(f, forwarder.interface.encodeFunctionData("setOffRamp", [offRamp]));
    await fromSafe(f, forwarder.interface.encodeFunctionData("setDesk", [desk.address]));
  });

  it("forwards from CL Operating to the off-ramp, as the module's delegate, for the desk wallet only", async function () {
    const f = await forwarder.getAddress();
    expect([await forwarder.safe(), await forwarder.allowanceModule(), await forwarder.token(), await forwarder.offRamp(), await forwarder.desk()])
      .to.deep.equal([clOp, CANONICAL_ALLOWANCE_MODULE, await usdc.getAddress(), offRamp, desk.address]);
    const tx = forwarder.connect(desk).forward(U(1_200));
    await expect(tx).to.emit(forwarder, "Forwarded").withArgs(offRamp, desk.address, U(1_200));
    await expect(tx).to.emit(module, "ExecuteAllowanceTransfer").withArgs(clOp, f, await usdc.getAddress(), offRamp, U(1_200), 1);
    expect(await usdc.balanceOf(offRamp)).to.equal(U(1_200));
    expect(await usdc.balanceOf(clOp)).to.equal(U(18_800));
    expect(await usdc.balanceOf(f)).to.equal(0n);
    expect((await module.getTokenAllowance(clOp, f, await usdc.getAddress()))[1]).to.equal(U(1_200));
    for (const who of [owner, stranger]) {
      await expect(forwarder.connect(who).forward(U(1))).to.be.revertedWithCustomError(forwarder, "SettlementForwarderNotDesk").withArgs(who.address);
    }
    await expect(forwarder.connect(desk).forward(0)).to.be.revertedWithCustomError(forwarder, "SettlementForwarderInvalidAmount");
    await expect(forwarder.connect(desk).forward(2n ** 96n)).to.be.revertedWithCustomError(forwarder, "SettlementForwarderInvalidAmount");
  });

  it("stays within the allowance per period, which resets on schedule", async function () {
    await forwarder.connect(desk).forward(U(3_000));
    await expect(forwarder.connect(desk).forward(U(2_000) + 1n)).to.be.revertedWith("newSpent > allowance.spent && newSpent <= allowance.amount");
    await forwarder.connect(desk).forward(U(2_000));
    await expect(forwarder.connect(desk).forward(1n)).to.be.reverted;
    await ethers.provider.send("evm_increaseTime", [7 * DAY + 60]);
    await ethers.provider.send("evm_mine", []);
    await forwarder.connect(desk).forward(U(5_000));
    expect(await usdc.balanceOf(offRamp)).to.equal(U(10_000));
  });

  it("only CL Operating sets the off-ramp and the desk; its deployer and the desk cannot", async function () {
    for (const who of [owner, desk, stranger]) {
      await expect(forwarder.connect(who).setOffRamp(who.address)).to.be.revertedWithCustomError(forwarder, "SettlementForwarderNotSafe").withArgs(who.address);
      await expect(forwarder.connect(who).setDesk(who.address)).to.be.revertedWithCustomError(forwarder, "SettlementForwarderNotSafe").withArgs(who.address);
    }
    const f = await forwarder.getAddress();
    const other = ethers.Wallet.createRandom().address;
    await expect(fromSafe(f, forwarder.interface.encodeFunctionData("setOffRamp", [other]))).to.emit(forwarder, "OffRampSet").withArgs(other);
    await forwarder.connect(desk).forward(U(10));
    expect(await usdc.balanceOf(other)).to.equal(U(10));
    // Never zero, CL Operating itself, or the forwarder (the Safe transaction reverts with the reason).
    for (const bad of [ethers.ZeroAddress, clOp, f]) {
      await expect(fromSafe(f, forwarder.interface.encodeFunctionData("setOffRamp", [bad]))).to.be.rejectedWith("SettlementForwarderInvalidAddress");
    }
    // A zero desk stops forwarding.
    await expect(fromSafe(f, forwarder.interface.encodeFunctionData("setDesk", [ethers.ZeroAddress]))).to.emit(forwarder, "DeskSet").withArgs(ethers.ZeroAddress);
    await expect(forwarder.connect(desk).forward(U(1))).to.be.revertedWithCustomError(forwarder, "SettlementForwarderNotDesk");
  });

  it("a stolen desk key reaches nothing else: not the module directly, not another destination", async function () {
    const f = await forwarder.getAddress();
    const token = await usdc.getAddress();
    // Calling the module itself, naming the forwarder as delegate, with an empty signature: the module sees the desk, not the delegate.
    const direct = module.interface.encodeFunctionData("executeAllowanceTransfer", [clOp, token, desk.address, U(1), ethers.ZeroAddress, 0, f, "0x"]);
    await expect(desk.sendTransaction({ to: CANONICAL_ALLOWANCE_MODULE, data: direct })).to.be.revertedWith("expectedDelegate == signer && delegates[address(safe)][uint48(signer)].delegate == signer");
    // The contract has no other function that moves anything.
    const fns = forwarder.interface.fragments.filter((x: any) => x.type === "function" && x.stateMutability !== "view").map((x: any) => x.name).sort();
    expect(fns).to.deep.equal(["forward", "setDesk", "setOffRamp"]);
    expect(await usdc.balanceOf(desk.address)).to.equal(0n);
  });

  it("stops when CL Operating removes it as delegate, and refuses with no off-ramp", async function () {
    const f = await forwarder.getAddress();
    await fromSafe(CANONICAL_ALLOWANCE_MODULE, module.interface.encodeFunctionData("removeDelegate", [f, true]));
    await expect(forwarder.connect(desk).forward(U(1))).to.be.reverted;
    const fresh = await (await ethers.getContractFactory("SettlementForwarder")).deploy(clOp, CANONICAL_ALLOWANCE_MODULE, await usdc.getAddress());
    await fromSafe(await fresh.getAddress(), fresh.interface.encodeFunctionData("setDesk", [desk.address]));
    await expect(fresh.connect(desk).forward(U(1))).to.be.revertedWithCustomError(fresh, "SettlementForwarderNoOffRamp");
  });

  it("refuses a Safe, module or token with no code", async function () {
    const F = await ethers.getContractFactory("SettlementForwarder");
    const eoa = stranger.address;
    await expect(F.deploy(eoa, CANONICAL_ALLOWANCE_MODULE, await usdc.getAddress())).to.be.revertedWithCustomError(F, "SettlementForwarderInvalidAddress");
    await expect(F.deploy(clOp, eoa, await usdc.getAddress())).to.be.revertedWithCustomError(F, "SettlementForwarderInvalidAddress");
    await expect(F.deploy(clOp, CANONICAL_ALLOWANCE_MODULE, eoa)).to.be.revertedWithCustomError(F, "SettlementForwarderInvalidAddress");
  });
});
