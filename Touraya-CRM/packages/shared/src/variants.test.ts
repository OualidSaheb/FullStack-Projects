import { describe, expect, it } from 'vitest';
import { draftItems, findOptions } from './variants';

const pants = { sizes: ['38', '40', '42', 'L', 'XL'], colors: ['أسود', 'رمادي', 'بني', 'أزرق', 'أزرق فاتح', 'بيج'] };

describe('variant drafting', () => {
  it('finds options in order, longest first', () => {
    expect(findOptions('أسود_رمادي_بني', pants.colors)).toEqual(['أسود', 'رمادي', 'بني']);
    expect(findOptions('ازرق فاتح و اسود', pants.colors)).toEqual(['أزرق فاتح', 'أسود']);
    expect(findOptions('أسود أسود', pants.colors)).toEqual(['أسود', 'أسود']);
  });

  it('one color per piece, single size for all', () => {
    expect(draftItems(3, { size: 'L', colors: 'أسود_رمادي_بني' }, pants)).toEqual([
      { size: 'L', color: 'أسود' },
      { size: 'L', color: 'رمادي' },
      { size: 'L', color: 'بني' },
    ]);
  });

  it('leaves unknown pieces empty for the agent', () => {
    expect(draftItems(2, { size: '40', colors: 'أحمر' }, pants)).toEqual([
      { size: '40', color: null },
      { size: '40', color: null },
    ]);
  });

  it('products without options get null variants', () => {
    expect(draftItems(1, { size: 'L', colors: 'أبيض' }, { sizes: [], colors: [] })).toEqual([{ size: null, color: null }]);
  });
});
