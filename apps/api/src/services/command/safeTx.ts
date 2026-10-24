import chain from '@clear/command-types/src/chain/base-sepolia.json';
import { concatHex, encodeFunctionData, encodePacked, getAddress, hashTypedData, isAddress, isHex, parseUnits, size, zeroAddress, type Abi, type AbiFunction, type Address, type Hex } from 'viem';
import type { Queryable } from '../../db/db.js';
import type { SafeConfig } from './safe.js';

/*
 * Safe transactions for the outbox's on-chain acts (docs/command-center-plan.md, Phase 4b).
 *
 * A builder turns an outbox row into one or more contract calls, encoded from the deployed ABIs
 * (packages/command-types/src/chain, generated from deployments/base-sepolia). One call goes to the
 * Safe as it is; several go through MultiSendCallOnly in one transaction. Command builds the SafeTx
 * and its EIP-712 hash; a signer's own wallet signs it. Nothing here holds or uses a key.
 */

export const CONTRACTS = chain.contracts as Record<string, { address: Address; functions: AbiFunction[] }>;

export interface Call {
  to: Address;
  value: bigint;
  data: Hex;
  /** What it does, for the summary and the signer. */
  label: string;
}

export interface SafeTxData {
  to: Address;
  value: string;
  data: Hex;
  operation: 0 | 1;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: Address;
  refundReceiver: Address;
  nonce: number;
}

/** Reads a builder needs first (a shop's current terms, the pool's token). Injected, so tests use a fake chain. */
export interface ChainRead {
  read(address: Address, abi: Abi, functionName: string, args: unknown[]): Promise<unknown>;
}

export class BuildError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const contract = (name: string) => {
  const c = CONTRACTS[name];
  if (!c) throw new BuildError('NO_CONTRACT', `${name} isn’t one of the deployed contracts`);
  return c;
};
const call = (name: string, functionName: string, args: unknown[], label: string): Call => {
  const c = contract(name);
  return { to: getAddress(c.address), value: 0n, data: encodeFunctionData({ abi: c.functions as Abi, functionName, args }), label };
};
const read = (r: ChainRead, name: string, functionName: string, args: unknown[]) => r.read(getAddress(contract(name).address), contract(name).functions as Abi, functionName, args);

/** A shop's address on chain, from Command's merchant row. */
async function shopWallet(db: Queryable, id: string): Promise<{ wallet: Address; name: string }> {
  const { rows } = await db.query<{ wallet_address: string | null; name: string }>('SELECT wallet_address, name FROM command.merchants WHERE id = $1', [id]);
  if (!rows[0]) throw new BuildError('NO_SHOP', 'No such shop');
  if (!rows[0].wallet_address) throw new BuildError('NO_SHOP_WALLET', `${rows[0].name} has no wallet on record, so MerchantRegistry can’t be told about it yet`);
  return { wallet: getAddress(rows[0].wallet_address), name: rows[0].name };
}

/** An argument typed as text, as its ABI type. Arrays and tuples come as JSON. */
export function argFor(type: string, raw: unknown): unknown {
  if (type.endsWith(']')) {
    const inner = type.slice(0, type.lastIndexOf('['));
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(list)) throw new BuildError('BAD_ARG', `Expected a list for ${type}`);
    return list.map((v) => argFor(inner, v));
  }
  const s = String(raw ?? '').trim();
  if (type === 'address') {
    if (!isAddress(s)) throw new BuildError('BAD_ARG', `“${s}” isn’t an address`);
    return getAddress(s);
  }
  if (type === 'bool') {
    if (!['true', 'false'].includes(s.toLowerCase())) throw new BuildError('BAD_ARG', `Expected true or false, not “${s}”`);
    return s.toLowerCase() === 'true';
  }
  if (/^u?int\d*$/.test(type)) {
    if (!/^-?\d+$/.test(s)) throw new BuildError('BAD_ARG', `Expected a whole number for ${type}, not “${s}”`);
    return BigInt(s);
  }
  if (/^bytes\d*$/.test(type)) {
    if (!isHex(s)) throw new BuildError('BAD_ARG', `Expected 0x… for ${type}`);
    if (type !== 'bytes' && size(s) !== Number(type.slice(5))) throw new BuildError('BAD_ARG', `${type} is ${type.slice(5)} bytes`);
    return s;
  }
  if (type === 'string') return s;
  throw new BuildError('BAD_ARG', `Command can’t build ${type} arguments yet`);
}

type Builder = (b: any, ctx: { db: Queryable; chain: ChainRead }) => Promise<Call[]>;

