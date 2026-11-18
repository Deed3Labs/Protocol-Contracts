import { ethers } from 'ethers';

/*
 * Every contract fragment the settlement funding desk uses, in one place, so they can be lined up
 * with the contracts as deployed (decision 54; the Earn spec §6 settlement lane, and the
 * SettlementForwarder). The lane and the forwarder are being written alongside this; the names
 * below are the ones agreed for them. When the contracts land, compare this file with their ABIs
 * and change only here.
 *
 * Agreed (the owner's spec, section 1 and 2):
 *   LendingPool (the Yield Pool, forwarding to YieldPoolValuation like `deploy`):
 *     deploySettlement(uint256 amount, bytes32 ref)       only the registered funder; to CL Operating
 *     event SettlementDeployed(id, amount, ref, periodUsed)
 *     settlementFunder() / settlementCapPerPeriod() / settlementPeriodSeconds()
 *     settlementPeriodUsed() / settlementHeadroom()
 *   SettlementForwarder (CL Operating's AllowanceModule delegate):
 *     forward(uint256 amount)                             only the desk wallet; USDC to the off-ramp
 *
 * To align (named here, not yet in the spec): the forwarder's views `desk()`, `offRamp()`, `safe()`
 * and `token()`. The desk reads them only to check its own configuration and carries on, with a
 * warning, when they are missing.
 *
 * The event is matched by its topic (the signature does not depend on which arguments are indexed)
 * and the ref is looked for in its topics and data, so the indexing chosen for it does not matter.
 */

export const SETTLEMENT_LANE_ABI = [
  'function deploySettlement(uint256 amount, bytes32 ref)',
  'function settlementFunder() view returns (address)',
  'function settlementCapPerPeriod() view returns (uint256)',
  'function settlementPeriodSeconds() view returns (uint64)',
  'function settlementPeriodUsed() view returns (uint256)',
  'function settlementHeadroom() view returns (uint256)',
  'event SettlementDeployed(uint256 id, uint256 amount, bytes32 ref, uint256 periodUsed)',
] as const;

/** The Yield Pool's existing views and the Return, which the lane's conditions are checked against. */
export const YIELD_POOL_ABI = [
  ...SETTLEMENT_LANE_ABI,
  'function asset() view returns (address)',
  'function availableCash() view returns (uint256)',
  'function vaultCash() view returns (uint256)',
  'function deployedBalance() view returns (uint256)',
  'function utilizationBps() view returns (uint256)',
  'function poolTierPrincipal() view returns (uint256 value, uint256 postedAt)',
  'function queuedShares() view returns (uint256)',
  'function isSuspended() view returns (bool)',
  'function deploymentAccount() view returns (address)',
  'function returnFunds(uint256 amount)',
] as const;

export const SETTLEMENT_FORWARDER_ABI = [
  'function forward(uint256 amount)',
  // To align with the contract (see above).
  'function desk() view returns (address)',
  'function offRamp() view returns (address)',
  'function safe() view returns (address)',
  'function token() view returns (address)',
] as const;

export const DESK_ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
] as const;

/** The two-person Deployment, for the Transaction Builder batch when the lane's cap is short. */
export const TWO_PERSON_DEPLOY_ABI = ['function deploy(uint256 amount, bytes32 ref)'] as const;

const sel = (sig: string) => ethers.id(sig).slice(0, 10);

/** The selectors the desk wallet may send. Everything else is refused before signing. */
export const DESK_SELECTORS = {
  deploySettlement: sel('deploySettlement(uint256,bytes32)'),
  forward: sel('forward(uint256)'),
  approve: sel('approve(address,uint256)'),
  returnFunds: sel('returnFunds(uint256)'),
} as const;

/** Calls the desk wallet must never make, refused by name. */
export const DESK_FORBIDDEN = {
  deploy: sel('deploy(uint256,bytes32)'),
  transfer: sel('transfer(address,uint256)'),
  transferFrom: sel('transferFrom(address,address,uint256)'),
} as const;

/** topic0 of SettlementDeployed, the same whatever is indexed. */
export const SETTLEMENT_DEPLOYED_TOPIC = ethers.id('SettlementDeployed(uint256,uint256,bytes32,uint256)');

export const laneInterface = new ethers.Interface(YIELD_POOL_ABI as unknown as string[]);
export const forwarderInterface = new ethers.Interface(SETTLEMENT_FORWARDER_ABI as unknown as string[]);
export const erc20Interface = new ethers.Interface(DESK_ERC20_ABI as unknown as string[]);
export const twoPersonDeployInterface = new ethers.Interface(TWO_PERSON_DEPLOY_ABI as unknown as string[]);

/** Whether a log is the SettlementDeployed for `ref`: its topic, and the ref in a topic or the data. */
export function isSettlementDeployedFor(log: { topics: readonly string[]; data: string }, ref: string): boolean {
  if ((log.topics[0] ?? '').toLowerCase() !== SETTLEMENT_DEPLOYED_TOPIC.toLowerCase()) return false;
  const r = ref.toLowerCase().replace(/^0x/, '');
  if (log.topics.slice(1).some((t) => t.toLowerCase().replace(/^0x/, '') === r)) return true;
  const data = log.data.toLowerCase().replace(/^0x/, '');
  for (let i = 0; i + 64 <= data.length; i += 64) if (data.slice(i, i + 64) === r) return true;
  return false;
}
