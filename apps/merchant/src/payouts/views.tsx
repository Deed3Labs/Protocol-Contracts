import { useState, type CSSProperties, type ReactNode } from 'react';
import { IconCheck15, IconChevronSm, IconPrev } from '@/brand/chargeIcons';
import { IconChevron, IconLock } from '@/brand/icons';
import { cx, Sheet } from '@/brand/ui';
import { usd } from '@/home/model';
import { HIST_PAGE, type HistRow, type PayoutsModel } from '@/payouts/model';
import type { BankAccount, ReceiveDetails } from '@clear/merchant-contracts';

/**
 * Payouts' blocks — docs/merchant-reference/clear-merchant-payouts.html: the figure a business
 * asks for, the payout cycle, and the slab (the payouts themselves, where the money sits, the
 * cash account, and the drawer's cash and tips).
 */

const press = (fn?: () => void) =>
  fn
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: fn,
        onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fn()),
      }
    : {};

const money = (c: number | null) => (c === null ? '—' : usd(c));

/** How much can move right now, and when the rest lands. */
export function PayoutsHero({ m }: { m: PayoutsModel }) {
  return (
    <div className="c-mc-hero">
      <div>
        <p className="c-label">Ready to withdraw</p>
        <p className="c-fig c-fig-hero" style={{ marginTop: 6 }}>
          {money(m.readyCents)}
        </p>
        <p className="c-det" style={{ marginTop: 4 }}>
          {m.on && m.scheduledCents > 0 ? `${usd(m.scheduledCents)} more releases ${m.on}` : 'Paid on your terms, and sooner when the pool allows'}
        </p>
      </div>
    </div>
  );
}

/**
 * The payout cycle, counting down to the date the rest releases. The border carries the state:
 * something free to move, nothing yet, or paying out today.
 */
