/*
 * Decide a dispute by hand — for partner and member-to-member disputes, which a person decides.
 * Card disputes follow the card network's own decision automatically; use this only to override.
 *
 *   railway run -s Protocol-Contracts -e dev bun scripts/resolve-dispute.ts <token> <member|merchant> "why"
 *
 * `member` = decided in the member's favour; `merchant` = against them. Nothing is decided twice:
 * a dispute already closed is refused.
 */
import { resolveDispute } from '../src/services/disputes/disputeEnforcement.js';

const [token, outcome, ...noteParts] = process.argv.slice(2);
if (!token || (outcome !== 'member' && outcome !== 'merchant')) {
  console.error('usage: bun scripts/resolve-dispute.ts <token> <member|merchant> "reason"');
  process.exit(1);
}
const decided = await resolveDispute(token, outcome, noteParts.join(' ') || null);
console.log(decided ? `decided: ${decided.token} → ${decided.resolution}` : 'not decided (unknown, or already closed)');
process.exit(decided ? 0 : 1);
