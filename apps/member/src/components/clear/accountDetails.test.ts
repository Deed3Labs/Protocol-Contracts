import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCOUNT_DETAILS_NOTE,
  ACCOUNT_DETAILS_TITLE,
  BANK_DISCLOSURE_PENDING_APPROVAL,
  CLOSED,
  accountDetailsReducer,
  accountNumberShown,
  bankDisclosure,
  copyText,
  maskedAccountNumber,
  obtainFullNumber,
  type AccountDetailsSource,
  type AccountDetailsState,
  type MaskedAccountDetails,
} from '@/lib/accountDetails';
import { STEP_UP_DECLINED, clearStepUp, setServerStepUpEnrolled, setServerStepUpToken, setStepUpVerifier } from '@/lib/stepUp';

/*
 * Spendable account details: ····1234 at rest, the full number only after Face ID, copy copies the
 * full number, and none of it reaches anywhere that outlives the surface.
 */

const read = (p: string) => readFileSync(join(import.meta.dir, p), 'utf8');
const DIALOG = read('AccountDetailsDialog.tsx');
const LIB = read('../../lib/accountDetails.ts');
const FORM = read('../../lib/directDepositForm.ts');
const API = read('../../utils/apiClient.ts');
const HOME = read('../../pages/app/HomePage.tsx');
const SW = read('../../../public/sw.js');

const FULL = '000123454192';
const DETAILS: MaskedAccountDetails = {
  holderName: 'Ada Lovelace',
  bankName: 'Example Partner Bank',
  routingNumber: '084106768',
  accountNumberLast4: '4192',
  accountType: 'Checking',
};

/** A source that counts how often the full number was asked for. */
function fakeSource() {
  const calls = { masked: 0, full: 0 };
  const source: AccountDetailsSource = {
    readMasked: async () => {
      calls.masked++;
      return { configured: true, details: DETAILS };
    },
    readFullNumber: async () => {
      calls.full++;
      return { accountNumber: FULL };
    },
  };
  return { source, calls };
}

/** The state after opening and loading. */
function loaded(): AccountDetailsState {
  const opened = accountDetailsReducer(CLOSED, { type: 'open' });
  return accountDetailsReducer(opened, { type: 'loaded', session: opened.session, read: { configured: true, details: DETAILS } });
}

describe('the copy is the spec\'s', () => {
  test('title and the line under the rows', () => {
    expect(ACCOUNT_DETAILS_TITLE).toBe('Spendable account details');
    expect(ACCOUNT_DETAILS_NOTE).toBe(
      "Use these for direct deposit or bank transfers. Money that lands here clears what you've used on Clear Credit first, then the rest is spendable. You can change this in Settings › Automatic clearing.",
    );
  });

  test('the footer has the bank name substituted, and is marked pending the bank\'s wording', () => {
    expect(bankDisclosure('Example Partner Bank')).toBe(
      'Deposits are held at Example Partner Bank, Member FDIC. Clear is not a bank. Banking services provided by Example Partner Bank.',
    );
    expect(BANK_DISCLOSURE_PENDING_APPROVAL).toBe(true);
    expect(LIB).toContain("PENDING THE BANK'S APPROVED WORDING");
    // One place: the surface and the PDF both use the constant rather than their own copy.
    expect(DIALOG).toContain('bankDisclosure(details.bankName)');
    expect(FORM).toContain('bankDisclosure(data.bankName)');
    expect(DIALOG).not.toContain('Member FDIC');
    expect(FORM).not.toContain('Member FDIC');
  });

  test('the rows, and the secondary action', () => {
    for (const label of ['Account holder', 'Bank', 'Routing number', 'Account number', 'Account type']) {
      expect(DIALOG).toContain(`label="${label}"`);
    }
    expect(DIALOG).toContain('DIRECT_DEPOSIT_FORM_ACTION');
    expect(LIB).toContain("DIRECT_DEPOSIT_FORM_ACTION = 'Get direct deposit form'");
  });

  test('no currency and no bars on this surface', () => {
    expect(DIALOG).not.toMatch(/\bmoney\(|signedMoney|<Bar\b|<Track\b|<HeadFig\b/);
  });
});

describe('the account number is masked by default', () => {
  test('····1234', () => {
    expect(maskedAccountNumber('1234')).toBe('····1234');
  });

  test('a freshly loaded surface shows the last four only', () => {
    expect(accountNumberShown(loaded())).toBe('····4192');
  });

  test('copying holds the full number without putting it on screen', () => {
    const s = loaded();
    const copied = accountDetailsReducer(s, { type: 'revealed', session: s.session, accountNumber: FULL, show: false });
    expect(copied.fullNumber).toBe(FULL);
    expect(accountNumberShown(copied)).toBe('····4192');
  });

  test('Show puts it on screen, Hide takes it off', () => {
    const s = loaded();
    const shown = accountDetailsReducer(s, { type: 'revealed', session: s.session, accountNumber: FULL, show: true });
    expect(accountNumberShown(shown)).toBe(FULL);
    expect(accountNumberShown(accountDetailsReducer(shown, { type: 'hide' }))).toBe('····4192');
  });

  test('closing drops the full number', () => {
    const s = loaded();
    const shown = accountDetailsReducer(s, { type: 'revealed', session: s.session, accountNumber: FULL, show: true });
    const closed = accountDetailsReducer(shown, { type: 'close' });
    expect(closed.fullNumber).toBeNull();
    expect(closed.details).toBeNull();
    expect(closed.shown).toBe(false);
  });

  test('a number that lands after the surface closed is not kept', () => {
    const s = loaded();
    const closed = accountDetailsReducer(s, { type: 'close' });
    expect(accountDetailsReducer(closed, { type: 'revealed', session: s.session, accountNumber: FULL, show: true }).fullNumber).toBeNull();
    // Nor in the next open: it belongs to the session that asked.
    const reopened = accountDetailsReducer(closed, { type: 'open' });
    expect(accountDetailsReducer(reopened, { type: 'revealed', session: s.session, accountNumber: FULL, show: true }).fullNumber).toBeNull();
  });

  test('the masked read is fetched on every open', () => {
    expect(DIALOG).toMatch(/state\.status !== 'loading'\) return;[\s\S]{0,120}source\.readMasked\(\)/);
    expect(accountDetailsReducer(CLOSED, { type: 'open' }).status).toBe('loading');
  });
});

