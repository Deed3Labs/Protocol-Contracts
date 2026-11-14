import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { poolProxyOptions } from "../../deploy/poolModules";
import { DAY, U, increase, latest } from "../helpers/yieldPool";

/*
 * Phase 2f, decision 16: LendingPool becomes the Yield Pool by an in-place UUPS upgrade. This
 * rehearses it against the source deployed on Base Sepolia (`LendingPoolLegacy`, commit 1a5386bc,
 * the layout in `.openzeppelin/base-sepolia.json`): the OpenZeppelin plugin checks the storage
 * layout on the way, and every balance, the legacy borrowers' principal and the queued claims
 * carry over.
 */
describe("Yield Pool upgrade from the Base Sepolia LendingPool (storage carry-over)", function () {
  async function legacyPool() {
    const [admin, alice, bob, carol, borrower, lending] = await ethers.getSigners();
    const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
    const controls: any = await (await ethers.getContractFactory("MockEarnControls")).deploy();
    const legacy: any = await upgrades.deployProxy(
      await ethers.getContractFactory("LendingPoolLegacy"),
      [admin.address, await usdc.getAddress(), "Clear Lending Pool", "clrLP"],
      { kind: "uups" }
    );
    const address = await legacy.getAddress();
    for (const w of [alice, bob, carol, borrower, lending]) {
      await usdc.mint(w.address, U(100_000));
      await usdc.connect(w).approve(address, ethers.MaxUint256);
    }
    await legacy.grantRole(await legacy.BORROWER_ROLE(), borrower.address);
    await legacy.connect(alice).deposit(U(10_000), alice.address);
    await legacy.connect(bob).deposit(U(5_000), bob.address);
    await legacy.connect(carol).deposit(U(1_000), carol.address);
    await legacy.connect(borrower).borrow(U(6_000), borrower.address);
    // A pre-2f request: shares burned, claim fixed at $1,000.
    await legacy.connect(carol).requestWithdrawal(U(1_000), carol.address);
    return { admin, alice, bob, carol, borrower, lending, usdc, controls, legacy, address };
  }

  async function upgrade(c: Awaited<ReturnType<typeof legacyPool>>, initialClosing: number) {
    return upgrades.upgradeProxy(c.address, await ethers.getContractFactory("LendingPool"), {
      ...(await poolProxyOptions()),
      call: { fn: "initializeYieldPool", args: [await c.controls.getAddress(), c.lending.address, initialClosing] },
    }) as Promise<any>;
  }

  it("keeps every balance, the name, the roles and the legacy principal, and validates the layout", async function () {
    const c = await legacyPool();
    const supply = await c.legacy.totalSupply();
    const a = await c.legacy.balanceOf(c.alice.address);
    const b = await c.legacy.balanceOf(c.bob.address);
    const firstIssue = (await latest()) - 10;

    const pool = await upgrade(c, firstIssue);

    expect(await pool.getAddress()).to.equal(c.address);
    expect(await pool.name()).to.equal("Clear Lending Pool");
    expect(await pool.symbol()).to.equal("clrLP");
    expect(await pool.totalSupply()).to.equal(supply);
    expect(await pool.balanceOf(c.alice.address)).to.equal(a);
    expect(await pool.balanceOf(c.bob.address)).to.equal(b);
    expect(await pool.hasRole(await pool.DEFAULT_ADMIN_ROLE(), c.admin.address)).to.equal(true);
    // The legacy borrowers' principal is the opening Deployed Balance.
    expect(await pool.deployedBalance()).to.equal(U(6_000));
    expect(await pool.queuedAssets()).to.equal(U(1_000));
    expect(await pool.initialClosing()).to.equal(BigInt(firstIssue));
    // Pool Assets: cash $10,000 less the $1,000 owed to the old request, plus $6,000 deployed.
    expect(await pool.totalAssets()).to.be.closeTo(U(15_000), U(0.01));
    expect(await pool.vaultCash()).to.equal(U(9_000));
    expect(await pool.convertToAssets(a)).to.be.closeTo(U(10_000), U(0.01));
    const [r0, s1, k, s2] = await pool.rateModel();
    expect([r0, s1, k, s2]).to.deep.equal([
      ethers.parseUnits("0.02", 18), ethers.parseUnits("0.03", 18), ethers.parseUnits("0.8", 18), ethers.parseUnits("0.05", 18),
    ]);
    expect(await pool.holdbackMaxAge()).to.equal(BigInt(540 * DAY));
  });

  it("pays the pre-2f queued claim, accrues interest on the legacy principal and takes the old borrower's repayment as a Return", async function () {
    const c = await legacyPool();
    const pool = await upgrade(c, (await latest()) - 10);

    const before = await c.usdc.balanceOf(c.carol.address);
    await pool.connect(c.carol).claimWithdrawal(0);
    expect(await c.usdc.balanceOf(c.carol.address) - before).to.equal(U(1_000));
    expect(await pool.queuedAssets()).to.equal(0n);
    await expect(pool.connect(c.carol).claimWithdrawal(0)).to.be.revertedWithCustomError(pool, "LendingPoolNothingQueued");

    await increase(30 * DAY);
    expect(await pool.accruedInterest()).to.be.greaterThan(0n);
    await expect(pool.connect(c.borrower).borrow(U(1), c.borrower.address))
      .to.be.revertedWithCustomError(pool, "LendingPoolDirectBorrowOff");
    await pool.connect(c.borrower).repay(U(6_100));
    expect(await pool.deployedBalance()).to.be.lessThan(U(6_000));
  });

  it("can be initialized only once, and must name the Initial Closing when shares exist", async function () {
    const c = await legacyPool();
    await expect(upgrade(c, 0)).to.be.reverted;
    const pool = await upgrade(c, (await latest()) - 10);
    await expect(pool.initializeYieldPool(await c.controls.getAddress(), c.lending.address, 1))
      .to.be.revertedWithCustomError(pool, "LendingPoolAlreadyInitialized");
  });

  it("refuses a module that is not the valuation module", async function () {
    const usdc = await (await ethers.getContractFactory("MockERC20")).deploy("x", "x", 6);
    await expect((await ethers.getContractFactory("LendingPool")).deploy(await usdc.getAddress())).to.be.reverted;
    const term = await (await ethers.getContractFactory("TermIssuerOrigination")).deploy();
    await expect((await ethers.getContractFactory("LendingPool")).deploy(await term.getAddress()))
      .to.be.reverted;
  });
});
