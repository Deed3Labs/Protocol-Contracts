import { pledgeWhatIsHeld } from '@/lib/pledgeSigning';
import { markChainStale } from '@/lib/chainStale';
import { readRemembered, writeRemembered } from '@/lib/rememberedState';
import { getMemberSecurity, updateMemberSecurity, type PledgeKindName } from '@/utils/apiClient';
import { AUTO_PLEDGE_EVERY_MS, createAutoPledger, isAutoPledgeKind, type AutoPledgeClock } from '@/lib/autoPledgeSchedule';

/*
 * The app's one background pledger, and the member's setting that governs it.
 *
 * The rules are in autoPledgeSchedule.ts. This wires them to the real pledge (`pledgeWhatIsHeld`:
 * the server says what is held and not pledged, the phone checks and signs, the server submits),
 * to the device for the ten-minute window, and to the server for the setting, which lives with the
 * member's other account switches so it follows them to another phone.
 */

/** The last try per member and kind, kept on the device and dropped at sign-out. */
const deviceClock: AutoPledgeClock = {
  get: (key) => readRemembered<number>(`autopledge-at:${key}`),
  set: (key, at) => writeRemembered(`autopledge-at:${key}`, at),
};

let activeChainId = 0;

export const autoPledger = createAutoPledger({
  pledge: (kind, member) => pledgeWhatIsHeld({ kind, member, chainId: activeChainId }),
  // The limit is read from the chain; re-read it once the pledge and the capacity push have landed.
  onPledged: () => markChainStale(),
  clock: deviceClock,
});

/** The background run for one member on one network. Never throws. */
export function runAutoPledge(args: { member: string | null | undefined; chainId: number; hasLine: boolean; enabled: boolean | null }) {
  activeChainId = args.chainId;
  return autoPledger.run(args).then(
    (outcome) => {
      if ('errors' in outcome && outcome.errors.length) console.warn('[auto-pledge]', outcome.errors.join('; '));
      return outcome;
    },
    (error) => {
      console.warn('[auto-pledge] not run:', error instanceof Error ? error.message : error);
      return { skipped: 'busy' as const };
    },
  );
}

// ---- The member's setting -------------------------------------------------------------------------

const settingKey = (member: string) => `autopledge:${member.toLowerCase()}`;
/** The server's answer, kept for as long as the background window so a focus does not re-ask. */
const known = new Map<string, { on: boolean; at: number }>();

function rememberSetting(member: string, on: boolean): void {
  known.set(settingKey(member), { on, at: Date.now() });
  writeRemembered(settingKey(member), on);
}

/**
 * Whether this member lets the app pledge Savings and Earn in the background: the server's answer
 * (re-asked after ten minutes, so a change made on another phone is picked up), else what this
 * device last heard, else null (not known; the background run waits).
 */
export async function autoPledgeSetting(member: string): Promise<boolean | null> {
  const cached = known.get(settingKey(member));
  if (cached && Date.now() - cached.at < AUTO_PLEDGE_EVERY_MS) return cached.on;
  const security = await getMemberSecurity().catch(() => null);
  if (security) {
    const on = security.autoPledge !== false;
    rememberSetting(member, on);
    return on;
  }
  return cached?.on ?? readRemembered<boolean>(settingKey(member)) ?? null;
}

/** What Settings shows before the server answers. */
export function lastKnownAutoPledge(member: string): boolean | undefined {
  return known.get(settingKey(member))?.on ?? readRemembered<boolean>(settingKey(member));
}

/** Turn it on or off, on the server. Nothing already pledged is released by turning it off. */
export async function saveAutoPledgeSetting(member: string, on: boolean): Promise<{ ok: boolean; error?: string }> {
  const saved = await updateMemberSecurity({ autoPledge: on }).catch(() => null);
  if (!saved) return { ok: false, error: 'That did not save. Nothing changed. Try again in a moment.' };
  rememberSetting(member, saved.autoPledge !== false);
  return { ok: true };
}

/**
 * After savings, the pool or a bond lands: ask the member to sign the pledge that makes it back the
 * line. Savings and Earn follow the member's setting (on unless turned off; a setting that could not
 * be read counts as on, the default). A bond is always asked for here: that is its explicit flow.
 * Runs in turn with the background pledger. Not awaited by callers; never throws.
 */
export function pledgeAfterMove(kind: PledgeKindName, member: string, chainId: number): void {
  void (async () => {
    if (isAutoPledgeKind(kind) && (await autoPledgeSetting(member)) === false) return;
    const outcome = await autoPledger.exclusive(() => pledgeWhatIsHeld({ kind, member, chainId }));
    if (outcome.error) console.warn(`[pledge] ${kind}:`, outcome.error);
  })().catch((error) => console.warn(`[pledge] ${kind} not signed:`, error instanceof Error ? error.message : error));
}
