import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../../helpers/phase0-fixture";
import { deployCore } from "../deep/deep-setup";
import { issuerProxyOptions } from "../../helpers/issuers";
import { CA, P, CA_BANDS, CYCLE, params, deployRateSchedule } from "./rates";
import {
  deployAssurancePool, setFloorInputs, fund, balances, advance,
  AssuranceSetup, BACKSTOP, ASSURANCE, TAG, MASK, DAY, ASSURANCE_DELAY,
} from "../../helpers/assurance";
import { pledgeSigned } from "../../helpers/pledge";

/*
 * Compliance section 13 (Assurance Contracts), acceptance tests 31-33.
 *
 * The co-op's AssurancePool: CREDIT_BACKSTOP and MEMBER_ASSURANCE compartments, two-person control
 * on everything, a 7-day governance timelock, and walled off from every credit, savings, payout and
 * bond path. The unit spec for each function is test/peripherals/AssurancePool.spec.ts.
 *
 * The fuzz runs are bounded randomized sequences: FUZZ_STEPS (default 300) calls, seeded by
 * FUZZ_SEED (default 13), so a failure is reproducible.
 */
const ONE_USDC = 10n ** 6n;
const usd = (n: number | bigint) => BigInt(n) * ONE_USDC;
const STEPS = Number(process.env.FUZZ_STEPS ?? 300);
const SEED = Number(process.env.FUZZ_SEED ?? 13);
const SAVINGS = ethers.encodeBytes32String("SAVINGS");
const INCOME_KIND = ethers.encodeBytes32String("INCOME");
const POOL_SHARE = ethers.encodeBytes32String("POOL_SHARE");
const BOND = ethers.encodeBytes32String("BOND");

/** mulberry32: small, seeded, good enough to pick calls. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(xs: T[]): T => xs[Math.floor(next() * xs.length)],
  };
}

/** The pool's invariant (13b): every unit held belongs to exactly one compartment. */
async function expectInvariant(pool: any, usdc: any) {
  const b = await balances(pool);
  expect(b.sum).to.equal(await usdc.balanceOf(await pool.getAddress()));
  expect(b.sum).to.equal(await pool.totalAccounted());
}

