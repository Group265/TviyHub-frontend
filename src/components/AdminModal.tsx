import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, galleryImageUrl } from '../api';
import { bookingAlreadyStartedError, errorMessage } from '../api/errors';
import type {
  AdminUser,
  Availability,
  Booking,
  BookingType,
  ClosedDay,
  GalleryImageItem,
  InPersonPaymentMethod,
  Page,
  Payment,
  Subscription,
  Tariff,
  Workspace,
  WorkspaceType,
} from '../api/types';
import {
  bookingDisplayStatus,
  canAdminCancelSubscription,
  canCancelBooking,
  displayWorkspace,
  money,
  statusText,
  venueDateTime,
} from '../booking';
import { Alert, Modal, Pager } from './ui';
import { useVenueClock } from '../useVenueClock';

const pageSize = 10;
type Tab = 'users' | 'bookings' | 'subscriptions' | 'payments' | 'closedDays' | 'workspaces' | 'tariffs' | 'gallery';

type Action =
  | { type: 'user'; user: AdminUser; blocked: boolean }
  | { type: 'payment'; label: string; payment: Payment; method: InPersonPaymentMethod }
  | { type: 'refund'; label: string; payment: Payment }
  | { type: 'cancel'; booking: Booking }
  | { type: 'cancelSubscription'; subscription: Subscription }
  | { type: 'deleteClosedDay'; date: string }
  | { type: 'deleteWorkspace'; workspace: Workspace }
  | { type: 'deleteTariff'; tariff: Tariff }
  | { type: 'deleteGalleryImage'; image: GalleryImageItem };

const clientName = (userId: number, client?: AdminUser) => client?.name || 'Клієнт №' + userId;

