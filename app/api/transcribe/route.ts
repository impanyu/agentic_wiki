import {getActor} from '@/app/actor';
import {aiKey,reply} from '@/db/store';

// Speech to text for the address bar and the page chat. The browser records a
// short clip and posts it here; the transcription model detects the spoken
// language itself, so Chinese, English and mixed speech all come back as text.
const MAX_BYTES=24*1024*1024;
export async function POST(request:Request){
 const actor=await getActor(request);
 if(!actor.signedIn)return actor.finish(reply({error:'Sign in to use voice input.'},401));
 const key=aiKey();if(!key)return actor.finish(reply({error:'Voice input is not configured.'},503));
 let audio:File|null=null;
 try{const form=await request.formData();const value=form.get('audio');audio=value instanceof File?value:null;}catch{}
 if(!audio||!audio.size)return actor.finish(reply({error:'No audio was received.'},400));
 if(audio.size>MAX_BYTES)return actor.finish(reply({error:'The recording is too long.'},413));
 const body=new FormData();
 body.append('file',audio,audio.name||'speech.webm');
 body.append('model',process.env.OPENAI_TRANSCRIBE_MODEL||'gpt-4o-transcribe');
 body.append('response_format','json');
 body.append('prompt','The speaker may use Mandarin Chinese (简体中文), English, or both in one sentence. Transcribe exactly what is said, with punctuation.');
 try{
  const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+key},body,signal:AbortSignal.timeout(90000)});
  const data=await response.json().catch(()=>({})) as {text?:string;error?:{message?:string}};
  if(!response.ok){console.error('transcribe failed',response.status,data.error?.message);return actor.finish(reply({error:'Could not transcribe the recording.'},502));}
  return actor.finish(reply({text:String(data.text||'').trim()}));
 }catch(e){console.error('transcribe failed',e instanceof Error?e.message:e);return actor.finish(reply({error:'Could not transcribe the recording.'},502));}
}
