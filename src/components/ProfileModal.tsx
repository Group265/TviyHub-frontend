import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, HISTORY_PAGE_SIZE } from '../api';
import { clearSession, logout } from '../api/client';
import { bookingAlreadyStartedError, errorMessage, passwordsMismatch } from '../api/errors';
import type { Booking, HistoryItem, Page, Subscription, User, Workspace } from '../api/types';
import {
  bookingCloseTime, bookingDisplayStatus, bookingOpenTime, bookingPaymentWindow, canCancelBooking, canUserCancelSubscription, displayWorkspace,
  isCurrentSubscription, isRetiredWorkspace, isUpcomingBooking, money, paymentDeadlineText, statusText, venueDateTime,
} from '../booking';
import { getPaymentId, startCheckout } from '../checkout';
import { Alert, Icon, Modal, Pager, ukrainianFormValidation } from './ui';
import { ProfileDetailsEditor } from './ProfileDetailsEditor';
import { useVenueClock } from '../useVenueClock';

const passwordReuseError = 'Новий пароль має відрізнятися від поточного.';

function reusesCurrentPassword(form: FormData): boolean {
  const currentPassword = form.get('currentPassword');
  return typeof currentPassword === 'string' && currentPassword.length > 0 && currentPassword === form.get('newPassword');
}

