/**
 * Who raised an order, by name. A website or link order has nobody at the shop behind it, so it reads
 * "Online" (pay DECISIONS, Phase 1: orders without staff).
 */
export const raisedByName = (raisedBy: string | null, nameOf: (staffId: string) => string) =>
  raisedBy === null ? 'Online' : nameOf(raisedBy);
