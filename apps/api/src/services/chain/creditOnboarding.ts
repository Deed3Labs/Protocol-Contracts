import { ethers } from 'ethers';
import { getPayPool, getPostgresPool } from '../../config/postgres.js';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider } from './provider.js';
import { chainErrorReason, describeOnboardingRefusal } from './chainErrors.js';
import { decodeStateCode, encodeStateCode, normalizeStateCode } from './stateCode.js';
import { openCreditLine, openLineDeps, openLineWith, type OpenLineResult } from './creditLineService.js';
import { memberWallets } from './cycleKeeper.js';
import { asOperator } from './operatorQueue.js';
import { dayKey, envCount, hourKey, keeperChainId, keeperMode, liveRunner, type CallRunner, type KeeperMode } from './keeperKit.js';
import { alertOps } from '../opsAlert.js';
import { memberStore } from '../memberStore.js';
import { verified } from '../credit/termLimitService.js';

/*
 * Credit onboarding: every eligible member gets a credit line, without anyone running a script.
 *
 * RevolvingIssuer opens no line until the member's state of residence is attested on chain
 * (`NetworkRegistry.stateCodeOf`, written by `attestStateCode` under STATE_ATTESTER_ROLE) and the
 * revolving product is enabled there (RateSchedule). So, per member, the chain decides, and a rerun
 * or a restart repeats nothing:
 *   - a line already (`creditPeriods.issuedAt`): nothing to do;
 *   - no state attested: attest the state on the member's private profile, but only for a member
 *     whose identity check passed (Lithic's account holder ACCEPTED, the one identity state the app
 *     shows), and only a real two-letter US state (a full name is read as its code; anything else is
 *     skipped, never guessed). Then open the line;
 *   - a state attested that differs from the profile: never overwritten here. Ops are told once,
 *     and the line is opened on the attested state;
 *   - the revolving product not enabled in that state: recorded, and not tried again for a day.
 * Until the attester holds STATE_ATTESTER_ROLE (granted through the CreditTimelock) the job stands
 * down on attestations with one line per run, and opens lines only for members already attested.
 *
 * Every send is simulated first (keeperKit) and goes through the credit operator's queue, which
 * the attester shares by default. Failures are logged and alerted, at most hourly. Logs carry counts
 * and wallets, never a member's state next to their wallet, nor a name or an address.
 */

const REGISTRY_ABI = [
  'function stateCodeOf(address member) view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function attestStateCode(address member, bytes32 stateCode)',
];
const REGISTRY = new ethers.Interface(REGISTRY_ABI);
const ISSUER_ABI = [
  'function creditPeriods(address member) view returns (uint256 issuedAt, uint256 expiration, uint256 graceLength, bool paused)',
  'function stableCredit() view returns (address)',
];

export const STATE_ATTESTER_ROLE = ethers.id('STATE_ATTESTER_ROLE');

/** Members acted on per run (an attestation and its line count once). The rest wait for the next. */
export const DEFAULT_MAX_PER_RUN = 25;
/** How long a member whose state has no revolving product is left alone. */
export const NOT_ENABLED_BACKOFF_S = 24 * 60 * 60;

export type WaitReason =
  | 'awaiting_role'
  | 'not_verified'
  | 'no_state'
  | 'unrecognized_state'
  | 'profile_unreadable'
  | 'state_not_enabled'
  | 'state_not_confirmed'
  | 'backing_off'
  | 'in_progress'
  | 'refused';

const WAIT_WORDS: Record<WaitReason, string> = {
  awaiting_role: 'awaiting the attester role',
  not_verified: 'identity not verified',
  no_state: 'no state on profile',
  unrecognized_state: 'state on profile not a US state',
  profile_unreadable: 'profile unreadable here',
  state_not_enabled: 'product not enabled in their state',
  state_not_confirmed: 'state not yet visible on chain',
  backing_off: 'not enabled, retried tomorrow',
  in_progress: 'already in progress',
  refused: 'refused by the contract',
};

export interface OnboardingResult {
  wallet: string;
  action: 'has_line' | 'opened' | 'would_send' | 'waiting' | 'deferred' | 'failed';
  wait?: WaitReason;
  /** This run attested the member's state (live), or would (dry run). */
  attested?: boolean;
  wouldAttest?: boolean;
  /** An attested state that differs from the profile's; ops were told. */
  mismatch?: boolean;
  txHashes?: string[];
  reason?: string;
}

