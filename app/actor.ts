import {z} from 'zod';
import {getChatGPTUser} from './chatgpt-auth';
// One principal is shared by page navigation, notebook tools, agents and history.
// Guest identities use the existing HttpOnly history cookie.
export async function getActor(request:Request){
 const user=await getChatGPTUser();
 let cookie:string|null=null,guest=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('samepage_visitor='))?.slice('samepage_visitor='.length);
 if(!user&&!z.string().uuid().safeParse(guest).success){guest=crypto.randomUUID();cookie='samepage_visitor='+guest+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000'+(new URL(process.env.APP_URL||request.url).protocol==='https:'?'; Secure':'');}
 const userId=user?.userId||'guest:'+guest;
 return {userId,userName:user?.fullName||user?.displayName.split('@')[0]||'Guest',signedIn:!!user,historyKey:user?'user:'+user.userId:userId,cookie,finish(response:Response){if(cookie)response.headers.append('Set-Cookie',cookie);return response;}};
}
