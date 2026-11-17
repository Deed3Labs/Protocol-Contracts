import { ethers } from 'ethers';
import { getContractAddress } from '../config/contracts.js';
import { chainProvider } from '../services/chain/provider.js';
import { alertOps } from '../services/opsAlert.js';
import {
  BOND_VAULT_READ_ABI,
  PAYOUT_POOL_READ_ABI,
  YIELD_POOL_READ_ABI,
  describePayoutFunding,
  evaluatePayoutFunding,
  formatUsdc,
  gatherPayoutFunding,
  localParts,
  payoutKeeperConfigFromEnv,
  type BondVaultReader,
  type PayoutFundingStatus,
  type PayoutKeeperConfig,
  type PayoutPoolReader,
  type YieldPoolReader,
} from '../services/payoutFunding/fundingStatus.js';

/*
 * The payout funding keeper: tells Clear's team when the PayoutPool is not funded ahead of what it
 * owes merchants.
 *
 * Since decision 17 nothing on chain borrows for a payout. Clear Lending funds the pool ahead of
 * time (addendum 12.10: no later than two business days before each merchant's payout deadline),
 * and keeps a standing balance: the payable balance at or above the claims due within the next 30
 * days (decision 49). This reads the chain hourly and says when either rule is not met
 * (services/payoutFunding/fundingStatus.ts has the rules and the arithmetic).
 *
 * Read-only. It holds no key, builds no transaction and calls only views; the funding options in
 * its message are for whoever moves the money.
 *
 * Alerts go through opsAlert (OPS_ALERT_EMAIL), once per condition per day: the first RED or AMBER
 * of a day alerts, and so does anything worse later that day: a higher level, a larger shortfall
 * at either horizon, or a claim newly past its deadline. The same condition hour after hour does
 * not. The day is the calendar day in PAYOUT_KEEPER_TIMEZONE. What has been alerted today is kept
 * in memory; after a restart the opsAlert key (which names the day, level, shortfalls and overdue
 * claims) still stops an identical repeat. GREEN is logged and nothing more.
 *
 * Off unless PAYOUT_KEEPER_ENABLED=1.
 */

const HOUR_MS = 60 * 60 * 1000;
/** Passes in a row that fail to read the chain before somebody is told the keeper is blind. */
const FAILURES_BEFORE_ALERT = 3;

const RANK = { GREEN: 0, AMBER: 1, RED: 2 } as const;

/** What has been alerted today, to tell a worse condition from the same one. */
export interface AlertMemory {
  day: string;
  rank: number;
  deadlineShort: bigint;
  standingShort: bigint;
  overdueIds: Set<string>;
}

