import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

const ONE_USDC = 10n ** 6n;
const MONTH = 30 * 24 * 60 * 60;

describe("BondVault", function () {
  let vault: any, usdc: any;
  let admin: any, bondContract: any, safe: any, holder: any, outsider: any;

  beforeEach(async function () {
    [admin, bondContract, safe, holder, outsider] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);

    const BondVault = await ethers.getContractFactory("BondVault");
    vault = await upgrades.deployProxy(
      BondVault,
      [admin.address, await usdc.getAddress(), 3 * MONTH],
      { kind: "uups" }
    );
    await vault.grantRole(await vault.BOND_ROLE(), bondContract.address);
    await vault.grantRole(await vault.TREASURY_ROLE(), safe.address);
  });

  async function now() {
    return BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  }

  /// A bond sold at a discount: proceeds land in the vault, face value is booked as owed.
  async function sell(bondId: number, principal: bigint, face: bigint, monthsOut: number) {
    await usdc.mint(await vault.getAddress(), principal);
    const maturity = (await now()) + BigInt(monthsOut * MONTH);
    await vault
      .connect(bondContract)
      .recordPurchase(bondId, principal, face, maturity);
  }

  async function advance(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  describe("what the vault owes", function () {
    it("books the obligation when it takes the money in", async function () {
      // Not discovered at maturity. The vault knows what it owes from the instant it is funded.
      await sell(1, 930n * ONE_USDC, 1_000n * ONE_USDC, 12);

      expect(await vault.totalPrincipal()).to.equal(930n * ONE_USDC);
      expect(await vault.totalFaceOutstanding()).to.equal(1_000n * ONE_USDC);
      expect(await vault.held()).to.equal(930n * ONE_USDC);
    });

    it("counts only what falls due inside the window", async function () {
      await sell(1, 950n * ONE_USDC, 1_000n * ONE_USDC, 1); // inside
      await sell(2, 900n * ONE_USDC, 1_000n * ONE_USDC, 12); // outside

      expect(await vault.faceDueWithin(3 * MONTH)).to.equal(1_000n * ONE_USDC);
      expect(await vault.faceDueWithin(24 * MONTH)).to.equal(2_000n * ONE_USDC);
    });
  });

  describe("the redemption reserve rises on its own", function () {
    it("holds the floor while everything is far out", async function () {
      await sell(1, 900n * ONE_USDC, 1_000n * ONE_USDC, 12);
      // Nothing due inside the window, so the floor governs: 30% of face outstanding.
      expect(await vault.requiredReserve()).to.equal(300n * ONE_USDC);
    });

    it("climbs as maturities come into view, without anyone raising it", async function () {
      // A reserve that has to be raised by hand is one that gets raised late.
      await sell(1, 900n * ONE_USDC, 1_000n * ONE_USDC, 6);
      expect(await vault.requiredReserve()).to.equal(300n * ONE_USDC);

      await advance(4 * MONTH); // now two months out, inside the window
      expect(await vault.requiredReserve()).to.equal(1_000n * ONE_USDC);
    });

    it("shrinks the deployable excess as it climbs", async function () {
      await sell(1, 900n * ONE_USDC, 1_000n * ONE_USDC, 6);
      expect(await vault.deployableExcess()).to.equal(600n * ONE_USDC);

      await advance(4 * MONTH);
      expect(await vault.deployableExcess()).to.equal(0n);
    });

    it("keeps the floor a parameter rather than a decision", async function () {
      const min = await vault.MIN_RESERVE_FLOOR_BPS();
      await expect(vault.setReserveTerms(MONTH, min - 1n))
        .to.be.revertedWithCustomError(vault, "BondVaultReserveFloorOutOfBounds");
      await expect(vault.setReserveTerms(MONTH, 10_001n))
        .to.be.revertedWithCustomError(vault, "BondVaultReserveFloorOutOfBounds");

      await vault.setReserveTerms(MONTH, 4_000n);
      expect(await vault.minReserveBps()).to.equal(4_000n);
    });
  });

  describe("the Safe takes only what is not owed soon", function () {
    it("lets the treasury take the deployable excess", async function () {
      // Money does have to reach human control; a contract cannot wire dollars anywhere.
      await sell(1, 1_000n * ONE_USDC, 1_000n * ONE_USDC, 12);
      await vault.connect(safe).withdrawDeployable(700n * ONE_USDC, safe.address);
      expect(await usdc.balanceOf(safe.address)).to.equal(700n * ONE_USDC);
    });

    it("cannot withdraw the redemption reserve", async function () {
      // The §6 test. The reserve is subtracted before the request is considered, so there is no
      // ordering in which the Safe empties the vault and restores it afterwards.
      await sell(1, 1_000n * ONE_USDC, 1_000n * ONE_USDC, 12);
      expect(await vault.deployableExcess()).to.equal(700n * ONE_USDC);

      await expect(vault.connect(safe).withdrawDeployable(701n * ONE_USDC, safe.address))
        .to.be.revertedWithCustomError(vault, "BondVaultWouldBreachReserve");
    });

    it("cannot drain the vault a slice at a time either", async function () {
      await sell(1, 1_000n * ONE_USDC, 1_000n * ONE_USDC, 12);
      await vault.connect(safe).withdrawDeployable(700n * ONE_USDC, safe.address);
      await expect(vault.connect(safe).withdrawDeployable(1n, safe.address))
        .to.be.revertedWithCustomError(vault, "BondVaultWouldBreachReserve");
    });

    it("is gated to the treasury role", async function () {
      await sell(1, 1_000n * ONE_USDC, 1_000n * ONE_USDC, 12);
      await expect(vault.connect(outsider).withdrawDeployable(1n, outsider.address))
        .to.be.reverted;
    });
  });

  describe("redemption", function () {
    it("pays face value out of the vault", async function () {
      await sell(1, 1_000n * ONE_USDC, 1_000n * ONE_USDC, 1);
      await advance(2 * MONTH);

      await vault.connect(bondContract).settle(1, holder.address);
      expect(await usdc.balanceOf(holder.address)).to.equal(1_000n * ONE_USDC);
      expect(await vault.totalFaceOutstanding()).to.equal(0n);
      expect(await vault.totalFaceSettled()).to.equal(1_000n * ONE_USDC);
    });

    it("refuses to settle the same bond twice", async function () {
      await sell(1, 1_000n * ONE_USDC, 1_000n * ONE_USDC, 1);
      await vault.connect(bondContract).settle(1, holder.address);
      await expect(vault.connect(bondContract).settle(1, holder.address))
        .to.be.revertedWithCustomError(vault, "BondVaultAlreadySettled");
    });

    it("is gated to the bond contract", async function () {
      await sell(1, 1_000n * ONE_USDC, 1_000n * ONE_USDC, 1);
      await expect(vault.connect(outsider).settle(1, outsider.address)).to.be.reverted;
    });

    it("reports whether it can cover what is due, not merely whether it is solvent", async function () {
      // A vault can be solvent in aggregate and short on timing, which is the failure that
      // actually happens.
      await sell(1, 500n * ONE_USDC, 1_000n * ONE_USDC, 1);
      expect(await vault.held()).to.equal(500n * ONE_USDC);
      expect(await vault.coversNearTermMaturities()).to.equal(false);

      await usdc.mint(await vault.getAddress(), 500n * ONE_USDC);
      expect(await vault.coversNearTermMaturities()).to.equal(true);
    });
  });
});
