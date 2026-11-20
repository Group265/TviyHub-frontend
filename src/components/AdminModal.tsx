import { useEffect, useState } from 'react';
import { api } from '../api';
import { ApiError, bookingAlreadyStartedError, errorMessage } from '../api/errors';
import type { AdminUser, Booking, Page, Payment, Workspace } from '../api/types';
import { bookingDisplayStatus, bookingTypeText, canCancelBooking, displayWorkspace, money, roleText, statusText, venueDateTime } from '../booking';
import { Alert, Modal, Pager } from './ui';
import { useVenueClock } from '../useVenueClock';

export function AdminModal({ onClose, onChanged, userId, workspaces }: { onClose:()=>void; onChanged:()=>void; userId:number; workspaces: Workspace[] }) {
  const [tab,setTab]=useState<'users'|'bookings'>('bookings');
  const [users,setUsers]=useState<Page<AdminUser>|null>(null);
  const [clients,setClients]=useState<Record<number,AdminUser>>({});
  const [bookings,setBookings]=useState<Booking[]>([]);
  const [payments,setPayments]=useState<Payment[]>([]);
  const [page,setPage]=useState(0);
  const [search,setSearch]=useState('');
  const [error,setError]=useState('');
  const [loadError,setLoadError]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [revision,setRevision]=useState(0);
  const [confirm,setConfirm]=useState<{label:string;action:()=>Promise<unknown>;bookingToCancel?:Booking}|null>(null);
  const now = venueDateTime(useVenueClock());
  const canConfirm = confirm && (!confirm.bookingToCancel || canCancelBooking(confirm.bookingToCancel, now));
  useEffect(() => {
    if (confirm && !canConfirm) setConfirm(null);
  }, [confirm, canConfirm]);
  useEffect(()=>{let active=true;setLoading(true);setLoadError('');
    const load=async()=>{
      if(tab==='users'){const value=await api.adminUsers(page,search);if(active)setUsers(value);}
      else{
        const [rows,transactions]=await Promise.all([api.adminBookings(),api.adminPayments()]);
        const current=rows.slice(page*10,page*10+10);
        const clientRows = (await Promise.all([...new Set(current.map(b => b.userId))]
          .map(id => api.adminUser(id).catch(err => {
            if (err instanceof ApiError && err.status === 404) return null;
            throw err;
          })))).filter(user => user !== null);
        if(active){setBookings(rows);setPayments(transactions);setClients(Object.fromEntries(clientRows.map(u=>[u.id,u])));}
      }
    };
    load().catch(err=>{
      if (active) {
        const action = tab === 'users' ? 'Не вдалося завантажити користувачів.' : 'Не вдалося завантажити дані про бронювання.';
        setLoadError(`${action} ${errorMessage(err, '')}`.trim());
      }
    }).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
  },[tab,page,search,revision]);

  async function perform() {
    if (!confirm || busy) return;
    setError('');
    if (confirm.bookingToCancel && !canCancelBooking(confirm.bookingToCancel, venueDateTime())) {
      setConfirm(null);
      setError(bookingAlreadyStartedError);
      return;
    }
    setBusy(true);
    try {
      await confirm.action();
      setConfirm(null);
      setRevision(v => v + 1);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return <Modal title="Адмін-панель" onClose={onClose} wide><p className="eyebrow">Керування бронюваннями та користувачами</p><div className="actions admin-tabs"><button className={`btn ${tab==='users'?'':'outline'}`} onClick={()=>{setTab('users');setPage(0);setError('');setConfirm(null);}}>Усі користувачі</button><button className={`btn ${tab==='bookings'?'':'outline'}`} onClick={()=>{setTab('bookings');setPage(0);setError('');setConfirm(null);}}>Усі бронювання</button></div>
    {tab==='users'&&<label className="search">Пошук<input type="search" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} placeholder="Ім’я, пошта або телефон"/></label>}
    {error&&<Alert>{error}</Alert>}
    {loading?<p role="status">Завантаження…</p>:loadError?<Alert>{loadError}</Alert>:<div className="table-scroll">{tab==='users'?<table><thead><tr><th>Реєстрація</th><th>Клієнт</th><th>Електронна пошта</th><th>Роль</th><th>Дії адміністратора</th></tr></thead><tbody>{users?.content.map(u=><tr key={u.id}><td>{u.createdAt.slice(0,10)}</td><td>{u.name}<small>{u.phone}</small></td><td>{u.email}</td><td>{roleText(u.role)}<small>{u.blocked?'Заблокований':'Активний'}</small></td><td><button className="text-button danger" disabled={busy||u.id===userId} onClick={()=>setConfirm({label:`${u.blocked?'Розблокувати':'Заблокувати'} користувача ${u.name}?`,action:()=>api.block(u.id,u.blocked)})}>{u.blocked?'Розблокувати':'Заблокувати'}</button></td></tr>)}</tbody></table>:<table><thead><tr><th>Дата / час</th><th>Клієнт</th><th>Ресурс / тариф</th><th>Сума</th><th>Статус</th><th>Оплата</th><th>Дії</th></tr></thead><tbody>{bookings.slice(page*10,page*10+10).map(b=>{const payment=payments.find(p=>p.bookingId===b.id);
      const resource = workspaces.find(workspace => workspace.id === b.workspaceId);
      const workspaceName = displayWorkspace(resource ?? { id: b.workspaceId, name: b.workspaceName ?? '' });
      const status = bookingDisplayStatus(b, now);
      const statusClass = status === 'CANCELLED' ? 'cancelled' : status === 'COMPLETED' ? 'completed' : '';
      return <tr key={b.id}><td>{b.bookingDate}<small>{b.startTime?.slice(0,5)}–{b.endTime?.slice(0,5)}</small></td><td>{clients[b.userId]?.name||`Клієнт №${b.userId}`}<small>{clients[b.userId]?.phone}</small></td><td>{workspaceName}<small>{bookingTypeText(b.bookingType)}</small></td><td>{money(b.totalPrice)}</td><td><span className={`status ${statusClass}`}>{statusText(status)}</span></td><td>{payment?.status==='UNPAID'&&b.status==='CONFIRMED'?<button className="btn outline small" disabled={busy} onClick={()=>setConfirm({label:`Підтвердити отримання ${money(payment.amount)} готівкою за бронювання №${b.id}?`,action:()=>api.updatePayment(payment.id)})}>Підтвердити готівку</button>:statusText(payment?.status||b.paymentStatus)}</td><td>{canCancelBooking(b, now) && <button className="text-button danger" disabled={busy} onClick={()=>{
        setError('');setConfirm({label:`Скасувати бронювання №${b.id}?`,action:()=>api.cancel(b.id),bookingToCancel:b});
      }}>Скасувати</button>}</td></tr>;})}</tbody></table>}</div>}
    {!loading&&!loadError&&((tab==='users'&&!users?.content.length)||(tab==='bookings'&&!bookings.length))&&<p className="empty">Записів поки немає.</p>}
    {!loadError&&<Pager page={page} total={tab==='users'?users?.totalPages||0:Math.ceil(bookings.length/10)} change={setPage}/>}
    {canConfirm&&<div className="confirm-panel"><p>{confirm.label}</p><div className="actions"><button className="btn small" disabled={busy} onClick={perform}>{busy?'Зачекайте…':'Підтвердити'}</button><button className="btn outline small" disabled={busy} onClick={()=>setConfirm(null)}>Назад</button></div></div>}
  </Modal>;
}