/** FNV-1a, so a key can name a set of claims without listing them all. */
function fingerprint(ids: string[]): string {
  let h = 0x811c9dc5;
  for (const ch of [...ids].sort().join(',')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The opsAlert key: the same condition on the same day is the same key. */
export function alertKey(status: PayoutFundingStatus, day: string, scope: string): string {
  const ids = status.overdue.ids.map(String);
  return [
    'payout-funding',
    scope,
    day,
    status.level,
    `due${status.config.deadlineBusinessDays}bd=${status.deadline.short}`,
    `due${status.config.standingDays}d=${status.standing.short}`,
    `overdue=${ids.length}-${fingerprint(ids)}`,
  ].join(':');
}

/**
 * Whether this status should alert, given what was alerted earlier today. Pure.
 * Alerts on the first RED or AMBER of a day, and again only if it is worse than everything
 * alerted so far today.
 */
export function decideAlert(
  memory: AlertMemory | null,
  status: PayoutFundingStatus,
  day: string,
): { send: boolean; why: string; memory: AlertMemory | null } {
  const today = memory && memory.day === day ? memory : null;
  if (status.level === 'GREEN') return { send: false, why: 'green', memory: today };
  const ids = status.overdue.ids.map(String);
  const rank = RANK[status.level];
  if (!today) {
    return {
      send: true,
      why: 'first today',
      memory: { day, rank, deadlineShort: status.deadline.short, standingShort: status.standing.short, overdueIds: new Set(ids) },
    };
  }
  const worse: string[] = [];
  if (rank > today.rank) worse.push(`now ${status.level}`);
  if (status.deadline.short > today.deadlineShort) worse.push('larger shortfall inside the 12.10 deadline');
  if (status.standing.short > today.standingShort) worse.push('larger standing-balance shortfall');
  if (ids.some((id) => !today.overdueIds.has(id))) worse.push('a claim newly past its deadline');
  if (!worse.length) return { send: false, why: 'already alerted today', memory: today };
  return {
    send: true,
    why: worse.join(', '),
    memory: {
      day,
      rank: Math.max(rank, today.rank),
      deadlineShort: status.deadline.short > today.deadlineShort ? status.deadline.short : today.deadlineShort,
      standingShort: status.standing.short > today.standingShort ? status.standing.short : today.standingShort,
      overdueIds: new Set([...today.overdueIds, ...ids]),
    },
  };
}

export interface KeeperReading {
  status: PayoutFundingStatus;
  /** For the message and the key: which chain and pool. */
  chain: string;
  payoutPool: string;
}

export interface KeeperDeps {
  read: () => Promise<KeeperReading>;
  alert: (input: { key: string; subject: string; body: string }) => Promise<void>;
  config: PayoutKeeperConfig;
  /** The wall clock, for the alert day when the chain cannot be read. Seconds. */
  clock?: () => number;
  log?: (line: string) => void;
  warn?: (line: string) => void;
}

export type TickResult = 'GREEN' | 'AMBER' | 'RED' | 'failed' | 'busy';

export function createPayoutFundingKeeper(deps: KeeperDeps) {
  const log = deps.log ?? ((line: string) => console.log(line));
  const warn = deps.warn ?? ((line: string) => console.warn(line));
  const clock = deps.clock ?? (() => Math.floor(Date.now() / 1000));
  let memory: AlertMemory | null = null;
  let failures = 0;
  let running = false;

  async function tick(): Promise<TickResult> {
    if (running) return 'busy';
    running = true;
    try {
      let reading: KeeperReading;
      try {
        reading = await deps.read();
      } catch (error) {
        failures += 1;
        const why = (error as Error)?.message ?? String(error);
        warn(`[payout-keeper] could not read the chain (${failures} in a row): ${why}`);
        if (failures >= FAILURES_BEFORE_ALERT) {
          const day = localParts(clock(), deps.config.timeZone).date;
          await deps.alert({
            key: `payout-funding:read-failed:${day}`,
            subject: 'Payout funding keeper cannot read the chain',
            body: `The payout funding keeper has failed ${failures} passes in a row, so nobody is being told whether the PayoutPool is funded ahead of merchant deadlines.\n\nLast error: ${why}\n\nCheck by hand: npx hardhat run scripts/check_payout_funding.ts --network <network>`,
          });
        }
        return 'failed';
      }
      failures = 0;
      const { status } = reading;
      const day = localParts(status.now, status.config.timeZone).date;
      if (status.level === 'GREEN') {
        memory = decideAlert(memory, status, day).memory;
        log(
          `[payout-keeper] GREEN: payable ${formatUsdc(status.payable)}, due within ${status.config.standingDays}d ${formatUsdc(status.standing.amount)}`,
        );
        return 'GREEN';
      }
      const decision = decideAlert(memory, status, day);
      memory = decision.memory;
      if (!decision.send) {
        log(`[payout-keeper] ${status.level}, not alerted again (${decision.why})`);
        return status.level;
      }
      const { subject, body } = describePayoutFunding(status, reading);
      await deps.alert({ key: alertKey(status, day, `${reading.chain}:${reading.payoutPool}`), subject, body });
      warn(`[payout-keeper] ${status.level} alerted (${decision.why})`);
      return status.level;
    } catch (error) {
      warn(`[payout-keeper] pass failed: ${(error as Error)?.message ?? error}`);
      return 'failed';
    } finally {
      running = false;
    }
  }

  return { tick, memory: () => memory };
}

function chainId(): number {
  const parsed = Number((process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 84532;
}

export function payoutKeeperEnabled(): boolean {
  return /^(1|true|on|yes)$/i.test((process.env.PAYOUT_KEEPER_ENABLED || '').trim());
}

/** The keeper wired to this server's chain provider and contract addresses. Reads only. */
export function defaultKeeperDeps(): KeeperDeps | null {
  const id = chainId();
  const payoutPool = getContractAddress(id, 'PayoutPool');
  if (!payoutPool) return null;
  const yieldPool = getContractAddress(id, 'LendingPool');
  const bondVault = getContractAddress(id, 'BondVault');
  const config = payoutKeeperConfigFromEnv(process.env);
  const provider = chainProvider(id);
  const reader = <T>(address: string, abi: readonly string[]) => new ethers.Contract(address, abi, provider) as unknown as T;
  return {
    config,
    alert: alertOps,
    read: async () => {
      const reads = await gatherPayoutFunding(
        {
          now: async () => {
            const block = await provider.getBlock('latest');
            if (!block) throw new Error('no latest block');
            return block.timestamp;
          },
          payoutPool: reader<PayoutPoolReader>(payoutPool, PAYOUT_POOL_READ_ABI),
          yieldPool: yieldPool ? reader<YieldPoolReader>(yieldPool, YIELD_POOL_READ_ABI) : null,
          bondVault: bondVault ? reader<BondVaultReader>(bondVault, BOND_VAULT_READ_ABI) : null,
        },
        config,
      );
      return { status: evaluatePayoutFunding(reads, config), chain: `chain ${id}`, payoutPool };
    },
  };
}

export function startPayoutFundingKeeper(): void {
  if (!payoutKeeperEnabled()) {
    console.log('[payout-keeper] disabled (set PAYOUT_KEEPER_ENABLED=1 to watch PayoutPool funding)');
    return;
  }
  const deps = defaultKeeperDeps();
  if (!deps) {
    console.log(`[payout-keeper] disabled (no PayoutPool address for chain ${chainId()})`);
    return;
  }
  const keeper = createPayoutFundingKeeper(deps);
  setInterval(() => void keeper.tick(), HOUR_MS).unref?.();
  void keeper.tick();
  console.log('[payout-keeper] started (hourly, read-only)');
}
