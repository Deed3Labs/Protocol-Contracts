import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readSecretKey, redactKeys } from './key';
import { main } from './main';
import { createServer, TOOL_NAMES } from './server';
import type { ClearClient } from './tools';

const key = (mode: string) => ['clear', 'sk', mode, 'Fake0Key1For2Tests3Only4'].join('_');
const unused = () => Promise.reject(new Error('not called'));

/** A fake client: only what a test sets up answers. */
function fakeClient(over: Partial<ClearClient> = {}): ClearClient {
  return {
    payments: { retrieve: unused, list: unused },
    paymentLinks: { create: unused },
    refunds: { create: unused },
    webhookDeliveries: { list: unused },
    ...over,
  };
}

async function connect(clear: ClearClient) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createServer(clear, { livemode: false });
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

describe('the MCP server', () => {
  test('lists the five tools', async () => {
    const client = await connect(fakeClient());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools.map((t) => t.name).sort()).toEqual(['create_payment_link', 'get_payment', 'list_payments', 'list_webhook_deliveries', 'refund_payment']);
    const refund = tools.find((t) => t.name === 'refund_payment')!;
    expect(refund.inputSchema.required).toEqual(['payment']);
    expect(Object.keys(refund.inputSchema.properties ?? {}).sort()).toEqual(['amount', 'payment', 'reason']);
    await client.close();
  });

  test('a call goes through to the handler, and its result comes back', async () => {
    const seen: unknown[] = [];
    const client = await connect(
      fakeClient({
        refunds: {
          create: async (params) => {
            seen.push(params);
            return { id: 're_1', object: 'refund', livemode: false, payment: 'pay_abc', amount: 500, status: 'pending_approval', reason: null, createdAt: '2026-10-16T10:00:00Z' };
          },
        },
      }),
    );
    const r = await client.callTool({ name: 'refund_payment', arguments: { payment: 'pay_abc', amount: 500 } });
    expect(seen).toEqual([{ payment: 'pay_abc', amount: 500, requireApproval: true }]);
    expect(r.isError).toBeFalsy();
    expect(JSON.parse((r.content as Array<{ text: string }>)[0]!.text).message).toContain('Charges');
    await client.close();
  });

  test('input the schema refuses never reaches the client', async () => {
    let called = false;
    const client = await connect(fakeClient({ refunds: { create: async () => ((called = true), Promise.reject(new Error('no'))) } }));
    const r = await client.callTool({ name: 'refund_payment', arguments: { payment: 'not-a-payment' } });
    expect(r.isError).toBe(true);
    expect(called).toBe(false);
    await client.close();
  });

  test('a key-shaped string in a result is cut before it reaches the agent', async () => {
    const client = await connect(fakeClient({ payments: { retrieve: unused, list: async () => ({ object: 'list', data: [], hasMore: false }) } }));
    const r = await client.callTool({ name: 'get_payment', arguments: { reference: `ref ${key('live')}` } });
    const text = (r.content as Array<{ text: string }>)[0]!.text;
    expect(text).not.toContain(key('live'));
    expect(text).toContain('clear_sk_live_…');
    await client.close();
  });
});

describe('the key', () => {
  test('a test or live secret key starts it', () => {
    expect(readSecretKey({ CLEAR_SECRET_KEY: key('test') })).toEqual({ ok: true, key: key('test'), livemode: false });
    expect(readSecretKey({ CLEAR_SECRET_KEY: key('live') })).toMatchObject({ ok: true, livemode: true });
  });

  test('missing, publishable or malformed is refused, without repeating the key', () => {
    const cases: Array<[string | undefined, RegExp]> = [
      [undefined, /not set/],
      ['  ', /not set/],
      [['clear', 'pk', 'live', 'Abc123'].join('_'), /publishable/],
      ['pk_live_Abc123', /publishable/],
      ['sk_live_Abc123', /not a Clear secret key/],
      [`${key('test')}!`, /not a Clear secret key/],
    ];
    for (const [value, message] of cases) {
      const r = readSecretKey({ CLEAR_SECRET_KEY: value });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.message).toMatch(message);
      if (value?.trim()) expect(r.message).not.toContain(value.trim());
    }
  });

  test('redactKeys', () => {
    expect(redactKeys(`a ${key('test')} b`)).toBe('a clear_sk_test_… b');
  });
});

describe('starting', () => {
  const errors: string[] = [];
  const spy = spyOn(console, 'error').mockImplementation((...args: unknown[]) => void errors.push(args.join(' ')));
  afterEach(() => void (errors.length = 0));

  test('a bad key refuses to start, with a message that never echoes it', async () => {
    const bad = ['clear', 'pk', 'live', 'Abc123'].join('_');
    expect(await main([], { CLEAR_SECRET_KEY: bad })).toBe(1);
    expect(errors.join('\n')).toContain('publishable');
    expect(errors.join('\n')).not.toContain(bad);
    expect(await main([], {})).toBe(1);
    expect(errors.join('\n')).toContain('CLEAR_SECRET_KEY is not set');
  });

  test('a --key flag is refused: environment only', async () => {
    expect(await main(['--key', key('live')], { CLEAR_SECRET_KEY: key('live') })).toBe(1);
    expect(errors.join('\n')).toContain('CLEAR_SECRET_KEY');
    expect(errors.join('\n')).not.toContain(key('live'));
    spy.mockRestore();
  });
});
