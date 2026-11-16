import type { BookingRequest, BookingType, Workspace } from './api/types';

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
  if (date === venueToday(now) && (type === 'DAILY' ? '09:00:00' : `${start}:00`) <= venueTime(now)) return type === 'DAILY' ? 'Повний день починається о 09:00. Оберіть майбутній день або погодинне бронювання.' : 'Цей час уже минув або розпочався. Оберіть майбутню годину (час Києва).';
  return null;
}
export function bookingPayload(workspaceId: number, type: 'HOURLY' | 'DAILY', date: string, start: string, hours: number): BookingRequest {
  return { workspaceId, bookingType: type, bookingDates: [date], ...(type === 'HOURLY' ? { startTime: start, endTime: endTime(start,hours) } : {}) };
}
export function displayWorkspace(w: Workspace): string { const match = /[№#]?\s*(\d+)$/.exec(w.name); return w.type === 'MEETING_ROOM' ? 'Переговорна кімната' : match ? `Стіл #${match[1]}` : w.name; }
export const money = (value: number) => `${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(Number(value))} грн`;
export const statusText = (status: string) => ({ CONFIRMED: 'Підтверджено', CANCELLED: 'Скасовано', PENDING_PAYMENT: 'Очікує оплати', ACTIVE: 'Активний', EXPIRED: 'Завершено', PAID: 'Сплачено', UNPAID: 'Не сплачено', REFUND_PENDING: 'Очікує повернення', REFUNDED: 'Повернено' })[status] || status;
