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
      join(import.meta.dirname, '..', '..', '..', 'api', 'src', 'services', 'lithic', 'cardTransactionsService.ts'),
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

  /*
   * Still one figure derived from one source, but the source is what each transaction HOLDS rather
   * than what it asked for. A voided charge keeps its row — the member remembers it — and must not
   * keep its place in the month's total, or the page claims spending that came back.
   */
  test('the month total counts what is held, from the same transactions as the rows', () => {
    expect(route).toMatch(/periodTotal: \(spend \?\? \[\]\)\.reduce/);
    expect(route).toContain('tx.heldCents ?? tx.amountCents');
  });

  test('a reversed charge is marked on the row rather than dropped from it', () => {
    expect(service).toContain('reversed: heldCents === 0 && amountCents > 0');
    expect(route).toContain('reversed: tx.reversed');
  });

  // The category bar went with the brand-guide rebuild: the reference has none. When it returns it must
  // still skip rows without a merchant category code, which categoryForMcc above already pins.
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
