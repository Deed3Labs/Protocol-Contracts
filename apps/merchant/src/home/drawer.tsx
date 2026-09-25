import { useState, type ReactNode } from 'react';
import { Chip } from '@/brand/controls';
import { IconCheck, IconDeleteSm, IconHidden, IconMethod, IconMinus, IconPlusSm } from '@/brand/icons';
import { Sheet, cx, initials } from '@/brand/ui';
import { FlowTop } from '@/shell/chrome';
import { firstName, usd } from '@/home/model';

/**
 * The drawer and Close the day, drawn from the Home reference.
 *
 * Cash is the one kind of money the app cannot count for itself, so the drawer gets three moments
 * and no more: the first person on counts it in, whoever is on sees it in their shift cell, and at
 * close it is counted out twice, by two people, blind. Neither count sees the other's figure or
 * the expected total until both are in (the backend enforces it; these sheets only never show it).
 *
 * The sheets keep their own typing state (a figure on the pad, notes on the steppers) and hand the
 * result up in cents. Whether two counts agree, and what that means, is decided by the caller.
 */

const DASH = '—';

// ---- Pieces -------------------------------------------------------------------------------------

/** The drawer's pad: ruled, 52px keys, a decimal point where sign-in has "Not me". */
function DrawerKeys({ onKey, decimal = true, mid }: { onKey: (k: string) => void; decimal?: boolean; mid?: boolean }) {
  return (
    <div className={cx('c-dr-keys', mid && 'c-mid')}>
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <button key={d} type="button" onClick={() => onKey(d)}>
          {d}
        </button>
      ))}
      {decimal ? (
        <button type="button" onClick={() => onKey('.')}>
          .
        </button>
      ) : (
        <button type="button" className="c-blank" aria-hidden="true" tabIndex={-1} />
      )}
      <button type="button" onClick={() => onKey('0')}>
        0
      </button>
      <button type="button" aria-label="Delete" onClick={() => onKey('del')}>
        <IconDeleteSm />
      </button>
    </div>
  );
}

/** A dollar figure typed on the pad, held as the string the person typed. */
function useTyped(initial: string) {
  const [s, setS] = useState(initial);
  const key = (k: string) =>
    setS((cur) => {
      if (k === 'del') return cur.slice(0, -1);
      if (k === '.' && cur.includes('.')) return cur;
      if (cur.includes('.') && cur.split('.')[1].length >= 2) return cur;
      if (cur.replace('.', '').length >= 7) return cur;
      return cur === '0' && k !== '.' ? k : cur + k;
    });
  const cents = Math.round(parseFloat(s || '0') * 100);
  return { s, cents, key, set: setS };
}

const Fig = ({ cents }: { cents: number }) => (
  <div className="c-dr-fig">
    {usd(cents)}
    <span className="c-caret" />
  </div>
);

function Who({ name, det }: { name: string; det: string }) {
  return (
    <div className="c-dr-who">
      <span className="c-avatarbtn" style={{ cursor: 'default' }}>
        {initials(name)}
      </span>
      <div>
        <p className="c-t">{name}</p>
        <p className="c-det">{det}</p>
      </div>
    </div>
  );
}

const PrimaryFoot = ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => (
  <button type="button" className="c-btn c-btn-primary c-btn-lg" style={{ width: '100%' }} disabled={disabled} onClick={onClick}>
    {children}
  </button>
);

