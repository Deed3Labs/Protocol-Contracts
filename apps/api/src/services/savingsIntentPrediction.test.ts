import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { intentConfigOf } from './savingsIntentService';

const service = readFileSync(new URL('./savingsIntentService.ts', import.meta.url), 'utf8');
const relayer = readFileSync(new URL('./savingsRelayerService.ts', import.meta.url), 'utf8');

const intent = {
  ownerWallet: '0x00000000000000000000000000000000000000A1',
  receiverWallet: '0x00000000000000000000000000000000000000A1',
  transferToken: '0x00000000000000000000000000000000000000B2',
  vaultToken: '0x00000000000000000000000000000000000000B2',
  vaultAddress: '0x00000000000000000000000000000000000000C3',
  amount: '25000000',
  expiry: 2_000_000_000,
  action: 'deposit' as const,
};

describe('the escrow address commits to the whole intent (audit H-4)', () => {
  test('predictIntentAddress takes the salt and the config, the factory’s new shape', () => {
    const iface = new ethers.Interface([
      'function predictIntentAddress(bytes32 userSalt, (address depositor,address receiver,address transferToken,address vaultToken,address vault,uint256 amount,uint64 expiry,uint8 action) config) external view returns (address)',
    ]);
    expect(iface.getFunction('predictIntentAddress')!.selector).toBe(
      ethers.id('predictIntentAddress(bytes32,(address,address,address,address,address,uint256,uint64,uint8))').slice(0, 10),
    );
    expect(service).toContain('factory.predictIntentAddress(salt, intentConfigOf(intent))');
  });

  test('settle and refund pass the same config the address was predicted from', () => {
    expect(relayer).toContain('return intentConfigOf(payload);');
    expect(intentConfigOf(intent)).toEqual({
      depositor: intent.ownerWallet,
      receiver: intent.receiverWallet,
      transferToken: intent.transferToken,
      vaultToken: intent.vaultToken,
      vault: intent.vaultAddress,
      amount: 25_000_000n,
      expiry: 2_000_000_000n,
      action: 0,
    });
    expect(intentConfigOf({ ...intent, action: 'redeem' }).action).toBe(1);
  });
});
