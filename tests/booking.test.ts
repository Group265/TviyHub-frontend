import { describe,it,expect,vi,afterEach } from 'vitest';
import {
  bookingDisplayStatus, bookingPayload, bookingPaymentWindow, bookingTypeText, bookingValidation, canCancelBooking, displayWorkspace, isCurrentSubscription,
  isUpcomingBooking, nextBookingSlot, nextWorkingDay, roleText, statusText, venueDateTime, venueToday,
} from '../src/booking';
afterEach(()=>vi.useRealTimers());
describe('booking payment deadline', () => {
  const booking = { bookingDate: '2026-11-25', startTime: '10:00' };

  it('uses the earlier of the start and the Kyiv creation time plus 24 hours', () => {
    expect(bookingPaymentWindow({ ...booking, createdAt: '2026-11-23T23:15:42' }).deadline).toBe('2026-11-24T23:15:42');
    expect(bookingPaymentWindow({ ...booking, createdAt: '2026-11-24T18:15:42Z' }).deadline).toBe('2026-11-25T10:00:00');
  });

  it('uses an explicit deadline and leaves the exact limit unknown without server data', () => {
    expect(bookingPaymentWindow({ ...booking, paymentDeadline: '2026-11-25T07:30:00Z', createdAt: '2026-11-21T10:00:00' }).deadline).toBe('2026-11-25T09:30:00');
    expect(bookingPaymentWindow({ ...booking, startTime: null })).toEqual({ deadline: null, start: '2026-11-25T09:00:00' });
  });
});
describe('booking date and backend rules',()=>{
  it('keeps the Kyiv venue date at UTC midnight boundaries',()=>{expect(venueToday(new Date('2026-11-16T22:30:00Z'))).toBe('2026-11-17');expect(venueToday(new Date('2026-07-16T21:30:00Z'))).toBe('2026-07-17');});
  it('rejects weekends, past dates and invalid hourly slots without changing backend rules',()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-16T10:00:00Z'));expect(bookingValidation('2026-11-15','10:00',1,'HOURLY')).toBeTruthy();expect(bookingValidation('2026-11-21','10:00',1,'HOURLY')).toBeTruthy();expect(bookingValidation('2026-11-17','18:00',2,'HOURLY')).toBeTruthy();expect(bookingValidation('2026-11-17','09:30',1,'HOURLY')).toBeTruthy();expect(bookingValidation('2026-11-17','15:00',4,'HOURLY')).toBeNull();});
  it('uses bookingDates array and omits hourly fields for daily bookings',()=>{expect(bookingPayload(7,'DAILY','2027-01-11','10:00',2)).toEqual({workspaceId:7,bookingType:'DAILY',bookingDates:['2027-01-11']});expect(bookingPayload(7,'HOURLY','2027-01-11','10:00',2).endTime).toBe('12:00');});
  it('moves repeat booking to a new working day instead of replaying a past date',()=>{expect(nextWorkingDay('2026-11-21')).toBe('2026-11-23');expect(nextWorkingDay('2026-11-22')).toBe('2026-11-23');});
  it('rejects elapsed and already started hours today, but allows the next hour and future dates',()=>{
    const now=new Date('2026-11-16T10:15:00Z'); // 12:15 in Kyiv, regardless of browser timezone.
    expect(bookingValidation('2026-11-16','09:00',1,'HOURLY',now)).toBeTruthy();
    expect(bookingValidation('2026-11-16','12:00',4,'HOURLY',now)).toBeTruthy();
    expect(bookingValidation('2026-11-16','13:00',1,'HOURLY',now)).toBeNull();
    expect(bookingValidation('2026-11-17','09:00',1,'HOURLY',now)).toBeNull();
  });
  it('rechecks at submission time when an open form crosses the start boundary',()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-16T10:59:59Z'));
    expect(bookingValidation('2026-11-16','13:00',1,'HOURLY')).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(bookingValidation('2026-11-16','13:00',1,'HOURLY')).toBeTruthy();
  });
  it('does not allow a daily booking whose fixed 09:00 start has already passed',()=>{
    expect(bookingValidation('2026-11-16','09:00',1,'DAILY',new Date('2026-11-16T06:59:59Z'))).toBeNull();
    expect(bookingValidation('2026-11-16','09:00',1,'DAILY',new Date('2026-11-16T07:00:00Z'))).toBeTruthy();
    expect(bookingValidation('2026-11-16','09:00',1,'SUBSCRIPTION',new Date('2026-11-16T12:00:00Z'))).toBeNull();
  });
  it('defaults to a future slot and advances past closing time and weekends',()=>{
    expect(nextBookingSlot(new Date('2026-11-16T06:30:00Z'))).toEqual({date:'2026-11-16',start:'09:00'});
    expect(nextBookingSlot(new Date('2026-11-16T10:15:00Z'))).toEqual({date:'2026-11-16',start:'13:00'});
    expect(nextBookingSlot(new Date('2026-11-20T16:00:00Z'))).toEqual({date:'2026-11-23',start:'09:00'});
    expect(nextBookingSlot(new Date('2026-11-21T08:00:00Z'))).toEqual({date:'2026-11-23',start:'09:00'});
  });
  it('applies summer Kyiv time instead of the computer timezone',()=>{
    const now=new Date('2026-07-16T09:15:00Z');
    expect(bookingValidation('2026-07-16','12:00',1,'HOURLY',now)).toBeTruthy();
    expect(nextBookingSlot(now)).toEqual({date:'2026-07-16',start:'13:00'});
  });
});

