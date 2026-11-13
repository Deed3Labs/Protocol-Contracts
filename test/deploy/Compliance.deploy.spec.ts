import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { deployCreditCore } from "../../deploy/20_deploy_CreditCore";
import { wireCompliance, loadRateTable } from "../../deploy/25_wire_Compliance";
import {
  deployCreditTimelock,
  handOverCredit,
  assertNoCreditAdmin,
  CREDIT_TIMELOCK_DELAY,
} from "../../deploy/credit_timelock_handover";

/**
 * Phase 2 deploy wiring, run against a fresh chain: RateSchedule and its products, the issuers
 * pointed at it, the state attester, and the 7-day credit timelock handover.
 */
describe("compliance deployment and credit timelock handover", function () {
  const dir = path.join("./deployments", "hardhat");
  let core: Awaited<ReturnType<typeof deployCreditCore>>;
  let rates: any, access: any;
  let admin: any, attester: any, safe: any;

  before(async function () {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    [admin, attester, safe] = await ethers.getSigners();

    const AccessManager = await ethers.getContractFactory("AccessManager");
    access = await upgrades.deployProxy(AccessManager, [admin.address]);
    await access.waitForDeployment();
    fs.writeFileSync(
      path.join(dir, "AccessManager.json"),
      JSON.stringify({ address: await access.getAddress(), abi: JSON.parse(access.interface.formatJson()), blockNumber: 0 }, null, 2)
    );
    core = await deployCreditCore({ quiet: true });
    ({ rates } = await wireCompliance({ quiet: true, stateAttester: attester.address }));
  });

  after(function () {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates every product in the rate table and points both issuers at it", async function () {
    for (const p of loadRateTable()) expect(await rates.hasProduct(p.state, p.product)).to.equal(true);
    expect(await core.revolving.rateSchedule()).to.equal(await rates.getAddress());
    expect(await core.revolving.ceilingProduct()).to.equal(ethers.encodeBytes32String("REVOLVING"));
    expect(await core.term.rateSchedule()).to.equal(await rates.getAddress());
    expect(await rates.cflSourcesOf()).to.deep.equal([await core.revolving.getAddress(), await core.term.getAddress()]);
    expect(await rates.cflAggregationOff()).to.equal(false);
  });

  it("prices exactly the unsecured tiers from the schedule", async function () {
    for (let id = 0; id < Number(await core.revolving.tierCount()); id++) {
      const [kind] = await core.revolving.tierAt(id);
      const name = ethers.decodeBytes32String(kind);
      const product = await core.revolving.tierProduct(id);
      if (name === "INCOME" || name === "BOOST") expect(ethers.decodeBytes32String(product)).to.equal(name);
      else expect(product).to.equal(ethers.ZeroHash);
    }
  });

  it("grants the state attester its role, and is safe to run again", async function () {
    expect(await core.networkRegistry.hasRole(await core.networkRegistry.STATE_ATTESTER_ROLE(), attester.address)).to.equal(true);
    await wireCompliance({ quiet: true, stateAttester: attester.address });
  });

  it("refuses a credit timelock shorter than 7 days", async function () {
    let error: any;
    try { await deployCreditTimelock(safe.address, CREDIT_TIMELOCK_DELAY - 1); } catch (e) { error = e; }
    expect(String(error?.message)).to.contain("at least 7 days");
  });

  it("hands every upgrade and admin power to the timelock and leaves the deployer none", async function () {
    const timelock: any = await deployCreditTimelock(safe.address);
    const t = await timelock.getAddress();
    const c = {
      revolving: core.revolving,
      term: core.term,
      rateSchedule: rates,
      networkRegistry: core.networkRegistry,
      collateral: core.collateral,
      limits: core.limits,
      access,
    };
    await handOverCredit(c, admin, t);
    await assertNoCreditAdmin(c, admin.address);
    expect(await rates.owner()).to.equal(t);
    expect(await core.revolving.owner()).to.equal(t);
    expect(await access.isAdmin(t)).to.equal(true);
    // AccessManager is a transparent proxy: its upgrade power moved with the ProxyAdmin.
    const pa = await ethers.getContractAt(["function owner() view returns (address)"], await upgrades.erc1967.getAdminAddress(await access.getAddress()));
    expect(await pa.owner()).to.equal(t);

    // A rate change now takes a proposal and 7 days.
    const p = loadRateTable()[1];
    await expect(rates.setProduct(p.state, p.product, p.params, p.bands)).to.be.reverted;
    const data = rates.interface.encodeFunctionData("setProduct", [p.state, p.product, { ...p.params, listMonthlyBps: 140 }, p.bands]);
    const salt = ethers.id("lower income rate");
    await timelock.connect(safe).schedule(await rates.getAddress(), 0, data, ethers.ZeroHash, salt, CREDIT_TIMELOCK_DELAY);
    await expect(timelock.connect(safe).execute(await rates.getAddress(), 0, data, ethers.ZeroHash, salt))
      .to.be.revertedWith("TimelockController: operation is not ready");
    await ethers.provider.send("evm_increaseTime", [CREDIT_TIMELOCK_DELAY]);
    await ethers.provider.send("evm_mine", []);
    await timelock.connect(safe).execute(await rates.getAddress(), 0, data, ethers.ZeroHash, salt);
    expect((await rates.paramsOf(p.state, p.product)).listMonthlyBps).to.equal(140n);
  });
});
