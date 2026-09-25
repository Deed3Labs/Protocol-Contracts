import { notifyMember, raiseChargeFromDevice } from '../../chargeService.js';
import { sendNotificationService } from '../../sendNotificationService.js';
import { chargeStore } from '../../chargeStore.js';
import type { Db } from '../../../db/db.js';
import type { ClearCharges } from './payments.js';

/**
 * The Clear charge flow, as the merchant back office's Clear tenders use it: the same
 * `raiseChargeFromDevice` the counter's Clear screen uses (the registry decides terms and the cap),
 * and the charge store for where a charge stands.
 */
export function clearChargesFor(db: Db): ClearCharges {
  return {
    async raise({ merchant, amountCents, raisedBy }) {
      const { rows } = await db.query<{ name: string }>('SELECT name FROM merchant.profiles WHERE merchant = $1', [merchant]);
      const r = await raiseChargeFromDevice({ merchant, merchantName: rows[0]?.name ?? 'A Clear partner', amountCents, raisedBy });
      return r.ok && r.charge ? { ok: true, code: r.charge.code } : { ok: false, reason: r.reason ?? 'the charge could not be raised' };
    },
    async status(code) {
      const charge = await chargeStore.get(code);
      if (!charge) return null;
      switch (charge.status) {
        case 'pending':
        case 'resolving':
          return 'pending';
        // Approved, and whatever the Clear refund or dispute flows did afterwards: the tender was paid.
        case 'approved':
        case 'refunded':
        case 'disputed':
          return 'approved';
        case 'declined':
        case 'expired':
        case 'cancelled':
          return charge.status;
        default:
          return 'other';
      }
    },
    async cancel(code, merchant) {
      return Boolean(await chargeStore.cancel(code, merchant));
    },
    async sendTo(code, to) {
      if ('member' in to) {
        // Their code said who they are: the charge becomes theirs, in their app and by text, as if
        // they'd scanned the tablet. Only while nobody has it and it's still waiting.
        const charge = await chargeStore.attachMember(code, to.member);
        if (!charge) return { ok: false, reason: 'That charge has gone to someone already, or it has ended' };
        await notifyMember(charge);
        return { ok: true, label: 'their Clear app' };
      }
      const charge = await chargeStore.get(code);
      if (!charge || charge.status !== 'pending') return { ok: false, reason: 'That charge has ended' };
      const base = (process.env.APP_PUBLIC_URL || 'https://app.useclear.org').replace(/\/+$/, '');
      const sent = await sendNotificationService.sendChargeAlert({
        recipientType: 'phone',
        recipientContact: to.phone,
        merchantName: charge.merchantName,
        amount: (charge.amountCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
        approveUrl: `${base}/c/${charge.code}`,
      });
      if (!sent) return { ok: false, reason: 'The text couldn’t be sent. Check the number, or have them scan the code.' };
      const d = to.phone.replace(/\D/g, '');
      return { ok: true, label: to.phone.startsWith('+1') && d.length === 11 ? `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : to.phone };
    },
  };
}
