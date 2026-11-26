import { useEffect, useState } from 'react';
import assets from './assets.json';
import { api, galleryImageUrl } from './api';
import { ApiError, errorMessage, hasSession } from './api/client';
import type { Availability, BookingType, ClosedDay, GalleryImageItem, HistoryItem, Tariff, User, Workspace } from './api/types';
import { bookingCloseTime, bookingOpenTime, bookingValidation, displayWorkspace, endTime, isRetiredWorkspace, isWeekend, money, nextBookingSlot, venueTime, venueToday } from './booking';
import { Alert, Icon, Logo, Modal, SectionTitle } from './components/ui';
import { AuthModal } from './components/AuthModal';
import { BookingModal } from './components/BookingModal';
import { ProfileModal } from './components/ProfileModal';
import { AdminModal } from './components/AdminModal';
import { PaymentReturn } from './components/PaymentReturn';
import { myBookingsPath, paymentSuccessPath } from './checkout';
import { useVenueClock } from './useVenueClock';

const plans: { title: string; label: string; type: BookingType; workspaceType: 'DESK'|'MEETING_ROOM'; reference: number; unit: string; features: string[] }[] = [
  {title:'Погодинний',label:'Робоче місце',type:'HOURLY',workspaceType:'DESK',reference:150,unit:'/година',features:['Бронювання від 1 до 4 годин','Доступ у години 09:00–19:00','Кава та чай','Бездротовий інтернет і розетки']},
  {title:'Денний',label:'Робоче місце',type:'DAILY',workspaceType:'DESK',reference:500,unit:'/день',features:['Повний день (09:00–19:00)','Зона відпочинку','Зона для кави','Бездротовий інтернет і розетки']},
  {title:'Місячний',label:'Абонемент',type:'SUBSCRIPTION',workspaceType:'DESK',reference:3500,unit:'/місяць',features:['Персональне місце','Доступ у години 09:00–19:00','Зона для кави','Бездротовий інтернет і розетки']},
  {title:'Переговорна',label:'Окрема кімната',type:'HOURLY',workspaceType:'MEETING_ROOM',reference:200,unit:'/година',features:['Лише погодинна оренда','Доступ у години 09:00–19:00','Приватність для команди','Бездротовий інтернет і розетки']},
];
const nav = [['services','Послуги'],['booking','Бронювання'],['advantages','Переваги'],['pricing','Тарифи'],['gallery','Галерея'],['location','Розташування']];
const galleryAlbums = [
  {
    label: 'Переговорна кімната',
    photos: [assets.imgImageContainer],
  },
  {
    label: 'Кімната коворкінгу',
    photos: [assets.imgImageContainer1],
  },
  {
    label: 'Кухня',
    photos: ['/assets/rest-zone-coffee.png', '/assets/kitchen.jpg'],
  },
  {
    label: 'Зони відпочинку',
    photos: [assets.imgPhotoContainer3, '/assets/rest-zone.jpg', '/assets/rest-zone2.jpg'],
  },
];
type Selected = { workspace?: Workspace; type: BookingType; date: string; start: string; hours: number };
function nextOpenDate(fromDate: string, closedSet: Set<string>): string {
  const cursor = new Date(`${fromDate}T12:00:00Z`);
  for (let i = 0; i < 60; i++) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const iso = cursor.toISOString().slice(0, 10);
    if (!isWeekend(iso) && !closedSet.has(iso)) return iso;
  }
  return fromDate;
}

