import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { ApiError, errorMessage } from '../api/client';
import type { BookingType, Tariff, User, Workspace } from '../api/types';
import { bookingPayload, bookingValidation, displayWorkspace, endTime, money, nextBookingSlot, nextWorkingDay, venueToday } from '../booking';
import { Alert, Icon, Modal } from './ui';
import { useVenueClock } from '../useVenueClock';

export function BookingModal({ workspace, user, tariffs, initialType, initialDate, initialStart, initialHours, onClose, onCreated }: { workspace: Workspace; user: User; tariffs: Tariff[]; initialType: BookingType; initialDate: string; initialStart: string; initialHours: number; onClose: () => void; onCreated: () => void }) {
  const [type,setType]=useState<BookingType>(workspace.type==='MEETING_ROOM'?'HOURLY':initialType);
  const [date,setDate]=useState(initialDate || nextWorkingDay());
  const [start,setStart]=useState(initialStart);
  const [hours,setHours]=useState(initialHours);
  const [price,setPrice]=useState<number|null>(null);
  const [available,setAvailable]=useState<boolean|null>(null);
  const [checking,setChecking]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  const [retry,setRetry]=useState(0);
  const now=useVenueClock();
  const validation=bookingValidation(date,start,hours,type,now);
  const payload=useMemo(()=>bookingPayload(workspace.id,type==='DAILY'?'DAILY':'HOURLY',date,start,hours),[workspace.id,type,date,start,hours]);
  useEffect(()=>{
    if(success)return;
    setPrice(null);setAvailable(null);setError('');
    if(validation){setChecking(false);return;}
    const controller=new AbortController();setChecking(true);
    if(type==='SUBSCRIPTION') {
      // There is no full-month availability or subscription quote endpoint.
      // Existing backend uses a fixed 3500 UAH amount; do not trust the tariff table for it.
      setPrice(3500);setChecking(false);return ()=>controller.abort();
    }
    Promise.all([api.price(payload,controller.signal),api.availability(date,type==='DAILY'?'09:00':start,type==='DAILY'?'19:00':endTime(start,hours),controller.signal)])
      .then(([amount,map])=>{if(!controller.signal.aborted){if(!Number.isFinite(Number(amount)))throw new Error('Сервіс не повернув вартість.');setPrice(Number(amount));setAvailable(map.find(w=>w.id===workspace.id)?.isAvailable===true);}})
      .catch(err=>{if(!controller.signal.aborted)setError(errorMessage(err));})
      .finally(()=>{if(!controller.signal.aborted)setChecking(false);});
    return ()=>controller.abort();
  },[payload,date,start,hours,type,validation,workspace.id,retry,success]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const currentValidation=bookingValidation(date,start,hours,type);
    if(currentValidation){setError(currentValidation);return;}
    if(busy||checking||validation||price===null||(type!=='SUBSCRIPTION'&&available!==true))return;
    setBusy(true);setError('');
    try {
      if(type==='SUBSCRIPTION') {
        const result=await api.subscribe(workspace.id,date);
        setSuccess(`Місце утримується з ${result.startDate} до ${result.endDate}. Абонемент очікує оплати. Для підтвердження зверніться до адміністратора протягом 24 годин.`);
      } else {
        const created=await api.book(payload);
        if(!created.length)throw new Error('Сервер не повернув створене бронювання. Перевірте історію перед повторною спробою.');
        setSuccess(`Бронювання №${created[0].id} підтверджено. ${date}, ${type==='DAILY'?'09:00–19:00':`${start}–${endTime(start,hours)}`}. До сплати: ${money(created[0].totalPrice)}. Оплата адміністратору.`);
      }
      onCreated();
    }catch(err){setError(err instanceof ApiError&&err.status===0?'Не отримано підтвердження від сервера. Перевірте історію бронювань перед повторною спробою.':errorMessage(err));if(err instanceof ApiError&&err.status===409&&type!=='SUBSCRIPTION'){setAvailable(false);} }
    finally{setBusy(false);}
  }
  const monthlyTariff=tariffs.find(t=>t.workspaceType==='DESK'&&t.bookingType==='SUBSCRIPTION');
  return <Modal title={displayWorkspace(workspace)} onClose={onClose}>
    <p className="eyebrow">Оформлення бронювання · час Києва</p>
    {success?<><Alert success>{success}</Alert><button className="btn full" onClick={onClose}>Готово</button></>:<>
      <form className="form" onSubmit={submit}>
        {workspace.type==='DESK'&&<label>Формат<select value={type} onChange={e=>setType(e.target.value as BookingType)}><option value="HOURLY">Погодинний</option><option value="DAILY">Повний день</option>{user.role==='USER'&&<option value="SUBSCRIPTION">Місячний абонемент</option>}</select></label>}
        <label>{type==='SUBSCRIPTION'?'Початок абонемента':'Дата'}<input type="date" required min={venueToday(now)} value={date} onChange={e=>setDate(e.target.value)} /></label>
        {type==='HOURLY'&&<div className="form-row"><label>Початок<select value={start} onChange={e=>setStart(e.target.value)}>{Array.from({length:10},(_,i)=>`${String(i+9).padStart(2,'0')}:00`).map(t=><option key={t} disabled={!!bookingValidation(date,t,1,'HOURLY',now)}>{t}</option>)}</select></label><label>Тривалість<select value={hours} onChange={e=>setHours(Number(e.target.value))}>{[1,2,3,4].map(h=><option key={h} value={h} disabled={!!bookingValidation(date,start,h,'HOURLY',now)}>{h} год.</option>)}</select></label></div>}
        <div className="form-row"><label>Ім’я<input value={user.name} readOnly /></label><label>Номер телефону<input value={user.phone || 'Не вказано'} readOnly /></label></div>
        {type==='SUBSCRIPTION'&&<p className="muted">Один календарний місяць. Наявність місця на весь період перевіряється під час оформлення.</p>}
        {monthlyTariff&&type==='SUBSCRIPTION'&&monthlyTariff.price!==3500&&<Alert>Вартість абонемента потребує уточнення в адміністратора.</Alert>}
        {validation&&<Alert>{validation}{type==='HOURLY'&&<> <button type="button" className="text-button" onClick={()=>{const slot=nextBookingSlot();setDate(slot.date);setStart(slot.start);setHours(1);}}>Обрати найближчий час</button></>}</Alert>}{error&&<Alert>{error}</Alert>}
        {available===false&&!error&&<Alert>Місце зайняте у вибраний час. Оберіть іншу дату або час.</Alert>}
        <div className="booking-total"><div><small>Разом до сплати:</small><strong>{checking?'Уточнюємо…':price===null?'—':money(price)}</strong></div><span className="pill">Оплата адміністратору</span></div>
        <button className="btn full" disabled={busy||checking||!!validation||price===null||(type!=='SUBSCRIPTION'&&available!==true)}>{busy?'Оформлюємо…':'Забронювати'}<Icon name="imgIconCalendar"/></button>
        {error&&<button type="button" className="text-button" onClick={()=>setRetry(v=>v+1)}>Перевірити ще раз</button>}
      </form>
    </>}
  </Modal>;
}
