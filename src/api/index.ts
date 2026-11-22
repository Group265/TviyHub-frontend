import { request, storeTokens } from './client';
import type { AdminUser, Availability, Booking, BookingRequest, HistoryItem, InPersonPaymentMethod, Page, Payment, StripeBatchSession, StripeSession, Subscription, Tariff, Tokens, User, Workspace } from './types';
export const HISTORY_PAGE_SIZE = 10;
const UPCOMING_BATCH_SIZE = 100;

const json = (method: string, data?: unknown): RequestInit => ({ method, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
export const api = {
  workspaces: () => request<Workspace[]>('/workspaces'),
  tariffs: () => request<Tariff[]>('/tariffs'),
  login: async (email: string, password: string) => { const tokens = await request<Tokens>('/auth/login', json('POST', { email, password })); storeTokens(tokens); },
  register: (data: { name: string; phone: string; email: string; password: string; confirmPassword: string }) => request<{ email: string; codeExpiresInSeconds: number }>('/auth/register', json('POST', data)),
  async verify(email: string, code: string) {
    const tokens = await request<Tokens>('/auth/verify-email', json('POST', { email, code }));
    storeTokens(tokens);
  },
  resend: (email: string) => request<void>('/auth/resend-verification', json('POST', { email })),
  forgot: (email: string) => request<void>('/auth/forgot-password', json('POST', { email })),
  reset: (email: string, code: string, newPassword: string, confirmNewPassword: string) => request<void>('/auth/reset-password', json('POST', { email, code, newPassword, confirmNewPassword })),
  me: () => request<User>('/users/me', {}, true),
  updateName: (name: string) => request<User>('/users/me', json('PATCH', { name }), true),
  requestChange: (kind: 'email' | 'phone' | 'password', data: unknown) => request<void>(`/users/me/${kind}/request`, json('POST', data), true),
  confirmChange: (kind: 'email' | 'phone' | 'password', code: string) => request<User | void>(`/users/me/${kind}/confirm`, json('POST', { code }), true),
  availability: (date: string, startTime?: string, endTime?: string, signal?: AbortSignal) => {
    const query = new URLSearchParams({ date });
    if (startTime) query.set('startTime', startTime);
    if (endTime) query.set('endTime', endTime);
    return request<Availability[]>(`/bookings/availability?${query}`, { signal }, true);
  },
  price: (data: BookingRequest, signal?: AbortSignal) => request<number>('/bookings/calculate-price', { ...json('POST', data), signal }, true),
  book: (data: BookingRequest) => request<Booking[]>('/bookings', json('POST', data), true),
  cancel: (id: number) => request<Booking>(`/bookings/${id}/cancel`, json('PATCH'), true),
  history: (page = 0, scope = 'all', signal?: AbortSignal) =>
    request<Page<HistoryItem>>(`/users/me/bookings?page=${page}&size=${HISTORY_PAGE_SIZE}&scope=${scope}`, { signal }, true),
  async upcomingHistory(signal?: AbortSignal): Promise<HistoryItem[]> {
    // The backend filters by date. Load the candidates before filtering status and paginating.
    const load = (page: number) => request<Page<HistoryItem>>(
      `/users/me/bookings?page=${page}&size=${UPCOMING_BATCH_SIZE}&scope=upcoming`, { signal }, true,
    );
    const first = await load(0);
    const items = [...first.content];
    for (let page = 1, totalPages = first.totalPages; page < totalPages; page++) {
      const result = await load(page);
      items.push(...result.content);
      totalPages = Math.min(totalPages, result.totalPages);
    }
    return items;
  },
  subscriptions: () => request<Subscription[]>('/subscriptions/my', {}, true),
  subscribe: (workspaceId: number, startDate: string) => request<Subscription>('/subscriptions', json('POST', { workspaceId, startDate }), true),
  stripeSession: (paymentId: number, successUrl: string, cancelUrl: string) => {
    const query = new URLSearchParams({ successUrl, cancelUrl });
    return request<StripeSession>(`/payments/${paymentId}/stripe-session?${query}`, json('POST'), true);
  },
  stripeBatchSession: (paymentIds: number[], successUrl: string, cancelUrl: string) =>
    request<StripeBatchSession>('/payments/stripe-session/batch', json('POST', { paymentIds, successUrl, cancelUrl }), true),
  verifyStripePayment: (sessionId: string, signal?: AbortSignal) =>
    request<Payment | Payment[] | { payments: Payment[] }>(`/payments/success?${new URLSearchParams({ session_id: sessionId })}`, { signal }, true),
  bookings: (signal?: AbortSignal, userId?: number) =>
    request<Booking[]>(userId === undefined ? '/bookings' : `/bookings?userId=${userId}`, { signal }, true),
  adminSubscriptions: (signal?: AbortSignal) => request<Subscription[]>('/admin/subscriptions', { signal }, true),
  adminUsers: (page = 0, search = '', order: 'recent' | 'name' | 'id' = 'recent', signal?: AbortSignal, size = 10) => {
    const sortBy = order === 'recent' ? 'createdAt' : order;
    const query = new URLSearchParams({ page: String(page), size: String(size), search, sortBy, direction: order === 'recent' ? 'desc' : 'asc' });
    return request<Page<AdminUser>>(`/admin/users?${query}`, { signal }, true);
  },
  async adminClients(ids: number[], signal: AbortSignal) {
    const remaining = new Set(ids);
    const clients: AdminUser[] = [];
    for (let page = 0, totalPages = 1; page < totalPages && remaining.size; page++) {
      const result = await api.adminUsers(page, '', 'id', signal, 100);
      clients.push(...result.content.filter(user => remaining.delete(user.id)));
      totalPages = result.totalPages;
    }
    return clients;
  },
  setUserBlocked: (id: number, blocked: boolean) => request<AdminUser>(`/admin/users/${id}/${blocked ? 'block' : 'unblock'}`, json('POST'), true),
  adminPayments: (signal?: AbortSignal) => request<Payment[]>('/admin/payments', { signal }, true),
  updatePayment: (id: number, paymentMethod: InPersonPaymentMethod) =>
    request<Payment>(`/admin/payments/${id}/status`, json('PUT', { status: 'PAID', paymentMethod }), true),
};
