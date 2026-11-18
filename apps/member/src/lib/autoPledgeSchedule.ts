/*
 * When the app pledges Savings and Earn in the background, and when it does not.
 *
 * Since Phase 4b (L-I) every pledge carries the member's signature, so pledging stopped happening on
 * its own: the app asked only after a deposit, and money a member already held -- everyone's, after
 * a redeploy moved them to a fresh CollateralRegistry -- backed nothing. This runs the same
 * prepare → check → sign → submit (`pledgeWhatIsHeld`) on load and on return to the app, silently,
 * the way pledging felt before.
 *
 * The rules, all here so they can be tested without a wallet:
 *
 *  - Only for a signed-in member with a line. Before the line exists the server refuses, so asking is
 *    noise, and a failed signature prompt on a brand-new account is worse.
 *  - Only when the member has not turned it off (Settings → Permissions).
 *  - Only Savings (CLRUSD) and Yield Pool shares. Never a bond: its pledge signs a Maturity
 *    Instruction, which the member should see, so bonds keep their own explicit flow.
 *  - At most once per kind per ten minutes, remembered across reloads, so opening the app often
 *    does not ask the server (or the wallet) every time.
 *  - One at a time. A run while another is going is skipped, not queued; a post-deposit pledge
 *    waits its turn (`exclusive`), so two signatures never race for the same pledge nonce.
 *
 * Fire-and-forget by design: errors are collected and returned, never thrown, so Home never breaks.
 */

export type AutoPledgeKind = 'SAVINGS' | 'POOL_SHARE';

/** The kinds pledged in the background. BOND is deliberately absent. */
export const AUTO_PLEDGE_KINDS: readonly AutoPledgeKind[] = ['SAVINGS', 'POOL_SHARE'];

/** At most one try per kind in this window. */
export const AUTO_PLEDGE_EVERY_MS = 10 * 60 * 1000;

export function isAutoPledgeKind(kind: string): kind is AutoPledgeKind {
  return (AUTO_PLEDGE_KINDS as readonly string[]).includes(kind);
}

/** Where the last try per member and kind is kept (the device, in the app; memory in tests). */
export interface AutoPledgeClock {
  get(key: string): number | undefined;
  set(key: string, at: number): void;
}

export type AutoPledgeSkip = 'signed-out' | 'off' | 'no-line' | 'busy' | 'recent';

export type AutoPledgeRun =
  | { skipped: AutoPledgeSkip }
  | { tried: AutoPledgeKind[]; pledged: number; errors: string[] };

export interface AutoPledgeInput {
  member: string | null | undefined;
  /** The credit read says this member has a line. */
  hasLine: boolean;
  /** The member's setting. Null while it is not known: no attempt. */
  enabled: boolean | null;
  /** Defaults to every background kind. Anything else (a bond) is dropped. */
  kinds?: readonly string[];
}

export interface AutoPledger {
  run(input: AutoPledgeInput): Promise<AutoPledgeRun>;
  /** Run other pledging work (after a deposit) in turn with the background run. */
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  busy(): boolean;
}

export function memoryClock(): AutoPledgeClock {
  const at = new Map<string, number>();
  return { get: (key) => at.get(key), set: (key, value) => void at.set(key, value) };
}

export function createAutoPledger(deps: {
  pledge: (kind: AutoPledgeKind, member: string) => Promise<{ pledged: number; error?: string }>;
  /** Something was pledged: refresh what shows the limit. */
  onPledged?: () => void;
  now?: () => number;
  clock?: AutoPledgeClock;
  everyMs?: number;
}): AutoPledger {
  const now = deps.now ?? (() => Date.now());
  const clock = deps.clock ?? memoryClock();
  const everyMs = deps.everyMs ?? AUTO_PLEDGE_EVERY_MS;
  let tail: Promise<unknown> = Promise.resolve();
  let holders = 0;

  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    holders += 1;
    const result = tail.then(work);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      holders -= 1;
    });
  }

  async function run(input: AutoPledgeInput): Promise<AutoPledgeRun> {
    const member = input.member;
    if (!member) return { skipped: 'signed-out' };
    // The window is keyed case-blind; the pledge gets the address as the wallet gave it.
    const who = member.toLowerCase();
    if (input.enabled !== true) return { skipped: 'off' };
    if (!input.hasLine) return { skipped: 'no-line' };
    if (holders > 0) return { skipped: 'busy' };
    const kinds = (input.kinds ?? AUTO_PLEDGE_KINDS).filter(isAutoPledgeKind);
    const due = kinds.filter((kind) => {
      const last = clock.get(`${who}:${kind}`);
      return last === undefined || now() - last >= everyMs;
    });
    if (due.length === 0) return { skipped: 'recent' };

    return exclusive(async () => {
      let pledged = 0;
      const errors: string[] = [];
      for (const kind of due) {
        // Counted before the try, so a failure (a declined signature, a dropped connection) also
        // waits out the window rather than asking again on the next focus.
        clock.set(`${who}:${kind}`, now());
        try {
          const outcome = await deps.pledge(kind, member);
          pledged += outcome.pledged;
          if (outcome.error) errors.push(`${kind}: ${outcome.error}`);
        } catch (error) {
          errors.push(`${kind}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (pledged > 0) {
        try {
          deps.onPledged?.();
        } catch {
          /* a refresh that fails changes nothing that was pledged */
        }
      }
      return { tried: due, pledged, errors };
    });
  }

  return { run, exclusive, busy: () => holders > 0 };
}

/**
 * Whether the credit read shows a line. A complete read with a credit period that has started: a
 * line is opened at signup, and `issuedAt` is zero until it has been. A failed or partial read is
 * not a line (no attempt; the next read tries again).
 */
export function hasCreditLine(credit: { complete?: boolean; cycle?: { issuedAt: number } | null } | null | undefined): boolean {
  return Boolean(credit?.complete && credit.cycle && credit.cycle.issuedAt > 0);
}
