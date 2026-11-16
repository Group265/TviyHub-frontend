import { describe,it,expect,vi,afterEach } from 'vitest';
import { bookingPayload, bookingValidation, venueToday, nextWorkingDay, nextBookingSlot } from '../src/booking';
afterEach(()=>vi.useRealTimers());
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
