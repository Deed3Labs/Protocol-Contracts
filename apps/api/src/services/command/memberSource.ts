import { getPayPool, getPostgresPool } from '../../config/postgres.js';
import type { Queryable } from '../../db/db.js';
import { PrivyClient } from '@privy-io/server-auth';
import { memberStore } from '../memberStore.js';

/*
 * The member app's own records, for the Command Center's Members (Phase 7b), read only: who has an
 * account, the invite code their onboarding sent back, their wallets, and the milestones the money
 * shows, all keyed by wallet: their first deposit (how they funded) and their first spend at a shop
 * (a card purchase, or a charge code they approved).
 */

export interface RosterMember {
  id: number;
  createdAt: number;
  lastSeen: number | null;
  inviteCode: string | null;
  wallets: string[];
  name: string | null;
  /**
   * Only when names were asked for: their email and phone, as their private profile has them, else as their Privy
   * sign-in has them; and their smart account (the members row's primary wallet), the last thing to know them by.
   */
  email?: string | null;
  phone?: string | null;
  wallet?: string | null;
  city: string | null;
}
export interface Milestones {
  funded?: { at: number; with: 'bank' | 'deposit' };
  spend?: { at: number; shop: string };
}
/** How many members accepted one version of a document the app has them accept (counts only, never who). */
export interface TermsCount {
  doc: string;
  version: string;
  n: number;
  first: number;
  last: number;
}
export interface MemberSource {
  /** Everyone with an account; their names and cities only when asked (decrypted from the private profile). */
  roster(o: { names: boolean }): Promise<RosterMember[]>;
  /** Each wallet's first deposit and first spend. */
  milestones(wallets: string[]): Promise<Map<string, Milestones>>;
  /** Governance's agreement versions: each document version members accepted in the app, counted. */
  terms?(): Promise<TermsCount[]>;
}

const ms = (d: Date | string | null) => (d == null ? null : new Date(d).getTime());

/** Where it reads: the member app's database, the payments one, and the store that decrypts profiles. */
interface Where {
  main: () => Pick<Queryable, 'query'> | null;
  pay: () => Pick<Queryable, 'query'> | null;
  basics: (ids: number[]) => Promise<Map<number, { legalName: string | null; email?: string | null; phone?: string | null; city: string | null }>>;
  /** The email and phone a Privy account signs in with, by its DID; nothing when Privy isn't configured or can't say. */
  privy?: (did: string) => Promise<{ email: string | null; phone: string | null } | null>;
}

let privyClient: PrivyClient | null = null;
/** A member's contact as their Privy sign-in has it: an email account (or Google's, Apple's), and a phone. */
async function privyContact(did: string) {
  const id = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID || '',
    secret = process.env.PRIVY_APP_SECRET || '';
  if (!id || !secret) return null;
  privyClient ??= new PrivyClient(id, secret);
  const u = await privyClient.getUser(did);
  const email = u.email?.address ?? u.google?.email ?? u.apple?.email ?? null;
  return { email, phone: u.phone?.number ?? null };
}
const LIVE: Where = { main: getPostgresPool, pay: getPayPool, basics: (ids) => memberStore.privateBasics(ids), privy: privyContact };

