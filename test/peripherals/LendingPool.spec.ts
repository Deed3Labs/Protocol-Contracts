import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

const ONE_USDC = 10n ** 6n;
const BPS = 10_000n;

describe("LendingPool", function () {
  let pool: any, usdc: any;
  let admin: any, alice: any, bob: any, borrower: any, outsider: any;

  beforeEach(async function () {
    [admin, alice, bob, borrower, outsider] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);

    const LendingPool = await ethers.getContractFactory("LendingPool");
    pool = await upgrades.deployProxy(
      LendingPool,
      [admin.address, await usdc.getAddress(), "Clear Lending Pool", "clrLP"],
      { kind: "uups" }
    );
    await pool.grantRole(await pool.BORROWER_ROLE(), borrower.address);
    await pool.grantRole(await pool.LOSS_REPORTER_ROLE(), admin.address);

    for (const who of [alice, bob]) {
      await usdc.mint(who.address, 100_000n * ONE_USDC);
      await usdc.connect(who).approve(await pool.getAddress(), 100_000n * ONE_USDC);
    }
    await usdc.mint(borrower.address, 100_000n * ONE_USDC);
    await usdc.connect(borrower).approve(await pool.getAddress(), 100_000n * ONE_USDC);
  });

  async function deposit(who: any, amount: bigint) {
    await pool.connect(who).deposit(amount, who.address);
  }

  describe("it is a real ERC-4626 vault", function () {
    it("takes deposits and hands back proportional shares", async function () {
      await deposit(alice, 1_000n * ONE_USDC);
      expect(await pool.totalAssets()).to.equal(1_000n * ONE_USDC);
      expect(await pool.convertToAssets(await pool.balanceOf(alice.address)))
        .to.equal(1_000n * ONE_USDC);
    });

    it("counts lent money as an asset, because it is one", async function () {
      await deposit(alice, 1_000n * ONE_USDC);
      await pool.connect(borrower).borrow(600n * ONE_USDC, borrower.address);

      expect(await pool.totalAssets()).to.equal(1_000n * ONE_USDC);
      expect(await pool.availableCash()).to.equal(400n * ONE_USDC);
      expect(await pool.totalBorrowed()).to.equal(600n * ONE_USDC);
    });

    it("reports what would actually succeed, rather than what is owned", async function () {
      // The spec says maxWithdraw is what a withdrawal would return. A depositor whose money is
      // out on loan cannot have it back this second, and saying otherwise makes the number a lie.
      await deposit(alice, 1_000n * ONE_USDC);
      await pool.connect(borrower).borrow(900n * ONE_USDC, borrower.address);

      expect(await pool.maxWithdraw(alice.address)).to.equal(100n * ONE_USDC);
      await pool.connect(alice).withdraw(100n * ONE_USDC, alice.address, alice.address);
      expect(await pool.maxWithdraw(alice.address)).to.equal(0n);
    });

    it("raises the share price when more comes back than went out", async function () {
      await deposit(alice, 1_000n * ONE_USDC);
      await pool.connect(borrower).borrow(500n * ONE_USDC, borrower.address);

      // The carry earned on the tiers this pool funded comes back with the principal.
      await pool.connect(borrower).repay(550n * ONE_USDC);

      expect(await pool.totalAssets()).to.equal(1_050n * ONE_USDC);
      expect(await pool.convertToAssets(await pool.balanceOf(alice.address)))
        .to.be.greaterThan(1_049n * ONE_USDC);
    });
  });

  describe("the rate rises with utilization", function () {
    it("is cheapest when nothing is lent", async function () {
      await deposit(alice, 1_000n * ONE_USDC);
      expect(await pool.utilizationBps()).to.equal(0n);
      expect(await pool.borrowRatePerCycle()).to.equal(await pool.baseRatePerCycle());
    });

    it("climbs gently below the kink and steeply above it", async function () {
      await deposit(alice, 1_000n * ONE_USDC);

      await pool.connect(borrower).borrow(400n * ONE_USDC, borrower.address);
      const atForty = await pool.borrowRatePerCycle();

      await pool.connect(borrower).borrow(400n * ONE_USDC, borrower.address);
      const atEighty = await pool.borrowRatePerCycle(); // the kink

      await pool.connect(borrower).borrow(150n * ONE_USDC, borrower.address);
      const atNinetyFive = await pool.borrowRatePerCycle();

      expect(atForty).to.be.greaterThan(0n);
      expect(atEighty).to.be.greaterThan(atForty);
      expect(atNinetyFive).to.be.greaterThan(atEighty);

      // The steep part is steep: the last fifteen points cost more than the first eighty.
      expect(atNinetyFive - atEighty).to.be.greaterThan(atEighty - atForty);
    });

    it("dilutes the yield when capital arrives faster than demand", async function () {
      // The self-regulation. Nobody has to decide the pool is full.
      await deposit(alice, 1_000n * ONE_USDC);
      await pool.connect(borrower).borrow(800n * ONE_USDC, borrower.address);
      const before = await pool.supplyRatePerCycle();

      await deposit(bob, 4_000n * ONE_USDC);
      const after = await pool.supplyRatePerCycle();

      expect(after).to.be.lessThan(before);
    });

    it("pays depositors the borrow rate scaled by how much is earning it", async function () {
      await deposit(alice, 1_000n * ONE_USDC);
      await pool.connect(borrower).borrow(500n * ONE_USDC, borrower.address);

      const expected =
        ((await pool.borrowRatePerCycle()) * (await pool.utilizationBps())) / BPS;
      expect(await pool.supplyRatePerCycle()).to.equal(expected);
    });

    it("only lets an operator reshape the curve, and refuses a nonsense kink", async function () {
      await expect(pool.connect(outsider).setRateCurve(1n, 1n, 1n, 5_000n)).to.be.reverted;
      await expect(pool.setRateCurve(1n, 1n, 1n, 0n))
        .to.be.revertedWithCustomError(pool, "LendingPoolInvalidCurve");
      await expect(pool.setRateCurve(1n, 1n, 1n, BPS))
        .to.be.revertedWithCustomError(pool, "LendingPoolInvalidCurve");
    });
  });

  describe("the withdrawal queue", function () {
    it("queues rather than failing when the cash is out on loan", async function () {
      // A depositor whose money is lent has not made a mistake, and the app can show them where
      // they stand instead of an error.
      await deposit(alice, 1_000n * ONE_USDC);
      await pool.connect(borrower).borrow(900n * ONE_USDC, borrower.address);

      const shares = await pool.balanceOf(alice.address);
      await pool.connect(alice).requestWithdrawal(shares, alice.address);

      expect(await pool.balanceOf(alice.address)).to.equal(0n);
      const [owner, , assets, , claimed] = await pool.requestAt(0);
      expect(owner).to.equal(alice.address);
      expect(assets).to.equal(1_000n * ONE_USDC);
      expect(claimed).to.equal(false);
      expect(await pool.isClaimable(0)).to.equal(false);
    });

    it("stops the queued depositor earning and stops them carrying loss", async function () {
      // Waiting in line should not also cost you. The claim is fixed in assets when it is made.
      await deposit(alice, 1_000n * ONE_USDC);
      await deposit(bob, 1_000n * ONE_USDC);
      await pool.connect(borrower).borrow(1_500n * ONE_USDC, borrower.address);

      await pool.connect(alice).requestWithdrawal(await pool.balanceOf(alice.address), alice.address);
      const [, , queued] = await pool.requestAt(0);

      // A loss lands after Alice queued; her claim does not move, Bob's shares do.
      const bobBefore = await pool.convertToAssets(await pool.balanceOf(bob.address));
      await pool.absorbLoss(500n * ONE_USDC);
      const bobAfter = await pool.convertToAssets(await pool.balanceOf(bob.address));

      const [, , stillQueued] = await pool.requestAt(0);
      expect(stillQueued).to.equal(queued);
      expect(bobAfter).to.be.lessThan(bobBefore);
    });

    it("pays out once the loans come back", async function () {
      await deposit(alice, 1_000n * ONE_USDC);
      await pool.connect(borrower).borrow(900n * ONE_USDC, borrower.address);
      await pool.connect(alice).requestWithdrawal(await pool.balanceOf(alice.address), alice.address);

      await pool.connect(borrower).repay(900n * ONE_USDC);
      expect(await pool.isClaimable(0)).to.equal(true);

      const before = await usdc.balanceOf(alice.address);
      await pool.connect(alice).claimWithdrawal(0);
      expect(await usdc.balanceOf(alice.address) - before).to.equal(1_000n * ONE_USDC);
      expect(await pool.queuedAssets()).to.equal(0n);
    });

    it("does not lend out cash that is already spoken for", async function () {
      await deposit(alice, 1_000n * ONE_USDC);
      await pool.connect(borrower).borrow(900n * ONE_USDC, borrower.address);
      await pool.connect(alice).requestWithdrawal(await pool.balanceOf(alice.address), alice.address);
      await pool.connect(borrower).repay(900n * ONE_USDC);

      // The cash is back, but it belongs to the queue.
      expect(await pool.availableCash()).to.equal(0n);
      await expect(pool.connect(borrower).borrow(1n, borrower.address))
        .to.be.revertedWithCustomError(pool, "LendingPoolInsufficientCash");
    });

    it("refuses a claim from anyone but the depositor who queued", async function () {
      await deposit(alice, 1_000n * ONE_USDC);
      await pool.connect(alice).requestWithdrawal(await pool.balanceOf(alice.address), alice.address);
      await expect(pool.connect(outsider).claimWithdrawal(0))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotRequestOwner");
    });

    it("refuses to pay the same claim twice", async function () {
      await deposit(alice, 1_000n * ONE_USDC);
      await pool.connect(alice).requestWithdrawal(await pool.balanceOf(alice.address), alice.address);
      await pool.connect(alice).claimWithdrawal(0);
      await expect(pool.connect(alice).claimWithdrawal(0))
        .to.be.revertedWithCustomError(pool, "LendingPoolNothingQueued");
    });
  });

  describe("first loss sits here, ahead of the AssurancePool", function () {
    it("takes the loss out of the share price", async function () {
      // Depositors earn the return on unsecured lending, so they carry its first loss.
      await deposit(alice, 1_000n * ONE_USDC);
      await pool.connect(borrower).borrow(600n * ONE_USDC, borrower.address);
      const before = await pool.convertToAssets(await pool.balanceOf(alice.address));

      const [absorbed, uncovered] = await pool.absorbLoss.staticCall(200n * ONE_USDC);
      await pool.absorbLoss(200n * ONE_USDC);

      expect(absorbed).to.equal(200n * ONE_USDC);
      expect(uncovered).to.equal(0n);
      expect(await pool.totalAssets()).to.equal(800n * ONE_USDC);
      expect(await pool.convertToAssets(await pool.balanceOf(alice.address)))
        .to.be.lessThan(before);
    });

    it("reports what it could not cover instead of reverting", async function () {
      // A loss larger than first-loss capacity is exactly when the next layer is meant to act.
      // Reverting there would stall the write-off rather than escalate it.
      await deposit(alice, 1_000n * ONE_USDC);
      await pool.connect(borrower).borrow(300n * ONE_USDC, borrower.address);

      const [absorbed, uncovered] = await pool.absorbLoss.staticCall(500n * ONE_USDC);
      expect(absorbed).to.equal(300n * ONE_USDC);
      expect(uncovered).to.equal(200n * ONE_USDC);
    });

    it("never reaches a depositor's cash, only the loans", async function () {
      // The pool can lose what it lent. It cannot lose what it never lent out.
      await deposit(alice, 1_000n * ONE_USDC);
      await pool.connect(borrower).borrow(200n * ONE_USDC, borrower.address);

      await pool.absorbLoss(10_000n * ONE_USDC);
      expect(await pool.totalBorrowed()).to.equal(0n);
      expect(await pool.totalAssets()).to.equal(800n * ONE_USDC);
      expect(await usdc.balanceOf(await pool.getAddress())).to.equal(800n * ONE_USDC);
    });

    it("only lets a loss reporter report one", async function () {
      await expect(pool.connect(outsider).absorbLoss(1n)).to.be.reverted;
    });
  });

  describe("borrowing", function () {
    it("is gated to the borrower role", async function () {
      await deposit(alice, 1_000n * ONE_USDC);
      await expect(pool.connect(outsider).borrow(1n, outsider.address)).to.be.reverted;
    });

    it("cannot lend more cash than the pool holds", async function () {
      await deposit(alice, 1_000n * ONE_USDC);
      await expect(pool.connect(borrower).borrow(1_001n * ONE_USDC, borrower.address))
        .to.be.revertedWithCustomError(pool, "LendingPoolInsufficientCash");
    });
  });
});
