import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { bookingAlreadyStartedError, errorMessage } from '../api/errors';
import type { AdminUser, Booking, InPersonPaymentMethod, Page, Payment, Subscription, Workspace } from '../api/types';
import { bookingDisplayStatus, bookingTypeText, canAdminCancelSubscription, canCancelBooking, displayWorkspace, money, roleText, statusText, venueDateTime } from '../booking';
import { Alert, Modal, Pager } from './ui';
import { useVenueClock } from '../useVenueClock';

const pageSize = 10;
type Tab = 'bookings' | 'subscriptions' | 'users';
type TableSort = 'recent' | 'oldest' | 'client' | 'status' | 'payment';
type UserSort = 'recent' | 'name';
type Action =
  | { type: 'user'; user: AdminUser; blocked: boolean }
  | { type: 'payment'; booking: Booking; payment: Payment; method: InPersonPaymentMethod }
  | { type: 'refund'; label: string; payment: Payment }
  | { type: 'cancel'; booking: Booking }
  | { type: 'cancelSubscription'; subscription: Subscription };;

const paymentOrder: Record<string, number> = { UNPAID: 1, PAID: 2, REFUND_PENDING: 3, REFUNDED: 4 };
const collator = new Intl.Collator('uk', { sensitivity: 'base', numeric: true });
const comparePayment = (left: string, right: string) => (paymentOrder[left] ?? 5) - (paymentOrder[right] ?? 5);
const bookingDate = (booking: Booking) => [booking.bookingDate, booking.startTime ?? '09:00'].join(' ');
const clientName = (userId: number, client?: AdminUser) => client?.name || ('Клієнт №' + userId);
const matchesClient = (userId: number, client: AdminUser | undefined, term: string) =>
  !term || [clientName(userId, client), client?.email, client?.phone].some(value => value?.toLocaleLowerCase('uk').includes(term));

