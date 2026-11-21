import { api } from './api';
import type { BookingPayment, Payment } from './api/types';

export const paymentSuccessPath = '/payment/success';
export const myBookingsPath = '/my-bookings';
const storageKey = 'tviy-hub-checkout';

interface Checkout {
  paymentIds: number[];
  userId: number;
  sessionUrl: string;
  sessionId?: string;
  mode?: 'batch' | 'single';
}

function validPaymentId(id: unknown): id is number {
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
}

export function getPaymentId(payment: BookingPayment): number | null {
  if (validPaymentId(payment.paymentId)) return payment.paymentId;
  return validPaymentId(payment.payment?.id) ? payment.payment.id : null;
}

function stripeUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === 'https://checkout.stripe.com' && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export function pendingCheckout(): Checkout | null {
  try {
    const checkout: (Checkout & { paymentId?: number }) | null = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
    if (!checkout || !stripeUrl(checkout.sessionUrl)) return null;
    const paymentIds = checkout.paymentIds ?? [checkout.paymentId];
    return Array.isArray(paymentIds) && paymentIds.length && paymentIds.every(validPaymentId)
      ? { ...checkout, paymentIds }
      : null;
  } catch {
    return null;
  }
}

export function forgetCheckout() {
  sessionStorage.removeItem(storageKey);
}

export function checkoutMatchesSession(checkout: Checkout, sessionId: string): boolean {
  return checkout.sessionId ? checkout.sessionId === sessionId : /^cs_[A-Za-z0-9_]{1,240}$/.test(sessionId);
}

export function checkoutIsPaid(paymentIds: number[], response: Payment | Payment[] | { payments: Payment[] }): boolean {
  const payments = Array.isArray(response) ? response : response && typeof response === 'object' && 'payments' in response ? response.payments : [response];
  return Array.isArray(payments) && paymentIds.every(id => payments.some(payment => payment?.id === id && payment.status === 'PAID'));
}

export async function startCheckout(ids: number[], userId: number, mode: 'batch' | 'single' = 'batch'): Promise<string> {
  const paymentIds = [...new Set(ids)].sort((a, b) => a - b);
  if (!paymentIds.length || !paymentIds.every(validPaymentId) || (mode === 'single' && paymentIds.length !== 1)) {
    throw new Error('Missing payment ID');
  }

  const existing = pendingCheckout();
  if (existing?.userId === userId && existing.paymentIds.length === paymentIds.length &&
      existing.paymentIds.every((id, index) => id === paymentIds[index])) return existing.sessionUrl;

  const successUrl = new URL(paymentSuccessPath, location.origin).href;
  const cancelUrl = new URL(myBookingsPath, location.origin).href;
  const session = mode === 'single'
    ? await api.stripeSession(paymentIds[0], successUrl, cancelUrl).then(data => ({ url: data?.sessionUrl, sessionId: data?.sessionId }))
    : await api.stripeBatchSession(paymentIds, successUrl, cancelUrl);
  const sessionUrl = stripeUrl(session?.url);
  if (!sessionUrl) throw new Error('Invalid checkout response');
  const sessionId = session?.sessionId || sessionUrl.pathname.split('/').find(segment => /^cs_[A-Za-z0-9_]+$/.test(segment));

  sessionStorage.setItem(storageKey, JSON.stringify({ sessionId, sessionUrl: sessionUrl.href, paymentIds, userId, mode }));
  return sessionUrl.href;
}
