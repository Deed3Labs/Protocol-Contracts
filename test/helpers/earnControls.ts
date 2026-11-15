import { ethers, upgrades } from "hardhat";
import { U, latest } from "./yieldPool";
import { earnControlsAt, earnControlsProxyOptions } from "../../deploy/earnModules";

export const RESOLUTION = ethers.id("lending board resolution");
export const code = (s: string) => ethers.encodeBytes32String(s);
export const RESERVE_SHORTFALL = 1;
export const EQUITY_CUSHION = 2;
export const LOW_UTILIZATION_RULE = 4;

export interface ControlsOptions {
  membership?: string;
  fundingLimit?: bigint;
  offeringCap?: bigint;
  poolOfferingCap?: bigint;
  poolCapacity?: bigint;
  holderCapFloor?: bigint;
}

/**
 * Deploys `EarnControls` (with its module) behind a UUPS proxy, `admin` as its admin (the Earn
 * timelock in production), and returns it with the joined ABI of both.
 */
export async function deployEarnControls(admin: any, opts: ControlsOptions = {}) {
  const proxy = await upgrades.deployProxy(
    await ethers.getContractFactory("EarnControls", admin),
    [{
      admin: admin.address,
      decimals: 6,
      membership: opts.membership ?? ethers.ZeroAddress,
      fundingLimit: opts.fundingLimit ?? U(100_000_000),
      fundingResolution: RESOLUTION,
      fiscalYear: 2026,
      offeringCap: opts.offeringCap ?? U(1_000_000),
      poolOfferingCap: opts.poolOfferingCap ?? U(100_000_000),
      poolCapacity: opts.poolCapacity ?? U(100_000_000),
      holderCapFloor: opts.holderCapFloor ?? 0n,
    }],
    await earnControlsProxyOptions(admin)
  );
  return earnControlsAt(await proxy.getAddress(), admin);
}

/** An eligibility attestation signed by `attester` (an ethers Wallet or signer), as the pool takes it. */
export async function attestation(
  controls: any,
  attester: any,
  account: string,
  exemption = "506C",
  opts: { issuedAt?: number; validUntil?: number; netWorth?: bigint } = {}
) {
  const now = await latest();
  const issuedAt = opts.issuedAt ?? now;
  const validUntil = opts.validUntil ?? now + 365 * 24 * 3600;
  const netWorth = opts.netWorth ?? U(100_000_000);
  const net = await ethers.provider.getNetwork();
  const domain = { name: "EarnControls", version: "1", chainId: net.chainId, verifyingContract: await controls.getAddress() };
  const types = {
    EligibilityAttestation: [
      { name: "account", type: "address" },
      { name: "exemptionCode", type: "bytes32" },
      { name: "netWorth", type: "uint256" },
      { name: "issuedAt", type: "uint64" },
      { name: "validUntil", type: "uint64" },
    ],
  };
  const value = { account, exemptionCode: code(exemption), netWorth, issuedAt, validUntil };
  const sig = await attester.signTypedData(domain, types, value);
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "bytes32", "uint256", "uint64", "uint64", "bytes"],
    [attester.address, code(exemption), netWorth, issuedAt, validUntil, sig]
  );
}

/** Grants `role` (by name) to each of `who` with a resolution hash. */
export async function grant(controls: any, admin: any, role: string, ...who: string[]) {
  const hash = role === "DEFAULT_ADMIN_ROLE" ? ethers.ZeroHash : await controls[role]();
  for (const w of who) await controls.connect(admin).grantRoleByResolution(hash, w, RESOLUTION);
}

/**
 * Swaps the Yield Pool fixture's mock controls for the real `EarnControls`: a MembershipRegistry
 * with alice (and alice2 as her second wallet), bob, carol, outsider and lending as members, an
 * attester (and two funded attesting-role holders for households), two pause signers and two Successor signers,
 * and alice, alice2, bob and carol attested "506C". The holder cap is off below `holderCapFloor`
 * (default $100m, i.e. off) unless a test sets it.
 */
export async function withRealControls(f: any, opts: ControlsOptions = {}) {
  const signers = await ethers.getSigners();
  const [p1, p2, succ1, succ2] = signers.slice(16, 20);
  const admin = f.admin;
  const membership: any = await upgrades.deployProxy(await ethers.getContractFactory("MembershipRegistry"), [admin.address]);
  const LIFETIME = 3;
  for (const who of [f.alice, f.bob, f.carol, f.outsider, f.lending]) {
    await membership.registerMember(who.address, LIFETIME, 0, ethers.ZeroHash);
  }
  await membership.linkWallet(await membership.walletToMemberId(f.alice.address), f.alice2.address);

  const controls = await deployEarnControls(admin, {
    holderCapFloor: U(100_000_000),
    ...opts,
    membership: await membership.getAddress(),
  });
  const attester = ethers.Wallet.createRandom();
  // Two funded holders of the attesting role record households (IV-02 §2.5(c)).
  const [h1, h2] = [f.v1, f.v2];
  await grant(controls, admin, "ATTESTER_ROLE", attester.address, h1.address, h2.address);
  await grant(controls, admin, "PAUSE_ROLE", p1.address, p2.address);
  await grant(controls, admin, "SUCCESSOR_ROLE", succ1.address, succ2.address);
  await controls.setSources(await membership.getAddress(), f.poolAddress, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress);
  await f.pool.setEarnControls(await controls.getAddress());

  const attest = async (who: any, exemption = "506C", o: { issuedAt?: number; validUntil?: number; netWorth?: bigint } = {}) =>
    controls.attestEligibility(who.address, await attestation(controls, attester, who.address, exemption, o));
  for (const who of [f.alice, f.alice2, f.bob, f.carol]) await attest(who);

  /** Both signers make the same two-person call. */
  async function two(a: any, b: any, fn: string, ...args: unknown[]) {
    await controls.connect(a)[fn](...args);
    return controls.connect(b)[fn](...args);
  }
  return { controls, membership, attester, h1, h2, p1, p2, succ1, succ2, attest, two };
}
