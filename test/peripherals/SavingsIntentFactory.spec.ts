import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

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
    await usdc.waitForDeployment();    const ESADepositVault = await ethers.getContractFactory("ESADepositVault");
    vault = await upgrades.deployProxy(
      ESADepositVault,
      [await clearUsd.getAddress(), admin.address],
      { kind: "uups" }
    );
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

  // The escrow address commits to the whole config (audit H-4), so every prediction names it.
  async function depositConfig(amount: bigint, expiry: bigint) {
    return {
      depositor: user.address,
      receiver: receiver.address,
      transferToken: await usdc.getAddress(),
      vaultToken: await usdc.getAddress(),
      vault: await vault.getAddress(),
      amount,
      expiry,
      action: 0,
    };
  }

  it("settles a deposit after a single transfer to the predicted escrow", async function () {
    const amount = 125n * ONE_USDC;
    const config = await depositConfig(amount, await currentExpiry());
    const salt = makeSalt("deposit-1");
    const predicted = await factory.predictIntentAddress(salt, config);

    await usdc.connect(user).transfer(predicted, amount);

    await expect(factory.settleDeterministic(salt, config)).to.emit(vault, "Deposited");

    expect(await clearUsd.balanceOf(receiver.address)).to.equal(amount);
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(amount);
  });

  // Phase 2d: the factory records a redeem escrow only after asking the transfer token whether the
  // depositor may receive it (CLRUSD's `mayReceive`), so the redeem token is ClearUSDUpgradeable.
  // The legacy ClearUSD cannot answer, so the factory refuses its redeem intents (fail closed).
  it("settles a redeem after a single CLRUSD transfer to the predicted escrow", async function () {
    const ClearUSD = await ethers.getContractFactory("ClearUSDUpgradeable");
    const clrusd: any = await upgrades.deployProxy(ClearUSD,
      ["Clear USD", "CLRUSD", 6, 0, 0, admin.address, admin.address],
      { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
    const vault2: any = await upgrades.deployProxy(await ethers.getContractFactory("ESADepositVault"),
      [await clrusd.getAddress(), admin.address], { kind: "uups" });
    await clrusd.grantMintAndBurnRoles(await vault2.getAddress());
    await vault2.setAcceptedToken(await usdc.getAddress(), true);

    const mintAmount = 200n * ONE_USDC;
    await usdc.connect(user).approve(await vault2.getAddress(), mintAmount);
    await vault2.connect(user).deposit(await usdc.getAddress(), mintAmount, user.address);

    const redeemAmount = 80n * ONE_USDC;
    const config = {
      depositor: user.address,
      receiver: receiver.address,
      transferToken: await clrusd.getAddress(),
      vaultToken: await usdc.getAddress(),
      vault: await vault2.getAddress(),
      amount: redeemAmount,
      expiry: await currentExpiry(),
      action: 1,
    };
    const salt = makeSalt("redeem-1");
    const predicted = await factory.predictIntentAddress(salt, config);

    await clrusd.connect(user).transfer(predicted, redeemAmount);

    await expect(factory.settleDeterministic(salt, config)).to.emit(vault2, "Redeemed");
    expect(await factory.isIntentEscrow(predicted)).to.equal(true);

    expect(await usdc.balanceOf(receiver.address)).to.equal(redeemAmount);
    expect(await clrusd.balanceOf(user.address)).to.equal(mintAmount - redeemAmount);
  });

  it("refuses a redeem intent on a token that cannot say whether the depositor may receive it", async function () {
    const config = {
      depositor: user.address,
      receiver: receiver.address,
      transferToken: await clearUsd.getAddress(),
      vaultToken: await usdc.getAddress(),
      vault: await vault.getAddress(),
      amount: ONE_USDC,
      expiry: await currentExpiry(),
      action: 1,
    };
    await expect(factory.announceIntent(makeSalt("legacy"), config))
      .to.be.revertedWithCustomError(factory, "SavingsIntentFactoryDepositorNotMember").withArgs(user.address);
    await expect(factory.createIntentDeterministic(makeSalt("legacy"), config))
      .to.be.revertedWithCustomError(factory, "SavingsIntentFactoryDepositorNotMember");
  });

  it("refunds a funded intent after expiry", async function () {
    const amount = 55n * ONE_USDC;
    const latest = await ethers.provider.getBlock("latest");
    const config = await depositConfig(amount, BigInt((latest?.timestamp || 0) + 30));
    const salt = makeSalt("refund-1");
    const predicted = await factory.predictIntentAddress(salt, config);

    await usdc.connect(user).transfer(predicted, amount);
    await factory.createIntentDeterministic(salt, config);

    await ethers.provider.send("evm_increaseTime", [31]);
    await ethers.provider.send("evm_mine", []);

    const userBalanceBefore = await usdc.balanceOf(user.address);
    await factory.refundDeterministic(salt, config);

    expect(await usdc.balanceOf(user.address)).to.equal(userBalanceBefore + amount);
  });

  it("rejects settlement when the funded balance is short of the intent amount", async function () {
    const amount = 90n * ONE_USDC;
    const config = await depositConfig(amount, await currentExpiry());
    const salt = makeSalt("mismatch-1");
    const predicted = await factory.predictIntentAddress(salt, config);

    await usdc.connect(user).transfer(predicted, amount - ONE_USDC);

    await expect(factory.settleDeterministic(salt, config)).to.be.revertedWithCustomError(
      await ethers.getContractAt("SavingsIntentEscrow", predicted),
      "SavingsIntentEscrowFundingIncomplete"
    );
  });
});