/** The outbox kinds that are on-chain, and how each becomes calls. */
export const BUILDERS: Record<string, Builder> = {
  'merchants.cap': async (b, { db, chain }) => {
    const s = await shopWallet(db, b.id);
    const [window, fee] = await Promise.all([read(chain, 'MerchantRegistry', 'payoutWindowOf', [s.wallet]), read(chain, 'MerchantRegistry', 'discountBpsOf', [s.wallet])]);
    return [call('MerchantRegistry', 'updateTerms', [s.wallet, window, parseUnits(String(b.cap), 6), fee], `${s.name}’s cap to $${Number(b.cap).toFixed(2)}`)];
  },
  'merchants.off': async (b, { db }) => {
    const s = await shopWallet(db, b.id);
    return [call('MerchantRegistry', 'setActive', [s.wallet, false], `Turn off ${s.name}`)];
  },
  'merchants.on': async (b, { db }) => {
    const s = await shopWallet(db, b.id);
    return [call('MerchantRegistry', 'setActive', [s.wallet, true], `Turn on ${s.name}`)];
  },
  'merchants.run': async (b) => [call('PayoutPool', 'payQueue', [BigInt(Math.max(1, b.shops))], `Pay the next ${b.shops} claims in the queue`)],
  'money.top': async (b, { chain }) => {
    const token = getAddress(String(await read(chain, 'PayoutPool', 'reserveToken', [])));
    const amount = parseUnits(Number(b.amount).toFixed(6), 6);
    const pool = getAddress(contract('PayoutPool').address);
    return [
      { to: token, value: 0n, data: encodeFunctionData({ abi: ERC20_APPROVE, functionName: 'approve', args: [pool, amount] }), label: 'Let the PayoutPool take the top-up' },
      call('PayoutPool', 'fund', [amount], `Fund the PayoutPool with $${Number(b.amount).toFixed(2)}`),
    ];
  },
  'contracts.propose': async (b) => {
    if (!b.fn) throw new BuildError('NO_CALL', 'Pick the function and its arguments first');
    const c = contract(b.contract);
    const fns = c.functions.filter((f) => f.name === b.fn && f.stateMutability !== 'view' && f.stateMutability !== 'pure');
    const args: unknown[] = b.args ?? [];
    const fn = fns.find((f) => f.inputs.length === args.length);
    if (!fn) throw new BuildError('NO_FUNCTION', `${b.contract} has no ${b.fn} that takes ${args.length} argument${args.length === 1 ? '' : 's'}`);
    const typed = fn.inputs.map((inp, i) => argFor(inp.type, args[i]));
    return [{ to: getAddress(c.address), value: 0n, data: encodeFunctionData({ abi: [fn] as Abi, functionName: fn.name, args: typed }), label: b.what || `${b.contract}.${fn.name}` }];
  },
};
export const onChain = (section: string, kind: string) => `${section}.${kind}` in BUILDERS;

const ERC20_APPROVE = [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }] as const;
const MULTISEND = [{ type: 'function', name: 'multiSend', stateMutability: 'payable', inputs: [{ name: 'transactions', type: 'bytes' }], outputs: [] }] as const;

/** MultiSendCallOnly 1.4.1, deployed at the same address on every chain Safe supports. Env can point elsewhere. */
export const multiSendAddress = (env: Record<string, string | undefined> = process.env) => getAddress(env.COMMAND_SAFE_MULTISEND || '0x9641d764fc13c8B624c04430C7356C1C7C8102e2');

/** One SafeTx for the calls: as it is for one, through MultiSendCallOnly for several. */
export function safeTxFor(calls: Call[], nonce: number, env?: Record<string, string | undefined>): SafeTxData {
  const base = { safeTxGas: '0', baseGas: '0', gasPrice: '0', gasToken: zeroAddress, refundReceiver: zeroAddress, nonce };
  if (calls.length === 1) return { ...base, to: calls[0].to, value: calls[0].value.toString(), data: calls[0].data, operation: 0 };
  const packed = concatHex(calls.map((c) => encodePacked(['uint8', 'address', 'uint256', 'uint256', 'bytes'], [0, c.to, c.value, BigInt(size(c.data)), c.data])));
  return { ...base, to: multiSendAddress(env), value: '0', data: encodeFunctionData({ abi: MULTISEND, functionName: 'multiSend', args: [packed] }), operation: 1 };
}

export const SAFE_TX_TYPES = {
  SafeTx: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'operation', type: 'uint8' },
    { name: 'safeTxGas', type: 'uint256' },
    { name: 'baseGas', type: 'uint256' },
    { name: 'gasPrice', type: 'uint256' },
    { name: 'gasToken', type: 'address' },
    { name: 'refundReceiver', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

/** What a signer's wallet signs (eth_signTypedData_v4), with numbers as strings so it travels as JSON. */
export function typedDataFor(c: SafeConfig, tx: SafeTxData) {
  return {
    domain: { chainId: c.chainId, verifyingContract: c.address },
    types: { EIP712Domain: [{ name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }], ...SAFE_TX_TYPES },
    primaryType: 'SafeTx' as const,
    message: { ...tx, nonce: String(tx.nonce) },
  };
}

/** The Safe's own hash of the transaction: what every signature is over. */
export function safeTxHash(c: SafeConfig, tx: SafeTxData): Hex {
  return hashTypedData({
    domain: { chainId: c.chainId, verifyingContract: c.address },
    types: SAFE_TX_TYPES,
    primaryType: 'SafeTx',
    message: { ...tx, value: BigInt(tx.value), safeTxGas: BigInt(tx.safeTxGas), baseGas: BigInt(tx.baseGas), gasPrice: BigInt(tx.gasPrice), nonce: BigInt(tx.nonce) },
  });
}
