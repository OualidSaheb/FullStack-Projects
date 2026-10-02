/**
 * Call scheduling: when should the next attempt happen? Retries never land
 * outside working hours (nobody is called at night). The same policy will
 * drive the automatic AI caller later.
 */
export interface CallPolicy {
  /** Local working window, "HH:MM" (Algeria, UTC+1). */
  workStart: string;
  workEnd: string;
  /** Working days, 0 = Sunday … 6 = Saturday. Friday off by default. */
  workDays: number[];
  /** Delay before attempt N+1 after "no answer" N (minutes). Last value repeats. */
  retryDelays: number[];
  maxAttempts: number;
  /** Cancel automatically after the last unanswered attempt. */
  autoCancelAfterMax: boolean;
}

export const DEFAULT_CALL_POLICY: CallPolicy = {
  workStart: '09:00',
  workEnd: '21:00',
  workDays: [0, 1, 2, 3, 4, 6],
  retryDelays: [60, 180, 24 * 60, 24 * 60],
  maxAttempts: 4,
  autoCancelAfterMax: false,
};

const OFFSET_MS = 60 * 60 * 1000; // Africa/Algiers, no DST

const minutesOf = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Local (Algeria) wall clock of a UTC instant, as a Date whose UTC fields are local time. */
const toLocal = (d: Date) => new Date(d.getTime() + OFFSET_MS);
const fromLocal = (d: Date) => new Date(d.getTime() - OFFSET_MS);

export function isWorkingTime(at: Date, policy: CallPolicy): boolean {
  const local = toLocal(at);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  return policy.workDays.includes(local.getUTCDay()) && minutes >= minutesOf(policy.workStart) && minutes < minutesOf(policy.workEnd);
}

/** First working moment at or after `at`. */
export function nextWorkingTime(at: Date, policy: CallPolicy): Date {
  if (!policy.workDays.length) return at;
  const start = minutesOf(policy.workStart);
  const end = minutesOf(policy.workEnd);
  const local = toLocal(at);
  for (let day = 0; day < 8; day++) {
    const candidate = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + day));
    if (!policy.workDays.includes(candidate.getUTCDay())) continue;
    const minutes = day === 0 ? local.getUTCHours() * 60 + local.getUTCMinutes() : 0;
    if (minutes >= end) continue;
    if (day === 0 && minutes >= start) return at;
    candidate.setUTCMinutes(start);
    return fromLocal(candidate);
  }
  return at;
}

/** When to call again after `attempt` unanswered calls (1-based). */
export function nextCallAt(now: Date, attempt: number, policy: CallPolicy): Date {
  const delays = policy.retryDelays.length ? policy.retryDelays : [60];
  const delay = delays[Math.min(attempt - 1, delays.length - 1)]!;
  return nextWorkingTime(new Date(now.getTime() + delay * 60_000), policy);
}

/** Quick "call me later" presets shown to the agent. */
export function postponePresets(now: Date, policy: CallPolicy) {
  const local = toLocal(now);
  const at = (dayOffset: number, hhmm: string) => {
    const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset));
    d.setUTCMinutes(minutesOf(hhmm));
    return nextWorkingTime(fromLocal(d), policy);
  };
  return [
    { key: '1h', label: 'بعد ساعة', at: nextWorkingTime(new Date(now.getTime() + 3600_000), policy) },
    { key: '3h', label: 'بعد 3 ساعات', at: nextWorkingTime(new Date(now.getTime() + 3 * 3600_000), policy) },
    { key: 'evening', label: 'هذا المساء', at: at(0, '18:00') },
    { key: 'tomorrow', label: 'غداً صباحاً', at: at(1, '10:00') },
  ].filter((p) => p.at.getTime() > now.getTime());
}