export interface OnboardingRun {
  checked: number;
  results: OnboardingResult[];
  /** Why attestations are paused this run, if they are. */
  attestPaused: string | null;
}

export type Readiness = { ready: true } | { ready: false; why: string; alert?: boolean };

export interface OnboardingDeps {
  registry: string;
  reader: {
    creditPeriods(member: string): Promise<readonly unknown[]>;
    stateCodeOf(member: string): Promise<string>;
  };
  /** Simulates and sends `attestStateCode` as the state attester. */
  attester: CallRunner;
  /** Whether attestations can be sent this run: the role, and the registry the issuer reads. */
  attestReadiness(): Promise<Readiness>;
  openLine(wallet: string, dryRun: boolean): Promise<OpenLineResult>;
  verified(wallet: string): Promise<boolean>;
  addressState(wallet: string): Promise<{ addressState: string | null; unreadable?: boolean }>;
  wallets(): Promise<string[]>;
  alert(input: { key: string; subject: string; body: string }): Promise<unknown>;
  mode: 'dry_run' | 'live';
  now?: number;
  maxPerRun?: number;
  /** wallet -> unix seconds before which a not-enabled member is not tried again. */
  backoff?: Map<string, number>;
}

const backoffs = new Map<string, number>();
const alerted = new Set<string>();
const inFlight = new Set<string>();

const waiting = (wallet: string, wait: WaitReason, extra: Partial<OnboardingResult> = {}): OnboardingResult => ({
  wallet,
  action: 'waiting',
  wait,
  ...extra,
});

/**
 * One member, end to end. `claim` takes one from the run's budget, or says there is none left; it is
 * asked only once a write (or its simulation) is due, so members with nothing to do cost nothing.
 */
export async function onboardMember(
  deps: OnboardingDeps,
  wallet: string,
  context: { attestReady: boolean; claim: () => boolean },
): Promise<OnboardingResult> {
  const key = wallet.toLowerCase();
  if (inFlight.has(key)) return waiting(wallet, 'in_progress');
  inFlight.add(key);
  try {
    return await onboard(deps, wallet, context);
  } finally {
    inFlight.delete(key);
  }
}