function formatUkrainianDay(isoDate: string): string {
  return new Intl.DateTimeFormat('uk-UA', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T12:00:00Z`));
}
export default function App() {
  const path = location.pathname.replace(/\/$/, '');
  const paymentPage = path === paymentSuccessPath;
  const bookingsPage = path === myBookingsPath;
  const [user,setUser]=useState<User|null>(null);
  const [authLoading,setAuthLoading]=useState(hasSession());
  const [sessionError,setSessionError]=useState('');
  const [workspaces,setWorkspaces]=useState<Workspace[]>([]);
  const [tariffs,setTariffs]=useState<Tariff[]>([]);
  const [uploadedPhotos, setUploadedPhotos] = useState<GalleryImageItem[]>([]);
  const [closedDays,setClosedDays]=useState<ClosedDay[]>([]);
  const [catalogError,setCatalogError]=useState('');
  const [catalogLoading,setCatalogLoading]=useState(true);
  const [availability,setAvailability]=useState<Availability[]>([]);
  const [availabilityError,setAvailabilityError]=useState('');
  const [checking,setChecking]=useState(false);
  const now=useVenueClock();
  const [initialSlot]=useState(()=>nextBookingSlot());
  const [date,setDate]=useState(initialSlot.date);
  const [start,setStart]=useState(initialSlot.start);
  const [hours,setHours]=useState(1);
  const [revision,setRevision]=useState(0);
  const [authOpen,setAuthOpen]=useState(false);
  const [profile,setProfile]=useState(false);
  const [admin,setAdmin]=useState(false);
  const [privacy,setPrivacy]=useState(false);
  const [selected,setSelected]=useState<Selected|null>(null);
  const [pending,setPending]=useState<Selected|null>(null);
  const [mobileNav,setMobileNav]=useState(false);
  const [activeAlbum, setActiveAlbum] = useState<{ label: string; photos: string[]; index: number } | null>(null);
  const bookableWorkspaces=workspaces.filter(workspace=>!isRetiredWorkspace(workspace));
  const validation=bookingValidation(date,start,hours,'HOURLY',now);
  const closedInfo = closedDays.find(d => d.date === date);
  const closedMessage = closedInfo
    ? `Коворкінг зачинений у вибраний день${closedInfo.reason ? ` (${closedInfo.reason})` : ''}. Найближчий робочий день — ${formatUkrainianDay(nextOpenDate(date, new Set(closedDays.map(d => d.date))))}, з ${bookingOpenTime} до ${bookingCloseTime}.`
    : null;

  useEffect(()=>{
    if(date<venueToday(now)||(date===venueToday(now)&&start<=venueTime(now).slice(0,5))){
      const next=nextBookingSlot(now);setDate(next.date);setStart(next.start);
    }
  },[now,date,start]);
  useEffect(()=>{let active=true;setCatalogLoading(true);setCatalogError('');
    Promise.allSettled([api.workspaces(), api.tariffs(), api.closedDays(), api.gallery(0, 100)]).then(([spaces, prices, closed, gallery]) => {
      if(!active)return;
      if(spaces.status==='fulfilled')setWorkspaces(spaces.value);
      if(prices.status==='fulfilled')setTariffs(prices.value);
      if(closed.status==='fulfilled')setClosedDays(closed.value);
      if (gallery.status === 'fulfilled') setUploadedPhotos(gallery.value.content);
      if (spaces.status === 'rejected' && prices.status === 'rejected') {
        const reasons = new Set([errorMessage(spaces.reason, ''), errorMessage(prices.reason, '')]);
        setCatalogError(`Не вдалося завантажити місця й тарифи. ${[...reasons].filter(Boolean).join(' ')}`.trim());
      } else if (spaces.status === 'rejected') {
        setCatalogError(`Не вдалося завантажити місця. ${errorMessage(spaces.reason, '')}`.trim());
      } else if (prices.status === 'rejected') {
        setCatalogError(`Не вдалося завантажити тарифи. ${errorMessage(prices.reason, '')}`.trim());
      }
      setCatalogLoading(false);
    });return()=>{active=false;};
  },[revision]);
  useEffect(()=>{let active=true;const handle=()=>{if(!hasSession())setUser(null);};window.addEventListener('tviy-session',handle);
    if(hasSession())api.me().then(u=>{if(active)setUser(u);}).catch(err=>{if(active)setSessionError(errorMessage(err, 'Не вдалося завантажити профіль.'));}).finally(()=>{if(active)setAuthLoading(false);});
    return()=>{active=false;window.removeEventListener('tviy-session',handle);};
  },[]);
  useEffect(()=>{
    setAvailability([]);setAvailabilityError('');
    if(paymentPage||bookingsPage||authLoading||validation){setChecking(false);return;}
    const controller=new AbortController();setChecking(true);
    api.availability(date,start,endTime(start,hours),controller.signal,!!user)
      .then(map=>{if(!controller.signal.aborted)setAvailability(map);})
      .catch(err=>{
        if(controller.signal.aborted)return;
        setAvailabilityError(!user && err instanceof ApiError && (err.status===401||err.status===403)
          ? 'Перегляд доступності без входу наразі недоступний.'
          : errorMessage(err, 'Не вдалося перевірити доступність місць.'));
      })
      .finally(()=>{if(!controller.signal.aborted)setChecking(false);});
    return()=>controller.abort();
  },[user?.id,date,start,hours,validation,revision,paymentPage,bookingsPage,authLoading]);
  async function loggedIn(){const u=await api.me();setUser(u);setSessionError('');setAuthLoading(false);if(pending){setSelected(pending);setPending(null);}}
  function choose(workspace:Workspace|undefined,type:BookingType='HOURLY',settings?:Partial<Selected>){const choice={workspace,type,date,start,hours,...settings};if(!user){setPending(choice);setAuthOpen(true);}else setSelected(choice);}
  function planChoice(type:BookingType,workspaceType:'DESK'|'MEETING_ROOM'){
    // A desk tariff describes a format, not a particular desk. Require an explicit choice.
    const workspace=workspaceType==='MEETING_ROOM'?bookableWorkspaces.find(w=>w.type==='MEETING_ROOM'):undefined;
    if(bookableWorkspaces.some(w=>w.type===workspaceType))choose(workspace,type);
    else document.getElementById('booking')?.scrollIntoView({behavior:'smooth'});
  }
  const price=(workspaceType:'DESK'|'MEETING_ROOM',type:BookingType,fallback:number) => tariffs.find(t=>t.workspaceType===workspaceType&&t.bookingType===type)?.price??fallback;
  const room=bookableWorkspaces.find(w=>w.type==='MEETING_ROOM');
  const desks=bookableWorkspaces.filter(w=>w.type==='DESK');
  const navLinks=nav.map(([id,label])=><a key={id} href={`#${id}`} onClick={()=>setMobileNav(false)}>{label}</a>);
  function deskCard(workspace:Workspace|undefined,index:number){
    const state=workspace?availability.find(w=>w.id===workspace.id):undefined;
    const free=state?.isAvailable;
    const status=checking?'Перевіряємо':free===true?'Вільний':free===false?'Недоступний':'Немає даних';
    const label=workspace?displayWorkspace(workspace):`Робоче місце №${index+1}`;
    return <button key={workspace?.id??`placeholder-${index}`} className={`desk ${free===true?'free':free===false?'occupied':'unknown'}`} style={{gridArea:index<6?`desk${index+1}`:undefined}} disabled={!workspace||free===false||checking||!!validation||!!closedInfo} onClick={()=>workspace&&choose(workspace)} aria-label={`${label}: ${status.toLocaleLowerCase('uk')}`}><span className="desk-number">{index+1}</span><strong>{label}</strong><small>{status}</small></button>;
  }
  const roomFree=room?availability.find(w=>w.id===room.id)?.isAvailable:undefined;
  const authDialog = authOpen && <AuthModal onClose={() => { setAuthOpen(false); setPending(null); }} onLogin={loggedIn} />;
  const bookingDialog = selected && user && <BookingModal {...selected} workspaces={bookableWorkspaces} initialType={selected.type} initialDate={selected.date} initialStart={selected.start} initialHours={selected.hours} user={user} tariffs={tariffs} onClose={() => setSelected(null)} onCreated={() => setRevision(value => value + 1)} />;
  const profileView = user && <ProfileModal standalone={bookingsPage} user={user}
    onUser={setUser} onLogoutError={setSessionError} onClose={() => setProfile(false)}
    onRepeat={(workspace: Workspace, item: HistoryItem) => {
      setProfile(false);
      const hours = item.startTime && item.endTime
        ? Math.min(4, Math.max(1, Number(item.endTime.slice(0, 2)) - Number(item.startTime.slice(0, 2)))) : 1;
      choose(workspace, item.bookingType, { ...nextBookingSlot(), hours });
    }} />;
  if (paymentPage || bookingsPage) {
    return <>
      <header className="container header"><Logo href="/" /><a className="btn outline small" href="/">На головну</a></header>
      <main className={'container checkout-page' + (paymentPage ? ' checkout-result' : '')}>
        <h1>{paymentPage ? 'Результат оплати' : 'Мої бронювання'}</h1>
        {sessionError && <Alert>{sessionError}</Alert>}
        {paymentPage ? <>
          <PaymentReturn user={user} authLoading={authLoading} onLogin={() => setAuthOpen(true)} dedicated />
          <a className="btn outline" href={myBookingsPath}>Мої бронювання</a>
        </> : user ? profileView : authLoading
          ? <p role="status">Завантажуємо профіль…</p>
          : <p><button className="text-button" onClick={() => setAuthOpen(true)}>Увійдіть</button>, щоб переглянути бронювання.</p>}
      </main>
      {authDialog}
      {bookingDialog}
    </>;
  }
const mergedAlbums = galleryAlbums.map(album => {
  const extra = uploadedPhotos
    .filter(item => item.caption === album.label)
    .map(item => galleryImageUrl(item));
  return { ...album, photos: [...album.photos, ...extra] };
});
  return <>
    <a className="skip" href="#main">Перейти до вмісту</a>
    <header className="container header" id="home"><Logo/><button className="mobile-menu btn outline small" aria-label="Відкрити меню" aria-expanded={mobileNav} onClick={()=>setMobileNav(v=>!v)}>Меню</button><nav className={mobileNav?'expanded':''} aria-label="Головна навігація">{navLinks}</nav><div className="header-actions">{user?.role==='ADMIN'&&<button className="btn outline small" onClick={()=>setAdmin(true)}>Адмін-панель</button>}<button className="btn outline small" disabled={authLoading} onClick={()=>user?setProfile(true):setAuthOpen(true)}>{authLoading?'Зачекайте…':user?'Мій профіль':'Увійти'}</button></div></header>
    <main id="main" className="container">
      {sessionError && <Alert>{sessionError}</Alert>}
      <PaymentReturn user={user} authLoading={authLoading} onLogin={() => setAuthOpen(true)} />
      <section className="hero" aria-labelledby="hero-title"><h1 id="hero-title">Твій хаб — простір для твоїх ідей!</h1><p>Сучасний коворкінг із домашнім затишком. Гарантований інтернет, безперебійне світло та спільнота, з якою рости приємніше.</p><div className="hero-actions"><a className="btn" href="#booking">Забронювати місце<Icon name="imgIconCalendar2"/></a><a className="btn outline" href="#services">Оглянути приміщення</a></div><div className="hero-image"><img src={assets.imgImageContainer1} alt="Затишний спільний робочий простір Твій хаб" fetchPriority="high"/></div></section>
      <section id="services"><SectionTitle title="Наші послуги" description="У нас є 2 комфортні зони для ваших завдань — для глибокого фокусу або важливих переговорів."/><div className="services-grid">
        <article className="service-card"><div className="service-image meeting-image"><img src={assets.imgImageContainer} alt="Команда за столом у приватній переговорній" loading="lazy"/></div><h3>Окрема переговорна кімната</h3><p>Простір для проведення онлайн-зустрічей, переговорів з клієнтами, командних обговорень та презентацій.</p><ul className="checks"><li><Icon name="imgIconCheck"/>Приватність</li><li><Icon name="imgIconCheck"/>Розетки</li></ul><div className="card-bottom"><div><small>{tariffs.length?'Вартість':'Орієнтовна вартість'}</small><strong>{money(price('MEETING_ROOM','HOURLY',200))}<small> / година</small></strong></div><button className="btn" onClick={()=>planChoice('HOURLY','MEETING_ROOM')}>Забронювати<Icon name="imgIconCalendar"/></button></div></article>
        <article className="service-card"><div className="service-image"><img src={assets.imgImageContainer1} alt="Робочі місця зі столами та настільними лампами" loading="lazy"/></div><h3>Спільна робоча кімната</h3><p>Затишне робоче приміщення зі столами, зручними кріслами, розетками біля кожного місця та спокійною атмосферою.</p><ul className="checks"><li><Icon name="imgIconCheck"/>Тихий режим для роботи та навчання</li><li><Icon name="imgIconCheck"/>Розетки</li></ul><div className="card-bottom"><div><small>{tariffs.length?'Вартість':'Орієнтовна вартість'}</small><strong>від {money(price('DESK','HOURLY',150))}<small> / година</small></strong></div><button className="btn" onClick={()=>planChoice('HOURLY','DESK')}>Забронювати<Icon name="imgIconCalendar"/></button></div></article>
      </div></section>
      <section id="booking"><SectionTitle title="Онлайн-бронювання" description="Натисніть на бажане робоче місце або переговорну кімнату для перегляду доступності та швидкого оформлення бронювання."/>
        <div className="booking-controls"><label>Дата<input type="date" value={date} min={venueToday(now)} onChange={e=>setDate(e.target.value)}/></label><label>Початок<select value={start} onChange={e=>setStart(e.target.value)}>{Array.from({length:10},(_,i)=>`${String(i+9).padStart(2,'0')}:00`).map(t=><option key={t} disabled={!!bookingValidation(date,t,1,'HOURLY',now)}>{t}</option>)}</select></label><label>Тривалість<select value={hours} onChange={e=>setHours(Number(e.target.value))}>{[1,2,3,4].map(h=><option key={h} value={h} disabled={!!bookingValidation(date,start,h,'HOURLY',now)}>{h} год.</option>)}</select></label><button className="btn outline small" disabled={checking||catalogLoading} onClick={()=>setRevision(v=>v+1)}>Оновити</button></div>

        {validation&&<Alert>{validation}</Alert>}{!validation&&closedMessage&&<Alert>{closedMessage}</Alert>}{catalogError&&<Alert>{catalogError}</Alert>}{availabilityError&&<Alert>{availabilityError}</Alert>}
        {!user&&!authLoading&&!catalogError&&<p className="booking-signin"><button className="text-button" onClick={()=>choose(undefined)}>Забронювати місце</button></p>}
        {catalogLoading&&<p role="status" className="booking-signin">Завантажуємо простір…</p>}
        <p className="booking-signin">Доступність для {date}, {start}–{endTime(start,hours)} за Київським часом</p><div className="legend"><span><i className="free"/>Вільний стіл</span><span><i className="occupied"/>Недоступно</span></div>
        <div className="booking-grid"><article className="meeting-card"><div className="meeting-heading"><div><p className="eyebrow">Окрема зона</p><h3>Переговорна кімната</h3></div><span className="icon-circle"><Icon name="imgIconPeople"/></span></div><ul className="room-features"><li><Icon name="imgGroup2"/>Безперервний інтернет</li><li><Icon name="imgIconLight"/>Світло 24/7</li><li><Icon name="imgIconCoffee"/>Кава та чай у вільному доступі</li><li><Icon name="imgIconGroup"/>Приватний простір для команди</li></ul><div className="card-bottom"><div><small>{tariffs.length?'Вартість':'Орієнтовна вартість'}</small><strong>{money(price('MEETING_ROOM','HOURLY',200))}<small> / година</small></strong></div><button className="btn" disabled={!room||roomFree===false||checking||!!validation||!!closedInfo} onClick={()=>room&&choose(room)}>Обрати</button></div>{roomFree===false&&<small className="danger">Недоступна у вибраний час</small>}</article>
                <div className="floorplan">
                  <h3>{desks.length?`Робочі місця (${desks.length})`:"Схема робочих місць"}</h3>
                  <div className={`desk-map ${desks.length>5?'extra-desks':''}`}>
                    <img className="rest rest-left" src="/assets/rest-zone-left.png" alt="Зона відпочинку" width={178} height={112} loading="lazy" />
                    {(desks.length?desks:Array.from({length:5},()=>undefined)).map(deskCard)}
                    <img className="rest rest-right" src="/assets/rest-zone-right.png" alt="Зона відпочинку" width={178} height={112} loading="lazy" />
                  </div>
                </div></div>
      </section>
      <section id="advantages"><SectionTitle title="Чому обирають Твій хаб?" description="Ми знаємо, як важливо мати стабільне світло, швидкий інтернет та робочу тишу в умовах сьогодення. Тому у нас завжди комфортно, немає зайвого шуму, а кожна деталь продумана для високої продуктивності."/><div className="badges">{['Безперервний інтернет','Світло 24/7','Бездротовий інтернет','Чай та кава у вільному доступі'].map(text=><span key={text}><Icon name="imgIconCheck1"/>{text}</span>)}</div><div className="gallery">{(['imgPhotoContainer','imgPhotoContainer1','imgPhotoContainer2','imgPhotoContainer3'] as const).map((name,i)=><img key={name} src={assets[name]} alt={['Кава та затишна зона відпочинку','Робоча атмосфера коворкінгу','Світлий простір Твій хаб','Гості коворкінгу'][i]} loading="lazy"/>)}</div></section>
      <section id="pricing"><SectionTitle title="Наші тарифні плани" description="Обирайте зручний формат: від кількох годин для термінового дзвінка до закріпленого власного столу на цілий місяць."/><div className="pricing-grid">{plans.map(plan=><article className="pricing-card" key={plan.title}><p className="eyebrow">{plan.label}</p><h3>{plan.title}</h3><div className="plan-price"><strong>{money(price(plan.workspaceType,plan.type,plan.reference))}</strong><span>{plan.unit}</span></div><ul className="checks">{plan.features.map(feature=><li key={feature}><Icon name="imgIconCheck"/>{feature}</li>)}</ul><button className="btn outline" disabled={user?.role==='ADMIN'&&plan.type==='SUBSCRIPTION'} onClick={()=>planChoice(plan.type,plan.workspaceType)}>Забронювати<Icon name="imgIconCalendar1"/></button></article>)}</div>{!tariffs.length&&<p className="muted centered">Орієнтовні ціни. Остаточну вартість буде підтверджено під час бронювання.</p>}</section>
           <section id="gallery">
             <SectionTitle
               title="Галерея просторів"
               description="Зазирніть усередину нашого затишного коворкінгу: світлі робочі зони, окрема переговорна кімната та куточок для перезавантаження з ароматним чаєм."
             />
             <div className="gallery spaces-gallery">
               {mergedAlbums.map(album => (
                 <button
                   key={album.label}
                   type="button"
                   className="space-album-card"
                   onClick={() => setActiveAlbum({ label: album.label, photos: album.photos, index: 0 })}
                 >
                   <img src={album.photos[0]} alt={album.label} loading="lazy" />
                   <span className="album-badge">{album.label}</span>
                   {album.photos.length > 1 && (
                     <span className="album-count">{album.photos.length} фото</span>
                   )}
                 </button>
               ))}
             </div>
           </section>
      <section id="location"><SectionTitle title="Де нас знайти?"/><div className="location-grid"><div className="contacts"><div><span className="contact-icon"><Icon name="imgIconLocation"/></span><div><h4>Адреса</h4><p>м. Миколаїв, вул. Олексія Вадатурського, 1</p></div></div><div><span className="contact-icon"><Icon name="imgGroup3"/></span><div><h4>Графік роботи</h4><p>Пн–Пт 09:00–19:00.<br/>Субота та неділя — вихідні.</p></div></div><div><span className="contact-icon"><Icon name="imgIconPhone"/></span><div><h4>Контакти</h4><a href="tel:+380998710595">+380 99 871 0595</a></div></div></div><div className="location-map"><iframe title="Твій хаб на карті — Миколаїв, вул. Олексія Вадатурського, 1" src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2722.2252615539714!2d31.989338599999996!3d46.976910000000004!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x40c5c9396fa069b3%3A0x4f2d8be6a025fb9f!2s%D0%A2%D0%B2%D1%96%D0%B9%20%D1%85%D0%B0%D0%B1%20%E2%80%94%20%D0%BC%D1%96%D0%BD%D1%96%D0%BA%D0%BE%D0%B2%D0%BE%D1%80%D0%BA%D1%96%D0%BD%D0%B3!5e0!3m2!1suk!2sua!4v1794827457765!5m2!1suk!2sua&amp;hl=uk" loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/><a className="map-link" href="https://www.google.com/maps/search/?api=1&amp;hl=uk&amp;query=Миколаїв%20Олексія%20Вадатурського%201" target="_blank" rel="noreferrer">Відкрити на карті ↗</a></div></div></section>
    </main>
    <footer><div className="container"><div className="footer-top"><Logo/><nav aria-label="Нижня навігація">{nav.filter(([id])=>id!=='booking').map(([id,label])=><a key={id} href={`#${id}`}>{label}</a>)}</nav><div className="footer-contact"><span><Icon name="imgIconLocation1"/>м. Миколаїв, вул. Олексія Вадатурського, 1</span><a href="tel:+380998710595"><Icon name="imgIconPhone1"/>+380 99 871 0595</a></div></div><div className="footer-bottom"><span>© 2026 Твій хаб. Всі права захищено.</span><button className="text-button muted" onClick={()=>setPrivacy(true)}>Політика конфіденційності</button></div></div></footer>
    {authDialog}
    {bookingDialog}
    {profile && profileView}
    {admin&&user?.role==='ADMIN'&&<AdminModal userId={user.id} workspaces={workspaces} onClose={()=>setAdmin(false)} onChanged={()=>setRevision(v=>v+1)}/>}
    {privacy&&<Modal title="Політика конфіденційності" onClose={()=>setPrivacy(false)}><p>Для входу та бронювання введені вами дані передаються сервісу Твій хаб. Дані для входу зберігаються лише у відкритій вкладці й видаляються під час виходу з облікового запису.</p><p>Історія бронювань завантажується з вашого облікового запису. За інформацією щодо обробки даних звертайтеся до адміністратора простору.</p></Modal>}
    {activeAlbum && (
      <Modal
        title={activeAlbum.label}
        subtitle={
          activeAlbum.photos.length > 1
            ? `Фото ${activeAlbum.index + 1} з ${activeAlbum.photos.length}`
            : undefined
        }
        onClose={() => setActiveAlbum(null)}
        wide
      >
        <div className="album-viewer">
          <div className="album-stage">
            {activeAlbum.photos.length > 1 && (
              <button
                type="button"
                className="gallery-arrow prev"
                aria-label="Попереднє фото"
                onClick={() =>
                  setActiveAlbum(curr =>
                    curr
                      ? { ...curr, index: (curr.index - 1 + curr.photos.length) % curr.photos.length }
                      : null,
                  )
                }
              >
                ‹
              </button>
            )}
            <img
              src={activeAlbum.photos[activeAlbum.index]}
              alt={`${activeAlbum.label} — фото ${activeAlbum.index + 1}`}
            />
            {activeAlbum.photos.length > 1 && (
              <button
                type="button"
                className="gallery-arrow next"
                aria-label="Наступне фото"
                onClick={() =>
                  setActiveAlbum(curr =>
                    curr ? { ...curr, index: (curr.index + 1) % curr.photos.length } : null,
                  )
                }
              >
                ›
              </button>
            )}
          </div>

          {activeAlbum.photos.length > 1 && (
            <div className="album-thumbs">
              {activeAlbum.photos.map((photo, idx) => (
                <button
                  key={photo}
                  type="button"
                  className={idx === activeAlbum.index ? 'active' : ''}
                  onClick={() => setActiveAlbum(curr => (curr ? { ...curr, index: idx } : null))}
                >
                  <img src={photo} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>
    )}
  </>;
}
