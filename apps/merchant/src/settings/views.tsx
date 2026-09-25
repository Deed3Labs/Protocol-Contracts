import { useState, type CSSProperties, type ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { IconBackChevron, IconBank, IconLock14, IconMonitor, IconTabletSm } from '@/brand/chargeIcons';
import { IconChevron } from '@/brand/icons';
import { cx, initials, Sheet, clickOnKey } from '@/brand/ui';

/**
 * Settings' pieces — docs/merchant-reference/clear-merchant-settings.html. The member app's
 * anatomy: a rail and a pane on a landscape tablet, an index and pushed pages everywhere
 * narrower, and sheets only for actions. Every pane is cells: header, main, footer.
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

// ---- The frame -----------------------------------------------------------------------------------

export function Who({ name, sub, person }: { name: string; sub: string; person?: boolean }) {
  return (
    <div className="c-who">
      <div className="c-avatar">{person ? initials(name) : initials(name.replace(/’s\b/, ''))}</div>
      <div>
        <p className="c-fig c-fig-sec">{name}</p>
        <p className="c-sub">{sub}</p>
      </div>
    </div>
  );
}

export interface RailItem {
  key: string;
  label: string;
}

export function Rail({ items, help, on, onPick }: { items: RailItem[]; help?: RailItem; on: string; onPick: (k: string) => void }) {
  const a = (i: RailItem) => (
    <a
      key={i.key}
      href={`/settings/${i.key}`}
      className={i.key === on ? 'c-on' : undefined}
      onClick={(e) => {
        e.preventDefault();
        onPick(i.key);
      }}
    >
      {i.label}
    </a>
  );
  return (
    <nav className="c-railnav">
      {items.map(a)}
      {help && <div className="c-sep">{a(help)}</div>}
    </nav>
  );
}

/** A pane's heading and body. `back` draws the pushed page's back row. */
export function PaneHead({ title, det, back, small }: { title: string; det: string; back?: () => void; small?: boolean }) {
  const t = (
    <p className="c-panetitle" style={small ? { fontSize: 15 } : undefined}>
      {title}
    </p>
  );
  return (
    <div className="c-panehead">
      {back ? (
        <div className="c-paneback" {...press(back)}>
          <IconBackChevron />
          {t}
        </div>
      ) : (
        t
      )}
      <p className="c-det">{det}</p>
    </div>
  );
}

// ---- Cells and rows ------------------------------------------------------------------------------

export function Cell({ label, det, full = true, foot, children }: { label: string; det?: ReactNode; full?: boolean; foot?: ReactNode; children: ReactNode }) {
  return (
    <div className="c-slab c-one">
      <div className={cx('c-cell', full && 'c-full')}>
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">{label}</p>
            {typeof det === 'string' || det === undefined ? <span className="c-det">{det}</span> : det}
          </div>
        </div>
        {children}
        {foot}
      </div>
    </div>
  );
}

export const Main = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cx('c-cmain', className)}>{children}</div>;

export const Rows = ({ link, className, style, children }: { link?: boolean; className?: string; style?: CSSProperties; children: ReactNode }) => (
  <div className={cx('c-rows', link && 'c-link', className)} style={style}>
    {children}
  </div>
);

/** A row: a name and its value; `go` adds the chevron of a row that opens something. */
export function Kv({ k, v, ink, go, onTap }: { k: ReactNode; v?: ReactNode; ink?: boolean; go?: boolean; onTap?: () => void }) {
  return (
    <div>
      <div className="c-kv" {...press(onTap)}>
        <span>{k}</span>
        <span className={cx('c-v', ink && 'c-ink')}>
          {v}
          {go && <IconChevron />}
        </span>
      </div>
    </div>
  );
}

export function Tg({ on, onChange, label }: { on: boolean; onChange?: (on: boolean) => void; label?: string }) {
  return <span className={cx('c-tg', on && 'c-on')} role="switch" onKeyDown={clickOnKey} aria-checked={on} aria-label={label} tabIndex={0} {...(onChange ? { onClick: () => onChange(!on) } : {})} />;
}

/**
 * A switch row. Given `on` and `onChange` it's the shop's setting, saved as it changes; without
 * them it keeps its own state (the preview's rows that have no setting behind them yet).
 */
