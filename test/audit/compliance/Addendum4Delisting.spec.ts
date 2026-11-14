import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { anyUint } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { deployPhase0Network } from "../../helpers/phase0-fixture";
import { ONE_USDC, DAY } from "./rates";

/*
 * Phase 2g, the de-listing and Legacy Contact half: Addendum 4 (`docs/audit/specs/addendum-4.md`)
 * as the owner decided it (`addendum-4-decisions.md`, items 1 to 15).
 *
 *  - 10c: the 30-day renewal cap on CLRUSD's account and security pauses and the vault pause
 *    (decision 2), and the pause clocks the credit side reads (decisions 3 and 4). Test 49.
 *  - 10d: CLRUSD's own listing, cleared only by a two-person `delist` with a reason code
 *    (decisions 7 and 8). Test 52.
 *  - 10f: the Legacy Contact module (decisions 10 to 13), on a mock of Kernel v3.3's executor path.
 *    Tests 53 and 54.
 */
const HOUR = 3600;
const WINDOW = 72 * HOUR;
const MEMBERSHIP_ENDED = 1, HOLDER_REQUEST = 2, FRAUD = 3;
const COURT_ORDER = 1;

async function advance(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}
async function now(): Promise<number> {
  return (await ethers.provider.getBlock("latest"))!.timestamp;
}
async function setNext(ts: number) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
}
async function snapshot(): Promise<string> {
  return ethers.provider.send("evm_snapshot", []);
}
async function revertTo(id: string) {
  await ethers.provider.send("evm_revert", [id]);
}
async function stamp(tx: any): Promise<number> {
  const r = await (await tx).wait();
  return (await ethers.provider.getBlock(r!.blockNumber))!.timestamp;
}

