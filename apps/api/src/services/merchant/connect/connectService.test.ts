import { beforeAll, describe, expect, test } from 'bun:test';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import type { CustomerSnapshot } from '../../bridgeCustomerService.js';
import type { BridgeKyb } from '../kyb/kybService.js';
import { allowedReturn, approvalOf, AUDIENCE, ConnectError, mintToken, publicKeyPem, redirectTo, shopApproval, shopClaims, signingKey, validState } from './connectService.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
  // The real staff table has an email column (config/merchantDb); the test table's lazy copy does not.
  await db.query('ALTER TABLE merchant.staff ADD COLUMN IF NOT EXISTS email TEXT');
});

/** Bridge with one business customer in a given state. */
function fakeBridge(status: CustomerSnapshot['status'] | null): BridgeKyb {
  return {
    configured: () => true,
    start: async () => ({ customerId: null, url: null }),
    snapshot: async (id) =>
      status ? ({ customerId: id, type: 'business', status, tosAccepted: true, baseEndorsement: 'approved', payinFiat: 'active', payoutFiat: 'active', rejectionReason: null } as CustomerSnapshot) : null,
  };
}

const { privateKey } = generateKeyPairSync('ed25519');
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

describe('the signing key', () => {
  test('reads a PEM Ed25519 key, with or without \\n escapes, and nothing else', () => {
    expect(signingKey({ SHOP_CONNECT_PRIVATE_KEY: pem })).not.toBeNull();
    expect(signingKey({ SHOP_CONNECT_PRIVATE_KEY: pem.replace(/\n/g, '\\n') })).not.toBeNull();
    expect(signingKey({})).toBeNull();
    expect(signingKey({ SHOP_CONNECT_PRIVATE_KEY: 'nonsense' })).toBeNull();
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    expect(signingKey({ SHOP_CONNECT_PRIVATE_KEY: rsa })).toBeNull();
    expect(publicKeyPem({ SHOP_CONNECT_PRIVATE_KEY: pem })).toContain('BEGIN PUBLIC KEY');
  });
});

describe('where a token may go', () => {
  test('only the site’s return route, on an allowed origin, with no query of its own', () => {
    expect(allowedReturn('https://www.useclear.org/api/shop/account/return', {})?.origin).toBe('https://www.useclear.org');
    expect(allowedReturn('https://useclear.org/api/shop/account/return', {})).not.toBeNull();
    expect(allowedReturn('https://evil.example/api/shop/account/return', {})).toBeNull();
    expect(allowedReturn('https://www.useclear.org.evil.example/api/shop/account/return', {})).toBeNull();
    expect(allowedReturn('http://www.useclear.org/api/shop/account/return', {})).toBeNull();
    expect(allowedReturn('https://www.useclear.org/shop/bag', {})).toBeNull();
    expect(allowedReturn('https://www.useclear.org/api/shop/account/return?next=https://evil.example', {})).toBeNull();
    expect(allowedReturn('https://user:pw@www.useclear.org/api/shop/account/return', {})).toBeNull();
    expect(allowedReturn('not a url', {})).toBeNull();
  });
  test('SHOP_CONNECT_RETURN_ORIGINS replaces the default, for a preview or localhost on dev', () => {
    const env = { SHOP_CONNECT_RETURN_ORIGINS: 'http://localhost:8137, https://preview.useclear.org/' };
    expect(allowedReturn('http://localhost:8137/api/shop/account/return', env)).not.toBeNull();
    expect(allowedReturn('https://preview.useclear.org/api/shop/account/return', env)).not.toBeNull();
    expect(allowedReturn('https://www.useclear.org/api/shop/account/return', env)).toBeNull();
  });
  test('the site’s state is opaque but bounded', () => {
    expect(validState('a'.repeat(24))).toBe(true);
    expect(validState('short')).toBe(false);
    expect(validState('has spaces in it, sixteen+')).toBe(false);
    expect(validState(undefined)).toBe(false);
  });
});

