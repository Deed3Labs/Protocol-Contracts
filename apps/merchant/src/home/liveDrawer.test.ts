import { describe, expect, test } from 'bun:test';
import { createMockMerchantApi } from '../data/merchantApi/mock';
import { STAFF, STAFF_ID } from '../data/merchantApi/seed';
import { drawerPrompt, drawerStep } from './liveDrawer';

const names = new Map(STAFF.map((s) => [s.id, s.name]));

describe('the drawer on a live Home', () => {
  test('open → first count → the counter waits, someone else counts second → close', async () => {
    const { api, controls } = createMockMerchantApi({ delayMs: 0, viewer: STAFF_ID.luis });
    const s = (await api.drawer())!;
    expect(drawerStep(null, null, STAFF_ID.luis)).toEqual({ kind: 'open' });
    expect(drawerStep(s, await api.counts(s.id), STAFF_ID.luis)).toEqual({ kind: 'count', which: 'first' });
    await api.saveCount(s.id, { method: 'total', totalCents: 21200 });
    const after = await api.counts(s.id);
    expect(drawerStep(s, after, STAFF_ID.luis)).toEqual({ kind: 'wait' });
    // Blind: nothing the panel says names a figure.
    expect(JSON.stringify(drawerPrompt(s, after, STAFF_ID.luis, names))).not.toMatch(/\\$|212/);
    controls.setViewer(STAFF_ID.mike);
    expect(drawerStep(s, await api.counts(s.id), STAFF_ID.mike)).toEqual({ kind: 'count', which: 'second' });
    await api.saveCount(s.id, { method: 'total', totalCents: 21200 });
    expect(drawerStep(s, await api.counts(s.id), STAFF_ID.mike)).toEqual({ kind: 'close' });
  });

  test('short: a sign-off first; disagree: a recount', async () => {
    const short = createMockMerchantApi({ delayMs: 0, drawer: 'short', viewer: STAFF_ID.mike });
    const s = (await short.api.drawer())!;
    const v = await short.api.counts(s.id);
    expect(drawerStep(s, v, STAFF_ID.mike)).toMatchObject({ kind: 'result' });
    expect(drawerPrompt(s, v, STAFF_ID.mike, names).det).toContain('A manager signs it off');
    await short.api.signOff(s.id, { note: 'Change error', pin: '9999' });
    expect(drawerStep(s, await short.api.counts(s.id), STAFF_ID.mike)).toEqual({ kind: 'close' });

    const dis = createMockMerchantApi({ delayMs: 0, drawer: 'disagree', viewer: STAFF_ID.mike });
    const d = (await dis.api.drawer())!;
    expect(drawerPrompt(d, await dis.api.counts(d.id), STAFF_ID.mike, names).det).toContain('One of you counts again');
  });
});
