import { isCardSettlementConfigured, sweepCardSettlements } from '../services/chain/cardSettlementService.js';

/*
 * The backstop for card settlement on chain.
 *
 * Settlement is attempted the moment Lithic reports it, from the webhook. This catches everything
 * that did not land then: an RPC that timed out, a deploy mid-transaction, a refund after
 * settlement, and every settled purchase from before this existed. Each pass is cheap when there is
 * nothing to do — one indexed query.
 */
const DEFAULT_MINUTES = 5;

function intervalMs(): number {
  const configured = Number(process.env.CARD_SETTLEMENT_SWEEP_MINUTES);
  const minutes = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MINUTES;
  return minutes * 60 * 1000;
}

let running = false;

export async function tick(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const results = await sweepCardSettlements();
    const acted = results.filter((r) => r.action !== 'none' && r.action !== 'skipped');
    if (acted.length) {
      console.log(`[card-settlement] sweep: ${acted.map((r) => `${r.transactionToken}=${r.action}`).join(', ')}`);
    }
    return acted.length;
  } catch (error) {
    console.error('[card-settlement] sweep failed:', error);
    return 0;
  } finally {
    running = false;
  }
}

export async function startCardSettlementSweeper(): Promise<void> {
  // Inert without a settler key, like every other integration here.
  if (!isCardSettlementConfigured()) {
    console.log('[card-settlement] not configured (CARD_SETTLER_PRIVATE_KEY unset) — settled card spend stays off-chain');
    return;
  }
  const ms = intervalMs();
  setInterval(() => void tick(), ms);
  void tick();
  console.log(`[card-settlement] sweep started (${Math.round(ms / 60000)}m interval)`);
}
