import type { ReaderInfo, ReaderService } from './types';

/**
 * Borrowing a table's reader (the Pay case addendum). Stripe's Terminal SDK connects an app to one
 * reader at a time and does one thing at a time, so a table's M2 is connected only while that table
 * pays: when its bill is sent to a Point with a linked reader. It lets go when the payment is done,
 * the bill is withdrawn, or after five minutes idle, and the counter's reader comes back. A second
 * table waits its turn; a payment in progress is never interrupted to switch.
 *
 * The Point itself never drives the reader: only the SDK on a tablet or phone can.
 */

export const IDLE_RELEASE_MS = 5 * 60_000;

export interface TableReaderState {
  /** The Point whose reader is connected now, or null for the counter's. */
  active: string | null;
  phase: 'counter' | 'connecting' | 'ready' | 'paying';
  /** Points waiting their turn, first first. */
  queue: string[];
}

export interface TableRequestReader {
  pointId: string;
  /** The reader as the SDK finds it: its serial matches the Point's linked reader. */
  externalReaderId: string;
}

export function readerQueue(service: () => Promise<ReaderService>, opts: { idleMs?: number; counter?: () => ReaderInfo | null } = {}) {
  let state: TableReaderState = { active: null, phase: 'counter', queue: [] };
  const wants = new Map<string, TableRequestReader>();
  const listeners = new Set<(s: TableReaderState) => void>();
  let idle: ReturnType<typeof setTimeout> | null = null;
  const set = (patch: Partial<TableReaderState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l(state));
  };

  async function connect(req: TableRequestReader) {
    set({ active: req.pointId, phase: 'connecting' });
    const svc = await service();
    const found = (await svc.discover('bluetooth')).find((r) => r.id === req.externalReaderId || r.handle === req.externalReaderId) ?? {
      id: req.externalReaderId,
      kind: 'bluetooth' as const,
      label: req.externalReaderId,
      detail: '',
    };
    if (svc.connected()) await svc.disconnect();
    await svc.connect(found);
    set({ phase: 'ready' });
    armIdle();
  }

  function armIdle() {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => void release(state.active ?? ''), opts.idleMs ?? IDLE_RELEASE_MS);
  }

  /** Back to the counter's reader, then the next table in line. */
  async function release(pointId: string) {
    if (state.active !== pointId) {
      set({ queue: state.queue.filter((p) => p !== pointId) });
      wants.delete(pointId);
      return;
    }
    if (idle) clearTimeout(idle);
    wants.delete(pointId);
    const svc = await service();
    await svc.disconnect();
    const counter = opts.counter?.();
    if (counter) await svc.connect(counter);
    const [next, ...rest] = state.queue;
    set({ active: null, phase: 'counter', queue: rest });
    if (next && wants.has(next)) await connect(wants.get(next)!);
  }

  return {
    state: () => state,
    subscribe(fn: (s: TableReaderState) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** A table's bill went to its Point: connect its reader, or wait behind the table paying now. */
    async connectFor(req: TableRequestReader) {
      wants.set(req.pointId, req);
      if (state.active === req.pointId) return;
      if (state.active && state.phase === 'paying') {
        if (!state.queue.includes(req.pointId)) set({ queue: [...state.queue, req.pointId] });
        return;
      }
      if (state.active) await release(state.active);
      await connect(req);
    },
    /** A payment started on the table's reader: nothing switches until it's done. */
    paying(pointId: string) {
      if (state.active === pointId) {
        if (idle) clearTimeout(idle);
        set({ phase: 'paying' });
      }
    },
    /** Done, declined, cancelled or withdrawn: let go. */
    done: release,
  };
}

export type ReaderQueue = ReturnType<typeof readerQueue>;
