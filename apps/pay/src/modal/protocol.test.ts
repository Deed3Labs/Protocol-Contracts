import { describe, expect, test } from 'bun:test';
import { framedBy, post, PROTOCOL } from './protocol';

const SITE = 'https://micasatacos.com';
const target = () => {
  const sent: { data: unknown; origin: string }[] = [];
  return { sent, win: { postMessage: (data: unknown, origin: string) => sent.push({ data, origin }) } as unknown as Window };
};

describe('the frame posts only to the session’s website', () => {
  test('to that exact origin, never *', () => {
    const t = target();
    post(SITE, { type: 'ready' }, t.win);
    expect(t.sent).toEqual([{ data: { protocol: PROTOCOL, type: 'ready' }, origin: SITE }]);
  });

  test('nowhere without a website, or when not framed', () => {
    const t = target();
    post(null, { type: 'cancel' }, t.win);
    post(SITE, { type: 'cancel' }, null);
    expect(t.sent).toEqual([]);
  });

  test('success carries the id, status and reference, and nothing else', () => {
    const t = target();
    post(SITE, { type: 'success', id: 'pay_1', status: 'succeeded', reference: 'ORDER-1042' }, t.win);
    expect(Object.keys(t.sent[0]!.data as object).sort()).toEqual(['id', 'protocol', 'reference', 'status', 'type']);
  });
});

describe('who frames it', () => {
  test('the session’s website passes; another site doesn’t', () => {
    expect(framedBy(SITE, [SITE])).toBe(true);
    expect(framedBy(SITE, ['https://evil.example'])).toBe(false);
    expect(framedBy(SITE, ['https://micasatacos.com.evil.example'])).toBe(false);
  });
  test('no website: never', () => {
    expect(framedBy(null, [SITE])).toBe(false);
  });
  test('browsers without ancestorOrigins leave it to frame-ancestors', () => {
    expect(framedBy(SITE, undefined)).toBe(true);
  });
});