export function ProfileModal({ user, onClose, onUser, onRepeat, onLogoutError, standalone = false }: { user: User; onClose: () => void; onUser: (u: User | null) => void; onRepeat: (w: Workspace, item: HistoryItem) => void; onLogoutError: (message: string) => void; standalone?: boolean }) {
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
  const [edit,setEdit]=useState<'details'|'password'|null>(null);
  const [codeStep,setCodeStep]=useState(false);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [cancelError,setCancelError]=useState('');
  const [cancelNotice,setCancelNotice]=useState('');
  const [confirmCancel,setConfirmCancel]=useState<HistoryItem|null>(null);
  const [confirmCancelSub, setConfirmCancelSub] = useState<Subscription | null>(null);
  const [subCancelError, setSubCancelError] = useState('');
  const [subCancelNotice, setSubCancelNotice] = useState('');
  const [paymentError,setPaymentError] = useState('');
  const [paymentBookings,setPaymentBookings] = useState<Map<number, Booking> | null>(null);
  const leavingForCheckout = useRef(false);
  const detailsPanelId = useId();
  const passwordPanelId = useId();
  const passwordErrorId = useId();
  const showPasswordReuseError = edit === 'password' && !codeStep && error === passwordReuseError;
  const now = venueDateTime(useVenueClock());
  const isClientFiltered = !['all', 'past'].includes(scope);

  const filteredItems = useMemo(() => {
    if (scope === 'upcoming') return upcoming.filter(item => isUpcomingBooking(item, now));
    if (!isClientFiltered) return [];
    return upcoming.filter(item => {
      const displayStatus = bookingDisplayStatus(item, now);
      const payStatus = item.paymentStatus || paymentBookings?.get(item.id)?.paymentStatus;
      if (scope === 'PENDING_PAYMENT') return displayStatus === 'PENDING_PAYMENT';
      if (scope === 'CONFIRMED') return displayStatus === 'CONFIRMED';
      if (scope === 'COMPLETED') return displayStatus === 'COMPLETED';
      if (scope === 'CANCELLED') return displayStatus === 'CANCELLED';
      if (scope === 'PAID') return payStatus === 'PAID';
      if (scope === 'UNPAID') return payStatus === 'UNPAID';
      if (scope === 'REFUND') return payStatus === 'REFUND_PENDING' || payStatus === 'REFUNDED';
      return true;
    });
  }, [upcoming, scope, isClientFiltered, now, paymentBookings]);

  const totalPages = isClientFiltered
    ? Math.ceil(filteredItems.length / HISTORY_PAGE_SIZE)
    : (history?.totalPages ?? 0);
  const visiblePage = isClientFiltered ? Math.min(page, Math.max(0, totalPages - 1)) : page;
  const visibleHistory = isClientFiltered
    ? filteredItems.slice(visiblePage * HISTORY_PAGE_SIZE, (visiblePage + 1) * HISTORY_PAGE_SIZE)
    : history?.content ?? [];
  const activeSubscriptions = subscriptions.filter(item => isCurrentSubscription(item, now.slice(0, 10)));
  const canConfirmCancel = confirmCancel && canCancelBooking(confirmCancel, now);
  const canConfirmCancelSub = confirmCancelSub && canUserCancelSubscription(confirmCancelSub, now);
  const serverPage = isClientFiltered ? 0 : page;
  const needsPaymentData = visibleHistory.some(item => !item.paymentStatus ||
    (user.role === 'USER' && item.status === 'PENDING_PAYMENT' &&
      (!getPaymentId(item) || (!item.createdAt && !item.paymentDeadline))));

  useEffect(() => {
    function restoreProfile(event: PageTransitionEvent) {
      if (!event.persisted || !leavingForCheckout.current) return;
      leavingForCheckout.current = false;
      setBusy(false);
      setRevision(value => value + 1);
    }
    window.addEventListener('pageshow', restoreProfile);
    return () => window.removeEventListener('pageshow', restoreProfile);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setLoading(true);
    setHistoryError('');
    const load = async () => {
      if (scope === 'upcoming') {
        const items = await api.upcomingHistory(signal);
        if (!signal.aborted) setUpcoming(items);
      } else if (isClientFiltered) {
        const first = await api.history(0, 'all', signal);
        const allItems = [...first.content];
        for (let p = 1; p < first.totalPages; p++) {
          const next = await api.history(p, 'all', signal);
          allItems.push(...next.content);
        }
        if (!signal.aborted) setUpcoming(allItems);
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
  }, [serverPage, scope, isClientFiltered, revision]);


  useEffect(() => {
      if (!needsPaymentData && !['PAID', 'UNPAID', 'REFUND'].includes(scope)) return;
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
  useEffect(() => {
    if (confirmCancelSub && !canConfirmCancelSub) setConfirmCancelSub(null);
  }, [confirmCancelSub, canConfirmCancelSub]);
  function checkPasswordReuse(event: FormEvent<HTMLInputElement>) {
    const form = event.currentTarget.form;
    if (!form) return;
    const samePassword = reusesCurrentPassword(new FormData(form));
    setError(previous => samePassword ? passwordReuseError : previous === passwordReuseError ? '' : previous);
  }

  function openEditor(next: typeof edit) {
    setEdit(next === edit ? null : next);
    setCodeStep(false);
    setError('');
    setNotice('');
  }

  async function submitPassword(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(busy||edit!=='password')return;
    const form=new FormData(e.currentTarget);const get=(name:string)=>String(form.get(name)||'');
    if (!codeStep && reusesCurrentPassword(form)) {
      setError(passwordReuseError);
      return;
    }
    setBusy(true);setError('');setNotice('');
    try{
      if(!codeStep){
        const newPassword = get('newPassword');
        const confirmNewPassword = get('confirmNewPassword');
        if (newPassword !== confirmNewPassword) { setError(passwordsMismatch); return; }
        const currentPassword = get('currentPassword');
        await api.requestChange('password', { newPassword, confirmNewPassword, currentPassword });
        setCodeStep(true);
        setNotice('Введіть код, який надійшов на електронну адресу вашого профілю.');
      }else{
        await api.confirmChange('password', get('code'));
        clearSession();onUser(null);onClose();
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
  async function cancelSubscription(sub: Subscription) {
    if (busy) return;
    setSubCancelError('');
    setSubCancelNotice('');
    if (!canUserCancelSubscription(sub, venueDateTime())) {
      setConfirmCancelSub(null);
      setSubCancelError('Абонемент можна скасувати щонайменше за 24 години до початку.');
      return;
    }
    setBusy(true);
    try {
      await api.cancelSubscription(sub.id);
      setConfirmCancelSub(null);
      setRevision(v => v + 1);
      setSubCancelNotice('Абонемент скасовано.');
    } catch (err) {
      setSubCancelError(errorMessage(err, 'Не вдалося скасувати абонемент.'));
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
      const url = await startCheckout([paymentId], user.id);
      leavingForCheckout.current = true;
      location.assign(url);
    } catch (err) {
      leavingForCheckout.current = false;
      setPaymentError(`Не вдалося відкрити оплату бронювання №${item.id}. ${errorMessage(err, 'Спробуйте ще раз.')}`);
    } finally {
      setBusy(false);
    }
  }
  const content = <>
    <div className="profile-head"><div className="avatar" aria-hidden="true">{user.name.slice(0,1)}</div><div><h3>{user.name}</h3><p className="profile-contacts"><span><Icon name="imgProfileEmail"/>{user.email}</span><span><Icon name="imgProfilePhone"/>{user.phone||'Телефон не вказаний'}</span></p></div></div>
    {!user.emailVerified&&<Alert>Пошта не підтверджена. Завершіть реєстрацію за допомогою коду з листа.</Alert>}
    <div className="actions">
      <button type="button" className={`btn small${edit === 'details' ? '' : ' outline'}`} disabled={busy}
        aria-expanded={edit === 'details'} aria-controls={edit === 'details' ? detailsPanelId : undefined}
        onClick={() => openEditor('details')}>Редагувати</button>
      <button type="button" className={`btn small${edit === 'password' ? '' : ' outline'}`} disabled={busy || !user.emailVerified}
        aria-expanded={edit === 'password'} aria-controls={edit === 'password' ? passwordPanelId : undefined}
        onClick={() => openEditor('password')}>Пароль</button>
      <button className="text-button muted" disabled={busy} onClick={signout}>Вийти</button>
    </div>
    {error&&!showPasswordReuseError&&<Alert>{error}</Alert>}{notice&&<Alert success>{notice}</Alert>}
    {edit === 'details' && <ProfileDetailsEditor id={detailsPanelId} user={user} busy={busy} onBusy={setBusy} onUser={onUser}
      onCancel={() => openEditor(null)} onSaved={() => { setEdit(null); setNotice('Дані збережено.'); }} />}
    {edit === 'password' && <form {...ukrainianFormValidation} id={passwordPanelId} className="form edit-panel" onSubmit={submitPassword} key={String(codeStep)}><h3>Зміна пароля</h3>
      {codeStep?<label>Код із листа<input name="code" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code"/></label>:<>
        <label>Поточний пароль<input name="currentPassword" type="password" required autoComplete="current-password" onInput={checkPasswordReuse}/></label>
          <div>
            <label>Новий пароль<input name="newPassword" type="password" minLength={8} maxLength={72} required autoComplete="new-password"
              onInput={checkPasswordReuse} aria-invalid={showPasswordReuseError || undefined}
              aria-describedby={showPasswordReuseError ? passwordErrorId : undefined}/></label>
            {showPasswordReuseError && <p id={passwordErrorId} className="danger" role="alert">{passwordReuseError}</p>}
          </div>
          <label>Підтвердження нового пароля<input name="confirmNewPassword" type="password" maxLength={72} required autoComplete="new-password"/></label>
      </>}
      <div className="actions"><button className="btn small" disabled={busy}>{busy?'Зачекайте…':codeStep?'Підтвердити':'Надіслати код'}</button><button type="button" className="text-button" disabled={busy} onClick={()=>openEditor(null)}>Скасувати</button></div>
    </form>}
        <div className="table-heading">
          <h3>Історія бронювань</h3>
          <select
            aria-label="Фільтр історії"
            value={scope}
            onChange={e => {
              setLoading(true);
              setHistoryError('');
              setPaymentError('');
              setConfirmCancel(null);
              setScope(e.target.value);
              setPage(0);
            }}
          >
            <optgroup label="За часом">
              <option value="all">Усі бронювання</option>
              <option value="upcoming">Майбутні</option>
              <option value="past">Минулі</option>
            </optgroup>
            <optgroup label="За статусом бронювання">
              <option value="PENDING_PAYMENT">Очікують оплати</option>
              <option value="CONFIRMED">Підтверджені</option>
              <option value="COMPLETED">Завершені</option>
              <option value="CANCELLED">Скасовані</option>
            </optgroup>
            <optgroup label="За оплатою">
              <option value="PAID">Сплачені</option>
              <option value="UNPAID">Не сплачені</option>
              <option value="REFUND">Повернення коштів</option>
            </optgroup>
          </select>
        </div>
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
              {!pendingPayment && !isRetiredWorkspace(item.workspace) && <button className="btn outline small" disabled={busy} onClick={() => onRepeat(item.workspace,item)}>Повторити</button>}
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
    {subCancelError && <Alert>{subCancelError}</Alert>}
    {subCancelNotice && <Alert success>{subCancelNotice}</Alert>}
    {activeSubscriptions.length > 0 && <>
      <h3>Активні та майбутні абонементи</h3>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Місце</th><th>Період</th><th>Статус</th><th>Дії</th></tr></thead>
          <tbody>{activeSubscriptions.map(sub => <tr key={sub.id}>
            <td>Місце №{sub.workspaceId}</td>
            <td>{sub.startDate} — {sub.endDate}</td>
            <td>{statusText(sub.status)}<small>{statusText(sub.paymentStatus)}</small></td>
            <td>{canUserCancelSubscription(sub, now) && <button type="button" className="text-button danger" disabled={busy} onClick={() => {
              setSubCancelError(''); setSubCancelNotice(''); setConfirmCancelSub(sub);
            }}>Скасувати</button>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
    {canConfirmCancelSub && <div className="confirm-panel"><p>Скасувати абонемент №{confirmCancelSub.id}?</p><div className="actions"><button className="btn small" disabled={busy} onClick={() => cancelSubscription(confirmCancelSub)}>Так, скасувати</button><button className="btn outline small" onClick={() => setConfirmCancelSub(null)}>Залишити</button></div></div>}
    <p className="muted small-copy">Погодинну бронь можна скасувати щонайменше за 2 години, денну та абонемент — за добу.</p>
    </>;
  return standalone ? content : <Modal title="Мій профіль" onClose={() => { if (!busy) onClose(); }} wide>{content}</Modal>;
}