/** Expected, counted and the difference, in one ruled strip. `hideExpected` for a blind count. */
function Strip({
  cells,
  flush,
}: {
  cells: { label: ReactNode; cents: number | null; tone?: 'ok' | 'short' | 'hid' }[];
  flush?: boolean;
}) {
  return (
    <div className={cx('c-dr-was', flush && 'c-flush')}>
      {cells.map((c, i) => (
        <div key={i} className={c.tone ? `c-${c.tone}` : ''}>
          <p className="c-label">{c.label}</p>
          {c.tone === 'hid' ? (
            <p className="c-f" aria-label="Hidden">
              $&bull;&bull;&bull;.&bull;&bull;
            </p>
          ) : (
            <p className="c-f">{c.cents === null ? DASH : usd(c.cents)}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ---- Opening it ---------------------------------------------------------------------------------

/** Only the first person on counts. Everyone after joins a drawer that is already open. */
export function OpenDrawerSheet({
  name,
  at,
  lastCloseCents,
  onStart,
  onClose,
  inline,
  initialOther,
}: {
  name: string;
  at: string;
  lastCloseCents: number;
  onStart?: (cents: number) => void;
  onClose?: () => void;
  inline?: boolean;
  /** For the gallery: open on "Something else" with this typed. */
  initialOther?: string;
}) {
  const [other, setOther] = useState(initialOther !== undefined);
  const typed = useTyped(initialOther ?? '');
  const cents = other ? typed.cents : lastCloseCents;
  return (
    <Sheet
      inline={inline}
      className="c-dr-sheet"
      title="Open the drawer"
      closeSize="lg"
      onClose={onClose}
      foot={<PrimaryFoot onClick={() => onStart?.(cents)}>Start with {usd(cents)}</PrimaryFoot>}
    >
      <Who name={name} det={`First on today · ${at}`} />
      <p className="c-label c-dr-fl">Count what is in it to start</p>
      <Fig cents={cents} />
      <div className="c-dr-chips">
        <button type="button" className={cx('c-btn', !other && 'c-on')} onClick={() => setOther(false)}>
          Same as last close &middot; {usd(lastCloseCents)}
        </button>
        <button type="button" className={cx('c-btn', other && 'c-on')} onClick={() => setOther(true)}>
          Something else
        </button>
      </div>
      {other ? (
        <DrawerKeys onKey={typed.key} />
      ) : (
        <p className="c-det" style={{ marginTop: 'var(--s2)', lineHeight: 1.5 }}>
          Only the first person on counts. Everyone after joins a drawer that is already open.
        </p>
      )}
    </Sheet>
  );
}

// ---- Ending a shift -----------------------------------------------------------------------------

export function EndShiftSheet({
  name,
  span,
  raised,
  cashCents,
  tips,
  stillOn,
  onEnd,
  onClose,
  inline,
}: {
  name: string;
  /** "8:04am to 4:02pm · 7h 58m" */
  span: string;
  raised: { n: number; cents: number };
  cashCents: number | null;
  tips: { cents: number; how: 'card' | 'cash' } | null;
  /** Someone still on, so the drawer stays open. */
  stillOn?: { name: string; until: string };
  onEnd?: () => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  return (
    <Sheet
      inline={inline}
      className="c-dr-sheet"
      title="End your shift"
      closeSize="lg"
      onClose={onClose}
      foot={<PrimaryFoot onClick={onEnd}>End shift</PrimaryFoot>}
    >
      <Who name={name} det={span} />
      <div className="c-dr-rows">
        <div className="c-kv">
          <span>Charges you raised</span>
          <span className="c-v">
            {raised.n} &middot; {usd(raised.cents)}
          </span>
        </div>
        <div className="c-kv">
          <span>Cash you took</span>
          <span className="c-v">{cashCents ? usd(cashCents) : DASH}</span>
        </div>
        <div className="c-kv">
          <span>Your tips today</span>
          <span className="c-v">{tips ? `${usd(tips.cents)} · ${tips.how}` : DASH}</span>
        </div>
      </div>
      {stillOn && (
        <div className="c-dr-note">
          <span className="c-dot" />
          <p className="c-det">
            {firstName(stillOn.name)} is on until {stillOn.until}, so the drawer stays open. Whoever closes counts it.
          </p>
        </div>
      )}
    </Sheet>
  );
}

// ---- Counting it out ----------------------------------------------------------------------------

const NOTES = [10000, 5000, 2000, 1000, 500, 100];

/**
 * One blind count. The first is drawn by note, two to a row with each note's total under it; the
 * second typed as a total. Either can switch. The expected total and the other count are never
 * passed in, so they cannot be shown.
 */
export function CountSheet({
  which,
  name,
  at,
  otherName,
  initialNotes,
  initialCoins,
  initialTotal,
  initialMode,
  onSave,
  onClose,
  inline,
}: {
  which: 'first' | 'second';
  name: string;
  at: string;
  /** Whose count is hidden, on the second. */
  otherName?: string;
  initialNotes?: number[];
  initialCoins?: number;
  initialTotal?: string;
  initialMode?: 'note' | 'total';
  onSave?: (cents: number) => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  const [mode, setMode] = useState<'note' | 'total'>(initialMode ?? (which === 'first' ? 'note' : 'total'));
  const [notes, setNotes] = useState<number[]>(initialNotes ?? NOTES.map(() => 0));
  const [coins] = useState(initialCoins ?? 0);
  const typed = useTyped(initialTotal ?? '');
  const byNote = notes.reduce((s, n, i) => s + n * NOTES[i], 0) + coins;
  const cents = mode === 'note' ? byNote : typed.cents;
  const mine = firstName(name);

  return (
    <Sheet
      inline={inline}
      className={cx('c-dr-sheet', mode === 'note' && 'c-dr-wide')}
      title={which === 'first' ? 'First count' : 'Second count'}
      closeSize="lg"
      onClose={onClose}
      foot={<PrimaryFoot onClick={() => onSave?.(cents)}>Save the {which} count</PrimaryFoot>}
    >
      <div className="c-dr-mode" role="radiogroup" aria-label="Count by">
        <button type="button" role="radio" aria-checked={mode === 'note'} className={mode === 'note' ? 'c-on' : ''} onClick={() => setMode('note')}>
          By note
        </button>
        <button type="button" role="radio" aria-checked={mode === 'total'} className={mode === 'total' ? 'c-on' : ''} onClick={() => setMode('total')}>
          Type the total
        </button>
      </div>
      {mode === 'note' ? (
        <>
          <p className="c-det" style={{ margin: 'var(--s2) 0' }}>
            {name} &middot; {at}
            {otherName ? ` · ${firstName(otherName)}’s count is hidden` : ''}
          </p>
          <div className="c-dr-notes">
            {NOTES.map((v, i) => (
              <div key={v} className="c-dr-note-cell">
                <div>
                  <p className="c-n">${v / 100}</p>
                  <p className="c-det">{usd(notes[i] * v)}</p>
                </div>
                <span className="c-dr-step">
                  <button
                    type="button"
                    aria-label={`One fewer $${v / 100}`}
                    onClick={() => setNotes((ns) => ns.map((n, j) => (j === i ? Math.max(0, n - 1) : n)))}
                  >
                    <IconMinus />
                  </button>
                  <b aria-label={`${notes[i]} $${v / 100} notes`}>{notes[i]}</b>
                  <button
                    type="button"
                    aria-label={`One more $${v / 100}`}
                    onClick={() => setNotes((ns) => ns.map((n, j) => (j === i ? n + 1 : n)))}
                  >
                    <IconPlusSm />
                  </button>
                </span>
              </div>
            ))}
            <div className="c-dr-note-cell c-coins">
              <div>
                <p className="c-n">Coins</p>
                <p className="c-det">Typed as a total</p>
              </div>
              <span className="c-dr-field">{usd(coins)}</span>
            </div>
          </div>
          <div className="c-dr-mine">
            <span>{mine}&rsquo;s count</span>
            <b>{usd(byNote)}</b>
          </div>
          <div className="c-dr-blind">
            <IconHidden />
            <p className="c-det">The expected total stays hidden until both counts are in, so neither count leans on it.</p>
          </div>
        </>
      ) : (
        <>
          <p className="c-det" style={{ margin: 'var(--s2) 0 0' }}>
            {name} &middot; {at}
            {otherName ? ` · ${firstName(otherName)}’s count is hidden` : ''}
          </p>
          <Fig cents={typed.cents} />
          <DrawerKeys onKey={typed.key} mid />
        </>
      )}
    </Sheet>
  );
}

/** What the two counts say. Only the third needs a manager. */
export function CountResultSheet({
  outcome,
  first,
  second,
  expectedCents,
  note,
  onNote,
  onDone,
  onRecount,
  onAskSignOff,
  onClose,
  inline,
}: {
  outcome: 'match' | 'disagree' | 'short';
  first: { name: string; cents: number };
  second: { name: string; cents: number };
  /** Never shown while the counts disagree. */
  expectedCents: number;
  note?: string;
  onNote?: (v: string) => void;
  onDone?: () => void;
  onRecount?: (who: 'first' | 'second') => void;
  onAskSignOff?: () => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  const a = firstName(first.name);
  const b = firstName(second.name);
  if (outcome === 'match') {
    return (
      <Sheet inline={inline} className="c-dr-sheet" title="The counts match" closeSize="lg" onClose={onClose} foot={<PrimaryFoot onClick={onDone}>Done</PrimaryFoot>}>
        <Strip
          flush
          cells={[
            { label: a, cents: first.cents, tone: 'ok' },
            { label: b, cents: second.cents, tone: 'ok' },
            { label: 'Expected', cents: expectedCents },
          ]}
        />
        <div className="c-dr-note c-ok">
          <span className="c-dot" />
          <p className="c-det">Both counts agree, and they match the drawer. Nothing else to do.</p>
        </div>
      </Sheet>
    );
  }
  if (outcome === 'disagree') {
    return (
      <Sheet
        inline={inline}
        className="c-dr-sheet"
        title={'The counts don’t agree'}
        closeSize="lg"
        onClose={onClose}
        foot={
          <p className="c-det" style={{ margin: 0 }}>
            A third count replaces whichever it matches.
          </p>
        }
      >
        <Strip
          flush
          cells={[
            { label: a, cents: first.cents },
            { label: b, cents: second.cents },
            {
              label: (
                <>
                  Expected <IconHidden />
                </>
              ),
              cents: null,
              tone: 'hid',
            },
          ]}
        />
        <div className="c-dr-note c-warn">
          <span className="c-dot" />
          <p className="c-det">
            The two counts are {usd(Math.abs(first.cents - second.cents))} apart. One of you counts again; the expected
            total stays hidden until two counts agree.
          </p>
        </div>
        <div className="c-dr-again">
          <button type="button" className="c-btn" onClick={() => onRecount?.('first')}>
            {a} counts again
          </button>
          <button type="button" className="c-btn" onClick={() => onRecount?.('second')}>
            {b} counts again
          </button>
        </div>
      </Sheet>
    );
  }
  const diff = expectedCents - first.cents;
  return (
    <Sheet
      inline={inline}
      className="c-dr-sheet"
      title={`The counts agree, the drawer is ${diff > 0 ? 'short' : 'over'}`}
      closeSize="lg"
      onClose={onClose}
      foot={<PrimaryFoot onClick={onAskSignOff}>Ask for a sign-off</PrimaryFoot>}
    >
      <Strip
        flush
        cells={[
          { label: a, cents: first.cents },
          { label: b, cents: second.cents },
          { label: 'Expected', cents: expectedCents },
        ]}
      />
      <div className="c-dr-short">
        <span>Both counted {usd(first.cents)}</span>
        <b>
          {usd(Math.abs(diff))} {diff > 0 ? 'short' : 'over'}
        </b>
      </div>
      <p className="c-label c-dr-fl">What happened</p>
      <input className="c-field c-dr-in" aria-label="What happened" value={note ?? ''} onChange={(e) => onNote?.(e.target.value)} />
    </Sheet>
  );
}

/**
 * A difference two counts agree on is signed off by an owner or manager, never by whoever counted
 * first. Count again is always beside it, because most differences are a miscount.
 */
export function SignOffSheet({
  expectedCents,
  countedCents,
  counters,
  note,
  signer,
  pinFilled,
  onKey,
  onSomeoneElse,
  onCountAgain,
  onSignOff,
  onClose,
  inline,
}: {
  expectedCents: number;
  countedCents: number;
  counters: [string, string];
  note: string;
  signer: { name: string; role: string };
  pinFilled: number;
  onKey?: (k: string) => void;
  onSomeoneElse?: () => void;
  onCountAgain?: () => void;
  onSignOff?: () => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  const diff = expectedCents - countedCents;
  const word = diff > 0 ? 'short' : 'over';
  return (
    <Sheet
      inline={inline}
      className="c-dr-sheet c-dr-sign"
      title={`Sign off a ${word} drawer`}
      closeSize="lg"
      onClose={onClose}
      foot={
        <div className="c-dr-pair">
          <button type="button" className="c-btn c-btn-lg" onClick={onCountAgain}>
            Count again
          </button>
          <button type="button" className="c-btn c-btn-primary c-btn-lg" disabled={pinFilled < 4} onClick={onSignOff}>
            Sign off {usd(Math.abs(diff))} {word}
          </button>
        </div>
      }
    >
      <Strip
        flush
        cells={[
          { label: 'Expected', cents: expectedCents },
          { label: 'Counted', cents: countedCents },
          { label: word[0].toUpperCase() + word.slice(1), cents: Math.abs(diff), tone: 'short' },
        ]}
      />
      <p className="c-dr-quote">
        {firstName(counters[0])} and {firstName(counters[1])} both counted {usd(countedCents)}. &ldquo;{note}&rdquo;
      </p>
      <div className="c-dr-signer">
        <span className="c-avatarbtn" style={{ cursor: 'default' }}>
          {initials(signer.name)}
        </span>
        <div>
          <p className="c-t">{signer.name} signs</p>
          <p className="c-det">{signer.role}. The first counter cannot sign.</p>
        </div>
        <button type="button" className="c-ci-link c-dr-link" onClick={onSomeoneElse}>
          Someone else
        </button>
      </div>
      <div className="c-dr-pinrow">
        <span className="c-dots" role="img" aria-label={`${pinFilled} of 4 digits`}>
          {[0, 1, 2, 3].map((i) => (
            <i key={i} className={i < pinFilled ? 'c-f' : ''} />
          ))}
        </span>
      </div>
      <DrawerKeys decimal={false} onKey={(k) => onKey?.(k)} />
    </Sheet>
  );
}

// ---- Closing the day ----------------------------------------------------------------------------

export interface DaySummary {
  /** "Tue, Sep 22" */
  date: string;
  charges: number;
  /** "8:30am to 5:40pm" */
  span: string;
  takenCents: number;
  clear: { n: number; cents: number };
  card: { n: number; cents: number };
  cash: { n: number; cents: number };
  tipsCents: number;
  taxCents: number;
  discountsCents: number;
  waiting: { n: number; cents: number } | null;
}

export interface DrawerClose {
  expectedCents: number;
  countedCents: number;
  note?: string;
  counters: [string, string];
  signed?: { name: string; at: string };
  tips: { name: string; cents: number; how: 'card' | 'cash' }[];
  leaveCents: number;
}

/**
 * One screen for the last person out: the day by how it was paid on the left, the drawer on the
 * right. Closing locks the day's figures, so the footer says so beside the button, and a
 * difference nobody has signed off keeps it disabled.
 */
export function CloseDayView({
  day,
  drawer,
  onShift,
  onExit,
  onSignOff,
  onClose,
  onChangeShift,
  twoColumn = true,
}: {
  day: DaySummary;
  drawer: DrawerClose;
  onShift: string;
  onExit?: () => void;
  onSignOff?: () => void;
  onClose?: () => void;
  onChangeShift?: () => void;
  twoColumn?: boolean;
}) {
  const diff = drawer.expectedCents - drawer.countedCents;
  const balanced = diff === 0;
  const word = diff > 0 ? 'Short' : 'Over';
  const needsSign = !balanced && !drawer.signed;
  const cashTips = drawer.tips.filter((t) => t.how === 'cash');
  const cashTipCents = cashTips.reduce((s, t) => s + t.cents, 0);
  const leaves = drawer.countedCents - cashTipCents;
  const [c1, c2] = drawer.counters.map(firstName);

  const method = (key: 'clear' | 'card' | 'cash', t: string, det: string, m: { n: number; cents: number }) => (
    <div className="c-dr-m">
      <span className="c-ic">
        <IconMethod method={key} />
      </span>
      <div>
        <p className="c-t">{t}</p>
        <p className="c-det">
          {m.n} &middot; {det}
        </p>
      </div>
      <span className="c-v">{usd(m.cents)}</span>
    </div>
  );

  return (
    <div className="c-app c-mc-tablet c-mc-page c-dr-close">
      <FlowTop title={`Close the day · ${day.date}`} onExit={onExit} onShift={onShift} onChangeShift={onChangeShift} />
      <div className={cx('c-slab', !twoColumn && 'c-one')}>
        <div className="c-cell">
          <div className="c-chead">
            <div className="c-sechead">
              <p className="c-label">Today</p>
              <span className="c-det">
                {day.charges} charges &middot; {day.span}
              </span>
            </div>
          </div>
          <div className="c-cmain c-dr-col">
            <div className="c-dr-hero">
              <p className="c-label">Taken today</p>
              <p className="c-f">{usd(day.takenCents)}</p>
              <p className="c-det">Across Clear, card and cash, tips included</p>
            </div>
            <div className="c-dr-ms">
              {method('clear', 'Clear', 'paid out on the 14th', day.clear)}
              {method('card', 'Card', 'deposited by the processor', day.card)}
              {method('cash', 'Cash', 'in the drawer', day.cash)}
            </div>
            <div className="c-dr-small">
              <div className="c-kv">
                <span>Tips</span>
                <span className="c-v">{usd(day.tipsCents)}</span>
              </div>
              <div className="c-kv">
                <span>Sales tax collected</span>
                <span className="c-v">{usd(day.taxCents)}</span>
              </div>
              <div className="c-kv">
                <span>Discounts and refunds</span>
                <span className="c-v">{day.discountsCents ? usd(day.discountsCents) : DASH}</span>
              </div>
              <div className="c-kv">
                <span>Still waiting</span>
                <span className="c-v">
                  {day.waiting ? `${day.waiting.n} · ${usd(day.waiting.cents)}, can approve tomorrow` : DASH}
                </span>
              </div>
            </div>
          </div>
          <div className="c-cfoot">
            <p className="c-det">Each figure opens its charges.</p>
          </div>
        </div>

        <div className="c-cell">
          <div className="c-chead">
            <div className="c-sechead">
              <p className="c-label">The drawer</p>
              {balanced ? (
                <Chip tone="settled" dot>
                  Balanced
                </Chip>
              ) : (
                <Chip tone="underway" dot>
                  {word} {usd(Math.abs(diff))}
                </Chip>
              )}
            </div>
          </div>
          <div className="c-cmain c-dr-col">
            <Strip
              cells={[
                { label: 'Expected', cents: drawer.expectedCents },
                { label: 'Counted', cents: drawer.countedCents, tone: balanced ? 'ok' : undefined },
                balanced
                  ? { label: 'Difference', cents: null }
                  : { label: word, cents: Math.abs(diff), tone: 'short' },
              ]}
            />
            {balanced ? (
              <p className="c-dr-quote c-dr-match">
                Counted by {c1}, checked by {c2}. Both match the drawer.
              </p>
            ) : (
              <p className="c-dr-quote">
                &ldquo;{drawer.note}&rdquo;{' '}
                <span className="c-det">
                  Counted by {c1}, checked by {c2}
                </span>
              </p>
            )}
            {drawer.signed && (
              <p className="c-dr-signed">
                <IconCheck />
                Signed off by {drawer.signed.name} at {drawer.signed.at}
              </p>
            )}
            <p className="c-label c-dr-fl">Tips to pay out</p>
            <div className="c-dr-tips">
              {drawer.tips.map((t) => (
                <div key={t.name} className="c-kv">
                  <span>{t.name}</span>
                  <span className="c-v">
                    {usd(t.cents)} &middot; {t.how === 'card' ? 'card, with payroll' : 'cash, from the drawer'}
                  </span>
                </div>
              ))}
            </div>
            <div className="c-dr-small">
              <div className="c-kv">
                <span>Counted</span>
                <span className="c-v">{usd(drawer.countedCents)}</span>
              </div>
              {cashTips.length > 0 && (
                <div className="c-kv">
                  <span>{cashTips.length === 1 ? `${firstName(cashTips[0].name)}’s tip, paid from it` : 'Cash tips, paid from it'}</span>
                  <span className="c-v">&minus;{usd(cashTipCents)}</span>
                </div>
              )}
              <div className="c-kv c-strong">
                <span>Leaves</span>
                <span className="c-v">{usd(leaves)}</span>
              </div>
            </div>
            <div className="c-dr-split">
              <div>
                <p className="c-label">Leave for tomorrow</p>
                <p className="c-f">{usd(drawer.leaveCents)}</p>
              </div>
              <div>
                <p className="c-label">To the bank</p>
                <p className="c-f">{usd(leaves - drawer.leaveCents)}</p>
              </div>
            </div>
          </div>
          <div className="c-cfoot">
            <div className="c-line" style={{ alignItems: 'center' }}>
              {needsSign ? (
                <>
                  <span className="c-det c-dr-need">Needs a sign-off first</span>
                  <span className="c-dr-pair" style={{ flexShrink: 0 }}>
                    <button type="button" className="c-btn" disabled>
                      Close the day
                    </button>
                    <button type="button" className="c-btn c-btn-primary" onClick={onSignOff}>
                      Sign off
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <span className="c-det">Everyone is off. This locks today&rsquo;s figures.</span>
                  <button type="button" className="c-btn c-btn-primary" onClick={onClose}>
                    Close the day
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
