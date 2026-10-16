import { describe, expect, test } from 'bun:test';
import { withLayout } from './modal';

describe('the page tells the frame its layout', () => {
  test('in the fragment, so nothing reaches a server and nothing reloads', () => {
    expect(withLayout('https://pay.useclear.org/m/ms_1', true)).toBe('https://pay.useclear.org/m/ms_1#layout=modal');
    expect(withLayout('https://pay.useclear.org/m/ms_1', false)).toBe('https://pay.useclear.org/m/ms_1#layout=sheet');
  });
  test('replacing, never stacking, the fragment', () => {
    expect(withLayout('https://pay.useclear.org/m/ms_1#layout=modal', false)).toBe('https://pay.useclear.org/m/ms_1#layout=sheet');
  });
});
