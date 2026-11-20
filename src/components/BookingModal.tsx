import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { errorMessage, isBookingAvailabilityConflict, isUnconfirmedWrite } from '../api/errors';
import type { BookingType, Tariff, User, Workspace } from '../api/types';
import { bookingPayload, bookingValidation, displayWorkspace, endTime, money, nextBookingSlot, nextWorkingDay, venueToday } from '../booking';
import { Alert, Icon, Modal, ukrainianFormValidation } from './ui';
import { useVenueClock } from '../useVenueClock';

interface BookingModalProps {
  workspace?: Workspace;
  workspaces: Workspace[];
  user: User;
  tariffs: Tariff[];
  initialType: BookingType;
  initialDate: string;
  initialStart: string;
  initialHours: number;
  onClose: () => void;
  onCreated: () => void;
}
interface Quote { key: string; price: number; available: boolean | null }

export function BookingModal({ workspace: initialWorkspace, workspaces, user, tariffs, initialType, initialDate, initialStart, initialHours, onClose, onCreated }: BookingModalProps) {
  const [workspaceId, setWorkspaceId] = useState<number | null>(initialWorkspace?.id ?? null);
  const [type,setType]=useState<BookingType>(initialWorkspace?.type==='MEETING_ROOM'?'HOURLY':initialType);
  const [date,setDate]=useState(initialDate || nextWorkingDay());
  const [start,setStart]=useState(initialStart);
  const [hours,setHours]=useState(initialHours);
  const [quote,setQuote]=useState<Quote|null>(null);
  const [checking,setChecking]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  const [retry,setRetry]=useState(0);
  const now=useVenueClock();
  const choices=workspaces.filter(w=>type==='HOURLY'||w.type==='DESK');
  const workspace=choices.find(w=>w.id===workspaceId);
  const validation=bookingValidation(date,start,hours,type,now);
  const payload=useMemo(()=>workspace?bookingPayload(workspace.id,type==='DAILY'?'DAILY':'HOURLY',date,start,hours):null,[workspace?.id,type,date,start,hours]);
  // Never reuse a quote for another desk or time, even during the render before an effect runs.
  const quoteKey=JSON.stringify([workspace?.id,type,date,start,hours]);
  const price=quote?.key===quoteKey?quote.price:null;
  const available=quote?.key===quoteKey?quote.available:null;
  useEffect(()=>{
    if(success)return;
    setQuote(null);setError('');
    if(!workspace||!payload||validation){setChecking(false);return;}
    const controller=new AbortController();setChecking(true);
    if(type==='SUBSCRIPTION') {
      // There is no full-month availability or subscription quote endpoint.
      // Existing backend uses a fixed 3500 UAH amount; do not trust the tariff table for it.
      setQuote({key:quoteKey,price:3500,available:null});setChecking(false);return ()=>controller.abort();
    }
    Promise.all([api.price(payload,controller.signal),api.availability(date,type==='DAILY'?'09:00':start,type==='DAILY'?'19:00':endTime(start,hours),controller.signal)])
      .then(([amount,map])=>{if(!controller.signal.aborted){if(typeof amount !== 'number' || !Number.isFinite(amount)) {
        setError('Сервіс не повернув вартість бронювання.');
        return;
      }
      const item = map.find(w => w.id === workspace.id);
      if (!item) {
        setError('Сервіс не повернув дані про доступність цього місця.');
        return;
      }
      setQuote({key:quoteKey,price:amount,available:item.isAvailable});}})
      .catch(err=>{if(!controller.signal.aborted)setError(errorMessage(err, 'Не вдалося перевірити доступність або вартість бронювання.'));})
      .finally(()=>{if(!controller.signal.aborted)setChecking(false);});
    return ()=>controller.abort();
  },[payload,date,start,hours,type,validation,workspace?.id,quoteKey,retry,success]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const currentValidation=bookingValidation(date,start,hours,type);
    if(currentValidation){setError(currentValidation);return;}
    if(!workspace||!payload||busy||checking||validation||price===null||(type!=='SUBSCRIPTION'&&available!==true))return;
    setBusy(true);setError('');
    try {
      if(type==='SUBSCRIPTION') {
        const result=await api.subscribe(workspace.id,date);
        setSuccess(`${displayWorkspace(workspace)} утримується з ${result.startDate} до ${result.endDate}. Абонемент очікує оплати. Для підтвердження зверніться до адміністратора протягом 24 годин.`);
      } else {
        const created=await api.book(payload);
        if (!Array.isArray(created) || !created.length) {
          setError('Сервер не підтвердив створення бронювання. Перевірте історію перед повторною спробою.');
          return;
        }
        setSuccess(`Бронювання №${created[0].id} підтверджено: ${displayWorkspace(workspace)}. ${date}, ${type==='DAILY'?'09:00–19:00':`${start}–${endTime(start,hours)}`}. До сплати: ${money(created[0].totalPrice)}. Оплата адміністратору.`);
      }
      onCreated();
    } catch (err) {
      if (isUnconfirmedWrite(err)) {
        const location = type === 'SUBSCRIPTION' ? 'список абонементів' : 'історію бронювань';
        setError(`Не отримано підтвердження від сервісу. Перевірте ${location} перед повторною спробою.`);
      } else {
        setError(errorMessage(err, 'Не вдалося оформити бронювання.'));
      }
      if (type !== 'SUBSCRIPTION' && isBookingAvailabilityConflict(err)) {
        setQuote(current => current?.key === quoteKey ? {...current,available:false} : current);
      }
    }
    finally{setBusy(false);}
  }
  const monthlyTariff=tariffs.find(t=>t.workspaceType==='DESK'&&t.bookingType==='SUBSCRIPTION');
  return <Modal title="Бронювання місця" onClose={onClose}>
    <p className="eyebrow">Оформлення бронювання · час Києва</p>
    {success?<><Alert success>{success}</Alert><button className="btn full" onClick={onClose}>Готово</button></>:<>
      <form {...ukrainianFormValidation} className="form" onSubmit={submit}>
        <label>Місце для бронювання<select required disabled={busy} value={workspace?.id??''} onChange={e=>setWorkspaceId(Number(e.target.value))}>
          <option value="" disabled>{type==='HOURLY'?'Оберіть стіл або переговорну':'Оберіть стіл'}</option>
          <optgroup label="Робочі столи">{choices.filter(w=>w.type==='DESK').map(w=><option key={w.id} value={w.id}>{displayWorkspace(w)}</option>)}</optgroup>
          {type==='HOURLY'&&choices.some(w=>w.type==='MEETING_ROOM')&&<optgroup label="Переговорна">{choices.filter(w=>w.type==='MEETING_ROOM').map(w=><option key={w.id} value={w.id}>{displayWorkspace(w)}</option>)}</optgroup>}
        </select></label>
        <label>Формат<select disabled={busy} value={type} onChange={e=>setType(e.target.value as BookingType)}><option value="HOURLY">Погодинний</option><option value="DAILY" disabled={workspace?.type==='MEETING_ROOM'}>Повний день</option>{user.role==='USER'&&<option value="SUBSCRIPTION" disabled={workspace?.type==='MEETING_ROOM'}>Місячний абонемент</option>}</select></label>
        <label>{type==='SUBSCRIPTION'?'Початок абонемента':'Дата'}<input type="date" required disabled={busy} min={venueToday(now)} value={date} onChange={e=>setDate(e.target.value)} /></label>
        {type==='HOURLY'&&<div className="form-row"><label>Початок<select disabled={busy} value={start} onChange={e=>setStart(e.target.value)}>{Array.from({length:10},(_,i)=>`${String(i+9).padStart(2,'0')}:00`).map(t=><option key={t} disabled={!!bookingValidation(date,t,1,'HOURLY',now)}>{t}</option>)}</select></label><label>Тривалість<select disabled={busy} value={hours} onChange={e=>setHours(Number(e.target.value))}>{[1,2,3,4].map(h=><option key={h} value={h} disabled={!!bookingValidation(date,start,h,'HOURLY',now)}>{h} год.</option>)}</select></label></div>}
        <div className="form-row"><label>Ім’я<input value={user.name} readOnly /></label><label>Номер телефону<input value={user.phone || 'Не вказано'} readOnly /></label></div>
        {workspace?.type==='MEETING_ROOM'&&<p className="muted">Переговорна кімната доступна лише для погодинного бронювання.</p>}
        {type==='SUBSCRIPTION'&&<p className="muted">Один календарний місяць. Наявність місця на весь період перевіряється під час оформлення.</p>}
        {monthlyTariff&&type==='SUBSCRIPTION'&&monthlyTariff.price!==3500&&<Alert>Вартість абонемента потребує уточнення в адміністратора.</Alert>}
        {validation&&<Alert>{validation}{type==='HOURLY'&&<> <button type="button" disabled={busy} className="text-button" onClick={()=>{const slot=nextBookingSlot();setDate(slot.date);setStart(slot.start);setHours(1);}}>Обрати найближчий час</button></>}</Alert>}{error&&<Alert>{error}</Alert>}
        {!workspace&&<p className="muted" role="status">Оберіть місце зі списку, щоб перевірити наявність і вартість.</p>}
        {available===false&&!error&&<Alert>Місце недоступне у вибраний час. Оберіть інше місце, дату або час.</Alert>}
        <div className="booking-total"><div><small>Разом до сплати:</small><strong>{checking?'Уточнюємо…':price===null?'—':money(price)}</strong></div><span className="pill">Оплата адміністратору</span></div>
        <button className="btn full" disabled={!workspace||busy||checking||!!validation||price===null||(type!=='SUBSCRIPTION'&&available!==true)}>{busy?'Оформлюємо…':'Забронювати'}<Icon name="imgIconCalendar"/></button>
        {error&&type!=='SUBSCRIPTION'&&<button type="button" className="text-button" onClick={()=>setRetry(v=>v+1)}>Оновити доступність і вартість</button>}
      </form>
    </>}
  </Modal>;
}
