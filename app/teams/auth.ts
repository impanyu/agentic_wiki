import {timingSafeEqual} from 'node:crypto';
// Operators only: the TEAM_ADMIN_TOKEN (at least 24 characters) in the x-team-token header.
export function teamAuthorized(request:Request){
 const want=process.env.TEAM_ADMIN_TOKEN||'',got=request.headers.get('x-team-token')||'';
 return want.length>=24&&got.length===want.length&&timingSafeEqual(Buffer.from(got),Buffer.from(want));
}
