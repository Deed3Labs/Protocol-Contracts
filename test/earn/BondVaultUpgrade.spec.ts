import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

/*
 * Phase 2f stage 2: the upgradeProxy rehearsal for the BondVault. The deployed Base Sepolia vault is
 * upgraded in place, so its storage must carry over (append-only; `scripts/storage_report_bond_vault.ts`
 * checks the layout against every implementation in `.openzeppelin/base-sepolia.json`). The source
 * before this stage is `contracts/mocks/BondVaultPre2f.sol`.
 */
const U = (n: number | bigint) => BigInt(n) * 10n ** 6n;
const DAY = 24 * 3600;

describe("BondVault upgrade rehearsal (Phase 2f stage 2)", function () {
  it("keeps every obligation, total, backstop and settlement record through upgradeProxy, and the new reserve reads them", async function () {
    const [admin, bondRole, treasury, payout, holder] = await ethers.getSigners();
    const source: any = await (await ethers.getContractFactory("MockCollateralSignals")).deploy();
    const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
    const old: any = await upgrades.deployProxy(await ethers.getContractFactory("BondVaultPre2f"),
      [admin.address, await usdc.getAddress(), 90 * DAY], { kind: "uups" });
    await old.grantRole(await old.BOND_ROLE(), bondRole.address);
    await old.setBackstops(treasury.address, payout.address);
    await old.setEncumbranceSource(await source.getAddress(), ethers.id("BOND"));
    const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    await usdc.mint(await old.getAddress(), U(2_000));
    await old.connect(bondRole).recordPurchase(1, U(900), U(1_000), now + BigInt(365 * DAY));
    await old.connect(bondRole).recordPurchase(2, U(950), U(1_000), now + BigInt(30 * DAY));
    await ethers.provider.send("evm_increaseTime", [31 * DAY]);
    await ethers.provider.send("evm_mine", []);
    const before = {
      total: await old.totalFaceOutstanding(), principal: await old.totalPrincipal(), held: await old.held(),
      floor: await old.minReserveBps(), ob1: await old.obligations(1), outstanding: await old.outstandingBonds(),
    };

    const vault: any = await upgrades.upgradeProxy(await old.getAddress(), await ethers.getContractFactory("BondVault"), { kind: "uups" });
    expect(await vault.totalFaceOutstanding()).to.equal(before.total);
    expect(await vault.totalPrincipal()).to.equal(before.principal);
    expect(await vault.held()).to.equal(before.held);
    expect(await vault.minReserveBps()).to.equal(before.floor); // 30%: the FIXED floor
    expect(await vault.obligations(1)).to.deep.equal(before.ob1);
    expect(await vault.outstandingBonds()).to.deep.equal(before.outstanding);
    expect(await vault.treasury()).to.equal(treasury.address);
    expect(await vault.payoutPool()).to.equal(payout.address);
    expect(await vault.encumbranceSource()).to.equal(await source.getAddress());
    expect(await vault.hasRole(await vault.BOND_ROLE(), bondRole.address)).to.equal(true);
    expect(await vault.hasRole(await vault.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
    // The new reserve reads the old buckets: bond 2 is overdue (100%), bond 1 at the 30% floor.
    expect(await vault.faceDueWithin(90 * DAY)).to.equal(U(1_000));
    expect(await vault.requiredReserve()).to.equal(U(1_000));
    // Unset Phase 2f fields read as none.
    expect(await vault.agent()).to.equal(ethers.ZeroAddress);
    expect(await vault.shortfallSince()).to.equal(0n);
    expect(await vault.registerLength()).to.equal(0n);
    // Legacy obligations still settle (Issue Yield 0 reads as the Maturity Amount).
    await vault.connect(bondRole).settle(2, holder.address);
    expect(await usdc.balanceOf(holder.address)).to.equal(U(1_000));
    // A later purchase records its Phase 2f terms.
    await vault.connect(bondRole).recordPurchase(3, U(950), U(1_000), now + BigInt(400 * DAY), 475, 365);
    expect((await vault.bondTerms(3)).yieldBps).to.equal(475n);
    expect(await vault.registerLength()).to.equal(1n);
  });
});
