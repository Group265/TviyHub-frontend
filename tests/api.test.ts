import { beforeEach, describe, expect, it, vi } from 'vitest';
const tokens=(suffix='1')=>({accessToken:`access-${suffix}`,refreshToken:`refresh-${suffix}`,tokenType:'Bearer',expiresInSeconds:900,refreshExpiresInSeconds:2592000});
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
beforeEach(()=>{vi.resetModules();const data=new Map<string,string>();vi.stubGlobal('sessionStorage',{getItem:(key:string)=>data.get(key)||null,setItem:(key:string,v:string)=>data.set(key,v),removeItem:(key:string)=>data.delete(key)});vi.stubGlobal('window',new EventTarget());});

describe('API integration and rotating sessions',()=>{
  it('shares a single refresh between concurrent protected requests',async()=>{
    const client=await import('../src/api/client');client.storeTokens({...tokens(),expiresInSeconds:0});
    const fetcher=vi.fn(async(input:string,init:RequestInit)=>{if(input.endsWith('/auth/refresh')){await new Promise(resolve=>setTimeout(resolve,10));expect(JSON.parse(String(init.body))).toEqual({refreshToken:'refresh-1'});return response(tokens('2'));}expect(new Headers(init.headers).get('Authorization')).toBe('Bearer access-2');return response({ok:true});});vi.stubGlobal('fetch',fetcher);
    await Promise.all([client.request('/users/me',{},true),client.request('/bookings',{},true)]);
    expect(fetcher.mock.calls.filter(([path])=>path.endsWith('/auth/refresh'))).toHaveLength(1);
  });
  it('refreshes a server-rejected access token once and retries with the new token',async()=>{
    const client=await import('../src/api/client');client.storeTokens(tokens());
    const fetcher=vi.fn(async(input:string,init:RequestInit)=>input.endsWith('/auth/refresh')?response(tokens('2')):new Headers(init.headers).get('Authorization')==='Bearer access-1'?response({detail:'Expired'},401):response({name:'Test'}));vi.stubGlobal('fetch',fetcher);
    expect(await client.request('/users/me',{},true)).toEqual({name:'Test'});expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('does not repeatedly refresh or replay a write when the second attempt is also 401',async()=>{
    const client=await import('../src/api/client');client.storeTokens(tokens());
    const fetcher=vi.fn(async(input:string)=>input.endsWith('/auth/refresh')?response(tokens('2')):response({detail:'No session'},401));vi.stubGlobal('fetch',fetcher);
    await expect(client.request('/bookings',{method:'POST',body:'{}'},true)).rejects.toMatchObject({status:401});expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('does not automatically replay a booking after a conflict',async()=>{
    const client=await import('../src/api/client');client.storeTokens(tokens());const fetcher=vi.fn(async()=>response({detail:'Selected time slot overlaps with an existing booking'},409));vi.stubGlobal('fetch',fetcher);
    await expect(client.request('/bookings',{method:'POST',body:'{}'},true)).rejects.toMatchObject({status:409});expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('clears rejected refresh tokens but preserves the session on a network outage',async()=>{
    const client=await import('../src/api/client');client.storeTokens({...tokens(),expiresInSeconds:0});vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('offline');}));await expect(client.request('/users/me',{},true)).rejects.toMatchObject({status:0});expect(client.hasSession()).toBe(true);
    vi.stubGlobal('fetch',vi.fn(async()=>response({detail:'Revoked'},401)));await expect(client.request('/users/me',{},true)).rejects.toMatchObject({status:401});expect(client.hasSession()).toBe(false);
  });
  it('does not restore a session after logout while a refresh is in flight',async()=>{
    const client=await import('../src/api/client');client.storeTokens({...tokens(),expiresInSeconds:0});let release:(value:Response)=>void=()=>{};
    const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{release=resolve;}));vi.stubGlobal('fetch',fetcher);const pending=client.request('/users/me',{},true);const assertion=expect(pending).rejects.toMatchObject({status:401});client.clearSession();release(response(tokens('2')));
    // The request must not become an authenticated request after the user logs out.
    await assertion;expect(client.hasSession()).toBe(false);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects HTML fallback pages and handles empty 204 bodies',async()=>{
    const client=await import('../src/api/client');vi.stubGlobal('fetch',vi.fn(async()=>new Response('<html>app</html>',{headers:{'Content-Type':'text/html'}})));await expect(client.request('/workspaces')).rejects.toMatchObject({status:502});
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:204})));await expect(client.request('/auth/verify-email',{method:'POST'})).resolves.toBeUndefined();
  });
  it('matches Java DTOs: registration name, array bookings, authenticated availability and numeric quote',async()=>{
    const client=await import('../src/api/client');client.storeTokens(tokens());const {api}=await import('../src/api');
    const calls:{url:string;body:unknown;auth:string|null}[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{calls.push({url,body:init.body?JSON.parse(String(init.body)):null,auth:new Headers(init.headers).get('Authorization')});if(url.includes('calculate-price'))return response(300);if(url==='/api/bookings')return response([{id:4,totalPrice:300}]);return response([]);}));
    const data={workspaceId:3,bookingType:'HOURLY' as const,bookingDates:['2027-01-11'],startTime:'10:00',endTime:'12:00'};
    expect(await api.price(data)).toBe(300);expect(await api.book(data)).toEqual([{id:4,totalPrice:300}]);await api.availability('2027-01-11','10:00','12:00');
    expect(calls[0].body).toEqual(data);expect(calls[2].url).toBe('/api/bookings/availability?date=2027-01-11&startTime=10%3A00&endTime=12%3A00');expect(calls.every(c=>c.auth==='Bearer access-1')).toBe(true);
  });
});

