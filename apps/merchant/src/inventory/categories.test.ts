import { describe, expect, test } from 'bun:test';
import { categoriesOf } from './model';

describe('the shop’s categories', () => {
  test('the reference’s four first in their order, then the shop’s own A to Z, each once', () => {
    expect(categoriesOf([{ category: 'Parts' }, { category: 'Hair care' }, { category: 'Tires' }, { category: 'Bags' }, { category: 'Parts' }])).toEqual(['Tires', 'Parts', 'Bags', 'Hair care']);
    expect(categoriesOf([{ category: 'Hair care' }])).toEqual(['Hair care']);
    expect(categoriesOf([])).toEqual([]);
  });
});
