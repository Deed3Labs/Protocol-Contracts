const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** `18532` → `"$185.32"`, so an agent reads money instead of doing arithmetic on cents. */
export const formatUsd = (cents: number) => usd.format(cents / 100);
