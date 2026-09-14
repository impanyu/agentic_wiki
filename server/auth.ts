import { randomBytes, createHash } from 'node:crypto';
import { env } from './runtime';
export const sessionCookie = 'agenticwiki_session';
export const stateCookie = 'agenticwiki_oauth_state';
export const token = () => randomBytes(32).toString('base64url');
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export type User = { userId: string; displayName: string; email: string; fullName: string | null };
export function origin() {
  const url = new URL(process.env.APP_URL || 'http://localhost:3000');
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw Error('APP_URL must be an HTTPS origin (HTTP localhost is allowed for development).');
  if (process.env.NODE_ENV === 'production' && !process.env.APP_URL) throw Error('APP_URL is required in production.');
  return url.origin;
}
export function safeReturn(value: string | null) { try { const u = new URL(value || '/', origin()); return u.origin === origin() && !u.pathname.startsWith('/auth/') ? u.pathname + u.search + u.hash : '/'; } catch { return '/'; } }
export function cookie(name: string, value: string, maxAge: number) { return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${origin().startsWith('https:') ? '; Secure' : ''}`; }
export function requestCookie(request: Request, name: string) { return request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1) || ''; }
export async function sessionUser(value: string): Promise<User | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const row = await env.DB.prepare('SELECT user_json FROM auth_sessions WHERE hash=? AND expires>?').bind(hash(value), Date.now()).first<{user_json:string}>();
  return row ? JSON.parse(row.user_json) : null;
}
export async function pruneAuth() { await env.DB.batch([env.DB.prepare('DELETE FROM auth_states WHERE expires<?').bind(Date.now()), env.DB.prepare('DELETE FROM auth_sessions WHERE expires<?').bind(Date.now())]); }
