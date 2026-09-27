import {createHash,randomBytes} from 'node:crypto';
import {vaultPath,vaultRead,vaultWrite,vaultDelete,signedIn,setting} from '@/app/storage/vault';
import {database,lock,unlock} from '@/db/store';
import {safeReturnTo,validateOAuthState} from '@/app/connections/google-drive/crypto';
import {EE_SCOPE,oauthConfigured,tokenRequest,userConnection} from './credentials';
import {earthEngineTools} from './tools';

// The Earth Engine connector: the person signs in with Google and names the Cloud project that is
// registered for Earth Engine. It reuses the Google OAuth client and its registered redirect URI
// (/api/storage/google/callback), which hands the callback here when the state is an Earth Engine one.
export const EE_COOKIE='agenticwiki_earthengine';
export const projectPattern=/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
export async function earthEngineConnectorStatus(userId:string){const saved=await userConnection(userId);return {configured:oauthConfigured(),connected:!!saved,project:saved?.project,email:saved?.email};}
export async function beginEarthEngine(userId:string,origin:string,returnTo:unknown,project:unknown){
 signedIn(userId);if(!oauthConfigured())throw Error('Google sign-in is not configured on this server.');
 const id=String(project||'').trim().toLowerCase();if(!projectPattern.test(id))throw Error('Enter your Google Cloud project ID (6–30 lowercase letters, digits or hyphens), for example my-ee-project.');
 const state=crypto.randomUUID(),verifier=randomBytes(32).toString('base64url'),redirect=(process.env.APP_URL||origin)+'/api/storage/google/callback';
 await vaultWrite(await vaultPath(userId,'earthengine-state-'+state),{ownerId:userId,verifier,redirect,project:id,returnTo:safeReturnTo(returnTo),expires:Date.now()+600000});
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 url.search=new URLSearchParams({client_id:setting('GOOGLE_CLIENT_ID'),response_type:'code',redirect_uri:redirect,scope:EE_SCOPE+' openid email',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',access_type:'offline',prompt:'consent',include_granted_scopes:'false'}).toString();
 return {state,url:url.href};
}
export async function isEarthEngineState(userId:string,state:string){if(!/^[a-f0-9-]{36}$/.test(state)||userId.startsWith('guest:'))return false;return !!await vaultRead(await vaultPath(userId,'earthengine-state-'+state)).catch(()=>null);}
export async function finishEarthEngine(userId:string,state:string,cookie:string,code:string,cancelled:boolean){
 signedIn(userId);if(!/^[a-f0-9-]{36}$/.test(state)||state!==cookie)throw Error('Invalid Earth Engine OAuth state.');
 const lease=await lock('earthengine-oauth:'+state,60000);if(!lease)throw Error('OAuth request already used.');
 try{
  const path=await vaultPath(userId,'earthengine-state-'+state),pending=await vaultRead(path);validateOAuthState(pending,userId,state,cookie);await vaultDelete(path);
  if(cancelled)return {returnTo:pending.returnTo as string,status:'cancelled'};
  const t=await tokenRequest({grant_type:'authorization_code',code,code_verifier:pending.verifier,redirect_uri:pending.redirect});
  if(!t.refresh_token||!String(t.scope||'').split(' ').includes(EE_SCOPE))return {returnTo:pending.returnTo as string,status:'scope'};
  // A one-value computation proves the account can use Earth Engine in that project.
  const check=await fetch('https://earthengine.googleapis.com/v1/projects/'+pending.project+'/value:compute',{method:'POST',headers:{Authorization:'Bearer '+t.access_token,'Content-Type':'application/json'},body:JSON.stringify({expression:{result:'0',values:{'0':{constantValue:1}}}}),signal:AbortSignal.timeout(30000)});
  if(!check.ok){console.error('earth engine project check failed',check.status,(await check.text().catch(()=>'')).slice(0,300));return {returnTo:pending.returnTo as string,status:'project'};}
  let email='';try{const idt=String((t as {id_token?:string}).id_token||'').split('.')[1];email=idt?String(JSON.parse(Buffer.from(idt,'base64url').toString()).email||''):'';}catch{}
  await vaultWrite(await vaultPath(userId,'earthengine'),{ownerId:userId,project:pending.project,email,accessToken:t.access_token,refreshToken:t.refresh_token,expires:Date.now()+(t.expires_in||3600)*1000});
  const names=earthEngineTools.map(x=>x.name);
  await database().prepare("INSERT INTO user_connectors(id,owner_id,name,kind,url,enabled,tools,allowed,automatic) VALUES('earthengine',?,'Google Earth Engine','api','api:earthengine',1,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET enabled=1,revision=user_connectors.revision+1").bind(userId,JSON.stringify(earthEngineTools),JSON.stringify(names),JSON.stringify(names)).run();
  return {returnTo:pending.returnTo as string,status:'connected'};
 }finally{await unlock(lease);}
}