function confirmationText(action: Action): string {
  if (action.type === 'cancelSubscription') return 'Скасувати абонемент №' + action.subscription.id + '?';
  if (action.type === 'cancel') return 'Скасувати бронювання №' + action.booking.id + '?';
  if (action.type === 'refund') {
    return 'Підтвердити повернення ' + money(action.payment.amount) + ' за ' + action.label + '?';
  }
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
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [userSort, setUserSort] = useState<UserSort>('recent');
  const [bookingSort, setBookingSort] = useState<TableSort>('recent');
  const [subscriptionSort, setSubscriptionSort] = useState<TableSort>('recent');
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

      const [rows, subscriptionRows, transactions] = tab === 'bookings'
        ? await Promise.all([api.bookings(signal), Promise.resolve([]), api.adminPayments(signal)])
        : await Promise.all([Promise.resolve([]), api.adminSubscriptions(signal), api.adminPayments(signal)]);
      const entries = tab === 'subscriptions' ? subscriptionRows : rows;
      const clientRows = await api.adminClients(entries.map(item => item.userId), signal);
      if (signal.aborted) return;
      setBookings(rows);
      setSubscriptions(subscriptionRows);
      setPayments(transactions);
      setClients(Object.fromEntries(clientRows.map(user => [user.id, user])));
    }

    load().catch(err => {
      if (signal.aborted) return;
      const action = tab === 'users' ? 'Не вдалося завантажити користувачів.' :
        tab === 'subscriptions' ? 'Не вдалося завантажити абонементи.' : 'Не вдалося завантажити дані про бронювання.';
      setLoadError((action + ' ' + errorMessage(err, '')).trim());
    }).finally(() => {
      if (!signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [tab, userPage, userSearch, userSort, revision]);

  const bookingPayments = useMemo(() => new Map(payments.filter(payment => payment.bookingId != null)
    .map(payment => [payment.bookingId, payment])), [payments]);

  const subscriptionPayments = useMemo(() => new Map(payments.filter(payment => payment.subscriptionId != null)
    .map(payment => [payment.subscriptionId, payment])), [payments]);

  const sortedBookings = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('uk');
    return bookings.filter(booking => matchesClient(booking.userId, clients[booking.userId], term)).sort((left, right) => {
      const newest = bookingDate(right).localeCompare(bookingDate(left)) || right.id - left.id;
      if (bookingSort === 'oldest') return -newest;
      if (bookingSort === 'client') return collator.compare(
        clientName(left.userId, clients[left.userId]), clientName(right.userId, clients[right.userId]),
      ) || newest;
      const order = bookingSort === 'status' ? collator.compare(
        statusText(bookingDisplayStatus(left, now)), statusText(bookingDisplayStatus(right, now)),
      ) : bookingSort === 'payment' ? comparePayment(
        bookingPayments.get(left.id)?.status ?? left.paymentStatus, bookingPayments.get(right.id)?.status ?? right.paymentStatus,
      ) : 0;
      return order || newest;
    });
  }, [bookings, bookingPayments, bookingSort, clients, search, now]);

  const sortedSubscriptions = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('uk');
    return subscriptions.filter(item => matchesClient(item.userId, clients[item.userId], term))
      .sort((left, right) => {
        const newest = right.startDate.localeCompare(left.startDate) || right.id - left.id;
        if (subscriptionSort === 'oldest') return -newest;
        if (subscriptionSort === 'client') return collator.compare(
          clientName(left.userId, clients[left.userId]), clientName(right.userId, clients[right.userId]),
        ) || newest;
        const order = subscriptionSort === 'status' ? collator.compare(statusText(left.status), statusText(right.status)) :
          subscriptionSort === 'payment' ? comparePayment(
            subscriptionPayments.get(left.id)?.status ?? left.paymentStatus,
            subscriptionPayments.get(right.id)?.status ?? right.paymentStatus,
          ) : 0;
        return order || newest;
      });
  }, [subscriptions, subscriptionPayments, clients, search, subscriptionSort]);

  const entryCount = tab === 'subscriptions' ? sortedSubscriptions.length : sortedBookings.length;
  const totalPages = tab === 'users' ? users?.totalPages ?? 0 : Math.ceil(entryCount / pageSize);
  const visiblePage = tab === 'users' ? page : Math.min(page, Math.max(0, totalPages - 1));
  const visibleBookings = sortedBookings.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize);
  const visibleSubscriptions = sortedSubscriptions.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize);
  function changeTableSort(sort: TableSort) {
    if (tab === 'subscriptions') setSubscriptionSort(sort);
    else setBookingSort(sort);
    setPage(0);
    setConfirm(null);
  }

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
      } else if (confirm.type === 'refund') {
        const updated = await api.confirmRefund(confirm.payment.id);
        if (updated?.status !== 'REFUNDED') throw new Error('Missing refund confirmation');
        setNotice('Повернення коштів за ' + confirm.label + ' підтверджено.');
      } else if (confirm.type === 'cancelSubscription') {
        await api.adminCancelSubscription(confirm.subscription.id);
        setNotice('Абонемент №' + confirm.subscription.id + ' скасовано.');
      } else {
        await api.cancel(confirm.booking.id);
        setNotice('Бронювання №' + confirm.booking.id + ' скасовано.');
      }
      setConfirm(null);
      setRevision(value => value + 1);
      onChanged();
    } catch (err) {
      const fallback = confirm.type === 'user' ? 'Не вдалося змінити статус користувача.' :
        confirm.type === 'payment' ? 'Не вдалося підтвердити оплату.' :
        confirm.type === 'refund' ? 'Не вдалося підтвердити повернення коштів.' :
        confirm.type === 'cancelSubscription' ? 'Не вдалося скасувати абонемент.' : 'Не вдалося скасувати бронювання.';
      setError(errorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  return <Modal title="Адмін-панель" onClose={() => { if (!busy) onClose(); }} wide>
    <div className="actions admin-tabs">
      <button className={tab === 'users' ? 'btn' : 'btn outline'} aria-pressed={tab === 'users'} disabled={busy} onClick={() => changeTab('users')}>Усі користувачі</button>
      <button className={tab === 'bookings' ? 'btn' : 'btn outline'} aria-pressed={tab === 'bookings'} disabled={busy} onClick={() => changeTab('bookings')}>Усі бронювання</button>
      <button className={tab === 'subscriptions' ? 'btn' : 'btn outline'} aria-pressed={tab === 'subscriptions'} disabled={busy} onClick={() => changeTab('subscriptions')}>Абонементи</button>
    </div>
    <div className="admin-filters">
      <label className="search">Пошук {tab === 'users' ? 'користувача' : 'клієнта'}
        <input type="search" value={search} disabled={busy} onChange={e => { setSearch(e.target.value); setPage(0); setConfirm(null); }} placeholder="Ім’я, пошта або телефон" />
      </label>
      <label className="search">Сортування
        {tab === 'users' ? <select value={userSort} disabled={busy} onChange={e => { setUserSort(e.target.value as UserSort); setPage(0); setConfirm(null); }}>
          <option value="recent">Спочатку нові користувачі</option>
          <option value="name">За ім’ям</option>
        </select> : <select value={tab === 'subscriptions' ? subscriptionSort : bookingSort} disabled={busy}
          onChange={e => changeTableSort(e.target.value as TableSort)}>
          <option value="recent">{tab === 'subscriptions' ? 'За датою початку від новішої' : 'За датою від новішої'}</option>
          <option value="oldest">{tab === 'subscriptions' ? 'За датою початку від давнішої' : 'За датою від давнішої'}</option>
          <option value="client">За ім’ям клієнта</option>
          <option value="status">{tab === 'subscriptions' ? 'За статусом абонемента' : 'За статусом бронювання'}</option>
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
      tab === 'subscriptions' ?
      visibleSubscriptions.length ? <div className="table-scroll"><table>
        <thead><tr><th scope="col">№ абонемента</th><th>Клієнт</th><th>Місце</th><th>Період</th><th scope="col">Статус</th><th scope="col">Оплата</th><th>Дії</th></tr></thead>
        <tbody>{visibleSubscriptions.map(item => {
          const client = clients[item.userId];
          const workspace = workspaces.find(workspace => workspace.id === item.workspaceId);
          const payment = subscriptionPayments.get(item.id);
          const canRefund = payment?.status === 'REFUND_PENDING';
          return <tr key={item.id}>
            <td>№{item.id}</td>
            <td>{clientName(item.userId, client)}<small>{client?.phone}</small></td>
            <td>{displayWorkspace(workspace ?? { id: item.workspaceId, name: '' })}</td>
            <td>{item.startDate} — {item.endDate}</td>
            <td>{statusText(item.status)}</td>
            <td>{statusText(payment?.status ?? item.paymentStatus)}
              {canRefund && <div className="actions admin-payment-actions">
                <button className="text-button" disabled={busy} onClick={() => ask({ type: 'refund', label: 'абонемент №' + item.id, payment })}>Підтвердити повернення</button>
              </div>}
            </td>
            <td>{canAdminCancelSubscription(item) && <button className="text-button danger" disabled={busy} onClick={() => ask({ type: 'cancelSubscription', subscription: item })}>Скасувати</button>}</td>
          </tr>;
        })}</tbody>
      </table></div> : <p className="empty">Абонементів не знайдено.</p> :
      visibleBookings.length ? <div className="table-scroll"><table>
        <thead><tr><th scope="col">№ бронювання</th><th>Дата / час</th><th>Клієнт</th><th>Ресурс / тариф</th><th>Сума</th><th scope="col">Статус</th><th scope="col">Оплата</th><th>Дії</th></tr></thead>
        <tbody>{visibleBookings.map(booking => {
          const payment = bookingPayments.get(booking.id);
          const workspace = workspaces.find(item => item.id === booking.workspaceId);
          const status = bookingDisplayStatus(booking, now);
          const statusClass = status === 'CANCELLED' ? 'cancelled' : status === 'COMPLETED' ? 'completed' : '';
          const canRecordPayment = payment?.status === 'UNPAID' && payment.paymentMethod !== 'STRIPE' && canCancelBooking(booking, now);
          const canRefund = payment?.status === 'REFUND_PENDING';
          return <tr key={booking.id}>
            <td>№{booking.id}</td>
            <td>{booking.bookingDate}<small>{booking.startTime?.slice(0, 5)}–{booking.endTime?.slice(0, 5)}</small></td>
            <td>{clientName(booking.userId, clients[booking.userId])}<small>{clients[booking.userId]?.phone}</small></td>
            <td>{displayWorkspace(workspace ?? { id: booking.workspaceId, name: booking.workspaceName ?? '' })}<small>{bookingTypeText(booking.bookingType)}</small></td>
            <td>{money(booking.totalPrice)}</td>
            <td><span className={'status ' + statusClass}>{statusText(status)}</span></td>
            <td>{statusText(payment?.status ?? booking.paymentStatus)}
              {canRecordPayment && <div className="actions admin-payment-actions">
                <button className="text-button" disabled={busy} onClick={() => ask({ type: 'payment', booking, payment, method: 'CASH' })}>Готівка</button>
                <button className="text-button" disabled={busy} onClick={() => ask({ type: 'payment', booking, payment, method: 'CARD' })}>Термінал</button>
              </div>}
              {canRefund && <div className="actions admin-payment-actions">
                <button className="text-button" disabled={busy} onClick={() => ask({ type: 'refund', label: 'бронювання №' + booking.id, payment })}>Підтвердити повернення</button>
              </div>}
            </td>
            <td>{canCancelBooking(booking, now) && <button className="text-button danger" disabled={busy} onClick={() => ask({ type: 'cancel', booking })}>Скасувати</button>}</td>
          </tr>;
        })}</tbody>
      </table></div> : <p className="empty">Бронювань не знайдено.</p>}
    {!loading && !loadError && <Pager page={visiblePage} total={totalPages} change={next => { if (!busy) { setPage(next); setConfirm(null); } }} />}
  </Modal>;
}
