import {timingSafeEqual} from 'node:crypto';
// Pool workers (our own GPUs) authenticate with LLM_POOL_TOKEN.
export function poolAuthorized(request:Request){
 const token=process.env.LLM_POOL_TOKEN||'',given=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 return !!token&&given.length===token.length&&timingSafeEqual(Buffer.from(given),Buffer.from(token));
}
