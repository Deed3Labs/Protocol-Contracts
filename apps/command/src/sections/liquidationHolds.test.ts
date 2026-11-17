import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const screen = readFileSync(new URL('./liquidationHolds.tsx', import.meta.url), 'utf8');
const money = readFileSync(new URL('./money2.tsx', import.meta.url), 'utf8');

describe('Liquidation Holds on Money → Credit (Phase 2b, 12.6)', () => {
  test('lists holds, shortfall notices and excesses from the Liquidator', () => {
    expect(screen).toContain("api<Read>('GET', '/liquidation-holds')");
    expect(screen).toContain('settleable ${day(r.shortfall.settleableAt)}');
    expect(money).toContain('<LiquidationHolds />');
  });

  test('propose, confirm, renew and clear are prepared by the API and sent from the signer’s own wallet', () => {
    expect(screen).toContain("api<Prepared>('POST', '/liquidation-holds/prepare'");
    expect(screen).toContain("method: 'eth_sendTransaction'");
    // Nothing here signs: no key, no private key, no server-side send.
    expect(screen).not.toMatch(/privateKey|PRIVATE_KEY|signTransaction/);
  });

  test('says the second step must be a different signer', () => {
    expect(screen).toContain('a <b>different</b> signer confirms');
    expect(screen).toContain('Confirm (a different signer)');
    expect(screen).toContain('Clear (two different signers)');
  });
});