describe('backend error and history responses', () => {
  it.each([
    [409, 'Email is already registered', 'Ця електронна адреса вже використовується.'],
    [409, 'Phone is already registered', 'Цей номер телефону вже використовується.'],
    [409, 'Selected time slot overlaps with an existing booking', 'Вибраний час перетинається з іншим бронюванням.'],
    [409, 'The hub is fully rented for an event on 2026-11-16', 'На 2026-11-16 весь простір заброньовано для події. Оберіть іншу дату.'],
    [403, 'Access denied', 'У вас немає прав для цієї дії.'],
    [403, 'Verify your email first', 'Спочатку підтвердьте електронну пошту.'],
    [400, 'Invalid or expired code', 'Код неправильний або строк його дії закінчився.'],
    [400, 'Current password is incorrect', 'Поточний пароль неправильний.'],
    [400, 'Cannot cancel a booking that has already started or passed', 'Бронювання вже почалося або завершилося. Скасувати його неможливо.'],
    [400, ' Cannot cancel a booking that has already started or passed. ', 'Бронювання вже почалося або завершилося. Скасувати його неможливо.'],
    [400, 'HOURLY bookings can only be cancelled at least 2 hours before the start time', 'Погодинне бронювання можна скасувати щонайменше за 2 год. до початку.'],
    [429, 'Please wait before requesting a new code', 'Зачекайте трохи, перш ніж запросити новий код.'],
    [503, 'Could not send the email, try again later', 'Не вдалося надіслати лист із кодом. Спробуйте пізніше.'],
  ])('shows the specific API detail for %s %s', async (status, detail, expected) => {
    const { request, errorMessage } = await import('../src/api/client');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status, detail, title: 'Problem' }), {
      status, headers: { 'Content-Type': 'application/problem+json' },
    })));
    await expect(request('/example').catch(errorMessage)).resolves.toBe(expected);
  });

  it('localizes validation fields and tolerates malformed error responses', async () => {
    const { request, errorMessage } = await import('../src/api/client');
    const message = async () => {
      try { await request('/example'); }
      catch (err) { return errorMessage(err); }
      throw new Error('Expected the request to fail');
    };
    vi.stubGlobal('fetch', vi.fn(async () => response({ detail: 'Validation failed', errors: {
      confirmNewPassword: 'passwords do not match',
      'bookingDates[0]': 'Booking date cannot be in the past',
      unexpected: { internal: 'ignored' },
    } }, 400)));
    expect(await message()).toBe('Підтвердження нового пароля · Паролі не збігаються. Дата бронювання · Оберіть сьогоднішню або майбутню дату.');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{bad-json', { status: 503, headers: { 'Content-Type': 'application/json' } })));
    expect(await message()).toBe('Сервіс тимчасово недоступний. Спробуйте пізніше.');
    vi.stubGlobal('fetch', vi.fn(async () => response(null, 404)));
    expect(await message()).toBe('Запитані дані не знайдено.');
  });

  it.each(['must not be blank', 'не должно быть пустым'])(
    'localizes the combined registration validation error (%s)',
    async (confirmationMessage) => {
      const { request, errorMessage } = await import('../src/api/client');
      vi.stubGlobal('fetch', vi.fn(async () => response({
        detail: 'Validation failed',
        errors: {
          phone: 'must be in international format, e.g. +380671234567',
          confirmPassword: confirmationMessage,
        },
      }, 400)));
      await expect(request('/auth/register').catch(errorMessage)).resolves.toBe(
        'Введіть номер телефону в міжнародному форматі, наприклад +380671234567. Повторіть пароль.',
      );
    },
  );

  it('shows the phone format hint without the API field name or English validation detail', async () => {
    const { errorMessage, storeTokens } = await import('../src/api/client');
    const { api } = await import('../src/api');
    storeTokens(tokens());
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      title: 'Bad Request',
      status: 400,
      detail: 'Validation failed',
      errors: { newPhone: 'must be in international format, e.g. +380671234567' },
    }), { status: 400, headers: { 'Content-Type': 'application/problem+json' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(api.requestChange('phone', { newPhone: '0671234567' }).catch(errorMessage)).resolves.toBe(
      'Введіть номер телефону в міжнародному форматі, наприклад +380671234567.',
    );
  });

  it('reads all upcoming candidate pages before the UI paginates filtered results', async () => {
    const { storeTokens } = await import('../src/api/client');
    const { api } = await import('../src/api');
    storeTokens(tokens());
    const fetcher = vi.fn(async (url: string) => url.includes('page=0')
      ? response({ content: [{ id: 7, status: 'CANCELLED' }], totalPages: 2 })
      : response({ content: [{ id: 18, status: 'CONFIRMED' }], totalPages: 2 }));
    vi.stubGlobal('fetch', fetcher);
    expect(await api.upcomingHistory()).toEqual([{ id: 7, status: 'CANCELLED' }, { id: 18, status: 'CONFIRMED' }]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/users/me/bookings?page=0&size=100&scope=upcoming',
      '/api/users/me/bookings?page=1&size=100&scope=upcoming',
    ]);
  });
});