describe("COMPLIANCE section 13: Assurance Contracts (acceptance 31-33)", function () {
  /* ================================================================ 31 */

  describe("31. floor first", function () {
    let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
    let a: AssuranceSetup, revolving: any, registry: any;
    const INCOME = 1;

    beforeEach(async function () {
      ctx = await deployPhase0Network();
      // The covered book is read from the issuers: a RevolvingIssuer with an income-backed tier,
      // through the CollateralRegistry, which values each member's debt by kind.
      const coop = (await ethers.getSigners())[8];
      const R = await ethers.getContractFactory("RevolvingIssuer");
      revolving = await upgrades.deployProxy(R, [await ctx.stableCredit.getAddress(), coop.address], { ...(await issuerProxyOptions("RevolvingIssuer")), kind: "uups" });
      await ctx.networkRegistry.registerIssuer(await revolving.getAddress(), await ctx.stableCredit.getAddress());
      await ctx.access.grantOperator(await revolving.getAddress());
      for (const [name, rate] of [["SAVINGS", 0n], ["INCOME", 150n], ["BOOST", 300n]] as const) {
        await revolving.connect(ctx.operator).addTier(ethers.encodeBytes32String(name), rate, CYCLE);
      }
      const rates = await deployRateSchedule(ctx.admin.address);
      await rates.setProduct(CA, P("INCOME"), params({ listMonthlyBps: 150 }), CA_BANDS);
      await rates.setProduct(CA, P("BOOST"), params({ listMonthlyBps: 300 }), CA_BANDS);
      await rates.setProduct(CA, P("REVOLVING"), params({ listMonthlyBps: 0 }), CA_BANDS);
      await revolving.connect(ctx.operator).setPricing(await rates.getAddress(), P("REVOLVING"));
      await revolving.connect(ctx.operator).setTierProduct(INCOME, P("INCOME"));
      await revolving.connect(ctx.operator).setTierProduct(2, P("BOOST"));
      await ctx.networkRegistry.grantRole(await ctx.networkRegistry.STATE_ATTESTER_ROLE(), ctx.admin.address);
      await ctx.networkRegistry.attestStateCode(ctx.member.address, CA);

      registry = await upgrades.deployProxy(await ethers.getContractFactory("CollateralRegistry"),
        [ctx.admin.address, await ctx.networkRegistry.getAddress()], { kind: "uups" });
      await registry.registerCollateralType(SAVINGS, 1, 10_000n, 10n ** 18n);
      await registry.registerCollateralType(INCOME_KIND, 0, 0n, 0n);

      a = await deployAssurancePool(ctx.usdc, ctx.networkRegistry, { exposureSources: [await registry.getAddress()] });
    });

    async function unsecured(amount: bigint) {
      await revolving.connect(ctx.operator).openLine(ctx.member.address, [0n, amount, 0n], 365 * DAY, CYCLE);
      await ctx.stableCredit.connect(ctx.member).transfer(ctx.counterparty.address, amount);
      await registry.refresh(ctx.member.address);
    }

    it("covered book $100,000 (floor $5,000), backstop $3,000, 50/50: $4,000 of interchange fills $2,000 first, then $1,000 each", async function () {
      await unsecured(usd(100_000));
      expect(await a.pool.coveredBookPrincipal()).to.equal(usd(100_000));
      expect(await a.pool.backstopFloor()).to.equal(usd(5_000));

      // A RECOVERY deposit goes 100% to the Credit Backstop.
      await fund(a, ctx.usdc, a.lendingCo, TAG.RECOVERY, usd(3_000));
      expect(await a.pool.balanceOf(BACKSTOP)).to.equal(usd(3_000));
      expect(await a.pool.balanceOf(ASSURANCE)).to.equal(0n);

      await ctx.usdc.mint(a.treasury.address, usd(4_000));
      await ctx.usdc.connect(a.treasury).approve(await a.pool.getAddress(), usd(4_000));
      await expect(a.pool.connect(a.treasury).deposit(TAG.INTERCHANGE, usd(4_000)))
        .to.emit(a.pool, "CompartmentCredited").withArgs(TAG.INTERCHANGE, BACKSTOP, usd(2_000)) // the floor fill
        .and.to.emit(a.pool, "CompartmentCredited").withArgs(TAG.INTERCHANGE, BACKSTOP, usd(1_000)) // its 50%
        .and.to.emit(a.pool, "CompartmentCredited").withArgs(TAG.INTERCHANGE, ASSURANCE, usd(1_000));
      expect(await a.pool.balanceOf(BACKSTOP)).to.equal(usd(6_000));
      expect(await a.pool.balanceOf(ASSURANCE)).to.equal(usd(1_000));

      // Above the floor, a RECOVERY deposit still goes wholly to the backstop.
      await fund(a, ctx.usdc, a.lendingCo, TAG.RECOVERY, usd(500));
      expect(await a.pool.balanceOf(BACKSTOP)).to.equal(usd(6_500));
      expect(await a.pool.balanceOf(ASSURANCE)).to.equal(usd(1_000));
      await expectInvariant(a.pool, ctx.usdc);
    });

    it("a credit-enhancement fee fills the floor too, net of approved unpaid draws", async function () {
      await unsecured(usd(100_000));
      await fund(a, ctx.usdc, a.lendingCo, TAG.RECOVERY, usd(5_000));
      await setFloorInputs(a, 0n, usd(10_000), 0n);
      await a.pool.connect(a.drawer).requestDraw(1, usd(1_000), ethers.id("charge-offs"));
      await a.pool.connect(a.signerA).approveDraw(0, usd(1_000));
      // backstopBalance() is 5,000 less the 1,000 approved and unpaid: 1,000 short of the floor.
      expect(await a.pool.backstopBalance()).to.equal(usd(4_000));
      await fund(a, ctx.usdc, a.lendingCo, TAG.CREDIT_ENHANCEMENT_FEE, usd(3_000));
      expect(await a.pool.balanceOf(BACKSTOP)).to.equal(usd(5_000 + 1_000 + 1_000));
      expect(await a.pool.balanceOf(ASSURANCE)).to.equal(usd(1_000));
    });

    it("with no unsecured credit live, backstopFloor() = 0 and deposits split 50/50", async function () {
      expect(await a.pool.coveredBookPrincipal()).to.equal(0n);
      expect(await a.pool.backstopFloor()).to.equal(0n);
      await fund(a, ctx.usdc, a.treasury, TAG.INTERCHANGE, usd(1_000));
      expect(await a.pool.balanceOf(BACKSTOP)).to.equal(usd(500));
      expect(await a.pool.balanceOf(ASSURANCE)).to.equal(usd(500));

      // The floor follows the book: $10,000 of unsecured credit sets it at $500, which the
      // backstop already holds, so the next deposit splits 50/50 again.
      await unsecured(usd(10_000));
      expect(await a.pool.backstopFloor()).to.equal(usd(500));
      await fund(a, ctx.usdc, a.treasury, TAG.BOARD_ALLOCATION, usd(1_000));
      expect(await a.pool.balanceOf(BACKSTOP)).to.equal(usd(1_000));
      expect(await a.pool.balanceOf(ASSURANCE)).to.equal(usd(1_000));
    });

    it("a mid-year change lowering the Credit Backstop share reverts; raising it, or lowering it in a new program year, does not", async function () {
      // Through the real timelock, with the board proposing and two signers approving.
      await expect(a.governed("setAllocation", [[4_000, 6_000]]))
        .to.be.revertedWith("TimelockController: underlying transaction reverted");
      expect(await a.pool.allocationOf(BACKSTOP)).to.equal(5_000n);

      await a.governed("setAllocation", [[6_000, 4_000]]);
      expect(await a.pool.allocationOf(BACKSTOP)).to.equal(6_000n);
      // Back down to 5,000 inside the same year is still a lowering.
      await expect(a.governed("setAllocation", [[5_000, 5_000]]))
        .to.be.revertedWith("TimelockController: underlying transaction reverted");

      const year = await a.pool.currentProgramYear();
      const start = await a.pool.programYearStart();
      const latest = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
      // Into the next program year, less the timelock's own wait.
      await advance(Number(start + (year + 1n) * BigInt(365 * DAY) - latest) - ASSURANCE_DELAY + 1);
      await expect(a.governed("setAllocation", [[4_000, 6_000]])).to.emit(a.pool, "AllocationSet");
      expect(await a.pool.allocationOf(BACKSTOP)).to.equal(4_000n);
    });
  });

  /* ================================================================ 32 */

  describe("32. walls and draws", function () {
    let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
    let a: AssuranceSetup, pool: any, usdc: any;

    beforeEach(async function () {
      ctx = await deployPhase0Network();
      usdc = ctx.usdc;
      a = await deployAssurancePool(usdc, ctx.networkRegistry);
      pool = a.pool;
      // Member Assurance $500, Credit Backstop $50,000.
      await fund(a, usdc, a.treasury, TAG.BOARD_ALLOCATION, usd(1_000));
      await fund(a, usdc, a.lendingCo, TAG.RECOVERY, usd(49_500));
      expect(await pool.balanceOf(ASSURANCE)).to.equal(usd(500));
      expect(await pool.balanceOf(BACKSTOP)).to.equal(usd(50_000));
    });

    it("releaseAssurance of $600 against Member Assurance of $500 reverts, and never reaches the backstop", async function () {
      await expect(pool.connect(a.signerA).releaseAssurance(ethers.id("g-600"), usd(600), ethers.id("ev")))
        .to.be.revertedWithCustomError(pool, "AssurancePoolCompartmentShort")
        .withArgs(ASSURANCE, usd(500), usd(600));
      // $500 pays, from Member Assurance alone.
      await pool.connect(a.signerA).releaseAssurance(ethers.id("g-500"), usd(500), ethers.id("ev"));
      await pool.connect(a.signerB).releaseAssurance(ethers.id("g-500"), usd(500), ethers.id("ev"));
      expect(await usdc.balanceOf(a.disbursement.address)).to.equal(usd(500));
      expect(await pool.balanceOf(BACKSTOP)).to.equal(usd(50_000));
      await expect(pool.connect(a.signerA).releaseAssurance(ethers.id("g-1"), 1n, ethers.id("ev")))
        .to.be.revertedWithCustomError(pool, "AssurancePoolCompartmentShort");
    });

    it("executeTransfer from the backstop: below floor + pending draws reverts; by the proposer reverts; before 14 days reverts; a compliant one succeeds", async function () {
      // Floor $45,000 (5% of an attested $900,000 book), and a $3,000 draw request pending.
      await setFloorInputs(a, 0n, usd(20_000), usd(900_000));
      expect(await pool.backstopFloor()).to.equal(usd(45_000));
      await pool.connect(a.drawer).requestDraw(1, usd(3_000), ethers.id("p1"));
      // So 50,000 - 45,000 - 3,000 = 2,000 may move.
      await pool.connect(a.signerA).proposeTransfer(BACKSTOP, ASSURANCE, usd(2_001), ethers.id("resolution-1"));
      await pool.connect(a.signerA).proposeTransfer(BACKSTOP, ASSURANCE, usd(2_000), ethers.id("resolution-2"));

      await expect(pool.connect(a.signerB).executeTransfer(1)).to.be.revertedWithCustomError(pool, "AssurancePoolTransferTooEarly");
      await advance(14 * DAY);
      await expect(pool.connect(a.signerA).executeTransfer(1)).to.be.revertedWithCustomError(pool, "AssurancePoolSameSigner");
      await expect(pool.connect(a.signerB).executeTransfer(0))
        .to.be.revertedWithCustomError(pool, "AssurancePoolBelowFloor").withArgs(usd(50_000), usd(50_001));
      await pool.connect(a.signerB).executeTransfer(1);
      expect(await pool.balanceOf(BACKSTOP)).to.equal(usd(48_000));
      expect(await pool.balanceOf(ASSURANCE)).to.equal(usd(2_500));
      await expectInvariant(pool, usdc);
    });

    it("a draw above availableCoverage() reverts; releaseDraw by the approver reverts; paid only to the loss-reserve address, from the backstop", async function () {
      await setFloorInputs(a, 0n, usd(10_000), 0n);
      expect(await pool.availableCoverage()).to.equal(usd(10_000));
      await pool.connect(a.drawer).requestDraw(7, usd(12_000), ethers.id("charge-offs-7"));
      await expect(pool.connect(a.signerA).approveDraw(0, usd(12_000)))
        .to.be.revertedWithCustomError(pool, "AssurancePoolAboveCoverage").withArgs(usd(12_000), usd(10_000));
      await pool.connect(a.signerA).approveDraw(0, usd(9_000)); // 3,000 disputed
      await expect(pool.connect(a.signerA).releaseDraw(0)).to.be.revertedWithCustomError(pool, "AssurancePoolSameSigner");

      const assuranceBefore = await pool.balanceOf(ASSURANCE);
      await expect(pool.connect(a.signerB).releaseDraw(0))
        .to.emit(pool, "DrawReleased").withArgs(0n, usd(9_000), a.lossReserve.address, a.signerB.address);
      expect(await usdc.balanceOf(a.lossReserve.address)).to.equal(usd(9_000));
      // The disputed remainder stays in the backstop; Member Assurance never moved.
      expect(await pool.balanceOf(BACKSTOP)).to.equal(usd(41_000));
      expect(await pool.balanceOf(ASSURANCE)).to.equal(assuranceBefore);
    });

    it("no function pays a draw from Member Assurance or to any other address", async function () {
      // Empty the backstop's coverage: everything in it is approved for one draw.
      await setFloorInputs(a, 0n, usd(50_000), 0n);
      await pool.connect(a.drawer).requestDraw(1, usd(50_000), ethers.ZeroHash);
      await pool.connect(a.signerA).approveDraw(0, usd(50_000));
      await pool.connect(a.signerB).releaseDraw(0);
      expect(await pool.balanceOf(BACKSTOP)).to.equal(0n);
      // $500 sits in Member Assurance, and a draw cannot reach it.
      await pool.connect(a.drawer).requestDraw(2, usd(100), ethers.ZeroHash);
      expect(await pool.availableCoverage()).to.equal(0n);
      await expect(pool.connect(a.signerA).approveDraw(1, usd(100))).to.be.revertedWithCustomError(pool, "AssurancePoolAboveCoverage");
      expect(await pool.balanceOf(ASSURANCE)).to.equal(usd(500));
      // The only functions that pay out are releaseDraw, releaseAssurance and executeTransfer, and the
      // first two name no recipient: the recipient is the registered address.
      for (const fn of ["releaseDraw", "releaseAssurance"]) {
        const inputs = pool.interface.getFunction(fn)!.inputs.map((i: any) => i.type);
        expect(inputs).to.not.include("address");
      }
    });

    it("fuzz: sum of compartments == assets after every call, and money leaves only to the registered addresses", async function () {
      const r = rng(SEED);
      await setFloorInputs(a, usd(1_000), usd(30_000), usd(200_000), ethers.id("fuzz-month"));
      const actors = [a.signerA, a.signerB, a.signerC, a.drawer, a.lossReserve, a.lendingCo, a.treasury, a.disbursement, ctx.outsider, ctx.member];
      const signers = [a.signerA, a.signerB, a.signerC];
      const lossReserve0 = await usdc.balanceOf(a.lossReserve.address);
      const disbursement0 = await usdc.balanceOf(a.disbursement.address);
      let paidDraws = 0n, paidGrants = 0n, deposited = 0n;
      let period = 100;
      for (const who of [a.lendingCo, a.treasury]) {
        await usdc.mint(who.address, usd(10_000_000));
        await usdc.connect(who).approve(await pool.getAddress(), ethers.MaxUint256);
      }
      const startHeld = await usdc.balanceOf(await pool.getAddress());

      for (let step = 0; step < STEPS; step++) {
        const op = r.int(11);
        const who = r.next() < 0.75 ? r.pick(signers) : r.pick(actors);
        const amount = usd(1 + r.int(5_000));
        const draws = Number(await pool.drawCount());
        const transfers = Number(await pool.transferCount());
        try {
          if (op === 0) {
            const tag = r.int(4);
            const payer = tag <= 1 ? a.lendingCo : a.treasury;
            await pool.connect(r.next() < 0.8 ? payer : r.pick(actors)).deposit(tag, amount);
            deposited += amount;
          } else if (op === 1) {
            await pool.connect(r.next() < 0.8 ? a.drawer : who).requestDraw(period++, amount, ethers.id(`d${step}`));
          } else if (op === 2 && draws > 0) {
            await pool.connect(who).approveDraw(r.int(draws), r.next() < 0.2 ? 0n : amount);
          } else if (op === 3 && draws > 0) {
            const id = r.int(draws);
            const tx = await pool.connect(who).releaseDraw(id);
            const rc = await tx.wait();
            for (const log of rc.logs) {
              const parsed = pool.interface.parseLog(log);
              if (parsed?.name === "DrawReleased") {
                expect(parsed.args.to).to.equal(a.lossReserve.address);
                paidDraws += parsed.args.amount;
              }
            }
          } else if (op === 4) {
            const grant = ethers.id(`g${r.int(8)}`);
            const amt = usd(1 + r.int(400));
            const tx = await pool.connect(who).releaseAssurance(grant, amt, ethers.ZeroHash);
            const rc = await tx.wait();
            for (const log of rc.logs) {
              const parsed = pool.interface.parseLog(log);
              if (parsed?.name === "AssuranceReleased") {
                expect(parsed.args.to).to.equal(a.disbursement.address);
                paidGrants += parsed.args.amount;
              }
            }
          } else if (op === 5) {
            const ids = [BACKSTOP, ASSURANCE];
            const from = r.pick(ids);
            await pool.connect(who).proposeTransfer(from, from === BACKSTOP ? ASSURANCE : BACKSTOP, amount, ethers.ZeroHash);
          } else if (op === 6 && transfers > 0) {
            await pool.connect(who).executeTransfer(r.int(transfers));
          } else if (op === 7) {
            await pool.connect(who)[r.pick(["pause", "renewPause", "unpause"])]();
          } else if (op === 8) {
            await advance(r.int(20) * DAY);
          } else if (op === 9) {
            await pool.connect(who).setFloorInputs(usd(r.int(3_000)), usd(r.int(60_000)), usd(r.int(600_000)), ethers.id(`m${r.int(4)}`));
          } else {
            await pool.connect(who).approveAction(ethers.id(`x${r.int(3)}`));
          }
        } catch (e: any) {
          // Reverts are expected; only a broken invariant fails the run.
          if (!String(e.message).includes("reverted") && !String(e.message).includes("revert")) throw e;
        }
        await expectInvariant(pool, usdc);
        expect(await pool.backstopBalance()).to.be.lte(await pool.balanceOf(BACKSTOP));
      }
      // Every unit that left went to the loss-reserve address (draws) or the disbursement address
      // (grants), and nowhere else.
      expect((await usdc.balanceOf(a.lossReserve.address)) - lossReserve0).to.equal(paidDraws);
      expect((await usdc.balanceOf(a.disbursement.address)) - disbursement0).to.equal(paidGrants);
      const held = await usdc.balanceOf(await pool.getAddress());
      expect(held).to.equal(startHeld + deposited - paidDraws - paidGrants);
    });
  });

  /* ================================================================ 33 */

  describe("33. no path in or out", function () {
    /** Every money-path contract, wired as deploy wires them, and the co-op's pool beside them. */
    async function deployStack() {
      const core = await deployCore();
      const { ctx, revolving, term, registry: merchants, pool: payoutPool, coop, merchant } = core;
      const usdc = ctx.usdc;
      const a = await deployAssurancePool(usdc, ctx.networkRegistry);

      const clrusd: any = await upgrades.deployProxy(await ethers.getContractFactory("ClearUSDUpgradeable"),
        ["Clear USD", "CLRUSD", 6, 0, 0, ctx.admin.address, ctx.admin.address],
        { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
      const vault: any = await upgrades.deployProxy(await ethers.getContractFactory("ESADepositVault"),
        [await clrusd.getAddress(), ctx.admin.address], { kind: "uups" });
      await clrusd.grantRole(await clrusd.MINTER_ROLE(), await vault.getAddress());
      await clrusd.grantRole(await clrusd.BURNER_ROLE(), await vault.getAddress());
      await vault.setAcceptedToken(await usdc.getAddress(), true);

      const pledges: any = await upgrades.deployProxy(await ethers.getContractFactory("CollateralRegistry"),
        [ctx.admin.address, await ctx.networkRegistry.getAddress()], { kind: "uups" });
      await pledges.registerCollateralType(SAVINGS, 1, 10_000n, 10n ** 18n);
      await pledges.registerCollateralType(POOL_SHARE, 3, 7_000n, 10n ** 18n);
      await pledges.registerCollateralType(INCOME_KIND, 0, 0n, 0n);
      await pledges.setClrusdKind(SAVINGS);
      await pledges.setClrusdToken(await clrusd.getAddress());
      await clrusd.setEncumbranceSource(await pledges.getAddress());
      await revolving.connect(ctx.operator).setExposureSource(await pledges.getAddress());

      const lending: any = await upgrades.deployProxy(await ethers.getContractFactory("LendingPool"),
        [ctx.admin.address, await usdc.getAddress(), "Clear Lending Pool", "clrLP"], { kind: "uups" });
      await lending.setEncumbranceSource(await pledges.getAddress(), POOL_SHARE);

      const bondVault: any = await upgrades.deployProxy(await ethers.getContractFactory("BondVault"),
        [ctx.admin.address, await usdc.getAddress(), 90 * DAY], { kind: "uups" });
      const factory: any = await (await ethers.getContractFactory("BurnerBondFactory")).deploy(await ctx.tokenRegistry.getAddress(), "ipfs://b");
      const deposit: any = await ethers.getContractAt("BurnerBondDeposit", await factory.getUnifiedDepositContract());
      await factory.createCollection(await usdc.getAddress(), "USDC", "USD Coin", "ipfs://b");
      const bond: any = await ethers.getContractAt("BurnerBond", (await factory.getCollectionInfo(await usdc.getAddress())).collectionAddress);
      await bondVault.grantRole(await bondVault.BOND_ROLE(), await deposit.getAddress());
      await bondVault.grantRole(await bondVault.BOND_ROLE(), await bond.getAddress());
      await deposit.setBondVault(await bondVault.getAddress());
      await bond.setBondVault(await bondVault.getAddress());
      await bondVault.setBackstops(coop.address, await payoutPool.getAddress());
      await payoutPool.connect(ctx.admin).setBondVault(await bondVault.getAddress());
      await payoutPool.connect(ctx.admin).setYieldPool(await lending.getAddress());

      const liquidator: any = await upgrades.deployProxy(await ethers.getContractFactory("Liquidator"),
        [ctx.admin.address, await ctx.stableCredit.getAddress(), await clrusd.getAddress(), await vault.getAddress(),
          await usdc.getAddress(), await pledges.getAddress()], { kind: "uups" });
      await clrusd.grantRole(await clrusd.LIQUIDATOR_ROLE(), await liquidator.getAddress());
      await pledges.grantRole(await pledges.OPERATOR_ROLE(), await liquidator.getAddress());
      await lending.grantRole(await lending.LIQUIDATOR_ROLE(), await liquidator.getAddress());
      await ctx.access.grantOperator(await liquidator.getAddress());
      await liquidator.setTrustedSavingsIssuer(await revolving.getAddress(), true);
      await liquidator.setEarnSources(await lending.getAddress(), await bond.getAddress());

      const offers: any = await upgrades.deployProxy(await ethers.getContractFactory("OffersIssuer"),
        [await ctx.stableCredit.getAddress(), coop.address, usd(10), 90 * DAY], { kind: "uups" });
      await ctx.networkRegistry.registerIssuer(await offers.getAddress(), await ctx.stableCredit.getAddress());

      // The money-path list the pool reads (deploy/25 lists the same ones).
      const listed: [any, string][] = [
        [clrusd, "CLRUSD"], [vault, "ESA_VAULT"], [pledges, "PLEDGE"], [liquidator, "LIQUIDATOR"],
        [lending, "LENDING_POOL"], [bondVault, "BOND_VAULT"], [payoutPool, "PAYOUT_POOL"],
        [ctx.stableCredit, "LEDGER"], [bond, "BOND"], [deposit, "BOND_DEPOSIT"],
      ];
      for (const [c, kind] of listed) {
        await ctx.networkRegistry.listMoneyPath(await c.getAddress(), ethers.encodeBytes32String(kind));
      }

      // Some life in the system: savings pledged, a revolving draw at a merchant, a redemption.
      await revolving.connect(ctx.operator).openLine(ctx.member.address, [usd(2_000), 0n, 0n, 0n], 365 * DAY, CYCLE);
      await usdc.mint(ctx.member.address, usd(5_000));
      await usdc.connect(ctx.member).approve(await vault.getAddress(), ethers.MaxUint256);
      await vault.connect(ctx.member).deposit(await usdc.getAddress(), usd(3_000), ctx.member.address);
      await pledgeSigned(pledges, ctx.member.address, SAVINGS, usd(3_000));
      await ctx.stableCredit.connect(ctx.member).transfer(merchant.address, usd(1_000));
      await payoutPool.connect(merchant).redeem(usd(500));

      // The co-op's pool, funded in both compartments.
      await fund(a, usdc, a.treasury, TAG.BOARD_ALLOCATION, usd(4_000));
      await fund(a, usdc, a.lendingCo, TAG.RECOVERY, usd(1_000));

      const contracts: Record<string, any> = {
        CLRUSD: clrusd, ESADepositVault: vault, CollateralRegistry: pledges, Liquidator: liquidator,
        RevolvingIssuer: revolving, TermIssuer: term, OffersIssuer: offers, LendingPool: lending,
        BondVault: bondVault, PayoutPool: payoutPool, ClearCredit: ctx.stableCredit,
        BurnerBond: bond, BurnerBondDeposit: deposit, MerchantRegistry: merchants,
      };
      return { core, ctx, a, usdc, contracts };
    }

    /** A random argument for an ABI type, drawn from the addresses and figures that matter. */
    function argFor(t: any, r: ReturnType<typeof rng>, addresses: string[]): any {
      if (t.baseType === "array") {
        const n = t.arrayLength >= 0 ? t.arrayLength : r.int(3);
        return Array.from({ length: n }, () => argFor(t.arrayChildren, r, addresses));
      }
      if (t.baseType === "tuple") return t.components.map((c: any) => argFor(c, r, addresses));
      if (t.type === "address") return r.pick(addresses);
      if (t.type === "bool") return r.int(2) === 1;
      if (t.type === "string") return "x";
      if (t.type === "bytes") return r.pick(["0x", ethers.hexlify(ethers.randomBytes(65))]);
      if (t.type.startsWith("bytes")) {
        const n = Number(t.type.slice(5));
        const kinds = [SAVINGS, INCOME_KIND, POOL_SHARE, BOND, BACKSTOP, ASSURANCE];
        return n === 32 && r.next() < 0.5 ? r.pick(kinds) : ethers.hexlify(ethers.randomBytes(n));
      }
      if (t.type.startsWith("uint") || t.type.startsWith("int")) {
        const bits = BigInt(Number(t.type.replace(/^u?int/, "")) || 256);
        const max = (t.type.startsWith("u") ? 2n ** bits : 2n ** (bits - 1n)) - 1n;
        const v = r.pick([0n, 1n, 2n, usd(1), usd(100), usd(1_000), usd(5_000), BigInt(r.int(1e9)), max]);
        return v > max ? max : v;
      }
      throw new Error(`no generator for ${t.type}`);
    }

    async function snapshotPool(a: AssuranceSetup, usdc: any) {
      const b = await balances(a.pool);
      return { byId: b.byId, accounted: await a.pool.totalAccounted(), held: await usdc.balanceOf(await a.pool.getAddress()) };
    }

    it("fuzz every function of CLRUSD, the ESA vault, the pledge module, every issuer, the Liquidator, LendingPool, BondVault and PayoutPool: every compartment is unchanged", async function () {
      this.timeout(600_000);
      const { core, ctx, a, usdc, contracts } = await deployStack();
      const r = rng(SEED + 33);
      const callers = [ctx.admin, ctx.operator, ctx.member, ctx.outsider, core.merchant, core.coop, core.funder, a.drawer, a.lendingCo, a.signerA];
      const addresses = [
        ...callers.map((c: any) => c.address), await a.pool.getAddress(), a.lossReserve.address, a.disbursement.address,
        ...(await Promise.all(Object.values(contracts).map((c: any) => c.getAddress()))), ethers.ZeroAddress,
      ];
      const before = await snapshotPool(a, usdc);
      const skip = new Set(["upgradeTo", "upgradeToAndCall", "initialize", "renounceOwnership"]);

      // Every function once with random arguments from a random caller, then STEPS more at random.
      const calls: [string, any, any][] = [];
      for (const [name, c] of Object.entries(contracts)) {
        for (const f of c.interface.fragments) {
          if (f.type !== "function" || f.stateMutability === "view" || f.stateMutability === "pure" || skip.has(f.name)) continue;
          calls.push([name, c, f]);
        }
      }
      const plan = [...calls, ...Array.from({ length: STEPS }, () => r.pick(calls))];
      let ran = 0, succeeded = 0;
      for (const [, c, f] of plan) {
        const args = f.inputs.map((i: any) => argFor(i, r, addresses));
        try {
          await c.connect(r.pick(callers)).getFunction(f.format())(...args, f.payable ? { value: 0 } : {});
          succeeded++;
        } catch {
          // A revert moves nothing; what matters is the pool.
        }
        ran++;
        if (ran % 25 === 0 || ran === plan.length) {
          const now = await snapshotPool(a, usdc);
          expect(now.byId).to.deep.equal(before.byId);
          expect(now.accounted).to.equal(before.accounted);
          // Tokens can be sent to any address, the pool's included; nothing they do credits a
          // compartment, and nothing takes any out.
          expect(now.held >= before.held).to.equal(true);
        }
      }
      expect(calls.length).to.be.greaterThan(200);
      expect(succeeded).to.be.greaterThan(0);
      const after = await snapshotPool(a, usdc);
      expect(after.byId).to.deep.equal(before.byId);
    });

    it("the real paths: savings redemption, payouts, a due-claim draw, liquidation and force settlement leave every compartment unchanged", async function () {
      const { core, ctx, a, usdc, contracts } = await deployStack();
      const before = await snapshotPool(a, usdc);
      const { RevolvingIssuer: revolving, PayoutPool: payoutPool, ESADepositVault: vault, CLRUSD: clrusd, Liquidator: liquidator } = contracts;
      // Payout: the queued claim comes due and the draw refuses rather than reach for anything else.
      await advance(31 * DAY);
      await payoutPool.drawForDueClaim().catch(() => undefined);
      // The member repays: the payout pool first, the rest to Lending Co. -- never the pool.
      await usdc.mint(ctx.member.address, usd(2_000));
      await usdc.connect(ctx.member).approve(await ctx.stableCredit.getAddress(), ethers.MaxUint256);
      await ctx.stableCredit.connect(ctx.member).repayCreditBalance(ctx.member.address, usd(1_000));
      await payoutPool.payNext().catch(() => undefined);
      expect((await snapshotPool(a, usdc)).byId).to.deep.equal(before.byId);
      // Savings redemption.
      await clrusd.connect(ctx.member).approve(await vault.getAddress(), ethers.MaxUint256);
      await vault.connect(ctx.member).redeem(await usdc.getAddress(), usd(500), ctx.member.address);
      // Force settlement and liquidation, where they apply.
      await ctx.stableCredit.connect(ctx.member).transfer(core.merchant.address, usd(800));
      await liquidator.connect(ctx.outsider).settleExcess(ctx.member.address).catch(() => undefined);
      await liquidator.connect(ctx.outsider).liquidate(ctx.member.address, await revolving.getAddress(), 0, SAVINGS).catch(() => undefined);
      const after = await snapshotPool(a, usdc);
      expect(after.byId).to.deep.equal(before.byId);
      expect(after.held).to.equal(before.held);
    });

    it("deposit from any of them reverts, under every tag, even once allowlisted by mistake", async function () {
      const { ctx, a, usdc, contracts } = await deployStack();
      const before = await snapshotPool(a, usdc);
      for (const [name, c] of Object.entries(contracts)) {
        // The merchant registry holds no money; it is in the fuzz set, not the money-path list.
        if (name === "MerchantRegistry") continue;
        const address = await c.getAddress();
        expect(await ctx.networkRegistry.isMoneyPath(address), name).to.equal(true);
        await ethers.provider.send("hardhat_impersonateAccount", [address]);
        await ethers.provider.send("hardhat_setBalance", [address, "0x56BC75E2D63100000"]);
        const as = await ethers.getSigner(address);
        await usdc.mint(address, usd(100));
        await usdc.connect(as).approve(await a.pool.getAddress(), usd(100));
        for (const tag of [TAG.CREDIT_ENHANCEMENT_FEE, TAG.RECOVERY, TAG.INTERCHANGE, TAG.BOARD_ALLOCATION]) {
          await expect(a.pool.connect(as).deposit(tag, usd(1)), `${name} tag ${tag}`).to.be.reverted;
        }
        await ethers.provider.send("hardhat_stopImpersonatingAccount", [address]);
      }
      // Nor can governance make one a payer: one attempt through the real timelock.
      await expect(a.governed("setPayer", [await contracts.PayoutPool.getAddress(), MASK.treasury]))
        .to.be.revertedWith("TimelockController: underlying transaction reverted");
      expect((await snapshotPool(a, usdc)).byId).to.deep.equal(before.byId);
    });

    it("every Lending Co. and Manager role calling anything but requestDraw reverts", async function () {
      const { a, usdc } = await deployStack();
      const pool = a.pool;
      // Clear Capital Management and Clear Capital Holdings hold no role anywhere in the pool.
      const manager = new ethers.Wallet(ethers.id("clear-capital-management"), ethers.provider);
      const holdings = new ethers.Wallet(ethers.id("clear-capital-holdings"), ethers.provider);
      for (const w of [manager, holdings]) await ethers.provider.send("hardhat_setBalance", [w.address, "0x56BC75E2D63100000"]);

      // State where every action is live for a signer: a requested draw, an approved draw, a
      // matured transfer proposal, money in Member Assurance, floor inputs half-proposed.
      await setFloorInputs(a, 0n, usd(5_000), 0n);
      await pool.connect(a.drawer).requestDraw(1, usd(100), ethers.ZeroHash);
      await pool.connect(a.drawer).requestDraw(2, usd(100), ethers.ZeroHash);
      await pool.connect(a.signerA).approveDraw(0, usd(100));
      await pool.connect(a.signerA).proposeTransfer(ASSURANCE, BACKSTOP, usd(10), ethers.ZeroHash);
      await pool.connect(a.signerA).releaseAssurance(ethers.id("g"), usd(10), ethers.ZeroHash);
      await pool.connect(a.signerA).setFloorInputs(1n, usd(5_000), 0n, ethers.id("m"));
      await pool.connect(a.signerA).pause();
      await pool.connect(a.signerA).approveAction(ethers.id("action"));

      const impl = await (await ethers.getContractFactory("AssurancePool")).deploy();
      const good: Record<string, any[]> = {
        addCompartment: [ethers.encodeBytes32String("NEW")],
        approveAction: [ethers.id("action")],
        approveDraw: [1, usd(100)],
        deposit: [TAG.INTERCHANGE, usd(1)],
        executeTransfer: [0],
        initialize: [await usdc.getAddress(), await a.timelock.getAddress(), a.board.address, [a.signerA.address, a.signerB.address]],
        pause: [],
        proposeTransfer: [BACKSTOP, ASSURANCE, usd(1), ethers.ZeroHash],
        releaseAssurance: [ethers.id("g"), usd(10), ethers.ZeroHash],
        releaseDraw: [0],
        removeCompartment: [ethers.encodeBytes32String("NEW")],
        renewPause: [],
        requestDraw: [99, usd(1), ethers.ZeroHash],
        setAllocation: [[6_000, 4_000]],
        setAssuranceDisbursementAddress: [a.lendingCo.address],
        setExposureSources: [[]],
        setFloorBps: [1n],
        setFloorInputs: [1n, usd(5_000), 0n, ethers.id("m")],
        setGovernance: [await a.timelock.getAddress()],
        setLendingCoAddresses: [a.drawer.address, a.lendingCo.address],
        setNetworkRegistry: [a.board.address],
        setPayer: [a.lendingCo.address, 0xf],
        setSigner: [a.lendingCo.address, true],
        setTransferDelay: [BigInt(15 * DAY)],
        unpause: [],
        upgradeTo: [await impl.getAddress()],
        upgradeToAndCall: [await impl.getAddress(), "0x"],
      };
      const fns = pool.interface.fragments.filter((f: any) => f.type === "function" && f.stateMutability !== "view" && f.stateMutability !== "pure");
      expect(fns.length).to.equal(Object.keys(good).length);

      const lendingCoRoles: [string, any][] = [
        ["draw address", a.drawer], ["loss-reserve address", a.lossReserve], ["operating address", a.lendingCo],
        ["Clear Capital Management", manager], ["Clear Capital Holdings", holdings],
      ];
      for (const [role, who] of lendingCoRoles) {
        await usdc.mint(who.address, usd(10));
        await usdc.connect(who).approve(await pool.getAddress(), usd(10));
        for (const f of fns) {
          const call = pool.connect(who).getFunction(f.format())(...good[f.name]);
          if (f.name === "requestDraw" && who === a.drawer) {
            await call;
          } else if (f.name === "deposit" && who === a.lendingCo) {
            // Not a role: 13c names Lending Co.'s operating address as the payer of fees and
            // recoveries, and those (only those) go through. Interchange is the co-op's.
            await expect(call, `${role} ${f.name}`).to.be.revertedWithCustomError(pool, "AssurancePoolNotPayer");
            await pool.connect(who).deposit(TAG.CREDIT_ENHANCEMENT_FEE, usd(1));
          } else {
            await expect(call, `${role} ${f.name}`).to.be.reverted;
          }
        }
      }
      // The same live actions still work for the co-op's second signer.
      await pool.connect(a.signerB).pause();
      await advance(72 * 60 * 60);
      await pool.connect(a.signerB).releaseDraw(0);
      await pool.connect(a.signerB).releaseAssurance(ethers.id("g"), usd(10), ethers.ZeroHash);
      await pool.connect(a.signerB).executeTransfer(0);
      await expectInvariant(pool, usdc);
    });

    it("the ledger does not redeem lost debt from any reserve, and holds no pool address", async function () {
      const { ctx } = await deployStack();
      await expect(ctx.stableCredit.connect(ctx.member).burnLostDebt(ctx.member.address, 1n))
        .to.be.revertedWithCustomError(ctx.stableCredit, "StableCreditLostDebtNotRedeemable");
      for (const fn of ["assurancePool", "setAssurancePool"]) {
        expect(ctx.stableCredit.interface.getFunction(fn), fn).to.equal(null);
      }
    });
  });
});
