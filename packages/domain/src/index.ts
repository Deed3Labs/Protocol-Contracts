/**
 * Shared domain for the Clear apps.
 *
 * The member app and the merchant app are two ends of one state machine: the merchant's
 * "waiting" is the member's approve screen, unopened. Anything both surfaces must agree on —
 * the charge lifecycle, what a split costs, how a figure is written — is computed here once
 * and imported by both. Neither app reimplements any of it.
 *
 * Filled in Phase 2. Deliberately narrow: member-specific display logic (credit tiers, cycle
 * status, reserve projection) stays in the member app, so the merchant app cannot reach it.
 */
export {};
