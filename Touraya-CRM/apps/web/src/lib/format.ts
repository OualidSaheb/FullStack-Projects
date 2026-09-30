const dateTime = new Intl.DateTimeFormat('ar-DZ-u-nu-latn', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Algiers' });
const dateOnly = new Intl.DateTimeFormat('ar-DZ-u-nu-latn', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Algiers' });
const number = new Intl.NumberFormat('fr-DZ');

export const fmtDateTime = (iso: string | null | undefined) => (iso ? dateTime.format(new Date(iso)) : '—');
export const fmtDate = (iso: string | null | undefined) => (iso ? dateOnly.format(new Date(iso)) : '—');
export const fmtNumber = (n: number) => number.format(n);
export const fmtDA = (n: number) => `${number.format(n)} دج`;

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'الآن';
  if (s < 3600) return `منذ ${Math.floor(s / 60)} د`;
  if (s < 86400) return `منذ ${Math.floor(s / 3600)} سا`;
  if (s < 86400 * 7) return `منذ ${Math.floor(s / 86400)} يوم`;
  return fmtDate(iso);
}

/** Today in Algeria, YYYY-MM-DD. */
export function todayDZ(offsetDays = 0): string {
  const d = new Date(Date.now() + 3600_000 + offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
}

/** 0556… → +213556… for WhatsApp links. */
export const intlPhone = (phone: string) => `213${phone.replace(/^0/, '')}`;