function diffDays(fromIso: string, toIso: string): number {
  const from = new Date(fromIso + 'T00:00:00Z').getTime();
  const to = new Date(toIso + 'T00:00:00Z').getTime();
  return Math.round((to - from) / 86_400_000);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(isoDate + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function paymentMethodLabel(method?: string | null): string {
  if (method === 'CARD' || method === 'STRIPE') return 'КАРТКА';
  if (method === 'CASH') return 'ГОТІВКА';
  return method || 'КАРТКА';
}
const MONTH_NAMES_UK: Record<string, string> = {
  '01': 'Січень',
  '02': 'Лютий',
  '03': 'Березень',
  '04': 'Квітень',
  '05': 'Травень',
  '06': 'Червень',
  '07': 'Липень',
  '08': 'Серпень',
  '09': 'Вересень',
  '10': 'Жовтень',
  '11': 'Листопад',
  '12': 'Грудень',
};
function formatMonthLabel(ym: string): string {
  const [year, month] = ym.split('-');
  return `${MONTH_NAMES_UK[month] ?? month} ${year}`;
}

function tariffMeta(tariff: Tariff) {
  const isRoom = tariff.workspaceType === 'MEETING_ROOM';
  const category = isRoom ? 'ОКРЕМА КІМНАТА' : 'РОБОЧЕ МІСЦЕ';
  const title =
    tariff.bookingType === 'HOURLY'
      ? isRoom
        ? 'Переговорна'
        : 'Погодинний'
      : tariff.bookingType === 'DAILY'
        ? 'Денний'
        : 'Місячний';
  const unit = tariff.bookingType === 'HOURLY' ? 'година' : tariff.bookingType === 'DAILY' ? 'день' : 'місяць';
  const features = isRoom
    ? ['Лише погодинна оренда', 'Доступ у години 09:00 - 19:00', 'Кава - поінт', 'WiFi та розетки']
    : tariff.bookingType === 'HOURLY'
      ? ['Бронювання від 1 до 4 години', 'Доступ у години 09:00 - 19:00', 'Кава - поінт', 'WiFi та розетки']
      : tariff.bookingType === 'DAILY'
        ? ['Повний робочий день', 'Доступ у години 09:00 - 19:00', 'Кава - поінт', 'WiFi та розетки']
        : ['Закріплене робоче місце', 'Доступ у години 09:00 - 19:00', 'Кава - поінт', 'WiFi та розетки'];

  return { category, title, unit, features };
}

function confirmationText(action: Action): string {
  if (action.type === 'cancelSubscription') return `Скасувати абонемент №${action.subscription.id}?`;
  if (action.type === 'cancel') return `Скасувати бронювання №${action.booking.id}?`;
  if (action.type === 'refund') return `Оформити повернення ${money(action.payment.amount)} за ${action.label}?`;
  if (action.type === 'payment') {
    const method = action.method === 'CASH' ? 'готівкою' : 'карткою';
    return `Підтвердити оплату ${money(action.payment.amount)} (${method}) за ${action.label}?`;
  }
  if (action.type === 'deleteClosedDay') return `Скасувати статус неробочого дня для ${action.date}?`;
  if (action.type === 'deleteWorkspace') return `Видалити робоче місце «${action.workspace.name}»?`;
  if (action.type === 'deleteTariff') return `Видалити обраний тариф?`;
  if (action.type === 'deleteGalleryImage') return `Видалити фото №${action.image.id} з галереї?`;
  const verb = action.blocked ? 'видалити (заблокувати)' : 'відновити';
  return `Ви впевнені, що хочете ${verb} користувача «${action.user.name}»?`;
}

export function AdminModal({
  onClose,
  onChanged,
  userId,
  workspaces: initialWorkspaces,
}: {
  onClose: () => void;
  onChanged: () => void;
  userId: number;
  workspaces: Workspace[];
}) {
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<Page<AdminUser> | null>(null);
  const [clients, setClients] = useState<Record<number, AdminUser>>({});
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [closedDays, setClosedDays] = useState<ClosedDay[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(initialWorkspaces);
  const [availability, setAvailability] = useState<Record<number, boolean>>({});
  const [tariffs, setTariffs] = useState<Tariff[]>([]);

  const [page, setPage] = useState(0);
  const [bookingStatusFilter, setBookingStatusFilter] = useState<string>('ALL');
  const [bookingPaymentFilter, setBookingPaymentFilter] = useState<string>('ALL');
  const [subStatusFilter, setSubStatusFilter] = useState<string>('ALL');
  const [subPaymentFilter, setSubPaymentFilter] = useState<string>('ALL');
  const [paymentFilter, setPaymentFilter] = useState<string>('ALL');
  const [paymentMonthFilter, setPaymentMonthFilter] = useState<string>('ALL');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [confirm, setConfirm] = useState<Action | null>(null);

  const [newClosedDate, setNewClosedDate] = useState('');
  const [newClosedReason, setNewClosedReason] = useState('');

  const [extendSub, setExtendSub] = useState<Subscription | null>(null);
  const [extendEndDate, setExtendEndDate] = useState('');
  const [extendReason, setExtendReason] = useState('');

  const [workspaceModal, setWorkspaceModal] = useState<{ mode: 'create' | 'edit'; item?: Workspace } | null>(null);
  const [wsName, setWsName] = useState('');
  const [wsType, setWsType] = useState<WorkspaceType>('DESK');

  const [tariffModal, setTariffModal] = useState<{ mode: 'create' | 'edit'; item?: Tariff } | null>(null);
  const [tfWorkspaceType, setTfWorkspaceType] = useState<WorkspaceType>('DESK');
  const [tfBookingType, setTfBookingType] = useState<BookingType>('HOURLY');
  const [tfPrice, setTfPrice] = useState('150');
  const [galleryImages, setGalleryImages] = useState<GalleryImageItem[]>([]);
  const [galleryFile, setGalleryFile] = useState<File | null>(null);
  const [galleryCategory, setGalleryCategory] = useState<string>('Зони відпочинку');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const now = venueDateTime(useVenueClock());
  const canConfirm = confirm && (confirm.type !== 'cancel' || canCancelBooking(confirm.booking, now));

  useEffect(() => {
    if (confirm && !canConfirm) setConfirm(null);
  }, [confirm, canConfirm]);

  useEffect(() => {
    if (confirm) backButton.current?.focus();
  }, [confirm]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setLoading(true);
    setLoadError('');

    async function load() {
      if (tab === 'users') {
        const [usersPage, allBookings] = await Promise.all([
          api.adminUsers(page, '', 'recent', signal, pageSize),
          api.bookings(signal),
        ]);
        if (signal.aborted) return;
        setUsers(usersPage);
        setBookings(allBookings);
        return;
      }

      if (tab === 'bookings') {
        const [rows, transactions] = await Promise.all([api.bookings(signal), api.adminPayments(signal)]);
        const clientRows = await api.adminClients(rows.map(item => item.userId), signal);
        if (signal.aborted) return;
        setBookings(rows);
        setPayments(transactions);
        setClients(Object.fromEntries(clientRows.map(u => [u.id, u])));
        return;
      }

      if (tab === 'subscriptions') {
        const [subRows, transactions, tariffRows, wsRows] = await Promise.all([
          api.adminSubscriptions(signal),
          api.adminPayments(signal),
          api.tariffs(),
          api.workspaces(),
        ]);
        const clientRows = await api.adminClients(subRows.map(item => item.userId), signal);
        if (signal.aborted) return;
        setSubscriptions(subRows);
        setPayments(transactions);
        setTariffs(tariffRows);
        setWorkspaces(wsRows);
        setClients(Object.fromEntries(clientRows.map(u => [u.id, u])));
        return;
      }

      if (tab === 'payments') {
        const [transactions, bookingRows, subRows] = await Promise.all([
          api.adminPayments(signal),
          api.bookings(signal),
          api.adminSubscriptions(signal),
        ]);
        const userIds = [
          ...bookingRows.map(b => b.userId),
          ...subRows.map(s => s.userId),
        ];
        const clientRows = await api.adminClients(userIds, signal);
        if (signal.aborted) return;
        setPayments(transactions);
        setBookings(bookingRows);
        setSubscriptions(subRows);
        setClients(Object.fromEntries(clientRows.map(u => [u.id, u])));
        return;
      }

      if (tab === 'closedDays') {
        const days = await api.closedDays(signal);
        if (signal.aborted) return;
        setClosedDays(days);
        return;
      }

      if (tab === 'workspaces') {
        const today = new Date().toISOString().slice(0, 10);
        const [wsRows, tariffRows, availRows] = await Promise.all([
          api.workspaces(),
          api.tariffs(),
          api.availability(today, undefined, undefined, signal, true).catch(() => [] as Availability[]),
        ]);
        if (signal.aborted) return;
        setWorkspaces(wsRows);
        setTariffs(tariffRows);
        setAvailability(Object.fromEntries(availRows.map(a => [a.id, a.isAvailable])));
        return;
      }

      if (tab === 'tariffs') {
        const tariffRows = await api.tariffs();
        if (signal.aborted) return;
        setTariffs(tariffRows);
      }
      if (tab === 'gallery') {
        const res = await api.gallery(0, 100, signal);
        if (signal.aborted) return;
        setGalleryImages(res.content);
        return;
      }
    }
    load()
      .catch(err => {
        if (signal.aborted) return;
        setLoadError(errorMessage(err, 'Не вдалося завантажити дані адмін-панелі.'));
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [tab, page, revision]);
  const bookingPayments = useMemo(
    () => new Map(payments.filter(p => p.bookingId != null).map(p => [p.bookingId!, p])),
    [payments],
  );
  const subscriptionPayments = useMemo(
    () => new Map(payments.filter(p => p.subscriptionId != null).map(p => [p.subscriptionId!, p])),
    [payments],
  );
  const bookingsById = useMemo(() => new Map(bookings.map(b => [b.id, b])), [bookings]);
  const subscriptionsById = useMemo(() => new Map(subscriptions.map(s => [s.id, s])), [subscriptions]);
  const bookingsCountByUser = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const b of bookings) {
      counts[b.userId] = (counts[b.userId] ?? 0) + 1;
    }
    return counts;
  }, [bookings]);
  const monthlySubPrice = useMemo(
    () => tariffs.find(t => t.bookingType === 'SUBSCRIPTION')?.price ?? 3500,
    [tariffs],
  );
  const hourlyPriceByType = useMemo(() => {
    const map: Partial<Record<WorkspaceType, number>> = {};
    for (const t of tariffs) {
      if (t.bookingType === 'HOURLY') map[t.workspaceType] = t.price;
    }
    return map;
  }, [tariffs]);
  const filteredBookings = useMemo(() => {
    return bookings.filter(booking => {
      const displayStatus = bookingDisplayStatus(booking, now);
      const payStatus = bookingPayments.get(booking.id)?.status ?? booking.paymentStatus;
      if (bookingStatusFilter === 'UPCOMING') {
        const isFuture = booking.bookingDate >= now.slice(0, 10) && displayStatus !== 'CANCELLED' && displayStatus !== 'COMPLETED';
        if (!isFuture) return false;
      } else if (bookingStatusFilter !== 'ALL' && displayStatus !== bookingStatusFilter) {
        return false;
      }
      if (bookingPaymentFilter === 'ACTION_REQUIRED') {
        const needsPayment = payStatus === 'UNPAID' && displayStatus !== 'CANCELLED';
        const needsRefund = payStatus === 'REFUND_PENDING';
        if (!needsPayment && !needsRefund) return false;
      } else if (bookingPaymentFilter !== 'ALL' && payStatus !== bookingPaymentFilter) {
        return false;
      }
      return true;
    });
  }, [bookings, bookingPayments, bookingStatusFilter, bookingPaymentFilter, now]);
  const filteredSubscriptions = useMemo(() => {
    return subscriptions.filter(sub => {
      const payStatus = subscriptionPayments.get(sub.id)?.status ?? sub.paymentStatus;
      if (subStatusFilter !== 'ALL' && sub.status !== subStatusFilter) return false;
      if (subPaymentFilter === 'ACTION_REQUIRED') {
        const needsPayment = payStatus === 'UNPAID' && sub.status !== 'CANCELLED';
        const needsRefund = payStatus === 'REFUND_PENDING';
        if (!needsPayment && !needsRefund) return false;
      } else if (subPaymentFilter !== 'ALL' && payStatus !== subPaymentFilter) {
        return false;
      }
      return true;
    });
  }, [subscriptions, subscriptionPayments, subStatusFilter, subPaymentFilter]);
    const paymentDateIso = (p: Payment): string => {
      const booking = p.bookingId ? bookingsById.get(p.bookingId) : undefined;
      const sub = p.subscriptionId ? subscriptionsById.get(p.subscriptionId) : undefined;
      return (p.createdAt ?? booking?.bookingDate ?? sub?.startDate ?? '').slice(0, 10);
    };

    const availablePaymentMonths = useMemo(() => {
      const set = new Set<string>();
      for (const p of payments) {
        const ym = paymentDateIso(p).slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(ym)) set.add(ym);
      }
      return Array.from(set).sort((a, b) => b.localeCompare(a));
    }, [payments, bookingsById, subscriptionsById]);

    const paymentsInMonth = useMemo(() => {
      if (paymentMonthFilter === 'ALL') return payments;
      return payments.filter(p => paymentDateIso(p).startsWith(paymentMonthFilter));
    }, [payments, paymentMonthFilter, bookingsById, subscriptionsById]);

    const paymentSummary = useMemo(() => {
      let paidTotal = 0;
      let paidCount = 0;
      let cardTotal = 0;
      let cardCount = 0;
      let cashTotal = 0;
      let cashCount = 0;
      let refundedTotal = 0;
      let refundedCount = 0;

      for (const p of paymentsInMonth) {
        if (p.status === 'PAID') {
          paidTotal += p.amount;
          paidCount++;
          if (p.paymentMethod === 'CASH') {
            cashTotal += p.amount;
            cashCount++;
          } else {
            cardTotal += p.amount;
            cardCount++;
          }
        } else if (p.status === 'REFUNDED') {
          refundedTotal += p.amount;
          refundedCount++;
        }
      }

      return {
        paidTotal,
        paidCount,
        cardTotal,
        cardCount,
        cashTotal,
        cashCount,
        refundedTotal,
        refundedCount,
        netTotal: paidTotal - refundedTotal,
      };
    }, [paymentsInMonth]);

    const filteredPayments = useMemo(() => {
      return paymentsInMonth.filter(p => {
        if (paymentFilter === 'ACTION_REQUIRED') {
          return p.status === 'UNPAID' || p.status === 'REFUND_PENDING';
        }
        return paymentFilter === 'ALL' || p.status === paymentFilter;
      });
    }, [paymentsInMonth, paymentFilter]);

  function changeTab(next: Tab) {
    setTab(next);
    setPage(0);
    setBookingStatusFilter('ALL');
    setBookingPaymentFilter('ALL');
    setSubStatusFilter('ALL');
    setSubPaymentFilter('ALL');
    setPaymentFilter('ALL');
    setPaymentMonthFilter('ALL');
    setError('');
    setNotice('');
    setConfirm(null);
  }
  function ask(action: Action) {
    setError('');
    setNotice('');
    setConfirm(action);
  }
  async function perform() {
    if (!confirm || busy) return;
    setError('');
    if (confirm.type === 'cancel' && !canCancelBooking(confirm.booking, venueDateTime())) {
      setConfirm(null);
      setError(bookingAlreadyStartedError);
      return;
    }
    setBusy(true);
    try {
      if (confirm.type === 'user') {
        const updated = await api.setUserBlocked(confirm.user.id, confirm.blocked);
        setUsers(
          current => current && { ...current, content: current.content.map(u => (u.id === updated.id ? updated : u)) },
        );
        setNotice(
          updated.blocked
            ? `Користувача ${updated.name} видалено (заблоковано).`
            : `Доступ ${updated.name} відновлено.`,
        );
      } else if (confirm.type === 'payment') {
        await api.updatePayment(confirm.payment.id, confirm.method);
        setNotice(`Оплату за ${confirm.label} підтверджено.`);
      } else if (confirm.type === 'refund') {
        await api.confirmRefund(confirm.payment.id);
        setNotice(`Повернення коштів за ${confirm.label} оформлено.`);
      } else if (confirm.type === 'cancelSubscription') {
        await api.adminCancelSubscription(confirm.subscription.id);
        setNotice(`Абонемент №${confirm.subscription.id} скасовано.`);
      } else if (confirm.type === 'deleteClosedDay') {
        await api.deleteClosedDay(confirm.date);
        setNotice(`Неробочий день ${confirm.date} скасовано.`);
      } else if (confirm.type === 'deleteWorkspace') {
        await api.deleteWorkspace(confirm.workspace.id);
        setNotice(`Робоче місце «${confirm.workspace.name}» видалено.`);
      } else if (confirm.type === 'deleteTariff') {
        await api.deleteTariff(confirm.tariff.id);
        setNotice('Тариф видалено.');
      } else if (confirm.type === 'deleteGalleryImage') {
        await api.deleteGalleryImage(confirm.image.id);
        setNotice(`Фото №${confirm.image.id} видалено.`);
      } else {
        await api.cancel(confirm.booking.id);
        setNotice(`Бронювання №${confirm.booking.id} скасовано.`);
      }
      setConfirm(null);
      setRevision(v => v + 1);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося виконати дію.'));
    } finally {
      setBusy(false);
    }
  }
  async function handleAddClosedDay(e: FormEvent) {
    e.preventDefault();
    if (!newClosedDate || !newClosedReason.trim() || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.createClosedDay({ date: newClosedDate, reason: newClosedReason.trim() });
      setNewClosedDate('');
      setNewClosedReason('');
      setNotice('Неробочий день додано.');
      setRevision(v => v + 1);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося додати неробочий день.'));
    } finally {
      setBusy(false);
    }
  }
  function openExtendModal(sub: Subscription) {
    setError('');
    setNotice('');
    setExtendSub(sub);
    setExtendEndDate(addDays(sub.endDate, 7));
    setExtendReason('');
  }
  async function handleExtendSubmit(e: FormEvent) {
    e.preventDefault();
    if (!extendSub || !extendEndDate || busy) return;
    const days = diffDays(extendSub.endDate, extendEndDate);
    if (days <= 0) {
      setError('Нова дата завершення має бути пізнішою за поточну.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.adminExtendSubscription(extendSub.id, days);
      setExtendSub(null);
      setNotice(`Абонемент №${extendSub.id} продовжено на ${days} дн.`);
      setRevision(v => v + 1);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося продовжити абонемент.'));
    } finally {
      setBusy(false);
    }
  }
  function openWorkspaceModal(mode: 'create' | 'edit', item?: Workspace) {
    setError('');
    setNotice('');
    setWorkspaceModal({ mode, item });
    setWsName(item?.name ?? '');
    setWsType(item?.type ?? 'DESK');
  }
  async function handleWorkspaceSubmit(e: FormEvent) {
    e.preventDefault();
    if (!workspaceModal || !wsName.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      if (workspaceModal.mode === 'edit' && workspaceModal.item) {
        await api.updateWorkspace(workspaceModal.item.id, { name: wsName.trim(), type: wsType });
        setNotice(`Робоче місце «${wsName.trim()}» оновлено.`);
      } else {
        await api.createWorkspace({ name: wsName.trim(), type: wsType });
        setNotice(`Робоче місце «${wsName.trim()}» створено.`);
      }
      setWorkspaceModal(null);
      setRevision(v => v + 1);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося зберегти робоче місце.'));
    } finally {
      setBusy(false);
    }
  }
  function openTariffModal(mode: 'create' | 'edit', item?: Tariff) {
    setError('');
    setNotice('');
    setTariffModal({ mode, item });
    setTfWorkspaceType(item?.workspaceType ?? 'DESK');
    setTfBookingType(item?.bookingType ?? 'HOURLY');
    setTfPrice(item ? String(item.price) : '150');
  }
  async function handleTariffSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tariffModal || busy) return;
    const numericPrice = Number(tfPrice);
    if (Number.isNaN(numericPrice) || numericPrice < 0) {
      setError('Введіть коректну вартість.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (tariffModal.mode === 'edit' && tariffModal.item) {
        await api.updateTariff(tariffModal.item.id, {
          workspaceType: tfWorkspaceType,
          bookingType: tfBookingType,
          price: numericPrice,
        });
        setNotice('Тариф оновлено.');
      } else {
        await api.createTariff({
          workspaceType: tfWorkspaceType,
          bookingType: tfBookingType,
          price: numericPrice,
        });
        setNotice('Новий тариф додано.');
      }
      setTariffModal(null);
      setRevision(v => v + 1);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося зберегти тариф.'));
    } finally {
      setBusy(false);
    }
  }
  const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

  function handleGalleryFileChange(file: File | null) {
    setError('');
    setNotice('');
    if (!file) {
      setGalleryFile(null);
      return;
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setGalleryFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setError('Дозволені лише формати JPG, PNG або WebP.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setGalleryFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setError('Максимальний розмір файлу — 5 МБ.');
      return;
    }
    setGalleryFile(file);
  }

  async function handleGalleryUpload(e: FormEvent) {
    e.preventDefault();
    if (!galleryFile || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.uploadGalleryImage(galleryFile, galleryCategory);
      setGalleryFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setNotice('Фото успішно завантажено до галереї.');
      setRevision(v => v + 1);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося завантажити фото.'));
    } finally {
      setBusy(false);
    }
  }
  const listLength =
    tab === 'bookings'
      ? filteredBookings.length
      : tab === 'subscriptions'
        ? filteredSubscriptions.length
        : tab === 'payments'
          ? filteredPayments.length
          : 0;
  const totalPages = tab === 'users' ? users?.totalPages ?? 0 : Math.ceil(listLength / pageSize);
  const visiblePage = tab === 'users' ? page : Math.min(page, Math.max(0, totalPages - 1));
  const visibleBookings = filteredBookings.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize);
  const visibleSubscriptions = filteredSubscriptions.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize);
  const visiblePayments = filteredPayments.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize);
  return (
    <Modal
      title="Адмін - панель"
      subtitle="ЄДИНИЙ ІНСТРУМЕНТ КЕРУВАННЯ БРОНЮВАННЯМИ, СТАТУСАМИ ТА ЗАЯВКАМИ"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
      className="admin-modal"
    >
      <div className="admin-nav-pills">
        <button className={tab === 'users' ? 'btn' : 'btn outline'} disabled={busy} onClick={() => changeTab('users')}>
          Всі користувачі
        </button>
        <button className={tab === 'bookings' ? 'btn' : 'btn outline'} disabled={busy} onClick={() => changeTab('bookings')}>
          Всі бронювання
        </button>
        <button className={tab === 'subscriptions' ? 'btn' : 'btn outline'} disabled={busy} onClick={() => changeTab('subscriptions')}>
          Абонементи
        </button>
        <button className={tab === 'payments' ? 'btn' : 'btn outline'} disabled={busy} onClick={() => changeTab('payments')}>
          Платежі
        </button>
        <button className={tab === 'closedDays' ? 'btn' : 'btn outline'} disabled={busy} onClick={() => changeTab('closedDays')}>
          Неробочі дні
        </button>
        <button className={tab === 'workspaces' ? 'btn' : 'btn outline'} disabled={busy} onClick={() => changeTab('workspaces')}>
          Робочі місця
        </button>
        <button className={tab === 'tariffs' ? 'btn' : 'btn outline'} disabled={busy} onClick={() => changeTab('tariffs')}>
          Тарифи
        </button>
        <button className={tab === 'gallery' ? 'btn' : 'btn outline'} disabled={busy} onClick={() => changeTab('gallery')}>
          Галерея
        </button>
      </div>

      {!loading && !loadError && tab === 'bookings' && (
        <div className="admin-filters">
          <label>
            Статус броні
            <select
              value={bookingStatusFilter}
              onChange={e => {
                setBookingStatusFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="ALL">Всі статуси</option>
              <option value="UPCOMING">Майбутні (активні)</option>
              <option value="CONFIRMED">Підтверджено</option>
              <option value="PENDING_PAYMENT">Очікує оплати</option>
              <option value="COMPLETED">Завершено</option>
              <option value="CANCELLED">Скасовано</option>
            </select>
          </label>

          <label>
            Статус оплати
            <select
              value={bookingPaymentFilter}
              onChange={e => {
                setBookingPaymentFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="ALL">Всі оплати</option>
              <option value="ACTION_REQUIRED">Потребують дій (Не сплачено / Повернення)</option>
              <option value="PAID">Сплачено</option>
              <option value="UNPAID">Не сплачено</option>
              <option value="REFUND_PENDING">Очікує повернення</option>
              <option value="REFUNDED">Повернено</option>
            </select>
          </label>

          {(bookingStatusFilter !== 'ALL' || bookingPaymentFilter !== 'ALL') && (
            <button
              type="button"
              className="text-button muted-link reset-filters-btn"
              onClick={() => {
                setBookingStatusFilter('ALL');
                setBookingPaymentFilter('ALL');
                setPage(0);
              }}
            >
              Скинути фільтри
            </button>
          )}
        </div>
      )}

      {!loading && !loadError && tab === 'subscriptions' && (
        <div className="admin-filters">
          <label>
            Статус абонемента
            <select
              value={subStatusFilter}
              onChange={e => {
                setSubStatusFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="ALL">Всі статуси</option>
              <option value="ACTIVE">Активний</option>
              <option value="PENDING_PAYMENT">Очікує оплати</option>
              <option value="EXPIRED">Завершено</option>
              <option value="CANCELLED">Скасовано</option>
            </select>
          </label>

          <label>
            Статус оплати
            <select
              value={subPaymentFilter}
              onChange={e => {
                setSubPaymentFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="ALL">Всі оплати</option>
              <option value="ACTION_REQUIRED">Потребують дій (Не сплачено / Повернення)</option>
              <option value="PAID">Сплачено</option>
              <option value="UNPAID">Не сплачено</option>
              <option value="REFUND_PENDING">Очікує повернення</option>
              <option value="REFUNDED">Повернено</option>
            </select>
          </label>

          {(subStatusFilter !== 'ALL' || subPaymentFilter !== 'ALL') && (
            <button
              type="button"
              className="text-button muted-link reset-filters-btn"
              onClick={() => {
                setSubStatusFilter('ALL');
                setSubPaymentFilter('ALL');
                setPage(0);
              }}
            >
              Скинути фільтри
            </button>
          )}
        </div>
      )}

            {!loading && !loadError && tab === 'payments' && (
              <>
                <div className="payment-summary-grid">
                  <div className="payment-summary-card accent">
                    <span>Чистий дохід</span>
                    <strong>{money(paymentSummary.netTotal)}</strong>
                    <small>Сплачено {money(paymentSummary.paidTotal)} ({paymentSummary.paidCount} шт.)</small>
                  </div>
                  <div className="payment-summary-card">
                    <span>Безготівка (Картка)</span>
                    <strong>{money(paymentSummary.cardTotal)}</strong>
                    <small>{paymentSummary.cardCount} оплат карткою / Stripe</small>
                  </div>
                  <div className="payment-summary-card">
                    <span>Готівка</span>
                    <strong>{money(paymentSummary.cashTotal)}</strong>
                    <small>{paymentSummary.cashCount} оплат готівкою</small>
                  </div>
                  <div className="payment-summary-card">
                    <span>Повернення</span>
                    <strong>{money(paymentSummary.refundedTotal)}</strong>
                    <small>{paymentSummary.refundedCount} повернених платежів</small>
                  </div>
                </div>

                <div className="admin-filters">
                  <label>
                    Період (місяць)
                    <select
                      value={paymentMonthFilter}
                      onChange={e => {
                        setPaymentMonthFilter(e.target.value);
                        setPage(0);
                      }}
                    >
                      <option value="ALL">За весь час</option>
                      {availablePaymentMonths.map(ym => (
                        <option key={ym} value={ym}>
                          {formatMonthLabel(ym)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Фільтр за статусом платежу
                    <select
                      value={paymentFilter}
                      onChange={e => {
                        setPaymentFilter(e.target.value);
                        setPage(0);
                      }}
                    >
                      <option value="ALL">Всі платежі</option>
                      <option value="ACTION_REQUIRED">Потребують дій (Не сплачено / Повернення)</option>
                      <option value="PAID">Сплачено</option>
                      <option value="UNPAID">Не сплачено</option>
                      <option value="REFUND_PENDING">Очікує повернення</option>
                      <option value="REFUNDED">Повернено</option>
                    </select>
                  </label>

                  {(paymentFilter !== 'ALL' || paymentMonthFilter !== 'ALL') && (
                    <button
                      type="button"
                      className="text-button muted-link reset-filters-btn"
                      onClick={() => {
                        setPaymentFilter('ALL');
                        setPaymentMonthFilter('ALL');
                        setPage(0);
                      }}
                    >
                      Скинути фільтри
                    </button>
                  )}
                </div>
              </>
            )}

      {error && !canConfirm && !extendSub && !workspaceModal && !tariffModal && <Alert>{error}</Alert>}
      {notice && <Alert success>{notice}</Alert>}

      {canConfirm && confirm && (
        <Modal
          title="Підтвердження дії"
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <p>{confirmationText(confirm)}</p>
          {error && <Alert>{error}</Alert>}
          <div className="actions align-right" style={{ marginTop: 24 }}>
            <button
              type="button"
              ref={backButton}
              className="btn outline small"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              Скасувати
            </button>
            <button type="button" className="btn small" disabled={busy} onClick={perform}>
              {busy ? 'Зачекайте…' : 'Підтвердити'}
            </button>
          </div>
        </Modal>
      )}


      {loading ? (
        <p className="empty" role="status">
          Завантаження…
        </p>
      ) : loadError ? (
        <Alert>{loadError}</Alert>
      ) : tab === 'users' ? (
        users?.content.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>РЕЄСТРАЦІЯ</th>
                  <th>КЛІЄНТ</th>
                  <th>EMAIL</th>
                  <th>БРОНЮВАННЯ</th>
                  <th>ДІЇ МЕНЕДЖЕРА</th>
                </tr>
              </thead>
              <tbody>
                {users.content.map(user => {
                  const count = bookingsCountByUser[user.id] ?? 0;
                  const isSelf = user.id === userId;
                  return (
                    <tr key={user.id}>
                      <td>{user.createdAt.slice(0, 10).split('-').reverse().join('.')}</td>
                      <td>
                        <strong>{user.name}</strong>
                        <small>{user.phone || 'Телефон не вказано'}</small>
                      </td>
                      <td>{user.email}</td>
                      <td>
                        <strong>{count}</strong>
                        <small>БРОНЮВАНЬ</small>
                      </td>
                      <td>
                        {isSelf ? (
                          <span className="muted">Поточний адмін</span>
                        ) : (
                          <button
                            type="button"
                            className={`text-button ${user.blocked ? '' : 'danger'}`}
                            disabled={busy}
                            onClick={() => ask({ type: 'user', user, blocked: !user.blocked })}
                          >
                            {user.blocked ? 'Відновити користувача' : 'Видалити користувача'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">Користувачів не знайдено.</p>
        )
      ) : tab === 'bookings' ? (
        visibleBookings.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>ДАТА</th>
                  <th>КЛІЄНТ</th>
                  <th>РЕСУРС / ТАРИФ</th>
                  <th>СУМА</th>
                  <th>СТАТУС БРОНІ</th>
                  <th>ОПЛАТА</th>
                  <th>ДІЇ МЕНЕДЖЕРА</th>
                </tr>
              </thead>
              <tbody>
                {visibleBookings.map(booking => {
                  const client = clients[booking.userId];
                  const payment = bookingPayments.get(booking.id);
                  const workspace = workspaces.find(item => item.id === booking.workspaceId);
                  const status = bookingDisplayStatus(booking, now);
                  const payStatus = payment?.status ?? booking.paymentStatus;
                  const isPaid = payStatus === 'PAID';
                  const canRecordPayment = payment?.status === 'UNPAID' && canCancelBooking(booking, now);

                  return (
                    <tr key={booking.id}>
                      <td>
                        {booking.bookingDate.split('-').reverse().join('.')}
                        {booking.startTime && booking.endTime && (
                          <small>
                            {booking.startTime.slice(0, 5)} – {booking.endTime.slice(0, 5)}
                          </small>
                        )}
                      </td>
                      <td>
                        <strong>{clientName(booking.userId, client)}</strong>
                        {client?.phone && <small>{client.phone}</small>}
                      </td>
                      <td>
                        <strong>{workspace?.name || booking.workspaceName || `Місце №${booking.workspaceId}`}</strong>
                        <small>{booking.bookingType}</small>
                      </td>
                      <td>
                        <strong>{money(booking.totalPrice)}</strong>
                      </td>
                      <td>
                        <span
                          className={`status ${status === 'CONFIRMED' ? 'active' : status === 'CANCELLED' ? 'cancelled' : 'completed'
                            }`}
                        >
                          {statusText(status)}
                        </span>
                      </td>
                      <td>
                        <span className={`status ${isPaid ? 'active' : 'pending'}`}>{statusText(payStatus)}</span>
                        {canRecordPayment && payment && (
                          <div className="actions admin-payment-actions">
                            <button
                              type="button"
                              className="text-button"
                              disabled={busy}
                              onClick={() =>
                                ask({
                                  type: 'payment',
                                  label: `бронювання №${booking.id}`,
                                  payment,
                                  method: 'CARD',
                                })
                              }
                            >
                              Картка
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              disabled={busy}
                              onClick={() =>
                                ask({
                                  type: 'payment',
                                  label: `бронювання №${booking.id}`,
                                  payment,
                                  method: 'CASH',
                                })
                              }
                            >
                              Готівка
                            </button>
                          </div>
                        )}
                      </td>
                      <td>
                        {payment?.status === 'REFUND_PENDING' ? (
                          <button
                            type="button"
                            className="text-button danger"
                            disabled={busy}
                            onClick={() =>
                              ask({
                                type: 'refund',
                                label: `бронювання №${booking.id}`,
                                payment,
                              })
                            }
                          >
                            Підтвердити повернення
                          </button>
                        ) : canCancelBooking(booking, now) ? (
                          <button
                            type="button"
                            className="text-button danger"
                            disabled={busy}
                            onClick={() => ask({ type: 'cancel', booking })}
                          >
                            Скасувати
                          </button>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">Бронювань за обраними фільтрами не знайдено.</p>
        )
      ) : tab === 'subscriptions' ? (
        visibleSubscriptions.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>КЛІЄНТ</th>
                  <th>АБОНЕМЕНТ</th>
                  <th>ТЕРМІН ДІЇ</th>
                  <th>СТАТУС</th>
                  <th>ОПЛАТА</th>
                  <th>ДІЇ МЕНЕДЖЕРА</th>
                </tr>
              </thead>
              <tbody>
                {visibleSubscriptions.map(item => {
                  const client = clients[item.userId];
                  const workspace = workspaces.find(w => w.id === item.workspaceId);
                  const payment = subscriptionPayments.get(item.id);
                  const amount = payment?.amount ?? monthlySubPrice;
                  const payStatus = payment?.status ?? item.paymentStatus;
                  const isPaid = payStatus === 'PAID';

                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{clientName(item.userId, client)}</strong>
                        {client?.phone && <small>{client.phone}</small>}
                      </td>
                      <td>
                        <strong>Місячний</strong>
                        <small>({workspace?.name || `Стіл №${item.workspaceId}`})</small>
                      </td>
                      <td>
                        З {item.startDate} до {item.endDate}
                      </td>
                      <td>
                        <span
                          className={`status ${item.status === 'ACTIVE'
                              ? 'active'
                              : item.status === 'CANCELLED'
                                ? 'cancelled'
                                : 'completed'
                            }`}
                        >
                          {statusText(item.status)}
                        </span>
                      </td>
                      <td>
                        <div className="sub-payment-cell">
                          <span className={isPaid ? 'text-green' : 'muted'}>
                            {statusText(payStatus)} ({money(amount)})
                          </span>
                          {item.status === 'ACTIVE' && (
                            <button
                              type="button"
                              className="btn outline small"
                              disabled={busy}
                              onClick={() => openExtendModal(item)}
                            >
                              + Продовжити
                            </button>
                          )}
                          {payment?.status === 'UNPAID' && item.status === 'PENDING_PAYMENT' && (
                            <div className="actions admin-payment-actions">
                              <button
                                type="button"
                                className="text-button"
                                disabled={busy}
                                onClick={() =>
                                  ask({
                                    type: 'payment',
                                    label: `абонемент №${item.id}`,
                                    payment,
                                    method: 'CARD',
                                  })
                                }
                              >
                                Картка
                              </button>
                              <button
                                type="button"
                                className="text-button"
                                disabled={busy}
                                onClick={() =>
                                  ask({
                                    type: 'payment',
                                    label: `абонемент №${item.id}`,
                                    payment,
                                    method: 'CASH',
                                  })
                                }
                              >
                                Готівка
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        {payment?.status === 'REFUND_PENDING' ? (
                          <button
                            type="button"
                            className="text-button danger"
                            disabled={busy}
                            onClick={() =>
                              ask({
                                type: 'refund',
                                label: `абонемент №${item.id}`,
                                payment,
                              })
                            }
                          >
                            Підтвердити повернення
                          </button>
                        ) : canAdminCancelSubscription(item) ? (
                          <button
                            type="button"
                            className="text-button danger"
                            disabled={busy}
                            onClick={() => ask({ type: 'cancelSubscription', subscription: item })}
                          >
                            Скасувати
                          </button>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">Абонементів за обраними фільтрами не знайдено.</p>
        )
      ) : tab === 'payments' ? (
        visiblePayments.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>ДАТА</th>
                  <th>КЛІЄНТ</th>
                  <th>ПРИЗНАЧЕННЯ</th>
                  <th>МЕТОД</th>
                  <th>СУМА</th>
                  <th>СТАТУС ПЛАТЕЖУ</th>
                  <th>ЗМІНИТИ СТАТУС</th>
                </tr>
              </thead>
              <tbody>
                {visiblePayments.map(payment => {
                  const booking = payment.bookingId ? bookingsById.get(payment.bookingId) : undefined;
                  const sub = payment.subscriptionId ? subscriptionsById.get(payment.subscriptionId) : undefined;
                  const ownerId = booking?.userId ?? sub?.userId ?? 0;
                  const purpose = booking
                    ? `Бронювання: ${booking.workspaceName || `№${booking.id}`}`
                    : sub
                      ? `Абонемент №${sub.id}`
                      : `Платіж №${payment.id}`;
                  const dateLabel = (payment.createdAt ?? booking?.bookingDate ?? sub?.startDate ?? '—').slice(0, 10);

                  return (
                    <tr key={payment.id}>
                      <td>{dateLabel}</td>
                      <td>{ownerId ? clientName(ownerId, clients[ownerId]) : 'Клієнт'}</td>
                      <td>{purpose}</td>
                      <td>{paymentMethodLabel(payment.paymentMethod)}</td>
                      <td>
                        <strong>{money(payment.amount)}</strong>
                      </td>
                      <td>
                        <span
                          className={`status ${payment.status === 'PAID'
                              ? 'active'
                              : payment.status === 'UNPAID' || payment.status === 'REFUND_PENDING'
                                ? 'pending'
                                : 'completed'
                            }`}
                        >
                          {statusText(payment.status)}
                        </span>
                      </td>
                      <td>
                        {payment.status === 'PAID' && (
                          <button
                            type="button"
                            className="text-button danger"
                            disabled={busy}
                            onClick={() => ask({ type: 'refund', label: purpose, payment })}
                          >
                            Оформити повернення
                          </button>
                        )}
                        {payment.status === 'REFUND_PENDING' && (
                          <button
                            type="button"
                            className="text-button danger"
                            disabled={busy}
                            onClick={() => ask({ type: 'refund', label: purpose, payment })}
                          >
                            Підтвердити повернення
                          </button>
                        )}
                        {payment.status === 'UNPAID' && (
                          <div className="pay-choice-group">
                            <span className="pay-choice-label">Сплатити</span>
                            <div className="pay-choice-links">
                              <button
                                type="button"
                                className="text-button"
                                disabled={busy}
                                onClick={() => ask({ type: 'payment', label: purpose, payment, method: 'CASH' })}
                              >
                                Готівка
                              </button>
                              <span className="pay-choice-sep">/</span>
                              <button
                                type="button"
                                className="text-button"
                                disabled={busy}
                                onClick={() => ask({ type: 'payment', label: purpose, payment, method: 'CARD' })}
                              >
                                Картка
                              </button>
                            </div>
                          </div>
                        )}
                        {payment.status === 'REFUNDED' && <span className="muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">Платежів за обраним фільтром не знайдено.</p>
        )
      ) : tab === 'closedDays' ? (
        <div className="admin-closed-days">
          <form className="closed-day-form" onSubmit={handleAddClosedDay}>
            <label className="closed-day-label">
              Позначити дату як неробочий день
              <div className="closed-day-row">
                <input
                  type="date"
                  value={newClosedDate}
                  required
                  disabled={busy}
                  onChange={e => setNewClosedDate(e.target.value)}
                />
                <input
                  type="text"
                  value={newClosedReason}
                  required
                  disabled={busy}
                  placeholder="Причина (напр. ремонтні роботи)"
                  onChange={e => setNewClosedReason(e.target.value)}
                />
                <button type="submit" className="btn small" disabled={busy}>
                  Додати неробочий день +
                </button>
              </div>
            </label>
          </form>

          {closedDays.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>ДАТА</th>
                    <th>ПРИЧИНА НЕРОБОЧОГО ДНЯ</th>
                    <th>ДІЇ</th>
                  </tr>
                </thead>
                <tbody>
                  {closedDays.map(day => (
                    <tr key={day.date}>
                      <td>{day.date}</td>
                      <td>{day.reason}</td>
                      <td>
                        <button
                          type="button"
                          className="text-button danger"
                          disabled={busy}
                          onClick={() => ask({ type: 'deleteClosedDay', date: day.date })}
                        >
                          Скасувати статус
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Неробочих днів поки немає.</p>
          )}
        </div>
      ) : tab === 'workspaces' ? (
        <div>
          {workspaces.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>НАЗВА</th>
                    <th>ЗОНА</th>
                    <th>МІСТКІСТЬ</th>
                    <th>ТАРИФ / ГОД</th>
                    <th>СТАТУС</th>
                    <th>ДІЇ</th>
                  </tr>
                </thead>
                <tbody>
                  {workspaces.map(ws => {
                    const isRoom = ws.type === 'MEETING_ROOM';
                    const isFree = availability[ws.id] !== false;
                    const price = hourlyPriceByType[ws.type] ?? (isRoom ? 200 : 150);
                    return (
                      <tr key={ws.id}>
                        <td>
                          <strong>{ws.name || displayWorkspace(ws)}</strong>
                        </td>
                        <td>{isRoom ? 'Окрема кімната' : 'Загальна зала'}</td>
                        <td>{isRoom ? '6 чол.' : '1 чол.'}</td>
                        <td>
                          <strong>{price} ГРН</strong>
                        </td>
                        <td>
                          <span className={`status ${isFree ? 'active' : 'cancelled'}`}>
                            {isFree ? 'ВІЛЬНИЙ' : 'ЗАЙНЯТИЙ'}
                          </span>
                        </td>
                        <td>
                          <div className="actions">
                            <button
                              type="button"
                              className="text-button muted-link"
                              disabled={busy}
                              onClick={() => openWorkspaceModal('edit', ws)}
                            >
                              Редагувати
                            </button>
                            <button
                              type="button"
                              className="text-button danger"
                              disabled={busy}
                              onClick={() => ask({ type: 'deleteWorkspace', workspace: ws })}
                            >
                              Видалити
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Робочих місць не знайдено.</p>
          )}

          <div className="admin-footer-bar">
            <span className="muted">Список усіх робочих місць ({workspaces.length})</span>
            <button type="button" className="btn small" disabled={busy} onClick={() => openWorkspaceModal('create')}>
              Додати місце +
            </button>
          </div>
        </div>
      ) : tab === 'gallery' ? (
        <div className="admin-gallery">
          <form className="closed-day-form" onSubmit={handleGalleryUpload}>
            <label className="closed-day-label">
              Додати фото до галереї (JPG, PNG або WebP, до 5 МБ)
              <div className="closed-day-row">
                <select
                  value={galleryCategory}
                  disabled={busy}
                  onChange={e => setGalleryCategory(e.target.value)}
                >
                  <option value="Переговорна кімната">Переговорна кімната</option>
                  <option value="Кімната коворкінгу">Кімната коворкінгу</option>
                  <option value="Кухня">Кухня</option>
                  <option value="Зони відпочинку">Зони відпочинку</option>
                </select>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                  disabled={busy}
                  onChange={e => handleGalleryFileChange(e.target.files?.[0] ?? null)}
                />
                <button type="submit" className="btn small" disabled={busy || !galleryFile}>
                  {busy ? 'Завантаження…' : 'Завантажити +'}
                </button>
              </div>
            </label>
          </form>

          {galleryImages.length ? (
            <div className="admin-tariffs-grid">
              {galleryImages.map(img => (
                <article className="pricing-card admin-tariff-card" key={img.id}>
                  <div style={{ aspectRatio: '16 / 10', borderRadius: 12, overflow: 'hidden', marginBottom: 12, background: '#eee' }}>
                    <img
                      src={galleryImageUrl(img)}
                      alt={img.caption || `Фото №${img.id}`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      loading="lazy"
                    />
                  </div>
                  <strong>{img.caption || 'Без категорії'}</strong>
                  <small className="muted" style={{ marginBottom: 12 }}>
                    {(img.sizeBytes / (1024 * 1024)).toFixed(2)} МБ · {img.contentType.replace('image/', '').toUpperCase()}
                  </small>
                  <div className="admin-tariff-actions">
                    <button
                      type="button"
                      className="text-button danger"
                      disabled={busy}
                      onClick={() => ask({ type: 'deleteGalleryImage', image: img })}
                    >
                      Видалити
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty">Завантажених фото поки немає (відображаються стандартні фото сайту).</p>
          )}
        </div>
      ) : (
        <div>
          <div className="admin-tariffs-grid">
            {tariffs.map(tariff => {
              const meta = tariffMeta(tariff);
              return (
                <article className="pricing-card admin-tariff-card" key={tariff.id}>
                  <p className="eyebrow">{meta.category}</p>
                  <h3>{meta.title}</h3>
                  <div className="plan-price">
                    <strong>{tariff.price} грн</strong>
                    <span>/{meta.unit}</span>
                  </div>
                  <ul className="checks">
                    {meta.features.map(feat => (
                      <li key={feat}>✓ {feat}</li>
                    ))}
                  </ul>
                  <div className="admin-tariff-actions">
                    <button
                      type="button"
                      className="text-button muted-link"
                      disabled={busy}
                      onClick={() => openTariffModal('edit', tariff)}
                    >
                      Редагувати
                    </button>
                    <button
                      type="button"
                      className="text-button danger"
                      disabled={busy}
                      onClick={() => ask({ type: 'deleteTariff', tariff })}
                    >
                      Видалити
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="admin-footer-bar">
            <span className="muted">Список усіх тарифів ({tariffs.length})</span>
            <button type="button" className="btn small" disabled={busy} onClick={() => openTariffModal('create')}>
              Додати тариф +
            </button>
          </div>
        </div>
      )}

      {!loading && !loadError && ['users', 'bookings', 'subscriptions', 'payments'].includes(tab) && (
        <Pager
          page={visiblePage}
          total={totalPages}
          change={next => {
            if (!busy) {
              setPage(next);
              setConfirm(null);
            }
          }}
        />
      )}

      {/* Вкладена модалка: Продовжити термін абонементу */}
      {extendSub && (
        <Modal title="Продовжити термін абонементу" onClose={() => !busy && setExtendSub(null)}>
          <p className="muted">
            Клієнт: <strong>{clientName(extendSub.userId, clients[extendSub.userId])}</strong>. Поточна дата завершення:{' '}
            <strong>{extendSub.endDate}</strong>
          </p>
          {error && <Alert>{error}</Alert>}
          <form className="form" onSubmit={handleExtendSubmit}>
            <label>
              Нова дата завершення дії
              <input
                type="date"
                min={addDays(extendSub.endDate, 1)}
                value={extendEndDate}
                required
                disabled={busy}
                onChange={e => setExtendEndDate(e.target.value)}
              />
            </label>
            <label>
              Причини продовження
              <input
                type="text"
                value={extendReason}
                placeholder="Наприклад: компенсація за ремонтні роботи"
                disabled={busy}
                onChange={e => setExtendReason(e.target.value)}
              />
            </label>
            <div className="actions align-right">
              <button type="button" className="btn outline small" disabled={busy} onClick={() => setExtendSub(null)}>
                Скасувати
              </button>
              <button type="submit" className="btn small" disabled={busy}>
                {busy ? 'Збереження…' : 'Зберегти'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {/* Вкладена модалка: Редагувати / Додати робоче місце */}
      {workspaceModal && (
        <Modal
          title={workspaceModal.mode === 'edit' ? 'Редагувати робоче місце' : 'Додати робоче місце'}
          onClose={() => !busy && setWorkspaceModal(null)}
        >
          {error && <Alert>{error}</Alert>}
          <form className="form" onSubmit={handleWorkspaceSubmit}>
            <label>
              Назва місця
              <input
                type="text"
                value={wsName}
                placeholder="Стіл №3"
                required
                disabled={busy}
                onChange={e => setWsName(e.target.value)}
              />
            </label>
            <label>
              Зона / тип приміщення
              <select value={wsType} disabled={busy} onChange={e => setWsType(e.target.value as WorkspaceType)}>
                <option value="DESK">Загальна зала (1 чол.)</option>
                <option value="MEETING_ROOM">Окрема кімната (6 чол.)</option>
              </select>
            </label>
            <div className="actions align-right">
              <button
                type="button"
                className="btn outline small"
                disabled={busy}
                onClick={() => setWorkspaceModal(null)}
              >
                Скасувати
              </button>
              <button type="submit" className="btn small" disabled={busy}>
                {busy ? 'Збереження…' : 'Зберегти'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Вкладена модалка: Створити / Редагувати тариф */}
      {tariffModal && (
        <Modal
          title={tariffModal.mode === 'edit' ? 'Редагувати тариф' : 'Створити тариф'}
          onClose={() => !busy && setTariffModal(null)}
        >
          {error && <Alert>{error}</Alert>}
          <form className="form" onSubmit={handleTariffSubmit}>
            <label>
              Категорія (бейдж)
              <select
                value={tfWorkspaceType}
                disabled={busy}
                onChange={e => {
                  const nextType = e.target.value as WorkspaceType;
                  setTfWorkspaceType(nextType);
                  if (nextType === 'MEETING_ROOM') setTfBookingType('HOURLY');
                }}
              >
                <option value="DESK">Робоче місце</option>
                <option value="MEETING_ROOM">Окрема кімната</option>
              </select>
            </label>
            <div className="form-row">
              <label>
                Вартість (грн)
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={tfPrice}
                  required
                  disabled={busy}
                  onChange={e => setTfPrice(e.target.value)}
                />
              </label>
              <label>
                Одиниця (година/день/місяць)
                <select
                  value={tfBookingType}
                  disabled={busy || tfWorkspaceType === 'MEETING_ROOM'}
                  onChange={e => setTfBookingType(e.target.value as BookingType)}
                >
                  <option value="HOURLY">година</option>
                  <option value="DAILY">день</option>
                  <option value="SUBSCRIPTION">місяць</option>
                </select>
              </label>
            </div>
            <div className="actions align-right">
              <button type="button" className="btn outline small" disabled={busy} onClick={() => setTariffModal(null)}>
                Скасувати
              </button>
              <button type="submit" className="btn small" disabled={busy}>
                {busy ? 'Збереження…' : tariffModal.mode === 'edit' ? 'Зберегти' : 'Додати +'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Modal>
  );
}