import { ethers } from "hardhat";

/// Wires the StableCredit network the Phase 0 contracts assume:
///   AccessManager -> StableCredit -> CreditIssuer -> AssurancePool -> AssuranceOracle
///
/// None of these declare a constructor, so none of them disable initializers, and the
/// implementations can be initialized directly. Tests exercise the production logic; only
/// StableCredit and CreditIssuer are wrapped, because both expose `__X_init` under
/// `onlyInitializing` and are meant to be extended rather than deployed.
export async function deployPhase0Network() {
  const [admin, operator, member, counterparty, instrument, outsider] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
  const usdt = await MockERC20.deploy("Tether USD", "USDT", 6);
  const dai = await MockERC20.deploy("Dai Stablecoin", "DAI", 18);

  const AccessManager = await ethers.getContractFactory("AccessManager");
  const access = await AccessManager.deploy();
  await access.initialize(admin.address);
  await access.grantOperator(operator.address);

  const StableCreditHarness = await ethers.getContractFactory("StableCreditHarness");
  const stableCredit = await StableCreditHarness.deploy();
  await stableCredit.initialize("Clear Credit", "CLRC", await access.getAddress());

  const CreditIssuerHarness = await ethers.getContractFactory("CreditIssuerHarness");
  const creditIssuer = await CreditIssuerHarness.deploy();
  await creditIssuer.initialize(await stableCredit.getAddress());

  const AssurancePool = await ethers.getContractFactory("AssurancePool");
  const assurancePool = await AssurancePool.deploy();
  await assurancePool.initialize(await stableCredit.getAddress(), await usdc.getAddress());

  const MockUniswapV3Factory = await ethers.getContractFactory("MockUniswapV3Factory");
  const uniswapFactory = await MockUniswapV3Factory.deploy();

  const weth = await MockERC20.deploy("Wrapped Ether", "WETH", 18);

  const AssuranceOracle = await ethers.getContractFactory("AssuranceOracle");
  const assuranceOracle = await AssuranceOracle.deploy(
    await assurancePool.getAddress(),
    ethers.parseEther("0.2"), // 20% target RTD
    await uniswapFactory.getAddress(),
    await weth.getAddress(),
    await usdc.getAddress(),
    await usdt.getAddress(),
    await dai.getAddress(),
    ethers.ZeroAddress // no token registry
  );

  // StableCredit grants membership when a credit line is created, and CreditIssuer revokes it on
  // default. Both act on AccessManager in their own name, so both need operator access.
  await access.grantOperator(await stableCredit.getAddress());
  await access.grantOperator(await creditIssuer.getAddress());

  await stableCredit.setCreditIssuer(await creditIssuer.getAddress());
  await stableCredit.setAssurancePool(await assurancePool.getAddress());
  await assurancePool.setAssuranceOracle(await assuranceOracle.getAddress());
  await assurancePool.setTokenAddresses(
    await usdc.getAddress(),
    await usdt.getAddress(),
    await dai.getAddress()
  );

  return {
    admin, operator, member, counterparty, instrument, outsider,
    usdc, usdt, dai, weth,
    access, stableCredit, creditIssuer, assurancePool, assuranceOracle, uniswapFactory,
  };
}

/// Opens a credit line and draws against it, so `stableCredit.totalSupply()` is non-zero.
/// Spending mints credit at the moment of the transaction; that minted supply is the exposure
/// the AssurancePool reserves against.
export async function drawCredit(
  ctx: Awaited<ReturnType<typeof deployPhase0Network>>,
  amount: bigint
) {
  const { creditIssuer, stableCredit, operator, member, counterparty, access } = ctx;
  const ONE_YEAR = 365 * 24 * 60 * 60;

  await creditIssuer
    .connect(operator)
    .initializeCreditLine(member.address, amount, 0, ONE_YEAR, 30 * 24 * 60 * 60);
  await access.connect(operator).grantMember(counterparty.address);

  // Spending mints: the member goes negative, the counterparty positive.
  await stableCredit.connect(member).transfer(counterparty.address, amount);
}
