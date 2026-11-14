import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";
import {
  deployAssurancePool, setFloorInputs, fund, balances, advance,
  AssuranceSetup, BACKSTOP, ASSURANCE, TAG, MASK, DAY, ASSURANCE_DELAY,
} from "../helpers/assurance";

const ONE_USDC = 10n ** 6n;
const usd = (n: number | bigint) => BigInt(n) * ONE_USDC;

/*
 * The co-op's AssurancePool (compliance section 13): segregated compartments, two-person control
 * on every action, and a 7-day governance timelock for parameters and upgrades. The acceptance
 * tests (31-33) are in test/audit/compliance/Assurance.spec.ts; this file covers each function.
 *
 * Replaces the Phase 1 pool's spec (primary/buffer/excess tiers, oracle rebalancing, RTD), which
 * section 13 retired with the contract.
 */
describe("AssurancePool (section 13)", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let a: AssuranceSetup;
  let pool: any, usdc: any, gov: any;

  /** The governance timelock, impersonated: the timelock's own delay is shown separately. */
  async function governance() {
    const address = await a.timelock.getAddress();
    await ethers.provider.send("hardhat_impersonateAccount", [address]);
    await ethers.provider.send("hardhat_setBalance", [address, "0x56BC75E2D63100000"]);
    return ethers.getSigner(address);
  }

  async function approve(fn: string, args: any[]) {
    const action = ethers.keccak256(pool.interface.encodeFunctionData(fn, args));
    await pool.connect(a.signerA).approveAction(action);
    await pool.connect(a.signerB).approveAction(action);
    return action;
  }

  /** A governed call: two signers approve its calldata, then governance makes it. */
  async function governed(fn: string, args: any[]) {
    await approve(fn, args);
    return pool.connect(gov)[fn](...args);
  }

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    usdc = ctx.usdc;
    a = await deployAssurancePool(usdc, ctx.networkRegistry);
    pool = a.pool;
    gov = await governance();
  });

  describe("initialization", function () {
    it("starts with the two fixed compartments at 50/50, a 5% floor and a 14-day transfer delay", async function () {
      expect(await pool.compartments()).to.deep.equal([BACKSTOP, ASSURANCE]);
      expect(await pool.allocationOf(BACKSTOP)).to.equal(5_000n);
      expect(await pool.allocationOf(ASSURANCE)).to.equal(5_000n);
      expect(await pool.floorBps()).to.equal(500n);
      expect(await pool.transferDelay()).to.equal(BigInt(14 * DAY));
      expect(await pool.signerCount()).to.equal(3n);
      expect(await pool.governance()).to.equal(await a.timelock.getAddress());
    });

    it("cannot be initialized again, nor its implementation at all", async function () {
      await expect(pool.initialize(await usdc.getAddress(), await a.timelock.getAddress(), await ctx.networkRegistry.getAddress(), [a.signerA.address, a.signerB.address]))
        .to.be.revertedWith("Initializable: contract is already initialized");
      const impl: any = await (await ethers.getContractFactory("AssurancePool")).deploy();
      await expect(impl.initialize(await usdc.getAddress(), await a.timelock.getAddress(), await ctx.networkRegistry.getAddress(), [a.signerA.address, a.signerB.address]))
        .to.be.revertedWith("Initializable: contract is already initialized");
    });

    it("refuses a governance delay under 7 days, fewer than two signers, and a governance signer", async function () {
      const F = await ethers.getContractFactory("AssurancePool");
      const T = await ethers.getContractFactory("TimelockController");
      const short: any = await T.deploy(6 * DAY, [a.board.address], [a.board.address], ethers.ZeroAddress);

      await expect(upgrades.deployProxy(F, [await usdc.getAddress(), await short.getAddress(), await ctx.networkRegistry.getAddress(), [a.signerA.address, a.signerB.address]], { kind: "uups" }))
        .to.be.revertedWithCustomError(F, "AssurancePoolGovernanceDelayTooShort");
      await expect(upgrades.deployProxy(F, [await usdc.getAddress(), await a.timelock.getAddress(), await ctx.networkRegistry.getAddress(), [a.signerA.address, a.signerA.address]], { kind: "uups" }))
        .to.be.revertedWithCustomError(F, "AssurancePoolTooFewSigners");
      const tl = await a.timelock.getAddress();
      await expect(upgrades.deployProxy(F, [await usdc.getAddress(), tl, await ctx.networkRegistry.getAddress(), [a.signerA.address, tl]], { kind: "uups" }))
        .to.be.revertedWithCustomError(F, "AssurancePoolRoleConflict");
    });
  });

  describe("two-person control on governed calls (13a)", function () {
    const cases: [string, (s: AssuranceSetup) => any[]][] = [
      ["setSigner", (s) => [s.signerC.address, false]],
      ["setPayer", (s) => [s.treasury.address, MASK.treasury]],
      ["setLendingCoAddresses", (s) => [s.drawer.address, s.lossReserve.address]],
      ["setAssuranceDisbursementAddress", (s) => [s.disbursement.address]],
      ["setFloorBps", () => [600n]],
      ["setExposureSources", (s) => [[s.board.address]]],
      ["setTransferDelay", () => [BigInt(21 * DAY)]],
      ["setAllocation", () => [[6_000, 4_000]]],
      ["addCompartment", () => [ethers.encodeBytes32String("RESEARCH")]],
      ["setNetworkRegistry", (s) => [s.board.address]],
    ];

    for (const [fn, argsOf] of cases) {
      it(`${fn}: governance only, and only once two different signers approved the exact call`, async function () {
        const args = argsOf(a);
        // A signer, or anybody else, calling it directly.
        await expect(pool.connect(a.signerA)[fn](...args)).to.be.revertedWithCustomError(pool, "AssurancePoolNotGovernance");
        await expect(pool.connect(a.lendingCo)[fn](...args)).to.be.revertedWithCustomError(pool, "AssurancePoolNotGovernance");
        // Governance with no approval, then with one signer's.
        await expect(pool.connect(gov)[fn](...args)).to.be.revertedWithCustomError(pool, "AssurancePoolNotApproved");
        const action = ethers.keccak256(pool.interface.encodeFunctionData(fn, args));
        await pool.connect(a.signerA).approveAction(action);
        await expect(pool.connect(gov)[fn](...args)).to.be.revertedWithCustomError(pool, "AssurancePoolNotApproved");
        // The same signer cannot approve its own proposal.
        await expect(pool.connect(a.signerA).approveAction(action)).to.be.revertedWithCustomError(pool, "AssurancePoolSameSigner");
        // A non-signer cannot approve at all.
        await expect(pool.connect(a.board).approveAction(action)).to.be.revertedWithCustomError(pool, "AssurancePoolNotSigner");
        await pool.connect(a.signerB).approveAction(action);
        expect(await pool.approvedAction(action)).to.equal(true);
        await pool.connect(gov)[fn](...args);
        // Used once.
        expect(await pool.approvedAction(action)).to.equal(false);
      });
    }

    it("removeCompartment: the same, and never for the two fixed compartments", async function () {
      const id = ethers.encodeBytes32String("RESEARCH");
      await governed("addCompartment", [id]);
      await expect(pool.connect(gov).removeCompartment(id)).to.be.revertedWithCustomError(pool, "AssurancePoolNotApproved");
      await governed("removeCompartment", [id]);
      expect(await pool.compartments()).to.deep.equal([BACKSTOP, ASSURANCE]);
      for (const fixed of [BACKSTOP, ASSURANCE]) {
        await approve("removeCompartment", [fixed]);
        await expect(pool.connect(gov).removeCompartment(fixed)).to.be.revertedWithCustomError(pool, "AssurancePoolCompartmentFixed");
      }
    });

    it("setGovernance: the same, and never to a timelock under 7 days", async function () {
      const T = await ethers.getContractFactory("TimelockController");
      const short: any = await T.deploy(DAY, [a.board.address], [a.board.address], ethers.ZeroAddress);
      const longer: any = await T.deploy(10 * DAY, [a.board.address], [a.board.address], ethers.ZeroAddress);
      await expect(pool.connect(gov).setGovernance(await longer.getAddress())).to.be.revertedWithCustomError(pool, "AssurancePoolNotApproved");
      await approve("setGovernance", [await short.getAddress()]);
      await expect(pool.connect(gov).setGovernance(await short.getAddress())).to.be.revertedWithCustomError(pool, "AssurancePoolGovernanceDelayTooShort");
      await governed("setGovernance", [await longer.getAddress()]);
      expect(await pool.governance()).to.equal(await longer.getAddress());
    });

    it("upgrades: through governance with two signers, and every compartment balance survives", async function () {
      await fund(a, usdc, a.treasury, TAG.INTERCHANGE, usd(1_000));
      await fund(a, usdc, a.lendingCo, TAG.RECOVERY, usd(300));
      const before = await balances(pool);
      const impl = await (await ethers.getContractFactory("AssurancePool")).deploy();
      const implAddress = await impl.getAddress();

      await expect(pool.connect(a.signerA).upgradeTo(implAddress)).to.be.revertedWithCustomError(pool, "AssurancePoolNotGovernance");
      await expect(pool.connect(gov).upgradeTo(implAddress)).to.be.revertedWithCustomError(pool, "AssurancePoolNotApproved");
      await governed("upgradeTo", [implAddress]);
      expect(await upgrades.erc1967.getImplementationAddress(await pool.getAddress())).to.equal(implAddress);
      expect((await balances(pool)).byId).to.deep.equal(before.byId);
      expect(await pool.totalAccounted()).to.equal(usd(1_300));
    });

    it("waits out the real timelock: scheduled by the board, not executable before 7 days", async function () {
      const data = pool.interface.encodeFunctionData("setFloorBps", [700n]);
      const action = ethers.keccak256(data);
      await pool.connect(a.signerA).approveAction(action);
      await pool.connect(a.signerC).approveAction(action);
      const target = await pool.getAddress();
      const salt = ethers.id("floor-700");
      await expect(a.timelock.connect(a.signerA).schedule(target, 0, data, ethers.ZeroHash, salt, ASSURANCE_DELAY)).to.be.reverted;
      await a.timelock.connect(a.board).schedule(target, 0, data, ethers.ZeroHash, salt, ASSURANCE_DELAY);
      await advance(ASSURANCE_DELAY - 60);
      await expect(a.timelock.connect(a.board).execute(target, 0, data, ethers.ZeroHash, salt))
        .to.be.revertedWith("TimelockController: operation is not ready");
      await advance(60);
      await a.timelock.connect(a.board).execute(target, 0, data, ethers.ZeroHash, salt);
      expect(await pool.floorBps()).to.equal(700n);
    });

    it("keeps at least two signers, and never makes Lending Co., a payer or a money path a signer", async function () {
      await approve("setSigner", [a.signerC.address, false]);
      await pool.connect(gov).setSigner(a.signerC.address, false);
      await approve("setSigner", [a.signerB.address, false]);
      await expect(pool.connect(gov).setSigner(a.signerB.address, false)).to.be.revertedWithCustomError(pool, "AssurancePoolTooFewSigners");
      for (const who of [a.drawer, a.lossReserve, a.lendingCo, a.treasury]) {
        await approve("setSigner", [who.address, true]);
        await expect(pool.connect(gov).setSigner(who.address, true)).to.be.revertedWithCustomError(pool, "AssurancePoolRoleConflict");
      }
      const issuer = await ctx.creditIssuer.getAddress();
      await approve("setSigner", [issuer, true]);
      await expect(pool.connect(gov).setSigner(issuer, true)).to.be.revertedWithCustomError(pool, "AssurancePoolRoleConflict");
      // Nor a signer a payer or Lending Co.
      await approve("setPayer", [a.signerA.address, MASK.treasury]);
      await expect(pool.connect(gov).setPayer(a.signerA.address, MASK.treasury)).to.be.revertedWithCustomError(pool, "AssurancePoolRoleConflict");
      await approve("setLendingCoAddresses", [a.signerA.address, a.lossReserve.address]);
      await expect(pool.connect(gov).setLendingCoAddresses(a.signerA.address, a.lossReserve.address)).to.be.revertedWithCustomError(pool, "AssurancePoolRoleConflict");
    });

    it("forgets a proposal whose proposer is no longer a signer", async function () {
      const action = ethers.keccak256(pool.interface.encodeFunctionData("setFloorBps", [800n]));
      await pool.connect(a.signerC).approveAction(action);
      await governed("setSigner", [a.signerC.address, false]);
      // signerA's approval now starts afresh instead of completing signerC's.
      await pool.connect(a.signerA).approveAction(action);
      expect(await pool.approvedAction(action)).to.equal(false);
      await pool.connect(a.signerB).approveAction(action);
      expect(await pool.approvedAction(action)).to.equal(true);
    });
  });

  describe("deposit (13c)", function () {
    it("takes each tag only from a payer allowed it", async function () {
      await usdc.mint(a.lendingCo.address, usd(100));
      await usdc.connect(a.lendingCo).approve(await pool.getAddress(), ethers.MaxUint256);
      await expect(pool.connect(a.lendingCo).deposit(TAG.INTERCHANGE, usd(10))).to.be.revertedWithCustomError(pool, "AssurancePoolNotPayer");
      await expect(pool.connect(a.lendingCo).deposit(TAG.BOARD_ALLOCATION, usd(10))).to.be.revertedWithCustomError(pool, "AssurancePoolNotPayer");
      await pool.connect(a.lendingCo).deposit(TAG.CREDIT_ENHANCEMENT_FEE, usd(10));
      await pool.connect(a.lendingCo).deposit(TAG.RECOVERY, usd(10));
      await usdc.mint(a.treasury.address, usd(100));
      await usdc.connect(a.treasury).approve(await pool.getAddress(), ethers.MaxUint256);
      await expect(pool.connect(a.treasury).deposit(TAG.RECOVERY, usd(10))).to.be.revertedWithCustomError(pool, "AssurancePoolNotPayer");
      await pool.connect(a.treasury).deposit(TAG.INTERCHANGE, usd(10));
      await expect(pool.connect(a.treasury).deposit(TAG.INTERCHANGE, 0n)).to.be.revertedWithCustomError(pool, "AssurancePoolInvalidAmount");
      await expect(pool.connect(ctx.outsider).deposit(TAG.INTERCHANGE, usd(1))).to.be.revertedWithCustomError(pool, "AssurancePoolNotPayer");
    });

    it("refuses an allowlisted payer once it is listed as a money path", async function () {
      await fund(a, usdc, a.treasury, TAG.INTERCHANGE, usd(10));
      await ctx.networkRegistry.listMoneyPath(a.treasury.address, ethers.encodeBytes32String("PAYOUT_POOL"));
      await usdc.mint(a.treasury.address, usd(10));
      await usdc.connect(a.treasury).approve(await pool.getAddress(), usd(10));
      await expect(pool.connect(a.treasury).deposit(TAG.INTERCHANGE, usd(10))).to.be.revertedWithCustomError(pool, "AssurancePoolMoneyPath");
      // And will not allowlist one.
      await approve("setPayer", [await ctx.creditIssuer.getAddress(), MASK.treasury]);
      await expect(pool.connect(gov).setPayer(await ctx.creditIssuer.getAddress(), MASK.treasury)).to.be.revertedWithCustomError(pool, "AssurancePoolMoneyPath");
    });

    it("keeps rounding dust in the Credit Backstop", async function () {
      await governed("setAllocation", [[6_667, 3_333]]);
      await fund(a, usdc, a.treasury, TAG.INTERCHANGE, 10n);
      // 10 x 33.33% = 3.333 -> 3 to assurance; the backstop keeps 7, the dust included.
      expect(await pool.balanceOf(ASSURANCE)).to.equal(3n);
      expect(await pool.balanceOf(BACKSTOP)).to.equal(7n);
      expect((await balances(pool)).sum).to.equal(await usdc.balanceOf(await pool.getAddress()));
    });

    it("emits CompartmentCredited per compartment", async function () {
      await usdc.mint(a.treasury.address, usd(100));
      await usdc.connect(a.treasury).approve(await pool.getAddress(), usd(100));
      await expect(pool.connect(a.treasury).deposit(TAG.BOARD_ALLOCATION, usd(100)))
        .to.emit(pool, "CompartmentCredited").withArgs(TAG.BOARD_ALLOCATION, BACKSTOP, usd(50))
        .and.to.emit(pool, "CompartmentCredited").withArgs(TAG.BOARD_ALLOCATION, ASSURANCE, usd(50));
    });

    it("splits across a governed third compartment once it has an allocation", async function () {
      const id = ethers.encodeBytes32String("RESEARCH");
      await governed("addCompartment", [id]);
      expect(await pool.allocationOf(id)).to.equal(0n);
      await fund(a, usdc, a.treasury, TAG.INTERCHANGE, usd(100));
      expect(await pool.balanceOf(id)).to.equal(0n);
      await governed("setAllocation", [[5_000, 3_000, 2_000]]);
      await fund(a, usdc, a.treasury, TAG.INTERCHANGE, usd(100));
      expect(await pool.balanceOf(id)).to.equal(usd(20));
      await approve("setAllocation", [[5_000, 5_000]]);
      await expect(pool.connect(gov).setAllocation([5_000, 5_000])).to.be.revertedWithCustomError(pool, "AssurancePoolBadAllocation");
      await approve("setAllocation", [[5_000, 3_000, 1_000]]);
      await expect(pool.connect(gov).setAllocation([5_000, 3_000, 1_000])).to.be.revertedWithCustomError(pool, "AssurancePoolBadAllocation");
      // A compartment with money in it cannot be removed.
      await approve("removeCompartment", [id]);
      await expect(pool.connect(gov).removeCompartment(id)).to.be.revertedWithCustomError(pool, "AssurancePoolCompartmentNotEmpty");
    });
  });

  describe("floor inputs (13d), two signers each month", function () {
    it("applies only when a second, different signer sends the same figures", async function () {
      const ev = ethers.id("2026-11");
      await expect(pool.connect(a.lendingCo).setFloorInputs(1n, 2n, 3n, ev)).to.be.revertedWithCustomError(pool, "AssurancePoolNotSigner");
      await pool.connect(a.signerA).setFloorInputs(usd(1), usd(2), usd(3), ev);
      expect(await pool.coverageCap()).to.equal(0n);
      await expect(pool.connect(a.signerA).setFloorInputs(usd(1), usd(2), usd(3), ev)).to.be.revertedWithCustomError(pool, "AssurancePoolSameSigner");
      // Different figures are a different proposal.
      await pool.connect(a.signerB).setFloorInputs(usd(1), usd(2), usd(4), ev);
      expect(await pool.coverageCap()).to.equal(0n);
      await expect(pool.connect(a.signerB).setFloorInputs(usd(1), usd(2), usd(3), ev))
        .to.emit(pool, "FloorInputsSet").withArgs(usd(1), usd(2), usd(3), ev, a.signerA.address, a.signerB.address);
      expect(await pool.timingBufferShortfall()).to.equal(usd(1));
      expect(await pool.coverageCap()).to.equal(usd(2));
      expect(await pool.attestedCoveredBook()).to.equal(usd(3));
      expect(await pool.floorEvidenceHash()).to.equal(ev);
      await expect(pool.connect(a.signerA).setFloorInputs(1n, 1n, 1n, ethers.ZeroHash)).to.be.revertedWithCustomError(pool, "AssurancePoolInvalidAmount");
    });

    it("floor = max(shortfall, floorBps x covered book); covered book = max(sources, attested)", async function () {
      const source: any = await (await ethers.getContractFactory("MockExposureSource")).deploy();
      await governed("setExposureSources", [[await source.getAddress()]]);
      await source.setFixedExposure(usd(100_000));
      expect(await pool.coveredBookPrincipal()).to.equal(usd(100_000));
      expect(await pool.backstopFloor()).to.equal(usd(5_000));
      await setFloorInputs(a, usd(7_000), 0n, usd(50_000));
      expect(await pool.backstopFloor()).to.equal(usd(7_000));
      await setFloorInputs(a, 0n, 0n, usd(200_000), ethers.id("m2"));
      expect(await pool.coveredBookPrincipal()).to.equal(usd(200_000));
      expect(await pool.backstopFloor()).to.equal(usd(10_000));
      await governed("setFloorBps", [1_000n]);
      expect(await pool.backstopFloor()).to.equal(usd(20_000));
    });

    it("a source that cannot answer counts as nothing, and does not block deposits", async function () {
      await governed("setExposureSources", [[await usdc.getAddress()]]); // has no poolExposure()
      expect(await pool.coveredBookPrincipal()).to.equal(0n);
      await fund(a, usdc, a.treasury, TAG.INTERCHANGE, usd(10));
      expect(await pool.balanceOf(BACKSTOP)).to.equal(usd(5));
    });
  });

  describe("draws (13e)", function () {
    beforeEach(async function () {
      await fund(a, usdc, a.lendingCo, TAG.RECOVERY, usd(10_000));
      await setFloorInputs(a, 0n, usd(8_000), 0n);
    });

    it("only Lending Co.'s Registered Draw Address requests, once per period", async function () {
      for (const who of [a.lendingCo, a.lossReserve, a.signerA, a.treasury, ctx.outsider]) {
        await expect(pool.connect(who).requestDraw(1, usd(1), ethers.ZeroHash)).to.be.revertedWithCustomError(pool, "AssurancePoolNotDrawAddress");
      }
      await expect(pool.connect(a.drawer).requestDraw(1, usd(1_000), ethers.id("e")))
        .to.emit(pool, "DrawRequested").withArgs(0n, 1n, usd(1_000), ethers.id("e"));
      await expect(pool.connect(a.drawer).requestDraw(1, usd(1), ethers.ZeroHash)).to.be.revertedWithCustomError(pool, "AssurancePoolPeriodAlreadyDrawn");
      await expect(pool.connect(a.drawer).requestDraw(2, 0n, ethers.ZeroHash)).to.be.revertedWithCustomError(pool, "AssurancePoolInvalidAmount");
      expect(await pool.pendingDrawRequests()).to.equal(usd(1_000));
    });

    it("approved by one signer, released by another, to the loss-reserve address only", async function () {
      await pool.connect(a.drawer).requestDraw(1, usd(1_000), ethers.id("e"));
      await expect(pool.connect(a.drawer).approveDraw(0, usd(1_000))).to.be.revertedWithCustomError(pool, "AssurancePoolNotSigner");
      await expect(pool.connect(a.signerA).approveDraw(0, usd(1_001))).to.be.revertedWithCustomError(pool, "AssurancePoolBadDrawState");
      await expect(pool.connect(a.signerA).approveDraw(0, usd(800)))
        .to.emit(pool, "DrawApproved").withArgs(0n, usd(800), a.signerA.address);
      expect(await pool.pendingDrawRequests()).to.equal(0n);
      expect(await pool.approvedUnpaidDraws()).to.equal(usd(800));
      expect(await pool.backstopBalance()).to.equal(usd(9_200));
      await expect(pool.connect(a.signerA).approveDraw(0, usd(800))).to.be.revertedWithCustomError(pool, "AssurancePoolBadDrawState");

      await expect(pool.connect(a.signerA).releaseDraw(0)).to.be.revertedWithCustomError(pool, "AssurancePoolSameSigner");
      await expect(pool.connect(a.drawer).releaseDraw(0)).to.be.revertedWithCustomError(pool, "AssurancePoolNotSigner");
      await expect(pool.connect(a.signerB).releaseDraw(0))
        .to.emit(pool, "DrawReleased").withArgs(0n, usd(800), a.lossReserve.address, a.signerB.address);
      expect(await usdc.balanceOf(a.lossReserve.address)).to.equal(usd(800));
      // The disputed 200 stayed in the backstop.
      expect(await pool.balanceOf(BACKSTOP)).to.equal(usd(9_200));
      expect(await pool.approvedUnpaidDraws()).to.equal(0n);
      await expect(pool.connect(a.signerC).releaseDraw(0)).to.be.revertedWithCustomError(pool, "AssurancePoolBadDrawState");
    });

    it("approving zero closes a fully disputed request", async function () {
      await pool.connect(a.drawer).requestDraw(1, usd(1_000), ethers.id("e"));
      await pool.connect(a.signerA).approveDraw(0, 0n);
      expect((await pool.drawAt(0)).status).to.equal(4n); // Closed
      expect(await pool.pendingDrawRequests()).to.equal(0n);
      expect(await pool.balanceOf(BACKSTOP)).to.equal(usd(10_000));
    });

    it("releases in request order", async function () {
      await pool.connect(a.drawer).requestDraw(1, usd(100), ethers.ZeroHash);
      await pool.connect(a.drawer).requestDraw(2, usd(200), ethers.ZeroHash);
      await pool.connect(a.signerA).approveDraw(1, usd(200));
      await expect(pool.connect(a.signerB).releaseDraw(1)).to.be.revertedWithCustomError(pool, "AssurancePoolDrawOutOfOrder");
      await pool.connect(a.signerA).approveDraw(0, usd(100));
      await pool.connect(a.signerB).releaseDraw(0);
      await pool.connect(a.signerB).releaseDraw(1);
      // A closed request is stepped over.
      await pool.connect(a.drawer).requestDraw(3, usd(50), ethers.ZeroHash);
      await pool.connect(a.drawer).requestDraw(4, usd(60), ethers.ZeroHash);
      await pool.connect(a.signerA).approveDraw(2, 0n);
      await pool.connect(a.signerA).approveDraw(3, usd(60));
      await pool.connect(a.signerB).releaseDraw(3);
      expect(await usdc.balanceOf(a.lossReserve.address)).to.equal(usd(360));
    });

    it("reverts above availableCoverage() at approval and at release", async function () {
      await pool.connect(a.drawer).requestDraw(1, usd(9_000), ethers.ZeroHash);
      // Coverage cap is 8,000.
      await expect(pool.connect(a.signerA).approveDraw(0, usd(8_001))).to.be.revertedWithCustomError(pool, "AssurancePoolAboveCoverage");
      await pool.connect(a.signerA).approveDraw(0, usd(8_000));
      // The cap is cut before release: the release refuses.
      await setFloorInputs(a, 0n, usd(5_000), 0n, ethers.id("cut"));
      await expect(pool.connect(a.signerB).releaseDraw(0)).to.be.revertedWithCustomError(pool, "AssurancePoolAboveCoverage");
      await setFloorInputs(a, 0n, usd(8_000), 0n, ethers.id("restored"));
      await pool.connect(a.signerB).releaseDraw(0);
      expect(await pool.balanceOf(BACKSTOP)).to.equal(usd(2_000));
    });
  });

  describe("Assurance grants (13e)", function () {
    beforeEach(async function () {
      await fund(a, usdc, a.treasury, TAG.BOARD_ALLOCATION, usd(1_000));
    });

    it("two signers, from MEMBER_ASSURANCE only, to the disbursement address, once per grant", async function () {
      const g = ethers.id("grant-1");
      await expect(pool.connect(a.lendingCo).releaseAssurance(g, usd(100), ethers.ZeroHash)).to.be.revertedWithCustomError(pool, "AssurancePoolNotSigner");
      await pool.connect(a.signerA).releaseAssurance(g, usd(100), ethers.id("ev"));
      expect(await usdc.balanceOf(a.disbursement.address)).to.equal(0n);
      await expect(pool.connect(a.signerA).releaseAssurance(g, usd(100), ethers.id("ev"))).to.be.revertedWithCustomError(pool, "AssurancePoolSameSigner");
      await expect(pool.connect(a.signerB).releaseAssurance(g, usd(100), ethers.id("ev")))
        .to.emit(pool, "AssuranceReleased").withArgs(g, usd(100), ethers.id("ev"), a.disbursement.address, a.signerA.address);
      expect(await usdc.balanceOf(a.disbursement.address)).to.equal(usd(100));
      expect(await pool.balanceOf(ASSURANCE)).to.equal(usd(400));
      expect(await pool.balanceOf(BACKSTOP)).to.equal(usd(500));
      await expect(pool.connect(a.signerA).releaseAssurance(g, usd(1), ethers.id("ev"))).to.be.revertedWithCustomError(pool, "AssurancePoolGrantAlreadyPaid");
    });

    it("reverts when MEMBER_ASSURANCE is short, with the backstop full", async function () {
      await expect(pool.connect(a.signerA).releaseAssurance(ethers.id("big"), usd(501), ethers.ZeroHash))
        .to.be.revertedWithCustomError(pool, "AssurancePoolCompartmentShort");
    });
  });

  describe("transfers between compartments (13f)", function () {
    beforeEach(async function () {
      await fund(a, usdc, a.treasury, TAG.BOARD_ALLOCATION, usd(2_000));
    });

    it("proposed by one signer, executed by another after the delay", async function () {
      await expect(pool.connect(a.lendingCo).proposeTransfer(BACKSTOP, ASSURANCE, usd(100), ethers.ZeroHash)).to.be.revertedWithCustomError(pool, "AssurancePoolNotSigner");
      await expect(pool.connect(a.signerA).proposeTransfer(BACKSTOP, ethers.encodeBytes32String("NOPE"), usd(100), ethers.ZeroHash)).to.be.revertedWithCustomError(pool, "AssurancePoolUnknownCompartment");
      await expect(pool.connect(a.signerA).proposeTransfer(BACKSTOP, BACKSTOP, usd(100), ethers.ZeroHash)).to.be.revertedWithCustomError(pool, "AssurancePoolInvalidAmount");
      await expect(pool.connect(a.signerA).proposeTransfer(BACKSTOP, ASSURANCE, usd(100), ethers.id("r")))
        .to.emit(pool, "TransferProposed").withArgs(0n, BACKSTOP, ASSURANCE, usd(100), ethers.id("r"), a.signerA.address);
      await expect(pool.connect(a.signerA).executeTransfer(0)).to.be.revertedWithCustomError(pool, "AssurancePoolSameSigner");
      await expect(pool.connect(a.signerB).executeTransfer(0)).to.be.revertedWithCustomError(pool, "AssurancePoolTransferTooEarly");
      await advance(14 * DAY);
      await expect(pool.connect(a.signerB).executeTransfer(0))
        .to.emit(pool, "TransferExecuted").withArgs(0n, BACKSTOP, ASSURANCE, usd(100), a.signerB.address);
      expect(await pool.balanceOf(BACKSTOP)).to.equal(usd(900));
      expect(await pool.balanceOf(ASSURANCE)).to.equal(usd(1_100));
      await expect(pool.connect(a.signerC).executeTransfer(0)).to.be.revertedWithCustomError(pool, "AssurancePoolBadTransfer");
    });

    it("into the Credit Backstop: two signers, no delay", async function () {
      await pool.connect(a.signerA).proposeTransfer(ASSURANCE, BACKSTOP, usd(300), ethers.ZeroHash);
      await pool.connect(a.signerB).executeTransfer(0);
      expect(await pool.balanceOf(BACKSTOP)).to.equal(usd(1_300));
    });

    it("never takes the backstop below its floor plus pending draw requests", async function () {
      await setFloorInputs(a, usd(600), usd(1_000), 0n);
      await pool.connect(a.drawer).requestDraw(1, usd(200), ethers.ZeroHash);
      // 1,000 held; floor 600 + pending 200 leaves 200 movable.
      await pool.connect(a.signerA).proposeTransfer(BACKSTOP, ASSURANCE, usd(201), ethers.ZeroHash);
      await pool.connect(a.signerA).proposeTransfer(BACKSTOP, ASSURANCE, usd(200), ethers.ZeroHash);
      await advance(14 * DAY);
      await expect(pool.connect(a.signerB).executeTransfer(0)).to.be.revertedWithCustomError(pool, "AssurancePoolBelowFloor");
      await pool.connect(a.signerB).executeTransfer(1);
      expect(await pool.backstopBalance()).to.equal(usd(800));
    });

    it("a governed transfer delay can only lengthen", async function () {
      await approve("setTransferDelay", [BigInt(13 * DAY)]);
      await expect(pool.connect(gov).setTransferDelay(13 * DAY)).to.be.revertedWithCustomError(pool, "AssurancePoolInvalidAmount");
      await governed("setTransferDelay", [BigInt(20 * DAY)]);
      await pool.connect(a.signerA).proposeTransfer(BACKSTOP, ASSURANCE, usd(1), ethers.ZeroHash);
      await advance(14 * DAY);
      await expect(pool.connect(a.signerB).executeTransfer(0)).to.be.revertedWithCustomError(pool, "AssurancePoolTransferTooEarly");
    });
  });

  describe("security pause (13g)", function () {
    beforeEach(async function () {
      await fund(a, usdc, a.treasury, TAG.BOARD_ALLOCATION, usd(2_000));
      await setFloorInputs(a, 0n, usd(1_000), 0n);
      await pool.connect(a.drawer).requestDraw(1, usd(100), ethers.ZeroHash);
      await pool.connect(a.signerA).approveDraw(0, usd(100));
      await pool.connect(a.signerA).proposeTransfer(ASSURANCE, BACKSTOP, usd(10), ethers.ZeroHash);
    });

    async function pauseBy(first: any, second: any, fn = "pause") {
      await pool.connect(first)[fn]();
      return pool.connect(second)[fn]();
    }

    it("takes two signers, blocks only outflows and transfers, and lapses after 72 hours", async function () {
      await expect(pool.connect(a.lendingCo).pause()).to.be.revertedWithCustomError(pool, "AssurancePoolNotSigner");
      await pool.connect(a.signerA).pause();
      expect(await pool.paused()).to.equal(false);
      await expect(pool.connect(a.signerA).pause()).to.be.revertedWithCustomError(pool, "AssurancePoolSameSigner");
      await expect(pool.connect(a.signerB).pause()).to.emit(pool, "SecurityPaused");
      expect(await pool.paused()).to.equal(true);

      await expect(pool.connect(a.signerB).releaseDraw(0)).to.be.revertedWithCustomError(pool, "AssurancePoolPaused");
      await expect(pool.connect(a.signerB).executeTransfer(0)).to.be.revertedWithCustomError(pool, "AssurancePoolPaused");
      await pool.connect(a.signerA).releaseAssurance(ethers.id("g"), usd(10), ethers.ZeroHash);
      await expect(pool.connect(a.signerB).releaseAssurance(ethers.id("g"), usd(10), ethers.ZeroHash)).to.be.revertedWithCustomError(pool, "AssurancePoolPaused");
      // Money still comes in, and Lending Co. can still ask.
      await fund(a, usdc, a.treasury, TAG.INTERCHANGE, usd(10));
      await pool.connect(a.drawer).requestDraw(2, usd(5), ethers.ZeroHash);

      await advance(72 * 60 * 60);
      expect(await pool.paused()).to.equal(false);
      await pool.connect(a.signerB).releaseDraw(0);
    });

    it("renews only by two signers while it stands, and can be lifted early by two", async function () {
      await expect(pool.connect(a.signerA).renewPause()).to.be.revertedWithCustomError(pool, "AssurancePoolNotPaused");
      await pauseBy(a.signerA, a.signerB);
      await advance(70 * 60 * 60);
      await pool.connect(a.signerB).renewPause();
      await expect(pool.connect(a.signerB).renewPause()).to.be.revertedWithCustomError(pool, "AssurancePoolSameSigner");
      await pool.connect(a.signerC).renewPause();
      await advance(70 * 60 * 60);
      expect(await pool.paused()).to.equal(true);
      await pool.connect(a.signerA).unpause();
      expect(await pool.paused()).to.equal(true);
      await pool.connect(a.signerC).unpause();
      expect(await pool.paused()).to.equal(false);
      await pool.connect(a.signerB).releaseDraw(0);
    });
  });

  describe("prohibited (13g)", function () {
    it("has no sweep, rescue, withdraw, approve or admin transfer", async function () {
      const names = pool.interface.fragments
        .filter((f: any) => f.type === "function" && f.stateMutability !== "view" && f.stateMutability !== "pure")
        .map((f: any) => f.name)
        .sort();
      expect(names).to.deep.equal([
        "addCompartment", "approveAction", "approveDraw", "deposit", "executeTransfer", "initialize",
        "pause", "proposeTransfer", "releaseAssurance", "releaseDraw", "removeCompartment", "renewPause",
        "requestDraw", "setAllocation", "setAssuranceDisbursementAddress", "setExposureSources",
        "setFloorBps", "setFloorInputs", "setGovernance", "setLendingCoAddresses", "setNetworkRegistry",
        "setPayer", "setSigner", "setTransferDelay", "unpause", "upgradeTo", "upgradeToAndCall",
      ].sort());
    });

    it("never approves its asset to anybody", async function () {
      await fund(a, usdc, a.treasury, TAG.BOARD_ALLOCATION, usd(100));
      for (const who of [a.signerA, a.lossReserve, a.disbursement, a.timelock]) {
        const address = typeof who.getAddress === "function" ? await who.getAddress() : who.address;
        expect(await usdc.allowance(await pool.getAddress(), address)).to.equal(0n);
      }
    });
  });
});
