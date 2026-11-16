import { useEffect, useState } from 'react';
import assets from './assets.json';
import { api } from './api';
import { errorMessage, hasSession } from './api/client';
import type { Availability, BookingType, HistoryItem, Tariff, User, Workspace } from './api/types';
import { bookingValidation, displayWorkspace, endTime, money, nextBookingSlot, venueTime, venueToday } from './booking';
import { Alert, Icon, Logo, Modal, SectionTitle } from './components/ui';
import { AuthModal } from './components/AuthModal';
import { BookingModal } from './components/BookingModal';
import { ProfileModal } from './components/ProfileModal';
import { AdminModal } from './components/AdminModal';
import { useVenueClock } from './useVenueClock';

const plans: { title: string; label: string; type: BookingType; workspaceType: 'DESK'|'MEETING_ROOM'; reference: number; unit: string; features: string[] }[] = [
  {title:'Погодинний',label:'Робоче місце',type:'HOURLY',workspaceType:'DESK',reference:150,unit:'/година',features:['Бронювання від 1 до 4 годин','Доступ у години 09:00–19:00','Кава та чай','Wi-Fi та розетки']},
  {title:'Денний',label:'Робоче місце',type:'DAILY',workspaceType:'DESK',reference:500,unit:'/день',features:['Повний день (09:00–19:00)','Можливість виходити','Кава-поінт','Wi-Fi та розетки']},
  {title:'Місячний',label:'Абонемент',type:'SUBSCRIPTION',workspaceType:'DESK',reference:3500,unit:'/місяць',features:['Персональне місце','Доступ у години 09:00–19:00','Кава-поінт','Wi-Fi та розетки']},
  {title:'Переговорна',label:'Окрема кімната',type:'HOURLY',workspaceType:'MEETING_ROOM',reference:200,unit:'/година',features:['Лише погодинна оренда','Доступ у години 09:00–19:00','Приватність для команди','Wi-Fi та розетки']},
];
const nav = [['services','Послуги'],['booking','Бронювання'],['advantages','Переваги'],['pricing','Тарифи'],['location','Локація']];
type Selected = { workspace?: Workspace; type: BookingType; date: string; start: string; hours: number };
export default function App() {
  const [user,setUser]=useState<User|null>(null);
  const [authLoading,setAuthLoading]=useState(hasSession());
  const [workspaces,setWorkspaces]=useState<Workspace[]>([]);
  const [tariffs,setTariffs]=useState<Tariff[]>([]);
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
  const [auth,setAuth]=useState<'login'|'verify'|null>(null);
  const [profile,setProfile]=useState(false);
  const [admin,setAdmin]=useState(false);
  const [privacy,setPrivacy]=useState(false);
  const [selected,setSelected]=useState<Selected|null>(null);
  const [pending,setPending]=useState<Selected|null>(null);
  const [mobileNav,setMobileNav]=useState(false);
  const validation=bookingValidation(date,start,hours,'HOURLY',now);
  useEffect(()=>{
    if(date<venueToday(now)||(date===venueToday(now)&&start<=venueTime(now).slice(0,5))){
      const next=nextBookingSlot(now);setDate(next.date);setStart(next.start);
    }
  },[now,date,start]);
  useEffect(()=>{let active=true;setCatalogLoading(true);setCatalogError('');
    Promise.allSettled([api.workspaces(),api.tariffs()]).then(([spaces,prices])=>{
      if(!active)return;
      if(spaces.status==='fulfilled')setWorkspaces(spaces.value);
      if(prices.status==='fulfilled')setTariffs(prices.value);
      if(spaces.status==='rejected'||prices.status==='rejected')setCatalogError('Онлайн-бронювання тимчасово недоступне. Спробуйте пізніше або зателефонуйте нам.');
      setCatalogLoading(false);
    });return()=>{active=false;};
  },[revision]);
  useEffect(()=>{let active=true;const handle=()=>{if(!hasSession())setUser(null);};window.addEventListener('tviy-session',handle);
    if(hasSession())api.me().then(u=>{if(active)setUser(u);}).catch(err=>{if(active)setAvailabilityError(errorMessage(err));}).finally(()=>{if(active)setAuthLoading(false);});
    return()=>{active=false;window.removeEventListener('tviy-session',handle);};
  },[]);
  useEffect(()=>{
    setAvailability([]);setAvailabilityError('');
    if(!user||validation){setChecking(false);return;}
    const controller=new AbortController();setChecking(true);
    api.availability(date,start,endTime(start,hours),controller.signal).then(map=>{if(!controller.signal.aborted)setAvailability(map);}).catch(err=>{if(!controller.signal.aborted)setAvailabilityError(errorMessage(err));}).finally(()=>{if(!controller.signal.aborted)setChecking(false);});
    return()=>controller.abort();
  },[user?.id,date,start,hours,validation,revision]);
  async function loggedIn(){const u=await api.me();setUser(u);setAuthLoading(false);if(pending){setSelected(pending);setPending(null);}}
  function choose(workspace:Workspace|undefined,type:BookingType='HOURLY',settings?:Partial<Selected>){const choice={workspace,type,date,start,hours,...settings};if(!user){setPending(choice);setAuth('login');}else setSelected(choice);}
  function planChoice(type:BookingType,workspaceType:'DESK'|'MEETING_ROOM'){
    // A desk tariff describes a format, not a particular desk. Require an explicit choice.
    const workspace=workspaceType==='MEETING_ROOM'?workspaces.find(w=>w.type==='MEETING_ROOM'):undefined;
    if(workspaces.some(w=>w.type===workspaceType))choose(workspace,type);
    else document.getElementById('booking')?.scrollIntoView({behavior:'smooth'});
  }
  const price=(workspaceType:'DESK'|'MEETING_ROOM',type:BookingType,fallback:number) => type==='SUBSCRIPTION'?3500:tariffs.find(t=>t.workspaceType===workspaceType&&t.bookingType===type)?.price??fallback;
  const room=workspaces.find(w=>w.type==='MEETING_ROOM');
  const desks=workspaces.filter(w=>w.type==='DESK');
  const navLinks=nav.map(([id,label])=><a key={id} href={`#${id}`} onClick={()=>setMobileNav(false)}>{label}</a>);
  function deskCard(workspace:Workspace|undefined,index:number){
    const state=workspace?availability.find(w=>w.id===workspace.id):undefined;
    const free=state?.isAvailable;
    return <button key={workspace?.id??`placeholder-${index}`} className={`desk ${free===true?'free':free===false?'occupied':'unknown'}`} style={{gridArea:index<6?`desk${index+1}`:undefined}} disabled={!workspace||free===false||checking||!!validation} onClick={()=>workspace&&choose(workspace)} aria-label={`${workspace?displayWorkspace(workspace):`Стіл #${index+1}`}: ${free===true?'вільний':free===false?'зайнятий':'обрати місце'}`}><span className="desk-number">{index+1}</span><strong>{workspace?displayWorkspace(workspace):`Стіл #${index+1}`}</strong><small>{checking?'Перевіряємо':free===true?'Вільний':free===false?'Заброньовано':!workspace?'Немає даних':'Обрати місце'}</small></button>;
  }
  const roomFree=room?availability.find(w=>w.id===room.id)?.isAvailable:undefined;
  return <>
    <a className="skip" href="#main">Перейти до вмісту</a>
    <header className="container header" id="home"><Logo/><button className="mobile-menu btn outline small" aria-label="Відкрити меню" aria-expanded={mobileNav} onClick={()=>setMobileNav(v=>!v)}>Меню</button><nav className={mobileNav?'expanded':''} aria-label="Головна навігація">{navLinks}</nav><div className="header-actions">{user?.role==='ADMIN'&&<button className="btn outline small" onClick={()=>setAdmin(true)}>Адмін-панель</button>}<button className="btn outline small" disabled={authLoading} onClick={()=>user?setProfile(true):setAuth('login')}>{authLoading?'Зачекайте…':user?'Мій профіль':'Увійти'}</button></div></header>
    <main id="main" className="container">
      <section className="hero" aria-labelledby="hero-title"><h1 id="hero-title">Tviy.hub — простір, такий же креативний, як і ти!</h1><p>Сучасний коворкінг із домашнім затишком. Гарантований інтернет, безперебійне світло та спільнота, з якою рости приємніше.</p><div className="hero-actions"><a className="btn" href="#booking">Забронювати місце<Icon name="imgIconCalendar2"/></a><a className="btn outline" href="#services">Оглянути приміщення</a></div><div className="hero-image"><img src={assets.imgImageContainer1} alt="Затишний спільний робочий простір Tviy.hub" fetchPriority="high"/></div></section>
      <section id="services"><SectionTitle title="Наші послуги" description="У нас є 2 комфортні зони для ваших задач — для глибокого фокусу або важливих переговорів."/><div className="services-grid">
        <article className="service-card"><div className="service-image meeting-image"><img src={assets.imgImageContainer} alt="Команда за столом у приватній переговорній" loading="lazy"/></div><h3>Приватна переговорка</h3><p>Простір для проведення онлайн-зустрічей, переговорів з клієнтами, командних брейнштормів та презентацій.</p><ul className="checks"><li><Icon name="imgIconCheck"/>Приватність</li><li><Icon name="imgIconCheck"/>Розетки</li></ul><div className="card-bottom"><div><small>{tariffs.length?'Вартість':'Орієнтовна вартість'}</small><strong>{money(price('MEETING_ROOM','HOURLY',200))}<small> / година</small></strong></div><button className="btn" onClick={()=>planChoice('HOURLY','MEETING_ROOM')}>Забронювати<Icon name="imgIconCalendar"/></button></div></article>
        <article className="service-card"><div className="service-image"><img src={assets.imgImageContainer1} alt="Робочі місця зі столами та настільними лампами" loading="lazy"/></div><h3>Спільний коворкінг — кімната</h3><p>Затишне робоче приміщення зі столами, зручними кріслами, розетками біля кожного місця та спокійною атмосферою.</p><ul className="checks"><li><Icon name="imgIconCheck"/>Тихий режим для роботи та навчання</li><li><Icon name="imgIconCheck"/>Розетки</li></ul><div className="card-bottom"><div><small>{tariffs.length?'Вартість':'Орієнтовна вартість'}</small><strong>від {money(price('DESK','HOURLY',150))}<small> / година</small></strong></div><button className="btn" onClick={()=>planChoice('HOURLY','DESK')}>Забронювати<Icon name="imgIconCalendar"/></button></div></article>
      </div></section>
      <section id="booking"><SectionTitle title="Онлайн бронювання" description="Натисніть на бажане робоче місце або переговорну кімнату для перегляду доступності та швидкого оформлення бронювання."/>
        <div className="booking-controls"><label>Дата<input type="date" value={date} min={venueToday(now)} onChange={e=>setDate(e.target.value)}/></label><label>Початок<select value={start} onChange={e=>setStart(e.target.value)}>{Array.from({length:10},(_,i)=>`${String(i+9).padStart(2,'0')}:00`).map(t=><option key={t} disabled={!!bookingValidation(date,t,1,'HOURLY',now)}>{t}</option>)}</select></label><label>Тривалість<select value={hours} onChange={e=>setHours(Number(e.target.value))}>{[1,2,3,4].map(h=><option key={h} value={h} disabled={!!bookingValidation(date,start,h,'HOURLY',now)}>{h} год.</option>)}</select></label><button className="btn outline small" disabled={checking||catalogLoading} onClick={()=>setRevision(v=>v+1)}>Оновити</button></div>

        {validation&&<Alert>{validation}</Alert>}{catalogError&&<Alert>{catalogError}</Alert>}{availabilityError&&<Alert>{availabilityError}</Alert>}
        {!user&&!catalogError&&<p className="booking-signin"><button className="text-button" onClick={()=>setAuth('login')}>Увійдіть</button>, щоб перевірити доступність і забронювати місце.</p>}
        {catalogLoading&&<p role="status" className="booking-signin">Завантажуємо простір…</p>}
        <p className="booking-signin">Доступність для {date}, {start}–{endTime(start,hours)} · час Києва</p><div className="legend"><span><i className="free"/>Вільний стіл</span><span><i className="occupied"/>Заброньовано</span></div>
        <div className="booking-grid"><article className="meeting-card"><div className="meeting-heading"><div><p className="eyebrow">Окрема зона</p><h3>Переговорна кімната</h3></div><span className="icon-circle"><Icon name="imgIconPeople"/></span></div><ul className="room-features"><li><Icon name="imgGroup2"/>Безперервний інтернет</li><li><Icon name="imgIconLight"/>Світло 24/7</li><li><Icon name="imgIconCoffee"/>Кава та чай у вільному доступі</li><li><Icon name="imgIconGroup"/>Приватний простір для команди</li></ul><div className="card-bottom"><div><small>{tariffs.length?'Вартість':'Орієнтовна вартість'}</small><strong>{money(price('MEETING_ROOM','HOURLY',200))}<small> / година</small></strong></div><button className="btn" disabled={!room||roomFree===false||checking||!!validation} onClick={()=>room&&choose(room)}>Обрати</button></div>{roomFree===false&&<small className="danger">Зайнята у вибраний час</small>}</article>
        <div className="floorplan"><h3>{desks.length?`Кімната коворкінгу (${desks.length} робочих місць)`:"Схема коворкінгу"}</h3><div className={`desk-map ${desks.length>5?'extra-desks':''}`}><div className="rest rest-left">Зона відпочинку</div>{(desks.length?desks:Array.from({length:5},()=>undefined)).map(deskCard)}<div className="rest rest-right">Зона відпочинку</div></div></div></div>
      </section>
      <section id="advantages"><SectionTitle title="Чому обирають Tviy.hub?" description="Ми знаємо, як важливо мати стабільне світло, швидкий інтернет та робочу тишу в умовах сьогодення. Тому у нас завжди комфортно, немає зайвого шуму, а кожна деталь продумана для високої продуктивності."/><div className="badges">{['Безперервний інтернет','Світло 24/7','Wi-Fi','Чай та кава у вільному доступі'].map(text=><span key={text}><Icon name="imgIconCheck1"/>{text}</span>)}</div><div className="gallery">{(['imgPhotoContainer','imgPhotoContainer1','imgPhotoContainer2','imgPhotoContainer3'] as const).map((name,i)=><img key={name} src={assets[name]} alt={['Кава та затишна зона відпочинку','Робоча атмосфера коворкінгу','Світлий простір Tviy.hub','Гості коворкінгу'][i]} loading="lazy"/>)}</div></section>
      <section id="pricing"><SectionTitle title="Наші тарифні плани" description="Обирайте зручний формат: від кількох годин для термінового дзвінка до закріпленого власного столу на цілий місяць."/><div className="pricing-grid">{plans.map(plan=><article className="pricing-card" key={plan.title}><p className="eyebrow">{plan.label}</p><h3>{plan.title}</h3><div className="plan-price"><strong>{money(price(plan.workspaceType,plan.type,plan.reference))}</strong><span>{plan.unit}</span></div><ul className="checks">{plan.features.map(feature=><li key={feature}><Icon name="imgIconCheck"/>{feature}</li>)}</ul><button className="btn outline" disabled={user?.role==='ADMIN'&&plan.type==='SUBSCRIPTION'} onClick={()=>planChoice(plan.type,plan.workspaceType)}>Забронювати<Icon name="imgIconCalendar1"/></button></article>)}</div>{!tariffs.length&&<p className="muted centered">Орієнтовні ціни. Остаточну вартість буде підтверджено під час бронювання.</p>}</section>
      <section id="location"><SectionTitle title="Де нас знайти?"/><div className="location-grid"><div className="contacts"><div><span className="contact-icon"><Icon name="imgIconLocation"/></span><div><h4>Адреса:</h4><p>м. Миколаїв, вул. Олексія Вадатурського, 1</p></div></div><div><span className="contact-icon"><Icon name="imgGroup3"/></span><div><h4>Графік роботи:</h4><p>Пн–Пт 09:00–19:00.<br/>Субота та неділя — вихідні.</p></div></div><div><span className="contact-icon"><Icon name="imgIconPhone"/></span><div><h4>Контакти:</h4><a href="tel:+380998710595">+380 99 871 0595</a></div></div></div><div className="location-map"><iframe title="Tviy.hub на карті — Миколаїв, вул. Олексія Вадатурського, 1" src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2722.2252615539714!2d31.989338599999996!3d46.976910000000004!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x40c5c9396fa069b3%3A0x4f2d8be6a025fb9f!2sTviy%20Khab%20-%20Mini-Kovorkinh!5e0!3m2!1sen!2sus!4v1794827457765!5m2!1sen!2sus" loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/><a className="map-link" href="https://www.google.com/maps/search/?api=1&query=Миколаїв%20Олексія%20Вадатурського%201" target="_blank" rel="noreferrer">Відкрити локацію на Google Maps ↗</a></div></div></section>
    </main>
    <footer><div className="container"><div className="footer-top"><Logo/><nav aria-label="Нижня навігація">{nav.filter(([id])=>id!=='booking').map(([id,label])=><a key={id} href={`#${id}`}>{label}</a>)}</nav><div className="footer-contact"><span><Icon name="imgIconLocation1"/>м. Миколаїв, вул. Олексія Вадатурського, 1</span><a href="tel:+380998710595"><Icon name="imgIconPhone1"/>+380 99 871 0595</a></div></div><div className="footer-bottom"><span>© 2026 Tviy.hub. Всі права захищено.</span><button className="text-button muted" onClick={()=>setPrivacy(true)}>Політика конфіденційності</button></div></div></footer>
    {auth&&<AuthModal initial={auth} email={auth==='verify'?user?.email:''} onClose={()=>{setAuth(null);setPending(null);}} onLogin={loggedIn}/>}
    {selected&&user&&<BookingModal {...selected} workspaces={workspaces} initialType={selected.type} initialDate={selected.date} initialStart={selected.start} initialHours={selected.hours} user={user} tariffs={tariffs} onClose={()=>setSelected(null)} onCreated={()=>setRevision(v=>v+1)}/>}
    {profile&&user&&<ProfileModal user={user} onUser={setUser} onClose={()=>setProfile(false)} onVerify={()=>{setProfile(false);setAuth('verify');}} onRepeat={(workspace:Workspace,item:HistoryItem)=>{setProfile(false);choose(workspace,item.bookingType,{...nextBookingSlot(),hours:item.startTime&&item.endTime?Math.min(4,Math.max(1,Number(item.endTime.slice(0,2))-Number(item.startTime.slice(0,2)))):1});}}/>}
    {admin&&user?.role==='ADMIN'&&<AdminModal userId={user.id} onClose={()=>setAdmin(false)} onChanged={()=>setRevision(v=>v+1)}/>}
    {privacy&&<Modal title="Політика конфіденційності" onClose={()=>setPrivacy(false)}><p>Для входу та бронювання введені вами дані передаються сервісу Tviy.hub. Токени сесії зберігаються в пам’яті та sessionStorage цієї вкладки й видаляються з неї під час виходу.</p><p>Історія бронювань завантажується з вашого облікового запису. За інформацією щодо обробки даних звертайтеся до адміністратора простору.</p></Modal>}
  </>;
}
