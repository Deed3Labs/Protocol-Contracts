import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const gas = strip(readFileSync(join(import.meta.dirname, 'relayerGas.ts'), 'utf8'));
const collateral = strip(
  readFileSync(join(import.meta.dirname, '..', 'services', 'chain', 'savingsCollateralService.ts'), 'utf8'),
);

/*
 * A signer with no gas does not fail loudly. The pledge does not happen, the capacity is not
 * pushed, and the first anyone knows is a member's credit limit being wrong by $25.
 */
describe('the account that signs can be seen to afford the next write', () => {
  test('the threshold is measured, not chosen', () => {
    // A hardcoded 0.002 ETH once reported a healthy account as empty — the real cost is about four
    // thousandths of that. A number picked by hand is wrong on every chain but the one it came from.
    expect(gas).toContain('getFeeData');
    expect(gas).toContain('estimateGas');
    expect(gas).not.toMatch(/parseEther\(['"]0\./);
  });

  test('it estimates against the relayer itself', () => {
    // Gas depends on the state being written; an estimate for another sender measures somebody
    // else's transaction.
    expect(gas).toContain('{ from: address }');
  });

  test('and reports something a person can act on', () => {
    expect(gas).toContain('syncsRemaining');
    // 'writes' rather than 'syncs' since this covers the send relayer too, which does not sync
    // anything — a count of transactions is the unit both have in common.
    expect(gas).toContain('writes left');
  });

  test('maxFeePerGas, not the base fee', () => {
    // The base fee would report runway we might not have when the next block is busier.
    expect(gas).toContain('fees.maxFeePerGas');
  });
});

/*
 * The reason this account matters at all: the collateral sync could only sign with a raw operator
 * key, and that key is not set in the deployed environment — so it returned "no key" before
 * touching the chain and no deposit there ever pledged anything.
 */
describe('collateral writes use the signer the server already has', () => {
  test('a missing operator key is no longer the end of it', () => {
    const run = collateral.slice(collateral.indexOf('async function runSync'), collateral.indexOf('export async function readSavingsUnits'));
    expect(run).not.toContain("return { ok: false, reason: 'no CREDIT_OPERATOR_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY' }");
  });

  test('it falls back to the relayer that signs everything else', () => {
    expect(collateral).toContain('savingsRelayerService.sendAsRelayer');
  });

  test('a raw key still wins when one is configured', () => {
    // Separation of duties is a real reason to run a dedicated operator; the fallback exists so the
    // absence of one is not silent, not so the choice is taken away.
    const fn = collateral.slice(collateral.indexOf('async function sendCollateralTx'), collateral.indexOf('async function runSync'));
    expect(fn.indexOf('operatorKey()')).toBeLessThan(fn.indexOf('sendAsRelayer'));
  });

  test('bonds sign the same way savings do', () => {
    // A second path is a second thing that can be configured differently and break on its own.
    const bond = collateral.slice(collateral.indexOf('export async function syncBondCollateral'));
    expect(bond).toContain('sendCollateralTx');
    expect(bond).not.toContain('new ethers.Wallet(');
  });
});

/*
 * The relayers are not on the same chain, and treating them as if they were produces a false alarm
 * every day.
 *
 * Savings and collateral sign on Base Sepolia; send signs on Base mainnet. Checking the mainnet
 * account against testnet reports it as empty, because it holds nothing there and never will. I
 * made exactly that mistake by hand — told the user their send relayer was at zero when it was
 * funded on the chain it actually uses — which is what this guards.
 */
describe('each relayer is checked on the chain it actually uses', () => {
  test('the chain travels with the account, not read once from the environment', () => {
    expect(gas).toMatch(/chainId: number; address: string/);
    expect(gas).toContain('checkRelayerGas(relayer)');
  });

  test('send has its own chain and its own address', () => {
    expect(gas).toContain("envChainId('SEND_DEFAULT_CHAIN_ID')");
    expect(gas).toContain('sendRelayerAddress');
  });

  test('the address is resolved chain-suffixed first, as the service resolves it', () => {
    /*
     * The first version read only the global variable — the same suffixed-vs-global mistake this
     * monitor exists to catch, made inside the monitor. It went on reporting the mainnet address on
     * a testnet chain after the suffixed override was set, so the config fix looked like it had
     * failed.
     */
    const fn = gas.slice(gas.indexOf('async function sendRelayerAddress'), gas.indexOf('export async function checkRelayerGas'));
    expect(fn).toContain('SEND_CDP_EVM_ACCOUNT_ADDRESS_${chainId}');
    expect(fn.indexOf('_${chainId}')).toBeLessThan(fn.indexOf('process.env.SEND_CDP_EVM_ACCOUNT_ADDRESS ||'));
  });

  test('both are reported, not just the first', () => {
    const run = gas.slice(gas.indexOf('const run = async'));
    expect(run).toContain('for (const relayer of found)');
  });

  test('one relayer failing does not silence the other', () => {
    // A single try/catch around the loop would let an RPC hiccup on one chain hide a genuinely
    // empty account on the other.
    const run = gas.slice(gas.indexOf('for (const relayer of found)'));
    expect(run).toContain('catch');
    expect(run).toContain('check failed');
  });

  test('the same account on the same chain is not reported twice', () => {
    expect(gas).toContain('send === savings && sendChain === savingsChain');
  });
});
