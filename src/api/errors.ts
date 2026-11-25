export class ApiError extends Error {
  constructor(public status: number, message: string, public fields: Record<string, string> = {}) {
    super(message);
  }
}

export const bookingAlreadyStartedError = 'Бронювання вже почалося або завершилося. Скасувати його неможливо.';

const messages = new Map(Object.entries({
  'Invalid email or password': 'Неправильна пошта або пароль.',
  'Account is blocked': 'Цей обліковий запис заблоковано. Зверніться до адміністратора.',
  'Authentication required': 'Увійдіть, щоб продовжити.',
  'Invalid or expired refresh token': 'Сесія завершилася. Увійдіть знову.',
  'User no longer exists': 'Обліковий запис більше не існує.',
  'Access denied': 'У вас немає прав для цієї дії.',
  'Verify your email first': 'Спочатку підтвердьте електронну пошту.',
  'Email is already registered': 'Ця електронна адреса вже використовується.',
  'Phone is already registered': 'Цей номер телефону вже використовується.',
  'Invalid or expired code': 'Код неправильний або строк його дії закінчився.',
  'Please wait before requesting a new code': 'Зачекайте трохи, перш ніж запросити новий код.',
  'Too many failed login attempts, try again later': 'Забагато невдалих спроб входу. Спробуйте пізніше.',
  'Could not send the email, try again later': 'Не вдалося надіслати лист із кодом. Спробуйте пізніше.',
  'Current password is incorrect': 'Поточний пароль неправильний.',
  'This account has no password yet; set one via forgot-password': 'Цей обліковий запис ще не має пароля. Скористайтеся функцією «Забули пароль?», щоб його встановити.',
  'The meeting room can be booked by the hour only.': 'Переговорну кімнату можна бронювати лише погодинно.',
  'Invalid time slot: end time must be after start time': 'Час завершення має бути пізнішим за час початку.',
  'Hourly booking is restricted to fixed 1-hour slots. Minutes must be 00.': 'Виберіть час початку й завершення з цілої години.',
  'This desk is occupied by an active subscription for this date': 'На цю дату робоче місце зайняте за абонементом.',
  'Workspace is already booked for the whole day (DAILY)': 'Це місце вже заброньоване на весь день.',
  'Cannot book for the whole day. Hourly bookings already exist': 'На цей день уже є погодинні бронювання. Оберіть інший день або місце.',
  'Selected time slot overlaps with an existing booking': 'Вибраний час перетинається з іншим бронюванням.',
  'Tariff not found for this resource and booking type': 'Для вибраного місця й формату бронювання немає тарифу.',
  'Booking is already cancelled': 'Це бронювання вже скасовано.',
  'Cannot cancel a booking that has already started or passed': bookingAlreadyStartedError,
  'You can only cancel your own bookings': 'Ви можете скасувати лише власне бронювання.',
  'Subscriptions can only be created for DESK resources. MEETING_ROOM is hourly only.': 'Абонемент можна оформити лише на робоче місце. Переговорна кімната доступна погодинно.',
  'The desk is already held or active for the selected dates': 'На вибраний період це місце вже закріплене за іншим абонементом.',
  'Cannot create subscription: this desk already has standard hourly/daily bookings within this period.': 'На вибраний період уже є погодинні або денні бронювання цього місця.',
  'Only ACTIVE subscriptions can be extended': 'Продовжити можна лише активний абонемент.',
  'Extension days must be greater than zero': 'Кількість днів продовження має бути більшою за нуль.',
  'Cannot extend subscription: the extension period conflicts with another client\'s upcoming subscription': 'Неможливо продовжити абонемент: період продовження перетинається з іншим абонементом на це місце.',
  'Cannot extend subscription: this desk already has standard hourly/daily bookings within the extension period.': 'Неможливо продовжити абонемент: на період продовження вже є погодинні або денні бронювання цього місця.',
  'You cannot block yourself': 'Ви не можете заблокувати власний обліковий запис.',
  'Malformed JSON request': 'Запит має некоректний формат. Повторіть дію.',
}));

