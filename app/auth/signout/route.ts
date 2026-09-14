import { env } from '@/server/runtime';
import { cookie, hash, origin, sessionCookie, requestCookie } from '@/server/auth';
export async function GET() { return new Response('<!doctype html><html><head><title>Sign out · AgenticWiKi</title></head><body><form method="post"><button type="submit">Sign out of AgenticWiKi</button></form><a href="/">Cancel</a></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'"}}); }
export async function POST(request: Request) {
  if (request.headers.get('origin') !== origin()) return new Response('Forbidden',{status:403});
  await env.DB.prepare('DELETE FROM auth_sessions WHERE hash=?').bind(hash(requestCookie(request,sessionCookie))).run();
  return new Response(null,{status:303,headers:{Location:origin()+'/', 'Set-Cookie':cookie(sessionCookie,'',0),'Cache-Control':'no-store'}});
}
