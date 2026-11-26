import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHECK_IN_AFTER_MONTHS,
  CHECK_IN_NOTE,
  COMMUNITY_FEE_LINES,
  COMMUNITY_FEE_TERMS,
  communityFeeTotal,
  elpaBooksStub,
  minimumContribution,
  redemptionProgress,
  showsCheckIn,
} from './elpa';
import { ELPA_ACTIVE, ELPA_CHECK_IN, ELPA_REDEEMED } from '@/data/elpaPreview';

/*
 * The ELPA (Addendum 3, owner decisions of Nov 14, 2026): equity toward Redemption plus a Community
 * Fee bill. Not credit, a term plan or a mortgage; never in a limit. The equity is the Housing
 * Allowance, read from the chain (lib/housing); the books (this module) hold the month's
 * contribution, the projection and the fee.
 */

const SRC = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const LIB = read('lib/elpa.ts');
const VIEW = read('components/clear/YourHome.tsx');
const HOOK = read('hooks/useElpa.ts');
const HA = read('components/clear/HousingAllowance.tsx');
/** The Housing Allowance block's own source. */
const HA_BLOCK = HA.slice(HA.indexOf('export function HousingAllowanceBlock('), HA.indexOf('export function RedeemCreditsDialog('));

/** The source of one function in the view, so a word in the bill block cannot hide in the equity one. */
function block(name: string): string {
  const start = VIEW.indexOf(`function ${name}(`);
  const next = VIEW.indexOf('\nfunction ', start + 1);
  const exported = VIEW.indexOf('\nexport default function', start + 1);
  const ends = [next, exported].filter((i) => i > start);
  return VIEW.slice(start, ends.length ? Math.min(...ends) : undefined);
}

