import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, HISTORY_PAGE_SIZE } from '../api';
import { clearSession, logout } from '../api/client';
import { bookingAlreadyStartedError, errorMessage, passwordsMismatch, phoneFormatError } from '../api/errors';
import type { Booking, HistoryItem, Page, Subscription, User, Workspace } from '../api/types';
import {
  bookingCloseTime, bookingDisplayStatus, bookingOpenTime, bookingPaymentWindow, canCancelBooking, displayWorkspace,
  isCurrentSubscription, isUpcomingBooking, money, paymentDeadlineText, statusText, venueDateTime,
} from '../booking';
import { getPaymentId, startCheckout } from '../checkout';
import { Alert, Icon, Modal, Pager, ukrainianFormValidation } from './ui';
import { useVenueClock } from '../useVenueClock';

export function ProfileModal({ user, onClose, onUser, onRepeat, onVerify, onLogoutError, standalone = false }: { user: User; onClose: () => void; onUser: (u: User | null) => void; onRepeat: (w: Workspace, item: HistoryItem) => void; onVerify: () => void; onLogoutError: (message: string) => void; standalone?: boolean }) {
  const [history,setHistory]=useState<Page<HistoryItem>|null>(null);
  const [upcoming,setUpcoming]=useState<HistoryItem[]>([]);
  const [historyError,setHistoryError]=useState('');
  const [subscriptionError,setSubscriptionError]=useState('');
  const [subscriptions,setSubscriptions]=useState<Subscription[]>([]);
  const [page,setPage]=useState(0);
  const [scope,setScope]=useState('all');
  const [revision,setRevision]=useState(0);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [edit,setEdit]=useState<'name'|'phone'|'email'|'password'|null>(null);
  const [codeStep,setCodeStep]=useState(false);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [cancelError,setCancelError]=useState('');
  const [cancelNotice,setCancelNotice]=useState('');
  const [confirmCancel,setConfirmCancel]=useState<HistoryItem|null>(null);
  const [paymentError,setPaymentError] = useState('');
  const [paymentBookings,setPaymentBookings] = useState<Map<number, Booking> | null>(null);
  const now = venueDateTime(useVenueClock());
  const upcomingItems = useMemo(() => upcoming.filter(item => isUpcomingBooking(item, now)), [upcoming, now]);
  const totalPages = scope === 'upcoming' ? Math.ceil(upcomingItems.length / HISTORY_PAGE_SIZE) : (history?.totalPages ?? 0);
  const visiblePage = scope === 'upcoming' ? Math.min(page, Math.max(0, totalPages - 1)) : page;
  const visibleHistory = scope === 'upcoming'
    ? upcomingItems.slice(visiblePage * HISTORY_PAGE_SIZE, (visiblePage + 1) * HISTORY_PAGE_SIZE)
    : history?.content ?? [];
  const activeSubscriptions = subscriptions.filter(item => isCurrentSubscription(item, now.slice(0, 10)));
  const canConfirmCancel = confirmCancel && canCancelBooking(confirmCancel, now);
  const serverPage = scope === 'upcoming' ? 0 : page;
  const needsPaymentData = visibleHistory.some(item => !item.paymentStatus ||
    (user.role === 'USER' && item.status === 'PENDING_PAYMENT' &&
      (!getPaymentId(item) || (!item.createdAt && !item.paymentDeadline))));

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setLoading(true);
    setHistoryError('');
    const load = async () => {
      if (scope === 'upcoming') {
        const items = await api.upcomingHistory(signal);
        if (!signal.aborted) setUpcoming(items);
      } else {
        const result = await api.history(serverPage, scope, signal);
        if (!signal.aborted) setHistory(result);
      }
    };
    load().catch(err => {
      if (!signal.aborted) setHistoryError(`Не вдалося завантажити історію бронювань. ${errorMessage(err, '')}`.trim());
    }).finally(() => {
      if (!signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [serverPage, scope, revision]);

  useEffect(() => {
    if (!needsPaymentData) return;
    const controller = new AbortController();
    setPaymentBookings(null);
    api.bookings(controller.signal, user.role === 'ADMIN' ? user.id : undefined).then(bookings => {
      if (!controller.signal.aborted) setPaymentBookings(new Map(bookings.map(booking => [booking.id, booking])));
    }).catch(() => {
      if (!controller.signal.aborted) setPaymentBookings(new Map());
    });
    return () => controller.abort();
  }, [needsPaymentData, revision, user.id, user.role]);

  useEffect(() => {
    if(user.role!=='USER')return;
    let active=true;
    setSubscriptionError('');
    api.subscriptions().then(items=>{if(active)setSubscriptions(items);}).catch(err=>{
      if(active)setSubscriptionError(`Не вдалося завантажити абонементи. ${errorMessage(err, '')}`.trim());
    });
    return()=>{active=false;};
  },[user.role,revision]);
  useEffect(() => {
    if (confirmCancel && !canConfirmCancel) setConfirmCancel(null);
  }, [confirmCancel, canConfirmCancel]);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(busy||!edit)return;setBusy(true);setError('');setNotice('');
    const form=new FormData(e.currentTarget);const get=(name:string)=>String(form.get(name)||'');
    try{
      if(edit==='name'){onUser(await api.updateName(get('name').trim()));setEdit(null);setNotice('Ім’я оновлено.');}
      else if(!codeStep){
        const newPhone = get('newPhone').replace(/[\s()-]/g, '');
        const newPassword = get('newPassword');
        const confirmNewPassword = get('confirmNewPassword');
        if (edit === 'phone' && !/^\+[1-9]\d{6,14}$/.test(newPhone)) { setError(phoneFormatError); return; }
        if (edit === 'password' && newPassword !== confirmNewPassword) { setError(passwordsMismatch); return; }
        const currentPassword = get('currentPassword');
        const body = edit === 'phone' ? { newPhone }
          : edit === 'email' ? { newEmail: get('newEmail').trim(), currentPassword }
          : { newPassword, confirmNewPassword, currentPassword };
        await api.requestChange(edit,body);
        setCodeStep(true);
        setNotice(edit === 'email'
          ? 'Введіть код, який надійшов на нову електронну адресу.'
          : 'Введіть код, який надійшов на електронну адресу вашого профілю.');
      }else{
        const updated = await api.confirmChange(edit, get('code'));
        if(edit==='password'){clearSession();onUser(null);onClose();return;}
        if (updated) onUser(updated);
        setEdit(null);setCodeStep(false);setNotice('Дані оновлено.');
      }
    }catch(err){setError(errorMessage(err));}finally{setBusy(false);}
  }
  async function cancel(booking: HistoryItem) {
    if (busy) return;
    setCancelError('');
    setCancelNotice('');
    if (!canCancelBooking(booking, venueDateTime())) {
      setConfirmCancel(null);
      setCancelError(bookingAlreadyStartedError);
      return;
    }
    setBusy(true);
    try {
      await api.cancel(booking.id);
      setConfirmCancel(null);
      setRevision(v => v + 1);
      setCancelNotice('Бронювання скасовано.');
    } catch (err) {
      setCancelError(errorMessage(err, 'Не вдалося скасувати бронювання.'));
    } finally {
      setBusy(false);
    }
  }
  async function signout() {
    setBusy(true);
    try {
      await logout();
    } catch (err) {
      onLogoutError(`Ви вийшли на цьому пристрої. Сервер не підтвердив завершення сесії. ${errorMessage(err, '')}`.trim());
    } finally {
      onUser(null);
      onClose();
    }
  }
  async function payOnline(item: HistoryItem, paymentId: number, latest: string) {
    if (busy || item.status !== 'PENDING_PAYMENT' || latest <= venueDateTime()) return;
    setBusy(true);
    setPaymentError('');
    try {
      location.assign(await startCheckout([paymentId], user.id));
    } catch (err) {
      setPaymentError(`Не вдалося відкрити оплату бронювання №${item.id}. ${errorMessage(err, 'Спробуйте ще раз.')}`);
      setBusy(false);
    }
  }
  const content = <>
    <div className="profile-head"><div className="avatar" aria-hidden="true">{user.name.slice(0,1)}</div><div><h3>{user.name}</h3><p className="profile-contacts"><span><Icon name="imgProfileEmail"/>{user.email}</span><span><Icon name="imgProfilePhone"/>{user.phone||'Телефон не вказаний'}</span></p></div></div>
    {!user.emailVerified&&<Alert>Пошта не підтверджена. <button className="text-button" disabled={busy} onClick={onVerify}>Підтвердити пошту</button></Alert>}
    <div className="actions">{(['name','phone','email','password'] as const).map(kind=><button className="btn outline small" key={kind} disabled={busy||(kind!=='name'&&!user.emailVerified)} onClick={()=>{setEdit(kind);setCodeStep(false);setError('');setNotice('');}}>{({name:'Змінити ім’я',phone:'Телефон',email:'Пошта',password:'Пароль'})[kind]}</button>)}<button className="text-button muted" disabled={busy} onClick={signout}>Вийти</button></div>
    {error&&<Alert>{error}</Alert>}{notice&&<Alert success>{notice}</Alert>}
    {edit&&<form {...ukrainianFormValidation} className="form edit-panel" onSubmit={submit} key={`${edit}-${codeStep}`}><h3>{({name:'Редагування профілю',phone:'Зміна телефону',email:'Зміна пошти',password:'Зміна пароля'})[edit]}</h3>
      {codeStep?<label>Код із листа<input name="code" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code"/></label>:<>
        {edit==='name'&&<label>Ім’я та прізвище<input name="name" required maxLength={100} defaultValue={user.name} autoComplete="name"/></label>}
        {edit==='phone'&&<label>Новий номер телефону<input name="newPhone" type="tel" required placeholder="+380..."/></label>}
        {edit==='email'&&<label>Нова пошта<input name="newEmail" type="email" required/></label>}
        {(edit==='email'||edit==='password')&&<label>Поточний пароль<input name="currentPassword" type="password" required autoComplete="current-password"/></label>}
        {edit==='password'&&<>
          <label>Новий пароль<input name="newPassword" type="password" minLength={8} maxLength={72} required autoComplete="new-password"/></label>
          <label>Підтвердження нового пароля<input name="confirmNewPassword" type="password" maxLength={72} required autoComplete="new-password"/></label>
        </>}
      </>}
      <div className="actions"><button className="btn small" disabled={busy}>{busy?'Зачекайте…':codeStep?'Підтвердити':edit==='name'?'Зберегти':'Надіслати код'}</button><button type="button" className="text-button" disabled={busy} onClick={()=>{setEdit(null);setError('');setNotice('');}}>Скасувати</button></div>
    </form>}
    <div className="table-heading"><h3>Історія бронювань</h3><select aria-label="Фільтр історії" value={scope} onChange={e=>{
      setLoading(true);setHistoryError('');setPaymentError('');setConfirmCancel(null);setScope(e.target.value);setPage(0);
    }}><option value="all">Усі</option><option value="upcoming">Майбутні</option><option value="past">Минулі</option></select></div>
    {cancelError && <Alert>{cancelError}</Alert>}
    {cancelNotice && <Alert success>{cancelNotice}</Alert>}
    {paymentError && <Alert>{paymentError}</Alert>}
    {loading ? <p role="status">Завантажуємо бронювання…</p> : historyError ? <Alert>{historyError}</Alert> : <>
      {visibleHistory.length > 0 ? <div className="table-scroll">
        <table>
          <thead><tr><th>Дата візиту</th><th>Тип ресурсу</th><th>Час</th><th>Сума / статус</th><th>Оплата</th><th>Дії</th></tr></thead>
          <tbody>{visibleHistory.map(item => {
            const paymentBooking = paymentBookings?.get(item.id);
            const paymentStatus = item.paymentStatus || paymentBooking?.paymentStatus;
            const paymentLabel = paymentStatus ? statusText(paymentStatus) :
              paymentBookings === null ? 'Завантаження…' : 'Статус недоступний';
            const paymentId = getPaymentId(item) ?? (paymentBooking && getPaymentId(paymentBooking));
            const pendingPayment = item.status === 'PENDING_PAYMENT';
            const { start, deadline } = bookingPaymentWindow({
              ...item,
              createdAt: item.createdAt ?? paymentBooking?.createdAt,
              paymentDeadline: item.paymentDeadline ?? paymentBooking?.paymentDeadline,
            });
            const latest = deadline ?? start;
            return <tr key={item.id}>
            <td>{item.bookingDate}</td><td>{displayWorkspace(item.workspace)}</td>
            <td>{item.startTime?.slice(0,5) ?? bookingOpenTime}–{item.endTime?.slice(0,5) ?? bookingCloseTime}</td>
            <td>{money(item.totalPrice)}<small>{pendingPayment ? <span className="status">{statusText(item.status)}</span> : statusText(bookingDisplayStatus(item, now))}</small>
              {pendingPayment && deadline && <small>{paymentDeadlineText(deadline)}</small>}
            </td>
            <td>{paymentLabel}</td>
            <td><div className="actions">
              {user.role === 'USER' && pendingPayment && <button type="button" className="btn outline small"
                disabled={busy || !paymentId || latest <= now}
                onClick={() => { if (paymentId) payOnline(item, paymentId, latest); }}>Оплатити онлайн</button>}
              <button className="btn outline small" disabled={busy} onClick={() => onRepeat(item.workspace,item)}>Повторити</button>
              {canCancelBooking(item, now) && <button className="text-button danger" disabled={busy} onClick={() => {
                setCancelError('');setCancelNotice('');setConfirmCancel(item);
              }}>Скасувати</button>}
            </div>{user.role === 'USER' && pendingPayment && (latest <= now || !paymentId) && <small>
              {latest <= now ? 'Строк оплати минув.' : 'Онлайн-оплата недоступна.'}
            </small>}</td>
          </tr>;})}</tbody>
        </table>
      </div> : <p className="empty">{scope === 'upcoming' ? 'Майбутніх бронювань немає.' : 'У цьому розділі немає бронювань.'}</p>}
      <Pager page={visiblePage} total={totalPages} change={setPage}/>
    </>}
    {canConfirmCancel&&<div className="confirm-panel"><p>Скасувати бронювання №{confirmCancel.id}?</p><div className="actions"><button className="btn small" disabled={busy} onClick={()=>cancel(confirmCancel)}>Так, скасувати</button><button className="btn outline small" onClick={()=>setConfirmCancel(null)}>Залишити</button></div></div>}
    {subscriptionError && <Alert>{subscriptionError}</Alert>}
    {activeSubscriptions.length>0&&<><h3>Активні та майбутні абонементи</h3><div className="table-scroll"><table><thead><tr><th>Місце</th><th>Період</th><th>Статус</th></tr></thead><tbody>{activeSubscriptions.map(sub=><tr key={sub.id}><td>Місце №{sub.workspaceId}</td><td>{sub.startDate} — {sub.endDate}</td><td>{statusText(sub.status)}<small>{statusText(sub.paymentStatus)}</small></td></tr>)}</tbody></table></div></>}
    <p className="muted small-copy">Погодинну бронь можна скасувати щонайменше за 2 години, денну — за добу.</p>
  </>;
  return standalone ? content : <Modal title="Мій профіль" onClose={() => { if (!busy) onClose(); }} wide>{content}</Modal>;
}