describe('registration and email verification', () => {
  it('sends password confirmation and signs in with the returned verification tokens', async () => {
    const { api } = await import('../src/api');
    const client = await import('../src/api/client');
    const registration = { name: 'Олена Тест', phone: '+380671234567', email: 'olena@example.com', password: 'StrongPass123', confirmPassword: 'StrongPass123' };
    const codes = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/register')) {
        expect(JSON.parse(String(init.body))).toEqual(registration);
        return response({ email: registration.email, codeExpiresInSeconds: 600 }, 202);
      }
      if (url.endsWith('/auth/verify-email')) {
        const body = JSON.parse(String(init.body));
        expect(body.email).toBe(registration.email);
        codes(body.code);
        return body.code === '123456' ? response(tokens()) : response({ detail: 'Invalid or expired code' }, 400);
      }
      expect(url).toBe('/api/users/me');
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer access-1');
      return response({ email: registration.email, emailVerified: true });
    }));

    await expect(api.register(registration)).resolves.toEqual({ email: registration.email, codeExpiresInSeconds: 600 });
    expect(client.hasSession()).toBe(false);
    await expect(api.verify(registration.email, '111111')).rejects.toMatchObject({ status: 400 });
    expect(client.hasSession()).toBe(false);
    await api.verify(registration.email, '123456');
    expect(codes.mock.calls).toEqual([['111111'], ['123456']]);
    expect(client.hasSession()).toBe(true);
    await expect(api.me()).resolves.toMatchObject({ emailVerified: true });
  });
});

