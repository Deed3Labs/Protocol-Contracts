import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";
import { deployBondStack, grantNoticeRole, WIND_DOWN_ROLE, DAY, U, now } from "../helpers/bonds";
import { grant, RESOLUTION, EQUITY_CUSHION } from "../helpers/earnControls";

/*
 * Phase 2f, stage 2: the new BurnerBond collection and the BondVault, wired to EarnControls and the
 * real CollateralAgent. Earn acceptance tests 1-10, 24 and 26 at the spec's figures (IV-01 §7.3:
 * $2,267.57, $750.00 and $1,517.57), R2 (reserve schedule and Reserve Shortfall), R4 (compounding),
 * R5 (buyback and redeemAll), section 4A (roll by confirmation; IV-01 §§5.1-5.5), decisions 11, 14,
 * 19, 30, 31 and 32, and a test that an Enforcement Notice stops every outflow and every roll.
 */
const NOTICE = ethers.id("enforcement notice");
const DIRECTION = ethers.id("direction");
const PAYMENT_DEFAULT = 1;
const ROLL_NOTICE = ethers.id("roll notice");
const QUARTER = 15 * 60;

async function increase(seconds: number | bigint) {
  await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
  await ethers.provider.send("evm_mine", []);
}

async function at(ts: bigint) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [Number(ts)]);
}

async function deploy() {
  const ctx = await deployPhase0Network();
  const sg = await ethers.getSigners();
  const [key, t1, t2, alice, alice2, bob, carol, keeper, multisig, costs, account, noticer, p1, p2] = sg.slice(6, 20);
  const admin = ctx.admin;

  const membership: any = await upgrades.deployProxy(await ethers.getContractFactory("MembershipRegistry"), [admin.address]);
  for (const who of [alice, bob, carol]) await membership.registerMember(who.address, 3, 0, ethers.ZeroHash);
  await membership.linkWallet(await membership.walletToMemberId(alice.address), alice2.address);

  const s = await deployBondStack(admin, ctx.usdc, ctx.tokenRegistry, {
    membership: await membership.getAddress(),
    rungs: [[365, 475], [730, 500]],
  });
  const { controls, vault, bond } = s;

  // A BOND_ROLE stand-in for the vault-level checks, granted before the Agent is named.
  await vault.grantRole(await vault.BOND_ROLE(), keeper.address);

  const agent: any = await upgrades.deployProxy(await ethers.getContractFactory("CollateralAgent"), [
    admin.address, key.address, [t1.address, t2.address], 6, {
      vault: await vault.getAddress(), bondBook: await vault.getAddress(), pledgeModule: ethers.ZeroAddress,
      payeeSource: await controls.getAddress(), collateralAccount: account.address, costAddress: costs.address,
      excessDestination: multisig.address,
    }], { kind: "uups" });
  // First naming: before the Agent exists on either, it is the admin's alone.
  await vault.setEarnSources(await agent.getAddress(), await controls.getAddress());
  await bond.setSources(await vault.getAddress(), ethers.ZeroAddress, ethers.ZeroHash, await controls.getAddress(), await agent.getAddress());
  await controls.setSources(await membership.getAddress(), ethers.ZeroAddress, await vault.getAddress(), await agent.getAddress(), await vault.getAddress());

  await grantNoticeRole(controls, admin, noticer.address);
  await grant(controls, admin, "PAUSE_ROLE", p1.address, p2.address);
  await grant(controls, admin, "ELIGIBILITY_ROLE", p1.address, p2.address);
  await grant(controls, admin, "SUCCESSOR_ROLE", p1.address, p2.address);
  for (const p of [p1, p2]) await controls.grantRoleByResolution(WIND_DOWN_ROLE, p.address, RESOLUTION);

  const harness = await (await ethers.getContractFactory("AccretionHarness")).deploy();

  /** propose (t1), confirm (t2), co-sign (Agent Key), then 7 days. */
  async function cosigned(target: string, data: string) {
    const callHash = ethers.keccak256(data);
    await agent.connect(t1).proposeChange(target, callHash, ethers.id("description"));
    const id = await agent.openChangeFor(target, callHash);
    await agent.connect(t2).confirmChange(id);
    await agent.connect(key).approveChange(id);
    await increase(7 * DAY);
    return id;
  }

  /** Two holders of a two-person role make the same call. */
  async function two(fn: string, ...args: unknown[]) {
    await controls.connect(p1)[fn](...args);
    return controls.connect(p2)[fn](...args);
  }

  /** Posts a Roll Notice on `id` 21 days before maturity, deadline as late as allowed. */
  async function notice(id: bigint) {
    const b = await bond.getBondInfo(id);
    if ((await now()) < b.maturityDate - BigInt(21 * DAY)) await at(b.maturityDate - BigInt(21 * DAY));
    const deadline = await bond.latestRollDeadline(b.maturityDate);
    const term = await controls.rollTermFor(b.termDays);
    await bond.connect(noticer).postRollNotice(id, ROLL_NOTICE, deadline, term, await controls.ladderYieldBps(term));
    return deadline;
  }

  /** Moves time to 60 days before bond `id` matures: inside the 90-day window. */
  async function near(id: bigint) {
    await at((await bond.getBondInfo(id)).maturityDate - BigInt(60 * DAY));
    await ethers.provider.send("evm_mine", []);
  }

  async function confirm(holder: any, id: bigint) {
    return bond.connect(keeper).confirmRoll(id, ROLL_NOTICE, await s.confirmSig(holder, id));
  }

  return { ...s, ctx, admin, agent, membership, key, t1, t2, alice, alice2, bob, carol, keeper, multisig, costs, account, noticer, p1, p2, harness, cosigned, two, notice, near, confirm };
}

