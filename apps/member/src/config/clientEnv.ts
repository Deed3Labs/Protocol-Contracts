/**
 * Every client env var this app looks up by a computed name — written out one by one, on purpose.
 *
 * `import.meta.env` is not an object at runtime. Vite finds the literal text
 * `import.meta.env.VITE_FOO` and substitutes the value, which means a STATIC read publishes
 * exactly that one variable. A DYNAMIC read — `import.meta.env[key]`, or the same thing behind a
 * `Record` cast — has no literal to match, so Vite gives up and serialises the WHOLE env object
 * into the bundle instead.
 *
 * That is how our Alchemy key reached the public bundle. Nothing read `VITE_ALCHEMY_*` by then;
 * three helpers here indexed the env by a chain-id-derived key, and the dump they caused carried
 * every VITE_ var set in the build, read or not. Deleting the readers did not stop it, and would
 * not have stopped the next one either.
 *
 * So the rule this file enforces: a var is reachable from the browser only if it is spelled out
 * below. Adding a chain means adding its five lines. That is tedious by design — the tedium is an
 * allowlist, and it is the thing that keeps a secret someone sets in Vercel from shipping just
 * because it happens to start with VITE_.
 *
 * Generated shape, not generated code: the keys must be literals for Vite to see them.
 */
const CLIENT_ENV: Record<string, string | undefined> = {
  VITE_CLRUSD_1: import.meta.env.VITE_CLRUSD_1,
  VITE_CLRUSD_10: import.meta.env.VITE_CLRUSD_10,
  VITE_CLRUSD_100: import.meta.env.VITE_CLRUSD_100,
  VITE_CLRUSD_137: import.meta.env.VITE_CLRUSD_137,
  VITE_CLRUSD_8453: import.meta.env.VITE_CLRUSD_8453,
  VITE_CLRUSD_11155111: import.meta.env.VITE_CLRUSD_11155111,
  VITE_CLRUSD_42161: import.meta.env.VITE_CLRUSD_42161,
  VITE_CLRUSD_84532: import.meta.env.VITE_CLRUSD_84532,

  VITE_ESA_VAULT_1: import.meta.env.VITE_ESA_VAULT_1,
  VITE_ESA_VAULT_10: import.meta.env.VITE_ESA_VAULT_10,
  VITE_ESA_VAULT_100: import.meta.env.VITE_ESA_VAULT_100,
  VITE_ESA_VAULT_137: import.meta.env.VITE_ESA_VAULT_137,
  VITE_ESA_VAULT_8453: import.meta.env.VITE_ESA_VAULT_8453,
  VITE_ESA_VAULT_11155111: import.meta.env.VITE_ESA_VAULT_11155111,
  VITE_ESA_VAULT_42161: import.meta.env.VITE_ESA_VAULT_42161,
  VITE_ESA_VAULT_84532: import.meta.env.VITE_ESA_VAULT_84532,

  VITE_CLRUSD_POOL_1: import.meta.env.VITE_CLRUSD_POOL_1,
  VITE_CLRUSD_POOL_10: import.meta.env.VITE_CLRUSD_POOL_10,
  VITE_CLRUSD_POOL_100: import.meta.env.VITE_CLRUSD_POOL_100,
  VITE_CLRUSD_POOL_137: import.meta.env.VITE_CLRUSD_POOL_137,
  VITE_CLRUSD_POOL_8453: import.meta.env.VITE_CLRUSD_POOL_8453,
  VITE_CLRUSD_POOL_11155111: import.meta.env.VITE_CLRUSD_POOL_11155111,
  VITE_CLRUSD_POOL_42161: import.meta.env.VITE_CLRUSD_POOL_42161,
  VITE_CLRUSD_POOL_84532: import.meta.env.VITE_CLRUSD_POOL_84532,

  VITE_SEND_USDC_1: import.meta.env.VITE_SEND_USDC_1,
  VITE_SEND_USDC_10: import.meta.env.VITE_SEND_USDC_10,
  VITE_SEND_USDC_100: import.meta.env.VITE_SEND_USDC_100,
  VITE_SEND_USDC_137: import.meta.env.VITE_SEND_USDC_137,
  VITE_SEND_USDC_8453: import.meta.env.VITE_SEND_USDC_8453,
  VITE_SEND_USDC_11155111: import.meta.env.VITE_SEND_USDC_11155111,
  VITE_SEND_USDC_42161: import.meta.env.VITE_SEND_USDC_42161,
  VITE_SEND_USDC_84532: import.meta.env.VITE_SEND_USDC_84532,

  VITE_SEND_CLAIM_ESCROW_1: import.meta.env.VITE_SEND_CLAIM_ESCROW_1,
  VITE_SEND_CLAIM_ESCROW_10: import.meta.env.VITE_SEND_CLAIM_ESCROW_10,
  VITE_SEND_CLAIM_ESCROW_100: import.meta.env.VITE_SEND_CLAIM_ESCROW_100,
  VITE_SEND_CLAIM_ESCROW_137: import.meta.env.VITE_SEND_CLAIM_ESCROW_137,
  VITE_SEND_CLAIM_ESCROW_8453: import.meta.env.VITE_SEND_CLAIM_ESCROW_8453,
  VITE_SEND_CLAIM_ESCROW_11155111: import.meta.env.VITE_SEND_CLAIM_ESCROW_11155111,
  VITE_SEND_CLAIM_ESCROW_42161: import.meta.env.VITE_SEND_CLAIM_ESCROW_42161,
  VITE_SEND_CLAIM_ESCROW_84532: import.meta.env.VITE_SEND_CLAIM_ESCROW_84532,
};

/**
 * Read one allowlisted client env var by name.
 *
 * Returns undefined for anything not listed above — including a var that IS set in the build
 * environment. That is the intended failure: an unlisted var is one nobody decided to publish, and
 * silently reaching it is what got us here. If a lookup comes back empty and you expected a value,
 * add the key to CLIENT_ENV rather than reaching for `import.meta.env[key]`.
 */
export function readEnv(key: string): string | undefined {
  return CLIENT_ENV[key];
}
