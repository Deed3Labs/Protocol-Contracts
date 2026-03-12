import { expect } from "chai";
import { ethers } from "hardhat";

describe("SavingsIntentFactory", function () {
  let clearUsd: any;
  let vault: any;
  let factory: any;
  let usdc: any;

  let admin: any;
  let user: any;
  let receiver: any;

  const ONE_USDC = 10n ** 6n;

  beforeEach(async function () {
    [admin, user, receiver] = await ethers.getSigners();

    const ClearUSD = await ethers.getContractFactory("ClearUSD");
    clearUsd = await ClearUSD.deploy(admin.address, 0, 0);
    await clearUsd.waitForDeployment();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();

    const ESADepositVault = await ethers.getContractFactory("ESADepositVault");
    vault = await ESADepositVault.deploy(await clearUsd.getAddress(), admin.address);
    await vault.waitForDeployment();

    const minterRole = await clearUsd.MINTER_ROLE();
    const burnerRole = await clearUsd.BURNER_ROLE();
    await clearUsd.grantRole(minterRole, await vault.getAddress());
    await clearUsd.grantRole(burnerRole, await vault.getAddress());
    await vault.setAcceptedToken(await usdc.getAddress(), true);

    const SavingsIntentFactory = await ethers.getContractFactory("SavingsIntentFactory");
    factory = await SavingsIntentFactory.deploy(admin.address);
    await factory.waitForDeployment();

    await usdc.mint(user.address, 10_000n * ONE_USDC);
  });

  function makeSalt(label: string) {
    return ethers.keccak256(ethers.toUtf8Bytes(label));
  }

  async function currentExpiry() {
    const latest = await ethers.provider.getBlock("latest");
    return BigInt((latest?.timestamp || 0) + 3600);
  }

  it("settles a deposit after a single transfer to the predicted escrow", async function () {
    const amount = 125n * ONE_USDC;
    const expiry = await currentExpiry();
    const salt = makeSalt("deposit-1");
    const predicted = await factory.predictIntentAddress(salt);

    await usdc.connect(user).transfer(predicted, amount);

    await expect(
      factory.settleDeterministic(salt, {
        depositor: user.address,
        receiver: receiver.address,
        transferToken: await usdc.getAddress(),
        vaultToken: await usdc.getAddress(),
        vault: await vault.getAddress(),
        amount,
        expiry,
        action: 0,
      })
    ).to.emit(vault, "Deposited");

    expect(await clearUsd.balanceOf(receiver.address)).to.equal(amount);
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(amount);
  });

  it("settles a redeem after a single CLRUSD transfer to the predicted escrow", async function () {
    const mintAmount = 200n * ONE_USDC;
    await usdc.connect(user).approve(await vault.getAddress(), mintAmount);
    await vault.connect(user).deposit(await usdc.getAddress(), mintAmount, user.address);

    const redeemAmount = 80n * ONE_USDC;
    const expiry = await currentExpiry();
    const salt = makeSalt("redeem-1");
    const predicted = await factory.predictIntentAddress(salt);

    await clearUsd.connect(user).transfer(predicted, redeemAmount);

    await expect(
      factory.settleDeterministic(salt, {
        depositor: user.address,
        receiver: receiver.address,
        transferToken: await clearUsd.getAddress(),
        vaultToken: await usdc.getAddress(),
        vault: await vault.getAddress(),
        amount: redeemAmount,
        expiry,
        action: 1,
      })
    ).to.emit(vault, "Redeemed");

    expect(await usdc.balanceOf(receiver.address)).to.equal(redeemAmount);
    expect(await clearUsd.balanceOf(user.address)).to.equal(mintAmount - redeemAmount);
  });

  it("refunds a funded intent after expiry", async function () {
    const amount = 55n * ONE_USDC;
    const latest = await ethers.provider.getBlock("latest");
    const expiry = BigInt((latest?.timestamp || 0) + 30);
    const salt = makeSalt("refund-1");
    const predicted = await factory.predictIntentAddress(salt);

    await usdc.connect(user).transfer(predicted, amount);
    await factory.createIntentDeterministic(salt, {
      depositor: user.address,
      receiver: receiver.address,
      transferToken: await usdc.getAddress(),
      vaultToken: await usdc.getAddress(),
      vault: await vault.getAddress(),
      amount,
      expiry,
      action: 0,
    });

    await ethers.provider.send("evm_increaseTime", [31]);
    await ethers.provider.send("evm_mine", []);

    const userBalanceBefore = await usdc.balanceOf(user.address);
    await factory.refundDeterministic(salt, {
      depositor: user.address,
      receiver: receiver.address,
      transferToken: await usdc.getAddress(),
      vaultToken: await usdc.getAddress(),
      vault: await vault.getAddress(),
      amount,
      expiry,
      action: 0,
    });

    expect(await usdc.balanceOf(user.address)).to.equal(userBalanceBefore + amount);
  });

  it("rejects settlement when the funded balance does not match the intent amount", async function () {
    const amount = 90n * ONE_USDC;
    const expiry = await currentExpiry();
    const salt = makeSalt("mismatch-1");
    const predicted = await factory.predictIntentAddress(salt);

    await usdc.connect(user).transfer(predicted, amount - ONE_USDC);

    await expect(
      factory.settleDeterministic(salt, {
        depositor: user.address,
        receiver: receiver.address,
        transferToken: await usdc.getAddress(),
        vaultToken: await usdc.getAddress(),
        vault: await vault.getAddress(),
        amount,
        expiry,
        action: 0,
      })
    ).to.be.revertedWithCustomError(await ethers.getContractAt("SavingsIntentEscrow", predicted), "SavingsIntentEscrowFundingIncomplete");
  });
}