async function onboard(
  deps: OnboardingDeps,
  wallet: string,
  context: { attestReady: boolean; claim: () => boolean },
): Promise<OnboardingResult> {
  const now = deps.now ?? Math.floor(Date.now() / 1000);
  const backoff = deps.backoff ?? backoffs;
  const dryRun = deps.mode === 'dry_run';
  const result: OnboardingResult = { wallet, action: 'failed' };
  try {
    const [issuedAt] = await deps.reader.creditPeriods(wallet);
    if (Number(issuedAt) > 0) return { wallet, action: 'has_line' };
    if ((backoff.get(wallet.toLowerCase()) ?? 0) > now) return waiting(wallet, 'backing_off');

    const onChain = decodeStateCode(await deps.reader.stateCodeOf(wallet));
    if (onChain === null) {
      if (!context.attestReady) return waiting(wallet, 'awaiting_role');
      if (!(await deps.verified(wallet))) return waiting(wallet, 'not_verified');
      const profile = await deps.addressState(wallet);
      if (profile.unreadable) return waiting(wallet, 'profile_unreadable');
      const parsed = normalizeStateCode(profile.addressState);
      if (!parsed.ok) return waiting(wallet, parsed.reason === 'missing' ? 'no_state' : 'unrecognized_state');
      if (!context.claim()) return { wallet, action: 'deferred' };

      const call = { to: deps.registry, data: REGISTRY.encodeFunctionData('attestStateCode', [wallet, encodeStateCode(parsed.code)]) };
      const sim = await deps.attester.simulate(call);
      if (sim.kind === 'refused') return waiting(wallet, 'refused', { reason: sim.sentence });
      if (sim.kind === 'failed') {
        // The deployed contracts are built with revert strings stripped, so a missing role reverts
        // with no data at all. Ask the chain before calling it a failure: a role revoked since the
        // run began is a pause, not an alert.
        const again = await deps.attestReadiness().catch(() => null);
        if (again && !again.ready) return waiting(wallet, 'awaiting_role', { reason: again.why });
        return { ...result, reason: `attestStateCode simulation ${sim.reason}` };
      }
      // The line cannot be simulated before the state it needs is on chain: a dry run stops here.
      if (dryRun) return { wallet, action: 'would_send', wouldAttest: true, reason: 'would attest the state, then open the line' };
      const sent = await deps.attester.send(call);
      result.txHashes = [sent.hash];
      if (sent.status === 0) return { ...result, reason: 'attestStateCode reverted on chain' };
      result.attested = true;
    } else {
      // Never overwritten here: a member who has moved is a decision for a person.
      const profile = await deps.addressState(wallet).catch(() => null);
      const parsed = normalizeStateCode(profile?.addressState);
      if (parsed.ok && parsed.code !== onChain) {
        result.mismatch = true;
        const alertKey = `credit-onboarding:state-mismatch:${wallet.toLowerCase()}:${ethers.encodeBytes32String(onChain)}`;
        if (!alerted.has(alertKey)) {
          alerted.add(alertKey);
          await deps
            .alert({
              key: alertKey,
              subject: `Credit onboarding: ${wallet}'s attested state differs from their profile`,
              body:
                `NetworkRegistry.stateCodeOf(${wallet}) holds a state that is not the one on the member's private profile now. ` +
                'The job never overwrites an attestation. Check where the member lives; if they have moved, attest the new state by hand ' +
                '(attestStateCode, STATE_ATTESTER_ROLE). The line is opened on the state already attested.',
            })
            .catch(() => null);
        }
      }
      if (!context.claim()) return { ...result, action: 'deferred' };
    }

    const open = await deps.openLine(wallet, dryRun);
    if (open.txHash) result.txHashes = [...(result.txHashes ?? []), open.txHash];
    if (open.opened) return { ...result, action: 'opened' };
    switch (open.reason) {
      case 'already has a line':
        return { ...result, action: 'has_line' };
      case 'dry_run':
        return { ...result, action: 'would_send', reason: 'would open the line' };
      case 'state_not_enabled':
        backoff.set(wallet.toLowerCase(), now + NOT_ENABLED_BACKOFF_S);
        return { ...result, action: 'waiting', wait: 'state_not_enabled' };
      case 'state_not_confirmed':
        return { ...result, action: 'waiting', wait: 'state_not_confirmed' };
      default:
        return { ...result, action: 'failed', reason: `openLine: ${open.detail ?? open.reason ?? 'not opened'}`.slice(0, 300) };
    }
  } catch (error) {
    return { ...result, action: 'failed', reason: chainErrorReason(error).slice(0, 300) };
  }
}

let running = false;

/** One pass over every member on record. Runs never overlap. */
export async function runCreditOnboarding(deps: OnboardingDeps): Promise<OnboardingRun> {
  const run: OnboardingRun = { checked: 0, results: [], attestPaused: null };
  if (running) return run;
  running = true;
  try {
    const now = deps.now ?? Math.floor(Date.now() / 1000);
    let readiness: Readiness;
    try {
      readiness = await deps.attestReadiness();
    } catch (error) {
      readiness = { ready: false, why: `the attester's role could not be read (${chainErrorReason(error).slice(0, 120)})` };
    }
    if (!readiness.ready) {
      run.attestPaused = readiness.why;
      if (readiness.alert) {
        await deps
          .alert({ key: `credit-onboarding:not-ready:${dayKey(now)}`, subject: 'Credit onboarding: attestations paused', body: readiness.why })
          .catch(() => null);
      }
    }
    let budget = deps.maxPerRun ?? DEFAULT_MAX_PER_RUN;
    const claim = () => {
      if (budget <= 0) return false;
      budget -= 1;
      return true;
    };
    const context = { attestReady: readiness.ready, claim };
    for (const wallet of await deps.wallets()) {
      run.checked += 1;
      run.results.push(await onboardMember({ ...deps, now }, wallet, context));
    }

    const failed = run.results.filter((r) => r.action === 'failed');
    for (const f of failed) console.error(`[credit-onboarding] ${f.wallet} failed: ${f.reason}`);
    if (failed.length) {
      await deps
        .alert({
          key: `credit-onboarding:failures:${hourKey(now)}`,
          subject: `Credit onboarding: ${failed.length} member(s) not onboarded`,
          body:
            `Failed: ${failed.map((f) => `${f.wallet} (${f.reason})`).join('; ')}. ` +
            'Check that the credit operator (and the state attester, if it is a separate key) holds Base Sepolia ETH, that the credit operator may open lines on the RevolvingIssuer, and the RPC. The next run retries.',
        })
        .catch(() => null);
    }
    const would = run.results.filter((r) => r.action === 'would_send');
    if (would.length) {
      const attest = would.filter((r) => r.wouldAttest).length;
      await deps
        .alert({
          key: `credit-onboarding:dry-run:${dayKey(now)}`,
          subject: `Credit onboarding (dry run): would attest ${attest} state(s) and open ${would.length - attest} line(s)`,
          body:
            `The simulations succeed for ${would.length} member(s): ${attest} state attestation(s), whose lines follow in the same run, ` +
            `and ${would.length - attest} line(s) for members already attested. Nothing was sent: dry run.`,
        })
        .catch(() => null);
    }
    return run;
  } finally {
    running = false;
  }
}

