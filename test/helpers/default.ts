import { ethers } from "hardhat";

export const ATTESTER_ROLE = ethers.id("CREDIT_ATTESTER_ROLE");
/** MB-05 6.4: the cure notice gives at least ten full days. */
export const NOTICE_GRACE = 864_000;

async function advanceTo(target: number) {
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  if (target > now) await ethers.provider.send("evm_increaseTime", [target - now]);
  await ethers.provider.send("evm_mine", []);
}

/** Two distinct signers holding the credit attester role (cure notices, Income Assurance). */
export async function attesters(issuer: any): Promise<[any, any]> {
  const signers = await ethers.getSigners();
  const ledger = await ethers.getContractAt("StableCredit", await issuer.stableCredit());
  const access = await ethers.getContractAt("AccessManager", await ledger.access());
  const pair: [any, any] = [signers[16], signers[17]];
  for (const s of pair) {
    if (!(await access.hasRole(ATTESTER_ROLE, s.address))) {
      await access.connect(signers[0]).grantRole(ATTESTER_ROLE, s.address);
    }
  }
  return pair;
}

/** Moves time to just past the member's running cycle end and asks the chain to judge it. */
export async function passCycleEnd(issuer: any, member: string) {
  const end = Number((await issuer.cycleStateOf(member)).cycleEnd);
  await advanceTo(end + 1);
  await issuer.syncCreditPeriod(member);
}

/**
 * Drives the member to a second consecutive missed Rebalance Amount (12.5, Addendum 2): the first
 * cycle end closes a cycle on what is drawn, the next two are missed. The line is then frozen with
 * the second amount unpaid, and nothing is a default until a cure notice is recorded.
 */
export async function driveToSecondMiss(issuer: any, member: string) {
  for (let i = 0; i < 4; i++) {
    if ((await issuer.cycleStateOf(member)).cureAmount > 0n) return;
    await passCycleEnd(issuer, member);
  }
}

/** Records the cure-notice timestamp by two people: one proposes, a different one approves. */
export async function recordCureNotice(issuer: any, member: string) {
  const [a, b] = await attesters(issuer);
  await issuer.connect(a).proposeCureNotice(member);
  await issuer.connect(b).approveCureNotice(member);
}

/**
 * Section 12.5's default, for tests that need a member in it (Addendum 2): two consecutive missed
 * Rebalance Amounts, a two-person cure-notice timestamp for the second, then the grace period: the
 * later of the cure window after the second due point and 864,000 s after the timestamp. `governor`
 * is kept for the callers' signature; no setting needs changing.
 */
export async function driveToDefault(issuer: any, member: string, _governor?: any) {
  await driveToSecondMiss(issuer, member);
  await recordCureNotice(issuer, member);
  const s = await issuer.cycleStateOf(member);
  const c = await issuer.cycleOf(member);
  const t = await issuer.creditTerms();
  const graceEnd = Math.max(Number(s.cureDueAt + t.cureWindow), Number(c.cureNoticeAt) + NOTICE_GRACE);
  await advanceTo(graceEnd);
}
