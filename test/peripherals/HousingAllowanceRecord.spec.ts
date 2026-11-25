import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployCreditsNetwork, signRedeem } from "../helpers/credits";

const ONE = 10n ** 6n;
const DAY = 24 * 60 * 60;
const RENT = ethers.encodeBytes32String("RENT");
const SAVING = ethers.encodeBytes32String("SAVING");
const ref = (s: string) => ethers.id(s);

/*
 * The Housing Allowance Record: a member's equity toward a Clear home, in a Credit Portion (credits
 * redeemed through the Points Issuer) and a Member Portion (their own money), read by the Deed
 * contracts at Redemption. It holds no money and nothing in it can be transferred.
 */
describe("HousingAllowanceRecord", function () {
  let n: Awaited<ReturnType<typeof deployCreditsNetwork>>;
  let record: any, usdc: any, writer: any, payee: any, deed: any, member: any, other: any;
  const HOME = 101n;
  const HOME2 = 202n;
  const PRICE = 300_000n * ONE;

  async function now() {
    return BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  }
  async function elapse(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  beforeEach(async function () {
    n = await deployCreditsNetwork();
    const s = await ethers.getSigners();
    [writer, payee, deed, member, other] = [s[12], s[13], s[14], s[15], s[16]];

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);

    const Record = await ethers.getContractFactory("HousingAllowanceRecord");
    record = await upgrades.deployProxy(Record, [n.admin.address, await usdc.getAddress(), await n.points.getAddress()], {
      kind: "uups",
    });
    await record.grantRole(await record.HOUSING_WRITER_ROLE(), writer.address);
    await record.setPayee(HOME, payee.address);
    await record.setDeedContract(deed.address);
    await n.points.setHousingRecord(await record.getAddress());
  });

  async function openHome(who = member, home = HOME, price = PRICE, carry = 0n, r = "open") {
    await record.connect(writer).open(who.address, home, price, carry, ref(r));
  }

  describe("opening", function () {
    it("opens a SIGNED record, marks the occupant and closes the member's Match Period", async function () {
      await n.points.connect(n.membersKey).openMatchPeriod(member.address, await now());
      await openHome();
      const r = await record.recordOf(member.address, HOME);
      expect(r.status).to.equal(1n);
      expect(r.structurePrice).to.equal(PRICE);
      expect(await record.occupantOf(HOME)).to.equal(member.address);
      await expect(n.points.connect(n.minter).mint(member.address, ONE, SAVING, ref("s")))
        .to.be.revertedWithCustomError(n.points, "PointsIssuerOutsideMatchPeriod");
    });

    it("is the writer's alone, once per home and ref", async function () {
      await expect(record.connect(other).open(member.address, HOME, PRICE, 0, ref("x"))).to.be.reverted;
      await openHome();
      await expect(record.connect(writer).open(other.address, HOME, PRICE, 0, ref("y")))
        .to.be.revertedWithCustomError(record, "HousingHomeOccupied");
      await expect(record.connect(writer).open(other.address, HOME2, PRICE, 0, ref("open")))
        .to.be.revertedWithCustomError(record, "HousingRefUsed");
    });
  });

  describe("the Credit Portion", function () {
    it("takes redeemed credits through the Points Issuer only, and never before an ELPA", async function () {
      await n.points.connect(n.minter).mint(member.address, 500n * ONE, RENT, ref("r"));
      const deadline = (await now()) + 3600n;
      let sig = await signRedeem(n.points, member, HOME, 100n * ONE, deadline);
      await expect(n.points.redeem(member.address, HOME, 100n * ONE, deadline, sig))
        .to.be.revertedWithCustomError(record, "HousingNotSigned");

      await openHome();
      sig = await signRedeem(n.points, member, HOME, 100n * ONE, deadline);
      await n.points.redeem(member.address, HOME, 100n * ONE, deadline, sig);
      expect((await record.recordOf(member.address, HOME)).creditPortion).to.equal(100n * ONE);
      expect(await record.lifetimeCreditPortion(member.address)).to.equal(100n * ONE);

      await expect(record.connect(writer).creditFromCredits(member.address, HOME, ONE))
        .to.be.revertedWithCustomError(record, "HousingNotPoints");
    });

    it("holds a member to the lifetime cap, counting lapsed amounts", async function () {
      await record.setCreditCap(150n * ONE);
      await n.points.connect(n.minter).mint(member.address, 500n * ONE, RENT, ref("r"));
      await openHome();
      const deadline = (await now()) + 3600n;
      let sig = await signRedeem(n.points, member, HOME, 100n * ONE, deadline);
      await n.points.redeem(member.address, HOME, 100n * ONE, deadline, sig);

      await record.connect(writer).end(member.address, HOME, 0, ref("end"));
      await elapse(731 * DAY);
      await record.lapse(member.address, HOME);

      await record.setPayee(HOME2, payee.address);
      await openHome(member, HOME2, PRICE, 0n, "open2");
      sig = await signRedeem(n.points, member, HOME2, 60n * ONE, (await now()) + 3600n);
      await expect(n.points.redeem(member.address, HOME2, 60n * ONE, (await now()) + 3600n, sig)).to.be.reverted;
    });
  });

  describe("the Member Portion", function () {
    beforeEach(async function () {
      await openHome();
      await usdc.mint(member.address, 10_000n * ONE);
    });

    it("pulls USDC straight from the member to the payee, and holds none", async function () {
      await usdc.connect(member).approve(await record.getAddress(), 2_000n * ONE);
      await record.connect(member).contribute(HOME, 2_000n * ONE);
      expect(await usdc.balanceOf(payee.address)).to.equal(2_000n * ONE);
      expect(await usdc.balanceOf(await record.getAddress())).to.equal(0n);
      expect((await record.recordOf(member.address, HOME)).memberPortion).to.equal(2_000n * ONE);
    });

    it("refuses another account paying into someone else's record, and a home with no payee", async function () {
      await usdc.mint(other.address, ONE);
      await usdc.connect(other).approve(await record.getAddress(), ONE);
      await expect(record.connect(other).contribute(HOME, ONE)).to.be.revertedWithCustomError(record, "HousingNotSigned");
      await record.setPayee(HOME, ethers.ZeroAddress);
      await usdc.connect(member).approve(await record.getAddress(), ONE);
      await expect(record.connect(member).contribute(HOME, ONE)).to.be.revertedWithCustomError(record, "HousingNoPayee");
    });

    it("records fiat payments once per ref, by the writer only", async function () {
      await record.connect(writer).recordPayment(member.address, HOME, 1_000n * ONE, ref("ach1"));
      await expect(record.connect(writer).recordPayment(member.address, HOME, ONE, ref("ach1")))
        .to.be.revertedWithCustomError(record, "HousingRefUsed");
      await expect(record.connect(other).recordPayment(member.address, HOME, ONE, ref("ach2"))).to.be.reverted;
      expect(await record.totalOf(member.address, HOME)).to.equal(1_000n * ONE);
    });

    it("refuses ETH", async function () {
      await expect(member.sendTransaction({ to: await record.getAddress(), value: 1n })).to.be.reverted;
    });
  });

  describe("Redemption", function () {
    it("is readable when the total reaches the price, and marked only by the Deed contract", async function () {
      await openHome(member, HOME, 1_000n * ONE);
      expect(await record.isRedeemable(HOME)).to.equal(false);
      await record.connect(writer).recordPayment(member.address, HOME, 1_200n * ONE, ref("ach"));
      expect(await record.isRedeemable(HOME)).to.equal(true);

      await expect(record.connect(other).markRedeemed(HOME)).to.be.revertedWithCustomError(record, "HousingNotDeed");
      await record.connect(deed).markRedeemed(HOME);
      const r = await record.recordOf(member.address, HOME);
      expect(r.status).to.equal(2n);
      expect(r.refundDue).to.equal(200n * ONE);
      expect(await record.isRedeemable(HOME)).to.equal(false);
    });

    it("never raises a price", async function () {
      await openHome();
      await expect(record.connect(writer).lowerPrice(member.address, HOME, PRICE + 1n, ethers.ZeroHash))
        .to.be.revertedWithCustomError(record, "HousingPriceRaise");
      await record.connect(writer).lowerPrice(member.address, HOME, PRICE - 1n, ethers.id("5.5"));
    });
  });

  describe("moves and exits", function () {
    it("moves the whole balance, and redeems a cheaper home's excess as a refund, credit counted first", async function () {
      await n.points.connect(n.minter).mint(member.address, 500n * ONE, RENT, ref("r"));
      await openHome(member, HOME, 1_000n * ONE);
      const deadline = (await now()) + 3600n;
      const sig = await signRedeem(n.points, member, HOME, 300n * ONE, deadline);
      await n.points.redeem(member.address, HOME, 300n * ONE, deadline, sig);
      await record.connect(writer).recordPayment(member.address, HOME, 600n * ONE, ref("ach"));

      await record.connect(writer).move(member.address, HOME, HOME2, 700n * ONE, 50n * ONE, 0, ref("mv"));
      const to = await record.recordOf(member.address, HOME2);
      expect(to.creditPortion).to.equal(300n * ONE);
      expect(to.memberPortion).to.equal(400n * ONE);
      expect(to.refundDue).to.equal(150n * ONE);
      expect((await record.recordOf(member.address, HOME)).status).to.equal(3n);
      expect(await record.isRedeemable(HOME2)).to.equal(true);
    });

    it("ends with the Member Portion due, holds the Credit Portion 24 months, then lets anyone lapse it", async function () {
      await n.points.connect(n.minter).mint(member.address, 100n * ONE, RENT, ref("r"));
      await openHome();
      const deadline = (await now()) + 3600n;
      const sig = await signRedeem(n.points, member, HOME, 100n * ONE, deadline);
      await n.points.redeem(member.address, HOME, 100n * ONE, deadline, sig);
      await record.connect(writer).recordPayment(member.address, HOME, 5_000n * ONE, ref("ach"));

      await expect(record.connect(writer).end(member.address, HOME, 6_000n * ONE, ref("e0")))
        .to.be.revertedWithCustomError(record, "HousingDeductionsTooLarge");
      await record.connect(writer).end(member.address, HOME, 800n * ONE, ref("end"));
      let r = await record.recordOf(member.address, HOME);
      expect(r.refundDue).to.equal(4_200n * ONE);
      expect(r.creditPortion).to.equal(100n * ONE);

      await expect(record.lapse(member.address, HOME)).to.be.revertedWithCustomError(record, "HousingHoldNotOver");
      await elapse(731 * DAY);
      await record.connect(other).lapse(member.address, HOME);
      r = await record.recordOf(member.address, HOME);
      expect(r.creditPortion).to.equal(0n);
      expect(r.status).to.equal(5n);
    });

    it("carries a held Credit Portion into a new home signed within 24 months", async function () {
      await n.points.connect(n.minter).mint(member.address, 100n * ONE, RENT, ref("r"));
      await openHome();
      const deadline = (await now()) + 3600n;
      const sig = await signRedeem(n.points, member, HOME, 100n * ONE, deadline);
      await n.points.redeem(member.address, HOME, 100n * ONE, deadline, sig);
      await record.connect(writer).end(member.address, HOME, 0, ref("end"));

      await elapse(100 * DAY);
      await openHome(member, HOME2, PRICE, HOME, "open2");
      expect((await record.recordOf(member.address, HOME2)).creditPortion).to.equal(100n * ONE);
      expect((await record.recordOf(member.address, HOME)).creditPortion).to.equal(0n);
    });
  });

  describe("upgrades", function () {
    it("validates as an upgradeable implementation", async function () {
      const Record = await ethers.getContractFactory("HousingAllowanceRecord");
      await upgrades.validateImplementation(Record, { kind: "uups" });
    });
  });
});
