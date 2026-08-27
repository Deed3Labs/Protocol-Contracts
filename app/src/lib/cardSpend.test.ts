import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const read = (p: string) => strip(readFileSync(join(import.meta.dirname, '..', p), 'utf8'));

/*
 * The category bar is only honest if every segment came from a merchant category code the network
 * actually sent. These pin the path from that code to the bar.
 */
describe('the month bar is made of real categories', () => {
  const route = read('pages/app/CardRoute.tsx');
  const page = read('pages/app/CardPage.tsx');
  const service = strip(
    readFileSync(
      join(import.meta.dirname, '..', '..', 'server', 'src', 'services', 'lithic', 'cardTransactionsService.ts'),
      'utf8',
    ),
  );

  test('card spending is read, not hardcoded empty', () => {
    // Every real card showed "no card spending yet" forever, because this was literally `[]`.
    expect(route).toContain('getCardTransactions()');
    expect(route).not.toMatch(/transactions: card \? \[\] :/);
  });

  test('it comes from our own approved authorizations', () => {
    expect(service).toContain("result = 'APPROVED'");
    // A decline is not a purchase and does not belong in a list of what was spent.
    expect(service).not.toMatch(/result IN|result != /);
  });

  test('the category comes from the MCC the network sent', () => {
    expect(service).toContain('merchant.mcc');
    expect(route).toContain('categoryForMcc(tx.mcc)');
  });

  test('a merchant number is never shown as a name', () => {
    // `acceptor_id` is a merchant id, not a name. Blank beats numeric.
    expect(service).toContain('merchant.descriptor');
    expect(service).not.toMatch(/name:.*acceptor_id/);
  });

  test('the source chip is the tier that actually paid', () => {
    expect(route).toContain("credited.length === 0 ? 'cash' : 'credit'");
  });

  test('the month total is the rows, not a second figure that could disagree', () => {
    expect(route).toMatch(/periodTotal: cardRows\.reduce/);
  });

  test('the bar is skipped when the rows carry no category', () => {
    // Placeholder rows and non-card activity have no MCC; a bar built from them would be a picture
    // of our ignorance rather than of a member's month.
    expect(page).toContain('row.category != null');
    expect(page).toContain('categoryTotals.length > 1');
  });
});

describe('the network mark is swappable', () => {
  const face = read('components/clear/ClearCardFace.tsx');
  const marks = readFileSync(join(import.meta.dirname, '..', 'assets', 'brand', 'networkMarks.ts'), 'utf8');

  test('the asset lives in one file, not inlined in a component', () => {
    // Replacing it with the licensed file the issuer program supplies should be a file swap.
    expect(face).toContain('NETWORK_MARKS');
    expect(face).not.toMatch(/d="M9\.112/);
  });

  test('and that file says which asset is licensed for what', () => {
    expect(marks).toContain('trademark');
    expect(marks).toContain('Lithic');
  });

  test('an unknown network renders nothing rather than the wrong mark', () => {
    expect(face).toContain('if (!mark) return null;');
  });
});
