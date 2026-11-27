import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CancelMessage, LATEST_VERSION, MODAL_ERROR_CODES as CONTRACT_CODES, ModalSession, PAY_ORIGIN as CONTRACT_PAY_ORIGIN, PaymentId, PriceId, PROTOCOL as CONTRACT_PROTOCOL } from '@clear/public-api-contracts';
import { CLEAR_VERSION, MODAL_ERROR_CODES, MODAL_OPTIONS, PAY_ORIGIN, PAYMENT_ID, PRICE_ID, PROTOCOL, VERSION } from './constants';

describe('the copied contract values', () => {
  test('match @clear/public-api-contracts', () => {
    expect(PAY_ORIGIN).toBe(CONTRACT_PAY_ORIGIN);
    expect(PROTOCOL).toBe(CONTRACT_PROTOCOL);
    expect(CLEAR_VERSION).toBe(LATEST_VERSION);
    expect([...MODAL_ERROR_CODES]).toEqual([...CONTRACT_CODES]);
    expect(CancelMessage.shape.protocol.value).toBe(PROTOCOL);
  });

  test("the id checks agree with the contract's", () => {
    for (const id of ['pay_abc123', 'pay_', 'pay_a-b', 'pay_' + 'a'.repeat(64), 'pay_' + 'a'.repeat(65), 'price_x', 'PAY_x', ' pay_a']) {
      expect(PAYMENT_ID.test(id)).toBe(PaymentId.safeParse(id).success);
    }
    for (const id of ['price_tacotray12', 'price_', 'price_tray-12', 'itm_tray12', 'price_' + 'b'.repeat(64)]) {
      expect(PRICE_ID.test(id)).toBe(PriceId.safeParse(id).success);
    }
  });

  test("the script's options are exactly the contract's modal options", async () => {
    const { CreateModalSession } = await import('@clear/public-api-contracts');
    const keys = new Set<string>();
    for (const o of CreateModalSession.options) for (const k of Object.keys(o.shape)) keys.add(k);
    for (const k of ['price', 'quantity', 'payment']) keys.delete(k);
    expect([...keys].sort()).toEqual([...MODAL_OPTIONS].sort());
    expect(Object.keys(ModalSession.shape)).toContain('url');
  });

  test('VERSION is the package version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(VERSION).toBe(pkg.version);
  });
});
