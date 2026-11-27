import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  askingFor,
  contactLabel,
  doneLede,
  endedLine,
  handoffFrom,
  identityAfterSubmit,
  identityInput,
  identityValuesFrom,
  isOnboarded,
  needsJoining,
  nextStep,
  parseStreet,
  postJoinDone,
  readJoinWindow,
  splitLegalName,
  stateCode,
  toE164,
  typedDob,
  type JoinProgress,
  type JoinWindowView,
} from './joinPay';

const VIEW: JoinWindowView = {
  shop: { name: 'Mi Casa Tacos', initials: 'MC' },
  order: { totalCents: 18532, summary: 'Taco tray for 12, 2 × Agua fresca' },
  shopHost: 'micasatacos.com',
  basics: { legalName: 'Marco Alvarez', dateOfBirth: '1991-04-12', zip: '91762', street: '418 W 6th St, Ontario, CA' },
  contact: { channel: 'phone', value: '+19095550188' },
  expiresAt: '2026-10-16T19:00:00.000Z',
};

const fakeFetch = (status: number, body: unknown = {}) => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, calls };
};

describe('the hand-off', () => {
  test('is read from ?h=, and nothing else passes for one', () => {
    expect(handoffFrom('?h=hf_8QK2abcd')).toBe('hf_8QK2abcd');
    expect(handoffFrom('')).toBeNull();
    expect(handoffFrom('?h=')).toBeNull();
    expect(handoffFrom('?h=short')).toBeNull();
    expect(handoffFrom('?h=../../api/x')).toBeNull();
  });

  test('a 404, a 410 and a 409 are a link that has ended; 401 is sign in; anything else is an error', async () => {
    for (const status of [404, 410, 409]) expect((await readJoinWindow('hf_abcdefgh', 'https://api', {}, fakeFetch(status).impl)).kind).toBe('ended');
    expect((await readJoinWindow('hf_abcdefgh', 'https://api', {}, fakeFetch(401).impl)).kind).toBe('signin');
    expect((await readJoinWindow('hf_abcdefgh', 'https://api', {}, fakeFetch(500).impl)).kind).toBe('error');
    expect((await readJoinWindow('hf_abcdefgh', 'https://api', {}, fakeFetch(200, { nope: true }).impl)).kind).toBe('error');
    const thrown = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect((await readJoinWindow('hf_abcdefgh', 'https://api', {}, thrown)).kind).toBe('error');
  });

  test('signed out, the API names the shop and the contact but keeps step 1 back', async () => {
    const signedOut = { ...VIEW, basics: null };
    expect(await readJoinWindow('hf_abcdefgh', 'https://api', {}, fakeFetch(200, signedOut).impl)).toEqual({ kind: 'ok', data: signedOut });
    expect(identityValuesFrom(signedOut)).toMatchObject({ name: '', dob: '', zip: '', phone: VIEW.contact.channel === 'phone' ? VIEW.contact.value : '' });
  });

  test('reads with the member session it is given, never a cookie or a cache', async () => {
    const f = fakeFetch(200, VIEW);
    const r = await readJoinWindow('hf_abcdefgh', 'https://api', { Authorization: 'Bearer t', 'X-Wallet-Address': '0xabc' }, f.impl);
    expect(r).toEqual({ kind: 'ok', data: VIEW });
    expect(f.calls[0]!.url).toBe('https://api/api/checkout/join/hf_abcdefgh');
    expect(f.calls[0]!.init).toMatchObject({ credentials: 'omit', cache: 'no-store' });
    expect((f.calls[0]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer t');
    expect((f.calls[0]!.init!.headers as Record<string, string>)['X-Wallet-Address']).toBe('0xabc');
  });

  test('done is a POST to …/done, and reads the same way', async () => {
    const f = fakeFetch(200, { state: 'done', termLimitCents: 50_000 });
    expect(await postJoinDone('hf_abcdefgh', 'https://api', {}, f.impl)).toEqual({ kind: 'ok', data: { state: 'done', termLimitCents: 50_000 } });
    expect(f.calls[0]!.url).toBe('https://api/api/checkout/join/hf_abcdefgh/done');
    expect(f.calls[0]!.init!.method).toBe('POST');
    expect((await postJoinDone('hf_abcdefgh', 'https://api', {}, fakeFetch(410).impl)).kind).toBe('ended');
  });
});

describe('what the window says', () => {
  test("who's asking", () => {
    expect(askingFor(VIEW)).toBe('Mi Casa Tacos · $185.32 · Taco tray for 12, 2 × Agua fresca');
  });

  test('the confirmed contact, as people write it', () => {
    expect(contactLabel(VIEW.contact)).toBe('(909) 555-0188');
    expect(contactLabel({ channel: 'phone', value: '9095550188' })).toBe('(909) 555-0188');
    expect(contactLabel({ channel: 'email', value: 'marco@example.com' })).toBe('marco@example.com');
  });

  test('a link that has ended says where to start again', () => {
    expect(endedLine('Mi Casa Tacos')).toBe('This link has ended. Start again on Mi Casa Tacos’s page.');
    expect(endedLine(null)).toBe('This link has ended. Start again on the shop’s page.');
  });

  test("you're in: a limit, a rejection (card is still there), or the checks still going", () => {
    expect(doneLede({ state: 'done', termLimitCents: 50_000 }, 'micasatacos.com', 'Mi Casa Tacos', 'verified')).toBe(
      'You can split up to $500.00. Finish on micasatacos.com.',
    );
    expect(doneLede({ state: 'done', termLimitCents: null }, 'micasatacos.com', 'Mi Casa Tacos', 'rejected')).toContain(
      'micasatacos.com still has Pay by card.',
    );
    expect(doneLede({ state: 'done', termLimitCents: null }, null, 'Mi Casa Tacos', 'rejected')).toContain('Mi Casa Tacos’s page still has Pay by card.');
    expect(doneLede({ state: 'done', termLimitCents: null }, 'micasatacos.com', 'Mi Casa Tacos', 'unverified', true)).toContain('Pay by card');
    expect(doneLede({ state: 'done', termLimitCents: null }, 'micasatacos.com', 'Mi Casa Tacos', 'in_review')).toBe(
      'Finish on micasatacos.com. It still has Pay by card.',
    );
  });
});

describe('the basics, ready for the identity check', () => {
  test('the legal name splits into first and last the way the Verify form splits it', () => {
    expect(splitLegalName('Marco Alvarez')).toEqual({ firstName: 'Marco', lastName: 'Alvarez' });
    expect(splitLegalName('  Maria  de la Cruz ')).toEqual({ firstName: 'Maria', lastName: 'de la Cruz' });
    expect(splitLegalName('Cher')).toBeNull();
  });

  test('a street with its city and state splits; one without leaves them to ask', () => {
    expect(parseStreet('418 W 6th St, Ontario, CA')).toEqual({ address1: '418 W 6th St', city: 'Ontario', state: 'CA' });
    expect(parseStreet('418 W 6th St, Apt 2, Ontario, California 91762')).toEqual({ address1: '418 W 6th St, Apt 2', city: 'Ontario', state: 'CA' });
    expect(parseStreet('418 W 6th St, Ontario CA 91762')).toEqual({ address1: '418 W 6th St', city: 'Ontario', state: 'CA' });
    expect(parseStreet('418 W 6th St')).toEqual({ address1: '418 W 6th St', city: '', state: '' });
    expect(parseStreet('418 W 6th St, Unit 4')).toEqual({ address1: '418 W 6th St, Unit 4', city: '', state: '' });
    expect(parseStreet('12 Main St, Springfield, Narnia')).toEqual({ address1: '12 Main St, Springfield, Narnia', city: '', state: '' });
  });

  test('states by code or by name', () => {
    expect(stateCode('ca')).toBe('CA');
    expect(stateCode('New York')).toBe('NY');
    expect(stateCode('Cal')).toBeNull();
  });

  test('the date of birth and the phone in the shapes the form and Lithic take', () => {
    expect(typedDob('1991-04-12')).toBe('04/12/1991');
    expect(typedDob('nonsense')).toBe('');
    expect(toE164('(909) 555-0188')).toBe('+19095550188');
    expect(toE164('+1 909 555 0188')).toBe('+19095550188');
  });

  test('the form fills from step 1 and the confirmed contact, never with an SSN', () => {
    const v = identityValuesFrom(VIEW, 'marco@example.com');
    expect(v).toEqual({
      name: 'Marco Alvarez',
      dob: '04/12/1991',
      address1: '418 W 6th St',
      city: 'Ontario',
      state: 'CA',
      zip: '91762',
      phone: '+19095550188',
      email: 'marco@example.com',
      ssn: '',
    });
    const byEmail = identityValuesFrom({ ...VIEW, contact: { channel: 'email', value: 'm@example.com' } });
    expect(byEmail.email).toBe('m@example.com');
    expect(byEmail.phone).toBe('');
  });

  test('the input Lithic gets, and what stops it before an SSN is sent', () => {
    const v = { ...identityValuesFrom(VIEW, 'marco@example.com'), ssn: '123456789' };
    const ok = identityInput(v);
    expect(ok).toEqual({
      input: {
        firstName: 'Marco',
        lastName: 'Alvarez',
        email: 'marco@example.com',
        phoneNumber: '+19095550188',
        dob: '1991-04-12',
        governmentId: '123-45-6789',
        address: { address1: '418 W 6th St', city: 'Ontario', state: 'CA', postal_code: '91762' },
      },
    });
    expect(identityInput({ ...v, ssn: '1234' })).toEqual({ error: 'A social security number is nine digits.' });
    expect(identityInput({ ...v, city: '' })).toEqual({ error: 'We need your full home address.' });
    expect(identityInput({ ...v, state: 'Narnia' })).toEqual({ error: 'Enter your state, like CA.' });
    expect(identityInput({ ...v, email: '' })).toEqual({ error: 'We need an email address for our card issuer.' });
    expect(identityInput({ ...v, name: 'Marco' })).toEqual({ error: 'Enter your first and last name.' });
  });
});

describe('the steps, in order', () => {
  const fresh: JoinProgress = {
    onboarded: false,
    identity: 'unverified',
    identityTried: false,
    identityLater: false,
    joining: true,
    bankLinked: false,
    bankSkipped: false,
  };

  test('new: join, confirm it’s you, link a bank, finish', () => {
    let p = fresh;
    expect(nextStep(p)).toBe('onboard');
    p = { ...p, onboarded: true };
    expect(nextStep(p)).toBe('identity');
    p = { ...p, identity: 'verified', identityTried: true };
    expect(nextStep(p)).toBe('bank');
    p = { ...p, bankLinked: true };
    expect(nextStep(p)).toBe('finish');
  });

  test('the bank can be skipped; it isn’t needed to join', () => {
    expect(nextStep({ ...fresh, onboarded: true, identity: 'verified', bankSkipped: true })).toBe('finish');
  });

  test('a photo when Lithic wants one, and it can wait', () => {
    const p = { ...fresh, onboarded: true, identity: 'needs_document' as const, identityTried: true };
    expect(nextStep(p)).toBe('document');
    expect(nextStep({ ...p, identityLater: true })).toBe('bank');
  });

  test('rejected still finishes (the modal falls back to card), with no bank to link', () => {
    expect(nextStep({ ...fresh, onboarded: true, identity: 'rejected', identityTried: true })).toBe('finish');
  });

  test("a mismatch is asked once, not in a loop; under review moves on", () => {
    expect(nextStep({ ...fresh, onboarded: true, identity: 'needs_resubmit' })).toBe('identity');
    expect(nextStep({ ...fresh, onboarded: true, identity: 'needs_resubmit', identityTried: true })).toBe('bank');
    expect(nextStep({ ...fresh, onboarded: true, identity: 'in_review', identityTried: true })).toBe('bank');
  });

  test('"Not now" on identity moves on to the bank', () => {
    expect(nextStep({ ...fresh, onboarded: true, identityLater: true })).toBe('bank');
  });

  test('Lithic off: nothing to confirm', () => {
    expect(nextStep({ ...fresh, onboarded: true, identity: 'unavailable' })).toBe('bank');
  });

  test('already a member, onboarded and verified: straight to finishing', () => {
    expect(needsJoining(true, 'verified')).toBe(false);
    expect(nextStep({ ...fresh, onboarded: true, identity: 'verified', joining: needsJoining(true, 'verified') })).toBe('finish');
    expect(needsJoining(true, 'in_review')).toBe(false);
    expect(needsJoining(true, 'unverified')).toBe(true);
    expect(needsJoining(false, 'verified')).toBe(true);
  });

  test('onboarded is past ONBOARDING; not loaded is not onboarded', () => {
    expect(isOnboarded('ONBOARDING')).toBe(false);
    expect(isOnboarded(null)).toBe(false);
    expect(isOnboarded('BASIC_ACTIVE')).toBe(true);
  });

  test("Lithic's answer after the form, read the way Settings reads it", () => {
    expect(identityAfterSubmit('ACCEPTED')).toBe('verified');
    expect(identityAfterSubmit('PENDING_DOCUMENT')).toBe('needs_document');
    expect(identityAfterSubmit('REJECTED')).toBe('rejected');
    expect(identityAfterSubmit(undefined)).toBe('in_review');
  });
});

describe('the route', () => {
  const ROUTE = readFileSync(join(import.meta.dir, '../pages/app/JoinPayRoute.tsx'), 'utf8');
  const APP = readFileSync(join(import.meta.dir, '../App.tsx'), 'utf8');

  test('lives outside the shell, with its own profile provider, like /approve/:id', () => {
    const at = APP.indexOf('path="/join/pay"');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(APP.indexOf('<ProtectedRoute>'));
    expect(APP.slice(at, at + 200)).toContain('<MemberProfileProvider>');
  });

  test('joins as an online referral through the shared submit chain', () => {
    expect(ROUTE).toContain('submitClearOnboarding');
    expect(ROUTE).toContain("referralSource: 'online'");
  });

  test('signs in with Privy prefilled with the confirmed contact', () => {
    expect(ROUTE).toMatch(/login\(\{ prefill: \{ type: view\.contact\.channel, value: view\.contact\.value \} \}\)/);
  });

  test('closes itself when done, or says where to go', () => {
    expect(ROUTE).toContain('closeOrFallback(window');
    expect(ROUTE).toContain('doneLine(host)');
  });

  test('never keeps the SSN after the request', () => {
    expect(ROUTE).toMatch(/ssn: ''/);
    expect(ROUTE).not.toMatch(/localStorage|sessionStorage/);
  });
});
