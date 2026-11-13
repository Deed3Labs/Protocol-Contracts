import { ethers, upgrades } from "hardhat";

/*
 * The compliance spec's initial California table (spec item 1), as governed parameters.
 * Pending counsel; tests use it because the acceptance figures are stated against it.
 */
export const ONE_USDC = 10n ** 6n;
export const DAY = 24 * 60 * 60;
export const CYCLE = 30 * DAY;
export const CA = ethers.encodeBytes32String("CA");
export const NY = ethers.encodeBytes32String("NY");
export const P = (name: string) => ethers.encodeBytes32String(name);
export const MAX128 = (1n << 128n) - 1n;

export const CA_BANDS = [
  { upperBound: 225n * ONE_USDC, monthlyBps: 250 },
  { upperBound: 900n * ONE_USDC, monthlyBps: 200 },
  { upperBound: 1650n * ONE_USDC, monthlyBps: 150 },
  { upperBound: MAX128, monthlyBps: 100 },
];

export function params(over: Partial<Record<string, any>> = {}) {
  return {
    enabled: true,
    listMonthlyBps: 0,
    flatMonthlyBps: 0,
    largeLoanThreshold: 2_500n * ONE_USDC,
    annualCapBps: 3_650, // placeholder for "about 36% + fed funds", pending counsel
    minTermSeconds: 365 * DAY,
    freeInFull: true,
    freeBelowAmount: 0n,
    freeSplitMax: 0,
    ...over,
  };
}

/** Thirty days of a monthly rate under per-second accrual (DECISIONS #1): × 12 × 30 / 365. */
export function thirtyDays(monthlyCharge: bigint) {
  return (monthlyCharge * 12n * 30n) / 365n;
}

export async function deployRateSchedule(owner: string) {
  const F = await ethers.getContractFactory("RateSchedule");
  return upgrades.deployProxy(F, [owner], { kind: "uups" }) as Promise<any>;
}

/** A snapshot read back from the chain, as a plain object ethers can pass in again. */
export async function snapshotOf(rates: any, state: string, product: string) {
  const s = await rates.snapshot(state, product);
  return { list: s.list, flatAlt: s.flatAlt, annual: s.annual, bands: [...s.bands] };
}