const bookingAvailabilityConflicts = new Set([
  'This desk is occupied by an active subscription for this date',
  'Workspace is already booked for the whole day (DAILY)',
  'Cannot book for the whole day. Hourly bookings already exist',
  'Selected time slot overlaps with an existing booking',
]);

export function isBookingAvailabilityConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 &&
    (bookingAvailabilityConflicts.has(error.message) || /^The hub is (?:closed|fully rented for an event) on /.test(error.message));
}

export function isUnconfirmedWrite(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status >= 500);
}

const messagePatterns: [RegExp, (...values: string[]) => string][] = [
  [/^The hub is fully rented for an event on (\d{4}-\d{2}-\d{2})$/, date => `На ${date} весь простір заброньовано для події. Оберіть іншу дату.`],
  [/^The hub is closed on (\d{4}-\d{2}-\d{2}) \(holiday, repair or special event\)$/, date => `На ${date} простір зачинено. Оберіть іншу дату.`],
  [/^The hub is closed on weekends \((\d{4}-\d{2}-\d{2})\)\. Booking is unavailable\.$/, date => `${date} простір зачинено. Оберіть будній день.`],
  [/^Clients can only book between (\d{2}:\d{2}) and (\d{2}:\d{2})$/, (start, end) => `Бронювання доступне з ${start} до ${end} за Київським часом.`],
  [/^Hourly booking must be between (\d+) and (\d+) hours$/, (min, max) => `Тривалість погодинного бронювання має бути від ${min} до ${max} год.`],
  [/^HOURLY bookings can only be cancelled at least (\d+) hours before the start time$/, hours => `Погодинне бронювання можна скасувати щонайменше за ${hours} год. до початку.`],
  [/^DAILY bookings can only be cancelled at least (\d+) hours before the start time$/, hours => `Денне бронювання можна скасувати щонайменше за ${hours} год. до початку.`],
  [/^Workspace (?:with ID \d+ not found|not found with id: \d+)$/, () => 'Вибране місце не знайдено. Оберіть інше місце.'],
  [/^Booking with ID (\d+) not found$/, id => `Бронювання №${id} не знайдено.`],
  [/^User not found(?:(?: with id)?: \d+)?$/, () => 'Користувача не знайдено.'],
  [/^Payment transaction not found with id: (\d+)$/, id => `Платіж №${id} не знайдено.`],
];

const fieldLabels = new Map(Object.entries({
  name: 'Ім’я та прізвище', email: 'Пошта', newEmail: 'Нова пошта', phone: 'Телефон', newPhone: 'Новий телефон',
  password: 'Пароль', currentPassword: 'Поточний пароль', newPassword: 'Новий пароль',
  confirmPassword: 'Підтвердження пароля', confirmNewPassword: 'Підтвердження нового пароля', code: 'Код із листа',
  date: 'Дата', bookingDates: 'Дата бронювання', startDate: 'Дата початку абонемента',
  startTime: 'Час початку', endTime: 'Час завершення', workspaceId: 'Місце',
  type: 'Тип', bookingType: 'Формат бронювання', status: 'Статус оплати', paymentMethod: 'Спосіб оплати',
}));

export const phoneFormatError = 'Введіть номер телефону в міжнародному форматі, наприклад +380671234567.';
export const phoneLengthError = 'Номер телефону повинен містити від 7 до 15 цифр після знака +.';
export const passwordsMismatch = 'Паролі не збігаються.';

export const normalizePhone = (value: string) => value.replace(/[\s()-]/g, '');

export function phoneValidationError(phone: string): string {
  const digits = /^\+(\d+)$/.exec(phone)?.[1];
  if (!digits) return phoneFormatError;
  if (digits.length < 7 || digits.length > 15) return phoneLengthError;
  return digits.startsWith('0') ? phoneFormatError : '';
}

const defaultRequiredMessage = 'Заповніть це поле.';
const requiredValidationDetails = new Set([
  'must not be blank', 'must not be null', 'must not be empty',
  'не должно быть пустым', 'не может быть пустым', 'не должно равняться null',
]);

