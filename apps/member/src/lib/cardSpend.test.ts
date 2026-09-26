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

  const home = read('pages/app/HomeRoute.tsx');

  test('every list that shows spending shows both halves of it', () => {
    /*
     * Activity was fixed first and Home still showed sends alone, which is how a member ends up
     * looking at a recent-activity preview with no purchases in it. One merge, used by both.
     */
    expect(activity).toContain('mergedActivityRows(items, cards, undefined, repayments, chargePayments)');
    expect(home).toContain('mergedActivityRows(items, cards, undefined, repayments, chargePayments)');
    expect(activity).not.toMatch(/rows: items\.map\(toActivityRow\),/);
    expect(home).not.toMatch(/recent: items\.slice/);
  });

  test('Home fetches the card side at all', () => {
    // It never asked for card transactions, so there was nothing to merge in the first place.
    expect(home).toContain('getCardTransactions()');
  });

  test('the two sources are interleaved by time, newest first', () => {
    // `date` is a display string, so two rows on the same day have no order in it. Sort on the
    // timestamps the data actually carries.
    expect(mapping).toContain('Date.parse(tx.at)');
    expect(mapping).toMatch(/\.sort\(\(a, b\) => b\.ts - a\.ts\)/);
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

/*
 * The same purchase, presented the same way, wherever it is listed.
 *
 * Harbor Freight showed struck through and marked Reversed on the Card page, and as an ordinary
 * "Cash · −$5.00" on Activity. Two presentations of one fact is worse than either alone, and it is
 * the kind of drift that returns the moment one page is edited without the other.
 */
describe('a reversed charge looks reversed on every list', () => {
  const model = read('lib/clearModel.ts');
  const lists = [
    ['the Card page', read('pages/app/CardPage.tsx')],
    ['the Activity page', read('pages/app/ActivityPage.tsx')],
    ["Home's recent activity", read('components/clear/RecentActivityCard.tsx')],
  ] as const;

  /*
   * Three lists show spending and each owns its row markup, so each was fixed separately — a
   * screenshot at a time. The values live in one constant now, and this loop is what makes a fourth
   * list, or a fourth edit, fail loudly instead of quietly looking different.
   */
  test('the treatment is defined once', () => {
    expect(model).toContain('export const REVERSED_ROW');
    expect(model).toContain("label: 'Reversed'");
    expect(model).toContain('line-through');
  });

  for (const [name, page] of lists) {
    test(`${name} uses the shared treatment rather than its own`, () => {
      expect(page).toContain('REVERSED_ROW');
      // No hand-rolled copies left behind to drift.
      expect(page).not.toContain("'text-ink-50 line-through'");
    });

    test(`${name} strikes the amount and mutes the name`, () => {
      expect(page).toMatch(/row\.reversed[\s\S]{0,80}REVERSED_ROW\.amount/);
      expect(page).toMatch(/row\.reversed && REVERSED_ROW\.text/);
    });

    test(`${name} replaces the funding tag`, () => {
      // Saying "Cash" or "Credit" beside money that came back is the one wrong thing on the line.
      expect(page).toContain('REVERSED_ROW.label');
    });
  }
});


/*
 * The card's own frames, on every ground.
 *
 * Chrome paints an opaque canvas behind an iframe whose element's colour scheme differs from the
 * document inside it. The root says `dark` on the dark ground and Lithic's frames are light, so
 * the digits sat on white boxes however transparent we told the inside to be. Reproduced side by
 * side: inheriting dark gives a white box, `light` or `normal` on the element gives a clear one.
 */
describe("the issuer's frames match the document they hold", () => {
  const details = read('components/clear/card/EmbeddedCardDetails.tsx');
  const pin = read('components/clear/card/SetPinDialog.tsx');
  const dialog = read('components/clear/CardDetailsDialog.tsx');

  test('every place a Lithic frame renders sets its colour scheme to light', () => {
    expect(details).toContain('[&_iframe]:[color-scheme:light]');
    expect(pin).toContain('[&_iframe]:[color-scheme:light]');
    expect(dialog).toMatch(/<iframe[^>]*\[color-scheme:light\]/);
  });
});

/*
 * "Show the numbers" did nothing. The dialog passed an inline `onFailed`, which was a dependency of
 * the mount effect, so every render the reveal caused tore the frames down and remounted them
 * masked — underneath the toggle that had just unmasked them.
 */
describe('revealing the numbers does not remount the frames', () => {
  const details = read('components/clear/card/EmbeddedCardDetails.tsx');

  test("the mount does not depend on the caller's callback identity", () => {
    expect(details).toContain('}, [session, environment, ground]);');
    expect(details).not.toMatch(/\[session, environment, onFailed/);
    expect(details).toContain('failed.current()');
  });

  test('fresh frames reset the button to match them', () => {
    // A remount on a theme change brings the digits back masked; the button must not keep saying
    // "Hide" over dots.
    expect(details).toMatch(/let live = true;[\s\S]{0,120}setShown\(false\)/);
  });
});
