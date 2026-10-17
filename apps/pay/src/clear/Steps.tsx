import type { CodeVerified, ContactSent, JoinHandoff, MemberQuote, PaidView, PaySession } from '@clear/merchant-contracts';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { type PayApi, PayApiError } from '../lib/api';
import { CardStep } from './Card';
import {
  approveLabel,
  cardPointsNote,
  carryLabel,
  checkBody,
  checkTitle,
  codeDigits,
  dobMask,
  dobToIso,
  doneLine,
  everydayName,
  joinDet,
  joinTitle,
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
 *
 * Someone new can join (§3): step 1 here, step 2 in the Clear window (polled), step 3 their own
 * member's screen back here. Card is Stripe's fields, here, on the shop's account.
 */

export type Layout = 'modal' | 'sheet';

export type Step =
  | { k: 'start' }
  | { k: 'enter' }
  | { k: 'check'; sent: ContactSent; contact: string }
  | { k: 'member'; token: string; quote: MemberQuote; joined?: boolean }
  | { k: 'new'; contact: string; token: string; join: Extract<CodeVerified['person'], { kind: 'new' }>['join'] }
  /** Join, step 1: the basics. */
  | { k: 'join1'; token: string; split: { installments: number; perCycleCents: number } | null; prefill?: { legalName: string; dob: string; zip: string; street: string } }
  /** Join, step 2: the Clear window, polled. */
  | { k: 'join2'; token: string; handoff: JoinHandoff; split: { installments: number; perCycleCents: number } | null }
  /** Joined, but a starting limit doesn't cover this order (yet): this one by card. Not drawn. */
  | { k: 'joined'; token: string }
  | { k: 'card'; token: string | null; signedIn: boolean }
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
  // Join, step 1. Kept here too, so a window whose link ran out can be opened again without retyping.
  const [basics, setBasics] = useState(initial?.k === 'join1' && initial.prefill ? initial.prefill : { legalName: '', dob: '', zip: '', street: '' });
  const [phoneQr, setPhoneQr] = useState(false);
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

  // While the Clear window is open for joining: done hands back a member's token, and step 3 is theirs.
  useEffect(() => {
    if (step.k !== 'join2') return;
    const { token, split } = step;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const j = await api.joinState(session.id, token).catch(() => null);
      if (!j) return;
      if (j.state === 'expired') return setError('The window’s link ran out. Open a new one, or pay by card.');
      if (j.state !== 'done' || !j.token) return;
      window.clearInterval(timer);
      const quote = await api.member(session.id, j.token).catch(() => null);
      if (quote && quote.splits.length) {
        setMode('over');
        setSplit(split?.installments ?? null);
        go({ k: 'member', token: j.token, quote, joined: true });
      } else go({ k: 'joined', token: j.token });
    }, POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, api, session.id]);

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
  /** Stripe's fields, here. A token when someone signed in: a member's card takes their points. */
  const payByCard = (token: string | null = null, signedIn = false) => go({ k: 'card', token, signedIn });

  /** Step 1 sent: the window's address, opened on the tap that asked for it. */
  const startJoin = (token: string, split: { installments: number; perCycleCents: number } | null, open: boolean) =>
    run(async () => {
      const dateOfBirth = dobToIso(basics.dob);
      if (!dateOfBirth) throw new Error('Type your date of birth as MM / DD / YYYY');
      const tab = open ? window.open('', '_blank') : null;
      try {
        const handoff = await api.join(session.id, token, { legalName: basics.legalName.trim(), dateOfBirth, zip: basics.zip.trim(), street: basics.street.trim() });
        if (tab) {
          tab.opener = null;
          tab.location.href = handoff.url;
        }
        setPhoneQr(false);
        go({ k: 'join2', token, handoff, split });
      } catch (e) {
        tab?.close();
        throw e;
      }
    });
  const openJoinWindow = (url: string) => {
    const tab = window.open(url, '_blank');
    if (tab) tab.opener = null;
  };

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
        if (verified.person.kind === 'new') return go({ k: 'new', contact: verified.person.contact, token: verified.token, join: verified.person.join });
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
    <button type="button" className="pw-btn" disabled={busy} onClick={() => payByCard()}>
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
            <button type="button" className="ci-link pay-link" disabled={busy} onClick={() => payByCard()}>
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
        {step.joined ? <p className="pw-step">Step 3 of 3</p> : null}
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
    const split = step.join?.split ?? null;
    return (
      <Body>
        <p className="pw-h">You’re new to Clear</p>
        <p className="pw-d">{step.contact} is confirmed. The order is the same either way.</p>
        {step.join ? (
          <button type="button" className="pw-choice pay-choice on" disabled={busy} onClick={() => go({ k: 'join1', token: step.token, split })}>
            <div>
              <p className="t">{joinTitle(split)}</p>
              <p className="det">{joinDet(split)}</p>
            </div>
            <Chevron />
          </button>
        ) : null}
        {session.methods.card ? (
          <button type="button" className="pw-choice pay-choice" disabled={busy} onClick={() => payByCard(step.token)}>
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

  // ---- Join, step 1 of 3: the basics (§3) --------------------------------------------------------
  if (step.k === 'join1') {
    const field = (k: keyof typeof basics) => (e: ChangeEvent<HTMLInputElement>) => setBasics((b) => ({ ...b, [k]: k === 'dob' ? dobMask(e.target.value) : k === 'zip' ? e.target.value.replace(/\D/g, '').slice(0, 5) : e.target.value }));
    const filled = basics.legalName.trim().length >= 2 && dobToIso(basics.dob) && /^\d{5}$/.test(basics.zip) && basics.street.trim().length >= 3;
    return (
      <Body>
        <p className="pw-step">Step 1 of 3</p>
        <p className="pw-h">Join Clear</p>
        <p className="pw-d">The basics first. Two quick checks come next.</p>
        <form
          className="pay-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (filled) void startJoin(step.token, step.split, false);
          }}
        >
          <label className="pw-f">
            <span>Legal name</span>
            <input className="sa-in pay-in" autoComplete="name" value={basics.legalName} onChange={field('legalName')} />
          </label>
          <div className="pw-two">
            <label className="pw-f">
              <span>Date of birth</span>
              <input className="sa-in pay-in" inputMode="numeric" autoComplete="bday" placeholder="MM / DD / YYYY" value={basics.dob} onChange={field('dob')} />
            </label>
            <label className="pw-f">
              <span>ZIP</span>
              <input className="sa-in pay-in" inputMode="numeric" autoComplete="postal-code" value={basics.zip} onChange={field('zip')} />
            </label>
          </div>
          <label className="pw-f">
            <span>Street address</span>
            <input className="sa-in pay-in" autoComplete="street-address" value={basics.street} onChange={field('street')} />
          </label>
          <button type="submit" className="pw-btn k" disabled={busy || !filled}>
            Continue
          </button>
        </form>
        <Err text={error} />
      </Body>
    );
  }

  // ---- Join, step 2 of 3: the Clear window (§3, with the approved line) -------------------------
  if (step.k === 'join2') {
    const ranOut = error !== null && error.startsWith('The window’s link ran out');
    return (
      <Body>
        <p className="pw-step">Step 2 of 3</p>
        <p className="pw-h">Confirm it’s you</p>
        <p className="pw-d">Your SSN, a photo of your ID and your bank’s sign-in need their own window. Finish there and this page moves on.</p>
        <div className="pw-kv">
          <div className="kv">
            <span>Photo of your ID</span>
            <span className="v">About 1 min</span>
          </div>
          <div className="kv">
            <span>Link your bank</span>
            <span className="v">About 1 min</span>
          </div>
        </div>
        <button type="button" className="pw-btn k" disabled={busy} onClick={() => (ranOut ? void startJoin(step.token, step.split, true) : openJoinWindow(step.handoff.url))}>
          {ranOut ? 'Open a new window' : 'Continue in a new window'}
        </button>
        {/* On a computer only: the same link as a QR, for a phone. Never a QR on a phone. */}
        {layout === 'modal' ? (
          phoneQr && !ranOut ? (
            <div className="pay-qr">
              <QRCodeSVG value={step.handoff.url} size={148} marginSize={0} title="Open this on your phone" />
              <p className="pw-note">Scan it with your phone’s camera. This page moves on when you’re done there.</p>
            </div>
          ) : (
            <p className="pw-note">
              On a computer you can also{' '}
              <button type="button" className="ci-link pay-link" onClick={() => setPhoneQr(true)}>
                finish on your phone
              </button>
              .
            </p>
          )
        ) : null}
        {session.methods.card ? (
          <>
            <div className="pw-or">
              <span>or</span>
            </div>
            <button type="button" className="pw-btn" disabled={busy} onClick={() => payByCard(step.token)}>
              Pay by card
            </button>
          </>
        ) : null}
        <Err text={error} />
      </Body>
    );
  }

  // ---- Joined, and this one by card (not drawn) ----------------------------------------------------
  if (step.k === 'joined') {
    return (
      <Body>
        <p className="pw-h">You’re in</p>
        <p className="pw-d">Welcome to Clear. Splitting opens once your checks finish, so pay this one by card.</p>
        {session.methods.card ? (
          <button type="button" className="pw-btn k" disabled={busy} onClick={() => payByCard(step.token, true)}>
            Pay {money(total)} by card
          </button>
        ) : (
          <p className="pw-note">Card isn’t on for {shop}. You can approve this in Clear once your checks finish.</p>
        )}
        {cardPointsNote(session.rewardsName ?? null) ? <p className="pw-note">{cardPointsNote(session.rewardsName ?? null)}</p> : null}
        <Err text={error} />
      </Body>
    );
  }

  // ---- Pay by card (§3) ----------------------------------------------------------------------------
  if (step.k === 'card') {
    return (
      <Body
        foot={
          <button type="button" className="ci-link pay-link" onClick={() => go({ k: layout === 'sheet' ? 'start' : 'enter' })}>
            Pay another way
          </button>
        }
      >
        <CardStep api={api} session={session} token={step.token} signedIn={step.signedIn} onPaid={(p) => paid(p, everydayName(shop))} />
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
