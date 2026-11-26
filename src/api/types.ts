export type WorkspaceType = 'DESK' | 'MEETING_ROOM';
export type BookingType = 'HOURLY' | 'DAILY' | 'SUBSCRIPTION';
export interface Workspace { id: number; name: string; type: WorkspaceType }
export interface Availability extends Workspace { isAvailable: boolean }
export interface Tariff { id: number; workspaceType: WorkspaceType; bookingType: BookingType; price: number }
export interface User { id: number; name: string; phone: string | null; email: string; role: 'USER' | 'ADMIN'; emailVerified: boolean; createdAt: string }
export interface AdminUser extends User { blocked: boolean }
export interface Tokens { accessToken: string; refreshToken: string; tokenType: string; expiresInSeconds: number; refreshExpiresInSeconds: number }
export interface BookingRequest { workspaceId: number; bookingType: 'HOURLY' | 'DAILY'; bookingDates: string[]; startTime?: string; endTime?: string }
export interface BookingPayment {
  paymentId?: number | null;
  payment?: { id?: number | null } | null;
  createdAt?: string | null;
  paymentDeadline?: string | null;
}
export interface Booking extends BookingPayment { id: number; userId: number; workspaceId: number; workspaceName: string; bookingType: BookingType; bookingDate: string; startTime: string | null; endTime: string | null; totalPrice: number; status: string; paymentStatus: string }
export interface HistoryItem extends BookingPayment { id: number; bookingDate: string; startTime: string | null; endTime: string | null; bookingType: BookingType; status: string; paymentStatus?: string | null; totalPrice: number; workspace: Workspace }
export interface Page<T> { content: T[]; page: number; size: number; totalElements: number; totalPages: number }
export interface Subscription { id: number; userId: number; workspaceId: number; startDate: string; endDate: string; status: string; paymentStatus: string; paymentId?: number | null }
export interface Payment { id: number; status: string; amount: number; bookingId: number | null; subscriptionId: number | null; paymentMethod: string; createdAt?: string | null;}
export interface StripeSession { sessionUrl: string; sessionId: string }
export interface StripeBatchSession { url: string; sessionId?: string }
export type InPersonPaymentMethod = 'CASH' | 'CARD';
export interface ClosedDay { date: string; reason: string;}
export interface GalleryImageItem {
  id: number;
  caption?: string | null;
  contentType: string;
  sizeBytes: number;
  url?: string;
  createdAt: string;
}
