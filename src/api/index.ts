import { request, storeTokens } from './client';
import type { AdminUser, Availability, Booking, BookingRequest, HistoryItem, Page, Payment, Subscription, Tariff, Tokens, User, Workspace } from './types';
const json = (method: string, data?: unknown): RequestInit => ({ method, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
export const api = {
  workspaces: () => request<Workspace[]>('/workspaces'),
  tariffs: () => request<Tariff[]>('/tariffs'),
  login: async (email: string, password: string) => { const tokens = await request<Tokens>('/auth/login', json('POST', { email, password })); storeTokens(tokens); },
  register: (data: { name: string; phone: string; email: string; password: string }) => request<User>('/auth/register', json('POST', data)),
  verify: (email: string, code: string) => request<void>('/auth/verify-email', json('POST', { email, code })),
  resend: (email: string) => request<void>('/auth/resend-verification', json('POST', { email })),
  forgot: (email: string) => request<void>('/auth/forgot-password', json('POST', { email })),
  reset: (email: string, code: string, newPassword: string) => request<void>('/auth/reset-password', json('POST', { email, code, newPassword })),
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
  history: (page = 0, scope = 'all') => request<Page<HistoryItem>>(`/users/me/bookings?page=${page}&size=10&scope=${scope}`, {}, true),
  subscriptions: () => request<Subscription[]>('/subscriptions/my', {}, true),
  subscribe: (workspaceId: number, startDate: string) => request<Subscription>('/subscriptions', json('POST', { workspaceId, startDate }), true),
  adminBookings: () => request<Booking[]>('/bookings', {}, true),
  adminUsers: (page = 0, search = '') => request<Page<AdminUser>>(`/admin/users?page=${page}&size=10&search=${encodeURIComponent(search)}`, {}, true),
  adminUser: (id: number) => request<AdminUser>(`/admin/users/${id}`, {}, true),
  block: (id: number, blocked: boolean) => request<AdminUser>(`/admin/users/${id}/${blocked ? 'unblock' : 'block'}`, json('POST'), true),
  adminPayments: () => request<Payment[]>('/admin/payments', {}, true),
  updatePayment: (id: number) => request<Payment>(`/admin/payments/${id}/status`, json('PUT', { status: 'PAID', paymentMethod: 'CASH' }), true),
};