export function liveMemberSource(where: Where = LIVE): MemberSource {
  return {
    async roster({ names }) {
      const pool = where.main();
      if (!pool) throw new Error('The member database isn’t configured');
      const { rows } = await pool.query<{ id: string; created_at: Date; last_authenticated_at: Date | null; invite_code: string | null; wallets: string[] | null; auth_subject: string | null; primary_wallet: string | null }>(
        `SELECT m.id, m.created_at, m.last_authenticated_at, o.invite_code, m.auth_subject, m.primary_wallet,
                array_remove(array_agg(DISTINCT lower(w.wallet_address)) || array_agg(DISTINCT lower(m.primary_wallet)), NULL) AS wallets
           FROM members m
           LEFT JOIN member_onboarding o ON o.member_id = m.id
           LEFT JOIN member_wallets w ON w.member_id = m.id
          GROUP BY m.id, o.invite_code, m.auth_subject, m.primary_wallet
          ORDER BY m.id`,
      );
      const basics = await where.basics(rows.map((r) => Number(r.id)));
      // a member whose profile has neither an email nor a phone: their Privy sign-in's, asked only when names are
      const fromPrivy = new Map<number, { email: string | null; phone: string | null }>();
      if (names && where.privy)
        for (const r of rows) {
          const b = basics.get(Number(r.id));
          if (b?.email || b?.phone || !r.auth_subject?.startsWith('did:privy:')) continue;
          const c = await where.privy(r.auth_subject).catch(() => null);
          if (c) fromPrivy.set(Number(r.id), c);
        }
      return rows.map((r) => {
        const b = basics.get(Number(r.id)),
          p = fromPrivy.get(Number(r.id));
        return {
          id: Number(r.id),
          createdAt: ms(r.created_at)!,
          lastSeen: ms(r.last_authenticated_at),
          inviteCode: r.invite_code?.trim().toUpperCase() || null,
          wallets: [...new Set(r.wallets ?? [])],
          name: names ? (b?.legalName ?? null) : null,
          email: names ? (b?.email || p?.email || null) : null,
          phone: names ? (b?.phone || p?.phone || null) : null,
          wallet: names ? r.primary_wallet?.toLowerCase() || null : null,
          city: b?.city ?? null,
        };
      });
    },
    async milestones(wallets) {
      const out = new Map<string, Milestones>();
      if (!wallets.length) return out;
      const pay = where.pay();
      const main = where.main();
      const set = (w: string, m: Milestones) => out.set(w, { ...out.get(w), ...m });
      if (pay) {
        const { rows: dep } = await pay.query<{ wallet: string; rail: string; at: Date }>(
          `SELECT DISTINCT ON (lower(wallet)) lower(wallet) AS wallet, rail, received_at AS at FROM deposit_receipts WHERE lower(wallet) = ANY($1) ORDER BY lower(wallet), received_at`,
          [wallets],
        );
        // a Lithic ACH pull is from their bank; a Bridge virtual account is a deposit
        for (const d of dep) set(d.wallet, { funded: { at: ms(d.at)!, with: d.rail === 'lithic_ach' ? 'bank' : 'deposit' } });
        const { rows: card } = await pay.query<{ wallet: string; shop: string | null; at: Date }>(
          `SELECT DISTINCT ON (lower(wallet)) lower(wallet) AS wallet, merchant->>'descriptor' AS shop, decided_at AS at FROM lithic_auth_decisions
            WHERE lower(wallet) = ANY($1) AND result = 'APPROVED' ORDER BY lower(wallet), decided_at`,
          [wallets],
        );
        for (const c of card) set(c.wallet, { spend: { at: ms(c.at)!, shop: c.shop?.trim() || 'A shop' } });
      }
      if (main) {
        const { rows: charges } = await main.query<{ wallet: string; shop: string; at: Date }>(
          `SELECT DISTINCT ON (lower(member_wallet)) lower(member_wallet) AS wallet, merchant_name AS shop, coalesce(resolved_at, created_at) AS at FROM charge_requests
            WHERE lower(member_wallet) = ANY($1) AND status = 'approved' ORDER BY lower(member_wallet), coalesce(resolved_at, created_at)`,
          [wallets],
        );
        // whichever came first, a card purchase or a charge code
        for (const c of charges) if (!out.get(c.wallet)?.spend || out.get(c.wallet)!.spend!.at > ms(c.at)!) set(c.wallet, { spend: { at: ms(c.at)!, shop: c.shop } });
      }
      return out;
    },
    async terms() {
      const pool = where.main();
      if (!pool) return [];
      // the member app makes the table when it starts (memberStore); before then there's nothing to count
      const { rows } = await pool
        .query<{ doc: string; version: string; n: number; first: Date; last: Date }>(
          `SELECT document_type AS doc, document_version AS version, count(DISTINCT member_id)::int AS n, min(accepted_at) AS first, max(accepted_at) AS last
             FROM member_terms_acceptances GROUP BY document_type, document_version ORDER BY document_type, min(accepted_at)`,
        )
        .catch((e: { code?: string }) => {
          if (e?.code === '42P01') return { rows: [] as { doc: string; version: string; n: number; first: Date; last: Date }[] };
          throw e;
        });
      return rows.map((r) => ({ doc: r.doc, version: r.version, n: r.n, first: ms(r.first)!, last: ms(r.last)! }));
    },
  };
}
