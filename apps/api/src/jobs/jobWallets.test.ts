import { describe, expect, test } from 'bun:test';
import { ethers } from 'ethers';
import { jobWalletLines, jobWallets } from './jobWallets';

// Throwaway keys made for this test; they hold nothing on any network.
const a = ethers.Wallet.createRandom();
const b = ethers.Wallet.createRandom();

describe('the job wallets printed at startup', () => {
  test('shows each job with its address, and never a key', () => {
    const env = { CREDIT_OPERATOR_PRIVATE_KEY: a.privateKey, CARD_SETTLER_PRIVATE_KEY: b.privateKey.slice(2) };
    const lines = jobWalletLines(env).join('\n');
    expect(lines).toContain(`credit operator: ${a.address}`);
    expect(lines).toContain(`card settler: ${b.address}`);
    expect(lines).not.toContain(a.privateKey.slice(2, 20));
    expect(lines).not.toContain(b.privateKey.slice(2, 20));
  });

  test('says which are unset or malformed without echoing the value', () => {
    const bad = '0xnot-a-key-but-still-secret';
    const wallets = jobWallets({ SEND_RELAYER_PRIVATE_KEY: bad });
    expect(wallets.find((w) => w.job === 'send relayer')?.problem).toBe('set, but not a valid private key');
    expect(wallets.find((w) => w.job === 'credit operator')?.problem).toBe('not set');
    expect(jobWalletLines({ SEND_RELAYER_PRIVATE_KEY: bad }).join('\n')).not.toContain('still-secret');
  });

  test('says when an unset key is expected (registrar fallback, CDP relayers)', () => {
    const lines = jobWalletLines({}).join('\n');
    expect(lines).toContain('[wallets] savings relayer: not set (needed only in local-key mode; a CDP relayer has no key here) (SAVINGS_RELAYER_PRIVATE_KEY)');
    expect(lines).toContain('[wallets] membership registrar: not set (the credit operator registers members instead)');
    expect(lines).toContain('[wallets] state attester: not set (the credit operator attests states instead) (STATE_ATTESTER_PRIVATE_KEY)');
  });

  test('flags one wallet doing several jobs', () => {
    const lines = jobWalletLines({ CREDIT_OPERATOR_PRIVATE_KEY: a.privateKey, MEMBERSHIP_REGISTRAR_PRIVATE_KEY: a.privateKey });
    expect(lines.at(-1)).toBe(`[wallets] one wallet does several jobs: ${a.address} (credit operator, membership registrar)`);
  });
});
