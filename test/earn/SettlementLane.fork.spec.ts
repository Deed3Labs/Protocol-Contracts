import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { poolAt } from "../../deploy/poolModules";
import { prepareSettlementLaneUpgrade } from "../../scripts/upgrade_settlement_lane";
import { standIn } from "../../scripts/rehearse_sepolia_fork";

/*
 * The Settlement Funding lane (decision 54) against the Yield Pool deployed on Base Sepolia, on a
 * local fork: the upgrade validated against the day-0 manifest (.openzeppelin/base-sepolia.json),
 * the deployed proxy upgraded in place as the Earn timelock would (impersonated: nothing is sent to
 * the real network), its state carried over, then the lane run on the real pool, USDC and CL
 * Operating. Skipped unless the in-process network is a Base Sepolia fork:
 *
 *   FORK_RPC_URL=https://sepolia.base.org FORK_CHAIN_ID=84532 KEEP_REVERT_STRINGS=true \
 *     npx hardhat test test/earn/SettlementLane.fork.spec.ts
 *
 * (In this sandbox, also NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt.)
 */
const FORKED = !!process.env.FORK_RPC_URL?.trim() && process.env.FORK_CHAIN_ID === "84532";
const RECORDS = path.join(__dirname, "..", "..", "deployments", "base-sepolia");
const record = (name: string) => ethers.getAddress(JSON.parse(fs.readFileSync(path.join(RECORDS, `${name}.json`), "utf8")).address);
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const U = (n: number) => ethers.parseUnits(String(n), 6);
const DAY = 24 * 3600;

async function as(address: string) {
  await ethers.provider.send("hardhat_impersonateAccount", [address]);
  await ethers.provider.send("hardhat_setBalance", [address, "0x" + ethers.parseEther("10").toString(16)]);
  return ethers.getSigner(address);
}

