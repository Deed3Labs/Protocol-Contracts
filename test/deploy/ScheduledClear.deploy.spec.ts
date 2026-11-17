import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { deployEarnTimelock, EARN_TIMELOCK_DELAY } from "../../deploy/earn_timelock_handover";
import { scheduledBackstopClear } from "../../scripts/scheduledClear";

/*
 * Decision 52: on a testnet the BondVault's backstop to the retired PayoutPool is a WARN, not a FAIL,
 * once the Earn timelock holds the exact batch (from the signing plan's E8-earn-schedule step) that
 * clears it. Nothing here touches a live network.
 */
describe("decision 52: a backstop whose clearing change is scheduled (scripts/scheduledClear.ts)", function () {
  const bv = new ethers.Interface(["function setBackstops(address _treasury, address _payoutPool)"]);
  const tlIface = new ethers.Interface([
    "function scheduleBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt, uint256 delay)",
  ]);
  const bondVault = ethers.Wallet.createRandom().address;
  const agent = ethers.Wallet.createRandom().address;
  const treasury = ethers.Wallet.createRandom().address;
  const retiredPayout = ethers.Wallet.createRandom().address;
  const salt = ethers.id("signing-plan: Earn batch");

  async function setup(payoutPool: string) {
    const [safe] = await ethers.getSigners();
    const tl = await deployEarnTimelock(safe.address);
    const targets = [agent, bondVault];
    const payloads = ["0x12345678", bv.encodeFunctionData("setBackstops", [treasury, payoutPool])];
    const data = tlIface.encodeFunctionData("scheduleBatch", [targets, [0n, 0n], payloads, ethers.ZeroHash, salt, EARN_TIMELOCK_DELAY]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-"));
    const planFile = path.join(dir, "signing-plan.json");
    fs.writeFileSync(planFile, JSON.stringify({ steps: [{ id: "E8-earn-schedule", to: await tl.getAddress(), data }] }));
    const ask = (over: Partial<Parameters<typeof scheduledBackstopClear>[0]> = {}) =>
      scheduledBackstopClear({ provider: ethers.provider, planFile, bondVault, earnTimelock: "", retired: [retiredPayout], ...over });
    return { tl, safe, data, planFile, ask, earnTimelock: await tl.getAddress() };
  }

  it("is null until the Safe schedules the batch, then gives the operation and when it may run", async function () {
    const { safe, data, ask, earnTimelock } = await setup(ethers.ZeroAddress);
    expect(await ask({ earnTimelock })).to.equal(null);
    await safe.sendTransaction({ to: earnTimelock, data });
    const got = await ask({ earnTimelock });
    expect(got).to.not.equal(null);
    expect(got!.payoutPool).to.equal(ethers.ZeroAddress);
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    expect(Math.round(got!.readyAt.getTime() / 1000)).to.equal(now + EARN_TIMELOCK_DELAY);
  });

  it("stays a WARN while ready but not run, and is null once the Safe runs the batch", async function () {
    const { safe, data, ask, earnTimelock, tl } = await setup(ethers.ZeroAddress);
    await safe.sendTransaction({ to: earnTimelock, data });
    await ethers.provider.send("evm_increaseTime", [EARN_TIMELOCK_DELAY]);
    await ethers.provider.send("evm_mine", []);
    const payloads = ["0x12345678", bv.encodeFunctionData("setBackstops", [treasury, ethers.ZeroAddress])];
    const id = await tl.hashOperationBatch([agent, bondVault], [0n, 0n], payloads, ethers.ZeroHash, salt);
    expect(await tl.isOperationReady(id)).to.equal(true);
    expect(await ask({ earnTimelock })).to.not.equal(null);
    await tl.connect(safe).executeBatch([agent, bondVault], [0n, 0n], payloads, ethers.ZeroHash, salt);
    expect(await ask({ earnTimelock })).to.equal(null); // run: the link itself is what the gate reads now
  });

  it("refuses a scheduled call that would point the backstop at a retired contract", async function () {
    const { safe, data, ask, earnTimelock } = await setup(retiredPayout);
    await safe.sendTransaction({ to: earnTimelock, data });
    expect(await ask({ earnTimelock })).to.equal(null);
  });

  it("refuses a plan step aimed at another timelock, another BondVault, or no plan file at all", async function () {
    const { safe, data, ask, earnTimelock } = await setup(ethers.ZeroAddress);
    await safe.sendTransaction({ to: earnTimelock, data });
    expect(await ask({ earnTimelock: ethers.Wallet.createRandom().address })).to.equal(null);
    expect(await ask({ earnTimelock, bondVault: ethers.Wallet.createRandom().address })).to.equal(null);
    expect(await ask({ earnTimelock, planFile: path.join(os.tmpdir(), "no-such-plan.json") })).to.equal(null);
  });
});
