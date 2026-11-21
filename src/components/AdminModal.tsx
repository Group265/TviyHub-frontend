import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { bookingAlreadyStartedError, errorMessage } from '../api/errors';
import type { AdminUser, Booking, InPersonPaymentMethod, Page, Payment, Workspace } from '../api/types';
import { bookingDisplayStatus, bookingTypeText, canCancelBooking, displayWorkspace, money, roleText, statusText, venueDateTime } from '../booking';
import { Alert, Modal, Pager } from './ui';
import { useVenueClock } from '../useVenueClock';

const pageSize = 10;
type Tab = 'bookings' | 'users';
type BookingSort = 'recent' | 'oldest' | 'client' | 'payment';
type UserSort = 'recent' | 'name';
type Action =
  | { type: 'user'; user: AdminUser; blocked: boolean }
  | { type: 'payment'; booking: Booking; payment: Payment; method: InPersonPaymentMethod }
  | { type: 'cancel'; booking: Booking };

const paymentSort: Record<string, number> = { UNPAID: 1, PAID: 2, REFUNDED: 3 };
const collator = new Intl.Collator('uk', { sensitivity: 'base', numeric: true });
const bookingDate = (booking: Booking) => [booking.bookingDate, booking.startTime ?? '09:00'].join(' ');
const clientName = (booking: Booking, clients: Record<number, AdminUser>) =>
  clients[booking.userId]?.name || ('Клієнт №' + booking.userId);

function confirmationText(action: Action): string {
  if (action.type === 'cancel') return 'Скасувати бронювання №' + action.booking.id + '?';
  if (action.type === 'payment') {
    const method = action.method === 'CASH' ? 'готівкою' : 'карткою через термінал';
    return 'Підтвердити отримання ' + money(action.payment.amount) + ' ' + method + ' за бронювання №' + action.booking.id + '?';
  }
  const verb = action.blocked ? 'заблокувати' : 'розблокувати';
  return 'Ви впевнені, що хочете ' + verb + ' користувача «' + action.user.name + '»?';
}

