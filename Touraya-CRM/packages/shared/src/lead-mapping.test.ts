import { describe, expect, it } from 'vitest';
import { formIdentity, parseLeadRow, resolveHeaders } from './lead-mapping';

const newFormRow = {
  id: 'l:1234567890123',
  created_time: '2026-09-28T10:15:00+01:00',
  ad_name: 'pants 3',
  form_name: 'pants offer 3 - 4999 - DZ - More volume',
  platform: 'fb',
  'اختر_المقاس': 'L',
  'الألوان_المطلوبة': 'أسود_رمادي',
  'الولاية': 'الجزائر',
  'البلدية': 'باب الزوار',
  'رقمك_الخاص_للتواصل_معاك': '0556 25 17 79',
  full_name: 'Karim B',
  phone_number: 'p:+213556251779',
};

describe('lead mapping', () => {
  it('maps a new-form row with default candidates', () => {
    const { values } = parseLeadRow(newFormRow);
    expect(values.leadId).toBe('1234567890123');
    expect(values.phoneCustomer).toBe('0556 25 17 79');
    expect(values.phoneFacebook).toBe('p:+213556251779');
    expect(values.wilaya).toBe('الجزائر');
    expect(values.commune).toBe('باب الزوار');
    expect(values.size).toBe('L');
    expect(values.colors).toBe('أسود_رمادي');
    expect(values.fullName).toBe('Karim B');
    expect(values.formName).toContain('pants offer 3');
  });

  it('explicit field map wins over defaults', () => {
    const headers = resolveHeaders(['phone_number', 'my_phone'], { phoneCustomer: ['my_phone'] });
    expect(headers.phoneCustomer).toBe('my_phone');
    expect(headers.phoneFacebook).toBe('phone_number');
  });

  it('never maps one header to two fields', () => {
    const headers = resolveHeaders(['phone']);
    expect(headers.phoneFacebook).toBe('phone');
    expect(headers.phoneCustomer).toBeUndefined();
  });
});

describe('loose matching', () => {
  it('does not steal well-known Facebook columns', () => {
    const headers = resolveHeaders(['ad_name', 'form_name', 'الاسم_و_اللقب_بالكامل']);
    expect(headers.adName).toBe('ad_name');
    expect(headers.fullName).toBe('الاسم_و_اللقب_بالكامل');
  });

  it('recognises conditional questions (wilaya → commune) by their answers', () => {
    const row = {
      id: 'l:99',
      form_id: 'f:555',
      form_name: 'skirt 2pcs 3600 - B',
      adset_name: 'Alger 25-45',
      conditional_question_1: 'البليدة',
      conditional_question_2: 'بوفاريك',
      'اختر_المقاس': 'L',
      full_name: 'Sara',
      phone_number: 'p:+213661234567',
    };
    const { values, matchedHeaders, inferred } = parseLeadRow(row);
    expect(values.wilaya).toBe('البليدة');
    expect(values.commune).toBe('بوفاريك');
    expect(matchedHeaders.wilaya).toBe('conditional_question_1');
    expect(inferred).toEqual(['wilaya', 'commune']);
    expect(values.formId).toBe('555');
  });

  it('never takes "2 قطع" or Facebook columns for a wilaya', () => {
    const { values } = parseLeadRow({ id: 'l:1', adset_name: '16', campaign_name: 'Oran', conditional_question_1: '2 قطع', full_name: 'X' });
    expect(values.wilaya).toBeUndefined();
    expect(parseLeadRow({ id: 'l:2', conditional_question_1: '16 - Alger' }).values.wilaya).toBe('16 - Alger');
  });

  it('identifies the form by form_id, then name, then sheet tab', () => {
    const where = { spreadsheetId: 'SS1', spreadsheetName: 'Skirt leads', sheetName: 'Sheet1', sourceId: 3, sourceName: 'Drive' };
    expect(formIdentity({ formId: '555', formName: 'skirt' }, where).key).toBe('fb:555');
    expect(formIdentity({ formName: 'Skirt 2PCS 3600' }, where).key).toBe(formIdentity({ formName: 'skirt 2pcs 3600' }, where).key);
    expect(formIdentity({}, where)).toEqual({ key: 'sheet:SS1:Sheet1', name: 'Skirt leads / Sheet1' });
  });
});
