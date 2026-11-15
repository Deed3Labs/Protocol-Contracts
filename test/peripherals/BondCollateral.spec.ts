import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPhase0Network } from "../helpers/phase0-fixture";
import { issuerProxyOptions } from "../helpers/issuers";
import { pledgeItemSigned } from "../helpers/pledge";
import { deployBondStack, grantNoticeRole } from "../helpers/bonds";

const ONE_USDC = 10n ** 6n;
const DAY = 24 * 60 * 60;
const CYCLE = 30 * DAY;
const YEAR = 365 * DAY;

const BOND = ethers.encodeBytes32String("BOND");
const ASSET_INT = 3;

// A bond pledged as collateral has to behave like collateral in two ways that a flat per-kind
// price and an unguarded transfer hook do not give it: it must not be able to walk away while
// credit is drawn on it, and it must be valued at what it is worth today rather than at whatever
// figure an operator last typed in. Bonds accrete, so the second one moves every block.
describe("bonds as collateral", function () {
  let ctx: Awaited<ReturnType<typeof deployPhase0Network>>;
  let stack: any, bond: any, vault: any, registry: any, issuer: any, valuer: any;
  let coop: any, other: any, noticer: any;

  beforeEach(async function () {
    ctx = await deployPhase0Network();
    const signers = await ethers.getSigners();
    [coop, other, noticer] = [signers[8], signers[9], signers[10]];

    const RevolvingIssuer = await ethers.getContractFactory("RevolvingIssuer");
    issuer = await upgrades.deployProxy(
      RevolvingIssuer, [await ctx.stableCredit.getAddress(), coop.address], { ...(await issuerProxyOptions("RevolvingIssuer")),  kind: "uups" }
    );
    await ctx.networkRegistry.registerIssuer(
      await issuer.getAddress(),
      await ctx.stableCredit.getAddress()
    );
    await ctx.access.grantOperator(await issuer.getAddress());
    await ctx.access.connect(ctx.operator).grantMember(ctx.counterparty.address);
    await issuer.connect(ctx.operator).addTier(BOND, 75n, CYCLE);

    const LimitCalculator = await ethers.getContractFactory("LimitCalculator");
    const CollateralRegistry = await ethers.getContractFactory("CollateralRegistry");
    registry = await upgrades.deployProxy(
      CollateralRegistry,
      [ctx.admin.address, await ctx.networkRegistry.getAddress()],
      { kind: "uups" }
    );
    // The unit price is deliberately left at zero: with a valuer attached nothing should read it,
    // so a wrong answer from the flat path shows up as a zero rather than as a plausible number.
    await registry.registerCollateralType(BOND, ASSET_INT, 9_000n, 0n);

    // Phase 2f: the new collection, sold by quote (decision 8), with EarnControls and a membership
    // registry in which `other` is the member's second Smart Account: Earn §1 lets a bond move only
    // between one Holder's accounts (or on the Successor path).
    const membership: any = await upgrades.deployProxy(await ethers.getContractFactory("MembershipRegistry"), [ctx.admin.address]);
    await membership.registerMember(ctx.member.address, 3, 0, ethers.ZeroHash);
    await membership.linkWallet(await membership.walletToMemberId(ctx.member.address), other.address);
    stack = await deployBondStack(ctx.admin, ctx.usdc, ctx.tokenRegistry, {
      registry, kind: BOND, membership: await membership.getAddress(), rungs: [[365, 475], [730, 500]],
    });
    bond = stack.bond;
    vault = stack.vault;
    await grantNoticeRole(stack.controls, ctx.admin, noticer.address);

    const BondValuer = await ethers.getContractFactory("BondValuer");
    valuer = await BondValuer.deploy(await bond.getAddress());
    await registry.setCollateralValuer(BOND, await valuer.getAddress());

    await issuer.connect(ctx.operator).setExposureSource(await registry.getAddress());
  });

  async function now() {
    return BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  }

  async function advance(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  /// Buys a bond of `face` for a term of `term` seconds (a Ladder term), and returns its id.
  async function buyBond(face: bigint, term: number) {
    const { id } = await stack.buy(ctx.member, face, term / DAY);
    return id as bigint;
  }

  /// Posts a Roll Notice on `id` 21 days before maturity and has the member confirm it.
  async function confirmRoll(id: bigint) {
    const b = await bond.getBondInfo(id);
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(b.maturityDate) - 21 * DAY]);
    const deadline = await bond.latestRollDeadline(b.maturityDate);
    await bond.connect(noticer).postRollNotice(id, ethers.id("notice"), deadline, 365, 475);
    await bond.connect(other).confirmRoll(id, ethers.id("notice"), await stack.confirmSig(ctx.member, id));
  }

  describe("a pledged bond cannot walk away", function () {
    let bondId: bigint;

    beforeEach(async function () {
      bondId = await buyBond(1_000n * ONE_USDC, YEAR);
      await pledgeItemSigned(registry, ctx.member.address, BOND, bondId);
      await issuer
        .connect(ctx.operator)
        .openLine(ctx.member.address, [500n * ONE_USDC], 0);
    });

    it("does not move while pledged, even with nothing drawn against it (Phase 2e, section 9)", async function () {
      // A pledged position leaves only through MB-05: `settle` at maturity or `payPledged`. The
      // member asks for the pledge to be released first if they want to move the bond.
      await expect(
        bond.connect(ctx.member).safeTransferFrom(ctx.member.address, other.address, bondId, 1, "0x")
      ).to.be.revertedWithCustomError(bond, "BurnerBondPledged").withArgs(bondId);
      await registry.releaseItem(ctx.member.address, BOND, bondId);
      await bond
        .connect(ctx.member)
        .safeTransferFrom(ctx.member.address, other.address, bondId, 1, "0x");
      expect(await bond.balanceOf(other.address, bondId)).to.equal(1n);
    });

    it("refuses to move once credit is drawn on it", async function () {
      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 500n * ONE_USDC);

      expect(await registry.isItemEncumbered(ctx.member.address, BOND, bondId)).to.equal(true);
      await expect(
        bond
          .connect(ctx.member)
          .safeTransferFrom(ctx.member.address, other.address, bondId, 1, "0x")
      ).to.be.revertedWithCustomError(bond, "BurnerBondPledged").withArgs(bondId);
    });

    it("moves again once the credit is repaid", async function () {
      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 500n * ONE_USDC);
      await ctx.stableCredit
        .connect(ctx.counterparty)
        .transfer(ctx.member.address, 500n * ONE_USDC);
      // Repaying the principal alone leaves a few units of carry outstanding, and any debt at all
      // keeps the collateral spoken for, so the member clears the rest in USDC. (This used to be
      // funded by a member-to-member draw, which Phase 1 no longer allows: audit C-1.)
      const owed = await ctx.stableCredit.creditBalanceOf(ctx.member.address);
      await ctx.usdc.mint(ctx.member.address, owed);
      await ctx.usdc.connect(ctx.member).approve(await ctx.stableCredit.getAddress(), owed);
      await ctx.stableCredit.connect(ctx.member).repayCreditBalance(ctx.member.address, owed);

      expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address)).to.equal(0n);
      expect(await registry.isItemEncumbered(ctx.member.address, BOND, bondId)).to.equal(false);
      // Released once nothing is drawn (Phase 2e: a pledged bond stays put until then).
      await registry.releaseItem(ctx.member.address, BOND, bondId);
      await bond
        .connect(ctx.member)
        .safeTransferFrom(ctx.member.address, other.address, bondId, 1, "0x");
      expect(await bond.balanceOf(other.address, bondId)).to.equal(1n);
    });

    it("nobody takes it: the seize path is gone, and the liquidator is not exempt (founder answer G)", async function () {
      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 500n * ONE_USDC);

      // A pledged bond is paid only under its own pledge payment term (`payPledged`), when MB-05
      // permits enforcement. Naming the co-op as the collection's liquidator gives it nothing to
      // take with: no seizeBond, and the pledge lock binds it like anyone else.
      await bond.setLiquidator(coop.address);
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600]);
      await ethers.provider.send("evm_mine", []);
      await bond.executeLiquidatorChange();
      expect(bond.interface.getFunction("seizeBond")).to.equal(null);
      // Phase 2f (Earn §1): no operator can be approved at all.
      await expect(bond.connect(ctx.member).setApprovalForAll(coop.address, true))
        .to.be.revertedWithCustomError(bond, "BurnerBondNoOperators");
      await expect(
        bond.connect(coop).safeTransferFrom(ctx.member.address, coop.address, bondId, 1, "0x")
      ).to.be.reverted;
      expect(await bond.balanceOf(ctx.member.address, bondId)).to.equal(1n);
    });

    it("leaves an unpledged bond alone", async function () {
      // $500: the minimum face was raised from $100 (audit X-10).
      const free = await buyBond(500n * ONE_USDC, YEAR);

      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 500n * ONE_USDC);

      await bond
        .connect(ctx.member)
        .safeTransferFrom(ctx.member.address, other.address, free, 1, "0x");
      expect(await bond.balanceOf(other.address, free)).to.equal(1n);
    });
  });

  /*
   * A collection lets burns past its own pledge check, so redemption is refused where it pays out:
   * the vault will not hand over a bond's face while it is still holding up drawn credit.
   */
  describe("a pledged bond backing drawn credit cannot be redeemed", function () {
    let bondId: bigint;

    beforeEach(async function () {
      await vault.setEncumbranceSource(await registry.getAddress(), BOND);
      bondId = await buyBond(1_000n * ONE_USDC, YEAR);
      await pledgeItemSigned(registry, ctx.member.address, BOND, bondId);
      await issuer
        .connect(ctx.operator)
        .openLine(ctx.member.address, [500n * ONE_USDC], 0);
      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 400n * ONE_USDC);
      await advance(YEAR + DAY);
      await ctx.usdc.mint(await vault.getAddress(), 1_000n * ONE_USDC);
    });

    // Phase 2f (decision 8): no Holder redemption (`redeemBond` is gone); `settle` is permissionless,
    // and an unconfirmed bond is paid at maturity. A pledged one pays only under its Maturity
    // Instruction, through the pledge module (here none is named), never straight to the Holder.
    it("refuses while the credit is drawn", async function () {
      expect(bond.interface.getFunction("redeemBond")).to.equal(null);
      await expect(bond.connect(other).settle(bondId)).to.be.reverted;
      expect(await bond.balanceOf(ctx.member.address, bondId)).to.equal(1n);
    });

    it("pays once the credit is paid down", async function () {
      // Carry lands on the balance as the first repayment settles it, so pay until nothing is owed.
      await ctx.usdc.mint(ctx.member.address, 1_000n * ONE_USDC);
      await ctx.usdc.connect(ctx.member).approve(await ctx.stableCredit.getAddress(), ethers.MaxUint256);
      for (let i = 0; i < 3; i++) {
        const owed = await ctx.stableCredit.creditBalanceOf(ctx.member.address);
        if (owed === 0n) break;
        await ctx.stableCredit.connect(ctx.member).repayCreditBalance(ctx.member.address, owed);
      }
      expect(await ctx.stableCredit.creditBalanceOf(ctx.member.address)).to.equal(0n);

      // The member's pledge is released once nothing is drawn, and then the bond redeems.
      await registry.releaseItem(ctx.member.address, BOND, bondId);
      const before = await ctx.usdc.balanceOf(ctx.member.address);
      await bond.connect(other).settle(bondId);
      expect((await ctx.usdc.balanceOf(ctx.member.address)) - before).to.equal(1_000n * ONE_USDC);
    });

    it("is the Earn timelock's to set", async function () {
      await expect(vault.connect(other).setEncumbranceSource(other.address, BOND)).to.be.reverted;
    });
  });

  /*
   * Rolling burns the matured bond and issues a replacement for the same money. The pledge has
   * to follow, or the credit drawn against it is backed by an id that no longer exists.
   */
  describe("a rolled bond stays pledged", function () {
    let bondId: bigint;

    beforeEach(async function () {
      bondId = await buyBond(1_000n * ONE_USDC, YEAR);
      await pledgeItemSigned(registry, ctx.member.address, BOND, bondId);
      await issuer
        .connect(ctx.operator)
        .openLine(ctx.member.address, [500n * ONE_USDC], 0);
      await ctx.stableCredit
        .connect(ctx.member)
        .transfer(ctx.counterparty.address, 400n * ONE_USDC);
    });

    // Phase 2f (Earn §4A, decision 8): the Holder-only `rollBond` is gone. A bond rolls only on the
    // Holder's confirmation of its Roll Notice, executed by anyone's `settle` at maturity, with an
    // eligibility attestation in force (decision 44).
    async function roll(id: bigint) {
      await confirmRoll(id);
      await stack.attest(ctx.member);
      await advance(22 * DAY);
      await bond.connect(other).settle(id);
    }

    it("moves the pledge to the replacement", async function () {
      await roll(bondId);
      const replacement = bondId + 1n;

      expect(await registry.pledgedItemsOf(ctx.member.address, BOND)).to.deep.equal([replacement]);
      expect(await registry.isItemEncumbered(ctx.member.address, BOND, replacement)).to.equal(true);
      expect(await registry.isItemEncumbered(ctx.member.address, BOND, bondId)).to.equal(false);
    });

    it("keeps the replacement from walking away while credit is drawn", async function () {
      await roll(bondId);
      await expect(
        bond
          .connect(ctx.member)
          .safeTransferFrom(ctx.member.address, other.address, bondId + 1n, 1, "0x")
      ).to.be.revertedWithCustomError(bond, "BurnerBondPledged").withArgs(bondId + 1n);
    });

    it("leaves an unpledged bond's roll alone", async function () {
      const unpledged = await buyBond(500n * ONE_USDC, YEAR);
      await roll(unpledged);
      expect(await registry.pledgedItemsOf(ctx.member.address, BOND)).to.deep.equal([bondId]);
    });

    it("moves only on the collection's word", async function () {
      await expect(
        registry.connect(other).rollItem(ctx.member.address, BOND, bondId, 999n)
      ).to.be.reverted;
    });
  });

  describe("the limit accretes with the bond", function () {
    it("values a fresh pledge near what was paid, not at face", async function () {
      const bondId = await buyBond(1_000n * ONE_USDC, YEAR);
      const paid = (await bond.getBondInfo(bondId)).purchasePrice;
      await pledgeItemSigned(registry, ctx.member.address, BOND, bondId);

      const value = await registry.collateralValueOf(ctx.member.address, BOND);
      // Phase 2f: the Purchase Price is the Accreted Value at issue floored to the cent (R4).
      expect(value).to.be.gte(paid);
      expect(value - paid).to.be.lessThan(10_000n);
      expect(value).to.be.lessThan(1_000n * ONE_USDC);
    });

    it("grows on its own as maturity approaches", async function () {
      const bondId = await buyBond(1_000n * ONE_USDC, YEAR);
      await pledgeItemSigned(registry, ctx.member.address, BOND, bondId);

      const atIssue = await registry.collateralValueOf(ctx.member.address, BOND);
      await advance(YEAR / 2);
      const halfway = await registry.collateralValueOf(ctx.member.address, BOND);
      await advance(YEAR / 2 - DAY);
      const nearly = await registry.collateralValueOf(ctx.member.address, BOND);

      // Nobody revalued anything. The bond is simply closer to paying out.
      expect(halfway).to.be.greaterThan(atIssue);
      expect(nearly).to.be.greaterThan(halfway);
      expect(nearly).to.be.lessThanOrEqual(1_000n * ONE_USDC);
    });

    it("reaches face at maturity and stops there", async function () {
      const bondId = await buyBond(1_000n * ONE_USDC, YEAR);
      await pledgeItemSigned(registry, ctx.member.address, BOND, bondId);

      await advance(YEAR + DAY);
      expect(await registry.collateralValueOf(ctx.member.address, BOND)).to.equal(
        1_000n * ONE_USDC
      );
      await advance(YEAR);
      expect(await registry.collateralValueOf(ctx.member.address, BOND)).to.equal(
        1_000n * ONE_USDC
      );
    });

    it("prices each bond on its own term rather than a standard one", async function () {
      // The old code reconstructed the issue date by subtracting the roll term from maturity,
      // which reads a six-month bond as though it had already been accreting for six months.
      const long = await buyBond(1_000n * ONE_USDC, 2 * YEAR);
      const paid = (await bond.getBondInfo(long)).purchasePrice;
      const value = await bond.presentValueOf(long);
      expect(value).to.be.gte(paid);
      expect(value - paid).to.be.lessThan(10_000n); // floored to the cent at issue (R4)
    });

    it("counts a bond the member no longer holds as worth nothing", async function () {
      const bondId = await buyBond(1_000n * ONE_USDC, YEAR);
      // Phase 2e: a pledged bond no longer leaves while pledged, so the valuer's own rule is checked
      // directly -- whoever does not hold a bond is credited nothing for it.
      expect(await valuer.valueOfItems(other.address, [bondId])).to.equal(0n);
      expect(await valuer.valueOfItems(ctx.member.address, [bondId])).to.equal(await bond.presentValueOf(bondId));
    });

    it("sums a member's pledged bonds", async function () {
      const a = await buyBond(1_000n * ONE_USDC, YEAR);
      const b = await buyBond(500n * ONE_USDC, YEAR);
      await pledgeItemSigned(registry, ctx.member.address, BOND, a);
      await pledgeItemSigned(registry, ctx.member.address, BOND, b);

      const expected =
        (await bond.presentValueOf(a)) + (await bond.presentValueOf(b));
      expect(await registry.collateralValueOf(ctx.member.address, BOND)).to.equal(expected);
    });
  });

  // Phase 4's claim is that a pledged bond makes the asset-backed tier light up without anybody
  // attesting to anything. The registry values it, the calculator haircuts it, and the issuer
  // takes the figure -- so the member's line moves because their collateral did.
  describe("the asset-backed tier lights up", function () {
    let limits: any;

    beforeEach(async function () {
      const LimitCalculator = await ethers.getContractFactory("LimitCalculator");
      limits = await upgrades.deployProxy(
        LimitCalculator,
        [
          ctx.admin.address,
          await registry.getAddress(),
          await issuer.getAddress(),
        ],
        { kind: "uups" }
      );
      // The calculator points at the issuer, not the other way round: it reads collateral and
      // pushes the ceiling in. So what it needs is the right to act, not a registration.
      await ctx.access.grantOperator(await limits.getAddress());
      await ctx.access.grantRole(ethers.id("CREDIT_LIMITS_ROLE"), await limits.getAddress()); // audit H-4
      await registry.grantRole(await registry.OPERATOR_ROLE(), await limits.getAddress());
      // A ceiling has to have somewhere to land: the calculator sets a line's capacity, it does
      // not open the line.
      await issuer.connect(ctx.operator).openLine(ctx.member.address, [0n], 0);
    });

    it("gives a member with no collateral and no attestation nothing", async function () {
      expect(await limits.capacityOf(ctx.member.address, BOND)).to.equal(0n);
    });

    it("opens a line the moment a bond is pledged, with nobody attesting", async function () {
      const bondId = await buyBond(1_000n * ONE_USDC, YEAR);
      await pledgeItemSigned(registry, ctx.member.address, BOND, bondId);

      // 90% of what the bond is worth today, not of its face.
      const value = await bond.presentValueOf(bondId);
      expect(await limits.capacityOf(ctx.member.address, BOND)).to.equal(
        (value * 9_000n) / 10_000n
      );
    });

    it("widens that line on its own as the bond accretes", async function () {
      const bondId = await buyBond(1_000n * ONE_USDC, YEAR);
      await pledgeItemSigned(registry, ctx.member.address, BOND, bondId);

      const atIssue = await limits.capacityOf(ctx.member.address, BOND);
      await advance(YEAR / 2);
      const halfway = await limits.capacityOf(ctx.member.address, BOND);

      expect(halfway).to.be.greaterThan(atIssue);
    });

    it("pushes the figure onto the issuer for anyone who asks", async function () {
      const bondId = await buyBond(1_000n * ONE_USDC, YEAR);
      await pledgeItemSigned(registry, ctx.member.address, BOND, bondId);
      await limits.connect(other).pushCapacities(ctx.member.address);

      const value = await bond.presentValueOf(bondId);
      // The issuer indexes capacity by tier, not by kind: BOND is tier 0 here.
      expect(await issuer.capacityOf(ctx.member.address, 0)).to.equal(
        (value * 9_000n) / 10_000n
      );
    });
  });
});
