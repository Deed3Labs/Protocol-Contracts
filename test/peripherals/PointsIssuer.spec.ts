import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployCreditsNetwork, signRedeem, signSpend } from "../helpers/credits";

const ONE = 10n ** 6n;
const DAY = 24 * 60 * 60;
const SAVING = ethers.encodeBytes32String("SAVING");
const RENT = ethers.encodeBytes32String("RENT");
const ref = (s: string) => ethers.id(s);

/*
 * The Points Issuer: mints Clear Credits with a source and a unique ref,
 * enforces the match limits on chain, keeps Credits Earned, redeems into the Housing Allowance at a
 * rate schedule, spends on registered uses, and reverses only with two reviewers.
 */
describe("PointsIssuer", function () {
  let n: Awaited<ReturnType<typeof deployCreditsNetwork>>;
  let member: any, other: any;

  async function now() {
    return BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  }
  async function elapse(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }
  async function openMatch(who: any) {
    await n.points.connect(n.membersKey).openMatchPeriod(who.address, await now());
  }

  beforeEach(async function () {
    n = await deployCreditsNetwork();
    const s = await ethers.getSigners();
    [member, other] = [s[10], s[11]];
  });

  describe("minting", function () {
    it("mints to a member from the line, counted as earned and by source", async function () {
      await expect(n.points.connect(n.minter).mint(member.address, 30n * ONE, RENT, ref("p1")))
        .to.emit(n.points, "CreditsMinted")
        .withArgs(member.address, 30n * ONE, RENT, ref("p1"));
      expect(await n.ledger.balanceOf(member.address)).to.equal(30n * ONE);
      expect(await n.points.earnedOf(member.address)).to.equal(30n * ONE);
      expect(await n.points.earnedBySource(member.address, RENT)).to.equal(30n * ONE);
      expect(await n.points.outstanding()).to.equal(30n * ONE);
    });

    it("mints each ref once", async function () {
      await n.points.connect(n.minter).mint(member.address, ONE, RENT, ref("p1"));
      await expect(n.points.connect(n.minter).mint(member.address, ONE, RENT, ref("p1")))
        .to.be.revertedWithCustomError(n.points, "PointsIssuerRefUsed");
    });

    it("takes only registered sources and only the minter", async function () {
      await expect(
        n.points.connect(n.minter).mint(member.address, ONE, ethers.encodeBytes32String("BONUS"), ref("x"))
      ).to.be.revertedWithCustomError(n.points, "PointsIssuerSourceNotAllowed");
      await expect(n.points.connect(n.outsider).mint(member.address, ONE, RENT, ref("y")))
        .to.be.revertedWithCustomError(n.points, "CreditIssuerMissingRole");
    });

    it("leaves credits impossible to send to anyone but the issuer", async function () {
      await n.points.connect(n.minter).mint(member.address, 5n * ONE, RENT, ref("p1"));
      await expect(n.ledger.connect(member).transfer(other.address, ONE)).to.be.reverted;
    });
  });

  describe("the match (SAVING)", function () {
    it("needs an open Match Period", async function () {
      await expect(n.points.connect(n.minter).mint(member.address, ONE, SAVING, ref("s1")))
        .to.be.revertedWithCustomError(n.points, "PointsIssuerNoMatchPeriod");
    });

    it("opens a Match Period once, by the members key only", async function () {
      await openMatch(member);
      await expect(n.points.connect(n.membersKey).openMatchPeriod(member.address, await now()))
        .to.be.revertedWithCustomError(n.points, "PointsIssuerMatchPeriodSet");
      await expect(n.points.connect(n.outsider).openMatchPeriod(other.address, await now()))
        .to.be.revertedWithCustomError(n.points, "CreditIssuerMissingRole");
    });

    it("holds a calendar month to 1,500", async function () {
      await openMatch(member);
      await n.points.connect(n.minter).mint(member.address, 1_400n * ONE, SAVING, ref("s1"));
      await expect(n.points.connect(n.minter).mint(member.address, 101n * ONE, SAVING, ref("s2")))
        .to.be.revertedWithCustomError(n.points, "PointsIssuerMonthlyCap");
      await n.points.connect(n.minter).mint(member.address, 100n * ONE, SAVING, ref("s3"));
      await elapse(32 * DAY);
      await n.points.connect(n.minter).mint(member.address, 1_500n * ONE, SAVING, ref("s4"));
    });

    it("holds the member to 54,000 in all", async function () {
      await openMatch(member);
      await n.points.setLimits(60_000n * ONE, 54_000n * ONE, 1096 * DAY);
      await n.points.connect(n.minter).mint(member.address, 54_000n * ONE, SAVING, ref("s1"));
      await elapse(32 * DAY);
      await expect(n.points.connect(n.minter).mint(member.address, ONE, SAVING, ref("s2")))
        .to.be.revertedWithCustomError(n.points, "PointsIssuerLifetimeCap");
    });

    it("ends after 36 months, and at once when the Housing Allowance Record closes it", async function () {
      await openMatch(member);
      await openMatch(other);
      await n.housing.closeMatchPeriodOn(await n.points.getAddress(), member.address);
      await expect(n.points.connect(n.minter).mint(member.address, ONE, SAVING, ref("s1")))
        .to.be.revertedWithCustomError(n.points, "PointsIssuerOutsideMatchPeriod");
      // Rent still earns after the match ends.
      await n.points.connect(n.minter).mint(member.address, ONE, RENT, ref("r1"));

      await elapse(1097 * DAY);
      await expect(n.points.connect(n.minter).mint(other.address, ONE, SAVING, ref("s2")))
        .to.be.revertedWithCustomError(n.points, "PointsIssuerOutsideMatchPeriod");
    });

    it("lets only the Housing Allowance Record close a Match Period", async function () {
      await openMatch(member);
      await expect(n.points.connect(n.outsider).closeMatchPeriod(member.address))
        .to.be.revertedWithCustomError(n.points, "PointsIssuerNotHousingRecord");
    });
  });

  describe("redeeming into the Housing Allowance", function () {
    const HOME = 7n;

    beforeEach(async function () {
      await n.points.connect(n.minter).mint(member.address, 1_000n * ONE, RENT, ref("r1"));
      await n.housing.setSigned(member.address, HOME, true);
    });

    it("burns the credits, credits $1 each, and leaves Credits Earned alone", async function () {
      const deadline = (await now()) + 3600n;
      const sig = await signRedeem(n.points, member, HOME, 400n * ONE, deadline);
      await expect(n.points.connect(n.outsider).redeem(member.address, HOME, 400n * ONE, deadline, sig))
        .to.emit(n.points, "CreditsRedeemed")
        .withArgs(member.address, HOME, 400n * ONE, 400n * ONE);
      expect(await n.ledger.balanceOf(member.address)).to.equal(600n * ONE);
      expect(await n.points.earnedOf(member.address)).to.equal(1_000n * ONE);
      expect(await n.points.outstanding()).to.equal(600n * ONE);
      expect(await n.housing.creditPortion(member.address, HOME)).to.equal(400n * ONE);
    });

    it("refuses a replayed, expired, forged or oversized redemption", async function () {
      const deadline = (await now()) + 3600n;
      const sig = await signRedeem(n.points, member, HOME, 100n * ONE, deadline);
      await n.points.redeem(member.address, HOME, 100n * ONE, deadline, sig);
      await expect(n.points.redeem(member.address, HOME, 100n * ONE, deadline, sig))
        .to.be.revertedWithCustomError(n.points, "PointsIssuerBadSignature");

      const forged = await signRedeem(n.points, other, HOME, 100n * ONE, deadline, await n.points.nonces(member.address));
      await expect(n.points.redeem(member.address, HOME, 100n * ONE, deadline, forged))
        .to.be.revertedWithCustomError(n.points, "PointsIssuerBadSignature");

      const old = (await now()) - 1n;
      const late = await signRedeem(n.points, member, HOME, ONE, old);
      await expect(n.points.redeem(member.address, HOME, ONE, old, late))
        .to.be.revertedWithCustomError(n.points, "PointsIssuerExpired");

      const big = await signRedeem(n.points, member, HOME, 5_000n * ONE, deadline);
      await expect(n.points.redeem(member.address, HOME, 5_000n * ONE, deadline, big))
        .to.be.revertedWithCustomError(n.points, "PointsIssuerInsufficient");
    });

    it("is refused by the record before an ELPA, and above the lifetime cap", async function () {
      const deadline = (await now()) + 3600n;
      const noElpa = await signRedeem(n.points, member, 99n, ONE, deadline);
      await expect(n.points.redeem(member.address, 99n, ONE, deadline, noElpa)).to.be.reverted;

      await n.housing.setCap(50n * ONE);
      const over = await signRedeem(n.points, member, HOME, 60n * ONE, deadline);
      await expect(n.points.redeem(member.address, HOME, 60n * ONE, deadline, over)).to.be.reverted;
    });
  });

  describe("the Redemption Rate", function () {
    it("needs 30 days' notice and a later date", async function () {
      const t = await now();
      await expect(n.points.scheduleRate(ONE / 2n, t + BigInt(10 * DAY)))
        .to.be.revertedWithCustomError(n.points, "PointsIssuerRateTooSoon");
      await expect(n.points.connect(n.outsider).scheduleRate(ONE / 2n, t + BigInt(40 * DAY))).to.be.reverted;
    });

    it("keeps credits earned before a lower rate at the old rate, oldest first", async function () {
      const HOME = 1n;
      await n.housing.setSigned(member.address, HOME, true);
      await n.points.connect(n.minter).mint(member.address, 100n * ONE, RENT, ref("before"));
      await n.points.scheduleRate(ONE / 2n, (await now()) + BigInt(31 * DAY));
      await elapse(32 * DAY);
      await n.points.connect(n.minter).mint(member.address, 100n * ONE, RENT, ref("after"));

      expect(await n.points.quote(member.address, 150n * ONE)).to.equal(100n * ONE + 25n * ONE);
      const deadline = (await now()) + 3600n;
      const sig = await signRedeem(n.points, member, HOME, 150n * ONE, deadline);
      await n.points.redeem(member.address, HOME, 150n * ONE, deadline, sig);
      expect(await n.housing.creditPortion(member.address, HOME)).to.equal(125n * ONE);
    });

    it("applies a higher rate to credits already held", async function () {
      await n.points.connect(n.minter).mint(member.address, 10n * ONE, RENT, ref("a"));
      await n.points.scheduleRate(2n * ONE, (await now()) + BigInt(31 * DAY));
      await elapse(32 * DAY);
      expect(await n.points.quote(member.address, 10n * ONE)).to.equal(20n * ONE);
    });
  });

  describe("spending on a registered use", function () {
    const USE = ethers.encodeBytes32String("REWARDS_APP");

    it("refuses an unregistered use, and spends a registered one without touching Credits Earned", async function () {
      await n.points.connect(n.minter).mint(member.address, 50n * ONE, RENT, ref("r1"));
      const deadline = (await now()) + 3600n;
      let sig = await signSpend(n.points, member, USE, 20n * ONE, deadline);
      await expect(n.points.spend(member.address, USE, 20n * ONE, deadline, sig))
        .to.be.revertedWithCustomError(n.points, "PointsIssuerUseNotAllowed");

      await n.points.setUse(USE, true);
      sig = await signSpend(n.points, member, USE, 20n * ONE, deadline);
      await n.points.spend(member.address, USE, 20n * ONE, deadline, sig);
      expect(await n.ledger.balanceOf(member.address)).to.equal(30n * ONE);
      expect(await n.points.spentOf(member.address)).to.equal(20n * ONE);
      expect(await n.points.earnedOf(member.address)).to.equal(50n * ONE);
    });
  });

  describe("reversal", function () {
    it("needs two different reviewers, and touches only that ref", async function () {
      await n.points.connect(n.minter).mint(member.address, 40n * ONE, RENT, ref("bad"));
      await n.points.connect(n.minter).mint(member.address, 60n * ONE, RENT, ref("good"));

      await expect(n.points.connect(n.outsider).proposeReversal(ref("bad"), 40n * ONE, 0, 0, ethers.ZeroHash))
        .to.be.revertedWithCustomError(n.points, "CreditIssuerMissingRole");
      await expect(n.points.connect(n.reviewerA).proposeReversal(ref("bad"), 41n * ONE, 0, 0, ethers.ZeroHash))
        .to.be.revertedWithCustomError(n.points, "PointsIssuerReversalTooLarge");

      await n.points.connect(n.reviewerA).proposeReversal(ref("bad"), 40n * ONE, 0, 0, ethers.id("evidence"));
      await expect(n.points.connect(n.reviewerA).approveReversal(0))
        .to.be.revertedWithCustomError(n.points, "PointsIssuerSameReviewer");
      await n.points.connect(n.reviewerB).approveReversal(0);

      expect(await n.ledger.balanceOf(member.address)).to.equal(60n * ONE);
      expect(await n.points.earnedOf(member.address)).to.equal(60n * ONE);
      expect(await n.points.earnedBySource(member.address, RENT)).to.equal(60n * ONE);
      await expect(n.points.connect(n.reviewerB).approveReversal(0))
        .to.be.revertedWithCustomError(n.points, "PointsIssuerReversalDone");
    });

    it("takes redeemed value back out of the Credit Portion", async function () {
      const HOME = 3n;
      await n.housing.setSigned(member.address, HOME, true);
      await n.points.connect(n.minter).mint(member.address, 40n * ONE, RENT, ref("bad"));
      const deadline = (await now()) + 3600n;
      const sig = await signRedeem(n.points, member, HOME, 40n * ONE, deadline);
      await n.points.redeem(member.address, HOME, 40n * ONE, deadline, sig);

      await n.points.connect(n.reviewerA).proposeReversal(ref("bad"), 40n * ONE, HOME, 40n * ONE, ethers.id("evidence"));
      await n.points.connect(n.reviewerB).approveReversal(0);
      expect(await n.housing.creditPortion(member.address, HOME)).to.equal(0n);
      expect(await n.points.earnedOf(member.address)).to.equal(0n);
    });
  });

  describe("the calendar", function () {
    it("reads months in UTC", async function () {
      expect(await n.points.monthOf(1767225600n)).to.equal(202601); // 2026-01-01
      expect(await n.points.monthOf(1767225599n)).to.equal(202512); // 2025-12-31 23:59:59
      expect(await n.points.monthOf(1709164800n)).to.equal(202402); // 2024-02-29
    });
  });

  describe("upgrades", function () {
    it("validates as an upgradeable implementation", async function () {
      const PointsIssuer = await ethers.getContractFactory("PointsIssuer");
      await upgrades.validateImplementation(PointsIssuer, { kind: "uups" });
    });
  });
});