describe('Show needs Face ID', () => {
  beforeEach(() => clearStepUp());
  afterEach(() => {
    setStepUpVerifier(null);
    clearStepUp();
  });

  test('declined: the full number is never asked for', async () => {
    const { source, calls } = fakeSource();
    setServerStepUpEnrolled(true);
    setStepUpVerifier(async () => {
      throw new Error('no');
    });
    expect(await obtainFullNumber(null, source)).toEqual({ error: STEP_UP_DECLINED });
    expect(calls.full).toBe(0);
  });

  test('confirmed: asked once, then the number', async () => {
    const { source, calls } = fakeSource();
    let asked = 0;
    setServerStepUpEnrolled(true);
    setStepUpVerifier(async () => {
      asked++;
      setServerStepUpToken({ token: 'fresh', expiresAt: Date.now() + 120_000 });
    });
    expect(await obtainFullNumber(null, source)).toEqual({ accountNumber: FULL });
    expect(asked).toBe(1);
    expect(calls.full).toBe(1);
  });

  test('already held this open: no second prompt, no second read', async () => {
    const { source, calls } = fakeSource();
    let gated = 0;
    const gate = async () => {
      gated++;
      return null;
    };
    expect(await obtainFullNumber(FULL, source, gate)).toEqual({ accountNumber: FULL });
    expect(gated).toBe(0);
    expect(calls.full).toBe(0);
  });

  test('the surface reaches the number only through that gate', () => {
    expect(DIALOG).toContain('obtainFullNumber(state.fullNumber, source)');
    expect(DIALOG).not.toContain('readFullNumber(');
    // And the server refuses it without step-up anyway (api routes/lithic).
    expect(API).toContain("'/api/lithic/account-details/account-number'");
  });
});

describe('copy', () => {
  const nav = globalThis.navigator as Navigator & { clipboard?: unknown };
  const hadClipboardItem = 'ClipboardItem' in globalThis;
  let written: string[] = [];

  beforeEach(() => {
    written = [];
    Object.defineProperty(nav, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (t: string) => void written.push(t),
        write: async (items: { types: string[]; getType: (t: string) => Promise<Blob> }[]) => {
          for (const item of items) written.push(await (await item.getType('text/plain')).text());
        },
      },
    });
    clearStepUp();
  });
  afterEach(() => {
    delete (nav as { clipboard?: unknown }).clipboard;
    if (!hadClipboardItem) delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
    setStepUpVerifier(null);
    clearStepUp();
  });

  test('a plain value is copied as it is', async () => {
    expect(await copyText(DETAILS.routingNumber)).toBe(true);
    expect(written).toEqual(['084106768']);
  });

  test('the account number before it is revealed: Face ID, then the FULL number, never the dots', async () => {
    const { source } = fakeSource();
    let asked = 0;
    setServerStepUpEnrolled(true);
    setStepUpVerifier(async () => {
      asked++;
      setServerStepUpToken({ token: 'fresh', expiresAt: Date.now() + 120_000 });
    });
    const number = obtainFullNumber(null, source).then((r) => ('accountNumber' in r ? r.accountNumber : Promise.reject(new Error(r.error))));
    expect(await copyText(number)).toBe(true);
    expect(asked).toBe(1);
    expect(written).toEqual([FULL]);
  });

  test('the same through a ClipboardItem, where the browser has one', async () => {
    class FakeItem {
      constructor(private parts: Record<string, Promise<Blob>>) {}
      get types() {
        return Object.keys(this.parts);
      }
      getType(t: string) {
        return this.parts[t];
      }
    }
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = FakeItem;
    expect(await copyText(Promise.resolve(FULL))).toBe(true);
    expect(written).toEqual([FULL]);
  });

  test('declined Face ID copies nothing', async () => {
    const { source } = fakeSource();
    setServerStepUpEnrolled(true);
    setStepUpVerifier(async () => {
      throw new Error('no');
    });
    const number = obtainFullNumber(null, source).then((r) => ('accountNumber' in r ? r.accountNumber : Promise.reject(new Error(r.error))));
    expect(await copyText(number)).toBe(false);
    expect(written).toEqual([]);
  });

  test('every value has a copy button, and the account number copies the full number', () => {
    expect(DIALOG).toContain('copy={() => fullNumber(false)}');
    expect(DIALOG.match(/copy=\{/g)?.length).toBe(5);
  });
});

