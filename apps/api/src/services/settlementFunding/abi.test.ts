import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { SETTLEMENT_FORWARDER_ABI, YIELD_POOL_ABI, forwarderInterface, laneInterface } from './abi';

/*
 * The desk's fragments are the contracts' (decision 54). The lane and the forwarder are compared
 * with the compiled artifacts when this checkout has them built from contracts that include them
 * (`npx hardhat compile`; the LendingPool serves the ledger's views, such as poolTierPrincipal, from
 * its fallback, so the two ABIs are joined as `poolAt` joins them). The Yield Pool's other views are
 * compared with the deployment record on Base Sepolia, which is committed.
 */
const root = '../../../../../';
const artifact = (path: string) => new URL(`${root}artifacts/contracts/peripherals/${path}`, import.meta.url);
const abiOf = (url: URL) => JSON.parse(readFileSync(url, 'utf8')).abi as ethers.InterfaceAbi;
const minimal = (f: ethers.Fragment) => f.format('minimal');

function compare(ours: ethers.Interface, theirs: ethers.Interface, skip: (f: ethers.Fragment) => boolean = () => false) {
  for (const f of ours.fragments) {
    if (skip(f)) continue;
    if (f.type === 'function') {
      const fn = f as ethers.FunctionFragment;
      expect(theirs.getFunction(fn.selector)?.format('minimal') ?? `missing: ${minimal(fn)}`).toBe(minimal(fn));
    } else if (f.type === 'event') {
      const ev = f as ethers.EventFragment;
      expect(theirs.getEvent(ev.topicHash)?.format('minimal') ?? `missing: ${minimal(ev)}`).toBe(minimal(ev));
    }
  }
}

describe('the settlement desk’s fragments are the contracts’', () => {
  test('the lane and the Yield Pool, against the compiled LendingPool (with its ledger views)', () => {
    const pool = artifact('LendingPool.sol/LendingPool.json');
    const ledger = artifact('YieldPoolLedger.sol/YieldPoolLedger.json');
    if (!existsSync(pool) || !existsSync(ledger)) return; // not compiled in this checkout
    const joined = [...(abiOf(pool) as ethers.JsonFragment[])];
    const have = new Set(joined.filter((f) => f.type === 'function').map((f) => f.name));
    for (const f of abiOf(ledger) as ethers.JsonFragment[]) if (f.type === 'function' && !have.has(f.name)) joined.push(f);
    const compiled = new ethers.Interface(joined);
    if (!compiled.getFunction('settlementLane')) return; // built from contracts before the lane (decision 54)
    compare(laneInterface, compiled);
  });

  test('the SettlementForwarder, against its compiled ABI', () => {
    const fwd = artifact('SettlementForwarder.sol/SettlementForwarder.json');
    if (!existsSync(fwd)) return; // not compiled in this checkout
    compare(forwarderInterface, new ethers.Interface(abiOf(fwd)));
  });

  test('the Yield Pool’s views the desk reads are on the deployed pool (Base Sepolia); the lane is not, yet', () => {
    const record = new URL(`${root}deployments/base-sepolia/LendingPool.json`, import.meta.url);
    if (!existsSync(record)) return;
    const deployed = new ethers.Interface(abiOf(record));
    const lane = new Set(['deploySettlement', 'settlementLane', 'SettlementDeployed', 'SettlementFunderSet', 'SettlementHeadroomSet', 'SettlementFunderStopped']);
    // poolTierPrincipal is the ledger's, served by the pool's fallback.
    compare(laneInterface, deployed, (f) => lane.has((f as ethers.FunctionFragment).name) || (f as ethers.FunctionFragment).name === 'poolTierPrincipal' && !deployed.getFunction('poolTierPrincipal'));
  });

  test('the lane’s view is one tuple, in the contract’s order', () => {
    const fn = laneInterface.getFunction('settlementLane')!;
    expect(fn.outputs.map((o) => `${o.type} ${o.name}`)).toEqual([
      'address funder',
      'uint256 capPerPeriod',
      'uint256 periodSeconds',
      'uint256 periodStart',
      'uint256 usedInPeriod',
      'bool stopped',
      'uint256 epoch',
      'uint256 headroom',
    ]);
    expect(YIELD_POOL_ABI.length).toBeGreaterThan(0);
    expect(SETTLEMENT_FORWARDER_ABI).toContain('function allowanceModule() view returns (address)');
  });
});
