import { describe, expect, test } from 'bun:test';
import { attrs, css } from './dom';

describe('attrs: attribute strings the prototype wrote into tags', () => {
  test('empty, false and null give no props', () => {
    expect(attrs('')).toEqual({});
    expect(attrs(false)).toEqual({});
    expect(attrs(null)).toEqual({});
  });
  test('quoted, bare and boolean attributes', () => {
    expect(attrs('aria-current="page"')).toEqual({ 'aria-current': 'page' });
    expect(attrs(' data-state="warn" data-close')).toEqual({ 'data-state': 'warn', 'data-close': '' });
    expect(attrs(' disabled')).toEqual({ disabled: true });
    expect(attrs("title='Two words' tabindex=0")).toEqual({ title: 'Two words', tabIndex: '0' });
  });
  test('class and style become React props', () => {
    expect(attrs('class="a b" style="color:var(--fg);--r:12"')).toEqual({ className: 'a b', style: { color: 'var(--fg)', '--r': '12' } });
  });
});

describe('css: inline style strings', () => {
  test('properties are camel-cased and custom properties keep their names', () => {
    expect(css('font-weight:600; margin:8px 0 0;--c:color-mix(in srgb,var(--fg) 35%,transparent)')).toEqual({
      fontWeight: '600',
      margin: '8px 0 0',
      '--c': 'color-mix(in srgb,var(--fg) 35%,transparent)',
    });
  });
  test('vendor prefixes and empty declarations', () => {
    expect(css('-webkit-mask:none;;width:')).toEqual({ WebkitMask: 'none' });
  });
});
