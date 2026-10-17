import { createHash } from 'node:crypto';
import { getPostgresPool } from '../../../config/postgres.js';
import type { Db } from '../../../db/db.js';
import { approveCharge } from '../../chargeService.js';
import { chargeStore } from '../../chargeStore.js';
import { grantStarterLimit } from '../../credit/termLimitService.js';
import { readChainCredit } from '../../chain/creditReader.js';
import { notificationStore } from '../../notificationStore.js';
import { sendNotificationService } from '../../sendNotificationService.js';
import { stepUpStore } from '../../stepUp/stepUpStore.js';
import { connectorForShop } from '../cards/registry.js';
import { clearChargesFor } from '../orders/clearCharges.js';
import type { OrderDeps } from '../orders/orderService.js';
import type { Contact, FrameDeps, PayMember } from './frame.js';

/**
 * The modal's real connections (services/merchant/pay/frame.ts): Clear's members (main database), its
 * texts and email, the Clear app's notifications, the charge store and the chain. Tests stand in
 * their own.
 */

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

/** The hashes a member's phone or email may be stored under (memberStore strips spaces only). */
function hashesOf(c: Contact): string[] {
  if (c.channel === 'email') return [...new Set([c.value, c.value.toLowerCase()])].map(sha);
  const digits = c.value.replace(/\D/g, '');
  const national = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits;
  return [...new Set([c.value, digits, `+${digits}`, national])].map(sha);
}

const firstWord = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'there';

async function memberWhere(where: string, params: unknown[]): Promise<PayMember | null> {
  const pool = getPostgresPool();
  if (!pool) return null;
  const r = await pool.query<{ wallet: string; did: string | null; display_name: string | null; username: string | null }>(
    `SELECT m.primary_wallet AS wallet, m.reown_profile_uuid AS did, pub.display_name, pub.username
       FROM members m
       LEFT JOIN member_profile_private p ON p.member_id = m.id
       LEFT JOIN member_profile_public pub ON pub.member_id = m.id
      WHERE ${where} AND m.primary_wallet IS NOT NULL
      LIMIT 1`,
    params,
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    wallet: String(row.wallet).toLowerCase(),
    firstName: firstWord(row.display_name ?? row.username),
    hasPasskey: row.did ? await stepUpStore.enrolled(row.did).catch(() => false) : false,
  };
}

export function defaultFrameDeps(db: Db, orders: OrderDeps): FrameDeps {
  return {
    orders,
    clear: clearChargesFor(db),
    card: (merchant) => connectorForShop(db, merchant),
    findMember: (c) =>
      c.channel === 'email'
        ? memberWhere('(p.email_hash = ANY($1) OR m.reown_email_hash = ANY($1))', [hashesOf(c)])
        : memberWhere('(p.phone_hash = ANY($1) OR m.reown_phone_hash = ANY($1))', [hashesOf(c)]),
    memberByWallet: (wallet) => memberWhere('lower(m.primary_wallet) = $1', [wallet.toLowerCase()]),
    async sendCode({ contact, code, link, shopName, amount }) {
      if (contact.channel === 'phone') {
        await sendNotificationService.sendShopText({ to: contact.value, message: `${code} is your Clear code for ${amount} at ${shopName}. Or approve it here: ${link} It runs out in 10 minutes.` });
      } else {
        await sendNotificationService.sendEmail({
          to: contact.value,
          subject: `Your Clear code: ${code}`,
          body: `${code} is your code for ${amount} at ${shopName}.\n\nOr approve it in Clear: ${link}\n\nIt runs out in 10 minutes. If you didn’t ask for it, you can ignore this email.`,
        });
      }
    },
    async notifyApp({ wallet, shopName, amount, link, dedupe }) {
      await notificationStore.emit({
        wallet,
        kind: 'request',
        title: `${shopName} is asking for ${amount}`,
        body: 'Online. Approve or decline. You haven’t been charged yet.',
        data: { url: link },
        dedupeKey: dedupe,
      });
    },
    attachCharge: async (code, wallet) => Boolean(await chargeStore.attachMember(code, wallet)),
    approveCharge: async (code, wallet, installments) => {
      const r = await approveCharge(code, wallet, installments);
      return r.ok ? { ok: true } : { ok: false, reason: r.reason ?? 'It couldn’t be approved' };
    },
    async creditAvailable(wallet) {
      const credit = await readChainCredit(wallet);
      return credit.complete && credit.term ? credit.term.availableCents : null;
    },
    // A linked bank's name isn't kept with its Plaid item yet, so "Clears from" waits for it.
    bankLabel: async () => null,
    grantStarterLimit: (wallet) => grantStarterLimit(wallet),
    planOf: async (code) => {
      const charge = await chargeStore.get(code);
      return charge ? { installments: charge.splitInto } : null;
    },
  };
}
