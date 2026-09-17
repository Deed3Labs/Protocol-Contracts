import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const read = (p: string) => strip(readFileSync(join(import.meta.dirname, '..', p), 'utf8'));

/*
 * Savings → See all → Assurance is one flow about one member, and both ends decide the same thing:
 * which protections are on, from the member's credit total.
 *
 * The pane was routed with no data, so it fell back to the day-one fixture and judged everything
 * against zero credits. A member holding 1,500 read "2 of 4 active" on Savings and was then told
 * the second protection was 1,000 credits away.
 */
describe('Savings and Assurance read the same credits', () => {
  test('both routes take their data from one hook', () => {
    expect(read('pages/app/SavingsRoute.tsx')).toContain('useSavingsData()');
    expect(read('pages/app/AssuranceRoute.tsx')).toContain('useSavingsData()');
  });

  test('the pane is routed with data, not left to its fallback', () => {
    const app = read('App.tsx');
    expect(app).toContain('<AssuranceRoute />');
    // The bare page would silently take SAVINGS_DAY_ONE again.
    expect(app).not.toContain('<AssurancePage />');
  });

  test('the fallback stays day-one, so a fetch in flight never invents credits', () => {
    // Comments are stripped first: the file explains what the IN_USE fixtures are, and matching
    // its own prose would be the test reading the warning rather than the code.
    const hook = read('hooks/useSavingsData.ts');
    expect(hook).toContain('SAVINGS_DAY_ONE');
    expect(hook).not.toContain('IN_USE');
  });
});

/*
 * The flow the reference describes, end to end: the cell, the pane, the reserve behind it, the
 * statements behind that, and the claim the whole thing is for. Each link was a dead end before.
 */
describe('every link in the assurance flow goes somewhere', () => {
  const app = read('App.tsx');

  test('the reserve, the reports and the claim are all routed', () => {
    expect(app).toContain('/assurance/reserve');
    expect(app).toContain('/assurance/reports');
    expect(app).toContain('/assurance/claim');
  });

  test('the pane points at the real reserve, not the explainer stub', () => {
    expect(read('pages/app/AssurancePage.tsx')).toContain("navigate('/assurance/reserve')");
  });

  test('the reserve carries its own two ways out', () => {
    const page = read('pages/app/AssuranceReservePage.tsx');
    expect(page).toContain("navigate('/assurance/reports')");
    expect(page).toContain("navigate('/assurance/claim')");
  });
});

/*
 * A claim is the worst day a member has with Clear, and the failure this is built against is a form
 * that looked like it worked on the day somebody needed it to.
 */
describe('a claim reaches the server or says it did not', () => {
  test('the page never reaches for a wallet itself', () => {
    // It also has to render in the preview harness, which has no wallet provider — a page that
    // reaches for one cannot be reviewed as a design.
    const page = read('pages/app/ClaimPage.tsx');
    expect(page).not.toContain('useAppKitAccount');
    expect(page).toContain('onFile');
  });

  test('filing lives in the route, with the member', () => {
    const route = read('pages/app/ClaimRoute.tsx');
    expect(route).toContain('fileAssuranceClaim');
    expect(route).toMatch(/if \(!address\)[\s\S]{0,80}nothing was sent/i);
  });

  test('a failure is words, not a silent close', () => {
    const dialog = read('components/clear/StartClaimDialog.tsx');
    expect(dialog).toMatch(/if \(failed\)[\s\S]{0,80}setError\(failed\)/);
    // The sent state is only reached when nothing came back.
    expect(dialog).toMatch(/setSent\(/);
  });

  test('locked protections cannot be claimed on', () => {
    // Shown as locked rather than hidden — finding out at the point of need is worse — but the
    // chooser only offers what is active.
    const dialog = read('components/clear/StartClaimDialog.tsx');
    expect(dialog).toContain('isAssuranceActive');
    expect(read('components/clear/ClaimGuidePanel.tsx')).toContain('isAssuranceActive');
  });
});

/*
 * The reference builds three of the four panes as two-column slabs, with the cell that answers both
 * columns spanning beneath. Built as one column they read as a single tall strip in a wide window —
 * which is what the desktop screenshots showed.
 */
describe('the panes use the columns the reference gives them', () => {
  const twoColumn = [
    ['the reserve', 'pages/app/AssuranceReservePage.tsx'],
    ['the reports', 'pages/app/ReserveReportsPage.tsx'],
    ['the claim guide', 'pages/app/ClaimPage.tsx'],
  ] as const;

  for (const [name, file] of twoColumn) {
    test(`${name} is two columns on desktop and one on a phone`, () => {
      const page = read(file);
      expect(page).toContain("desktop ? 'c-slab' : 'c-slab c-one'");
      // A narrow column would defeat the point of having two of them.
      expect(page).not.toContain('max-w-[560px]');
    });
  }

  test('the protections pane stays one column, as the reference has it', () => {
    // It holds a single cell; stretched across a wide window it would be one long row of nothing.
    expect(read('pages/app/AssurancePage.tsx')).toContain('c-slab c-one');
  });

  test('the cells that answer both columns span them', () => {
    expect(read('components/clear/ReservePanel.tsx')).toMatch(/<Cell full>[\s\S]{0,200}Is it enough\?/);
    expect(read('components/clear/ClaimGuidePanel.tsx')).toMatch(/<Cell full>[\s\S]{0,200}The record/);
  });
});

/*
 * Footers carry the closing line or the action, never main.
 *
 * Every explanatory `det` that comments on a cell sits in that cell's footer in the reference, and
 * I had put all of them at the bottom of main instead. The difference is a rule: a footer is
 * divided off, so the note reads as commentary on the cell rather than as one more row inside it.
 */
describe('the closing note is a footer', () => {
  const reserve = read('components/clear/ReservePanel.tsx');
  const claim = read('components/clear/ClaimGuidePanel.tsx');
  const reports = read('components/clear/ReserveReportsPanel.tsx');

  test('the reserve closes "Is it enough?" in its footer', () => {
    expect(reserve).toMatch(/<CFoot>[\s\S]{0,200}No reserve covers everyone/);
  });

  test('the claim page closes both of its notes in footers', () => {
    expect(claim).toMatch(/<CFoot>[\s\S]{0,200}A protection you have not unlocked/);
    expect(claim).toMatch(/<CFoot>[\s\S]{0,200}One in four is declined/);
  });

  test('the reports keep the line saying why an audit is not required', () => {
    // Dropped at first, which left "reviewed, not audited" reading as an apology rather than a
    // fact about co-ops of this size.
    expect(reports).toContain('auditNote');
    expect(reports).toMatch(/<CFoot>[\s\S]{0,120}auditNote/);
  });

  test('a footer action is a button, not a text link', () => {
    expect(reports).toContain('<Btn onClick={onSubscribe}>Get them by email</Btn>');
  });

  test('only the audit caveat earns a chip', () => {
    // Every other section header on these panes carries plain detail text.
    expect(reports).toContain('<Chip tone="underway">Not audited</Chip>');
    expect(reserve).not.toContain('<Chip');
    expect(claim).not.toContain('<Chip');
  });
});
