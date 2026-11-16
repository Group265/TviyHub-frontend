import { useEffect, useState } from 'react';
import { api } from '../api';
import { errorMessage } from '../api/client';
import type { AdminUser, Booking, Page, Payment } from '../api/types';
import { money, statusText } from '../booking';
import { Alert, Modal, Pager } from './ui';

export function AdminModal({ onClose, onChanged, userId }: { onClose:()=>void; onChanged:()=>void; userId:number }) {
  const [tab,setTab]=useState<'users'|'bookings'>('bookings');
  const [users,setUsers]=useState<Page<AdminUser>|null>(null);
  const [clients,setClients]=useState<Record<number,AdminUser>>({});
  const [bookings,setBookings]=useState<Booking[]>([]);
  const [payments,setPayments]=useState<Payment[]>([]);
  const [page,setPage]=useState(0);
  const [search,setSearch]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [revision,setRevision]=useState(0);
  const [confirm,setConfirm]=useState<{label:string;action:()=>Promise<unknown>}|null>(null);
  useEffect(()=>{let active=true;setLoading(true);setError('');
    const load=async()=>{
      if(tab==='users'){const value=await api.adminUsers(page,search);if(active)setUsers(value);}
      else{
        const [rows,transactions]=await Promise.all([api.adminBookings(),api.adminPayments()]);
        const current=rows.slice(page*10,page*10+10);
        const clientRows=await Promise.all([...new Set(current.map(b=>b.userId))].map(id=>api.adminUser(id)));
        if(active){setBookings(rows);setPayments(transactions);setClients(Object.fromEntries(clientRows.map(u=>[u.id,u])));}
      }
    };
    load().catch(err=>{if(active)setError(errorMessage(err));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
  },[tab,page,search,revision]);
  async function perform(){if(!confirm||busy)return;setBusy(true);setError('');try{await confirm.action();setConfirm(null);setRevision(v=>v+1);onChanged();}catch(err){setError(errorMessage(err));}finally{setBusy(false);}}
  return <Modal title="Адмін-панель" onClose={onClose} wide><p className="eyebrow">Керування бронюваннями та користувачами</p><div className="actions admin-tabs"><button className={`btn ${tab==='users'?'':'outline'}`} onClick={()=>{setTab('users');setPage(0);}}>Усі користувачі</button><button className={`btn ${tab==='bookings'?'':'outline'}`} onClick={()=>{setTab('bookings');setPage(0);}}>Усі бронювання</button></div>
    {tab==='users'&&<label className="search">Пошук<input type="search" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} placeholder="Ім’я, пошта або телефон"/></label>}
    {error&&<Alert>{error}</Alert>}
    {loading?<p role="status">Завантаження…</p>:<div className="table-scroll">{tab==='users'?<table><thead><tr><th>Реєстрація</th><th>Клієнт</th><th>Email</th><th>Роль</th><th>Дії менеджера</th></tr></thead><tbody>{users?.content.map(u=><tr key={u.id}><td>{u.createdAt.slice(0,10)}</td><td>{u.name}<small>{u.phone}</small></td><td>{u.email}</td><td>{u.role}<small>{u.blocked?'Заблокований':'Активний'}</small></td><td><button className="text-button danger" disabled={busy||u.id===userId} onClick={()=>setConfirm({label:`${u.blocked?'Розблокувати':'Заблокувати'} користувача ${u.name}?`,action:()=>api.block(u.id,u.blocked)})}>{u.blocked?'Розблокувати':'Заблокувати'}</button></td></tr>)}</tbody></table>:<table><thead><tr><th>Дата / час</th><th>Клієнт</th><th>Ресурс / тариф</th><th>Сума</th><th>Статус</th><th>Оплата</th><th>Дії</th></tr></thead><tbody>{bookings.slice(page*10,page*10+10).map(b=>{const payment=payments.find(p=>p.bookingId===b.id);return <tr key={b.id}><td>{b.bookingDate}<small>{b.startTime?.slice(0,5)}–{b.endTime?.slice(0,5)}</small></td><td>{clients[b.userId]?.name||`Клієнт #${b.userId}`}<small>{clients[b.userId]?.phone}</small></td><td>{b.workspaceName}<small>{b.bookingType}</small></td><td>{money(b.totalPrice)}</td><td><span className={`status ${b.status==='CANCELLED'?'cancelled':''}`}>{statusText(b.status)}</span></td><td>{payment?.status==='UNPAID'&&b.status==='CONFIRMED'?<button className="btn outline small" disabled={busy} onClick={()=>setConfirm({label:`Підтвердити отримання ${money(payment.amount)} готівкою за бронювання №${b.id}?`,action:()=>api.updatePayment(payment.id)})}>Підтвердити готівку</button>:statusText(payment?.status||b.paymentStatus)}</td><td>{b.status==='CONFIRMED'&&<button className="text-button danger" onClick={()=>setConfirm({label:`Скасувати бронювання №${b.id}?`,action:()=>api.cancel(b.id)})}>Скасувати</button>}</td></tr>;})}</tbody></table>}</div>}
    {!loading&&((tab==='users'&&!users?.content.length)||(tab==='bookings'&&!bookings.length))&&<p className="empty">Записів поки немає.</p>}
    <Pager page={page} total={tab==='users'?users?.totalPages||0:Math.ceil(bookings.length/10)} change={setPage}/>
    {confirm&&<div className="confirm-panel"><p>{confirm.label}</p><div className="actions"><button className="btn small" disabled={busy} onClick={perform}>{busy?'Зачекайте…':'Підтвердити'}</button><button className="btn outline small" disabled={busy} onClick={()=>setConfirm(null)}>Назад</button></div></div>}
  </Modal>;
}
