import { z } from 'zod';
import { env } from '@/server/runtime';
import { token, hash, cookie, stateCookie, sessionCookie, requestCookie, origin } from '@/server/auth';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams, state = q.get('state') || '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || state !== requestCookie(request,stateCookie)) throw Error('Invalid state');
    const pending = await env.DB.prepare('DELETE FROM auth_states WHERE hash=? AND expires>? RETURNING verifier,return_to').bind(hash(state),Date.now()).first<{verifier:string;return_to:string}>();
    if (!pending || !q.get('code') || q.has('error')) throw Error('Expired or denied authorization');
    const response = await fetch('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID!,client_secret:process.env.GOOGLE_CLIENT_SECRET!,redirect_uri:origin()+'/auth/google/callback',grant_type:'authorization_code',code:q.get('code')!,code_verifier:pending.verifier}),signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw Error('Token exchange failed');
    const credentials = z.object({access_token:z.string().min(1)}).parse(await response.json());
    if (typeof credentials.access_token !== 'string') throw Error('Missing token');
    const info = await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+credentials.access_token},redirect:'error',signal:AbortSignal.timeout(20000)});
    if (!info.ok) throw Error('Identity lookup failed');
    const user = z.object({sub:z.string().min(1),email:z.string().email(),email_verified:z.literal(true),name:z.string().optional()}).parse(await info.json());
    if (typeof user.sub !== 'string' || !user.sub || typeof user.email !== 'string' || user.email_verified !== true) throw Error('Unverified identity');
    const session = token(), old = requestCookie(request,sessionCookie);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM auth_sessions WHERE hash=?').bind(hash(old)),
      env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?)').bind(hash(session),JSON.stringify({userId:'google:'+user.sub,email:user.email,displayName:user.name||user.email,fullName:user.name||null}),Date.now()+30*86400000)
    ]);
    const headers = new Headers({Location:origin()+pending.return_to,'Cache-Control':'no-store'});
    headers.append('Set-Cookie',cookie(sessionCookie,session,30*86400));headers.append('Set-Cookie',cookie(stateCookie,'',0));
    return new Response(null,{status:302,headers});
  } catch { return new Response('Sign-in could not be completed. Please start sign-in again.',{status:400,headers:{'Cache-Control':'no-store','Set-Cookie':cookie(stateCookie,'',0)}}); }
}