describe("Phase 2f stage 2: bonds and the BondVault", function () {
  let f: Awaited<ReturnType<typeof deploy>>;

  beforeEach(async function () {
    f = await deploy();
  });

  describe("tests 1 and 3: the Redemption Reserve and deployable excess (IV-01 §7.3)", function () {
    it("a $2,500 bond at 5% for two years costs $2,267.57; the reserve is $750.00 and $1,517.57 may go, $1,517.58 may not", async function () {
      const { bond, vault, agent, alice, t1, t2, multisig, usdc } = f;
      expect(await bond.quotePrice(U(2_500), 730, 500)).to.equal(U(2_267) + 570_000n);
      const { id, price } = await f.buy(alice, U(2_500), 730);
      expect(price).to.equal(2_267_570_000n);
      const b = await bond.getBondInfo(id);
      expect([b.faceValue, b.purchasePrice, b.termDays, b.yieldBps]).to.deep.equal([U(2_500), price, 730n, 500n]);
      expect(await vault.requiredReserve()).to.equal(U(750));
      expect(await vault.deployableExcess()).to.equal(1_517_570_000n);

      await agent.connect(t1).proposeExcessWithdrawal(1_517_580_000n);
      await expect(agent.connect(t2).executeExcessWithdrawal(1)).to.be.revertedWithCustomError(agent, "CollateralAgentInsufficient");
      await agent.connect(t1).proposeExcessWithdrawal(1_517_570_000n);
      await expect(agent.connect(t2).executeExcessWithdrawal(2)).to.emit(vault, "ExcessWithdrawn").withArgs(multisig.address, 1_517_570_000n);
      expect(await usdc.balanceOf(multisig.address)).to.equal(1_517_570_000n);
      expect(await vault.held()).to.equal(U(750));
      expect(await vault.inReserveShortfall()).to.equal(false);
    });

    it("excess leaves only to the registered multisig, proposed and executed by different signers (C1, decision 3)", async function () {
      const { vault, agent, alice, t1, keeper } = f;
      await f.buy(alice, U(2_500), 730);
      await agent.connect(t1).proposeExcessWithdrawal(U(100));
      await expect(agent.connect(t1).executeExcessWithdrawal(1)).to.be.revertedWithCustomError(agent, "CollateralAgentSameSigner");
      await expect(vault.connect(t1).agentWithdrawExcess(t1.address, U(1))).to.be.revertedWithCustomError(vault, "BondVaultNotAgent");
      await expect(vault.connect(keeper).agentTransfer(keeper.address, U(1))).to.be.revertedWithCustomError(vault, "BondVaultNotAgent");
      // The single-key withdrawal and the payout pool's loan are gone (C1).
      for (const gone of ["withdrawDeployable", "lendToPayoutPool", "setReserveTerms"]) {
        expect(vault.interface.getFunction(gone)).to.equal(null);
      }
    });

    it("the glide schedule and the 30% floor can only be raised, and only by a co-signed change", async function () {
      const { vault, admin, alice } = f;
      await f.buy(alice, U(2_500), 730);
      await expect(vault.connect(admin).raiseReserveFloor(3_500)).to.be.revertedWithCustomError(f.agent, "CollateralAgentChangeNotReady");
      await f.cosigned(await vault.getAddress(), vault.interface.encodeFunctionData("raiseReserveFloor", [2_900]));
      await expect(vault.connect(admin).raiseReserveFloor(2_900)).to.be.revertedWithCustomError(vault, "BondVaultReserveFloorOutOfBounds");

      const set = (days: number[], bps: number[]) => vault.interface.encodeFunctionData("setGlideSchedule", [days, bps]);
      await f.cosigned(await vault.getAddress(), set([800], [5_000]));
      await vault.connect(admin).setGlideSchedule([800], [5_000]);
      expect(await vault.requiredReserve()).to.equal(U(1_250)); // the bond is inside the 800-day band
      // Lowering a band, or shortening it, would lower some bond's ratio: refused.
      await f.cosigned(await vault.getAddress(), set([800], [4_000]));
      await expect(vault.connect(admin).setGlideSchedule([800], [4_000])).to.be.revertedWithCustomError(vault, "BondVaultBadGlide");
      await f.cosigned(await vault.getAddress(), set([400], [5_000]));
      await expect(vault.connect(admin).setGlideSchedule([400], [5_000])).to.be.revertedWithCustomError(vault, "BondVaultBadGlide");
    });
  });

  describe("test 2: unconfirmed bonds and withdrawn confirmations (Earn §2, IV-01 §7.2)", function () {
    it("counts an unconfirmed bond at 100% within 90 days; a confirmation lowers it, a withdrawal restores it in the same block", async function () {
      const { vault, bond, agent, alice, bob, t1, t2, usdc, keeper } = f;
      const { id } = await f.buy(alice, U(10_000), 365, { cover: false });
      expect(await vault.requiredReserve()).to.equal(U(3_000)); // the 30% floor, far from maturity
      await f.near(id);
      // No Roll Confirmation: 100% of the Maturity Amount once inside 90 days; time alone starts a shortfall.
      expect(await vault.requiredReserve()).to.equal(U(10_000));
      expect(await vault.inReserveShortfall()).to.equal(true);
      await vault.pokeReserve();
      expect(await vault.shortfallSince()).to.not.equal(0n);
      await expect(f.buy(bob, U(1_000), 365, { cover: false })).to.be.revertedWithCustomError(f.controls, "EarnControlsPaused");
      await usdc.mint(keeper.address, U(100_000));
      await usdc.connect(keeper).approve(await vault.getAddress(), U(100_000));
      await expect(vault.connect(keeper).topUp(U(5_000))).to.emit(vault, "ReserveShortfallCured");
      expect(await vault.shortfallSince()).to.equal(0n);

      await f.notice(id);
      await f.confirm(alice, id);
      expect(await vault.requiredReserve()).to.equal(U(3_000)); // the 30% floor only
      await agent.connect(t1).proposeExcessWithdrawal(U(10_000));
      await agent.connect(t2).executeExcessWithdrawal(1);

      // Withdrawing the confirmation restores 100% at once and starts a Reserve Shortfall.
      await expect(bond.connect(alice).withdrawRollConfirmation(id))
        .to.emit(vault, "ReserveShortfall").and.to.emit(bond, "RollConfirmationWithdrawn").withArgs(id, alice.address);
      expect(await vault.requiredReserve()).to.equal(U(10_000));
      expect(await vault.shortfallSince()).to.equal(await now());
      expect(await vault.deployableExcess()).to.equal(0n);
      await agent.connect(t1).proposeExcessWithdrawal(U(1));
      await expect(agent.connect(t2).executeExcessWithdrawal(2)).to.be.revertedWithCustomError(agent, "CollateralAgentInsufficient");
      await expect(f.buy(bob, U(1_000), 365, { cover: false })).to.be.revertedWithCustomError(f.controls, "EarnControlsPaused");
      await vault.connect(keeper).topUp(U(10_000));
      expect(await vault.inReserveShortfall()).to.equal(false);
      await f.buy(bob, U(1_000), 365);
    });

    it("setting the holder-ineligible flag on a confirmed bond restores 100% in the same transaction, and a confirmed roll still runs during a shortfall", async function () {
      const { vault, bond, alice, bob, usdc, keeper } = f;
      const a = await f.buy(alice, U(10_000), 365);
      const b = await f.buy(bob, U(10_000), 365);
      await usdc.mint(await vault.getAddress(), U(1_000));
      await f.notice(a.id);
      await f.notice(b.id);
      await f.confirm(alice, a.id);
      await f.confirm(bob, b.id);
      expect(await vault.requiredReserve()).to.equal(U(6_000));
      await f.two("setHolderIneligible", alice.address, true, ethers.id("evidence"));
      expect(await vault.requiredReserve()).to.equal(U(10_000));
      // Take the vault below even that: bob's confirmed roll still executes (rolls are never paused).
      expect(await vault.inReserveShortfall()).to.equal(false);
      await f.two("setHolderIneligible", bob.address, true, ethers.id("evidence"));
      await f.two("setHolderIneligible", bob.address, false, ethers.id("evidence 2"));
      await increase(22 * DAY);
      await f.attest(bob); // decision 44: a roll needs an attestation in force
      await expect(bond.connect(keeper).settle(b.id)).to.emit(bond, "BondRolled");
      // alice is flagged: her confirmed bond is paid, not rolled.
      await expect(bond.connect(keeper).settle(a.id)).to.emit(bond, "BondRedeemed").withArgs(a.id, alice.address, U(10_000));
    });
  });

  describe("test 4: purchase by quote (Earn §1; decisions 11, 31, 32)", function () {
    it("refuses $249.99, a Clear contract as payer, a quote older than 15 minutes, a used quote and a forged one", async function () {
      const { bond, controls, alice, bob, usdc } = f;
      // $261 at 4.75% for a year is $249.16.
      const low = await f.quote(alice, U(261), 365);
      await usdc.mint(alice.address, U(1_000));
      await usdc.connect(alice).approve(await bond.getAddress(), U(1_000));
      await expect(bond.connect(alice).purchase(low.q, low.sig, "0x")).to.be.revertedWithCustomError(controls, "EarnControlsBelowMinimum");
      await f.buy(alice, U(262), 365); // $250.11 passes

      await controls.setRefused(bob.address, true);
      await expect(f.buy(bob, U(1_000), 365)).to.be.revertedWithCustomError(controls, "EarnControlsRefused");
      await controls.setRefused(bob.address, false);

      const stale = await f.quote(alice, U(1_000), 365, { quotedAt: (await now()) - BigInt(QUARTER) - 1n });
      await expect(bond.connect(alice).purchase(stale.q, stale.sig, "0x")).to.be.revertedWithCustomError(bond, "BurnerBondBadQuote");
      const ok = await f.quote(alice, U(1_000), 365);
      const forged = { ...ok.q, maturityAmount: U(2_000) };
      await expect(bond.connect(alice).purchase(forged, ok.sig, "0x")).to.be.revertedWithCustomError(bond, "BurnerBondBadSignature");
      await usdc.mint(alice.address, U(1_000));
      await usdc.connect(alice).approve(await bond.getAddress(), U(1_000));
      await bond.connect(bob).purchase(ok.q, ok.sig, "0x"); // anyone may submit; the payer pays
      await expect(bond.connect(alice).purchase(ok.q, ok.sig, "0x")).to.be.revertedWithCustomError(bond, "BurnerBondBadQuote");
      const offLadder = await f.quote(alice, U(1_000), 365, { yieldBps: 500 });
      await expect(bond.connect(alice).purchase(offLadder.q, offLadder.sig, "0x")).to.be.revertedWithCustomError(bond, "BurnerBondBadQuote");
    });

    it("a quote keeps the Ladder rate it was given at; the Ladder is not re-read at purchase (decisions 11, 31)", async function () {
      const { bond, controls, alice, usdc } = f;
      const given = await f.quote(alice, U(1_000), 365); // 4.75%
      await increase(60);
      await controls.setRung(365, 400, true);
      const price = await bond.quotePrice(U(1_000), 365, 475);
      await usdc.mint(alice.address, price);
      await usdc.connect(alice).approve(await bond.getAddress(), price);
      const { attestation } = require("../helpers/earnControls");
      await bond.connect(alice).purchase(given.q, given.sig, await attestation(controls, f.attester, alice.address));
      const ids = await bond.getBondIdsByCreator(alice.address);
      expect((await bond.getBondInfo(ids[ids.length - 1])).yieldBps).to.equal(475n);
      // A quote given after the change at the old rate is refused.
      const late = await f.quote(alice, U(1_000), 365, { yieldBps: 475 });
      await expect(bond.connect(alice).purchase(late.q, late.sig, "0x")).to.be.revertedWithCustomError(bond, "BurnerBondBadQuote");
    });

    it("counts the offering cap by Purchase Price, rolls excluded, one cap per product (decision 32)", async function () {
      const { controls, alice } = f;
      const before = await controls.offeringTaken();
      const { price } = await f.buy(alice, U(2_500), 730);
      expect((await controls.offeringTaken()) - before).to.equal(price);
      expect((await controls.earnCostOf(alice.address)).bondCost).to.equal(price);
    });
  });

  describe("test 5: transfers (Earn §1 allowlist, FIXED)", function () {
    it("moves a bond only between one Holder's Smart Accounts or on the Successor path; no operators", async function () {
      const { bond, alice, alice2, bob } = f;
      const { id } = await f.buy(alice, U(1_000), 365);
      await expect(bond.connect(alice).safeTransferFrom(alice.address, bob.address, id, 1, "0x"))
        .to.be.revertedWithCustomError(bond, "BurnerBondTransferNotAllowed");
      await expect(bond.connect(alice).setApprovalForAll(bob.address, true)).to.be.revertedWithCustomError(bond, "BurnerBondNoOperators");
      await expect(bond.connect(bob).safeTransferFrom(alice.address, bob.address, id, 1, "0x")).to.be.reverted;
      await bond.connect(alice).safeTransferFrom(alice.address, alice2.address, id, 1, "0x");
      expect(await bond.holderOf(id)).to.equal(alice2.address);
      await f.two("approveSuccessorTransfer", alice2.address, bob.address, ethers.id("court order"));
      await bond.connect(alice2).safeTransferFrom(alice2.address, bob.address, id, 1, "0x");
      expect(await bond.holderOf(id)).to.equal(bob.address);
    });
  });

  describe("tests 6 and 26: settlement and roll by confirmation (Earn §4A; IV-01 §§5.1-5.5)", function () {
    it("test 26: notice timing, who may confirm, the deadline freeze and the replacement's fresh state", async function () {
      const { bond, controls, vault, alice, bob, keeper, noticer, harness, usdc } = f;
      // A bond maturing on a Monday (18:00 UTC: Monday morning in Pacific time).
      const D = BigInt(DAY);
      let issue = ((await now()) / D + 1n) * D + 18n * 3600n;
      while (new Date(Number(issue + 365n * D) * 1000).getUTCDay() !== 1) issue += D;
      const q = await f.quote(alice, U(10_000), 365, { quotedAt: issue });
      const price = await bond.quotePrice(U(10_000), 365, 475);
      await usdc.mint(alice.address, price);
      await usdc.connect(alice).approve(await bond.getAddress(), price);
      const { attestation } = require("../helpers/earnControls");
      const att = await attestation(controls, f.attester, alice.address);
      await at(issue);
      await bond.connect(alice).purchase(q.q, q.sig, att);
      const id = (await bond.getBondIdsByCreator(alice.address))[0];
      const maturity = (await bond.getBondInfo(id)).maturityDate;
      expect(new Date(Number(maturity) * 1000).getUTCDay()).to.equal(1);
      // The latest Roll Deadline is the end of the Monday seven days before, in Pacific time: one
      // second later it is midnight starting a Tuesday at UTC-8 (winter) or UTC-7 (summer).
      const latest = await bond.latestRollDeadline(maturity);
      const midnight = [8n, 7n].map((h) => latest + 1n - h * 3600n).find((t) => t % D === 0n)!;
      expect(new Date(Number(midnight) * 1000).getUTCDay()).to.equal(2);
      expect(maturity - latest).to.be.lessThan(7n * D);

      await expect(bond.connect(keeper).confirmRoll(id, ROLL_NOTICE, "0x")).to.be.revertedWithCustomError(bond, "BurnerBondBadNotice");
      await at(maturity - 21n * D);
      await expect(bond.connect(f.bob).postRollNotice(id, ROLL_NOTICE, latest, 365, 475)).to.be.revertedWithCustomError(bond, "BurnerBondNotAuthorized");
      await expect(bond.connect(noticer).postRollNotice(id, ROLL_NOTICE, latest + 1n, 365, 475)).to.be.revertedWithCustomError(bond, "BurnerBondBadNotice");
      await expect(bond.connect(noticer).postRollNotice(id, ROLL_NOTICE, latest, 365, 400)).to.be.revertedWithCustomError(bond, "BurnerBondBadNotice");
      await at(maturity - 19n * D);
      await expect(bond.connect(noticer).postRollNotice(id, ROLL_NOTICE, latest, 365, 475)).to.be.revertedWithCustomError(bond, "BurnerBondBadNotice");

      // A second bond for the confirmation rules.
      const { id: id2 } = await f.buy(alice, U(10_000), 365);
      const m2 = (await bond.getBondInfo(id2)).maturityDate;
      await at(m2 - 21n * D);
      const latest2 = await bond.latestRollDeadline(m2);
      await expect(bond.connect(noticer).postRollNotice(id2, ROLL_NOTICE, latest2, 365, 475)).to.emit(bond, "RollNoticePosted");
      await expect(bond.connect(noticer).postRollNotice(id2, ROLL_NOTICE, latest2, 365, 475)).to.be.revertedWithCustomError(bond, "BurnerBondBadNotice");

      // Only the Holder's own signature, over this notice.
      await expect(bond.connect(keeper).confirmRoll(id2, ethers.id("other"), await f.confirmSig(alice, id2))).to.be.revertedWithCustomError(bond, "BurnerBondBadNotice");
      for (const signer of [bob, noticer, keeper, f.p1]) {
        await expect(bond.connect(keeper).confirmRoll(id2, ROLL_NOTICE, await f.confirmSig(signer, id2))).to.be.revertedWithCustomError(bond, "BurnerBondBadSignature");
      }
      const first = await f.confirmSig(alice, id2);
      await expect(bond.connect(keeper).confirmRoll(id2, ROLL_NOTICE, first)).to.emit(bond, "RollConfirmed").withArgs(id2, alice.address, ROLL_NOTICE);
      await expect(bond.connect(bob).withdrawRollConfirmation(id2)).to.be.revertedWithCustomError(bond, "BurnerBondNotAuthorized");
      await bond.connect(alice).withdrawRollConfirmation(id2);
      // A withdrawn confirmation cannot be replayed.
      await expect(bond.connect(keeper).confirmRoll(id2, ROLL_NOTICE, first)).to.be.revertedWithCustomError(bond, "BurnerBondBadSignature");
      await f.confirm(alice, id2);
      // At and after the deadline the confirmation is frozen.
      await at(latest2);
      await expect(bond.connect(alice).withdrawRollConfirmation(id2)).to.be.revertedWithCustomError(bond, "BurnerBondNoticeClosed");

      // At maturity a random caller rolls it: IV-01 §5.2's formula, only the remainder leaves. The
      // Holder re-attested as a Rule 506(b) purchaser: the replacement takes that code (decision 44).
      await f.attest(alice, "506B");
      await at(m2);
      const [newFace, newPrice, remainder] = await harness.rollTerms(U(10_000), 475, 365, 10_000n);
      const vaultBefore = await vault.held();
      const aliceBefore = await usdc.balanceOf(alice.address);
      await expect(bond.connect(keeper).settle(id2)).to.emit(bond, "BondRolled");
      const newId = (await bond.getBondIdsByCreator(alice.address)).at(-1);
      const nb = await bond.getBondInfo(newId);
      expect([nb.faceValue, nb.purchasePrice, nb.issuedAt, nb.costBasis]).to.deep.equal([newFace, newPrice, m2, (await bond.getBondInfo(id2)).costBasis]);
      expect(newFace % 10_000n).to.equal(0n); // rounded down to the cent
      expect(vaultBefore - (await vault.held())).to.equal(remainder);
      expect((await usdc.balanceOf(alice.address)) - aliceBefore).to.equal(remainder);
      expect(await bond.balanceOf(alice.address, id2)).to.equal(0n);
      // The replacement starts unconfirmed with no Roll Notice, and is paid at its own maturity.
      expect(nb.exemptionCode).to.equal(ethers.encodeBytes32String("506B"));
      const fresh = await bond.rollNotice(newId);
      expect([fresh.noticeHash, fresh.confirmed]).to.deep.equal([ethers.ZeroHash, false]);
      await at(nb.maturityDate);
      await usdc.mint(await vault.getAddress(), newFace);
      await expect(bond.connect(keeper).settle(newId)).to.emit(bond, "BondRedeemed").withArgs(newId, alice.address, newFace);
      // No function confirms more than one bond from a single signature.
      const confirms = bond.interface.fragments.filter((x: any) => x.type === "function" && x.stateMutability !== "view" && /confirm/i.test(x.name)).map((x: any) => x.name);
      expect(confirms.sort()).to.deep.equal(["confirmRoll", "confirmRolls", "withdrawRollConfirmation"]);
      expect(id).to.not.equal(0n);
    });

    it("test 6: settle by a random caller pays an unconfirmed bond at maturity and burns it; before maturity it reverts", async function () {
      const { bond, vault, alice, keeper, usdc } = f;
      const { id } = await f.buy(alice, U(1_000), 365);
      await expect(bond.connect(keeper).settle(id)).to.be.revertedWithCustomError(bond, "BurnerBondNotSettleable");
      await usdc.mint(await vault.getAddress(), U(100));
      await increase(365 * DAY);
      const before = await usdc.balanceOf(alice.address);
      await expect(bond.connect(keeper).settle(id)).to.emit(bond, "BondRedeemed").withArgs(id, alice.address, U(1_000));
      expect((await usdc.balanceOf(alice.address)) - before).to.equal(U(1_000));
      expect(await bond.balanceOf(alice.address, id)).to.equal(0n);
      expect((await f.controls.earnCostOf(alice.address)).bondCost).to.equal(0n);
    });

    it("a short vault records a settlement shortfall instead of reverting, and completeSettlement pays it", async function () {
      const { bond, vault, alice, keeper, usdc } = f;
      const { id, price } = await f.buy(alice, U(1_000), 365);
      await increase(365 * DAY);
      await expect(bond.connect(keeper).settle(id)).to.emit(vault, "SettlementShortfall").withArgs(id, alice.address, 0, U(1_000) - price);
      await usdc.mint(await vault.getAddress(), U(1_000));
      await vault.connect(keeper).completeSettlement(id);
      expect(await usdc.balanceOf(alice.address)).to.equal(U(1_000));
    });

    it("a confirmed bond whose term (and every shorter one) is withdrawn is paid, not rolled; the reserve moves at once", async function () {
      const { bond, controls, vault, alice, keeper, usdc } = f;
      const { id } = await f.buy(alice, U(10_000), 365);
      await usdc.mint(await vault.getAddress(), U(1_000));
      await f.notice(id);
      await f.confirm(alice, id);
      expect(await vault.requiredReserve()).to.equal(U(3_000));
      await controls.setRung(365, 475, false); // no term of 365 days or shorter is offered now
      expect(await vault.requiredReserve()).to.equal(U(10_000));
      await f.attest(alice);
      await increase(22 * DAY);
      await expect(bond.connect(keeper).settle(id)).to.emit(bond, "BondRedeemed");
    });
  });

  describe("test 7 and R5: no early redemption; buyback; redeemAll", function () {
    it("has no Holder redemption; a buyback above Accreted Value, in a shortfall or in enforcement reverts; a valid one pays from outside the vault", async function () {
      const { bond, vault, agent, alice, carol, key, usdc } = f;
      for (const gone of ["redeemBond", "batchRedeemBonds", "redeemEarly", "rollBond", "setAutoRollOptOut", "willAutoRoll", "mintBond", "calculateDiscount"]) {
        expect(bond.interface.getFunction(gone)).to.equal(null);
      }
      const { id } = await f.buy(alice, U(2_500), 730);
      const av = await bond.accretedValue(id);
      const deadline = (await now()) + 3600n;
      await usdc.mint(carol.address, U(10_000));
      await usdc.connect(carol).approve(await bond.getAddress(), U(10_000));
      await expect(bond.connect(carol).buyback(id, av + 1n, deadline, await f.buybackSig(alice, id, av + 1n, deadline)))
        .to.be.revertedWithCustomError(bond, "BurnerBondBuybackRefused");
      await expect(bond.connect(carol).buyback(id, av, deadline, await f.buybackSig(carol, id, av, deadline)))
        .to.be.revertedWithCustomError(bond, "BurnerBondBadSignature");
      await agent.connect(key).enforce(PAYMENT_DEFAULT, NOTICE);
      await expect(bond.connect(carol).buyback(id, av, deadline, await f.buybackSig(alice, id, av, deadline)))
        .to.be.revertedWithCustomError(vault, "BondVaultEnforcementInForce");
      await agent.connect(key).releaseEnforcement(DIRECTION);

      const vaultBefore = await vault.held();
      const aliceBefore = await usdc.balanceOf(alice.address);
      await expect(bond.connect(carol).buyback(id, av, deadline, await f.buybackSig(alice, id, av, deadline)))
        .to.emit(bond, "BondBoughtBack").withArgs(id, alice.address, carol.address, av);
      expect(await vault.held()).to.equal(vaultBefore);
      expect((await usdc.balanceOf(alice.address)) - aliceBefore).to.equal(av);
      expect((await vault.obligations(id)).settled).to.equal(true);
      expect(await vault.totalFaceOutstanding()).to.equal(0n);
    });

    it("refuses a buyback during a Reserve Shortfall", async function () {
      const { bond, alice, carol, usdc, vault } = f;
      const { id } = await f.buy(alice, U(10_000), 365, { cover: false });
      await f.near(id);
      expect(await vault.inReserveShortfall()).to.equal(true);
      const av = await bond.accretedValue(id);
      const deadline = (await now()) + 3600n;
      await usdc.mint(carol.address, av);
      await usdc.connect(carol).approve(await bond.getAddress(), av);
      await expect(bond.connect(carol).buyback(id, av, deadline, await f.buybackSig(alice, id, av, deadline)))
        .to.be.revertedWithCustomError(bond, "BurnerBondBuybackRefused");
    });

    it("redeemAll: two signers set the flag, purchases stop, 30 days later every bond is paid its Accreted Value and none rolls", async function () {
      const { bond, vault, alice, bob, keeper, p1, p2, usdc } = f;
      const a = await f.buy(alice, U(2_500), 730);
      const b = await f.buy(bob, U(10_000), 365);
      await usdc.mint(await vault.getAddress(), U(20_000));
      await f.notice(b.id);
      await f.confirm(bob, b.id);
      await expect(bond.connect(keeper).setWindDown(true, ethers.id("illegality"))).to.be.revertedWithCustomError(bond, "BurnerBondNotAuthorized");
      await expect(bond.connect(p1).setWindDown(true, ethers.id("illegality"))).to.emit(bond, "WindDownProposed");
      await expect(bond.connect(p1).setWindDown(true, ethers.id("illegality"))).to.be.revertedWithCustomError(bond, "BurnerBondNotAuthorized");
      await expect(bond.connect(p2).setWindDown(true, ethers.id("illegality"))).to.emit(bond, "WindDownSet");
      await expect(f.buy(alice, U(1_000), 365)).to.be.revertedWithCustomError(bond, "BurnerBondWindDown");
      await expect(bond.connect(keeper).redeemAll()).to.be.revertedWithCustomError(bond, "BurnerBondNotWindingDown");
      await expect(bond.connect(keeper).redeemUnderWindDown(a.id)).to.be.revertedWithCustomError(bond, "BurnerBondNotWindingDown");
      await increase(30 * DAY);
      await expect(bond.connect(keeper).redeemAll()).to.emit(bond, "RedeemAllStarted");
      await expect(bond.connect(p1).setWindDown(false, ethers.ZeroHash)).to.be.revertedWithCustomError(bond, "BurnerBondWindDown");
      const av = await bond.accretedValue(a.id);
      const before = await usdc.balanceOf(alice.address);
      await expect(bond.connect(keeper).redeemUnderWindDown(a.id)).to.emit(bond, "RedeemedUnderWindDown").withArgs(a.id, alice.address, av, 0);
      expect((await usdc.balanceOf(alice.address)) - before).to.equal(av);
      // bob's confirmed bond is paid, not rolled.
      await increase(31 * DAY);
      await expect(bond.connect(keeper).settle(b.id)).to.emit(bond, "BondRedeemed").withArgs(b.id, bob.address, U(10_000));
    });
  });

  describe("decisions 43 and 44", function () {
    it("43: no buyback while any bond has an unpaid settlement shortfall", async function () {
      const { bond, vault, alice, bob, carol, keeper, usdc } = f;
      const a = await f.buy(alice, U(1_000), 365, { cover: false });
      await increase(365 * DAY);
      await bond.connect(keeper).settle(a.id); // the vault holds less than the Maturity Amount
      expect(await vault.totalSettlementOwed()).to.be.greaterThan(0n);
      const b = await f.buy(bob, U(1_000), 730); // Clear Lending tops the reserve up; the payment is still owed
      expect(await vault.inReserveShortfall()).to.equal(false);
      expect(await vault.totalSettlementOwed()).to.be.greaterThan(0n);
      const av = await bond.accretedValue(b.id);
      const deadline = (await now()) + 3600n;
      await usdc.mint(carol.address, av);
      await usdc.connect(carol).approve(await bond.getAddress(), av);
      const sig = await f.buybackSig(bob, b.id, av, deadline);
      await expect(bond.connect(carol).buyback(b.id, av, deadline, sig)).to.be.revertedWithCustomError(bond, "BurnerBondBuybackRefused");
      await vault.connect(keeper).completeSettlement(a.id);
      expect(await vault.totalSettlementOwed()).to.equal(0n);
      await expect(bond.connect(carol).buyback(b.id, av, deadline, sig)).to.emit(bond, "BondBoughtBack");
    });

    it("44: a confirmed roll runs only while the Holder's attestation is in force; with none it is paid", async function () {
      const { bond, alice, keeper } = f;
      const { id } = await f.buy(alice, U(10_000), 365);
      await f.notice(id);
      await f.confirm(alice, id);
      await increase(22 * DAY);
      // alice's attestation (12 months from the purchase) has lapsed by maturity.
      expect(await f.controls.eligibleCode(alice.address)).to.equal(ethers.ZeroHash);
      await expect(bond.connect(keeper).settle(id)).to.emit(bond, "BondRedeemed").withArgs(id, alice.address, U(10_000));
    });
  });

  describe("test 24: the Equity Cushion pause", function () {
    it("stops new purchases, not confirmed rolls; a single signer cannot set it", async function () {
      const { bond, controls, alice, keeper, p1, usdc, vault } = f;
      const { id } = await f.buy(alice, U(10_000), 365);
      await usdc.mint(await vault.getAddress(), U(1_000));
      await f.notice(id);
      await f.confirm(alice, id);
      await controls.connect(p1).setPauseFlag(EQUITY_CUSHION, true, ethers.id("cushion"));
      await f.buy(alice, U(1_000), 365); // one signer: nothing paused yet
      await f.two("setPauseFlag", EQUITY_CUSHION, true, ethers.id("cushion 2"));
      await expect(f.buy(alice, U(1_000), 365)).to.be.revertedWithCustomError(controls, "EarnControlsPaused");
      await f.attest(alice);
      await increase(22 * DAY);
      await expect(bond.connect(keeper).settle(id)).to.emit(bond, "BondRolled");
    });
  });

  describe("tests 8-10 and decision 19: the Collateral Agent and the real BondVault", function () {
    it("an Enforcement Notice stops every outflow and every roll, a confirmed one included; distributions pay and burn", async function () {
      const { bond, vault, agent, alice, bob, keeper, key, t1, t2, usdc } = f;
      const a = await f.buy(alice, U(30_000), 365);
      const b = await f.buy(bob, U(10_000), 365);
      await usdc.mint(await vault.getAddress(), U(50_000));
      await f.notice(a.id);
      await f.confirm(alice, a.id);
      await agent.connect(t1).proposeExcessWithdrawal(U(1));
      const deadline = (await now()) + 365n * BigInt(DAY);
      // Both bonds have matured, so each is owed its Maturity Amount; the notice comes before anyone settles.
      await increase(22 * DAY);
      await f.attest(alice);
      await agent.connect(key).enforce(PAYMENT_DEFAULT, NOTICE);

      // New purchases.
      await expect(f.buy(alice, U(1_000), 365)).to.be.revertedWithCustomError(f.controls, "EarnControlsPaused");
      // Excess.
      await expect(agent.connect(t2).executeExcessWithdrawal(1)).to.be.revertedWithCustomError(agent, "CollateralAgentInForce");
      // Buyback.
      await usdc.mint(t1.address, U(1_000));
      await usdc.connect(t1).approve(await bond.getAddress(), U(1_000));
      await expect(bond.connect(t1).buyback(b.id, U(1), deadline, await f.buybackSig(bob, b.id, U(1), deadline)))
        .to.be.revertedWithCustomError(vault, "BondVaultEnforcementInForce");
      // Settlement, and the confirmed roll (decision 19).
      await expect(bond.connect(keeper).settle(b.id)).to.be.revertedWithCustomError(vault, "BondVaultEnforcementInForce");
      await expect(bond.connect(keeper).settle(a.id)).to.be.revertedWithCustomError(vault, "BondVaultEnforcementInForce");
      // Every other vault outflow (BOND_ROLE stand-in): payPledged's, the split, redeemAll's, completion.
      await expect(vault.connect(keeper).settleEarly(a.id, keeper.address, 1n)).to.be.revertedWithCustomError(vault, "BondVaultEnforcementInForce");
      await expect(vault.connect(keeper).settlePledged(a.id, keeper.address, 0n, alice.address)).to.be.revertedWithCustomError(vault, "BondVaultEnforcementInForce");
      await expect(vault.connect(keeper).settleAt(a.id, ethers.ZeroAddress, 0n, alice.address, 1n)).to.be.revertedWithCustomError(vault, "BondVaultEnforcementInForce");
      await expect(vault.connect(keeper).completeSettlement(a.id)).to.be.revertedWithCustomError(vault, "BondVaultEnforcementInForce");
      await expect(vault.connect(keeper).retireUnpaid(a.id)).to.be.revertedWithCustomError(vault, "BondVaultEnforcementInForce");
      await expect(vault.connect(keeper).roll(a.id, 999n, 1n, 1n, 0, 0, alice.address, 0n)).to.be.revertedWithCustomError(vault, "BondVaultEnforcementInForce");

      // Test 8 at the real vault: $10,000 across bonds owed $30,000 and $10,000 pays $7,500 and $2,500.
      await agent.snapshotBonds(10);
      await agent.connect(key).postDistribution(U(10_000), 1);
      const before = await usdc.balanceOf(alice.address);
      await agent.connect(keeper).claimDistribution(a.id);
      await agent.connect(keeper).claimDistribution(b.id);
      expect((await usdc.balanceOf(alice.address)) - before).to.equal(U(7_500));
      // Paid in full: the bond burns through the vault and the collection (IV-10 §7.6).
      await agent.connect(key).postDistribution(U(30_000), 2);
      await expect(agent.connect(keeper).claimDistribution(a.id)).to.emit(bond, "BondPaidThroughDistributions").withArgs(a.id, alice.address);
      expect(await bond.balanceOf(alice.address, a.id)).to.equal(0n);
      expect((await vault.obligations(a.id)).settled).to.equal(true);
      expect((await bond.getBondInfo(a.id)).paid).to.equal(U(30_000));
    });

    it("test 10: a BondVault upgrade needs the treasury, the Agent's co-signature and 7 days; without a notice nothing stops settle", async function () {
      const { vault, agent, admin, key, t1, t2, alice, keeper, usdc, bond } = f;
      const impl = await upgrades.prepareUpgrade(await vault.getAddress(), await ethers.getContractFactory("BondVault"), { kind: "uups" });
      await expect(vault.connect(admin).upgradeTo(impl)).to.be.revertedWithCustomError(agent, "CollateralAgentChangeNotReady");
      const data = vault.interface.encodeFunctionData("upgradeTo", [impl]);
      await agent.connect(t1).proposeChange(await vault.getAddress(), ethers.keccak256(data), ethers.id("upgrade"));
      const id = await agent.openChangeFor(await vault.getAddress(), ethers.keccak256(data));
      await agent.connect(t2).confirmChange(id);
      await increase(7 * DAY);
      await expect(vault.connect(admin).upgradeTo(impl)).to.be.revertedWithCustomError(agent, "CollateralAgentChangeNotReady");
      await agent.connect(key).approveChange(id);
      await expect(vault.connect(keeper).upgradeTo(impl)).to.be.reverted; // the Earn timelock only
      await expect(vault.connect(admin).upgradeTo(impl)).to.emit(agent, "ChangeExecuted");

      // Roles and settings are changes too.
      await expect(vault.connect(admin).grantRole(await vault.BOND_ROLE(), keeper.address)).to.be.revertedWithCustomError(agent, "CollateralAgentChangeNotReady");
      await expect(vault.connect(admin).setBackstops(keeper.address, ethers.ZeroAddress)).to.be.revertedWithCustomError(agent, "CollateralAgentChangeNotReady");
      await expect(bond.connect(admin).setSources(await vault.getAddress(), ethers.ZeroAddress, ethers.ZeroHash, await f.controls.getAddress(), await agent.getAddress()))
        .to.be.revertedWithCustomError(agent, "CollateralAgentChangeNotReady");

      const { id: bondId } = await f.buy(alice, U(1_000), 365);
      await usdc.mint(await vault.getAddress(), U(100));
      await agent.connect(key).rotateAgentKey(t1.address);
      await increase(365 * DAY);
      await bond.connect(keeper).settle(bondId);
      expect(await usdc.balanceOf(alice.address)).to.equal(U(1_000));
    });

    it("the reserve hook and the Agent's calls answer only their own callers", async function () {
      const { vault, keeper } = f;
      await expect(vault.connect(keeper).holderEligibilityChanged(keeper.address, true)).to.be.revertedWithCustomError(vault, "BondVaultNotControls");
      await expect(vault.connect(keeper).termOfferChanged(60, false)).to.be.revertedWithCustomError(vault, "BondVaultNotControls");
      await expect(vault.connect(keeper).burnPaid(1)).to.be.revertedWithCustomError(vault, "BondVaultNotAgent");
      await expect(f.bond.connect(keeper).burnPaid(1)).to.be.revertedWithCustomError(f.bond, "BurnerBondNotAuthorized");
    });
  });

  describe("decision 30: Required-Holder Directions signed by the Holders, counted by Accreted Value", function () {
    async function withDirections() {
      const dirs = await (await ethers.getContractFactory("HolderDirections"))
        .deploy(await f.vault.getAddress(), await f.agent.getAddress(), await f.controls.getAddress());
      await f.cosigned(await f.agent.getAddress(), f.agent.interface.encodeFunctionData("setHolderDirections", [await dirs.getAddress()]));
      await f.agent.connect(f.admin).setHolderDirections(await dirs.getAddress());
      return dirs;
    }

    async function signDirection(dirs: any, holder: any, id: string, bondIds: bigint[]) {
      const net = await ethers.provider.getNetwork();
      const domain = { name: "HolderDirections", version: "1", chainId: net.chainId, verifyingContract: await dirs.getAddress() };
      return holder.signTypedData(domain, { Direction: [{ name: "directionId", type: "bytes32" }, { name: "bondIds", type: "uint256[]" }] }, { directionId: id, bondIds });
    }

    it("raises the Agent's cost cap only once Holders of more than half the Accreted Value sign; insiders are excluded", async function () {
      const { agent, key, alice, bob, carol, keeper, admin, controls } = f;
      const a = await f.buy(alice, U(30_000), 730);
      const b = await f.buy(bob, U(20_000), 730);
      const c = await f.buy(carol, U(20_000), 730);
      const dirs = await withDirections();
      await agent.connect(key).enforce(PAYMENT_DEFAULT, NOTICE);
      // The Agent Key cannot record it any more.
      await expect(agent.connect(key).recordCostApproval(DIRECTION, U(5_000))).to.be.revertedWithCustomError(agent, "CollateralAgentNotAgent");

      const id = await dirs.open.staticCall(1, U(5_000), DIRECTION);
      await dirs.open(1, U(5_000), DIRECTION);
      await expect(dirs.connect(keeper).sign(id, alice.address, [b.id], await signDirection(dirs, alice, id, [b.id])))
        .to.be.revertedWithCustomError(dirs, "HolderDirectionsBond");
      await expect(dirs.connect(keeper).sign(id, alice.address, [a.id], await signDirection(dirs, bob, id, [a.id])))
        .to.be.revertedWithCustomError(dirs, "HolderDirectionsBadSignature");
      await dirs.connect(keeper).sign(id, alice.address, [a.id], await signDirection(dirs, alice, id, [a.id]));
      await dirs.tally(id, 1);
      await expect(dirs.execute(id)).to.be.revertedWithCustomError(dirs, "HolderDirectionsInvalid");
      await dirs.tally(id, 10);
      // alice holds 30/70 of the Accreted Value: not enough.
      await expect(dirs.execute(id)).to.be.revertedWithCustomError(dirs, "HolderDirectionsNotReached");

      // carol is an insider: once excluded, her bonds count neither for nor in the total.
      await controls.connect(admin).grantRoleByResolution(await dirs.EXCLUDED_HOLDER_ROLE(), carol.address, RESOLUTION);
      await expect(dirs.connect(keeper).sign(id, carol.address, [c.id], await signDirection(dirs, carol, id, [c.id])))
        .to.be.revertedWithCustomError(dirs, "HolderDirectionsInvalid");
      const id2 = await dirs.open.staticCall(1, U(5_000), DIRECTION);
      await dirs.open(1, U(5_000), DIRECTION);
      await dirs.connect(keeper).sign(id2, alice.address, [a.id], await signDirection(dirs, alice, id2, [a.id]));
      await dirs.tally(id2, 10);
      await expect(dirs.execute(id2)).to.emit(agent, "CostApprovalRecorded").withArgs(1, DIRECTION, U(5_000), (await now()) + 1n + BigInt(7 * DAY));
      await expect(dirs.execute(id2)).to.be.revertedWithCustomError(dirs, "HolderDirectionsInvalid");
    });

    it("blocks a pending key replacement once the Required Holders sign", async function () {
      const { agent, t1, t2, alice, bob, keeper } = f;
      const a = await f.buy(alice, U(30_000), 730);
      await f.buy(bob, U(20_000), 730);
      const dirs = await withDirections();
      await agent.connect(t1).proposeReplacement(1, keeper.address, ethers.id("instruction"));
      await agent.connect(t2).approveReplacement(1);
      const id = await dirs.open.staticCall(2, 1, DIRECTION);
      await dirs.open(2, 1, DIRECTION);
      await dirs.connect(keeper).sign(id, alice.address, [a.id], await signDirection(dirs, alice, id, [a.id]));
      await dirs.tally(id, 10);
      await expect(dirs.execute(id)).to.emit(agent, "ReplacementBlocked").withArgs(1, DIRECTION, await dirs.getAddress());
      await increase(7 * DAY);
      await expect(agent.executeReplacement(1)).to.be.revertedWithCustomError(agent, "CollateralAgentReplacement");
    });
  });
});
