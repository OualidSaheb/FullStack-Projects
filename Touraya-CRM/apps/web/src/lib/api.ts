export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | string[] | null | undefined>;

export function toSearch(query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    params.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('auth:expired'));
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? `HTTP ${res.status}`, (data as { details?: unknown })?.details);
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path + toSearch(query)),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

/** Triggers a browser download of an API file (keeps the session cookie). */
export function download(path: string) {
  const a = document.createElement('a');
  a.href = `/api${path}`;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
}
