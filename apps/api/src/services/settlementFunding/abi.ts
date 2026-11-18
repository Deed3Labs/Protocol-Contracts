import { ethers } from 'ethers';

/*
 * Every contract fragment the settlement funding desk uses, in one place (decision 54; the Earn
 * spec §6 settlement lane, acceptance test 27, and the SettlementForwarder). Each one is checked
 * against the compiled ABIs (artifacts/contracts/peripherals/LendingPool.sol/LendingPool.json, with
 * the ledger's views it serves by fallback, YieldPoolValuation.json and SettlementForwarder.json):
 * abi.test.ts holds the list, and compares it with the artifacts when they are built.
 *
 *   LendingPool (the Yield Pool; the lane runs in YieldPoolValuation, forwarded like `deploy`):
 *     deploySettlement(uint256 amount, bytes32 ref)    only the registered funder, while not stopped;
 *                                                      to the deployment account (CL Operating)
 *     settlementLane()                                 one view of the whole lane, the period's
 *                                                      rollover already applied; it reverts on a pool
 *                                                      from before the SL upgrade
 *     pendingLossCharge()                              a charge being applied blocks every Deployment
 *     events SettlementDeployed (with the usual Deployed), SettlementFunderSet,
 *     SettlementHeadroomSet, SettlementFunderStopped
 *   SettlementForwarder (CL Operating's AllowanceModule delegate, deploy 28):
 *     forward(uint256 amount)                          only the desk; USDC to the off-ramp
 *     safe(), allowanceModule(), token()               fixed at construction
 *     offRamp(), desk()                                set only by CL Operating (the Safe)
 */

/** The lane's one view: what the desk reads every check. */
export const SETTLEMENT_LANE_VIEW =
  'function settlementLane() view returns (address funder, uint256 capPerPeriod, uint256 periodSeconds, uint256 periodStart, uint256 usedInPeriod, bool stopped, uint256 epoch, uint256 headroom)';

export const SETTLEMENT_LANE_ABI = [
  'function deploySettlement(uint256 amount, bytes32 ref)',
  SETTLEMENT_LANE_VIEW,
  'event SettlementDeployed(uint256 indexed id, uint256 amount, bytes32 ref, uint256 periodUsed)',
  'event Deployed(uint256 indexed deploymentId, address indexed to, uint256 amount, address proposer, address approver)',
  'event SettlementFunderSet(address indexed funder, uint256 capPerPeriod, uint64 periodSeconds, address proposer, address approver)',
  'event SettlementHeadroomSet(uint256 amount, address proposer, address approver)',
  'event SettlementFunderStopped(address indexed funder, address indexed by)',
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
  'function pendingLossCharge() view returns (bool pending, uint256 id, uint256 amount, uint256 absorbed, uint256 cursor, uint256 end)',
  'function deploymentAccount() view returns (address)',
  'function returnFunds(uint256 amount)',
] as const;

export const SETTLEMENT_FORWARDER_ABI = [
  'function forward(uint256 amount)',
  'function safe() view returns (address)',
  'function allowanceModule() view returns (address)',
  'function token() view returns (address)',
  'function offRamp() view returns (address)',
  'function desk() view returns (address)',
  'event Forwarded(address indexed offRamp, address indexed desk, uint256 amount)',
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

/** topic0 of SettlementDeployed. */
export const SETTLEMENT_DEPLOYED_TOPIC = ethers.id('SettlementDeployed(uint256,uint256,bytes32,uint256)');

export const laneInterface = new ethers.Interface(YIELD_POOL_ABI as unknown as string[]);
export const forwarderInterface = new ethers.Interface(SETTLEMENT_FORWARDER_ABI as unknown as string[]);
export const erc20Interface = new ethers.Interface(DESK_ERC20_ABI as unknown as string[]);
export const twoPersonDeployInterface = new ethers.Interface(TWO_PERSON_DEPLOY_ABI as unknown as string[]);

/** Whether a log is the SettlementDeployed for `ref` (its data: amount, ref, periodUsed). */
export function isSettlementDeployedFor(log: { topics: readonly string[]; data: string }, ref: string): boolean {
  if ((log.topics[0] ?? '').toLowerCase() !== SETTLEMENT_DEPLOYED_TOPIC.toLowerCase()) return false;
  try {
    const parsed = laneInterface.parseLog({ topics: [...log.topics], data: log.data });
    return !!parsed && String(parsed.args.ref).toLowerCase() === ref.toLowerCase();
  } catch {
    return false;
  }
}
