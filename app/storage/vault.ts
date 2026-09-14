import {env} from '@/server/runtime';import {encryptSecret,decryptSecret} from '@/app/connections/google-drive/crypto';
export const setting=(name:string)=>(env as unknown as Record<string,string>)[name]||process.env[name]||'';
export const vaultKey=()=>setting('STORAGE_TOKEN_ENCRYPTION_KEY')||setting('GOOGLE_TOKEN_ENCRYPTION_KEY');
export function vaultReady(){try{return atob(vaultKey()).length===32;}catch{return false;}}
const bucket=()=>(env as unknown as {FILES:R2Bucket}).FILES;
export async function vaultPath(userId:string,name:string){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(userId));return 'secrets/storage/'+Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('')+'/'+name;}
export async function vaultRead(path:string){const v=await bucket().get(path);return v?decryptSecret(await v.text(),vaultKey(),path):null;}
export async function vaultWrite(path:string,value:unknown){await bucket().put(path,await encryptSecret(value,vaultKey(),path));}
export async function vaultDelete(path:string){await bucket().delete(path);}
export function signedIn(userId:string){if(userId.startsWith('guest:'))throw Error('STORAGE_SIGN_IN_REQUIRED');}
