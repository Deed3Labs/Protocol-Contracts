/*
 * Everything the credit operator key sends, one transaction at a time, server-wide.
 *
 * Term limits and the $10 offers both sign with CREDIT_OPERATOR_PRIVATE_KEY. Two transactions from
 * one key at once race for the same nonce and one of them fails, so every writer goes through this
 * queue rather than keeping one of its own.
 */
let queue: Promise<unknown> = Promise.resolve();

export function asOperator<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}
