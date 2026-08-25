import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyKey } from '@/lib/amountEntry';
import { stepsFor } from '@/lib/moveSteps';
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
    // Each direction takes its cap from its own leg, and the pool's leg is capped again by what
    // the pool can actually pay.
    expect(DIALOG).toContain('const available = isDeposit ? cashReady : isPool ? poolFree : savingsFree;');
    expect(DIALOG).toContain('Math.min(savingsFree, pool.freeNow)');
  });

  test('the consequence flips with the direction', () => {
    expect(DIALOG).toContain('Credits earned');
    expect(DIALOG).toContain('Credits given up');
    expect(DIALOG).toContain('Adds to your credit limit');
    expect(DIALOG).toContain('Your credit limit drops by');
  });

  test('the cost of withdrawing is stated, not moralised', () => {
    // Three facts and no scare copy. A member taking out their own money is exercising the thing
    // that makes this an equity account rather than a lock-up.
    expect(DIALOG).toContain('Vested credits stay. Only the credits this money was still earning are given up.');
    expect(DIALOG).toContain('Credits given up');
    expect(DIALOG).toContain('Your credit limit drops by');
    // No confirmation gate in front of it — asserted on the rendered strings, not the file, so a
    // docblock explaining the rule cannot satisfy or break it.
    const rendered = DIALOG.match(/>[^<>{}]*[a-z][^<>{}]*</gi)?.join(' ') ?? '';
    expect(rendered).not.toMatch(/are you sure|be careful|cannot be undone/i);
  });

  test('swapping clears the amount', () => {
    // The caps differ between directions; carrying an amount that was valid one way into the
    // other would arrive already over the limit.
    expect(DIALOG).toContain("onDirectionChange(isDeposit ? 'withdraw' : 'deposit');\n    changeTyped('');");
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
    expect(DIALOG).toContain('more than is');
    expect(DIALOG).toContain("'ready to allocate'");
  });

  test('and the affordable amount is offered', () => {
    expect(DIALOG).toContain('instead');
    expect(DIALOG).toContain('onClick={() => changeTyped(String(available))}');
  });

  test('it is not styled as an error', () => {
    const overBlock = DIALOG.slice(DIALOG.indexOf('const action = over ? ('), DIALOG.indexOf('</>\n  ) : ('));
    expect(overBlock).not.toContain('negative');
  });
});

