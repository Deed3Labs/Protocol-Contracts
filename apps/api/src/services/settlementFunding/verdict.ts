import type { DeskConfig } from './config.js';
import { fundingPlan } from './desk.js';

/*
 * Card settlement's verdict (decision 54): will members' credit swipes settle at the next cut-off,
 * and if not, how far short and by when. One function for Home, Money and the desk: what the desk
 * moves on its own is `fundingPlan`, the rule its own decision uses, so they cannot disagree.
 *
 *   target = due + buffer; have = CSA + in flight; need = target − have.
 *   The desk books from the Collection Account, then the lane covers what it can (both zero when the
 *   desk can't move: the lane is stopped, the desk is halted, or it runs dry).
 *   Covered: need ≤ 0. On track: the desk closes the whole gap. Buffer short: swipes are covered but
 *   not the buffer. Short: otherwise ("Desk stopped" when that's why).
 *
 * Figures are dollars, as the card's are; the rule runs in USDC units.
 */

export type VerdictState = 'covered' | 'ontrack' | 'thin' | 'short';
/** The colour a figure or pill takes, as the page's variables name them. */
export type Tone = 'settled' | 'underway' | 'absent' | null;

export interface VerdictCell {
  label: string;
  value: string;
  sub: string;
  tone: Tone;
}

export interface SettlementVerdict {
  state: VerdictState;
  /** The pill: Covered · On track · Buffer short · Short, or Desk stopped (or Dry run) when that's why. */
  label: string;
  tone: Exclude<Tone, null>;
  /** What the desk moves on its own before the cut-off. */
  willMove: { book: number; lane: number };
  /** Swipes that won't settle after that, and the same including the buffer. */
  gapDue: number;
  gapBuffer: number;
  /** What will be in the account by the cut-off: CSA, in flight and what the desk moves. */
  after: number;
  target: number;
  /** The latest pool money can leave (ms): the cut-off less the off-ramp latency. */
  fundBy: number;
  /** "$1,513.60 short", "Buffer $X short", "On track", "Covered": the notifications' title. */
  head: string;
  /** "Fund by 09:00", or "Desk moves it at 08:00". */
  when: string;
  /** The slim card's and the strip's short line. */
  brief: string;
  /** The hero sentence, as the reference words it (for Records and the guide; the card leads with the cells). */
  line: string;
  /** The stat band: Due at, Will be there, Short (or Buffer short), Fund by (or Desk runs, or Act by). */
  cells: [VerdictCell, VerdictCell, VerdictCell, VerdictCell];
}

export interface VerdictInput {
  due: number;
  buffer: number;
  csa: number;
  inFlight: number;
  /** The Collection Account's balance; null when it can't be read. */
  collection: number | null;
  /** The lane's limits now: the pool's room, the period's cap left and the forwarder's allowance left. */
  laneRoom: number;
  capLeft: number;
  forwardLeft: number;
  /** The lane is set up (the SL upgrade, a funder, the forwarder): until then it moves nothing. */
  laneReady: boolean;
  /** Why nothing moves on its own, when it doesn't: the lane stopped or the desk halted. */
  stopped: { why: string } | null;
  dryRun: boolean;
  /** The next cut-off, the desk's forced run, and the off-ramp's latency (minutes). */
  cutoff: number;
  forcedAt: number;
  latencyMinutes: number;
  /** The cut-off's own zone, for the times the card says. */
  timeZone: string;
}

const UNIT = 1_000_000;
const units = (v: number) => BigInt(Math.round(Math.max(0, v) * UNIT));
const dollars = (u: bigint) => Number(u) / UNIT;
const round = (v: number) => Math.round(v * 100) / 100;

export const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const hhmm = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(ms));

