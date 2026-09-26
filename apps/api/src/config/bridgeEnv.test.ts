import { describe, expect, test } from 'bun:test';
import { applyBridgeEnv } from './bridgeEnv.js';

describe('Bridge live or sandbox', () => {
  test('live by default: nothing changes', () => {
    const env = { BRIDGE_API_KEY: 'sk-live-x', BRIDGE_SANDBOX_API_KEY: 'sk-test-y' } as NodeJS.ProcessEnv;
    expect(applyBridgeEnv(env)).toBe('live');
    expect(env.BRIDGE_API_KEY).toBe('sk-live-x');
  });

  test('sandbox swaps in the test key, the sandbox address and its webhook key', () => {
    const env = { BRIDGE_ENV: 'sandbox', BRIDGE_API_KEY: 'sk-live-x', BRIDGE_API_BASE_URL: 'https://api.bridge.xyz/v0', SEND_BRIDGE_PAYOUT_API_KEY: 'sk-live-x', BRIDGE_SANDBOX_API_KEY: 'sk-test-y', BRIDGE_SANDBOX_WEBHOOK_PUBLIC_KEY: 'PEM', SEND_BRIDGE_WEBHOOK_PUBLIC_KEY: 'LIVEPEM' } as NodeJS.ProcessEnv;
    expect(applyBridgeEnv(env)).toBe('sandbox');
    expect(env.BRIDGE_API_KEY).toBe('sk-test-y');
    expect(env.SEND_BRIDGE_PAYOUT_API_KEY).toBe('sk-test-y');
    expect(env.BRIDGE_API_BASE_URL).toBe('https://api.sandbox.bridge.xyz/v0');
    expect(env.BRIDGE_WEBHOOK_PUBLIC_KEY).toBe('PEM');
    expect(env.SEND_BRIDGE_WEBHOOK_PUBLIC_KEY).toBeUndefined();
  });

  test('sandbox without its key leaves Bridge unconfigured, never on live', () => {
    const env = { BRIDGE_ENV: 'sandbox', BRIDGE_API_KEY: 'sk-live-x' } as NodeJS.ProcessEnv;
    applyBridgeEnv(env);
    expect(env.BRIDGE_API_KEY).toBe('');
  });
});