export function requiredFieldMessage(field: string): string {
  if (field === 'confirmPassword') return 'Повторіть пароль.';
  if (field === 'confirmNewPassword') return 'Повторіть новий пароль.';
  return defaultRequiredMessage;
}

function fieldError(field: string, message: string): string | undefined {
  const name = field.replace(/\[\d+\].*$/, '');
  const label = fieldLabels.get(name);
  const detail = message.trim();
  if (requiredValidationDetails.has(detail.toLowerCase().replace(/[.!]$/, ''))) {
    const text = requiredFieldMessage(name);
    return label && text === defaultRequiredMessage ? `${label} · ${text}` : text;
  }
  if (/^must be in international format(?:,|\.|$)/i.test(detail) && /^(newPhone|phone)$/.test(name)) {
    return phoneFormatError;
  }
  const size = /^size must be between (\d+) and (\d+)$/.exec(detail);
  let text: string;
  if (size) {
    const [, min, max] = size;
    text = min === '0' ? `Не більше ${max} символів.` : `Введіть від ${min} до ${max} символів.`;
  } else if (/^Value is not supported\./.test(detail)) {
    text = 'Виберіть значення зі списку.';
  } else {
    text = validationMessages.get(detail) ?? (label ? 'Перевірте значення.' : '');
  }
  return text ? (label ? `${label} · ${text}` : text) : undefined;
}

const validationMessages = new Map(Object.entries({
  'must be a well-formed email address': 'Введіть коректну електронну адресу.',
  'must be a 6-digit code': 'Введіть шість цифр із листа.',
  'passwords do not match': passwordsMismatch,
  'must contain only English, Ukrainian or Russian letters (words may be separated by a space, hyphen or apostrophe)': 'Використовуйте українські, англійські або російські літери. Між словами можна ставити пробіл, дефіс або апостроф.',
  'Booking date cannot be in the past': 'Оберіть сьогоднішню або майбутню дату.',
  'Availability date cannot be in the past': 'Оберіть сьогоднішню або майбутню дату.',
  'Booking date is required': 'Оберіть дату бронювання.',
  'Booking type is required': 'Оберіть формат бронювання.',
  'Workspace ID is required': 'Оберіть місце.',
  'Workspace ID cannot be null': 'Оберіть місце.',
  'Start date cannot be null': 'Оберіть дату початку абонемента.',
  'Payment status cannot be null': 'Виберіть статус оплати.',
  'Payment method cannot be null': 'Виберіть спосіб оплати.',
}));

const defaults: Record<number, string> = {
  400: 'Сервіс відхилив запит. Перевірте введені дані.',
  401: 'Увійдіть, щоб продовжити.',
  403: 'У вас немає прав для цієї дії.',
  404: 'Запитані дані не знайдено.',
  409: 'Дані конфліктують з іншим записом. Оновіть дані й перевірте їх перед повторною спробою.',
  429: 'Забагато запитів. Зачекайте й спробуйте пізніше.',
  502: 'Сервіс тимчасово недоступний. Спробуйте пізніше.',
  503: 'Сервіс тимчасово недоступний. Спробуйте пізніше.',
  504: 'Сервіс не відповів вчасно. Спробуйте пізніше.',
};

export function errorMessage(error: unknown, fallback = 'Не вдалося виконати дію.'): string {
  if (!(error instanceof ApiError)) return fallback;
  if (error.status === 0) return error.message;

  const detail = error.message.trim();
  const fields = Object.entries(error.fields).map(([key, value]) => fieldError(key, value)).filter(Boolean);
  if (detail === 'Validation failed' || fields.length) {
    return fields.length ? fields.join(' ') : 'Перевірте введені дані.';
  }

  const known = messages.get(detail) ?? messages.get(detail.replace(/\.$/, ''));
  if (known) return known;
  for (const [pattern, format] of messagePatterns) {
    const match = pattern.exec(detail);
    if (match) return format(...match.slice(1));
  }
  return defaults[error.status] ?? (error.status >= 500 ? 'На сервері сталася помилка. Спробуйте пізніше.' : fallback);
}
