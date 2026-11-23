import { useId, useState, type FormEvent } from 'react';
import { api } from '../api';
import { errorMessage, phoneFormatError } from '../api/errors';
import type { User } from '../api/types';
import { Alert, ukrainianFormValidation } from './ui';

type Draft = { name: string; phone: string; email: string };
type Contact = 'email' | 'phone';

interface ProfileDetailsEditorProps {
  id: string;
  user: User;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onUser: (user: User) => void;
  onSaved: () => void;
  onCancel: () => void;
}

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const normalizePhone = (value: string) => value.replace(/[\s()-]/g, '');
const emailReuseError = 'Нова електронна адреса має відрізнятися від поточної.';

export function ProfileDetailsEditor({ id, user, busy, onBusy, onUser, onSaved, onCancel }: ProfileDetailsEditorProps) {
  const [draft, setDraft] = useState<Draft>({ name: user.name, phone: user.phone ?? '', email: '' });
  const [contact, setContact] = useState<Contact | null>(null);
  const [error, setError] = useState('');
  const emailErrorId = useId();
  const email = normalizeEmail(draft.email);
  const sameEmail = email !== '' && email === normalizeEmail(user.email);

  async function saveDetails(current: User, values: Draft, currentPassword = '') {
    if (values.email) {
      await api.requestChange('email', { newEmail: values.email, currentPassword });
      setContact('email');
      return;
    }
    if (values.phone !== normalizePhone(current.phone ?? '')) {
      await api.requestChange('phone', { newPhone: values.phone });
      setContact('phone');
      return;
    }
    if (values.name !== current.name) onUser(await api.updateName(values.name));
    onSaved();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (!contact && sameEmail)) return;
    const form = new FormData(event.currentTarget);
    const values = { name: draft.name.trim(), phone: normalizePhone(draft.phone), email };
    setError('');
    if (!contact) {
      if (!values.name) { setError('Введіть ім’я та прізвище.'); return; }
      if (values.phone !== normalizePhone(user.phone ?? '') && !/^\+[1-9]\d{6,14}$/.test(values.phone)) {
        setError(phoneFormatError);
        return;
      }
    }

    onBusy(true);
    try {
      if (!contact) {
        await saveDetails(user, values, String(form.get('currentPassword') ?? ''));
      } else {
        const updated = await api.confirmChange(contact, String(form.get('code') ?? '')) ?? await api.me();
        onUser(updated);
        setContact(null);
        if (contact === 'email') {
          values.email = '';
          setDraft(previous => ({ ...previous, email: '' }));
        }
        await saveDetails(updated, values);
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      onBusy(false);
    }
  }

  return <form {...ukrainianFormValidation} id={id} className="form edit-panel" onSubmit={submit}>
    <h3>Редагування профілю</h3>
    {error && <Alert>{error}</Alert>}
    {contact ? <>
      <Alert success>{contact === 'email'
        ? 'Введіть код, який надійшов на нову електронну адресу.'
        : 'Введіть код для зміни телефону, який надійшов на електронну адресу вашого профілю.'}</Alert>
      <label key={contact}>Код із листа<input name="code" required disabled={busy} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" /></label>
    </> : <>
      <label>Ім’я та прізвище<input name="name" required disabled={busy} maxLength={100} autoComplete="name"
        value={draft.name} onChange={event => { const name = event.currentTarget.value; setDraft(previous => ({ ...previous, name })); }} /></label>
      <div>
        <label>Нова пошта<input name="newEmail" type="email" autoComplete="email" placeholder={user.email}
          disabled={busy || !user.emailVerified} value={draft.email} aria-invalid={sameEmail || undefined}
          aria-describedby={sameEmail ? emailErrorId : undefined}
          onChange={event => { const email = event.currentTarget.value; setDraft(previous => ({ ...previous, email })); }} /></label>
        {sameEmail && <p id={emailErrorId} className="danger" role="alert">{emailReuseError}</p>}
      </div>
      <label>Номер телефону<input name="newPhone" type="tel" autoComplete="tel" placeholder="+380..."
        disabled={busy || !user.emailVerified} value={draft.phone}
        onChange={event => { const phone = event.currentTarget.value; setDraft(previous => ({ ...previous, phone })); }} /></label>
      {email && !sameEmail && <label>Поточний пароль<input name="currentPassword" type="password"
        required disabled={busy} autoComplete="current-password" /></label>}
    </>}
    <div className="actions">
      <button className="btn small" disabled={busy || (!contact && sameEmail)}>{busy ? 'Зачекайте…' : contact ? 'Підтвердити' : 'Зберегти'}</button>
      <button type="button" className="text-button" disabled={busy} onClick={onCancel}>Скасувати</button>
    </div>
  </form>;
}
