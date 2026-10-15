import { describe, expect, test } from 'bun:test';
import { mockReader } from './mock';
import { readerQueue } from './tables';
import type { ReaderInfo } from './types';

const counter: ReaderInfo = { id: 'tap', kind: 'bluetooth', label: 'Clear Tap', detail: '' };

describe('borrowing a table’s reader', () => {
  test('connects for the table, waits behind a payment, and gives the reader back', async () => {
    const svc = mockReader('ios');
    const q = readerQueue(async () => svc, { counter: () => counter });
    await q.connectFor({ pointId: 't12', externalReaderId: 'STRM2-1A3F' });
    expect(q.state()).toMatchObject({ active: 't12', phase: 'ready' });
    expect(svc.connected()?.id).toBe('STRM2-1A3F');
    q.paying('t12');
    await q.connectFor({ pointId: 't4', externalReaderId: 'STRM2-0B4C' });
    expect(q.state()).toMatchObject({ active: 't12', phase: 'paying', queue: ['t4'] });
    await q.done('t12');
    expect(q.state()).toMatchObject({ active: 't4', phase: 'ready', queue: [] });
    await q.done('t4');
    expect(q.state()).toMatchObject({ active: null, phase: 'counter' });
    expect(svc.connected()?.id).toBe('tap');
  });

  test('lets go after five minutes idle', async () => {
    const svc = mockReader('ios');
    const q = readerQueue(async () => svc, { counter: () => counter, idleMs: 20 });
    await q.connectFor({ pointId: 't12', externalReaderId: 'STRM2-1A3F' });
    await new Promise((r) => setTimeout(r, 40));
    expect(q.state().phase).toBe('counter');
  });
});
