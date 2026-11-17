import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deedTrustOf, transferBlockedReason, transferNote } from './deedTrust';

const record = (over: Record<string, unknown> = {}) => ({
  trustee: '0x00000000000000000000000000000000000000a1',
  trusteeSuspended: false,
  protector: '0x0000000000000000000000000000000000000000',
  transferPolicy: 0n,
  status: 0n,
  voidReason: 0n,
  ...over,
});
const reader = (over: Record<string, unknown> = {}, trust = true) => ({
  isTrustDeed: async () => trust,
  trustRecordOf: async () => record(over),
  beneficialOwnerOf: async () => '0x00000000000000000000000000000000000000b2',
});

describe('a v5 deed’s trust record, in the app', () => {
  test('a Land or Estate deed has a trustee, protector, policy and beneficial owner', async () => {
    expect(await deedTrustOf(reader({ transferPolicy: 1n }), '7')).toMatchObject({
      trustee: '0x00000000000000000000000000000000000000a1',
      transferPolicy: 'Verified',
      status: 'Active',
      beneficialOwner: '0x00000000000000000000000000000000000000b2',
    });
  });

  test('a legacy deed, or a v4 DeedNFT, has none', async () => {
    expect(await deedTrustOf(reader({}, false), 7n)).toBeNull();
    expect(await deedTrustOf({ isTrustDeed: async () => { throw new Error('no fallback'); } } as never, 7n)).toBeNull();
  });
});

describe('a direct transfer the contract would refuse is refused first', () => {
  test('Coop policy goes through the agent; retired and frozen deeds do not move', async () => {
    expect(transferBlockedReason(await deedTrustOf(reader({ transferPolicy: 2n }), 1n))).toContain('co-op’s transfer agent');
    expect(transferBlockedReason(await deedTrustOf(reader({ status: 1n }), 1n))).toContain('retired');
    expect(transferBlockedReason(await deedTrustOf(reader({ status: 2n, voidReason: 129n }), 1n))).toContain('frozen');
    // A void below 128 stays transferable, as the contract has it.
    expect(transferBlockedReason(await deedTrustOf(reader({ status: 2n, voidReason: 1n }), 1n))).toBeNull();
    expect(transferNote(await deedTrustOf(reader({ transferPolicy: 1n }), 1n))).toContain('member in good standing');
  });

  test('the transfer modal checks before it encodes anything', () => {
    const modal = readFileSync(join(import.meta.dir, '../components/TransferModal.tsx'), 'utf8');
    expect(modal.indexOf('transferBlockedReason(trust)')).toBeLessThan(modal.indexOf("encodeFunctionData('transferFrom'"));
  });

  test('the app’s DeedNFT ABIs include IDeedTrust (served from DeedNFT’s fallback)', () => {
    for (const chain of ['base-sepolia', 'base', 'sepolia', 'ethereum']) {
      const json = JSON.parse(readFileSync(join(import.meta.dir, `../contracts/${chain}/DeedNFT.json`), 'utf8'));
      const abi = (typeof json.abi === 'string' ? JSON.parse(json.abi) : json.abi) as { name?: string }[];
      for (const fn of ['mintTrustDeed', 'trustRecordOf', 'beneficialOwnerOf', 'protectorOf', 'postNotice', 'isTrustDeed']) {
        expect(abi.some((e) => e.name === fn)).toBe(true);
      }
    }
  });
});
