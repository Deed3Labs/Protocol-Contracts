import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  approveLabel,
  askingLine,
  backOnLine,
  closeOrFallback,
  doneLine,
  handBack,
  hasNoClearAccount,
  hostOf,
  noAccountLine,
  overTimeShown,
  readApproval,
  returnUrlAllowed,
  shopHostFor,
  type ApprovalView,
} from './approvalPage';

const PAGES = join(import.meta.dir, '../pages/app');
const ROUTE = readFileSync(join(PAGES, 'ChargeApprovalRoute.tsx'), 'utf8');
const SCREEN = readFileSync(join(PAGES, 'ChargeApproval.tsx'), 'utf8');
const PAGE = readFileSync(join(PAGES, 'ApprovalPageRoute.tsx'), 'utf8');
const APP = readFileSync(join(import.meta.dir, '../App.tsx'), 'utf8');

const VIEW: ApprovalView = {
  id: 'ps_1',
  shop: { name: 'Mi Casa Tacos', initials: 'MC', logoUrl: null, accent: '#B4532A' },
  order: {
    lines: [
      { name: 'Taco tray for 12', quantity: 1, lineCents: 14900 },
      { name: 'Agua fresca, gallon', quantity: 2, lineCents: 2200 },
    ],
    subtotalCents: 17100,
    taxCents: 1432,
    totalCents: 18532,
    summary: 'Taco tray for 12, 2 × Agua fresca',
  },
  channel: 'online',
  returnUrl: 'https://micasatacos.com/order/confirm',
  chargeCode: 'CLRWEB12',
};

describe('the sheet’s head line (pay spec §4)', () => {
  test('a website’s payment', () => {
    expect(askingLine('Mi Casa Tacos', 'online')).toBe('MI CASA TACOS IS ASKING · ONLINE');
  });
  test('a payment link’s', () => {
    expect(askingLine('Mi Casa Tacos', 'link')).toBe('MI CASA TACOS IS ASKING · LINK');
  });
});

describe('the shop’s site, from the return address', () => {
  test('the host alone, without www', () => {
    expect(hostOf('https://micasatacos.com/order/confirm?x=1')).toBe('micasatacos.com');
    expect(hostOf('https://www.micasatacos.com/')).toBe('micasatacos.com');
    expect(hostOf('https://order.micasatacos.com')).toBe('order.micasatacos.com');
  });
  test('nothing that isn’t a web address', () => {
    expect(hostOf(null)).toBeNull();
    expect(hostOf('')).toBeNull();
    expect(hostOf('not a url')).toBeNull();
    expect(hostOf('javascript:alert(1)')).toBeNull();
    expect(hostOf('micasa://done')).toBeNull();
  });
  test('the charge’s own host first, then the return address', () => {
    expect(shopHostFor({ channel: 'online', shopHost: 'micasatacos.com' }, 'https://elsewhere.example')).toBe('micasatacos.com');
    expect(shopHostFor(null, VIEW.returnUrl)).toBe('micasatacos.com');
    expect(shopHostFor({ channel: 'link', shopHost: null }, null)).toBeNull();
  });
  test('the lines that name it, and the one that doesn’t without it', () => {
    expect(backOnLine('micasatacos.com')).toBe('Then you’re back on micasatacos.com');
    expect(backOnLine(null)).toBeNull();
    expect(doneLine('micasatacos.com')).toBe('Done. Go back to micasatacos.com');
    expect(doneLine(null)).toBe('Done. Go back to the shop’s page');
    expect(noAccountLine('micasatacos.com', 'Mi Casa Tacos')).toBe('Enter the code we sent you on micasatacos.com, or pay by card there.');
    expect(noAccountLine(null, 'Mi Casa Tacos')).toBe('Enter the code we sent you on Mi Casa Tacos’s page, or pay by card there.');
  });
});

describe('Over time', () => {
  test('hidden when the shop offers Pay now only', () => {
    expect(overTimeShown(false)).toBe(false);
  });
  test('shown otherwise; the counter’s null keeps its own rules', () => {
    expect(overTimeShown(true)).toBe(true);
    expect(overTimeShown(null)).toBe(true);
    expect(overTimeShown(undefined)).toBe(true);
  });
  test('the button says the split', () => {
    expect(approveLabel('$185.32', 4)).toBe('Approve $185.32 in 4');
    expect(approveLabel('$185.32', 1)).toBe('Approve $185.32 next cycle');
  });
  test('the screen takes it from the charge, and lands nothing on a hidden Over time', () => {
    expect(ROUTE).toContain('overTimeShown={showsOverTime(charge.overTime)}');
    expect(SCREEN).toContain("(!overTimeShown && asked === 'over') ? 'now' : asked");
    expect(SCREEN).toContain('{!overTimeShown ? null : overTimeOff ? (');
  });
});

