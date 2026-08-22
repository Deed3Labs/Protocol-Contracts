import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

const FEE_TIER = 3000;
const DEFAULT_TWAP_PERIOD = 1800;

describe("AssuranceOracle", function () {
  let oracle: any;
  let factory: any;
  let usdc: any, usdt: any, dai: any, weth: any, vol: any;
  let owner: any, other: any;

  beforeEach(async function () {
    [owner, other] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    usdt = await MockERC20.deploy("Tether USD", "USDT", 6);
    dai = await MockERC20.deploy("Dai Stablecoin", "DAI", 18);
    weth = await MockERC20.deploy("Wrapped Ether", "WETH", 18);
    // Six decimals so the pool's raw-unit ratio needs no decimal correction, which keeps the
    // expected price readable: tick 0 is exactly $1.
    vol = await MockERC20.deploy("Volatile", "VOL", 6);

    const MockUniswapV3Factory = await ethers.getContractFactory("MockUniswapV3Factory");
    factory = await MockUniswapV3Factory.deploy();

    const AssuranceOracle = await ethers.getContractFactory("AssuranceOracle");
    oracle = await upgrades.deployProxy(
      AssuranceOracle,
      [
        ethers.ZeroAddress,
        ethers.parseEther("0.2"),
        await factory.getAddress(),
        await weth.getAddress(),
        await usdc.getAddress(),
        await usdt.getAddress(),
        await dai.getAddress(),
        ethers.ZeroAddress,
      ],
      { kind: "uups" }
    );
  });

  /// Wires a VOL/USDC pool whose average tick is `tick` and whose spot is `spotSqrtPriceX96`.
  async function deployPool(tick: number, spotSqrtPriceX96: bigint) {
    const MockUniswapV3Pool = await ethers.getContractFactory("MockUniswapV3Pool");
    const pool = await MockUniswapV3Pool.deploy(await vol.getAddress(), await usdc.getAddress());
    await pool.setAverageTick(tick, DEFAULT_TWAP_PERIOD);
    await pool.setSpot(spotSqrtPriceX96, tick);
    await factory.setPool(await vol.getAddress(), await usdc.getAddress(), FEE_TIER, await pool.getAddress());
    return pool;
  }

  describe("a pair whose decimals do not match", function () {
    // The rest of this spec prices a six-decimal token against six-decimal USDC, deliberately, so
    // the raw ratio needs no correction and tick 0 reads as exactly $1. That is also why none of
    // it caught this: the overflow only appears once the two sides differ.
    //
    // USDC has six decimals and WETH eighteen, so a real WETH/USDC pool carries a raw ratio near
    // 3.3e8 and its squared sqrt price reaches about 2^220. Scaling that by 1e18 before shifting
    // needs 2^280. The live Base Sepolia pool panicked on exactly this.

    it("prices an eighteen-decimal token against six-decimal USDC without overflowing", async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const bigToken = await MockERC20.deploy("Big Decimals", "BIG", 18);

      const MockUniswapV3Pool = await ethers.getContractFactory("MockUniswapV3Pool");
      // USDC sorts first on Base, so it is token0 and the eighteen-decimal side is token1.
      const pool = await MockUniswapV3Pool.deploy(
        await usdc.getAddress(),
        await bigToken.getAddress()
      );
      // ~196200 is the tick for a raw ratio of 3.3e8 — one unit of the big token being worth
      // roughly three thousand USDC.
      await pool.setAverageTick(196200, DEFAULT_TWAP_PERIOD);
      await pool.setSpot(0n, 196200);
      await factory.setPool(
        await bigToken.getAddress(),
        await usdc.getAddress(),
        FEE_TIER,
        await pool.getAddress()
      );

      const price = await oracle.getTokenPriceInUSD(await bigToken.getAddress());

      // The assertion that matters is that the call returns at all; before the fix it panicked
      // with an arithmetic overflow. The range check keeps the shift honest either way.
      expect(price).to.be.greaterThan(ethers.parseEther("2000"));
      expect(price).to.be.lessThan(ethers.parseEther("4000"));
    });
  });

  describe("deployment", function () {
    it("sets the constructor values", async function () {
      expect(await oracle.targetRTD()).to.equal(ethers.parseEther("0.2"));
      expect(await oracle.staticTargetRTD()).to.equal(ethers.parseEther("0.2"));
      expect(await oracle.uniswapFactory()).to.equal(await factory.getAddress());
      expect(await oracle.WETH_ADDRESS()).to.equal(await weth.getAddress());
      expect(await oracle.owner()).to.equal(owner.address);
    });

    it("defaults to a thirty minute averaging window", async function () {
      expect(await oracle.twapPeriod()).to.equal(DEFAULT_TWAP_PERIOD);
    });

    it("prices the constructor stablecoins at a dollar without consulting a pool", async function () {
      for (const token of [usdc, usdt, dai]) {
        expect(await oracle.getTokenPriceInUSD(await token.getAddress())).to.equal(
          ethers.parseEther("1")
        );
      }
    });
  });

  describe("price manipulation resistance", function () {
    // Prices read here decide how much token leaves the AssurancePool, so a spot read is a drain
    // vector: a flash loan moves slot0 within one transaction and moves it back. A time-weighted
    // average cannot be moved that way without holding the price across blocks.

    it("prices from the observation window, not from spot", async function () {
      const pool = await deployPool(0, 2n ** 96n);
      expect(await oracle.getTokenPriceInUSD(await vol.getAddress())).to.equal(
        ethers.parseEther("1")
      );
    });

    it("does not move when spot is manipulated within a block", async function () {
      const pool = await deployPool(0, 2n ** 96n);
      const before = await oracle.getTokenPriceInUSD(await vol.getAddress());

      // A flash loan pushes spot up a hundredfold and, in a real attack, back again. The
      // observation buffer is written across blocks and does not follow.
      await pool.setSpot(2n ** 96n * 10n, 46054);
      expect(await oracle.getTokenPriceInUSD(await vol.getAddress())).to.equal(before);

      await pool.setSpot(2n ** 96n / 10n, -46054);
      expect(await oracle.getTokenPriceInUSD(await vol.getAddress())).to.equal(before);
    });

    it("does move when the average itself moves", async function () {
      // The counterpart to the test above: proving invariance is only meaningful alongside
      // proving the oracle reads the observations at all.
      const pool = await deployPool(0, 2n ** 96n);
      expect(await oracle.getTokenPriceInUSD(await vol.getAddress())).to.equal(
        ethers.parseEther("1")
      );

      // 1.0001^6932 is approximately 2.
      await pool.setAverageTick(6932, DEFAULT_TWAP_PERIOD);
      const doubled = await oracle.getTokenPriceInUSD(await vol.getAddress());
      expect(doubled).to.be.greaterThan(ethers.parseEther("1.99"));
      expect(doubled).to.be.lessThan(ethers.parseEther("2.01"));
    });

    it("fails closed when a pool cannot serve the window, rather than falling back to spot", async function () {
      // A pool whose observation cardinality was never increased holds a single observation.
      // Falling back to spot there would reintroduce the manipulation this replaces, on exactly
      // the pools most likely to be thin.
      const pool = await deployPool(0, 2n ** 96n);
      await pool.setObservationsAvailable(false);

      await expect(oracle.getTokenPriceInUSD(await vol.getAddress())).to.be.revertedWith(
        "No price data"
      );
    });

    it("reports an unknown token as unpriceable rather than free", async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const unknown = await MockERC20.deploy("Unknown", "UNK", 18);
      await expect(oracle.getTokenPriceInUSD(await unknown.getAddress())).to.be.revertedWith(
        "No price data"
      );
    });
  });

  describe("averaging window", function () {
    it("rejects a window outside the configured bounds", async function () {
      const min = await oracle.MIN_TWAP_PERIOD();
      const max = await oracle.MAX_TWAP_PERIOD();

      await expect(oracle.setTwapPeriod(Number(min) - 1))
        .to.be.revertedWithCustomError(oracle, "TwapPeriodOutOfBounds");
      await expect(oracle.setTwapPeriod(Number(max) + 1))
        .to.be.revertedWithCustomError(oracle, "TwapPeriodOutOfBounds");

      await oracle.setTwapPeriod(min);
      expect(await oracle.twapPeriod()).to.equal(min);
    });

    it("is owner only", async function () {
      await expect(oracle.connect(other).setTwapPeriod(600)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
  });

  describe("target RTD", function () {
    // The oracle's real job is the predicted default rate feeding target RTD. That model needs
    // contracts that do not exist yet, so this is the seam it will plug into.

    it("serves the operator-set constant while no source is registered", async function () {
      expect(await oracle.targetRTDSource()).to.equal(ethers.ZeroAddress);
      expect(await oracle.targetRTD()).to.equal(ethers.parseEther("0.2"));
    });

    it("defers to a registered source once there is one", async function () {
      const MockTargetRTDSource = await ethers.getContractFactory("MockTargetRTDSource");
      const source = await MockTargetRTDSource.deploy();
      await source.setTargetRTD(ethers.parseEther("0.35"));

      await oracle.setTargetRTDSource(await source.getAddress());
      expect(await oracle.targetRTD()).to.equal(ethers.parseEther("0.35"));

      // The set constant is untouched underneath, and unsetting restores it.
      expect(await oracle.staticTargetRTD()).to.equal(ethers.parseEther("0.2"));
      await oracle.setTargetRTDSource(ethers.ZeroAddress);
      expect(await oracle.targetRTD()).to.equal(ethers.parseEther("0.2"));
    });

    it("is owner only", async function () {
      await expect(oracle.connect(other).setTargetRTDSource(other.address)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
  });
});
