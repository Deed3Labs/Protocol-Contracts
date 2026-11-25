import { describe, expect, test } from 'bun:test';
import { auxRows } from './inventoryCards.js';

/* Build → Contracts, Timelocks and helpers: a record shows by its name once it's on dev, with what it does. */
describe('Timelocks and helpers', () => {
  const at = (n: number) => ({ address: '0x' + n.toString(16).padStart(40, '0') });
  test('Clear Credits’ helpers and DeedNFT’s extensions show once their records land, after the timelocks', () => {
    const inv = new Map([
      ['CreditTimelock', at(1)],
      ['CreditsAccessManager', at(2)],
      ['CreditsMerchantRegistry', at(3)],
      ['DeedRolesExtension', at(4)],
    ]);
    expect(auxRows(inv).map(([n, , what, who]) => [n, what, who])).toEqual([
      ['CreditTimelock', 'Holds the credit contracts’ upgrades and settings for 7 days', 'Clear Treasury Safe, as the Ops Safe'],
      ['CreditsAccessManager', 'Roles over the Credits Ledger alone, so the credit ledger’s admins have no say over it', 'The Credit timelock'],
      ['CreditsMerchantRegistry', 'Empty, with its admin roles given up: no shop can ever take credits', 'No one'],
      ['DeedRolesExtension', 'Who holds a deed in trust for its member (the owner-trustee)', 'Through DeedNFT'],
    ]);
  });
  test('none of them shows before its record does', () => {
    expect(auxRows(new Map([['CreditTimelock', at(1)]])).map(([n]) => n)).toEqual(['CreditTimelock']);
  });
});
