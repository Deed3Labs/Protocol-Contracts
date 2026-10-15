import { useEffect, useState } from 'react';
import { phoneApi } from './api';
import { clock, day, money, orderNo } from './format';
import { Lines, Row, Total } from './rows';
import type { Receipt } from './types';

/**
 * `useclear.org/r/<code>` (terminal reference, section 12): the code on a printed receipt opens the
 * same receipt, for good. Items, tender, change and the shop, and one line about paying with Clear
 * next time, for anyone who didn't.
 */
export function ReceiptPage({ code }: { code: string }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    phoneApi.receipt(code).then(setReceipt, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [code]);
  if (error)
    return (
      <div className="tm-pbody">
        <p className="tm-psub" role="alert">
          {error}
        </p>
      </div>
    );
  if (!receipt) return null;
  const head = [receipt.orderNumber !== null ? `Order ${orderNo(receipt.orderNumber)}` : null, day(receipt.issuedAt), clock(receipt.issuedAt)].filter(Boolean).join(' · ');
  return (
    <div className="tm-pbody">
      <p className="tm-shop">{receipt.shop.name}</p>
      <p className="tm-mono">{head}</p>
      <Lines {...receipt} />
      <Total cents={receipt.totalCents} />
      {receipt.tenders.map((t, i) => (
        <TenderRows key={i} t={t} />
      ))}
      {!receipt.tenders.some((t) => t.method === 'clear') && <p className="tm-psub tm-gap">Next time, pay with Clear and the shop keeps more of it.</p>}
    </div>
  );
}

/** "Cash 50.00" (what was handed over) and "Change 4.30"; a card by its name; Clear as Clear. */
function TenderRows({ t }: { t: Receipt['tenders'][number] }) {
  const paid = t.amountCents + t.tipCents;
  if (t.method === 'cash') {
    return (
      <>
        <Row label="Cash" cents={paid + (t.changeCents ?? 0)} />
        {t.changeCents ? <Row label="Change" cents={t.changeCents} /> : null}
      </>
    );
  }
  return (
    <div className="tm-prow">
      <span>{t.method === 'card' ? (t.card ?? 'Card') : t.method === 'clear' ? 'Clear' : t.method}</span>
      <span>{money(paid)}</span>
    </div>
  );
}
