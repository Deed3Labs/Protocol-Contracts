import type { OffRamp, OffRampPayout, PayoutState } from './offRamp.js';

/*
 * The off-ramp through Bridge (apidocs.bridge.xyz): a liquidation address bound to the CSA.
 *
 * A liquidation address is a blockchain address Bridge creates for a customer with a fixed
 * destination: here an external account (the CSA's bank details, registered with Bridge once) and a
 * payout rail. Every USDC deposit to it becomes a "drain", which Bridge pays out to that account and
 * reports with a state (funds received -> payment submitted -> payment processed; or returned,
 * refunded, undeliverable, canceled) through the `liquidation_address.drain` webhook and
 * GET /customers/{customer}/liquidation_addresses/{id}/drains. Liquidation addresses do not custody
 * funds. If a payout fails, Bridge sends the USDC to the address's `return_address`, which is CL
 * Operating, so failed money goes back where it came from.
 *
 * The rail (Bridge's docs, checked Nov 2026, from search results: apidocs.bridge.xyz itself was not
 * reachable from the build environment, so confirm with Bridge before relying on it):
 *   - wire: sent as soon as the drain is processed, the same business day, within hours. The fastest
 *     rail Bridge documents for liquidation addresses, and the default here;
 *   - ach: queued and sent once a day (next-day);
 *   - ach_same_day: listed by Bridge as a transfer rail; whether a liquidation address accepts it
 *     is not stated in the pages found;
 *   - FedNow: Bridge's changelog announces 24/7 USD payouts to FedNow-eligible accounts; whether a
 *     liquidation address can use it, and under which rail name, is not documented in the pages
 *     found. RTP is not mentioned at all.
 * So `SETTLEMENT_OFFRAMP_RAIL` is configuration, and the measured latency (desk records) replaces the
 * configured one once it is longer.
 *
 * The sandbox (api.sandbox.bridge.xyz) cannot pay a real bank, and no sandbox CSA exists: on Base
 * Sepolia the desk uses the mock off-ramp (SETTLEMENT_OFFRAMP=mock).
 */

type BridgeFetch = <T>(path: string, init?: RequestInit) => Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; message: string }>;

export interface BridgeOffRampConfig {
  customerId: string;
  liquidationAddressId: string;
  /** The liquidation address's blockchain address (what the forwarder pays). */
  address: string;
  rail: string;
  /** The Bridge client (billerPayoutService `bridge`); injected for tests. */
  fetch?: BridgeFetch;
}

interface BridgeDrain {
  id?: string;
  amount?: string | number;
  currency?: string;
  state?: string;
  created_at?: string;
  updated_at?: string;
  deposit_tx_hash?: string | null;
}

const ARRIVED = new Set(['payment_processed']);
const FAILED = new Set(['returned', 'refunded', 'refund_failed', 'undeliverable', 'canceled', 'error']);

export function drainState(state: string | undefined): PayoutState {
  const s = String(state ?? '').toLowerCase();
  if (ARRIVED.has(s)) return 'arrived';
  if (FAILED.has(s)) return 'failed';
  return 'in-flight';
}

/** Bridge's decimal-string USDC amount as base units, exactly. */
export function usdcUnits(amount: string | number | undefined): bigint {
  const m = /^(\d+)(?:\.(\d{0,6})\d*)?$/.exec(String(amount ?? '0').trim());
  if (!m) return 0n;
  return BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0') || '0');
}

const secs = (iso: string | undefined) => (iso ? Math.floor(Date.parse(iso) / 1000) : 0);

export function drainToPayout(d: BridgeDrain): OffRampPayout {
  const state = drainState(d.state);
  return {
    id: String(d.id ?? ''),
    amount: usdcUnits(d.amount),
    state,
    depositTx: d.deposit_tx_hash ? String(d.deposit_tx_hash) : null,
    createdAt: secs(d.created_at),
    arrivedAt: state === 'arrived' ? secs(d.updated_at ?? d.created_at) : null,
    detail: String(d.state ?? ''),
  };
}

export function bridgeOffRamp(cfg: BridgeOffRampConfig): OffRamp {
  const call: BridgeFetch =
    cfg.fetch ??
    (async (path, init) => {
      const { bridge } = await import('../billerPayoutService.js');
      return bridge(path, init) as never;
    });
  return {
    name: 'bridge',
    address: cfg.address,
    rail: cfg.rail,
    async payouts(since) {
      const out: OffRampPayout[] = [];
      let starting: string | null = null;
      for (let page = 0; page < 10; page++) {
        const q = new URLSearchParams({ limit: '100' });
        if (starting) q.set('starting_after', starting);
        const r = await call<{ data?: BridgeDrain[] }>(
          `/customers/${encodeURIComponent(cfg.customerId)}/liquidation_addresses/${encodeURIComponent(cfg.liquidationAddressId)}/drains?${q}`,
        );
        if (!r.ok) throw new Error(`Bridge drains could not be read (${r.status}): ${r.message}`);
        const rows = r.data?.data ?? [];
        out.push(...rows.map(drainToPayout));
        // Newest first: stop once a page reaches before `since`.
        if (rows.length < 100 || rows.some((d) => secs(d.created_at) < since)) break;
        starting = String(rows[rows.length - 1].id ?? '');
        if (!starting) break;
      }
      return out.filter((p) => p.createdAt >= since);
    },
  };
}

/**
 * The one-time setup call, for people (docs/operators/settlement-funding.md): a liquidation address
 * on Base for USDC, paying the CSA (registered with Bridge as an external account) by `rail`, and
 * returning failed payouts to CL Operating. POST it to /customers/{Clear Lending's customer id}/
 * liquidation_addresses with an Idempotency-Key; the desk never creates or changes it.
 */
export function liquidationAddressRequest(input: { csaExternalAccountId: string; rail: string; returnAddress: string; chain?: string }) {
  return {
    chain: input.chain ?? 'base',
    currency: 'usdc',
    external_account_id: input.csaExternalAccountId,
    destination_payment_rail: input.rail,
    destination_currency: 'usd',
    return_address: input.returnAddress,
  };
}
