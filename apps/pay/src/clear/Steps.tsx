import type { ContactSent, MemberQuote, PaidView, PaySession } from '@clear/merchant-contracts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { type PayApi, PayApiError } from '../lib/api';
import {
  approveLabel,
  carryLabel,
  checkBody,
  checkTitle,
  codeDigits,
  doneLine,
  everydayName,
  money,
  paidWith,
  pointsNote,
  pointsRow,
  splitLabel,
} from './model';

/**
 * Pay with Clear's steps (pay spec §2–§4), built once for the modal (`/m/:session`) and the link page
 * (`/l/:slug`). They draw the body of the drawn modal; the caller draws the head and the secure line.
 *
 * On a computer: email or phone, then the one screen for everyone ("Check your phone"), then the
 * member's screen or "You're new to Clear", then done. On a phone: the sheet's three choices, where
 * "Approve with Clear" opens the Clear app's approval page in a window.
 */

export type Layout = 'modal' | 'sheet';

export type Step =
  | { k: 'start' }
  | { k: 'enter' }
  | { k: 'check'; sent: ContactSent; contact: string }
  | { k: 'member'; token: string; quote: MemberQuote }
  | { k: 'new'; contact: string }
  | { k: 'window'; via: 'clear' | 'card'; url: string }
  | { k: 'done'; paid: PaidView; pointsShop: string | null };

export interface StepsProps {
  api: PayApi;
  session: PaySession;
  layout: Layout;
  /** Where the steps start; the preview opens any. */
  initial?: Step;
  /** "Back to Mi Casa Tacos": the modal hands the payment to the page. Absent on the link page. */
  onBack?: (paid: PaidView) => void;
  /** Paid, by any route: the caller follows (the modal tells the page; the link page shows Paid). */
  onPaid?: (paid: PaidView) => void;
}

const POLL_MS = 3000;
const errorOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.');
const key = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

// ---- Icons, as the spec draws them -----------------------------------------------------------------

const PhoneIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="7" y="2.5" width="10" height="19" rx="2" />
    <path d="M11 18.5h2" />
  </svg>
);
const TickIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12 5 5 9-10" />
  </svg>
);
const Chevron = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

function Err({ text }: { text: string | null }) {
  return text ? (
    <p className="pw-note pay-err" role="alert">
      {text}
    </p>
  ) : null;
}

/** The body and an optional footer, as the drawn modal lays them out. */
function Body({ children, foot }: { children: ReactNode; foot?: ReactNode }) {
  return (
    <>
      <div className="pw-mbody">{children}</div>
      {foot ? <div className="pw-mfoot">{foot}</div> : null}
    </>
  );
}

/** Six boxes over one real input, so a phone's keyboard and autofill (`one-time-code`) both work. */
function CodeBoxes({ value, onChange, onDone, disabled }: { value: string; onChange: (v: string) => void; onDone: (v: string) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <label className="pw-code6 pay-code" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        className="pay-code-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="The six-digit code"
        maxLength={6}
        disabled={disabled}
        value={value}
        onChange={(e) => {
          const v = codeDigits(e.target.value);
          onChange(v);
          if (v.length === 6) onDone(v);
        }}
      />
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={i === value.length ? 'cur' : undefined} aria-hidden="true">
          {value[i] ?? ''}
        </span>
      ))}
    </label>
  );
}

