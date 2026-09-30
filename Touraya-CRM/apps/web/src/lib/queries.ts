import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  BulkAction,
  CommentDTO,
  ExportBatchDTO,
  OrderDetail,
  OrderEventDTO,
  OrderFilter,
  OrderListItem,
  OrderListQuery,
  OrderUpdate,
  Paginated,
  Permission,
  ProductDTO,
  Role,
  Settings,
  SourceDTO,
  StatsDTO,
  StatusChange,
  StatusCounts,
  UserDTO,
} from '@touraya/shared';
import { api, ApiError } from './api';

export interface Me {
  id: number;
  name: string;
  email: string;
  role: Role;
  permissions: Permission[];
}

export type PublicSettings = Settings & { yalidine: Settings['yalidine'] & { hasApiToken: boolean } };
export type SourceWithStats = SourceDTO & {
  lastSyncStats: { at: string; received: number; created: number; duplicates: number; skipped: number; errors: { row: number; sheet: string; message: string }[] } | null;
};

/** Central query keys: invalidating ['orders'] refreshes lists, counts and details together. */
export const qk = {
  me: ['me'] as const,
  orders: ['orders'] as const,
  orderList: (q: Partial<OrderListQuery>) => ['orders', 'list', q] as const,
  orderCounts: (f: OrderFilter) => ['orders', 'counts', f] as const,
  order: (id: string) => ['orders', 'detail', id] as const,
  timeline: (id: string) => ['orders', 'timeline', id] as const,
  products: ['products'] as const,
  users: ['users'] as const,
  sources: ['sources'] as const,
  settings: ['settings'] as const,
  batches: ['batches'] as const,
  stats: (f: OrderFilter) => ['stats', f] as const,
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'حدث خطأ');
const onError = (e: unknown) => toast.error(errorMessage(e));

export const useMe = () =>
  useQuery({
    queryKey: qk.me,
    queryFn: () => api.get<Me>('/auth/me'),
    retry: (count, e) => !(e instanceof ApiError && e.status === 401) && count < 2,
    staleTime: 5 * 60_000,
  });

export const useOrders = (q: Partial<OrderListQuery>) =>
  useQuery({ queryKey: qk.orderList(q), queryFn: () => api.get<Paginated<OrderListItem>>('/orders', q as never), placeholderData: keepPreviousData, refetchInterval: 60_000 });

export const useOrderCounts = (f: OrderFilter) =>
  useQuery({ queryKey: qk.orderCounts(f), queryFn: () => api.get<StatusCounts>('/orders/counts', f as never), placeholderData: keepPreviousData, refetchInterval: 60_000 });

export const useOrder = (id: string | null) =>
  useQuery({ queryKey: qk.order(id ?? ''), queryFn: () => api.get<OrderDetail>(`/orders/${id}`), enabled: Boolean(id) });

export const useTimeline = (id: string | null) =>
  useQuery({
    queryKey: qk.timeline(id ?? ''),
    queryFn: () => api.get<{ comments: CommentDTO[]; events: OrderEventDTO[] }>(`/orders/${id}/timeline`),
    enabled: Boolean(id),
  });

export const useProducts = () => useQuery({ queryKey: qk.products, queryFn: () => api.get<ProductDTO[]>('/products'), staleTime: 60_000 });
export const useUsers = () => useQuery({ queryKey: qk.users, queryFn: () => api.get<UserDTO[]>('/users'), staleTime: 60_000 });
export const useSources = () => useQuery({ queryKey: qk.sources, queryFn: () => api.get<SourceWithStats[]>('/sources') });
export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: () => api.get<PublicSettings>('/settings'), staleTime: 60_000 });
export const useBatches = () => useQuery({ queryKey: qk.batches, queryFn: () => api.get<ExportBatchDTO[]>('/shipping/exports') });
export const useStats = (f: OrderFilter) => useQuery({ queryKey: qk.stats(f), queryFn: () => api.get<StatsDTO>('/stats', f as never), placeholderData: keepPreviousData });

/** Mutations that touch orders refresh every order view (list, counts, detail, timeline). */
function useOrderMutation<V, R>(fn: (v: V) => Promise<R>, success?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.orders });
      qc.invalidateQueries({ queryKey: ['stats'] });
      if (success) toast.success(success);
    },
    onError,
  });
}

export const useChangeStatus = (id: string) => useOrderMutation((v: StatusChange) => api.post<OrderDetail>(`/orders/${id}/status`, v));
export const useUpdateOrder = (id: string) => useOrderMutation((v: OrderUpdate) => api.patch<OrderDetail>(`/orders/${id}`, v), 'تم حفظ التعديلات');
export const useAddComment = (id: string) => useOrderMutation((body: string) => api.post(`/orders/${id}/comments`, { body }));
export const useBulkAction = () => useOrderMutation((v: BulkAction) => api.post<{ affected: number }>('/orders/bulk', v));
export const useDeleteByFilter = () =>
  useOrderMutation((v: { filter: OrderFilter; confirmCount: number }) => api.post<{ affected: number }>('/orders/delete-by-filter', v));

/** Generic admin mutation: runs `fn`, refreshes `key`, toasts. */
export function useAdminMutation<V, R = unknown>(key: readonly unknown[], fn: (v: V) => Promise<R>, success = 'تم الحفظ') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      toast.success(success);
    },
    onError,
  });
}
