import { describe, expect, test } from 'bun:test';
import { createMockMerchantApi } from '../data/merchantApi/mock';
import { merchantTerminalBackend } from './backend';
import { serverSmartReaders } from './server';

describe('a card payment through the merchant API', () => {
  test('a smart reader collects it on the order: approved, the order paid; declined, it still owes', async () => {
    const { api, controls } = createMockMerchantApi({ delayMs: 0 });
    const smart = serverSmartReaders(merchantTerminalBackend(api), { pollMs: 1, key: () => `k-${Math.random().toString(36).slice(2)}-card` });
    const [reader] = await smart.discover();
    expect(reader).toMatchObject({ kind: 'smart', label: 'Front counter' });

    const o = await api.createOrder({ lines: [{ itemId: null, name: 'Alignment', note: null, amountCents: 11900, taxKind: 'labour' }], customer: null });
    const events: string[] = [];
    const ok = await smart.collect(reader!, 11900, (e) => events.push(e.state), { orderId: o.id, tipCents: 500 });
    expect(ok).toEqual({ outcome: 'approved', card: 'Visa ending 4242' });
    expect(events).toEqual(['ready', 'approved']);
    expect(await api.order(o.id)).toMatchObject({ status: 'paid', tipCents: 500 });

    controls.set({ card: 'decline' });
    const d = await api.createOrder({ lines: [{ itemId: null, name: 'Patch', note: null, amountCents: 3000, taxKind: 'labour' }], customer: null });
    const no = await smart.collect(reader!, 3000, () => undefined, { orderId: d.id, tipCents: 0 });
    expect(no.outcome).toBe('declined');
    expect((await api.order(d.id)).remainingCents).toBe(3000);
  });
});
