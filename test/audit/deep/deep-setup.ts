import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../../helpers/phase0-fixture";
import { issuerProxyOptions } from "../../helpers/issuers";

/*
 * Shared wiring for the deep-pass audit tests: the credit core as AuditPoC.spec.ts wires it
 * (ClearCredit + RevolvingIssuer + TermIssuer + MerchantRegistry + PayoutPool), plus extra actors.
 */
export const ONE_USDC = 10n ** 6n;
export const DAY = 24 * 60 * 60;
export const CYCLE = 30 * DAY;
export const NET_30 = 30 * DAY;
export const TIERS: [string, bigint][] = [["SAVINGS", 0n], ["ASSET_INTERNAL", 65n], ["INCOME", 150n], ["BOOST", 300n]];

export async function advance(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

export async function deployCore(opts: { fundPool?: bigint } = {}) {
  const ctx = await deployPhase0Network();
  const s = await ethers.getSigners();
  const [coop, merchant, funder, attacker, member2, member3, merchant2] =
    [s[8], s[9], s[10], s[11], s[12], s[13], s[14]];

  const RevolvingIssuer = await ethers.getContractFactory("RevolvingIssuer");
  const revolving: any = await upgrades.deployProxy(
    RevolvingIssuer, [await ctx.stableCredit.getAddress(), coop.address], { ...(await issuerProxyOptions("RevolvingIssuer")),  kind: "uups" });
  const TermIssuer = await ethers.getContractFactory("TermIssuer");
  const term: any = await upgrades.deployProxy(
    TermIssuer, [await ctx.stableCredit.getAddress(), coop.address], { ...(await issuerProxyOptions("TermIssuer")),  kind: "uups" });

  for (const issuer of [revolving, term]) {
    await ctx.networkRegistry.registerIssuer(
      await issuer.getAddress(), await ctx.stableCredit.getAddress()
);
    await ctx.access.grantOperator(await issuer.getAddress());
  }
  for (const [name, rate] of TIERS) {
    await revolving.connect(ctx.operator).addTier(ethers.encodeBytes32String(name), rate, CYCLE);
  }
  // The term issuer reads the revolving line to tell residual carry apart from revolving debt.
  await term.connect(ctx.operator).setMandateSource(await revolving.getAddress());

  const MerchantRegistry = await ethers.getContractFactory("MerchantRegistry");
  const registry: any = await upgrades.deployProxy(MerchantRegistry, [ctx.admin.address, NET_30], { kind: "uups" });
  const PayoutPool = await ethers.getContractFactory("PayoutPool");
  const pool: any = await upgrades.deployProxy(PayoutPool, [
    ctx.admin.address, await ctx.stableCredit.getAddress(), await ctx.usdc.getAddress(),
    await registry.getAddress(), coop.address], { kind: "uups" });
  await pool.grantRole(await pool.FUNDER_ROLE(), funder.address);
  await ctx.stableCredit.connect(ctx.admin).setPayoutPool(await pool.getAddress());
  // As deploy/22 wires it: the ledger knows who the merchants are (audit C-1, H-1).
  await ctx.stableCredit.connect(ctx.admin).setMerchantRegistry(await registry.getAddress());
  for (const m of [merchant, merchant2]) {
    await registry.registerMerchant(m.address, NET_30, 1_000_000n * ONE_USDC, 250n);
  }
  for (const who of [coop, merchant, merchant2]) {
    await ctx.access.connect(ctx.operator).grantMember(who.address);
  }

  // Everybody who repays needs USDC and an allowance to the ledger.
  for (const who of [ctx.member, member2, member3, coop, merchant, merchant2, attacker]) {
    await ctx.usdc.mint(who.address, 1_000_000n * ONE_USDC);
    await ctx.usdc.connect(who).approve(await ctx.stableCredit.getAddress(), ethers.MaxUint256);
    await ctx.stableCredit.connect(who).approve(await pool.getAddress(), ethers.MaxUint256);
  }
  await ctx.usdc.mint(funder.address, 1_000_000n * ONE_USDC);
  await ctx.usdc.connect(funder).approve(await pool.getAddress(), ethers.MaxUint256);
  if (opts.fundPool && opts.fundPool > 0n) await pool.connect(funder).fund(opts.fundPool);

  return { ctx, revolving, term, registry, pool, coop, merchant, merchant2, funder, attacker, member2, member3 };
}
