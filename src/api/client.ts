import { ApiError, networkError, timeoutError } from './errors';
import type { Tokens } from './types';

const BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
const SESSION_KEY = 'tviy-hub-session';
type Session = Tokens & { expiresAt: number };
let session: Session | null = readSession();
let refreshFlight: Promise<void> | null = null;
let revision = 0;

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    return typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string' ? parsed : null;
  } catch { return null; }
}
function notify() { window.dispatchEvent(new Event('tviy-session')); }
export const hasSession = () => !!session;
export function storeTokens(tokens: Tokens) {
  session = { ...tokens, expiresAt: Date.now() + tokens.expiresInSeconds * 1000 };
  revision++;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* In-memory session still works. */ }
  notify();
}
export function clearSession() {
  session = null;
  revision++;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* Storage can be unavailable. */ }
  notify();
}
export { ApiError, errorMessage } from './errors';

async function raw<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const abort = () => controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  try {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    // Keep server-side validation messages stable for the Ukrainian translations.
    headers.set('Accept-Language', 'en');
    if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(`${BASE}${path}`, { ...init, headers, signal: controller.signal });
    if (response.status === 204) return undefined as T;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) throw new ApiError(response.ok ? 502 : response.status, '');

    const body: unknown = await response.json().catch(error => {
      if (controller.signal.aborted) throw error;
      throw new ApiError(response.ok ? 502 : response.status, '');
    });
    if (!response.ok) {
      const problem = body && typeof body === 'object' ? body as Record<string, unknown> : {};
      const detail = [problem.detail, problem.message, problem.title].find(value => typeof value === 'string' && value.trim());
      const fields = problem.errors && typeof problem.errors === 'object' && !Array.isArray(problem.errors)
        ? Object.fromEntries(Object.entries(problem.errors).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        : {};
      throw new ApiError(response.status, typeof detail === 'string' ? detail : '', fields);
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (controller.signal.aborted) throw new ApiError(0, timeoutError);
    throw new ApiError(0, networkError);
  } finally { clearTimeout(timer); init.signal?.removeEventListener('abort', abort); }
}
async function refresh(): Promise<void> {
  if (!session?.refreshToken) throw new ApiError(401, 'Authentication required');
  if (!refreshFlight) {
    const currentRevision = revision;
    const refreshToken = session.refreshToken;
    refreshFlight = raw<Tokens>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) })
      .then(tokens => { if (revision === currentRevision) storeTokens(tokens); })
      .catch(error => {
        // A transient network error must not silently discard the refresh token.
        if (revision === currentRevision && error instanceof ApiError && [400,401,403].includes(error.status)) clearSession();
        throw error;
      })
      .finally(() => { refreshFlight = null; });
  }
  return refreshFlight;
}
export async function request<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
  if (auth && !session) throw new ApiError(401, 'Authentication required');
  if (auth && session && session.expiresAt <= Date.now() + 15000) await refresh();
  if (auth && !session) throw new ApiError(401, 'Authentication required');
  const usedToken = auth ? session?.accessToken : undefined;
  try { return await raw<T>(path, init, usedToken); }
  catch (error) {
    if (!auth || !(error instanceof ApiError) || error.status !== 401 || !session) throw error;
    // Another request may already have rotated the token while this one was in flight.
    if (session.accessToken === usedToken) await refresh();
    if (!session) throw error;
    const retryToken = session.accessToken;
    try { return await raw<T>(path, init, retryToken); } // At most one retry, never a refresh loop.
    catch (retryError) {
      if (retryError instanceof ApiError && retryError.status === 401 && session?.accessToken === retryToken) clearSession();
      throw retryError;
    }
  }
}
export async function logout() {
  const refreshToken = session?.refreshToken;
  clearSession();
  if (refreshToken) await request<void>('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) });
}
