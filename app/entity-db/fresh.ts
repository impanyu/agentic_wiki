import {timingSafeEqual} from 'node:crypto';
import {headers} from 'next/headers';
// An agent checking a page it just changed (the preview tool) sends x-rankwiki-fresh with the operators' token: the
// page is rebuilt from the database now (and its precomputed copy replaced) instead of served from the copy.
export const FRESH_HEADER='x-rankwiki-fresh';
export async function wantsFresh():Promise<boolean>{
 const want=process.env.TEAM_ADMIN_TOKEN||'';if(want.length<24)return false;
 const got=(await headers()).get(FRESH_HEADER)||'';
 return got.length===want.length&&timingSafeEqual(Buffer.from(got),Buffer.from(want));
}
