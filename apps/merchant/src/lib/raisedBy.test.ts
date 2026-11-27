import { describe, expect, test } from 'bun:test';
import { raisedByName } from './raisedBy';

describe('who raised an order', () => {
  const nameOf = (id: string) => (id === 'stf_ana' ? 'Ana R.' : '—');
  test('a website or link order reads Online', () => {
    expect(raisedByName(null, nameOf)).toBe('Online');
  });
  test('anyone else is their name', () => {
    expect(raisedByName('stf_ana', nameOf)).toBe('Ana R.');
  });
});
