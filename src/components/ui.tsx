import { useEffect, useId, useRef, type ReactNode } from 'react';
import assets from '../assets.json';

export function Icon({ name }: { name: keyof typeof assets }) { return <img className="icon" src={assets[name]} alt="" aria-hidden="true" />; }
const logoLayers: [keyof typeof assets, number, number][] = [
  ['imgVector',32.38,0],['imgVector1',13.64,1.9],['imgVector2',4.09,8.6],['imgVector3',53.76,21.28],['imgVector4',60.9,36.32],['imgVector5',24.44,20.06],['imgVector6',56.91,27.76],['imgVector7',70.29,33.98],['imgVector8',64.86,38.25],
];
export function Logo() {
  return <a href="#home" className="logo" aria-label="Твій хаб — на початок">
    {logoLayers.map(([name,left,top]) => <img key={name} src={assets[name]} alt="" style={{left,top}} />)}
    <span className="logo-wordmark" aria-hidden="true"><span>Твій</span> хаб</span>
  </a>;
}

// Forms use noValidate so all messages are rendered by the app in Ukrainian.
export function formValidationError(form: HTMLFormElement): string {
  for (const field of form.elements) {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) continue;
    const { validity } = field;
    if (!field.willValidate || validity.valid) continue;

    field.focus();
    if (field instanceof HTMLSelectElement) return 'Оберіть варіант зі списку.';
    if (field.type === 'date' && (validity.valueMissing || validity.badInput)) return 'Оберіть дату.';
    if (validity.valueMissing) {
      const label = field.labels?.[0]?.textContent?.trim();
      return label ? `${label} · Заповніть це поле.` : 'Заповніть це поле.';
    }
    if (validity.typeMismatch && field.type === 'email') return 'Введіть коректну адресу електронної пошти.';
    if (validity.patternMismatch && field.name === 'code') return 'Введіть шість цифр із листа.';
    if (validity.tooShort) return `Введіть щонайменше ${field.minLength} символів.`;
    if (validity.tooLong) return `Введіть не більше ${field.maxLength} символів.`;
    if (validity.rangeUnderflow && field.type === 'date') return 'Оберіть сьогоднішню або майбутню дату.';
    return 'Перевірте значення в цьому полі.';
  }
  return '';
}

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { dialog.close(); document.body.style.overflow = previous; }; }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} aria-labelledby={id} onCancel={e => {e.preventDefault();onClose();}} onClick={e => {if(e.target===e.currentTarget)onClose();}}>
    <div className="modal-inner"><button type="button" className="close" aria-label="Закрити" onClick={onClose}><Icon name="imgIconClose"/></button><h2 id={id}>{title}</h2>{children}</div>
  </dialog>;
}
export function Alert({ children, success = false }: { children: ReactNode; success?: boolean }) { return <div className={`alert ${success ? 'alert-success' : ''}`} role={success ? 'status' : 'alert'}>{children}</div>; }
export function SectionTitle({ title, description }: { title: string; description?: string }) { return <div className="section-title"><h2>{title}</h2>{description && <p>{description}</p>}</div>; }
export function Pager({ page, total, change }: { page: number; total: number; change: (n: number) => void }) { return total > 1 ? <div className="pager"><button className="btn outline small" disabled={!page} onClick={() => change(page-1)}>Назад</button><span>{page+1} / {total}</span><button className="btn outline small" disabled={page+1>=total} onClick={() => change(page+1)}>Далі</button></div> : null; }
