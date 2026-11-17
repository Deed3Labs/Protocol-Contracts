import type { CommunityFeeStatement, ElpaActive, ElpaRedeemed } from '@/lib/elpa';

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
