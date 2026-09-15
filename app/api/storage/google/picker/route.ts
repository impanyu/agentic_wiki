import {getActor} from '@/app/actor';
import {reply,sameOrigin} from '@/db/store';
import {storageToken} from '@/app/storage/oauth';
import {setting} from '@/app/storage/vault';
export async function POST(request:Request){
 const actor=await getActor(request);
 if(!sameOrigin(request))return actor.finish(reply({error:'Same-origin request required.'},403));
 try{
  if(actor.userId.startsWith('guest:'))return actor.finish(reply({error:'Sign in to connect storage'},401));
  const developerKey=setting('GOOGLE_PICKER_API_KEY'),appId=setting('GOOGLE_CLIENT_ID').split('-')[0];
  if(!developerKey||!/^\d+$/.test(appId))return actor.finish(reply({error:'Google file picker is not configured yet.'},503));
  const token=await storageToken('google',actor.userId);
  const response=reply({token,developerKey,appId});response.headers.set('Cache-Control','no-store');return actor.finish(response);
 }catch{return actor.finish(reply({error:'Reconnect Google Drive to enable reading all files and editing selected files.'},400));}
}
