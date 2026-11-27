import { useCallback, useEffect, useState } from 'react';
import type { Receipt } from '@clear/merchant-contracts';
import { Lockup } from '@/brand/ui';
import { usd } from '@/charge/model';
import { BASE } from '@/data/apiClient';
import { PREVIEW_RECEIPT } from './preview';

/**
 * The receipt a customer opens from a text or an email: `/r/<token>`.
 *
 * Public, and nothing like the rest of the app: no sign-in, no device, no shift. It renders before
 * the app's auth and wallet code runs (main.tsx), so a customer's phone loads only this. The token
 * in the link is the whole key; the API answers with this one receipt and nothing else.
 *
 * It is the printed slip (charge/card.tsx, PrintReceiptSheet) at phone width: the shop, the lines,
 * the discount, tax, tip, the total and how it was paid. Built from the order when opened, so a
 * refund made after the sale shows here. Cards show brand and last four only.
 *
 * Not drawn in the reference files; it follows the slip the New Charge reference draws.
 */

type Load = { state: 'loading' } | { state: 'ready'; receipt: Receipt } | { state: 'missing' } | { state: 'error' };

const whenLabel = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(' AM', 'am').replace(' PM', 'pm');

const METHOD: Record<Receipt['tenders'][number]['method'], string> = { card: 'Card', cash: 'Cash', clear: 'Clear' };

export function ReceiptPage({ token }: { token: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  const fetchIt = useCallback(async () => {
    // Development only: `/r/preview` shows a sample, so the page can be looked at without an API.
    if (import.meta.env.DEV && token === 'preview') {
      setLoad({ state: 'ready', receipt: PREVIEW_RECEIPT });
      return;
    }
    setLoad({ state: 'loading' });
    try {
      // No token of ours, no cookies: the link's own token is the only key.
      const res = await fetch(`${BASE}/api/merchant/receipts/${encodeURIComponent(token)}`, { credentials: 'omit' });
      if (res.status === 404) return setLoad({ state: 'missing' });
      if (!res.ok) return setLoad({ state: 'error' });
      setLoad({ state: 'ready', receipt: (await res.json()) as Receipt });
    } catch {
      setLoad({ state: 'error' });
    }
  }, [token]);

  useEffect(() => {
    void fetchIt();
  }, [fetchIt]);

  useEffect(() => {
    if (load.state === 'ready') document.title = `Receipt · ${load.receipt.shop.name}`;
  }, [load]);

  return (
    <main className="c-rcpt-page">
      <header className="c-rcpt-head">{load.state === 'ready' ? <Lockup shop={load.receipt.shop.name} small /> : <Lockup shop="Receipt" small />}</header>
      {load.state === 'loading' && (
        <p className="c-det c-rcpt-note" aria-busy="true">
          Getting your receipt…
        </p>
      )}
      {load.state === 'missing' && (
        <div className="c-rcpt-note">
          <p className="c-t">This receipt isn’t here</p>
          <p className="c-det">Check the link, or ask the shop to send it again.</p>
        </div>
      )}
      {load.state === 'error' && (
        <div className="c-rcpt-note">
          <p className="c-t">It didn’t load</p>
          <p className="c-det">That’s on our side, not yours.</p>
          <button type="button" className="c-btn" onClick={() => void fetchIt()}>
            Try again
          </button>
        </div>
      )}
      {load.state === 'ready' && <Slip r={load.receipt} />}
    </main>
  );
}

function Slip({ r }: { r: Receipt }) {
  const paid = r.tenders.filter((t) => ['authorised', 'approved', 'captured', 'partly_refunded', 'refunded'].includes(t.status));
  return (
    <article className="c-cc-slip c-rcpt-slip" aria-label={`Receipt from ${r.shop.name}`}>
      <p className="c-shop">{r.shop.name}</p>
      {r.shop.address && <p className="c-det c-c">{r.shop.address}</p>}
      <p className="c-det c-c">
        {whenLabel(r.issuedAt)}
        {r.orderNumber ? ` · Order ${r.orderNumber}` : ''}
      </p>

      {r.lines.map((l, i) => (
        <div key={i} className="c-ln c-rcpt-line">
          <span>
            {l.quantity > 1 ? `${l.quantity} × ` : ''}
            {l.name}
            {(l.options.length > 0 || l.note) && <small>{[...l.options, l.note].filter(Boolean).join(' · ')}</small>}
          </span>
          <span>{usd(l.lineCents)}</span>
        </div>
      ))}

      {r.discount && (
        <div className="c-ln c-sm">
          <span>{r.discount.label}</span>
          <span>−{usd(r.discount.amountCents)}</span>
        </div>
      )}
      {(r.discount || r.taxCents > 0) && !r.taxIncluded && (
        <div className="c-ln c-sm">
          <span>Subtotal</span>
          <span>{usd(r.subtotalCents - r.discountCents)}</span>
        </div>
      )}
      <div className="c-ln c-sm">
        <span>{r.taxIncluded ? 'Sales tax, included' : 'Sales tax'}</span>
        <span>{r.taxCents > 0 ? usd(r.taxCents) : '—'}</span>
      </div>
      {r.tipCents > 0 && (
        <div className="c-ln c-sm">
          <span>Tip</span>
          <span>{usd(r.tipCents)}</span>
        </div>
      )}
      <div className="c-ln c-tot">
        <span>Total</span>
        <span>{usd(r.totalCents + r.tipCents)}</span>
      </div>

      {paid.map((t, i) => (
        <div key={i} className="c-ln c-sm">
          <span>
            {t.card ?? METHOD[t.method]}
            {t.changeCents ? ` · change ${usd(t.changeCents)}` : ''}
          </span>
          <span>{usd(t.amountCents + t.tipCents)}</span>
        </div>
      ))}
      {r.refundedCents > 0 && (
        <div className="c-ln c-sm c-rcpt-refund">
          <span>Refunded</span>
          <span>−{usd(r.refundedCents)}</span>
        </div>
      )}

      <p className="c-det c-c c-ft">Pay over time next visit with Clear</p>
    </article>
  );
}
