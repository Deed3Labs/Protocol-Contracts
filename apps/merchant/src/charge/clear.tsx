import type { ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { IconClear, IconText } from '@/brand/chargeIcons';
import { Chip, StepStrip } from '@/brand/controls';
import { ClearMark } from '@/brand/icons';
import { cx, initials, Slab } from '@/brand/ui';
import { Keypad, lineLabel } from '@/charge/start';
import { totals, usd, type CartLine } from '@/charge/model';

/**
 * Paying with Clear — New Charge reference, section 4.
 *
 * The tablet turns toward the customer, so the left cell is written for them: whose shop, what
 * they are approving, and one reassurance. The right cell is the code, the one object in its cell.
 * Then the charge's own state, waiting or approved, which is what no card terminal can show.
 */

const MEMBER_APP = ((import.meta.env.VITE_MEMBER_APP_URL as string | undefined) || 'https://app.useclear.org').replace(/\/$/, '');

/** What the code opens, and the same address written out for a camera that will not read it. */
export function chargeLink(code: string) {
  const url = `${MEMBER_APP}/c/${code}`;
  return { url, text: url.replace(/^https?:\/\//, '').replace(/^app\./, '') };
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const monthDay = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Four payments every two weeks, the first two weeks out: the reference's example split. */
export function exampleSplit(cents: number, from = new Date()) {
  return { each: Math.round(cents / 4), dates: [1, 2, 3, 4].map((i) => monthDay(addDays(from, 14 * i))) };
}

export interface CustomerSide {
  shop: string;
  amountCents: number;
  /** "Sep 22" */
  date: string;
  /** From a cart: the lines and their tax. A typed amount shows an example split instead. */
  lines?: CartLine[];
  /** Below the pay-over-time minimum: pay now only. */
  minimumCents?: number;
}

/** The customer's side of the screen: reads at arm's length, nothing on it looks tappable. */
export function CustomerCell({
  c,
  onScanTheirs,
  onPhone,
  alts = ['theirs', 'phone'],
  onShowMine,
}: {
  c: CustomerSide;
  onScanTheirs?: () => void;
  onPhone?: () => void;
  onShowMine?: () => void;
  alts?: ('mine' | 'theirs' | 'phone')[];
}) {
  const t = c.lines?.length ? totals(c.lines) : null;
  const under = c.minimumCents !== undefined && c.amountCents < c.minimumCents;
  const split = exampleSplit(c.amountCents);
  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">For the customer</p>
          <span className="c-det">Turn the screen</span>
        </div>
      </div>
      <div className="c-cmain">
        <div className="c-mc-cust">
          <div className="c-line" style={{ alignItems: 'center' }}>
            <span className="c-brand">
              {under ? <IconClear /> : <ClearMark />}
              <span>{c.shop} is asking you to approve</span>
            </span>
            <Chip tone="settled" dot>
              Clear Partner
            </Chip>
          </div>
          <div className="c-mid">
            <p className="c-label" style={{ margin: '0 0 12px' }}>
              {under ? 'You are paying' : 'You are approving'}
            </p>
            <p className={cx('c-amt', under && 'c-ck-amt-sm')}>{usd(c.amountCents)}</p>
            <p className="c-det c-amtsub">
              {under && t
                ? `${t.count} items · tax included`
                : t
                  ? `${t.count} items from ${c.shop} · ${c.date}`
                  : `Today’s work at ${c.shop} · ${c.date}`}
            </p>
            {t && c.lines ? (
              <>
                <Receipt lines={c.lines} taxCents={t.taxCents} />
                <p className="c-mc-full">
                  {under
                    ? `Paid now from your Clear balance. Paying over time is for charges of ${usd(c.minimumCents!)} or more.`
                    : 'You choose how to pay on your phone: all at once, or over time.'}
                </p>
              </>
            ) : under ? (
              <p className="c-mc-full">
                Paid now from your Clear balance. Paying over time is for charges of {usd(c.minimumCents!)} or more.
              </p>
            ) : (
              <div className="c-mc-plan">
                <div className="c-line" style={{ alignItems: 'baseline' }}>
                  <p className="c-label" style={{ margin: 0 }}>
                    4 payments, for example
                  </p>
                  <span className="c-each">
                    <b>{usd(split.each)}</b> each
                  </span>
                </div>
                <div className="c-segs">
                  <div />
                  <div />
                  <div />
                  <div />
                </div>
                <div className="c-mc-plancap">
                  {split.dates.map((d) => (
                    <p key={d} className="c-det">
                      {d}
                    </p>
                  ))}
                </div>
                <p className="c-mc-full">Or pay it all at once. You choose on your phone.</p>
              </div>
            )}
          </div>
          {!under && (
            <div className="c-mc-bleed">
              <span className="c-dotw" />
              <div>
                <p className="c-t">Nothing is charged until you approve</p>
                <p className="c-det">New to Clear? Scanning sets you up with this charge waiting.</p>
              </div>
            </div>
          )}
        </div>
      </div>
      {!under && <AltLinks alts={alts} onShowMine={onShowMine} onScanTheirs={onScanTheirs} onPhone={onPhone} />}
    </div>
  );
}

/** The other two ways, beneath a rule, as plain links: shortcuts, not a decision. */
function AltLinks({
  alts,
  onShowMine,
  onScanTheirs,
  onPhone,
}: {
  alts: ('mine' | 'theirs' | 'phone')[];
  onShowMine?: () => void;
  onScanTheirs?: () => void;
  onPhone?: () => void;
}) {
  const label = { mine: 'Show my code instead', theirs: alts[0] === 'theirs' ? 'Scan their code instead' : 'Scan their code', phone: 'Enter phone number' };
  const on = { mine: onShowMine, theirs: onScanTheirs, phone: onPhone };
  return (
    <div className="c-cfoot">
      <div className="c-mc-alt">
        {alts.map((a) => (
          <a
            key={a}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              on[a]?.();
            }}
          >
            {label[a]}
          </a>
        ))}
      </div>
    </div>
  );
}

export function Receipt({ lines, taxCents, small }: { lines: CartLine[]; taxCents: number; small?: boolean }) {
  return (
    <div className={cx('c-ci-rcpt', small && 'c-sm')}>
      {lines.map((l) => (
        <div key={l.key} className="c-kv">
          <span>{lineLabel(l)}</span>
          <span className="c-v">{usd(l.qty * l.unitCents)}</span>
        </div>
      ))}
      <div className="c-kv c-tx">
        <span>Sales tax</span>
        <span className="c-v">{usd(taxCents)}</span>
      </div>
    </div>
  );
}

/** The code, centred and unframed (its quiet zone is the frame), the link under it, and the steps. */
export function CodeCell({ code, amountCents }: { code: string; amountCents: number }) {
  const { url, text } = chargeLink(code);
  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">Scan to approve</p>
          <span className="c-det">Phone camera</span>
        </div>
      </div>
      <div className="c-cmain">
        <div className="c-mc-qrcol">
          <div className="c-mc-qrcenter">
            <QRCodeSVG
              value={url}
              className="c-mc-qr"
              size={260}
              level="M"
              marginSize={2}
              bgColor="var(--qr-paper)"
              fgColor="var(--qr-ink)"
              role="img"
              aria-label="Code for this charge"
            />
            <p className="c-mc-link">
              <span>or open</span> {text}
            </p>
          </div>
          <StepStrip
            current={0}
            steps={[
              { t: 'Scan the code', det: 'Now' },
              { t: `Approve ${usd(amountCents)}`, det: 'On your phone' },
              { t: 'Choose how to pay', det: 'Also on your phone' },
            ]}
          />
        </div>
      </div>
      <div className="c-cfoot">
        <p className="c-det" style={{ textAlign: 'center' }}>
          Point your phone camera at the code
        </p>
      </div>
    </div>
  );
}

