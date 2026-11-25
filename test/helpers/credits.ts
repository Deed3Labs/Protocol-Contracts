import { ethers, upgrades } from "hardhat";

/// The Credits Ledger as the P0 spike proved it (PR #950): a second ClearCredit proxy with an
/// AccessManager of its own, a merchant registry whose admin has renounced it, no payout pool, no
/// reserve token, and the Points Issuer as its only issuer and only system recipient.
export async function deployCreditsNetwork() {
  const signers = await ethers.getSigners();
  const [admin, minter, membersKey, reviewerA, reviewerB, outsider] = signers;

  const AccessManager = await ethers.getContractFactory("AccessManager");
  const access = await AccessManager.deploy();
  await access.initialize(admin.address);

  const ClearCredit = await ethers.getContractFactory("ClearCredit");
  const ledger = await upgrades.deployProxy(ClearCredit, ["Clear Credits", "CREDITS", await access.getAddress()], {
    kind: "uups",
  });
  await access.grantOperator(await ledger.getAddress());

  const NetworkRegistry = await ethers.getContractFactory("NetworkRegistry");
  const registry = await upgrades.deployProxy(NetworkRegistry, [admin.address], { kind: "uups" });
  await ledger.setNetworkRegistry(await registry.getAddress());

  const MerchantRegistry = await ethers.getContractFactory("MerchantRegistry");
  const merchants = await upgrades.deployProxy(MerchantRegistry, [admin.address, 30], { kind: "uups" });
  await ledger.setMerchantRegistry(await merchants.getAddress());
  await merchants.renounceRole(await merchants.OPERATOR_ROLE(), admin.address);
  await merchants.renounceRole(await merchants.DEFAULT_ADMIN_ROLE(), admin.address);

  const PointsIssuer = await ethers.getContractFactory("PointsIssuer");
  const points = await upgrades.deployProxy(PointsIssuer, [await ledger.getAddress()], { kind: "uups" });
  await registry.registerIssuer(await points.getAddress(), await ledger.getAddress());
  await ledger.setSystemRecipient(await points.getAddress(), true);
  await access.grantOperator(await points.getAddress());
  await points.setCap(10_000_000n * 10n ** 6n);

  await access.grantRole(await points.CREDITS_MINTER_ROLE(), minter.address);
  await access.grantRole(await points.MEMBERS_ROLE(), membersKey.address);
  await access.grantRole(await points.CREDITS_REVIEW_ROLE(), reviewerA.address);
  await access.grantRole(await points.CREDITS_REVIEW_ROLE(), reviewerB.address);

  const MockHousing = await ethers.getContractFactory("MockHousingAllowanceRecord");
  const housing = await MockHousing.deploy();
  await points.setHousingRecord(await housing.getAddress());

  return { admin, minter, membersKey, reviewerA, reviewerB, outsider, access, ledger, registry, merchants, points, housing };
}

export async function signRedeem(points: any, member: any, homeId: bigint, amount: bigint, deadline: bigint, nonce?: bigint) {
  const { chainId } = await ethers.provider.getNetwork();
  const n = nonce ?? (await points.nonces(member.address));
  return member.signTypedData(
    { name: "Clear Credits", version: "1", chainId, verifyingContract: await points.getAddress() },
    {
      RedeemCredits: [
        { name: "member", type: "address" },
        { name: "homeId", type: "uint256" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    { member: member.address, homeId, amount, nonce: n, deadline }
  );
}

export async function signSpend(points: any, member: any, useId: string, amount: bigint, deadline: bigint) {
  const { chainId } = await ethers.provider.getNetwork();
  const nonce = await points.nonces(member.address);
  return member.signTypedData(
    { name: "Clear Credits", version: "1", chainId, verifyingContract: await points.getAddress() },
    {
      SpendCredits: [
        { name: "member", type: "address" },
        { name: "useId", type: "bytes32" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    { member: member.address, useId, amount, nonce, deadline }
  );
}
