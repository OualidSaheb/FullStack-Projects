import { describe, expect, it } from 'vitest';
import { draftItems, findOptions, splitAnswer, unknownOptions } from './variants';

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

describe('customer answers', () => {
  it('splits any separator', () => {
    expect(splitAnswer('البيج الفاتح|الاحمر العنابي|البني')).toEqual(['البيج الفاتح', 'الاحمر العنابي', 'البني']);
    expect(splitAnswer('أسود_رمادي')).toEqual(['أسود', 'رمادي']);
    expect(splitAnswer('noir, gris')).toEqual(['noir', 'gris']);
    expect(splitAnswer('54')).toEqual(['54']);
  });

  it('finds choices the product does not have yet', () => {
    expect(unknownOptions({ size: '54', colors: 'البيج الفاتح|أسود|البني' }, { sizes: ['40', '42'], colors: ['أسود', 'بني'] })).toEqual({
      sizes: ['54'],
      colors: ['البيج الفاتح'],
    });
  });

  it('finds new choices in plain space-separated answers', () => {
    const product = { sizes: ['38', '40'], colors: ['أسود', 'رمادي', 'أزرق فاتح'] };
    expect(unknownOptions({ size: '38', colors: 'أسود أحمر' }, product)).toEqual({ sizes: [], colors: ['أحمر'] });
    expect(unknownOptions({ size: '48 و 50', colors: 'أزرق فاتح و أخضر' }, product)).toEqual({ sizes: ['48', '50'], colors: ['أخضر'] });
    expect(unknownOptions({ size: '40', colors: 'أسود رمادي' }, product)).toEqual({ sizes: [], colors: [] });
  });

  it('pipe-separated colors are drafted once the product has them', () => {
    const product = { sizes: ['54'], colors: ['البيج الفاتح', 'الاحمر العنابي', 'البني'] };
    expect(draftItems(3, { size: '54', colors: 'البيج الفاتح|الاحمر العنابي|البني' }, product)).toEqual([
      { size: '54', color: 'البيج الفاتح' },
      { size: '54', color: 'الاحمر العنابي' },
      { size: '54', color: 'البني' },
    ]);
  });

  it('one question per piece (Facebook answers) → one color per piece; a single size is filled in', () => {
    const product = { sizes: ['Standard'], colors: ['الأسود (Noir)', 'البيج الفاتح (Beige clair)', 'الأخضر الزيتي (Vert olive)'] };
    expect(draftItems(2, { colors: 'الأسود_(noir) | البيج_الفاتح_(beige_clair)' }, product)).toEqual([
      { size: 'Standard', color: 'الأسود (Noir)' },
      { size: 'Standard', color: 'البيج الفاتح (Beige clair)' },
    ]);
  });
});