export function Switch({ t, det, initial = true, on: controlled, onChange }: { t: string; det: string; initial?: boolean; on?: boolean; onChange?: (on: boolean) => void }) {
  const [own, setOwn] = useState(initial);
  const on = controlled ?? own;
  return <R2 t={t} det={det} end={<Tg on={on} onChange={onChange ?? setOwn} label={t} />} />;
}

/** Two lines and something at the end: a switch, a button, a word. */
export function R2({ t, det, end, endClass, off }: { t: string; det: string; end: ReactNode; endClass?: string; off?: boolean }) {
  return (
    <div>
      <div className={cx('c-r2', off && 'c-st-off')}>
        <div>
          <p className="c-t">{t}</p>
          <p className="c-det">{det}</p>
        </div>
        <span className={cx('c-end', endClass)}>{end}</span>
      </div>
    </div>
  );
}

export const Locked = ({ t, det }: { t: string; det: string }) => <R2 t={t} det={det} off endClass="c-st-locked" end={<IconLock14 />} />;
export const Fixed = ({ t, det }: { t: string; det: string }) => <R2 t={t} det={det} end={<span className="c-st-fixed">Always on</span>} />;

export function FootLine({ det, children }: { det: string; children: ReactNode }) {
  return (
    <div className="c-cfoot">
      <div className="c-line" style={{ alignItems: 'center' }}>
        <p className="c-det">{det}</p>
        {children}
      </div>
    </div>
  );
}

export const FootDet = ({ children }: { children: ReactNode }) => (
  <div className="c-cfoot">
    <p className="c-det">{children}</p>
  </div>
);

export const Btn = ({ children, primary, sm, onClick, disabled }: { children: ReactNode; primary?: boolean; sm?: boolean; onClick?: () => void; disabled?: boolean }) => (
  <button type="button" className={cx('c-btn', primary && 'c-btn-primary', sm && 'c-sm')} onClick={onClick} disabled={disabled}>
    {children}
  </button>
);

export const Pair = ({ children }: { children: ReactNode }) => (
  <span className="c-pair" style={{ flexShrink: 0 }}>
    {children}
  </span>
);

/** One choice from a few, or several (`multi`). */
/**
 * A row of chips. Given `value` and `onPick` it's the shop's setting (one choice, saved as picked);
 * without them it keeps its own state. `disabled` greys out choices that aren't available.
 */
