import { describe, expect, test } from 'bun:test';
import { toBase64 } from '../ble/bytes';
import { fakeDrawer } from '../fakes/fakeDrawer';
import { memoryCentral } from '../fakes/peripheral';
import { bleDrawer } from './ble';
import { memoryVault } from './keys';
import { DRAWER_COMMAND, DRAWER_SERVICE, nextCounter, signedOpen } from './protocol';
import type { DrawerSignal, DrawerTarget } from './types';

const KEY = toBase64(new Uint8Array(32).map((_, i) => i + 1));
const TARGET: DrawerTarget = { id: 'hw_drawer_1', bluetoothId: 'C1:EA:4F:2A', cabledToPrinter: false, printerId: null };
const tick = () => new Promise((r) => setTimeout(r, 5));

function rig(opts: { enrollment?: string | null } = {}) {
  const device = fakeDrawer({ shutAfterMs: null });
  const vault = memoryVault();
  let last = 0;
  const signals: DrawerSignal[] = [];
  const service = bleDrawer({
    central: () => memoryCentral([device.peripheral]),
    vault,
    enrollment: () => (opts.enrollment === undefined ? 'dev_tablet_1' : opts.enrollment),
    counter: { last: () => last, save: (n) => void (last = n) },
  });
  service.events((s) => signals.push(s));
  return { device, vault, service, signals, counter: () => last };
}

describe('the drawer opens for the tablet that paired it, and nothing else', () => {
  test('pair, key it, open: the drawer says it opened', async () => {
    const r = rig();
    expect(await r.service.pair()).toEqual({ bluetoothId: 'C1:EA:4F:2A', name: 'Clear Drawer' });
    await r.service.keyDrawer(TARGET, KEY);
    r.service.use(TARGET);
    await r.service.open('sale');
    await tick();
    expect(r.device.opens).toBe(1);
    expect(r.signals.map((s) => s.kind)).toEqual(['opened']);
  });

  test('it opens with no connection: the key is on the tablet, the counter goes up', async () => {
    const r = rig();
    await r.service.keyDrawer(TARGET, KEY);
    r.service.use(TARGET);
    for (let i = 0; i < 3; i += 1) await r.service.open('sale');
    expect(r.device.opens).toBe(3);
    expect(r.device.lastRefusal).toBeNull();
  });

  test('a replayed command does nothing', async () => {
    const r = rig();
    await r.service.keyDrawer(TARGET, KEY);
    r.service.use(TARGET);
    await r.service.open('sale');
    const sent = r.device.peripheral.writes.filter((w) => w.characteristic === DRAWER_COMMAND).at(-1)!.value;
    const link = r.device.peripheral.link();
    await link.write(DRAWER_SERVICE, DRAWER_COMMAND, sent);
    expect(r.device.lastRefusal).toBe('replay');
    expect(r.device.opens).toBe(1);
  });

  test('an unsigned command, or one signed with another key, does nothing', async () => {
    const r = rig();
    await r.service.keyDrawer(TARGET, KEY);
    const link = r.device.peripheral.link();
    await link.write(DRAWER_SERVICE, DRAWER_COMMAND, new Uint8Array([0x01]));
    expect(r.device.lastRefusal).toBe('short');
    const forged = await signedOpen({ drawerId: TARGET.id, key: new Uint8Array(32).fill(9), counter: 2 ** 31, at: Date.now() });
    await link.write(DRAWER_SERVICE, DRAWER_COMMAND, forged);
    expect(r.device.lastRefusal).toBe('mac');
    // The right key for another drawer's id doesn't open this one either.
    const otherId = await signedOpen({ drawerId: 'hw_other', key: new Uint8Array(32).map((_, i) => i + 1), counter: 2 ** 31, at: Date.now() });
    await link.write(DRAWER_SERVICE, DRAWER_COMMAND, otherId);
    expect(r.device.lastRefusal).toBe('mac');
    expect(r.device.opens).toBe(0);
  });

  test('a command from more than five minutes off the drawer’s clock does nothing', async () => {
    const r = rig();
    await r.service.keyDrawer(TARGET, KEY);
    const old = await signedOpen({ drawerId: TARGET.id, key: new Uint8Array(32).map((_, i) => i + 1), counter: 2 ** 31, at: Date.now() - 10 * 60_000 });
    await r.device.peripheral.link().write(DRAWER_SERVICE, DRAWER_COMMAND, old);
    expect(r.device.lastRefusal).toBe('stale');
  });

  test('a drawer keyed already refuses a new key until its button resets it', async () => {
    const r = rig();
    await r.service.keyDrawer(TARGET, KEY);
    await expect(r.service.keyDrawer({ ...TARGET, id: 'hw_thief' }, toBase64(new Uint8Array(32)))).rejects.toThrow('Hold its button');
    r.device.reset();
    await r.service.keyDrawer({ ...TARGET, id: 'hw_new' }, KEY);
  });

  test('no key on this tablet: the change screen hears why, nothing is sent', async () => {
    const r = rig();
    r.service.use(TARGET);
    await r.service.open('sale');
    expect(r.signals).toEqual([{ kind: 'unreachable', at: expect.any(String), why: 'This drawer isn’t paired to this tablet' }]);
    expect(r.device.peripheral.writes).toEqual([]);
  });

  test('keys are kept per enrollment: a tablet enrolled again starts without one', async () => {
    const r = rig();
    await r.service.keyDrawer(TARGET, KEY);
    expect(await r.vault.get('dev_tablet_1', TARGET.id)).not.toBeNull();
    await r.vault.put('dev_tablet_2', TARGET.id, KEY);
    expect(await r.vault.get('dev_tablet_1', TARGET.id)).toBeNull();
  });

  test('a lost counter starts again from the clock, ahead of any it had', () => {
    expect(nextCounter(0, 1_760_000_000_000)).toBe(1_760_000_000);
    expect(nextCounter(1_760_000_005, 1_760_000_000_000)).toBe(1_760_000_006);
  });

  test('a drawer cabled to the printer gets the printer’s pulse', async () => {
    const kicks: string[] = [];
    const service = bleDrawer({
      central: () => memoryCentral([]),
      vault: memoryVault(),
      enrollment: () => 'dev_tablet_1',
      counter: { last: () => 0, save: () => undefined },
      kick: async (id) => void kicks.push(id),
    });
    service.use({ id: 'hw_d', bluetoothId: null, cabledToPrinter: true, printerId: 'hw_printer' });
    await service.open('sale');
    expect(kicks).toEqual(['hw_printer']);
  });
});
