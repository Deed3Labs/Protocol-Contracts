import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

/*
 * Two problems, one cause: we never asked Plaid who the account holder is.
 *
 * A withdrawal sent Plaid's account NICKNAME to Bridge as the owner's legal name, and the identity
 * screen had to ask for a name and address the bank already knows.
 */
describe('the account holder comes from the bank', () => {
  const plaid = read('routes/plaid.ts');
  const withdraw = read('services/withdrawService.ts');
  const identity = read('services/plaidIdentityService.ts');

  test('Identity is requested', () => {
    expect(plaid).toContain('Products.Identity');
  });

  test('as OPTIONAL, so an institution without it can still be linked', () => {
    // Required would trade the KYC screen's convenience for members who cannot connect at all.
    const block = plaid.slice(plaid.indexOf('const optionalProducts'), plaid.indexOf('const baseRequest'));
    expect(block).toContain('optionalProducts.push(Products.Identity)');
    const required = plaid.slice(plaid.indexOf('products: [Products'), plaid.indexOf('products: [Products') + 90);
    expect(required).not.toContain('Identity');
  });

  test('withdrawals no longer send the account nickname as a person’s name', () => {
    // `acct.name` is "TOTAL CHECKING" — a product label where a legal name belongs, on every ACH credit.
    expect(withdraw).not.toMatch(/ownerName = .*acct\?\.name/);
    expect(withdraw).toContain('holder.legalName');
  });

  test('and fall back to a placeholder rather than a guess', () => {
    expect(withdraw).toContain("holder.legalName || 'Account holder'");
  });

  test('a bank without Identity returns nothing rather than throwing', () => {
    // This is the documented path, not an error: the caller has somewhere honest to go.
    const fn = identity.slice(identity.indexOf('export async function getAccountHolder'));
    expect(fn).toContain('continue;');
    expect(fn).toContain('return EMPTY;');
  });

  test('a joint account resolves to the primary holder and mailing address', () => {
    expect(identity).toContain('owner.names?.[0]');
    expect(identity).toContain('a.primary');
  });

  test("Plaid's `region` is mapped to the `state` both Lithic and Bridge want", () => {
    expect(identity).toContain('state: data.region');
  });
});