export function AdminModal({ onClose, onChanged, userId, workspaces }: {
  onClose: () => void;
  onChanged: () => void;
  userId: number;
  workspaces: Workspace[];
}) {
  const [tab, setTab] = useState<Tab>('bookings');
  const [users, setUsers] = useState<Page<AdminUser> | null>(null);
  const [clients, setClients] = useState<Record<number, AdminUser>>({});
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [userSort, setUserSort] = useState<UserSort>('recent');
  const [bookingSort, setBookingSort] = useState<BookingSort>('recent');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const now = venueDateTime(useVenueClock());
  const canConfirm = confirm && (confirm.type !== 'cancel' || canCancelBooking(confirm.booking, now));
  const userPage = tab === 'users' ? page : 0;
  const userSearch = tab === 'users' ? search.trim() : '';

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
        const result = await api.adminUsers(userPage, userSearch, userSort, signal);
        if (!signal.aborted) setUsers(result);
        return;
      }

      const [rows, transactions] = await Promise.all([api.bookings(signal), api.adminPayments(signal)]);
      const clientRows = await api.adminBookingClients(rows.map(booking => booking.userId), signal);
      if (signal.aborted) return;
      setBookings(rows);
      setPayments(transactions);
      setClients(Object.fromEntries(clientRows.map(user => [user.id, user])));
    }

    load().catch(err => {
      if (signal.aborted) return;
      const action = tab === 'users' ? 'Не вдалося завантажити користувачів.' : 'Не вдалося завантажити дані про бронювання.';
      setLoadError((action + ' ' + errorMessage(err, '')).trim());
    }).finally(() => {
      if (!signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [tab, userPage, userSearch, userSort, revision]);

  const bookingPayments = useMemo(() => new Map(payments.filter(payment => payment.bookingId != null)
    .map(payment => [payment.bookingId, payment])), [payments]);

  const sortedBookings = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('uk');
    return bookings.filter(booking => {
      if (!term) return true;
      const client = clients[booking.userId];
      return [clientName(booking, clients), client?.email, client?.phone].some(value => value?.toLocaleLowerCase('uk').includes(term));
    }).sort((left, right) => {
      const newest = bookingDate(right).localeCompare(bookingDate(left)) || right.id - left.id;
      if (bookingSort === 'oldest') return -newest;
      if (bookingSort === 'client') return collator.compare(clientName(left, clients), clientName(right, clients)) || newest;
      if (bookingSort === 'payment') {
        const leftStatus = bookingPayments.get(left.id)?.status ?? left.paymentStatus;
        const rightStatus = bookingPayments.get(right.id)?.status ?? right.paymentStatus;
        return (paymentSort[leftStatus] ?? 4) - (paymentSort[rightStatus] ?? 4) || newest;
      }
      return newest;
    });
  }, [bookings, bookingPayments, bookingSort, clients, search]);

  const totalPages = tab === 'users' ? users?.totalPages ?? 0 : Math.ceil(sortedBookings.length / pageSize);
  const visiblePage = tab === 'users' ? page : Math.min(page, Math.max(0, totalPages - 1));
  const visibleBookings = sortedBookings.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize);

  function changeTab(next: Tab) {
    setTab(next);
    setPage(0);
    setSearch('');
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
        if (updated?.id !== confirm.user.id || typeof updated.blocked !== 'boolean') {
          throw new Error('Missing user status');
        }
        setUsers(current => current && { ...current, content: current.content.map(user => user.id === updated.id ? updated : user) });
        setConfirm(null);
        if (updated.blocked !== confirm.blocked) {
          setError('Сервер не підтвердив зміну статусу користувача.');
          return;
        }
        setNotice(updated.name + (updated.blocked ? ' — доступ заблоковано.' : ' — доступ відновлено.'));
        return;
      }

      if (confirm.type === 'payment') {
        const updated = await api.updatePayment(confirm.payment.id, confirm.method);
        if (updated?.status !== 'PAID') throw new Error('Missing payment confirmation');
        setNotice('Оплату бронювання №' + confirm.booking.id + ' підтверджено.');
      } else {
        await api.cancel(confirm.booking.id);
        setNotice('Бронювання №' + confirm.booking.id + ' скасовано.');
      }
      setConfirm(null);
      setRevision(value => value + 1);
      onChanged();
    } catch (err) {
      const fallback = confirm.type === 'user' ? 'Не вдалося змінити статус користувача.' :
        confirm.type === 'payment' ? 'Не вдалося підтвердити оплату.' : 'Не вдалося скасувати бронювання.';
      setError(errorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  return <Modal title="Адмін-панель" onClose={() => { if (!busy) onClose(); }} wide>
    <div className="actions admin-tabs">
      <button className={tab === 'users' ? 'btn' : 'btn outline'} aria-pressed={tab === 'users'} disabled={busy} onClick={() => changeTab('users')}>Усі користувачі</button>
      <button className={tab === 'bookings' ? 'btn' : 'btn outline'} aria-pressed={tab === 'bookings'} disabled={busy} onClick={() => changeTab('bookings')}>Усі бронювання</button>
    </div>
    <div className="admin-filters">
      <label className="search">Пошук {tab === 'users' ? 'користувача' : 'клієнта'}
        <input type="search" value={search} disabled={busy} onChange={e => { setSearch(e.target.value); setPage(0); setConfirm(null); }} placeholder="Ім’я, пошта або телефон" />
      </label>
      <label className="search">Сортування
        {tab === 'users' ? <select value={userSort} disabled={busy} onChange={e => { setUserSort(e.target.value as UserSort); setPage(0); setConfirm(null); }}>
          <option value="recent">Спочатку нові користувачі</option>
          <option value="name">За ім’ям</option>
        </select> : <select value={bookingSort} disabled={busy} onChange={e => { setBookingSort(e.target.value as BookingSort); setPage(0); setConfirm(null); }}>
          <option value="recent">За датою від новішої</option>
          <option value="oldest">За датою від давнішої</option>
          <option value="client">За ім’ям клієнта</option>
          <option value="payment">За статусом оплати</option>
        </select>}
      </label>
    </div>
    {error && <Alert>{error}</Alert>}
    {notice && <Alert success>{notice}</Alert>}
    {canConfirm && <div className="confirm-panel">
      <p>{confirmationText(confirm)}</p>
      <div className="actions">
        <button className="btn small" disabled={busy} onClick={perform}>{busy ? 'Зачекайте…' : 'Підтвердити'}</button>
        <button ref={backButton} className="btn outline small" disabled={busy} onClick={() => setConfirm(null)}>Назад</button>
      </div>
    </div>}
    {loading ? <p role="status">Завантаження…</p> : loadError ? <Alert>{loadError}</Alert> : tab === 'users' ?
      users?.content.length ? <div className="table-scroll"><table>
        <thead><tr><th>Реєстрація</th><th>Користувач</th><th>Електронна пошта</th><th>Роль</th><th>Статус</th><th>Дії адміністратора</th></tr></thead>
        <tbody>{users.content.map(user => <tr key={user.id}>
          <td>{user.createdAt.slice(0, 10)}</td><td>{user.name}<small>{user.phone}</small></td><td>{user.email}</td><td>{roleText(user.role)}</td>
          <td><span className={'status ' + (user.blocked ? 'cancelled' : 'active')}>{user.blocked ? 'Заблокований' : 'Активний'}</span></td>
          <td><button className={'text-button' + (user.blocked ? '' : ' danger')} disabled={busy || user.id === userId} onClick={() => ask({ type: 'user', user, blocked: !user.blocked })}>
            {user.blocked ? 'Розблокувати' : 'Заблокувати'}
          </button></td>
        </tr>)}</tbody>
      </table></div> : <p className="empty">Користувачів не знайдено.</p> :
      visibleBookings.length ? <div className="table-scroll"><table>
        <thead><tr><th>Дата / час</th><th>Клієнт</th><th>Ресурс / тариф</th><th>Сума</th><th>Статус</th><th>Оплата</th><th>Дії</th></tr></thead>
        <tbody>{visibleBookings.map(booking => {
          const payment = bookingPayments.get(booking.id);
          const workspace = workspaces.find(item => item.id === booking.workspaceId);
          const status = bookingDisplayStatus(booking, now);
          const statusClass = status === 'CANCELLED' ? 'cancelled' : status === 'COMPLETED' ? 'completed' : '';
          const canRecordPayment = payment?.status === 'UNPAID' && payment.paymentMethod !== 'STRIPE' && canCancelBooking(booking, now);
          return <tr key={booking.id}>
            <td>{booking.bookingDate}<small>{booking.startTime?.slice(0, 5)}–{booking.endTime?.slice(0, 5)}</small></td>
            <td>{clientName(booking, clients)}<small>{clients[booking.userId]?.phone}</small></td>
            <td>{displayWorkspace(workspace ?? { id: booking.workspaceId, name: booking.workspaceName ?? '' })}<small>{bookingTypeText(booking.bookingType)}</small></td>
            <td>{money(booking.totalPrice)}</td>
            <td><span className={'status ' + statusClass}>{statusText(status)}</span></td>
            <td>{statusText(payment?.status ?? booking.paymentStatus)}
              {canRecordPayment && <div className="actions admin-payment-actions">
                <button className="text-button" disabled={busy} onClick={() => ask({ type: 'payment', booking, payment, method: 'CASH' })}>Готівка</button>
                <button className="text-button" disabled={busy} onClick={() => ask({ type: 'payment', booking, payment, method: 'CARD' })}>Термінал</button>
              </div>}
            </td>
            <td>{canCancelBooking(booking, now) && <button className="text-button danger" disabled={busy} onClick={() => ask({ type: 'cancel', booking })}>Скасувати</button>}</td>
          </tr>;
        })}</tbody>
      </table></div> : <p className="empty">Бронювань не знайдено.</p>}
    {!loading && !loadError && <Pager page={visiblePage} total={totalPages} change={next => { if (!busy) { setPage(next); setConfirm(null); } }} />}
  </Modal>;
}
