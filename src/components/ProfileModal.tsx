import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { clearSession, errorMessage, logout } from '../api/client';
import type { HistoryItem, Page, Subscription, User, Workspace } from '../api/types';
import { displayWorkspace, money, statusText } from '../booking';
import { Alert, Icon, Modal, Pager } from './ui';

export function ProfileModal({ user, onClose, onUser, onRepeat, onVerify }: { user: User; onClose: () => void; onUser: (u: User | null) => void; onRepeat: (w: Workspace, item: HistoryItem) => void; onVerify: () => void }) {
  const [history,setHistory]=useState<Page<HistoryItem>|null>(null);
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
  const [confirmCancel,setConfirmCancel]=useState<number|null>(null);
  useEffect(()=>{let active=true;setLoading(true);setError('');
    api.history(page,scope).then(value=>{if(active)setHistory(value);}).catch(err=>{if(active)setError(errorMessage(err));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[page,scope,revision]);
  useEffect(()=>{if(user.role!=='USER')return;let active=true;api.subscriptions().then(items=>{if(active)setSubscriptions(items);}).catch(err=>{if(active)setError(errorMessage(err));});return()=>{active=false;};},[user.role,revision]);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(busy||!edit)return;setBusy(true);setError('');setNotice('');
    const form=new FormData(e.currentTarget);const get=(name:string)=>String(form.get(name)||'');
    try{
      if(edit==='name'){onUser(await api.updateName(get('name').trim()));setEdit(null);setNotice('Ім’я оновлено.');}
      else if(!codeStep){
        const body=edit==='phone'?{newPhone:get('newPhone').replace(/[\s()-]/g,'')}:edit==='email'?{newEmail:get('newEmail').trim(),currentPassword:get('currentPassword')}:{newPassword:get('newPassword'),currentPassword:get('currentPassword')};
        await api.requestChange(edit,body);setCodeStep(true);setNotice('Введіть код із листа. Для зміни пошти він надісланий на нову адресу.');
      }else{
        await api.confirmChange(edit,get('code'));
        if(edit==='password'){clearSession();onUser(null);onClose();return;}
        onUser(await api.me());setEdit(null);setCodeStep(false);setNotice('Дані оновлено.');
      }
    }catch(err){setError(errorMessage(err));}finally{setBusy(false);}
  }
  async function cancel(id:number){if(busy)return;setBusy(true);setError('');try{await api.cancel(id);setConfirmCancel(null);setRevision(v=>v+1);setNotice('Бронювання скасовано.');}catch(err){setError(errorMessage(err));}finally{setBusy(false);}}
  async function signout(){setBusy(true);try{await logout();onUser(null);onClose();}catch(err){onUser(null);setNotice('На цьому пристрої виконано вихід. Сервер не підтвердив відкликання сесії.');setError(errorMessage(err));}finally{setBusy(false);}}
  return <Modal title="Мій профіль" onClose={onClose} wide>
    <div className="profile-head"><div className="avatar" aria-hidden="true">{user.name.slice(0,1)}</div><div><h3>{user.name}</h3><p className="profile-contacts"><span><Icon name="imgProfileEmail"/>{user.email}</span><span><Icon name="imgProfilePhone"/>{user.phone||'Телефон не вказаний'}</span></p></div></div>
    {!user.emailVerified&&<Alert>Пошта не підтверджена. <button className="text-button" onClick={onVerify}>Підтвердити пошту</button></Alert>}
    <div className="actions">{(['name','phone','email','password'] as const).map(kind=><button className="btn outline small" key={kind} disabled={kind!=='name'&&!user.emailVerified} onClick={()=>{setEdit(kind);setCodeStep(false);setError('');setNotice('');}}>{({name:'Змінити ім’я',phone:'Телефон',email:'Пошта',password:'Пароль'})[kind]}</button>)}<button className="text-button muted" disabled={busy} onClick={signout}>Вийти</button></div>
    {error&&<Alert>{error}</Alert>}{notice&&<Alert success>{notice}</Alert>}
    {edit&&<form className="form edit-panel" onSubmit={submit} key={`${edit}-${codeStep}`}><h3>{({name:'Редагування профілю',phone:'Зміна телефону',email:'Зміна пошти',password:'Зміна пароля'})[edit]}</h3>
      {codeStep?<label>Код із листа<input name="code" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code"/></label>:<>
        {edit==='name'&&<label>Ім’я та прізвище<input name="name" required maxLength={100} defaultValue={user.name} autoComplete="name"/></label>}
        {edit==='phone'&&<label>Новий номер телефону<input name="newPhone" type="tel" required placeholder="+380..." pattern="\+[1-9][0-9 ()-]{6,20}"/></label>}
        {edit==='email'&&<label>Нова пошта<input name="newEmail" type="email" required/></label>}
        {(edit==='email'||edit==='password')&&<label>Поточний пароль<input name="currentPassword" type="password" required autoComplete="current-password"/></label>}
        {edit==='password'&&<label>Новий пароль<input name="newPassword" type="password" minLength={8} maxLength={72} required autoComplete="new-password"/></label>}
      </>}
      <div className="actions"><button className="btn small" disabled={busy}>{busy?'Зачекайте…':codeStep?'Підтвердити':edit==='name'?'Зберегти':'Надіслати код'}</button><button type="button" className="text-button" onClick={()=>setEdit(null)}>Скасувати</button></div>
    </form>}
    <div className="table-heading"><h3>Історія бронювань</h3><select aria-label="Фільтр історії" value={scope} onChange={e=>{setScope(e.target.value);setPage(0);}}><option value="all">Усі</option><option value="upcoming">Майбутні</option><option value="past">Минулі</option></select></div>
    {loading?<p role="status">Завантажуємо бронювання…</p>:history&&<><div className="table-scroll"><table><thead><tr><th>Дата візиту</th><th>Тип ресурсу</th><th>Час</th><th>Сума / статус</th><th>Дії</th></tr></thead><tbody>{history.content.map(item=><tr key={item.id}><td>{item.bookingDate}</td><td>{displayWorkspace(item.workspace)}</td><td>{item.startTime?.slice(0,5)||'09:00'}–{item.endTime?.slice(0,5)||'19:00'}</td><td>{money(item.totalPrice)}<small>{statusText(item.status)}</small></td><td><div className="actions"><button className="btn outline small" onClick={()=>onRepeat(item.workspace,item)}>Повторити</button>{item.status==='CONFIRMED'&&<button className="text-button danger" onClick={()=>setConfirmCancel(item.id)}>Скасувати</button>}</div></td></tr>)}</tbody></table></div>{history.content.length===0&&<p className="empty">Тут з’являться ваші бронювання.</p>}<Pager page={page} total={history.totalPages} change={setPage}/></>}
    {confirmCancel!==null&&<div className="confirm-panel"><p>Скасувати бронювання №{confirmCancel}? Сервер перевірить допустимий строк скасування.</p><div className="actions"><button className="btn small" disabled={busy} onClick={()=>cancel(confirmCancel)}>Так, скасувати</button><button className="btn outline small" onClick={()=>setConfirmCancel(null)}>Залишити</button></div></div>}
    {subscriptions.length>0&&<><h3>Мої абонементи</h3><div className="table-scroll"><table><thead><tr><th>Місце</th><th>Період</th><th>Статус</th></tr></thead><tbody>{subscriptions.map(sub=><tr key={sub.id}><td>Місце #{sub.workspaceId}</td><td>{sub.startDate} — {sub.endDate}</td><td>{statusText(sub.status)}<small>{statusText(sub.paymentStatus)}</small></td></tr>)}</tbody></table></div></>}
    <p className="muted small-copy">Погодинну бронь можна скасувати щонайменше за 2 години, денну — за добу. Остаточне рішення повертає сервіс.</p>
  </Modal>;
}