export function ClearSteps({ api, session, layout, initial, onBack, onPaid }: StepsProps) {
  const [step, setStep] = useState<Step>(initial ?? { k: layout === 'sheet' ? 'start' : 'enter' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contact, setContact] = useState(session.prefillEmail ?? '');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'now' | 'over'>('over');
  const [split, setSplit] = useState<number | null>(null);
  const [details, setDetails] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const total = session.order.totalCents;
  const shop = session.shop.name;
  const go = (s: Step) => {
    setError(null);
    setStep(s);
  };

  const paid = (p: PaidView, pointsShop: string | null) => {
    go({ k: 'done', paid: p, pointsShop });
    onPaid?.(p);
  };

  // Paid already (a reload, or the link approved on the phone first): straight to done.
  useEffect(() => {
    if (session.state !== 'paid' || step.k === 'done') return;
    void api.status(session.id).then((s) => s.paid && go({ k: 'done', paid: s.paid, pointsShop: everydayName(shop) }), () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.state, session.id, api]);

  // While a screen waits on something outside it (the texted link, the Clear window, a card), ask.
  useEffect(() => {
    if (step.k !== 'check' && step.k !== 'window') return;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const s = await api.status(session.id).catch(() => null);
      if (s?.state === 'paid' && s.paid) paid(s.paid, everydayName(shop));
    }, POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.k, api, session.id]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorOf(e));
    } finally {
      setBusy(false);
    }
  };

  /** A window opened on the tap itself, so the browser doesn't block it, then pointed where it goes. */
  const openWindow = async (via: 'clear' | 'card', url: () => Promise<string>) => {
    const tab = window.open('', '_blank');
    await run(async () => {
      try {
        const to = await url();
        if (tab) {
          tab.opener = null;
          tab.location.href = to;
        }
        go({ k: 'window', via, url: to });
      } catch (e) {
        tab?.close();
        throw e;
      }
    });
  };
  const approveWithClear = () => openWindow('clear', async () => (await api.approval(session.id)).url);
  const payByCard = () =>
    openWindow('card', async () => {
      const started = await api.pay(session.id, 'card', key());
      if (started.method !== 'card') throw new Error('Card isn’t available here');
      return started.checkoutUrl;
    });

  const sendTo = (to: string) =>
    run(async () => {
      const sent = await api.contact(session.id, to);
      setCode('');
      setResendIn(sent.resendInSeconds);
      go({ k: 'check', sent, contact: to });
    });

  const checkCode = (typed: string) =>
    run(async () => {
      try {
        const verified = await api.code(session.id, typed);
        if (verified.person.kind === 'new') return go({ k: 'new', contact: verified.person.contact });
        const quote = await api.member(session.id, verified.token);
        // The drawing opens on Over time.
        setMode(quote.splits.length ? 'over' : 'now');
        setSplit(null);
        go({ k: 'member', token: verified.token, quote });
      } catch (e) {
        setCode('');
        throw e;
      }
    });

  const cardButton = session.methods.card ? (
    <button type="button" className="pw-btn" disabled={busy} onClick={() => void payByCard()}>
      Pay by card
    </button>
  ) : null;

  // ---- The phone's sheet (§4) --------------------------------------------------------------------
  if (step.k === 'start') {
    return (
      <Body>
        <p className="pw-h">Pay with Clear</p>
        <p className="pw-d">Approve in the Clear app, or sign in with your email or phone.</p>
        <button type="button" className="pw-btn k" disabled={busy} onClick={() => void approveWithClear()}>
          Approve with Clear
        </button>
        <button type="button" className="pw-btn" disabled={busy} onClick={() => go({ k: 'enter' })}>
          Use email or phone
        </button>
        {session.methods.card ? (
          <p className="pw-note">
            <button type="button" className="ci-link pay-link" disabled={busy} onClick={() => void payByCard()}>
              Pay by card
            </button>
          </p>
        ) : null}
        <Err text={error} />
      </Body>
    );
  }

  // ---- Email or phone (§2) -----------------------------------------------------------------------
  if (step.k === 'enter') {
    return (
      <Body>
        <p className="pw-h">Pay with Clear</p>
        <p className="pw-d">Sign in to your Clear account to pay now or split it. New to Clear? You can join here.</p>
        <form
          className="pay-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (contact.trim()) void sendTo(contact.trim());
          }}
        >
          <label className="pw-f">
            <span>Email or phone</span>
            <input className="sa-in pay-in" type="text" inputMode="email" autoComplete="email tel" value={contact} onChange={(e) => setContact(e.target.value)} />
          </label>
          <button type="submit" className="pw-btn k" disabled={busy || !contact.trim()}>
            Continue
          </button>
        </form>
        <Err text={error} />
        {cardButton ? (
          <>
            <div className="pw-or">
              <span>or</span>
            </div>
            {cardButton}
          </>
        ) : null}
      </Body>
    );
  }

  // ---- The one screen for everyone (approved over §2 and §3) --------------------------------------
  if (step.k === 'check') {
    return (
      <Body
        foot={
          <>
            <button type="button" className="ci-link pay-link" onClick={() => go({ k: 'enter' })}>
              Use a different email or phone
            </button>
            <button type="button" className="ci-link pay-link" disabled={busy || resendIn > 0} onClick={() => void sendTo(step.contact)}>
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
            </button>
          </>
        }
      >
        <p className="pw-h">{checkTitle(step.sent.channel)}</p>
        <p className="pw-d">{checkBody(step.sent.channel)}</p>
        <CodeBoxes value={code} onChange={setCode} onDone={(v) => void checkCode(v)} disabled={busy} />
        <button type="button" className="pw-btn k" disabled={busy || code.length !== 6} onClick={() => void checkCode(code)}>
          Continue
        </button>
        <p className="pw-note">Sent to {step.sent.to}. It expires in 10 minutes.</p>
        <Err text={error} />
      </Body>
    );
  }

  // ---- Hi Sofia (§2) -----------------------------------------------------------------------------
  if (step.k === 'member') {
    const q = step.quote;
    const over = mode === 'over' && q.splits.length > 0;
    // The drawing opens on In 4, where it's offered.
    const chosen = over ? (q.splits.find((s) => s.installments === split) ?? q.splits.find((s) => s.installments === 4) ?? q.splits[0]!) : null;
    const approve = () => {
      if (!over || q.approveIn === 'window') return void approveWithClear();
      void run(async () => {
        const done = await api.approve(session.id, step.token, chosen!.installments, key());
        paid(done, q.points?.shopName ?? everydayName(shop));
      });
    };
    return (
      <Body>
        <p className="pw-h">Hi {q.firstName}</p>
        <div className="pw-sum">
          <span>{session.order.summary}</span>
          <button type="button" className="ci-link pay-link" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
            Details
          </button>
        </div>
        {details ? (
          <div className="pw-kv">
            {session.order.lines.map((l, i) => (
              <div key={i} className="kv">
                <span>{l.quantity > 1 ? `${l.quantity} × ${l.name}` : l.name}</span>
                <span className="v">{money(l.lineCents)}</span>
              </div>
            ))}
            <div className="kv">
              <span>Tax</span>
              <span className="v">{money(session.order.taxCents)}</span>
            </div>
          </div>
        ) : null}
        {q.splits.length && q.canPayNow ? (
          <div className="tm-seg pw-seg" role="radiogroup" aria-label="How to pay">
            <b role="radio" tabIndex={0} aria-checked={mode === 'now'} className={mode === 'now' ? 'on' : undefined} onClick={() => setMode('now')} onKeyDown={(e) => e.key === 'Enter' && setMode('now')}>
              Pay now
            </b>
            <b role="radio" tabIndex={0} aria-checked={mode === 'over'} className={mode === 'over' ? 'on' : undefined} onClick={() => setMode('over')} onKeyDown={(e) => e.key === 'Enter' && setMode('over')}>
              Over time
            </b>
          </div>
        ) : null}
        {over ? (
          <>
            <div className="pw-splits" role="radiogroup" aria-label="Split it">
              {q.splits.map((s) => (
                <span
                  key={s.installments}
                  role="radio"
                  tabIndex={0}
                  aria-checked={s.installments === chosen!.installments}
                  className={s.installments === chosen!.installments ? 'on' : undefined}
                  onClick={() => setSplit(s.installments)}
                  onKeyDown={(e) => e.key === 'Enter' && setSplit(s.installments)}
                >
                  {splitLabel(s.installments)}
                  <b>{money(s.perCycleCents)}</b>
                </span>
              ))}
            </div>
            <div className="pw-kv">
              <div className="kv">
                <span>Each cycle</span>
                <span className="v">{money(chosen!.perCycleCents)}</span>
              </div>
              <div className="kv">
                <span>{carryLabel(chosen!.ratePerCycleBps)}</span>
                <span className="v">{money(chosen!.carryCents)}</span>
              </div>
              {q.clearsFrom ? (
                <div className="kv">
                  <span>Clears from</span>
                  <span className="v">{q.clearsFrom}</span>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="pw-kv">
            <div className="kv">
              <span>From</span>
              <span className="v">Your Clear cash</span>
            </div>
          </div>
        )}
        <button type="button" className="pw-btn k" disabled={busy} onClick={approve}>
          {approveLabel(total, over ? chosen!.installments : null)}
        </button>
        {(!over || q.approveIn === 'window') ? <p className="pw-note">You’ll approve it in Clear, in a new window.</p> : null}
        {pointsNote(q.points) ? <p className="pw-note">{pointsNote(q.points)}</p> : null}
        <Err text={error} />
      </Body>
    );
  }

  // ---- New to Clear (§3) -------------------------------------------------------------------------
  if (step.k === 'new') {
    return (
      <Body>
        <p className="pw-h">You’re new to Clear</p>
        <p className="pw-d">{step.contact} is confirmed. The order is the same either way.</p>
        {session.methods.card ? (
          <button type="button" className="pw-choice pay-choice" disabled={busy} onClick={() => void payByCard()}>
            <div>
              <p className="t">Pay {money(total)} by card</p>
              <p className="det">Now, with {shop}’ card processor</p>
            </div>
            <Chevron />
          </button>
        ) : null}
        <p className="pw-note" style={{ textAlign: 'left' }}>
          Clear is a member-owned co-op. Joining is free, and you can pay this order by card and join later.
        </p>
        <Err text={error} />
      </Body>
    );
  }

  // ---- Waiting on a window (not drawn) -------------------------------------------------------------
  if (step.k === 'window') {
    return (
      <Body
        foot={
          <>
            <a className="ci-link pay-link" href={step.url} target="_blank" rel="noopener">
              Open it again
            </a>
            <button type="button" className="ci-link pay-link" onClick={() => go({ k: layout === 'sheet' ? 'start' : 'enter' })}>
              Pay another way
            </button>
          </>
        }
      >
        <div className="pw-wait" role="status" aria-live="polite">
          <span className="pw-ring">
            <PhoneIcon />
          </span>
          <p className="pw-h">{step.via === 'card' ? 'Pay in the card window' : 'Approve in Clear'}</p>
          <p className="pw-d">Finish in the window that opened. This page moves on by itself.</p>
          <span className="chip underway">
            <span className="core" />
            {step.via === 'card' ? 'Waiting for the card' : 'Waiting for Clear'}
          </span>
        </div>
      </Body>
    );
  }

  // ---- Done (§2) -----------------------------------------------------------------------------------
  const p = step.paid;
  return (
    <Body>
      <div className="pw-wait" role="status">
        <span className="pw-ring ok">
          <TickIcon />
        </span>
        <p className="pw-h">You’re all set</p>
        <p className="pw-d">{doneLine(shop, p)}</p>
      </div>
      <div className="pw-kv">
        <div className="kv">
          <span>Paid with</span>
          <span className="v">{paidWith(p)}</span>
        </div>
        {p.points ? (
          <div className="kv">
            <span>Points at {step.pointsShop ?? everydayName(shop)}</span>
            <span className="v">{pointsRow(p.points)}</span>
          </div>
        ) : null}
        <div className="kv">
          <span>Receipt</span>
          <span className="v">{p.receipt}</span>
        </div>
      </div>
      {onBack ? (
        <button type="button" className="pw-btn" onClick={() => onBack(p)}>
          Back to {shop}
        </button>
      ) : null}
    </Body>
  );
}

export { PayApiError };
