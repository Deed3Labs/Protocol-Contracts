import type { ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Chip } from '@/brand/controls';
import { IconBack, IconCloseLg } from '@/brand/icons';
import { IconText } from '@/brand/chargeIcons';
import { Sheet, cx, initials } from '@/brand/ui';
import { chargeLink, type ChargeState } from '@/charge/clear';
import { BigLines, Breakdown, ItemList, Keypad, SearchItems, type ItemsProps, type FeeTerms } from '@/charge/start';
import { itemCount, totals, usd, type CartLine, type Item } from '@/charge/model';

/**
 * New Charge on a phone — the reference's fallback frames. The same screens, with a slim back
 * header instead of the flow bar, one column, and the cart as a bar pinned to the bottom.
 */

export function PhoneBack({ title, back, onExit, right }: { title: ReactNode; back?: boolean; onExit?: () => void; right?: ReactNode }) {
  return (
    <div className="c-paneback" style={{ marginBottom: 'var(--s3)' }}>
      <button type="button" aria-label={back ? 'Back' : 'Close'} onClick={onExit} style={{ display: 'flex' }}>
        {back ? <IconBack /> : <IconCloseLg />}
      </button>
      <p className="c-panetitle" style={{ fontSize: 15 }}>
        {title}
      </p>
      {right}
    </div>
  );
}

export function PhoneAmount({
  cents,
  fees,
  recordedAgainst,
  onKey,
  onContinue,
  onExit,
  modeSwitch,
}: {
  cents: number;
  fees?: FeeTerms | null;
  recordedAgainst?: string;
  onKey: (k: string) => void;
  onContinue?: () => void;
  onExit?: () => void;
  modeSwitch?: ReactNode;
}) {
  const fee = (p: number) => Math.round((cents * p) / 100);
  const pct = (p: number) => `${p % 1 ? p.toFixed(2).replace(/0$/, '') : p.toFixed(1)}%`;
  return (
    <>
      <PhoneBack title="New charge" onExit={onExit} right={modeSwitch} />
      <div className="c-mc-amount" style={{ fontSize: 48 }} aria-live="polite">
        {usd(cents)}
        <span className="c-caret" style={{ height: 40 }} />
      </div>
      <div style={{ margin: 'var(--s3) 0' }}>
        <div className="c-rows">
          <div>
            <div className="c-kv">
              <span>Customer approves</span>
              <span className="c-v">{usd(cents)}</span>
            </div>
          </div>
          {fees ? (
            <>
              <div>
                <div className="c-kv">
                  <span>
                    Fee &middot; {pct(fees.now)} now{fees.over !== undefined ? `, ${pct(fees.over)} over time` : ''}
                  </span>
                  <span className="c-v">
                    &minus;{usd(fee(fees.now))}
                    {fees.over !== undefined && <> or &minus;{usd(fee(fees.over))}</>}
                  </span>
                </div>
              </div>
              <div>
                <div className="c-kv">
                  <span style={{ color: 'var(--ink)', fontWeight: 600 }}>You receive</span>
                  <span className="c-v" style={{ color: 'var(--settled)', fontWeight: 600, fontSize: 'var(--t-body)' }}>
                    {usd(cents - fee(fees.now))}
                    {fees.over !== undefined && <> or {usd(cents - fee(fees.over))}</>}
                  </span>
                </div>
              </div>
            </>
          ) : (
            recordedAgainst && (
              <div>
                <div className="c-kv">
                  <span>Recorded against</span>
                  <span className="c-v">{recordedAgainst}</span>
                </div>
              </div>
            )
          )}
        </div>
      </div>
      <Keypad onKey={onKey} />
      <button type="button" className="c-btn c-btn-primary c-btn-lg" style={{ marginTop: 'var(--s2)' }} disabled={cents <= 0} onClick={onContinue}>
        Continue to checkout
      </button>
    </>
  );
}

/** On a phone, showing the code means handing the phone over, and the screen says so. */
export function PhoneCode({
  code,
  amountCents,
  onExit,
  onScanTheirs,
  onPhone,
}: {
  code: string;
  amountCents: number;
  onExit?: () => void;
  onScanTheirs?: () => void;
  onPhone?: () => void;
}) {
  const { url } = chargeLink(code);
  const link = (t: string, fn?: () => void) => (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault();
        fn?.();
      }}
    >
      {t}
    </a>
  );
  return (
    <>
      <PhoneBack title={usd(amountCents)} onExit={onExit} />
      <div className="c-mc-qrwrap">
        <QRCodeSVG value={url} className="c-mc-qr" size={220} level="M" marginSize={2} bgColor="var(--qr-paper)" fgColor="var(--qr-ink)" role="img" aria-label="Code for this charge" />
      </div>
      <p className="c-det" style={{ textAlign: 'center' }}>
        Scan with your phone camera
      </p>
      <p className="c-keyline" style={{ margin: 'var(--s3) 0' }}>
        <strong>On a phone this means handing it over.</strong> If that is awkward, send it to their number instead.
      </p>
      <div className="c-mc-alt">
        {link('Scan their code', onScanTheirs)}
        {link('Enter phone number', onPhone)}
      </div>
    </>
  );
}