describe('nothing reaches persistent storage', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { localStorage: g.localStorage, sessionStorage: g.sessionStorage, indexedDB: g.indexedDB, caches: g.caches };
  const writes: string[] = [];
  const spyStorage = (name: string) => ({
    getItem: () => null,
    setItem: (k: string, v: string) => void writes.push(`${name}:${k}=${v}`),
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  });

  beforeEach(() => {
    writes.length = 0;
    g.localStorage = spyStorage('localStorage');
    g.sessionStorage = spyStorage('sessionStorage');
    g.indexedDB = { open: (n: string) => void writes.push(`indexedDB:${n}`) };
    g.caches = { open: async (n: string) => void writes.push(`caches:${n}`) };
  });
  afterAll(() => Object.assign(g, saved));

  test('a full open, reveal, copy and close writes nowhere', async () => {
    const { source } = fakeSource();
    let s = loaded();
    const r = await obtainFullNumber(null, source, async () => null);
    if (!('accountNumber' in r)) throw new Error('expected a number');
    s = accountDetailsReducer(s, { type: 'revealed', session: s.session, accountNumber: r.accountNumber, show: true });
    s = accountDetailsReducer(s, { type: 'close' });
    expect(s.fullNumber).toBeNull();
    expect(writes).toEqual([]);
  });

  test('the surface, its state and the PDF never touch device storage', () => {
    for (const src of [DIALOG, LIB, FORM]) {
      expect(src).not.toMatch(/localStorage\.|sessionStorage\.|indexedDB|caches\.open|useRemembered|persistQueryClient|createSyncStoragePersister/);
    }
  });

  test('Home no longer passes the numbers in, so nothing above the surface holds them', () => {
    expect(HOME).not.toContain('account={data.cashAccount} open={accountOpen}');
    expect(DIALOG).not.toContain('account.accountNumber');
  });

  test('the reads ask the browser not to keep them, and the service worker never caches them', () => {
    const fns = API.slice(API.indexOf('export async function getSpendableAccountDetails'), API.indexOf('export const liveAccountDetails'));
    expect(fns.match(/cache: 'no-store'/g)).toHaveLength(2);
    expect(SW).toMatch(/if \(isBankDetailsAPI\(url\)\) \{\s*event\.respondWith\(networkOnly\(request\)\);/);
    expect(SW).toContain("return url.pathname.startsWith('/api/lithic/account');");
  });
});

describe('Get direct deposit form', () => {
  const texts: string[] = [];
  const saved: string[] = [];
  mock.module('jspdf', () => ({
    jsPDF: class {
      internal = { pageSize: { getWidth: () => 612 } };
      setFont() { return this; }
      setFontSize() { return this; }
      setTextColor() { return this; }
      setDrawColor() { return this; }
      line() { return this; }
      splitTextToSize(t: string) { return [t]; }
      text(t: string | string[]) {
        texts.push(...(Array.isArray(t) ? t : [t]));
        return this;
      }
      save(name: string) {
        saved.push(name);
      }
    },
  }));

  test('a PDF prefilled with every detail and the full number, to the member\'s own download', async () => {
    const { downloadDirectDepositForm, DIRECT_DEPOSIT_FILENAME } = await import('@/lib/directDepositForm');
    await downloadDirectDepositForm({ ...DETAILS, accountNumber: FULL });
    for (const v of ['Ada Lovelace', 'Example Partner Bank', '084106768', FULL, 'Checking']) expect(texts).toContain(v);
    expect(texts).toContain(bankDisclosure('Example Partner Bank'));
    expect(texts).not.toContain('····4192');
    expect(saved).toEqual([DIRECT_DEPOSIT_FILENAME]);
  });

  test('the surface makes it from the full number it obtained through Face ID', () => {
    expect(DIALOG).toMatch(/const accountNumber = await fullNumber\(false\);[\s\S]{0,80}downloadDirectDepositForm\(/);
  });
});
