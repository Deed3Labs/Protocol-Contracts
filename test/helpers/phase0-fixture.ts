import { ethers, upgrades } from "hardhat";

/// Wires the StableCredit network the Phase 0 contracts assume:
///   AccessManager -> ClearCredit -> CreditIssuer, with the ledger's own reserve token (USDC)
///
/// Section 13 took the AssurancePool out of the credit network: the ledger keeps its own reserve
/// token and conversion, and a repayment's remainder goes to Lending Co.'s operating address
/// (`lenderOperating`, signer 18 here). The co-op's AssurancePool is deployed on its own, by
/// `deployAssurancePool` in `./assurance.ts`, and nothing in this network holds its address.
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
  const stableCredit = await upgrades.deployProxy(
    ClearCredit, ["Clear Credit", "CLRC", await access.getAddress()], { kind: "uups" }
  );

  const CreditIssuerHarness = await ethers.getContractFactory("CreditIssuerHarness");
  const creditIssuer = await CreditIssuerHarness.deploy();
  await creditIssuer.initialize(await stableCredit.getAddress());

  const NetworkRegistry = await ethers.getContractFactory("NetworkRegistry");
  const networkRegistry = await upgrades.deployProxy(NetworkRegistry, [admin.address], {
    kind: "uups",
  });

  const weth = await MockERC20.deploy("Wrapped Ether", "WETH", 18);

  // A real token registry. The bond factory opens a collection only for a token it whitelists;
  // USDC is registered, WETH is not.
  const TokenRegistry = await ethers.getContractFactory("TokenRegistry");
  const tokenRegistry = await TokenRegistry.deploy();
  await tokenRegistry.registerToken(await usdc.getAddress(), 31337, await usdc.getAddress(), 0);

  // Lending Co.'s operating address: where a repayment goes once the payout pool has what it is
  // owed (section 13, decision 2).
  const lenderOperating = (await ethers.getSigners())[18];

  // StableCredit grants membership when a credit line is created, and CreditIssuer revokes it on
  // default. Both act on AccessManager in their own name, so both need operator access.
  await access.grantOperator(await stableCredit.getAddress());
  await access.grantOperator(await creditIssuer.getAddress());

  // One ledger, a set of issuers. The registry is what makes the ledger accept more than one.
  await stableCredit.setNetworkRegistry(await networkRegistry.getAddress());
  await networkRegistry.registerIssuer(
    await creditIssuer.getAddress(),
    await stableCredit.getAddress()
  );
  await stableCredit.setReserveToken(await usdc.getAddress());
  await stableCredit.setLenderOperating(lenderOperating.address);
  // Phase 1 has no member-to-member payments: a draw must pay an active merchant or a system
  // address the admin has named (audit C-1). The counterparty stands for whoever the member pays,
  // so it is named here; tests about who may be paid set up a merchant registry of their own.
  await stableCredit.setSystemRecipient(counterparty.address, true);
  // The credit operator's powers are split by job (audit H-4). The test operator holds all three;
  // production gives each to a different key.
  for (const role of ["CREDIT_LINES_ROLE", "CREDIT_LIMITS_ROLE", "CREDIT_SETTINGS_ROLE"]) {
    await access.grantRole(ethers.id(role), operator.address);
  }

  return {
    admin, operator, member, counterparty, instrument, outsider,
    usdc, usdt, dai, weth,
    access, stableCredit, creditIssuer, tokenRegistry, networkRegistry, lenderOperating,
  };
}

/** Grants a contract or key every credit role, for tests that stand in for several jobs. */
export async function grantCreditRoles(access: any, who: string) {
  for (const role of ["CREDIT_LINES_ROLE", "CREDIT_LIMITS_ROLE", "CREDIT_SETTINGS_ROLE"]) {
    await access.grantRole(ethers.id(role), who);
  }
}

/// Opens a credit line and draws against it, so `stableCredit.totalSupply()` is non-zero.
/// Spending mints credit at the moment of the transaction.
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
