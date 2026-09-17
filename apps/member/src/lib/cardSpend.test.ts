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
  /*
   * The card-row mapping moved here so the Card page and the Activity page build a purchase the
   * same way. One purchase reading as two different things depending on which page you opened is
   * the drift this shares a mapper to prevent.
   */
  const mapping = read('lib/activityMapping.ts');
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
    expect(mapping).toContain('categoryForMcc(tx.mcc)');
  });

  test('a merchant number is never shown as a name', () => {
    // `acceptor_id` is a merchant id, not a name. Blank beats numeric.
    expect(service).toContain('merchant.descriptor');
    expect(service).not.toMatch(/name:.*acceptor_id/);
  });

  test('the source chip is the tier that actually paid', () => {
    expect(mapping).toContain("credited.length === 0 ? 'cash' : 'credit'");
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
    expect(mapping).toContain('reversed: tx.reversed');
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

/*
 * Card spending reached the Activity page's cycle total, its category bar and its merchant list, and
 * never its list of rows — those were built from on-chain items alone. A member saw $200 spent this
 * cycle with no purchase anywhere underneath it, which reads as the page having lost something.
 */
describe('a card purchase appears on the Activity page too', () => {
  const activity = read('pages/app/ActivityRoute.tsx');
  const mapping = read('lib/activityMapping.ts');
  const card = read('pages/app/CardRoute.tsx');

  test('card transactions become rows, not just totals', () => {
    expect(activity).toContain('cardTransactionRow(tx)');
    expect(activity).not.toMatch(/rows: items\.map\(toActivityRow\),/);
  });

  test('the two sources are interleaved by time, newest first', () => {
    // `date` is a display string, so two rows on the same day have no order in it. Sort on the
    // timestamps the data actually carries.
    expect(activity).toContain('Date.parse(tx.at)');
    expect(activity).toMatch(/\.sort\(\(a, b\) => b\.ts - a\.ts\)/);
  });

  test('both pages build a purchase with the same mapper', () => {
    // One purchase reading as two different things depending on which page you opened is the drift
    // a shared mapper exists to prevent.
    expect(card).toContain('cardTransactionRow(tx,');
    expect(mapping).toContain('export function cardTransactionRow');
  });

  test('the funding tag is not a guess on this path', () => {
    /*
     * The chain mapping deliberately never says `credit` — which tier funded a transfer is not
     * knowable from the transfer. A card authorization carries its draws, so this path can.
     */
    expect(mapping).toMatch(/cardTransactionRow[\s\S]{0,900}'cash' : 'credit'/);
  });
});
