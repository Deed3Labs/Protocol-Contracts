import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { deployPhase0Network } from "../../helpers/phase0-fixture";
import { driveToDefault } from "../../helpers/default";
import { issuerProxyOptions } from "../../helpers/issuers";
import { CA, ONE_USDC, CYCLE, DAY } from "./rates";
import { pledgeSigned } from "../../helpers/pledge";

/*
 * Phase 2d: the "DFAL control, ESA vault roles, pilot cap and Send" addendum
 * (`docs/audit/specs/dfal-vault-send.md`, with the owner's decisions of 2026-11-14), and the
 * re-review's L-D and L-E (`docs/audit/REREVIEW-DECISIONS.md`).
 *
 * Acceptance 34, 35, 37 and 38, and L-D, are here. Acceptance 36 is off chain (decision 7: the
 * pilot measure and its alerts are tracked off chain from events), so it has no test here. The
 * governance handover (decision 1) is `test/deploy/Vault.deploy.spec.ts`.
 */
const SAVINGS = ethers.encodeBytes32String("SAVINGS");
const WY = ethers.encodeBytes32String("WY");

async function advance(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function deployStack() {
  const ctx = await deployPhase0Network();
  const s = await ethers.getSigners();
  const [coop, relayer, keyA, keyB, stranger, ca, wy, keyC, settler, treasury] = s.slice(8, 18);

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
    await vault.grantRole(await vault.PILOT_ROLE(), k.address);
    await clrusd.grantRole(await clrusd.FRAUD_ROLE(), k.address);
    await clrusd.grantRole(await clrusd.SECURITY_ROLE(), k.address);
  }

  const R = await ethers.getContractFactory("RevolvingIssuer");
  const issuer: any = await upgrades.deployProxy(R, [await ctx.stableCredit.getAddress(), coop.address], { ...(await issuerProxyOptions("RevolvingIssuer")), kind: "uups" });
  await ctx.networkRegistry.registerIssuer(await issuer.getAddress(), await ctx.stableCredit.getAddress());
  await ctx.access.grantOperator(await issuer.getAddress());
  await issuer.connect(ctx.operator).addTier(SAVINGS, 0n, CYCLE);

  const Registry = await ethers.getContractFactory("CollateralRegistry");
  const registry: any = await upgrades.deployProxy(Registry, [ctx.admin.address, await ctx.networkRegistry.getAddress()], { kind: "uups" });
  await registry.registerCollateralType(SAVINGS, 1, 10_000n, 10n ** 18n);
  await registry.setClrusdKind(SAVINGS);
  await registry.setClrusdToken(await clrusd.getAddress());
  await clrusd.setEncumbranceSource(await registry.getAddress());
  await issuer.connect(ctx.operator).setExposureSource(await registry.getAddress());

  const L = await ethers.getContractFactory("Liquidator");
  const liquidator: any = await upgrades.deployProxy(L, [ctx.admin.address, await ctx.stableCredit.getAddress(),
    await clrusd.getAddress(), await vault.getAddress(), await ctx.usdc.getAddress(), await registry.getAddress()], { kind: "uups" });
  await clrusd.grantRole(await clrusd.LIQUIDATOR_ROLE(), await liquidator.getAddress());
  await registry.grantRole(await registry.OPERATOR_ROLE(), await liquidator.getAddress());
  await ctx.access.grantOperator(await liquidator.getAddress());
  await liquidator.setTrustedSavingsIssuer(await issuer.getAddress(), true);

  const Escrow = await ethers.getContractFactory("ClaimEscrow");
  const escrow: any = await upgrades.deployProxy(Escrow, [await ctx.usdc.getAddress(), treasury.address, ctx.admin.address], { kind: "uups" });
  await escrow.grantRole(await escrow.SETTLER_ROLE(), settler.address);

  await ctx.networkRegistry.grantRole(await ctx.networkRegistry.STATE_ATTESTER_ROLE(), ctx.admin.address);
  return { ctx, clrusd, vault, issuer, registry, liquidator, escrow, coop, relayer, keyA, keyB, keyC, stranger, ca, wy, settler, treasury };
}

type Stack = Awaited<ReturnType<typeof deployStack>>;

async function deposit(s: Stack, who: any, amount: bigint, receiver = who.address) {
  await s.ctx.usdc.mint(who.address, amount);
  await s.ctx.usdc.connect(who).approve(await s.vault.getAddress(), amount);
  return s.vault.connect(who).deposit(await s.ctx.usdc.getAddress(), amount, receiver);
}

async function vaultDomain(vault: any) {
  return { name: "ESADepositVault", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await vault.getAddress() };
}

/* ── Static scan for acceptance 34 ── */

function walk(dir: string): string[] {
  return fs.readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return fs.statSync(p).isDirectory() ? walk(p) : p.endsWith(".sol") ? [p] : [];
  });
}

