import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { advance, ONE_USDC, DAY } from "./deep-setup";
import { deployPhase0Network } from "../../helpers/phase0-fixture";
import { deployAssurancePool, fund as fundAssurance, balances, TAG } from "../../helpers/assurance";
import { deployBondFactory, deployBondStack } from "../../helpers/bonds";
import { deployBarePool } from "../../helpers/yieldPool";

/*
 * Phase 1, workstream 1B: regression tests for the money peripherals.
 *
 * X-7, X-9 and X-10 are the flipped versions of the exploit tests in DeepPoC.spec.ts and
 * DeepPoC2.spec.ts (which also hold the lead's tests, so those files are left as they are).
 * Every other test here is new and asserts that the attack or the accounting error a finding
 * describes no longer works.
 */

const MONTH = 30 * DAY;

async function now(): Promise<number> {
  return (await ethers.provider.getBlock("latest"))!.timestamp;
}

/* ------------------------------------------------------------------ helpers: vault and USDC */

async function deployVault(admin: any, token: any) {
  const ClearUSD = await ethers.getContractFactory("ClearUSD");
  const clrusd: any = await ClearUSD.deploy(admin.address, 0, 0);
  const Vault = await ethers.getContractFactory("ESADepositVault");
  const vault: any = await upgrades.deployProxy(Vault, [await clrusd.getAddress(), admin.address], { kind: "uups" });
  await clrusd.grantIssuerRoles(await vault.getAddress());
  await vault.setAcceptedToken(await token.getAddress(), true);
  return { clrusd, vault };
}

async function signReceiveWithAuthorization(token: any, from: any, to: string, value: bigint, nonce: string) {
  const validAfter = 0n;
  const validBefore = BigInt((await now()) + 3600);
  const domain = {
    name: await token.name(),
    version: "2",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await token.getAddress(),
  };
  const types = {
    ReceiveWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };
  const sig = ethers.Signature.from(
    await from.signTypedData(domain, types, { from: from.address, to, value, validAfter, validBefore, nonce })
  );
  return { validAfter, validBefore, nonce, v: sig.v, r: sig.r, s: sig.s };
}

async function vaultDomain(vault: any) {
  return {
    name: "ESADepositVault",
    version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await vault.getAddress(),
  };
}

/* ------------------------------------------------------------------ helpers: lending pool */

// Phase 2f: the LendingPool is the Yield Pool, with its valuation module and mock Earn controls.
// Signers 17-19 are Clear Lending's lending account and the two Deployment signers.
async function deployLendingPool(admin: any) {
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc: any = await MockERC20.deploy("USDC", "USDC", 6);
  const signers = await ethers.getSigners();
  const lending = signers[17];
  const { pool: lp, controls, deploy } = await deployBarePool(admin, usdc, lending, [signers[18], signers[19]]);
  return { usdc, lp, controls, deploy, lending };
}

