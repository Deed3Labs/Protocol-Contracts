import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

const ONE_USDC = 10n ** 6n;

describe("AUDIT PoC 3 — hot operational keys", function () {
  // H-3 (flipped): the attack used to pass -- the savings relayer, holding OPERATOR_ROLE, accepted
  // a worthless token, minted against it and redeemed every member's USDC. The relayer now holds
  // RELAYER_ROLE (signed deposit/redeem/mandate paths only), settings are DEFAULT_ADMIN_ROLE, and
  // the legacy OPERATOR_ROLE no longer opens anything. Even the admin cannot accept a second token.
  it("H-3: neither the relayer key (RELAYER_ROLE) nor a legacy OPERATOR_ROLE holder can accept a fake token and drain the ESA vault", async function () {
    const [admin, relayer, member, attacker] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc: any = await MockERC20.deploy("USD Coin", "USDC", 6);
    const ClearUSD = await ethers.getContractFactory("ClearUSD");
    const clrusd: any = await ClearUSD.deploy(admin.address, 0, 0);
    const Vault = await ethers.getContractFactory("ESADepositVault");
    const vault: any = await upgrades.deployProxy(Vault, [await clrusd.getAddress(), admin.address], { kind: "uups" });
    await clrusd.grantIssuerRoles(await vault.getAddress());
    await vault.setAcceptedToken(await usdc.getAddress(), true);
    // The relayer as it is wired now, plus the role documented in on-chain-authority.md before the fix.
    await vault.grantRole(await vault.RELAYER_ROLE(), relayer.address);
    await vault.grantRole(await vault.OPERATOR_ROLE(), relayer.address);

    // Members' real savings in the vault.
    await usdc.mint(member.address, 50_000n * ONE_USDC);
    await usdc.connect(member).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(member).deposit(await usdc.getAddress(), 50_000n * ONE_USDC, member.address);

    // Relayer key compromised: it can no longer accept a token at all.
    const fake: any = await MockERC20.deploy("Fake", "FAKE", 6);
    await expect(vault.connect(relayer).setAcceptedToken(await fake.getAddress(), true)).to.be.reverted;
    // And the Safe cannot be talked into a second token either: one accepted token at a time (M-5).
    await expect(vault.connect(admin).setAcceptedToken(await fake.getAddress(), true))
      .to.be.revertedWithCustomError(vault, "ESADepositVaultOneTokenOnly")
      .withArgs(await usdc.getAddress());

    await fake.mint(attacker.address, 50_000n * ONE_USDC);
    await fake.connect(attacker).approve(await vault.getAddress(), ethers.MaxUint256);
    await expect(
      vault.connect(attacker).deposit(await fake.getAddress(), 50_000n * ONE_USDC, attacker.address)
    ).to.be.revertedWithCustomError(vault, "ESADepositVaultTokenNotAccepted");

    expect(await usdc.balanceOf(attacker.address)).to.equal(0n);
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(50_000n * ONE_USDC); // members' backing intact
  });
});
