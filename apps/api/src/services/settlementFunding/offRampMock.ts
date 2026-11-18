import type { ForwardedDeposit, OffRamp, OffRampPayout } from './offRamp.js';

/*
 * The mock off-ramp, for Base Sepolia (SETTLEMENT_OFFRAMP=mock). No sandbox off-ramp pays a real
 * bank, and there is no testnet CSA, so a deposit the desk forwarded is reported as a payout that
 * arrives `latencyMinutes` after it was forwarded. The forwarded USDC simply sits at the configured
 * address (any address CL Operating's owners set on the forwarder, e.g. a test wallet).
 */
export function mockOffRamp(cfg: { address: string; latencyMinutes: number; now: () => number; deposits: () => Promise<ForwardedDeposit[]> }): OffRamp {
  return {
    name: 'mock',
    address: cfg.address,
    rail: 'mock',
    async payouts(since) {
      const now = cfg.now();
      const deposits = await cfg.deposits();
      return deposits
        .filter((d) => d.forwardedAt >= since)
        .map((d, i): OffRampPayout => {
          const at = d.forwardedAt + cfg.latencyMinutes * 60;
          return {
            id: `mock-${d.forwardTx ?? i}`,
            amount: d.amount,
            state: now >= at ? 'arrived' : 'in-flight',
            depositTx: d.forwardTx,
            createdAt: d.forwardedAt,
            arrivedAt: now >= at ? at : null,
            detail: now >= at ? 'payment_processed' : 'funds_received',
          };
        });
    },
  };
}