describe('approval', () => {
  test('verified is approved, rejected is declined, anything else is pending', () => {
    expect(approvalOf('verified')).toBe('approved');
    expect(approvalOf('rejected')).toBe('declined');
    for (const s of ['not_started', 'needs_info', 'in_review', 'paused'] as const) expect(approvalOf(s)).toBe('pending');
  });
  test('reads the shop’s Bridge verification, and never declines when Bridge cannot be reached', async () => {
    const { merchant } = await seedShop(db);
    expect(await shopApproval(db, fakeBridge('active'), merchant)).toBe('pending'); // no Bridge customer yet
    await db.query("UPDATE merchant.profiles SET bridge_customer_id = 'cus_biz' WHERE merchant = $1", [merchant]);
    expect(await shopApproval(db, fakeBridge('active'), merchant)).toBe('approved');
    expect(await shopApproval(db, fakeBridge('rejected'), merchant)).toBe('declined');
    expect(await shopApproval(db, fakeBridge('under_review'), merchant)).toBe('pending');
    expect(await shopApproval(db, fakeBridge(null), merchant)).toBe('pending');
    expect(await shopApproval(db, fakeBridge('active'), '0x' + 'f'.repeat(40))).toBeNull();
  });
});

describe('the token', () => {
  test('names the shop, its owner and address, and verifies with the public key', async () => {
    const { merchant, staff } = await seedShop(db, { founding: true });
    await db.query(
      `UPDATE merchant.profiles SET name = 'Mi Casa Tacos', kyb_email = 'ana@micasatacos.test', address_line1 = '1450 N Mountain Ave', address_city = 'Ontario', address_region = 'CA', address_postal_code = '91762' WHERE merchant = $1`,
      [merchant],
    );
    const claims = await shopClaims(db, fakeBridge(null), merchant, staff.owner);
    expect(claims).toEqual({
      sub: merchant,
      name: 'Mi Casa Tacos',
      owner: 'Marcus',
      email: 'ana@micasatacos.test',
      approval: 'pending',
      address: { line1: '1450 N Mountain Ave', city: 'Ontario', state: 'CA', zip: '91762', country: 'US' },
      founding: true,
    });
    const state = 'st_' + 'x'.repeat(20);
    const now = 1_800_000_000;
    const token = mintToken(claims, state, signingKey({ SHOP_CONNECT_PRIVATE_KEY: pem })!, now);
    const [h, p, s] = token.split('.');
    expect(decode(h)).toEqual({ alg: 'EdDSA', typ: 'JWT' });
    expect(decode(p)).toEqual({ aud: AUDIENCE, ...claims, state, iat: now, exp: now + 600 });
    expect(verify(null, Buffer.from(`${h}.${p}`), createPublicKey(publicKeyPem({ SHOP_CONNECT_PRIVATE_KEY: pem })!), Buffer.from(s, 'base64url'))).toBe(true);
    const back = new URL(redirectTo(allowedReturn('https://www.useclear.org/api/shop/account/return', {})!, token, state));
    expect(back.searchParams.get('token')).toBe(token);
    expect(back.searchParams.get('state')).toBe(state);
  });
  test('only the owner can sign the shop in, and only their own shop', async () => {
    const a = await seedShop(db);
    const b = await seedShop(db);
    await expect(shopClaims(db, fakeBridge(null), a.merchant, a.staff.manager)).rejects.toBeInstanceOf(ConnectError);
    await expect(shopClaims(db, fakeBridge(null), a.merchant, b.staff.owner)).rejects.toBeInstanceOf(ConnectError);
    await db.query('UPDATE merchant.staff SET active = false WHERE id = $1', [a.staff.owner]);
    await expect(shopClaims(db, fakeBridge(null), a.merchant, a.staff.owner)).rejects.toBeInstanceOf(ConnectError);
  });
  test('leaves out an address the shop has not finished, and an email it does not have', async () => {
    const { merchant, staff } = await seedShop(db);
    await db.query("UPDATE merchant.profiles SET address_line1 = '1 Main St' WHERE merchant = $1", [merchant]);
    const claims = await shopClaims(db, fakeBridge(null), merchant, staff.owner);
    expect(claims.address).toBeUndefined();
    expect(claims.email).toBeUndefined();
  });
});