function stripComments(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** The top-level arguments of the call whose opening parenthesis ends at `open`. */
function argsAt(src: string, open: number): string[] {
  let depth = 1, cur = "";
  const out: string[] = [];
  for (let i = open; i < src.length && depth > 0; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0) break;
    if (ch === "," && depth === 1) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Every place a contract pulls ERC-20s from an address other than its caller or itself. */
function pullSites() {
  const own = new Set(["msg.sender", "_msgSender()", "address(this)"]);
  const sites: string[] = [];
  for (const file of walk(path.join(__dirname, "../../../contracts"))) {
    if (file.includes(`${path.sep}mocks${path.sep}`)) continue;
    const src = stripComments(fs.readFileSync(file, "utf8"));
    const re = /(\b(?:safeTransferFrom|transferFrom|receiveWithAuthorization|transferWithAuthorization|repayCreditBalanceFor)|\.permit)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const before = src.slice(Math.max(0, m.index - 40), m.index);
      if (/function\s+$/.test(before)) continue; // a declaration, not a call
      const callee = (before.match(/([\w.()\[\]]+)\.$/) ?? [])[1] ?? "";
      // NFTs (deeds, subdivisions, bonds) and a token moving its own balance are not member USDC.
      if (/deedNFT|subdivideNFT|IERC721|IERC1155|^super$/.test(callee)) continue;
      const args = argsAt(src, m.index + m[0].length);
      const from = /SafeERC20/.test(callee) ? args[1] : args[0];
      if (own.has(from)) continue;
      sites.push(`${path.basename(file)}:${m[1].replace(/^\./, "")}:${from}`);
    }
  }
  return [...new Set(sites)].sort();
}

/**
 * Each pull from an address that is not the caller, and why it is allowed under 10f. Every one is
 * either an authorization the member signed, the member's own call, or a Clear address paying in.
 */
const REVIEWED_PULLS: Record<string, string> = {
  "ESADepositVault.sol:receiveWithAuthorization:depositor": "EIP-3009: USDC checks the depositor's own signature",
  "ESADepositVault.sol:safeTransferFrom:depositor": "autopay: the depositor's signed DepositMandate (amount per run, runs, cadence, expiry), revocable by cancelOwnMandate or the allowance",
  "ClaimEscrow.sol:receiveWithAuthorization:sender": "EIP-3009: the sender's own signature, committing to every term",
  "StableCredit.sol:safeTransferFrom:payer": "a repayment: payer is the caller, or what a registered issuer passes (below)",
  "BondVault.sol:safeTransferFrom:treasury": "Clear's own treasury, not a member",
  "OffersIssuer.sol:safeTransferFrom:treasury": "Clear's own treasury, not a member",
  "PayoutPool.sol:safeTransferFrom:coopTreasury": "the co-op treasury, not a member",
  "PayoutPool.sol:transferFrom:merchant": "a merchant's StableCredit (a credit token, not USDC), on its own redemption",
  "FundManager.sol:safeTransferFrom:payer": "a deed fee: DeedNFT passes its caller, capped by the payer's own setMaxFee",
};

describe("COMPLIANCE Phase 2d: DFAL control, vault roles, pilot switch, members-only CLRUSD", function () {
  let s: Stack;
  beforeEach(async function () {
    s = await deployStack();
  });

  describe("acceptance 34: no Clear-held role can transfer, freeze or block USDC in a member's smart account", function () {
    it("no contract pulls USDC from anyone but its caller, except under an authorization the member signed", async function () {
      const found = pullSites();
      const unreviewed = found.filter((k) => !(k in REVIEWED_PULLS));
      expect(unreviewed, `unreviewed pull paths: ${unreviewed.join(", ")}`).to.deep.equal([]);
      // And nothing in the list has gone stale.
      expect(Object.keys(REVIEWED_PULLS).filter((k) => !found.includes(k))).to.deep.equal([]);
      // No contract spends a permit on a member's behalf.
      expect(found.some((k) => k.includes(":permit:"))).to.equal(false);
    });

    it("with standing allowances in place, every Clear key fails to move the member's USDC without the member's signature, and no pause stops the member's own USDC transfer", async function () {
      const { ctx, vault, escrow, clrusd, relayer, keyA, keyB, settler, stranger } = s;
      const member = ctx.member;
      const usdc = ctx.usdc;
      const v = await vault.getAddress();
      await usdc.mint(member.address, 1_000n * ONE_USDC);
      // The member gave the vault a standing allowance for autopay, and the escrow one for Send.
      await usdc.connect(member).approve(v, ethers.MaxUint256);
      await usdc.connect(member).approve(await escrow.getAddress(), ethers.MaxUint256);
      await ctx.usdc.connect(member).approve(await ctx.stableCredit.getAddress(), ethers.MaxUint256);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const mandate = { depositor: member.address, token: await usdc.getAddress(), amountPerRun: 100n * ONE_USDC, interval: DAY, maxRuns: 2, startAt: now, expiry: now + 30 * DAY, nonce: 1 };
      const types = { DepositMandate: [
        { name: "depositor", type: "address" }, { name: "token", type: "address" }, { name: "amountPerRun", type: "uint256" },
        { name: "interval", type: "uint64" }, { name: "maxRuns", type: "uint32" }, { name: "startAt", type: "uint256" },
        { name: "expiry", type: "uint256" }, { name: "nonce", type: "uint256" }] };
      const args = (m: any) => [m.depositor, m.token, m.amountPerRun, m.interval, m.maxRuns, m.startAt, m.expiry, m.nonce];

      for (const key of [ctx.admin, relayer, keyA, keyB, settler, stranger]) {
        // A mandate the member did not sign, signed by the key itself.
        const forged = await key.signTypedData(await vaultDomain(vault), types, mandate);
        await expect(vault.connect(key).executeMandateDeposit(...args(mandate), forged)).to.be.reverted;
        await expect(vault.connect(key).depositWithAuthorization(member.address, await usdc.getAddress(), ONE_USDC, member.address, 0, ethers.MaxUint256, ethers.ZeroHash, 27, ethers.ZeroHash, ethers.ZeroHash)).to.be.reverted;
        await expect(escrow.connect(key).createTransferWithAuthorization(member.address, ethers.id("x"), ONE_USDC, 0, now + DAY, ethers.ZeroHash, 0, ethers.MaxUint256, ethers.ZeroHash, 27, ethers.ZeroHash, ethers.ZeroHash)).to.be.reverted;
        await expect(ctx.stableCredit.connect(key).repayCreditBalanceFor(member.address, member.address, 1n)).to.be.reverted;
      }
      expect(await usdc.balanceOf(member.address)).to.equal(1_000n * ONE_USDC);

      // The mandate the member signed runs within its own caps, and stops when they cancel it.
      await ctx.networkRegistry.attestStateCode(member.address, WY);
      await vault.setStateSource(await ctx.networkRegistry.getAddress());
      const signed = await member.signTypedData(await vaultDomain(vault), types, mandate);
      await vault.connect(relayer).executeMandateDeposit(...args(mandate), signed);
      await expect(vault.connect(relayer).executeMandateDeposit(...args(mandate), signed)).to.be.revertedWithCustomError(vault, "ESADepositVaultMandateInvalid"); // cadence
      await vault.connect(member).cancelOwnMandate(mandate.token, mandate.amountPerRun, mandate.interval, mandate.maxRuns, mandate.startAt, mandate.expiry, mandate.nonce);
      await advance(DAY);
      await expect(vault.connect(relayer).executeMandateDeposit(...args(mandate), signed)).to.be.revertedWithCustomError(vault, "ESADepositVaultMandateInvalid");
      expect(await usdc.balanceOf(member.address)).to.equal(900n * ONE_USDC);

      // Every Clear pause on at once: the vault's, CLRUSD's security pause, the CA mint pause.
      for (const k of [keyA, keyB]) {
        await vault.connect(k).pause();
        await clrusd.connect(k).pauseForSecurity(1);
        await clrusd.connect(k).pauseAccount(member.address, 2);
        await vault.connect(k).pauseCaMints(3);
      }
      expect(await vault.paused()).to.equal(true);
      // The member's own USDC still goes wherever they send it (12.15: USDC Sends go to any address).
      await usdc.connect(member).transfer(stranger.address, 50n * ONE_USDC);
      expect(await usdc.balanceOf(stranger.address)).to.equal(50n * ONE_USDC);
    });
  });

  describe("acceptance 35: reserve USDC leaves only by a 1:1 redemption or a 10b liquidation", function () {
    it("lists no sweep, rescue or withdrawal: the vault's state-changing functions are exactly these", async function () {
      const { vault } = s;
      const writes = vault.interface.fragments
        .filter((f: any) => f.type === "function" && !["view", "pure"].includes(f.stateMutability))
        .map((f: any) => f.name)
        .sort();
      expect(writes).to.deep.equal([
        "cancelMandate", "cancelOwnMandate", "deposit", "depositWithAuthorization", "depositWithAuthorizationFor",
        "executeMandateDeposit", "grantRole", "initialize", "pause", "pauseCaMints", "redeem", "redeemWithAuthorization",
        "redeemWithSignature", "renewPause", "renounceRole", "revokeRole", "setAcceptedToken", "setClrusd", "setPauseWindow",
        "setPilotOff", "setStateSource", "unpause", "unpauseCaMints", "upgradeTo", "upgradeToAndCall",
      ].sort());
      expect(writes.filter((n: string) => /sweep|rescue|withdraw|skim|recover|drain|transfer/i.test(n))).to.deep.equal([]);
    });

    it("every other call, by every key, with any argument, leaves the reserve whole; redemption and liquidation pay out exactly what they burn", async function () {
      const { ctx, vault, clrusd, issuer, registry, liquidator, relayer, keyA, keyB, keyC, stranger } = s;
      const usdc = ctx.usdc;
      const v = await vault.getAddress();
      await deposit(s, ctx.member, 1_000n * ONE_USDC);
      await deposit(s, ctx.counterparty, 500n * ONE_USDC);
      await usdc.mint(v, 7n * ONE_USDC); // a donation: it can never be taken out
      const reserve = async () => usdc.balanceOf(v);
      const supply = async () => clrusd.totalSupply();
      const start = await reserve();
      expect(start).to.equal((await supply()) + 7n * ONE_USDC);

      // Every non-redeeming write, from every key, with every address the test knows as argument.
      const keys = [ctx.admin, relayer, keyA, keyB, keyC, stranger];
      const addrs = [ctx.admin.address, stranger.address, ctx.member.address, await usdc.getAddress(), await clrusd.getAddress(), v];
      // The redeeming and minting paths are run for real below; giving up roles would only stop the test.
      const skip = new Set(["deposit", "depositWithAuthorization", "depositWithAuthorizationFor", "executeMandateDeposit", "redeem", "redeemWithAuthorization", "redeemWithSignature", "renounceRole", "revokeRole"]);
      let seed = 7;
      const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
      const someHash = ethers.id("x");
      const value = (t: string): any => {
        if (t === "address") return addrs[rnd(addrs.length)];
        if (t === "bool") return rnd(2) === 1;
        if (t.startsWith("uint")) return BigInt(rnd(3)) * ONE_USDC;
        if (t === "bytes32") return [ethers.ZeroHash, someHash][rnd(2)];
        if (t === "bytes") return "0x";
        return 0;
      };
      const fns = vault.interface.fragments.filter((f: any) => f.type === "function" && !["view", "pure"].includes(f.stateMutability) && !skip.has(f.name));
      for (let round = 0; round < 3; round++) {
        for (const f of fns) {
          for (const k of keys) {
            const args = f.inputs.map((i: any) => value(i.type));
            try { await vault.connect(k)[f.format()](...args); } catch { /* refused */ }
            expect(await reserve()).to.equal(start, `${f.name} by ${k.address}`);
          }
        }
      }
      // Whatever the admin set, put the vault back on USDC for the paths below.
      if ((await vault.acceptedToken()) !== (await usdc.getAddress())) {
        if ((await vault.acceptedToken()) !== ethers.ZeroAddress) await vault.setAcceptedToken(await vault.acceptedToken(), false);
        await vault.setAcceptedToken(await usdc.getAddress(), true);
      }
      await vault.setPilotOff(true);
      await advance(72 * 3600 + 1); // any pause the keys set has lapsed

      // Someone without CLRUSD cannot redeem; somebody else's CLRUSD cannot be redeemed without
      // their allowance or signature.
      await expect(vault.connect(stranger).redeem(await usdc.getAddress(), ONE_USDC, stranger.address)).to.be.reverted;
      await expect(vault.connect(relayer).redeemWithSignature(ctx.member.address, await usdc.getAddress(), ONE_USDC, stranger.address, ethers.MaxUint256, "0x")).to.be.reverted;
      expect(await reserve()).to.equal(start);

      // 1:1 redemption, to the receiver the holder named.
      await clrusd.connect(ctx.counterparty).approve(v, 200n * ONE_USDC);
      const sBefore = await supply();
      await vault.connect(ctx.counterparty).redeem(await usdc.getAddress(), 200n * ONE_USDC, ctx.counterparty.address);
      expect(start - (await reserve())).to.equal(200n * ONE_USDC);
      expect(sBefore - (await supply())).to.equal(200n * ONE_USDC);

      // 10b liquidation: the seized CLRUSD is burned one-for-one and the USDC settles the debt.
      await pledgeSigned(registry, ctx.member.address, SAVINGS, 1_000n * ONE_USDC);
      await issuer.connect(ctx.operator).openLine(ctx.member.address, [1_000n * ONE_USDC], 0);
      await ctx.stableCredit.connect(ctx.member).transfer(ctx.counterparty.address, 400n * ONE_USDC);
      await driveToDefault(issuer, ctx.member.address, ctx.operator);
      const r1 = await reserve(), s1 = await supply(), debt = await ctx.stableCredit.creditBalanceOf(ctx.member.address);
      await liquidator.connect(stranger).liquidate(ctx.member.address, await issuer.getAddress(), 0, SAVINGS);
      const paid = r1 - (await reserve());
      expect(paid).to.equal(400n * ONE_USDC);
      expect(s1 - (await supply())).to.equal(paid);
      expect(await usdc.balanceOf(await liquidator.getAddress())).to.equal(0n);
      expect(debt - (await ctx.stableCredit.creditBalanceOf(ctx.member.address))).to.equal(paid);
      // The reserve still covers every CLRUSD outstanding, plus the donation nobody can take.
      expect(await reserve()).to.equal((await supply()) + 7n * ONE_USDC);
    });

    it("a redemption pays the holder, or a receiver only the holder's signature names: no call or role can redirect it", async function () {
      const { ctx, vault, clrusd, relayer, keyA, stranger } = s;
      const usdc = await ctx.usdc.getAddress();
      const holder = ctx.member;
      await deposit(s, holder, 300n * ONE_USDC);
      await clrusd.connect(holder).approve(await vault.getAddress(), ethers.MaxUint256);
      const types = { Redeem: [{ name: "redeemer", type: "address" }, { name: "token", type: "address" }, { name: "clrusdAmount", type: "uint256" },
        { name: "receiver", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
      const sign = async (who: any, receiver: string, amount: bigint) => who.signTypedData(await vaultDomain(vault), types,
        { redeemer: holder.address, token: usdc, clrusdAmount: amount, receiver, nonce: await vault.redeemNonces(holder.address), deadline: ethers.MaxUint256 });

      // A plain redeem pays only its caller.
      await expect(vault.connect(holder).redeem(usdc, ONE_USDC, stranger.address))
        .to.be.revertedWithCustomError(vault, "ESADepositVaultReceiverNotRedeemer").withArgs(stranger.address);
      await vault.connect(holder).redeem(usdc, 100n * ONE_USDC, holder.address);
      expect(await ctx.usdc.balanceOf(holder.address)).to.equal(100n * ONE_USDC);

      // A receiver the holder signed for: the relayer cannot change it, the amount, or forge it.
      const sig = await sign(holder, keyA.address, 50n * ONE_USDC);
      await expect(vault.connect(relayer).redeemWithSignature(holder.address, usdc, 50n * ONE_USDC, relayer.address, ethers.MaxUint256, sig))
        .to.be.revertedWithCustomError(vault, "ESADepositVaultBadSignature");
      await expect(vault.connect(relayer).redeemWithSignature(holder.address, usdc, 60n * ONE_USDC, keyA.address, ethers.MaxUint256, sig))
        .to.be.revertedWithCustomError(vault, "ESADepositVaultBadSignature");
      const forged = await sign(relayer, relayer.address, 50n * ONE_USDC);
      await expect(vault.connect(relayer).redeemWithSignature(holder.address, usdc, 50n * ONE_USDC, relayer.address, ethers.MaxUint256, forged))
        .to.be.revertedWithCustomError(vault, "ESADepositVaultBadSignature");
      const split = ethers.Signature.from(sig);
      await expect(vault.connect(relayer).redeemWithAuthorization(holder.address, usdc, 50n * ONE_USDC, relayer.address, ethers.MaxUint256, split.v, split.r, split.s))
        .to.be.revertedWithCustomError(vault, "ESADepositVaultBadSignature");
      await vault.connect(relayer).redeemWithAuthorization(holder.address, usdc, 50n * ONE_USDC, keyA.address, ethers.MaxUint256, split.v, split.r, split.s);
      expect(await ctx.usdc.balanceOf(keyA.address)).to.equal(50n * ONE_USDC);
      // Nobody but the relayer submits it, and only once.
      await expect(vault.connect(stranger).redeemWithSignature(holder.address, usdc, 50n * ONE_USDC, keyA.address, ethers.MaxUint256, sig)).to.be.reverted;

      // No role holder can redeem the holder's CLRUSD at all, to anyone.
      for (const k of [ctx.admin, relayer, keyA, stranger]) {
        await expect(vault.connect(k).redeem(usdc, ONE_USDC, k.address)).to.be.reverted;
      }
      expect(await clrusd.balanceOf(holder.address)).to.equal(150n * ONE_USDC);
    });
  });

  describe("acceptance 37: pauseCaMints takes two distinct signers and never blocks redemptions", function () {
    it("needs two PILOT_ROLE holders to set and to clear, with a reason code, and blocks only CA mints", async function () {
      const { ctx, vault, clrusd, keyA, keyB, keyC, stranger, ca, wy, relayer } = s;
      const usdc = await ctx.usdc.getAddress();
      await ctx.networkRegistry.attestStateCode(ca.address, CA);
      await ctx.networkRegistry.attestStateCode(wy.address, WY);
      await vault.setStateSource(await ctx.networkRegistry.getAddress());
      await deposit(s, ca, 1_000n * ONE_USDC);

      await expect(vault.connect(stranger).pauseCaMints(5)).to.be.reverted;
      await expect(vault.connect(keyA).pauseCaMints(5)).to.emit(vault, "ActionProposed");
      expect((await vault.caMintsPaused())[0]).to.equal(false);
      await expect(vault.connect(keyA).pauseCaMints(5)).to.be.revertedWithCustomError(vault, "ESADepositVaultSameSigner");
      await expect(vault.connect(keyB).pauseCaMints(5)).to.emit(vault, "CaMintsPauseSet").withArgs(true, 5, keyA.address, keyB.address);
      expect(await vault.caMintsPaused()).to.deep.equal([true, 5n]);

      // New CA mints stop: the receiver's state, or the depositor's (L-E: count both).
      await expect(deposit(s, ca, ONE_USDC)).to.be.revertedWithCustomError(vault, "ESADepositVaultCaMintsPaused").withArgs(5);
      await expect(deposit(s, ca, ONE_USDC, wy.address)).to.be.revertedWithCustomError(vault, "ESADepositVaultCaMintsPaused");
      // Non-CA mints go on.
      await deposit(s, wy, 100_000n * ONE_USDC);
      // Redemptions are never blocked: direct, and gasless.
      await clrusd.connect(ca).approve(await vault.getAddress(), ethers.MaxUint256);
      await vault.connect(ca).redeem(usdc, 100n * ONE_USDC, ca.address);
      const deadline = ethers.MaxUint256;
      const sig = await ca.signTypedData(await vaultDomain(vault),
        { Redeem: [{ name: "redeemer", type: "address" }, { name: "token", type: "address" }, { name: "clrusdAmount", type: "uint256" },
          { name: "receiver", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
        { redeemer: ca.address, token: usdc, clrusdAmount: 100n * ONE_USDC, receiver: ca.address, nonce: 0, deadline });
      await vault.connect(relayer).redeemWithSignature(ca.address, usdc, 100n * ONE_USDC, ca.address, deadline, sig);
      expect(await clrusd.balanceOf(ca.address)).to.equal(800n * ONE_USDC);

      // Clearing it takes two as well; a proposer who has since lost the role does not count.
      await vault.connect(keyA).unpauseCaMints(9);
      await vault.revokeRole(await vault.PILOT_ROLE(), keyA.address);
      await vault.connect(keyB).unpauseCaMints(9); // keyA no longer counts: this is a new proposal
      expect((await vault.caMintsPaused())[0]).to.equal(true);
      await expect(vault.connect(keyC).unpauseCaMints(9)).to.emit(vault, "CaMintsPauseSet").withArgs(false, 9, keyB.address, keyC.address);
      await deposit(s, ca, ONE_USDC);
    });

    it("is never set automatically, and governance's off switch turns the whole item off", async function () {
      const { ctx, vault, keyA, keyB, ca } = s;
      await ctx.networkRegistry.attestStateCode(ca.address, CA);
      await vault.setStateSource(await ctx.networkRegistry.getAddress());
      // Far past the old cap: nothing switches it on.
      await deposit(s, ca, 120_000n * ONE_USDC);
      expect((await vault.caMintsPaused())[0]).to.equal(false);

      await vault.connect(keyA).pauseCaMints(1);
      await vault.connect(keyB).pauseCaMints(1);
      await expect(vault.connect(keyA).setPilotOff(true)).to.be.reverted; // governance only
      await expect(vault.setPilotOff(true)).to.emit(vault, "PilotSwitched").withArgs(true);
      expect((await vault.caMintsPaused())[0]).to.equal(false);
      await deposit(s, ca, ONE_USDC);
      await expect(vault.connect(keyA).pauseCaMints(2)).to.be.revertedWithCustomError(vault, "ESADepositVaultPilotOff");
    });

    it("L-E: a mint needs the receiver's state attestation while the pilot is on; with no state source, every mint counts as CA", async function () {
      const { ctx, vault, keyA, keyB, ca, stranger } = s;
      // No source named yet: no attestation can be required, and the CA mint pause stops every mint.
      await vault.connect(keyA).pauseCaMints(4);
      await vault.connect(keyB).pauseCaMints(4);
      await expect(deposit(s, stranger, ONE_USDC)).to.be.revertedWithCustomError(vault, "ESADepositVaultCaMintsPaused");
      await vault.connect(keyA).unpauseCaMints(4);
      await vault.connect(keyB).unpauseCaMints(4);
      await deposit(s, stranger, ONE_USDC);

      await vault.setStateSource(await ctx.networkRegistry.getAddress());
      await expect(deposit(s, stranger, ONE_USDC)).to.be.revertedWithCustomError(vault, "ESADepositVaultStateNotAttested").withArgs(stranger.address);
      await ctx.networkRegistry.attestStateCode(ca.address, CA);
      await expect(deposit(s, ca, ONE_USDC, stranger.address)).to.be.revertedWithCustomError(vault, "ESADepositVaultStateNotAttested");
      await deposit(s, ca, ONE_USDC);
      await vault.setPilotOff(true);
      await deposit(s, stranger, ONE_USDC);
    });
  });

  describe("acceptance 38: CLRUSD is received only by member wallets", function () {
    async function members() {
      const { ctx, clrusd } = s;
      for (const w of [ctx.member, ctx.counterparty]) {
        if (!(await ctx.access.isMember(w.address))) await ctx.access.connect(ctx.operator).grantMember(w.address);
      }
      await deposit(s, ctx.member, 1_000n * ONE_USDC);
      await expect(clrusd.setMembershipSource(await ctx.access.getAddress())).to.emit(clrusd, "MembershipSourceUpdated");
    }

    it("a transfer to a non-member reverts; member to member succeeds; the MembershipRegistry counts", async function () {
      const { ctx, clrusd, stranger, wy } = s;
      await members();
      await expect(clrusd.connect(ctx.member).transfer(stranger.address, ONE_USDC))
        .to.be.revertedWithCustomError(clrusd, "ClearUSDReceiverNotMember").withArgs(stranger.address);
      await clrusd.connect(ctx.member).approve(stranger.address, ONE_USDC);
      await expect(clrusd.connect(stranger).transferFrom(ctx.member.address, stranger.address, ONE_USDC))
        .to.be.revertedWithCustomError(clrusd, "ClearUSDReceiverNotMember");
      await clrusd.connect(ctx.member).transfer(ctx.counterparty.address, 10n * ONE_USDC);
      expect(await clrusd.balanceOf(ctx.counterparty.address)).to.equal(10n * ONE_USDC);

      // A wallet the MembershipRegistry lists as an active member counts too.
      const MR = await ethers.getContractFactory("MembershipRegistry");
      const mr: any = await upgrades.deployProxy(MR, [ctx.admin.address]);
      await ctx.access.setMembershipRegistry(await mr.getAddress());
      expect(await clrusd.mayReceive(wy.address)).to.equal(false);
      await mr.registerMember(wy.address, 3 /* LIFETIME */, 0, ethers.ZeroHash);
      expect(await clrusd.mayReceive(wy.address)).to.equal(true);
      await clrusd.connect(ctx.member).transfer(wy.address, ONE_USDC);
    });

    it("a de-listed wallet can still send and redeem; only its receipt stops, and the de-listing is logged", async function () {
      const { ctx, clrusd, vault, relayer } = s;
      await members();
      await expect(ctx.access.connect(ctx.operator).revokeMember(ctx.member.address)).to.emit(ctx.access, "MemberRemoved").withArgs(ctx.member.address);
      // Sends.
      await clrusd.connect(ctx.member).transfer(ctx.counterparty.address, 100n * ONE_USDC);
      // Redeems, directly and gasless.
      await clrusd.connect(ctx.member).approve(await vault.getAddress(), ethers.MaxUint256);
      await vault.connect(ctx.member).redeem(await ctx.usdc.getAddress(), 100n * ONE_USDC, ctx.member.address);
      const usdc = await ctx.usdc.getAddress();
      const sig = await ctx.member.signTypedData(await vaultDomain(vault),
        { Redeem: [{ name: "redeemer", type: "address" }, { name: "token", type: "address" }, { name: "clrusdAmount", type: "uint256" },
          { name: "receiver", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
        { redeemer: ctx.member.address, token: usdc, clrusdAmount: 50n * ONE_USDC, receiver: ctx.member.address, nonce: 0, deadline: ethers.MaxUint256 });
      await vault.connect(relayer).redeemWithSignature(ctx.member.address, usdc, 50n * ONE_USDC, ctx.member.address, ethers.MaxUint256, sig);
      // Cannot receive.
      await expect(clrusd.connect(ctx.counterparty).transfer(ctx.member.address, ONE_USDC))
        .to.be.revertedWithCustomError(clrusd, "ClearUSDReceiverNotMember");
      expect(await clrusd.balanceOf(ctx.member.address)).to.equal(750n * ONE_USDC);
    });

    it("exempts mints, burns, the vault, the token pool and the Liquidator, and works alongside the 10c pauses and the lock", async function () {
      const { ctx, clrusd, vault, issuer, registry, liquidator, keyA, keyB, stranger } = s;
      await members();
      // A vault mint to a non-member is a mint: exempt (decision 6).
      await deposit(s, stranger, 5n * ONE_USDC);
      expect(await clrusd.balanceOf(stranger.address)).to.equal(5n * ONE_USDC);
      // The token pool is whoever holds MINTER/BURNER_ROLE (granted only by governance).
      const pool = ethers.Wallet.createRandom().address;
      await expect(clrusd.connect(ctx.member).transfer(pool, ONE_USDC)).to.be.revertedWithCustomError(clrusd, "ClearUSDReceiverNotMember");
      await clrusd.grantMintAndBurnRoles(pool);
      await clrusd.connect(ctx.member).transfer(pool, ONE_USDC);
      // The vault and the Liquidator are receivers too.
      expect(await clrusd.mayReceive(await vault.getAddress())).to.equal(true);
      expect(await clrusd.mayReceive(await liquidator.getAddress())).to.equal(true);

      // A paused member cannot send, even to a member; the pause does not touch receipt.
      for (const k of [keyA, keyB]) await clrusd.connect(k).pauseAccount(ctx.member.address, 1);
      await expect(clrusd.connect(ctx.member).transfer(ctx.counterparty.address, ONE_USDC)).to.be.revertedWithCustomError(clrusd, "ClearUSDPaused");
      await clrusd.connect(ctx.counterparty).transfer(ctx.member.address, 0n);
      for (const k of [keyA, keyB]) await clrusd.connect(k).unpauseAccount(ctx.member.address);

      // A de-listed member in default is still liquidated: the seizure is exempt, and the lock holds.
      await pledgeSigned(registry, ctx.member.address, SAVINGS, 999n * ONE_USDC);
      await issuer.connect(ctx.operator).openLine(ctx.member.address, [1_000n * ONE_USDC], 0);
      await ctx.stableCredit.connect(ctx.member).transfer(ctx.counterparty.address, 300n * ONE_USDC);
      await ctx.access.connect(ctx.operator).revokeMember(ctx.member.address);
      await expect(clrusd.connect(ctx.member).transfer(ctx.counterparty.address, 900n * ONE_USDC)).to.be.revertedWithCustomError(clrusd, "ClearUSDEncumbered");
      await driveToDefault(issuer, ctx.member.address, ctx.operator);
      await liquidator.connect(stranger).liquidate(ctx.member.address, await issuer.getAddress(), 0, SAVINGS);
      expect(await clrusd.balanceOf(ctx.member.address)).to.equal(699n * ONE_USDC);
    });

    it("exempts the registered savings-intent factory's redeem escrows, so redeem intents work end to end, and an escrow can always return its funds", async function () {
      const { ctx, clrusd, vault, stranger, keyA } = s;
      await members();
      const factory: any = await (await ethers.getContractFactory("SavingsIntentFactory")).deploy(ctx.admin.address);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const config = (amount: bigint, receiver: string, action = 1) => ({
        depositor: ctx.member.address, receiver, transferToken: action === 1 ? s.clrusd.target : ctx.usdc.target,
        vaultToken: ctx.usdc.target, vault: vault.target, amount, expiry: now + 7 * DAY, action });
      const redeemTo = config(100n * ONE_USDC, keyA.address);
      const salt = ethers.id("redeem-1");
      const escrow = await factory.predictIntentAddress(salt, redeemTo);

      // Before a factory is registered, the escrow is a non-member like any other.
      await factory.announceIntent(salt, redeemTo);
      await expect(clrusd.connect(ctx.member).transfer(escrow, 100n * ONE_USDC)).to.be.revertedWithCustomError(clrusd, "ClearUSDReceiverNotMember");
      // Only the admin (after handover, Clear Financial's timelock) registers it.
      await expect(clrusd.connect(stranger).setIntentFactory(factory.target)).to.be.reverted;
      await expect(clrusd.setIntentFactory(factory.target)).to.emit(clrusd, "IntentFactoryUpdated").withArgs(factory.target);
      // An address the factory never announced is still refused.
      const other = await factory.predictIntentAddress(ethers.id("not-announced"), redeemTo);
      await expect(clrusd.connect(ctx.member).transfer(other, ONE_USDC)).to.be.revertedWithCustomError(clrusd, "ClearUSDReceiverNotMember");
      // Deposit intents hold USDC and are never announced.
      await expect(factory.announceIntent(salt, config(1n, keyA.address, 0))).to.be.revertedWithCustomError(factory, "SavingsIntentFactoryNotRedeem");

      // The owner's follow-up: a redeem escrow is recorded only while its depositor may receive
      // CLRUSD. Otherwise one key (CREATOR_ROLE) could set up an escrow whose refund carries a
      // member's CLRUSD to a non-member. Announced or provisioned, a non-member depositor is refused.
      const stray = { ...redeemTo, depositor: stranger.address };
      const straySalt = ethers.id("stray");
      await expect(factory.announceIntent(straySalt, stray))
        .to.be.revertedWithCustomError(factory, "SavingsIntentFactoryDepositorNotMember").withArgs(stranger.address);
      await expect(factory.createIntentDeterministic(straySalt, stray))
        .to.be.revertedWithCustomError(factory, "SavingsIntentFactoryDepositorNotMember");
      await expect(factory.settleDeterministic(straySalt, stray))
        .to.be.revertedWithCustomError(factory, "SavingsIntentFactoryDepositorNotMember");
      expect(await factory.isIntentEscrow(await factory.predictIntentAddress(straySalt, stray))).to.equal(false);

      // A deposit intent is unaffected: it holds USDC, and a non-member may fund one for a member.
      const gift = { ...config(10n * ONE_USDC, ctx.member.address, 0), depositor: stranger.address };
      const giftSalt = ethers.id("gift");
      await ctx.usdc.mint(stranger.address, 10n * ONE_USDC);
      await ctx.usdc.connect(stranger).transfer(await factory.predictIntentAddress(giftSalt, gift), 10n * ONE_USDC);
      const memberBefore = await clrusd.balanceOf(ctx.member.address);
      await factory.settleDeterministic(giftSalt, gift);
      expect(await clrusd.balanceOf(ctx.member.address)).to.equal(memberBefore + 10n * ONE_USDC);

      // End to end: fund the predicted address, settle, the receiver the depositor fixed gets USDC.
      await clrusd.connect(ctx.member).transfer(escrow, 100n * ONE_USDC);
      await factory.settleDeterministic(salt, redeemTo);
      expect(await ctx.usdc.balanceOf(keyA.address)).to.equal(100n * ONE_USDC);
      expect(await clrusd.balanceOf(escrow)).to.equal(0n);

      // An escrow recorded while its depositor was a member returns its funds even after the
      // depositor is de-listed: the check is not repeated at provisioning or refund.
      const refundable = config(50n * ONE_USDC, keyA.address);
      const salt2 = ethers.id("redeem-2");
      const escrow2 = await factory.predictIntentAddress(salt2, refundable);
      await factory.announceIntent(salt2, refundable);
      await clrusd.connect(ctx.member).transfer(escrow2, 50n * ONE_USDC);
      await factory.createIntentDeterministic(salt2, refundable); // provisioned before expiry, as the settler does
      await ctx.access.connect(ctx.operator).revokeMember(ctx.member.address);
      await advance(8 * DAY);
      await factory.refundDeterministic(salt2, refundable);
      expect(await clrusd.balanceOf(escrow2)).to.equal(0n);

      // And when the escrow itself is de-listed (the factory unregistered), it can still send.
      await ctx.access.connect(ctx.operator).grantMember(ctx.member.address);
      const now2 = (await ethers.provider.getBlock("latest"))!.timestamp;
      const third = { ...refundable, expiry: now2 + DAY };
      const salt3 = ethers.id("redeem-3");
      const escrow3 = await factory.predictIntentAddress(salt3, third);
      await factory.announceIntent(salt3, third);
      await clrusd.connect(ctx.member).transfer(escrow3, 50n * ONE_USDC);
      await factory.createIntentDeterministic(salt3, third);
      await clrusd.setIntentFactory(ethers.ZeroAddress);
      await advance(2 * DAY);
      const before = await clrusd.balanceOf(ctx.member.address);
      await factory.refundDeterministic(salt3, third);
      expect(await clrusd.balanceOf(ctx.member.address)).to.equal(before + 50n * ONE_USDC);
    });

    it("has no screening or blocking power beyond receipt by members", async function () {
      const { clrusd } = s;
      const names = clrusd.interface.fragments.filter((f: any) => f.type === "function").map((f: any) => f.name);
      expect(names.filter((n: string) => /sanction|screen|ofac|blacklist|blocklist|deny|freeze/i.test(n))).to.deep.equal([]);
    });
  });

  describe("L-D: claimToPayoutTreasury needs the sender's or the claim key's signature", function () {
    const types = { PayoutClaim: [{ name: "transferId", type: "bytes32" }, { name: "payoutTreasury", type: "address" }, { name: "payoutRefHash", type: "bytes32" }] };
    async function domain(escrow: any) {
      return { name: "ClaimEscrow", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await escrow.getAddress() };
    }

    it("reverts without a signature or with anyone else's, and pays the treasury with the claim key's or the sender's", async function () {
      const { ctx, escrow, settler, treasury, stranger } = s;
      const sender = ctx.member;
      const claimKey = ethers.Wallet.createRandom();
      await ctx.usdc.mint(sender.address, 100n * ONE_USDC);
      await ctx.usdc.connect(sender).approve(await escrow.getAddress(), ethers.MaxUint256);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const keyed = { transferId: ethers.id("link-1"), principalUsdc: 30n * ONE_USDC, sponsorFeeUsdc: ONE_USDC, expiry: now + DAY, recipientHintHash: ethers.ZeroHash, claimSigner: claimKey.address };
      await escrow.connect(sender).createTransferWithClaimKey(keyed);
      const plain = ethers.id("link-2");
      await escrow.connect(sender).createTransfer(plain, 20n * ONE_USDC, 0, now + DAY, ethers.ZeroHash);
      const ref = ethers.id("card-payout-7");
      const sign = (who: any, id: string, r = ref) => domain(escrow).then((d) =>
        who.signTypedData(d, types, { transferId: id, payoutTreasury: treasury.address, payoutRefHash: r }));

      // The settler alone: refused.
      await expect(escrow.connect(settler).claimToPayoutTreasury(keyed.transferId)).to.be.revertedWithCustomError(escrow, "ClaimEscrowSignatureRequired");
      // Somebody else's signature, the settler's own, or one for another payout: refused.
      await expect(escrow.connect(settler).claimToPayoutTreasuryWithSignature(keyed.transferId, ref, await sign(stranger, keyed.transferId)))
        .to.be.revertedWithCustomError(escrow, "ClaimEscrowBadClaimSignature");
      await expect(escrow.connect(settler).claimToPayoutTreasuryWithSignature(keyed.transferId, ref, await sign(settler, keyed.transferId)))
        .to.be.revertedWithCustomError(escrow, "ClaimEscrowBadClaimSignature");
      await expect(escrow.connect(settler).claimToPayoutTreasuryWithSignature(keyed.transferId, ref, await sign(claimKey, keyed.transferId, ethers.id("other"))))
        .to.be.revertedWithCustomError(escrow, "ClaimEscrowBadClaimSignature");
      // Not the settler, even with a good signature.
      await expect(escrow.connect(stranger).claimToPayoutTreasuryWithSignature(keyed.transferId, ref, await sign(claimKey, keyed.transferId))).to.be.reverted;

      // The claim key's signature works (card and bank payouts stay, decision 5).
      await expect(escrow.connect(settler).claimToPayoutTreasuryWithSignature(keyed.transferId, ref, await sign(claimKey, keyed.transferId)))
        .to.emit(escrow, "PayoutClaimAuthorized").withArgs(keyed.transferId, claimKey.address, ref);
      expect(await ctx.usdc.balanceOf(treasury.address)).to.equal(31n * ONE_USDC);
      // The sender's works too, here for a transfer without a claim key.
      await expect(escrow.connect(settler).claimToPayoutTreasuryWithSignature(plain, ref, await sign(sender, plain)))
        .to.emit(escrow, "TransferClaimedTreasury").withArgs(plain, treasury.address, 20n * ONE_USDC);
      expect(await ctx.usdc.balanceOf(treasury.address)).to.equal(51n * ONE_USDC);
      // Once claimed, never again.
      await expect(escrow.connect(settler).claimToPayoutTreasuryWithSignature(plain, ref, await sign(sender, plain))).to.be.revertedWith("ClaimEscrow: already claimed");
    });
  });
});
