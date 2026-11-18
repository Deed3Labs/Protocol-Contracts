import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { STATE_ATTESTER_ROLE, stateAttesterGrant } from "../../scripts/state_attester_grant";

/*
 * The state attester grant (scripts/state_attester_grant.ts): the Safe schedules
 * NetworkRegistry.grantRole(STATE_ATTESTER_ROLE, attester) on the credit timelock, waits its delay,
 * and runs it. Nothing here touches a live network.
 */
describe("state attester grant through the credit timelock (scripts/state_attester_grant.ts)", function () {
  const DELAY = 7 * 24 * 3600;

  async function setup() {
    const [deployer, safe, attester, stranger] = await ethers.getSigners();
    const registry: any = await upgrades.deployProxy(await ethers.getContractFactory("NetworkRegistry"), [deployer.address], { kind: "uups" });
    const tl: any = await (await ethers.getContractFactory("TimelockController")).deploy(DELAY, [safe.address], [safe.address], ethers.ZeroAddress);
    const adminRole = await registry.DEFAULT_ADMIN_ROLE();
    await registry.grantRole(adminRole, await tl.getAddress());
    await registry.renounceRole(adminRole, deployer.address);
    const o = {
      provider: ethers.provider,
      registry: await registry.getAddress(),
      timelock: await tl.getAddress(),
      safe: safe.address,
      attester: attester.address,
    };
    return { registry, tl, safe, attester, stranger, o };
  }

  it("schedule, wait 7 days, execute: then the attester holds the role and nothing else changed", async function () {
    const { registry, safe, attester, o } = await setup();
    let plan = await stateAttesterGrant(o);
    expect(plan.step).to.equal("schedule");
    await safe.sendTransaction(plan.schedule);

    plan = await stateAttesterGrant(o);
    expect(plan.step).to.equal("wait");
    await expect(safe.sendTransaction(plan.execute)).to.be.reverted; // the timelock refuses it early

    await ethers.provider.send("evm_increaseTime", [DELAY]);
    await ethers.provider.send("evm_mine", []);
    plan = await stateAttesterGrant(o);
    expect(plan.step).to.equal("execute");
    await safe.sendTransaction(plan.execute);

    expect(await registry.hasRole(STATE_ATTESTER_ROLE, attester.address)).to.equal(true);
    expect(await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), attester.address)).to.equal(false);
    expect((await stateAttesterGrant(o)).step).to.equal("done");
    // and the role does what it is for: attest a state, nothing more
    await registry.connect(attester).attestStateCode(safe.address, ethers.encodeBytes32String("NY"));
    expect(await registry.stateCodeOf(safe.address)).to.equal(ethers.encodeBytes32String("NY"));
  });

  it("refuses a Safe that is not the timelock's proposer, a timelock without the admin role, and a bad address", async function () {
    const { stranger, o } = await setup();
    await expect(stateAttesterGrant({ ...o, safe: stranger.address })).to.be.rejectedWith(/not both proposer and executor/);
    await expect(stateAttesterGrant({ ...o, timelock: stranger.address })).to.be.rejected;
    await expect(stateAttesterGrant({ ...o, attester: "0x1234" })).to.be.rejectedWith(/attester is not an address/);
  });
});
