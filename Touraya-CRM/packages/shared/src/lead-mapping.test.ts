import { describe, expect, it } from 'vitest';
import { parseLeadRow, resolveHeaders } from './lead-mapping';

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
});