describe("PERIPHERAL REGRESSIONS (Phase 1, workstream 1B)", function () {
  /* ================================================================ ESADepositVault */

  describe("ESADepositVault", function () {
    it("M-5: a gasless deposit cannot mint CLRUSD to a receiver the depositor did not sign for", async function () {
      const [admin, relayer, depositor, attacker, friend] = await ethers.getSigners();
      const usdc: any = await (await ethers.getContractFactory("MockERC3009")).deploy("USD Coin", "USDC", 6);
      const { clrusd, vault } = await deployVault(admin, usdc);
      await vault.grantRole(await vault.RELAYER_ROLE(), relayer.address);
      await usdc.mint(depositor.address, 1_000n * ONE_USDC);
      const amount = 100n * ONE_USDC;

      // The relayer used to pick the receiver. Pointing it at itself now fails.
      let auth = await signReceiveWithAuthorization(usdc, depositor, await vault.getAddress(), amount, ethers.id("n1"));
      await expect(
        vault.connect(relayer).depositWithAuthorization(
          depositor.address, await usdc.getAddress(), amount, attacker.address,
          auth.validAfter, auth.validBefore, auth.nonce, auth.v, auth.r, auth.s
        )
      ).to.be.revertedWithCustomError(vault, "ESADepositVaultReceiverNotAuthorized");

      // To the depositor, as the depositor's own signature names: fine.
      await vault.connect(relayer).depositWithAuthorization(
        depositor.address, await usdc.getAddress(), amount, depositor.address,
        auth.validAfter, auth.validBefore, auth.nonce, auth.v, auth.r, auth.s
      );
      expect(await clrusd.balanceOf(depositor.address)).to.equal(amount);

      // To somebody else, only with a DepositIntent the depositor signed, tied to this authorization.
      auth = await signReceiveWithAuthorization(usdc, depositor, await vault.getAddress(), amount, ethers.id("n2"));
      const intentTypes = {
        DepositIntent: [
          { name: "depositor", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "receiver", type: "address" },
          { name: "authNonce", type: "bytes32" },
        ],
      };
      const intent = { depositor: depositor.address, token: await usdc.getAddress(), amount, receiver: friend.address, authNonce: auth.nonce };
      const intentSig = await depositor.signTypedData(await vaultDomain(vault), intentTypes, intent);
      // The relayer cannot reuse that intent for a receiver of its own choosing.
      await expect(
        vault.connect(relayer).depositWithAuthorizationFor(depositor.address, await usdc.getAddress(), amount, attacker.address, auth, intentSig)
      ).to.be.revertedWithCustomError(vault, "ESADepositVaultReceiverNotAuthorized");
      await vault.connect(relayer).depositWithAuthorizationFor(depositor.address, await usdc.getAddress(), amount, friend.address, auth, intentSig);
      expect(await clrusd.balanceOf(friend.address)).to.equal(amount);
      expect(await clrusd.balanceOf(attacker.address)).to.equal(0n);
    });

    it("M-5: a smart-contract wallet (EIP-1271) can redeem gaslessly", async function () {
      const [admin, relayer, owner] = await ethers.getSigners();
      const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
      const { clrusd, vault } = await deployVault(admin, usdc);
      await vault.grantRole(await vault.RELAYER_ROLE(), relayer.address);
      const wallet: any = await (await ethers.getContractFactory("MockERC1271Wallet")).deploy(owner.address);
      const walletAddr = await wallet.getAddress();

      await usdc.mint(admin.address, 100n * ONE_USDC);
      await usdc.approve(await vault.getAddress(), 100n * ONE_USDC);
      await vault.deposit(await usdc.getAddress(), 100n * ONE_USDC, walletAddr);
      await wallet.connect(owner).execute(
        await clrusd.getAddress(),
        clrusd.interface.encodeFunctionData("approve", [await vault.getAddress(), ethers.MaxUint256])
      );

      const deadline = BigInt((await now()) + 3600);
      const types = {
        Redeem: [
          { name: "redeemer", type: "address" },
          { name: "token", type: "address" },
          { name: "clrusdAmount", type: "uint256" },
          { name: "receiver", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = { redeemer: walletAddr, token: await usdc.getAddress(), clrusdAmount: 40n * ONE_USDC, receiver: owner.address, nonce: 0n, deadline };
      const sig = await owner.signTypedData(await vaultDomain(vault), types, value);
      await vault.connect(relayer).redeemWithSignature(walletAddr, await usdc.getAddress(), 40n * ONE_USDC, owner.address, deadline, sig);
      expect(await usdc.balanceOf(owner.address)).to.equal(40n * ONE_USDC);

      // The 65-byte path goes through SignatureChecker too.
      const value2 = { ...value, nonce: 1n };
      const s2 = ethers.Signature.from(await owner.signTypedData(await vaultDomain(vault), types, value2));
      await vault.connect(relayer).redeemWithAuthorization(walletAddr, await usdc.getAddress(), 40n * ONE_USDC, owner.address, deadline, s2.v, s2.r, s2.s);
      expect(await usdc.balanceOf(owner.address)).to.equal(80n * ONE_USDC);
    });

    it("H-3: the depositor can cancel their own mandate, and only the relayer can cancel by digest", async function () {
      const [admin, relayer, depositor, stranger] = await ethers.getSigners();
      const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
      const { vault } = await deployVault(admin, usdc);
      await vault.grantRole(await vault.RELAYER_ROLE(), relayer.address);
      const start = BigInt(await now());
      const terms = [await usdc.getAddress(), 10n * ONE_USDC, 7 * DAY, 4, start, start + 60n * BigInt(DAY), 1n] as const;
      const digest = await vault.hashDepositMandate(depositor.address, ...terms);

      await expect(vault.connect(stranger).cancelMandate(digest)).to.be.reverted;
      // A stranger calling the depositor path only cancels a mandate under their own address.
      await vault.connect(stranger).cancelOwnMandate(...terms);
      expect((await vault.depositMandates(digest)).cancelled).to.equal(false);

      await vault.connect(depositor).cancelOwnMandate(...terms);
      expect((await vault.depositMandates(digest)).cancelled).to.equal(true);
    });

    it("M-7 prep: the vault re-points at ClearUSDUpgradeable only once the old CLRUSD supply is zero", async function () {
      const [admin, user, relayer] = await ethers.getSigners();
      const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
      const { clrusd, vault } = await deployVault(admin, usdc);
      const Upgradeable = await ethers.getContractFactory("ClearUSDUpgradeable");
      const next: any = await upgrades.deployProxy(
        Upgradeable,
        ["Clear USD", "CLRUSD", 6, 0, 0, admin.address, admin.address],
        { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] }
      );
      await next.grantMintAndBurnRoles(await vault.getAddress());

      await usdc.mint(user.address, 100n * ONE_USDC);
      await usdc.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
      await vault.connect(user).deposit(await usdc.getAddress(), 100n * ONE_USDC, user.address);
      await expect(vault.setClrusd(await next.getAddress()))
        .to.be.revertedWithCustomError(vault, "ESADepositVaultTokenStillOutstanding");
      // Settings are the admin's alone: the relayer cannot re-point the vault.
      await vault.grantRole(await vault.RELAYER_ROLE(), relayer.address);
      await expect(vault.connect(relayer).setClrusd(await next.getAddress())).to.be.reverted;

      await clrusd.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
      await vault.connect(user).redeem(await usdc.getAddress(), 100n * ONE_USDC, user.address);
      await vault.setClrusd(await next.getAddress());

      await vault.connect(user).deposit(await usdc.getAddress(), 60n * ONE_USDC, user.address);
      expect(await next.balanceOf(user.address)).to.equal(60n * ONE_USDC);
    });
  });

  /* ================================================================ ClaimEscrow */

  describe("ClaimEscrow", function () {
    async function setup() {
      const [admin, sender, settler, recipient, treasury] = await ethers.getSigners();
      const usdc: any = await (await ethers.getContractFactory("MockERC3009")).deploy("USD Coin", "USDC", 6);
      const Escrow = await ethers.getContractFactory("ClaimEscrow");
      const escrow: any = await upgrades.deployProxy(Escrow, [await usdc.getAddress(), treasury.address, admin.address], { kind: "uups" });
      await escrow.grantRole(await escrow.SETTLER_ROLE(), settler.address);
      await usdc.mint(sender.address, 10_000n * ONE_USDC);
      await usdc.connect(sender).approve(await escrow.getAddress(), ethers.MaxUint256);
      const claimKey = ethers.Wallet.createRandom();
      return { admin, sender, settler, recipient, treasury, usdc, escrow, claimKey };
    }

    async function signClaim(escrow: any, signer: any, transferId: string, wallet: string) {
      const domain = { name: "ClaimEscrow", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await escrow.getAddress() };
      const types = { Claim: [{ name: "transferId", type: "bytes32" }, { name: "recipientWallet", type: "address" }] };
      return signer.signTypedData(domain, types, { transferId, recipientWallet: wallet });
    }

    it("H-4: the send relayer cannot claim an escrow to a wallet of its choosing; the claim key decides", async function () {
      const { sender, settler, recipient, usdc, escrow, claimKey } = await setup();
      const transferId = ethers.id("link-1");
      await escrow.connect(sender).createTransferWithClaimKey({
        transferId, principalUsdc: 100n * ONE_USDC, sponsorFeeUsdc: 0n,
        expiry: BigInt((await now()) + 3600), recipientHintHash: ethers.ZeroHash, claimSigner: claimKey.address,
      });

      // The old one-argument path no longer moves money at all.
      await expect(escrow.connect(settler).claimToWallet(transferId, settler.address))
        .to.be.revertedWithCustomError(escrow, "ClaimEscrowSignatureRequired");
      // The settler signing for itself is not the claim key, and neither is the sender.
      for (const who of [settler, sender]) {
        const forged = await signClaim(escrow, who, transferId, settler.address);
        await expect(escrow.connect(settler).claimToWalletWithSignature(transferId, settler.address, forged))
          .to.be.revertedWithCustomError(escrow, "ClaimEscrowBadClaimSignature");
      }

      const sig = await signClaim(escrow, claimKey, transferId, recipient.address);
      await escrow.connect(settler).claimToWalletWithSignature(transferId, recipient.address, sig);
      expect(await usdc.balanceOf(recipient.address)).to.equal(100n * ONE_USDC);
      expect(await usdc.balanceOf(settler.address)).to.equal(0n);
    });

    it("H-4: a gasless transfer commits to its claim key through the sender's EIP-3009 nonce", async function () {
      const { sender, settler, escrow, usdc, claimKey } = await setup();
      const terms = {
        transferId: ethers.id("link-2"), principalUsdc: 50n * ONE_USDC, sponsorFeeUsdc: 1n * ONE_USDC,
        expiry: BigInt((await now()) + 3600), recipientHintHash: ethers.ZeroHash, claimSigner: claimKey.address,
      };
      const nonce = await escrow.transferTermsHash(terms);
      const auth = await signReceiveWithAuthorization(usdc, sender, await escrow.getAddress(), 51n * ONE_USDC, nonce);

      // The relayer swaps in a claim key of its own: the nonce no longer matches.
      await expect(
        escrow.connect(settler).createTransferWithAuthorizationAndClaimKey(sender.address, { ...terms, claimSigner: settler.address }, auth)
      ).to.be.revertedWithCustomError(escrow, "ClaimEscrowTermsNotAuthorized");

      await escrow.connect(settler).createTransferWithAuthorizationAndClaimKey(sender.address, terms, auth);
      expect(await escrow.claimSignerOf(terms.transferId)).to.equal(claimKey.address);
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(51n * ONE_USDC);
    });

    it("H-4: a claim cannot race refundExpired -- claims end at expiry, refunds start after it", async function () {
      const { sender, settler, recipient, escrow, claimKey } = await setup();
      const transferId = ethers.id("link-3");
      const expiry = BigInt((await now()) + 100);
      await escrow.connect(sender).createTransferWithClaimKey({
        transferId, principalUsdc: 10n * ONE_USDC, sponsorFeeUsdc: 0n, expiry, recipientHintHash: ethers.ZeroHash, claimSigner: claimKey.address,
      });
      await expect(escrow.refundExpired(transferId)).to.be.revertedWith("ClaimEscrow: not expired");

      await advance(101);
      const sig = await signClaim(escrow, claimKey, transferId, recipient.address);
      await expect(escrow.connect(settler).claimToWalletWithSignature(transferId, recipient.address, sig))
        .to.be.revertedWithCustomError(escrow, "ClaimEscrowExpired");
      await expect(escrow.connect(settler).claimToPayoutTreasuryWithSignature(transferId, ethers.ZeroHash, sig))
        .to.be.revertedWithCustomError(escrow, "ClaimEscrowExpired");
      await escrow.refundExpired(transferId);
    });
  });

  /* ================================================================ SavingsIntent */

  describe("SavingsIntentFactory / SavingsIntentEscrow", function () {
    async function setup() {
      const [admin, user, receiver, attacker] = await ethers.getSigners();
      const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
      const { clrusd, vault } = await deployVault(admin, usdc);
      const factory: any = await (await ethers.getContractFactory("SavingsIntentFactory")).deploy(admin.address);
      await usdc.mint(user.address, 10_000n * ONE_USDC);
      const config = {
        depositor: user.address, receiver: receiver.address, transferToken: await usdc.getAddress(),
        vaultToken: await usdc.getAddress(), vault: await vault.getAddress(), amount: 100n * ONE_USDC,
        expiry: BigInt((await now()) + 3600), action: 0,
      };
      return { admin, user, receiver, attacker, usdc, clrusd, vault, factory, config };
    }

    it("H-4: the funded escrow address commits to the whole config; the settler cannot swap the receiver", async function () {
      const { user, receiver, attacker, usdc, clrusd, factory, config } = await setup();
      const salt = ethers.id("intent-1");
      const funded = await factory.predictIntentAddress(salt, config);
      await usdc.connect(user).transfer(funded, config.amount);

      // Same salt, receiver swapped: a different address, with none of the member's money in it.
      const hijack = { ...config, receiver: attacker.address };
      expect(await factory.predictIntentAddress(salt, hijack)).to.not.equal(funded);
      await expect(factory.settleDeterministic(salt, hijack)).to.be.revertedWithCustomError(
        await ethers.getContractAt("SavingsIntentEscrow", funded),
        "SavingsIntentEscrowFundingIncomplete"
      );
      expect(await usdc.balanceOf(funded)).to.equal(config.amount);

      await factory.settleDeterministic(salt, config);
      expect(await clrusd.balanceOf(receiver.address)).to.equal(config.amount);
      expect(await clrusd.balanceOf(attacker.address)).to.equal(0n);
    });

    it("M-4: a one-wei donation no longer blocks a savings intent; the excess goes back to the depositor", async function () {
      const { user, receiver, attacker, usdc, clrusd, factory, config } = await setup();
      const salt = ethers.id("intent-2");
      const funded = await factory.predictIntentAddress(salt, config);
      await usdc.connect(user).transfer(funded, config.amount);
      await usdc.mint(attacker.address, 1n);
      await usdc.connect(attacker).transfer(funded, 1n); // the griefing donation

      const before = await usdc.balanceOf(user.address);
      await factory.settleDeterministic(salt, config);
      expect(await clrusd.balanceOf(receiver.address)).to.equal(config.amount);
      expect(await usdc.balanceOf(user.address)).to.equal(before + 1n);
      expect(await usdc.balanceOf(funded)).to.equal(0n);
    });
  });

  /* ================================================================ LendingPool */

  describe("LendingPool", function () {
    it("H-4, superseded by decision 17: no borrower key can draw; money leaves only as a two-person Deployment to the registered account", async function () {
      // Changed: H-4 bounded the card settler's draws by destination and daily cap. Phase 2f
      // removes direct borrowing altogether: only Clear Lending draws, as a recorded Deployment.
      const [admin, depositor, settler, float, attacker] = await ethers.getSigners();
      const { usdc, lp, deploy, lending } = await deployLendingPool(admin);
      await usdc.mint(depositor.address, 10_000n * ONE_USDC);
      await usdc.connect(depositor).approve(await lp.getAddress(), ethers.MaxUint256);
      await lp.connect(depositor).deposit(10_000n * ONE_USDC, depositor.address);
      await lp.grantRole(await lp.BORROWER_ROLE(), settler.address);

      await expect(lp.connect(settler).borrow(1n, float.address))
        .to.be.revertedWithCustomError(lp, "LendingPoolDirectBorrowOff");
      expect(await lp.borrowableToday(settler.address)).to.equal(0n);
      // A leaked key cannot repoint the destination or deploy on its own.
      await expect(lp.connect(settler).setDeploymentAccount(attacker.address)).to.be.reverted;
      await expect(lp.connect(attacker).deploy(1n, ethers.ZeroHash))
        .to.be.revertedWithCustomError(lp, "LendingPoolNotAuthorized");
      await deploy(600n * ONE_USDC);
      expect(await usdc.balanceOf(lending.address)).to.equal(600n * ONE_USDC);
      expect(await usdc.balanceOf(attacker.address)).to.equal(0n);
      expect(await usdc.balanceOf(float.address)).to.equal(0n);
    });

    it("X-7, replaced by C4: a depositor who queues just before a loss carries their share of it, and is filled at the Share Value at fill", async function () {
      // Changed: X-7 capped a queued claim at its value when queued. The spec (C4) keeps queued
      // shares earning and bearing losses and fills them at the Share Value at fill, which still
      // stops a leaver escaping a loss by queueing just before it.
      const [admin, a, b, v1, v2] = await ethers.getSigners();
      const { usdc, lp, deploy, lending } = await deployLendingPool(admin);
      for (const v of [v1, v2]) await lp.grantRole(await lp.VALUATION_ROLE(), v.address);
      for (const w of [a, b]) {
        await usdc.mint(w.address, 1_000n * ONE_USDC);
        await usdc.connect(w).approve(await lp.getAddress(), ethers.MaxUint256);
        await lp.connect(w).deposit(1_000n * ONE_USDC, w.address);
      }
      await deploy(1_500n * ONE_USDC); // only 500 cash left
      await lp.connect(a).requestWithdrawal(await lp.balanceOf(a.address), a.address);
      await lp.connect(v1).postLossCharge(1_000n * ONE_USDC, ethers.id("loss"));
      await lp.connect(v2).postLossCharge(1_000n * ONE_USDC, ethers.id("loss"));

      // The loss is shared: 500 each.
      expect(await lp.convertToAssets(await lp.queuedShares())).to.be.closeTo(500n * ONE_USDC, ONE_USDC / 100n);
      expect(await lp.previewRedeem(await lp.balanceOf(b.address))).to.be.closeTo(500n * ONE_USDC, ONE_USDC / 100n);

      await usdc.mint(lending.address, 500n * ONE_USDC);
      await usdc.connect(lending).approve(await lp.getAddress(), ethers.MaxUint256);
      await lp.connect(lending).returnFunds(500n * ONE_USDC); // a later Return
      await lp.fillQueue(10);
      expect(await usdc.balanceOf(a.address)).to.be.closeTo(500n * ONE_USDC, ONE_USDC / 100n);
    });

    it("X-18, superseded: interest is a receivable accruing per second, so a Return moves no price and a just-in-time deposit captures none of it", async function () {
      // Changed: X-18 streamed interest that arrived as cash. Pool Interest now accrues per second
      // on the Deployed Balance (Earn §6), so it is in the Share Value before it is paid, and paying
      // it is a Return that changes nothing.
      const [admin, alice, jit] = await ethers.getSigners();
      const { usdc, lp, deploy, lending } = await deployLendingPool(admin);
      for (const w of [alice, jit, lending]) {
        await usdc.mint(w.address, 10_000n * ONE_USDC);
        await usdc.connect(w).approve(await lp.getAddress(), ethers.MaxUint256);
      }
      await lp.connect(alice).deposit(1_000n * ONE_USDC, alice.address);
      await deploy(500n * ONE_USDC);
      await advance(180 * DAY);

      await lp.connect(jit).deposit(1_000n * ONE_USDC, jit.address);
      const sv = await lp.shareValue();
      await lp.connect(lending).returnFunds(500n * ONE_USDC + (await lp.accruedInterest()));
      expect(await lp.shareValue()).to.be.closeTo(sv, 10n ** 9n);
      const before = await usdc.balanceOf(jit.address);
      await lp.connect(jit).redeem(await lp.balanceOf(jit.address), jit.address, jit.address);
      const captured = (await usdc.balanceOf(jit.address)) - before - 1_000n * ONE_USDC;
      expect(captured).to.be.lessThan(ONE_USDC / 100n);
      // The depositor who was there has it already.
      expect(await lp.previewRedeem(await lp.balanceOf(alice.address))).to.be.greaterThan(1_009n * ONE_USDC);
    });

    it("M-3: an unreadable encumbrance source keeps a pledger's shares locked, frees a non-pledger's, and blocks seizure", async function () {
      const [admin, pledger, saver, liquidator] = await ethers.getSigners();
      const { usdc, lp, controls } = await deployLendingPool(admin);
      // Two accounts of one Holder, so the transfer allowlist (Earn §6) lets them move between them.
      await controls.link(pledger.address, saver.address);
      const signals: any = await (await ethers.getContractFactory("MockCollateralSignals")).deploy();
      await lp.setEncumbranceSource(await signals.getAddress(), ethers.id("LP"));
      await lp.grantRole(await lp.LIQUIDATOR_ROLE(), liquidator.address);
      for (const w of [pledger, saver]) {
        await usdc.mint(w.address, 1_000n * ONE_USDC);
        await usdc.connect(w).approve(await lp.getAddress(), ethers.MaxUint256);
        await lp.connect(w).deposit(1_000n * ONE_USDC, w.address);
      }
      await signals.setLock(pledger.address, 600n * ONE_USDC);
      await lp.syncEncumbrance(pledger.address);
      expect(await lp.lastKnownLock(pledger.address)).to.equal(600n * ONE_USDC);

      await signals.setBroken(true);
      // Fails closed for the pledger: not even the unpledged part leaves while the source is dark.
      await expect(lp.connect(pledger).transfer(saver.address, 1n)).to.be.revertedWithCustomError(lp, "LendingPoolEncumbered");
      // Fails open, loudly, for someone who never pledged.
      await expect(lp.connect(saver).transfer(pledger.address, 1n))
        .to.emit(lp, "EncumbranceSourceReverted")
        .withArgs(saver.address, 0n);
      // And "fully locked" is not a licence to take anything: since Phase 2f stage 2 (C5, decision 7)
      // there is no seizure at all, and LIQUIDATOR_ROLE (granted above) exempts nothing.
      expect(lp.interface.getFunction("seizeShares")).to.equal(null);
      await lp.connect(pledger).approve(liquidator.address, 1n);
      await expect(lp.connect(liquidator).transferFrom(pledger.address, liquidator.address, 1n))
        .to.be.revertedWithCustomError(lp, "LendingPoolEncumbered");
    });
  });

  /* ================================================================ ClearUSDUpgradeable */

  it("M-3: CLRUSD keeps a holder's last recorded lock (and only that) when the source reverts, and moves for one who never pledged", async function () {
    const [admin, pledger, saver, liquidator] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("ClearUSDUpgradeable");
    const clrusd: any = await upgrades.deployProxy(
      Token,
      ["Clear USD", "CLRUSD", 6, 0, 0, admin.address, admin.address],
      { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] }
    );
    await clrusd.grantRole(await clrusd.MINTER_ROLE(), admin.address);
    await clrusd.grantRole(await clrusd.LIQUIDATOR_ROLE(), liquidator.address);
    const signals: any = await (await ethers.getContractFactory("MockCollateralSignals")).deploy();
    await clrusd.setEncumbranceSource(await signals.getAddress());
    await clrusd.mint(pledger.address, 1_000n * ONE_USDC);
    await clrusd.mint(saver.address, 1_000n * ONE_USDC);

    // A draw happens; the credit side (or anyone) records the lock.
    await signals.setLock(pledger.address, 400n * ONE_USDC);
    await clrusd.syncEncumbrance(pledger.address);
    expect(await clrusd.lastKnownLockOf(pledger.address)).to.equal(400n * ONE_USDC);

    await signals.setBroken(true);
    // This used to return 0 and let the pledger walk away with all 1,000. Now the recorded 400
    // stays locked -- and only that: the rest is theirs (DECISIONS #2, DFAL 10a).
    await expect(clrusd.connect(pledger).transfer(saver.address, 1_000n * ONE_USDC))
      .to.be.revertedWithCustomError(clrusd, "ClearUSDEncumbered");
    expect(await clrusd.freeBalanceOf(pledger.address)).to.equal(600n * ONE_USDC);
    await clrusd.connect(pledger).transfer(saver.address, 600n * ONE_USDC);
    await expect(clrusd.connect(pledger).transfer(saver.address, 1n))
      .to.be.revertedWithCustomError(clrusd, "ClearUSDEncumbered");
    await expect(clrusd.connect(saver).transfer(pledger.address, 10n * ONE_USDC))
      .to.emit(clrusd, "EncumbranceSourceReverted")
      .withArgs(saver.address, 0n);
    await expect(clrusd.connect(liquidator).seize(pledger.address, liquidator.address, 1n))
      .to.be.revertedWithCustomError(clrusd, "ClearUSDEncumbranceUnreadable");

    // Back up: the lock is exactly what the source says again.
    await signals.setBroken(false);
    await signals.setLock(pledger.address, 0n);
    await clrusd.connect(pledger).transfer(saver.address, 400n * ONE_USDC);
  });

  /* ================================================================ AssurancePool / oracle */

  // Section 13 retired the reserve these findings were about (primary, buffer and excess tiers,
  // multi-token deposits priced by the AssuranceOracle, loans to the payout pool and bond vault)
  // and the oracle with it. The regressions are kept as tests that the new pool cannot recur them.
  describe("AssurancePool (section 13) against the old pool's findings", function () {
    it("X-9, X-15, X-16: one asset, booked at face, so nothing is booked in another token, priced or repriced", async function () {
      // X-9 booked DAI as USDC of reserve; X-15 priced an unpriced stablecoin at $1; X-16 handed a
      // repricing gain to the withdrawable tier. The new pool takes its one asset through one
      // entry point, and every compartment sums to exactly what it holds.
      const ctx = await deployPhase0Network();
      const a = await deployAssurancePool(ctx.usdc, ctx.networkRegistry);
      expect(await a.pool.asset()).to.equal(await ctx.usdc.getAddress());
      expect(a.pool.interface.getFunction("depositToken", [ethers.ZeroAddress, 1n])).to.equal(null);
      expect(a.pool.interface.getFunction("rebalanceRTDPublic", [])).to.equal(null);
      await fundAssurance(a, ctx.usdc, a.treasury, TAG.INTERCHANGE, 100n * ONE_USDC);
      // Another token sent straight to the pool is not booked anywhere.
      await ctx.dai.mint(await a.pool.getAddress(), 10_000n * 10n ** 18n);
      const b = await balances(a.pool);
      expect(b.sum).to.equal(100n * ONE_USDC);
      expect(await a.pool.totalAccounted()).to.equal(await ctx.usdc.balanceOf(await a.pool.getAddress()));
    });

    it("M-8 / X-17: the pool lends to nobody, so there is no borrower to track", async function () {
      const ctx = await deployPhase0Network();
      const a = await deployAssurancePool(ctx.usdc, ctx.networkRegistry, { bare: true });
      for (const fn of ["lendToPayoutPool", "repayFromPayoutPool", "lendToBondVault", "repayFromBondVault", "reimburse", "depositRepayment"]) {
        expect(a.pool.interface.getFunction(fn, [1n]), fn).to.equal(null);
      }
    });
  });

  /* ================================================================ bonds */

  describe("BondVault and BurnerBond", function () {
    it("M-8 / X-17: BondVault takes a payout-pool repayment only from the payout pool, and books carry apart", async function () {
      // C1 and decision 3 (Phase 2f): the vault no longer lends. `lendToPayoutPool` is a stub that
      // lends nothing; `repayFromPayoutPool` stays, payout pool only, until old loans are repaid.
      const [admin, payout, outsider] = await ethers.getSigners();
      const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
      const vault: any = await upgrades.deployProxy(await ethers.getContractFactory("BondVault"), [admin.address, await usdc.getAddress(), 90 * DAY], { kind: "uups" });
      await vault.setBackstops(ethers.ZeroAddress, payout.address);
      await usdc.mint(await vault.getAddress(), 1_000n * ONE_USDC);
      expect(await vault.connect(payout).lendToPayoutPool.staticCall(100n * ONE_USDC)).to.equal(0n);
      await vault.connect(payout).lendToPayoutPool(100n * ONE_USDC);
      expect(await vault.held()).to.equal(1_000n * ONE_USDC);
      expect(await vault.lentToPayoutPool()).to.equal(0n);

      for (const w of [payout, outsider]) {
        await usdc.mint(w.address, 200n * ONE_USDC);
        await usdc.connect(w).approve(await vault.getAddress(), ethers.MaxUint256);
      }
      await expect(vault.connect(outsider).repayFromPayoutPool(100n * ONE_USDC))
        .to.be.revertedWithCustomError(vault, "BondVaultNotTrackedBorrower");
      await expect(vault.connect(payout).repayFromPayoutPool(5n * ONE_USDC))
        .to.emit(vault, "InterestReceived")
        .withArgs(0n, 5n * ONE_USDC);
    });

    it("X-10: reading face due within the window costs the same however many bonds are outstanding", async function () {
      // Flipped from DeepPoC2.spec.ts > X-10, where each $100 bond added ~8,000 gas to every RTD read.
      // Phase 2f: bonds are bought by quote (the $250 minimum is EarnControls'), and the reserve
      // reads two trees (every bond's face, and confirmed rolls) plus the glide bands.
      const ctx = await deployPhase0Network();
      const { admin, usdc, tokenRegistry, outsider } = ctx;
      const s = await deployBondStack(admin, usdc, tokenRegistry, { rungs: [[365, 475]] });
      const before = await s.vault.requiredReserve.estimateGas();
      const N = 20;
      for (let i = 0; i < N; i++) await s.buy(outsider, 500n * ONE_USDC, 365);
      const after = await s.vault.requiredReserve.estimateGas();
      expect(after - before).to.be.lessThan(50_000n); // a fixed number of bucket reads, not N
      expect(await s.vault.outstandingCount()).to.equal(BigInt(N));
      expect(await s.vault.faceDueWithin(366 * DAY)).to.equal(BigInt(N) * 500n * ONE_USDC);
    });

    async function bondSetup() {
      const ctx = await deployPhase0Network();
      const signers = await ethers.getSigners();
      const [buyer, liquidator, owner] = [signers[8], signers[10], ctx.admin];
      const s = await deployBondStack(owner, ctx.usdc, ctx.tokenRegistry);
      const bond = s.bond;
      await bond.setLiquidator(liquidator.address); // before any bond: takes effect at once
      const { id } = await s.buy(buyer, 1_000n * ONE_USDC, 365);
      return { ctx, s, bond, buyer, liquidator, owner, id };
    }

    it("M-6, superseded by founder answer G: no seizeBond; a pledged bond is not movable by the liquidator, pledged or in default", async function () {
      const { s, bond, buyer, liquidator, id } = await bondSetup();
      // The seize path is gone (Phase 2e): the function does not exist, and nothing reaches it.
      expect(bond.interface.getFunction("seizeBond")).to.equal(null);
      const legacy = new ethers.Interface(["function seizeBond(uint256,address,address)"]);
      await expect(liquidator.sendTransaction({
        to: await bond.getAddress(), data: legacy.encodeFunctionData("seizeBond", [id, buyer.address, liquidator.address]),
      })).to.be.reverted;

      // Pledged and "in default": the named liquidator still cannot move it, and no operator can be
      // approved at all (Earn §1, Phase 2f). Only `payPledged`, asked by the pledge module, pays it.
      const signals: any = await (await ethers.getContractFactory("MockCollateralSignals")).deploy();
      await bond.setSources(await s.vault.getAddress(), await signals.getAddress(), ethers.id("BOND"), await s.controls.getAddress(), ethers.ZeroAddress);
      await signals.setInDefault(buyer.address, true);
      await signals.setItemEncumbered(buyer.address, id, true);
      await expect(bond.connect(buyer).setApprovalForAll(liquidator.address, true))
        .to.be.revertedWithCustomError(bond, "BurnerBondNoOperators");
      await expect(bond.connect(liquidator).safeTransferFrom(buyer.address, liquidator.address, id, 1, "0x")).to.be.reverted;
      await expect(bond.connect(buyer).safeTransferFrom(buyer.address, liquidator.address, id, 1, "0x"))
        .to.be.revertedWithCustomError(bond, "BurnerBondPledged");
      expect(await bond.balanceOf(buyer.address, id)).to.equal(1n);
    });

    it("M-6: once bonds exist, the owner cannot name a new liquidator (pledge module) in the same breath", async function () {
      const { bond, buyer, owner, liquidator, id } = await bondSetup();
      await bond.connect(owner).setLiquidator(owner.address);
      expect(await bond.liquidator()).to.equal(liquidator.address); // unchanged: only proposed
      expect(await bond.pendingLiquidator()).to.equal(owner.address);
      expect(await bond.balanceOf(buyer.address, id)).to.equal(1n);
      await expect(bond.connect(owner).executeLiquidatorChange())
        .to.be.revertedWithCustomError(bond, "BurnerBondLiquidatorNotReady");
      await advance(7 * DAY);
      await bond.connect(owner).executeLiquidatorChange();
      expect(await bond.liquidator()).to.equal(owner.address);
      // Removing a liquidator takes power away, so it is immediate.
      await bond.connect(owner).setLiquidator(ethers.ZeroAddress);
      expect(await bond.liquidator()).to.equal(ethers.ZeroAddress);
    });

    it("X-19: a stranger cannot create (squat) a bond collection", async function () {
      const ctx = await deployPhase0Network();
      const factory: any = await deployBondFactory(
        await ctx.tokenRegistry.getAddress(), "ipfs://b"
      );
      await expect(
        factory.connect(ctx.outsider).createCollection(await ctx.usdc.getAddress(), "USDC", "Squatted", "ipfs://evil")
      ).to.be.revertedWith("Not allowed to create collections");
      await factory.createCollection(await ctx.usdc.getAddress(), "USDC", "USD Coin", "ipfs://b");
    });
  });
});
