import type { ReactNode } from 'react';
import { Chip } from '@/brand/controls';
import { IconCart } from '@/brand/icons';
import { cx, initials } from '@/brand/ui';
import type { Layout } from '@/lib/useBreakpoint';
import {
  firstName,
  inWords,
  sees,
  usd,
  type ClosingUp,
  type ConfirmedCharge,
  type HomeModel,
  type Payout,
  type PersonTally,
  type SetupItem,
  type ShiftCell,
  type WaitingCharge,
  type WriterTip,
} from '@/home/model';

/**
 * Home, drawn from docs/merchant-reference/clear-merchant-home.html.
 *
 * The member Home's three blocks: the figure, the temporary slot, the slab. Today counts confirmed
 * charges only, with what is waiting stated beside it. Waiting is the action component and never
 * disappears; temporary actions (setup, the owner's tip) sit under it and go when they are done.
 * The slab is what was confirmed on the left and, on the right, where it goes for someone who sees
 * money, or the shift for someone who does not.
 *
 * Above 900px the slab is two columns; below, one, in the same order. Nothing is removed at any
 * width: on the phone the hero loses its buttons only because the + button carries them.
 */

export interface HomeActions {
  onNewCharge?: () => void;
  onBuildCart?: () => void;
  onOpenWaiting?: (w: WaitingCharge) => void;
  onResend?: (w: WaitingCharge) => void;
  onAllCharges?: () => void;
  onPayouts?: () => void;
  onStaff?: () => void;
  onSetup?: (s: SetupItem) => void;
  onBreak?: () => void;
  onEndShift?: () => void;
  onCloseDay?: () => void;
}

const lineP = (t: ReactNode, det?: ReactNode) => (
  <div>
    <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>{t}</p>
    {det && (
      <p className="c-det" style={{ marginTop: 3 }}>
        {det}
      </p>
    )}
  </div>
);

// ---- The figure ---------------------------------------------------------------------------------

function Hero({ m, phone, a }: { m: HomeModel; phone: boolean; a: HomeActions }) {
  const waitingCents = m.waiting.reduce((s, w) => s + w.amountCents, 0);
  const n = m.waiting.length;
  let det: ReactNode;
  if (m.stage === 'dayOne') det = 'No charges yet';
  else if (!n) det = `${m.confirmedCount} confirmed · nothing waiting`;
  else if (phone) det = `${m.confirmedCount} confirmed · ${usd(waitingCents)} waiting`;
  else
    det = (
      <>
        {m.confirmedCount} confirmed &middot;{' '}
        <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{usd(waitingCents)} waiting</strong> on {inWords(n)}{' '}
        {n === 1 ? 'customer' : 'customers'}
      </>
    );
  return (
    <div className="c-mc-hero">
      <div>
        <p className="c-label">Today</p>
        <p className="c-fig c-fig-hero" style={{ marginTop: 6 }}>
          {usd(m.confirmedCents)}
        </p>
        <p className="c-det" style={{ marginTop: 4 }}>
          {det}
        </p>
      </div>
      {!phone && (
        <span className="c-mc-heroacts">
          <button type="button" className="c-btn c-mc-cartbtn" onClick={a.onBuildCart}>
            <IconCart size={16} />
            <span>Build cart</span>
          </button>
          <button type="button" className="c-btn c-btn-primary" onClick={a.onNewCharge}>
            New charge
          </button>
        </span>
      )}
    </div>
  );
}

// ---- The slot -----------------------------------------------------------------------------------

