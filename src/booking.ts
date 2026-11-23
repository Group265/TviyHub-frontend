import type { BookingRequest, BookingType, HistoryItem, Subscription, User, Workspace } from './api/types';

// A local date in the venue's timezone. Avoid toISOString(), which can change the day.
export function venueToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function isWeekend(date: string): boolean { const day = new Date(`${date}T12:00:00Z`).getUTCDay(); return day === 0 || day === 6; }
export function nextWorkingDay(date = venueToday()): string {
  let result = date;
  while (isWeekend(result)) { const d = new Date(`${result}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); result = d.toISOString().slice(0,10); }
  return result;
}
export const endTime = (start: string, hours: number) => `${String(Number(start.slice(0,2)) + hours).padStart(2,'0')}:00`;
export function venueTime(now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now);
}
export const bookingOpenTime = '09:00';
export const bookingCloseTime = '19:00';
type BookingSchedule = Pick<HistoryItem, 'bookingDate' | 'startTime' | 'endTime' | 'status'>;

export function venueDateTime(now = new Date()): string {
  return `${venueToday(now)}T${venueTime(now)}`;
}

function bookingDateTime(date: string, time: string): string {
  return `${date}T${time.length === 5 ? `${time}:00` : time}`;
}

function kyivTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value);
  if (local) {
    const asUtc = new Date(value + 'Z');
    return Number.isFinite(asUtc.getTime()) ? asUtc.toISOString().slice(0, 19) : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? venueDateTime(instant) : null;
}

type PaymentSchedule = Pick<HistoryItem, 'bookingDate' | 'startTime' | 'createdAt' | 'paymentDeadline'>;

export function bookingPaymentWindow(booking: PaymentSchedule) {
  const start = bookingDateTime(booking.bookingDate, booking.startTime ?? bookingOpenTime).slice(0, 19);
  const created = kyivTimestamp(booking.createdAt);
  const deadline = kyivTimestamp(booking.paymentDeadline) ??
    (created ? new Date(Date.parse(created + 'Z') + 86400000).toISOString().slice(0, 19) : null);
  return { start, deadline: deadline === null ? null : deadline < start ? deadline : start };
}

export function paymentDeadlineText(deadline: string): string {
  const [date, time] = deadline.split('T');
  return `Сплатіть до ${date.split('-').reverse().join('.')} о ${time.endsWith(':00') ? time.slice(0, 5) : time} за Київським часом.`;
}

export function bookingDisplayStatus(booking: BookingSchedule, now: string): string {
  return booking.status === 'CONFIRMED' && bookingDateTime(booking.bookingDate, booking.endTime ?? bookingCloseTime) <= now
    ? 'COMPLETED'
    : booking.status;
}

export function isUpcomingBooking(booking: BookingSchedule, now: string): boolean {
  return bookingDisplayStatus(booking, now) === 'CONFIRMED';
}

export function canCancelBooking(booking: BookingSchedule, now: string): boolean {
  const canCancelStatus = booking.status === 'CONFIRMED' || booking.status === 'PENDING_PAYMENT';
  return canCancelStatus && bookingDateTime(booking.bookingDate, booking.startTime ?? bookingOpenTime) > now;
}

export function isCurrentSubscription(subscription: Pick<Subscription, 'status' | 'endDate'>, today: string): boolean {
  return (subscription.status === 'ACTIVE' || subscription.status === 'PENDING_PAYMENT') && subscription.endDate >= today;
}

function followingDay(date: string): string {
  const day = new Date(`${date}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + 1); return day.toISOString().slice(0,10);
}
export function nextBookingSlot(now = new Date()): { date: string; start: string } {
  const today = venueToday(now);
  const hour = Math.max(9, Number(venueTime(now).slice(0,2)) + 1);
  if (isWeekend(today) || hour > 18) return { date: nextWorkingDay(isWeekend(today) ? today : followingDay(today)), start: '09:00' };
  return { date: today, start: `${String(hour).padStart(2,'0')}:00` };
}
export function bookingValidation(date: string, start: string, hours: number, type: BookingType, now = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) return 'Оберіть дату.';
  if (date < venueToday(now)) return 'Оберіть сьогоднішню або майбутню дату.';
  if (type === 'SUBSCRIPTION') return null;
  if (isWeekend(date)) return 'Бронювання на вихідних недоступне. Оберіть будній день.';
  if (type === 'HOURLY' && (!/^\d{2}:00$/.test(start) || hours < 1 || hours > 4 || !Number.isInteger(hours) || Number(start.slice(0,2)) < 9 || Number(start.slice(0,2)) + hours > 19)) return 'Оберіть від 1 до 4 годин у межах 09:00–19:00.';
  if (date === venueToday(now) && (type === 'DAILY' ? '09:00:00' : `${start}:00`) <= venueTime(now)) return type === 'DAILY' ? 'Повний день починається о 09:00. Оберіть майбутній день або погодинне бронювання.' : 'Цей час уже минув або розпочався. Оберіть майбутню годину за Київським часом.';
  return null;
}
export function bookingPayload(workspaceId: number, type: 'HOURLY' | 'DAILY', date: string, start: string, hours: number): BookingRequest {
  return { workspaceId, bookingType: type, bookingDates: [date], ...(type === 'HOURLY' ? { startTime: start, endTime: endTime(start,hours) } : {}) };
}
export function displayWorkspace(workspace: Omit<Workspace, 'type'> & { type?: Workspace['type'] }): string {
  const name = workspace.name.trim();
  const number = /(?:^|[^\d])(\d+)$/.exec(name)?.[1];
  if (workspace.type === 'MEETING_ROOM' || /^meeting[ _-]+room\b/i.test(name)) {
    return number ? `Переговорна кімната №${number}` : 'Переговорна кімната';
  }
  if (number) return `Робоче місце №${number}`;
  return name && !/\p{Script=Latin}/u.test(name) ? name : `Робоче місце №${workspace.id}`;
}

export function isRetiredWorkspace(workspace: Workspace): boolean {
  return workspace.type === 'DESK' && displayWorkspace(workspace) === 'Робоче місце №6';
}

export const money = (value: number) => `${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(Number(value))} грн`;

const statusLabels = new Map([
  ['CONFIRMED', 'Підтверджено'], ['CANCELLED', 'Скасовано'], ['COMPLETED', 'Завершено'],
  ['PENDING_PAYMENT', 'Очікує оплати'], ['ACTIVE', 'Активний'], ['EXPIRED', 'Завершено'],
  ['PAID', 'Сплачено'], ['UNPAID', 'Не сплачено'], ['REFUND_PENDING', 'Очікує повернення'], ['REFUNDED', 'Повернено'],
]);
export const statusText = (status: string | null | undefined) => status ? statusLabels.get(status) ?? 'Невідомий статус' : '—';

const bookingTypeLabels: Record<BookingType, string> = { HOURLY: 'Погодинне', DAILY: 'На весь день', SUBSCRIPTION: 'Абонемент' };
export const bookingTypeText = (type: BookingType) => bookingTypeLabels[type] ?? 'Невідомий формат';

const roleLabels: Record<User['role'], string> = { ADMIN: 'Адміністратор', USER: 'Користувач' };
export const roleText = (role: User['role']) => roleLabels[role] ?? 'Невідома роль';
