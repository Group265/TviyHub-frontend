import { useEffect, useState } from 'react';
import { api } from '../api';
import { errorMessage } from '../api/errors';
import type { User } from '../api/types';
import { checkoutIsPaid, checkoutMatchesSession, forgetCheckout, pendingCheckout } from '../checkout';
import { Alert } from './ui';

export function PaymentReturn({ user, authLoading, onLogin, dedicated = false }: { user: User | null; authLoading: boolean; onLogin: () => void; dedicated?: boolean }) {
  const [query] = useState(() => new URLSearchParams(location.search));
  const [checkout] = useState(pendingCheckout);
  const [paymentState, setPaymentState] = useState<'ready' | 'waiting' | 'paid' | 'error'>('ready');
  const [failure, setFailure] = useState('');
  const sessionId = query.get('session_id');
  const cancelled = query.get('checkout') === 'cancelled';
  const validReturn = !!checkout && (sessionId
    ? checkoutMatchesSession(checkout, sessionId)
    : cancelled && checkout.paymentIds.includes(Number(query.get('payment_id'))));
  const canVerify = !!sessionId && validReturn && user?.id === checkout?.userId;

  useEffect(() => {
    if (!sessionId || !canVerify || paymentState !== 'ready' || !checkout) return;
    const controller = new AbortController();
    api.verifyStripePayment(sessionId, controller.signal).then(payment => {
      if (controller.signal.aborted) return;
      if (!checkoutIsPaid(checkout.paymentIds, payment)) {
        setPaymentState('waiting');
        return;
      }
      const url = new URL(location.href);
      url.searchParams.delete('session_id');
      history.replaceState(history.state, '', url);
      forgetCheckout();
      setPaymentState('paid');
    }).catch(error => {
      if (controller.signal.aborted) return;
      setFailure(errorMessage(error, 'Спробуйте ще раз.'));
      setPaymentState('error');
    });
    return () => controller.abort();
  }, [canVerify, checkout, paymentState, sessionId]);

  if (!sessionId && !cancelled) return dedicated ? <Alert>Перевірте стан оплати в розділі «Мої бронювання».</Alert> : null;
  if (paymentState === 'paid') return <Alert success>{checkout?.mode === 'batch'
    ? 'Оплату успішно завершено. Бронювання підтверджено.'
    : 'Оплату підтверджено. Перегляньте статус в особистому кабінеті.'}</Alert>;
  if (!validReturn) return <Alert>Не вдалося знайти дані про цей платіж. Перевірте статус у профілі.</Alert>;
  if (authLoading) return <p role="status">Завантажуємо профіль…</p>;
  if (!user) return <Alert>Увійдіть, щоб перевірити стан оплати. <button className="text-button" onClick={onLogin}>Увійти</button></Alert>;
  if (user.id !== checkout?.userId) return <Alert>Увійдіть до облікового запису, з якого почали оплату.</Alert>;
  if (cancelled) return <Alert>Ви повернулися зі сторінки оплати. <a className="text-button" href={checkout.sessionUrl}>Повернутися до оплати</a></Alert>;
  if (paymentState === 'ready') return <p role="status">Перевіряємо оплату…</p>;
  return <Alert>
    Не вдалося підтвердити оплату. {failure}{' '}
    <button className="text-button" onClick={() => setPaymentState('ready')}>Перевірити ще раз</button>
  </Alert>;
}
