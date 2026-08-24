import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyKey } from '@/lib/amountEntry';
import { freeSavings } from '@/lib/freeSavings';

const DIALOG = readFileSync(join(import.meta.dir, 'MoveMoneyDialog.tsx'), 'utf8');
const CONNECTED = readFileSync(join(import.meta.dir, 'ConnectedMoveMoney.tsx'), 'utf8');
const HOOK = readFileSync(join(import.meta.dir, '../../hooks/useSavingsMove.ts'), 'utf8');
const GUARDS = readFileSync(join(import.meta.dir, '../../hooks/useOptionalWallet.ts'), 'utf8');

/*
 * Entry is string-based, not numeric: "250." is a state somebody passes through on the way to
 * "250.5", and parsing on every press erases the decimal point the moment it is entered.
 */
describe('typing an amount', () => {
  test('builds digits left to right', () => {
    expect(['2', '5', '0'].reduce(applyKey, '')).toBe('250');
  });

  test('keeps a trailing decimal point while it is being typed', () => {
    expect(applyKey('250', '.')).toBe('250.');
  });

  test('allows only one decimal point', () => {
    expect(applyKey('250.5', '.')).toBe('250.5');
  });

  test('stops at two decimal places', () => {
    // Accepting the third and rounding would change somebody's deposit behind their back.
    expect(applyKey('250.55', '5')).toBe('250.55');
  });

  test('a leading point becomes a leading zero', () => {
    expect(applyKey('', '.')).toBe('0.');
  });

  test('has no leading zeros', () => {
    expect(applyKey('0', '5')).toBe('5');
  });

  test('delete removes one character, and empty stays empty', () => {
    expect(applyKey('250', 'del')).toBe('25');
    expect(applyKey('', 'del')).toBe('');
  });
});

/*
 * Savings pledged against the credit line cannot leave — the token enforces it at transfer time.
 * A withdrawal capped at the total would offer an amount the chain will refuse.
 */
describe('what is free to withdraw', () => {
  test('excludes what is pledged', () => {
    expect(freeSavings(6000, 300_000)).toBe(3000);
  });

  test('never goes below zero', () => {
    expect(freeSavings(1000, 500_000)).toBe(0);
  });

  test('an unreadable credit line does not lock a member out of their own savings', () => {
    // The transfer still enforces the real rule, so the worst case is a rejected transaction
    // rather than telling somebody their money is locked when it is not.
    expect(freeSavings(6000, null)).toBe(6000);
  });
});

describe('one component, two directions', () => {
  test('each leg carries its own balance, which is what gives the presets stated meanings', () => {
    expect(DIALOG).toContain("isDeposit ? 'All' : 'All free'");
    expect(DIALOG).toContain('const available = isDeposit ? cashReady : savingsFree;');
  });

  test('the consequence flips with the direction', () => {
    expect(DIALOG).toContain('Credits earned');
    expect(DIALOG).toContain('Credits given up');
    expect(DIALOG).toContain('Your limit rises by');
    expect(DIALOG).toContain('Your limit drops by');
  });

  test('the cost of withdrawing is stated, not moralised', () => {
    // Three facts and no scare copy. A member taking out their own money is exercising the thing
    // that makes this an equity account rather than a lock-up.
    expect(DIALOG).toContain('Vested credits stay. Only the credits this money was still earning are given up.');
    expect(DIALOG).toContain('Credits given up');
    expect(DIALOG).toContain('Your limit drops by');
    // No confirmation gate in front of it — asserted on the rendered strings, not the file, so a
    // docblock explaining the rule cannot satisfy or break it.
    const rendered = DIALOG.match(/>[^<>{}]*[a-z][^<>{}]*</gi)?.join(' ') ?? '';
    expect(rendered).not.toMatch(/are you sure|be careful|cannot be undone/i);
  });

  test('swapping clears the amount', () => {
    // The caps differ between directions; carrying an amount that was valid one way into the
    // other would arrive already over the limit.
    expect(DIALOG).toContain("onDirectionChange(isDeposit ? 'withdraw' : 'deposit');\n    setTyped('');");
  });

  test('both rails exist and pick by direction', () => {
    expect(HOOK).toContain("const sponsored = direction === 'deposit' ? scDeposit : scRedeem;");
    expect(HOOK).toContain("const relayed = direction === 'deposit' ? gaslessDeposit : gaslessRedeem;");
  });
});