describe('the returnUrl hook', () => {
  test('only the payment’s own site, by origin', () => {
    expect(returnUrlAllowed('https://micasatacos.com/thanks', VIEW.returnUrl)).toBe(true);
    expect(returnUrlAllowed('https://micasatacos.com', VIEW.returnUrl)).toBe(true);
  });
  test('not another host, scheme or port', () => {
    expect(returnUrlAllowed('https://micasatacos.com.evil.example/thanks', VIEW.returnUrl)).toBe(false);
    expect(returnUrlAllowed('http://micasatacos.com/thanks', VIEW.returnUrl)).toBe(false);
    expect(returnUrlAllowed('https://micasatacos.com:8443/thanks', VIEW.returnUrl)).toBe(false);
    expect(returnUrlAllowed('https://www.micasatacos.com/thanks', VIEW.returnUrl)).toBe(false);
    expect(returnUrlAllowed('javascript:alert(1)', VIEW.returnUrl)).toBe(false);
    expect(returnUrlAllowed('nonsense', VIEW.returnUrl)).toBe(false);
  });
  test('nothing at all without a return address, and opaque origins never match', () => {
    expect(returnUrlAllowed('https://micasatacos.com', null)).toBe(false);
    expect(returnUrlAllowed('micasa://done', 'micasa://done')).toBe(false);
  });
  test('hands back only when allowed', () => {
    const went: string[] = [];
    expect(handBack('https://evil.example', VIEW, (u) => went.push(u))).toBe(false);
    expect(handBack('https://micasatacos.com/thanks', VIEW, (u) => went.push(u))).toBe(true);
    expect(went).toEqual(['https://micasatacos.com/thanks']);
  });
  test('and nothing redirects to it', () => {
    for (const source of [ROUTE, PAGE, SCREEN]) {
      expect(source).not.toContain('location.assign');
      expect(source).not.toContain('location.href =');
      expect(source).not.toContain('handBack(');
    }
  });
});

describe('done: the window closes itself, or says where to go', () => {
  const timers = () => {
    const queue: (() => void)[] = [];
    return { later: (fn: () => void) => void queue.push(fn), run: () => queue.splice(0).forEach((f) => f()) };
  };

  test('closed: no fallback', () => {
    const t = timers();
    const win = { closed: false, close() { this.closed = true; } };
    let fell = false;
    closeOrFallback(win, () => (fell = true), 300, t.later);
    t.run();
    expect(fell).toBe(false);
  });

  test('the browser refused: the fallback', () => {
    const t = timers();
    const win = { closed: false, close() {} };
    let fell = false;
    closeOrFallback(win, () => (fell = true), 300, t.later);
    expect(fell).toBe(false); // not before the beat
    t.run();
    expect(fell).toBe(true);
  });

  test('a close that throws counts as refused', () => {
    const t = timers();
    const win = { closed: false, close() { throw new Error('nope'); } };
    let fell = false;
    closeOrFallback(win, () => (fell = true), 300, t.later);
    t.run();
    expect(fell).toBe(true);
  });

  test('only on the approval page, once it’s paid or approved', () => {
    expect(ROUTE).toContain("const finished = Boolean(charge && charge.status === 'approved');");
    expect(ROUTE).toContain('if (!approval || !finished) return;');
    expect(ROUTE).toContain('doneLine={stillOpen ? doneLine(host) : null}');
  });
});

describe('reading the payment', () => {
  const answer = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

  test('no credentials, nothing cached', async () => {
    let init: RequestInit | undefined;
    let url = '';
    const f = (async (u: string, i?: RequestInit) => {
      url = u;
      init = i;
      return new Response(JSON.stringify(VIEW), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await readApproval('ps 1', 'https://api.example', f);
    expect(r).toEqual({ kind: 'ok', view: VIEW });
    expect(url).toBe('https://api.example/api/checkout/approval/ps%201');
    expect(init).toEqual({ cache: 'no-store', credentials: 'omit' });
  });

  test('ended, paid, and anything else', async () => {
    expect(await readApproval('x', '', answer(404, { error: 'not_found', message: 'No' }))).toEqual({ kind: 'gone' });
    expect(await readApproval('x', '', answer(409, { error: 'paid', message: 'Paid' }))).toEqual({ kind: 'paid' });
    expect(await readApproval('x', '', answer(500, {}))).toEqual({ kind: 'error' });
    expect(await readApproval('x', '', answer(200, { nope: true }))).toEqual({ kind: 'error' });
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await readApproval('x', '', offline)).toEqual({ kind: 'error' });
  });
});

describe('the route', () => {
  test('/approve/:id sits outside the shell, with the profile it waits on', () => {
    const at = APP.indexOf('path="/approve/:id"');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(APP.indexOf('<ProtectedRoute>'));
    expect(APP.slice(at, at + 200)).toContain('<MemberProfileProvider>');
  });

  test('it runs the charge approval on the payment’s code, not a copy of it', () => {
    expect(PAGE).toContain('<ChargeApprovalRoute approval={read.view} />');
    expect(ROUTE).toContain('const code = approval?.chargeCode ?? params.code ??');
  });

  test('signing in comes back here, as it does for /c/:code', () => {
    expect(ROUTE).toContain("navigate('/login', { state: { from: location }, replace: true });");
  });

  test('no Clear account: a member still onboarding, and nobody else', () => {
    expect(hasNoClearAccount('ONBOARDING')).toBe(true);
    for (const s of ['BASIC_ACTIVE', 'VERIFIED', 'RESTRICTED', null]) expect(hasNoClearAccount(s)).toBe(false);
  });

  test('no Clear account: told so before the charge is opened (opening claims it)', () => {
    const noAccount = ROUTE.indexOf('if (approval && hasNoClearAccount(memberStatus))');
    expect(noAccount).toBeGreaterThan(-1);
    expect(noAccount).toBeLessThan(ROUTE.indexOf('void getCharge(code)'));
  });
});
