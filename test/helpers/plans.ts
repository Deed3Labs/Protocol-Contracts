import { ethers } from "hardhat";

/*
 * Term plans are opened on terms the member signs (audit H-4). The operator submits; the member's
 * EIP-712 signature over the terms, at their current nonce, is what authorizes it.
 *
 * `productId` names the RateSchedule product (compliance spec items 5 and 7); tests that run without a
 * RateSchedule leave it zero and the plan keeps the rate in its terms.
 *
 * `signedOpenPlan` keeps the old positional shape so tests read the same: it looks up the member's
 * signer (every Hardhat account is unlocked), signs, and returns the transaction promise, so
 * `expect(signedOpenPlan(...)).to.be.revertedWith...` works as before.
 */
export const DISCLOSURE = ethers.keccak256(ethers.toUtf8Bytes("test disclosure"));

export async function signPlanTerms(term: any, memberSigner: any, terms: any) {
  const nonce = await term.planNonces(terms.member);
  const { chainId } = await ethers.provider.getNetwork();
  const domain = {
    name: "Clear TermIssuer",
    version: "1",
    chainId,
    verifyingContract: await term.getAddress(),
  };
  const types = {
    PlanTerms: [
      { name: "member", type: "address" },
      { name: "merchant", type: "address" },
      { name: "productId", type: "bytes32" },
      { name: "purchase", type: "uint256" },
      { name: "payout", type: "uint256" },
      { name: "ratePerCycle", type: "uint256" },
      { name: "cycleLength", type: "uint64" },
      { name: "installments", type: "uint32" },
      { name: "installmentLength", type: "uint64" },
      { name: "disclosureHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  return memberSigner.signTypedData(domain, types, { ...terms, nonce });
}

export function planTerms(
  member: string,
  merchant: string,
  purchase: bigint,
  payout: bigint,
  ratePerCycle: bigint | number,
  cycleLength: bigint | number,
  installments: bigint | number,
  installmentLength: bigint | number,
  productId: string = ethers.ZeroHash,
) {
  return {
    member,
    merchant,
    productId,
    purchase,
    payout,
    ratePerCycle: BigInt(ratePerCycle),
    cycleLength: BigInt(cycleLength),
    installments: BigInt(installments),
    installmentLength: BigInt(installmentLength),
    disclosureHash: DISCLOSURE,
    deadline: ethers.MaxUint256,
  };
}

/**
 * 12.16 (Addendum 2): the origination fee leg goes to Clear Lending's fee recipient, never the co-op,
 * and a plan with a fee will not open until one is named by two people. Tests that do not care which
 * address it is get this one (signer 19), named by the admin and signer 1 (the fixture's operator).
 */
export const FEE_REASON = ethers.encodeBytes32String("TEST_SETUP");
export async function feeRecipientOf(term: any): Promise<string> {
  const current = await term.feeRecipient();
  if (current !== ethers.ZeroAddress) return current;
  const signers = await ethers.getSigners();
  const to = signers[19].address;
  const ledger = await ethers.getContractAt("StableCredit", await term.stableCredit());
  const access = await ethers.getContractAt("AccessManager", await ledger.access());
  const role = ethers.id("CREDIT_SETTINGS_ROLE");
  const second = signers[1];
  if (!(await access.hasRole(role, second.address))) await access.connect(signers[0]).grantRole(role, second.address);
  await term.connect(signers[0]).proposeFeeRecipient(to, FEE_REASON);
  await term.connect(second).approveFeeRecipient(to, FEE_REASON);
  return to;
}

/** Opens a plan the way production does: member signs, operator submits. */
export async function signedOpenPlan(
  term: any,
  operator: any,
  member: string,
  merchant: string,
  purchase: bigint,
  payout: bigint,
  ratePerCycle: bigint | number,
  cycleLength: bigint | number,
  installments: bigint | number,
  installmentLength: bigint | number,
  productId: string = ethers.ZeroHash,
) {
  const terms = planTerms(member, merchant, purchase, payout, ratePerCycle, cycleLength, installments, installmentLength, productId);
  await feeRecipientOf(term);
  const signature = await signPlanTerms(term, await ethers.getSigner(member), terms);
  return term.connect(operator).openPlan(terms, signature);
}

/** The staticCall form, for reading the plan id a call would return. */
export async function signedOpenPlanStatic(
  term: any,
  operator: any,
  ...args: [string, string, bigint, bigint, bigint | number, bigint | number, bigint | number, bigint | number]
) {
  const terms = planTerms(...args);
  await feeRecipientOf(term);
  const signature = await signPlanTerms(term, await ethers.getSigner(args[0]), terms);
  return term.connect(operator).openPlan.staticCall(terms, signature);
}