describe('empty is a different screen, not a disabled button', () => {
  test('nothing ready to allocate replaces the form', () => {
    expect(DIALOG).toContain('const nothingReady = isDeposit && cashReady <= 0;');
    expect(DIALOG).toContain('Add money first');
  });

  test('and only on the deposit leg', () => {
    // With savings to draw on, the other direction still works — an empty cash account is not an
    // empty account.
    expect(DIALOG).toContain('isDeposit && cashReady <= 0');
  });

  test('auto-save is offered there and nowhere else', () => {
    // Once, and inside the empty branch — which in source order sits between the eyebrow and the
    // keypad that only the form branch renders.
    expect(DIALOG.split('Set up auto-save instead').length - 1).toBe(1);
    // Anchored to the empty branch's own copy rather than to source order, which moved when the
    // keypad was hoisted for the desktop two-column layout.
    const at = DIALOG.indexOf('Set up auto-save instead');
    expect(at).toBeGreaterThan(DIALOG.indexOf('Add money first'));
    expect(at).toBeLessThan(DIALOG.indexOf('</Modal>'));
  });
});

/*
 * The reference is a picture of the screens, not a source of balances — its figures are mock. The
 * contracts are deployed, so anything that exists on chain is read from chain.
 */
describe('every figure comes from its real source', () => {
  test('balances are read, never taken from the page', () => {
    expect(CONNECTED).toContain('const savingsTotal = balances.savings;');
    expect(CONNECTED).toContain('const cashReady = balances.cash;');
  });

  test('there is no fallback to the page’s figures', () => {
    // The earlier version fell back to `data` whenever the read came back at zero, which would
    // have shown a member with nothing the reference's money as their own.
    expect(CONNECTED).not.toContain('savingsBalance(data.savings)');
    expect(CONNECTED).not.toContain('data.payFrom.balance');
    expect(CONNECTED).not.toContain('balances.total > 0');
  });

  test('credits come from the ledger that mints them', () => {
    expect(CONNECTED).toContain('getPaySummary(address)');
    // On the prop, not a substring scan — `data.savings.creditsGoal` contains the shorter path.
    expect(CONNECTED).toContain('credits={credits ?? 0}');
  });

  test('what cannot be withdrawn comes from the credit contracts', () => {
    // Encumbrance, not the pledge — see the withdrawal tests below for why those differ. There is
    // no "limit today" line either; that was mine, not the reference's.
    expect(CONNECTED).toContain('setEncumberedCents');
    expect(CONNECTED).not.toContain('data.creditLimitToday');
  });

  test('and `data` is used only for what has no real source', () => {
    // The credits goal is a product constant; the projected date is a projection nothing on chain
    // holds. Everything else is read.
    const used = [...CONNECTED.matchAll(/data\.[a-zA-Z.]+/g)].map((m) => m[0]);
    expect(new Set(used)).toEqual(new Set(['data.savings.creditsGoal', 'data.savings.onTrackFor']));
  });

  test('the cash leg is ready-to-allocate, not card-spendable', () => {
    expect(CONNECTED).toContain('Ready to allocate');
  });
});

/*
 * The preview harness renders these pages with no wallet providers. This broke twice — once in the
 * hook, then again in the component that consumed it — which is why the guards are a module rather
 * than a comment.
 */
describe('the preview harness still renders', () => {
  test('the guarded hooks are shared, not re-derived per consumer', () => {
    expect(GUARDS).toContain('export function useOptionalAddress');
    expect(GUARDS).toContain('export function useOptionalSmartWalletClient');
  });

  test('nothing under a page reaches for a raw wallet hook', () => {
    for (const source of [CONNECTED, HOOK]) {
      expect(source).not.toContain("from '@/lib/walletCompat'");
      expect(source).not.toContain("from '@privy-io/react-auth/smart-wallets'");
    }
  });

  test('and the dialog itself stays presentational', () => {
    expect(DIALOG).not.toContain('useSavingsMove');
    expect(DIALOG).not.toContain('useClearBalances');
  });
});

/*
 * From the deposit component's own reference — two rules I had guessed at and got wrong.
 */
describe('never block the keypad', () => {
  test('an over-amount does not disable the pad or the figure', () => {
    // Disabling would leave somebody holding a number with no way to find out why it will not go.
    expect(DIALOG).not.toContain('disabled={busy || over');
    expect(DIALOG).toContain('disabled={busy || amount <= 0}');
  });

  test('the overage is stated as a difference', () => {
    // The number they can act on, not a refusal.
    expect(DIALOG).toContain('const shortBy = amount - available;');
    expect(DIALOG).toContain('more than is {isDeposit ?');
  });

  test('and the affordable amount is offered', () => {
    expect(DIALOG).toContain('instead');
    expect(DIALOG).toContain('onClick={() => setTyped(String(available))}');
  });

  test('it is not styled as an error', () => {
    const overBlock = DIALOG.slice(DIALOG.indexOf('const action = over ? ('), DIALOG.indexOf('</>\n  ) : ('));
    expect(overBlock).not.toContain('negative');
  });
});

