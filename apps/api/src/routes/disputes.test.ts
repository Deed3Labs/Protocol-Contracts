import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CARD_REASONS, isCardReason } from '../services/disputes/networkDispute.js';

const route = readFileSync(new URL('./disputes.ts', import.meta.url), 'utf8');
const store = readFileSync(new URL('../services/disputes/disputeStore.ts', import.meta.url), 'utf8');
const candidates = readFileSync(new URL('../services/disputes/disputeCandidates.ts', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

describe('a dispute is on the member’s own payment', () => {
  test('mounted behind auth, and the wallet comes from the session', () => {
    expect(index).toContain("app.use('/api/disputes', requireAuth, disputesRouter);");
    expect(route).toContain('req.auth?.smartWallet || req.auth?.walletAddress');
    expect(route).not.toMatch(/req\.body\?\.wallet|req\.params\.wallet/);
  });

  test('the payment is re-read from its own table; amount and name are never the client’s', () => {
    expect(route).toContain('await findCandidate(wallet, kind, ref)');
    expect(route).toContain('amountCents: subject.amountCents');
    expect(route).not.toMatch(/req\.body\?\.amount/);
  });

  test('each kind reads only this member’s rows', () => {
    expect(candidates).toMatch(/lithic_auth_decisions[\s\S]{0,80}WHERE wallet = \$1/);
    expect(candidates).toMatch(/charge_requests[\s\S]{0,60}WHERE member_wallet = \$1 AND status = 'approved'/);
    expect(candidates).toMatch(/send_transfers[\s\S]{0,60}WHERE LOWER\(sender_wallet\) = \$1/);
  });

  test('one live dispute per payment', () => {
    expect(route).toMatch(/openSubjects\(wallet\)\)\.has\(ref\)[\s\S]{0,120}409/);
  });
});

describe('a dispute is never quietly dropped', () => {
  test('no database means the member is told, not thanked', () => {
    expect(route).toMatch(/disputeStore\.isConfigured\(\)[\s\S]{0,120}503/);
    expect(route).toMatch(/if \(!dispute\) return res\.status\(503\)/);
  });

  test('stored before the network is told, and a network refusal is kept beside it', () => {
    expect(route.indexOf('disputeStore.file(')).toBeLessThan(route.indexOf('openCardDispute('));
    expect(store).toContain('SET lithic_error = $2');
    expect(route).toContain("network: 'error' in outcome ? { filed: false }");
  });
});

describe('card reasons map to the network’s codes', () => {
  test('plain words to Lithic reasons', () => {
    expect(CARD_REASONS.charged_twice).toBe('DUPLICATED');
    expect(CARD_REASONS.wrong_amount).toBe('INCORRECT_AMOUNT');
    expect(CARD_REASONS.not_received).toBe('GOODS_SERVICES_NOT_RECEIVED');
    expect(isCardReason('charged_twice')).toBe(true);
    expect(isCardReason('DUPLICATED')).toBe(false);
    expect(isCardReason(undefined)).toBe(false);
  });

  test('a card dispute has to carry a reason', () => {
    expect(route).toMatch(/kind === 'card' && !isCardReason\(reason\)[\s\S]{0,120}400/);
  });
});
