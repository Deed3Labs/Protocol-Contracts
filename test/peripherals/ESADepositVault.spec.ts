import { expect } from "chai";
import { ethers } from "hardhat";

describe("ClearUSD + ESADepositVault", function () {
  let clearUsd: any;
  let vault: any;
  let usdc: any;
  let dai: any;

  let deployer: any;
  let user: any;
  let other: any;

  const ONE_USDC = 10n ** 6n;
  const ONE_DAI = 10n ** 18n;

  beforeEach(async function () {
    [deployer, user, other] = await ethers.getSigners();

    const ClearUSD = await ethers.getContractFactory("ClearUSD");
    clearUsd = await ClearUSD.deploy(deployer.address, 0, 0);
    await clearUsd.waitForDeployment();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();
    dai = await MockERC20.deploy("Dai Stablecoin", "DAI", 18);
    await dai.waitForDeployment();

    const ESADepositVault = await ethers.getContractFactory("ESADepositVault");
    vault = await ESADepositVault.deploy(await clearUsd.getAddress(), deployer.address);
    await vault.waitForDeployment();

    const minterRole = await clearUsd.MINTER_ROLE();
    const burnerRole = await clearUsd.BURNER_ROLE();
    await clearUsd.grantRole(minterRole, await vault.getAddress());
    await clearUsd.grantRole(burnerRole, await vault.getAddress());

    await vault.setAcceptedToken(await usdc.getAddress(), true);
    await vault.setAcceptedToken(await dai.getAddress(), true);

    await usdc.mint(user.address, 10_000n * ONE_USDC);
    await dai.mint(user.address, 10_000n * ONE_DAI);
  });

  it("enforces role-gated minting and burning on CLRUSD", async function () {
    await expect(clearUsd.connect(user).mint(user.address, 10n * ONE_USDC)).to.be.reverted;
    await expect(clearUsd.connect(user).burn(ONE_USDC)).to.be.reverted;
  });

  it("allows standard ERC20 transfers for CLRUSD", async function () {
    await usdc.connect(user).approve(await vault.getAddress(), 100n * ONE_USDC);
    await vault.connect(user).deposit(await usdc.getAddress(), 100n * ONE_USDC, user.address);

    await clearUsd.connect(user).transfer(other.address, 25n * ONE_USDC);
    expect(await clearUsd.balanceOf(other.address)).to.equal(25n * ONE_USDC);
  });

  it("mints CLRUSD 1:1 for USDC deposits", async function () {
    const depositAmount = 150n * ONE_USDC;
    await usdc.connect(user).approve(await vault.getAddress(), depositAmount);

    await expect(
      vault.connect(user).deposit(await usdc.getAddress(), depositAmount, user.address)
    )
      .to.emit(vault, "Deposited")
      .withArgs(
        user.address,
        user.address,
        await usdc.getAddress(),
        depositAmount,
        depositAmount
      );

    expect(await clearUsd.balanceOf(user.address)).to.equal(depositAmount);
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(depositAmount);
  });

  it("burns CLRUSD and returns USDC on redeem", async function () {
    const depositAmount = 200n * ONE_USDC;
    await usdc.connect(user).approve(await vault.getAddress(), depositAmount);
    await vault.connect(user).deposit(await usdc.getAddress(), depositAmount, user.address);

    const redeemAmount = 80n * ONE_USDC;
    await clearUsd.connect(user).approve(await vault.getAddress(), redeemAmount);
    await expect(
      vault.connect(user).redeem(await usdc.getAddress(), redeemAmount, user.address)
    )
      .to.emit(vault, "Redeemed")
      .withArgs(
        user.address,
        user.address,
        await usdc.getAddress(),
        redeemAmount,
        redeemAmount
      );

    expect(await clearUsd.balanceOf(user.address)).to.equal(depositAmount - redeemAmount);
    expect(await usdc.balanceOf(user.address)).to.equal(
      10_000n * ONE_USDC - depositAmount + redeemAmount
    );
  });

  it("supports exact 18->6 decimal conversion", async function () {
    const depositAmount = 3n * ONE_DAI;
    await dai.connect(user).approve(await vault.getAddress(), depositAmount);
    await vault.connect(user).deposit(await dai.getAddress(), depositAmount, user.address);

    expect(await clearUsd.balanceOf(user.address)).to.equal(3n * ONE_USDC);
  });

  it("rejects non-exact decimal conversions", async function () {
    await dai.connect(user).approve(await vault.getAddress(), 1n);
    await expect(
      vault.connect(user).deposit(await dai.getAddress(), 1n, user.address)
    ).to.be.revertedWithCustomError(vault, "ESADepositVaultInvalidAmount");
  });

  it("enforces token allowlist and pause controls", async function () {
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdt = await MockERC20.deploy("Tether USD", "USDT", 6);
    await usdt.waitForDeployment();
    await usdt.mint(user.address, 1_000n * ONE_USDC);
    await usdt.connect(user).approve(await vault.getAddress(), ONE_USDC);

    await expect(
      vault.connect(user).deposit(await usdt.getAddress(), ONE_USDC, user.address)
    ).to.be.revertedWithCustomError(vault, "ESADepositVaultTokenNotAccepted");

    await vault.pause();
    await usdc.connect(user).approve(await vault.getAddress(), ONE_USDC);
    await expect(
      vault.connect(user).deposit(await usdc.getAddress(), ONE_USDC, user.address)
    ).to.be.reverted;
  });

  it("maintains a simple solvency invariant for USDC-backed liabilities", async function () {
    const depositAmount = 500n * ONE_USDC;
    await usdc.connect(user).approve(await vault.getAddress(), depositAmount);
    await vault.connect(user).deposit(await usdc.getAddress(), depositAmount, user.address);

    const vaultLiquidity = await usdc.balanceOf(await vault.getAddress());
    const clrusdSupply = await clearUsd.totalSupply();

    expect(vaultLiquidity).to.equal(clrusdSupply);
  });
});
