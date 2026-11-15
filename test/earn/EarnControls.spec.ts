import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { DAY, U, deployYieldPool, increase, latest } from "../helpers/yieldPool";
import {
  EQUITY_CUSHION, LOW_UTILIZATION_RULE, RESERVE_SHORTFALL, RESOLUTION,
  attestation, code, deployEarnControls, grant, withRealControls,
} from "../helpers/earnControls";
import { earnControlsProxyOptions } from "../../deploy/earnModules";

const NO_HASH = ethers.ZeroHash;
const what = (s: string) => ethers.encodeBytes32String(s);

/*
 * Phase 2f, stage 1: EarnControls (decisions 1, 12, 13 and 23; IV-02 §§2.4-2.6, 8.1) against the
 * real Yield Pool. The bond side (`checkPurchase`, rolls, the Ladder) is called by a signer standing
 * in for a bond collection, since stage 2 wires the collections.
 */
describe("EarnControls (Earn §§1, 2, 6; IV-02 §§2.4-2.6, 8.1; decisions 1, 12, 13, 23)", function () {
  let f: Awaited<ReturnType<typeof deployYieldPool>>;
  let c: Awaited<ReturnType<typeof withRealControls>>;
  let controls: any, pool: any, sources: any;

  beforeEach(async function () {
    f = await deployYieldPool();
    c = await withRealControls(f);
    controls = c.controls;
    pool = f.pool;
    sources = await (await ethers.getContractFactory("MockEarnSources")).deploy();
  });

  describe("roles and upgrades", function () {
    it("are granted only with a Lending Board resolution hash (§10)", async function () {
      const role = await controls.ATTESTER_ROLE();
      await expect(controls.grantRole(role, f.bob.address)).to.be.revertedWithCustomError(controls, "EarnControlsUseResolution");
      await expect(controls.grantRoleByResolution(role, f.bob.address, NO_HASH))
        .to.be.revertedWithCustomError(controls, "EarnControlsInvalidValue");
      await expect(controls.connect(f.bob).grantRoleByResolution(role, f.bob.address, RESOLUTION)).to.be.reverted;
      await expect(controls.grantRoleByResolution(role, f.bob.address, RESOLUTION))
        .to.emit(controls, "RoleGrantedByResolution").withArgs(role, f.bob.address, RESOLUTION);
    });

    it("upgrade only by the admin (the Earn timelock), and pin their module", async function () {
      const at = await controls.getAddress();
      await expect(upgrades.upgradeProxy(at, await ethers.getContractFactory("EarnControls", f.bob), await earnControlsProxyOptions(f.bob)))
        .to.be.reverted;
      await upgrades.upgradeProxy(at, await ethers.getContractFactory("EarnControls", f.admin), await earnControlsProxyOptions(f.admin));
      expect(await controls.pauseFlags()).to.equal(0n);
      const F = await ethers.getContractFactory("EarnControls");
      await expect(F.deploy(await sources.getAddress())).to.be.reverted;
    });
  });

  describe("eligibility by attestation (IV-02 §2.1, §10.1)", function () {
    it("refuses a payer with no attestation, a stale, unsigned or zero-net-worth one, or one whose attester lost the role", async function () {
      await expect(pool.connect(f.outsider).deposit(U(1_000), f.outsider.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsIneligible");
      const stranger = ethers.Wallet.createRandom();
      await expect(controls.attestEligibility(f.outsider.address, await attestation(controls, stranger, f.outsider.address)))
        .to.be.revertedWithCustomError(controls, "EarnControlsBadAttestation");
      const now = await latest();
      await expect(c.attest(f.outsider, "506C", { issuedAt: now - 10 * DAY, validUntil: now - DAY }))
        .to.be.revertedWithCustomError(controls, "EarnControlsBadAttestation");
      await expect(c.attest(f.outsider, "506C", { netWorth: 0n }))
        .to.be.revertedWithCustomError(controls, "EarnControlsBadAttestation");

      await c.attest(f.outsider, "506B", { validUntil: now + 30 * DAY });
      await pool.connect(f.outsider).deposit(U(1_000), f.outsider.address);
      await expect(c.attest(f.outsider, "506C", { issuedAt: now - DAY }))
        .to.be.revertedWithCustomError(controls, "EarnControlsBadAttestation");
      await increase(31 * DAY);
      await expect(pool.connect(f.outsider).deposit(U(1_000), f.outsider.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsIneligible");
      await controls.revokeRole(await controls.ATTESTER_ROLE(), c.attester.address);
      await expect(pool.connect(f.alice).deposit(U(1_000), f.alice.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsIneligible");
    });

    it("takes the attestation with the subscription and returns its tag to the pool", async function () {
      const att = await attestation(controls, c.attester, f.outsider.address, "147A");
      await expect(pool.connect(f.outsider).subscribe(U(1_000), f.outsider.address, att))
        .to.emit(pool, "Subscribed").withArgs(f.outsider.address, f.outsider.address, U(1_000), U(1_000), code("147A"))
        .and.to.emit(controls, "EligibilityAttested");
      expect((await controls.eligibilityOf(f.outsider.address)).exemptionCode).to.equal(code("147A"));
    });

    it("only the Yield Pool may check a subscription", async function () {
      await expect(controls.connect(f.alice).checkSubscription(f.alice.address, f.alice.address, U(1_000), "0x"))
        .to.be.revertedWithCustomError(controls, "EarnControlsNotAuthorized");
    });
  });

  describe("source of funds and receivers (IV-02 §2.4, §2.1(h))", function () {
    it("refuses a Clear contract as payer or receiver", async function () {
      await controls.setRefused(f.bob.address, true);
      await expect(pool.connect(f.bob).deposit(U(1_000), f.bob.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsRefused");
      await expect(controls.connect(f.bob).setRefused(f.carol.address, true)).to.be.reverted;
    });

    it("mints only to the payer's own Holder: one of the member's Smart Accounts", async function () {
      await expect(pool.connect(f.alice).deposit(U(1_000), f.bob.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsNotSameHolder");
      await pool.connect(f.alice).deposit(U(1_000), f.alice2.address);
      expect(await pool.balanceOf(f.alice2.address)).to.equal(U(1_000));
    });
  });

  describe("limits (IV-02 §2.5)", function () {
    it("(b) Earn Products at purchase price up to 10% of the attested net worth, at average cost", async function () {
      await c.attest(f.carol, "506C", { netWorth: U(20_000) }); // limit $2,000
      await pool.connect(f.carol).deposit(U(1_500), f.carol.address);
      await expect(pool.connect(f.carol).deposit(U(501), f.carol.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsLimit")
        .withArgs(what("netWorth"), U(1_500), U(501), U(2_000));
      // Redeeming a third of the shares takes a third of their cost off.
      await pool.connect(f.carol).redeem(U(500), f.carol.address, f.carol.address);
      await pool.connect(f.carol).deposit(U(1_000), f.carol.address);
      expect((await controls.earnCostOf(f.carol.address)).poolCost).to.equal(U(2_000));
      // Bond purchases count at their Purchase Price too, and come off when the bond leaves.
      await grant(controls, f.admin, "BOND_ROLE", f.d1.address);
      await controls.setRung(365, 500, true);
      await expect(controls.connect(f.d1).checkPurchase(f.carol.address, f.carol.address, U(250), U(262.5), 365, "0x"))
        .to.be.revertedWithCustomError(controls, "EarnControlsLimit");
      await c.attest(f.carol, "506C", { netWorth: U(25_000) });
      await controls.connect(f.d1).checkPurchase(f.carol.address, f.carol.address, U(500), U(525), 365, "0x");
      expect((await controls.earnCostOf(f.carol.address)).bondCost).to.equal(U(500));
      await controls.connect(f.d1).recordBondExit(f.carol.address, U(500));
      expect((await controls.earnCostOf(f.carol.address)).bondCost).to.equal(0n);
    });

    // Decision 40 (replacing decision 23's "no cap below the floor"): a household holds at most the
    // cap x the greater of Pool Assets after the subscription and the floor, from the first one. A 50%
    // cap here lets three members pass a $2,000 floor in a test; production keeps 10%.
    it("(c) holds a household to the cap x max(Pool Assets after, floor), always, queued shares included (decision 40)", async function () {
      await controls.setHolderCapBps(5_000);
      await controls.scheduleHolderCapFloor(U(2_000));
      await increase(7 * DAY);
      expect(await controls.holderCapFloor()).to.equal(U(2_000));
      // The pool's own check is gone (conformance pass); the controls count the cap.
      expect(pool.interface.getFunction("holderCapBps")).to.equal(null);
      // The very first subscriber: at most 50% of the $2,000 floor.
      await expect(pool.connect(f.bob).deposit(U(1_001), f.bob.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsHolderCap");
      await pool.connect(f.bob).deposit(U(1_000), f.bob.address);
      await pool.connect(f.alice).deposit(U(1_000), f.alice.address); // Pool Assets now exactly the floor
      await pool.connect(f.carol).deposit(U(500), f.carol.address); // above it: cap 1,250 of 2,500
      await pool.connect(f.alice).requestWithdrawal(U(1_000), f.alice.address); // queued, still hers
      // 1,000 queued + 600 from her second wallet = 1,600 of 3,100: over 50% for the member.
      await expect(pool.connect(f.alice2).deposit(U(600), f.alice2.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsHolderCap");
      await pool.connect(f.alice2).deposit(U(400), f.alice2.address); // 1,400 of 2,900

      // Carol joins Alice's household (two attesting-role holders): their holdings count together.
      const home = ethers.id("household-1");
      await c.two(c.h1, c.h2, "setHousehold", f.alice.address, home);
      await controls.connect(c.h1).setHousehold(f.carol.address, home);
      expect(await controls.walletsOf(f.carol.address)).to.deep.equal([f.carol.address]);
      await expect(controls.connect(c.h1).setHousehold(f.carol.address, home))
        .to.be.revertedWithCustomError(controls, "EarnControlsSameSigner");
      await controls.connect(c.h2).setHousehold(f.carol.address, home);
      expect(await controls.walletsOf(f.carol.address)).to.deep.equal([f.alice.address, f.alice2.address, f.carol.address]);
      // Household 1,400 + 500 = 1,900, over 50% of 2,900 already: Carol's next subscription is refused.
      await expect(pool.connect(f.carol).deposit(U(250), f.carol.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsHolderCap");
      // Out of the household, she counts alone again.
      await c.two(c.h1, c.h2, "setHousehold", f.carol.address, NO_HASH);
      await pool.connect(f.carol).deposit(U(250), f.carol.address);
    });

    it("the floor changes only 7 days after it is scheduled, with an event; the cap itself stays 10%", async function () {
      await controls.scheduleHolderCapFloor(U(10_000));
      await increase(7 * DAY);
      const tx = await controls.scheduleHolderCapFloor(0n);
      const at = (await latest()) + 7 * DAY;
      await expect(tx).to.emit(controls, "HolderCapFloorScheduled").withArgs(U(10_000), 0n, at);
      expect(await controls.holderCapFloor()).to.equal(U(10_000));
      expect((await controls.pendingHolderCapFloor()).floor).to.equal(0n);
      await increase(7 * DAY);
      expect(await controls.holderCapFloor()).to.equal(0n);
      expect(await controls.holderCapBps()).to.equal(1_000n);
      // With no floor, a 10% cap refuses the very first subscriber.
      await expect(pool.connect(f.alice).deposit(U(1_000), f.alice.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsHolderCap");
      await expect(controls.connect(f.bob).scheduleHolderCapFloor(1n)).to.be.reverted;
    });

    it("(d) pool capacity, the Funding Limit (bonds at Maturity Amount plus shares at Share Value) and the offering maximum", async function () {
      // Decision 38: one offering maximum across both products (here $25,000), and pool capacity.
      await controls.setOfferingLimits(U(25_000), U(15_000), RESOLUTION);
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      await expect(pool.connect(f.bob).deposit(U(5_001), f.bob.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsLimit").withArgs(what("capacity"), U(10_000), U(5_001), U(15_000));
      await pool.connect(f.alice).redeem(U(10_000), f.alice.address, f.alice.address);
      await pool.connect(f.bob).deposit(U(15_000), f.bob.address);
      // Sales are cumulative: 25,000 taken, so the offering maximum refuses more though the pool is empty.
      await pool.connect(f.bob).redeem(U(15_000), f.bob.address, f.bob.address);
      await expect(pool.connect(f.carol).deposit(U(250), f.carol.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsLimit").withArgs(what("offering"), U(25_000), U(250), U(25_000));

      await controls.setOfferingLimits(U(100_000), U(100_000), RESOLUTION);
      await controls.setBondBooks([await sources.getAddress()]);
      await sources.setFace(U(8_000));
      await controls.setFundingLimit(U(20_000), RESOLUTION, 2026);
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      expect(await controls.fundingUsed()).to.equal(U(18_000));
      await f.deploy(U(5_000));
      await increase(200 * DAY); // Pool Interest raises Share Value, and the measure with it
      const used: bigint = await controls.fundingUsed();
      expect(used).to.be.greaterThan(U(18_000));
      await expect(pool.connect(f.bob).deposit(U(20_000) - used + 1n, f.bob.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsLimit");
      await expect(controls.setFundingLimit(U(1), NO_HASH, 2026)).to.be.revertedWithCustomError(controls, "EarnControlsInvalidValue");
    });
  });

  describe("pauses (IV-02 §2.6; Earn §§1, 2; test 24)", function () {
    it("the Reserve Shortfall and Equity Cushion flags each take two signers, and stop subscriptions and purchases, never withdrawals or rolls", async function () {
      await pool.connect(f.alice).deposit(U(1_000), f.alice.address);
      for (const flag of [RESERVE_SHORTFALL, EQUITY_CUSHION]) {
        await controls.connect(c.p1).setPauseFlag(flag, true, ethers.id("why"));
        expect(await controls.subscriptionsPaused()).to.equal(false);
        await expect(controls.connect(c.p1).setPauseFlag(flag, true, ethers.id("why")))
          .to.be.revertedWithCustomError(controls, "EarnControlsSameSigner");
        await expect(controls.connect(f.bob).setPauseFlag(flag, true, ethers.id("why")))
          .to.be.revertedWithCustomError(controls, "EarnControlsNotAuthorized");
        await expect(controls.connect(c.p2).setPauseFlag(flag, true, ethers.id("why")))
          .to.emit(controls, "PauseFlagSet").withArgs(flag, true, ethers.id("why"), c.p1.address, c.p2.address);
        expect(await controls.subscriptionsPaused()).to.equal(true);
        expect(await controls.purchasesPaused()).to.equal(true);
        expect(await controls.rollAllowed()).to.equal(true);
        await expect(pool.connect(f.bob).deposit(U(1_000), f.bob.address)).to.be.revertedWithCustomError(pool, "LendingPoolSubscriptionsPaused");
        await pool.connect(f.alice).redeem(U(100), f.alice.address, f.alice.address);
        await c.two(c.p2, c.p1, "setPauseFlag", flag, false, ethers.id("cured"));
        expect(await controls.subscriptionsPaused()).to.equal(false);
      }
      await expect(controls.connect(c.p1).setPauseFlag(3, true, NO_HASH)).to.be.revertedWithCustomError(controls, "EarnControlsInvalidValue");
    });

    it("the BondVault's own Reserve Shortfall also pauses; an Enforcement Notice stops purchases and rolls, not subscriptions", async function () {
      await controls.setSources(await c.membership.getAddress(), f.poolAddress, await sources.getAddress(), await sources.getAddress(), ethers.ZeroAddress);
      await sources.setShortfall(true);
      expect(await controls.subscriptionsPaused()).to.equal(true);
      await sources.setShortfall(false);
      await sources.setEnforcement(true);
      expect(await controls.purchasesPaused()).to.equal(true);
      expect(await controls.rollAllowed()).to.equal(false);
      expect(await controls.subscriptionsPaused()).to.equal(false);
      await pool.connect(f.alice).deposit(U(1_000), f.alice.address);
    });

    it("while L-01 §2.9(c) applies, subscriptions pause after 30 days below 50% Utilization, until it recovers", async function () {
      await c.two(c.p1, c.p2, "setPauseFlag", LOW_UTILIZATION_RULE, true, ethers.id("2.9(c)"));
      // The pool now reports its low-Utilization clock (conformance pass): an empty pool's
      // Utilization is 0, but the clock starts only with the pool's first change, so not yet paused.
      expect(await pool.lowUtilizationSince()).to.equal(0n);
      expect(await controls.subscriptionsPaused()).to.equal(false);
      // Against a pool that reports it:
      await controls.setSources(await c.membership.getAddress(), await sources.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress);
      expect(await controls.subscriptionsPaused()).to.equal(false); // at or above 50%
      const now = await latest();
      await sources.setLowUtilizationSince(now - 29 * DAY);
      expect(await controls.subscriptionsPaused()).to.equal(false);
      await sources.setLowUtilizationSince(now - 30 * DAY);
      expect(await controls.subscriptionsPaused()).to.equal(true);
      await sources.setLowUtilizationSince(0);
      expect(await controls.subscriptionsPaused()).to.equal(false);
      await sources.setLowUtilizationSince(now - 31 * DAY);
      await c.two(c.p1, c.p2, "setPauseFlag", LOW_UTILIZATION_RULE, false, ethers.id("over"));
      expect(await controls.subscriptionsPaused()).to.equal(false);
    });
  });

  describe("bond purchases (Earn §1; decision 12)", function () {
    let bond: any;
    beforeEach(async function () {
      bond = f.d1; // stands in for a bond collection
      await grant(controls, f.admin, "BOND_ROLE", bond.address);
      await controls.setRung(365, 500, true);
      await controls.setBondBooks([await sources.getAddress()]);
      await controls.setOfferingLimits(U(10_000), U(100_000_000), RESOLUTION);
    });

    it("refuses a non-collection caller, under $250, a term not offered, a payer not the holder's, and an ineligible payer", async function () {
      await expect(controls.connect(f.alice).checkPurchase(f.alice.address, f.alice.address, U(1_000), U(1_050), 365, "0x")).to.be.reverted;
      await expect(controls.connect(bond).checkPurchase(f.alice.address, f.alice.address, U(249.99), U(262), 365, "0x"))
        .to.be.revertedWithCustomError(controls, "EarnControlsBelowMinimum");
      await expect(controls.connect(bond).checkPurchase(f.alice.address, f.alice.address, U(250), U(262.5), 730, "0x"))
        .to.be.revertedWithCustomError(controls, "EarnControlsTermNotOffered");
      await expect(controls.connect(bond).checkPurchase(f.alice.address, f.bob.address, U(250), U(262.5), 365, "0x"))
        .to.be.revertedWithCustomError(controls, "EarnControlsNotSameHolder");
      await expect(controls.connect(bond).checkPurchase(f.outsider.address, f.outsider.address, U(250), U(262.5), 365, "0x"))
        .to.be.revertedWithCustomError(controls, "EarnControlsIneligible");
    });

    it("books the cumulative Purchase Price against the offering maximum and the Maturity Amount against the Funding Limit", async function () {
      await expect(controls.connect(bond).checkPurchase(f.alice.address, f.alice.address, U(6_000), U(6_300), 365, "0x"))
        .to.emit(controls, "OfferingTaken").withArgs(f.alice.address, false, U(6_000), U(6_000));
      await expect(controls.connect(bond).checkPurchase(f.bob.address, f.bob.address, U(4_000.01), U(4_200), 365, "0x"))
        .to.be.revertedWithCustomError(controls, "EarnControlsLimit").withArgs(what("offering"), U(6_000), U(4_000.01), U(10_000));
      await controls.setFundingLimit(U(10_000), RESOLUTION, 2026);
      await sources.setFace(U(6_300));
      await expect(controls.connect(bond).checkPurchase(f.bob.address, f.bob.address, U(3_500), U(3_800), 365, "0x"))
        .to.be.revertedWithCustomError(controls, "EarnControlsLimit").withArgs(what("funding"), U(6_300), U(3_800), U(10_000));
      await controls.connect(bond).checkPurchase(f.bob.address, f.bob.address, U(3_500), U(3_700), 365, "0x");
      await expect(controls.connect(f.alice).recordBondExit(f.alice.address, 1n)).to.be.reverted;
    });

    it("refuses purchases while the Equity Cushion pause is set", async function () {
      await c.two(c.p1, c.p2, "setPauseFlag", EQUITY_CUSHION, true, ethers.id("cushion"));
      await expect(controls.connect(bond).checkPurchase(f.alice.address, f.alice.address, U(1_000), U(1_050), 365, "0x"))
        .to.be.revertedWithCustomError(controls, "EarnControlsPaused");
    });
  });

  describe("the Ladder and rolls (IV-01 §5.2)", function () {
    it("rolls into the same term if offered, else the nearest shorter, at the higher of the notice and Ladder yields", async function () {
      await controls.setSources(await c.membership.getAddress(), f.poolAddress, ethers.ZeroAddress, ethers.ZeroAddress, await sources.getAddress());
      // Decision 41: terms of 12 to 36 months (365 to 1,095 days).
      await controls.setRung(365, 400, true);
      await controls.setRung(547, 450, true);
      await controls.setRung(730, 500, true);
      expect(await controls.rollTermFor(730)).to.equal(730n);
      await expect(controls.setRung(730, 500, false)).to.emit(controls, "RungSet").withArgs(730, 500, false);
      expect(await sources.lastTerm()).to.equal(730n);
      expect(await sources.lastOffered()).to.equal(false);
      expect(await controls.rollTermFor(730)).to.equal(547n);
      expect(await controls.rollTermFor(364)).to.equal(0n);
      expect(await controls.rollYieldFor(547, 420)).to.equal(450n);
      expect(await controls.rollYieldFor(547, 480)).to.equal(480n);
      expect(await controls.ladderTerms()).to.deep.equal([365n, 547n, 730n]);
      await expect(controls.setRung(0, 500, true)).to.be.revertedWithCustomError(controls, "EarnControlsInvalidValue");
      await expect(controls.setRung(730, 5_001, true)).to.be.revertedWithCustomError(controls, "EarnControlsInvalidValue");
      await expect(controls.connect(f.bob).setRung(365, 500, true)).to.be.reverted;
    });

    /* Decision 31: Ladder changes take two LADDER_ROLE signers, are published, and take effect 48 hours later. */
    describe("Ladder changes (decision 31)", function () {
      let l1: any, l2: any;
      beforeEach(async function () {
        [l1, l2] = [f.s1, f.s2];
        await controls.setSources(await c.membership.getAddress(), f.poolAddress, ethers.ZeroAddress, ethers.ZeroAddress, await sources.getAddress());
        await grant(controls, f.admin, "LADDER_ROLE", l1.address, l2.address);
        await controls.setRung(365, 500, true);
      });

      it("need two different LADDER_ROLE signers, and the second publishes the change with its effective time", async function () {
        await expect(controls.connect(f.bob).scheduleRung(365, 550, true))
          .to.be.revertedWithCustomError(controls, "EarnControlsNotAuthorized");
        await expect(controls.connect(f.admin).scheduleRung(365, 550, true))
          .to.be.revertedWithCustomError(controls, "EarnControlsNotAuthorized");
        await controls.connect(l1).scheduleRung(365, 550, true);
        expect((await controls.pendingRung(365)).effectiveAt).to.equal(0n);
        await expect(controls.connect(l1).scheduleRung(365, 550, true))
          .to.be.revertedWithCustomError(controls, "EarnControlsSameSigner");
        const tx = await controls.connect(l2).scheduleRung(365, 550, true);
        const at = BigInt(await latest()) + 48n * 3600n;
        await expect(tx).to.emit(controls, "RungScheduled").withArgs(365, 550, true, at, l1.address, l2.address);
        expect(await controls.pendingRung(365)).to.deep.equal([550n, true, at]);
        // Bounds still apply.
        await expect(controls.connect(l1).scheduleRung(365, 5_001, true))
          .to.be.revertedWithCustomError(controls, "EarnControlsInvalidValue");
      });

      it("take effect only after 48 hours, by anyone, and tell the reserve hook then", async function () {
        await c.two(l1, l2, "scheduleRung", 365, 450, false);
        await expect(controls.applyRung(365)).to.be.revertedWithCustomError(controls, "EarnControlsNotYet");
        expect(await controls.isTermOffered(365)).to.equal(true);
        expect(await controls.ladderYieldBps(365)).to.equal(500n);
        await increase(48 * 3600 - 5);
        await expect(controls.connect(f.outsider).applyRung(365)).to.be.revertedWithCustomError(controls, "EarnControlsNotYet");
        await increase(5);
        await expect(controls.connect(f.outsider).applyRung(365)).to.emit(controls, "RungSet").withArgs(365, 450, false);
        expect(await controls.isTermOffered(365)).to.equal(false);
        expect(await sources.lastTerm()).to.equal(365n);
        expect(await sources.lastOffered()).to.equal(false);
        await expect(controls.applyRung(365)).to.be.revertedWithCustomError(controls, "EarnControlsInvalidValue");
      });

      it("never alter a quote or roll notice already given: the rate at quote time stays readable", async function () {
        const quotedAt = BigInt(await latest());
        await c.two(l1, l2, "scheduleRung", 365, 420, true);
        await increase(48 * 3600);
        await controls.applyRung(365);
        const changedAt = BigInt(await latest());
        expect(await controls.rungAt(365, quotedAt)).to.deep.equal([500n, true]);
        expect(await controls.rungAt(365, changedAt - 1n)).to.deep.equal([500n, true]);
        expect(await controls.rungAt(365, changedAt)).to.deep.equal([420n, true]);
        // A roll notice posted before the change keeps its own yield: the higher of the notice and
        // the Ladder is evaluated when the notice is posted, never lowered later.
        expect(await controls.rollYieldFor(365, 500)).to.equal(500n);
      });

      it("a new schedule for the same term replaces the pending one and restarts its 48 hours", async function () {
        await c.two(l1, l2, "scheduleRung", 365, 600, true);
        await increase(47 * 3600);
        await c.two(l1, l2, "scheduleRung", 365, 650, true);
        await increase(2 * 3600);
        await expect(controls.applyRung(365)).to.be.revertedWithCustomError(controls, "EarnControlsNotYet");
        await increase(46 * 3600);
        await controls.applyRung(365);
        expect(await controls.ladderYieldBps(365)).to.equal(650n);
      });

      it("leave every other setting on the 7-day timelock: a LADDER_ROLE signer cannot change them", async function () {
        await expect(controls.connect(l1).setRung(365, 600, true)).to.be.reverted;
        await expect(controls.connect(l1).setHolderCapBps(500)).to.be.reverted;
        await expect(controls.connect(l1).scheduleHolderCapFloor(1n)).to.be.reverted;
        await expect(controls.connect(l1).setRefused(f.bob.address, true)).to.be.reverted;
      });
    });

    it("the holder-ineligible flag takes two signers and an evidence hash, and tells the reserve", async function () {
      await controls.setSources(await c.membership.getAddress(), f.poolAddress, ethers.ZeroAddress, ethers.ZeroAddress, await sources.getAddress());
      const [e1, e2] = [f.s1, f.s2];
      await grant(controls, f.admin, "ELIGIBILITY_ROLE", e1.address, e2.address);
      await expect(controls.connect(e1).setHolderIneligible(f.alice.address, true, NO_HASH))
        .to.be.revertedWithCustomError(controls, "EarnControlsInvalidValue");
      await controls.connect(e1).setHolderIneligible(f.alice.address, true, ethers.id("evidence"));
      expect(await controls.holderIneligible(f.alice.address)).to.equal(false);
      await controls.connect(e2).setHolderIneligible(f.alice.address, true, ethers.id("evidence"));
      expect(await controls.holderIneligible(f.alice.address)).to.equal(true);
      expect(await sources.lastHolder()).to.equal(f.alice.address);
      expect(await sources.lastIneligible()).to.equal(true);
    });
  });

  describe("transfers (IV-02 §8.1, §8.3)", function () {
    it("move only between one Holder's accounts, or to a Successor approved by two signers with evidence, for 30 days", async function () {
      await pool.connect(f.alice).deposit(U(1_000), f.alice.address);
      await expect(pool.connect(f.alice).transfer(f.carol.address, U(100)))
        .to.be.revertedWithCustomError(pool, "LendingPoolTransferNotAllowed");
      await controls.connect(c.succ1).approveSuccessorTransfer(f.alice.address, f.carol.address, ethers.id("proof"));
      await expect(pool.connect(f.alice).transfer(f.carol.address, U(100)))
        .to.be.revertedWithCustomError(pool, "LendingPoolTransferNotAllowed");
      await expect(controls.connect(c.succ2).approveSuccessorTransfer(f.alice.address, f.carol.address, ethers.id("proof")))
        .to.emit(controls, "SuccessorTransferApproved");
      await pool.connect(f.alice).transfer(f.carol.address, U(100));
      await expect(pool.connect(f.carol).transfer(f.alice.address, U(1)))
        .to.be.revertedWithCustomError(pool, "LendingPoolTransferNotAllowed");
      await increase(31 * DAY);
      await expect(pool.connect(f.alice).transfer(f.carol.address, U(100)))
        .to.be.revertedWithCustomError(pool, "LendingPoolTransferNotAllowed");
      await pool.connect(f.alice).transfer(f.alice2.address, U(100));
    });

    it("register a bond's payment Successor after 7 days, which the Holder's own account can cancel", async function () {
      await c.two(c.succ1, c.succ2, "registerPaymentSuccessor", f.alice.address, f.carol.address, ethers.id("proof"));
      expect(await controls.payeeOf(f.alice.address)).to.equal(f.alice.address);
      await increase(7 * DAY);
      expect(await controls.payeeOf(f.alice.address)).to.equal(f.carol.address);
      await expect(controls.connect(f.bob).cancelPaymentSuccessor()).to.be.revertedWithCustomError(controls, "EarnControlsNothingToCancel");
      await expect(controls.connect(f.alice).cancelPaymentSuccessor())
        .to.emit(controls, "PaymentSuccessorCancelled").withArgs(f.alice.address, f.carol.address);
      expect(await controls.payeeOf(f.alice.address)).to.equal(f.alice.address);
    });
  });

  it("holds no position and moves no money: no token, approval or transfer path", async function () {
    const fns = controls.interface.fragments.filter((x: any) => x.type === "function").map((x: any) => x.name);
    for (const banned of ["transfer", "transferFrom", "approve", "sweep", "rescue", "withdraw", "seize", "freeze"]) {
      expect(fns).to.not.include(banned);
    }
    const fresh = await deployEarnControls(f.admin);
    expect(await fresh.holderCapBps()).to.equal(1_000n);
    expect(await fresh.offeringCap()).to.equal(U(1_000_000));
  });

  describe("decisions 38, 39, 41 and 42 (IV-03 review)", function () {
    it("38: one cumulative offering maximum across both products, by price paid", async function () {
      await controls.setSources(await c.membership.getAddress(), f.poolAddress, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress);
      await grant(controls, f.admin, "BOND_ROLE", f.d1.address);
      await controls.setRung(365, 500, true);
      await controls.setOfferingLimits(U(1_000), U(100_000_000), RESOLUTION);
      await pool.connect(f.alice).deposit(U(600), f.alice.address);
      await controls.connect(f.d1).checkPurchase(f.bob.address, f.bob.address, U(400), U(420), 365, "0x");
      expect(await controls.offeringTaken()).to.equal(U(1_000));
      // Full: a subscription and a purchase are both refused against the same counter.
      await expect(pool.connect(f.carol).deposit(U(250), f.carol.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsLimit").withArgs(what("offering"), U(1_000), U(250), U(1_000));
      await expect(controls.connect(f.d1).checkPurchase(f.bob.address, f.bob.address, U(250), U(262.5), 365, "0x"))
        .to.be.revertedWithCustomError(controls, "EarnControlsLimit");
      expect(controls.interface.getFunction("poolOfferingTaken")).to.equal(null);
    });

    it("39: two FUNDING_ROLE holders post other indebtedness with evidence; it adds to the Funding Limit check", async function () {
      const [a, b] = [f.cco, f.destination];
      await grant(controls, f.admin, "FUNDING_ROLE", a.address, b.address);
      await controls.setFundingLimit(U(5_000), RESOLUTION, 2026);
      await expect(controls.connect(f.bob).postOtherIndebtedness(U(4_500), ethers.id("statement")))
        .to.be.revertedWithCustomError(controls, "EarnControlsNotAuthorized");
      await controls.connect(a).postOtherIndebtedness(U(4_500), ethers.id("statement"));
      expect(await controls.otherIndebtedness()).to.equal(0n); // one signer: nothing yet
      await expect(controls.connect(a).postOtherIndebtedness(U(4_500), ethers.id("statement")))
        .to.be.revertedWithCustomError(controls, "EarnControlsSameSigner");
      await expect(controls.connect(b).postOtherIndebtedness(U(4_500), ethers.id("statement")))
        .to.emit(controls, "OtherIndebtednessPosted").withArgs(U(4_500), ethers.id("statement"), a.address, b.address);
      expect(await controls.fundingUsed()).to.equal(U(4_500));
      await expect(pool.connect(f.alice).deposit(U(600), f.alice.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsLimit").withArgs(what("funding"), U(4_500), U(600), U(5_000));
      await pool.connect(f.alice).deposit(U(500), f.alice.address);
    });

    it("41: terms of 12 to 36 months (60 by the Earn timelock), never a longer term yielding less; Ladder-wide moves together", async function () {
      expect(await controls.monthsToDays(12)).to.equal(365n);
      expect(await controls.monthsToDays(36)).to.equal(1_095n);
      expect(await controls.monthsToDays(60)).to.equal(1_825n);
      await expect(controls.setRung(364, 400, true)).to.be.revertedWithCustomError(controls, "EarnControlsInvalidValue");
      await expect(controls.setRung(1_096, 400, true)).to.be.revertedWithCustomError(controls, "EarnControlsInvalidValue");
      await expect(controls.connect(f.bob).setMaxTermMonths(60)).to.be.reverted;
      await expect(controls.setMaxTermMonths(61)).to.be.revertedWithCustomError(controls, "EarnControlsInvalidValue");
      await controls.setMaxTermMonths(60);
      await controls.setRung(1_825, 600, true);
      await expect(controls.setRung(1_826, 600, true)).to.be.revertedWithCustomError(controls, "EarnControlsInvalidValue");

      await controls.setRung(365, 500, true);
      await controls.setRung(730, 550, true);
      // A longer term below a shorter one is refused.
      await expect(controls.setRung(730, 450, true)).to.be.revertedWithCustomError(controls, "EarnControlsLadderOrder").withArgs(365, 730);
      const [l1, l2] = [f.s1, f.s2];
      await grant(controls, f.admin, "LADDER_ROLE", l1.address, l2.address);
      // Raising the 1-year rung above the 2-year one alone is refused when it takes effect...
      await c.two(l1, l2, "scheduleRung", 365, 575, true);
      await increase(2 * DAY);
      await expect(controls.applyRung(365)).to.be.revertedWithCustomError(controls, "EarnControlsLadderOrder");
      // ...but a Ladder-wide move scheduled and applied together passes.
      await c.two(l1, l2, "scheduleRungs", [365, 730, 1_825], [575, 625, 700], [true, true, true]);
      await increase(2 * DAY);
      await expect(controls.applyRungs([365])).to.be.revertedWithCustomError(controls, "EarnControlsLadderOrder");
      await controls.applyRungs([365, 730, 1_825]);
      expect(await controls.ladderYieldBps(365)).to.equal(575n);
      expect(await controls.ladderYieldBps(730)).to.equal(625n);
    });

    it("42: refuses an attestation valid for more than 12 months", async function () {
      const now = await latest();
      await expect(c.attest(f.outsider, "506C", { issuedAt: now, validUntil: now + 365 * DAY + 1 }))
        .to.be.revertedWithCustomError(controls, "EarnControlsBadAttestation");
      await c.attest(f.outsider, "506C", { issuedAt: now, validUntil: now + 365 * DAY });
    });
  });
});
