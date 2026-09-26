import { useState, type ReactNode } from 'react';
import { IconBackChevron } from '@/brand/chargeIcons';
import { IconChevron, IconClose, IconLock } from '@/brand/icons';
import { Sheet } from '@/brand/ui';
import { usd } from '@/home/model';
import { roleLabel } from '@/shell/chrome';
import type { OverviewModel } from '@/overview/model';
import { money, type Statement } from '@/overview/statement';

/**
 * Overview's blocks — docs/merchant-reference/clear-merchant-overview.html. Every cell ends in a
 * link to the page that does the work; nothing here is a second way to change something.
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

const CAN = { counter: 'Can charge', manager: 'Can approve', owner: 'Full access' } as const;

export function MonthHero({ m, onStatements }: { m: OverviewModel; onStatements: () => void }) {
  return (
    <div className="c-mc-hero">
      <div>
        <p className="c-label">This month</p>
        <p className="c-fig c-fig-hero" style={{ marginTop: 6 }}>
          {usd(m.monthCents)}
        </p>
        <p className="c-det" style={{ marginTop: 4 }}>
          {m.count ? `${m.count} charges · ${usd(m.avgCents)} average` : 'No charges yet this month'}
        </p>
      </div>
      <button type="button" className="c-btn" onClick={onStatements}>
        Statements
      </button>
    </div>
  );
}

/** The month itself, in the cycle card's shape: the figure, the count, the track, the comparison. */
export function MonthCard({ m, onExport }: { m: OverviewModel; onExport?: () => void }) {
  return (
    <div className="c-mc-slot">
      <div className="c-panel c-act">
        <div className="c-cmain">
          <div className="c-line" style={{ alignItems: 'center' }}>
            <div>
              <p className="c-label">{m.month}</p>
              <p className="c-fig c-fig-sec" style={{ marginTop: 6 }}>
                {usd(m.monthCents)}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p className="c-fig c-cyc-num" style={{ fontSize: 26, lineHeight: 1 }}>
                {m.count}
              </p>
              <p className="c-det" style={{ marginTop: 4 }}>
                sales
              </p>
            </div>
          </div>
          <div className="c-mc-track">
            <div style={{ width: `${Math.round((m.day / m.daysInMonth) * 100)}%` }} />
          </div>
          <p className="c-det">
            {m.day} of {m.daysInMonth} days
            {m.vs && (
              <>
                <span className="c-sep">·</span>
                <span className={m.vs.cents >= 0 ? 'c-t-sav' : 'c-neg'}>
                  {m.vs.cents >= 0 ? 'up' : 'down'} {usd(Math.abs(m.vs.cents))} vs {m.vs.prev}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="c-cfoot">
          <div className="c-line" style={{ alignItems: 'center' }}>
            <div>
              <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>{usd(m.avgCents)} average charge</p>
              <p className="c-det" style={{ marginTop: 3 }}>
                {m.note}
              </p>
            </div>
            <button type="button" className="c-btn" onClick={onExport} disabled={!onExport}>
              Export
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TipSlot({ tip, onPeople }: { tip: NonNullable<OverviewModel['tip']>; onPeople: () => void }) {
  return (
    <div className="c-mc-slot">
      <div className="c-panel">
        <div className="c-cmain">
          <div className="c-rows">
            <div>
              <div className="c-line" style={{ alignItems: 'center' }}>
                <div>
                  <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>{tip.fact}</p>
                  <p className="c-det" style={{ marginTop: 3 }}>
                    {tip.det}
                  </p>
                </div>
                <button type="button" className="c-btn" onClick={onPeople}>
                  See by person
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Cell({ label, right, children, foot, full }: { label: string; right: ReactNode; children: ReactNode; foot: ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'c-cell c-full' : 'c-cell'}>
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">{label}</p>
          {right}
        </div>
      </div>
      <div className="c-cmain">{children}</div>
      <div className="c-cfoot">{foot}</div>
    </div>
  );
}

const Det = ({ children }: { children: ReactNode }) => <span className="c-det">{children}</span>;
const Fig = ({ children }: { children: ReactNode }) => <p className="c-fig c-fig-sec">{children}</p>;

/** A footer that is a link: what the cell says, and where to go for more. */
function LinkFoot({ det, to, onGo }: { det: string; to: string; onGo?: () => void }) {
  return (
    <div className="c-line" style={{ alignItems: 'center', cursor: 'pointer' }} {...press(onGo)}>
      <span className="c-det">{det}</span>
      <span className="c-det">{to} ›</span>
    </div>
  );
}

function Line2({ t, det, fig }: { t: string; det: ReactNode; fig: string }) {
  return (
    <div>
      <div className="c-line" style={{ alignItems: 'baseline' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>{t}</p>
          <p className="c-det" style={{ marginTop: 3 }}>
            {det}
          </p>
        </div>
        <span className="c-fig c-fig-row">{fig}</span>
      </div>
    </div>
  );
}

function Kv({ k, v, ink, style }: { k: ReactNode; v: ReactNode; ink?: boolean; style?: React.CSSProperties }) {
  return (
    <div>
      <div className="c-kv">
        <span>{k}</span>
        <span className={ink ? 'c-v c-ink' : 'c-v'} style={style}>
          {v}
        </span>
      </div>
    </div>
  );
}

export function RecentCell({ m, onAll }: { m: OverviewModel; onAll: () => void }) {
  return (
    <Cell label="Recent charges" right={<Det>Last two days</Det>} foot={<LinkFoot det="Every charge names who raised it" to="All charges" onGo={onAll} />}>
      <div className="c-rows">
        {m.recent.length ? (
          m.recent.map((r) => (
            <Line2
              key={r.id}
              t={r.name}
              fig={usd(r.cents)}
              det={
                <>
                  {r.when} · {r.by}
                  {r.state && (
                    <>
                      {' · '}
                      <span className={r.state === 'waiting' ? 'c-t-inc' : 'c-neg'}>{r.state}</span>
                    </>
                  )}
                </>
              }
            />
          ))
        ) : (
          <Line2 t="Nothing in the last two days" det="—" fig="—" />
        )}
      </div>
    </Cell>
  );
}

export function OwedCell({ o, onPayouts }: { o: NonNullable<OverviewModel['owed']>; onPayouts: () => void }) {
  return (
    <Cell
      label="Owed to you"
      right={<Fig>{usd(o.cents)}</Fig>}
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <span className="c-det">{o.cashCents === null ? 'Cash account unknown' : `Plus ${usd(o.cashCents)} already yours`}</span>
          <button type="button" className="c-btn" onClick={onPayouts}>
            Payouts
          </button>
        </div>
      }
    >
      <div className="c-line">
        <span className="c-det">Next payout</span>
        <span className="c-det">{o.on ?? 'Net-30'}</span>
      </div>
      <div className="c-line" style={{ borderTop: '1px solid var(--ink-13)', marginTop: 'var(--s2)', paddingTop: 'var(--s2)' }}>
        <span className="c-sub">Free to move today</span>
        <span className="c-fig c-fig-row">{o.freeCents === null ? '—' : usd(o.freeCents)}</span>
      </div>
    </Cell>
  );
}

export function FeesCell({ m }: { m: OverviewModel }) {
  return (
    <Cell label="Fees this month" right={<Fig>{usd(m.fees.reduce((t, f) => t + f.cents, 0))}</Fig>} foot={<p className="c-det">Taken at each sale. No monthly fee, no rental, no minimum.</p>}>
      <div className="c-rows">
        {m.fees.map((f) => (
          <Line2 key={f.t} t={f.t} det={f.det} fig={usd(f.cents)} />
        ))}
      </div>
    </Cell>
  );
}

export function MonthsCell({ m }: { m: OverviewModel }) {
  const since = m.months[0]?.t.split(' ')[0];
  return (
    <Cell
      label="By month"
      right={<Det>{since ? `Since ${new Date(`${since} 1, 2000`).toLocaleDateString('en-US', { month: 'long' })}` : '—'}</Det>}
      foot={<p className="c-det">{m.months.length <= 2 ? `${m.months.length === 1 ? 'One month' : 'Two months'} is the whole history so far. A chart would be inventing precision.` : 'Every month since you joined.'}</p>}
    >
      <div className="c-rows">
        {m.months.map((x) => (
          <Line2 key={x.t} t={x.t} det={x.det} fig={usd(x.cents)} />
        ))}
      </div>
    </Cell>
  );
}

export function TermsCell({ m }: { m: OverviewModel }) {
  return (
    <Cell
      label="Your terms"
      right={<Det>{m.terms.founding ? 'Founding' : 'Standard'}</Det>}
      foot={<p className="c-det">The approval cap is the ceiling on what you can let a manager clear. It is set here and spent in Staff.</p>}
    >
      <div className="c-rows">
        <Kv k="Rate" v={m.terms.rate} />
        <Kv k="Payout" v={m.terms.payout} />
        <Kv k="Approval cap" v={m.terms.cap} />
        <Kv k="Member since" v={m.terms.since} />
      </div>
    </Cell>
  );
}

export function PeopleCell({ m, full, onStaff }: { m: OverviewModel; full: boolean; onStaff: () => void }) {
  return (
    <Cell
      full={full}
      label="Who can use the tablet"
      right={<Det>{`${m.people.length} ${m.people.length === 1 ? 'person' : 'people'}`}</Det>}
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <span className="c-det">A writer raises charges and nothing else — not withdraw, not change terms, not see bank details</span>
          <button type="button" className="c-btn" onClick={onStaff}>
            Staff
          </button>
        </div>
      }
    >
      <div className="c-rows">
        {m.people.map((p) => (
          <div key={p.name}>
            <div className="c-line" style={{ alignItems: 'center' }}>
              <div>
                <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>{p.name}</p>
                <p className="c-det" style={{ marginTop: 3 }}>
                  {roleLabel(p.role)}
                </p>
              </div>
              <span className="c-det">{CAN[p.role]}</span>
            </div>
          </div>
        ))}
      </div>
    </Cell>
  );
}

// ---- The second slab -------------------------------------------------------------------------------

const COLOURS = ['var(--ink)', 'var(--land)', '#A3AE95'];

export function PaidByCell({ more, onCharges }: { more: NonNullable<OverviewModel['more']>; onCharges: () => void }) {
  const rows: [string, [number, number]][] = [
    ['Clear', more.paid.clear],
    ['Card', more.paid.card],
    ['Cash', more.paid.cash],
  ];
  return (
    <Cell label="How it was paid" right={<Det>This month</Det>} foot={<LinkFoot det={more.paid.note} to="Charges" onGo={onCharges} />}>
      <div className="c-ov-bar">
        {rows.map(([k, [, c]], i) => (
          <i key={k} style={{ flexGrow: c / 100, background: COLOURS[i] }} />
        ))}
      </div>
      <div className="c-rows">
        {rows.map(([k, [n, c]], i) => (
          <div key={k}>
            <div className="c-kv">
              <span className="c-ov-m">
                <span className="c-sw" style={{ background: COLOURS[i] }} />
                {k}
                <span className="c-det">{n}</span>
              </span>
              <span className="c-v c-ink">{usd(c)}</span>
            </div>
          </div>
        ))}
      </div>
    </Cell>
  );
}

export function ItemsCell({ more, onInventory }: { more: NonNullable<OverviewModel['more']>; onInventory: () => void }) {
  return (
    <Cell label="Top items" right={<Det>{more.since ?? 'This month'}</Det>} foot={<LinkFoot det="From items picked at the counter" to="Inventory" onGo={onInventory} />}>
      <div className="c-rows">
        {more.items.map(([k, n, c]) => (
          <Kv key={k} k={k} v={`${n} · ${usd(c)}`} ink />
        ))}
      </div>
    </Cell>
  );
}

export function ExtrasCell({ more, onTax }: { more: NonNullable<OverviewModel['more']>; onTax: () => void }) {
  return (
    <Cell label="Discounts, tips and tax" right={<Det>This month</Det>} foot={<LinkFoot det={more.taxNote ?? 'Worked out per line at each sale'} to="Tax" onGo={onTax} />}>
      <div className="c-rows">
        <Kv k="Discounts given" v={more.discounts} ink />
        <Kv k="Tips" v={more.tips} ink />
        <Kv k="Sales tax collected" v={usd(more.taxCents)} ink />
        <Kv k="Refunds" v="—" ink />
      </div>
    </Cell>
  );
}

export function EodCell({ more, onAll }: { more: NonNullable<OverviewModel['more']>; onAll: () => void }) {
  return (
    <Cell label="End-of-day reports" right={<Det>{more.since ?? 'This month'}</Det>} foot={<LinkFoot det="A close locks the day’s figures" to="All reports" onGo={onAll} />}>
      <div className="c-rows c-ov-eod">
        {more.eod.map((e) => (
          <div key={e.date}>
            <div className="c-kv">
              <span>
                {e.date}
                <span className="c-det">{e.det}</span>
              </span>
              <span className="c-v">
                <b>{usd(e.cents)}</b>
                <span className="c-ov-short">{e.state}</span>
              </span>
            </div>
          </div>
        ))}
      </div>
      {more.firstNote ? <p className="c-det c-ov-first">{more.firstNote}</p> : !more.eod.length ? <p className="c-det c-ov-first">No day closed yet this month. Each close adds a row.</p> : null}
    </Cell>
  );
}

/** A counter shift: the same boundary as Payouts. */
export function OverviewLocked({ name, onOwner }: { name: string; onOwner: () => void }) {
  return (
    <div className="c-slab c-one">
      <div className="c-cell">
        <div className="c-cmain">
          <div className="c-mc-locked">
            <span style={{ color: 'var(--ink-28)' }}>
              <IconLock />
            </span>
            <p className="c-fig c-fig-sec" style={{ marginTop: 'var(--s1)' }}>
              The month is the owner’s
            </p>
            <p className="c-det" style={{ maxWidth: '40ch' }}>
              Totals, fees and terms are not a writer’s business. Everything {name} needs to do their job is on Home and Charges.
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

/**
 * The months, newest first. On a live shop (`onOpen`), a month opens its statement, and saving or
 * sending happens there; the preview keeps the reference's buttons under the list.
 */
export function StatementsSheet({ months, onOpen, onClose }: { months: { t: string; det: string; cents: number }[]; onOpen?: (index: number) => void; onClose: () => void }) {
  return (
    <Sheet
      title="Statements"
      onClose={onClose}
      foot={
        <>
          {onOpen ? (
            <p className="c-det" style={{ marginBottom: 'var(--s1)' }}>
              Open a month to save it as a PDF.
            </p>
          ) : (
            <div className="c-pair" style={{ marginBottom: 'var(--s2)' }}>
              <button type="button" className="c-btn">
                Download PDF
              </button>
              <button type="button" className="c-btn">
                Send to my accountant
              </button>
            </div>
          )}
          <p className="c-det">Each statement lists every charge, every refund and the fee on each one. It reconciles to the payout that followed it.</p>
        </>
      }
    >
      <div className="c-rows">
        {months.map((m, i) => (
          <div key={m.t}>
            <div className="c-line" style={{ alignItems: 'center', cursor: onOpen ? 'pointer' : undefined }} {...press(onOpen ? () => onOpen(i) : undefined)} aria-label={onOpen ? `${m.t} statement` : undefined}>
              <div>
                <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>{m.t}</p>
                <p className="c-det" style={{ marginTop: 3 }}>
                  {m.det}
                </p>
              </div>
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
                <span className="c-fig c-fig-row">{usd(m.cents)}</span>
                <IconChevron />
              </span>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/** One month's statement, as it prints: Save as PDF is the print dialog's own choice, or it's emailed. */
export function MonthStatementSheet({
  s,
  error,
  onPdf,
  onSend,
  lastEmail = '',
  onBack,
  onClose,
}: {
  /** Null while it loads. */
  s: Statement | null;
  error?: string | null;
  onPdf: () => void;
  /** Email it; resolves with where it went. Absent: sending isn't offered. */
  onSend?: (email: string) => Promise<string>;
  /** The address it went to last time, filled in. */
  lastEmail?: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [email, setEmail] = useState(lastEmail);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; t: string } | null>(null);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const send = async () => {
    if (!onSend) return;
    setBusy(true);
    setNote(null);
    try {
      const to = await onSend(email.trim());
      setNote({ ok: true, t: `Sent to ${to}` });
      setSending(false);
    } catch (e) {
      setNote({ ok: false, t: e instanceof Error ? e.message : 'That didn’t send. Try again.' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      label={s ? `${s.month} statement` : 'Statement'}
      onClose={onClose}
      head={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <span className="c-mc-back" {...press(onBack)}>
            <IconBackChevron />
            <span className="c-mtitle">{s ? s.month : 'Statement'}</span>
          </span>
          <button type="button" className="c-mclose" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>
      }
      foot={
        <>
          {sending ? (
            <div style={{ marginBottom: 'var(--s2)' }}>
              <p className="c-label" style={{ margin: '0 0 6px' }}>
                Your accountant’s email
              </p>
              <input
                className="c-field"
                type="email"
                inputMode="email"
                autoFocus
                aria-label="Your accountant’s email"
                placeholder="books@youraccountant.com"
                value={email}
                style={{ width: '100%', height: 44, padding: '0 12px' }}
                onChange={(e) => setEmail(e.target.value)}
              />
              <div className="c-pair" style={{ marginTop: 'var(--s1)' }}>
                <button type="button" className="c-btn" onClick={() => setSending(false)}>
                  Cancel
                </button>
                <button type="button" className="c-btn c-btn-primary" disabled={!valid || busy || !s} onClick={() => void send()}>
                  {busy ? 'Sending…' : 'Send the statement'}
                </button>
              </div>
            </div>
          ) : (
            <div className="c-pair" style={{ marginBottom: 'var(--s2)' }}>
              <button type="button" className="c-btn c-btn-primary" disabled={!s} onClick={onPdf}>
                Save as PDF
              </button>
              <button type="button" className="c-btn" disabled={!onSend || !s} onClick={() => (setNote(null), setSending(true))}>
                Send to my accountant
              </button>
            </div>
          )}
          {note && (
            <p className="c-det" role={note.ok ? 'status' : 'alert'} style={{ margin: '0 0 var(--s1)', color: note.ok ? undefined : 'var(--absent)' }}>
              {note.t}
            </p>
          )}
          <p className="c-det">Save as PDF opens the print dialog, where it is one of the choices. Sending emails the statement as text, the same figures.</p>
        </>
      }
    >
      {error ? (
        <p className="c-det" role="alert" style={{ color: 'var(--absent)' }}>
          {error}
        </p>
      ) : !s ? (
        <p className="c-det">Reading the month…</p>
      ) : (
        <>
          <p className="c-det" style={{ marginTop: 0 }}>
            {s.period}
            {s.inProgress ? ', in progress' : ''}
          </p>
          {s.sections.map((sec) => (
            <div key={sec.title}>
              <p className="c-label" style={{ margin: 'var(--s3) 0 var(--s1)' }}>
                {sec.title}
              </p>
              <div className="c-rows">
                {sec.rows.map(([k, v]) => (
                  <div key={k}>
                    <div className="c-line">
                      <span style={{ fontSize: 'var(--t-sec)' }}>{k}</span>
                      <span className="c-fig c-fig-row">{typeof v === 'number' ? money(v) : v}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </Sheet>
  );
}

export function TermsSheet({ m, onClose }: { m: OverviewModel; onClose: () => void }) {
  return (
    <Sheet
      title="Your terms"
      onClose={onClose}
      foot={
        <>
          <div className="c-footnote" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
            <p>Your rate does not change with volume, and we will not renegotiate it downward for somebody else upward. Changing terms takes a conversation, not a form.</p>
          </div>
          <button type="button" className="c-btn c-btn-lg" style={{ marginTop: 'var(--s2)' }}>
            Talk to someone
          </button>
        </>
      }
    >
      <div className="c-rows">
        <Kv k="Rate" v={m.terms.rate.replace(' now · ', ' paid now, ')} />
        <Kv k="Taken" v="At the charge, not monthly" />
        <Kv k="Payout" v={m.terms.payout} />
        <Kv k="Monthly fee" v="None" style={{ color: 'var(--ink)' }} />
        <Kv k="Terminal rental" v="None" style={{ color: 'var(--ink)' }} />
        <Kv k="Minimum volume" v="None" style={{ color: 'var(--ink)' }} />
        <Kv k="Approval cap" v={m.terms.cap} />
      </div>
    </Sheet>
  );
}
