import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { COLLATERAL_SIGNED_TYPES, collateralTypeString, pledgeTypedData } from '@clear/domain';

/*
 * The member signs every pledge (Phase 4b, decision L-I, #892).
 *
 * `CollateralRegistry.pledge(member, kind, amount, deadline, signature)` and `pledgeItem(...)` check
 * the member's EIP-712 signature at `pledgeNonces(member)`; the operator submits. These check the
 * API's inline fragments and the typed data against CollateralRegistry.sol, the digest against the
 * contract's own construction, and that nothing in the API pledges without a signature.
 */

const registrySol = new URL('../../../../../contracts/peripherals/CollateralRegistry.sol', import.meta.url);
const service = readFileSync(new URL('./savingsCollateralService.ts', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../../routes/savings.ts', import.meta.url), 'utf8');

const { REGISTRY_ABI, SAVINGS_KIND, submitPledge } = await import('./savingsCollateralService');

describe('the registry’s signed pledges, as the API calls them', () => {
  test('the fragments are CollateralRegistry.sol’s', () => {
    const iface = new ethers.Interface(REGISTRY_ABI);
    expect(iface.getFunction('pledge')?.format()).toBe('pledge(address,bytes32,uint256,uint256,bytes)');
    expect(iface.getFunction('pledgeNonces')?.format()).toBe('pledgeNonces(address)');
    expect(service).toContain("'function pledgeItem(address member, bytes32 kind, uint256 itemId, uint256 deadline, bytes signature)'");
    if (!existsSync(registrySol)) return;
    const source = readFileSync(registrySol, 'utf8');
    expect(source).toContain('function pledge(address member, bytes32 kind, uint256 amount, uint256 deadline, bytes calldata signature)');
    expect(source).toContain('function pledgeItem(address member, bytes32 kind, uint256 itemId, uint256 deadline, bytes calldata signature)');
    expect(source).toContain('mapping(address => uint256) public pledgeNonces;');
    for (const primary of Object.keys(COLLATERAL_SIGNED_TYPES) as (keyof typeof COLLATERAL_SIGNED_TYPES)[]) {
      expect(source).toContain(`"${collateralTypeString(primary)}"`);
    }
  });

  test('a member’s signature over the typed data recovers against the digest the registry builds', async () => {
    const member = ethers.Wallet.createRandom();
    const registry = '0x62fBdf62Ad0C3f52d898b28b2d1FB31e9EB152Cf';
    const td = pledgeTypedData({ chainId: 84532, registry, member: member.address, kind: SAVINGS_KIND, amount: 5_000_000n, nonce: 4n, deadline: 2_000_000_000 });
    const signature = await member.signTypedData(td.domain, { Pledge: [...COLLATERAL_SIGNED_TYPES.Pledge] }, td.message);

    // _pledgeDigest(PLEDGE_TYPEHASH, member, kind, amount, nonce, deadline), written out as the contract does.
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const structHash = ethers.keccak256(
      coder.encode(
        ['bytes32', 'address', 'bytes32', 'uint256', 'uint256', 'uint256'],
        [ethers.id(collateralTypeString('Pledge')), member.address, SAVINGS_KIND, 5_000_000n, 4n, 2_000_000_000n],
      ),
    );
    const domainSeparator = ethers.keccak256(
      coder.encode(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
        [ethers.id('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'), ethers.id('Clear CollateralRegistry'), ethers.id('1'), 84532, registry],
      ),
    );
    const digest = ethers.keccak256(ethers.concat(['0x1901', domainSeparator, structHash]));
    expect(ethers.recoverAddress(digest, signature)).toBe(member.address);
  });

  test('a bond pledges by item: PledgeItem', async () => {
    const member = ethers.Wallet.createRandom();
    const td = pledgeTypedData({ chainId: 84532, registry: ethers.ZeroAddress, member: member.address, kind: SAVINGS_KIND, itemId: 9n, nonce: 0n, deadline: 2_000_000_000 });
    expect(td.primaryType).toBe('PledgeItem');
    expect(td.message.itemId).toBe('9');
  });
});

describe('nothing pledges without the member’s signature', () => {
  test('the sync reports what is waiting instead of pledging it', () => {
    // `pledge` and `pledgeItem` are sent only by submitPledge, with the member's signature.
    expect(service.match(/'pledge', \[/g)).toHaveLength(1);
    expect(service.match(/'pledgeItem', \[/g)).toHaveLength(1);
    expect(service).toContain("[member, kind, BigInt(input.amount), BigInt(input.deadline), signature]");
    expect(service).toContain("[member, kind, BigInt(input.itemId), BigInt(input.deadline), signature]");
    expect(service).toContain("needsSignature = { kind, amount: (targetUnits - current).toString() };");
    expect(service).toContain('needsSignature: { kind: BOND_KIND, itemIds: unpledged }');
    // Releasing needs none: it only gives back what is the member's.
    expect(service).toContain("'release', [member, kind, amount]");
  });

  test('the routes: prepare reads the chain, submit takes the signature', () => {
    expect(routes).toContain("savingsRouter.post('/pledge/prepare'");
    expect(routes).toContain("savingsRouter.post('/pledge/submit'");
    expect(routes.match(/needsSignature: Boolean\(result\.needsSignature\)/g)).toHaveLength(2);
  });

  test('a submit without a signature, or with an expired one, is refused before the chain is asked', async () => {
    const wallet = ethers.Wallet.createRandom().address;
    const deadline = Math.floor(Date.now() / 1000) + 600;
    expect(await submitPledge(wallet, { kind: 'SAVINGS', amount: '1', deadline, signature: '' })).toEqual({
      ok: false,
      reason: 'Sign the pledge to back your line with it.',
    });
    const signature = `0x${'11'.repeat(65)}`;
    const expired = await submitPledge(wallet, { kind: 'SAVINGS', amount: '1', deadline: Math.floor(Date.now() / 1000) - 1, signature });
    expect(expired.ok).toBe(false);
    const tooLong = await submitPledge(wallet, { kind: 'SAVINGS', amount: '1', deadline: deadline + 86_400, signature });
    expect(tooLong.ok).toBe(false);
  });
});
