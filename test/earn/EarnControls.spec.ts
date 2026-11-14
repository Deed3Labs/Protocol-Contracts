import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { DAY, U, deployYieldPool, increase, latest } from "../helpers/yieldPool";
import { RESOLUTION, attestation, code, deployEarnControls, grant, withRealControls } from "../helpers/earnControls";

/*
 * Phase 2f, stage 1: EarnControls (decisions 1, 12 and 13) against the real Yield Pool. The bond
 * side (`checkPurchase`, rolls, the Ladder) is called by a signer standing in for a bond
 * collection, since stage 2 wires the collections.
 */
describe("EarnControls (Earn §1, §2, §6; decisions 1, 12, 13)", function () {
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

  describe("roles", function () {
    it("are granted only with a Lending Board resolution hash (§10)", async function () {
      const role = await controls.ATTESTER_ROLE();
      await expect(controls.grantRole(role, f.bob.address)).to.be.revertedWithCustomError(controls, "EarnControlsUseResolution");
      await expect(controls.grantRoleByResolution(role, f.bob.address, ethers.ZeroHash))
        .to.be.revertedWithCustomError(controls, "EarnControlsInvalidValue");
      await expect(controls.connect(f.bob).grantRoleByResolution(role, f.bob.address, RESOLUTION)).to.be.reverted;
      await expect(controls.grantRoleByResolution(role, f.bob.address, RESOLUTION))
        .to.emit(controls, "RoleGrantedByResolution").withArgs(role, f.bob.address, RESOLUTION);
    });

    it("upgrades only by the admin (the Earn timelock)", async function () {
      const F = await ethers.getContractFactory("EarnControls", f.bob);
      await expect(upgrades.upgradeProxy(controls, F, { kind: "uups" })).to.be.reverted;
      await upgrades.upgradeProxy(controls, await ethers.getContractFactory("EarnControls", f.admin), { kind: "uups" });
    });
  });

  describe("eligibility by attestation (IV-02 §2.1)", function () {
    it("refuses a payer with no attestation, a stale or unsigned one, or one whose attester lost the role", async function () {
      await expect(pool.connect(f.outsider).deposit(U(1_000), f.outsider.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsIneligible");
      const stranger = ethers.Wallet.createRandom();
      await expect(controls.attestEligibility(f.outsider.address, await attestation(controls, stranger, f.outsider.address)))
        .to.be.revertedWithCustomError(controls, "EarnControlsBadAttestation");
      const now = await latest();
      await expect(c.attest(f.outsider, "506C", { issuedAt: now - 10 * DAY, validUntil: now - DAY }))
        .to.be.revertedWithCustomError(controls, "EarnControlsBadAttestation");

      await c.attest(f.outsider, "506B", { validUntil: now + 30 * DAY });
      await pool.connect(f.outsider).deposit(U(1_000), f.outsider.address);
      // An older attestation cannot replace a newer one.
      await expect(c.attest(f.outsider, "506C", { issuedAt: now - DAY }))
        .to.be.revertedWithCustomError(controls, "EarnControlsBadAttestation");
      // Expiry.
      await increase(31 * DAY);
      await expect(pool.connect(f.outsider).deposit(U(1_000), f.outsider.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsIneligible");
      // A revoked attester's attestations stop counting.
      await controls.revokeRole(await controls.ATTESTER_ROLE(), c.attester.address);
      await expect(pool.connect(f.alice).deposit(U(1_000), f.alice.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsIneligible");
    });

    it("takes the attestation with the subscription and returns its tag to the pool", async function () {
      const att = await attestation(controls, c.attester, f.outsider.address, "147A");
      await expect(pool.connect(f.outsider).subscribe(U(1_000), f.outsider.address, att))
        .to.emit(pool, "Subscribed").withArgs(f.outsider.address, f.outsider.address, U(1_000), U(1_000), code("147A"))
        .and.to.emit(controls, "EligibilityAttested");
      expect((await controls.isEligible(f.outsider.address))[1]).to.equal(code("147A"));
    });

    it("only the Yield Pool may check a subscription", async function () {
      await expect(controls.connect(f.alice).checkSubscription(f.alice.address, f.alice.address, U(1_000), "0x"))
        .to.be.revertedWithCustomError(controls, "EarnControlsNotAuthorized");
    });
  });

  describe("payers and receivers (§1, §6)", function () {
    it("refuses a Clear contract as payer or receiver", async function () {
      await controls.setRefused(f.bob.address, true);
      await expect(pool.connect(f.bob).deposit(U(1_000), f.bob.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsRefused");
    });

    it("mints only to the payer's own Holder: one of the member's Smart Accounts", async function () {
      await expect(pool.connect(f.alice).deposit(U(1_000), f.bob.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsNotSameHolder");
      await pool.connect(f.alice).deposit(U(1_000), f.alice2.address);
      expect(await pool.balanceOf(f.alice2.address)).to.equal(U(1_000));
    });

    it("walletsOf lists every wallet of the member; an unregistered account is its own", async function () {
      expect(await controls.walletsOf(f.alice2.address)).to.deep.equal([f.alice.address, f.alice2.address]);
      expect(await controls.walletsOf(f.d1.address)).to.deep.equal([f.d1.address]);
      expect(await controls.sameHolder(f.alice.address, f.alice2.address)).to.equal(true);
      expect(await controls.sameHolder(f.alice.address, f.bob.address)).to.equal(false);
    });
  });

  describe("the 10% holder cap, per member, with the bootstrap floor (decision 13)", function () {
    beforeEach(async function () {
      // Pool Assets at or below $10,000 are the bootstrap: no cap applies.
      await controls.scheduleHolderCapFloor(U(10_000));
      await increase(7 * DAY);
      expect(await controls.holderCapFloor()).to.equal(U(10_000));
      expect(await pool.holderCapBps()).to.equal(10_000n); // the pool's own check is off; the controls count
    });

    it("lets the first subscribers in below the floor, then holds every member to 10% above it", async function () {
      await pool.connect(f.alice).deposit(U(5_000), f.alice.address); // 100% of the pool, under the floor
      await pool.connect(f.bob).deposit(U(5_000), f.bob.address); // Pool Assets now exactly the floor
      await pool.connect(f.carol).deposit(U(1_000), f.carol.address); // 1,000 of 11,000: 9.09%
      await expect(pool.connect(f.carol).deposit(U(250), f.carol.address)) // 1,250 of 11,250
        .to.be.revertedWithCustomError(controls, "EarnControlsHolderCap");
    });

    it("counts every wallet of the member, queued shares included", async function () {
      await pool.connect(f.bob).deposit(U(9_500), f.bob.address);
      await pool.connect(f.alice).deposit(U(500), f.alice.address); // Pool Assets 10,000: the floor
      // Pool Assets above the floor now. Alice holds 500 of 10,500 with this: under 10%.
      await pool.connect(f.carol).deposit(U(500), f.carol.address);
      await pool.connect(f.alice).requestWithdrawal(U(500), f.alice.address); // queued, still hers
      // 500 queued + 700 from her second wallet = 1,200 of 11,200: over 10% for the member.
      await expect(pool.connect(f.alice2).deposit(U(700), f.alice2.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsHolderCap");
      await pool.connect(f.alice2).deposit(U(250), f.alice2.address);
    });

    it("schedules a floor change 7 days ahead, with an event, leaving the cap itself at 10%", async function () {
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
  });

  describe("the Funding Limit (decision 12)", function () {
    it("counts outstanding bonds at their Maturity Amount plus pool shares at Share Value", async function () {
      await controls.setBondBooks([await sources.getAddress()]);
      await sources.setFace(U(8_000));
      await controls.setFundingLimit(U(20_000), RESOLUTION, 2026);
      await pool.connect(f.alice).deposit(U(10_000), f.alice.address);
      expect(await controls.fundingUsed()).to.equal(U(18_000));
      // Share Value rises with Pool Interest; the measure follows it.
      await f.deploy(U(5_000));
      await increase(200 * DAY);
      const used: bigint = await controls.fundingUsed();
      expect(used).to.be.greaterThan(U(18_000));
      const room: bigint = await controls.fundingRoom();
      expect(room).to.equal(U(20_000) - used);
      await expect(pool.connect(f.bob).deposit(room + 1n, f.bob.address))
        .to.be.revertedWithCustomError(controls, "EarnControlsFundingLimit");
      await expect(controls.setFundingLimit(U(1), ethers.ZeroHash, 2026)).to.be.revertedWithCustomError(controls, "EarnControlsInvalidValue");
    });
  });

  describe("pauses (§1, §2, §6; test 24)", function () {
    beforeEach(async function () {
      await controls.setSources(await c.membership.getAddress(), f.poolAddress, await sources.getAddress(), await sources.getAddress(), ethers.ZeroAddress);
    });

    it("a Reserve Shortfall pauses subscriptions and purchases; withdrawals go on", async function () {
      await pool.connect(f.alice).deposit(U(1_000), f.alice.address);
      await sources.setShortfall(true);
      expect(await controls.subscriptionsPaused()).to.equal(true);
      expect(await controls.purchasesPaused()).to.equal(true);
      expect(await controls.rollAllowed()).to.equal(true);
      await expect(pool.connect(f.bob).deposit(U(1_000), f.bob.address)).to.be.revertedWithCustomError(pool, "LendingPoolSubscriptionsPaused");
      await pool.connect(f.alice).redeem(U(500), f.alice.address, f.alice.address);
    });

    it("an Enforcement Notice stops purchases and rolls, not pool subscriptions", async function () {
      await sources.setEnforcement(true);
      expect(await controls.purchasesPaused()).to.equal(true);
      expect(await controls.rollAllowed()).to.equal(false);
      expect(await controls.subscriptionsPaused()).to.equal(false);
      await pool.connect(f.alice).deposit(U(1_000), f.alice.address);
    });

    it("the Equity Cushion pause needs two different signers to set and to clear", async function () {
      await controls.connect(c.ec1).setEquityCushionPause(true, ethers.id("cushion"));
      expect(await controls.equityCushionPaused()).to.equal(false);
      await expect(controls.connect(c.ec1).setEquityCushionPause(true, ethers.id("cushion")))
        .to.be.revertedWithCustomError(controls, "EarnControlsSameSigner");
      await expect(controls.connect(f.bob).setEquityCushionPause(true, ethers.id("cushion")))
        .to.be.revertedWithCustomError(controls, "EarnControlsNotAuthorized");
      await expect(controls.connect(c.ec2).setEquityCushionPause(true, ethers.id("cushion")))
        .to.emit(controls, "EquityCushionPauseSet").withArgs(true, ethers.id("cushion"), c.ec1.address, c.ec2.address);
      expect(await controls.purchasesPaused()).to.equal(true);
      expect(await controls.rollAllowed()).to.equal(true);
      await c.two(c.ec2, c.ec1, "setEquityCushionPause", false, ethers.id("cured"));
      expect(await controls.equityCushionPaused()).to.equal(false);
    });
  });

  describe("bond purchases (§1; decision 12)", function () {
    let bond: any;
    beforeEach(async function () {
      bond = f.d1; // stands in for a bond collection
      await grant(controls, f.admin, "BOND_ROLE", bond.address);
      await controls.setRung(365, 500, true);
      await controls.setBondBooks([await sources.getAddress()]);
      await controls.setOfferingCap(U(10_000));
    });

    it("refuses a non-collection caller, under $250, a term not offered, and a payer not the holder's", async function () {
      await expect(controls.connect(f.alice).checkPurchase(f.alice.address, f.alice.address, U(1_000), U(1_050), 365, "0x"))
        .to.be.reverted;
      await expect(controls.connect(bond).checkPurchase(f.alice.address, f.alice.address, U(249.99), U(262), 365, "0x"))
        .to.be.revertedWithCustomError(controls, "EarnControlsBelowMinimum");
      await expect(controls.connect(bond).checkPurchase(f.alice.address, f.alice.address, U(250), U(262.5), 730, "0x"))
        .to.be.revertedWithCustomError(controls, "EarnControlsTermNotOffered");
      await expect(controls.connect(bond).checkPurchase(f.alice.address, f.bob.address, U(250), U(262.5), 365, "0x"))
        .to.be.revertedWithCustomError(controls, "EarnControlsNotSameHolder");
      await expect(controls.connect(bond).checkPurchase(f.outsider.address, f.outsider.address, U(250), U(262.5), 365, "0x"))
        .to.be.revertedWithCustomError(controls, "EarnControlsIneligible");
    });

    it("books the cumulative Purchase Price against the offering cap and the Maturity Amount against the Funding Limit", async function () {
      await expect(controls.connect(bond).checkPurchase(f.alice.address, f.alice.address, U(6_000), U(6_300), 365, "0x"))
        .to.emit(controls, "OfferingTaken").withArgs(f.alice.address, U(6_000), U(6_000));
      expect(await controls.offeringTaken()).to.equal(U(6_000));
      // The cap counts Purchase Price taken, cumulatively: it never falls back when a bond matures.
      await expect(controls.connect(bond).checkPurchase(f.bob.address, f.bob.address, U(4_000.01), U(4_200), 365, "0x"))
        .to.be.revertedWithCustomError(controls, "EarnControlsOfferingCap");
      await controls.setFundingLimit(U(10_000), RESOLUTION, 2026);
      await sources.setFace(U(6_300));
      await expect(controls.connect(bond).checkPurchase(f.bob.address, f.bob.address, U(3_500), U(3_800), 365, "0x"))
        .to.be.revertedWithCustomError(controls, "EarnControlsFundingLimit");
      await controls.connect(bond).checkPurchase(f.bob.address, f.bob.address, U(3_500), U(3_700), 365, "0x");
    });

    it("refuses purchases during the Equity Cushion pause", async function () {
      await c.two(c.ec1, c.ec2, "setEquityCushionPause", true, ethers.id("cushion"));
      await expect(controls.connect(bond).checkPurchase(f.alice.address, f.alice.address, U(1_000), U(1_050), 365, "0x"))
        .to.be.revertedWithCustomError(controls, "EarnControlsPaused");
    });
  });

  describe("the Ladder and rolls (IV-01 §5.2)", function () {
    it("rolls into the same term if offered, else the nearest shorter, at the higher of the notice and Ladder yields", async function () {
      await controls.setSources(await c.membership.getAddress(), f.poolAddress, ethers.ZeroAddress, ethers.ZeroAddress, await sources.getAddress());
      await controls.setRung(91, 400, true);
      await controls.setRung(182, 450, true);
      await controls.setRung(365, 500, true);
      expect(await controls.rollTermFor(365)).to.equal(365n);
      await expect(controls.setRung(365, 500, false)).to.emit(controls, "RungSet").withArgs(365, 500, false);
      expect(await sources.lastTerm()).to.equal(365n);
      expect(await sources.lastOffered()).to.equal(false);
      expect(await controls.rollTermFor(365)).to.equal(182n);
      expect(await controls.rollTermFor(90)).to.equal(0n);
      expect(await controls.rollYieldFor(182, 420)).to.equal(450n);
      expect(await controls.rollYieldFor(182, 480)).to.equal(480n);
      expect(await controls.ladderTerms()).to.deep.equal([91n, 182n, 365n]);
      await expect(controls.setRung(0, 500, true)).to.be.revertedWithCustomError(controls, "EarnControlsInvalidValue");
      await expect(controls.setRung(365, 5_001, true)).to.be.revertedWithCustomError(controls, "EarnControlsInvalidValue");
      await expect(controls.connect(f.bob).setRung(365, 500, true)).to.be.reverted;
    });

    it("the holder-ineligible flag takes two signers and an evidence hash, and tells the reserve", async function () {
      await controls.setSources(await c.membership.getAddress(), f.poolAddress, ethers.ZeroAddress, ethers.ZeroAddress, await sources.getAddress());
      const [e1, e2] = [f.s1, f.s2];
      await grant(controls, f.admin, "ELIGIBILITY_ROLE", e1.address, e2.address);
      await expect(controls.connect(e1).setHolderIneligible(f.alice.address, true, ethers.ZeroHash))
        .to.be.revertedWithCustomError(controls, "EarnControlsInvalidValue");
      await controls.connect(e1).setHolderIneligible(f.alice.address, true, ethers.id("evidence"));
      expect(await controls.holderIneligible(f.alice.address)).to.equal(false);
      await controls.connect(e2).setHolderIneligible(f.alice.address, true, ethers.id("evidence"));
      expect(await controls.holderIneligible(f.alice.address)).to.equal(true);
      expect(await sources.lastHolder()).to.equal(f.alice.address);
      expect(await sources.lastIneligible()).to.equal(true);
    });
  });

  describe("the Successor path (IV-01 §6.3)", function () {
    it("opens a transfer to the Successor for 30 days on two signers and an evidence hash", async function () {
      await pool.connect(f.alice).deposit(U(1_000), f.alice.address);
      await expect(pool.connect(f.alice).transfer(f.carol.address, U(100)))
        .to.be.revertedWithCustomError(pool, "LendingPoolTransferNotAllowed");
      await controls.connect(c.succ1).approveSuccessorTransfer(f.alice.address, f.carol.address, ethers.id("proof"));
      await expect(pool.connect(f.alice).transfer(f.carol.address, U(100)))
        .to.be.revertedWithCustomError(pool, "LendingPoolTransferNotAllowed");
      await expect(controls.connect(c.succ2).approveSuccessorTransfer(f.alice.address, f.carol.address, ethers.id("proof")))
        .to.emit(controls, "SuccessorTransferApproved");
      await pool.connect(f.alice).transfer(f.carol.address, U(100));
      // Only that direction, and only for 30 days.
      await expect(pool.connect(f.carol).transfer(f.alice.address, U(1)))
        .to.be.revertedWithCustomError(pool, "LendingPoolTransferNotAllowed");
      await increase(31 * DAY);
      await expect(pool.connect(f.alice).transfer(f.carol.address, U(100)))
        .to.be.revertedWithCustomError(pool, "LendingPoolTransferNotAllowed");
      // Between one Holder's own accounts, always.
      await pool.connect(f.alice).transfer(f.alice2.address, U(100));
    });

    it("registers a Successor for payment after 7 days, which the Holder's own account can cancel", async function () {
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

  it("holds no position and moves no money: it has no token approval or transfer path", async function () {
    const fns = controls.interface.fragments.filter((x: any) => x.type === "function").map((x: any) => x.name);
    for (const banned of ["transfer", "transferFrom", "approve", "sweep", "rescue", "withdraw", "seize", "freeze"]) {
      expect(fns).to.not.include(banned);
    }
    const fresh = await deployEarnControls(f.admin);
    expect(await fresh.holderCapBps()).to.equal(1_000n);
    expect(await fresh.offeringCap()).to.equal(U(1_000_000));
  });
});
