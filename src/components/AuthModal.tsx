import { useId, useState, type FormEvent } from 'react';
import { api } from '../api';
import { errorMessage, normalizePhone, passwordsMismatch, phoneFormatError, phoneLengthError, phoneValidationError, requiredFieldMessage } from '../api/errors';
import { Alert, Modal, ukrainianFormValidation } from './ui';

export function AuthModal({ onClose, onLogin }: { onClose: () => void; onLogin: () => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'register' | 'verify' | 'forgot' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const confirmationErrorId = useId();
  const phoneErrorId = useId();
  const hasConfirmation = mode === 'register' || mode === 'reset';
  const confirmationField = mode === 'reset' ? 'confirmNewPassword' : 'confirmPassword';
  const confirmationError = hasConfirmation && (error === passwordsMismatch || error === requiredFieldMessage(confirmationField));
  const phoneError = mode === 'register' && (error === phoneFormatError || error === phoneLengthError);
  const clearConfirmationError = () => {
    if (confirmationError) setError('');
  };
  const change = (next: typeof mode) => { if (!busy) { setMode(next); setError(''); setMessage(''); } };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return; setBusy(true); setError(''); setMessage('');
    const form = new FormData(e.currentTarget);
    const value = (key: string) => String(form.get(key) || '').trim();
    const password = String(form.get('password') ?? '');
    const confirmation = String(form.get(confirmationField) ?? '');
    try {
      if (hasConfirmation && !confirmation.trim()) {
        setError(requiredFieldMessage(confirmationField));
        return;
      }
      if (hasConfirmation && password !== confirmation) {
        setError(passwordsMismatch);
        return;
      }
      if (mode === 'login') { await api.login(email.trim(), password); await onLogin(); onClose(); }
      if (mode === 'register') {
        const phone = normalizePhone(value('phone'));
        const validationError = phoneValidationError(phone);
        if (validationError) { setError(validationError); return; }
        const registration = await api.register({
          name: `${value('first')} ${value('last')}`.trim(), email: email.trim(), phone, password, confirmPassword: confirmation,
        });
        setEmail(registration.email);
        setMode('verify'); setResendAt(Date.now() + 60000); setMessage('Перевірте пошту та введіть код підтвердження.');
      }
      if (mode === 'verify') {
        await api.verify(email.trim(), value('code'));
        try {
          await onLogin();
          onClose();
        } catch (err) {
          setMode('login');
          setMessage('Пошту підтверджено.');
          setError(`Не вдалося відкрити профіль. ${errorMessage(err, '')}`.trim());
        }
      }
      if (mode === 'forgot') { await api.forgot(email.trim()); setMode('reset'); setMessage('Якщо обліковий запис існує, на пошту надіслано код.'); }
      if (mode === 'reset') { await api.reset(email.trim(), value('code'), password, confirmation); setMode('login'); setMessage('Пароль змінено. Увійдіть з новим паролем.'); }
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  async function resend() {
    if (busy) return;
    setError('');
    setMessage('');
    if (!email.trim()) { setError('Введіть електронну адресу, щоб отримати код.'); return; }
    if (Date.now() < resendAt) { setError('Новий код можна запросити через хвилину після попереднього.'); return; }
    setBusy(true);
    try {
      await api.resend(email.trim());
      setResendAt(Date.now() + 60000);
      setMessage('Якщо потрібне підтвердження, новий код надіслано.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return <Modal title={mode === 'verify' ? 'Підтвердження пошти' : mode === 'forgot' || mode === 'reset' ? 'Відновлення пароля' : 'Вітаємо у просторі «Твій хаб»!'} onClose={() => { if (!busy) onClose(); }}>
    <p className="muted">Увійдіть, щоб керувати бронюваннями.</p>
    {(mode === 'login' || mode === 'register') && <div className="tabs" role="tablist" aria-label="Вхід або реєстрація"><button role="tab" disabled={busy} aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => change('login')}>Увійти</button><button role="tab" disabled={busy} aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => change('register')}>Реєстрація</button></div>}
    {error && !confirmationError && !phoneError && <Alert>{error}</Alert>}{message && <Alert success>{message}</Alert>}
    <form {...ukrainianFormValidation} onSubmit={submit} className="form" key={mode}>
      {mode === 'register' && <>
        <div className="form-row"><label>Ім’я<input name="first" required maxLength={50} autoComplete="given-name" placeholder="Марія..." /></label><label>Прізвище<input name="last" required maxLength={49} autoComplete="family-name" placeholder="Коваленко..." /></label></div>
        <div>
          <label>Номер телефону<input name="phone" required type="tel" autoComplete="tel" placeholder="+380..."
            aria-invalid={phoneError || undefined} aria-describedby={phoneError ? phoneErrorId : undefined}
            onChange={() => { if (phoneError) setError(''); }} /></label>
          {phoneError && <p id={phoneErrorId} className="danger" role="alert">{error}</p>}
        </div>
      </>}
      <label>Пошта<input name="email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Адреса електронної пошти" /></label>
      {(mode === 'verify' || mode === 'reset') && <label>Код із листа<input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} placeholder="000000" /></label>}
      {(mode === 'login' || mode === 'register' || mode === 'reset') && <label>{mode === 'reset' ? 'Новий пароль' : 'Пароль'}<input name="password" type="password" required minLength={mode === 'login' ? 1 : 8} maxLength={mode === 'login' ? undefined : 72} onChange={clearConfirmationError} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="••••••••" /></label>}
      {hasConfirmation && <div>
        <label>
          {mode === 'reset' ? 'Підтвердження нового пароля' : 'Повторіть пароль'}
          <input
            name={confirmationField} type="password" required minLength={8} maxLength={72} autoComplete="new-password"
            aria-invalid={confirmationError || undefined}
            aria-describedby={confirmationError ? confirmationErrorId : undefined}
            onChange={clearConfirmationError}
          />
        </label>
        {confirmationError && <p id={confirmationErrorId} className="danger" role="alert">{error}</p>}
      </div>}
      {mode === 'login' && <button className="text-button align-right" type="button" disabled={busy} onClick={() => change('forgot')}>Забули пароль?</button>}
      <button className="btn full" disabled={busy}>{busy ? 'Зачекайте…' : ({ login: 'Увійти', register: 'Зареєструватися', verify: 'Підтвердити пошту', forgot: 'Надіслати код', reset: 'Змінити пароль' })[mode]}</button>
    </form>
    {mode === 'verify' && <button type="button" disabled={busy} className="text-button centered" onClick={resend}>Надіслати код повторно</button>}
    <button className="text-button centered muted" disabled={busy} onClick={() => change(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Немає облікового запису? Зареєструватися' : 'Уже маєте обліковий запис? Увійти'}</button>
    {mode === 'register' && <button className="text-button centered muted" disabled={busy} onClick={() => change('verify')}>Уже маєте код? Завершити реєстрацію</button>}
  </Modal>;
}