describe('booking history and admin status', () => {
  const booking = { bookingDate: '2026-11-16', startTime: '11:00:00', endTime: '13:00', status: 'CONFIRMED' };
  const beforeStart = venueDateTime(new Date('2026-11-16T08:59:59Z'));
  const atStart = venueDateTime(new Date('2026-11-16T09:00:00Z'));
  const justBeforeEnd = venueDateTime(new Date('2026-11-16T10:59:59Z'));
  const atEnd = venueDateTime(new Date('2026-11-16T11:00:00Z'));

  it('stops cancellation at the start but keeps the visit upcoming until its end', () => {
    expect(canCancelBooking(booking, beforeStart)).toBe(true);
    expect(canCancelBooking(booking, atStart)).toBe(false);
    expect(isUpcomingBooking(booking, justBeforeEnd)).toBe(true);
    expect(isUpcomingBooking(booking, atEnd)).toBe(false);
    expect(bookingDisplayStatus(booking, atEnd)).toBe('COMPLETED');
  });

  it('excludes cancelled and completed bookings even when the booked slot is still in the future', () => {
    for (const status of ['CANCELLED', 'COMPLETED']) {
      const item = { ...booking, status };
      expect(isUpcomingBooking(item, beforeStart)).toBe(false);
      expect(canCancelBooking(item, beforeStart)).toBe(false);
      expect(bookingDisplayStatus(item, atEnd)).toBe(status);
    }
  });

  it('uses 09:00 and 19:00 Kyiv for old daily bookings without explicit times', () => {
    const daily = { ...booking, startTime: null, endTime: null };
    const time = (utc: string) => venueDateTime(new Date(`2026-11-16T${utc}Z`));
    expect(canCancelBooking(daily, time('06:59:59'))).toBe(true);
    expect(canCancelBooking(daily, time('07:00:00'))).toBe(false);
    expect(isUpcomingBooking(daily, time('16:59:59'))).toBe(true);
    expect(isUpcomingBooking(daily, time('17:00:00'))).toBe(false);
  });

  it('keeps active and pending payments through their end date in Kyiv', () => {
    const today = venueToday(new Date('2026-07-16T21:30:00Z'));
    expect(isCurrentSubscription({ status: 'ACTIVE', endDate: '2026-07-17' }, today)).toBe(true);
    expect(isCurrentSubscription({ status: 'PENDING_PAYMENT', endDate: '2026-07-18' }, today)).toBe(true);
    expect(isCurrentSubscription({ status: 'ACTIVE', endDate: '2026-07-16' }, today)).toBe(false);
    expect(isCurrentSubscription({ status: 'CANCELLED', endDate: '2026-07-18' }, today)).toBe(false);
    expect(isCurrentSubscription({ status: 'EXPIRED', endDate: '2026-07-18' }, today)).toBe(false);
  });
});

describe('Ukrainian labels for backend data', () => {
  it('localizes roles, booking formats, and status values', () => {
    expect(roleText('ADMIN')).toBe('Адміністратор');
    expect(roleText('USER')).toBe('Користувач');
    expect(bookingTypeText('HOURLY')).toBe('Погодинне');
    expect(bookingTypeText('DAILY')).toBe('На весь день');
    expect(bookingTypeText('SUBSCRIPTION')).toBe('Абонемент');
    expect(statusText('PENDING_PAYMENT')).toBe('Очікує оплати');
    expect(statusText('FUTURE_STATUS')).toBe('Невідомий статус');
    expect(statusText(null)).toBe('—');
  });

  it('keeps localized workspace names and assigns Ukrainian labels to English names', () => {
    expect(displayWorkspace({ id: 15, type: 'DESK', name: 'Desk #5' })).toBe('Робоче місце №5');
    expect(displayWorkspace({ id: 15, type: 'DESK', name: 'Біля вікна' })).toBe('Біля вікна');
    expect(displayWorkspace({ id: 15, type: 'DESK', name: 'Private desk' })).toBe('Робоче місце №15');
    expect(displayWorkspace({ id: 22, name: 'Meeting Room 2' })).toBe('Переговорна кімната №2');
  });
});
