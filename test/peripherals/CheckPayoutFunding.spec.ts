import { expect } from "chai";
import { readFileSync } from "fs";
import path from "path";
import { ethers, upgrades } from "hardhat";
import { deployBarePool } from "../helpers/yieldPool";
import { deployPhase0Network } from "../helpers/phase0-fixture";
import { checkPayoutFunding } from "../../scripts/check_payout_funding";
import { DEFAULT_PAYOUT_KEEPER_CONFIG } from "../../apps/api/src/services/payoutFunding/fundingStatus";

/*
 * scripts/check_payout_funding.ts, the payout funding keeper's check by hand, against a deployed
 * PayoutPool and Yield Pool on the in-process network: the status it reports for the standing
 * balance (decision 49) and addendum 12.10's two-business-day lead, and the Yield Pool headroom it
 * reports matching what `deploy` actually accepts.
 */
const ONE_USDC = 10n ** 6n;
const DAY = 24 * 60 * 60;
const NET_30 = 30 * DAY;
const NET_14 = 14 * DAY;
const config = DEFAULT_PAYOUT_KEEPER_CONFIG;

describe("scripts/check_payout_funding.ts (payout funding keeper)", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let registry: any, pool: any, yieldPool: any, deployToLending: (amount: bigint) => Promise<unknown>;
  let net30: any, net14: any, coop: any, funder: any;
  let addresses: { payoutPool: string; yieldPool: string; bondVault: null };

  async function sale(merchant: any, amount: bigint) {
    const buyer = ethers.Wallet.createRandom().connect(ethers.provider);
    await ethers.provider.send("hardhat_setBalance", [buyer.address, "0xde0b6b3a7640000"]);
    await ctx.creditIssuer.connect(ctx.operator).initializeCreditLine(buyer.address, amount, 0, 365 * DAY, NET_30);
    await ctx.stableCredit.connect(buyer).transfer(merchant.address, amount);
  }

  async function fund(amount: bigint) {
    await ctx.usdc.mint(funder.address, amount);
    await ctx.usdc.connect(funder).approve(await pool.getAddress(), amount);
    await pool.connect(funder).fund(amount);
  }

  async function goTo(timestamp: number) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
    await ethers.provider.send("evm_mine", []);
  }

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [coop, net14, funder] = [signers[8], signers[9], signers[10]];
    net30 = ctx.counterparty;

    registry = await upgrades.deployProxy(await ethers.getContractFactory("MerchantRegistry"), [ctx.admin.address, NET_30], { kind: "uups" });
    pool = await upgrades.deployProxy(await ethers.getContractFactory("PayoutPool"), [
      ctx.admin.address, await ctx.stableCredit.getAddress(), await ctx.usdc.getAddress(), await registry.getAddress(), coop.address,
    ], { kind: "uups" });
    await pool.grantRole(await pool.FUNDER_ROLE(), funder.address);
    await ctx.stableCredit.connect(ctx.admin).setMerchantRegistry(await registry.getAddress());
    await ctx.stableCredit.connect(ctx.admin).setPayoutPool(await pool.getAddress());
    for (const m of [net30, net14]) {
      await ctx.access.connect(ctx.operator).grantMember(m.address);
      await ctx.stableCredit.connect(m).approve(await pool.getAddress(), ethers.MaxUint256);
    }
    await registry.registerMerchant(net30.address, NET_30, 50_000n * ONE_USDC, 200n);
    await registry.registerMerchant(net14.address, NET_14, 50_000n * ONE_USDC, 200n);

    ({ pool: yieldPool, deploy: deployToLending } = await deployBarePool(ctx.admin, ctx.usdc, signers[17], [signers[18], signers[19]]));
    addresses = { payoutPool: await pool.getAddress(), yieldPool: await yieldPool.getAddress(), bondVault: null };

    // Claims 0 and 1: net-30, 1,000 each. Claim 2: net-14, 500.
    await sale(net30, 2_000n * ONE_USDC);
    await sale(net14, 500n * ONE_USDC);
    await pool.connect(net30).redeem(1_000n * ONE_USDC);
    await pool.connect(net30).redeem(1_000n * ONE_USDC);
    await pool.connect(net14).redeem(500n * ONE_USDC);
  });

  it("AMBER with the exact top-up while the payable balance is below what is due within 30 days", async function () {
    const { status, subject, body } = await checkPayoutFunding(addresses, config);
    expect(status.level).to.equal("AMBER");
    expect(status.standing.amount).to.equal(2_500n * ONE_USDC);
    expect(status.topUp).to.equal(2_500n * ONE_USDC);
    expect(status.deadline.short).to.equal(0n);
    // The net-14 claim is paid first, so it sets the date: two business days before its deadline.
    const [, , , dueBy14] = await pool.claimAt(2);
    expect(status.firstUnfunded?.id).to.equal(2n);
    expect(status.fundBy).to.be.lessThan(Number(dueBy14));
    expect(status.fundBy).to.be.at.least(Number(dueBy14) - 4 * DAY);
    expect(subject).to.contain("AMBER: top up $2,500.00");
    expect(body).to.contain("BondVault deployable excess (through the Collateral Agent): not configured");

    // Part funded: the top-up is what is still missing.
    await fund(1_000n * ONE_USDC);
    expect((await checkPayoutFunding(addresses, config)).status.topUp).to.equal(1_500n * ONE_USDC);
  });

  it("GREEN once the standing balance is kept", async function () {
    await fund(2_500n * ONE_USDC);
    const { status } = await checkPayoutFunding(addresses, config);
    expect(status.level).to.equal("GREEN");
    expect(status.payable).to.equal(2_500n * ONE_USDC);
  });

  it("RED when a claim inside two business days is not funded", async function () {
    const [, , , dueBy14] = await pool.claimAt(2);
    await goTo(Number(dueBy14) - DAY);
    const { status, subject } = await checkPayoutFunding(addresses, config);
    expect(status.level).to.equal("RED");
    expect(status.overdue.ids).to.deep.equal([]);
    expect(status.deadline.short).to.equal(500n * ONE_USDC);
    expect(status.neededNow).to.equal(500n * ONE_USDC);
    expect(subject).to.equal("Payout funding RED: $500.00 needed now");
  });

  it("RED when a claim is past its payout deadline", async function () {
    const [, , , dueBy14] = await pool.claimAt(2);
    await goTo(Number(dueBy14) + 60);
    const { status } = await checkPayoutFunding(addresses, config);
    expect(status.level).to.equal("RED");
    expect(status.overdue.ids).to.deep.equal([2n]);
    expect(status.overdue.earliestDueBy).to.equal(Number(dueBy14));
    expect(status.payableNow).to.equal(false);
  });

  it("reports the treasury allowance, and a Yield Pool headroom that deploy accepts to the unit", async function () {
    await ctx.usdc.mint(coop.address, 300n * ONE_USDC);
    await ctx.usdc.connect(coop).approve(await pool.getAddress(), 1_000n * ONE_USDC);
    await ctx.usdc.mint(ctx.admin.address, 1_000n * ONE_USDC);
    await ctx.usdc.approve(await yieldPool.getAddress(), 1_000n * ONE_USDC);
    await yieldPool.deposit(1_000n * ONE_USDC, ctx.admin.address);

    let { status } = await checkPayoutFunding(addresses, config);
    expect(status.options.treasuryAvailable).to.deep.equal({ ok: true, value: 300n * ONE_USDC });
    const yp = status.options.yieldPool;
    if (!yp?.ok) throw new Error("yield pool read failed");
    // Nothing deployed, 1,000 cash: 90% of it.
    expect(yp.value.headroom).to.equal(900n * ONE_USDC);
    expect(yp.value.binding).to.equal("utilization cap");

    // One unit more is refused by the cap; exactly the headroom is accepted.
    await expect(deployToLending(yp.value.headroom + 1n)).to.be.revertedWithCustomError(yieldPool, "LendingPoolUtilizationCap");
    await deployToLending(yp.value.headroom);
    ({ status } = await checkPayoutFunding(addresses, config));
    if (!status.options.yieldPool?.ok) throw new Error("yield pool read failed");
    expect(status.options.yieldPool.value.headroom).to.equal(0n);
  });

  it("is read-only: views through the provider, no signer", function () {
    const source = readFileSync(path.join(__dirname, "../../scripts/check_payout_funding.ts"), "utf8");
    expect(source).to.not.match(/getSigners|getContractAt|sendTransaction|\.connect\(|Wallet/);
    expect(source).to.contain("new ethers.Contract(address, abi, provider)");
  });
});
