import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';

const deposit = readFileSync(new URL('./esaDeposit.ts', import.meta.url), 'utf8');
const relayer = readFileSync(new URL('../savingsRelayerService.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../../routes/savings.ts', import.meta.url), 'utf8');

/*
 * ESADepositVault after audit H-3 / M-5: the relayer needs RELAYER_ROLE; a gasless deposit mints to
 * the depositor unless the depositor signed a DepositIntent naming someone else; gasless redeem
 * takes a signature of any length, so an EIP-1271 smart account can redeem.
 */
describe('the vault’s relayer calls follow the contract', () => {
  test('the ABI the relayer encodes matches the vault’s new functions', () => {
    const iface = new ethers.Interface([
      'function depositWithAuthorizationFor(address depositor, address token, uint256 amount, address receiver, (uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) auth, bytes intentSignature) external returns (uint256 minted)',
      'function redeemWithSignature(address redeemer, address token, uint256 clrusdAmount, address receiver, uint256 deadline, bytes signature) external returns (uint256 returnedAmount)',
    ]);
    // The selectors of the Solidity signatures, as the vault declares them.
    expect(iface.getFunction('depositWithAuthorizationFor')!.selector).toBe(
      ethers.id('depositWithAuthorizationFor(address,address,uint256,address,(uint256,uint256,bytes32,uint8,bytes32,bytes32),bytes)').slice(0, 10),
    );
    expect(iface.getFunction('redeemWithSignature')!.selector).toBe(
      ethers.id('redeemWithSignature(address,address,uint256,address,uint256,bytes)').slice(0, 10),
    );
    expect(relayer).toContain("'function depositWithAuthorizationFor(");
    expect(relayer).toContain("'function redeemWithSignature(");
  });

  test('a deposit to someone else needs the depositor’s intent, and is refused before any gas without it', () => {
    expect(deposit).toContain('if (receiver === depositor) {');
    expect(deposit).toContain('savingsRelayerService.depositWithAuthorizationFor(');
    expect(deposit.indexOf("throw new Error('a deposit to another wallet needs the depositor’s signed deposit intent')")).toBeLessThan(
      deposit.indexOf('savingsRelayerService.depositWithAuthorizationFor('),
    );
  });

  test('gasless redeem goes through redeemWithSignature, and accepts a smart account’s longer signature', () => {
    expect(route).toContain('savingsRelayerService.redeemWithSignature(');
    expect(route).not.toContain('savingsRelayerService.redeemWithAuthorization(');
    expect(route).toContain("const signaturePattern = action === 'deposit' ? /^0x[a-fA-F0-9]{130}$/ : /^0x(?:[a-fA-F0-9]{2}){65,}$/;");
  });
});
