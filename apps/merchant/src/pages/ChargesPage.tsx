import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHARGE_LABEL, countsAsVolume, dollars, isPending } from '@clear/domain';
import { Card, Pill } from '@/shell/ui';
import { api, type MerchantCharge } from '@/data/apiClient';
import { useApi } from '@/data/useApi';

/**
 * Charges — reference section 06.
 *
 * The list a writer opens to answer one of two questions: **who has not confirmed**, and **what
 * did we run today**. Everything here serves one of those.
 *
 * Waiting rows sort to the top regardless of time, because they are the only rows with an action
 * attached, and they carry the accent background so the answer to the first question is visible
 * without reading.
 *
 * No hero figure. This is a list that either has rows or carries a one-line empty state — only
 * Home needs a number holding open a half-empty screen.
 */

type Filter = 'waiting' | 'today' | 'month';

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

/** "2:14pm" today, "Yesterday" before that — a writer does not need the clock time of last week. */
function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (isToday(iso)) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');
  }
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * The third fragment of a row's second line.
 *
 * Waiting says how it was sent, because that is what a writer needs to decide whether to chase.
 * Confirmed says the split — the merchant's only signal of how the customer is managing it, useful
 * context with no action attached. Expired says nothing further; the state is the whole story.
 */
function detailOf(c: MerchantCharge): string | null {
  if (isPending(c.state)) return 'sent by text, email, app';
  if (c.state !== 'approved') return null;
  if (c.splitInto === null) return null;
  return c.splitInto === 1 ? 'in full' : `split in ${c.splitInto}`;
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-[8px] border-[0.5px] bg-[var(--clear-surface-2)] px-3 py-[5px] text-[12px]',
        active
          ? 'border-[var(--clear-border-accent)] text-[var(--clear-text-accent)]'
          : 'border-[var(--clear-border-strong)] text-[var(--clear-text-primary)]',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

export default function ChargesPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('today');
  // The month is the widest thing any filter shows, so it is fetched once and narrowed here rather
  // than re-queried per chip — switching filters should not cost a round trip at a counter.
  const { data, loading, error } = useApi(() => api.charges({ limit: 200 }), []);
  const all = data ?? [];

  const waiting = all.filter((c) => isPending(c.state));
  const todays = all.filter((c) => isToday(c.createdAt));

  const rows = (filter === 'waiting' ? waiting : filter === 'today' ? todays : all)
    .slice()
    // Waiting first regardless of time — they are the only rows that need an action. Then newest.
    .sort((a, b) => {
      const p = Number(isPending(b.state)) - Number(isPending(a.state));
      return p !== 0 ? p : Date.parse(b.createdAt) - Date.parse(a.createdAt);
    });

  // Same rule as Home: the strip counts what the shop is actually owed, not every row raised.
  const countedToday = todays.filter((c) => countsAsVolume(c.state));
  const todayTotal = countedToday.reduce((sum, c) => sum + c.amount, 0);

  return (
    <>
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-[7px]">
          <FilterChip
            label={`Waiting · ${waiting.length}`}
            active={filter === 'waiting'}
            onClick={() => setFilter('waiting')}
          />
          <FilterChip label="Today" active={filter === 'today'} onClick={() => setFilter('today')} />
          <FilterChip
            label="This month"
            active={filter === 'month'}
            onClick={() => setFilter('month')}
          />
        </div>
        <span className="text-[12.5px] text-[var(--clear-text-muted)]">
          {countedToday.length} charges today · {dollars(todayTotal)}
        </span>
      </div>

      {error ? (
        <Card>
          {/* Every failure leaves the writer something to say. */}
          <p className="m-0 text-[13px] text-[var(--clear-text-secondary)]">{error}</p>
        </Card>
      ) : loading ? (
        <Card>
          <p className="m-0 text-[13px] text-[var(--clear-text-muted)]">Loading…</p>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <p className="m-0 text-[13px] text-[var(--clear-text-muted)]">
            {filter === 'waiting' ? 'Nothing waiting.' : 'No charges yet.'}
          </p>
        </Card>
      ) : (
        <Card rows className="!px-4 !py-0">
          {rows.map((c) => {
            const pending = isPending(c.state);
            const detail = detailOf(c);
            return (
              <button
                key={c.code}
                type="button"
                onClick={() => navigate(`/charges/${c.code}`)}
                className={[
                  'flex items-center justify-between gap-3 border-b-[0.5px] border-[var(--clear-border)] py-3 text-left text-[13px] last:border-b-0',
                  // The accent field is how "who has not confirmed" is answered without reading, so
                  // it has to bleed to BOTH card edges. The width is conditional rather than
                  // additive: emitting `w-full` alongside the calc leaves CSS order to decide, and
                  // `w-full` wins — the field then stops short on the right by exactly the padding.
                  // The card is padded 0 16px, so the accent field bleeds by exactly that to reach
                  // both edges. The width is conditional rather than additive: emitting `w-full`
                  // alongside the calc leaves CSS order to decide, and `w-full` wins.
                  pending
                    ? '-mx-4 w-[calc(100%+2rem)] bg-[var(--clear-bg-accent)] px-4'
                    : 'w-full',
                ].join(' ')}
              >
                <span className="min-w-0">
                  <span className={`block truncate ${pending ? 'font-medium' : ''}`}>
                    {c.memberName ?? 'Not opened yet'}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-[var(--clear-text-muted)]">
                    {/* Each row names who raised it. Not surveillance — it is how an owner works
                        out which writer is actually offering it. */}
                    {whenLabel(c.createdAt)} · {c.raisedBy ?? '—'}
                    {detail ? ` · ${detail}` : ''}
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-3">
                  <span
                    className={`tabular-nums ${
                      c.state === 'expired' || c.state === 'declined'
                        ? 'text-[var(--clear-text-muted)]'
                        : ''
                    }`}
                  >
                    {dollars(c.amount)}
                  </span>
                  {pending ? (
                    <Pill tone="pending">Waiting</Pill>
                  ) : (
                    <span className="w-[62px] text-right text-[11.5px] text-[var(--clear-text-muted)]">
                      {/* Expired is a visible state, not a silent disappearance: a charge that
                          timed out is a lost sale the shop should be able to follow up. */}
                      {/* One mapping, in the domain, shared with charge detail. This was a
                          ternary chain that fell through to "Declined" for anything it did not
                          name — so a charge the shop cancelled itself was reported back to them
                          as the customer refusing it, which is a different and worse story. */}
                      {CHARGE_LABEL[c.state]}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </Card>
      )}

      <p className="m-0 mt-[13px] text-[11.5px] text-[var(--clear-text-muted)]">
        Tap any charge for the fee, the payout date, or to cancel one still waiting.
      </p>
    </>
  );
}