export function ShowCodeView({
  c,
  code,
  onScanTheirs,
  onPhone,
}: {
  c: CustomerSide;
  code: string;
  onScanTheirs?: () => void;
  onPhone?: () => void;
}) {
  return (
    <Slab>
      <CustomerCell c={c} onScanTheirs={onScanTheirs} onPhone={onPhone} />
      <CodeCell code={code} amountCents={c.amountCents} />
    </Slab>
  );
}

/** Scanning a known member's own code. It says who they are and carries no amount. */
export function ScanTheirsView({
  amountCents,
  lines,
  onShowMine,
  onPhone,
  camera,
}: {
  amountCents: number;
  lines?: CartLine[];
  onShowMine?: () => void;
  onPhone?: () => void;
  /** The live camera, when there is one. */
  camera?: ReactNode;
}) {
  const t = lines?.length ? totals(lines) : null;
  return (
    <Slab>
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Scan their code</p>
            <span className="c-det">A known member</span>
          </div>
        </div>
        <div className="c-cmain">
          <div className="c-mc-state2">
            <div>
              <p className="c-keyline" style={{ margin: 0 }}>
                For a member who already has their code open. <strong>Their code says who they are and carries no amount</strong>, so
                scanning it moves nothing.
              </p>
            </div>
            <div className="c-mid">
              <p className="c-label" style={{ margin: '0 0 10px' }}>
                They will be asked to approve
              </p>
              <p className="c-amt">{usd(amountCents)}</p>
              <p className="c-det c-sub">{t ? `${t.count} items, the cart as you built it` : 'The amount you entered, on their phone'}</p>
              {t && lines && <Receipt lines={lines} taxCents={t.taxCents} small />}
            </div>
            <StepStrip
              current={0}
              steps={[
                { t: 'Scan', det: 'Now' },
                { t: 'They approve', det: 'On their phone' },
                { t: 'They choose how', det: 'Their choice' },
              ]}
            />
          </div>
        </div>
        <AltLinks alts={['mine', 'phone']} onShowMine={onShowMine} onPhone={onPhone} />
      </div>
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Their code</p>
            <span className="c-det">Camera</span>
          </div>
        </div>
        <div className="c-cmain">
          <div className="c-mc-cam">
            {camera}
            <div className="c-mc-reticle">
              <span className="c-vf c-tl" />
              <span className="c-vf c-tr" />
              <span className="c-vf c-bl" />
              <span className="c-vf c-br" />
            </div>
          </div>
        </div>
        <div className="c-cfoot">
          <p className="c-det" style={{ textAlign: 'center' }}>
            Hold their screen inside the frame
          </p>
        </div>
      </div>
    </Slab>
  );
}

