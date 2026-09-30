import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { orderListQuerySchema, type OrderListQuery } from '@touraya/shared';

const FILTER_KEYS = ['q', 'status', 'productId', 'sourceId', 'wilayaCode', 'assignedTo', 'phoneIssue', 'from', 'to', 'sort', 'dir', 'page', 'pageSize'] as const;

/** Orders table state lives in the URL: shareable, survives refresh, back button works. */
export function useOrderFilters(trash = false) {
  const [params, setParams] = useSearchParams();

  const query: OrderListQuery = useMemo(() => {
    const raw = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? undefined]));
    const parsed = orderListQuerySchema.safeParse({ ...raw, deleted: trash ? 'true' : undefined });
    return parsed.success ? parsed.data : orderListQuerySchema.parse({ deleted: trash ? 'true' : undefined });
  }, [params, trash]);

  const set = (patch: Partial<Record<(typeof FILTER_KEYS)[number], string | number | boolean | string[] | undefined | null>>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          const value = Array.isArray(v) ? v.join(',') : v;
          if (value === undefined || value === null || value === '' || value === false) next.delete(k);
          else next.set(k, String(value));
        }
        if (!('page' in patch)) next.delete('page');
        return next;
      },
      { replace: true },
    );

  const openOrderId = params.get('order');
  const openOrder = (id: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('order', id);
      else next.delete('order');
      return next;
    });

  const { page: _p, pageSize: _ps, sort: _s, dir: _d, ...filter } = query;
  const activeFilterCount = ['productId', 'sourceId', 'wilayaCode', 'assignedTo', 'phoneIssue', 'from', 'to'].filter((k) => params.get(k)).length;

  return { query, filter, set, clear: () => setParams({}, { replace: true }), openOrderId, openOrder, activeFilterCount };
}
