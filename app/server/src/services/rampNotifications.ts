import { notificationStore, type NotificationKind } from './notificationStore.js';
import { onramperStore } from './onramperStore.js';

/*
 * Shared ramp (on/off-ramp) status → notification mapping. Used by the client-driven /api/ramp/event
 * endpoint AND the Coinbase webhook, so a deposit/cash-out reads the same regardless of source. Deduped
 * per (ref, status) — when both the client poll and the webhook report the same terminal status with the
 * same Coinbase transaction id as the ref, only one notification is created.
 */
export type RampType = 'buy' | 'sell';
export type RampStatus = 'submitted' | 'completed' | 'failed';

const RAMP_NOTIFS: Record<string, { kind: NotificationKind; title: string; body: (amt: string) => string }> = {
  'buy:submitted': { kind: 'pending', title: 'Deposit started', body: (a) => `Your ${a} top-up is processing.` },
  'buy:completed': { kind: 'received', title: 'Money added', body: (a) => `${a} landed in your balance.` },
  'buy:failed': { kind: 'system', title: 'Deposit didn’t go through', body: (a) => `Your ${a} top-up didn’t complete.` },
  'sell:submitted': { kind: 'sent', title: 'Cash-out on its way', body: (a) => `${a} is being sent to your card.` },
  'sell:completed': { kind: 'sent', title: 'Cash-out complete', body: (a) => `${a} has been paid out to your card.` },
  'sell:failed': { kind: 'system', title: 'Cash-out failed', body: (a) => `Your ${a} cash-out didn’t complete.` },
};

/** Record a ramp order's status + emit the matching notification (idempotent by ref+status). */
export async function emitRampStatus(input: { wallet: string; type: RampType; status: RampStatus; amount: number; ref: string }): Promise<void> {
  const wallet = String(input.wallet || '').toLowerCase();
  const spec = RAMP_NOTIFS[`${input.type}:${input.status}`];
  if (!spec || !input.ref || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) return;
  const amt = input.amount > 0 ? `$${input.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Your';
  await onramperStore
    .upsert({ id: `cb:${input.ref}`, wallet, status: input.status, provider: 'coinbase', fiatAmount: input.amount || null, cryptoAmount: null, raw: { type: input.type, ref: input.ref } })
    .catch(() => {});
  await notificationStore
    .emit({
      wallet,
      kind: spec.kind,
      title: spec.title,
      body: spec.body(amt),
      data: { type: input.type, status: input.status, amount: input.amount || null, href: input.type === 'sell' ? '/transactions' : '/' },
      dedupeKey: `ramp:${input.ref}:${input.status}`,
    })
    .catch(() => {});
}
