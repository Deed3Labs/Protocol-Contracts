import { expect } from "chai";
import { ethers } from "hardhat";
import {
  BPS, DAY, EVIDENCE, HOUR, LEGAL_ORDER, LOSS_EVENT, U, USDC_OR_NETWORK, VALUATION_PENDING, WAD,
  deployYieldPool, increase, latest, setNext,
} from "../helpers/yieldPool";
import { EQUITY_CUSHION, attestation, withRealControls } from "../helpers/earnControls";

/*
 * Phase 2f: LendingPool is the Yield Pool. Acceptance tests 11–15 and 20–25 of
 * docs/audit/specs/earn-contract-requirements.md (the pool's halves), with the spec's figures where
 * it gives them.
 */
describe("Yield Pool (Earn §6, §6A, §7, §8)", function () {
  let f: Awaited<ReturnType<typeof deployYieldPool>>;
  let pool: any, usdc: any;

  beforeEach(async function () {
    f = await deployYieldPool();
    pool = f.pool;
    usdc = f.usdc;
  });

  /* ------------------------------------------------------------------ 11 */
  describe("11. Funding Rate", function () {
    it("gives the spec's figures at the initial parameters", async function () {
      expect(await pool.fundingRateAt(0n)).to.equal(ethers.parseUnits("0.02", 18));
      expect(await pool.fundingRateAt(ethers.parseUnits("0.5", 18))).to.equal(ethers.parseUnits("0.03875", 18));
      expect(await pool.fundingRateAt(ethers.parseUnits("0.8", 18))).to.equal(ethers.parseUnits("0.05", 18));
      expect(await pool.fundingRateAt(ethers.parseUnits("0.9", 18))).to.equal(ethers.parseUnits("0.075", 18));
      expect(await pool.fundingRateAt(WAD)).to.equal(ethers.parseUnits("0.10", 18));
    });

    it("refuses a parameter set with R0 + S1 + S2 above 10%, or outside a bound", async function () {
      const p = (x: string) => ethers.parseUnits(x, 18);
      await expect(pool.proposeRateModel(p("0.03"), p("0.03"), p("0.8"), p("0.05")))
        .to.be.revertedWithCustomError(pool, "LendingPoolInvalidRateModel");
      await expect(pool.proposeRateModel(p("0.06"), 0n, p("0.8"), 0n))
        .to.be.revertedWithCustomError(pool, "LendingPoolInvalidRateModel");
      await expect(pool.proposeRateModel(p("0.02"), p("0.03"), p("0.95"), p("0.05")))
        .to.be.revertedWithCustomError(pool, "LendingPoolInvalidRateModel");
      await expect(pool.connect(f.outsider).proposeRateModel(p("0.02"), p("0.03"), p("0.8"), p("0.05"))).to.be.reverted;
    });

    it("takes a raise after 48 hours, a cut only after 30 days, and one cut per calendar quarter", async function () {
      const p = (x: string) => ethers.parseUnits(x, 18);
      // Start of a calendar quarter (UTC), so both cuts below fall in the same one.
      const year = new Date((await latest()) * 1000).getUTCFullYear() + 1;
      const q = Date.UTC(year, 0, 1) / 1000;
      await setNext(q);
      await pool.proposeRateModel(p("0.03"), p("0.03"), p("0.8"), p("0.04")); // higher at every U
      await expect(pool.applyRateModel()).to.be.revertedWithCustomError(pool, "LendingPoolRateNotice");
      await increase(48 * HOUR);
      await pool.applyRateModel();
      expect((await pool.rateModel()).r0).to.equal(p("0.03"));

      await pool.proposeRateModel(p("0.01"), p("0.03"), p("0.8"), p("0.04")); // lower at U = 0
      expect((await pool.pendingRate()).lowers).to.equal(true);
      await increase(29 * DAY);
      await expect(pool.applyRateModel()).to.be.revertedWithCustomError(pool, "LendingPoolRateNotice");
      await increase(1 * DAY);
      await pool.applyRateModel();
      expect((await pool.rateModel()).r0).to.equal(p("0.01"));

      // A second cut that would take effect in the same quarter.
      await expect(pool.proposeRateModel(0n, p("0.03"), p("0.8"), p("0.04")))
        .to.be.revertedWithCustomError(pool, "LendingPoolRateQuarter");
      // Next quarter it is allowed.
      await setNext(Date.UTC(year, 2, 5) / 1000);
      await pool.proposeRateModel(0n, p("0.03"), p("0.8"), p("0.04"));
    });

    // Conformance pass (decision 24): unpaid interest is now capitalized after each month, so a
    // 365-day run no longer shows simple interest. This checks the per-second accrual within one
    // month; test/earn/YieldPoolConformance.spec.ts covers billing and capitalization.
    it("accrues Pool Interest per second on the Deployed Balance at the Funding Rate", async function () {
      const year = new Date((await latest()) * 1000).getUTCFullYear() + 1;
      await setNext(Date.UTC(year, 2, 2, 20) / 1000); // 2 March, well inside a Pacific month
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      await f.deploy(U(5_000));
      const t0 = await latest();
      expect(await pool.utilization()).to.equal(WAD / 2n);
      await increase(20 * DAY);
      const elapsed = BigInt((await latest()) - t0);
      const expected = (U(5_000) * ethers.parseUnits("0.03875", 18) * elapsed) / (365n * 86400n * WAD);
      expect(await pool.accruedInterest()).to.be.closeTo(expected, 2n);
    });
  });

  /* ------------------------------------------------------------------ 12 */
  describe("12. Deployments", function () {
    beforeEach(async function () {
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
    });

    it("go only to the registered lending account, by two people, and are recorded", async function () {
      await pool.connect(f.d1).deploy(U(1_000), ethers.ZeroHash);
      expect(await usdc.balanceOf(f.lending.address)).to.equal(U(1_000_000)); // proposal moves nothing
      await expect(pool.connect(f.d1).deploy(U(1_000), ethers.ZeroHash))
        .to.be.revertedWithCustomError(pool, "LendingPoolSameSigner");
      await expect(pool.connect(f.d2).deploy(U(1_000), ethers.ZeroHash))
        .to.emit(pool, "Deployed").withArgs(0n, f.lending.address, U(1_000), f.d1.address, f.d2.address);
      expect(await usdc.balanceOf(f.lending.address)).to.equal(U(1_001_000));
      expect(await pool.deployedBalance()).to.equal(U(1_000));
      expect(await pool.deploymentCount()).to.equal(1n);
      await expect(pool.connect(f.outsider).deploy(U(1), ethers.ZeroHash))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
    });

    it("revert above 90% utilization", async function () {
      await expect(f.deploy(U(9_000) + 1n)).to.be.revertedWithCustomError(pool, "LendingPoolUtilizationCap");
      await f.deploy(U(9_000));
      expect(await pool.utilization()).to.equal(ethers.parseUnits("0.9", 18));
      await increase(DAY);
      // Utilization is the Deployed Balance over it plus Vault Cash (IV-02 §1.2): accrued interest
      // does not move it, and it is still exactly 90%, so nothing more goes out.
      expect(await pool.utilization()).to.equal(ethers.parseUnits("0.9", 18));
      await expect(f.deploy(1n)).to.be.revertedWithCustomError(pool, "LendingPoolUtilizationCap");
    });

    it("revert with an open queue request", async function () {
      await pool.connect(f.alice).requestWithdrawal(U(1), f.alice.address);
      await expect(pool.connect(f.d1).deploy(U(100), ethers.ZeroHash))
        .to.be.revertedWithCustomError(pool, "LendingPoolQueueOpen");
    });

    it("revert during a Suspension", async function () {
      await f.two(f.s1, f.cco, "suspend", LOSS_EVENT, EVIDENCE, ethers.ZeroHash);
      await expect(pool.connect(f.d1).deploy(U(100), ethers.ZeroHash))
        .to.be.revertedWithCustomError(pool, "LendingPoolSuspended");
    });

    it("direct borrowing is off: borrow reverts and nothing is borrowable (decision 17)", async function () {
      await pool.grantRole(await pool.BORROWER_ROLE(), f.outsider.address);
      await expect(pool.connect(f.outsider).borrow(U(1), f.outsider.address))
        .to.be.revertedWithCustomError(pool, "LendingPoolDirectBorrowOff");
      expect(await pool.borrowableToday(f.outsider.address)).to.equal(0n);
    });

    it("Returns pay accrued interest first, then the Deployed Balance; anyone may return", async function () {
      // Conformance pass (decision 24): kept inside one Pacific month, so nothing is capitalized.
      const year = new Date((await latest()) * 1000).getUTCFullYear() + 1;
      await setNext(Date.UTC(year, 4, 2, 20) / 1000); // 2 May
      await f.deploy(U(5_000));
      await increase(25 * DAY);
      const interest: bigint = await pool.accruedInterest();
      expect(interest).to.be.greaterThan(0n);
      const tx = await pool.connect(f.outsider).returnFunds(U(1_000));
      const rc = await tx.wait();
      const ev = rc.logs.map((l: any) => { try { return pool.interface.parseLog(l); } catch { return null; } })
        .find((e: any) => e?.name === "Returned");
      expect(ev.args.interestPaid).to.be.closeTo(interest, 100n);
      expect(ev.args.principalPaid + ev.args.interestPaid).to.equal(U(1_000));
      expect(await pool.deployedBalance()).to.equal(U(5_000) - ev.args.principalPaid);
    });
  });

  /* ------------------------------------------------------------------ 13 */
  describe("13. The queue", function () {
    it("is FIFO, fills at the Share Value at fill (after a loss charge), allows a part cancel, and applies the holdback", async function () {
      const { alice, bob, carol } = f;
      await pool.connect(alice).deposit(U(10_000), alice.address);
      await pool.connect(bob).deposit(U(10_000), bob.address);
      await f.deploy(U(18_000));

      // A then B.
      await pool.connect(alice).requestWithdrawal(U(5_000), alice.address);
      await pool.connect(bob).requestWithdrawal(U(5_000), bob.address);
      expect(await pool.maxRedeem(carol.address)).to.equal(0n);
      expect(await pool.maxRedeem(bob.address)).to.equal(0n);
      expect(await pool.maxWithdraw(alice.address)).to.equal(0n);

      // B cannot fill before A: the cash goes to A first, partly.
      await pool.connect(carol).fillQueue(10);
      const [, , aLeft] = await pool.queueRequest(0);
      const [, , bLeft] = await pool.queueRequest(1);
      expect(aLeft).to.be.greaterThan(0n);
      expect(aLeft).to.be.lessThan(U(5_000));
      expect(bLeft).to.equal(U(5_000));

      // A Pool Loss Charge lowers Share Value 2% between request and fill.
      const before: bigint = await pool.shareValue();
      await f.lossCharge(((await pool.totalAssets()) * 2n) / 100n);
      const after: bigint = await pool.shareValue();
      expect(after).to.be.closeTo((before * 98n) / 100n, ethers.parseUnits("0.0002", 18));

      // A cancels half of what is left, and gets the rest at the new Share Value.
      const half = aLeft / 2n;
      await pool.connect(alice).cancelRequest(0, half);
      expect(await pool.queuedSharesOf(alice.address)).to.equal(aLeft - half);

      // With holdbackBps = 150 at fill, A gets 98.5% of the gross and a 1.5% holdback.
      await f.allowanceForBps(150n);
      expect(await pool.holdbackBps()).to.equal(150n);
      await pool.connect(f.lending).returnFunds(U(10_000));
      const aBefore = await usdc.balanceOf(alice.address);
      const tx = await pool.connect(carol).fillQueue(1);
      const rc = await tx.wait();
      const filled = rc.logs.map((l: any) => { try { return pool.interface.parseLog(l); } catch { return null; } })
        .find((e: any) => e?.name === "QueueFilled");
      const gross: bigint = filled.args.gross;
      expect(filled.args.shares).to.equal(aLeft - half);
      // Filled at the Share Value at fill: within interest of the post-charge value.
      expect(gross).to.be.closeTo(((aLeft - half) * after) / WAD, U(0.01));
      const held = (gross * 150n + BPS - 1n) / BPS;
      expect(await usdc.balanceOf(alice.address) - aBefore).to.equal(gross - held);
      expect(await pool.holdbackOf(alice.address)).to.equal(held);
      await expect(tx).to.emit(pool, "HoldbackRecorded").withArgs(alice.address, 0n, gross, held);
      // B is next.
      const [, , bStill] = await pool.queueRequest(1);
      expect(bStill).to.equal(U(5_000));
    });

    it("redeemOrQueue takes what cash allows now and queues the rest", async function () {
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      await f.deploy(U(8_000));
      const before = await usdc.balanceOf(f.alice.address);
      const [paid, id] = await pool.connect(f.alice).redeemOrQueue.staticCall(U(5_000), f.alice.address);
      await pool.connect(f.alice).redeemOrQueue(U(5_000), f.alice.address);
      expect(paid).to.be.closeTo(U(2_000), U(0.01));
      expect(await usdc.balanceOf(f.alice.address) - before).to.be.closeTo(paid, 1n);
      expect(id).to.equal(0n);
      expect(await pool.queuedShares()).to.be.greaterThan(U(2_999));
      expect(await pool.oldestRequestAge()).to.be.lessThan(5n);
      await increase(31 * DAY);
      expect(await pool.oldestRequestAge()).to.be.greaterThanOrEqual(BigInt(31 * DAY));
    });

    it("queued shares keep earning and fill at the Share Value at fill, not when queued (C4, replaces X-7)", async function () {
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      await f.deploy(U(9_000));
      await pool.connect(f.alice).requestWithdrawal(U(1_000), f.alice.address);
      const atRequest: bigint = await pool.convertToAssets(U(1_000));
      await increase(180 * DAY);
      await pool.connect(f.lending).returnFunds(U(2_000));
      const tx = await pool.fillQueue(1);
      const rc = await tx.wait();
      const ev = rc.logs.map((l: any) => { try { return pool.interface.parseLog(l); } catch { return null; } })
        .find((e: any) => e?.name === "QueueFilled");
      // X-7 capped the claim at its value when queued; now it carries the interest it earned waiting.
      expect(ev.args.gross).to.be.greaterThan(atRequest + U(15));
    });

    it("only the owner cancels, at any time; an enforcement request only by the enforcer", async function () {
      await pool.connect(f.alice).deposit(U(1_000), f.alice.address);
      await pool.connect(f.alice).requestWithdrawal(U(500), f.alice.address);
      await expect(pool.connect(f.bob).cancelRequest(0, U(1)))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotRequestOwner");
      await f.two(f.s1, f.cco, "suspend", LOSS_EVENT, EVIDENCE, ethers.ZeroHash);
      await pool.connect(f.alice).cancelRequest(0, U(500));
      expect(await pool.balanceOf(f.alice.address)).to.equal(U(1_000));
      expect(await pool.queuedShares()).to.equal(0n);
    });

    it("refuses a plain transfer into the pool: shares enter escrow only through the queue", async function () {
      await pool.connect(f.alice).deposit(U(1_000), f.alice.address);
      await expect(pool.connect(f.alice).transfer(f.poolAddress, 1n))
        .to.be.revertedWithCustomError(pool, "LendingPoolTransferNotAllowed");
    });
  });

  /* ------------------------------------------------------------------ 14 */
  describe("14. Suspension", function () {
    it("needs two different signers, one of them the CCO or treasurer", async function () {
      await pool.connect(f.s1).suspend(LOSS_EVENT, EVIDENCE, ethers.ZeroHash);
      await expect(pool.connect(f.s1).suspend(LOSS_EVENT, EVIDENCE, ethers.ZeroHash))
        .to.be.revertedWithCustomError(pool, "LendingPoolSameSigner");
      await expect(pool.connect(f.s2).suspend(LOSS_EVENT, EVIDENCE, ethers.ZeroHash))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
      await expect(pool.connect(f.outsider).suspend(LOSS_EVENT, EVIDENCE, ethers.ZeroHash))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
      expect(await pool.isSuspended()).to.equal(false);
      await expect(pool.connect(f.cco).suspend(LOSS_EVENT, EVIDENCE, ethers.ZeroHash)).to.emit(pool, "Suspended");
      expect(await pool.isSuspended()).to.equal(true);
    });

    it("lifts at 72 hours", async function () {
      await f.two(f.s1, f.cco, "suspend", LOSS_EVENT, EVIDENCE, ethers.ZeroHash);
      await increase(72 * HOUR - 5);
      expect(await pool.isSuspended()).to.equal(true);
      await increase(5);
      expect(await pool.isSuspended()).to.equal(false);
    });

    it("renews only by a signer other than the one who set or last renewed it", async function () {
      await f.two(f.s1, f.cco, "suspend", LOSS_EVENT, EVIDENCE, ethers.ZeroHash);
      await expect(pool.connect(f.s1).renewSuspension(ethers.ZeroHash, ethers.ZeroHash))
        .to.be.revertedWithCustomError(pool, "LendingPoolSameSigner");
      await pool.connect(f.cco).renewSuspension(ethers.ZeroHash, ethers.ZeroHash);
      await expect(pool.connect(f.cco).renewSuspension(ethers.ZeroHash, ethers.ZeroHash))
        .to.be.revertedWithCustomError(pool, "LendingPoolSameSigner");
      await pool.connect(f.s2).renewSuspension(ethers.ZeroHash, ethers.ZeroHash);
    });

    it("beyond 240 hours needs a Lending Board resolution hash", async function () {
      await f.two(f.s1, f.cco, "suspend", LOSS_EVENT, EVIDENCE, ethers.ZeroHash);
      await increase(70 * HOUR);
      await pool.connect(f.cco).renewSuspension(ethers.ZeroHash, ethers.ZeroHash); // to 142 h
      await increase(70 * HOUR);
      await pool.connect(f.s1).renewSuspension(ethers.ZeroHash, ethers.ZeroHash); // to 212 h
      await increase(70 * HOUR);
      await expect(pool.connect(f.cco).renewSuspension(ethers.ZeroHash, ethers.ZeroHash)) // to 282 h
        .to.be.revertedWithCustomError(pool, "LendingPoolResolutionRequired");
      await pool.connect(f.cco).renewSuspension(ethers.id("board resolution"), ethers.ZeroHash);
    });

    it("never runs past 30 days, except a LEGAL_ORDER with an order hash", async function () {
      await f.two(f.s1, f.cco, "suspend", LOSS_EVENT, EVIDENCE, ethers.ZeroHash);
      const start = BigInt(await latest());
      const signers = [f.cco, f.s1];
      let i = 0;
      for (let h = 70; h < 30 * 24; h += 70) {
        await increase(70 * HOUR);
        if ((await pool.suspension()).expiresAt === start + 30n * 86400n) break;
        await pool.connect(signers[i++ % 2]).renewSuspension(ethers.id("r"), ethers.ZeroHash);
      }
      expect((await pool.suspension()).expiresAt).to.equal(start + 30n * 86400n);
      await expect(pool.connect(signers[i % 2]).renewSuspension(ethers.id("r"), ethers.ZeroHash))
        .to.be.revertedWithCustomError(pool, "LendingPoolSuspensionCeiling");

      const order = ethers.id("court order");
      await increase(30 * DAY);
      await f.two(f.s1, f.cco, "suspend", LEGAL_ORDER, order, ethers.ZeroHash);
      const s2 = BigInt(await latest());
      for (let k = 0; k < 12; k++) {
        await increase(70 * HOUR);
        await pool.connect(k % 2 === 0 ? f.cco : f.s1).renewSuspension(ethers.id("r"), order);
      }
      expect((await pool.suspension()).expiresAt).to.be.greaterThan(s2 + 30n * 86400n);
    });

    it("VALUATION_PENDING ends at 48 hours and cannot be renewed", async function () {
      // Conformance pass (decision 26): only while a Valuation Event is recorded.
      await f.two(f.v1, f.v2, "recordValuationEvent", ethers.id("valuation event"));
      await f.two(f.s1, f.cco, "suspend", VALUATION_PENDING, EVIDENCE, ethers.ZeroHash);
      await expect(pool.connect(f.s2).renewSuspension(ethers.id("r"), ethers.ZeroHash))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotRenewable");
      await increase(48 * HOUR);
      expect(await pool.isSuspended()).to.equal(false);
    });

    it("refuses a reason code outside the four", async function () {
      for (const r of [0, 5, 255]) {
        await expect(pool.connect(f.s1).suspend(r, EVIDENCE, ethers.ZeroHash))
          .to.be.revertedWithCustomError(pool, "LendingPoolBadReason");
      }
    });

    it("a new suspension on the same evidence within 30 days needs a resolution hash", async function () {
      await f.two(f.s1, f.cco, "suspend", LOSS_EVENT, EVIDENCE, ethers.ZeroHash);
      await pool.connect(f.s1).liftSuspension();
      await expect(pool.connect(f.s1).suspend(LOSS_EVENT, EVIDENCE, ethers.ZeroHash))
        .to.be.revertedWithCustomError(pool, "LendingPoolResolutionRequired");
      await f.two(f.s1, f.cco, "suspend", LOSS_EVENT, EVIDENCE, ethers.id("resolution"));
    });

    it("stops subscriptions, redemptions, fills and deployments; cancellations go on and interest accrues", async function () {
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      await f.deploy(U(5_000));
      await pool.connect(f.alice).requestWithdrawal(U(1_000), f.alice.address);
      await f.two(f.s1, f.cco, "suspend", USDC_OR_NETWORK, EVIDENCE, ethers.ZeroHash);
      await expect(pool.connect(f.bob).deposit(U(1_000), f.bob.address))
        .to.be.revertedWithCustomError(pool, "LendingPoolSuspended");
      expect(await pool.maxDeposit(f.bob.address)).to.equal(0n);
      await expect(pool.fillQueue(5)).to.be.revertedWithCustomError(pool, "LendingPoolSuspended");
      await expect(pool.connect(f.alice).redeem(U(1), f.alice.address, f.alice.address))
        .to.be.revertedWithCustomError(pool, "LendingPoolSuspended");
      // Joining the queue keeps the holder's place; nothing is paid.
      const [paid] = await pool.connect(f.alice).redeemOrQueue.staticCall(U(1), f.alice.address);
      expect(paid).to.equal(0n);
      const i0: bigint = await pool.accruedInterest();
      await increase(DAY);
      expect(await pool.accruedInterest()).to.be.greaterThan(i0);
      await pool.connect(f.alice).cancelRequest(0, U(1_000));
      await increase(72 * HOUR);
      await pool.connect(f.bob).deposit(U(1_000), f.bob.address);
    });
  });

  /* ------------------------------------------------------------------ 15 */
  describe("15. Valuation postings", function () {
    beforeEach(async function () {
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
    });

    it("refuses an allowance above Pool Assets, and a single-signer posting", async function () {
      await pool.connect(f.v1).postAllowance(U(10_001), EVIDENCE);
      await expect(pool.connect(f.v2).postAllowance(U(10_001), EVIDENCE))
        .to.be.revertedWithCustomError(pool, "LendingPoolInvalidAmount");
      await pool.connect(f.v1).postAllowance(U(100), EVIDENCE);
      await expect(pool.connect(f.v1).postAllowance(U(100), EVIDENCE))
        .to.be.revertedWithCustomError(pool, "LendingPoolSameSigner");
      expect(await pool.holdbackBps()).to.equal(0n);
      await expect(pool.connect(f.outsider).postAllowance(U(100), EVIDENCE))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotAuthorized");
      await pool.connect(f.v1).postLossCharge(U(100), EVIDENCE);
      await expect(pool.connect(f.v1).postLossCharge(U(100), EVIDENCE))
        .to.be.revertedWithCustomError(pool, "LendingPoolSameSigner");
      expect(await pool.lossChargeCount()).to.equal(0n);
    });

    it("a valid allowance leaves shareValue unchanged to the wei and sets holdbackBps", async function () {
      const before = await pool.shareValue();
      const assetsBefore = await pool.totalAssets();
      await f.allowance(U(150)); // 1.5% of $10,000
      expect(await pool.shareValue()).to.equal(before);
      expect(await pool.totalAssets()).to.equal(assetsBefore);
      expect(await pool.holdbackBps()).to.equal(150n);
      expect(await pool.poolLossAllowance()).to.equal(U(150));
      expect(await pool.allowancePostedAt()).to.equal(BigInt(await latest()));
    });

    it("rounds the Holdback Percentage up", async function () {
      await f.allowance(U(150) + 1n);
      expect(await pool.holdbackBps()).to.equal(151n);
    });

    it("applies a loss charge to open holdbacks first, takes the full charge off the Deployed Balance, and sends out only what exceeds it and interest", async function () {
      await f.allowance(U(100)); // 100 bps
      await pool.connect(f.alice).redeem(U(1_000), f.alice.address, f.alice.address); // G 1,000, H 10
      expect(await pool.totalHoldback()).to.equal(U(10));
      await f.deploy(U(1_000));
      await increase(10 * DAY);
      const lendingBefore = await usdc.balanceOf(f.lending.address);
      const vaultBefore: bigint = await pool.vaultCash();

      const tx = await f.lossCharge(U(1_200));
      // A holdback is open, so the charge waits for its batch.
      expect((await pool.pendingLossCharge()).pending).to.equal(true);
      const done = await pool.applyHoldbacks(10);
      const rc = await done.wait();
      const ev = rc.logs.map((l: any) => { try { return pool.interface.parseLog(l); } catch { return null; } })
        .find((e: any) => e?.name === "LossChargeCompleted");
      expect(ev.args.absorbed).to.equal(U(10)); // ratable share > H, so all of H
      // The full $1,200 runs against the Deployed Balance and interest (decision 33), not $1,190.
      expect(ev.args.toDeployed).to.equal(U(1_000));
      const interest = ev.args.toInterest;
      expect(interest).to.be.greaterThan(0n);
      const out = U(1_200) - U(1_000) - interest;
      expect(ev.args.paidOut).to.equal(out);
      expect(await usdc.balanceOf(f.lending.address) - lendingBefore).to.equal(out);
      expect(await pool.vaultCash()).to.equal(vaultBefore + U(10) - out);
      expect(await pool.deployedBalance()).to.equal(0n);
      expect(await pool.totalHoldback()).to.equal(0n);
      await expect(tx).to.emit(pool, "LossChargePosted");
    });

    it("a charge within the Deployed Balance, with a holdback open, takes the full charge off it and adds what the holdback bore to Vault Cash", async function () {
      await f.allowance(U(100)); // 100 bps
      await pool.connect(f.alice).redeem(U(1_000), f.alice.address, f.alice.address); // G 1,000, H 10
      await f.deploy(U(5_000));
      const cash: bigint = await pool.vaultCash();
      const deployed: bigint = await pool.deployedBalance();
      await f.lossCharge(U(500));
      await pool.applyHoldbacks(10);
      expect(await pool.deployedBalance()).to.equal(deployed - U(500));
      expect(await pool.vaultCash()).to.equal(cash + U(10));
      expect(await pool.totalHoldback()).to.equal(0n);
      // Pool Assets fall by L − Σ absorbed.
      expect(await pool.totalAssets()).to.equal(cash + U(10) + deployed - U(500) + (await pool.accruedInterest()));
    });

    it("the largest charge allowed (Pool Assets + Σ H) never pays out more than the vault's free cash", async function () {
      await f.allowance(U(100));
      await pool.connect(f.alice).redeem(U(1_000), f.alice.address, f.alice.address); // G 1,000, H 10
      // Nothing deployed, so no interest moves the bound between the two signers' calls.
      const lendingBefore: bigint = await usdc.balanceOf(f.lending.address);
      const max: bigint = (await pool.totalAssets()) + (await pool.totalHoldback());
      expect(max).to.equal(U(9_010));
      await f.lossCharge(max);
      await pool.applyHoldbacks(10);
      // The holdback bore all its $10; the whole charge leaves, and it is exactly the vault's cash.
      expect(await pool.totalHoldback()).to.equal(0n);
      expect(await pool.vaultCash()).to.equal(0n);
      expect(await usdc.balanceOf(f.poolAddress)).to.equal(0n);
      expect(await usdc.balanceOf(f.lending.address) - lendingBefore).to.equal(U(9_010));
    });

    it("a charge within the Deployed Balance moves no cash", async function () {
      await f.deploy(U(5_000));
      const cash = await pool.vaultCash();
      await f.lossCharge(U(1_000));
      expect(await pool.vaultCash()).to.equal(cash);
      expect(await pool.deployedBalance()).to.equal(U(4_000));
    });
  });

  /* ------------------------------------------------------------------ 20 */
  describe("20. Loss Holdback worked example (IV-02 Exh. A10)", function () {
    it("pays $10,244, holds $156, releases $104, then applies $52 of a $900 charge", async function () {
      const { alice, lending } = f;
      // Pool Assets $100,000 at a Share Value of $1.04.
      await pool.connect(alice).deposit(96_153_846_153n, alice.address);
      await pool.connect(lending).returnFunds(3_846_153_847n);
      expect(await pool.totalAssets()).to.equal(U(100_000));
      expect(await pool.shareValue()).to.be.closeTo(ethers.parseUnits("1.04", 18), 10n ** 9n);

      await f.allowance(U(1_500));
      expect(await pool.holdbackBps()).to.equal(150n);

      const before = await usdc.balanceOf(alice.address);
      await expect(pool.connect(alice).redeem(U(10_000), alice.address, alice.address))
        .to.emit(pool, "HoldbackRecorded").withArgs(alice.address, 0n, U(10_400), U(156));
      expect(await usdc.balanceOf(alice.address) - before).to.equal(U(10_244));
      // The $156 is outside Vault Cash, Pool Assets and Utilization.
      expect(await pool.vaultCash()).to.equal(U(89_600));
      expect(await pool.totalAssets()).to.equal(U(89_600));
      expect(await usdc.balanceOf(f.poolAddress)).to.equal(U(89_756));
      expect(await pool.utilization()).to.equal(0n);

      // holdbackBps 50: releaseHoldbacks pays $104 to the Holder, leaving H $52.
      await f.allowance(U(448));
      expect(await pool.holdbackBps()).to.equal(50n);
      const b2 = await usdc.balanceOf(alice.address);
      await expect(pool.connect(f.outsider).releaseHoldbacks(10)).to.emit(pool, "HoldbackReleased").withArgs(0n, U(104));
      expect(await usdc.balanceOf(alice.address) - b2).to.equal(U(104));
      expect((await pool.holdbackAt(0)).held).to.equal(U(52));

      // postLossCharge($900), Pool Assets $89,600, this the only open holdback: applies $52
      // (ratable $93.60, capped), adds $52 to Vault Cash and takes the full $900 off the Deployed
      // Balance, so Pool Assets fall by $848, to $88,752 (decision 33; IV-02 §5.6(d), A2, A10).
      await f.deploy(U(50_000));
      const cash: bigint = await pool.vaultCash();
      const tx = await f.lossCharge(U(900));
      const rc = await tx.wait();
      const posted = rc.logs.map((l: any) => { try { return pool.interface.parseLog(l); } catch { return null; } })
        .find((e: any) => e?.name === "LossChargePosted");
      const ratable = (U(10_400) * U(900)) / posted.args.denominator;
      expect(ratable).to.be.closeTo(U(93.6), U(0.01));
      await expect(pool.applyHoldbacks(10)).to.emit(pool, "HoldbackApplied").withArgs(0n, U(52), 1n);
      expect(await pool.vaultCash()).to.equal(cash + U(52));
      expect(await pool.deployedBalance()).to.equal(U(50_000) - U(900));
      expect(await pool.totalAssets()).to.equal(U(88_752) + (await pool.accruedInterest()));
      expect(await pool.holdbackOf(alice.address)).to.equal(0n);
    });

    it("withdraw pays exactly the amount asked; it records a holdback only while holdbackBps > 0", async function () {
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      await f.deploy(U(1_000));
      await increase(30 * DAY); // a Share Value that is not a round number
      const a0 = await usdc.balanceOf(f.alice.address);
      await pool.connect(f.alice).withdraw(U(333), f.alice.address, f.alice.address);
      expect(await usdc.balanceOf(f.alice.address) - a0).to.equal(U(333));
      expect(await pool.holdbackCount()).to.equal(0n);
      await f.allowanceForBps(150n);
      const a1 = await usdc.balanceOf(f.alice.address);
      await pool.connect(f.alice).withdraw(U(333), f.alice.address, f.alice.address);
      expect(await usdc.balanceOf(f.alice.address) - a1).to.equal(U(333));
      const [, , , gross, held] = await pool.holdbackAt(0);
      expect(held).to.equal((gross * 150n + BPS - 1n) / BPS);
      expect(gross - held).to.be.greaterThanOrEqual(U(333));
    });

    it("never rounds in the leaver's favour", async function () {
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      await f.allowance(U(150));
      const before = await usdc.balanceOf(f.alice.address);
      await pool.connect(f.alice).redeem(1_000_001n, f.alice.address, f.alice.address);
      // H = ceil(1,000,001 × 1.5%) = 15,001; paid = 985,000.
      expect(await usdc.balanceOf(f.alice.address) - before).to.equal(985_000n);
      expect(await pool.totalHoldback()).to.equal(15_001n);
    });
  });

  /* ------------------------------------------------------------------ 21 */
  describe("21. Holdback invariants", function () {
    beforeEach(async function () {
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      await pool.connect(f.bob).deposit(U(10_000), f.bob.address);
      await f.allowance(U(300)); // 150 bps
      await pool.connect(f.alice).redeem(U(1_000), f.alice.address, f.alice.address);
      await pool.connect(f.bob).redeem(U(2_000), f.bob.address, f.bob.address);
    });

    it("a release goes only to the Holder, whoever processes it", async function () {
      const a = await usdc.balanceOf(f.alice.address);
      const o = await usdc.balanceOf(f.outsider.address);
      await f.allowance(0n);
      await pool.connect(f.outsider).releaseHoldbacks(10);
      expect(await usdc.balanceOf(f.alice.address) - a).to.equal(U(15));
      expect(await usdc.balanceOf(f.outsider.address)).to.equal(o);
      expect(await pool.totalHoldback()).to.equal(0n);
    });

    it("a higher allowance leaves every H unchanged", async function () {
      const h0 = (await pool.holdbackAt(0)).held;
      const h1 = (await pool.holdbackAt(1)).held;
      await f.allowanceForBps(400n);
      await pool.releaseHoldbacks(10);
      expect((await pool.holdbackAt(0)).held).to.equal(h0);
      expect((await pool.holdbackAt(1)).held).to.equal(h1);
    });

    it("at holdbackBps = 0, previewRedeem = shares × shareValue and every holdback is releasable", async function () {
      await f.allowance(0n);
      const sv: bigint = await pool.shareValue();
      expect(await pool.previewRedeem(U(1_000))).to.be.closeTo((U(1_000) * sv) / WAD, 1n);
      await pool.releaseHoldbacks(10);
      expect(await pool.totalHoldback()).to.equal(0n);
    });

    it("postLossCharge and a new posting revert while releases from a lower posting are unprocessed", async function () {
      await f.allowance(U(100));
      await pool.releaseHoldbacks(1);
      expect(await pool.releasePending()).to.equal(true);
      await expect(pool.connect(f.v1).postLossCharge(U(10), EVIDENCE))
        .to.be.revertedWithCustomError(pool, "LendingPoolReleasePending");
      await expect(pool.connect(f.v1).postAllowance(U(10), EVIDENCE))
        .to.be.revertedWithCustomError(pool, "LendingPoolReleasePending");
      await pool.releaseHoldbacks(1);
      expect(await pool.releasePending()).to.equal(false);
      await f.lossCharge(U(10));
    });

    it("redemptions, fills and subscriptions revert while a charge has unapplied holdbacks; cancellations go on", async function () {
      await pool.connect(f.carol).deposit(U(1_000), f.carol.address);
      await pool.connect(f.carol).requestWithdrawal(U(500), f.carol.address);
      await f.lossCharge(U(100));
      expect((await pool.pendingLossCharge()).pending).to.equal(true);
      await expect(pool.connect(f.bob).deposit(U(1_000), f.bob.address))
        .to.be.revertedWithCustomError(pool, "LendingPoolChargePending");
      await expect(pool.connect(f.bob).redeem(U(1), f.bob.address, f.bob.address))
        .to.be.revertedWithCustomError(pool, "LendingPoolChargePending");
      await expect(pool.fillQueue(5)).to.be.revertedWithCustomError(pool, "LendingPoolChargePending");
      await pool.connect(f.carol).cancelRequest(0, U(500));
      await pool.applyHoldbacks(1);
      expect((await pool.pendingLossCharge()).pending).to.equal(true);
      await pool.applyHoldbacks(1);
      expect((await pool.pendingLossCharge()).pending).to.equal(false);
      await pool.connect(f.bob).deposit(U(1_000), f.bob.address);
    });

    it("a Holder never loses more than its H", async function () {
      const h0 = (await pool.holdbackAt(0)).held;
      await f.lossCharge(U(16_000));
      await pool.applyHoldbacks(10);
      expect((await pool.holdbackAt(0)).held).to.equal(0n);
      expect(await pool.holdbackOf(f.alice.address)).to.equal(0n);
      expect(h0).to.equal(U(15));
    });
  });

  /* ------------------------------------------------------------------ 22 */
  describe("22. Interest and price", function () {
    it("with no loss charge, shareValue rises with interest whatever the allowance", async function () {
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      await f.deploy(U(8_000));
      let last: bigint = await pool.shareValue();
      for (let i = 0; i < 4; i++) {
        await increase(30 * DAY);
        if (i === 1) await f.allowanceForBps(250n);
        const sv: bigint = await pool.shareValue();
        expect(sv).to.be.greaterThan(last);
        last = sv;
      }
    });

    it("a subscription while holdbackBps > 0 mints at shareValue with nothing deducted", async function () {
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      await f.deploy(U(5_000));
      await increase(90 * DAY);
      await f.allowanceForBps(150n);
      await pool.connect(f.bob).deposit(U(1_000), f.bob.address);
      const shares = await pool.balanceOf(f.bob.address);
      expect(await pool.convertToAssets(shares)).to.be.closeTo(U(1_000), 2n);
    });
  });

  /* ------------------------------------------------------------------ 23 */
  describe("23. Pledged shares and enforcement", function () {
    let signals: any;
    beforeEach(async function () {
      signals = await (await ethers.getContractFactory("MockCollateralSignals")).deploy();
      await pool.setEncumbranceSource(await signals.getAddress(), ethers.encodeBytes32String("POOL_SHARE"));
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      await pool.connect(f.bob).deposit(U(10_000), f.bob.address);
    });

    it("values 1,000 pledged shares at previewRedeem = 98.5% of 1,000 × shareValue at 150 bps", async function () {
      await f.deploy(U(10_000));
      await increase(60 * DAY);
      await f.allowanceForBps(150n);
      const sv: bigint = await pool.shareValue();
      const gross = (U(1_000) * sv) / WAD;
      expect(await pool.previewRedeem(U(1_000))).to.be.closeTo((gross * 9_850n) / BPS, 2n);
    });

    it("an enforcement redemption queues, pays only the recorded destination, and records the holdback to the pledgor", async function () {
      await signals.setLock(f.alice.address, U(3_000));
      await f.deploy(U(15_000));
      await f.allowanceForBps(150n);
      // The holder cannot move or redeem pledged shares.
      await expect(pool.connect(f.alice).redeem(U(7_001), f.alice.address, f.alice.address)).to.be.reverted;
      await expect(pool.connect(f.outsider).enforcementRedeem(f.alice.address, U(1_000))).to.be.reverted;
      await expect(pool.connect(f.enforcer).enforcementRedeem(f.alice.address, U(3_001)))
        .to.be.revertedWithCustomError(pool, "LendingPoolSeizureExceedsEncumbrance");

      await pool.connect(f.bob).requestWithdrawal(U(1_000), f.bob.address); // earlier in line
      await pool.connect(f.enforcer).enforcementRedeem(f.alice.address, U(1_000));
      const [owner, receiver, , , enforcement] = await pool.queueRequest(1);
      expect(owner).to.equal(f.alice.address);
      expect(receiver).to.equal(f.destination.address);
      expect(enforcement).to.equal(true);
      // Pledged shares already queued count against the lock: Alice's other 7,000 stay free.
      expect(await pool.freeSharesOf(f.alice.address)).to.equal(U(7_000));
      await expect(pool.connect(f.alice).cancelRequest(1, U(1)))
        .to.be.revertedWithCustomError(pool, "LendingPoolNotRequestOwner");

      await pool.connect(f.lending).returnFunds(U(5_000));
      const d0 = await usdc.balanceOf(f.destination.address);
      const a0 = await usdc.balanceOf(f.alice.address);
      await pool.fillQueue(10);
      const paid = await usdc.balanceOf(f.destination.address) - d0;
      expect(paid).to.be.greaterThan(U(980));
      expect(await usdc.balanceOf(f.alice.address)).to.equal(a0);
      const held: bigint = await pool.holdbackOf(f.alice.address);
      expect(held).to.be.greaterThan(U(14));
      expect(await pool.enforcementQueuedOf(f.alice.address)).to.equal(0n);

      // Its later release goes only to the pledgor.
      await f.allowance(0n);
      await pool.releaseHoldbacks(10);
      expect(await usdc.balanceOf(f.alice.address) - a0).to.equal(held);
      expect(await usdc.balanceOf(f.destination.address) - d0).to.equal(paid);
    });

    it("the enforcer may cancel an enforcement request, returning the shares to the holder", async function () {
      await signals.setLock(f.alice.address, U(3_000));
      await pool.connect(f.enforcer).enforcementRedeem(f.alice.address, U(1_000));
      await pool.connect(f.enforcer).cancelRequest(0, U(1_000));
      expect(await pool.balanceOf(f.alice.address)).to.equal(U(10_000));
      expect(await pool.enforcementQueuedOf(f.alice.address)).to.equal(0n);
    });
  });

  /* ------------------------------------------------------------------ 24 */
  describe("24. Exemption tag and Equity Cushion pause", function () {
    // Stage 1, agent B: these run against the real EarnControls, not MockEarnControls.
    let c: Awaited<ReturnType<typeof withRealControls>>;
    beforeEach(async function () {
      c = await withRealControls(f);
    });

    it("stores and emits the exemptionCode, and the tag changes nothing else", async function () {
      const as = async (who: any, tag: string) => attestation(c.controls, c.attester, who.address, tag);
      await expect(pool.connect(f.alice).subscribe(U(1_000), f.alice.address, await as(f.alice, "506B")))
        .to.emit(pool, "Subscribed").withArgs(f.alice.address, f.alice.address, U(1_000), U(1_000), ethers.encodeBytes32String("506B"));
      await expect(pool.connect(f.bob).subscribe(U(1_000), f.bob.address, await as(f.bob, "147A")))
        .to.emit(pool, "Subscribed").withArgs(f.bob.address, f.bob.address, U(1_000), U(1_000), ethers.encodeBytes32String("147A"));
      expect(await pool.balanceOf(f.alice.address)).to.equal(await pool.balanceOf(f.bob.address));
    });

    it("while the Equity Cushion pause is set, subscriptions revert and withdrawals succeed; one signer cannot set or clear it", async function () {
      await pool.connect(f.alice).deposit(U(1_000), f.alice.address);
      await c.controls.connect(c.p1).setPauseFlag(EQUITY_CUSHION, true, EVIDENCE);
      await expect(c.controls.connect(c.p1).setPauseFlag(EQUITY_CUSHION, true, EVIDENCE))
        .to.be.revertedWithCustomError(c.controls, "EarnControlsSameSigner");
      expect(await pool.maxDeposit(f.bob.address)).to.equal(ethers.MaxUint256);
      await c.controls.connect(c.p2).setPauseFlag(EQUITY_CUSHION, true, EVIDENCE);
      expect(await pool.maxDeposit(f.bob.address)).to.equal(0n);
      await expect(pool.connect(f.bob).deposit(U(1_000), f.bob.address))
        .to.be.revertedWithCustomError(pool, "LendingPoolSubscriptionsPaused");
      await expect(pool.connect(f.bob).mint(U(1_000), f.bob.address))
        .to.be.revertedWithCustomError(pool, "LendingPoolSubscriptionsPaused");
      await pool.connect(f.alice).redeem(U(500), f.alice.address, f.alice.address);
      await pool.connect(f.alice).withdraw(U(100), f.alice.address, f.alice.address);
      await c.controls.connect(c.p2).setPauseFlag(EQUITY_CUSHION, false, EVIDENCE);
      await expect(c.controls.connect(c.p2).setPauseFlag(EQUITY_CUSHION, false, EVIDENCE))
        .to.be.revertedWithCustomError(c.controls, "EarnControlsSameSigner");
      expect(await c.controls.pauseFlags()).to.equal(BigInt(EQUITY_CUSHION));
      await c.controls.connect(c.p1).setPauseFlag(EQUITY_CUSHION, false, EVIDENCE);
      await pool.connect(f.bob).deposit(U(1_000), f.bob.address);
    });
  });

  /* ------------------------------------------------------------------ 25 */
  describe("25. Holdback maximum age", function () {
    let createdAt: bigint;
    beforeEach(async function () {
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      await f.allowance(U(150));
      await pool.connect(f.alice).redeem(U(1_000), f.alice.address, f.alice.address);
      createdAt = (await pool.holdbackAt(0)).createdAt;
      expect(await pool.holdbackMaxAge()).to.equal(BigInt(540 * DAY));
    });

    it("cannot be released before day 540, and is releasable in full by anyone from day 540, to the Holder", async function () {
      expect(await pool.releasableAt(0)).to.equal(createdAt + BigInt(540 * DAY));
      await setNext(Number(createdAt) + 539 * DAY);
      await pool.connect(f.outsider).releaseHoldbacks(10);
      expect((await pool.holdbackAt(0)).held).to.equal(U(15));
      await setNext(Number(createdAt) + 540 * DAY);
      const a = await usdc.balanceOf(f.alice.address);
      await pool.connect(f.outsider).releaseHoldbacks(10);
      expect(await usdc.balanceOf(f.alice.address) - a).to.equal(U(15));
      expect(await pool.holdbackBps()).to.equal(150n);
    });

    it("a loss charge posted on day 539 still applies to it", async function () {
      await setNext(Number(createdAt) + 539 * DAY);
      await pool.connect(f.v1).postLossCharge(U(500), EVIDENCE);
      await pool.connect(f.v2).postLossCharge(U(500), EVIDENCE);
      await increase(2 * DAY);
      await pool.releaseHoldbacks(10); // age release waits for the pending charge
      expect((await pool.holdbackAt(0)).held).to.equal(U(15));
      await expect(pool.applyHoldbacks(10)).to.emit(pool, "HoldbackApplied");
      expect((await pool.holdbackAt(0)).held).to.be.lessThan(U(15));
    });

    it("raising holdbackMaxAge to 720 on day 500 leaves the release date at day 540; a lowering applies at once", async function () {
      await setNext(Number(createdAt) + 500 * DAY);
      await pool.setHoldbackMaxAge(720 * DAY);
      expect(await pool.releasableAt(0)).to.equal(createdAt + BigInt(540 * DAY));
      await pool.setHoldbackMaxAge(100 * DAY);
      expect(await pool.releasableAt(0)).to.equal(createdAt + BigInt(100 * DAY));
      await pool.setHoldbackMaxAge(720 * DAY);
      expect(await pool.releasableAt(0)).to.equal(createdAt + BigInt(100 * DAY));
      await pool.releaseHoldbacks(10);
      expect((await pool.holdbackAt(0)).held).to.equal(0n);
    });
  });

  /* -------------------------------------------------------- subscriptions */
  describe("Subscriptions and transfers (§6)", function () {
    it("refuse less than $250, an ineligible or Clear-contract payer, and a pool with no controls", async function () {
      await expect(pool.connect(f.alice).deposit(U(249.99), f.alice.address))
        .to.be.revertedWithCustomError(pool, "LendingPoolBelowMinimum");
      await pool.connect(f.alice).deposit(U(250), f.alice.address);
      await f.controls.setRefused(f.bob.address, true);
      await expect(pool.connect(f.bob).deposit(U(1_000), f.bob.address))
        .to.be.revertedWithCustomError(f.controls, "Ineligible");
      await pool.setEarnControls(ethers.ZeroAddress);
      await expect(pool.connect(f.carol).deposit(U(1_000), f.carol.address))
        .to.be.revertedWithCustomError(pool, "LendingPoolNoControls");
    });

    // Conformance pass: the pool's own per-member cap (decision 13) is removed. EarnControls counts
    // the 10% cap per household above its floor (decision 23; EarnControls.spec), so the pool no
    // longer refuses the first subscriber, who holds 100% of the shares.
    it("accept the first subscriber: the holder cap is EarnControls' alone (decision 23)", async function () {
      await pool.connect(f.alice).deposit(U(1_000), f.alice.address);
      expect(await pool.balanceOf(f.alice.address)).to.equal(await pool.totalSupply());
      expect(pool.interface.getFunction("setHolderCapBps")).to.equal(null);
    });

    it("move only between one Holder's accounts or by the Successor path", async function () {
      await pool.connect(f.alice).deposit(U(1_000), f.alice.address);
      await expect(pool.connect(f.alice).transfer(f.bob.address, 1n))
        .to.be.revertedWithCustomError(pool, "LendingPoolTransferNotAllowed");
      await pool.connect(f.alice).approve(f.outsider.address, U(1));
      await expect(pool.connect(f.outsider).transferFrom(f.alice.address, f.outsider.address, 1n))
        .to.be.revertedWithCustomError(pool, "LendingPoolTransferNotAllowed");
      await f.controls.link(f.alice.address, f.alice2.address);
      await pool.connect(f.alice).transfer(f.alice2.address, U(100));
      await f.controls.setSuccessor(f.alice.address, f.carol.address, true);
      await pool.connect(f.alice).transfer(f.carol.address, U(100));
    });

    it("record the Initial Closing at the first subscription", async function () {
      expect(await pool.initialClosing()).to.equal(0n);
      await pool.connect(f.alice).deposit(U(1_000), f.alice.address);
      const t = await latest();
      expect(await pool.initialClosing()).to.equal(BigInt(t));
      await pool.connect(f.bob).deposit(U(1_000), f.bob.address);
      expect(await pool.initialClosing()).to.equal(BigInt(t));
    });
  });

  /* ------------------------------------------------------- final maturity */
  describe("Final Maturity (decision 15)", function () {
    it("stops subscriptions and Deployments at the 20th anniversary, and runs shares off in queue order", async function () {
      const leap = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
      let year = new Date((await latest()) * 1000).getUTCFullYear() + 1;
      while (!leap(year)) year++;
      await setNext(Date.UTC(year, 1, 29, 12) / 1000); // a 29 February
      await pool.connect(f.alice).deposit(U(1_000), f.alice.address);
      await pool.connect(f.bob).deposit(U(1_000), f.bob.address);
      await f.deploy(U(500));
      const at: bigint = await pool.finalMaturity();
      expect(at).to.equal(BigInt(Date.UTC(year + 20, 1, leap(year + 20) ? 29 : 28, 12) / 1000));
      await expect(pool.requestRunOff(f.alice.address)).to.be.revertedWithCustomError(pool, "LendingPoolNotFinalMaturity");

      await setNext(Number(at));
      await expect(pool.connect(f.carol).deposit(U(1_000), f.carol.address))
        .to.be.revertedWithCustomError(pool, "LendingPoolFinalMaturity");
      await expect(pool.connect(f.d1).deploy(U(1), ethers.ZeroHash))
        .to.be.revertedWithCustomError(pool, "LendingPoolFinalMaturity");
      await pool.connect(f.outsider).requestRunOff(f.bob.address);
      await pool.connect(f.outsider).requestRunOff(f.alice.address);
      await pool.connect(f.lending).returnFunds(U(2_000));
      await pool.fillQueue(10);
      expect(await pool.totalSupply()).to.equal(0n);
      expect(await usdc.balanceOf(f.bob.address)).to.be.greaterThan(U(1_000_000));
    });
  });

  /* ---------------------------------------------------- refused payments */
  it("keeps a payment the token refuses for its owner to claim, so the queue is not blocked", async function () {
    const { ethers: e, upgrades } = require("hardhat");
    const { poolProxyOptions } = require("../../deploy/poolModules");
    const token: any = await (await e.getContractFactory("MockBlocklistERC20")).deploy("USD Coin", "USDC", 6);
    const p: any = await upgrades.deployProxy(await e.getContractFactory("LendingPool"),
      [f.admin.address, await token.getAddress(), "Clear Lending Pool", "clrLP"], await poolProxyOptions());
    await p.setEarnControls(await f.controls.getAddress());
    for (const w of [f.alice, f.bob]) {
      await token.mint(w.address, U(10_000));
      await token.connect(w).approve(await p.getAddress(), e.MaxUint256);
      await p.connect(w).deposit(U(1_000), w.address);
    }
    await p.connect(f.alice).requestWithdrawal(U(500), f.alice.address);
    await p.connect(f.bob).requestWithdrawal(U(500), f.bob.address);
    await token.setBlocked(f.alice.address, true);
    await expect(p.fillQueue(10)).to.emit(p, "PaymentDeferred").withArgs(f.alice.address, U(500));
    expect(await token.balanceOf(f.bob.address)).to.equal(U(9_500));
    expect(await p.unpaidOf(f.alice.address)).to.equal(U(500));
    // Owed out, so not Vault Cash and not Pool Assets.
    expect(await p.totalAssets()).to.equal(U(1_000));
    await token.setBlocked(f.alice.address, false);
    await p.connect(f.alice).claimUnpaid();
    expect(await token.balanceOf(f.alice.address)).to.equal(U(9_500));
    expect(await p.totalUnpaid()).to.equal(0n);
  });
});
