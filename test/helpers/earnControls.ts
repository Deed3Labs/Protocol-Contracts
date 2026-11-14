import { ethers, upgrades } from "hardhat";
import { U, latest } from "./yieldPool";

export const RESOLUTION = ethers.id("lending board resolution");
export const code = (s: string) => ethers.encodeBytes32String(s);

/** Deploys `EarnControls` behind a UUPS proxy with `admin` as its admin (the Earn timelock in production). */
export async function deployEarnControls(
  admin: any,
  opts: { membership?: string; fundingLimit?: bigint; offeringCap?: bigint; holderCapFloor?: bigint } = {}
) {
  return upgrades.deployProxy(
    await ethers.getContractFactory("EarnControls", admin),
    [
      admin.address,
      6,
      opts.membership ?? ethers.ZeroAddress,
      opts.fundingLimit ?? U(100_000_000),
      RESOLUTION,
      2026,
      opts.offeringCap ?? U(1_000_000),
      opts.holderCapFloor ?? 0n,
    ],
    { kind: "uups" }
  ) as Promise<any>;
}

/** An eligibility attestation signed by `attester` (an ethers Wallet or signer), as the pool takes it. */
export async function attestation(
  controls: any,
  attester: any,
  account: string,
  exemption = "506C",
  opts: { issuedAt?: number; validUntil?: number } = {}
) {
  const now = await latest();
  const issuedAt = opts.issuedAt ?? now;
  const validUntil = opts.validUntil ?? now + 365 * 24 * 3600;
  const net = await ethers.provider.getNetwork();
  const domain = { name: "EarnControls", version: "1", chainId: net.chainId, verifyingContract: await controls.getAddress() };
  const types = {
    EligibilityAttestation: [
      { name: "account", type: "address" },
      { name: "exemptionCode", type: "bytes32" },
      { name: "issuedAt", type: "uint64" },
      { name: "validUntil", type: "uint64" },
    ],
  };
  const value = { account, exemptionCode: code(exemption), issuedAt, validUntil };
  const sig = await attester.signTypedData(domain, types, value);
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "bytes32", "uint64", "uint64", "bytes"],
    [attester.address, code(exemption), issuedAt, validUntil, sig]
  );
}

/** Grants `role` (by name) to each of `who` with a resolution hash. */
export async function grant(controls: any, admin: any, role: string, ...who: string[]) {
  const hash = role === "DEFAULT_ADMIN_ROLE" ? ethers.ZeroHash : await controls[role]();
  for (const w of who) await controls.connect(admin).grantRoleByResolution(hash, w, RESOLUTION);
}

/**
 * Swaps the Yield Pool fixture's mock controls for the real `EarnControls`: a MembershipRegistry
 * with alice (and alice2 as her second wallet), bob, carol and outsider as members, an attester,
 * two Equity Cushion signers and two Successor signers, and every member attested "506C".
 */
export async function withRealControls(f: any, opts: { fundingLimit?: bigint; holderCapFloor?: bigint } = {}) {
  const signers = await ethers.getSigners();
  const [ec1, ec2, succ1, succ2] = signers.slice(16, 20);
  const admin = f.admin;
  const membership: any = await upgrades.deployProxy(await ethers.getContractFactory("MembershipRegistry"), [admin.address]);
  const LIFETIME = 3;
  for (const who of [f.alice, f.bob, f.carol, f.outsider, f.lending]) {
    await membership.registerMember(who.address, LIFETIME, 0, ethers.ZeroHash);
  }
  await membership.linkWallet(await membership.walletToMemberId(f.alice.address), f.alice2.address);

  const controls = await deployEarnControls(admin, {
    membership: await membership.getAddress(),
    fundingLimit: opts.fundingLimit,
    holderCapFloor: opts.holderCapFloor ?? U(100_000_000),
  });
  const attester = ethers.Wallet.createRandom();
  await grant(controls, admin, "ATTESTER_ROLE", attester.address);
  await grant(controls, admin, "EQUITY_CUSHION_ROLE", ec1.address, ec2.address);
  await grant(controls, admin, "SUCCESSOR_ROLE", succ1.address, succ2.address);
  await controls.setSources(await membership.getAddress(), f.poolAddress, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress);
  await f.pool.setEarnControls(await controls.getAddress());

  const attest = async (who: any, exemption = "506C", o: { issuedAt?: number; validUntil?: number } = {}) =>
    controls.attestEligibility(who.address, await attestation(controls, attester, who.address, exemption, o));
  for (const who of [f.alice, f.alice2, f.bob, f.carol]) await attest(who);

  /** Both signers make the same two-person call. */
  async function two(a: any, b: any, fn: string, ...args: unknown[]) {
    await controls.connect(a)[fn](...args);
    return controls.connect(b)[fn](...args);
  }
  return { controls, membership, attester, ec1, ec2, succ1, succ2, attest, two };
}
