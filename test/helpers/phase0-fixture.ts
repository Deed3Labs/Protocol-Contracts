import { ethers, upgrades } from "hardhat";

/// Wires the StableCredit network the Phase 0 contracts assume:
///   AccessManager -> ClearCredit -> CreditIssuer -> AssurancePool -> AssuranceOracle
///
/// None of these declare a constructor, so none of them disable initializers, and the
/// implementations can be initialized directly.
///
/// `ClearCredit` is the production ledger -- the deployable child of `StableCredit`, which has no
/// public initializer of its own. Only `CreditIssuer` is still wrapped in a harness, and rightly:
/// production deploys `RevolvingIssuer` and `TermIssuer`, never a bare one, so its harness exists
/// to exercise the base class in isolation rather than to stand in for something shipped.
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

  // The production ledger, not a harness: a test that proves a contract nobody deploys has
  // proved the wrong contract.
  const ClearCredit = await ethers.getContractFactory("ClearCredit");
  const stableCredit = await ClearCredit.deploy();
  await stableCredit.initialize("Clear Credit", "CLRC", await access.getAddress());

  const CreditIssuerHarness = await ethers.getContractFactory("CreditIssuerHarness");
  const creditIssuer = await CreditIssuerHarness.deploy();
  await creditIssuer.initialize(await stableCredit.getAddress());

  const NetworkRegistry = await ethers.getContractFactory("NetworkRegistry");
  const networkRegistry = await upgrades.deployProxy(NetworkRegistry, [admin.address], {
    kind: "uups",
  });

  const AssurancePool = await ethers.getContractFactory("AssurancePool");
  const assurancePool = await AssurancePool.deploy();
  await assurancePool.initialize(await stableCredit.getAddress(), await usdc.getAddress());

  const MockUniswapV3Factory = await ethers.getContractFactory("MockUniswapV3Factory");
  const uniswapFactory = await MockUniswapV3Factory.deploy();

  const weth = await MockERC20.deploy("Wrapped Ether", "WETH", 18);

  // A real token registry, so tests can exercise the acceptance path as configured in
  // production: the pool accepts more than the reserve token and the three named stablecoins.
  const TokenRegistry = await ethers.getContractFactory("TokenRegistry");
  const tokenRegistry = await TokenRegistry.deploy();

  const AssuranceOracle = await ethers.getContractFactory("AssuranceOracle");
  const assuranceOracle = await upgrades.deployProxy(AssuranceOracle, [
    await assurancePool.getAddress(),
    ethers.parseEther("0.2"), // 20% target RTD
    await uniswapFactory.getAddress(),
    await weth.getAddress(),
    await usdc.getAddress(),
    await usdt.getAddress(),
    await dai.getAddress(),
    await tokenRegistry.getAddress(),
  ], { kind: "uups" });

  // StableCredit grants membership when a credit line is created, and CreditIssuer revokes it on
  // default. Both act on AccessManager in their own name, so both need operator access.
  await access.grantOperator(await stableCredit.getAddress());
  await access.grantOperator(await creditIssuer.getAddress());

  // One ledger, a set of issuers. The registry is what makes the ledger accept more than one.
  await stableCredit.setNetworkRegistry(await networkRegistry.getAddress());
  await networkRegistry.registerIssuer(
    await creditIssuer.getAddress(),
    await stableCredit.getAddress(),
    await assurancePool.getAddress(),
    await assuranceOracle.getAddress()
  );
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
    tokenRegistry, networkRegistry,
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
