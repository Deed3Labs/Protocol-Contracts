/*
 * The payout funding keeper's last pass (jobs/payoutFundingKeeper.ts), for Build's automatic jobs. The keeper
 * keeps nothing in the database (it only reads and emails), so this is the running server's own memory: empty
 * after a restart until its first pass, which it runs at start.
 */

export type KeeperResult = 'GREEN' | 'AMBER' | 'RED' | 'failed';
export interface KeeperRun {
  at: number;
  result: KeeperResult;
}

let last: KeeperRun | null = null;

export function recordKeeperRun(run: KeeperRun): void {
  last = run;
}

export const lastKeeperRun = (): KeeperRun | null => last;
