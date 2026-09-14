import { env } from '@/server/runtime';
import { token, hash, cookie, stateCookie, origin, safeReturn, pruneAuth } from '@/server/auth';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return new Response('Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server.', {status:503});
  const state = token(), verifier = token();
  await pruneAuth();
  await env.DB.prepare('INSERT INTO auth_states VALUES(?,?,?,?)').bind(hash(state), verifier, safeReturn(new URL(request.url).searchParams.get('return_to')), Date.now()+600000).run();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID, redirect_uri:origin()+'/auth/google/callback', response_type:'code', scope:'openid email profile', state, code_challenge:Buffer.from(hash(verifier),'hex').toString('base64url'), code_challenge_method:'S256'}).toString();
  return new Response(null,{status:302,headers:{Location:url.toString(),'Set-Cookie':cookie(stateCookie,state,600),'Cache-Control':'no-store'}});
}
