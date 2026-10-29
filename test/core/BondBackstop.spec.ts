import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";

const ONE_USDC = 10n ** 6n;
const MONTH = 30 * 24 * 60 * 60;

/*
 * A maturing bond the vault cannot pay on its own.
 *
 * The vault pays from what it holds, then the treasury up to the allowance the Safe gave it, then
 * the AssurancePool as the last resort -- out of excess and buffer, never the primary cover the RTD
 * is measured on. What the reserve lends comes back from new proceeds before the Safe can take any,
 * and the part of a near-term maturity nobody can pay is counted in the RTD rather than backed
 * unmeasured.
 */
describe("a bond the vault cannot pay alone", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let vault: any, reserve: any, usdc: any;
  let bondContract: any, safe: any, holder: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [bondContract, safe, holder] = [signers[8], signers[9], signers[10]];
    ({ usdc, assurancePool: reserve } = ctx);

    const BondVault = await ethers.getContractFactory("BondVault");
    vault = await upgrades.deployProxy(BondVault, [ctx.admin.address, await usdc.getAddress(), 3 * MONTH], { kind: "uups" });
    await vault.grantRole(await vault.BOND_ROLE(), bondContract.address);
    await vault.grantRole(await vault.TREASURY_ROLE(), safe.address);
    await vault.setBackstops(safe.address, await reserve.getAddress(), ethers.ZeroAddress);
    await reserve.connect(ctx.operator).setBondVault(await vault.getAddress());
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

  async function intoReserve(tier: "Primary" | "Buffer" | "Excess", amount: bigint) {
    await usdc.mint(ctx.admin.address, amount);
    await usdc.approve(await reserve.getAddress(), amount);
    await reserve[`depositInto${tier}Reserve`](amount);
  }

  it("pays from the vault alone when it can, and asks nobody else", async function () {
    await sell(1, 1_000n * ONE_USDC, 1_000n * ONE_USDC, 1);
    await treasuryAllows(500n * ONE_USDC);
    await intoReserve("Excess", 500n * ONE_USDC);
    await advance(MONTH + 1);

    await vault.connect(bondContract).settle(1, holder.address);

    expect(await usdc.balanceOf(holder.address)).to.equal(1_000n * ONE_USDC);
    expect(await usdc.balanceOf(safe.address)).to.equal(10_000n * ONE_USDC);
    expect(await reserve.excessBalance()).to.equal(500n * ONE_USDC);
  });

  it("takes the shortfall from the treasury up to its allowance, then the reserve", async function () {
    await sell(1, 700n * ONE_USDC, 1_000n * ONE_USDC, 1);
    await treasuryAllows(250n * ONE_USDC);
    await intoReserve("Excess", 100n * ONE_USDC);
    await advance(MONTH + 1);

    await expect(vault.connect(bondContract).settle(1, holder.address))
      .to.emit(vault, "DrewFromTreasury").withArgs(250n * ONE_USDC)
      .and.to.emit(vault, "DrewFromReserve").withArgs(50n * ONE_USDC, 50n * ONE_USDC);

    expect(await usdc.balanceOf(holder.address)).to.equal(1_000n * ONE_USDC);
    expect(await usdc.balanceOf(safe.address)).to.equal(10_000n * ONE_USDC - 250n * ONE_USDC);
    expect(await vault.owedToReserve()).to.equal(50n * ONE_USDC);
    expect(await reserve.lentToBondVault()).to.equal(50n * ONE_USDC);
    expect(await reserve.excessBalance()).to.equal(50n * ONE_USDC);
  });

  it("lends out of excess, then buffer, and never the primary cover", async function () {
    await sell(1, 950n * ONE_USDC, 1_000n * ONE_USDC, 1);
    await intoReserve("Primary", 400n * ONE_USDC);
    await intoReserve("Excess", 20n * ONE_USDC);
    await intoReserve("Buffer", 30n * ONE_USDC);
    await advance(MONTH + 1);

    await vault.connect(bondContract).settle(1, holder.address);

    expect(await usdc.balanceOf(holder.address)).to.equal(1_000n * ONE_USDC);
    expect(await reserve.primaryBalance()).to.equal(400n * ONE_USDC);
    expect(await reserve.excessBalance()).to.equal(0n);
    expect(await reserve.bufferBalance()).to.equal(0n);
    expect(await reserve.bondBufferOwed()).to.equal(30n * ONE_USDC);
  });

  it("refuses with nothing moved when all three together fall short", async function () {
    await sell(1, 700n * ONE_USDC, 1_000n * ONE_USDC, 1);
    await treasuryAllows(100n * ONE_USDC);
    await intoReserve("Primary", 1_000n * ONE_USDC);
    await intoReserve("Excess", 10n * ONE_USDC);
    await advance(MONTH + 1);

    await expect(vault.connect(bondContract).settle(1, holder.address)).to.be.revertedWithCustomError(
      vault,
      "BondVaultInsufficientFunds"
    );
    expect(await usdc.balanceOf(safe.address)).to.equal(10_000n * ONE_USDC);
    expect(await reserve.excessBalance()).to.equal(10n * ONE_USDC);
    expect(await reserve.primaryBalance()).to.equal(1_000n * ONE_USDC);
  });

  it("pays the reserve back from new proceeds before the Safe can take any", async function () {
    await sell(1, 900n * ONE_USDC, 1_000n * ONE_USDC, 1);
    await intoReserve("Excess", 100n * ONE_USDC);
    await advance(MONTH + 1);
    await vault.connect(bondContract).settle(1, holder.address);
    expect(await vault.owedToReserve()).to.equal(100n * ONE_USDC);

    // A new bond far out: 30% of its face is kept back, and what the reserve lent comes off too.
    await sell(2, 500n * ONE_USDC, 550n * ONE_USDC, 12);
    expect(await vault.deployableExcess()).to.equal(500n * ONE_USDC - 165n * ONE_USDC - 100n * ONE_USDC);

    // The Safe withdrawing repays the reserve first, so it can only ever take what is left.
    await vault.connect(safe).withdrawDeployable(235n * ONE_USDC, safe.address);
    expect(await vault.owedToReserve()).to.equal(0n);
    expect(await reserve.lentToBondVault()).to.equal(0n);
    expect(await reserve.excessBalance()).to.equal(100n * ONE_USDC);
    expect(await vault.held()).to.equal(165n * ONE_USDC);
  });

  it("lets anyone pay the reserve back as soon as there is spare", async function () {
    await sell(1, 900n * ONE_USDC, 1_000n * ONE_USDC, 1);
    await intoReserve("Excess", 100n * ONE_USDC);
    await advance(MONTH + 1);
    await vault.connect(bondContract).settle(1, holder.address);

    await sell(2, 200n * ONE_USDC, 220n * ONE_USDC, 12);
    await vault.connect(ctx.outsider).repayReserve();

    // 200 held, 66 kept back for the new bond: all 100 owed can go home.
    expect(await vault.owedToReserve()).to.equal(0n);
    expect(await reserve.excessBalance()).to.equal(100n * ONE_USDC);
  });

  it("counts the near-term gap nobody can pay in the RTD, and only that", async function () {
    await intoReserve("Primary", 100n * ONE_USDC);
    await sell(1, 700n * ONE_USDC, 1_000n * ONE_USDC, 1);
    await treasuryAllows(100n * ONE_USDC);

    // Due inside the window: 1,000 less 700 held less the treasury's 100.
    expect(await vault.uncoveredNearTerm()).to.equal(200n * ONE_USDC);
    expect(await reserve.bondExposure()).to.equal(200n * ONE_USDC);
    expect(await reserve.RTD()).to.equal(ethers.parseEther("0.5"));

    // A bond years out is the vault's to fund from its own proceeds first.
    await sell(2, 0n, 5_000n * ONE_USDC, 24);
    expect(await reserve.bondExposure()).to.equal(200n * ONE_USDC);
  });

  it("reads no bond exposure without a bond vault named", async function () {
    await reserve.connect(ctx.operator).setBondVault(ethers.ZeroAddress);
    await sell(1, 0n, 1_000n * ONE_USDC, 1);
    expect(await reserve.bondExposure()).to.equal(0n);
    expect(await reserve.hasValidRTD()).to.equal(true);
  });

  it("lends only to the bond vault it names", async function () {
    await intoReserve("Excess", 100n * ONE_USDC);
    await expect(reserve.connect(ctx.outsider).lendToBondVault(10n * ONE_USDC)).to.be.revertedWith(
      "AssurancePool: not the bond vault"
    );
  });
});