function WaitingPanel({ waiting, a }: { waiting: WaitingCharge[]; a: HomeActions }) {
  const total = waiting.reduce((s, w) => s + w.amountCents, 0);
  if (!waiting.length) {
    return (
      <div className="c-mc-slot">
        <div className="c-panel c-act">
          <div className="c-chead">
            <div className="c-sechead">
              <p className="c-label">Waiting</p>
              <Chip tone="settled" dot>
                All clear
              </Chip>
            </div>
          </div>
          <div className="c-cmain">
            <div style={{ textAlign: 'center', padding: 'var(--s2) 0' }}>
              <p style={{ margin: 0, fontSize: 'var(--t-body)', fontWeight: 500 }}>Nobody is waiting</p>
              <p className="c-det" style={{ marginTop: 4 }}>
                Every charge today was approved at the counter
              </p>
            </div>
          </div>
          <div className="c-cfoot">
            <div className="c-line" style={{ alignItems: 'center' }}>
              <span className="c-det">A charge sits here until the customer approves it</span>
              <button type="button" className="c-btn" onClick={a.onAllCharges}>
                View all charges
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="c-mc-slot">
      <div className="c-panel c-act c-mc-wait">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Waiting</p>
            <Chip tone="underway">{waiting.length} waiting</Chip>
          </div>
        </div>
        <div className="c-cmain">
          <div className="c-rows">
            {waiting.map((w) => (
              <div key={w.id}>
                <div className="c-mc-g2" role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => a.onOpenWaiting?.(w)}>
                  <span className="c-mc-faces">
                    <span className="c-avatarbtn c-sm">{initials(w.name)}</span>
                  </span>
                  <span className="c-txt">
                    <span style={{ display: 'block', fontSize: 'var(--t-sec)' }}>
                      {w.name} {w.opened ? 'has seen it' : 'has not opened it'}
                    </span>
                    <span className="c-det" style={{ display: 'block', marginTop: 3 }}>
                      {usd(w.amountCents)} &middot; {w.opened ? `opened ${w.ago}` : `sent ${w.ago}${w.by ? ` by ${w.by}` : ''}`}
                    </span>
                  </span>
                  <span className="c-act">
                    {w.opened ? (
                      <span className="c-det">Nothing to do</span>
                    ) : (
                      <button
                        type="button"
                        className="c-btn c-btn-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          a.onResend?.(w);
                        }}
                      >
                        Resend
                      </button>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="c-cfoot">
          <div className="c-line" style={{ alignItems: 'center' }}>
            <span className="c-det">{usd(total)} waiting &middot; they can approve any time today</span>
            <button type="button" className="c-btn" onClick={a.onAllCharges}>
              View all charges
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Temporary actions: one panel of statements, each with a line and its own button. */
function TemporaryPanel({ rows }: { rows: { key: string; t: ReactNode; det: ReactNode; action: string; onClick?: () => void }[] }) {
  return (
    <div className="c-mc-slot">
      <div className="c-panel">
        <div className="c-cmain">
          <div className="c-rows">
            {rows.map((r) => (
              <div key={r.key}>
                <div className="c-line" style={{ alignItems: 'center' }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>{r.t}</p>
                    <p className="c-det" style={{ marginTop: 3 }}>
                      {r.det}
                    </p>
                  </div>
                  <button type="button" className="c-btn" onClick={r.onClick}>
                    {r.action}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** From half an hour before closing, for owners and managers: what is left, and the button. */
export function ClosingUpPanel({ c, onCloseDay }: { c: ClosingUp; onCloseDay?: () => void }) {
  return (
    <div className="c-panel c-dr-prompt">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">Closing up</p>
          <span className="c-det">Closes at {c.closesAt}</span>
        </div>
      </div>
      <div className="c-cmain">
        <div className="c-dr-pr">
          <div className="c-kv">
            <span>Drawer</span>
            <span className="c-v">{c.drawer}</span>
          </div>
          <div className="c-kv">
            <span>Still on</span>
            <span className="c-v">{c.stillOn ?? '—'}</span>
          </div>
          <div className="c-kv">
            <span>Waiting</span>
            <span className="c-v">{c.waiting ?? '—'}</span>
          </div>
        </div>
      </div>
      <div className="c-cfoot">
        <div className="c-line" style={{ alignItems: 'center' }}>
          <span className="c-det">Owners and managers only</span>
          <button type="button" className="c-btn c-btn-primary" onClick={onCloseDay}>
            Close the day
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- The slab -----------------------------------------------------------------------------------

function Cell({
  label,
  det,
  children,
  foot,
  className,
}: {
  label: string;
  det?: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('c-cell', className)}>
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">{label}</p>
          {typeof det === 'string' ? <span className="c-det">{det}</span> : det}
        </div>
      </div>
      <div className="c-cmain">{children}</div>
      {foot && <div className="c-cfoot">{foot}</div>}
    </div>
  );
}

/** A footer that is one link: "Every charge, with who raised it · All charges ›". */
const LinkFoot = ({ left, right, onClick }: { left: string; right: string; onClick?: () => void }) => (
  <div className="c-line" style={{ alignItems: 'center', cursor: 'pointer' }} role="link" tabIndex={0} onClick={onClick}>
    <span className="c-det">{left}</span>
    <span className="c-det">{right} &rsaquo;</span>
  </div>
);

function ConfirmedCell({ rows, total, a }: { rows: ConfirmedCharge[]; total: number; a: HomeActions }) {
  return (
    <Cell
      label="Confirmed today"
      det={`${rows.length} · ${usd(total)}`}
      foot={<LinkFoot left="Every charge, with who raised it" right="All charges" onClick={a.onAllCharges} />}
    >
      <div className="c-rows">
        {rows.map((c) => (
          <div key={c.id}>
            <div className="c-line" style={{ alignItems: 'baseline' }}>
              {lineP(c.name, `${c.time} · ${c.by}`)}
              <span className="c-fig c-fig-row">{usd(c.amountCents)}</span>
            </div>
          </div>
        ))}
      </div>
    </Cell>
  );
}

function PayoutCell({ p, a }: { p: Payout; a: HomeActions }) {
  const pct = p.totalCents ? Math.round((p.availableCents / p.totalCents) * 100) : 0;
  return (
    <Cell
      label="Next payout"
      det="Owner"
      foot={
        p.first ? (
          <LinkFoot left={`Paid on the ${p.dayOrdinal}`} right="Payouts" onClick={a.onPayouts} />
        ) : (
          <div className="c-line" style={{ alignItems: 'center' }}>
            <span className="c-det">Paid on the {p.dayOrdinal}, sooner when the pool allows</span>
            <button type="button" className="c-btn" onClick={a.onPayouts}>
              Payouts
            </button>
          </div>
        )
      }
    >
      <div className="c-line" style={{ alignItems: 'baseline' }}>
        <span className="c-fig c-fig-sec">{usd(p.totalCents)}</span>
        <span className="c-det">Lands {p.landsOn}</span>
      </div>
      <div className="c-bar" style={{ margin: 'var(--s2) 0 var(--s1)' }} role="img" aria-label={`${usd(p.availableCents)} available now of ${usd(p.totalCents)}`}>
        {pct > 0 && <div style={{ width: `${pct}%`, background: 'var(--settled)' }} />}
        <div style={{ width: `${100 - pct}%`, background: 'var(--ink-13)' }} />
      </div>
      <p className="c-keyline">
        <span className="c-t-sav">Available now</span> <strong>{usd(p.availableCents)}</strong>
        <span className="c-sep">&middot;</span>Settling <strong>{usd(p.settlingCents)}</strong>
      </p>
      {p.first && (
        <p className="c-det" style={{ marginTop: 'var(--s2)' }}>
          Your first payout. Everything confirmed before then lands together, and you can withdraw early once the pool
          holds enough &mdash; we will tell you when.
        </p>
      )}
    </Cell>
  );
}

function ByPersonCell({ people, a }: { people: PersonTally[]; a: HomeActions }) {
  return (
    <Cell
      label="Who raised what"
      det="Today"
      foot={<LinkFoot left="Counts come from the shift PIN" right="Staff" onClick={a.onStaff} />}
    >
      <div className="c-rows">
        {people.map((p) => {
          const parts = [p.confirmed && `${p.confirmed} confirmed`, p.waiting && `${p.waiting} waiting`].filter(Boolean);
          return (
            <div key={p.name}>
              <div className="c-line" style={{ alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                  <span className="c-avatarbtn c-sm" style={{ cursor: 'default' }}>
                    {initials(p.name)}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 'var(--t-sec)' }}>{p.name}</span>
                    <span className="c-det" style={{ display: 'block', marginTop: 2 }}>
                      {parts.length ? parts.join(' · ') : '—'}
                    </span>
                  </span>
                </span>
                <span className="c-fig c-fig-row">{p.amountCents ? usd(p.amountCents) : '—'}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Cell>
  );
}

function TipCell({ tip }: { tip: WriterTip }) {
  return (
    <Cell
      className="c-mc-tip"
      label="Worth knowing"
      det="Only you see this"
      foot={<p className="c-det">Goes when every writer on the counter has raised one.</p>}
    >
      <p className="c-keyline">
        {tip.fact}. <strong>Worth a word with {tip.other}</strong> &mdash; the shops that do well are the ones where
        every writer offers it.
      </p>
    </Cell>
  );
}

const HOW = [
  ['Type the amount', 'From the ticket. Nothing else to enter.'],
  ['Turn the screen', 'They scan it with their phone camera.'],
  ['They approve', 'On their phone — here, or later.'],
  ['You are paid', 'On the 14th, or sooner if you withdraw.'],
];

function HowItGoesCell() {
  return (
    <Cell
      label="How it goes"
      det="Every charge"
      foot={
        <p className="c-det">
          <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>Offer it to anyone whose ticket is over $300</strong>{' '}
          &mdash; all of them, not only the people who look like they need it. That is fairer, and it is where the volume
          is.
        </p>
      }
    >
      <div className="c-rows">
        {HOW.map(([t, det], i) => (
          <div key={t}>
            <div style={{ display: 'flex', gap: 12 }}>
              <span className="c-ord">{i + 1}</span>
              {lineP(t, det)}
            </div>
          </div>
        ))}
      </div>
    </Cell>
  );
}

/**
 * The counter's right-hand cell: a time clock rather than a summary. Who is on, for how long, what
 * the shift produced, the drawer it works from, and the one row that is a job.
 */
export function ShiftCellView({ s, a, solo }: { s: ShiftCell; a: HomeActions; solo?: boolean }) {
  const c = s.clock;
  const paused = !!c?.onBreak;
  const hours = c ? Array.from({ length: c.hours }, (_, i) => i) : [];
  return (
    <div className={cx('c-cell c-mc-shiftcell', paused && 'c-paused')} style={solo ? { background: 'transparent' } : undefined}>
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">Your shift</p>
          {paused ? (
            <Chip tone="underway" dot>
              On break &middot; {c!.onBreak!.for}
            </Chip>
          ) : (
            <Chip tone="settled" live>
              On shift
            </Chip>
          )}
        </div>
      </div>
      <div className="c-cmain">
        {c && (
          <div>
            <div className="c-mc-clockhead">
              <p className="c-mc-clock">{c.onFor}</p>
              <p className="c-mc-remain">
                {c.left}
                <span className="c-of">left</span>
              </p>
              <p className="c-det">Since {c.since}</p>
              <p className="c-det">{paused ? `Break from ${c.onBreak!.from}` : `Until ${c.until}, no break yet`}</p>
            </div>
            <div className="c-mc-hours" role="img" aria-label={`${c.onFor} of a ${c.hours} hour shift`}>
              {hours.map((i) =>
                i < Math.floor(c.done) ? (
                  <span key={i} className="c-done" />
                ) : i === Math.floor(c.done) && c.done % 1 > 0 ? (
                  <span key={i} className="c-now" style={{ ['--p' as string]: `${Math.round((c.done % 1) * 100)}%` }} />
                ) : (
                  <span key={i} />
                ),
              )}
            </div>
          </div>
        )}
        <div className="c-rows c-mc-shiftrows">
          <div>
            <div className="c-line">
              {lineP('You raised', `${s.raised} of the shop’s ${s.shopRaised} today`)}
              <span className="c-fig c-fig-row">{s.raised}</span>
            </div>
          </div>
          {s.drawer && (
            <div>
              <div className="c-line">
                {lineP('Drawer', `Started with ${usd(s.drawer.startCents)} · ${usd(s.drawer.cashInCents)} cash in`)}
                <span className="c-fig c-fig-row">{usd(s.drawer.startCents + s.drawer.cashInCents)}</span>
              </div>
            </div>
          )}
          {s.job && (
            <div>
              <div className="c-line">
                {lineP(
                  <span className="c-mc-dot">Waiting on {s.job.name}</span>,
                  `Sent ${s.job.ago}, ${s.job.opened ? 'opened' : 'not opened'}`,
                )}
                <span className="c-fig c-fig-row c-mc-due">{usd(s.job.amountCents)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="c-cfoot">
        <div className="c-pair">
          {c && (
            <button type="button" className={cx('c-btn', paused && 'c-btn-primary')} onClick={a.onBreak}>
              {paused ? 'End break' : 'Start break'}
            </button>
          )}
          <button type="button" className="c-btn" onClick={a.onEndShift}>
            End shift
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Home ---------------------------------------------------------------------------------------

export function HomeView({ m, layout, a = {} }: { m: HomeModel; layout: Layout; a?: HomeActions }) {
  const phone = layout === 'phone';
  const money = sees(m.role);

  const temporary: Parameters<typeof TemporaryPanel>[0]['rows'] = [];
  if (m.setup?.length) temporary.push(...m.setup.map((s) => ({ ...s, onClick: () => a.onSetup?.(s) })));
  if (money && m.tip)
    temporary.push({
      key: 'tip',
      t: m.tip.fact,
      det: `Worth a word with ${m.tip.other} — the shops that do well are the ones where every writer offers it`,
      action: 'See by person',
      onClick: a.onStaff,
    });

  const left =
    m.stage === 'dayOne' ? <HowItGoesCell key="how" /> : <ConfirmedCell key="confirmed" rows={m.confirmed} total={m.confirmedCents} a={a} />;

  let right: ReactNode[] = [];
  if (money) {
    if (m.payout) right.push(<PayoutCell key="payout" p={m.payout} a={a} />);
    if (m.stage === 'running' && m.byPerson) right.push(<ByPersonCell key="people" people={m.byPerson} a={a} />);
    if (m.stage === 'early' && m.tip) right.push(<TipCell key="tip" tip={m.tip} />);
  } else if (m.shift) {
    right = [<ShiftCellView key="shift" s={m.shift} a={a} />];
  }

  // Two columns hold the right side in a column of its own when it has more than one cell; one
  // column lays every cell in order, as the portrait and phone frames do.
  const twoColumn = layout === 'two-column';
  return (
    <>
      <Hero m={m} phone={phone} a={a} />
      <WaitingPanel waiting={m.waiting} a={a} />
      {money && m.closing && (
        <div className="c-mc-slot">
          <ClosingUpPanel c={m.closing} onCloseDay={a.onCloseDay} />
        </div>
      )}
      {temporary.length > 0 && <TemporaryPanel rows={temporary} />}
      {twoColumn && right.length ? (
        <div className="c-slab">
          {left}
          {right.length > 1 ? <div className="c-col">{right}</div> : right}
        </div>
      ) : (
        <div className={cx('c-slab', 'c-one')}>
          {left}
          {right}
        </div>
      )}
    </>
  );
}

export { firstName };
