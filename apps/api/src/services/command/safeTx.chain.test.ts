import { describe, expect, test } from 'bun:test';
import { createPublicClient, getAddress, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { CONTRACTS, multiSendAddress, safeTxFor, safeTxHash } from './safeTx.js';

/*
 * Against Base Sepolia itself: the Safe contracts' own getTransactionHash agrees with Command's, for
 * one call and for several through MultiSendCallOnly, which is deployed there. Read-only, no key.
 * Opt in with CHAIN_CHECK=1, since the suite must run with no network.
 */
const on = !!process.env.CHAIN_CHECK;
const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org') });
const HASH_ABI = [
  {
    type: 'function',
    name: 'getTransactionHash',
    stateMutability: 'view',
    inputs: ['address', 'uint256', 'bytes', 'uint8', 'uint256', 'uint256', 'uint256', 'address', 'address', 'uint256'].map((type) => ({ type })),
    outputs: [{ type: 'bytes32' }],
  },
] as const;

describe.skipIf(!on)('Safe transaction hashes, on Base Sepolia', () => {
  for (const [version, singleton] of [
    ['1.4.1', '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762'],
    ['1.3.0', '0xfb1bffC9d739B8D520DaF37dF666da4C687191EA'],
  ] as const) {
    test(`Safe ${version} hashes them as Command does`, async () => {
      const cfg = { address: getAddress(singleton), chainId: 84532, serviceUrl: '', apiKey: null, rpcUrl: '' };
      const one = { to: getAddress(CONTRACTS.MerchantRegistry.address), value: 0n, data: '0x12345678' as const, label: '' };
      for (const tx of [safeTxFor([one], 7), safeTxFor([one, one], 8)]) {
        const theirs = await client.readContract({
          address: singleton,
          abi: HASH_ABI,
          functionName: 'getTransactionHash',
          args: [tx.to, BigInt(tx.value), tx.data, tx.operation, 0n, 0n, 0n, tx.gasToken, tx.refundReceiver, BigInt(tx.nonce)],
        });
        expect(theirs).toBe(safeTxHash(cfg, tx));
      }
    });
  }

  test('MultiSendCallOnly 1.4.1 is deployed where Command sends batches', async () => {
    expect((await client.getCode({ address: multiSendAddress({}) }))?.length).toBeGreaterThan(2);
  });
});