describe('checkout and admin actions', () => {
  it('sends the booking payment batch as JSON and uses both return routes', async () => {
    const { storeTokens } = await import('../src/api/client');
    const { startCheckout, pendingCheckout, getPaymentId } = await import('../src/checkout');
    storeTokens(tokens());
    vi.stubGlobal('location', { origin: 'https://hub.example' });
    const checkout = 'https://checkout.stripe.com/c/pay/cs_test_example';
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) => response({ url: checkout }));
    vi.stubGlobal('fetch', fetcher);
    const ids = [getPaymentId({ paymentId: 52 }), getPaymentId({ payment: { id: 21 } })].filter(id => id !== null);
    await expect(startCheckout(ids, 17)).resolves.toBe(checkout);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('/api/payments/stripe-session/batch');
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toEqual({
      paymentIds: [21, 52],
      successUrl: 'https://hub.example/payment/success',
      cancelUrl: 'https://hub.example/my-bookings',
    });
    expect(pendingCheckout()).toMatchObject({ paymentIds: [21, 52], sessionId: 'cs_test_example', userId: 17 });
    await expect(startCheckout(ids, 17)).resolves.toBe(checkout);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('requires paid status for every expected payment', async () => {
    const { checkoutIsPaid } = await import('../src/checkout');
    const payment = { amount: 100, bookingId: 2, subscriptionId: null, paymentMethod: 'STRIPE' };
    const first = { ...payment, id: 20, status: 'PAID' };
    const second = { ...payment, id: 23, status: 'UNPAID' };
    expect(checkoutIsPaid([20, 23], first)).toBe(false);
    expect(checkoutIsPaid([20, 23], [first, second])).toBe(false);
    expect(checkoutIsPaid([20, 23], { payments: [first, { ...second, status: 'PAID' }] })).toBe(true);
  });

  it('passes Stripe return URLs and verifies the returned session through authenticated API calls', async () => {
    const { api } = await import('../src/api');
    const { storeTokens } = await import('../src/api/client');
    storeTokens(tokens());
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer access-1');
      return response({ id: 19, status: 'PAID' });
    });
    vi.stubGlobal('fetch', fetcher);
    await api.stripeSession(19, 'https://hub.example/', 'https://hub.example/?checkout=cancelled&payment_id=19');
    await api.verifyStripePayment('cs_test_example');

    const [checkout, options] = fetcher.mock.calls[0];
    const url = new URL(checkout, 'https://hub.example');
    expect(url.pathname).toBe('/api/payments/19/stripe-session');
    expect(url.searchParams.get('successUrl')).toBe('https://hub.example/');
    expect(url.searchParams.get('cancelUrl')).toBe('https://hub.example/?checkout=cancelled&payment_id=19');
    expect(options.method).toBe('POST');
    expect(fetcher.mock.calls[1][0]).toBe('/api/payments/success?session_id=cs_test_example');
  });

  it('sends the desired user status and records terminal payments as CARD', async () => {
    const { api } = await import('../src/api');
    const { storeTokens } = await import('../src/api/client');
    storeTokens(tokens());
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) => response({}));
    vi.stubGlobal('fetch', fetcher);
    await api.setUserBlocked(12, true);
    await api.setUserBlocked(12, false);
    await api.updatePayment(19, 'CARD');
    await api.adminUsers(1, 'тест +380', 'name');

    expect(fetcher.mock.calls.slice(0, 3).map(([path, options]) => [path, options.method])).toEqual([
      ['/api/admin/users/12/block', 'POST'],
      ['/api/admin/users/12/unblock', 'POST'],
      ['/api/admin/payments/19/status', 'PUT'],
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[2][1].body))).toEqual({ status: 'PAID', paymentMethod: 'CARD' });
    const query = new URL(fetcher.mock.calls[3][0], 'https://hub.example').searchParams;
    expect(query.get('sortBy')).toBe('name');
    expect(query.get('direction')).toBe('asc');
    expect(query.get('search')).toBe('тест +380');
  });
});
