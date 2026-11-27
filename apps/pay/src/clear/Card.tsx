import type { CardStarted, PaidView, PaySession } from '@clear/merchant-contracts';
import { loadStripe, type Stripe, type StripeElements } from '@stripe/stripe-js';
import { useEffect, useRef, useState } from 'react';
import type { PayApi } from '../lib/api';
import { cardByLine, cardPointsNote, money } from './model';

/**
 * Pay by card (pay spec §3): Stripe's fields inside Clear's frame, on the shop's own Stripe account.
 * The payment is started on the server (its amount is the order's, Clear's fee set there); the fields
 * only confirm it. A declined card stays here to try another, on the same payment.
 *
 * The preview has no Stripe: a `pk_preview` key draws the spec's own fields, so the frame can be seen.
 */

const POLL_MS = 1500;
const key = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
export const isPreviewKey = (pk: string) => pk.startsWith('pk_preview');

/** The fields in Clear's look: square, Clear's ink, the system's type. */
const appearance = {
  theme: 'flat' as const,
  variables: { borderRadius: '0px', colorPrimary: '#16211D', colorText: '#16211D', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', fontSizeBase: '15px' },
};

function PreviewFields() {
  return (
    <>
      <label className="pw-f">
        <span>Card number</span>
        <div className="sa-in mute">1234 1234 1234 1234</div>
      </label>
      <div className="pw-two">
        <label className="pw-f">
          <span>Expiry</span>
          <div className="sa-in mute">MM / YY</div>
        </label>
        <label className="pw-f">
          <span>CVC</span>
          <div className="sa-in mute">123</div>
        </label>
      </div>
    </>
  );
}

export function CardStep({
  api,
  session,
  token,
  signedIn,
  onPaid,
}: {
  api: PayApi;
  session: PaySession;
  /** The payment-scoped token when someone signed in: a member's card takes their points. */
  token: string | null;
  signedIn: boolean;
  onPaid: (p: PaidView) => void;
}) {
  const [started, setStarted] = useState<CardStarted | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const mount = useRef<HTMLDivElement>(null);
  const stripe = useRef<Stripe | null>(null);
  const elements = useRef<StripeElements | null>(null);
  const idem = useRef(key());

  // The payment, once; asking again after a decline picks the same one up.
  useEffect(() => {
    let live = true;
    api.card(session.id, idem.current, token).then(
      (s) => live && setStarted(s),
      (e: unknown) => live && setError(e instanceof Error ? e.message : 'Card isn’t available right now.'),
    );
    return () => {
      live = false;
    };
  }, [api, session.id, token]);

  // Stripe's fields, on the shop's account.
  useEffect(() => {
    if (!started || isPreviewKey(started.publishableKey) || !mount.current) return;
    let live = true;
    void loadStripe(started.publishableKey, { stripeAccount: started.stripeAccount }).then((s) => {
      if (!live || !s || !mount.current) return;
      stripe.current = s;
      const els = s.elements({ clientSecret: started.clientSecret, appearance });
      elements.current = els;
      const field = els.create('payment', { layout: 'tabs' });
      field.on('ready', () => setReady(true));
      field.mount(mount.current);
    });
    return () => {
      live = false;
      elements.current?.getElement('payment')?.destroy();
    };
  }, [started]);

  /** Paid shows up on the session once Stripe's event lands: ask until it has. */
  const waitForPaid = async () => {
    for (let i = 0; i < 40; i++) {
      const s = await api.status(session.id).catch(() => null);
      if (s?.state === 'paid' && s.paid) return onPaid(s.paid);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    setError('Your card went through. This is taking a moment to show; you can close this.');
  };

  const pay = async () => {
    if (!started) return;
    setBusy(true);
    setError(null);
    try {
      if (isPreviewKey(started.publishableKey)) return await waitForPaid();
      if (!stripe.current || !elements.current) return;
      const result = await stripe.current.confirmPayment({
        elements: elements.current,
        redirect: 'if_required',
        // Only for the few ways to pay that leave the page; the frame then says it's paid.
        confirmParams: { return_url: `${window.location.origin}${window.location.pathname}?paid=1` },
      });
      if (result.error) {
        setError(result.error.message ?? 'That card didn’t go through. Try another.');
        return;
      }
      await waitForPaid();
    } finally {
      setBusy(false);
    }
  };

  const preview = started ? isPreviewKey(started.publishableKey) : false;
  return (
    <>
      <p className="pw-h">Pay by card</p>
      <div className="pw-stripe">
        {preview ? <PreviewFields /> : <div ref={mount} className="pay-stripe" aria-busy={!ready} />}
        <p className="pw-by">{cardByLine(session.shop.name)}</p>
      </div>
      <button type="button" className="pw-btn k" disabled={busy || !started || (!preview && !ready)} onClick={() => void pay()}>
        Pay {money(started?.amountCents ?? session.order.totalCents)}
      </button>
      {!signedIn && cardPointsNote(session.rewardsName ?? null) ? <p className="pw-note">{cardPointsNote(session.rewardsName ?? null)}</p> : null}
      {error ? (
        <p className="pw-note pay-err" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