describe('withdrawing is stated, not warned about', () => {
  test('its box is neutral while the deposit box is accented', () => {
    // Colouring the withdrawal figures would be the warning tone the reference rules out.
    expect(DIALOG).toContain('border-border bg-secondary/50');
    expect(DIALOG).toContain('border-tier-boost/40');
  });

  test('the vesting note sits inside that box', () => {
    const box = DIALOG.slice(DIALOG.indexOf('Credits given up'), DIALOG.indexOf('Savings after'));
    expect(box).toContain('Vested credits stay.');
  });

  test('each direction keeps its own closing line', () => {
    expect(DIALOG).toContain('Instant. You can move it back any time.');
    expect(DIALOG).toContain('Instant. Move it back whenever you like.');
  });
});

describe('desktop gives the keypad its own column', () => {
  test('at a fixed width, so keys do not stretch', () => {
    expect(DIALOG).toContain('sm:grid-cols-[minmax(0,1fr)_216px]');
  });

  test('and the pad renders once per breakpoint, not twice at once', () => {
    expect(DIALOG).toContain('sm:hidden');
    expect(DIALOG).toContain('hidden sm:block');
  });
});


/*
 * The reference's CSS variable names are not this app's Tailwind tokens. `bg-surface-1` compiles
 * to nothing, so the legs and keypad rendered with no background at all — visible only by looking.
 */
describe('the classes are this app’s tokens, not the reference’s variable names', () => {
  test('no invented surface classes survive', () => {
    for (const source of [DIALOG, readFileSync(join(import.meta.dir, 'Keypad.tsx'), 'utf8')]) {
      expect(source).not.toContain('surface-1');
      expect(source).not.toContain('surface-2');
      expect(source).not.toContain('border-strong');
    }
  });
});

/*
 * The two-column layout and the dialog's width are one decision, not two.
 *
 * Gated on a breakpoint but rendered inside a fixed-width dialog, the grid forced a 216px keypad
 * and a full consequence column into 360px — every row wrapped to one word per line and the legs
 * truncated to a single character. A breakpoint says how wide the *window* is, which is not the
 * same question as how wide the container is.
 */
describe('the desktop layout gets the width it needs', () => {
  test('the dialog widens exactly where the two-column layout applies', () => {
    expect(DIALOG).toContain('sm:max-w-[640px]');
    expect(DIALOG).toContain('sm:grid-cols-[minmax(0,1fr)_216px]');
  });

  test('and both use the breakpoint Modal itself switches at', () => {
    // Modal renders a bottom sheet below 640px and a dialog above it. A grid on a different
    // breakpoint would put two columns inside a sheet, or one inside a wide dialog.
    const modal = readFileSync(join(import.meta.dir, 'Modal.tsx'), 'utf8');
    expect(modal).toContain('(max-width: 639px)');
  });

  test('the empty state stays narrow — it has no second column', () => {
    expect(DIALOG).toContain('className={nothingReady ? undefined :');
  });
});

/*
 * What a member may withdraw, from the contract's own rule rather than from arithmetic that looks
 * right. `_requiredUnits` returns zero when nothing is drawn, so a fully pledged line nobody has
 * touched encumbers nothing — the pledge-subtraction returned zero and would have locked a member
 * out of their own savings. Verified against a real wallet: 5 CLRUSD held, 5 pledged, 0 drawn,
 * `encumberedOf` = 0.
 */
describe('what is free to withdraw', () => {
  test('nothing drawn means all of it, however much is pledged', () => {
    expect(freeSavings(5, 0)).toBe(5);
  });

  test('drawing encumbers pound for pound at a 100% haircut', () => {
    // required = drawn × 10000 / haircutBps. SAVINGS is 10000 bps, so spending $5 against it
    // holds exactly $5 of savings still.
    expect(freeSavings(5, 500)).toBe(0);
  });

  test('and it is marginal, not all-or-nothing', () => {
    // Spending $2 of a $5 line holds $2 and leaves $3 to move.
    expect(freeSavings(5, 200)).toBe(3);
  });

  test('never negative', () => {
    expect(freeSavings(5, 900)).toBe(0);
  });

  test('an unreadable registry does not lock somebody out of their own savings', () => {
    // The transfer still enforces the real rule, so the worst case is a rejected transaction
    // rather than a member wrongly told their money is spoken for.
    expect(freeSavings(5, null)).toBe(5);
  });

  test('the component reads encumbrance, not the pledge', () => {
    expect(CONNECTED).toContain('credit.savingsEncumberedCents');
    expect(CONNECTED).not.toContain('collateralValueCents');
  });
});
