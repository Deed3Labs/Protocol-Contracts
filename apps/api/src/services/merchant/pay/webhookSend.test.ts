import { describe, expect, test } from 'bun:test';
import type { LookupAddress } from 'node:dns';
import { guardedLookup, isPublicAddress, webhookSend } from './webhookSend.js';

/** A resolver that answers every name with these addresses, as a rebinding domain would. */
const resolvesTo =
  (...addresses: string[]) =>
  (_host: string, _opts: unknown, cb: (err: NodeJS.ErrnoException | null, a: LookupAddress[]) => void) =>
    cb(null, addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));

const lookupOnce = (lookup: ReturnType<typeof guardedLookup>, all = false) =>
  new Promise<{ err: NodeJS.ErrnoException | null; address: unknown }>((resolve) => lookup('hooks.example.com', { all }, (err, address) => resolve({ err, address })));

describe('which addresses a webhook may reach', () => {
  test('the public internet', () => {
    for (const a of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) expect({ a, ok: isPublicAddress(a) }).toEqual({ a, ok: true });
  });
  test('never loopback, private, link-local (cloud metadata), carrier NAT, multicast or reserved', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.5.4', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::a00:1', 'not-an-ip']) {
      expect({ a, ok: isPublicAddress(a) }).toEqual({ a, ok: false });
    }
  });
});

describe('the connection’s own lookup', () => {
  test('a name that resolves inside a network is refused, before any connection', async () => {
    const r = await lookupOnce(guardedLookup(resolvesTo('127.0.0.1')));
    expect(r.err?.code).toBe('ENOTPUBLIC');
  });
  test('one private address among public ones is enough to refuse it', async () => {
    const r = await lookupOnce(guardedLookup(resolvesTo('93.184.216.34', '10.0.0.5')), true);
    expect(r.err?.code).toBe('ENOTPUBLIC');
  });
  test('a public name is let through, in the form the caller asked for', async () => {
    expect((await lookupOnce(guardedLookup(resolvesTo('93.184.216.34')))).address).toBe('93.184.216.34');
    expect((await lookupOnce(guardedLookup(resolvesTo('93.184.216.34')), true)).address).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });
});

describe('sending', () => {
  test('a rebinding name is never reached: the send fails, so the delivery is retried, not sent inside', async () => {
    const send = webhookSend(resolvesTo('169.254.169.254'));
    await expect(send('https://rebind.example.com/hook', { body: '{}' })).rejects.toMatchObject({ code: 'ENOTPUBLIC' });
  });
  test('a literal address, or plain http, is refused outright', async () => {
    const send = webhookSend(resolvesTo('93.184.216.34'));
    await expect(send('https://127.0.0.1/hook', { body: '{}' })).rejects.toThrow('not an IP address');
    await expect(send('https://[::1]/hook', { body: '{}' })).rejects.toThrow('not an IP address');
    await expect(send('http://hooks.example.com/hook', { body: '{}' })).rejects.toThrow('https');
  });
});
