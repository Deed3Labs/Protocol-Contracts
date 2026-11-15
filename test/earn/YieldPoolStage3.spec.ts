import { expect } from "chai";
import { ethers } from "hardhat";
import { DAY, U, deployYieldPool, increase, latest } from "../helpers/yieldPool";
import { withRealControls } from "../helpers/earnControls";

/*
 * Phase 2f stage 3, the Yield Pool's last IV-02 powers, built on the enforcement branch's pool:
 *  - decision 34: holds required by law (IV-02 §7.5), two signers and the order's hash, only the
 *    shares the order names, ending on a two-signer release or the order's stated expiry;
 *  - decision 35: Successor redemption (IV-02 §8.3) through the ordinary queue, paid only to the
 *    Successor registered for payment in EarnControls (7 days, cancellable by the Holder).
 * Decision 33 (the full loss charge off the Deployed Balance) is in YieldPool.spec.ts, tests 15 and
 * 20, and YieldPoolConformance.spec.ts (Exhibit A, A10).
 */
describe("Yield Pool, Phase 2f stage 3 (decisions 34 and 35)", function () {
  let f: Awaited<ReturnType<typeof deployYieldPool>>;
  let pool: any;
  const ORDER = ethers.id("OFAC blocking order 2026-114");

  beforeEach(async function () {
    f = await deployYieldPool();
    pool = f.pool;
    await pool.connect(f.alice).deposit(U(1_000), f.alice.address);
    await pool.connect(f.bob).deposit(U(1_000), f.bob.address);
  });

  /** A hold by the suspension signer s1 and the CCO. */
  async function hold(holder: string, shares: bigint, expiresAt = 0n, order = ORDER) {
    await pool.connect(f.s1).placeLegalHold(holder, shares, order, expiresAt);
    return pool.connect(f.cco).placeLegalHold(holder, shares, order, expiresAt);
  }

  /* ------------------------------------------------------------ decision 34 */
  describe("§7.5 legal holds (decision 34)", function () {
    it("take two signers, one the CCO or treasurer, and the order's hash", async function () {
      await expect(pool.connect(f.s1).placeLegalHold(f.alice.address, U(400), ethers.ZeroHash, 0))
        .to.be.revertedWithCustomError(pool, "LendingPoolInvalidAmount");
      await expect(pool.connect(f.outsider).placeLegalHold(f.alice.address, U(400), ORDER, 0))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
      // A Deployment or valuation signer holds no power here.
      await expect(pool.connect(f.v1).placeLegalHold(f.alice.address, U(400), ORDER, 0))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
      await expect(pool.connect(f.d1).placeLegalHold(f.alice.address, U(400), ORDER, 0))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");

      // One signer only proposes.
      await pool.connect(f.s1).placeLegalHold(f.alice.address, U(400), ORDER, 0);
      expect(await pool.heldSharesOf(f.alice.address)).to.equal(0n);
      await expect(pool.connect(f.s1).placeLegalHold(f.alice.address, U(400), ORDER, 0))
        .to.be.revertedWithCustomError(pool, "LendingPoolSameSigner");
      // Two suspension signers, neither an officer, cannot.
      await expect(pool.connect(f.s2).placeLegalHold(f.alice.address, U(400), ORDER, 0))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
      await expect(pool.connect(f.cco).placeLegalHold(f.alice.address, U(400), ORDER, 0))
        .to.emit(pool, "LegalHoldPlaced").withArgs(0n, f.alice.address, U(400), ORDER, 0n, f.s1.address, f.cco.address);
      expect(await pool.heldSharesOf(f.alice.address)).to.equal(U(400));
      const h = await pool.legalHold(0);
      expect(h.holder).to.equal(f.alice.address);
      expect(h.orderHash).to.equal(ORDER);
      expect(h.inForce).to.equal(true);
    });

    it("covers only the named shares of one holder: they cannot be redeemed, queued or moved; the rest can", async function () {
      await hold(f.alice.address, U(400));
      // Nothing moved or burned.
      expect(await pool.balanceOf(f.alice.address)).to.equal(U(1_000));
      expect(await pool.totalSupply()).to.equal(U(2_000));
      expect(await pool.maxRedeem(f.alice.address)).to.equal(U(600));
      expect(await pool.freeSharesOf(f.alice.address)).to.equal(U(600));

      await expect(pool.connect(f.alice).redeem(U(601), f.alice.address, f.alice.address))
        .to.be.revertedWithCustomError(pool, "LendingPoolEncumbered").withArgs(f.alice.address, U(600), U(601));
      await expect(pool.connect(f.alice).requestWithdrawal(U(601), f.alice.address))
        .to.be.revertedWithCustomError(pool, "LendingPoolEncumbered");
      await f.controls.link(f.alice.address, f.alice2.address); // her second Smart Account
      await expect(pool.connect(f.alice).transfer(f.alice2.address, U(601)))
        .to.be.revertedWithCustomError(pool, "LendingPoolEncumbered");

      // Her other 600 shares, and every other holder's, are not affected.
      await pool.connect(f.alice).transfer(f.alice2.address, U(100));
      await pool.connect(f.alice).requestWithdrawal(U(100), f.alice.address);
      await pool.connect(f.alice).cancelRequest(0, U(100));
      await pool.connect(f.alice).redeem(U(500), f.alice.address, f.alice.address);
      expect(await pool.balanceOf(f.alice.address)).to.equal(U(400));
      await pool.connect(f.bob).redeem(U(1_000), f.bob.address, f.bob.address);
      // The held 400 stay where they are.
      await expect(pool.connect(f.alice).redeem(1n, f.alice.address, f.alice.address))
        .to.be.revertedWithCustomError(pool, "LendingPoolEncumbered");
    });

    it("can name only shares in the holder's account, and no more than are not already held", async function () {
      await expect(hold(f.alice.address, U(1_001))).to.be.revertedWithCustomError(pool, "LendingPoolEncumbered");
      await hold(f.alice.address, U(700));
      await expect(hold(f.alice.address, U(301), 0n, ethers.id("second order")))
        .to.be.revertedWithCustomError(pool, "LendingPoolEncumbered");
      await hold(f.alice.address, U(300), 0n, ethers.id("second order"));
      expect(await pool.heldSharesOf(f.alice.address)).to.equal(U(1_000));
      expect(await pool.legalHoldsOf(f.alice.address)).to.deep.equal([0n, 1n]);
    });

    it("ends when the order's stated expiry passes", async function () {
      const expiry = BigInt(await latest()) + 30n * BigInt(DAY);
      await expect(hold(f.alice.address, U(400), BigInt(await latest())))
        .to.be.revertedWithCustomError(pool, "LendingPoolInvalidAmount");
      await hold(f.alice.address, U(400), expiry);
      expect(await pool.maxRedeem(f.alice.address)).to.equal(U(600));
      await increase(30 * DAY);
      expect(await pool.heldSharesOf(f.alice.address)).to.equal(0n);
      expect((await pool.legalHold(0)).inForce).to.equal(false);
      await pool.connect(f.alice).redeem(U(1_000), f.alice.address, f.alice.address);
    });

    it("ends when two signers release it", async function () {
      await hold(f.alice.address, U(400));
      await expect(pool.connect(f.outsider).releaseLegalHold(0)).to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
      await pool.connect(f.s2).releaseLegalHold(0);
      expect(await pool.heldSharesOf(f.alice.address)).to.equal(U(400)); // one signer only proposes
      await expect(pool.connect(f.cco).releaseLegalHold(0))
        .to.emit(pool, "LegalHoldReleased").withArgs(0n, f.alice.address, f.s2.address, f.cco.address);
      expect(await pool.heldSharesOf(f.alice.address)).to.equal(0n);
      expect(await pool.legalHoldsOf(f.alice.address)).to.deep.equal([]);
      await expect(pool.connect(f.s1).releaseLegalHold(0)).to.be.revertedWithCustomError(pool, "LendingPoolInvalidAmount");
      await pool.connect(f.alice).redeem(U(1_000), f.alice.address, f.alice.address);
    });

    it("an MB-05 enforcement waits for a hold on pledged shares; Final Maturity run-off leaves held shares", async function () {
      const signals: any = await (await ethers.getContractFactory("MockCollateralSignals")).deploy();
      await pool.setEncumbranceSource(await signals.getAddress(), ethers.encodeBytes32String("POOL_SHARE"));
      await signals.setLock(f.alice.address, U(800));
      await hold(f.alice.address, U(500));
      // 800 pledged and 500 held of 1,000: enforcement may queue only the 500 not held.
      await expect(pool.connect(f.enforcer).enforcementRedeem(f.alice.address, U(501)))
        .to.be.revertedWithCustomError(pool, "LendingPoolEncumbered");
      await pool.connect(f.enforcer).enforcementRedeem(f.alice.address, U(500));
      // The holder herself has nothing free.
      expect(await pool.freeSharesOf(f.alice.address)).to.equal(0n);

      // From the Final Maturity Date, run-off queues only bob's shares not held.
      await hold(f.bob.address, U(400), 0n, ethers.id("bob's order"));
      await increase(20 * 366 * DAY);
      await pool.connect(f.outsider).requestRunOff(f.bob.address);
      expect(await pool.queuedSharesOf(f.bob.address)).to.equal(U(600));
      expect(await pool.balanceOf(f.bob.address)).to.equal(U(400));
    });

    it("keeps at most eight holds open per holder, pruning expired ones", async function () {
      const t = BigInt(await latest());
      for (let i = 0; i < 8; i++) await hold(f.alice.address, U(10), t + 1000n, ethers.id(`order ${i}`));
      await expect(hold(f.alice.address, U(10), 0n, ethers.id("order 8")))
        .to.be.revertedWithCustomError(pool, "LendingPoolInvalidAmount");
      await increase(1000);
      await hold(f.alice.address, U(10), 0n, ethers.id("order 9"));
      expect(await pool.legalHoldsOf(f.alice.address)).to.deep.equal([8n]);
    });
  });

  /* ------------------------------------------------------------ decision 35 */
  describe("§8.3 Successor redemption (decision 35)", function () {
    let c: Awaited<ReturnType<typeof withRealControls>>;
    const PROOF = ethers.id("W.S. 34.1-8-402 proof, identity verification, W-9 and indemnity");

    beforeEach(async function () {
      await pool.connect(f.alice).deposit(U(9_400), f.alice.address); // alice holds 10,400
      c = await withRealControls(f);
    });

    async function register(holder = f.alice.address, successor = f.carol.address) {
      return c.two(c.succ1, c.succ2, "registerPaymentSuccessor", holder, successor, PROOF);
    }

    it("only the registered Successor, only once the 7 days have run, and never a Clear key", async function () {
      await expect(pool.connect(f.carol).successorRedeem(f.alice.address, U(1_000)))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized"); // nobody registered
      await register();
      await expect(pool.connect(f.carol).successorRedeem(f.alice.address, U(1_000)))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized"); // within the 7 days
      await increase(7 * DAY);
      for (const who of [f.admin, c.succ1, c.succ2, f.cco, f.s1, f.v1, f.d1, f.enforcer, f.bob]) {
        await expect(pool.connect(who).successorRedeem(f.alice.address, U(1_000)))
          .to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
      }
      await expect(pool.connect(f.carol).successorRedeem(f.alice.address, U(1_000)))
        .to.emit(pool, "SuccessorRedemptionRequested").withArgs(f.alice.address, f.carol.address, 0n, U(1_000));
    });

    it("redeems through the ordinary queue, in order, paying only the Successor: $10,244 paid, $156 held for the Successor", async function () {
      await register();
      await increase(7 * DAY);
      // Pool Assets $11,400; a $171 allowance is a 1.5% holdback.
      await f.allowance(U(171));
      expect(await pool.holdbackRate()).to.equal(ethers.parseUnits("0.015", 18));
      await pool.connect(f.bob).requestWithdrawal(U(1_000), f.bob.address); // earlier in line
      await pool.connect(f.carol).successorRedeem(f.alice.address, U(10_400));
      const [owner, receiver, shares, , enforcement] = await pool.queueRequest(1);
      expect([owner, receiver, shares, enforcement]).to.deep.equal([f.alice.address, f.carol.address, U(10_400), false]);
      expect(await pool.balanceOf(f.alice.address)).to.equal(0n);

      const alice0: bigint = await f.usdc.balanceOf(f.alice.address);
      const bob0: bigint = await f.usdc.balanceOf(f.bob.address);
      const carol0: bigint = await f.usdc.balanceOf(f.carol.address);
      await expect(pool.connect(f.outsider).fillQueue(1)).to.emit(pool, "QueueFilled").withArgs(0n, U(1_000), U(1_000), U(985), 0n);
      expect(await f.usdc.balanceOf(f.carol.address)).to.equal(carol0); // bob first
      await expect(pool.connect(f.outsider).fillQueue(1))
        .to.emit(pool, "HoldbackRecorded").withArgs(f.carol.address, 1n, U(10_400), U(156));
      expect((await f.usdc.balanceOf(f.carol.address)) - carol0).to.equal(U(10_244));
      expect(await f.usdc.balanceOf(f.alice.address)).to.equal(alice0);
      expect((await f.usdc.balanceOf(f.bob.address)) - bob0).to.equal(U(985));
      // A later release of the Successor's holdback goes to the Successor.
      await f.allowance(0n);
      const carol1: bigint = await f.usdc.balanceOf(f.carol.address);
      await pool.connect(f.outsider).releaseHoldbacks(10);
      expect((await f.usdc.balanceOf(f.carol.address)) - carol1).to.equal(U(156));
      expect(await f.usdc.balanceOf(f.alice.address)).to.equal(alice0);
    });

    it("the Holder's own account cancels a queued Successor request, or the registration", async function () {
      await register();
      await increase(7 * DAY);
      await pool.connect(f.carol).successorRedeem(f.alice.address, U(4_000));
      // The Holder can still sign: she cancels the request, and her shares come back.
      await pool.connect(f.alice).cancelRequest(0, U(4_000));
      expect(await pool.balanceOf(f.alice.address)).to.equal(U(10_400));
      // ... and the registration, after which the Successor path is closed.
      await c.controls.connect(f.alice).cancelPaymentSuccessor();
      await expect(pool.connect(f.carol).successorRedeem(f.alice.address, U(1)))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
      // A Successor cannot cancel the Holder's request.
      await register();
      await increase(7 * DAY);
      await pool.connect(f.carol).successorRedeem(f.alice.address, U(1_000));
      await expect(pool.connect(f.carol).cancelRequest(1, U(1_000)))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotRequestOwner");
    });

    it("reaches only free shares: never pledged or legally held ones", async function () {
      await register();
      await increase(7 * DAY);
      const signals: any = await (await ethers.getContractFactory("MockCollateralSignals")).deploy();
      await pool.setEncumbranceSource(await signals.getAddress(), ethers.encodeBytes32String("POOL_SHARE"));
      await signals.setLock(f.alice.address, U(3_000));
      await hold(f.alice.address, U(2_000));
      await expect(pool.connect(f.carol).successorRedeem(f.alice.address, U(5_401)))
        .to.be.revertedWithCustomError(pool, "LendingPoolEncumbered").withArgs(f.alice.address, U(5_400), U(5_401));
      await pool.connect(f.carol).successorRedeem(f.alice.address, U(5_400));
      expect(await pool.balanceOf(f.alice.address)).to.equal(U(5_000));
    });
  });
});
