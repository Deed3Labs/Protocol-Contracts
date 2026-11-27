import type { CommunityFeeStatement, ElpaActive, ElpaRedeemed } from '@/lib/elpa';
import type { Housing } from '@/lib/housing';

/*
 * ELPA fixtures for the preview harness and tests only. The live app reads `elpaBooksStub`
 * (lib/elpa), which answers "no ELPA" until a books API exists.
 */

const FEE: CommunityFeeStatement = {
  period: 'December 2026',
  dueOn: '2026-12-01',
  lines: [
    { kind: 'ground-rent', amount: 210 },
    { kind: 'property', amount: 185.5 },
    { kind: 'community', amount: 64 },
    { kind: 'service', amount: 22.5 },
  ],
  paid: false,
};

/** Two years in, choosing a little over the minimum. */
export const ELPA_ACTIVE: ElpaActive = {
  status: 'active',
  home: '1042 Julia St',
  structurePrice: 250_000,
  equityBalance: 41_250,
  contributionThisMonth: 900,
  projectedRedemption: '2041-03',
  monthsBelowMinimum: 0,
  paused: false,
  communityFee: FEE,
};

/** Six months under the minimum, outside a pause: the one informational check-in shows. */
export const ELPA_CHECK_IN: ElpaActive = {
  ...ELPA_ACTIVE,
  contributionThisMonth: 300,
  monthsBelowMinimum: 6,
};

/** Redeemed: the Clear Deed is in the member's Smart Account; the Community Fee continues. */
export const ELPA_REDEEMED: ElpaRedeemed = {
  status: 'redeemed',
  home: '1042 Julia St',
  redeemedOn: '2041-03-01',
  deed: { tokenId: '1042', smartAccount: '0x7f3a0000000000000000000000000000000c19e2' },
  communityFee: { ...FEE, paid: true },
};

/** The Housing Allowance on chain, for the preview: an ELPA signed, the design's own figures. */
export const HOUSING_ACTIVE: Housing = {
  member: '0x7f3a0000000000000000000000000000000c19e2',
  home: {
    homeId: '1042',
    name: '1042 Julia St',
    status: 'signed',
    structurePrice: 250_000,
    creditPortion: 3_250,
    memberPortion: 18_400,
    total: 21_650,
    refundDue: 0,
    signedAt: '2026-11-01T00:00:00.000Z',
    endedAt: null,
    live: true,
    redeemable: false,
    payable: true,
  },
  creditsToRedeem: 1_240,
  creditsEarned: 15_240,
  creditPortionUsed: 3_250,
  creditPortionCap: 54_000,
};

/** Reached the price: the RedemptionAgent holds the deed and the record says it may go. */
export const HOUSING_READY: Housing = {
  ...HOUSING_ACTIVE,
  home: { ...HOUSING_ACTIVE.home!, creditPortion: 54_000, memberPortion: 197_200, total: 251_200, redeemable: true },
  creditsToRedeem: 310,
  creditsEarned: 71_480,
  creditPortionUsed: 54_000,
};