/** The run in one line: counts, never a member's state. */
export function summarize(run: OnboardingRun, mode: 'dry_run' | 'live'): string {
  const count = (a: OnboardingResult['action']) => run.results.filter((r) => r.action === a);
  const opened = count('opened');
  const waitingOnes = count('waiting');
  const byWait = new Map<WaitReason, number>();
  for (const r of waitingOnes) if (r.wait) byWait.set(r.wait, (byWait.get(r.wait) ?? 0) + 1);
  const waits = [...byWait].map(([w, n]) => `${n} ${WAIT_WORDS[w]}`).join(', ');
  const parts = [
    `${count('has_line').length} with a line`,
    mode === 'dry_run'
      ? `${count('would_send').length} would be sent (${count('would_send').filter((r) => r.wouldAttest).length} attestation(s))`
      : `${opened.length} opened (${run.results.filter((r) => r.attested).length} attested first)`,
    `${waitingOnes.length} waiting${waits ? ` (${waits})` : ''}`,
    `${count('deferred').length} left for the next run`,
    `${count('failed').length} failed`,
  ];
  const mismatched = run.results.filter((r) => r.mismatch).length;
  if (mismatched) parts.push(`${mismatched} attested state(s) differ from the profile (alerted)`);
  const paused = run.attestPaused ? ` Attestations paused: ${run.attestPaused}.` : '';
  return `[credit-onboarding]${mode === 'dry_run' ? ' dry run:' : ''} ${run.checked} member(s): ${parts.join(', ')}.${paused}`;
}

/* ---- Wiring ---- */

/** CREDIT_ONBOARDING_ENABLED=1 turns the job on; CREDIT_ONBOARDING_DRY_RUN=1 simulates only. */
export const onboardingMode = (env: Record<string, string | undefined> = process.env): KeeperMode => keeperMode('CREDIT_ONBOARDING', env);

/** The attester's key: its own if set, else the credit operator's (the owner's choice). Never logged. */
export function stateAttesterKey(env: Record<string, string | undefined> = process.env): string | null {
  const raw = (env.STATE_ATTESTER_PRIVATE_KEY || env.CREDIT_OPERATOR_PRIVATE_KEY || '').trim();
  if (!raw) return null;
  return raw.startsWith('0x') ? raw : `0x${raw}`;
}

/** What is missing for the job to run, or null when it can. */
export function onboardingUnconfigured(env: Record<string, string | undefined> = process.env): string | null {
  const chainId = keeperChainId(env);
  const missing: string[] = [];
  if (!getContractAddress(chainId, 'RevolvingIssuer')) missing.push('the RevolvingIssuer');
  if (!getContractAddress(chainId, 'NetworkRegistry')) missing.push('the NetworkRegistry');
  if (!(env.CREDIT_OPERATOR_PRIVATE_KEY || '').trim()) missing.push('CREDIT_OPERATOR_PRIVATE_KEY');
  if (!getPostgresPool()) missing.push('the members DB');
  return missing.length ? `needs ${missing.join(', ')}` : null;
}

/**
 * Whether attestations can be sent: the registry the RevolvingIssuer's state gate reads (through its
 * ledger, `ClearCredit.networkRegistry()`) is the one configured here, and the attester holds
 * STATE_ATTESTER_ROLE on it. Reads only.
 */
