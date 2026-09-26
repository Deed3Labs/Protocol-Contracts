/**
 * Which Bridge the API talks to: live, or Bridge's sandbox.
 *
 * `BRIDGE_ENV=sandbox` swaps in the sandbox's key, address and webhook key for everything that
 * reads Bridge's settings (the member app's KYC and virtual accounts, bill pay, Send payouts, and
 * the merchant app's business verification, bank linking and withdrawals), so dev can run on test
 * data while the live key stays in `BRIDGE_API_KEY` for production. Done once, at start-up, before
 * anything reads them.
 *
 *   BRIDGE_ENV=sandbox
 *   BRIDGE_SANDBOX_API_KEY=sk-test-…              (required for sandbox)
 *   BRIDGE_SANDBOX_WEBHOOK_PUBLIC_KEY=-----BEGIN… (optional: the sandbox's webhook signing key)
 */
export function applyBridgeEnv(env: NodeJS.ProcessEnv = process.env): 'live' | 'sandbox' {
  if ((env.BRIDGE_ENV || '').trim().toLowerCase() !== 'sandbox') return 'live';
  const key = (env.BRIDGE_SANDBOX_API_KEY || '').trim();
  if (!key) {
    console.error('[bridge] BRIDGE_ENV=sandbox but BRIDGE_SANDBOX_API_KEY is not set: Bridge is left unconfigured rather than pointed at live.');
    env.BRIDGE_API_KEY = '';
    return 'sandbox';
  }
  env.BRIDGE_API_KEY = key;
  env.BRIDGE_API_BASE_URL = 'https://api.sandbox.bridge.xyz/v0';
  if (env.SEND_BRIDGE_PAYOUT_API_KEY) env.SEND_BRIDGE_PAYOUT_API_KEY = key;
  const hook = (env.BRIDGE_SANDBOX_WEBHOOK_PUBLIC_KEY || '').trim();
  if (hook) {
    env.BRIDGE_WEBHOOK_PUBLIC_KEY = hook;
    delete env.SEND_BRIDGE_WEBHOOK_PUBLIC_KEY;
    delete env.BRIDGE_WEBHOOK_PUBLIC_KEYS;
    delete env.SEND_BRIDGE_WEBHOOK_PUBLIC_KEYS;
  }
  console.log('[bridge] using the sandbox (api.sandbox.bridge.xyz)');
  return 'sandbox';
}
