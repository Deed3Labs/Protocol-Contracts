import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { DEED_TRUST_VIEWS, readDeedTrust } from './nftService';

/*
 * DeedNFT v5 serves IDeedTrust from its fallback (docs/audit/DEED-V5-INTERFACE.md). The API's inline
 * trust views must be the interface's: same selectors, same tuple.
 */
const source = new URL('../../../../contracts/core/interfaces/IDeedTrust.sol', import.meta.url);
const artifact = new URL('../../../../artifacts/contracts/core/interfaces/IDeedTrust.sol/IDeedTrust.json', import.meta.url);

describe('the deed trust views are IDeedTrust’s', () => {
  test('each fragment’s selector is in the compiled interface', () => {
    if (!existsSync(artifact)) return; // not compiled in this checkout
    const compiled = new ethers.Interface(JSON.parse(readFileSync(artifact, 'utf8')).abi);
    for (const f of new ethers.Interface(DEED_TRUST_VIEWS).fragments) {
      const fn = f as ethers.FunctionFragment;
      expect(compiled.getFunction(fn.selector)?.format('full')).toBe(fn.format('full'));
    }
  });

  test('the trust record is the struct, field for field', () => {
    if (!existsSync(source)) return;
    const solidity = readFileSync(source, 'utf8');
    const struct = solidity.slice(solidity.indexOf('struct TrustRecord {'), solidity.indexOf('}', solidity.indexOf('struct TrustRecord {')));
    const fields = [...struct.matchAll(/\b(\w+) (\w+);/g)].map(([, type, name]) => `${type} ${name}`);
    const tuple = new ethers.Interface(DEED_TRUST_VIEWS).getFunction('trustRecordOf')!.outputs[0].components!.map((c) => `${c.type} ${c.name}`);
    expect(tuple).toEqual(fields);
  });
});

describe('reading a deed’s trust', () => {
  const record = {
    agreementHash: ethers.id('agreement v5'),
    trustee: '0x00000000000000000000000000000000000000a1',
    trusteeSuspended: false,
    protector: ethers.ZeroAddress,
    standbyTrustee: ethers.ZeroAddress,
    transferPolicy: 2n,
    status: 0n,
  };

  test('a Land or Estate deed: trustee, protector, policy, status and the beneficial owner', async () => {
    const contract = {
      isTrustDeed: async () => true,
      trustRecordOf: async () => record,
      beneficialOwnerOf: async () => '0x00000000000000000000000000000000000000b2',
    } as unknown as ethers.Contract;
    expect(await readDeedTrust(contract, 1n)).toMatchObject({
      trustee: record.trustee,
      transferPolicy: 'Coop',
      status: 'Active',
      beneficialOwner: '0x00000000000000000000000000000000000000b2',
    });
  });

  test('a legacy deed, or a v4 DeedNFT that reverts, has no trust', async () => {
    expect(await readDeedTrust({ isTrustDeed: async () => false } as unknown as ethers.Contract, 1n)).toBeNull();
    expect(await readDeedTrust({ isTrustDeed: async () => { throw new Error('revert'); } } as unknown as ethers.Contract, 1n)).toBeNull();
  });
});