export function Chips({
  options,
  initial = [0],
  multi,
  value,
  onPick,
  disabled = [],
}: {
  options: string[];
  initial?: number[];
  multi?: boolean;
  value?: number;
  onPick?: (i: number) => void;
  disabled?: number[];
}) {
  const [own, setOwn] = useState(initial);
  const on = value !== undefined ? [value] : own;
  const setOn = (next: number[]) => (onPick ? onPick(next[0]!) : setOwn(next));
  return (
    <div className="c-st-chips">
      {options.map((o, i) => (
        <button
          key={o}
          type="button"
          className={cx('c-btn', on.includes(i) && 'c-on')}
          aria-pressed={on.includes(i)}
          disabled={disabled.includes(i)}
          onClick={() => setOn(multi ? (on.includes(i) ? on.filter((x) => x !== i) : [...on, i]) : [i])}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function Conseq({ rows }: { rows: [string, ReactNode, boolean?][] }) {
  return (
    <div className="c-conseq">
      {rows.map(([k, v, tint]) => (
        <div key={k}>
          <span>{k}</span>
          <span className={tint ? 'c-st-tint' : undefined}>{v}</span>
        </div>
      ))}
    </div>
  );
}

export function Account({ bank, det, ready }: { bank: string; det: string; ready: boolean }) {
  return (
    <div className="c-st-acct">
      <span className="c-ic">
        <IconBank />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 'var(--t-sec)', fontWeight: 500 }}>{bank}</p>
        <p className="c-det" style={{ marginTop: 2 }}>
          {det}
        </p>
      </div>
      {ready ? (
        <span className="c-chip c-settled">
          <span className="c-core" />
          Ready
        </span>
      ) : (
        <span className="c-chip c-neutral">Not set</span>
      )}
    </div>
  );
}

export function Device({ name, det, kind, current, onSignOut }: { name: string; det: string; kind: 'tablet' | 'pc'; current?: boolean; onSignOut?: () => void }) {
  return (
    <div>
      <div className="c-line" style={{ alignItems: 'center' }}>
        <span className="c-st-dev">
          <span className="c-ic">{kind === 'tablet' ? <IconTabletSm /> : <IconMonitor />}</span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 'var(--t-sec)' }}>{name}</span>
            <span className="c-det" style={{ display: 'block', marginTop: 2 }}>
              {det}
            </span>
          </span>
        </span>
        {current ? (
          <span className="c-chip c-settled">
            <span className="c-core" />
            This device
          </span>
        ) : (
          <Btn sm onClick={onSignOut} disabled={!onSignOut}>
            Sign out
          </Btn>
        )}
      </div>
    </div>
  );
}

export function CounterCard({ shop, url }: { shop: string; url: string }) {
  return (
    <div className="c-st-card">
      <p className="c-t">Pay over time at {shop}</p>
      <div className="c-qr">
        <QRCodeSVG value={url} size={104} bgColor="var(--paper)" fgColor="var(--ink)" level="M" style={{ width: '100%', height: '100%' }} role="img" aria-label="The counter card's code" />
      </div>
      <p className="c-det">Scan with your camera</p>
    </div>
  );
}

// ---- Shop hours ----------------------------------------------------------------------------------

export interface DayHours {
  dn: string;
  open: [string, string] | null;
}

/** "08:00" → "8:00am" */
export const clock12 = (t: string) => {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
};

type Span = { from: string; to: string };
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * A live shop's week, to change: a switch per day, and when it's open, the times (the device's own
 * time picker). A day switched on starts at 9 to 5.
 */
export function WeekHoursEdit({ week, onChange }: { week: { day: number; open: Span | null }[]; onChange: (week: { day: number; open: Span | null }[]) => void }) {
  const set = (day: number, open: Span | null) => onChange(week.map((w) => (w.day === day ? { ...w, open } : w)));
  return (
    <Rows className="c-days">
      {week.map((w) => (
        <div key={w.day}>
          <div className={cx('c-st-day', !w.open && 'c-off')}>
            <span className="c-dn">{DAY_NAMES[w.day]}</span>
            {w.open ? (
              <span className="c-st-span">
                <input type="time" className="c-st-time" aria-label={`${DAY_NAMES[w.day]} opens`} value={w.open.from} onChange={(e) => set(w.day, { ...w.open!, from: e.target.value })} />
                <span className="c-sep">–</span>
                <input type="time" className="c-st-time" aria-label={`${DAY_NAMES[w.day]} closes`} value={w.open.to} onChange={(e) => set(w.day, { ...w.open!, to: e.target.value })} />
              </span>
            ) : (
              <span className="c-st-span">Closed</span>
            )}
            <Tg on={!!w.open} label={`Open on ${DAY_NAMES[w.day]}`} onChange={(v) => set(w.day, v ? { from: '09:00', to: '17:00' } : null)} />
          </div>
        </div>
      ))}
    </Rows>
  );
}

/** A date the shop is closed, or open other hours: "Thanksgiving, closed", "Christmas Eve, until noon". */
export function DateHoursSheet({ onAdd, onClose }: { onAdd: (d: { date: string; label: string; open: Span | null }) => void; onClose: () => void }) {
  const [date, setDate] = useState('');
  const [label, setLabel] = useState('');
  const [closed, setClosed] = useState(true);
  const [from, setFrom] = useState('08:00');
  const [to, setTo] = useState('12:00');
  const ok = !!date && label.trim().length > 0 && (closed || to > from);
  return (
    <Sheet
      className="c-st-sheet"
      title="A date that differs"
      onClose={onClose}
      foot={
        <button type="button" className="c-btn c-btn-primary c-btn-lg" style={{ width: '100%' }} disabled={!ok} onClick={() => onAdd({ date, label: label.trim(), open: closed ? null : { from, to } })}>
          Add the date
        </button>
      }
    >
      <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
        Date
      </p>
      <input className="c-field c-st-in" type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
      <p className="c-label c-st-fl">What it is</p>
      <input className="c-field c-st-in" aria-label="What it is" placeholder="Thanksgiving" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
      <p className="c-label c-st-fl">That day</p>
      <Chips options={['Closed all day', 'Open other hours']} value={closed ? 0 : 1} onPick={(i) => setClosed(i === 0)} />
      {!closed && (
        <div className="c-st-two" style={{ marginTop: 'var(--s2)' }}>
          <input className="c-field c-st-in" type="time" aria-label="Opens" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="c-field c-st-in" type="time" aria-label="Closes" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      )}
    </Sheet>
  );
}

/** One or a few text fields for the shop: its name, what it does, a line, a phone, an email, the address. */
export function TextSheet({
  title,
  det,
  fields,
  onSave,
  onClose,
  busy,
  error,
}: {
  title: string;
  det?: string;
  fields: { key: string; label: string; value: string; max: number; required?: boolean; inputMode?: 'text' | 'tel' | 'email' }[];
  onSave: (values: Record<string, string>) => void;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const [v, setV] = useState(() => Object.fromEntries(fields.map((f) => [f.key, f.value])));
  const ok = fields.every((f) => !f.required || v[f.key]!.trim().length > 0);
  return (
    <Sheet
      className="c-st-sheet"
      title={title}
      onClose={onClose}
      foot={
        <>
          {error && (
            <p className="c-det" role="alert" style={{ color: 'var(--absent)', margin: '0 0 var(--s1)' }}>
              {error}
            </p>
          )}
          <button type="button" className="c-btn c-btn-primary c-btn-lg" style={{ width: '100%' }} disabled={!ok || busy} onClick={() => onSave(v)}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {det && (
        <p className="c-det" style={{ marginTop: 0 }}>
          {det}
        </p>
      )}
      {fields.map((f, i) => (
        <div key={f.key}>
          <p className="c-label c-st-fl" style={i === 0 && !det ? { marginTop: 0 } : undefined}>
            {f.label}
          </p>
          <input
            className="c-field c-st-in"
            aria-label={f.label}
            inputMode={f.inputMode}
            maxLength={f.max}
            value={v[f.key]}
            autoFocus={i === 0}
            onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
          />
        </div>
      ))}
    </Sheet>
  );
}

export function WeekHours({ days }: { days: DayHours[] }) {
  const [on, setOn] = useState(days.map((d) => !!d.open));
  return (
    <Rows className="c-days">
      {days.map((d, i) => (
        <div key={d.dn}>
          <div className={cx('c-st-day', !on[i] && 'c-off')}>
            <span className="c-dn">{d.dn}</span>
            {on[i] ? (
              <span className="c-st-span">
                <span className="c-st-time">{d.open?.[0] ?? '9:00am'}</span>
                <span className="c-sep">–</span>
                <span className="c-st-time">{d.open?.[1] ?? '5:00pm'}</span>
              </span>
            ) : (
              <span className="c-st-span">Closed</span>
            )}
            <Tg on={on[i]} label={`Open on ${d.dn}`} onChange={(v) => setOn(on.map((x, k) => (k === i ? v : x)))} />
          </div>
        </div>
      ))}
    </Rows>
  );
}

// ---- The index ------------------------------------------------------------------------------------

export function IndexCell({ items, onPick, onEnd }: { items: (RailItem & { desc: string })[]; onPick: (k: string) => void; onEnd: () => void }) {
  return (
    <div className="c-slab c-one">
      <div className="c-cell">
        <div className="c-cmain">
          <Rows link>
            {items.map((i) => (
              <div key={i.key}>
                <div className="c-kv" style={{ alignItems: 'center' }} {...press(() => onPick(i.key))}>
                  <div>
                    <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>{i.label}</p>
                    <p className="c-det" style={{ marginTop: 3 }}>
                      {i.desc}
                    </p>
                  </div>
                  <IconChevron />
                </div>
              </div>
            ))}
          </Rows>
        </div>
        <div className="c-cfoot">
          <button type="button" className="c-btn c-btn-lg" onClick={onEnd}>
            End shift and sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Sheets --------------------------------------------------------------------------------------

const Note = ({ children }: { children: ReactNode }) => (
  <div className="c-footnote" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
    <p>{children}</p>
  </div>
);

export function ChangeAccountSheet({ now, next, onOpen, onClose }: { now: string; next: string; onOpen?: () => void; onClose: () => void }) {
  return (
    <Sheet
      title="Change account"
      onClose={onClose}
      foot={
        <>
          <Note>Nobody at Clear sees your login. If a rep is with you, they should step back now.</Note>
          <button type="button" className="c-btn c-btn-primary c-btn-lg" style={{ marginTop: 'var(--s2)' }} disabled={!onOpen} onClick={onOpen}>
            Open secure link
          </button>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>
        Payouts go to one business account. Changing it opens Plaid, your bank’s own sign-in, in a secure window.
      </p>
      <Rows style={{ marginTop: 'var(--s2)' }}>
        <Kv k="Now" v={now} />
        <div>
          <div className="c-kv" style={{ alignItems: 'flex-start' }}>
            <span>
              {next}
              <span className="c-det" style={{ display: 'block', marginTop: 3 }}>
                Goes to the new account if it is verified by Oct 12
              </span>
            </span>
          </div>
        </div>
      </Rows>
    </Sheet>
  );
}

export function AddDeviceSheet({ shop, code, onNew, onClose }: { shop: string; code: string; onNew?: () => void; onClose: () => void }) {
  return (
    <Sheet
      title="Add a device"
      onClose={onClose}
      foot={
        <>
          <Note>It signs in as {shop}. Staff still use their own PINs on it.</Note>
          <button type="button" className="c-btn c-btn-lg" style={{ marginTop: 'var(--s2)' }} disabled={!onNew} onClick={onNew}>
            New code
          </button>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>On the new tablet or computer, open merchant.useclear.org and enter this code.</p>
      <div className="c-st-code">
        {code.split('').map((c, i) => (
          <span key={i}>{c}</span>
        )).flatMap((s, i) => (i === 3 ? [<i key="gap" />, s] : [s]))}
      </div>
      <p className="c-det" style={{ textAlign: 'center' }}>
        Works once, for the next 10 minutes
      </p>
    </Sheet>
  );
}

export function LeaveSheet({ onTalk, onContinue, onClose }: { onTalk: () => void; onContinue: () => void; onClose: () => void }) {
  return (
    <Sheet
      title="Leave Clear"
      onClose={onClose}
      foot={
        <>
          <Note>Nothing happens until you confirm on the next screen.</Note>
          <div className="c-pair" style={{ marginTop: 'var(--s2)' }}>
            <button type="button" className="c-btn c-btn-primary" onClick={onTalk}>
              Talk to someone first
            </button>
            <button type="button" className="c-btn" onClick={onContinue}>
              Continue
            </button>
          </div>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>Leaving ends the partnership. Here is exactly what happens.</p>
      <Rows style={{ marginTop: 'var(--s2)' }}>
        <Kv k="New charges" v="Stop now" />
        <Kv k="Waiting charges" v="Cancelled" />
        <Kv k="Approved charges" v="Still settle" />
        <Kv k="What you are owed" v="Paid on the 14th" />
        <Kv k="Your listing" v="Comes down" />
        <Kv k="Counter cards" v="Stop working" />
      </Rows>
      <p className="c-det" style={{ marginTop: 'var(--s2)' }}>
        No fee and no notice period. Leaving does not change what you are owed.
      </p>
    </Sheet>
  );
}

export function ConfirmLeaveSheet({
  payout,
  waiting,
  names,
  onStay,
  onLeave,
}: {
  /** ["Paid to Chase ••4417 on Oct 14", "$4,218.91"] */
  payout: [string, string];
  waiting: string;
  names: string;
  onStay: () => void;
  onLeave?: () => void;
}) {
  const row = (k: string, v: ReactNode, det: string, style?: CSSProperties, ink?: boolean) => (
    <div>
      <div className="c-kv">
        <span>{k}</span>
        <span className={cx('c-v', ink && 'c-ink')} style={style}>
          {v}
        </span>
      </div>
      <p className="c-det" style={{ marginTop: 3 }}>
        {det}
      </p>
    </div>
  );
  return (
    <Sheet
      title="Confirm"
      onClose={onStay}
      foot={
        <>
          <Note>Your owner PIN is asked next. This cannot be undone from the tablet.</Note>
          <div className="c-pair" style={{ marginTop: 'var(--s2)' }}>
            <button type="button" className="c-btn c-btn-primary" onClick={onStay}>
              Stay with Clear
            </button>
            <button type="button" className="c-btn c-btn-danger" disabled={!onLeave} onClick={onLeave}>
              Leave Clear
            </button>
          </div>
        </>
      }
    >
      <Rows>
        {row(payout[0], payout[1], 'For charges approved up to today', undefined, true)}
        {row('Waiting charges cancelled', waiting, `${names} are told the shop has left Clear`, { color: 'var(--absent)' })}
        {row('Founding rate', 'Not kept if you return', 'A shop that returns signs the standard terms')}
      </Rows>
    </Sheet>
  );
}

export function NewCodeSheet({ onCreate, onClose }: { onCreate?: () => void; onClose: () => void }) {
  const [code, setCode] = useState('WINTER15');
  const [pct, setPct] = useState(true);
  return (
    <Sheet
      className="c-st-sheet"
      title="New discount code"
      onClose={onClose}
      foot={
        <button type="button" className="c-btn c-btn-primary c-btn-lg" style={{ width: '100%' }} disabled={!onCreate || !code} onClick={onCreate}>
          Create {code}
        </button>
      }
    >
      <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
        Code
      </p>
      <input className="c-field c-st-in" aria-label="Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))} />
      <p className="c-label c-st-fl">Takes off</p>
      <div className="c-st-two">
        <div className="c-st-seg">
          <b className={pct ? 'c-on' : undefined} {...press(() => setPct(true))}>
            %
          </b>
          <b className={pct ? undefined : 'c-on'} {...press(() => setPct(false))}>
            $
          </b>
        </div>
        <div className="c-field c-st-in">{pct ? '15%' : '$15.00'}</div>
      </div>
      <p className="c-label c-st-fl">On</p>
      <Chips options={['The whole charge', 'Tires', 'Parts', 'Services']} initial={[1]} />
      <p className="c-label c-st-fl">Runs</p>
      <div className="c-st-two">
        <div className="c-field c-st-in">Nov 1</div>
        <div className="c-field c-st-in">Dec 31</div>
      </div>
      <Rows style={{ marginTop: 'var(--s2)' }}>
        <Switch t="Once per customer" det="Checked by their phone number or Clear account" />
      </Rows>
    </Sheet>
  );
}

/**
 * Adding a smart reader: the code it shows on its own screen, and a name for it. The M2 and Tap to
 * Pay pair from the card screen in the Clear app, where the device can reach them.
 */
export function AddReaderSheet({ app, onAdd, onClose }: { app: boolean; onAdd?: (input: { code: string; label: string }) => Promise<void>; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('Front counter');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    if (!onAdd) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd({ code: code.trim(), label: label.trim() });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That reader couldn’t be added. Check the code and try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      className="c-st-sheet"
      title="Add a smart reader"
      onClose={onClose}
      foot={
        <button type="button" className="c-btn c-btn-primary c-btn-lg" style={{ width: '100%' }} disabled={!onAdd || busy || !code.trim() || !label.trim()} onClick={add}>
          {busy ? 'Adding…' : 'Add reader'}
        </button>
      }
    >
      <p className="c-det" style={{ marginTop: 0, lineHeight: 1.5 }}>
        On the reader, open Settings and choose Generate pairing code. Type the code it shows here.
        {app ? ' An M2 or Tap to Pay pairs from the card screen instead.' : ' An M2 or Tap to Pay pairs in the Clear app.'}
      </p>
      <p className="c-label c-st-fl">Pairing code</p>
      <input className="c-field c-st-in" aria-label="Pairing code" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
      <p className="c-label c-st-fl">Name</p>
      <input className="c-field c-st-in" aria-label="Reader name" value={label} onChange={(e) => setLabel(e.target.value)} />
      {error && (
        <p className="c-det" role="alert" style={{ marginTop: 'var(--s2)', color: 'var(--absent)' }}>
          {error}
        </p>
      )}
    </Sheet>
  );
}
