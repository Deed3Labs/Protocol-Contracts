import { useState } from 'react';
import type { Reconciliation, ReconciliationFlag } from '@clear/merchant-contracts';
import { Sheet, cx } from '@/brand/ui';
import { usd } from '@/home/model';

/**
 * Payouts › Checked against Stripe: the nightly reconciliation, where the shop's books and the card
 * processor disagree. Not drawn in the reference; it takes a cell's shape. Each flag says, in plain
 * words, what doesn't match and by how much, and an owner or manager explains it once they've
 * looked (it then stays closed while its figures hold).
 */

/** What each kind of flag means, for someone who isn't an accountant. */
export const FLAG_TITLE: Record<string, string> = {
  charge_without_tender: 'Stripe took a payment no sale accounts for',
  tender_without_charge: 'A card sale Stripe has no charge for',
  amount_mismatch: 'A card charge differs from its sale',
  fee_mismatch: 'Clear’s fee on a card sale differs',
  payout_unbooked: 'A payout that isn’t in the books',
  payout_mismatch: 'A payout differs from the books',
  payout_breakdown: 'A payout that can’t be broken down',
  fee_bill_unconfirmed: 'Clear’s fee bill wasn’t seen to land',
  card_stranded: 'A card that couldn’t be captured',
};
export const flagTitle = (f: ReconciliationFlag) => FLAG_TITLE[f.kind] ?? 'Something doesn’t match';

/** "Expected $189.00 · found $187.00", or the one figure there is. */
export function flagFigures(f: ReconciliationFlag): string {
  if (f.expectedCents !== null && f.actualCents !== null) return `Expected ${usd(f.expectedCents)} · found ${usd(f.actualCents)}`;
  if (f.expectedCents !== null) return usd(f.expectedCents);
  if (f.actualCents !== null) return usd(f.actualCents);
  return '';
}

const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export function ReconcileCell({ r, onExplain }: { r: Reconciliation; onExplain?: (f: ReconciliationFlag) => void }) {
  const [showExplained, setShowExplained] = useState(false);
  const n = r.open.length;
  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">Checked against Stripe</p>
          {n ? (
            <span className="c-chip c-underway">
              <span className="c-core" />
              {n} to look at
            </span>
          ) : (
            <span className="c-det">Every night</span>
          )}
        </div>
      </div>
      <div className="c-cmain">
        {n === 0 ? (
          <p className="c-det" style={{ margin: 0 }}>
            Everything matches: every card sale, fee and payout is in the books as Stripe has it.
          </p>
        ) : (
          <div className="c-rows">
            {r.open.map((f) => (
              <div key={f.id}>
                <div className="c-line" style={{ alignItems: 'center' }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>{flagTitle(f)}</p>
                    <p className="c-det" style={{ marginTop: 3 }}>
                      {[flagFigures(f), `since ${when(f.foundAt)}`].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {onExplain && (
                    <button type="button" className="c-btn" onClick={() => onExplain(f)}>
                      Explain
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {showExplained && r.explained.length > 0 && (
          <div className="c-rows" style={{ marginTop: 'var(--s2)' }}>
            {r.explained.map((f) => (
              <div key={f.id}>
                <div className="c-line">
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>{flagTitle(f)}</p>
                    <p className="c-det" style={{ marginTop: 3 }}>
                      “{f.explained!.note}” · {f.explained!.by}, {when(f.explained!.at)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="c-cfoot">
        <div className="c-line" style={{ alignItems: 'center' }}>
          <span className="c-det">Found each night. A flag closes when it no longer shows, or once it’s explained.</span>
          {r.explained.length > 0 && (
            <button type="button" className={cx('c-btn', showExplained && 'c-on')} aria-pressed={showExplained} onClick={() => setShowExplained(!showExplained)}>
              {showExplained ? 'Hide explained' : `Explained · ${r.explained.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ExplainFlagSheet({ f, onSave, onClose }: { f: ReconciliationFlag; onSave: (note: string) => Promise<unknown>; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = note.trim().length >= 3;
  return (
    <Sheet
      title="What happened?"
      onClose={onClose}
      foot={
        <>
          {error && (
            <p className="c-det" role="alert" style={{ color: 'var(--absent)', margin: '0 0 var(--s1)' }}>
              {error}
            </p>
          )}
          <button
            type="button"
            className="c-btn c-btn-primary c-btn-lg"
            style={{ width: '100%' }}
            disabled={!ok || busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              onSave(note.trim())
                .catch((e: unknown) => setError(e instanceof Error ? e.message : 'That didn’t save. Try again.'))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? 'Saving…' : 'Mark as explained'}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 'var(--t-sec)', fontWeight: 500 }}>{flagTitle(f)}</p>
      {flagFigures(f) && (
        <p className="c-det" style={{ marginTop: 3 }}>
          {flagFigures(f)}
        </p>
      )}
      <p className="c-det" style={{ marginTop: 'var(--s2)' }}>
        {f.detail}.
      </p>
      <p className="c-label" style={{ margin: 'var(--s3) 0 6px' }}>
        Your note
      </p>
      <textarea
        className="c-field"
        aria-label="Your note"
        rows={3}
        maxLength={500}
        autoFocus
        placeholder="Captured it in Stripe before the hold lapsed"
        value={note}
        style={{ width: '100%', resize: 'vertical', font: 'inherit', padding: 10 }}
        onChange={(e) => setNote(e.target.value)}
      />
      <p className="c-det" style={{ marginTop: 'var(--s1)' }}>
        It stays closed while the figures stay the same. If they change, it shows again.
      </p>
    </Sheet>
  );
}