/** "(909) 555-0142" from typed digits. */
export function formatPhone(d: string) {
  if (d.length <= 3) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`;
}

/** For a dead battery or a customer in the waiting room: a text from Clear. Digits only. */
export function SendToNumberView({
  shop,
  amountCents,
  code,
  digits,
  onKey,
  onSend,
  onShowMine,
  onScanTheirs,
}: {
  shop: string;
  amountCents: number;
  code: string;
  digits: string;
  onKey?: (k: string) => void;
  onSend?: () => void;
  onShowMine?: () => void;
  onScanTheirs?: () => void;
}) {
  const { text } = chargeLink(code);
  return (
    <Slab>
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Their number</p>
            <span className="c-det">By text</span>
          </div>
        </div>
        <div className="c-cmain">
          <div className="c-mc-amt2">
            <div>
              <div className="c-mc-amount c-mc-num" aria-live="polite">
                {formatPhone(digits)}
                <span className="c-caret" />
              </div>
              <p className="c-det c-lim">For a dead battery, a cracked screen, or someone in the waiting room.</p>
            </div>
            <div className="c-mid c-mc-sms">
              <div className="c-line" style={{ alignItems: 'baseline' }}>
                <p className="c-label" style={{ margin: 0 }}>
                  What they receive
                </p>
                <span className="c-det">A text from Clear</span>
              </div>
              <div className="c-bub">
                <b>{shop}</b> sent you a charge for <b>{usd(amountCents)}</b>. Approve it and choose how to split it at{' '}
                <span className="c-u">{text}</span>
              </div>
              <p className="c-det" style={{ marginTop: 10 }}>
                The same message goes to their email if they have Clear.
              </p>
            </div>
            <div className="c-mc-bleed">
              <p className="c-keyline" style={{ margin: 0 }}>
                They approve whenever they pick up their phone. <strong>You can serve the next customer meanwhile.</strong>
              </p>
            </div>
          </div>
        </div>
        <AltLinks alts={['mine', 'theirs']} onShowMine={onShowMine} onScanTheirs={onScanTheirs} />
      </div>
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Number pad</p>
            <span className="c-det">Digits only</span>
          </div>
        </div>
        <div className="c-cmain">
          <div className="c-mc-pad">
            {/* A phone number has no decimal point. */}
            <Keypad decimal={false} onKey={(k) => onKey?.(k)} />
            <button type="button" className="c-btn c-btn-primary c-btn-lg" disabled={digits.length < 10} onClick={onSend}>
              Send the charge
            </button>
          </div>
        </div>
        <div className="c-cfoot">
          <p className="c-det" style={{ textAlign: 'center' }}>
            It goes the moment you tap
          </p>
        </div>
      </div>
    </Slab>
  );
}


// ---- Waiting, and approved ----------------------------------------------------------------------

export interface ChargeState {
  code: string;
  raisedBy: string;
  customer?: string;
  /** "Sent to (909) 555-0142" */
  sentTo?: string;
  amountCents: number;
  status: 'waiting' | 'approved';
  steps: { t: string; det: string; state: 'd' | 'on' | '' }[];
  /** Approved: "4 payments of $235.00, the first on Oct 6" */
  howPaid?: string;
  /** Waiting, when there is more to say than "approving": "Paying now, from their Clear cash". */
  waitingLine?: string;
}

function StateCell({ s, foot }: { s: ChargeState; foot: ReactNode }) {
  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">This charge</p>
          <span className="c-det">
            #{s.code} &middot; raised by {s.raisedBy}
          </span>
        </div>
      </div>
      <div className="c-cmain">
        <div className="c-mc-state2">
          <div className="c-line" style={{ alignItems: 'center' }}>
            <span className="c-who">
              <span className="c-avatarbtn" style={{ cursor: 'default' }}>
                {s.customer ? initials(s.customer) : '—'}
              </span>
              <span>
                <p style={{ fontSize: 'var(--t-sec)', fontWeight: 500 }}>{s.customer ?? 'A customer'}</p>
                <p className="c-det">{s.sentTo ?? 'Showing the code'}</p>
              </span>
            </span>
            {s.status === 'approved' ? (
              <Chip tone="settled" dot>
                Approved
              </Chip>
            ) : (
              <Chip tone="underway" dot>
                Waiting
              </Chip>
            )}
          </div>
          <div className="c-mid">
            <p className="c-amt">{usd(s.amountCents)}</p>
            <p className="c-det c-sub">
              {s.status === 'approved' ? (s.howPaid ?? 'Approved on their phone') : (s.waitingLine ?? 'Approving on their phone, where they choose how to pay')}
            </p>
          </div>
          <div className={cx('c-mc-steps', s.status === 'approved' && 'c-done')} style={{ ['--n' as string]: s.steps.length }}>
            {s.steps.map((st) => (
              <div key={st.t} className={st.state ? `c-${st.state}` : ''} aria-current={st.state === 'on' ? 'step' : undefined}>
                <p className="c-t">{st.t}</p>
                <p className="c-det">{st.det}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="c-cfoot">{foot}</div>
    </div>
  );
}

export function WaitingView({
  s,
  reached,
  reachedNote = 'All three at once',
  onSendAgain,
  onCancel,
  onHome,
}: {
  s: ChargeState;
  /** Text, email, app: what reached them and when. Absent where the API does not say. */
  reached?: { how: 'Text' | 'Email' | 'App'; status: string; at: string }[];
  /** Beside "Reached them": how it went out. */
  reachedNote?: string;
  onSendAgain?: () => void;
  onCancel?: () => void;
  onHome?: () => void;
}) {
  const opened = reached?.some((r) => r.how === 'App' && r.status === 'Opened');
  return (
    <Slab>
      <StateCell
        s={s}
        foot={
          <div className="c-mc-foot2">
            <span className="c-det">Not charged until they approve</span>
            <span className="c-pair">
              <button type="button" className="c-btn" onClick={onSendAgain}>
                Send again
              </button>
              {onCancel && (
                <button type="button" className="c-btn" onClick={onCancel}>
                  Cancel charge
                </button>
              )}
            </span>
          </div>
        }
      />
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Reached them</p>
            <span className="c-det">{reachedNote}</span>
          </div>
        </div>
        <div className="c-cmain">
          <div className="c-mc-fill">
            <div className="c-rows c-mc-rx">
              {(reached ?? []).map((r) => (
                <div key={r.how}>
                  <div className="c-kv">
                    <span>{r.how}</span>
                    <span className={cx('c-v', r.how === 'App' && 'c-live')}>
                      {r.how !== 'App' && <IconText />}
                      {r.status}
                      <span className="c-t">{r.at}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="c-mc-bleed">
              <p className="c-keyline" style={{ margin: 0 }}>
                {opened ? (
                  <>
                    They have it open, so there is nothing to chase. <strong>They can approve any time today</strong>, and Home shows it
                    the moment they do.
                  </>
                ) : (
                  <>
                    <strong>They can approve any time today</strong>, and Home shows it the moment they do.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
        <div className="c-cfoot">
          <div className="c-mc-foot2">
            <span className="c-det">You do not have to wait here</span>
            <button type="button" className="c-btn c-btn-primary" onClick={onHome}>
              Back to Home
            </button>
          </div>
        </div>
      </div>
    </Slab>
  );
}

export interface ShiftRow {
  name: string;
  det: string;
  amountCents: number;
  approved: boolean;
}

export function ApprovedView({
  s,
  fee,
  paidOut,
  shift,
  shiftOf,
  onDone,
  onNew,
}: {
  s: ChargeState;
  /** Owners and managers: the fee as it applied. */
  fee?: { label: string; cents: number };
  /** "Oct 14, with this month's charges" */
  paidOut?: string;
  /** Counter shifts: the shift so far. */
  shift?: ShiftRow[];
  /** "Jen R." */
  shiftOf?: string;
  onDone?: () => void;
  onNew?: () => void;
}) {
  const waitingRow = shift?.find((r) => !r.approved);
  return (
    <Slab>
      <StateCell
        s={s}
        foot={
          <div className="c-mc-foot2">
            <span className="c-det">A receipt went to their phone</span>
            <span className="c-pair">
              <button type="button" className="c-btn" onClick={onDone}>
                Done
              </button>
              <button type="button" className="c-btn c-btn-primary" onClick={onNew}>
                New charge
              </button>
            </span>
          </div>
        }
      />
      {fee ? (
        <div className="c-cell">
          <div className="c-chead">
            <div className="c-sechead">
              <p className="c-label">What the shop gets</p>
              <span className="c-det">Owner only</span>
            </div>
          </div>
          <div className="c-cmain">
            <div className="c-mc-fill">
              <div className="c-mc-sum">
                <div className="c-conseq">
                  <div>
                    <span>Customer approved</span>
                    <span>{usd(s.amountCents)}</span>
                  </div>
                  <div>
                    <span>{fee.label}</span>
                    <span>&minus;{usd(fee.cents)}</span>
                  </div>
                  <div className="c-total c-grand" style={{ borderTop: '1px solid var(--ink-13)', marginTop: 'var(--s1)', paddingTop: 'var(--s1)' }}>
                    <span>You receive</span>
                    <span>{usd(s.amountCents - fee.cents)}</span>
                  </div>
                </div>
              </div>
              <div className="c-rows c-mc-bleed">
                <div>
                  <div className="c-kv">
                    <span>Paid out</span>
                    <span className="c-v" style={{ color: 'var(--ink)' }}>
                      {paidOut ?? '—'}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="c-kv">
                    <span>If they miss a payment</span>
                    <span className="c-v" style={{ color: 'var(--ink)' }}>
                      Clear carries it, not you
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="c-cfoot">
            <p className="c-det">The fee is shown at every confirmation, so the real rate is never a surprise on a statement.</p>
          </div>
        </div>
      ) : (
        <div className="c-cell">
          <div className="c-chead">
            <div className="c-sechead">
              <p className="c-label">Your shift so far</p>
              <span className="c-det">
                {shift?.length ?? 0} charges{shiftOf ? ` · ${shiftOf}` : ''}
              </span>
            </div>
          </div>
          <div className="c-cmain">
            <div className="c-mc-fill">
              <div className="c-rows c-mc-mine">
                {(shift ?? []).map((r) => (
                  <div key={r.name + r.det}>
                    <div className="c-line">
                      <span className="c-who" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span className="c-avatarbtn c-sm" style={{ cursor: 'default' }}>
                          {initials(r.name)}
                        </span>
                        <span>
                          <span style={{ display: 'block', fontSize: 'var(--t-sec)' }}>{r.name}</span>
                          <span className="c-det" style={{ display: 'block', marginTop: 2 }}>
                            {r.det}
                          </span>
                        </span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="c-amt2">{usd(r.amountCents)}</span>
                        {r.approved ? (
                          <Chip tone="settled" dot>
                            Approved
                          </Chip>
                        ) : (
                          <Chip tone="underway">Waiting</Chip>
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {waitingRow && (
                <div className="c-mc-bleed">
                  <p className="c-keyline" style={{ margin: 0 }}>
                    {waitingRow.name.split(/\s+/)[0]} has not opened it yet. <strong>Home can send it again</strong> if they are still in
                    the waiting room.
                  </p>
                </div>
              )}
            </div>
          </div>
          <div className="c-cfoot">
            <p className="c-det">The fee and the payout are for an owner.</p>
          </div>
        </div>
      )}
    </Slab>
  );
}
