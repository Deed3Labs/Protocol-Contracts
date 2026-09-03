import { describe, expect, test, beforeEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { websocketService } from './websocketService.js';

/*
 * The bug this pins down.
 *
 * `clients` is the POLLING registry. A backgrounded tab emits `unsubscribe` so the server stops
 * spending Alchemy calls on it, which deletes its entry. `broadcastToAddress` used to iterate that
 * same map — so the cost optimisation quietly made every backgrounded tab unreachable, which is
 * precisely the phone in your pocket that the push was built to reach.
 *
 * These drive the real singleton rather than asserting on source text. The previous guards for
 * this feature checked that files *mentioned* the wiring, and stayed green the whole time it did
 * not work.
 */

type Emitted = { event: string; data: unknown };

function fakeSocket(id: string, connected = true) {
  const sent: Emitted[] = [];
  return { id, connected, sent, emit: (event: string, data: unknown) => sent.push({ event, data }) };
}

function install(sockets: ReturnType<typeof fakeSocket>[]) {
  const map = new Map(sockets.map((s) => [s.id, s]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = websocketService as any;
  service.io = { sockets: { sockets: map } };
  service.clients = new Map();
  service.connectionAddress = new Map();
  return service;
}

const WALLET = '0x7ec1D6b69398af413edC94692FB167A3864A86cF';

describe('a push reaches a connection that stopped polling', () => {
  let socket: ReturnType<typeof fakeSocket>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let service: any;

  beforeEach(() => {
    socket = fakeSocket('sock-1');
    service = install([socket]);
  });

  test('a backgrounded tab — identified, not subscribed — still gets the event', () => {
    // Exactly the state after `unsubscribe`: known connection, no polling entry.
    service.connectionAddress.set('sock-1', WALLET.toLowerCase());
    service.broadcastToAddress(WALLET, 'chain:changed', { at: 'now' });
    expect(socket.sent).toEqual([{ event: 'chain:changed', data: { at: 'now' } }]);
  });

  test('and being in the polling registry is not what earns it', () => {
    // The inverse: subscribed but never identified. Reaching this socket would mean broadcast is
    // still reading `clients`, which is the bug.
    service.clients.set('sock-1', { address: WALLET.toLowerCase(), chainIds: [84532], subscriptions: [] });
    service.broadcastToAddress(WALLET, 'chain:changed', {});
    expect(socket.sent).toEqual([]);
  });

  test('a different wallet is not told about someone else’s deposit', () => {
    service.connectionAddress.set('sock-1', '0x000000000000000000000000000000000000dead');
    service.broadcastToAddress(WALLET, 'chain:changed', {});
    expect(socket.sent).toEqual([]);
  });

  test('address matching survives checksum casing', () => {
    service.connectionAddress.set('sock-1', WALLET.toLowerCase());
    service.broadcastToAddress(WALLET.toUpperCase().replace('0X', '0x'), 'chain:changed', {});
    expect(socket.sent.length).toBe(1);
  });

  test('a dead socket is skipped rather than thrown at', () => {
    const dead = fakeSocket('sock-2', false);
    service = install([dead]);
    service.connectionAddress.set('sock-2', WALLET.toLowerCase());
    service.broadcastToAddress(WALLET, 'chain:changed', {});
    expect(dead.sent).toEqual([]);
  });

  test('every identified connection for the wallet gets it, not just the first', () => {
    // One member, several devices — the whole point.
    const phone = fakeSocket('sock-2');
    service = install([socket, phone]);
    service.connectionAddress.set('sock-1', WALLET.toLowerCase());
    service.connectionAddress.set('sock-2', WALLET.toLowerCase());
    service.broadcastToAddress(WALLET, 'chain:changed', {});
    expect([socket.sent.length, phone.sent.length]).toEqual([1, 1]);
  });
});

describe('the registry outlives a subscription', () => {
  const SOURCE = readFileSync(join(import.meta.dirname, 'websocketService.ts'), 'utf8');

  function handler(name: string): string {
    const start = SOURCE.indexOf(`socket.on('${name}'`);
    expect(start).toBeGreaterThan(-1);
    return SOURCE.slice(start, SOURCE.indexOf("socket.on('", start + 20));
  }

  test('unsubscribe drops the polling entry and nothing else', () => {
    const body = handler('unsubscribe');
    expect(body).toContain('this.clients.delete(socket.id)');
    expect(body).not.toContain('connectionAddress');
  });

  test('disconnect is the only thing that forgets a connection', () => {
    expect(handler('disconnect')).toContain('this.connectionAddress.delete(socket.id)');
  });

  test('the client says who it is before it decides whether to poll', () => {
    const hook = readFileSync(join(import.meta.dirname, '../../../member/src/hooks/useWebSocket.ts'), 'utf8');
    const onConnect = hook.slice(hook.indexOf("socket.on('connect'"), hook.indexOf('const handleVisibility'));
    expect(onConnect.indexOf("emit('identify'")).toBeGreaterThan(-1);
    // Unconditional: the guard below it is what gates polling, and identify must sit above it.
    expect(onConnect.indexOf("emit('identify'")).toBeLessThan(onConnect.indexOf('document.hidden'));
  });
});
