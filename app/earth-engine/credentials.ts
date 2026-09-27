import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createSign} from 'node:crypto';
import {vaultPath,vaultRead,vaultWrite,vaultDelete,vaultReady,signedIn,setting} from '@/app/storage/vault';
import {lock,unlock} from '@/db/store';

// Two ways to reach Earth Engine:
// - platform: the server's own Cloud project (a service account registered for noncommercial Earth
//   Engine use), available to every signed-in user as a built-in tool with a daily quota;
// - user: a person's own Google account and Cloud project, authorized through the Earth Engine
//   connector, so the work runs under their permissions, private assets and quota.
export const EE_SCOPE='https://www.googleapis.com/auth/earthengine';
export type EeAccount={kind:'platform'|'user';project:string;ownerId:string;token:()=>Promise<string>};
const b64url=(v:string|Buffer)=>Buffer.from(v).toString('base64url');
const keyFile=()=>setting('EARTH_ENGINE_SERVICE_ACCOUNT_KEY_FILE')||resolve(process.env.DATA_DIR||'./data','secrets','earthengine-service-account.json');
type Key={client_email:string;private_key:string;project_id?:string};
let cachedKey:{key:Key|null;at:number}|undefined,platformToken:{token:string;expires:number}|undefined;
async function serviceKey(){
 if(cachedKey&&Date.now()-cachedKey.at<60000)return cachedKey.key;
 let key:Key|null=null;try{const k=JSON.parse(await readFile(keyFile(),'utf8'));if(k.client_email&&k.private_key)key=k;}catch{}
 cachedKey={key,at:Date.now()};return key;
}
async function metadataToken(){
 if(setting('EARTH_ENGINE_USE_METADATA')!=='true')return null;
 const r=await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes='+encodeURIComponent(EE_SCOPE),{headers:{'Metadata-Flavor':'Google'},signal:AbortSignal.timeout(5000)}).catch(()=>null);
 if(!r?.ok)return null;const d=await r.json() as {access_token?:string;expires_in?:number};return d.access_token?{token:d.access_token,expires:Date.now()+(d.expires_in||3600)*1000}:null;
}
export async function platformStatus(){const key=await serviceKey(),project=setting('EARTH_ENGINE_PROJECT')||key?.project_id||'';return {configured:!!project&&(!!key||setting('EARTH_ENGINE_USE_METADATA')==='true'),project};}
async function mintPlatformToken(){
 if(platformToken&&platformToken.expires>Date.now()+60000)return platformToken.token;
 const key=await serviceKey();
 if(!key){const m=await metadataToken();if(!m)throw Error('Earth Engine is not set up on this server yet.');platformToken=m;return m.token;}
 const now=Math.floor(Date.now()/1000),head=b64url(JSON.stringify({alg:'RS256',typ:'JWT'})),claims=b64url(JSON.stringify({iss:key.client_email,scope:EE_SCOPE,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
 const assertion=head+'.'+claims+'.'+createSign('RSA-SHA256').update(head+'.'+claims).sign(key.private_key).toString('base64url');
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(20000)});
 const d=await r.json().catch(()=>({})) as {access_token?:string;expires_in?:number;error_description?:string};
 if(!r.ok||!d.access_token){console.error('earth engine service token failed',r.status,d.error_description);throw Error('The server could not authorize with Earth Engine.');}
 platformToken={token:d.access_token,expires:Date.now()+(d.expires_in||3600)*1000};return d.access_token;
}
export async function platformAccount(userId:string):Promise<EeAccount>{const s=await platformStatus();if(!s.configured)throw Error('Earth Engine is not set up on this server yet.');return {kind:'platform',project:s.project,ownerId:userId,token:mintPlatformToken};}

// The user's own connection (Google OAuth with the Earth Engine scope, stored in the vault).
export const oauthConfigured=()=>!!setting('GOOGLE_CLIENT_ID')&&!!setting('GOOGLE_CLIENT_SECRET')&&vaultReady();
export async function tokenRequest(values:Record<string,string>){
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:setting('GOOGLE_CLIENT_ID'),client_secret:setting('GOOGLE_CLIENT_SECRET'),...values}),signal:AbortSignal.timeout(20000)});
 const d=await r.json().catch(()=>({})) as {access_token?:string;refresh_token?:string;expires_in?:number;scope?:string;error?:string};
 if(!r.ok||!d.access_token){console.error('earth engine oauth token failed',r.status,d.error);throw Error('Reconnect Google Earth Engine in Connectors.');}
 return d;
}
export async function userConnection(userId:string){if(userId.startsWith('guest:')||!vaultReady())return null;const saved=await vaultRead(await vaultPath(userId,'earthengine'));return saved&&saved.ownerId===userId?saved as {ownerId:string;project:string;email?:string;refreshToken:string;accessToken:string;expires:number}:null;}
export async function userAccount(userId:string):Promise<EeAccount>{
 signedIn(userId);const saved=await userConnection(userId);if(!saved)throw Error('Connect your Google Earth Engine account in Connectors first.');
 return {kind:'user',project:saved.project,ownerId:userId,token:async()=>{
  const path=await vaultPath(userId,'earthengine'),lease=await lock('earthengine-token:'+userId,30000);if(!lease)throw Error('Earth Engine connection is busy. Retry shortly.');
  try{const t=await vaultRead(path);if(!t||t.ownerId!==userId)throw Error('Connect your Google Earth Engine account in Connectors first.');if(t.expires>Date.now()+60000)return String(t.accessToken);
   const fresh=await tokenRequest({grant_type:'refresh_token',refresh_token:t.refreshToken});await vaultWrite(path,{...t,accessToken:fresh.access_token,expires:Date.now()+(fresh.expires_in||3600)*1000});return String(fresh.access_token);}
  finally{await unlock(lease);}
 }};
}
export async function disconnectUser(userId:string){signedIn(userId);await vaultDelete(await vaultPath(userId,'earthengine'));}