async function deployStack() {
  const ctx = await deployPhase0Network();
  const s = await ethers.getSigners();
  const [keyA, keyB, keyC, relayer, stranger, contact, contact2, newKey, other] = s.slice(8, 17);

  const ClearUSD = await ethers.getContractFactory("ClearUSDUpgradeable");
  const clrusd: any = await upgrades.deployProxy(ClearUSD,
    ["Clear USD", "CLRUSD", 6, 0, 0, ctx.admin.address, ctx.admin.address],
    { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
  const Vault = await ethers.getContractFactory("ESADepositVault");
  const vault: any = await upgrades.deployProxy(Vault, [await clrusd.getAddress(), ctx.admin.address], { kind: "uups" });
  await clrusd.grantRole(await clrusd.MINTER_ROLE(), await vault.getAddress());
  await clrusd.grantRole(await clrusd.BURNER_ROLE(), await vault.getAddress());
  await vault.setAcceptedToken(await ctx.usdc.getAddress(), true);
  await vault.grantRole(await vault.RELAYER_ROLE(), relayer.address);
  for (const k of [keyA, keyB, keyC]) {
    await vault.grantRole(await vault.PAUSER_ROLE(), k.address);
    await clrusd.grantRole(await clrusd.FRAUD_ROLE(), k.address);
    await clrusd.grantRole(await clrusd.SECURITY_ROLE(), k.address);
    await clrusd.grantRole(await clrusd.LISTING_ROLE(), k.address);
  }
  const signals: any = await (await ethers.getContractFactory("MockCollateralSignals")).deploy();
  await clrusd.setEncumbranceSource(await signals.getAddress());
  return { ctx, clrusd, vault, signals, keyA, keyB, keyC, relayer, stranger, contact, contact2, newKey, other };
}
type Stack = Awaited<ReturnType<typeof deployStack>>;

async function deposit(s: Stack, who: any, amount: bigint, receiver = who.address) {
  await s.ctx.usdc.mint(who.address, amount);
  await s.ctx.usdc.connect(who).approve(await s.vault.getAddress(), amount);
  return s.vault.connect(who).deposit(await s.ctx.usdc.getAddress(), amount, receiver);
}

/** Two distinct holders make the same call; the second carries it out. Returns the second call. */
async function twoPerson(contract: any, first: any, second: any, fn: string, args: any[]) {
  await contract.connect(first)[fn](...args);
  return contract.connect(second)[fn](...args);
}

describe("COMPLIANCE Phase 2g: pause cap and clocks, CLRUSD de-listing, Legacy Contact", function () {
  let s: Stack;
  beforeEach(async function () {
    s = await deployStack();
  });

  /* ───────────────────────────── 10c: the renewal cap (test 49) ───────────────────────────── */

  describe("test 49: the 30-day renewal cap", function () {
    /** Renews every 72 hours less a minute, rotating the three keys so the approver is never the
     *  last signer. Returns the renewals that went through and the error of the first that did not. */
    async function renewUntilRefused(renew: (first: any, second: any) => Promise<any>) {
      const { keyA, keyB, keyC } = s;
      const pairs = [[keyA, keyC], [keyB, keyA], [keyC, keyB]];
      let done = 0;
      for (let i = 0; i < 20; i++) {
        await advance(WINDOW - 60);
        const [first, second] = pairs[i % 3];
        try {
          await renew(first, second);
          done++;
        } catch (e: any) {
          return { done, error: e };
        }
      }
      return { done, error: null };
    }

    it("CLRUSD account pause: renewals past t0 + 30 days revert without a legal basis, and succeed with one under two-person approval", async function () {
      const { ctx, clrusd, keyA, keyB, keyC } = s;
      const m = ctx.member.address;
      await deposit(s, ctx.member, 100n * ONE_USDC);
      await clrusd.connect(keyA).pauseAccount(m, 7);
      const t0 = await stamp(clrusd.connect(keyB).pauseAccount(m, 7));
      const capEnd = t0 + 30 * DAY;

      const { done, error } = await renewUntilRefused((a, b) => twoPerson(clrusd, a, b, "renewAccountPause", [m, 7]));
      // Nine renewals reach day 30 at most; the tenth would carry the pause past it.
      expect(done).to.equal(9);
      expect(error.message).to.contain("ClearUSDPauseCapReached");
      const until = Number(await clrusd.pausedUntil(m));
      expect(until).to.be.at.most(capEnd);
      const snap = await snapshot();

      // With a legal basis, two-person, it goes through and is logged.
      await expect(clrusd.connect(keyA).renewAccountPauseWithLegalBasis(m, 8, 0, ethers.id("order")))
        .to.be.revertedWithCustomError(clrusd, "ClearUSDInvalidLegalBasis");
      await expect(clrusd.connect(keyA).renewAccountPauseWithLegalBasis(m, 8, 4, ethers.id("order")))
        .to.be.revertedWithCustomError(clrusd, "ClearUSDInvalidLegalBasis");
      await expect(clrusd.connect(keyA).renewAccountPauseWithLegalBasis(m, 8, COURT_ORDER, ethers.ZeroHash))
        .to.be.revertedWithCustomError(clrusd, "ClearUSDInvalidLegalBasis");
      await expect(clrusd.connect(keyA).renewAccountPauseWithLegalBasis(m, 8, COURT_ORDER, ethers.id("order")))
        .to.emit(clrusd, "ActionProposed");
      // The same signer cannot approve its own proposal.
      await expect(clrusd.connect(keyA).renewAccountPauseWithLegalBasis(m, 8, COURT_ORDER, ethers.id("order")))
        .to.be.revertedWithCustomError(clrusd, "ClearUSDSameSigner");
      // keyB approved the ninth renewal, so keyC approves (neither the proposer nor the last signer).
      await expect(clrusd.connect(keyC).renewAccountPauseWithLegalBasis(m, 8, COURT_ORDER, ethers.id("order")))
        .to.emit(clrusd, "PauseLegalBasisRecorded").withArgs(m, COURT_ORDER, ethers.id("order"), anyUint, keyA.address, keyC.address);
      const legalUntil = Number(await clrusd.pausedUntil(m));
      expect(legalUntil).to.be.greaterThan(capEnd);
      await setNext(capEnd + 60);
      await expect(clrusd.connect(ctx.member).transfer(ctx.counterparty.address, 1n)).to.be.revertedWithCustomError(clrusd, "ClearUSDPaused");
      // Past day 30, a plain renewal still reverts: each further renewal needs its own legal basis.
      await clrusd.connect(keyA).renewAccountPause(m, 9);
      await expect(clrusd.connect(keyB).renewAccountPause(m, 9)).to.be.revertedWithCustomError(clrusd, "ClearUSDPauseCapReached");

      // With no valid renewal, the pause lifts on expiry.
      await revertTo(snap);
      await setNext(until);
      await clrusd.connect(ctx.member).transfer(ctx.counterparty.address, 1n);
      expect(await clrusd.isPauseInForce(m)).to.equal(false);
    });

    it("CLRUSD security pause: the same cap and legal-basis renewal", async function () {
      const { ctx, clrusd, keyA, keyB, keyC } = s;
      await deposit(s, ctx.member, 100n * ONE_USDC);
      await clrusd.connect(keyA).pauseForSecurity(1);
      const t0 = await stamp(clrusd.connect(keyB).pauseForSecurity(1));
      const { done, error } = await renewUntilRefused((a, b) => twoPerson(clrusd, a, b, "renewSecurityPause", [1]));
      expect(done).to.equal(9);
      expect(error.message).to.contain("ClearUSDPauseCapReached");
      const approver = keyA; // keyB approved the ninth renewal
      await clrusd.connect(keyC).renewSecurityPauseWithLegalBasis(2, 3, ethers.id("regulator"));
      await expect(clrusd.connect(approver).renewSecurityPauseWithLegalBasis(2, 3, ethers.id("regulator")))
        .to.emit(clrusd, "PauseLegalBasisRecorded").withArgs(ethers.ZeroAddress, 3, ethers.id("regulator"), anyUint, keyC.address, approver.address);
      expect(Number(await clrusd.pausedUntil(ctx.member.address))).to.be.greaterThan(t0 + 30 * DAY);
    });

    it("ESADepositVault pause: the same cap and legal-basis renewal, and it lifts on expiry", async function () {
      const { ctx, vault, keyA, keyB, keyC } = s;
      await deposit(s, ctx.member, 100n * ONE_USDC);
      await vault.connect(keyA).pause();
      const t0 = await stamp(vault.connect(keyB).pause());
      const { done, error } = await renewUntilRefused((a, b) => twoPerson(vault, a, b, "renewPause", []));
      expect(done).to.equal(9);
      expect(error.message).to.contain("ESADepositVaultPauseCapReached");
      const snap = await snapshot();

      await expect(vault.connect(keyC).renewPauseWithLegalBasis(0, ethers.id("order"))).to.be.revertedWithCustomError(vault, "ESADepositVaultInvalidLegalBasis");
      await expect(vault.connect(keyC).renewPauseWithLegalBasis(COURT_ORDER, ethers.ZeroHash)).to.be.revertedWithCustomError(vault, "ESADepositVaultInvalidLegalBasis");
      await vault.connect(keyC).renewPauseWithLegalBasis(COURT_ORDER, ethers.id("order"));
      await expect(vault.connect(keyA).renewPauseWithLegalBasis(COURT_ORDER, ethers.id("order")))
        .to.emit(vault, "PauseLegalBasisRecorded").withArgs(COURT_ORDER, ethers.id("order"), anyUint, keyC.address, keyA.address);
      await setNext(t0 + 30 * DAY + 60);
      await ethers.provider.send("evm_mine", []);
      expect(await vault.paused()).to.equal(true);
      expect(await vault.isPauseInForce()).to.equal(true);

      // Without one, the pause lifts at its last end, no later than day 30.
      await revertTo(snap);
      await setNext(t0 + 30 * DAY);
      await ethers.provider.send("evm_mine", []);
      expect(await vault.paused()).to.equal(false);
      await clrusdRedeem(s, ctx.member, ONE_USDC);
    });

    it("pauseMaxTotal: above 30 days reverts on both contracts, only the timelock admin may shorten it, and a shorter cap binds", async function () {
      const { ctx, clrusd, vault, keyA, keyB, keyC } = s;
      expect(await clrusd.pauseMaxTotal()).to.equal(30 * DAY);
      expect(await vault.pauseMaxTotal()).to.equal(30 * DAY);
      await expect(clrusd.setPauseMaxTotal(30 * DAY + 1)).to.be.revertedWithCustomError(clrusd, "ClearUSDPauseMaxTotalTooLong");
      await expect(vault.setPauseMaxTotal(30 * DAY + 1)).to.be.revertedWithCustomError(vault, "ESADepositVaultPauseMaxTotalTooLong");
      for (const k of [keyA, keyB, keyC]) {
        await expect(clrusd.connect(k).setPauseMaxTotal(DAY)).to.be.reverted;
        await expect(vault.connect(k).setPauseMaxTotal(DAY)).to.be.reverted;
      }
      await expect(clrusd.setPauseMaxTotal(4 * DAY)).to.emit(clrusd, "PauseMaxTotalUpdated").withArgs(4 * DAY);
      await vault.setPauseMaxTotal(4 * DAY);
      await clrusd.connect(keyA).pauseAccount(ctx.member.address, 1);
      await clrusd.connect(keyB).pauseAccount(ctx.member.address, 1);
      await advance(WINDOW - 60);
      await clrusd.connect(keyA).renewAccountPause(ctx.member.address, 1);
      await expect(clrusd.connect(keyC).renewAccountPause(ctx.member.address, 1)).to.be.revertedWithCustomError(clrusd, "ClearUSDPauseCapReached");
      await vault.connect(keyA).pause();
      await vault.connect(keyB).pause();
      await advance(WINDOW - 60);
      await vault.connect(keyA).renewPause();
      await expect(vault.connect(keyC).renewPause()).to.be.revertedWithCustomError(vault, "ESADepositVaultPauseCapReached");
      // Zero restores the hard-coded maximum.
      await clrusd.setPauseMaxTotal(0);
      expect(await clrusd.pauseMaxTotal()).to.equal(30 * DAY);
    });
  });

  /* ─────────────────────────── 10c: the pause clocks (decisions 3, 4) ─────────────────────────── */

  describe("pause clocks", function () {
    it("CLRUSD counts the union of the security pause and an account's own pause once, never decreases, and reads the history", async function () {
      const { ctx, clrusd, keyA, keyB, keyC } = s;
      const m = ctx.member.address, c = ctx.counterparty.address;
      expect(await clrusd.pauseClock(m)).to.equal(0n);
      expect(await clrusd.isPauseInForce(m)).to.equal(false);
      const readings: bigint[] = [];
      const read = async () => { const v = await clrusd.pauseClock(m); readings.push(v); return v; };

      // A security pause, and an account pause starting 24 hours into it: overlapping.
      await clrusd.connect(keyA).pauseForSecurity(1);
      const s1 = await stamp(clrusd.connect(keyB).pauseForSecurity(1));
      expect(await clrusd.isPauseInForce(c)).to.equal(true);
      await advance(24 * HOUR);
      await read();
      await clrusd.connect(keyA).pauseAccount(m, 2);
      const a1 = await stamp(clrusd.connect(keyB).pauseAccount(m, 2));
      expect(await clrusd.isPauseInForce(m)).to.equal(true);
      await advance(10 * HOUR);
      const mid = await now();
      expect(await read()).to.equal(BigInt(mid - s1));
      await advance(200 * HOUR);
      const union = Math.max(s1 + WINDOW, a1 + WINDOW) - s1;
      expect(await read()).to.equal(BigInt(union));
      expect(await clrusd.pauseClock(c)).to.equal(BigInt(WINDOW));
      expect(await clrusd.pauseClock(ethers.ZeroAddress)).to.equal(BigInt(WINDOW));
      expect(await clrusd.isPauseInForce(m)).to.equal(false);

      // An account pause on its own, ended early by two signers after 5 hours.
      await clrusd.connect(keyA).pauseAccount(m, 3);
      const a2 = await stamp(clrusd.connect(keyC).pauseAccount(m, 3));
      await advance(5 * HOUR);
      await clrusd.connect(keyA).unpauseAccount(m);
      const e2 = await stamp(clrusd.connect(keyB).unpauseAccount(m));
      await advance(HOUR);
      expect(await read()).to.equal(BigInt(union + (e2 - a2)));

      // A security pause after that account span lapsed, then a new account pause: closing the old
      // span reads the security history at its end, which lies before the latest security pause.
      await advance(31 * DAY);
      await clrusd.connect(keyC).pauseForSecurity(4);
      const s2 = await stamp(clrusd.connect(keyA).pauseForSecurity(4));
      await advance(WINDOW + 1);
      await clrusd.connect(keyB).pauseAccount(m, 5);
      const a3 = await stamp(clrusd.connect(keyA).pauseAccount(m, 5));
      await advance(WINDOW + 1);
      const expected = union + (e2 - a2) + (s2 + WINDOW - s2) + WINDOW;
      expect(await read()).to.equal(BigInt(expected));
      expect(await clrusd.pauseClock(c)).to.equal(BigInt(2 * WINDOW));
      expect(a3).to.be.greaterThan(s2);
      for (let i = 1; i < readings.length; i++) expect(readings[i] >= readings[i - 1]).to.equal(true);
    });

    it("the vault keeps its own clock of the vault-wide pause", async function () {
      const { vault, keyA, keyB, keyC } = s;
      expect(await vault.pauseClock()).to.equal(0n);
      await vault.connect(keyA).pause();
      const p1 = await stamp(vault.connect(keyB).pause());
      expect(await vault.isPauseInForce()).to.equal(true);
      await advance(HOUR);
      expect(await vault.pauseClock()).to.equal(BigInt((await now()) - p1));
      await advance(WINDOW);
      expect(await vault.pauseClock()).to.equal(BigInt(WINDOW));
      expect(await vault.isPauseInForce()).to.equal(false);
      // A second pause, ended early.
      await vault.connect(keyC).pause();
      const p2 = await stamp(vault.connect(keyA).pause());
      await advance(2 * HOUR);
      await vault.connect(keyA).unpause();
      const e2 = await stamp(vault.connect(keyB).unpause());
      await advance(DAY);
      expect(await vault.pauseClock()).to.equal(BigInt(WINDOW + (e2 - p2)));
      // And a third, after both lapsed.
      await advance(31 * DAY);
      await vault.connect(keyA).pause();
      const p3 = await stamp(vault.connect(keyC).pause());
      await advance(3 * HOUR);
      expect(await vault.pauseClock()).to.equal(BigInt(WINDOW + (e2 - p2) + ((await now()) - p3)));
    });
  });

  /* ─────────────────────────────── 10d: de-listing (test 52) ─────────────────────────────── */

  describe("test 52: de-listing", function () {
    async function listed() {
      const { ctx, clrusd } = s;
      for (const w of [ctx.member, ctx.counterparty]) {
        if (!(await ctx.access.isMember(w.address))) await ctx.access.connect(ctx.operator).grantMember(w.address);
      }
      await clrusd.setMembershipSource(await ctx.access.getAddress());
      await deposit(s, ctx.member, 1_000n * ONE_USDC); // the mint records the member's listing
      await expect(clrusd.syncListing(ctx.counterparty.address)).to.emit(clrusd, "WalletListed").withArgs(ctx.counterparty.address);
      expect((await clrusd.listingOf(ctx.member.address)).status).to.equal(1n);
    }

    it("a transfer to a de-listed address reverts; the de-listed holder still sends to a listed member and redeems", async function () {
      const { ctx, clrusd, vault, keyA, keyB } = s;
      await listed();
      await clrusd.connect(keyA).delist(ctx.member.address, HOLDER_REQUEST, ethers.id("d1"));
      await expect(clrusd.connect(keyB).delist(ctx.member.address, HOLDER_REQUEST, ethers.id("d1")))
        .to.emit(clrusd, "WalletDelisted").withArgs(ctx.member.address, HOLDER_REQUEST, ethers.id("d1"), keyA.address, keyB.address);
      await expect(clrusd.connect(ctx.counterparty).transfer(ctx.member.address, 0n))
        .to.be.revertedWithCustomError(clrusd, "ClearUSDReceiverNotMember").withArgs(ctx.member.address);
      expect(await clrusd.mayReceive(ctx.member.address)).to.equal(false);
      // Sending to a listed member.
      await clrusd.connect(ctx.member).transfer(ctx.counterparty.address, 100n * ONE_USDC);
      // Redemption under Conversion/Exit (the vault is not paused, the balance is free).
      await clrusd.connect(ctx.member).approve(await vault.getAddress(), 100n * ONE_USDC);
      await vault.connect(ctx.member).redeem(await ctx.usdc.getAddress(), 100n * ONE_USDC, ctx.member.address);
      expect(await clrusd.balanceOf(ctx.member.address)).to.equal(800n * ONE_USDC);
      // Mints stay exempt (Phase 2d decision 6), so even a de-listed wallet's deposit is credited.
      await deposit(s, ctx.member, ONE_USDC);
    });

    it("a same-signer removal, a removal without a valid reason code or decision hash, and a removal by any other role revert; every removal emits its event", async function () {
      const { ctx, clrusd, keyA, keyB, keyC, stranger } = s;
      await listed();
      const m = ctx.member.address;
      await clrusd.connect(keyA).delist(m, MEMBERSHIP_ENDED, ethers.id("d"));
      await expect(clrusd.connect(keyA).delist(m, MEMBERSHIP_ENDED, ethers.id("d"))).to.be.revertedWithCustomError(clrusd, "ClearUSDSameSigner");
      for (const bad of [0, 4, 255]) {
        await expect(clrusd.connect(keyB).delist(m, bad, ethers.id("d"))).to.be.revertedWithCustomError(clrusd, "ClearUSDInvalidReasonCode").withArgs(bad);
      }
      await expect(clrusd.connect(keyB).delist(m, MEMBERSHIP_ENDED, ethers.ZeroHash)).to.be.revertedWithCustomError(clrusd, "ClearUSDInvalidListingAction");
      // Other roles, the admin included, cannot de-list.
      const fraudOnly = stranger;
      await clrusd.grantRole(await clrusd.FRAUD_ROLE(), fraudOnly.address);
      for (const k of [ctx.admin, fraudOnly, ctx.operator]) {
        await expect(clrusd.connect(k).delist(m, MEMBERSHIP_ENDED, ethers.id("d"))).to.be.reverted;
      }
      expect(await clrusd.mayReceive(m)).to.equal(true);
      // Each reason code removes, with its event.
      await expect(clrusd.connect(keyC).delist(m, MEMBERSHIP_ENDED, ethers.id("d")))
        .to.emit(clrusd, "WalletDelisted").withArgs(m, MEMBERSHIP_ENDED, ethers.id("d"), keyA.address, keyC.address);
      const c = ctx.counterparty.address;
      await clrusd.connect(keyA).delist(c, HOLDER_REQUEST, ethers.id("h"));
      await expect(clrusd.connect(keyB).delist(c, HOLDER_REQUEST, ethers.id("h"))).to.emit(clrusd, "WalletDelisted");
      expect((await clrusd.listingOf(c)).reasonCode).to.equal(BigInt(HOLDER_REQUEST));
      await expect(clrusd.connect(keyA).delist(c, HOLDER_REQUEST, ethers.id("h"))).to.be.revertedWithCustomError(clrusd, "ClearUSDAlreadyDelisted");
    });

    it("FRAUD needs a notice recorded on chain at least 10 days before the removal is approved", async function () {
      const { ctx, clrusd, keyA, keyB, stranger } = s;
      await listed();
      const m = ctx.member.address;
      await expect(clrusd.connect(keyA).delist(m, FRAUD, ethers.id("f"))).to.be.revertedWithCustomError(clrusd, "ClearUSDFraudNoticeRequired").withArgs(m, 0);
      await expect(clrusd.connect(stranger).recordFraudNotice(m, ethers.id("notice"))).to.be.reverted;
      await expect(clrusd.connect(keyA).recordFraudNotice(m, ethers.ZeroHash)).to.be.revertedWithCustomError(clrusd, "ClearUSDInvalidListingAction");
      const noticeAt = await stamp(clrusd.connect(keyA).recordFraudNotice(m, ethers.id("notice")));
      // The notice changes nothing by itself.
      await clrusd.connect(ctx.counterparty).transfer(m, 0n);
      await clrusd.connect(keyA).delist(m, FRAUD, ethers.id("f"));
      await setNext(noticeAt + 10 * DAY - 1);
      await expect(clrusd.connect(keyB).delist(m, FRAUD, ethers.id("f")))
        .to.be.revertedWithCustomError(clrusd, "ClearUSDFraudNoticeRequired").withArgs(m, noticeAt);
      await setNext(noticeAt + 10 * DAY);
      await expect(clrusd.connect(keyB).delist(m, FRAUD, ethers.id("f")))
        .to.emit(clrusd, "WalletDelisted").withArgs(m, FRAUD, ethers.id("f"), keyA.address, keyB.address);
      const l = await clrusd.listingOf(m);
      expect([l.status, l.reasonCode, l.fraudNoticeAt]).to.deep.equal([2n, BigInt(FRAUD), 0n]);
    });

    it("expiry, tier and status changes, revokeMember and unlinkWallet no longer affect receipt; an unrecorded wallet falls back to the registry", async function () {
      const { ctx, clrusd, stranger, other } = s;
      await listed();
      // AccessManager's revokeMember.
      await ctx.access.connect(ctx.operator).revokeMember(ctx.counterparty.address);
      await clrusd.connect(ctx.member).transfer(ctx.counterparty.address, ONE_USDC);
      // MembershipRegistry: a yearly member and a linked wallet, listed at registration and linking.
      const MR = await ethers.getContractFactory("MembershipRegistry");
      const mr: any = await upgrades.deployProxy(MR, [ctx.admin.address]);
      await ctx.access.setMembershipRegistry(await mr.getAddress());
      const expires = (await now()) + 30 * DAY;
      await mr.registerMember(stranger.address, 2 /* YEARLY */, expires, ethers.ZeroHash);
      const id = await mr.walletToMemberId(stranger.address);
      await mr.linkWallet(id, other.address);
      await clrusd.syncListing(stranger.address);
      await clrusd.syncListing(other.address);
      await mr.setMemberStatus(id, 3 /* SUSPENDED */);
      await mr.setMemberStatus(id, 2 /* ACTIVE */);
      await mr.setMemberTier(id, 1 /* BASIC */, expires);
      await mr.unlinkWallet(id, other.address);
      await mr.setMemberStatus(id, 4 /* REVOKED */);
      await advance(31 * DAY); // expired
      expect(await ctx.access.isMember(stranger.address)).to.equal(false);
      expect(await ctx.access.isMember(other.address)).to.equal(false);
      await clrusd.connect(ctx.member).transfer(stranger.address, ONE_USDC);
      await clrusd.connect(ctx.member).transfer(other.address, ONE_USDC);
      // A wallet never recorded still follows the registry's live answer, and is recorded at its
      // first receipt.
      const fresh = ethers.Wallet.createRandom().address;
      await expect(clrusd.connect(ctx.member).transfer(fresh, 1n)).to.be.revertedWithCustomError(clrusd, "ClearUSDReceiverNotMember");
      await ctx.access.connect(ctx.operator).grantMember(fresh);
      await expect(clrusd.connect(ctx.member).transfer(fresh, 1n)).to.emit(clrusd, "WalletListed").withArgs(fresh);
      await ctx.access.connect(ctx.operator).revokeMember(fresh);
      await clrusd.connect(ctx.member).transfer(fresh, 1n);
      // syncListing records nothing for a non-member.
      const nobody = ethers.Wallet.createRandom().address;
      await clrusd.syncListing(nobody);
      expect((await clrusd.listingOf(nobody)).status).to.equal(0n);
    });

    it("re-listing is two-person, only for a current member, and never happens through the registry, syncListing or receipt", async function () {
      const { ctx, clrusd, keyA, keyB, keyC } = s;
      await listed();
      const m = ctx.member.address;
      await twoPerson(clrusd, keyA, keyB, "delist", [m, MEMBERSHIP_ENDED, ethers.id("ended")]);
      // Still a member in the registry: syncListing and the registry do not bring it back.
      expect(await ctx.access.isMember(m)).to.equal(true);
      await clrusd.syncListing(m);
      expect(await clrusd.mayReceive(m)).to.equal(false);
      await expect(clrusd.connect(ctx.counterparty).transfer(m, 0n)).to.be.revertedWithCustomError(clrusd, "ClearUSDReceiverNotMember");
      // Only a two-person relist, of a wallet the registry reports as a member.
      await expect(clrusd.connect(keyA).relist(ctx.counterparty.address, ethers.id("r"))).to.be.revertedWithCustomError(clrusd, "ClearUSDNotDelisted");
      await expect(clrusd.connect(keyA).relist(m, ethers.ZeroHash)).to.be.revertedWithCustomError(clrusd, "ClearUSDInvalidListingAction");
      await ctx.access.connect(ctx.operator).revokeMember(m);
      await expect(clrusd.connect(keyA).relist(m, ethers.id("r"))).to.be.revertedWithCustomError(clrusd, "ClearUSDReceiverNotMember");
      await ctx.access.connect(ctx.operator).grantMember(m);
      await clrusd.connect(keyA).relist(m, ethers.id("r"));
      await expect(clrusd.connect(keyA).relist(m, ethers.id("r"))).to.be.revertedWithCustomError(clrusd, "ClearUSDSameSigner");
      await expect(clrusd.connect(ctx.admin).relist(m, ethers.id("r"))).to.be.reverted;
      await expect(clrusd.connect(keyC).relist(m, ethers.id("r")))
        .to.emit(clrusd, "WalletRelisted").withArgs(m, ethers.id("r"), keyA.address, keyC.address);
      await clrusd.connect(ctx.counterparty).transfer(m, 0n);
      // Swapping the registry stays the admin's (the vault timelock's).
      await expect(clrusd.connect(keyA).setMembershipSource(ethers.ZeroAddress)).to.be.reverted;
    });

    it("de-listing never affects a pledge lock or a liquidation", async function () {
      const { ctx, clrusd, signals, keyA, keyB, other } = s;
      await listed();
      const m = ctx.member.address;
      await signals.setLock(m, 600n * ONE_USDC);
      await twoPerson(clrusd, keyA, keyB, "delist", [m, MEMBERSHIP_ENDED, ethers.id("e")]);
      // The lock still holds: 400 free.
      await expect(clrusd.connect(ctx.member).transfer(ctx.counterparty.address, 401n * ONE_USDC)).to.be.revertedWithCustomError(clrusd, "ClearUSDEncumbered");
      await clrusd.connect(ctx.member).transfer(ctx.counterparty.address, 400n * ONE_USDC);
      // A liquidation still takes the encumbered collateral, to the Liquidator.
      await clrusd.grantRole(await clrusd.LIQUIDATOR_ROLE(), other.address);
      await clrusd.connect(other).seize(m, other.address, 600n * ONE_USDC);
      expect(await clrusd.balanceOf(m)).to.equal(0n);
    });

    it("keeps the savings-intent factory's depositor check working: it reads the listing", async function () {
      const { ctx, clrusd, vault, keyA, keyB } = s;
      await listed();
      const factory: any = await (await ethers.getContractFactory("SavingsIntentFactory")).deploy(ctx.admin.address);
      const t = await now();
      const config = (depositor: string, receiver: string) => ({
        depositor, receiver, transferToken: clrusd.target, vaultToken: ctx.usdc.target, vault: vault.target,
        amount: ONE_USDC, expiry: t + 7 * DAY, action: 1 });
      // A listed member whose registry membership has since been revoked may still be a depositor.
      await ctx.access.connect(ctx.operator).revokeMember(ctx.counterparty.address);
      await factory.announceIntent(ethers.id("a"), config(ctx.counterparty.address, ctx.member.address));
      // A de-listed one may not.
      await twoPerson(clrusd, keyA, keyB, "delist", [ctx.member.address, HOLDER_REQUEST, ethers.id("x")]);
      await expect(factory.announceIntent(ethers.id("b"), config(ctx.member.address, ctx.counterparty.address)))
        .to.be.revertedWithCustomError(factory, "SavingsIntentFactoryDepositorNotMember").withArgs(ctx.member.address);
    });
  });

  /* ─────────────────────────── 10f: Legacy Contact (tests 53, 54) ─────────────────────────── */

  describe("Legacy Contact module", function () {
    async function legacy() {
      const { ctx, clrusd, vault, keyA, keyB, keyC, relayer, contact, contact2 } = s;
      const ecdsa: any = await (await ethers.getContractFactory("MockKernelECDSAValidator")).deploy();
      const entrypoint = ethers.Wallet.createRandom().address;
      const account: any = await (await ethers.getContractFactory("MockKernelAccount"))
        .deploy(entrypoint, await ecdsa.getAddress(), ctx.member.address);
      // Every key that holds a Clear role here, fixed in the module at deployment.
      const clearKeys = [ctx.admin, ctx.operator, keyA, keyB, keyC, relayer];
      const module: any = await (await ethers.getContractFactory("LegacyContactModule"))
        .deploy(await ecdsa.getAddress(), clearKeys.map((k) => k.address));
      const installData = (contacts: string[], wait: number) => ethers.concat([
        ethers.ZeroAddress, // no hook
        ethers.AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"],
          [ethers.AbiCoder.defaultAbiCoder().encode(["address[]", "uint64"], [contacts, wait]), "0x"]),
      ]);
      /** A call from the account, signed by its owner (Kernel's root-key path). */
      const viaAccount = (signer: any, target: string, data: string) =>
        account.connect(signer).execute(ethers.ZeroHash, ethers.solidityPacked(["address", "uint256", "bytes"], [target, 0, data]));
      const install = (signer: any, contacts = [contact.address, contact2.address], wait = 0) =>
        account.connect(signer).installModule(2, module.target, installData(contacts, wait));
      void clrusd; void vault;
      return { ecdsa, account, module, clearKeys, installData, viaAccount, install };
    }

    it("test 53: only the member's signature installs, configures or uninstalls it; every Clear role reverts; the wait is at least 30 days, 90 by default; no Clear address can be a contact", async function () {
      const { ctx, contact, contact2, stranger } = s;
      const { account, module, clearKeys, viaAccount, install } = await legacy();
      // Install: only the account's owner (or the account itself) can.
      for (const k of [...clearKeys, contact, stranger]) {
        await expect(install(k)).to.be.revertedWithCustomError(account, "InvalidCaller");
      }
      // Under 30 days reverts; a Clear address as contact reverts.
      await expect(install(ctx.member, [contact.address], 29 * DAY)).to.be.revertedWithCustomError(module, "LegacyContactWaitTooShort");
      for (const k of clearKeys) {
        await expect(install(ctx.member, [contact.address, k.address])).to.be.revertedWithCustomError(module, "LegacyContactClearAddress").withArgs(k.address);
      }
      await expect(install(ctx.member, [])).to.be.revertedWithCustomError(module, "LegacyContactInvalidContacts");
      await expect(install(ctx.member, [contact.address, contact.address])).to.be.revertedWithCustomError(module, "LegacyContactInvalidContacts");
      await expect(install(ctx.member, [await account.getAddress()])).to.be.revertedWithCustomError(module, "LegacyContactInvalidContacts");
      // The default wait is 90 days.
      await expect(install(ctx.member)).to.emit(module, "LegacyContactConfigured");
      expect(await module.waitOf(account.target)).to.equal(90 * DAY);
      expect(await module.contactsOf(account.target)).to.deep.equal([contact.address, contact2.address]);
      expect(await account.isModuleInstalled(2, module.target, "0x")).to.equal(true);

      // Configure: only through the account. Anyone else calling the module acts on their own
      // (empty) record and reverts; nothing names another account's settings.
      for (const k of [...clearKeys, contact, stranger]) {
        await expect(module.connect(k).setWait(30 * DAY)).to.be.revertedWithCustomError(module, "LegacyContactNotInitialized");
        await expect(module.connect(k).setContacts([k.address])).to.be.revertedWithCustomError(module, "LegacyContactNotInitialized");
        await expect(module.connect(k).cancelRecovery()).to.be.revertedWithCustomError(module, "LegacyContactNoRequest");
        await expect(viaAccount(k, module.target as string, module.interface.encodeFunctionData("setWait", [30 * DAY])))
          .to.be.revertedWithCustomError(account, "InvalidCaller");
      }
      await expect(viaAccount(ctx.member, module.target as string, module.interface.encodeFunctionData("setWait", [29 * DAY])))
        .to.be.revertedWithCustomError(module, "LegacyContactWaitTooShort");
      await viaAccount(ctx.member, module.target as string, module.interface.encodeFunctionData("setWait", [30 * DAY]));
      expect(await module.waitOf(account.target)).to.equal(30 * DAY);
      await expect(viaAccount(ctx.member, module.target as string, module.interface.encodeFunctionData("setContacts", [[clearKeys[2].address]])))
        .to.be.revertedWithCustomError(module, "LegacyContactClearAddress");
      await viaAccount(ctx.member, module.target as string, module.interface.encodeFunctionData("setContacts", [[contact2.address]]));
      expect(await module.contactsOf(account.target)).to.deep.equal([contact2.address]);

      // Uninstall: only the member.
      for (const k of [...clearKeys, contact, contact2, stranger]) {
        await expect(account.connect(k).uninstallModule(2, module.target, "0x")).to.be.revertedWithCustomError(account, "InvalidCaller");
      }
      await account.connect(ctx.member).uninstallModule(2, module.target, "0x");
      expect(await module.isInitialized(account.target)).to.equal(false);
      expect(await module.contactsOf(account.target)).to.deep.equal([]);
      await expect(module.connect(contact2).requestRecovery(account.target, contact2.address)).to.be.revertedWithCustomError(module, "LegacyContactNotInitialized");
    });

    it("no Clear role can reach the module: it has no admin function, and every Clear key's call on it reverts or touches only that key's own record", async function () {
      const { ctx, contact, newKey } = s;
      const { account, module, clearKeys, install } = await legacy();
      const writes = module.interface.fragments
        .filter((f: any) => f.type === "function" && !["view", "pure"].includes(f.stateMutability))
        .map((f: any) => f.name).sort();
      expect(writes).to.deep.equal(["cancelRecovery", "onInstall", "onUninstall", "recover", "requestRecovery", "setContacts", "setWait"]);
      expect(module.interface.fragments.filter((f: any) => f.type === "fallback" || f.type === "receive")).to.deep.equal([]);
      await install(ctx.member);
      for (const k of clearKeys) {
        expect(await module.isClearAddress(k.address)).to.equal(true);
        await expect(module.connect(k).requestRecovery(account.target, k.address)).to.be.revertedWithCustomError(module, "LegacyContactNotContact");
        await expect(module.connect(k).recover(account.target)).to.be.revertedWithCustomError(module, "LegacyContactNoRequest");
        await expect(account.connect(k).executeFromExecutor(ethers.ZeroHash, "0x")).to.be.revertedWithCustomError(account, "InvalidExecutor");
        // A Clear key may set itself up as an "account" in the module; that is its own record only.
        await module.connect(k).onInstall(ethers.AbiCoder.defaultAbiCoder().encode(["address[]", "uint64"], [[contact.address], 0]));
        await module.connect(k).onUninstall("0x");
      }
      expect(await module.contactsOf(account.target)).to.deep.equal([contact.address, s.contact2.address]);
      // A recovery can never hand the account to a Clear address.
      for (const k of clearKeys) {
        await expect(module.connect(contact).requestRecovery(account.target, k.address)).to.be.revertedWithCustomError(module, "LegacyContactClearAddress");
      }
      await module.connect(contact).requestRecovery(account.target, newKey.address);
    });

    it("test 54: a cancelled request leaves the owner unchanged; an uncancelled one rotates the owner only after the full wait; the contact can do nothing else; the pledge lock and pauses still apply after", async function () {
      const { ctx, clrusd, signals, keyA, keyB, contact, contact2, newKey, stranger } = s;
      const { ecdsa, account, module, viaAccount, install } = await legacy();
      await install(ctx.member);
      const acct = await account.getAddress();
      await deposit(s, ctx.member, 500n * ONE_USDC, acct);

      // A request, then the member's one-signature cancellation within the wait.
      await expect(module.connect(stranger).requestRecovery(acct, newKey.address)).to.be.revertedWithCustomError(module, "LegacyContactNotContact");
      await expect(module.connect(contact).requestRecovery(acct, ethers.ZeroAddress)).to.be.revertedWithCustomError(module, "LegacyContactInvalidOwner");
      const opened = await stamp(module.connect(contact).requestRecovery(acct, newKey.address));
      const req = await module.requestOf(acct);
      expect(req.executableAt).to.equal(BigInt(opened + 90 * DAY));
      await expect(module.connect(contact2).requestRecovery(acct, contact2.address)).to.be.revertedWithCustomError(module, "LegacyContactRequestOpen");
      await advance(89 * DAY);
      await expect(viaAccount(ctx.member, module.target as string, module.interface.encodeFunctionData("cancelRecovery")))
        .to.emit(module, "RecoveryCancelled").withArgs(acct, contact.address, newKey.address);
      await advance(2 * DAY);
      await expect(module.connect(contact).recover(acct)).to.be.revertedWithCustomError(module, "LegacyContactNoRequest");
      expect(await ecdsa.ecdsaValidatorStorage(acct)).to.equal(ctx.member.address);

      // An uncancelled request.
      const t1 = await stamp(module.connect(contact).requestRecovery(acct, newKey.address));

      // Every other call by the contact reverts: the module has no such function, and the account
      // refuses the contact directly.
      const erc20 = new ethers.Interface([
        "function transfer(address,uint256)", "function approve(address,uint256)", "function burn(uint256)",
        "function redeem(address,uint256,address)", "function mint(address,uint256)",
        "function pledgeItem(address,bytes32,uint256,uint256)", "function setPledgeModule(address)",
        "function installModule(uint256,address,bytes)", "function uninstallModule(uint256,address,bytes)",
        "function executeFromExecutor(bytes32,bytes)", "function execute(bytes32,bytes)",
        "function pauseAccount(address,uint32)", "function unpauseAccount(address)", "function setHold(address,bool)",
      ]);
      const attempts = [
        erc20.encodeFunctionData("transfer", [contact.address, 1n]), erc20.encodeFunctionData("approve", [contact.address, 1n]),
        erc20.encodeFunctionData("burn", [1n]), erc20.encodeFunctionData("redeem", [ctx.usdc.target, 1n, contact.address]),
        erc20.encodeFunctionData("mint", [contact.address, 1n]),
        erc20.encodeFunctionData("pledgeItem", [acct, ethers.ZeroHash, 0n, 1n]), erc20.encodeFunctionData("setPledgeModule", [contact.address]),
        erc20.encodeFunctionData("installModule", [2, contact.address, "0x"]), erc20.encodeFunctionData("uninstallModule", [2, module.target, "0x"]),
        erc20.encodeFunctionData("executeFromExecutor", [ethers.ZeroHash, "0x"]), erc20.encodeFunctionData("execute", [ethers.ZeroHash, "0x"]),
        erc20.encodeFunctionData("pauseAccount", [acct, 1]), erc20.encodeFunctionData("unpauseAccount", [acct]),
        erc20.encodeFunctionData("setHold", [acct, false]),
      ];
      for (const data of attempts) {
        await expect(contact.sendTransaction({ to: module.target, data })).to.be.reverted;
      }
      const usdcTransfer = ethers.solidityPacked(["address", "uint256", "bytes"],
        [clrusd.target, 0, erc20.encodeFunctionData("transfer", [contact.address, 1n])]);
      await expect(account.connect(contact).executeFromExecutor(ethers.ZeroHash, usdcTransfer)).to.be.revertedWithCustomError(account, "InvalidExecutor");
      await expect(account.connect(contact).execute(ethers.ZeroHash, usdcTransfer)).to.be.revertedWithCustomError(account, "InvalidCaller");
      await expect(account.connect(contact).installModule(2, contact.address, "0x")).to.be.revertedWithCustomError(account, "InvalidCaller");
      await expect(account.connect(contact).uninstallModule(2, module.target, "0x")).to.be.revertedWithCustomError(account, "InvalidCaller");

      // One second before the full wait reverts; at it, the owner rotates.
      await setNext(t1 + 90 * DAY - 1);
      await expect(module.connect(contact).recover(acct)).to.be.revertedWithCustomError(module, "LegacyContactWaitNotOver").withArgs(t1 + 90 * DAY);
      await expect(module.connect(contact2).recover(acct)).to.be.revertedWithCustomError(module, "LegacyContactNotContact");
      await setNext(t1 + 90 * DAY + 10);
      await expect(module.connect(contact).recover(acct))
        .to.emit(module, "OwnerRotated").withArgs(acct, contact.address, ctx.member.address, newKey.address)
        .and.to.emit(ecdsa, "OwnerRegistered").withArgs(acct, newKey.address);
      expect(await ecdsa.ecdsaValidatorStorage(acct)).to.equal(newKey.address);
      expect(await account.owner()).to.equal(newKey.address);
      expect(await clrusd.balanceOf(acct)).to.equal(500n * ONE_USDC); // nothing moved
      expect(await account.isModuleInstalled(2, module.target, "0x")).to.equal(true); // no module changed
      await expect(module.connect(contact).recover(acct)).to.be.revertedWithCustomError(module, "LegacyContactNoRequest");
      // The old key is out; the new key controls the account.
      await expect(viaAccount(ctx.member, clrusd.target as string, erc20.encodeFunctionData("transfer", [ctx.member.address, 1n])))
        .to.be.revertedWithCustomError(account, "InvalidCaller");

      // The pledge lock still applies: 300 of 500 encumbered.
      await signals.setLock(acct, 300n * ONE_USDC);
      await expect(viaAccount(newKey, clrusd.target as string, erc20.encodeFunctionData("transfer", [newKey.address, 201n * ONE_USDC])))
        .to.be.revertedWithCustomError(clrusd, "ClearUSDEncumbered");
      await viaAccount(newKey, clrusd.target as string, erc20.encodeFunctionData("transfer", [newKey.address, 200n * ONE_USDC]));
      // A 10c pause still applies.
      await twoPerson(clrusd, keyA, keyB, "pauseAccount", [acct, 1]);
      await expect(viaAccount(newKey, clrusd.target as string, erc20.encodeFunctionData("transfer", [newKey.address, 1n])))
        .to.be.revertedWithCustomError(clrusd, "ClearUSDPaused");
    });

    it("recovery fails closed when the account's root validator is not the ECDSA validator the module rotates", async function () {
      const { ctx, contact, newKey } = s;
      const { module, install } = await legacy();
      await install(ctx.member);
      // An account whose root validator is a different ECDSA validator.
      const otherValidator: any = await (await ethers.getContractFactory("MockKernelECDSAValidator")).deploy();
      const account2: any = await (await ethers.getContractFactory("MockKernelAccount"))
        .deploy(ethers.Wallet.createRandom().address, await otherValidator.getAddress(), ctx.counterparty.address);
      await account2.connect(ctx.counterparty).installModule(2, module.target, ethers.concat([ethers.ZeroAddress,
        ethers.AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [ethers.AbiCoder.defaultAbiCoder().encode(["address[]", "uint64"], [[contact.address], 30 * DAY]), "0x"])]));
      const t = await stamp(module.connect(contact).requestRecovery(account2.target, newKey.address));
      await setNext(t + 30 * DAY);
      await expect(module.connect(contact).recover(account2.target)).to.be.revertedWithCustomError(module, "LegacyContactRootNotECDSA");
      expect(await otherValidator.ecdsaValidatorStorage(account2.target)).to.equal(ctx.counterparty.address);
    });
  });
});

async function clrusdRedeem(s: Stack, who: any, amount: bigint) {
  await s.clrusd.connect(who).approve(await s.vault.getAddress(), amount);
  await s.vault.connect(who).redeem(await s.ctx.usdc.getAddress(), amount, who.address);
}
