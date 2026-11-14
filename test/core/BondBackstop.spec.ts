import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";
import { deployAssurancePool, fund, balances, TAG, AssuranceSetup } from "../helpers/assurance";

const ONE_USDC = 10n ** 6n;
const MONTH = 30 * 24 * 60 * 60;

/*
 * A maturing bond the vault cannot pay on its own.
 *
 * The vault pays from what it holds, then the treasury up to the allowance the Safe gave it, and
 * nothing else. The AssurancePool used to lend as the last resort; addendum 12.11 stopped the
 * vault asking, and section 13 removed the pool's lending and the vault's pool address altogether
 * (PHASE-2C-REPORT.md lists each changed test). Here the co-op's AssurancePool is deployed and
 * funded beside the vault, and every test shows its compartments do not move.
 */
describe("a bond the vault cannot pay alone", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let vault: any, usdc: any, a: AssuranceSetup;
  let bondContract: any, safe: any, holder: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [bondContract, safe, holder] = [signers[8], signers[9], signers[10]];
    ({ usdc } = ctx);

    a = await deployAssurancePool(usdc, ctx.networkRegistry);
    await fund(a, usdc, a.treasury, TAG.BOARD_ALLOCATION, 1_000n * ONE_USDC);

    const BondVault = await ethers.getContractFactory("BondVault");
    vault = await upgrades.deployProxy(BondVault, [ctx.admin.address, await usdc.getAddress(), 3 * MONTH], { kind: "uups" });
    await vault.grantRole(await vault.BOND_ROLE(), bondContract.address);
    await vault.grantRole(await vault.TREASURY_ROLE(), safe.address);
    await vault.setBackstops(safe.address, ethers.ZeroAddress);
  });

  async function now() {
    return BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  }

  async function advance(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  /// A bond whose proceeds were `held` but whose face is `face`: the gap is what the Safe took out
  /// as deployable excess, or what a later reserve change left short.
  async function sell(bondId: number, held: bigint, face: bigint, monthsOut: number) {
    await usdc.mint(await vault.getAddress(), held);
    await vault.connect(bondContract).recordPurchase(bondId, held, face, (await now()) + BigInt(monthsOut * MONTH));
  }

  async function treasuryAllows(amount: bigint, holds = 10_000n * ONE_USDC) {
    await usdc.mint(safe.address, holds);
    await usdc.connect(safe).approve(await vault.getAddress(), amount);
  }

  async function poolUnchanged(before: Awaited<ReturnType<typeof balances>>) {
    expect((await balances(a.pool)).byId).to.deep.equal(before.byId);
    expect(await usdc.balanceOf(await a.pool.getAddress())).to.equal(1_000n * ONE_USDC);
  }

  it("pays from the vault alone when it can, and asks nobody else", async function () {
    const before = await balances(a.pool);
    await sell(1, 1_000n * ONE_USDC, 1_000n * ONE_USDC, 1);
    await treasuryAllows(500n * ONE_USDC);
    await advance(MONTH + 1);

    await vault.connect(bondContract).settle(1, holder.address);

    expect(await usdc.balanceOf(holder.address)).to.equal(1_000n * ONE_USDC);
    expect(await usdc.balanceOf(safe.address)).to.equal(10_000n * ONE_USDC);
    await poolUnchanged(before);
  });

  it("takes the shortfall from the treasury up to its allowance, and never the AssurancePool", async function () {
    // Was "...then the reserve", with the reserve lending the last 50.
    const before = await balances(a.pool);
    await sell(1, 700n * ONE_USDC, 1_000n * ONE_USDC, 1);
    await treasuryAllows(250n * ONE_USDC);
    await advance(MONTH + 1);

    await expect(vault.connect(bondContract).settle(1, holder.address))
      .to.be.revertedWithCustomError(vault, "BondVaultInsufficientFunds");
    await poolUnchanged(before);

    // With the treasury's allowance big enough, it pays, and the pool is still untouched.
    await usdc.connect(safe).approve(await vault.getAddress(), 300n * ONE_USDC);
    await expect(vault.connect(bondContract).settle(1, holder.address))
      .to.emit(vault, "DrewFromTreasury").withArgs(300n * ONE_USDC);

    expect(await usdc.balanceOf(holder.address)).to.equal(1_000n * ONE_USDC);
    expect(await usdc.balanceOf(safe.address)).to.equal(10_000n * ONE_USDC - 300n * ONE_USDC);
    await poolUnchanged(before);
  });

  it("refuses with nothing moved when the vault and the treasury together fall short", async function () {
    // Was two tests: "never draws on the reserve's excess, buffer or primary cover" and this one.
    const before = await balances(a.pool);
    await sell(1, 700n * ONE_USDC, 1_000n * ONE_USDC, 1);
    await treasuryAllows(100n * ONE_USDC);
    await advance(MONTH + 1);

    await expect(vault.connect(bondContract).settle(1, holder.address)).to.be.revertedWithCustomError(
      vault,
      "BondVaultInsufficientFunds"
    );
    expect(await usdc.balanceOf(safe.address)).to.equal(10_000n * ONE_USDC);
    await poolUnchanged(before);
  });

  it("owes no reserve anything, so the Safe's deployable excess is only the reserve rule's", async function () {
    // Was "owes the reserve nothing...". `repayReserve` is gone with the pool's loans (section 13).
    await sell(1, 500n * ONE_USDC, 550n * ONE_USDC, 12);
    // 30% of the face is kept back, and nothing else comes off.
    expect(await vault.deployableExcess()).to.equal(500n * ONE_USDC - 165n * ONE_USDC);
    expect(vault.interface.getFunction("repayReserve", [])).to.equal(null);
    expect(vault.interface.getFunction("owedToReserve", [])).to.equal(null);
  });

  it("reports the near-term gap nobody can pay, for the treasury to fund", async function () {
    // Was "counts the near-term gap nobody can pay in the RTD": there is no RTD any more, and the
    // co-op's AssurancePool never covers a bond.
    await sell(1, 700n * ONE_USDC, 1_000n * ONE_USDC, 1);
    await treasuryAllows(100n * ONE_USDC);

    // Due inside the window: 1,000 less 700 held less the treasury's 100.
    expect(await vault.uncoveredNearTerm()).to.equal(200n * ONE_USDC);

    // A bond years out is the vault's to fund from its own proceeds first.
    await sell(2, 0n, 5_000n * ONE_USDC, 24);
    expect(await vault.uncoveredNearTerm()).to.equal(200n * ONE_USDC);
  });

  it("names no AssurancePool: its backstops are the treasury and the payout pool", async function () {
    // Was "lends only to the bond vault it names" (the pool side) and the vault's three-way
    // `setBackstops(treasury, assurancePool, payoutPool)`.
    await expect(vault.setBackstops(safe.address, ctx.outsider.address))
      .to.emit(vault, "BackstopsUpdated").withArgs(safe.address, ctx.outsider.address);
    expect(a.pool.interface.getFunction("lendToBondVault", [])).to.equal(null);
    // And the vault could not pay the pool in even if it tried: it is a money-path contract.
    await ctx.networkRegistry.listMoneyPath(await vault.getAddress(), ethers.encodeBytes32String("BOND_VAULT"));
    expect(await ctx.networkRegistry.isMoneyPath(await vault.getAddress())).to.equal(true);
  });
});
