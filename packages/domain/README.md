# @clear/domain

The shared state machine. The member app and the merchant app are two ends of one flow — the
merchant's "waiting" is the member's approve screen, unopened — so anything both surfaces must
agree on is computed here once and imported by both.

Holds: charge lifecycle (states + transition table), split and carry math, money formatting, and
the shared types for merchant, member, charge, plan, payout and staff role.

**If the merchant app and the member app ever disagree on a number for the same charge, this
package is wrong.** The reference figures live here as unit tests for that reason — not in either
app, so the guarantee is enforceable rather than aspirational.

Deliberately narrow. Member-specific display logic — credit tiers, cycle status, reserve
projection — stays in `apps/member`, so the merchant app cannot reach it. There is no shared
component library: tokens and formatters are the whole shared surface.

Populated in Phase 2.
