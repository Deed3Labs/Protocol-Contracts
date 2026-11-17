import { ethers } from 'ethers';

/**
 * At startup, prints the ADDRESS of every wallet the API signs with from a private key held in its
 * environment, so an operator can read in the logs which wallet does which job without ever seeing
 * or comparing a key. Only addresses are printed, never a key or any part of one.
 *
 * Wallets held by Coinbase CDP have no key here; their addresses appear in the `[gas]` lines of
 * relayerGas.ts instead.
 */
export const JOB_WALLET_KEYS: Array<{ job: string; envVar: string; unsetNote?: string }> = [
  { job: 'credit operator', envVar: 'CREDIT_OPERATOR_PRIVATE_KEY' },
  { job: 'card settler', envVar: 'CARD_SETTLER_PRIVATE_KEY' },
  // The chain keepers pay their gas from the card settler's key (docs/operators/keepers.md): cycle
  // and default, shortfall notices, pledged pool shares and bonds, and the Yield Pool's queue.
  { job: 'chain keepers', envVar: 'CARD_SETTLER_PRIVATE_KEY' },
  {
    job: 'membership registrar',
    envVar: 'MEMBERSHIP_REGISTRAR_PRIVATE_KEY',
    unsetNote: 'the credit operator registers members instead',
  },
  {
    job: 'savings relayer',
    envVar: 'SAVINGS_RELAYER_PRIVATE_KEY',
    unsetNote: 'needed only in local-key mode; a CDP relayer has no key here',
  },
  {
    job: 'send relayer',
    envVar: 'SEND_RELAYER_PRIVATE_KEY',
    unsetNote: 'needed only in local-key mode; a CDP relayer has no key here',
  },
];

export type JobWallet = { job: string; envVar: string; address: string | null; problem?: string };

/** The address behind each key that is set; `address: null` when unset or not a valid key. */
export function jobWallets(env: Record<string, string | undefined> = process.env): JobWallet[] {
  return JOB_WALLET_KEYS.map(({ job, envVar, unsetNote }) => {
    const raw = (env[envVar] || '').trim();
    if (!raw) return { job, envVar, address: null, problem: unsetNote ? `not set (${unsetNote})` : 'not set' };
    try {
      const key = raw.startsWith('0x') ? raw : `0x${raw}`;
      return { job, envVar, address: ethers.computeAddress(key) };
    } catch {
      // Never echo the value: a malformed key is still a secret.
      return { job, envVar, address: null, problem: 'set, but not a valid private key' };
    }
  });
}

/** The log lines, one per wallet. Addresses only. */
export function jobWalletLines(env: Record<string, string | undefined> = process.env): string[] {
  const wallets = jobWallets(env);
  const lines = wallets.map((w) =>
    w.address ? `[wallets] ${w.job}: ${w.address} (${w.envVar})` : `[wallets] ${w.job}: ${w.problem} (${w.envVar})`,
  );
  // Two jobs on one key is allowed (the registrar defaults to the credit operator) but worth seeing.
  const byAddress = new Map<string, string[]>();
  for (const w of wallets) if (w.address) byAddress.set(w.address, [...(byAddress.get(w.address) ?? []), w.job]);
  for (const [address, jobs] of byAddress) {
    if (jobs.length > 1) lines.push(`[wallets] one wallet does several jobs: ${address} (${jobs.join(', ')})`);
  }
  return lines;
}

export function logJobWallets(): void {
  try {
    for (const line of jobWalletLines()) console.log(line);
  } catch (error) {
    console.error('[wallets] could not list the job wallets:', error instanceof Error ? error.message : error);
  }
}