/** Waiting or approved, compact: the charge, its rail, then what reached them or the money. */
export function PhoneStatus({
  s,
  reached,
  fee,
  paidOut,
  onExit,
  onHome,
  onSendAgain,
  onCancel,
  onDone,
  onNew,
}: {
  s: ChargeState;
  reached?: { how: string; status: string }[];
  fee?: { label: string; cents: number };
  paidOut?: string;
  onExit?: () => void;
  onHome?: () => void;
  onSendAgain?: () => void;
  onCancel?: () => void;
  onDone?: () => void;
  onNew?: () => void;
}) {
  const approved = s.status === 'approved';
  const first = s.customer?.split(/\s+/)[0];
  return (
    <>
      <PhoneBack title={approved ? 'Charge approved' : first ? `Waiting on ${first}` : 'Waiting'} onExit={onExit} />
      <div className="c-slab c-one">
        <div className="c-cell">
          <div className="c-cmain">
            <div className="c-mc-state2" style={{ gap: 'var(--s3)' }}>
              <div className="c-line" style={{ alignItems: 'center' }}>
                <span className="c-who">
                  <span className="c-avatarbtn c-sm" style={{ cursor: 'default' }}>
                    {s.customer ? initials(s.customer) : '—'}
                  </span>
                  <p style={{ fontSize: 'var(--t-sec)', fontWeight: 500 }}>{s.customer ?? 'A customer'}</p>
                </span>
                {approved ? (
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
                <p className="c-det c-sub">{approved ? (s.howPaid?.replace(/, the first on .*$/, '') ?? 'Approved') : 'Approving on their phone'}</p>
              </div>
              <div className={cx('c-mc-steps', approved && 'c-done')} style={{ ['--n' as string]: s.steps.length }}>
                {s.steps.map((st) => (
                  <div key={st.t} className={st.state ? `c-${st.state}` : ''}>
                    <p className="c-t">{st.t}</p>
                    <p className="c-det">{st.det}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {!approved && reached && (
            <div className="c-cmain">
              <div className="c-rows c-mc-rx">
                {reached.map((r) => (
                  <div key={r.how}>
                    <div className="c-kv">
                      <span>{r.how}</span>
                      <span className={cx('c-v', r.how === 'App' && 'c-live')}>
                        {r.how !== 'App' && <IconText />}
                        {r.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {approved && fee && (
            <div className="c-cmain c-mc-sum">
              <div className="c-conseq">
                <div>
                  <span>{fee.label}</span>
                  <span>&minus;{usd(fee.cents)}</span>
                </div>
                <div className="c-total c-grand" style={{ borderTop: '1px solid var(--ink-13)', marginTop: 'var(--s1)', paddingTop: 'var(--s1)' }}>
                  <span>You receive</span>
                  <span>{usd(s.amountCents - fee.cents)}</span>
                </div>
                {paidOut && (
                  <div>
                    <span>Paid out</span>
                    <span>{paidOut}</span>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="c-cfoot">
            {approved ? (
              <div className="c-pair">
                <button type="button" className="c-btn" onClick={onDone}>
                  Done
                </button>
                <button type="button" className="c-btn c-btn-primary" onClick={onNew}>
                  New charge
                </button>
              </div>
            ) : (
              <>
                <button type="button" className="c-btn c-btn-primary c-btn-lg" onClick={onHome}>
                  Back to Home
                </button>
                <div className="c-pair" style={{ marginTop: 'var(--s1)' }}>
                  <button type="button" className="c-btn" onClick={onSendAgain}>
                    Send again
                  </button>
                  <button type="button" className="c-btn" onClick={onCancel}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** The item list, one column, with the cart as a bar pinned to the bottom. */
export function PhoneItems({
  lines,
  onCart,
  onExit,
  modeSwitch,
  ...p
}: ItemsProps & { lines: CartLine[]; onCart?: () => void; onExit?: () => void; modeSwitch?: ReactNode }) {
  const t = totals(lines);
  return (
    <>
      <div className="c-paneback" style={{ marginBottom: 'var(--s2)' }}>
        <button type="button" aria-label="Close" onClick={onExit} style={{ display: 'flex' }}>
          <IconCloseLg />
        </button>
        <p className="c-panetitle" style={{ fontSize: 15 }}>
          New charge
        </p>
        {modeSwitch}
      </div>
      <SearchItems value={p.search} onChange={p.onSearch} style={{ width: '100%', marginBottom: 'var(--s2)' }} />
      <div className="c-slab c-one">
        <div className="c-cell">
          <ItemList {...p} />
        </div>
      </div>
      {lines.length > 0 && (
        <div className="c-ci-bar">
          <div>
            <p className="c-t">{itemCount(t.count)}</p>
            <p className="c-det">{usd(t.totalCents)} with tax</p>
          </div>
          <button type="button" className="c-btn c-btn-primary" onClick={onCart}>
            Checkout
          </button>
        </div>
      )}
    </>
  );
}

/** The cart as its own screen on a phone: the lines stacked, the stepper under each name. */
export function PhoneCart({
  lines,
  catalog,
  onQty,
  onRemove,
  onBack,
  onCheckout,
}: {
  lines: CartLine[];
  catalog: Item[];
  onQty?: (l: CartLine, n: number) => void;
  onRemove?: (l: CartLine) => void;
  onBack?: () => void;
  onCheckout?: () => void;
}) {
  const t = totals(lines);
  return (
    <>
      <PhoneBack back title={`Cart · ${itemCount(t.count)}`} onExit={onBack} />
      <div className="c-slab c-one">
        <div className="c-cell">
          <div className="c-cmain">
            <BigLines lines={lines} catalog={catalog} onQty={onQty} onRemove={onRemove} />
          </div>
          <div className="c-cmain c-ci-cartcell">
            <Breakdown t={t} className="c-ci-tot" />
            <div className="c-ci-grand">
              <span>Customer approves</span>
              <span className="c-f">{usd(t.totalCents)}</span>
            </div>
          </div>
          <div className="c-cfoot">
            <button type="button" className="c-btn c-btn-primary c-btn-lg" disabled={!lines.length} onClick={onCheckout}>
              Checkout &middot; {usd(t.totalCents)}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ---- When it does not work ----------------------------------------------------------------------

/**
 * Three failures a counter will hit with Clear, each handing the writer the sentence to say.
 * A decline never says why: that stays between Clear and the member.
 */
export function FailureSheet({
  kind,
  customer,
  offlineLimitCents,
  onPrimary,
  onCash,
  onCard,
  onClose,
  inline,
}: {
  kind: 'declined' | 'expired' | 'offline';
  customer?: string;
  offlineLimitCents?: number;
  onPrimary?: () => void;
  onCash?: () => void;
  onCard?: () => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  const who = customer?.split(/\s+/)[0] ?? 'They';
  const body = {
    declined: {
      title: 'Declined',
      chip: <Chip tone="neutral">Not covered</Chip>,
      lead: 'Clear could not cover this one.',
      det: `${who} can see why in their app. You are never told the reason — that stays between Clear and the member.`,
      say: '“It did not go through on their side — the app will tell you why. Nothing was charged.”',
    },
    expired: {
      title: 'Expired',
      chip: <Chip tone="underway">24 hours</Chip>,
      lead: `${who} did not approve in time.`,
      det: 'Charges expire after 24 hours. Nothing was charged and nothing is owed. The usual cause is a phone left face-down.',
      say: '“I will send it again — it just needs approving on your phone.”',
    },
    offline: {
      title: 'No connection',
      chip: <Chip tone="absent">Offline</Chip>,
      lead: 'Clear can’t reach their phone.',
      det: `There is no offline queue for Clear: a charge the ledger has not seen is a promise that may not hold. Card and cash still work, and a card is stored and sent when the connection is back, up to ${usd(offlineLimitCents ?? 50000)}.`,
      say: '“Paying over time is down for a moment. I can take a card or cash, or we can try again in a minute.”',
    },
  }[kind];
  return (
    <Sheet
      inline={inline}
      label={body.title}
      onClose={onClose}
      head={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <span className="c-mtitle">{body.title}</span>
          {body.chip}
        </div>
      }
      foot={
        kind === 'offline' ? (
          <div className="c-pair" style={{ display: 'flex', gap: 'var(--s1)' }}>
            <button type="button" className="c-btn c-btn-lg" style={{ flex: 1 }} onClick={onCash}>
              Cash
            </button>
            <button type="button" className="c-btn c-btn-primary c-btn-lg" style={{ flex: 1 }} onClick={onCard}>
              Card
            </button>
          </div>
        ) : (
          <button type="button" className="c-btn c-btn-primary c-btn-lg" onClick={onPrimary}>
            {kind === 'declined' ? 'Try a smaller amount' : 'Send it again'}
          </button>
        )
      }
    >
      <p style={{ margin: 0, fontSize: 'var(--t-body)', fontWeight: 500 }}>{body.lead}</p>
      <p className="c-det" style={{ marginTop: 6 }}>
        {body.det}
      </p>
      <p className="c-label" style={{ margin: 'var(--s3) 0 6px' }}>
        What to tell them
      </p>
      <p className="c-keyline">{body.say}</p>
    </Sheet>
  );
}
