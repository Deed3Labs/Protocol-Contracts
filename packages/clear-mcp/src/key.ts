/**
 * The shop's secret key, from the environment only. Not a `--key` flag: a flag lands in shell history and
 * in the MCP config the agent can read back. The messages never repeat the key, not even in part.
 */

const SECRET_KEY = /^clear_sk_(test|live)_[A-Za-z0-9]+$/;

export type KeyCheck = { ok: true; key: string; livemode: boolean } | { ok: false; message: string };

export function readSecretKey(env: Record<string, string | undefined>): KeyCheck {
  const key = env.CLEAR_SECRET_KEY?.trim();
  if (!key) {
    return {
      ok: false,
      message:
        'CLEAR_SECRET_KEY is not set. Put your secret key (clear_sk_test_… or clear_sk_live_…, from Developers in the merchant app) in this server\'s "env" in your MCP config.',
    };
  }
  if (key.startsWith('clear_pk_') || key.startsWith('pk_')) {
    return {
      ok: false,
      message: 'CLEAR_SECRET_KEY is a publishable key. It belongs in the browser, with the Clear script; this server needs the secret key (clear_sk_test_… or clear_sk_live_…).',
    };
  }
  if (!SECRET_KEY.test(key)) {
    return { ok: false, message: 'CLEAR_SECRET_KEY is not a Clear secret key. It starts clear_sk_test_ or clear_sk_live_.' };
  }
  return { ok: true, key, livemode: key.startsWith('clear_sk_live_') };
}

/** Anything shaped like a secret key, cut to its prefix. Every tool result and log line goes through it. */
export const redactKeys = (text: string) => text.replace(/clear_sk_(test|live)_[A-Za-z0-9]+/g, 'clear_sk_$1_…');
