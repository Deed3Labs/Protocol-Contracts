import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../../helpers/phase0-fixture";
import { CA, ONE_USDC, CYCLE, DAY } from "./rates";

/*
 * Compliance spec items 10-11 (DFAL "control", pilot cap). Acceptance tests 9, 12, 13, 14, 15, 16
 * and 17. No Clear key may execute or indefinitely block a member's CLRUSD transaction except the
 * computed pledge lock, liquidation on computed default, and an expiring fraud or security pause.
 */
const SAVINGS = ethers.encodeBytes32String("SAVINGS");

async function advance(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function deployStack() {
  const ctx = await deployPhase0Network();
  const [, , , , , , , , coop, fraudA, fraudB, stranger] = await ethers.getSigners();
  const ClearUSD = await ethers.getContractFactory("ClearUSDUpgradeable");
  const clrusd: any = await upgrades.deployProxy(ClearUSD,
    ["Clear USD", "CLRUSD", 6, 0, 0, ctx.admin.address, ctx.admin.address],
    { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
  const Vault = await ethers.getContractFactory("ESADepositVault");
  const vault: any = await upgrades.deployProxy(Vault, [await clrusd.getAddress(), ctx.admin.address], { kind: "uups" });
  await clrusd.grantRole(await clrusd.MINTER_ROLE(), await vault.getAddress());
  await clrusd.grantRole(await clrusd.BURNER_ROLE(), await vault.getAddress());
  await vault.setAcceptedToken(await ctx.usdc.getAddress(), true);

  const R = await ethers.getContractFactory("RevolvingIssuer");
  const issuer: any = await upgrades.deployProxy(R, [await ctx.stableCredit.getAddress(), coop.address], { kind: "uups" });
  await ctx.networkRegistry.registerIssuer(await issuer.getAddress(), await ctx.stableCredit.getAddress(),
    await ctx.assurancePool.getAddress(), await ctx.assuranceOracle.getAddress());
  await ctx.access.grantOperator(await issuer.getAddress());
  await issuer.connect(ctx.operator).addTier(SAVINGS, 0n, CYCLE);

  const Registry = await ethers.getContractFactory("CollateralRegistry");
  const registry: any = await upgrades.deployProxy(Registry, [ctx.admin.address, await ctx.networkRegistry.getAddress()], { kind: "uups" });
  await registry.registerCollateralType(SAVINGS, 1, 10_000n, 10n ** 18n);
  await registry.setClrusdKind(SAVINGS);
  await registry.setClrusdToken(await clrusd.getAddress());
  await clrusd.setEncumbranceSource(await registry.getAddress());
  await issuer.connect(ctx.operator).setExposureSource(await registry.getAddress());

  const L = await ethers.getContractFactory("Liquidator");
  const liquidator: any = await upgrades.deployProxy(L, [ctx.admin.address, await ctx.stableCredit.getAddress(),
    await clrusd.getAddress(), await vault.getAddress(), await ctx.usdc.getAddress(), await registry.getAddress()], { kind: "uups" });
  await clrusd.grantRole(await clrusd.LIQUIDATOR_ROLE(), await liquidator.getAddress());
  await registry.grantRole(await registry.OPERATOR_ROLE(), await liquidator.getAddress());
  await ctx.access.grantOperator(await liquidator.getAddress());
  await liquidator.setTrustedSavingsIssuer(await issuer.getAddress(), true);

  await clrusd.grantRole(await clrusd.FRAUD_ROLE(), fraudA.address);
  await clrusd.grantRole(await clrusd.FRAUD_ROLE(), fraudB.address);
  return { ctx, clrusd, vault, issuer, registry, liquidator, fraudA, fraudB, stranger };
}

describe("COMPLIANCE DFAL control and pilot cap (spec items 10-11)", function () {
  let s: Awaited<ReturnType<typeof deployStack>>;

  beforeEach(async function () {
    s = await deployStack();
  });

  async function save(amount: bigint) {
    const { ctx, vault, registry } = s;
    await ctx.usdc.mint(ctx.member.address, amount);
    await ctx.usdc.connect(ctx.member).approve(await vault.getAddress(), amount);
    await vault.connect(ctx.member).deposit(await ctx.usdc.getAddress(), amount, ctx.member.address);
    await registry.pledge(ctx.member.address, SAVINGS, amount);
  }

  async function drawSavings(amount: bigint, period = 30 * DAY) {
    const { ctx, issuer } = s;
    await issuer.connect(ctx.operator).openLine(ctx.member.address, [1_000n * ONE_USDC], period, CYCLE);
    await ctx.stableCredit.connect(ctx.member).transfer(ctx.counterparty.address, amount);
  }

  it("acceptance 9: the lock releases in the block the savings draw reaches zero; no admin call can re-lock it; FRAUD_ROLE cannot move funds", async function () {
    const { ctx, clrusd, registry, issuer, fraudA } = s;
    await save(1_000n * ONE_USDC);
    await drawSavings(400n * ONE_USDC);
    expect(await clrusd.freeBalanceOf(ctx.member.address)).to.equal(600n * ONE_USDC);

    // Repay the draw in full: in that same block the whole balance is free.
    await ctx.usdc.mint(ctx.member.address, 400n * ONE_USDC);
    await ctx.usdc.connect(ctx.member).approve(await ctx.stableCredit.getAddress(), 400n * ONE_USDC);
    await ctx.stableCredit.connect(ctx.member).repayCreditBalance(ctx.member.address, 400n * ONE_USDC);
    expect(await clrusd.freeBalanceOf(ctx.member.address)).to.equal(1_000n * ONE_USDC);

    // No admin path re-locks it, directly or by re-pricing the collateral the lock is computed from.
    await expect(registry.setCollateralTerms(SAVINGS, 5_000n, 10n ** 18n)).to.be.revertedWithCustomError(registry, "CollateralRegistryClrusdTermsFixed");
    await expect(registry.setClrusdKind(ethers.encodeBytes32String("OTHER"))).to.be.reverted;
    await expect(registry.setCollateralValuer(SAVINGS, ctx.admin.address)).to.be.revertedWithCustomError(registry, "CollateralRegistryClrusdTermsFixed");
    await registry.pledge(ctx.member.address, SAVINGS, 5_000n * ONE_USDC); // pledging more locks nothing
    expect(await clrusd.freeBalanceOf(ctx.member.address)).to.equal(1_000n * ONE_USDC);

    // FRAUD_ROLE has no way to move a member's CLRUSD.
    await expect(clrusd.connect(fraudA).seize(ctx.member.address, fraudA.address, 1n)).to.be.reverted;
    await expect(clrusd.connect(fraudA).transferFrom(ctx.member.address, fraudA.address, 1n)).to.be.reverted;
    expect(await issuer.principalOf(ctx.member.address, 0)).to.equal(0n);
  });

  it("acceptance 13: no declared default -- liquidation reverts one second before the cure window ends (section 12.5) and succeeds for any caller after", async function () {
    const { ctx, issuer, liquidator, clrusd, stranger } = s;
    const CURE = 15 * DAY;
    await issuer.connect(ctx.operator).setCreditTerms(
      { unsecuredLineCap: 0, cureWindow: CURE, boostCleanCycles: 0, boostDepositCycles: 0, autoClearOffGlobal: false }, 0, 0);
    await save(1_000n * ONE_USDC);
    await drawSavings(400n * ONE_USDC, CYCLE);
    // Not in default yet: anyone calling is refused.
    await expect(liquidator.connect(stranger).liquidate(ctx.member.address, await issuer.getAddress(), 0, SAVINGS))
      .to.be.revertedWithCustomError(liquidator, "LiquidatorNotInDefault");
    // Two missed rebalances in a row, each judged by the chain (anyone may ask it to).
    for (let miss = 0; miss < 2; miss++) {
      const [, expiration, grace] = await issuer.creditPeriods(ctx.member.address);
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(expiration + grace) + 1]);
      await issuer.connect(stranger).syncCreditPeriod(ctx.member.address);
    }
    const end = Number((await issuer.cycleOf(ctx.member.address)).cureNoticeAt) + CURE;
    await ethers.provider.send("evm_setNextBlockTimestamp", [end - 1]);
    await expect(liquidator.connect(stranger).liquidate(ctx.member.address, await issuer.getAddress(), 0, SAVINGS))
      .to.be.revertedWithCustomError(liquidator, "LiquidatorNotInDefault");
    await ethers.provider.send("evm_setNextBlockTimestamp", [end + 1]);
    await liquidator.connect(stranger).liquidate(ctx.member.address, await issuer.getAddress(), 0, SAVINGS);
    // Never more than the encumbered collateral and the debt: the rest of the savings is theirs.
    expect(await clrusd.balanceOf(ctx.member.address)).to.equal(600n * ONE_USDC);
    // An untrusted issuer cannot trigger a seizure.
    await expect(liquidator.connect(stranger).liquidate(ctx.member.address, stranger.address, 0, SAVINGS))
      .to.be.revertedWithCustomError(liquidator, "LiquidatorUntrustedIssuer");
  });

  it("acceptance 14: no indirect lock -- admin and attestation calls on a member's address never raise their drawn amount or lock", async function () {
    const { ctx, clrusd, registry, issuer } = s;
    await save(1_000n * ONE_USDC);
    await drawSavings(300n * ONE_USDC);
    const drawn = await ctx.stableCredit.creditBalanceOf(ctx.member.address);
    const lock = 1_000n * ONE_USDC - (await clrusd.freeBalanceOf(ctx.member.address));
    const m = ctx.member.address;
    await ctx.networkRegistry.grantRole(await ctx.networkRegistry.STATE_ATTESTER_ROLE(), ctx.admin.address);
    await ctx.networkRegistry.attestStateCode(m, CA);
    await registry.pledge(m, SAVINGS, 1n);
    await registry.refresh(m);
    await issuer.connect(ctx.operator).setTierCapacity(m, 0, 2_000n * ONE_USDC);
    await issuer.connect(ctx.operator).pausePeriodOf(m);
    await issuer.connect(ctx.operator).unpausePeriodOf(m);
    const [, exp, grace] = await issuer.creditPeriods(m);
    await issuer.connect(ctx.operator).setPeriodExpirationOf(m, exp + 1n);
    await issuer.connect(ctx.operator).setGraceLengthOf(m, grace + 1n);
    await clrusd.syncEncumbrance(m);
    expect(await ctx.stableCredit.creditBalanceOf(m)).to.equal(drawn);
    expect(1_000n * ONE_USDC - (await clrusd.freeBalanceOf(m))).to.equal(lock);
  });

  it("acceptance 15: a fraud pause lifts by itself at 72 hours; the signer that set it cannot renew it, a second signer can, and it is logged", async function () {
    const { ctx, clrusd, fraudA, fraudB } = s;
    await save(100n * ONE_USDC);
    await clrusd.connect(fraudA).pauseAccount(ctx.member.address, 7);
    await expect(clrusd.connect(ctx.member).transfer(ctx.counterparty.address, 1n)).to.be.revertedWithCustomError(clrusd, "ClearUSDPaused");
    await expect(clrusd.connect(fraudA).renewAccountPause(ctx.member.address, 8)).to.be.revertedWithCustomError(clrusd, "ClearUSDSameSigner");
    await advance(72 * 3600 - 10);
    await expect(clrusd.connect(fraudB).renewAccountPause(ctx.member.address, 8)).to.emit(clrusd, "AccountPauseRenewed");
    await advance(72 * 3600 - 10);
    await expect(clrusd.connect(ctx.member).transfer(ctx.counterparty.address, 1n)).to.be.revertedWithCustomError(clrusd, "ClearUSDPaused");
    await advance(20);
    await clrusd.connect(ctx.member).transfer(ctx.counterparty.address, 1n); // lapsed on its own
    // The security pause follows the same rule.
    await clrusd.grantRole(await clrusd.SECURITY_ROLE(), fraudA.address);
    await clrusd.connect(fraudA).pauseForSecurity(1);
    await expect(clrusd.connect(ctx.member).transfer(ctx.counterparty.address, 1n)).to.be.revertedWithCustomError(clrusd, "ClearUSDPaused");
    await advance(72 * 3600 + 1);
    await clrusd.connect(ctx.member).transfer(ctx.counterparty.address, 1n);
  });

  it("acceptance 16: no role can pause, freeze or blacklist member transfers outside the 10c pauses, and burnFrom needs the member's allowance", async function () {
    const { ctx, clrusd, vault } = s;
    const names = clrusd.interface.fragments.filter((f: any) => f.type === "function").map((f: any) => f.name)
      .filter((n: string) => n !== n.toUpperCase()); // constants are not powers
    const blocking = names.filter((n: string) => /pause|freeze|blacklist|block|forceTransfer/i.test(n));
    expect(blocking.sort()).to.deep.equal(
      ["pauseAccount", "pauseForSecurity", "pausedUntil", "renewAccountPause", "renewSecurityPause", "setPauseWindow", "unpauseAccount", "unpauseSecurity"].sort());
    await save(100n * ONE_USDC);
    // The vault holds BURNER_ROLE, and still cannot burn a member's CLRUSD without their allowance.
    const burner = (await ethers.getSigners())[15];
    await clrusd.grantRole(await clrusd.BURNER_ROLE(), burner.address);
    await expect(clrusd.connect(burner).burnFrom(ctx.member.address, 1n)).to.be.reverted;
    // The vault's own pause is a security pause too: it lapses after 72 hours.
    await vault.pause();
    expect(await vault.paused()).to.equal(true);
    await advance(72 * 3600 + 1);
    expect(await vault.paused()).to.equal(false);
  });

  it("acceptance 17: an upgrade cannot take effect before the 7-day timelock ends, and a member can withdraw during the delay", async function () {
    const { ctx, vault } = s;
    const [admin] = await ethers.getSigners();
    const Timelock = await ethers.getContractFactory("TimelockController");
    const timelock: any = await Timelock.deploy(7 * DAY, [admin.address], [admin.address], ethers.ZeroAddress);
    const ClearUSD = await ethers.getContractFactory("ClearUSDUpgradeable");
    const clrusd: any = await upgrades.deployProxy(ClearUSD,
      ["Clear USD", "CLRUSD", 6, 0, 0, admin.address, await timelock.getAddress()],
      { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
    await clrusd.grantRole(await clrusd.MINTER_ROLE(), admin.address);
    await clrusd.mint(ctx.member.address, 100n * ONE_USDC);
    const impl = await (await ClearUSD.deploy()).getAddress();
    const data = clrusd.interface.encodeFunctionData("upgradeToAndCall", [impl, "0x"]);
    // The deployer, holding no upgrade role, cannot upgrade directly.
    await expect(clrusd.upgradeToAndCall(impl, "0x")).to.be.reverted;
    const salt = ethers.id("upgrade-1");
    await timelock.schedule(await clrusd.getAddress(), 0, data, ethers.ZeroHash, salt, 7 * DAY);
    await expect(timelock.execute(await clrusd.getAddress(), 0, data, ethers.ZeroHash, salt)).to.be.revertedWith("TimelockController: operation is not ready");
    // During the delay the member moves their unencumbered CLRUSD freely.
    await clrusd.connect(ctx.member).transfer(ctx.counterparty.address, 100n * ONE_USDC);
    await advance(7 * DAY);
    await timelock.execute(await clrusd.getAddress(), 0, data, ethers.ZeroHash, salt);
    expect(await vault.getAddress()).to.not.equal(ethers.ZeroAddress);
  });

  it("acceptance 12: CA mint volume above the cap reverts; members without a CA attestation are unaffected; it alerts first", async function () {
    const { ctx, vault } = s;
    const [, , , , , , , , , , , , , ca, wy] = await ethers.getSigners();
    await ctx.networkRegistry.grantRole(await ctx.networkRegistry.STATE_ATTESTER_ROLE(), ctx.admin.address);
    await ctx.networkRegistry.attestStateCode(ca.address, CA);
    await vault.setStateSource(await ctx.networkRegistry.getAddress());
    await vault.setPilotCap(50_000n * ONE_USDC, 45_000n * ONE_USDC, true);
    async function deposit(who: any, amount: bigint) {
      await ctx.usdc.mint(who.address, amount);
      await ctx.usdc.connect(who).approve(await vault.getAddress(), amount);
      return vault.connect(who).deposit(await ctx.usdc.getAddress(), amount, who.address);
    }
    await expect(deposit(ca, 46_000n * ONE_USDC)).to.emit(vault, "PilotAlert");
    await expect(deposit(ca, 5_000n * ONE_USDC)).to.be.revertedWithCustomError(vault, "ESADepositVaultPilotCapReached");
    await deposit(wy, 100_000n * ONE_USDC); // no CA attestation: counted as WY (DECISIONS #6)
    // Redemptions are counted but never refused.
    const clrusd = await ethers.getContractAt("ClearUSDUpgradeable", await vault.clrusd());
    await clrusd.connect(ca).approve(await vault.getAddress(), 1_000n * ONE_USDC);
    await vault.connect(ca).redeem(await ctx.usdc.getAddress(), 1_000n * ONE_USDC, ca.address);
    expect(await vault.caVolume()).to.equal(47_000n * ONE_USDC);
    // A year later the window has rolled.
    await advance(366 * DAY);
    expect(await vault.caVolume()).to.equal(0n);
    await deposit(ca, 5_000n * ONE_USDC);
  });
});