export async function attestReadiness(
  provider: ethers.ContractRunner,
  at: { chainId: number; issuer: string; registry: string; attester: string },
): Promise<Readiness> {
  const issuerReads = new ethers.Contract(at.issuer, ISSUER_ABI, provider);
  const ledger = new ethers.Contract(await issuerReads.stableCredit(), ['function networkRegistry() view returns (address)'], provider);
  const gateReads = String(await ledger.networkRegistry());
  if (gateReads.toLowerCase() !== at.registry.toLowerCase()) {
    return {
      ready: false,
      why: `NETWORK_REGISTRY_${at.chainId} is ${at.registry}, but the RevolvingIssuer's state gate reads ${gateReads}`,
      alert: true,
    };
  }
  const registry = new ethers.Contract(at.registry, REGISTRY_ABI, provider);
  if (!(await registry.hasRole(STATE_ATTESTER_ROLE, at.attester))) {
    return { ready: false, why: `the attester ${at.attester} does not hold STATE_ATTESTER_ROLE yet` };
  }
  return { ready: true };
}

export function onboardingDeps(mode: 'dry_run' | 'live', env: Record<string, string | undefined> = process.env): OnboardingDeps | null {
  const chainId = keeperChainId(env);
  const registry = getContractAddress(chainId, 'NetworkRegistry');
  const issuer = getContractAddress(chainId, 'RevolvingIssuer');
  const key = stateAttesterKey(env);
  const open = openLineDeps();
  if (!registry || !issuer || !key || 'reason' in open || onboardingUnconfigured(env)) return null;
  const provider = chainProvider(chainId);
  const registryReads = new ethers.Contract(registry, REGISTRY_ABI, provider);
  const issuerReads = new ethers.Contract(issuer, ISSUER_ABI, provider);
  // The attester shares the credit operator's queue: by default it is the same key.
  const attester = liveRunner(chainId, key, { describe: describeOnboardingRefusal, lock: asOperator });
  return {
    registry,
    reader: {
      creditPeriods: (m) => issuerReads.creditPeriods(m),
      stateCodeOf: (m) => registryReads.stateCodeOf(m),
    },
    attester,
    attestReadiness: () => attestReadiness(provider, { chainId, issuer, registry, attester: attester.from }),
    openLine: (wallet, dryRun) => openLineWith(open, wallet, { dryRun }),
    verified,
    addressState: async (wallet) => {
      if (!memberStore.isPrivateDataEncryptionConfigured()) return { addressState: null, unreadable: true };
      return memberStore.addressStateByWallet(wallet);
    },
    wallets: memberWallets,
    alert: (input) => alertOps(input),
    mode,
    maxPerRun: envCount('CREDIT_ONBOARDING_MAX_PER_RUN', DEFAULT_MAX_PER_RUN, env),
  };
}

/** Why `verified` can say yes for nobody here, if it can't: it reads Lithic's rows in the Pay DB. */
export const identityUnreadable = () => (getPayPool() ? null : 'the Pay DB is not configured, so no identity reads as verified');

/**
 * One member, now: signup and a passed identity check call this so a new member does not wait for
 * the hourly run. With the job live it attests (when it can) and opens; otherwise it only opens the
 * line, as signup always has. Never throws.
 */
export async function onboardCreditLine(wallet: string): Promise<{ opened: boolean; reason?: string; txHash?: string; attested?: boolean }> {
  try {
    const deps = onboardingMode() === 'live' ? onboardingDeps('live') : null;
    if (!deps) return await openCreditLine(wallet);
    const readiness = await deps.attestReadiness().catch((): Readiness => ({ ready: false, why: 'unreadable' }));
    const r = await onboardMember(deps, wallet, { attestReady: readiness.ready, claim: () => true });
    if (r.action === 'opened') return { opened: true, attested: r.attested, txHash: r.txHashes?.at(-1) };
    if (r.action === 'has_line') return { opened: false, reason: 'already has a line' };
    return { opened: false, attested: r.attested, reason: r.wait ?? r.reason ?? r.action };
  } catch (error) {
    return { opened: false, reason: chainErrorReason(error).slice(0, 300) };
  }
}

/**
 * Fire-and-forget, for a route: never awaited into the response, never able to fail it. `signup`
 * opens a line whatever the job's switch (as it always has); `identity` is new, so it only runs
 * once the job is live.
 */
export function onboardInBackground(wallet: string, source: 'signup' | 'identity'): void {
  if (source === 'identity' && onboardingMode() !== 'live') return;
  void onboardCreditLine(wallet)
    .then((result) => {
      if (result.opened) console.log('[credit] line opened for', wallet, result.attested ? '(state attested first)' : '', result.txHash);
      else if (result.reason !== 'already has a line') console.warn('[credit] no line for', wallet, '—', result.reason);
    })
    .catch((error) => console.error('[credit] onboarding threw for', wallet, error));
}
