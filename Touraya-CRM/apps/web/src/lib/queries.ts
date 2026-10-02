import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  BulkAction,
  CarrierDTO,
  CarrierRateDTO,
  CommentDTO,
  OfferDTO,
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
  ReturnReceive,
  Role,
  Settings,
  SourceDTO,
  StatsDTO,
  StatusChange,
  StatusCounts,
  StockMovementDTO,
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

export type SourceWithStats = SourceDTO;

/** Central query keys: invalidating ['orders'] refreshes lists, counts and details together. */
export const qk = {
  me: ['me'] as const,
  orders: ['orders'] as const,
  orderList: (q: Partial<OrderListQuery>) => ['orders', 'list', q] as const,
  orderCounts: (f: OrderFilter) => ['orders', 'counts', f] as const,
  order: (id: string) => ['orders', 'detail', id] as const,
  timeline: (id: string) => ['orders', 'timeline', id] as const,
  products: ['products'] as const,
  offers: ['offers'] as const,
  carriers: ['carriers'] as const,
  rates: (carrierId: number) => ['carriers', carrierId, 'rates'] as const,
  movements: ['movements'] as const,
  customer: (id: number) => ['customer', id] as const,
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

export const useProducts = () => useQuery({ queryKey: qk.products, queryFn: () => api.get<ProductDTO[]>('/products'), staleTime: 30_000 });
export const useOffers = () => useQuery({ queryKey: qk.offers, queryFn: () => api.get<OfferDTO[]>('/offers'), staleTime: 60_000 });
export const useCarriers = () => useQuery({ queryKey: qk.carriers, queryFn: () => api.get<CarrierDTO[]>('/carriers'), staleTime: 60_000 });
export const useRates = (carrierId: number | undefined) =>
  useQuery({ queryKey: qk.rates(carrierId ?? 0), queryFn: () => api.get<CarrierRateDTO[]>(`/carriers/${carrierId}/rates`), enabled: Boolean(carrierId) });
export const useMovements = () => useQuery({ queryKey: qk.movements, queryFn: () => api.get<StockMovementDTO[]>('/inventory/movements') });
export const useUsers = () => useQuery({ queryKey: qk.users, queryFn: () => api.get<UserDTO[]>('/users'), staleTime: 60_000 });
export const useSources = () => useQuery({ queryKey: qk.sources, queryFn: () => api.get<SourceWithStats[]>('/sources') });
export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: () => api.get<Settings>('/settings'), staleTime: 60_000 });
export const useBatches = () => useQuery({ queryKey: qk.batches, queryFn: () => api.get<ExportBatchDTO[]>('/shipping/exports') });
export const useStats = (f: OrderFilter) => useQuery({ queryKey: qk.stats(f), queryFn: () => api.get<StatsDTO>('/stats', f as never), placeholderData: keepPreviousData });

/** Mutations that touch orders refresh every order view (list, counts, detail, timeline). */
function useOrderMutation<V, R>(fn: (v: V) => Promise<R>, success?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.orders });
      qc.invalidateQueries({ queryKey: qk.products });
      qc.invalidateQueries({ queryKey: ['stats'] });
      if (success) toast.success(success);
    },
    onError,
  });
}

export const useChangeStatus = (id: string) => useOrderMutation((v: StatusChange) => api.post<OrderDetail>(`/orders/${id}/status`, v));
export const useUpdateOrder = (id: string) => useOrderMutation((v: OrderUpdate) => api.patch<OrderDetail>(`/orders/${id}`, v), 'تم حفظ التعديلات');
/** Inline edits save on change, without a toast each time (errors still show). */
export const useInlineUpdate = (id: string) => useOrderMutation((v: OrderUpdate) => api.patch<OrderDetail>(`/orders/${id}`, v));
export const useRedraft = (id: string) => useOrderMutation(() => api.post<OrderDetail>(`/orders/${id}/redraft`), 'تمت تعبئة القطع');
export const useReorder = (id: string) => useOrderMutation((status: 'new' | 'confirmed') => api.post<OrderDetail>(`/orders/${id}/reorder`, { status }), 'تم إنشاء طلبية جديدة');
export const useAddProductOptions = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, ...v }: { productId: number; sizes?: string[]; colors?: string[] }) => api.post<ProductDTO[]>(`/products/${productId}/options`, v),
    onSuccess: (products) => qc.setQueryData(qk.products, products),
    onError,
  });
};
export const useAddComment = (id: string) => useOrderMutation((body: string) => api.post(`/orders/${id}/comments`, { body }));
export const useBulkAction = () => useOrderMutation((v: BulkAction) => api.post<{ affected: number }>('/orders/bulk', v));
export const useReceiveReturn = (id: string) => useOrderMutation((v: ReturnReceive) => api.post<OrderDetail>(`/orders/${id}/return-received`, v), 'تم تسجيل المرتجع');
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