/** Source without its comments, so a comment explaining what the code avoids does not trip it. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('the Equity Contribution is equity, chosen by the member', () => {
  test('the minimum is 0.30% of the Structure Price', () => {
    expect(minimumContribution(250_000)).toBe(750);
    expect(minimumContribution(183_333)).toBe(550);
  });

  test('progress toward Redemption is the Equity Balance against the Structure Price', () => {
    expect(redemptionProgress(ELPA_ACTIVE)).toBeCloseTo(0.165);
    expect(redemptionProgress({ equityBalance: 300_000, structurePrice: 250_000 })).toBe(1);
    expect(redemptionProgress({ equityBalance: 10, structurePrice: 0 })).toBe(0);
  });

  test('the view shows the Housing Allowance in its two parts against the price, and when it lands', () => {
    for (const label of ['Housing Allowance', 'From credits', 'Your money', 'Price', 'To go', 'On track to redeem']) expect(HA_BLOCK).toContain(label);
    expect(VIEW).toContain('ConnectedHousingAllowance');
  });

  test('and has no due, past-due or late state, no reminder and no dunning', () => {
    expect(code(HA_BLOCK)).not.toMatch(/\b(due|overdue|past.?due|late|missed|behind|remind|owed?)\b/i);
    // "never a debt" is the one place the word appears, and it says the opposite.
    expect(HA_BLOCK).toContain('Equity, never a debt.');
  });
});

describe('the one informational check-in', () => {
  test('after six consecutive months below the minimum', () => {
    expect(CHECK_IN_AFTER_MONTHS).toBe(6);
    expect(showsCheckIn({ monthsBelowMinimum: 5, paused: false })).toBe(false);
    expect(showsCheckIn({ monthsBelowMinimum: 6, paused: false })).toBe(true);
    expect(showsCheckIn(ELPA_CHECK_IN)).toBe(true);
    expect(showsCheckIn(ELPA_ACTIVE)).toBe(false);
  });

  test('never during a pause', () => {
    expect(showsCheckIn({ monthsBelowMinimum: 12, paused: true })).toBe(false);
  });

  test('is information, not a demand', () => {
    expect(CHECK_IN_NOTE).toContain('nothing changes because of it');
    expect(CHECK_IN_NOTE).not.toMatch(/\b(due|overdue|late|must|required|owe)\b/i);
  });

  test('nothing in the app sends ELPA reminders or notifications', () => {
    for (const src of [LIB, VIEW, HOOK]) expect(src).not.toMatch(/notif|sendReminder|push\(|email/i);
  });
});

describe('the Community Fee is a housing bill, owed on the 1st', () => {
  test('its four parts, in MB-14 Article 5\'s order', () => {
    expect(COMMUNITY_FEE_LINES.map((l) => l.label)).toEqual(['Ground Rent', 'Property Charges', 'Community Charges', 'Service Charges']);
  });

  test('due on the 1st, with a normal due date', () => {
    expect(ELPA_ACTIVE.communityFee?.dueOn.endsWith('-01')).toBe(true);
    expect(block('CommunityFeeBlock')).toContain('Due');
  });

  test('no late fee, 5% simple interest only after 60 days, Service Charges never a default', () => {
    expect(COMMUNITY_FEE_TERMS).toContain('No late fee');
    expect(COMMUNITY_FEE_TERMS).toContain('more than 60 days, 5% simple interest');
    expect(COMMUNITY_FEE_TERMS).toContain('Service Charges are never treated as a default');
  });

  test('the total is its lines plus any interest the books accrued', () => {
    expect(communityFeeTotal(ELPA_ACTIVE.communityFee!)).toBe(482);
    expect(communityFeeTotal({ ...ELPA_ACTIVE.communityFee!, interest: 3.25 })).toBe(485.25);
  });

  test('before Redemption it rides with the monthly payment, shown as its own line', () => {
    expect(VIEW).toContain('beforeRedemption={!redeemed}');
    expect(VIEW).toContain('COMMUNITY_FEE_WITH_PAYMENT');
    // A separate block from the equity, never summed into it.
    expect(HA).not.toContain('communityFee');
  });
});

describe('not credit, not a term plan, not a mortgage', () => {
  test('nothing in credit, limits or term plans reads the ELPA', () => {
    for (const file of ['lib/creditMapping.ts', 'components/clear/TermPlansCard.tsx', 'components/clear/ClearCreditCard.tsx', 'components/clear/LimitBreakdown.tsx', 'pages/app/HomeRoute.tsx', 'pages/app/HomePage.tsx']) {
      const src = read(file);
      expect(code(src)).not.toMatch(/@\/lib\/elpa|useElpa|YourHome|structurePrice|equityBalance|communityFee/);
    }
  });

  test('no app copy calls it a loan, a plan, a mortgage or a debt', () => {
    const offending = filesUnder(SRC)
      .filter((f) => !f.endsWith('.test.ts'))
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .filter((line) => /ELPA/.test(line) && /\b(mortgage|loan|term plan|amortis|incl\. ELPA|buy a home)\b/i.test(line))
          .filter((line) => !/NOT|not credit|not a term plan|is not|never/i.test(line))
          .map((line) => `${f}: ${line.trim()}`),
      );
    expect(offending).toEqual([]);
  });
});

describe('the books make no contract call; the Housing Allowance is read from the chain', () => {
  test('the ELPA module, its hook and the Your home view make no contract call', () => {
    for (const src of [LIB, VIEW, HOOK].map(code)) {
      expect(src).not.toMatch(/readContract|writeContract|useReadContract|sendCalls|viem|wagmi|ethers|abi/i);
      expect(src).not.toMatch(/USDC|CLRUSD/);
    }
  });

  test('the live app reads the typed books stub, which answers no ELPA for everyone today', async () => {
    expect(await elpaBooksStub.read()).toEqual({ status: 'none' });
    expect(HOOK).toContain('source: ElpaSource = elpaBooksStub');
    expect(read('pages/app/SavingsRoute.tsx')).toContain('useElpa()');
  });

  test('a member with no ELPA and no Housing Allowance sees nothing of it', () => {
    expect(VIEW).toContain("if (!live && !redeemed && elpa.status === 'none') return null;");
  });

  test('Redeemed shows the Clear Deed in the member\'s Smart Account', () => {
    const redeemed = block('RedeemedBlock');
    expect(redeemed).toContain('Clear Deed');
    expect(redeemed).toContain('Smart Account');
    expect(ELPA_REDEEMED.deed.smartAccount).toMatch(/^0x/);
  });
});
