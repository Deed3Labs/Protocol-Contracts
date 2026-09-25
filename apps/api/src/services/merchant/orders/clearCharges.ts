import { raiseChargeFromDevice } from '../../chargeService.js';
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
  };
}
