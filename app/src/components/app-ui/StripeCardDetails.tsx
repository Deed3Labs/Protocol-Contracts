import { useEffect, useRef, useState } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { createCardEphemeralKey } from '@/utils/apiClient';

/*
 * Renders the live Clear card number/expiry/CVV via Stripe Issuing Elements — the PCI-compliant iframe,
 * so the raw PAN never touches our DOM/logs. Inert unless VITE_STRIPE_PUBLISHABLE_KEY is set.
 *
 * Flow (Stripe.js issuing): client nonce → backend ephemeral key → mount issuing display elements.
 * TODO(verify-on-activation): the issuing-element calls aren't in the standard @stripe/stripe-js types,
 * so they're cast; confirm the exact method names + the apiVersion (must match the backend Stripe SDK)
 * against a live test card once STRIPE_SECRET_KEY / VITE_STRIPE_PUBLISHABLE_KEY are set.
 */
const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
const STRIPE_API_VERSION = (import.meta.env.VITE_STRIPE_API_VERSION as string | undefined) || '2024-06-20';

let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> | null {
  if (!PUBLISHABLE_KEY) return null;
  if (!stripePromise) stripePromise = loadStripe(PUBLISHABLE_KEY);
  return stripePromise;
}

export function stripeCardsConfigured(): boolean {
  return !!PUBLISHABLE_KEY;
}

export default function StripeCardDetails({ cardId }: { cardId: string }) {
  const numberRef = useRef<HTMLDivElement>(null);
  const expiryRef = useRef<HTMLDivElement>(null);
  const cvcRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const p = getStripe();
    if (!p) return;
    let cancelled = false;
    (async () => {
      try {
        const stripe = await p;
        if (!stripe || cancelled) return;
        // Issuing-specific APIs aren't in the public types — cast narrowly.
        const s = stripe as unknown as {
          createEphemeralKeyNonce: (o: { issuingCard: string }) => Promise<{ nonce: string }>;
          elements: () => { create: (type: string, opts: Record<string, unknown>) => { mount: (el: HTMLElement) => void } };
        };
        const { nonce } = await s.createEphemeralKeyNonce({ issuingCard: cardId });
        const key = await createCardEphemeralKey({ nonce, apiVersion: STRIPE_API_VERSION });
        if (!key || cancelled) {
          setError(true);
          return;
        }
        const elements = s.elements();
        const style = { base: { color: '#ffffff', fontSize: '16px', fontFamily: 'ui-monospace, monospace' } };
        const opts = { issuingCard: cardId, nonce, ephemeralKeySecret: key.secret, style };
        if (numberRef.current) elements.create('issuingCardNumberDisplay', opts).mount(numberRef.current);
        if (expiryRef.current) elements.create('issuingCardExpiryDisplay', opts).mount(expiryRef.current);
        if (cvcRef.current) elements.create('issuingCardCvcDisplay', opts).mount(cvcRef.current);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  if (error) return <div className="text-xs text-white/70">Card details are temporarily unavailable.</div>;

  return (
    <div className="space-y-2">
      <div ref={numberRef} className="font-mono text-white/90" />
      <div className="flex gap-6 text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-white/50">Exp</div>
          <div ref={expiryRef} className="font-mono text-white/90" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-white/50">CVV</div>
          <div ref={cvcRef} className="font-mono text-white/90" />
        </div>
      </div>
    </div>
  );
}