export function settlementVerdict(i: VerdictInput, c: Pick<DeskConfig, 'collectionReserve' | 'minMove'>): SettlementVerdict {
  const target = round(i.due + i.buffer);
  const have = round(i.csa + i.inFlight);
  const need = round(target - have);
  const moves = !i.stopped && !i.dryRun;
  const plan = moves
    ? fundingPlan(
        { need: units(need), collection: i.collection === null ? null : units(i.collection), laneRoom: units(i.laneRoom), capLeft: units(i.capLeft), forwardLeft: units(i.forwardLeft), laneReady: i.laneReady },
        c,
      )
    : { book: 0n, deploy: 0n };
  const book = dollars(plan.book),
    lane = dollars(plan.deploy);
  const after = round(have + book + lane);
  const gapDue = round(Math.max(0, i.due - after));
  const gapBuffer = round(Math.max(0, target - after));
  const state: VerdictState = need <= 0 ? 'covered' : gapBuffer <= 0 ? 'ontrack' : gapDue <= 0 ? 'thin' : 'short';
  const tone: Exclude<Tone, null> = state === 'covered' ? 'settled' : state === 'short' ? 'absent' : 'underway';
  const label = state === 'covered' ? 'Covered' : state === 'ontrack' ? 'On track' : state === 'thin' ? 'Buffer short' : i.stopped ? 'Desk stopped' : i.dryRun ? 'Dry run' : 'Short';

  const fundBy = i.cutoff - i.latencyMinutes * 60_000;
  const t = (ms: number) => hhmm(ms, i.timeZone);
  const by = t(fundBy),
    forced = t(i.forcedAt),
    cut = t(i.cutoff);
  const moved = book + lane;

  const line =
    state === 'covered'
      ? `Covered. ${usd(i.csa)} is in the account and ${i.inFlight ? `${usd(i.inFlight)} is arriving` : 'nothing more is needed'}, ${usd(i.buffer)} buffer included.`
      : state === 'ontrack'
        ? `On track. The desk ${[book ? `books ${usd(book)} of repayments` : '', lane ? `draws ${usd(lane)} from the pool by ${forced}` : ''].filter(Boolean).join(' and ')}. Nothing needs you.`
        : state === 'thin'
          ? `Swipes are covered, but the buffer is ${usd(gapBuffer)} short after what the desk can move. Top it up by ${by}.`
          : i.stopped
            ? `The desk is stopped (${i.stopped.why.charAt(0).toLowerCase() + i.stopped.why.slice(1)}), so nothing moves on its own. ${usd(gapDue)} of swipes won’t settle (${usd(gapBuffer)} with the buffer) unless someone funds them by ${by}.`
            : `${usd(gapDue)} of swipes won’t settle (${usd(gapBuffer)} with the buffer) after everything the desk can move. Fund it by ${by}, or the bank declines new credit swipes.`;
  const head = state === 'short' ? `${usd(gapDue)} short` : state === 'thin' ? `Buffer ${usd(gapBuffer)} short` : state === 'ontrack' ? 'On track' : 'Covered';
  const when = state === 'ontrack' ? `Desk moves it at ${forced}` : `Fund by ${by}`;
  const brief =
    state === 'covered' ? `Covered · ${usd(Math.max(0, after - target))} spare` : state === 'ontrack' ? `On track · desk moves ${usd(moved)} at ${forced}` : state === 'thin' ? `Buffer ${usd(gapBuffer)} short · fund by ${by}` : `${usd(gapDue)} short · fund by ${by}`;

  const cells: SettlementVerdict['cells'] = [
    { label: `Due at ${cut}`, value: usd(i.due), sub: 'Members’ credit swipes', tone: null },
    { label: 'Will be there', value: usd(after), sub: moved ? 'Including what the desk moves' : 'In the account and arriving', tone: null },
    state === 'covered'
      ? { label: 'Short', value: usd(0), sub: `${usd(i.buffer)} buffer kept`, tone: 'settled' }
      : state === 'ontrack'
        ? { label: 'Short', value: usd(0), sub: `After the desk moves ${usd(moved)}`, tone: 'underway' }
        : state === 'thin'
          ? { label: 'Buffer short', value: usd(gapBuffer), sub: 'Swipes are covered', tone: 'underway' }
          : { label: 'Short', value: usd(gapDue), sub: `${usd(gapBuffer)} with the buffer`, tone: 'absent' },
    state === 'covered'
      ? { label: 'Act by', value: '—', sub: 'Nothing to do', tone: null }
      : state === 'ontrack'
        ? { label: 'Desk runs', value: forced, sub: 'On its own', tone: null }
        : { label: 'Fund by', value: by, sub: i.stopped ? 'Desk stopped' : 'Or swipes decline', tone: state === 'short' ? 'absent' : 'underway' },
  ];
  return { state, label, tone, willMove: { book, lane }, gapDue, gapBuffer, after, target, fundBy, head, when, brief, line, cells };
}
