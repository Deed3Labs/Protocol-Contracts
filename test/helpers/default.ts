import { ethers } from "hardhat";

/*
 * Section 12.5's default, for tests that need a member in it: two missed rebalances in a row, each
 * judged by the chain (anyone may ask it to), then the cure window after the chain-dated notice.
 * A cure window of zero would write the line off at the second judgement, before `inDefault` could
 * read true, so an unset one is set to a day here by `governor` (a CREDIT_SETTINGS_ROLE holder).
 */
export async function driveToDefault(issuer: any, member: string, governor: any) {
  const t = await issuer.creditTerms();
  let cure = t.cureWindow as bigint;
  if (cure === 0n) {
    cure = 86_400n;
    await issuer.connect(governor).setCreditTerms(
      {
        unsecuredLineCap: t.unsecuredLineCap,
        cureWindow: cure,
        boostCleanCycles: t.boostCleanCycles,
        boostDepositCycles: t.boostDepositCycles,
        autoClearOffGlobal: t.autoClearOffGlobal,
      },
      await issuer.boostBaseCap(),
      await issuer.boostEarnedCap(),
    );
  }
  for (let miss = 0; miss < 2; miss++) {
    const period = await issuer.creditPeriods(member);
    const target = Number(period.expiration + period.graceLength) + 1;
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    if (target > now) await ethers.provider.send("evm_increaseTime", [target - now]);
    await ethers.provider.send("evm_mine", []);
    await issuer.syncCreditPeriod(member);
  }
  await ethers.provider.send("evm_increaseTime", [Number(cure) + 1]);
  await ethers.provider.send("evm_mine", []);
}