export function CycleCard({ m, onWithdraw, onHow, onCharges }: { m: PayoutsModel; onWithdraw: () => void; onHow?: () => void; onCharges?: () => void }) {
  const on = m.on ?? '—';
  let label: string;
  let fig: number;
  let num: ReactNode;
  let unit: string;
  let track: ReactNode = null;
  let cap: ReactNode;
  let foot: [string, string];
  let action: ReactNode;
  if (m.cycle === 'paying' && m.paying) {
    label = 'Paying out';
    fig = m.paying.cents;
    num = m.paying.days;
    unit = `days to ${m.bank?.split(' ')[0] ?? 'the bank'}`;
    track = <div style={{ width: '100%', background: 'var(--live)' }} />;
    cap = (
      <>
        {usd(m.paying.movedEarlyCents)} you moved early<span className="c-sep">·</span>
        {usd(m.paying.cents)} to {m.bank?.split(' ')[0] ?? 'the bank'} today
      </>
    );
    foot = ['Left this morning', `Arrives by ${m.paying.arrivesBy} · ${m.bank ?? 'your bank'}`];
    action = (
      <button type="button" className="c-btn" onClick={onCharges}>
        See the charges
      </button>
    );
  } else {
    label = `Releases ${on}`;
    fig = m.owedCents;
    num = m.daysLeft ?? '—';
    unit = 'days left';
    const released = m.releasedCents ?? 0;
    if (m.cycle === 'free' && m.owedCents > 0) track = <div style={{ width: `${Math.round((released / m.owedCents) * 100)}%`, background: 'var(--settled)' }} />;
    const rest = m.cycle === 'free' ? m.owedCents - released : m.owedCents;
    cap =
      m.cycle === 'free' ? (
        <>
          <span className="c-t-sav">{usd(released)} released</span>
          <span className="c-sep">·</span>
          {usd(rest)} on {on}
        </>
      ) : (
        <>
          Nothing released yet<span className="c-sep">·</span>
          {usd(rest)} on {on}
        </>
      );
    foot =
      m.cycle === 'free'
        ? [`Paid on the ${m.dayOrdinal}, and sooner when the pool allows`, 'What is released is yours to move now, at no cost']
        : ['The pool frees what it can, when it can', `Your cash account is untouched: ${money(m.cashCents)} is still yours to move`];
    action =
      m.cycle === 'free' ? (
        <button type="button" className="c-btn c-btn-primary" onClick={onWithdraw}>
          Withdraw
        </button>
      ) : (
        <button type="button" className="c-btn" onClick={onHow}>
          How this works
        </button>
      );
  }
  return (
    <div className="c-mc-slot">
      <div className={cx('c-panel c-act c-mc-cyc', `c-${m.cycle}`)}>
        <div className="c-cmain">
          <div className="c-line" style={{ alignItems: 'center' }}>
            <div>
              <p className="c-label">{label}</p>
              <p className="c-fig c-fig-sec" style={{ marginTop: 6 }}>
                {usd(fig)}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p className="c-fig c-cyc-num" style={{ fontSize: 26, lineHeight: 1 }}>
                {num}
              </p>
              <p className="c-det" style={{ marginTop: 4 }}>
                {unit}
              </p>
            </div>
          </div>
          <div className="c-mc-track">{track}</div>
          <p className="c-det">{cap}</p>
        </div>
        <div className="c-cfoot">
          <div className="c-line" style={{ alignItems: 'center' }}>
            <div>
              <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>{foot[0]}</p>
              <p className="c-det" style={{ marginTop: 3 }}>
                {foot[1]}
              </p>
            </div>
            {action}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- The slab ------------------------------------------------------------------------------------

function Hist({ r, onStatement, onCard }: { r: HistRow; onStatement?: (r: HistRow) => void; onCard?: (r: HistRow) => void }) {
  const colour = r.future ? 'var(--ink-28)' : r.next ? 'var(--ink-50)' : 'var(--ink)';
  return (
    <div {...press(r.card && onCard ? () => onCard(r) : undefined)}>
      <div className="c-line" style={{ alignItems: 'baseline' }}>
        <div>
          <p className="c-t" style={r.future ? { color: 'var(--ink-50)' } : undefined}>
            {r.t} {r.next && <span className="c-po-next">Next</span>}
          </p>
          <p className="c-det">
            {r.det}
            {r.statement && (
              <>
                {' · '}
                <span className="c-po-link" {...press(onStatement ? () => onStatement(r) : undefined)}>
                  Statement
                </span>
              </>
            )}
          </p>
        </div>
        <span className="c-fig c-fig-row" style={{ color: colour }}>
          {r.cents === null ? '–' : usd(r.cents)}
        </span>
      </div>
    </div>
  );
}

/** What has been paid and what is next: Clear monthly, card daily. */
export function PayoutsCell({ m, onStatement, onCard, onStatements }: { m: PayoutsModel; onStatement?: (r: HistRow) => void; onCard?: (r: HistRow) => void; onStatements?: () => void }) {
  const [page, setPage] = useState(0);
  const groups = m.card.length > 0;
  const paged = !groups && m.clear.length > HIST_PAGE;
  const clear = paged ? m.clear.slice(page * HIST_PAGE, page * HIST_PAGE + HIST_PAGE) : m.clear;
  const pages = Math.ceil(m.clear.length / HIST_PAGE);
  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">Payouts</p>
          {paged ? (
            <span className="c-po-pager">
              <span className="c-det">
                {page * HIST_PAGE + 1}–{Math.min(m.clear.length, (page + 1) * HIST_PAGE)} of {m.clear.length}
              </span>
              <button type="button" className="c-po-arrow" disabled={page === 0} aria-label="Newer" onClick={() => setPage(page - 1)}>
                <IconPrev />
              </button>
              <button type="button" className="c-po-arrow" disabled={page >= pages - 1} aria-label="Older" onClick={() => setPage(page + 1)}>
                <IconChevronSm />
              </button>
            </span>
          ) : (
            <span className="c-det">{groups ? 'Clear monthly · card daily' : `Monthly, on the ${m.dayOrdinal}`}</span>
          )}
        </div>
      </div>
      <div className="c-cmain c-po-paid">
        {groups && (
          <div className="c-po-grp">
            <p className="c-label">Clear</p>
            <span className="c-det">On the {m.dayOrdinal}</span>
          </div>
        )}
        <div className="c-rows c-po-hist">
          {clear.length ? (
            clear.map((r, i) => <Hist key={r.id ?? `${r.t}${i}`} r={r} onStatement={onStatement} />)
          ) : (
            <div>
              <div className="c-line" style={{ alignItems: 'baseline' }}>
                <div>
                  <p className="c-t">No payouts yet</p>
                  <p className="c-det">The first lands on your next payout date.</p>
                </div>
                <span className="c-fig c-fig-row" style={{ color: 'var(--ink-28)' }}>
                  –
                </span>
              </div>
            </div>
          )}
        </div>
        {groups && (
          <>
            <div className="c-po-grp">
              <p className="c-label">Card</p>
              <span className="c-det">Next business day, from the processor</span>
            </div>
            <div className="c-rows c-po-hist">
              {m.card.map((r, i) => (
                <Hist key={`${r.t}${i}`} r={r} onCard={onCard} />
              ))}
            </div>
          </>
        )}
        {m.made && m.on && (
          <div className="c-po-made">
            <div className="c-mh">
              <p className="c-label">{m.on} so far</p>
            </div>
            <div className="c-po-eq">
              <div>
                <p className="c-det">Charges</p>
                <p className="c-f">{usd(m.made.chargesCents)}</p>
              </div>
              <div>
                <p className="c-det">Fees</p>
                <p className="c-f">−{usd(m.made.feesCents)}</p>
              </div>
              <div>
                <p className="c-det">Paid to you</p>
                <p className="c-f c-grand">{usd(m.made.paidCents)}</p>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="c-cfoot">
        <div className="c-line" style={{ alignItems: 'center', cursor: 'pointer' }} {...press(onStatements)}>
          <span className="c-det">Every payout traces to its charges</span>
          <span className="c-det">Statements ›</span>
        </div>
      </div>
    </div>
  );
}

/** One bar and three lines: cash account, released, and what releases on the day. */
export function WhereItSitsCell({ m, onBank, onDay }: { m: PayoutsModel; onBank?: () => void; onDay?: () => void }) {
  const parts: [string, number | null, string][] = [
    ['Cash account', m.cashCents, 'var(--ink)'],
    ['Released', m.releasedCents, 'var(--settled)'],
    [`Releases ${m.on ?? 'later'}`, m.scheduledCents, 'var(--underway)'],
  ];
  const total = parts.reduce((t, [, c]) => t + (c ?? 0), 0);
  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">Where it sits</p>
          <p className="c-fig c-fig-sec">{usd(total)}</p>
        </div>
      </div>
      <div className="c-cmain">
        <div className="c-bar" style={{ marginBottom: 'var(--s2)' }}>
          {total > 0 &&
            parts
              .filter(([, c]) => (c ?? 0) > 0)
              .map(([k, c, colour]) => <div key={k} style={{ width: `${Math.round(((c ?? 0) / total) * 1000) / 10}%`, background: colour }} />)}
        </div>
        <div className="c-po-leg">
          {parts.map(([k, c, colour]) => (
            <div key={k}>
              <span className="c-sw" style={{ '--c': colour } as CSSProperties} />
              <span>{k}</span>
              <span className="c-v">{money(c)}</span>
            </div>
          ))}
        </div>
        <p className="c-det c-po-held">Cash and released money can move today. The rest releases on the {m.dayOrdinal}.</p>
      </div>
      <div className="c-cfoot">
        <div className="c-foot2" style={{ '--fp': '14px' } as CSSProperties}>
          <div {...press(onBank)}>
            <p className="c-det">
              <span className="c-muted">Withdraws to</span> <span style={{ color: 'var(--ink)' }}>{m.bank ?? 'Not set'}</span>
            </p>
            <IconChevron />
          </div>
          <div {...press(onDay)}>
            <p className="c-det">
              <span className="c-muted">Paid on</span> <span style={{ color: 'var(--ink)' }}>The {m.dayOrdinal}</span>
            </p>
            <IconChevron />
          </div>
        </div>
      </div>
    </div>
  );
}

function Go({ t, det, onTap }: { t: string; det: string; onTap?: () => void }) {
  return (
    <div>
      <div className="c-kv" {...press(onTap)}>
        <span>
          <b>{t}</b>
          <span className="c-det">{det}</span>
        </span>
        <span className="c-v">
          <IconChevron />
        </span>
      </div>
    </div>
  );
}

export function CashAccountCell({ m, onWithdraw, onSpend, onReceive }: { m: PayoutsModel; onWithdraw: () => void; onSpend?: () => void; onReceive?: () => void }) {
  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">Cash account</p>
          <p className="c-fig c-fig-sec">{money(m.cashCents)}</p>
        </div>
      </div>
      <div className="c-cmain">
        <div className="c-rows c-po-cash">
          <Go t="Withdraw" det={`To ${m.bank ?? 'your bank'}, 1–3 days, no fee`} onTap={onWithdraw} />
          <Go t="Spend" det="At Clear Partners, with no wait" onTap={onSpend} />
          <Go t="Receive" det="Account and routing, for ACH or wire" onTap={onReceive} />
        </div>
      </div>
      <div className="c-cfoot">
        <div className="c-line" style={{ alignItems: 'center' }}>
          <span className="c-det">In your business’s name, held as USDC</span>
          <button type="button" className="c-btn" onClick={onWithdraw}>
            Withdraw
          </button>
        </div>
      </div>
    </div>
  );
}

/** What the last close left: in the drawer, to the bank (amber until it is), tips owed. */
export function CashTipsCell({ d, me, onMark }: { d: NonNullable<PayoutsModel['drawer']>; me: string; onMark?: () => Promise<void> }) {
  // A live shop marks it on the server (and the figure comes back from there); the preview here.
  const [marked, setMarked] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const deposited = d.deposited ?? marked;
  const row = (t: string, det: ReactNode, cents: number, pend?: boolean) => (
    <div>
      <div className="c-kv">
        <span>
          <b>{t}</b>
          <span className={cx('c-det', pend && 'c-po-pend')}>{det}</span>
        </span>
        <span className={cx('c-v c-po-fig', pend && 'c-po-pend')}>{usd(cents)}</span>
      </div>
    </div>
  );
  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">Cash and tips</p>
          <span className="c-det">{d.from}</span>
        </div>
      </div>
      <div className="c-cmain">
        <div className="c-rows c-po-cash">
          {row('In the drawer', 'Left for tomorrow', d.inDrawerCents)}
          {row('To the bank', deposited ?? 'Not deposited yet', d.toBankCents, !deposited)}
          {row('Tips owed', d.tipsWho, d.tipsCents)}
        </div>
      </div>
      <div className="c-cfoot">
        <div className="c-line" style={{ alignItems: 'center' }}>
          <span className="c-det">Cash never passes through Clear</span>
          <button
            type="button"
            className={cx('c-btn c-po-dep', deposited && 'c-done')}
            disabled={!!deposited}
            onClick={() =>
              onMark
                ? void onMark().catch((e: unknown) => setError(e instanceof Error ? e.message : 'That couldn’t be marked. Try again.'))
                : setMarked(`Deposited today by ${me}`)
            }
          >
            <IconCheck15 />
            <span>{deposited ? 'Deposited' : 'Mark deposited'}</span>
          </button>
        </div>
        {error && (
          <p className="c-det" role="alert" style={{ color: 'var(--absent)', marginTop: 6 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** A counter shift: where the line falls, and the way across it. */
export function PayoutsLocked({ onOwner }: { onOwner: () => void }) {
  return (
    <div className="c-slab c-one">
      <div className="c-cell">
        <div className="c-cmain">
          <div className="c-mc-locked">
            <span className="c-mc-lockg" style={{ color: 'var(--ink-28)' }}>
              <IconLock />
            </span>
            <p className="c-fig c-fig-sec" style={{ marginTop: 'var(--s1)' }}>
              Payouts need an owner
            </p>
            <p className="c-det" style={{ maxWidth: '38ch' }}>
              What the shop is owed, where it is held and where it can be sent are the owner’s. Raising charges and asking for refunds are
              not.
            </p>
            <button type="button" className="c-btn c-btn-primary" style={{ marginTop: 'var(--s3)' }} onClick={onOwner}>
              Owner sign in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Sheets --------------------------------------------------------------------------------------

/** Card processing, split: the same two lines the shop's own Stripe dashboard shows. */
export function BreakdownSheet({ r, onClose }: { r: HistRow; onClose: () => void }) {
  const c = r.card!;
  const fee = c.stripeCents + c.clearCents;
  const kv = (k: ReactNode, v: ReactNode, sub?: boolean) => (
    <div className={sub ? 'c-po-sub' : undefined}>
      <div className="c-kv">
        <span>{k}</span>
        <span className={cx('c-v', !sub && 'c-ink')}>{v}</span>
      </div>
    </div>
  );
  return (
    <Sheet
      className="c-po-bd"
      label="Card processing"
      onClose={onClose}
      head={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <span className="c-mtitle">Card processing</span>
          <span className="c-det">{r.t} deposit</span>
        </div>
      }
      foot={<p className="c-det">Your Stripe dashboard shows the same two lines.</p>}
    >
      <div className="c-rows">
        {kv('Card sales', usd(c.salesCents))}
        {kv('Card processing', `−${usd(fee)}`)}
        {kv('Stripe · 2.7% + 5¢', `−${usd(c.stripeCents)}`, true)}
        {kv('Clear · 30¢ a sale over $10', `−${usd(c.clearCents)}`, true)}
        {kv(<b>Deposited</b>, <b>{usd(c.salesCents - fee)}</b>)}
      </div>
    </Sheet>
  );
}

/**
 * Payouts › Receive: the shop's account and routing numbers for being paid by ACH or wire, from
 * Bridge. Read from Bridge each time; an owner opens them once the business is verified.
 */
export function ReceiveSheet({
  d,
  readError,
  onOpen,
  onEmail,
  onVerify,
  onClose,
}: {
  /** Null while it's being read. */
  d: ReceiveDetails | null;
  /** Why it couldn't be read. */
  readError?: string | null;
  /** Owners, when it isn't open yet. */
  onOpen?: () => Promise<void>;
  /** Sends them to the business's email; resolves to the address. */
  onEmail?: () => Promise<string>;
  /** To Settings › Advanced, when the business isn't verified yet. */
  onVerify?: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<'open' | 'email' | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (what: 'open' | 'email', fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const a = d?.account ?? null;
  const kv = (k: string, v: string) => (
    <div>
      <div className="c-kv">
        <span>{k}</span>
        <span className="c-v c-mono" style={{ color: 'var(--ink)' }}>
          {v}
        </span>
      </div>
    </div>
  );
  const alert = error && (
    <p className="c-det" role="alert" style={{ color: 'var(--absent)', margin: 'var(--s1) 0 0' }}>
      {error}
    </p>
  );

  let body: ReactNode;
  let foot: ReactNode;
  if (a) {
    body = (
      <>
        <p className="c-det" style={{ marginBottom: 'var(--s2)' }}>
          Send money here by ACH or wire and it lands in your Clear balance.
        </p>
        <div className="c-rows">
          {kv('Account name', a.beneficiary)}
          {a.bankName && kv('Bank', a.bankName)}
          {kv('Routing', a.routingNumber)}
          {kv('Account', a.accountNumber)}
          {kv('Type', 'Checking')}
        </div>
      </>
    );
    foot = (
      <>
        <div className="c-pair" style={{ marginBottom: 'var(--s2)' }}>
          <button
            type="button"
            className="c-btn"
            onClick={() => {
              void navigator.clipboard?.writeText(`${a.beneficiary}\n${a.bankName ? `${a.bankName}\n` : ''}Routing ${a.routingNumber}\nAccount ${a.accountNumber}\nChecking`);
              setCopied(true);
            }}
          >
            {copied ? 'Copied' : 'Copy all details'}
          </button>
          <button type="button" className="c-btn" disabled={!onEmail || !d?.email || busy !== null} onClick={() => onEmail && run('email', async () => setSentTo(await onEmail()))}>
            {busy === 'email' ? 'Sending…' : sentTo ? 'Sent' : 'Email them to me'}
          </button>
        </div>
        <p className="c-det">
          {sentTo
            ? `Sent to ${sentTo}.`
            : `Account and routing from Bridge, in your business’s name. Deposits arrive as USDC in your cash account, usually the same business day.${d?.email ? ` Email sends them to ${d.email}.` : ''}`}
        </p>
        {alert}
      </>
    );
  } else if (d === null) {
    body = readError ? (
      <p className="c-det" role="alert" style={{ color: 'var(--absent)' }}>
        {readError}
      </p>
    ) : (
      <p className="c-det">Reading the shop’s account…</p>
    );
  } else if (d.state === 'not_opened') {
    body = (
      <p className="c-det">
        Get an account and routing number in the business’s name, from Bridge, to be paid by ACH or wire. Money sent to it lands in your cash account, usually the same business day.
      </p>
    );
    foot = (
      <>
        {onOpen ? (
          <button type="button" className="c-btn c-btn-lg" disabled={busy !== null} onClick={() => run('open', onOpen)}>
            {busy === 'open' ? 'Opening…' : 'Get account and routing'}
          </button>
        ) : (
          <p className="c-det">Only an owner can open it.</p>
        )}
        {alert}
      </>
    );
  } else if (d.state === 'not_verified') {
    body = <p className="c-det">Bridge opens an account only for a verified business. Verify it in Settings › Advanced, then come back here.</p>;
    foot = onVerify ? (
      <button type="button" className="c-btn c-btn-lg" onClick={onVerify}>
        Verify the business
      </button>
    ) : undefined;
  } else {
    body = <p className="c-det">Receiving by ACH isn’t available yet.</p>;
  }

  return (
    <Sheet title="Cash account" onClose={onClose} foot={foot}>
      {body}
    </Sheet>
  );
}

export function PickRow({ on, t, det, right, onPick, disabled }: { on: boolean; t: string; det: string; right: ReactNode; onPick?: () => void; disabled?: boolean }) {
  return (
    <div {...press(disabled ? undefined : onPick)} style={disabled ? { opacity: 0.45 } : undefined} aria-disabled={disabled}>
      <div className="c-line" style={{ alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0 }}>
          <span className={cx('c-pick', on && 'c-on')} style={{ marginTop: 2 }}>
            {on && <IconPickTickSvg />}
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 'var(--t-sec)' }}>{t}</span>
            <span className="c-det" style={{ display: 'block', marginTop: 3 }}>
              {det}
            </span>
          </span>
        </span>
        {right}
      </div>
    </div>
  );
}

const IconPickTickSvg = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--settled)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export function WhereWithdrawalsGoSheet({ bank, onAdd, onClose }: { bank: string; onAdd?: () => void; onClose: () => void }) {
  const [on, setOn] = useState(0);
  return (
    <Sheet
      title="Where withdrawals go"
      onClose={onClose}
      foot={
        <>
          <div className="c-footnote" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
            <p>Only an owner can change where money leaves to. A manager can send a payout, but only to an account you have already set.</p>
          </div>
          <button type="button" className="c-btn c-btn-lg" style={{ marginTop: 'var(--s2)' }} onClick={onAdd} disabled={!onAdd}>
            Add a bank account
          </button>
        </>
      }
    >
      <div className="c-rows">
        <PickRow on={on === 0} t={bank} det="Business checking · verified" right={<span className="c-det" style={{ flexShrink: 0 }}>1–3 days · no fee</span>} onPick={() => setOn(0)} />
        <PickRow on={on === 1} t="Debit ••2208" det="Instant to your card" right={<span className="c-det" style={{ flexShrink: 0 }}>Minutes · 1.5%</span>} onPick={() => setOn(1)} />
      </div>
    </Sheet>
  );
}

/**
 * Where withdrawals go, on a live shop: the bank accounts linked with Plaid. An owner adds one (Plaid
 * Link: they sign in to the bank, so it's verified there and then) or removes one; a manager sees them.
 */
export function LiveWithdrawalsSheet({
  banks,
  onAdd,
  onRemove,
  busy,
  error,
  onClose,
}: {
  banks: BankAccount[] | null;
  onAdd?: () => void;
  onRemove?: (b: BankAccount) => void;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
}) {
  return (
    <Sheet
      title="Where withdrawals go"
      onClose={onClose}
      foot={
        <>
          <div className="c-footnote" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
            <p>Only an owner can change where money leaves to. You sign in to the bank with Plaid, which is how it’s verified: no numbers to type, no test deposits. It has to be in the business’s name.</p>
          </div>
          {error && (
            <p className="c-det" role="alert" style={{ color: 'var(--absent)', margin: 'var(--s1) 0 0' }}>
              {error}
            </p>
          )}
          <button type="button" className="c-btn c-btn-lg" style={{ marginTop: 'var(--s2)' }} onClick={onAdd} disabled={!onAdd || busy}>
            {busy ? 'Linking…' : 'Add a bank account'}
          </button>
        </>
      }
    >
      {banks === null ? (
        <p className="c-det">Reading the shop’s banks…</p>
      ) : banks.length === 0 ? (
        <p className="c-det">No bank yet. Add the business’s account to withdraw to it.</p>
      ) : (
        <div className="c-rows">
          {banks.map((b) => (
            <div key={b.id}>
              <div className="c-line" style={{ alignItems: 'center' }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 'var(--t-sec)' }}>
                    {b.bankName} ••{b.mask}
                  </span>
                  <span className="c-det" style={{ display: 'block', marginTop: 3 }}>
                    Business {b.subtype} · verified with Plaid
                  </span>
                </span>
                {onRemove && (
                  <button type="button" className="c-ci-link" aria-label={`Remove ${b.bankName} ••${b.mask}`} onClick={() => onRemove(b)}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

export function AddBankSheet({ onAdd, onClose }: { onAdd?: () => void; onClose: () => void }) {
  const [savings, setSavings] = useState(false);
  const field = (label: string, value: string, last?: boolean) => (
    <div style={last ? undefined : { marginBottom: 'var(--s2)' }}>
      <p className="c-label" style={{ marginBottom: 6 }}>
        {label}
      </p>
      <input className="c-field" style={{ width: '100%' }} defaultValue={value} aria-label={label} />
    </div>
  );
  return (
    <Sheet
      title="Add a bank account"
      onClose={onClose}
      foot={
        <>
          <div className="c-conseq">
            <div className="c-earn">
              <span>Verified by</span>
              <span>Two small deposits</span>
            </div>
            <div>
              <span>Usually takes</span>
              <span>1 to 2 business days</span>
            </div>
            <div>
              <span>Until then</span>
              <span>Withdrawals keep going to Chase</span>
            </div>
            <div className="c-limit">
              <span>Cost</span>
              <span>None</span>
            </div>
          </div>
          <button type="button" className="c-btn c-btn-primary c-btn-lg" style={{ marginTop: 'var(--s2)' }} disabled={!onAdd} onClick={onAdd}>
            Add account
          </button>
          <p className="c-det" style={{ marginTop: 'var(--s1)', textAlign: 'center' }}>
            It has to be in the business’s name. An account in a personal name is the one thing Bridge will reject.
          </p>
        </>
      }
    >
      {field('Account name', 'Mike’s Tire LLC')}
      {field('Routing number', '021000021')}
      {field('Account number', '••••••••7731')}
      <p className="c-label" style={{ marginBottom: 6 }}>
        Type
      </p>
      <div className="c-qc c-split" style={{ marginTop: 0 }}>
        <button type="button" className={cx('c-btn c-chip-q', !savings && 'c-on')} onClick={() => setSavings(false)}>
          Checking
        </button>
        <button type="button" className={cx('c-btn c-chip-q', savings && 'c-on')} onClick={() => setSavings(true)}>
          Savings
        </button>
      </div>
    </Sheet>
  );
}