describe('withdrawing is stated, not warned about', () => {
  test('one summary box, not a tinted one and a bare list', () => {
    // Colour does what a second container was doing: the earn row is tinted, the credit-limit
    // footer is green and divided, and everything sits in one bordered box.
    expect(DIALOG).toContain('const summaryRows = (past = false) => (');
    expect(DIALOG).toContain("gain && 'mt-2 border-t-[0.5px] border-border pt-2'");
    expect(DIALOG).toContain("accent && 'text-tier-boost-fg'");
  });

  test('the vesting note survives the restructure', () => {
    // The update that introduced the single summary draws only deposits. That is not evidence a
    // withdrawal should say less.
    expect(DIALOG).toContain('const vestingNote =');
    expect(DIALOG).toContain('Vested credits stay.');
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

/*
 * The limit is not ours to predict.
 *
 * Balances are safe to show optimistically — the transfer confirmed, so they are already true. The
 * limit is not: it moves only after the server pledges the collateral and pushes the capacities,
 * two writes later. Faking it would have hidden a real bug where the pledge landed and the push
 * did not, leaving collateral recorded and the line unaware of it.
 */
describe('what may be shown before the chain agrees', () => {
  test('balances are optimistic, the limit is not', () => {
    expect(CONNECTED).toContain('balances.applyOptimistic');
    // No arithmetic on a limit anywhere in the connected component.
    expect(CONNECTED).not.toContain('creditLimit');
  });

  test('a move asks for a re-read instead', () => {
    expect(CONNECTED).toContain("new Event('clear:credit-stale')");
  });

  test('and the reader refetches on it, with backoff for the two writes', () => {
    const home = readFileSync(join(import.meta.dir, '../../pages/app/HomeRoute.tsx'), 'utf8');
    expect(home).toContain("addEventListener('clear:credit-stale'");
    expect(home).toContain('[3000, 8000, 15000]');
  });
});

/*
 * The yield pool — "the same component as savings, pointed at a different destination", which is
 * why it is a prop rather than a second modal.
 */
const POOL = readFileSync(join(import.meta.dir, 'ConnectedPoolMove.tsx'), 'utf8');
const POOL_HOOK = readFileSync(join(import.meta.dir, '../../hooks/usePoolMove.ts'), 'utf8');

describe('the pool is the same component, redirected', () => {
  test('destination is a prop, not a fork', () => {
    expect(DIALOG).toContain("export type MoveDestination = 'savings' | 'pool'");
    expect(DIALOG).toContain("const isPool = destination === 'pool';");
  });

  test('it names itself for what it does', () => {
    expect(DIALOG).toContain("'Add to the pool'");
    expect(DIALOG).toContain("'Take from the pool'");
  });

  test('the limit it quotes moves with the amount', () => {
    // A fixed delta would be right once and wrong on every keystroke after. 70% haircut, applied
    // to whatever is typed.
    expect(DIALOG).toContain('(amount * pool.haircutBps) / 10_000');
    expect(DIALOG).not.toContain('limitDeltaCents');
  });

  test('the yield figure is approximate on purpose', () => {
    // The rate moves with utilisation, so a precise number would be a promise the pool cannot keep.
    expect(DIALOG).toContain('~${money((after.savings * pool.apyPercent) / 100');
    expect(DIALOG).toContain('Rate moves with how much of the pool is lent.');
  });

  test('the withdraw panel names the limit it lands on, not only the drop', () => {
    // The question a member is actually asking is whether they stay above what they owe.
    expect(DIALOG).toContain('const landingNote =');
    expect(DIALOG).toContain('Limit falls to');
    expect(DIALOG).toContain('you owe');
  });

  test('and taking from the pool is not described as earning', () => {
    // The pool branch ignored direction at first, so a withdrawal read "Earning 6.8% APY" and
    // "Backs your credit limit" — both the wrong sign and the wrong claim.
    expect(DIALOG).toContain('isPool && pool && isDeposit ?');
    expect(DIALOG).toContain('Yield lost');
  });
});

/*
 * The pool has a state savings does not: it can be fully lent. A member whose money is out on loan
 * has not made a mistake, so the honest handling is to pay what is free and queue the rest.
 */
describe('fully lent is queued, not refused', () => {
  test('what can be taken now is capped by the pool’s cash, not the position', () => {
    expect(DIALOG).toContain('Math.min(savingsFree, pool.freeNow)');
  });

  test('the state is named before the constrained figures are read', () => {
    expect(DIALOG).toContain('Pool is fully lent');
  });

  test('both actions are offered — take what is free, queue the rest', () => {
    expect(DIALOG).toContain('Take {money(available, { cents: true })} now');
    expect(DIALOG).toContain('Queue the remaining');
    expect(DIALOG).toContain('Sent automatically. Nothing to come back and do.');
  });

  test('the split is computed in shares from the contract’s own cap', () => {
    // maxRedeem already accounts for available cash, so what it will not pay is exactly what must
    // queue. Deriving it from dollars would be the app guessing at a number the pool decides.
    expect(POOL_HOOK).toContain("functionName: 'maxRedeem'");
    expect(POOL_HOOK).toContain('const sharesQueued = wanted - sharesNow;');
  });

  test('both legs of the split go in one batch', () => {
    const send = readFileSync(join(import.meta.dir, '../../lib/sendCalls.ts'), 'utf8');
    expect(send).toContain("functionName: 'requestWithdrawal'");
    expect(send).toContain('scPoolWithdraw');
  });
});

describe('the pool pledges what it holds', () => {
  test('a movement tells the server, which pledges the position', () => {
    const send = readFileSync(join(import.meta.dir, '../../lib/sendCalls.ts'), 'utf8');
    expect(send).toContain('recordGaslessPool');
  });

  test('the position is read back rather than taken from the request', () => {
    // Nothing in the body is trusted but the fact that something happened, so a wrong or replayed
    // amount changes nothing.
    const service = readFileSync(
      join(import.meta.dir, '../../../server/src/services/chain/savingsCollateralService.ts'),
      'utf8',
    );
    expect(service).toContain('syncPoolCollateral');
    expect(service).toContain('convertToAssets');
  });

  test('it pledges assets, not shares', () => {
    // The registry values an amount pledge at a flat unit price, and a share is not worth a dollar
    // — it drifts up as the pool earns.
    const service = readFileSync(
      join(import.meta.dir, '../../../server/src/services/chain/savingsCollateralService.ts'),
      'utf8',
    );
    expect(service).toContain('POOL_SHARE_KIND, assets');
  });

  test('every figure is read, none passed in', () => {
    expect(POOL).toContain('getEarn(address)');
    expect(POOL).toContain('getCredit(address)');
  });
});

/*
 * The pad should be ready to type into.
 *
 * A prefilled amount has to be cleared before it can be replaced, which on a keypad means pressing
 * backspace three times before the first digit of what you actually wanted.
 */
describe('the amount starts empty', () => {
  test('nothing is prefilled', () => {
    expect(DIALOG).toContain("const [typed, setTyped] = useState('');");
    expect(DIALOG).not.toContain("useState('250')");
  });

  test('an empty amount reads as $0.00, not as blank', () => {
    // The figure is the anchor of the screen; an empty space where it belongs reads as broken.
    expect(DIALOG).toContain("Number(typed.split('.')[0] || 0)");
    expect(DIALOG).toContain("(typed.split('.')[1] ?? '').padEnd(2, '0')");
  });

  test('and the action is inert until something is typed', () => {
    expect(DIALOG).toContain('disabled={busy || amount <= 0}');
  });

  test('typing builds from empty without a leading zero to clear', () => {
    expect(['5', '0'].reduce(applyKey, '')).toBe('50');
  });
});

/*
 * Bonds join the pattern, which takes one extra control and one honest exception.
 */
describe('the bond is the third destination, not a third modal', () => {
  test('it is a destination on the same component', () => {
    expect(DIALOG).toContain("export type MoveDestination = 'savings' | 'pool' | 'bond'");
    expect(DIALOG).toContain("const isBond = destination === 'bond';");
  });

  test('the hero carries face value and the price beneath it', () => {
    // The one rule bonds break: everywhere else the number you type is the number that moves.
    // With a bond you choose what you get back, and a smaller, discounted amount leaves.
    expect(DIALOG).toContain('Face value — what you get back');
    expect(DIALOG).toContain('You pay {money(bond.priceToday, { cents: true })} today');
  });

  test('the price is never buried in the summary alone', () => {
    const heroEnd = DIALOG.indexOf('const chips');
    expect(DIALOG.slice(0, heroEnd)).toContain('You pay {money(bond.priceToday');
  });

  test('term is the only chip row', () => {
    // Face value is typed, so quick amounts would be guesses at a number already in mind — and
    // unlike savings there is no habitual round figure for a bond.
    expect(DIALOG).toContain('const chips = isBond && bond ? (');
    expect(DIALOG).toContain('{months} mo');
  });

  test('the route shows a direction, not a control', () => {
    // A two-headed swap would promise a reversal the product cannot do before maturity.
    expect(DIALOG).toContain('<ArrowRight');
    expect(DIALOG).toContain('{isBond ? (');
    const bondArrow = DIALOG.slice(DIALOG.indexOf('{isBond ? (\n        /*'), DIALOG.indexOf('<button\n          type="button"\n          onClick={swap}'));
    expect(bondArrow).not.toContain('onClick');
  });

  test('the To leg carries a date, because a bond has no balance yet', () => {
    expect(DIALOG).toContain('note={`Matures ${bond.maturesShort}`}');
    expect(DIALOG).toContain('balance === undefined ? note');
  });

  test('yield is one line, rate and dollars together', () => {
    // Splitting them made the reader do the multiplication.
    expect(DIALOG).toContain("% fixed · +${money(Math.max(0, amount - bond.priceToday)");
  });

  test('and the summary is the same five lines as everywhere else', () => {
    expect(DIALOG).toContain('You pay today');
    expect(DIALOG).toContain('You get at maturity');
    expect(DIALOG).toContain('Adds to your credit limit');
  });

  test('the lock note is context, so desktop moves it off the read', () => {
    expect(DIALOG).toContain('const lockNote =');
    expect(DIALOG).toContain('<div className="sm:hidden">{lockNote}</div>');
  });
});

describe('a fetched price needs the amount as it is typed', () => {
  test('the dialog reports every change, not just the submit', () => {
    // A price that only appeared after pressing Buy would be a price nobody agreed to before
    // agreeing to it.
    expect(DIALOG).toContain('onAmountChange?.(Number(value) || 0)');
  });

  test('through one setter, so nothing can move it unheard', () => {
    expect(DIALOG).toContain('const changeTyped =');
    // Exactly one call to the raw setter, and it is the one inside changeTyped.
    expect(DIALOG.split('setTyped(').length - 1).toBe(1);
  });

  test('and the bond quotes its price from the chain for what is on screen', () => {
    const bond = readFileSync(join(import.meta.dir, 'ConnectedBuyBond.tsx'), 'utf8');
    expect(bond).toContain("functionName: 'calculateRequiredDeposit'");
    expect(bond).toContain('onAmountChange={setFace}');
  });
});

/*
 * A spinner inside the button is too quiet for money moving, so the modal replaces its own
 * content — and a failure gets more than a red line under the amount.
 */
const PROGRESS = readFileSync(join(import.meta.dir, 'MoveProgress.tsx'), 'utf8');
const SAVINGS_HOOK = readFileSync(join(import.meta.dir, '../../hooks/useSavingsMove.ts'), 'utf8');

describe('a move shows itself happening', () => {
  test('three named steps, not a bare spinner', () => {
    // If one stalls the screen already shows which; a spinner that stalls says only that
    // something is wrong somewhere.
    expect(DIALOG).toContain('const stepLabels =');
    expect(DIALOG).toContain('Taken from your cash account');
    expect(DIALOG).toContain('Adding to your savings');
    expect(DIALOG).toContain('Crediting ${count(amount)} equity credits');
  });

  test('the steps are named per destination', () => {
    expect(DIALOG).toContain('Issuing the bond');
    expect(DIALOG).toContain('Adding it to your credit line');
  });

  test('and they advance on events, not on a timer', () => {
    // A progress bar that moves on its own lies when something stalls, which is exactly when a
    // member is watching it.
    expect(SAVINGS_HOOK).toContain("setProgress({ status: 'processing', step: 0 })");
    expect(SAVINGS_HOOK).toContain("setProgress({ status: 'done'");
    expect(SAVINGS_HOOK).not.toContain('setTimeout');
    expect(SAVINGS_HOOK).not.toContain('setInterval');
  });

  test('the member is told they can walk away', () => {
    // The instinct with money in flight is to sit and stare. It is also true — the transaction is
    // already submitted.
    expect(DIALOG).toContain('You can close this');
    expect(DIALOG).toContain('finishes on its own');
  });
});

describe('done repeats what was promised, past tense', () => {
  test('the same five lines, relabelled', () => {
    // Same numbers the member saw before confirming, so nothing arrives as a surprise.
    expect(DIALOG).toContain("past ? 'Your credit limit rose by' : 'Adds to your credit limit'");
    expect(DIALOG).toContain("past ? 'Savings' : 'Savings after'");
    expect(DIALOG).toContain('summaryRows(true)');
  });

  test('and the bond leads with the gain, not the payment', () => {
    // The member already knows what left their account — they confirmed it. What they bought is
    // the difference and a date.
    expect(DIALOG).toContain("past ? 'You gain' : 'You get at maturity'");
    expect(DIALOG).toContain('past ? Math.max(0, amount - bond.priceToday) : amount');
  });

  test('the next move is offered where somebody is inclined to make one', () => {
    expect(DIALOG).toContain("isBond ? 'See your bonds' : isPool ? 'Add more' : 'Save more'");
  });
});

describe('a failure answers the only question that matters', () => {
  test('"Nothing moved" is the headline, not the error', () => {
    expect(DIALOG).toContain("'Nothing moved'");
    expect(DIALOG).toContain('is still in your');
  });

  test('the steps stay and show the reversal', () => {
    // Somebody who watched money leave needs to watch it come back, not be told it never left.
    expect(DIALOG).toContain("state: 'done' as const }");
    expect(DIALOG).toContain('Returned — ${progress.failureNote');
  });

  test('the reason is short enough for one line', () => {
    // Chain errors are paragraphs. The full message stays in `error` for a console.
    const pool = readFileSync(join(import.meta.dir, '../../hooks/usePoolMove.ts'), 'utf8');
    expect(pool).toContain('export function shortMoveReason');
    expect(pool).toContain("return 'the network was busy'");
  });

  test('and there is one implementation of it, not one per destination', () => {
    expect(SAVINGS_HOOK).toContain("import { shortMoveReason }");
    expect(SAVINGS_HOOK).not.toContain('function shortReason');
  });

  test('the mark is not a red cross', () => {
    // Nothing went wrong with the member's money — it is still theirs, in the account it started
    // in. A red X would say otherwise before the headline gets a chance to.
    expect(PROGRESS).toContain('export function AlertMark');
    expect(PROGRESS).not.toContain('negative');
  });
});

describe('which step is where', () => {
  test('processing marks everything before the current one done', () => {
    const steps = stepsFor(['a', 'b', 'c'], 1, 'processing');
    expect(steps.map((s) => s.state)).toEqual(['done', 'active', 'waiting']);
  });

  test('done marks all of them done, whatever the step says', () => {
    // A confirmed move is finished even if the step counter never caught up.
    expect(stepsFor(['a', 'b', 'c'], 0, 'done').every((s) => s.state === 'done')).toBe(true);
  });

  test('a failure leaves nothing active', () => {
    // Nothing is in flight once it has come back.
    expect(stepsFor(['a', 'b', 'c'], 1, 'failed').some((s) => s.state === 'active')).toBe(false);
  });
});
