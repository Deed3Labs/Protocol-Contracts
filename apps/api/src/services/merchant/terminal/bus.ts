import { EventEmitter } from 'node:events';

/**
 * Wakes whoever is waiting on a shop's Points: a Point's long poll or stream, the phone pages.
 *
 * Nothing is pushed through it but "this shop changed". Whoever wakes asks `pointStateFor` again, so
 * the Point, the phone page and the tablet all read the one answer. In-process only: a Point waiting
 * on another instance catches up when its wait times out (`WAIT_MS`), and the waits are short.
 */
const bus = new EventEmitter();
bus.setMaxListeners(0);

export const WAIT_MS = 25_000;

/** Something about this shop's orders, tenders, tables or Points changed. */
export function touchShop(merchant: string): void {
  bus.emit(`shop:${merchant}`);
}

/** Resolves on the shop's next change, or after `ms`, whichever is first. */
export function nextChange(merchant: string, ms: number): Promise<'changed' | 'timeout'> {
  return new Promise((resolve) => {
    const done = (why: 'changed' | 'timeout') => {
      clearTimeout(timer);
      bus.off(`shop:${merchant}`, onChange);
      resolve(why);
    };
    const onChange = () => done('changed');
    const timer = setTimeout(() => done('timeout'), Math.max(0, ms));
    bus.on(`shop:${merchant}`, onChange);
  });
}

/** For a stream: every change, until `stop` is called. */
export function onShopChange(merchant: string, fn: () => void): () => void {
  bus.on(`shop:${merchant}`, fn);
  return () => bus.off(`shop:${merchant}`, fn);
}