describe("Settlement Funding lane on a Base Sepolia fork (decision 54)", function () {
  this.timeout(1_800_000);
  let proxy: string, timelock: string, clOperating: string;
  let pool: any, usdc: any;
  let deployers: string[];

  before(async function () {
    if (!FORKED) this.skip();
    // The fork answers no call at its fork block itself: mine one first.
    await ethers.provider.send("evm_mine", []);
    expect(Number((await ethers.provider.getNetwork()).chainId)).to.equal(84532);
    proxy = record("LendingPool");
    timelock = record("EarnTimelock");
    pool = await poolAt(proxy);
    usdc = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", await pool.asset());
    clOperating = await pool.deploymentAccount();
    const roles = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "deploy", "config", "earn-roles.json"), "utf8"));
    deployers = roles.networks["base-sepolia"].LendingPool.DEPLOYER_ROLE.map((a: string) => ethers.getAddress(a));
  });

  it("validates against the day-0 manifest and upgrades the deployed proxy in place, keeping its state", async function () {
    const before = await implementation(proxy);
    const snapshot = await state();
    const { implementation: impl } = await prepareSettlementLaneUpgrade({ proxy, prepare: true, log: () => undefined });
    // The Earn timelock is the pool's admin: it runs upgradeTo once its proposal is ready.
    expect(await pool.hasRole(ethers.ZeroHash, timelock)).to.equal(true);
    await (await pool.connect(await as(timelock)).upgradeTo(impl!)).wait();
    expect(await implementation(proxy)).to.equal(ethers.getAddress(impl!));
    expect(impl).to.not.equal(before);
    expect(await state()).to.deep.equal(snapshot);
    // The lane starts empty.
    const lane = await pool.settlementLane();
    expect(lane.funder).to.equal(ethers.ZeroAddress);
    expect(lane.headroom).to.equal(0n);
  });

  it("runs the lane on the deployed pool: set by two, deploy to CL Operating, cap, stop by one, restart by two, return", async function () {
    const DEPLOYER = await pool.DEPLOYER_ROLE();
    const admin = await as(timelock);
    // earn-roles.json names two deployers; any that does not hold the role on chain gets it here, on the fork only.
    const missing: string[] = [];
    for (const d of deployers) {
      if (!(await pool.hasRole(DEPLOYER, d))) {
        missing.push(d);
        await (await pool.connect(admin).grantRole(DEPLOYER, d)).wait();
      }
    }
    if (missing.length) console.log(`      (fork only) granted DEPLOYER_ROLE to ${missing.join(", ")}: earn-roles.json lists it, the chain does not have it`);
    const [d1, d2] = await Promise.all(deployers.slice(0, 2).map(as));
    const funder = await as(standIn("settlement funding desk wallet"));
    const cap = U(150);

    await (await pool.connect(d1).setSettlementFunder(funder.address, cap, 7 * DAY)).wait();
    await expect(pool.connect(d2).setSettlementFunder(funder.address, cap, 7 * DAY))
      .to.emit(pool, "SettlementFunderSet").withArgs(funder.address, cap, 7 * DAY, d1.address, d2.address);
    await (await pool.connect(d2).setSettlementHeadroom(U(1_000))).wait();
    await (await pool.connect(d1).setSettlementHeadroom(U(1_000))).wait();
    expect((await pool.settlementLane()).headroom).to.equal(U(1_000));

    const count: bigint = await pool.deploymentCount();
    const cashBefore: bigint = await usdc.balanceOf(clOperating);
    const ref = ethers.id("fork: settlement 2026-11-24 cut-off");
    await expect(pool.connect(funder).deploySettlement(U(100), ref))
      .to.emit(pool, "SettlementDeployed").withArgs(count, U(100), ref, U(100));
    expect(await usdc.balanceOf(clOperating) - cashBefore).to.equal(U(100));
    expect(await usdc.balanceOf(funder.address)).to.equal(0n);
    expect(await pool.deploymentCount()).to.equal(count + 1n);
    await expect(pool.connect(funder).deploySettlement(U(50) + 1n, ref))
      .to.be.revertedWithCustomError(pool, "LendingPoolSettlementCap").withArgs(U(100), cap, U(50) + 1n);
    await expect(pool.connect(d1).deploySettlement(U(1), ref)).to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");

    // One deployer stops it; the funder is refused; two restart it.
    await expect(pool.connect(d2).stopSettlementFunder()).to.emit(pool, "SettlementFunderStopped").withArgs(funder.address, d2.address);
    await expect(pool.connect(funder).deploySettlement(U(1), ref)).to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
    await (await pool.connect(d2).setSettlementFunder(funder.address, cap, 7 * DAY)).wait();
    await (await pool.connect(d1).setSettlementFunder(funder.address, cap, 7 * DAY)).wait();
    await (await pool.connect(funder).deploySettlement(U(50), ref)).wait();

    // CL Operating returns the unused funding: a Return, interest first.
    const op = await as(clOperating);
    const deployed: bigint = await pool.deployedBalance();
    await (await usdc.connect(op).approve(proxy, U(150))).wait();
    await (await pool.connect(op).returnFunds(U(150))).wait();
    expect(await pool.accruedInterest()).to.equal(0n);
    // Interest was paid first, so a few wei of the Deployed Balance are left.
    expect(await pool.deployedBalance()).to.be.lessThan(deployed - U(149));
  });

  async function state() {
    const [supply, assets, cash, deployed, count, tier, account, controls, admin, rate, legend] = await Promise.all([
      pool.totalSupply(), pool.totalAssets(), pool.vaultCash(), pool.deployedBalance(), pool.deploymentCount(),
      pool.poolTierPrincipal(), pool.deploymentAccount(), pool.earnControls(), pool.hasRole(ethers.ZeroHash, timelock),
      pool.rateModel(), pool.legend(),
    ]);
    return {
      supply, assets, cash, deployed, count, tier: [...tier].map(String), account, controls, admin, rate: [...rate].map(String), legend,
      name: await pool.name(), symbol: await pool.symbol(), asset: await pool.asset(),
    };
  }
});

async function implementation(proxy: string) {
  return ethers.getAddress("0x" + (await ethers.provider.getStorage(proxy, IMPL_SLOT)).slice(-40));
}
